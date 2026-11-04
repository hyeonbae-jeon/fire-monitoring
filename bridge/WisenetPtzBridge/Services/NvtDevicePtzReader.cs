using System.Globalization;
using System.Net;
using System.Text;
using Microsoft.AspNetCore.WebUtilities;

namespace WisenetPtzBridge.Services;

// Read-only contract found in the operator-supplied Position OSD source.
// This route shares a CGI with movement commands: keep the full query fixed.
internal static class NvtDevicePtzReader
{
    private const string QueryPath = "/api/ptz.cgi?PTZNumber=1&GetPTZPosition=do";
    private static SnapshotException Invalid() => new("nvt-ptz-invalid-response", "NVT 현재 PTZ 응답의 세 값과 범위를 확인할 수 없습니다.", 502);

    public static async Task<DevicePtzSample> ReadAsync(HttpClient client, Uri snapshotUri, CancellationToken ct)
    {
        var uri = new Uri(snapshotUri.GetLeftPart(UriPartial.Authority) + QueryPath);
        var credentials = QueryHelpers.ParseQuery(snapshotUri.Query);
        using var request = new HttpRequestMessage(HttpMethod.Get, uri);
        // The web viewer uses these same named cookies. Scope them to this one
        // same-device status request, never a shared cookie jar or a redirect.
        request.Headers.Add("Cookie", "username=" + Uri.EscapeDataString(credentials["USER"][0]!) +
            "; password=" + Uri.EscapeDataString(credentials["PWD"][0]!));
        request.Headers.CacheControl = new() { NoCache = true, NoStore = true };
        request.Headers.Accept.ParseAdd("text/plain");
        var startedAt = DateTimeOffset.UtcNow;
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct);
        deadline.CancelAfter(TimeSpan.FromSeconds(6));
        using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, deadline.Token);
        if (response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
            throw new SnapshotException("ptz-authentication-denied", "NVT 현재 각도 조회 권한이 거절됐습니다.", 502);
        if ((int)response.StatusCode is >= 300 and < 400)
            throw new SnapshotException("ptz-redirect-rejected", "NVT 각도 조회의 주소 이동은 허용하지 않습니다.", 502);
        if (!response.IsSuccessStatusCode) throw new SnapshotException("ptz-http-error", "NVT 현재 각도 조회가 실패했습니다.", 502);
        const int limit = 8192;
        if (response.Content.Headers.ContentLength > limit) throw Invalid();
        await using var input = await response.Content.ReadAsStreamAsync(deadline.Token);
        using var bytes = new MemoryStream(); var buffer = new byte[1024]; int count;
        while ((count = await input.ReadAsync(buffer, deadline.Token)) != 0)
        {
            if (bytes.Length + count > limit) throw Invalid();
            bytes.Write(buffer, 0, count);
        }
        var parts = Encoding.UTF8.GetString(bytes.ToArray()).TrimStart('\uFEFF').Trim().Split('=');
        if (parts.Length != 2 || parts[0].Trim() != "PTZ.1.Position") throw Invalid();
        var values = parts[1].Split(',');
        if (values.Length != 3) throw Invalid();
        var numbers = new double[3];
        for (var i = 0; i < 3; i++)
            if (!double.TryParse(values[i], NumberStyles.Float, CultureInfo.InvariantCulture, out numbers[i]) || !double.IsFinite(numbers[i])) throw Invalid();
        if (numbers[0] is < 0 or > 360 || numbers[1] is < -360 or > 360 || numbers[2] is <= 0 or > 10000) throw Invalid();
        return new(numbers[0], numbers[1], numbers[2], null, startedAt, DateTimeOffset.UtcNow);
    }
}
