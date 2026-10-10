using System.Globalization;
using System.Net;
using System.Net.Security;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.Json;

namespace SsmConnectionTest;

public sealed record CameraPreview(string uuid, string name, string? channel, string? device, string? ptzCap);
public sealed record CameraMetadata(string uuid, string name, string? entityCapability, long? subType,
    long? installType, string? configuredLatitude, string? configuredLongitude, string? configuredHeading,
    bool? xMapSubscriptionConditions, string[] issues);
public sealed record RequestResult(string stage, int httpStatus);
public sealed class DiagnosticReport
{
    public string toolVersion { get; } = "3";
    public DateTimeOffset capturedAt { get; set; } = DateTimeOffset.UtcNow;
    public string result { get; set; } = "not-started";
    public string? serverStatus { get; set; }
    public string? serverVersion { get; set; }
    public bool publicKeyPresent { get; set; }
    public bool certificateMatched { get; set; }
    public bool certificateRejected { get; set; }
    public int serverCount { get; set; }
    public int componentCount { get; set; }
    public int cameraCount { get; set; }
    public int unknownPtzCapCount { get; set; }
    public int configuredHeadingCount { get; set; }
    public int configuredCoordinateCount { get; set; }
    public int metadataIssueCameraCount { get; set; }
    public int xMapSubscriptionCandidateCount { get; set; }
    public int unknownSubscriptionConditionsCount { get; set; }
    public int connectionDetailCameraCount { get; set; }
    public int connectionDetailIssueCount { get; set; }
    public bool complete { get; set; } = false;
    public List<RequestResult> requests { get; } = [];
    public string? error { get; set; }
    public string? logout { get; set; }
}

public sealed class DiagnosticException(string code) : Exception(code);

// Independent implementation of the statically verified SSM 2.21 REST contract.
// Only status/inventory GET, a single normal login POST, and own-session logout DELETE.
public sealed class SsmClient : IDisposable
{
    private readonly Uri origin;
    private readonly HttpClient http;
    private readonly DiagnosticReport report;
    private readonly CancellationTokenSource budget = new(TimeSpan.FromMinutes(10));
    private string? session;
    private string? password;
    private string? publicKey;
    private bool loginAttempted;
    private int requestCount;
    private readonly Dictionary<Guid, CameraMetadata> metadata = [];
    private readonly Dictionary<Guid, CameraConnectionDetail> connections = [];
    public IReadOnlyList<CameraMetadata> Metadata => metadata.Values.OrderBy(c => c.uuid, StringComparer.Ordinal).ToList();
    public CameraConnectionDetail? SelectedConnection => connections.Count == 1 ? connections.Values.Single() : null;

