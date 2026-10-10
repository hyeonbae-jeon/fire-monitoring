using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Diagnostics;
using ScreenCapture.Core;
using SsmScreenCapture;

internal static class Program
{
    [DllImport("dwmapi.dll")] private static extern int DwmFlush();
    [STAThread]
    private static int Main()
    {
        var passed = 0;
        string Escape(string value) => value.Replace("%", "%25").Replace("\r", "%0D").Replace("\n", "%0A");
        void Check(bool result, string name)
        {
            if (!result) throw new Exception(name);
            passed++; Console.WriteLine("PASS " + name);
            Console.WriteLine("::notice title=Windows synthetic capture::" + Escape(name));
        }
        try
        {
            Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
            Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
            Console.WriteLine("::notice title=Windows test environment::" + Escape($"process={Process.GetCurrentProcess().ProcessName}; interactive={Environment.UserInteractive}; screen={SystemInformation.VirtualScreen}"));
            using var target = new Form { Text = "SYNTHETIC capture target", StartPosition = FormStartPosition.Manual,
                Location = new(60, 70), ClientSize = new(500, 300), BackColor = Color.DodgerBlue, TopMost = true };
            target.Show(); target.Activate(); target.Refresh(); Application.DoEvents(); DwmFlush();
            var initial = new Rectangle(target.PointToScreen(new(90, 70)), new Size(180, 120));
            var selection = NativeWindows.Select(initial);
            Check(selection.Window == target.Handle, "selection binds the synthetic allowlisted process/window");
            Check(NativeWindows.CanCapture(selection, out var region, out _) && region == initial, "unobscured client region is capturable");
            using var bitmap = ScreenPixels.Read(region);
            var pixel = bitmap.GetPixel(90, 60);
            Check(Math.Abs(pixel.B - Color.DodgerBlue.B) < 5 && Math.Abs(pixel.R - Color.DodgerBlue.R) < 5,
                $"GDI reads the actual synthetic window color (observed RGB={pixel.R},{pixel.G},{pixel.B})");
            using var memory = new MemoryStream(); bitmap.Save(memory, ImageFormat.Jpeg);
            Check(JpegHeader.HasDimensions(memory.ToArray(), 180, 120), "Windows encoded JPEG matches selected region");
            using (var obstruction = new Form { StartPosition = FormStartPosition.Manual,
                Bounds = new Rectangle(region.Left + 20, region.Top + 20, 120, 90), TopMost = true })
            {
                obstruction.Show(); obstruction.Activate(); Application.DoEvents();
                Check(!NativeWindows.CanCapture(selection, out _, out var reason) && reason == "region-occluded",
                    "native foreign-window overlap pauses capture");
            }
            Application.DoEvents();
            Check(NativeWindows.CanCapture(selection, out _, out _), "removing obstruction permits capture");
            target.Location = new(target.Left + 30, target.Top + 10); Application.DoEvents();
            Check(NativeWindows.CanCapture(selection, out region, out _) && region.Left == initial.Left + 30 && region.Top == initial.Top + 10,
                "client-relative region follows a moved window");
            target.ClientSize = new(520, 320); Application.DoEvents();
            Check(!NativeWindows.CanCapture(selection, out _, out var resizeReason) && resizeReason == "target-resized",
                "resize requires reselection");
            target.WindowState = FormWindowState.Minimized; Application.DoEvents();
            Check(!NativeWindows.CanCapture(selection, out _, out _), "minimized window is not captured");
            target.Close(); Application.DoEvents();
            Check(!NativeWindows.CanCapture(selection, out _, out _), "closed window is not captured");
            Console.WriteLine($"{passed} Windows synthetic capture checks passed. No Wisenet installation or CCTV connection used.");
            return 0;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error);
            Console.WriteLine("::error title=Windows synthetic capture failed::" + Escape(error.Message));
            return 1;
        }
    }
}
