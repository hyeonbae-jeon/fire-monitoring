namespace SsmScreenCapture;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        ApplicationConfiguration.Initialize();
        var output = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "data", "capture.private"));
        for (var i = 0; i < args.Length; i++)
        {
            if (args[i] == "--output-dir" && i + 1 < args.Length) output = Path.GetFullPath(args[++i]);
            else { MessageBox.Show("지원하지 않는 실행 옵션입니다."); return; }
        }
        Application.Run(new CaptureForm(output));
    }
}