    public SsmClient(string endpoint, string fingerprint, DiagnosticReport report)
    {
        origin = ParseOrigin(endpoint);
        var expected = ParseFingerprint(fingerprint);
        this.report = report;
        var handler = new HttpClientHandler
        {
            AllowAutoRedirect = false, UseCookies = false, UseProxy = false,
            ServerCertificateCustomValidationCallback = (request, cert, _, errors) =>
            {
                bool accepted = SameOrigin(request.RequestUri!) && CertificateMatches(cert, errors, expected, DateTimeOffset.UtcNow);
                if (accepted) report.certificateMatched = true;
                else report.certificateRejected = true;
                return accepted;
            }
        };
        http = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(20) };
    }

    public static Uri ParseOrigin(string endpoint)
    {
        if (!Uri.TryCreate(endpoint, UriKind.Absolute, out var uri) || uri.Scheme != "https" ||
            uri.UserInfo.Length != 0 || uri.AbsolutePath != "/" || uri.Query.Length != 0 || uri.Fragment.Length != 0)
            throw new DiagnosticException("HTTPS_ORIGIN_REQUIRED");
        return uri;
    }

    public static byte[] ParseFingerprint(string value)
    {
        var compact = value.Replace(":", "").Replace(" ", "").Trim();
        if (compact.Length != 64 || compact.Any(c => !Uri.IsHexDigit(c)))
            throw new DiagnosticException("SHA256_FINGERPRINT_REQUIRED");
        return Convert.FromHexString(compact);
    }

    public static bool CertificateMatches(X509Certificate2? cert, SslPolicyErrors errors, byte[] expected, DateTimeOffset now)
    {
        // An explicitly pinned self-signed/name-mismatched cert is permitted only for this origin.
        // A matching fingerprint alone must not accept an expired or unavailable certificate.
        return cert is not null && (errors & SslPolicyErrors.RemoteCertificateNotAvailable) == 0 &&
            now.UtcDateTime >= cert.NotBefore.ToUniversalTime() && now.UtcDateTime <= cert.NotAfter.ToUniversalTime() &&
            CryptographicOperations.FixedTimeEquals(cert.GetCertHash(HashAlgorithmName.SHA256), expected);
    }

    private bool SameOrigin(Uri uri) => uri.Scheme == "https" && uri.Host == origin.Host && uri.Port == origin.Port;

    public static string Sign(string pathAndQuery, string timestamp, string session, string password)
    {
        var key = Encoding.UTF8.GetBytes(password);
        try
        {
            var digest = HMACSHA256.HashData(key, Encoding.UTF8.GetBytes(pathAndQuery + ":" + timestamp));
            return "TSM " + Convert.ToBase64String(Encoding.UTF8.GetBytes(session + ":" + Convert.ToHexString(digest).ToLowerInvariant()));
        }
        finally { CryptographicOperations.ZeroMemory(key); }
    }

    public static string Encrypt(string value, string key)
    {
        try
        {
            using var rsa = RSA.Create();
            var der = Convert.FromBase64String(key);
            rsa.ImportSubjectPublicKeyInfo(der, out int read);
            if (read != der.Length || rsa.KeySize < 2048) throw new DiagnosticException("PUBLIC_KEY_INVALID");
            var plaintext = Encoding.UTF8.GetBytes(value);
            try { return Convert.ToBase64String(rsa.Encrypt(plaintext, RSAEncryptionPadding.Pkcs1)); }
            finally { CryptographicOperations.ZeroMemory(plaintext); }
        }
        catch (Exception e) when (e is FormatException or CryptographicException)
        { throw new DiagnosticException("PUBLIC_KEY_INVALID"); }
    }

    private static bool Allowed(HttpMethod method, string path)
    {
        if (path == "/V1/Session") return method == HttpMethod.Post || method == HttpMethod.Delete;
        if (method != HttpMethod.Get) return false;
        if (path == "/V1/report/status" || path == "/v3/servers?type=all") return true;
        var pieces = path.Split('/');
        if (pieces.Length != 5 || pieces[1] != "v3" || !Guid.TryParseExact(pieces[3], "D", out _)) return false;
        if (pieces[2] == "servers" && pieces[4] == "components") return true;
        return pieces[2] == "components" && pieces[4].StartsWith("channels?serverGuid=", StringComparison.Ordinal) &&
            Guid.TryParseExact(pieces[4]["channels?serverGuid=".Length..], "D", out _);
    }

    private async Task<HttpResponseMessage> Send(HttpMethod method, string path, string stage, object? body = null)
    {
        if (!Allowed(method, path)) throw new DiagnosticException("REQUEST_NOT_ALLOWED");
        if (++requestCount > 500) throw new DiagnosticException("REQUEST_LIMIT");
        var uri = new Uri(origin, path);
        if (!SameOrigin(uri)) throw new DiagnosticException("ORIGIN_CHANGED");
        using var request = new HttpRequestMessage(method, uri);
        request.Headers.Accept.ParseAdd("application/json");
        if (method != HttpMethod.Post && session is not null)
        {
            string timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString(CultureInfo.InvariantCulture);
            request.Headers.Add("x-ssm-date", timestamp);
            request.Headers.Add("Authorization", Sign(uri.PathAndQuery, timestamp, session, password!));
            request.Headers.Add("Cookie", "Session_ID=" + session);
        }
        if (body is not null) request.Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");
        var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, budget.Token);
        report.requests.Add(new(stage, (int)response.StatusCode));
        return response;
    }

    private async Task<JsonDocument> Json(HttpResponseMessage response)
    {
        if (response.StatusCode != HttpStatusCode.OK) throw new DiagnosticException("HTTP_" + (int)response.StatusCode);
        const int limit = 16 * 1024 * 1024;
        if (response.Content.Headers.ContentLength > limit) throw new DiagnosticException("RESPONSE_TOO_LARGE");
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(budget.Token);
        timeout.CancelAfter(TimeSpan.FromSeconds(20));
        await using var stream = await response.Content.ReadAsStreamAsync(timeout.Token);
        using var memory = new MemoryStream();
        byte[] chunk = new byte[8192];
        int count;
        while ((count = await stream.ReadAsync(chunk, timeout.Token)) != 0)
        {
            if (memory.Length + count > limit) throw new DiagnosticException("RESPONSE_TOO_LARGE");
            memory.Write(chunk, 0, count);
        }
        return JsonDocument.Parse(memory.ToArray());
    }

    public async Task Status()
    {
        using var response = await Send(HttpMethod.Get, "/V1/report/status", "status");
        if (response.StatusCode != HttpStatusCode.OK) throw new DiagnosticException("HTTP_" + (int)response.StatusCode);
        string? Header(string name) => response.Headers.TryGetValues(name, out var values) ? values.SingleOrDefault() : null;
        var status = Header("serverstatus");
        report.serverStatus = status is "START" or "STOP" ? status : "UNKNOWN";
        var version = Header("ServerVersion");
        // Don't persist arbitrary server-supplied text or bodies in shareable diagnostics.
        report.serverVersion = version is not null && version.Length <= 32 && version.All(c => char.IsAsciiDigit(c) || c == '.') ? version : "UNKNOWN";
        publicKey = Header("PublicKey");
        report.publicKeyPresent = !string.IsNullOrWhiteSpace(publicKey);
        report.result = "status-ok";
    }

    public async Task Login(string id, string secret, string clientIp)
    {
        if (loginAttempted) throw new DiagnosticException("LOGIN_ALREADY_ATTEMPTED");
        loginAttempted = true;
        if (report.serverStatus != "START" || report.serverVersion != "2.21.00") throw new DiagnosticException("SERVER_CONTRACT_UNVERIFIED");
        if (string.IsNullOrWhiteSpace(publicKey)) throw new DiagnosticException("PUBLIC_KEY_MISSING");
        if (string.IsNullOrWhiteSpace(id) || string.IsNullOrEmpty(secret) || !IPAddress.TryParse(clientIp, out _))
            throw new DiagnosticException("LOGIN_INPUT_INVALID");
        // CLIENT_SDK's wire service is 12 (not the enum ordinal 6); TSM for non-SVM clients.
        var body = new { id = Encrypt(id, publicKey), password = Encrypt(secret, publicKey), ip = clientIp, service = 12, clientVersion = "2.21.00" };
        using var response = await Send(HttpMethod.Post, "/V1/Session", "login", body);
        using var json = await Json(response);
        var value = RequiredString(json.RootElement, "SessionId");
        if (value.Length > 1024 || value.Any(c => c < 0x21 || c > 0x7e || c is '"' or ',' or ';' or '\\'))
            throw new DiagnosticException("SESSION_FORMAT_INVALID");
        session = value;
        password = secret;
        report.result = "login-ok";
    }

    private static string RequiredString(JsonElement row, string property)
    {
        if (row.ValueKind != JsonValueKind.Object || !row.TryGetProperty(property, out var item) || item.ValueKind != JsonValueKind.String || string.IsNullOrWhiteSpace(item.GetString()))
            throw new DiagnosticException("RESPONSE_FIELD_INVALID");
        return item.GetString()!;
    }

    private static Guid RequiredGuid(JsonElement row, string property)
    {
        if (!Guid.TryParse(RequiredString(row, property), out var guid) || guid == Guid.Empty)
            throw new DiagnosticException("RESPONSE_UUID_INVALID");
        return guid;
    }

    private async Task<JsonDocument> Get(string path, string stage)
    {
        if (session is null) throw new DiagnosticException("NO_SESSION");
        using var response = await Send(HttpMethod.Get, path, stage);
        var json = await Json(response);
        if (json.RootElement.ValueKind != JsonValueKind.Array) { json.Dispose(); throw new DiagnosticException("ARRAY_RESPONSE_REQUIRED"); }
        return json;
    }

    private static CameraMetadata ReadMetadata(JsonElement row, CameraPreview camera)
    {
        var issues = new List<string>();
        string? entityCapability = null;
        if (row.TryGetProperty("capability", out var capability) && capability.ValueKind != JsonValueKind.Null)
        {
            if (capability.ValueKind == JsonValueKind.String && string.IsNullOrWhiteSpace(capability.GetString())) { }
            else if (capability.ValueKind == JsonValueKind.String &&
                ulong.TryParse(capability.GetString(), NumberStyles.HexNumber, CultureInfo.InvariantCulture, out var bits))
                entityCapability = bits.ToString(CultureInfo.InvariantCulture);
            else issues.Add("CAPABILITY_FORMAT_INVALID");
        }
        long? OptionalInteger(string key)
        {
            if (!row.TryGetProperty(key, out var field) || field.ValueKind == JsonValueKind.Null) return null;
            if (field.ValueKind == JsonValueKind.Number && field.TryGetInt64(out var value) && value >= 0) return value;
            issues.Add(key == "subType" ? "SUBTYPE_FORMAT_INVALID" : "INSTALL_TYPE_FORMAT_INVALID");
            return null;
        }
        var subType = OptionalInteger("subType");
        var installType = OptionalInteger("installType");
        string? latitude = null, longitude = null, heading = null;
        if (row.TryGetProperty("extendedData", out var extra) && extra.ValueKind != JsonValueKind.Null)
        {
            if (extra.ValueKind != JsonValueKind.String) issues.Add("EXTENDED_DATA_FORMAT_INVALID");
            else if (!string.IsNullOrWhiteSpace(extra.GetString()))
            {
                try
                {
                    using var document = JsonDocument.Parse(extra.GetString()!);
                    if (document.RootElement.ValueKind != JsonValueKind.Object) issues.Add("EXTENDED_DATA_FORMAT_INVALID");
                    else
                    {
                        string? ConfiguredNumber(string key, double? min = null, double? max = null)
                        {
                            if (!document.RootElement.TryGetProperty(key, out var value) || value.ValueKind == JsonValueKind.Null) return null;
                            // Preserve numeric text without interpreting heading units, origin, or sign.
                            var text = value.ValueKind == JsonValueKind.String ? value.GetString() :
                                value.ValueKind == JsonValueKind.Number ? value.GetRawText() : null;
                            if (text is not null && string.IsNullOrWhiteSpace(text)) return null;
                            if (text is not null && text.Length <= 64 && double.TryParse(text, NumberStyles.Float,
                                CultureInfo.InvariantCulture, out var number) && double.IsFinite(number) &&
                                (min is null || number >= min) && (max is null || number <= max)) return text;
                            issues.Add("CONFIGURED_" + key.ToUpperInvariant() + "_FORMAT_INVALID");
                            return null;
                        }
                        latitude = ConfiguredNumber("latitude", -90, 90);
                        longitude = ConfiguredNumber("longitude", -180, 180);
                        heading = ConfiguredNumber("heading");
                    }
                }
                catch (JsonException) { issues.Add("EXTENDED_DATA_JSON_INVALID"); }
            }
        }
        bool? conditions = null;
        // Mirror the verified XMap data gates only; these are NOT account permissions or live success.
        bool? capabilityGate = entityCapability is null ? null : (ulong.Parse(entityCapability, CultureInfo.InvariantCulture) & 128UL) != 0;
        bool? subtypeGate = subType is null ? null : subType is 4 or 8;
        bool? positionGate = camera.ptzCap is null ? null : (ulong.Parse(camera.ptzCap, CultureInfo.InvariantCulture) & 268435456UL) != 0;
        if (capabilityGate == false || subtypeGate == false || positionGate == false) conditions = false;
        else if (capabilityGate == true && subtypeGate == true && positionGate == true) conditions = true;
        return new(camera.uuid, camera.name, entityCapability, subType, installType,
            latitude, longitude, heading, conditions, issues.ToArray());
    }

    public async Task<List<CameraPreview>> Inventory(string? connectionTarget = null)
    {
        var cameras = new Dictionary<Guid, CameraPreview>();
        var servers = new HashSet<Guid>();
        var components = new HashSet<(Guid, Guid)>();
        using var serverJson = await Get("/v3/servers?type=all", "servers");
        foreach (var server in serverJson.RootElement.EnumerateArray())
        {
            var serverId = RequiredGuid(server, "guid");
            if (!servers.Add(serverId)) throw new DiagnosticException("DUPLICATE_SERVER");
            report.serverCount = servers.Count;
            using var componentJson = await Get($"/v3/servers/{serverId:D}/components", "components");
            foreach (var component in componentJson.RootElement.EnumerateArray())
            {
                var componentId = RequiredGuid(component, "guid");
                if (!components.Add((serverId, componentId))) throw new DiagnosticException("DUPLICATE_COMPONENT");
                report.componentCount = components.Count;
                using var channelJson = await Get($"/v3/components/{componentId:D}/channels?serverGuid={serverId:D}", "channels");
                foreach (var row in channelJson.RootElement.EnumerateArray())
                {
                    if (row.ValueKind != JsonValueKind.Object || !row.TryGetProperty("type", out var type) || !type.TryGetInt64(out long channelType))
                        throw new DiagnosticException("CHANNEL_TYPE_INVALID");
                    if (channelType != 8192) continue;
                    var uuid = RequiredGuid(row, "guid");
                    var name = RequiredString(row, "name");
                    string? cap = null;
                    if (row.TryGetProperty("ptzCap", out var field) && field.ValueKind != JsonValueKind.Null)
                    {
                        if (field.ValueKind != JsonValueKind.Number || !field.TryGetUInt64(out ulong bits)) throw new DiagnosticException("PTZ_CAP_INVALID");
                        cap = bits.ToString(CultureInfo.InvariantCulture);
                    }
                    var camera = new CameraPreview(uuid.ToString("D"), name, null, null, cap);
                    if (cameras.TryGetValue(uuid, out var previous) && previous != camera) throw new DiagnosticException("CONFLICTING_CAMERA");
                    var detail = ReadMetadata(row, camera);
                    if (metadata.TryGetValue(uuid, out var previousDetail) &&
                        JsonSerializer.Serialize(previousDetail) != JsonSerializer.Serialize(detail))
                        throw new DiagnosticException("CONFLICTING_CAMERA_METADATA");
                    cameras[uuid] = camera;
                    metadata[uuid] = detail;
                    if (connectionTarget is not null && (camera.uuid.Equals(connectionTarget, StringComparison.OrdinalIgnoreCase) ||
                        camera.name.Contains(connectionTarget, StringComparison.OrdinalIgnoreCase)))
                    {
                        var connection = new CameraConnectionDetail(camera.uuid, camera.name, serverId.ToString("D"), componentId.ToString("D"),
                            ConnectionDetails.Read(row, "channel.networkInfo"), ConnectionDetails.Read(component, "component.networkInfo"),
                            ConnectionDetails.Read(server, "server.networkInfo", isServer: true));
                        if (connections.TryGetValue(uuid, out var previousConnection) &&
                            JsonSerializer.Serialize(previousConnection) != JsonSerializer.Serialize(connection))
                            throw new DiagnosticException("CONFLICTING_CONNECTION_DETAILS");
                        connections[uuid] = connection;
                    }
                    report.cameraCount = cameras.Count;
                    report.unknownPtzCapCount = cameras.Values.Count(c => c.ptzCap is null);
                    report.configuredHeadingCount = metadata.Values.Count(c => c.configuredHeading is not null);
                    report.configuredCoordinateCount = metadata.Values.Count(c => c.configuredLatitude is not null && c.configuredLongitude is not null);
                    report.metadataIssueCameraCount = metadata.Values.Count(c => c.issues.Length != 0);
                    report.xMapSubscriptionCandidateCount = metadata.Values.Count(c => c.xMapSubscriptionConditions == true);
                    report.unknownSubscriptionConditionsCount = metadata.Values.Count(c => c.xMapSubscriptionConditions is null);
                }
            }
        }
        if (connectionTarget is not null)
        {
            if (connections.Count == 0) throw new DiagnosticException("CONNECTION_TARGET_NOT_FOUND");
            if (connections.Count != 1) throw new DiagnosticException("CONNECTION_TARGET_AMBIGUOUS");
            var selected = connections.Values.Single();
            report.connectionDetailCameraCount = 1;
            report.connectionDetailIssueCount = selected.camera.issues.Length + selected.component.issues.Length + selected.server.issues.Length;
        }
        report.result = "inventory-preview-ok";
        // The visible account/server scope is not proof of the entire installed inventory.
        return cameras.Values.OrderBy(c => c.uuid, StringComparer.Ordinal).ToList();
    }

    public async Task Logout()
    {
        if (session is null) return;
        try
        {
            using var response = await Send(HttpMethod.Delete, "/V1/Session", "logout");
            report.logout = response.StatusCode == HttpStatusCode.OK ? "ok" : "HTTP_" + (int)response.StatusCode;
        }
        catch { report.logout = "failed"; }
        finally { session = null; password = null; }
    }

    public void Dispose() { session = null; password = null; http.Dispose(); budget.Dispose(); }
}
