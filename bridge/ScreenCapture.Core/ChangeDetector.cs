namespace ScreenCapture.Core;

public sealed record ChangeObservation(double PreviousDifference, double ReferenceDifference,
    bool SceneChanged, bool LowContrast);

/// <summary>Coarse image-change evidence, never Pan/Tilt/Zoom or geographic orientation.</summary>
public sealed class ChangeDetector(double threshold = .08)
{
    private byte[]? reference, previous;
    private int consecutive;
    private bool changed;

    public void Reset() { reference = previous = null; consecutive = 0; changed = false; }

    public ChangeObservation Observe(ReadOnlySpan<byte> grayscale)
    {
        if (grayscale.Length < 16) throw new ArgumentException("Image signature is too small.");
        if (!double.IsFinite(threshold) || threshold is < .01 or > .5) throw new ArgumentOutOfRangeException(nameof(threshold));
        if (reference is null || reference.Length != grayscale.Length)
        {
            reference = grayscale.ToArray(); previous = grayscale.ToArray(); consecutive = 0; changed = false;
        }
        var delta = Difference(grayscale, previous!);
        var absolute = Difference(grayscale, reference!);
        consecutive = absolute >= threshold ? consecutive + 1 : 0;
        changed |= consecutive >= 2;
        previous = grayscale.ToArray();
        var mean = 0d;
        foreach (var value in grayscale) mean += value;
        mean /= grayscale.Length;
        var variance = 0d;
        foreach (var value in grayscale) variance += (value - mean) * (value - mean);
        return new(delta, absolute, changed, Math.Sqrt(variance / grayscale.Length) < 2.5);
    }

    private static double Difference(ReadOnlySpan<byte> a, ReadOnlySpan<byte> b)
    {
        var sum = 0d;
        for (var i = 0; i < a.Length; i++) sum += Math.Abs(a[i] - b[i]);
        return sum / a.Length / 255;
    }
}
