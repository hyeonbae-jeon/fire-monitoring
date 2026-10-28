using System.Collections.Concurrent;
using System.Text.Json;
using System.Text.Json.Serialization;
using WisenetPtzBridge.Models;

namespace WisenetPtzBridge.Services;

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record AutoCameraConnection(string CameraId, string Source, string SnapshotUrl,
    string Username = "", string Password = "", bool Enabled = true, int DisplayRangeM = 1000);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record AutoCameraDocument(int SchemaVersion, AutoCameraConnection[] Cameras);

// Runtime-only inputs. Neither this document nor credentials are returned to browsers.
public sealed class AutomaticMonitoring(IConfiguration config, MapConfiguration maps) : BackgroundService
{
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private sealed class Channel(AutoCameraConnection connection)
    {
        public AutoCameraConnection Connection { get; } = connection;
        public DirectSnapshotSource? Source;
        public string Name = "";
        public DateTimeOffset RetryAt;
        public int Failures;
        public string Reason = "waiting";
        public bool AuthenticationBlocked;
        public bool Attention;
        public bool PtzRetryPending;
    }
    private readonly ConcurrentDictionary<string, Channel> channels = new();
    public bool Configured => !string.IsNullOrWhiteSpace(config["CCTV_CONNECTIONS_JSON"]);

    public static AutoCameraDocument Parse(string text)
    {
        try
        {
            if (text.Length > 48000) throw new JsonException();
            var doc = JsonSerializer.Deserialize<AutoCameraDocument>(text, Json) ?? throw new JsonException();
            if (doc.SchemaVersion != 1 || doc.Cameras is null || doc.Cameras.Length is < 1 or > 9) throw new JsonException();
            var ids = new HashSet<string>();
            foreach (var c in doc.Cameras)
            {
                if (c is null || string.IsNullOrWhiteSpace(c.CameraId) || c.CameraId.Length > 100 || !ids.Add(c.CameraId) ||
                    c.DisplayRangeM is < 10 or > 20000) throw new JsonException();
                DirectSnapshotSource.Validate(new(c.CameraId, c.SnapshotUrl, c.Username, c.Password, true, c.Source));
            }
            return doc;
        }
        catch (Exception e) when (e is JsonException or SnapshotException or ArgumentException)
        { throw new InventoryException(422, "자동 수신 설정의 카메라 ID·종류·주소·계정·표시 거리를 확인하세요. 기존 지도 설정은 변경하지 않았습니다."); }
    }
    public override Task StartAsync(CancellationToken ct)
    {
        if (Configured)
        {
            var doc = Parse(config["CCTV_CONNECTIONS_JSON"]!);
            foreach (var c in doc.Cameras.Where(c => c.Enabled)) channels[c.CameraId] = new(c);
        }
        return base.StartAsync(ct);
    }
    protected override Task ExecuteAsync(CancellationToken stoppingToken) => !Configured ? Task.CompletedTask :
        Task.WhenAll(channels.Select(entry => ChannelLoopAsync(entry.Key, entry.Value, stoppingToken)));
    private async Task ChannelLoopAsync(string cameraId, Channel ch, CancellationToken stoppingToken)
    {
        try
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                try { await TickAsync(cameraId, ch, await maps.ReadAsync(stoppingToken), stoppingToken); }
                catch (InventoryException) { await Close(ch); ch.Reason = "map-unavailable"; }
                await Task.Delay(1000, stoppingToken);
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
        finally { await Close(ch); }
    }
    private async Task TickAsync(string cameraId, Channel ch, MapSnapshot map, CancellationToken stoppingToken)
    {
        var position = map.Configuration.Positions.FirstOrDefault(p => p.Id == cameraId);
        if (position is null)
        {
            await Close(ch); ch.Reason = "camera-not-in-map"; return;
        }
        if (ch.Name != position.Name)
        { await Close(ch); ch.Name = position.Name; ch.AuthenticationBlocked = false; ch.RetryAt = default; }
        if (ch.Source is { } source)
        {
            var current = JsonSerializer.SerializeToElement(source.Status(renewLease: true), Json);
            var status = current.GetProperty("status").GetString();
            if (status is "live" or "connecting" or "stale")
            {
                var ptz = current.GetProperty("devicePtz");
                if (ptz.GetProperty("status").GetString() != "error")
                { ch.PtzRetryPending = false; ch.Attention = false; if (ptz.GetProperty("status").GetString() == "live") ch.Failures = 0; return; }
                var reason = ptz.GetProperty("reasonCode").GetString();
                if (reason is "ptz-authentication-denied" or "ptz-invalid-response" or "nvt-ptz-invalid-response" or "ptz-redirect-rejected")
                { ch.Attention = true; return; }
                if (!ch.PtzRetryPending)
                { ch.PtzRetryPending = true; ch.RetryAt = DateTimeOffset.UtcNow.AddSeconds(Math.Min(60, 5 * Math.Pow(2, Math.Min(ch.Failures++, 4)))); return; }
                if (DateTimeOffset.UtcNow < ch.RetryAt) return;
            }
            ch.Reason = current.GetProperty("reasonCode").GetString() ?? "camera-unreachable";
            await Close(ch);
            ch.AuthenticationBlocked = ch.Reason == "authentication-denied";
            ch.RetryAt = ch.PtzRetryPending ? DateTimeOffset.UtcNow : DateTimeOffset.UtcNow.AddSeconds(Math.Min(60, 5 * Math.Pow(2, Math.Min(ch.Failures++, 4))));
        }
        if (ch.AuthenticationBlocked || DateTimeOffset.UtcNow < ch.RetryAt) return;
        var next = new DirectSnapshotSource(config);
        try
        {
            var c = ch.Connection;
            await next.StartAsync(new(ch.Name, c.SnapshotUrl, c.Username, c.Password, true, c.Source), stoppingToken);
            ch.Source = next; ch.Reason = "receiving"; ch.PtzRetryPending = false;
        }
        catch (Exception e) when (e is SnapshotException or OperationCanceledException)
        {
            await next.DisposeAsync();
            ch.Reason = e is SnapshotException se ? se.Code : "camera-timeout";
            ch.AuthenticationBlocked = ch.Reason == "authentication-denied";
            ch.RetryAt = DateTimeOffset.UtcNow.AddSeconds(Math.Min(60, 5 * Math.Pow(2, Math.Min(ch.Failures++, 4))));
        }
    }
    private static async Task Close(Channel ch)
    { var old = ch.Source; ch.Source = null; if (old is not null) await old.DisposeAsync(); }
    public object Status() => new
    {
        configured = Configured,
        serverNow = DateTimeOffset.UtcNow,
        cameras = channels.Select(entry => new
        {
            cameraId = entry.Key, name = entry.Value.Name, source = entry.Value.Connection.Source,
            displayRangeM = entry.Value.Connection.DisplayRangeM,
            needsAttention = entry.Value.AuthenticationBlocked || entry.Value.Attention,
            retryAt = entry.Value.RetryAt == default ? (DateTimeOffset?)null : entry.Value.RetryAt,
            feed = entry.Value.Source?.Status() ?? (object)new
            { status = "waiting", reasonCode = entry.Value.Reason, liveFrameAvailable = false, observation = (object?)null }
        }).ToArray()
    };
    public byte[]? Frame(string cameraId, string sessionId, long sequence) =>
        channels.TryGetValue(cameraId, out var ch) ? ch.Source?.FrameBytes(sessionId, sequence) : null;
}
