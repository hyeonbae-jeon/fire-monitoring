using System.IO.Compression;
using System.Net;
using System.Text;
using WisenetPtzBridge.Services;

static class EventPageChecks
{
    public static async Task RunAsync(string? privateArchive = null)
    {
        const string origin = "https://alert.example", link = origin + "/sms/synthetic-event/synthetic-recipient";
        const string info = "{\"cctv_info\":\"synthetic-camera\",\"cctvName\":\"합성 감지 카메라\",\"eventName\":\"Smoke\",\"evtTime\":\"2026-11-03T00:28:14.000Z\",\"mapping_Info\":[],\"shortId\":\"synthetic-event\"}";
        var html = "<!doctype html><!-- saved from url=(0080)" + link + " --><html><span>2026-11-03 00:28:14</span><img src='/smsImages/synthetic-event.jpg'><script>const eventInfo = " + info + ";fetch('/api/disableUser/do-not-call');</script></html>";
        var jpeg = new byte[] {255,216,0,0,255,217};
        void Check(bool ok, string reason) { if (!ok) throw new Exception(reason); }
        byte[] Zip(string page, string imageName = "synthetic-event.jpg")
        {
            using var output = new MemoryStream();
            using (var zip = new ZipArchive(output, ZipArchiveMode.Create, true))
            {
                using (var writer = new StreamWriter(zip.CreateEntry("saved.htm").Open(), new UTF8Encoding(false))) writer.Write(page);
                using (var stream = zip.CreateEntry("saved_files/" + imageName).Open()) stream.Write(jpeg);
            }
            return output.ToArray();
        }
        var parsed = FirewatcherEventPage.Parse(html, link);
        Check(parsed.Detail.CameraName == "합성 감지 카메라" && parsed.Detail.MappingCount == 0 && !parsed.Detail.HasDevicePose &&
            parsed.Detail.ReportedTime.EndsWith("Z") && parsed.Detail.DisplayedTime == "2026-11-03 00:28:14", "Provider fields/time semantics lost.");
        var imported = FirewatcherEventPage.ReadArchive(Zip(html), origin);
        Check(imported.Image!.SequenceEqual(jpeg) && imported.Link == link, "Archive did not preserve event identity/image.");
        foreach (var imageSource in new[] {"/api/disableUser/synthetic-event.jpg", "https://other.example/synthetic-event.jpg", "//other.example/synthetic-event.jpg", "/smsImages/synthetic-event.jpg?disable=1", "./saved_files/synthetic-event.jpg"})
            Check(FirewatcherEventPage.ImageUri(parsed with { ImageSource = imageSource }, link, origin) is null, "Unsafe/saved image path accepted.");
        Check(FirewatcherEventPage.ImageUri(parsed, link, origin)?.AbsolutePath == "/smsImages/synthetic-event.jpg", "Static image rejected.");
        foreach (var bad in new[] {html.Replace("const eventInfo =", "const other ="), html.Replace("\"shortId\":\"synthetic-event\"", "\"shortId\":\"wrong-event\""), html.Replace(info, "(()=>{throw new Error('must not execute')})()")})
        {
            try { FirewatcherEventPage.Parse(bad, link); throw new Exception("Unverified event data accepted."); }
            catch (Exception e) when (e is InvalidDataException or System.Text.Json.JsonException) { }
        }
        try { FirewatcherEventPage.ReadArchive(Zip(html), "https://other.example"); throw new Exception("Cross-origin archive accepted."); }
        catch (InvalidDataException) { }
        var calls = new List<string>();
        using (var pages = new FirewatcherPageReader(new SyntheticHandler(request =>
        {
            calls.Add(request.Method + " " + request.RequestUri!.AbsolutePath);
            return request.RequestUri.AbsolutePath.EndsWith(".jpg")
                ? new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(jpeg) { Headers = { ContentType = new("image/jpeg") } } }
                : new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(html, Encoding.UTF8, "text/html") };
        })))
        {
            var result = await pages.ReadAsync(link, origin, default);
            Check(result.Image!.SequenceEqual(jpeg), "Read-only image fetch failed.");
        }
        Check(calls.SequenceEqual(["GET /sms/synthetic-event/synthetic-recipient", "GET /smsImages/synthetic-event.jpg"]), "Page scripts or management calls executed.");
        if (privateArchive is not null)
        {
            // Local-only optional diagnostic. Never copy operational pages/images into fixtures or output.
            var data = File.ReadAllBytes(privateArchive);
            using var zip = new ZipArchive(new MemoryStream(data));
            var page = zip.Entries.Single(e => e.Name.EndsWith(".htm")); using var reader = new StreamReader(page.Open());
            var text = reader.ReadToEnd(); var at = text.IndexOf("http", StringComparison.Ordinal); var end = text.IndexOf(" -->", at, StringComparison.Ordinal);
            var original = text[at..end]; var actualOrigin = new Uri(original).GetLeftPart(UriPartial.Authority);
            var actual = FirewatcherEventPage.ReadArchive(data, actualOrigin);
            Check(actual.Image is { Length: > 0 } && actual.Page.Detail.MappingCount == 0 && !actual.Page.Detail.HasDevicePose, "Private supplied archive contract check failed.");
            Console.WriteLine("Supplied private archive parsed locally; identifiers, images and links were not published.");
        }
        Console.WriteLine("Event page JSON-only parsing, archive origin/identity, static-image-only GET and missing event PTZ/timezone checks passed.");
    }
    private sealed class SyntheticHandler(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token) => Task.FromResult(respond(request));
    }
}
