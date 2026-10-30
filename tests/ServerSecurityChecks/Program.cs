using System.Text;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using WisenetPtzBridge.Services;

var password = "synthetic-monitor-password";
var hash = MonitoringServerSecurity.HashPassword(password);
if (!MonitoringServerSecurity.ValidHash(hash) || !MonitoringServerSecurity.VerifyPassword(password, hash) ||
    MonitoringServerSecurity.VerifyPassword("incorrect-password", hash) ||
    MonitoringServerSecurity.ValidHash("pbkdf2-sha256$600000$bad$bad") ||
    MonitoringServerSecurity.VerifyPassword(password, "pbkdf2-sha256$600000$bad$bad")) throw new Exception("Login hash validation failed.");
var settingsPath = Path.Combine(Path.GetTempPath(), "monitor-settings-check-" + Guid.NewGuid().ToString("N"), "server-settings.protected");
var emptySettings = MonitoringServerSetup.ReadProtectedSettings(settingsPath);
emptySettings["CCTV_CONNECTIONS_JSON"] = "synthetic-memory-value";
if (emptySettings["CCTV_CONNECTIONS_JSON"] != "synthetic-memory-value") throw new Exception("CLI settings must have a writable configuration provider.");
foreach (var stderr in new[] { "HTTP 403: denied synthetic-private-value", "HTTP 401: synthetic-private-value", "HTTP 404: synthetic-private-value", "unexpected synthetic-private-value" })
    if (MonitoringServerSetup.GitHubFailureReason(stderr).Contains("synthetic-private-value")) throw new Exception("CLI error output exposed raw diagnostic data.");
if (!MonitoringServerSetup.GitHubFailureReason("HTTP 403").Contains("403")) throw new Exception("CLI permission diagnosis missing.");
var secretCommand = MonitoringServerSetup.GitHubSecretCommand("CCTV_MAP_CONFIGURATION_JSON");
const string koreanMapLabel = "합성 카메라 지도 설정";
if (secretCommand.StandardInputEncoding is not { } stdinEncoding || stdinEncoding.GetPreamble().Length != 0 ||
    Encoding.UTF8.GetString(stdinEncoding.GetBytes(koreanMapLabel)) != koreanMapLabel ||
    !secretCommand.ArgumentList.SequenceEqual(new[] { "secret", "set", "CCTV_MAP_CONFIGURATION_JSON", "--repo", "hyeonbae-jeon/fire-monitoring" }))
    throw new Exception("GitHub secret transfer must preserve Korean UTF-8 without a BOM and use stdin for values.");
