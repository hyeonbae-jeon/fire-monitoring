using System.Text.Json;
using System.Text.Json.Serialization;

namespace ScreenCapture.Core;

public sealed record CaptureState
{
    public int SchemaVersion { get; init; } = 1;
    public required string SessionId { get; init; }
    public required string CameraLabel { get; init; }
    public required string Status { get; init; }
    public required string ReasonCode { get; init; }
    public required DateTimeOffset UpdatedAt { get; init; }
    public DateTimeOffset? CapturedAt { get; init; }
    public long Sequence { get; init; }
    public int Width { get; init; }
    public int Height { get; init; }
    public string? FrameFile { get; init; }
    public double? MeanDifference { get; init; }
    public double? ReferenceDifference { get; init; }
    public bool SceneChanged { get; init; }
    public bool LowContrast { get; init; }
    // Screen change is not a geographic pose measurement.
    public string DirectionStatus { get; init; } = "unknown";

    public static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow
    };

    public static string FrameName(string sessionId, long sequence) => $"frame-{sessionId}-{sequence}.jpg";

    public bool IsValid()
    {
        if (SchemaVersion != 1 || !Guid.TryParseExact(SessionId, "N", out var id) || id.ToString("N") != SessionId ||
            string.IsNullOrWhiteSpace(CameraLabel) || CameraLabel.Length > 100 || CameraLabel.Any(char.IsControl) ||
            Status is not ("live" or "paused" or "stopped") ||
            ReasonCode is not ("capturing" or "not-started" or "target-unavailable" or "target-resized" or
                "region-occluded" or "capture-error" or "user-stopped" or "select-again") ||
            DirectionStatus != "unknown" || Sequence < 0 || UpdatedAt == default ||
            !ValidDifference(MeanDifference) || !ValidDifference(ReferenceDifference)) return false;
        if (Status != "live") return FrameFile is null;
        return ReasonCode == "capturing" && Sequence > 0 && CapturedAt is not null &&
            Width is >= 64 and <= 4096 && Height is >= 64 and <= 2160 && (long)Width * Height <= 8_847_360 &&
            FrameFile == FrameName(SessionId, Sequence);
    }

    private static bool ValidDifference(double? value) => value is null ||
        (double.IsFinite(value.Value) && value.Value is >= 0 and <= 1);
}
