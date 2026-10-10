namespace ScreenCapture.Core;

public static class JpegHeader
{
    // Bound browser decoding to the dimensions declared by the capture tool.
    public static bool HasDimensions(ReadOnlySpan<byte> bytes, int width, int height)
    {
        if (bytes.Length < 4 || bytes[0] != 0xff || bytes[1] != 0xd8 || bytes[^2] != 0xff || bytes[^1] != 0xd9) return false;
        var offset = 2;
        while (offset < bytes.Length - 2)
        {
            if (bytes[offset++] != 0xff) return false;
            while (offset < bytes.Length && bytes[offset] == 0xff) offset++;
            if (offset >= bytes.Length) return false;
            var marker = bytes[offset++];
            if (marker is 0xda or 0xd9 or 0x00) return false;
            if (marker == 0x01 || marker is >= 0xd0 and <= 0xd7) continue;
            if (offset + 2 > bytes.Length) return false;
            var length = (bytes[offset] << 8) | bytes[offset + 1];
            if (length < 2 || length > bytes.Length - offset) return false;
            if (marker is 0xc0 or 0xc1 or 0xc2 or 0xc3 or 0xc5 or 0xc6 or 0xc7 or 0xc9 or 0xca or 0xcb or 0xcd or 0xce or 0xcf)
                return length >= 8 && ((bytes[offset + 3] << 8) | bytes[offset + 4]) == height &&
                    ((bytes[offset + 5] << 8) | bytes[offset + 6]) == width;
            offset += length;
        }
        return false;
    }
}
