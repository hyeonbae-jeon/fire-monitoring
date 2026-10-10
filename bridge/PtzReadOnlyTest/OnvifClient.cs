using System.Globalization;
using System.Net;
using System.Net.Security;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Xml;
using System.Xml.Linq;

namespace PtzReadOnlyTest;

public sealed class ProbeException(string code) : Exception(code);
public sealed record RequestResult(string operation, int httpStatus);
public sealed class ProbeReport
{
    public string toolVersion { get; } = "1";
    public DateTimeOffset capturedAt { get; set; } = DateTimeOffset.UtcNow;
    public string result { get; set; } = "not-started";
    public string? error { get; set; }
    public string? transport { get; set; }
    public bool certificateRejected { get; set; }
    public bool certificatePinned { get; set; }
    public int profileCount { get; set; }
    public int ptzProfileCount { get; set; }
    public bool panPresent { get; set; }
    public bool tiltPresent { get; set; }
    public bool zoomPresent { get; set; }
    public bool deviceTimePresent { get; set; }
    public bool mappingVerified { get; } = false;
    public bool liveUpdateVerified { get; } = false;
    public bool northCalibrationVerified { get; } = false;
    public List<RequestResult> requests { get; } = [];
}
public sealed record DeviceIdentity(string? manufacturer, string? model, string? firmware,
    string? serialNumber, string? hardwareId);
public sealed record MediaProfile(string token, string? name, bool hasPtz, string? videoSourceToken);
public sealed record PositionSample(DateTimeOffset receivedAt, DateTimeOffset? deviceUtcTime,
    double? pan, double? tilt, double? zoom, string? panTiltSpace, string? zoomSpace);

// SOAP POST is a read operation here. Only these four fixed operations can be sent.
// No vendor DLL loading, movement/stop, setters, stream requests, discovery or port scanning.
public sealed class OnvifClient : IDisposable
{
    public static readonly XNamespace SoapNs = "http://www.w3.org/2003/05/soap-envelope";
    public static readonly XNamespace DeviceNs = "http://www.onvif.org/ver10/device/wsdl";
    public static readonly XNamespace MediaNs = "http://www.onvif.org/ver10/media/wsdl";
    public static readonly XNamespace PtzNs = "http://www.onvif.org/ver20/ptz/wsdl";
    public static readonly XNamespace SchemaNs = "http://www.onvif.org/ver10/schema";
    private static readonly XNamespace SecurityNs = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd";
    private static readonly XNamespace UtilityNs = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd";
    private const string TokenBase = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#";
    private const string SoapBase = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#";
    private readonly Uri endpoint;
    private readonly HttpClient http;
    private readonly ProbeReport report;
    private readonly CancellationTokenSource budget = new(TimeSpan.FromMinutes(3));
    private string username;
    private string password;
    private Uri? mediaEndpoint, ptzEndpoint;
    private IReadOnlyList<MediaProfile> profiles = [];
    private bool informationRead, capabilitiesRead, profilesRead, statusRead;

