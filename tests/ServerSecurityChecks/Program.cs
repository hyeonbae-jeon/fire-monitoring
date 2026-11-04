using System.Text;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using WisenetPtzBridge.Services;

if (args.Length == 2 && args[0] == "--write-receiver-fixture")
{
    Environment.SetEnvironmentVariable("CCTV_DATA_DIR", args[1]);
    await MonitoringServerSetup.SaveProtectedSettingsAsync(new Dictionary<string, string> {
        ["MONITOR_SERVER_MODE"] = "true", ["CCTV_CONNECTIONS_JSON"] = "", ["CCTV_MAIL_SETTINGS_JSON"] = "",
        ["CCTV_MONITOR_USER"] = "synthetic-admin", ["CCTV_MONITOR_PASSWORD_HASH"] = MonitoringServerSecurity.HashPassword("synthetic-fixture-password"),
        ["CCTV_MAP_CONFIGURATION_JSON"] = MonitoringMapDefaults.ReadText(), ["VWORLD_API_KEY"] = "" });
    return;
}
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

// Recovery exports must be portable, authenticated encryption; web settings keep blank secrets.
var backupValues = MonitoringServerSetup.Keys.ToDictionary(k => k, k => "");
backupValues["MONITOR_SERVER_MODE"] = "true";
backupValues["CCTV_MONITOR_USER"] = "synthetic-admin";
backupValues["CCTV_MONITOR_PASSWORD_HASH"] = hash;
backupValues["CCTV_MAP_CONFIGURATION_JSON"] = MonitoringMapDefaults.ReadText();
backupValues["CCTV_CONNECTIONS_JSON"] = JsonSerializer.Serialize(new AutoCameraDocument(1,
    [new("bukhansan-camera-2", "hanwha", "http://synthetic-camera.invalid/stw-cgi/video.cgi?msubmenu=snapshot&action=view&Profile=1", "synthetic-id", "synthetic-secret")] ), AutomaticMonitoring.Json);
var syntheticMail = FirewatcherMailSettings.Validate(new(true, "synthetic", "synthetic-mail-secret", "synthetic@naver.com", "https://synthetic-alert.invalid", DateTimeOffset.UtcNow.AddDays(-7)));
backupValues["CCTV_MAIL_SETTINGS_JSON"] = JsonSerializer.Serialize(syntheticMail);
UnifiedSettings.Validate(backupValues);
const string backupPassword = "synthetic-backup-passphrase";
var recovery = SettingsBackup.Encrypt(backupValues, backupPassword);
if (Encoding.UTF8.GetString(recovery).Contains("synthetic-secret") || Encoding.UTF8.GetString(recovery).Contains("synthetic-mail-secret")) throw new Exception("Unencrypted recovery credentials.");
var recovered = SettingsBackup.Decrypt(recovery, backupPassword);
if (backupValues.Any(kv => recovered[kv.Key] != kv.Value)) throw new Exception("Portable backup lost settings.");
foreach (var wrong in new[] { true, false })
{
    var bytes = recovery.ToArray(); if (!wrong) bytes[^1] ^= 1;
    try { SettingsBackup.Decrypt(bytes, wrong ? "incorrect-long-passphrase" : backupPassword); throw new Exception("Unauthenticated backup accepted."); }
    catch (CryptographicException) { }
}
var mapDocument = JsonSerializer.Deserialize<WisenetPtzBridge.Models.MapDocument>(MonitoringMapDefaults.ReadText(), FileCameraInventorySource.Json)!;
var edit = new SettingsEdit("unused", [new("bukhansan-camera-2", "hanwha", "", "synthetic-id", "", true, 3000)],
    new("synthetic-admin", "", false, "", ""), new(true, "synthetic", "", "synthetic@naver.com", "https://synthetic-alert.invalid", syntheticMail.ReadFromUtc), "");
var merged = UnifiedSettings.Merge(backupValues, edit, mapDocument);
if (AutomaticMonitoring.Parse(merged["CCTV_CONNECTIONS_JSON"]).Cameras.Single().Password != "synthetic-secret" ||
    JsonSerializer.Deserialize<FirewatcherMailSettings>(merged["CCTV_MAIL_SETTINGS_JSON"])!.AppPassword != "synthetic-mail-secret" ||
    merged["CCTV_MONITOR_PASSWORD_HASH"] != hash) throw new Exception("Blank web fields cleared existing credentials.");
