using System.Net;
using Microsoft.AspNetCore.WebUtilities;
using ScreenCapture.Core;

namespace WisenetPtzBridge.Services;

public sealed record DirectSnapshotRequest(string CameraLabel, string SnapshotUrl, string Username, string Password);
public sealed class SnapshotException(string code, string message, int statusCode = 400) : Exception(message)
{
    public string Code { get; } = code;
    public int StatusCode { get; } = statusCode;
}

// One operator-selected camera, read-only JPEGs, credentials and frames in memory.
// No redirects, discovery, fallback paths, PTZ, cookies or persistent credentials.
public sealed class DirectSnapshotSource : IAsyncDisposable
{
    private readonly object sync = new();
    private readonly SemaphoreSlim changes = new(1, 1);
    private Session? session;
    private string state = "disconnected", reason = "not-connected";
    public bool Configured { get; }
    private sealed class Session(HttpClient client, Uri uri, string label)
    {
        public HttpClient Client { get; } = client;
        public Uri Uri { get; } = uri;
        public string Label { get; } = label;
        public string Id { get; } = Guid.NewGuid().ToString("N");
        public CancellationTokenSource Cancellation { get; } = new();
        public Task? Loop { get; set; }
        public DateTimeOffset LeaseUntil { get; set; } = DateTimeOffset.UtcNow.AddSeconds(15);
        public long Sequence { get; set; }
        public Queue<Frame> Frames { get; } = new();
    }
    private sealed record Frame(long Sequence, byte[] Bytes, int Width, int Height, DateTimeOffset ReceivedAt);
    public DirectSnapshotSource(IConfiguration configuration) => Configured = configuration["DIRECT_CAMERA_SNAPSHOT_ENABLED"] == "true";

