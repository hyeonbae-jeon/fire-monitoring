using System.Drawing.Imaging;

namespace SsmScreenCapture;

internal static class ScreenPixels
{
    // Graphics.CopyFromScreen validates a single enum value, not a bitmask.
    // Callers must check the selected SSM window and occlusion before and after reading.
    public static Bitmap Read(Rectangle region)
    {
        var bitmap = new Bitmap(region.Width, region.Height, PixelFormat.Format24bppRgb);
        try
        {
            using var graphics = Graphics.FromImage(bitmap);
            graphics.CopyFromScreen(region.Location, Point.Empty, region.Size, CopyPixelOperation.SourceCopy);
            return bitmap;
        }
        catch
        {
            bitmap.Dispose();
            throw;
        }
    }
}