var mapWork = Path.Combine(Path.GetTempPath(), "monitor-defaults-check-" + Guid.NewGuid().ToString("N"));
var mapConfig = new ConfigurationBuilder().AddInMemoryCollection().Build();
var mapPath = Path.Combine(mapWork, "map.json");
mapConfig["MAP_CONFIG_FILE"] = mapPath;
try
{
    await MonitoringServerSetup.InitializeMapAsync(mapConfig);
    if (File.Exists(mapPath)) throw new Exception("Regular Bridge must not opt into bundled defaults implicitly.");
    await MonitoringServerSetup.InitializeMapAsync(mapConfig, useBundledDefaults: true);
    if (await File.ReadAllTextAsync(mapPath) != MonitoringMapDefaults.ReadText()) throw new Exception("Fresh installation did not receive bundled defaults.");
    const string explicitMap = "{\"schemaVersion\":1,\"crs\":\"EPSG:4326\",\"positions\":[]}";
    await File.WriteAllTextAsync(mapPath, explicitMap);
    await MonitoringServerSetup.InitializeMapAsync(mapConfig, useBundledDefaults: true);
    if (await File.ReadAllTextAsync(mapPath) != explicitMap) throw new Exception("Saved operator settings must survive updates.");
    File.Delete(mapPath);
    mapConfig["MONITOR_SERVER_MODE"] = "true";
    mapConfig["CCTV_MAP_CONFIGURATION_JSON"] = explicitMap;
    await MonitoringServerSetup.InitializeMapAsync(mapConfig, useBundledDefaults: true);
    if (await File.ReadAllTextAsync(mapPath) != explicitMap) throw new Exception("Explicit server map must take precedence over bundled defaults.");
}
finally { if (Directory.Exists(mapWork)) Directory.Delete(mapWork, true); }
var accounts = new ConfigurationBuilder().AddInMemoryCollection().Build();
accounts["CCTV_MONITOR_USER"] = "synthetic-admin"; accounts["CCTV_MONITOR_PASSWORD_HASH"] = hash;
MonitoringServerSecurity.ValidateAccounts(accounts);
accounts["CCTV_VIEWER_USER"] = "synthetic-viewer"; accounts["CCTV_VIEWER_PASSWORD_HASH"] = hash;
MonitoringServerSecurity.ValidateAccounts(accounts);
foreach (var invalid in new[] { "synthetic-admin", " ", "bad\nname" })
{
    accounts["CCTV_VIEWER_USER"] = invalid;
    try { MonitoringServerSecurity.ValidateAccounts(accounts); throw new Exception("Invalid viewer account accepted."); }
    catch (InvalidOperationException) { }
}
accounts["CCTV_VIEWER_USER"] = ""; accounts["CCTV_VIEWER_PASSWORD_HASH"] = "";
MonitoringServerSecurity.ValidateAccounts(accounts);
if (OperatingSystem.IsWindows())
{
    var plain = Encoding.UTF8.GetBytes("synthetic-camera-secret-do-not-publish");
    var encrypted = MonitoringServerSetup.Protect(plain, true);
    if (encrypted.AsSpan().IndexOf(plain) >= 0 || !MonitoringServerSetup.Protect(encrypted, false).SequenceEqual(plain))
        throw new Exception("Windows current-user protection failed.");
    encrypted[0] ^= 255;
    try { MonitoringServerSetup.Protect(encrypted, false); throw new Exception("Corrupt protected settings accepted."); }
    catch (CryptographicException) { }
    var expected = new Dictionary<string,string>
    {
        ["MONITOR_SERVER_MODE"] = "true",
        ["CCTV_CONNECTIONS_JSON"] = """{"schemaVersion":1,"cameras":[{"cameraId":"synthetic-camera","source":"hanwha","snapshotUrl":"http://synthetic-camera.invalid/stw-cgi/video.cgi?msubmenu=snapshot&action=view&Profile=1","username":"synthetic-user","password":"synthetic-camera-password"}]}""",
        ["CCTV_MAP_CONFIGURATION_JSON"] = """{"schemaVersion":1,"crs":"EPSG:4326","positions":[]}""",
        ["CCTV_MONITOR_USER"] = "synthetic-monitor", ["CCTV_MONITOR_PASSWORD_HASH"] = hash,
        ["VWORLD_API_KEY"] = "synthetic-browser-key", ["CCTV_VIEWER_USER"] = "synthetic-viewer", ["CCTV_VIEWER_PASSWORD_HASH"] = hash
    };
    Directory.CreateDirectory(Path.GetDirectoryName(settingsPath)!);
    try
    {
        var saved = MonitoringServerSetup.Protect(JsonSerializer.SerializeToUtf8Bytes(expected), true);
        File.WriteAllBytes(settingsPath, saved);
        var loaded = MonitoringServerSetup.ReadProtectedSettings(settingsPath);
        foreach (var value in expected)
            if (loaded[value.Key] != value.Value) throw new Exception("Encrypted CLI settings reload lost a field.");
        loaded["CCTV_MONITOR_USER"] = "synthetic-in-memory-change";
        if (MonitoringServerSetup.ReadProtectedSettings(settingsPath)["CCTV_MONITOR_USER"] != expected["CCTV_MONITOR_USER"] ||
            !saved.SequenceEqual(File.ReadAllBytes(settingsPath))) throw new Exception("Settings inspection modified the encrypted file.");
        File.WriteAllBytes(settingsPath, encrypted);
        try { MonitoringServerSetup.ReadProtectedSettings(settingsPath); throw new Exception("Corrupt CLI settings accepted."); }
        catch (InvalidOperationException) { }
    }
    finally { Directory.Delete(Path.GetDirectoryName(settingsPath)!, true); }
    Console.WriteLine("Windows DPAPI, encrypted CLI settings reload/preservation, tamper rejection and login checks passed.");
}
else Console.WriteLine("CLI writable settings, sanitized diagnostics and login checks passed; Windows DPAPI reload checks run on Windows CI.");
