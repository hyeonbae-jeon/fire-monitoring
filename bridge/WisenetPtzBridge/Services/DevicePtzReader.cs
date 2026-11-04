using System.Globalization;
using System.Net;
using System.Text;

namespace WisenetPtzBridge.Services;

public sealed record DevicePtzSample(double PanDeg, double TiltDeg, double Zoom, double? ZoomPulse,
    DateTimeOffset RequestStartedAt, DateTimeOffset ReceivedAt, long Sequence = 0);

// The operator-confirmed SUNAPI current-status query. Never sends movement or settings.
internal static class DevicePtzReader
{
    private const string QueryPath = "/stw-cgi/ptzcontrol.cgi?msubmenu=query&action=view&Query=Pan,Tilt,Zoom";
    private static SnapshotException Invalid() => new("ptz-invalid-response", "장비 각도 응답을 확인할 수 없습니다. 오류 응답·누락·채널 불일치를 확인하세요.", 502);

    public static async Task<DevicePtzSample> ReadAsync(HttpClient client, Uri snapshotUri, CancellationToken ct)
    {
        var uri = new Uri(snapshotUri.GetLeftPart(UriPartial.Authority) + QueryPath);
        var startedAt = DateTimeOffset.UtcNow;
        using var request = new HttpRequestMessage(HttpMethod.Get, uri);
        request.Headers.CacheControl = new() { NoCache = true, NoStore = true };
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct);
        deadline.CancelAfter(TimeSpan.FromSeconds(6));
        using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, deadline.Token);
        if (response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
            throw new SnapshotException("ptz-authentication-denied", "장비 각도 조회 권한이 거절됐습니다.", 502);
        if ((int)response.StatusCode is >= 300 and < 400)
            throw new SnapshotException("ptz-redirect-rejected", "장비 각도 조회의 주소 이동은 허용하지 않습니다.", 502);
        if (!response.IsSuccessStatusCode)
            throw new SnapshotException("ptz-http-error", "장비 각도 조회가 실패했습니다.", 502);
        const int limit = 8192;
        if (response.Content.Headers.ContentLength > limit) throw Invalid();
        await using var input = await response.Content.ReadAsStreamAsync(deadline.Token);
        using var bytes = new MemoryStream(); var buffer = new byte[1024]; int count;
        while ((count = await input.ReadAsync(buffer, deadline.Token)) != 0)
        {
            if (bytes.Length + count > limit) throw Invalid();
            bytes.Write(buffer, 0, count);
        }
        var values = new Dictionary<string, double>(StringComparer.Ordinal);
        foreach (var rawLine in Encoding.UTF8.GetString(bytes.ToArray()).TrimStart('\uFEFF').Split('\n'))
        {
            var line = rawLine.Trim(); if (line.Length == 0) continue;
            var parts = line.Split('=');
            if (parts.Length != 2 || parts[0] is not ("Pan" or "Tilt" or "Zoom" or "ZoomPulse" or
                "Channel.0.Pan" or "Channel.0.Tilt" or "Channel.0.Zoom" or "Channel.0.ZoomPulse") ||
                !double.TryParse(parts[1], NumberStyles.Float, CultureInfo.InvariantCulture, out var value) ||
                !double.IsFinite(value) || !values.TryAdd(parts[0], value)) throw Invalid();
        }
        double Read(string name)
        {
            var global = values.TryGetValue(name, out var a);
            var channel = values.TryGetValue("Channel.0." + name, out var b);
            if ((!global && !channel) || (global && channel && Math.Abs(a - b) > .000001)) throw Invalid();
            return global ? a : b;
        }
        // Do not mix partial global and channel-only groups into a seemingly complete sample.
        if (!(values.ContainsKey("Pan") && values.ContainsKey("Tilt") && values.ContainsKey("Zoom")) &&
            !(values.ContainsKey("Channel.0.Pan") && values.ContainsKey("Channel.0.Tilt") && values.ContainsKey("Channel.0.Zoom"))) throw Invalid();
        var pan = Read("Pan"); var tilt = Read("Tilt"); var zoom = Read("Zoom");
        double? pulse = values.ContainsKey("ZoomPulse") || values.ContainsKey("Channel.0.ZoomPulse") ? Read("ZoomPulse") : null;
        if (pan is < 0 or > 360 || tilt is < -360 or > 360 || zoom is <= 0 or > 10000 ||
            pulse is { } p && (p < 0 || p > int.MaxValue || p != Math.Truncate(p))) throw Invalid();
        return new DevicePtzSample(pan, tilt, zoom, pulse, startedAt, DateTimeOffset.UtcNow);
    }
}
