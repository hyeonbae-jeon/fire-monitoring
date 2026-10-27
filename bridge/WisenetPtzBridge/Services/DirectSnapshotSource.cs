using System.Net;
using Microsoft.AspNetCore.WebUtilities;
using ScreenCapture.Core;

namespace WisenetPtzBridge.Services;

public sealed record DirectSnapshotRequest(string CameraLabel, string SnapshotUrl, string Username = "", string Password = "", bool ReadDevicePtz = false, string Source = "hanwha");
public sealed class SnapshotException(string code, string message, int statusCode = 400) : Exception(message)
{
    public string Code { get; } = code;
    public int StatusCode { get; } = statusCode;
}

// One operator-selected camera, read-only JPEGs, credentials and frames in memory.
// No redirects, discovery, fallback paths, movement, cookies or persistent credentials.
public sealed partial class DirectSnapshotSource : IAsyncDisposable
{
    private readonly object sync = new();
    private readonly SemaphoreSlim changes = new(1, 1);
    private Session? session;
    private string state = "disconnected", reason = "not-connected";
    public bool Configured { get; }
    private sealed class Session(HttpClient client, Uri uri, string label, bool readDevicePtz, bool nvt)
    {
        public HttpClient Client { get; } = client;
        public Uri Uri { get; } = uri;
        public string Label { get; } = label;
        public string Id { get; } = Guid.NewGuid().ToString("N");
        public CancellationTokenSource Cancellation { get; } = new();
        public Task? Loop { get; set; }
        public bool ReadDevicePtz { get; } = readDevicePtz;
        public bool Nvt { get; } = nvt;
        public string PtzState { get; set; } = readDevicePtz ? "waiting" : "disabled";
        public string PtzReason { get; set; } = readDevicePtz ? "waiting" : "not-enabled";
        public DevicePtzSample? PtzSample { get; set; }
        public long PtzSequence { get; set; }
        public bool ReferenceBusy { get; set; }
        public DateTimeOffset LeaseUntil { get; set; } = DateTimeOffset.UtcNow.AddSeconds(15);
        public long Sequence { get; set; }
        public Queue<Frame> Frames { get; } = new();
    }
    private sealed record Frame(long Sequence, byte[] Bytes, int Width, int Height, DateTimeOffset ReceivedAt);
    public DirectSnapshotSource(IConfiguration configuration) => Configured = configuration["DIRECT_CAMERA_SNAPSHOT_ENABLED"] == "true";