    public static Uri ParseEndpoint(string value, bool allowHttp)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) ||
            !(uri.Scheme == "https" || allowHttp && uri.Scheme == "http") ||
            uri.UserInfo.Length != 0 || uri.Query.Length != 0 || uri.Fragment.Length != 0 || uri.AbsolutePath == "/")
            throw new ProbeException("EXPLICIT_DEVICE_SERVICE_URL_REQUIRED");
        return uri;
    }

    public OnvifClient(string serviceUrl, bool allowHttp, string? fingerprint,
        string username, string password, ProbeReport report)
    {
        endpoint = ParseEndpoint(serviceUrl, allowHttp);
        this.report = report;
        this.username = username;
        this.password = password;
        report.transport = endpoint.Scheme;
        byte[]? pin = null;
        if (!string.IsNullOrWhiteSpace(fingerprint))
        {
            string compact = fingerprint.Replace(":", "").Replace(" ", "").Trim();
            if (endpoint.Scheme != "https" || compact.Length != 64 || compact.Any(c => !Uri.IsHexDigit(c)))
                throw new ProbeException("DEVICE_SHA256_FINGERPRINT_INVALID");
            pin = Convert.FromHexString(compact);
        }
        var cache = new CredentialCache();
        // HTTP Basic is never offered. A Digest challenge is the normal authentication handshake.
        cache.Add(new Uri(endpoint.GetLeftPart(UriPartial.Authority) + "/"), "Digest", new NetworkCredential(username, password));
        var handler = new HttpClientHandler
        {
            AllowAutoRedirect = false, UseCookies = false, UseProxy = false,
            Credentials = cache, PreAuthenticate = false,
            ServerCertificateCustomValidationCallback = (request, cert, _, errors) =>
            {
                bool valid = SameOrigin(request.RequestUri!) && cert is not null &&
                    DateTime.UtcNow >= cert.NotBefore.ToUniversalTime() && DateTime.UtcNow <= cert.NotAfter.ToUniversalTime() &&
                    (errors & SslPolicyErrors.RemoteCertificateNotAvailable) == 0 &&
                    (pin is null ? errors == SslPolicyErrors.None :
                        CryptographicOperations.FixedTimeEquals(cert.GetCertHash(HashAlgorithmName.SHA256), pin));
                if (!valid) report.certificateRejected = true;
                else if (pin is not null) report.certificatePinned = true;
                return valid;
            }
        };
        http = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(15) };
    }

    private bool SameOrigin(Uri uri) => uri.Scheme == endpoint.Scheme && uri.Host == endpoint.Host && uri.Port == endpoint.Port;
    private Uri ServiceAddress(string? value)
    {
        if (value is null) throw new ProbeException("SERVICE_ADDRESS_MISSING");
        var uri = ParseEndpoint(value, endpoint.Scheme == "http");
        if (!SameOrigin(uri)) throw new ProbeException("SERVICE_ORIGIN_MISMATCH");
        return uri;
    }
    private XElement SecurityHeader()
    {
        byte[] nonce = RandomNumberGenerator.GetBytes(24);
        string created = DateTimeOffset.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ", CultureInfo.InvariantCulture);
        byte[] time = Encoding.UTF8.GetBytes(created), secret = Encoding.UTF8.GetBytes(password);
        byte[] input = new byte[nonce.Length + time.Length + secret.Length];
        nonce.CopyTo(input, 0); time.CopyTo(input, nonce.Length); secret.CopyTo(input, nonce.Length + time.Length);
        try
        {
            // SHA-1 is required by the ONVIF WS-Security PasswordDigest format, not a TLS choice.
            return new XElement(SecurityNs + "Security", new XAttribute(SoapNs + "mustUnderstand", "true"),
                new XElement(SecurityNs + "UsernameToken",
                    new XElement(SecurityNs + "Username", username),
                    new XElement(SecurityNs + "Password", new XAttribute("Type", TokenBase + "PasswordDigest"), Convert.ToBase64String(SHA1.HashData(input))),
                    new XElement(SecurityNs + "Nonce", new XAttribute("EncodingType", SoapBase + "Base64Binary"), Convert.ToBase64String(nonce)),
                    new XElement(UtilityNs + "Created", created)));
        }
        finally { CryptographicOperations.ZeroMemory(input); CryptographicOperations.ZeroMemory(secret); }
    }
    private async Task<XElement> Read(Uri uri, XElement operation)
    {
        // Reject even internal callers if an operation or destination escapes the read allowlist.
        if (!SameOrigin(uri) || !(operation.Name == DeviceNs + "GetDeviceInformation" ||
            operation.Name == DeviceNs + "GetCapabilities" || operation.Name == MediaNs + "GetProfiles" ||
            operation.Name == PtzNs + "GetStatus")) throw new ProbeException("READ_OPERATION_REQUIRED");
        string action = operation.Name.NamespaceName + "/" + operation.Name.LocalName;
        var envelope = new XElement(SoapNs + "Envelope", new XAttribute(XNamespace.Xmlns + "s", SoapNs),
            new XElement(SoapNs + "Header", SecurityHeader()), new XElement(SoapNs + "Body", operation));
        using var request = new HttpRequestMessage(HttpMethod.Post, uri);
        request.Content = new StringContent(envelope.ToString(SaveOptions.DisableFormatting), Encoding.UTF8);
        request.Content.Headers.ContentType = System.Net.Http.Headers.MediaTypeHeaderValue.Parse($"application/soap+xml; charset=utf-8; action=\"{action}\"");
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(budget.Token);
        timeout.CancelAfter(TimeSpan.FromSeconds(15));
        using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
        report.requests.Add(new(operation.Name.LocalName, (int)response.StatusCode));
        if ((int)response.StatusCode is >= 300 and < 400) throw new ProbeException("REDIRECT_REJECTED");
        if (response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden) throw new ProbeException("AUTHENTICATION_OR_PERMISSION_REJECTED");
        if (response.Content.Headers.ContentLength > 2 * 1024 * 1024) throw new ProbeException("RESPONSE_TOO_LARGE");
        using var stream = await response.Content.ReadAsStreamAsync(timeout.Token);
        using var limited = new MemoryStream();
        byte[] buffer = new byte[8192];
        int count;
        while ((count = await stream.ReadAsync(buffer, timeout.Token)) > 0)
        {
            if (limited.Length + count > 2 * 1024 * 1024) throw new ProbeException("RESPONSE_TOO_LARGE");
            limited.Write(buffer, 0, count);
        }
        limited.Position = 0;
        using var reader = XmlReader.Create(limited, new XmlReaderSettings
        { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null, MaxCharactersInDocument = 2 * 1024 * 1024 });
        var doc = XDocument.Load(reader);
        var root = doc.Root;
        if (root?.Name != SoapNs + "Envelope") throw new ProbeException("SOAP_ENVELOPE_INVALID");
        var body = Single(root, SoapNs + "Body", true)!;
        if (body.Element(SoapNs + "Fault") is not null)
        {
            // Do not log arbitrary device fault text, which can contain credentials/URLs.
            var codes = body.Descendants(SoapNs + "Value").Select(x => x.Value.Split(':').Last()).ToHashSet();
            throw new ProbeException(codes.Contains("NotAuthorized") ? "SOAP_NOT_AUTHORIZED_OR_CLOCK_SKEW" :
                codes.Overlaps(["ActionNotSupported", "PTZNotSupported"]) ? "SOAP_OPERATION_NOT_SUPPORTED" : "SOAP_FAULT");
        }
        if (!response.IsSuccessStatusCode) throw new ProbeException("HTTP_READ_FAILED");
        return Single(body, operation.Name.Namespace + (operation.Name.LocalName + "Response"), true)!;
    }
    private static XElement? Single(XElement parent, XName name, bool required = false)
    {
        var rows = parent.Elements(name).Take(2).ToArray();
        if (rows.Length > 1 || required && rows.Length != 1) throw new ProbeException("SOAP_STRUCTURE_INVALID");
        return rows.SingleOrDefault();
    }
    private static string? Text(XElement? node, int limit = 512)
    {
        if (node is null || string.IsNullOrWhiteSpace(node.Value)) return null;
        if (node.HasElements || node.Value.Length > limit) throw new ProbeException("SOAP_FIELD_INVALID");
        return node.Value;
    }
    public async Task<DeviceIdentity> DeviceInformation()
    {
        if (informationRead) throw new ProbeException("READ_ALREADY_ATTEMPTED"); informationRead = true;
        var r = await Read(endpoint, new XElement(DeviceNs + "GetDeviceInformation"));
        return new(Text(Single(r, DeviceNs + "Manufacturer")), Text(Single(r, DeviceNs + "Model")),
            Text(Single(r, DeviceNs + "FirmwareVersion")), Text(Single(r, DeviceNs + "SerialNumber")), Text(Single(r, DeviceNs + "HardwareId")));
    }
    public async Task Capabilities()
    {
        if (capabilitiesRead) throw new ProbeException("READ_ALREADY_ATTEMPTED"); capabilitiesRead = true;
        var r = await Read(endpoint, new XElement(DeviceNs + "GetCapabilities", new XElement(DeviceNs + "Category", "All")));
        var caps = Single(r, DeviceNs + "Capabilities", true)!;
        var media = Single(caps, SchemaNs + "Media"); var ptz = Single(caps, SchemaNs + "PTZ");
        if (media is null) throw new ProbeException("MEDIA1_SERVICE_NOT_ADVERTISED");
        if (ptz is null) throw new ProbeException("PTZ_SERVICE_NOT_ADVERTISED");
        // Validate both origins before making any subsequent authenticated request.
        mediaEndpoint = ServiceAddress(Text(Single(media, SchemaNs + "XAddr")));
        ptzEndpoint = ServiceAddress(Text(Single(ptz, SchemaNs + "XAddr")));
    }
    public async Task<IReadOnlyList<MediaProfile>> Profiles()
    {
        if (profilesRead) throw new ProbeException("READ_ALREADY_ATTEMPTED"); profilesRead = true;
        if (mediaEndpoint is null) throw new ProbeException("CAPABILITIES_REQUIRED");
        var r = await Read(mediaEndpoint, new XElement(MediaNs + "GetProfiles"));
        var list = new List<MediaProfile>(); var tokens = new HashSet<string>(StringComparer.Ordinal);
        foreach (var p in r.Elements(MediaNs + "Profiles"))
        {
            string? token = p.Attribute("token")?.Value;
            if (string.IsNullOrWhiteSpace(token) || token.Length > 512 || !tokens.Add(token) || list.Count >= 1000)
                throw new ProbeException("PROFILE_TOKEN_INVALID_OR_DUPLICATE");
            var video = Single(p, SchemaNs + "VideoSourceConfiguration");
            list.Add(new(token, Text(Single(p, SchemaNs + "Name")), Single(p, SchemaNs + "PTZConfiguration") is not null,
                video is null ? null : Text(Single(video, SchemaNs + "SourceToken"))));
        }
        if (list.Count == 0) throw new ProbeException("PROFILES_EMPTY");
        profiles = list; report.profileCount = list.Count; report.ptzProfileCount = list.Count(p => p.hasPtz);
        return list;
    }
    public async Task<PositionSample> Status(int profileIndex)
    {
        if (statusRead) throw new ProbeException("READ_ALREADY_ATTEMPTED"); statusRead = true;
        if (ptzEndpoint is null || profileIndex < 0 || profileIndex >= profiles.Count || !profiles[profileIndex].hasPtz)
            throw new ProbeException("EXPLICIT_PTZ_PROFILE_REQUIRED");
        var r = await Read(ptzEndpoint, new XElement(PtzNs + "GetStatus", new XElement(PtzNs + "ProfileToken", profiles[profileIndex].token)));
        var status = Single(r, PtzNs + "PTZStatus", true)!; var position = Single(status, SchemaNs + "Position");
        var panTilt = position is null ? null : Single(position, SchemaNs + "PanTilt");
        var zoom = position is null ? null : Single(position, SchemaNs + "Zoom");
        double? pan = Number(panTilt, "x"), tilt = Number(panTilt, "y"), z = Number(zoom, "x");
        DateTimeOffset? time = null;
        if (Text(Single(status, SchemaNs + "UtcTime")) is string raw)
        {
            try { time = XmlConvert.ToDateTimeOffset(raw); }
            catch (FormatException) { throw new ProbeException("DEVICE_TIME_INVALID"); }
        }
        report.panPresent = pan is not null; report.tiltPresent = tilt is not null; report.zoomPresent = z is not null;
        report.deviceTimePresent = time is not null;
        report.result = pan is not null && tilt is not null && z is not null ? "ptz-position-received" :
            pan is not null || tilt is not null || z is not null ? "partial-position-received" : "status-without-position";
        return new(DateTimeOffset.UtcNow, time, pan, tilt, z, Space(panTilt), Space(zoom));
    }
    private static double? Number(XElement? node, string attribute)
    {
        if (node is null) return null;
        string? value = node.Attribute(attribute)?.Value;
        if (value is null || !double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out double n) || !double.IsFinite(n))
            throw new ProbeException("PTZ_POSITION_INVALID");
        return n;
    }
    private static string? Space(XElement? node)
    {
        var value = node?.Attribute("space")?.Value;
        if (value is not null && (value.Length > 512 || !Uri.TryCreate(value, UriKind.Absolute, out _)))
            throw new ProbeException("PTZ_SPACE_INVALID");
        return value;
    }
    public void Dispose() { username = ""; password = ""; http.Dispose(); budget.Dispose(); }
}
