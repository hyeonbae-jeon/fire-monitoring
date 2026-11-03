using System.Globalization;
using System.IO.Compression;
using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using AngleSharp.Html.Parser;

namespace WisenetPtzBridge.Services;

public sealed record FirewatcherEventDetail(string CameraKey, string CameraName, string EventType,
    string ReportedTime, string? DisplayedTime, int MappingCount, bool HasDevicePose, string? ImageSha256);
public sealed record ParsedFirewatcherPage(FirewatcherEventDetail Detail, string ShortId, string? ImageSource);
public sealed record ImportedFirewatcherPage(string Link, ParsedFirewatcherPage Page, byte[]? Image);

// Parse data only. Never execute the page's scripts or its notification enable/disable handlers.
public static partial class FirewatcherEventPage
{
    public const int MaxPageBytes = 1024 * 1024, MaxImageBytes = 2 * 1024 * 1024, MaxZipBytes = 12 * 1024 * 1024;
    [GeneratedRegex(@"\bconst\s+eventInfo\s*=\s*")]
    private static partial Regex EventAssignment();
    [GeneratedRegex(@"saved from url=\(\d+\)(https?://[^\s<>]+)", RegexOptions.IgnoreCase)]
    private static partial Regex SavedUrl();
    public static ParsedFirewatcherPage Parse(string html, string expectedLink)
    {
        if (Encoding.UTF8.GetByteCount(html) > MaxPageBytes) throw new InvalidDataException();
        var match = EventAssignment().Matches(html);
        if (match.Count != 1) throw new InvalidDataException();
        var json = Encoding.UTF8.GetBytes(html[(match[0].Index + match[0].Length)..]);
        var reader = new Utf8JsonReader(json, new JsonReaderOptions { MaxDepth = 24 });
        using var document = JsonDocument.ParseValue(ref reader);
        var root = document.RootElement;
        string Text(string key, int max)
        {
            var value = root.GetProperty(key).GetString();
            return !string.IsNullOrWhiteSpace(value) && value.Length <= max && !value.Any(char.IsControl) ? value : throw new InvalidDataException();
        }
        var shortId = Text("shortId", 200);
        if (!Regex.IsMatch(shortId, @"\A[A-Za-z0-9_-]+\z") || new Uri(expectedLink).Segments[^2].Trim('/') != shortId) throw new InvalidDataException();
        var cameraKey = Text("cctv_info", 200); var cameraName = Text("cctvName", 200); var eventType = Text("eventName", 100);
        var reportedTime = Text("evtTime", 100);
        if (!DateTimeOffset.TryParse(reportedTime, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out _)) throw new InvalidDataException();
        var mapping = root.GetProperty("mapping_Info");
        if (mapping.ValueKind != JsonValueKind.Array || mapping.GetArrayLength() > 500) throw new InvalidDataException();
        var htmlDocument = new HtmlParser().ParseDocument(html);
        var displayed = htmlDocument.QuerySelectorAll("span").Select(e => e.TextContent.Trim())
            .FirstOrDefault(s => Regex.IsMatch(s, @"\A\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\z"));
        var images = htmlDocument.Images.Select(i => i.GetAttribute("src")).Where(src => !string.IsNullOrEmpty(src) &&
            src.Split('/').Last() == shortId + ".jpg").Distinct().ToArray();
        // A field merely named Pan/zoom is not a verified event-time PTZ contract.
        var detail = new FirewatcherEventDetail(cameraKey, cameraName, eventType, reportedTime, displayed,
            mapping.GetArrayLength(), false, null);
        return new(detail, shortId, images.Length == 1 ? images[0] : null);
    }
    public static Uri? ImageUri(ParsedFirewatcherPage page, string link, string origin)
    {
        if (page.ImageSource is null || !Uri.TryCreate(new Uri(link), page.ImageSource, out var image) ||
            image.Scheme is not ("http" or "https") || image.UserInfo.Length > 0 || image.Query.Length > 0 || image.Fragment.Length > 0 ||
            image.GetLeftPart(UriPartial.Authority) != origin || image.Segments.Last() != page.ShortId + ".jpg" ||
            image.AbsolutePath.Contains('%') || image.AbsolutePath.Contains('\\')) return null;
        // Static image reads only; never follow any /api enable/disable/alarm/logout routes.
        var segments = image.AbsolutePath.Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (segments.Any(s => Regex.IsMatch(s, "api|disable|enable|alarm|logout|delete|remove", RegexOptions.IgnoreCase))) return null;
        if (page.ImageSource.Contains("_files/", StringComparison.Ordinal)) return null; // Saved local archive path is not a server route.
        return image;
    }
    private static byte[] ReadLimited(Stream input, int limit)
    {
        using var output = new MemoryStream(); var buffer = new byte[8192]; int n;
        while ((n = input.Read(buffer)) > 0)
        { if (output.Length + n > limit) throw new InvalidDataException(); output.Write(buffer, 0, n); }
        return output.ToArray();
    }
    public static bool IsJpeg(byte[] bytes) => bytes.Length is > 4 and <= MaxImageBytes && bytes[0] == 255 && bytes[1] == 216 && bytes[^2] == 255 && bytes[^1] == 217;
    public static ImportedFirewatcherPage ReadArchive(byte[] bytes, string origin)
    {
        if (bytes.Length > MaxZipBytes) throw new InvalidDataException();
        using var zip = new ZipArchive(new MemoryStream(bytes));
        if (zip.Entries.Count > 150 || zip.Entries.Sum(e => e.Length) > 32 * 1024 * 1024) throw new InvalidDataException();
        var pages = zip.Entries.Where(e => e.Name.EndsWith(".htm", StringComparison.OrdinalIgnoreCase) || e.Name.EndsWith(".html", StringComparison.OrdinalIgnoreCase)).ToArray();
        if (pages.Length != 1 || pages[0].Length > MaxPageBytes) throw new InvalidDataException();
        using var pageStream = pages[0].Open();
        var html = Encoding.UTF8.GetString(ReadLimited(pageStream, MaxPageBytes)); var urls = SavedUrl().Matches(html);
        if (urls.Count != 1) throw new InvalidDataException();
        var link = urls[0].Groups[1].Value;
        if (!FirewatcherMailParser.IsAllowedLink(link, origin)) throw new InvalidDataException();
        var parsed = Parse(html, link);
        var pictures = zip.Entries.Where(e => e.Name == parsed.ShortId + ".jpg").ToArray();
        byte[]? image = null;
        if (pictures.Length == 1 && pictures[0].Length <= MaxImageBytes)
        {
            using var input = pictures[0].Open();
            image = ReadLimited(input, MaxImageBytes); if (!IsJpeg(image)) throw new InvalidDataException();
        }
        return new(link, parsed, image);
    }
}