try { UnifiedSettings.Merge(backupValues, edit with { Cameras = [new("unknown-camera", "hanwha", "", "", "", true, 3000)] }, mapDocument); throw new Exception("Unknown camera accepted."); }
catch (ArgumentException) { }
if (OperatingSystem.IsWindows())
{
    var tempRoot = Path.Combine(Path.GetTempPath(), "unified-web-check-" + Guid.NewGuid().ToString("N"));
    var oldDataRoot = Environment.GetEnvironmentVariable("CCTV_DATA_DIR");
    try
    {
        Environment.SetEnvironmentVariable("CCTV_DATA_DIR", tempRoot);
        var runtime = new ConfigurationBuilder().AddInMemoryCollection(backupValues!).Build();
        runtime["MAP_CONFIG_FILE"] = Path.Combine(tempRoot, "map.demo.json");
        await MonitoringServerSetup.InitializeMapAsync(runtime, true);
        await MonitoringServerSetup.SaveProtectedSettingsAsync(backupValues);
        var service = new UnifiedSettings(runtime, new MapConfiguration(runtime));
        var view = JsonSerializer.SerializeToElement(await service.ReadAsync(default), AutomaticMonitoring.Json);
        var redacted = view.GetRawText();
        foreach (var secretValue in new[] { "synthetic-secret", "synthetic-mail-secret", hash })
            if (redacted.Contains(secretValue)) throw new Exception("Admin settings GET leaked a stored secret.");
        var revision = view.GetProperty("revision").GetString()!;
        await service.SaveAsync(edit with { Revision = revision, Cameras = [edit.Cameras[0] with { Enabled = false }] }, default);
        if (AutomaticMonitoring.Parse(runtime["CCTV_CONNECTIONS_JSON"]!).Cameras.Single().Enabled || AutomaticMonitoring.Parse(MonitoringServerSetup.ReadProtectedSettings()["CCTV_CONNECTIONS_JSON"]!).Cameras.Single().Enabled) throw new Exception("Web save did not persist and apply runtime settings.");
        try { await service.SaveAsync(edit with { Revision = revision }, default); throw new Exception("Stale web edit accepted."); }
        catch (WisenetPtzBridge.Models.InventoryException e) when (e.StatusCode == 409) { }
    }
    finally { Environment.SetEnvironmentVariable("CCTV_DATA_DIR", oldDataRoot); if (Directory.Exists(tempRoot)) Directory.Delete(tempRoot, true); }
}
Console.WriteLine("Unified settings secret preservation, portable encrypted backup, wrong-password/tamper and Windows web save checks passed.");

var reloadRoot = Path.Combine(Path.GetTempPath(), "receiver-reload-check-" + Guid.NewGuid().ToString("N"));
try
{
    var runtime = new ConfigurationBuilder().AddInMemoryCollection().Build();
    runtime["MAP_CONFIG_FILE"] = Path.Combine(reloadRoot, "map.json");
    runtime["DIRECT_CAMERA_SNAPSHOT_ENABLED"] = "true";
    await MonitoringServerSetup.InitializeMapAsync(runtime, true);
    using var receiver = new AutomaticMonitoring(runtime, new MapConfiguration(runtime));
    await receiver.StartAsync(default);
    var connection = new AutoCameraConnection("bukhansan-camera-2", "hanwha", "http://127.0.0.1:9/stw-cgi/video.cgi?msubmenu=snapshot&action=view&Profile=1", "synthetic", "synthetic", true);
    runtime["CCTV_CONNECTIONS_JSON"] = JsonSerializer.Serialize(new AutoCameraDocument(1, [connection]), AutomaticMonitoring.Json);
    async Task WaitForCount(int count)
    {
        for (var attempt = 0; attempt < 100; attempt++)
        {
            if (JsonSerializer.SerializeToElement(receiver.Status(), AutomaticMonitoring.Json).GetProperty("cameras").GetArrayLength() == count) return;
            await Task.Delay(50);
        }
        throw new Exception("Receiver did not reload camera settings.");
    }
    await WaitForCount(1);
    runtime["CCTV_CONNECTIONS_JSON"] = "";
    await WaitForCount(0);
    await receiver.StopAsync(default);
}
finally { if (Directory.Exists(reloadRoot)) Directory.Delete(reloadRoot, true); }
Console.WriteLine("Running receiver accepts the first camera and removes it without restarting the host.");
