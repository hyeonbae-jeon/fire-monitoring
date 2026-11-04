using System.Text.Json;
using ScreenCapture.Core;

namespace WisenetPtzBridge.Services;

public sealed class ScreenFrameSource(IConfiguration configuration)
{
    public bool Configured => !string.IsNullOrWhiteSpace(configuration["CAPTURE_SOURCE_DIR"]);
    private string DirectoryPath => Path.GetFullPath(configuration["CAPTURE_SOURCE_DIR"]!);

    public object Status()
    {
        var state = ReadState(out var reason);
        return new { configured = Configured, status = reason ?? state!.Status,
            liveFrameAvailable = reason is null && state!.Status == "live", observation = state,
            directionStatus = "unknown", automaticDirectionTrackingImplemented = false,
            frameSource = "ssm-screen-region", captureTimestampSource = "local-pc-clock",
            underlyingStreamFreshnessVerified = false };
    }

    public byte[]? Frame(string sessionId, long sequence)
    {
        var state = ReadState(out var reason);
        if (reason is not null || state is null || state.Status != "live" ||
            state.SessionId != sessionId || state.Sequence != sequence) return null;
        try
        {
            var path = Path.Combine(DirectoryPath, state.FrameFile!);
            if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0) return null;
            using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read | FileShare.Delete);
            if (stream.Length is < 4 or > FrameSink.MaximumFrameBytes) return null;
            var bytes = new byte[(int)stream.Length]; stream.ReadExactly(bytes);
            var after = ReadState(out reason);
            if (reason is not null || after?.Status != "live" || after.SessionId != sessionId || after.Sequence != sequence ||
                !JpegHeader.HasDimensions(bytes, state.Width, state.Height)) return null;
            return bytes;
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { return null; }
    }

    private CaptureState? ReadState(out string? reason)
    {
        reason = "disabled";
        if (!Configured) return null;
        reason = "waiting";
        try
        {
            var path = Path.Combine(DirectoryPath, "capture-source.json");
            if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0) { reason = "invalid"; return null; }
            using var stream = new FileStream(path, FileMode.Open,
                FileAccess.Read, FileShare.Read | FileShare.Delete);
            if (stream.Length is <= 0 or > 4096) { reason = "invalid"; return null; }
            var state = JsonSerializer.Deserialize<CaptureState>(stream, CaptureState.JsonOptions);
            if (state is null || !state.IsValid()) { reason = "invalid"; return null; }
            var now = DateTimeOffset.UtcNow;
            if (state.UpdatedAt > now.AddSeconds(2) ||
                (state.Status == "live" && (state.CapturedAt > now.AddSeconds(2) || state.CapturedAt < now.AddSeconds(-4) ||
                    state.UpdatedAt < now.AddSeconds(-4) || state.CapturedAt > state.UpdatedAt.AddSeconds(1))))
            { reason = "stale"; return state with { Status = "paused", ReasonCode = "target-unavailable", FrameFile = null }; }
            if (state.Status == "live")
            {
                var frame = new FileInfo(Path.Combine(DirectoryPath, state.FrameFile!));
                if (!frame.Exists) { reason = "waiting"; return state with { Status = "paused", FrameFile = null }; }
                if (frame.Length is < 4 or > FrameSink.MaximumFrameBytes || (frame.Attributes & FileAttributes.ReparsePoint) != 0)
                { reason = "invalid"; return null; }
            }
            reason = null; return state;
        }
        catch (FileNotFoundException) { return null; }
        catch (DirectoryNotFoundException) { return null; }
        catch (Exception e) when (e is JsonException or IOException or UnauthorizedAccessException)
        { reason = "invalid"; return null; }
    }
}
