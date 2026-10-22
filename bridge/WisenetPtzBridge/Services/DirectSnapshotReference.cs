using System.IO.Compression;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.AspNetCore.WebUtilities;

namespace WisenetPtzBridge.Services;

public sealed record SnapshotReferenceRequest(string SessionId);
public sealed record SnapshotReferenceArchive(byte[] Bytes, string FileName);

public sealed partial class DirectSnapshotSource
{
    public async Task<SnapshotReferenceArchive> CreateReferenceAsync(string sessionId, CancellationToken ct)
    {
        Session current;
        CancellationTokenSource deadline;
        lock (sync)
        {
            if (session is null || session.Id != sessionId)
                throw new SnapshotException("session-changed", "직접 영상 연결이 변경됐습니다. 현재 연결에서 다시 저장하세요.", 409);
            current = session;
            if (!current.ReadDevicePtz || state != "live" || current.PtzState != "live" ||
                current.PtzSample is null || current.PtzSample.ReceivedAt < DateTimeOffset.UtcNow.AddSeconds(-4))
                throw new SnapshotException("reference-not-ready", "영상과 장비 PTZ가 정상 수신 중일 때 저장하세요. 장비 각도 조회를 켜야 합니다.", 409);
            if (current.ReferenceBusy)
                throw new SnapshotException("reference-busy", "기준 묶음을 저장 중입니다. 완료 후 다시 누르세요.", 409);
            deadline = CancellationTokenSource.CreateLinkedTokenSource(ct, current.Cancellation.Token);
            current.ReferenceBusy = true;
            current.LeaseUntil = DateTimeOffset.UtcNow.AddSeconds(15);
        }
        using (deadline)
        try
        {
            deadline.CancelAfter(TimeSpan.FromSeconds(8));
            var before = await DevicePtzReader.ReadAsync(current.Client, current.Uri, deadline.Token);
            var requestedAt = DateTimeOffset.UtcNow;
            var image = await ReadAsync(current, deadline.Token);
            var after = await DevicePtzReader.ReadAsync(current.Client, current.Uri, deadline.Token);
            var panDifference = Math.Abs(((after.PanDeg - before.PanDeg + 540) % 360) - 180);
            var tiltDifference = Math.Abs(after.TiltDeg - before.TiltDeg);
            var zoomDifference = Math.Abs(after.Zoom - before.Zoom);
            if (panDifference > .1 || tiltDifference > .1 || zoomDifference > .0001 || before.ZoomPulse != after.ZoomPulse)
                throw new SnapshotException("reference-moving", "저장 전후 PTZ가 달라 기준 묶음을 만들지 않았습니다. 카메라가 멈추고 값이 안정된 뒤 다시 저장하세요.", 409);
            var selection = QueryHelpers.ParseQuery(current.Uri.Query);
            int? Number(string key) => selection.TryGetValue(key, out var value) ? int.Parse(value[0]!) : null;
            object Sample(DevicePtzSample sample) => new { sample.PanDeg, sample.TiltDeg, sample.Zoom, sample.ZoomPulse, sample.RequestStartedAt, sample.ReceivedAt };
            var createdAt = DateTimeOffset.UtcNow;
            var metadata = new {
                schemaVersion = 1, kind = "camera-ptz-reference", createdAt, sessionId = current.Id, cameraLabel = current.Label,
                reference = new { fileName = "reference.jpg", sha256 = Convert.ToHexString(SHA256.HashData(image.Bytes)).ToLowerInvariant(),
                    image.Width, image.Height, requestStartedAt = requestedAt, image.ReceivedAt,
                    frameSource = "hanwha-jpeg-snapshot", snapshotSelection = new { channel = Number("Channel"), profile = Number("Profile") } },
                devicePtz = new { before = Sample(before), after = Sample(after) },
                stability = new { passed = true, panDifferenceDeg = panDifference, tiltDifferenceDeg = tiltDifference, zoomDifference,
                    maximumPanDifferenceDeg = .1, maximumTiltDifferenceDeg = .1, maximumZoomDifference = .0001, zoomPulseUnchanged = true },
                synchronization = new { method = "ptz-read-jpeg-request-ptz-read", timestampSource = "local-receive-clock",
                    sensorCaptureTimeKnown = false, underlyingStreamFreshnessVerified = false,
                    note = "PTZ reads bracket the JPEG request. This is not hardware synchronization and cannot detect motion that returns to the same values or a frozen source image." },
                geographicHeadingCalibrated = false
            };
            using var output = new MemoryStream();
            using (var archive = new ZipArchive(output, ZipArchiveMode.Create, leaveOpen: true))
            {
                await using (var entry = archive.CreateEntry("reference.jpg", CompressionLevel.NoCompression).Open())
                    await entry.WriteAsync(image.Bytes, deadline.Token);
                await using (var entry = archive.CreateEntry("reference-metadata.private.json", CompressionLevel.Optimal).Open())
                    await JsonSerializer.SerializeAsync(entry, metadata, new JsonSerializerOptions(JsonSerializerDefaults.Web) { WriteIndented = true }, deadline.Token);
            }
            deadline.Token.ThrowIfCancellationRequested();
            lock (sync) if (session != current) throw new SnapshotException("session-changed", "저장 중 연결이 변경돼 기준 묶음을 취소했습니다.", 409);
            return new(output.ToArray(), "cctv-ptz-reference-" + createdAt.ToString("yyyyMMddTHHmmssfffZ") + ".zip");
        }
        catch (Exception error)
        {
            lock (sync) if (session != current)
                throw new SnapshotException("session-changed", "저장 중 연결이 변경돼 기준 묶음을 취소했습니다.", 409);
            if (error is SnapshotException) throw;
            throw new SnapshotException("reference-read-failed", "기준 묶음 수신이 취소됐거나 시간을 초과했습니다. 영상과 PTZ 수신 상태를 확인하세요.", 502);
        }
        finally { lock (sync) current.ReferenceBusy = false; }
    }
}
