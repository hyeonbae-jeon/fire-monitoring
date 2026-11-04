using System.Text.Json;
using ScreenCapture.Core;

var passed = 0;
void Check(bool condition, string name) { if (!condition) throw new Exception(name); passed++; Console.WriteLine("PASS " + name); }
byte[] Flat(int value) => Enumerable.Repeat((byte)value, 3600).ToArray();
var detector = new ChangeDetector(); detector.Observe(Flat(100));
Check(!detector.Observe(Flat(101)).SceneChanged, "small noise does not report scene change");
Check(!detector.Observe(Flat(160)).SceneChanged, "one transient does not latch change");
Check(detector.Observe(Flat(160)).SceneChanged, "sustained scene change is detected");
Check(detector.Observe(Flat(100)).SceneChanged, "return to reference cannot erase a recorded change");
detector.Reset(); detector.Observe(Flat(100));
for (var i = 102; i <= 160; i += 2) detector.Observe(Flat(i));
Check(detector.Observe(Flat(162)).SceneChanged, "slow cumulative movement is compared with reference");
detector.Reset();
Check(!detector.Observe(Flat(160)).SceneChanged, "operator reset creates a new comparison baseline");
Check(detector.Observe(Flat(0)).LowContrast, "black/low contrast is flagged without claiming PTZ");
var client = new PixelBounds(-1920, 0, 1920, 1080); var region = new PixelBounds(-1800, 100, 600, 400);
Check(CapturePolicy.IsAllowed(region, client, true, true, []), "negative monitor coordinates are supported");
Check(!CapturePolicy.IsAllowed(region, client, true, true, [new(-1300, 200, 200, 200)]), "partial foreign-window overlap blocks capture");
Check(CapturePolicy.IsAllowed(region, client, true, true, [new(100, 200, 200, 200)]), "non-overlapping control window permits capture");
Check(!CapturePolicy.IsAllowed(region, client, false, true, []), "unavailable target blocks capture");
Check(!CapturePolicy.IsAllowed(region, client, true, false, []), "unknown target z-order blocks capture");
Check(!CapturePolicy.IsAllowed(new(-1800, 100, 3000, 400), client, true, true, []), "region outside selected client is rejected");
var session = Guid.NewGuid().ToString("N");
var state = new CaptureState { SessionId = session, CameraLabel = "Synthetic camera", Status = "live", ReasonCode = "capturing",
    UpdatedAt = DateTimeOffset.UtcNow, CapturedAt = DateTimeOffset.UtcNow, Sequence = 1, Width = 100, Height = 80, FrameFile = CaptureState.FrameName(session, 1) };
Check(state.IsValid() && state.DirectionStatus == "unknown", "screen collection carries no measured geographic direction");
Check(!(state with { FrameFile = "../outside.jpg" }).IsValid(), "path traversal cannot be a frame filename");
Check(!(state with { CameraLabel = null! }).IsValid(), "explicit null camera label fails closed");
Check(!(state with { DirectionStatus = "verified" }).IsValid(), "capture cannot claim verified direction");
Check(!(state with { Status = "paused" }).IsValid(), "paused source cannot publish a frame path");
var jpeg = new byte[] { 0xff, 0xd8, 0xff, 0xc0, 0, 8, 8, 0, 80, 0, 100, 1, 0xff, 0xd9 };
Check(JpegHeader.HasDimensions(jpeg, 100, 80) && !JpegHeader.HasDimensions(jpeg, 4096, 80), "JPEG header must match bounded dimensions");
Check(!JpegHeader.HasDimensions([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xff, 0xff, 0xd9], 100, 80), "truncated JPEG segment is rejected");
var directory = Path.Combine(Path.GetTempPath(), "synthetic-capture-" + Guid.NewGuid().ToString("N"));
try
{
    Directory.CreateDirectory(directory);
    File.WriteAllText(Path.Combine(directory, "frame-old.jpg.orphan.tmp"), "synthetic interrupted write");
    using var sink = new FrameSink(directory);
    Check(Directory.GetFiles(directory, "*.tmp").Length == 0, "next start removes interrupted private frame writes");
    for (var i = 1; i <= 5; i++) sink.Publish(state with { Sequence = i, FrameFile = CaptureState.FrameName(session, i) }, jpeg);
    Check(Directory.GetFiles(directory, "*.jpg").Length == 2, "continuous collection retains at most two frames");
    sink.Publish(state with { Status = "paused", ReasonCode = "region-occluded", FrameFile = null });
    Check(Directory.GetFiles(directory, "*.jpg").Length == 0, "occlusion deletes retained images");
    var published = JsonSerializer.Deserialize<CaptureState>(File.ReadAllText(Path.Combine(directory, "capture-source.json")), CaptureState.JsonOptions)!;
    Check(published.Status == "paused" && published.FrameFile is null, "occlusion publishes non-live state");
}
finally { Directory.Delete(directory, true); }
Console.WriteLine($"{passed} screen capture checks passed. All data is synthetic; Windows capture is not exercised here.");