    public static Uri Validate(DirectSnapshotRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.CameraLabel) || request.CameraLabel.Length > 100 || request.CameraLabel.Any(char.IsControl) ||
            string.IsNullOrWhiteSpace(request.Username) || request.Username.Length > 128 || request.Username.Any(char.IsControl) ||
            string.IsNullOrEmpty(request.Password) || request.Password.Length > 512 || request.Password.Any(char.IsControl))
            throw new SnapshotException("invalid-input", "카메라 이름과 장비 ID/PW를 확인하세요.");
        if (request.SnapshotUrl is null || request.SnapshotUrl.Length > 2048 ||
            !Uri.TryCreate(request.SnapshotUrl, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https") ||
            uri.UserInfo.Length != 0 || uri.Fragment.Length != 0 || uri.AbsolutePath != "/stw-cgi/video.cgi")
            throw new SnapshotException("snapshot-url-required", "확인한 한화 JPEG 요청의 전체 주소를 입력하세요. DDNS·로그인·영상 페이지 주소는 스냅샷 주소가 아닙니다.");
        var query = QueryHelpers.ParseQuery(uri.Query);
        if (!query.TryGetValue("msubmenu", out var submenu) || submenu.Count != 1 || submenu[0] != "snapshot" ||
            !query.TryGetValue("action", out var action) || action.Count != 1 || action[0] != "view" ||
            query.Any(p => p.Key is not ("msubmenu" or "action" or "Channel" or "Profile") || p.Value.Count != 1) ||
            (query.TryGetValue("Channel", out var channel) && (!int.TryParse(channel[0], out var c) || c < 0 || c > 15)) ||
            (query.TryGetValue("Profile", out var profile) && (!int.TryParse(profile[0], out var p) || p < 1 || p > 10)))
            throw new SnapshotException("snapshot-only", "현재 시험은 확인된 snapshot / view JPEG 조회만 허용합니다. 설정·제어 경로는 요청하지 않습니다.");
        return uri;
    }
    public async Task<object> StartAsync(DirectSnapshotRequest request, CancellationToken ct)
    {
        var uri = Validate(request);
        await changes.WaitAsync(ct);
        try
        {
            await StopCurrentAsync();
            var credentials = new CredentialCache();
            var authority = new Uri(uri.GetLeftPart(UriPartial.Authority) + "/");
            var credential = new NetworkCredential(request.Username, request.Password);
            credentials.Add(authority, "Digest", credential);
            // Basic may be negotiated only over validated HTTPS, never plaintext HTTP.
            if (uri.Scheme == "https") credentials.Add(authority, "Basic", credential);
            var handler = new HttpClientHandler { AllowAutoRedirect = false, UseCookies = false, Credentials = credentials, PreAuthenticate = false };
            var client = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(6) };
            var next = new Session(client, uri, request.CameraLabel.Trim());
            lock (sync) { state = "connecting"; reason = "connecting"; }
            try
            {
                var frame = await ReadAsync(next, ct);
                ct.ThrowIfCancellationRequested();
                lock (sync) { session = next; Publish(next, frame); }
                next.Loop = PollAsync(next);
                return Status();
            }
            catch (Exception error)
            {
                client.Dispose(); next.Cancellation.Dispose();
                var failure = Failure(error);
                lock (sync) { state = "error"; reason = failure.Code; }
                throw failure;
            }
        }
        finally { changes.Release(); }
    }
    public async Task StopAsync(string sessionId)
    {
        await changes.WaitAsync();
        try
        {
            lock (sync)
                if (session is not null && session.Id != sessionId)
                    throw new SnapshotException("session-changed", "다른 연결로 변경되어 이전 연결의 중지 요청을 취소했습니다.", 409);
            await StopCurrentAsync();
        }
        finally { changes.Release(); }
    }
    private async Task StopCurrentAsync()
    {
        Session? previous;
        lock (sync) { previous = session; session = null; state = "disconnected"; reason = "user-stopped"; previous?.Frames.Clear(); }
        if (previous is null) return;
        try { previous.Cancellation.Cancel(); }
        catch (ObjectDisposedException) { /* The reader finished as it was detached. */ }
        if (previous.Loop is not null) await previous.Loop;
        previous.Client.Dispose(); previous.Cancellation.Dispose();
    }
    private async Task PollAsync(Session current)
    {
        try
        {
            while (!current.Cancellation.IsCancellationRequested)
            {
                await Task.Delay(1000, current.Cancellation.Token);
                lock (sync)
                {
                    if (session != current) return;
                    if (DateTimeOffset.UtcNow > current.LeaseUntil) { state = "disconnected"; reason = "viewer-inactive"; session = null; current.Frames.Clear(); return; }
                }
                try
                {
                    var frame = await ReadAsync(current, current.Cancellation.Token);
                    lock (sync) if (session == current) Publish(current, frame);
                }
                catch (OperationCanceledException) when (current.Cancellation.IsCancellationRequested) { return; }
                catch (Exception error)
                {
                    var failure = Failure(error);
                    lock (sync) if (session == current) { state = "error"; reason = failure.Code; current.Frames.Clear(); session = null; }
                    return; // No automatic credential retry, route fallback or continued stale imagery.
                }
            }
        }
        catch (OperationCanceledException) when (current.Cancellation.IsCancellationRequested) { }
        finally { current.Client.Dispose(); current.Cancellation.Dispose(); }
    }
    private void Publish(Session current, Frame frame)
    {
        current.Frames.Enqueue(frame with { Sequence = ++current.Sequence });
        while (current.Frames.Count > 2) current.Frames.Dequeue();
        state = "live"; reason = "receiving";
    }
    public object Status(bool renewLease = false)
    {
        lock (sync)
        {
            if (renewLease && session is not null) session.LeaseUntil = DateTimeOffset.UtcNow.AddSeconds(15);
            var frame = session?.Frames.LastOrDefault();
            var fresh = frame is not null && frame.ReceivedAt >= DateTimeOffset.UtcNow.AddSeconds(-4);
            return new { configured = Configured, status = state == "live" && !fresh ? "stale" : state,
                reasonCode = reason, liveFrameAvailable = state == "live" && fresh,
                observation = frame is null || session is null ? null : new {
                    sessionId = session.Id, cameraLabel = session.Label, status = fresh ? "live" : "paused", reasonCode = "snapshot-received",
                    capturedAt = frame.ReceivedAt, sequence = frame.Sequence, width = frame.Width, height = frame.Height,
                    sceneChanged = false, lowContrast = false, referenceDifference = (double?)null },
                directionStatus = "unknown", automaticDirectionTrackingImplemented = false,
                frameSource = "hanwha-jpeg-snapshot", captureTimestampSource = "local-receive-clock", underlyingStreamFreshnessVerified = false };
        }
    }
    public byte[]? FrameBytes(string sessionId, long sequence)
    {
        lock (sync)
        {
            if (session?.Id != sessionId || state != "live") return null;
            return session.Frames.FirstOrDefault(f => f.Sequence == sequence && f.ReceivedAt >= DateTimeOffset.UtcNow.AddSeconds(-4))?.Bytes;
        }
    }
    private static async Task<Frame> ReadAsync(Session current, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, current.Uri);
        request.Headers.CacheControl = new() { NoCache = true, NoStore = true };
        request.Headers.Accept.ParseAdd("image/jpeg");
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct);
        deadline.CancelAfter(TimeSpan.FromSeconds(6));
        using var response = await current.Client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, deadline.Token);
        if (response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
            throw new SnapshotException("authentication-denied", "장비 인증 또는 접근 권한이 거절됐습니다. ID/PW와 허용 IP를 확인하세요. HTTP 연결은 Digest 인증이 필요합니다.", 502);
        if ((int)response.StatusCode is >= 300 and < 400)
            throw new SnapshotException("redirect-rejected", "장비가 다른 주소로 이동을 요청했습니다. 웹뷰어의 최종 장비 주소에서 확인한 JPEG 주소를 사용하세요.", 502);
        if (!response.IsSuccessStatusCode) throw new SnapshotException("camera-http-error", $"장비의 JPEG 요청이 실패했습니다 (HTTP {(int)response.StatusCode}).", 502);
        if (response.Content.Headers.ContentType?.MediaType is not ("image/jpeg" or "image/jpg"))
            throw new SnapshotException("not-jpeg", "응답이 JPEG 이미지가 아닙니다. 로그인 페이지가 아닌 실제 스냅샷 요청을 확인하세요.", 502);
        if (response.Content.Headers.ContentLength > FrameSink.MaximumFrameBytes)
            throw new SnapshotException("frame-too-large", "수신 이미지가 허용 크기 6MB를 넘었습니다.", 502);
        await using var input = await response.Content.ReadAsStreamAsync(deadline.Token);
        using var bytes = new MemoryStream(); var buffer = new byte[16384]; int count;
        while ((count = await input.ReadAsync(buffer, deadline.Token)) != 0)
        {
            if (bytes.Length + count > FrameSink.MaximumFrameBytes) throw new SnapshotException("frame-too-large", "수신 이미지가 허용 크기 6MB를 넘었습니다.", 502);
            bytes.Write(buffer, 0, count);
        }
        var jpeg = bytes.ToArray();
        if (!JpegHeader.TryGetDimensions(jpeg, out var width, out var height) || width is < 64 or > 4096 || height is < 64 or > 2160 || (long)width * height > 8_847_360)
            throw new SnapshotException("invalid-jpeg", "JPEG 헤더 또는 영상 크기를 확인할 수 없습니다.", 502);
        return new Frame(0, jpeg, width, height, DateTimeOffset.UtcNow);
    }
    private static SnapshotException Failure(Exception error) => error as SnapshotException ?? (error is OperationCanceledException
        ? new("camera-timeout", "장비 영상 수신 시간이 초과됐거나 요청이 취소됐습니다.", 502)
        : new("camera-unreachable", "장비에 연결할 수 없습니다. 주소·접근 권한·HTTPS 인증서를 확인하세요.", 502));
    public async ValueTask DisposeAsync()
    {
        await changes.WaitAsync();
        try { await StopCurrentAsync(); }
        finally { changes.Release(); changes.Dispose(); }
    }
}
