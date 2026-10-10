using System.Diagnostics;
using System.Runtime.InteropServices;
using ScreenCapture.Core;

namespace SsmScreenCapture;

internal sealed record WindowSelection(nint Window, uint ProcessId, Size OriginalClientSize,
    Rectangle RelativeRegion);

internal static class NativeWindows
{
    [StructLayout(LayoutKind.Sequential)] private struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] private struct POINT { public int X, Y; }
    private delegate bool EnumCallback(nint window, nint parameter);
    [DllImport("user32.dll")] private static extern nint WindowFromPoint(POINT point);
    [DllImport("user32.dll")] private static extern nint GetAncestor(nint window, uint flags);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(nint window, out uint processId);
    [DllImport("user32.dll")] private static extern bool GetClientRect(nint window, out RECT rectangle);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(nint window, out RECT rectangle);
    [DllImport("user32.dll")] private static extern bool ClientToScreen(nint window, ref POINT point);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(nint window);
    [DllImport("user32.dll")] private static extern bool IsIconic(nint window);
    [DllImport("user32.dll")] private static extern bool IsWindow(nint window);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumCallback callback, nint parameter);
    [DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(nint window, uint attribute, out int value, int size);

    public static WindowSelection Select(Rectangle screenRegion)
    {
        var middle = new POINT { X = screenRegion.Left + screenRegion.Width / 2, Y = screenRegion.Top + screenRegion.Height / 2 };
        var window = GetAncestor(WindowFromPoint(middle), 2); // GA_ROOT
        GetWindowThreadProcessId(window, out var pid);
        if (window == 0 || !IsSsm(pid))
            throw new InvalidOperationException("SSM Console Client(ConsoleStudio2)의 영상 영역을 선택하세요.");
        if (!ClientBounds(window, out var client) || !Bounds(client).Contains(Bounds(screenRegion)))
            throw new InvalidOperationException("선택 영역은 SSM 창 내부에 있어야 합니다.");
        var result = new WindowSelection(window, pid, client.Size,
            new Rectangle(screenRegion.Left - client.Left, screenRegion.Top - client.Top, screenRegion.Width, screenRegion.Height));
        if (!CanCapture(result, out _, out var reason)) throw new InvalidOperationException(Message(reason));
        return result;
    }

    public static bool CanCapture(WindowSelection selection, out Rectangle region, out string reason)
    {
        region = Rectangle.Empty; reason = "target-unavailable";
        if (!IsWindow(selection.Window) || !IsWindowVisible(selection.Window) || IsIconic(selection.Window)) return false;
        GetWindowThreadProcessId(selection.Window, out var pid);
        if (pid != selection.ProcessId || !IsSsm(pid) || !ClientBounds(selection.Window, out var client)) return false;
        if (client.Size != selection.OriginalClientSize) { reason = "target-resized"; return false; }
        region = new Rectangle(client.Left + selection.RelativeRegion.Left,
            client.Top + selection.RelativeRegion.Top, selection.RelativeRegion.Width, selection.RelativeRegion.Height);
        var higher = new List<PixelBounds>(); var found = false; var uncertain = false;
        EnumWindows((window, _) =>
        {
            if (window == selection.Window) { found = true; return false; }
            if (!IsWindowVisible(window) || IsIconic(window)) return true;
            if (DwmGetWindowAttribute(window, 14, out var cloaked, sizeof(int)) == 0 && cloaked != 0) return true;
            if (GetWindowRect(window, out var rect))
                higher.Add(new(rect.Left, rect.Top, rect.Right - rect.Left, rect.Bottom - rect.Top));
            else uncertain = true;
            return true;
        }, 0);
        reason = "region-occluded";
        return !uncertain && CapturePolicy.IsAllowed(Bounds(region), Bounds(client), true, found, higher);
    }

    private static bool IsSsm(uint pid)
    {
        try { using var process = Process.GetProcessById(checked((int)pid)); return process.ProcessName.Equals("ConsoleStudio2", StringComparison.OrdinalIgnoreCase); }
        catch (Exception e) when (e is ArgumentException or InvalidOperationException or System.ComponentModel.Win32Exception) { return false; }
    }

    private static bool ClientBounds(nint window, out Rectangle rectangle)
    {
        var origin = new POINT(); rectangle = Rectangle.Empty;
        if (!GetClientRect(window, out var size) || !ClientToScreen(window, ref origin)) return false;
        rectangle = new(origin.X, origin.Y, size.Right - size.Left, size.Bottom - size.Top);
        return true;
    }

    private static PixelBounds Bounds(Rectangle r) => new(r.Left, r.Top, r.Width, r.Height);
    public static string Message(string reason) => reason switch
    {
        "target-resized" => "SSM 창 크기가 바뀌었습니다. 영상 영역을 다시 선택하세요.",
        "region-occluded" => "영상 영역에 다른 창이 겹칩니다. 겹친 창을 옮기면 재개합니다.",
        "target-unavailable" => "SSM 창이 닫히거나 최소화되었습니다.",
        "capture-error" => "화면 캡처 또는 파일 교환에 실패했습니다. 중지 후 다시 시작하세요.",
        _ => "영상 수집이 중지되었습니다."
    };
}
