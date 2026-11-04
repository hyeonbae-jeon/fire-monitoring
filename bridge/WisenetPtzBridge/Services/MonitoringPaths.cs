using System.Text.Json;

namespace WisenetPtzBridge.Services;

public static class MonitoringPaths
{
    public static string DataDirectory => Path.GetFullPath(Environment.GetEnvironmentVariable("CCTV_DATA_DIR") ?? Path.Combine(AppContext.BaseDirectory, "data"));
    public static string ServerSettings => Path.Combine(DataDirectory, "server-settings.protected");
    public static string ReceiverPid => Path.Combine(DataDirectory, "receiver.pid.json");
    public static void RegisterReceiver(WebApplication app)
    {
        if (!OperatingSystem.IsWindows() || !MonitoringServerSecurity.Enabled(app.Configuration)) return;
        app.Lifetime.ApplicationStarted.Register(() =>
        {
            try
            {
                Directory.CreateDirectory(DataDirectory);
                using var process = System.Diagnostics.Process.GetCurrentProcess();
                File.WriteAllText(ReceiverPid, JsonSerializer.Serialize(new { processId = process.Id,
                    startTicks = process.StartTime.ToUniversalTime().Ticks, executable = Environment.ProcessPath }));
            }
            catch { /* A missing local PID record must not stop camera reception. */ }
        });
        app.Lifetime.ApplicationStopped.Register(() =>
        {
            try
            {
                if (!File.Exists(ReceiverPid)) return;
                using var doc = JsonDocument.Parse(File.ReadAllText(ReceiverPid));
                if (doc.RootElement.GetProperty("processId").GetInt32() == Environment.ProcessId) File.Delete(ReceiverPid);
            }
            catch { }
        });
    }
}
