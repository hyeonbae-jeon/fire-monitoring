using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.Json;
using WisenetPtzBridge.Models;

namespace WisenetPtzBridge.Services;

public static class MonitoringServerSetup
{
    private static string ProtectedPath => Path.Combine(AppContext.BaseDirectory, "data", "server-settings.protected");
    private static readonly string[] Keys = ["MONITOR_SERVER_MODE", "CCTV_CONNECTIONS_JSON", "CCTV_MAP_CONFIGURATION_JSON",
        "CCTV_MONITOR_USER", "CCTV_MONITOR_PASSWORD_HASH", "VWORLD_API_KEY"];
    public static void LoadProtected(IConfiguration config)
    {
        if (!File.Exists(ProtectedPath)) return;
        try
        {
            var values = JsonSerializer.Deserialize<Dictionary<string, string>>(Protect(File.ReadAllBytes(ProtectedPath), false))!;
            if (values is null || values.Keys.Any(k => !Keys.Contains(k))) throw new JsonException();
            foreach (var kv in values) config[kv.Key] = kv.Value;
        }
        catch (Exception e) when (e is JsonException or CryptographicException or IOException or PlatformNotSupportedException)
        { throw new InvalidOperationException("서버 설정을 복호화하지 못했습니다. 등록한 Windows 계정과 설정 파일을 확인하세요."); }
    }
    [StructLayout(LayoutKind.Sequential)] private struct Blob { public int Length; public IntPtr Data; }
    [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CryptProtectData(ref Blob input, string? description, IntPtr entropy, IntPtr reserved, IntPtr prompt, int flags, out Blob output);
    [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CryptUnprotectData(ref Blob input, IntPtr description, IntPtr entropy, IntPtr reserved, IntPtr prompt, int flags, out Blob output);
    [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr memory);
    public static byte[] Protect(byte[] bytes, bool encrypt)
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException();
        var input = new Blob { Length = bytes.Length, Data = Marshal.AllocHGlobal(bytes.Length) };
        Blob output = default;
        try
        {
            Marshal.Copy(bytes, 0, input.Data, bytes.Length);
            var ok = encrypt ? CryptProtectData(ref input, null, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, 1, out output)
                : CryptUnprotectData(ref input, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, 1, out output);
            if (!ok) throw new CryptographicException();
            var result = new byte[output.Length]; Marshal.Copy(output.Data, result, 0, output.Length); return result;
        }
        finally { Marshal.FreeHGlobal(input.Data); if (output.Data != IntPtr.Zero) LocalFree(output.Data); }
    }
    private static string Read(string label, string fallback = "", bool secret = false)
    {
        Console.Write(label + (fallback.Length > 0 ? " (Enter: 기존 값 유지)" : "") + ": ");
        if (!secret) { var line = Console.ReadLine()?.Trim() ?? ""; return line.Length == 0 ? fallback : line; }
        var value = "";
        while (true)
        {
            var key = Console.ReadKey(intercept: true);
            if (key.Key == ConsoleKey.Enter) { Console.WriteLine(); return value.Length == 0 ? fallback : value; }
            if (key.Key == ConsoleKey.Backspace) { if (value.Length > 0) value = value[..^1]; }
            else if (!char.IsControl(key.KeyChar) && value.Length < 4096) value += key.KeyChar;
        }
    }
    public static async Task<int> ConfigureAsync()
    {
        if (!OperatingSystem.IsWindows() || Console.IsInputRedirected)
        { Console.Error.WriteLine("Windows 터미널에서 서버설정.cmd를 실행하세요."); return 1; }
        try
        {
            var old = new ConfigurationBuilder().Build(); LoadProtected(old);
            var mapPath = Read("저장한 지도 JSON 경로", Path.Combine(AppContext.BaseDirectory, "data", "map.demo.json")).Trim('"');
            var mapJson = await File.ReadAllTextAsync(mapPath);
            var map = JsonSerializer.Deserialize<MapDocument>(mapJson, FileCameraInventorySource.Json) ?? throw new JsonException();
            MapConfiguration.Validate(map);
            if (map.Positions.Count is < 1 or > 9 || map.Positions.Any(p => p.NativeTracking is null))
                throw new JsonException();
            var previous = string.IsNullOrWhiteSpace(old["CCTV_CONNECTIONS_JSON"]) ? null : AutomaticMonitoring.Parse(old["CCTV_CONNECTIONS_JSON"]!);
            var connections = new List<AutoCameraConnection>();
            foreach (var p in map.Positions)
            {
                Console.WriteLine("\n카메라: " + p.Name);
                var prior = previous?.Cameras.FirstOrDefault(c => c.CameraId == p.Id);
                var source = Read("영상 방식 (hanwha / nvt-getimage)", prior?.Source ?? (p.Name == "산성주차장" ? "nvt-getimage" : "hanwha"));
                var url = Read(source == "nvt-getimage" ? "NVT GetImage 전체 주소 (입력 숨김)" : "최종 장비 웹 주소", prior?.SnapshotUrl ?? "", source == "nvt-getimage");
                if (source == "hanwha")
                {
                    var uri = new Uri(url);
                    if (uri.AbsolutePath is "/" or "/wmf/index.html")
                        url = new UriBuilder(uri) { Path = "/stw-cgi/video.cgi", Query = "msubmenu=snapshot&action=view&Profile=1", Fragment = "" }.Uri.AbsoluteUri;
                }
                var user = source == "hanwha" ? Read("장비 ID", prior?.Username ?? "") : "";
                var password = source == "hanwha" ? Read("장비 PW (입력 숨김)", prior?.Password ?? "", true) : "";
                var range = Read("관측 범위 표시 거리(m)", (prior?.DisplayRangeM ?? 1000).ToString());
                var connection = new AutoCameraConnection(p.Id, source, url, user, password, prior?.Enabled ?? true, int.Parse(range));
                AutomaticMonitoring.Parse(JsonSerializer.Serialize(new AutoCameraDocument(1, [connection]), AutomaticMonitoring.Json));
                connections.Add(connection);
            }
            var cameraJson = JsonSerializer.Serialize(new AutoCameraDocument(1, connections.ToArray()), AutomaticMonitoring.Json);
            AutomaticMonitoring.Parse(cameraJson);
            var login = Read("모니터링 로그인 이름", old["CCTV_MONITOR_USER"] ?? "monitor");
            if (string.IsNullOrWhiteSpace(login) || login.Length > 100) throw new ArgumentException();
            var passwordHash = old["CCTV_MONITOR_PASSWORD_HASH"] ?? "";
            var loginPassword = Read("모니터링 비밀번호 (12자 이상, 입력 숨김)", "", true);
            if (loginPassword.Length > 0) passwordHash = MonitoringServerSecurity.HashPassword(loginPassword);
            if (passwordHash.Length == 0) throw new ArgumentException();
            var key = Read("VWorld 지도 키", old["VWORLD_API_KEY"] ?? "");
            var values = new Dictionary<string, string>
            {
                ["MONITOR_SERVER_MODE"] = "true", ["CCTV_CONNECTIONS_JSON"] = cameraJson,
                ["CCTV_MAP_CONFIGURATION_JSON"] = mapJson, ["CCTV_MONITOR_USER"] = login,
                ["CCTV_MONITOR_PASSWORD_HASH"] = passwordHash, ["VWORLD_API_KEY"] = key
            };
            var encrypted = Protect(JsonSerializer.SerializeToUtf8Bytes(values), true);
            Directory.CreateDirectory(Path.GetDirectoryName(ProtectedPath)!);
            var temporary = ProtectedPath + "." + Guid.NewGuid().ToString("N") + ".tmp";
            await File.WriteAllBytesAsync(temporary, encrypted); File.Move(temporary, ProtectedPath, true);
            Console.WriteLine("\n카메라 " + connections.Count + "대 서버 설정을 Windows 사용자 암호화로 저장했습니다. 실행파일을 다시 열면 자동 수신합니다.");
            return 0;
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or ArgumentException or JsonException or CryptographicException or InventoryException or FormatException or InvalidOperationException)
        { Console.Error.WriteLine("서버 설정을 저장하지 못했습니다. 지도 JSON·입력값·파일 권한을 확인하세요. 기존 설정은 유지했습니다."); return 1; }
    }
    public static async Task<int> RegisterGitHubAsync()
    {
        try
        {
            var settings = new ConfigurationBuilder().Build(); LoadProtected(settings);
            if (settings["CCTV_CONNECTIONS_JSON"] is null) throw new InvalidOperationException();
            var currentMap = Path.Combine(AppContext.BaseDirectory, "data", "map.demo.json");
            if (File.Exists(currentMap))
            {
                var text = await File.ReadAllTextAsync(currentMap);
                var map = JsonSerializer.Deserialize<MapDocument>(text, FileCameraInventorySource.Json) ?? throw new JsonException();
                MapConfiguration.Validate(map); settings["CCTV_MAP_CONFIGURATION_JSON"] = text;
            }
            foreach (var name in new[] { "CCTV_CONNECTIONS_JSON", "CCTV_MAP_CONFIGURATION_JSON", "CCTV_MONITOR_USER", "CCTV_MONITOR_PASSWORD_HASH", "VWORLD_API_KEY" })
            {
                if (System.Text.Encoding.UTF8.GetByteCount(settings[name] ?? "") > 48 * 1024) throw new InvalidOperationException();
                var targetName = name == "VWORLD_API_KEY" ? "CCTV_VWORLD_API_KEY" : name;
                var start = new ProcessStartInfo("gh") { RedirectStandardInput = true, UseShellExecute = false };
                foreach (var arg in new[] { "secret", "set", targetName, "--repo", "hyeonbae-jeon/fire-monitoring" }) start.ArgumentList.Add(arg);
                using var process = Process.Start(start) ?? throw new InvalidOperationException();
                await process.StandardInput.WriteAsync(settings[name] ?? ""); process.StandardInput.Close();
                await process.WaitForExitAsync(); if (process.ExitCode != 0) throw new InvalidOperationException();
            }
            Console.WriteLine("GitHub 서버용 Secrets 등록 완료. 인증정보는 공개 빌드와 ZIP에 포함하지 않습니다."); return 0;
        }
        catch (Exception e) when (e is System.ComponentModel.Win32Exception or InvalidOperationException or IOException or JsonException)
        { Console.Error.WriteLine("GitHub Secrets 등록 실패. GitHub CLI 설치 후 gh auth login으로 저장소 시크릿 관리 권한이 있는 계정에 로그인하세요. 비밀번호는 채팅에 보내지 마세요."); return 1; }
    }
    public static async Task<int> ImportAsync()
    {
        try
        {
            using var reader = new StreamReader(Console.OpenStandardInput());
            var buffer = new char[128001]; var count = await reader.ReadBlockAsync(buffer, 0, buffer.Length);
            if (count > 128000) throw new JsonException();
            var values = JsonSerializer.Deserialize<Dictionary<string, string>>(new string(buffer, 0, count)) ?? throw new JsonException();
            if (values.Keys.Any(k => !Keys.Contains(k)) || values["MONITOR_SERVER_MODE"] != "true" ||
                string.IsNullOrWhiteSpace(values["CCTV_MONITOR_USER"]) || values["CCTV_MONITOR_USER"].Length > 100 ||
                !MonitoringServerSecurity.ValidHash(values["CCTV_MONITOR_PASSWORD_HASH"])) throw new JsonException();
            AutomaticMonitoring.Parse(values["CCTV_CONNECTIONS_JSON"]);
            var map = JsonSerializer.Deserialize<MapDocument>(values["CCTV_MAP_CONFIGURATION_JSON"], FileCameraInventorySource.Json) ?? throw new JsonException(); MapConfiguration.Validate(map);
            var encrypted = Protect(JsonSerializer.SerializeToUtf8Bytes(values), true);
            Directory.CreateDirectory(Path.GetDirectoryName(ProtectedPath)!);
            var temp = ProtectedPath + "." + Guid.NewGuid().ToString("N") + ".tmp";
            await File.WriteAllBytesAsync(temp, encrypted); File.Move(temp, ProtectedPath, true);
            Console.WriteLine("서버 설정을 Windows 사용자 암호화로 가져왔습니다. 프로그램을 재시작하면 적용됩니다.");return 0;
        }
        catch (Exception e) when (e is JsonException or KeyNotFoundException or InventoryException or IOException or CryptographicException or PlatformNotSupportedException)
        { Console.Error.WriteLine("서버 시크릿 형식 또는 암호화 권한을 확인하세요. 기존 설정은 유지했습니다.");return 1; }
    }
    public static async Task InitializeMapAsync(IConfiguration config)
    {
        if (!MonitoringServerSecurity.Enabled(config)) return;
        var path = config["MAP_CONFIG_FILE"]!;
        if (!File.Exists(path) && config["CCTV_MAP_CONFIGURATION_JSON"] is { Length: > 0 } text)
        {
            if (text.Length > 1024 * 1024) throw new InvalidOperationException("서버 지도 JSON 크기를 확인하세요.");
            var doc = JsonSerializer.Deserialize<MapDocument>(text, FileCameraInventorySource.Json) ?? throw new InvalidOperationException("서버 지도 JSON을 확인하세요.");
            MapConfiguration.Validate(doc); Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try { await File.WriteAllTextAsync(temporary, text); File.Move(temporary, path, false); }
            finally { if (File.Exists(temporary)) File.Delete(temporary); }
        }
    }
}
