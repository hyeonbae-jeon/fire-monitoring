namespace ScreenCapture.Core;

public readonly record struct PixelBounds(int Left, int Top, int Width, int Height)
{
    public long Right => (long)Left + Width;
    public long Bottom => (long)Top + Height;
    public bool Contains(PixelBounds other) => Width > 0 && Height > 0 && other.Width > 0 && other.Height > 0 &&
        other.Left >= Left && other.Top >= Top && other.Right <= Right && other.Bottom <= Bottom;
    public bool Intersects(PixelBounds other) => Width > 0 && Height > 0 && other.Width > 0 && other.Height > 0 &&
        Left < other.Right && other.Left < Right && Top < other.Bottom && other.Top < Bottom;
}

public static class CapturePolicy
{
    public static bool IsAllowed(PixelBounds selected, PixelBounds client,
        bool targetAvailable, bool targetFoundInZOrder, IEnumerable<PixelBounds> higherVisibleWindows) =>
        targetAvailable && targetFoundInZOrder && client.Contains(selected) &&
        selected.Width is >= 64 and <= 4096 && selected.Height is >= 64 and <= 2160 &&
        (long)selected.Width * selected.Height <= 8_847_360 &&
        !higherVisibleWindows.Any(selected.Intersects);
}