public sealed class FirewatcherPageReader : IDisposable
{
    private readonly HttpClient client;
    public FirewatcherPageReader() : this(new HttpClientHandler { AllowAutoRedirect = false, UseCookies = false, UseDefaultCredentials = false }) { }
    public FirewatcherPageReader(HttpMessageHandler handler) => client = new(handler) { Timeout = TimeSpan.FromSeconds(8) };
    private async Task<(byte[] Bytes, string? Type)> ReadAsync(Uri uri, int limit, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, uri);
        using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
        response.EnsureSuccessStatusCode();
        if ((int)response.StatusCode is >= 300 and < 400 || response.Content.Headers.ContentLength > limit) throw new InvalidDataException();
        using var stream = await response.Content.ReadAsStreamAsync(ct); using var output = new MemoryStream();
        var buffer = new byte[8192]; int n;
        while ((n = await stream.ReadAsync(buffer, ct)) > 0)
        { if (output.Length + n > limit) throw new InvalidDataException(); await output.WriteAsync(buffer.AsMemory(0, n), ct); }
        return (output.ToArray(), response.Content.Headers.ContentType?.MediaType);
    }
    public async Task<(ParsedFirewatcherPage Page, byte[]? Image)> ReadAsync(string link, string origin, CancellationToken ct)
    {
        if (!FirewatcherMailParser.IsAllowedLink(link, origin)) throw new InvalidDataException();
        var html = await ReadAsync(new Uri(link), FirewatcherEventPage.MaxPageBytes, ct);
        if (html.Type is not ("text/html" or "application/xhtml+xml")) throw new InvalidDataException();
        var page = FirewatcherEventPage.Parse(Encoding.UTF8.GetString(html.Bytes), link);
        byte[]? image = null;
        if (FirewatcherEventPage.ImageUri(page, link, origin) is { } imageUri)
        {
            var data = await ReadAsync(imageUri, FirewatcherEventPage.MaxImageBytes, ct);
            if (data.Type == "image/jpeg" && FirewatcherEventPage.IsJpeg(data.Bytes)) image = data.Bytes;
        }
        return (page, image);
    }
    public void Dispose() => client.Dispose();
}
