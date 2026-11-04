using System.Text.Json;

namespace ScreenCapture.Core;

/// <summary>Private local exchange folder. Two latest JPEGs, no video archive.</summary>
public sealed class FrameSink : IDisposable
{
    private readonly string directory;
    private readonly FileStream ownership;
    private readonly Queue<string> frames = new();
    public const int MaximumFrameBytes = 6 * 1024 * 1024;

    public FrameSink(string directory)
    {
        this.directory = Path.GetFullPath(directory);
        Directory.CreateDirectory(this.directory);
        ownership = new FileStream(Path.Combine(this.directory, ".capture.lock"), FileMode.OpenOrCreate,
            FileAccess.ReadWrite, FileShare.None);
        try
        {
            foreach (var pattern in new[] { "frame-*.jpg", "frame-*.jpg.*.tmp", "capture-source.json.*.tmp" })
                foreach (var file in Directory.EnumerateFiles(this.directory, pattern)) File.Delete(file);
        }
        catch { ownership.Dispose(); throw; }
    }

    public void Publish(CaptureState state, byte[]? jpeg = null)
    {
        if (!state.IsValid()) throw new InvalidDataException("Invalid capture state.");
        if (state.Status == "live")
        {
            if (jpeg is null || jpeg.Length is < 4 or > MaximumFrameBytes || !JpegHeader.HasDimensions(jpeg, state.Width, state.Height))
                throw new InvalidDataException("Invalid JPEG frame.");
            var path = Path.Combine(directory, state.FrameFile!);
            AtomicWrite(path, jpeg);
            frames.Enqueue(path);
        }
        AtomicWrite(Path.Combine(directory, "capture-source.json"),
            JsonSerializer.SerializeToUtf8Bytes(state, CaptureState.JsonOptions));
        while (frames.Count > (state.Status == "live" ? 2 : 0)) File.Delete(frames.Dequeue());
    }

    private static void AtomicWrite(string path, byte[] contents)
    {
        var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try { File.WriteAllBytes(temporary, contents); File.Move(temporary, path, true); }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }

    public void Dispose() => ownership.Dispose();
}