    public static Uri Validate(DirectSnapshotRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.CameraLabel) || request.CameraLabel.Length > 100 || request.CameraLabel.Any(char.IsControl))
            throw new SnapshotException("invalid-input", "카메라 이름을 확인하세요.");
        if (request.Source == "nvt-getimage") return ValidateNvt(request);
        if (request.Source != "hanwha") throw new SnapshotException("unsupported-source", "지원하는 영상 입력 방식을 선택하세요.");
        if (string.IsNullOrWhiteSpace(request.Username) || request.Username.Length > 128 || request.Username.Any(char.IsControl) ||
            string.IsNullOrEmpty(request.Password) || request.Password.Length > 512 || request.Password.Any(char.IsControl))
            throw new SnapshotException("invalid-input", "카메라 이름과 장비 ID/PW를 확인하세요.");
        if (request.SnapshotUrl is null || request.SnapshotUrl.Length > 2048 ||
            !Uri.TryCreate(request.SnapshotUrl, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https") ||
            uri.UserInfo.Length != 0 || uri.Fragment.Length != 0 || uri.AbsolutePath != "/stw-cgi/video.cgi")
            throw new SnapshotException("snapshot-url-required", "확인한 한화 JPEG 요청의 전체 주소를 입력하세요. DDNS·로그인·영상 페이지 주소는 스냅샷 주소가 아닙니다.");
        if (uri.Host.Equals("ddns.hanwha-security.com", StringComparison.OrdinalIgnoreCase))
            throw new SnapshotException("device-address-required", "DDNS 포털에는 장비 계정을 보내지 않습니다. 웹뷰어에 최종 표시된 카메라 장비 주소를 입력하세요.");
        var query = QueryHelpers.ParseQuery(uri.Query);
        if (!query.TryGetValue("msubmenu", out var submenu) || submenu.Count != 1 || submenu[0] != "snapshot" ||
            !query.TryGetValue("action", out var action) || action.Count != 1 || action[0] != "view" ||
            query.Any(p => p.Key is not ("msubmenu" or "action" or "Channel" or "Profile") || p.Value.Count != 1) ||
            (query.TryGetValue("Channel", out var channel) && (!int.TryParse(channel[0], out var c) || c < 0 || c > 15)) ||
            (query.TryGetValue("Profile", out var profile) && (!int.TryParse(profile[0], out var p) || p < 1 || p > 10)))
            throw new SnapshotException("snapshot-only", "현재 시험은 확인된 snapshot / view JPEG 조회만 허용합니다. 설정·제어 경로는 요청하지 않습니다.");
        if (request.ReadDevicePtz && query.TryGetValue("Channel", out var ptzChannel) && ptzChannel[0] != "0")
            throw new SnapshotException("ptz-channel-unsupported", "현재 장비 각도 조회는 단일 카메라의 Channel 0 영상에만 연결합니다.");
        return uri;
    }
    private static Uri ValidateNvt(DirectSnapshotRequest request)
    {
        if (!string.IsNullOrEmpty(request.Username) || !string.IsNullOrEmpty(request.Password))
            throw new SnapshotException("invalid-input", "NVT는 웹뷰어에서 확인한 JPEG 요청 전체 주소를 입력하세요. 별도 ID/PW는 사용하지 않습니다.");
        if (request.SnapshotUrl is null || request.SnapshotUrl.Length > 2048 ||
            !Uri.TryCreate(request.SnapshotUrl, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https") ||
            uri.UserInfo.Length != 0 || uri.Fragment.Length != 0 || uri.AbsolutePath != "/cgi-bin/GetImage.cgi")
            throw new SnapshotException("nvt-url-required", "NVT 웹뷰어에서 확인한 /cgi-bin/GetImage.cgi JPEG 요청 전체 주소를 입력하세요.");
        if (uri.Host.Equals("ddns.hanwha-security.com", StringComparison.OrdinalIgnoreCase))
            throw new SnapshotException("device-address-required", "웹뷰어에 최종 표시된 장비의 JPEG 요청 주소를 입력하세요.");
        var query = QueryHelpers.ParseQuery(uri.Query);
        bool Secret(string key, int limit) => query.TryGetValue(key, out var value) && value.Count == 1 &&
            !string.IsNullOrWhiteSpace(value[0]) && value[0]!.Length <= limit && !value[0]!.Any(char.IsControl);
        if (!Secret("USER", 128) || !Secret("PWD", 1024) ||
            !query.TryGetValue("InputNumber", out var input) || input.Count != 1 || input[0] != "1" ||
            query.Any(p => p.Key is not ("USER" or "PWD" or "InputNumber" or "time") || p.Value.Count != 1) ||
            query.TryGetValue("time", out var time) && (!double.TryParse(time[0], System.Globalization.NumberStyles.Float,
                System.Globalization.CultureInfo.InvariantCulture, out var t) || !double.IsFinite(t) || t < 0 || t > 1))
            throw new SnapshotException("nvt-snapshot-only", "NVT GetImage의 USER·PWD·InputNumber=1과 선택 time만 지원합니다. 인증값은 웹뷰어의 요청에서 그대로 가져오세요.");
        return uri;
    }
    public async Task<object> StartAsync(DirectSnapshotRequest request, CancellationToken ct)
    {
        var uri = Validate(request);
        await changes.WaitAsync(ct);
        try
        {
            await StopCurrentAsync();
            var nvt = request.Source == "nvt-getimage";
            var handler = new HttpClientHandler { AllowAutoRedirect = false, UseCookies = false, PreAuthenticate = false };
            if (!nvt)
            {
                var credentials = new CredentialCache();
                var authority = new Uri(uri.GetLeftPart(UriPartial.Authority) + "/");
                var credential = new NetworkCredential(request.Username, request.Password);
                credentials.Add(authority, "Digest", credential);
                // Basic may be negotiated only over validated HTTPS, never plaintext HTTP.
                if (uri.Scheme == "https") credentials.Add(authority, "Basic", credential);
                handler.Credentials = credentials;
            }
            var client = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(6) };
            var next = new Session(client, uri, request.CameraLabel.Trim(), request.ReadDevicePtz, nvt);
            lock (sync) { state = "connecting"; reason = "connecting"; }
            try
            {
                var frame = await ReadAsync(next, ct);
                ct.ThrowIfCancellationRequested();
                lock (sync) { session = next; Publish(next, frame); }
                next.Loop = RunAsync(next);
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
    private async Task RunAsync(Session current)
    {
        try
        {
            await Task.WhenAll(PollAsync(current), current.ReadDevicePtz ? PollPtzAsync(current) : Task.CompletedTask);
        }
        finally { current.Client.Dispose(); current.Cancellation.Dispose(); }
    }
    private async Task PollPtzAsync(Session current)
    {
        try
        {
            while (!current.Cancellation.IsCancellationRequested)
            {
                var sample = await ReadPtzAsync(current, current.Cancellation.Token);
                lock (sync)
                {
                    if (session != current || current.Cancellation.IsCancellationRequested) return;
                    current.PtzSample = sample with { Sequence = ++current.PtzSequence };
                    current.PtzState = "live"; current.PtzReason = "ptz-received";
                }
                await Task.Delay(1000, current.Cancellation.Token);
            }
        }
        catch (OperationCanceledException) when (current.Cancellation.IsCancellationRequested) { }
        catch (Exception error)
        {
            lock (sync) if (session == current)
            {
                current.PtzSample = null; current.PtzState = "error";
                current.PtzReason = error is SnapshotException failure ? failure.Code : error is OperationCanceledException ? "ptz-timeout" : "ptz-unreachable";
            }
            // Optional angle reads stop on failure; the independent JPEG loop continues.
        }
    }
    private static Task<DevicePtzSample> ReadPtzAsync(Session current, CancellationToken ct) => current.Nvt
        ? NvtDevicePtzReader.ReadAsync(current.Client, current.Uri, ct)
        : DevicePtzReader.ReadAsync(current.Client, current.Uri, ct);
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
        finally { current.Cancellation.Cancel(); }
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
            var ptzFresh = session?.PtzSample is { } ptz && ptz.ReceivedAt >= DateTimeOffset.UtcNow.AddSeconds(-4);
            return new { configured = Configured, status = state == "live" && !fresh ? "stale" : state,
                reasonCode = reason, liveFrameAvailable = state == "live" && fresh,
                observation = frame is null || session is null ? null : new {
                    sessionId = session.Id, cameraLabel = session.Label, status = fresh ? "live" : "paused", reasonCode = "snapshot-received",
                    capturedAt = frame.ReceivedAt, sequence = frame.Sequence, width = frame.Width, height = frame.Height,
                    sceneChanged = false, lowContrast = false, referenceDifference = (double?)null },
                directionStatus = "unknown", automaticDirectionTrackingImplemented = false,
                devicePtz = new { enabled = session?.ReadDevicePtz ?? false,
                    status = session?.PtzState == "live" && !ptzFresh ? "stale" : session?.PtzState ?? "disabled",
                    reasonCode = session?.PtzState == "live" && !ptzFresh ? "ptz-stale" : session?.PtzReason ?? "not-connected",
                    sample = ptzFresh ? session?.PtzSample : null,
                    timestampSource = "local-receive-clock", geographicHeadingCalibrated = false, imageSynchronized = false },
                frameSource = session?.Nvt == true ? "nvt-getimage-snapshot" : "hanwha-jpeg-snapshot", captureTimestampSource = "local-receive-clock", underlyingStreamFreshnessVerified = false };
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
        // NVT's web viewer changes this cache-buster for every JPEG. Never log the URI:
        // its query contains the operator's captured authentication material.
        var uri = current.Uri;
        if (current.Nvt)
        {
            var query = QueryHelpers.ParseQuery(uri.Query).ToDictionary(p => p.Key, p => (string?)p.Value[0]);
            query["time"] = Random.Shared.NextDouble().ToString("R", System.Globalization.CultureInfo.InvariantCulture);
            uri = new Uri(QueryHelpers.AddQueryString(uri.GetLeftPart(UriPartial.Path), query));
        }
        using var request = new HttpRequestMessage(HttpMethod.Get, uri);
        request.Headers.CacheControl = new() { NoCache = true, NoStore = true };
        request.Headers.Accept.ParseAdd("image/jpeg");
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct);
        deadline.CancelAfter(TimeSpan.FromSeconds(6));
        using var response = await current.Client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, deadline.Token);
        if (response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
            throw new SnapshotException("authentication-denied", current.Nvt
                ? "NVT 영상 접근이 거절됐습니다. 웹뷰어에서 새 JPEG 요청 주소를 확인하세요."
                : "장비 인증 또는 접근 권한이 거절됐습니다. ID/PW와 허용 IP를 확인하세요. HTTP 연결은 Digest 인증이 필요합니다.", 502);
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
