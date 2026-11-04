using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using WisenetPtzBridge.Models;

namespace WisenetPtzBridge.Services;

public sealed record ConnectionEdit(string CameraId, string Source, string Url, string Username, string Password, bool Enabled, int DisplayRangeM);
public sealed record AccountsEdit(string AdminUser, string AdminPassword, bool ViewerEnabled, string ViewerUser, string ViewerPassword);
public sealed record MailEdit(bool Enabled, string UserName, string AppPassword, string AllowedFrom, string AlertOrigin, DateTimeOffset ReadFromUtc);
public sealed record SettingsEdit(string Revision, ConnectionEdit[] Cameras, AccountsEdit Accounts, MailEdit? Mail, string VworldApiKey);
public sealed record BackupRequest(string Passphrase);

// One receiver owns the credentials. Browsers receive redacted settings and submit replacements only.
public sealed class UnifiedSettings(IConfiguration config, MapConfiguration maps)
{
    private readonly SemaphoreSlim gate = new(1, 1);
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { UnmappedMemberHandling = System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow };
    private Dictionary<string, string> Values() => MonitoringServerSetup.Keys.ToDictionary(k => k, k => config[k] ?? "");
    private static FirewatcherMailSettings? Mail(Dictionary<string, string> values) =>
        string.IsNullOrEmpty(values.GetValueOrDefault("CCTV_MAIL_SETTINGS_JSON")) ? null :
        FirewatcherMailSettings.Validate(JsonSerializer.Deserialize<FirewatcherMailSettings>(values["CCTV_MAIL_SETTINGS_JSON"]) ?? throw new JsonException());
    private static string Revision(Dictionary<string, string> values, string mapRevision) =>
        Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(new { values, mapRevision })));
    private Dictionary<string, string> WithMail()
    {
        var values = Values();
        if (config["CCTV_MAIL_SETTINGS_JSON"] is null && OperatingSystem.IsWindows() && FirewatcherMailSettings.Load() is { } mail)
            values["CCTV_MAIL_SETTINGS_JSON"] = JsonSerializer.Serialize(mail);
        return values;
    }
    public async Task<object> ReadAsync(CancellationToken ct)
    {
        await gate.WaitAsync(ct);
        try
        {
            var values = WithMail(); var map = await maps.ReadAsync(ct); var mail = Mail(values);
            var cameras = string.IsNullOrWhiteSpace(values["CCTV_CONNECTIONS_JSON"]) ? [] : AutomaticMonitoring.Parse(values["CCTV_CONNECTIONS_JSON"]).Cameras;
            return new { writable = OperatingSystem.IsWindows(), revision = Revision(values, map.Revision),
                cameras = map.Configuration.Positions.Select(p => {
                    var c = cameras.FirstOrDefault(c => c.CameraId == p.Id);
                    // Even encoded NVT query values are credentials; do not return them.
                    return new { cameraId = p.Id, name = p.Name, source = c?.Source ?? "hanwha", configured = c is not null,
                        address = c is null ? "" : new Uri(c.SnapshotUrl).GetLeftPart(UriPartial.Authority),
                        username = c?.Username ?? "", hasPassword = !string.IsNullOrEmpty(c?.Password), enabled = c?.Enabled ?? false,
                        displayRangeM = c?.DisplayRangeM ?? 3000 };
                }), accounts = new { adminUser = values["CCTV_MONITOR_USER"], viewerEnabled = values["CCTV_VIEWER_USER"].Length > 0, viewerUser = values["CCTV_VIEWER_USER"] },
                mail = mail is null ? null : new { mail.Enabled, mail.UserName, mail.AllowedFrom, mail.AlertOrigin, mail.ReadFromUtc, hasPassword = true },
                hasMapKey = values["VWORLD_API_KEY"].Length > 0 };
        }
        finally { gate.Release(); }
    }
    public static Dictionary<string, string> Merge(Dictionary<string, string> old, SettingsEdit edit, MapDocument map)
    {
        if (edit.Cameras is null || edit.Cameras.Length > 9 || edit.Accounts is null || edit.VworldApiKey is null || edit.VworldApiKey.Length > 1000) throw new ArgumentException();
        var next = new Dictionary<string, string>(old);
        var previous = string.IsNullOrWhiteSpace(old["CCTV_CONNECTIONS_JSON"]) ? [] : AutomaticMonitoring.Parse(old["CCTV_CONNECTIONS_JSON"]).Cameras;
        var connections = new List<AutoCameraConnection>(); var ids = new HashSet<string>();
        foreach (var c in edit.Cameras)
        {
            if (c is null || !ids.Add(c.CameraId) || !map.Positions.Any(p => p.Id == c.CameraId) || c.Url is null || c.Password is null || c.Username is null) throw new ArgumentException();
            var prior = previous.FirstOrDefault(p => p.CameraId == c.CameraId && p.Source == c.Source);
            if (prior is null && string.IsNullOrWhiteSpace(c.Url) && !c.Enabled) continue;
            var url = string.IsNullOrWhiteSpace(c.Url) ? prior?.SnapshotUrl ?? "" : c.Url.Trim();
            if (c.Source == "hanwha" && Uri.TryCreate(url, UriKind.Absolute, out var uri) && uri.AbsolutePath is "/" or "/wmf/index.html")
                url = new UriBuilder(uri) { Path = "/stw-cgi/video.cgi", Query = "msubmenu=snapshot&action=view&Profile=1", Fragment = "" }.Uri.AbsoluteUri;
            connections.Add(new(c.CameraId, c.Source, url, c.Username, c.Password.Length > 0 ? c.Password : prior?.Password ?? "", c.Enabled, c.DisplayRangeM));
        }
        next["CCTV_CONNECTIONS_JSON"] = connections.Count == 0 ? "" : JsonSerializer.Serialize(new AutoCameraDocument(1, connections.ToArray()), AutomaticMonitoring.Json);
        var a = edit.Accounts;
        next["CCTV_MONITOR_USER"] = a.AdminUser;
        if (!string.IsNullOrEmpty(a.AdminPassword)) next["CCTV_MONITOR_PASSWORD_HASH"] = MonitoringServerSecurity.HashPassword(a.AdminPassword);
        next["CCTV_VIEWER_USER"] = a.ViewerEnabled ? a.ViewerUser : "";
        next["CCTV_VIEWER_PASSWORD_HASH"] = !a.ViewerEnabled ? "" : !string.IsNullOrEmpty(a.ViewerPassword) ? MonitoringServerSecurity.HashPassword(a.ViewerPassword) : old.GetValueOrDefault("CCTV_VIEWER_PASSWORD_HASH", "");
        if (edit.Mail is { } m)
        {
            var prior = Mail(old);
            if (!m.Enabled && prior is null && string.IsNullOrWhiteSpace(m.UserName)) next["CCTV_MAIL_SETTINGS_JSON"] = "";
            else next["CCTV_MAIL_SETTINGS_JSON"] = JsonSerializer.Serialize(FirewatcherMailSettings.Validate(new(m.Enabled, m.UserName,
                string.IsNullOrEmpty(m.AppPassword) ? prior?.AppPassword ?? "" : m.AppPassword, m.AllowedFrom, m.AlertOrigin, m.ReadFromUtc)));
        }
        if (edit.VworldApiKey.Length > 0) next["VWORLD_API_KEY"] = edit.VworldApiKey.Trim();
        Validate(next); return next;
    }
    public static void Validate(Dictionary<string, string> values)
    {
        if (values.Keys.Any(k => !MonitoringServerSetup.Keys.Contains(k)) || values.Any(kv => kv.Value is null) || values.GetValueOrDefault("MONITOR_SERVER_MODE") != "true") throw new ArgumentException();
        MonitoringServerSecurity.ValidateAccounts(new ConfigurationBuilder().AddInMemoryCollection(values!).Build());
        if (!string.IsNullOrWhiteSpace(values.GetValueOrDefault("CCTV_CONNECTIONS_JSON"))) AutomaticMonitoring.Parse(values["CCTV_CONNECTIONS_JSON"]);
        var map = JsonSerializer.Deserialize<MapDocument>(values["CCTV_MAP_CONFIGURATION_JSON"], FileCameraInventorySource.Json) ?? throw new JsonException();
        MapConfiguration.Validate(map); Mail(values);
    }
    public async Task<object> SaveAsync(SettingsEdit edit, CancellationToken ct)
    {
        if (!OperatingSystem.IsWindows()) throw new InventoryException(503, "이 배포의 웹 설정 저장은 Windows 수신 PC에서 지원합니다.");
        await gate.WaitAsync(ct);
        try
        {
            var old = WithMail(); var map = await maps.ReadAsync(ct);
            if (Revision(old, map.Revision) != edit.Revision) throw new InventoryException(409, "다른 관리자가 설정을 바꿨습니다. 다시 불러온 뒤 저장하세요.");
            var next = Merge(old, edit, map.Configuration);
            var requiresLogin = new[] { "CCTV_MONITOR_USER", "CCTV_MONITOR_PASSWORD_HASH", "CCTV_VIEWER_USER", "CCTV_VIEWER_PASSWORD_HASH" }.Any(k => old[k] != next[k]);
            await MonitoringServerSetup.SaveProtectedSettingsAsync(next);
            foreach (var kv in next) config[kv.Key] = kv.Value;
            return new { saved = true, requiresLogin, reloadMap = old["VWORLD_API_KEY"] != next["VWORLD_API_KEY"] };
        }
        finally { gate.Release(); }
    }
    public async Task<byte[]> BackupAsync(string passphrase, CancellationToken ct)
    {
        await gate.WaitAsync(ct);
        try
        {
            var values = WithMail(); var map = await maps.ReadAsync(ct);
            values["CCTV_MAP_CONFIGURATION_JSON"] = JsonSerializer.Serialize(map.Configuration, FileCameraInventorySource.Json);
            Validate(values); return SettingsBackup.Encrypt(values, passphrase);
        }
        finally { gate.Release(); }
    }
    public static async Task<int> RestoreCliAsync()
    {
        if (!OperatingSystem.IsWindows() || Console.IsInputRedirected) return 1;
        try
        {
            // Restore only while the receiver is stopped; launcher verifies this before invoking us.
            var path = MonitoringServerSetup.Read("암호화 백업 파일 경로").Trim('"');
            if (new FileInfo(path).Length > SettingsBackup.MaxBytes) throw new ArgumentException();
            var password = MonitoringServerSetup.Read("백업 암호 (입력 숨김)", "", true);
            var values = SettingsBackup.Decrypt(await File.ReadAllBytesAsync(path), password); Validate(values);
            var mapPath = Path.Combine(MonitoringPaths.DataDirectory, "map.demo.json");
            Directory.CreateDirectory(MonitoringPaths.DataDirectory);
            var oldMap = File.Exists(mapPath) ? await File.ReadAllBytesAsync(mapPath) : null;
            var temp = mapPath + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try
            {
                await File.WriteAllTextAsync(temp, values["CCTV_MAP_CONFIGURATION_JSON"]);
                File.Move(temp, mapPath, true);
                try { await MonitoringServerSetup.SaveProtectedSettingsAsync(values); }
                catch { if (oldMap is null) File.Delete(mapPath); else await File.WriteAllBytesAsync(mapPath, oldMap); throw; }
            }
            finally { if (File.Exists(temp)) File.Delete(temp); }
            Console.WriteLine("설정 복원 완료. 백업에 저장된 로그인 계정을 사용하세요. 수신기를 다시 시작하세요."); return 0;
        }
        catch { Console.Error.WriteLine("복원 실패. 백업 파일·암호·쓰기 권한을 확인하세요. 비밀번호는 채팅에 보내지 마세요."); return 1; }
    }
}

public static class SettingsBackup
{
    public const int MaxBytes = 2 * 1024 * 1024;
    private static readonly byte[] Header = Encoding.ASCII.GetBytes("FIREMON-BACKUP-1\n");
    private static byte[] Key(string passphrase, byte[] salt)
    {
        if (passphrase is null || passphrase.Length is < 16 or > 512) throw new ArgumentException();
        return Rfc2898DeriveBytes.Pbkdf2(passphrase, salt, 600000, HashAlgorithmName.SHA256, 32);
    }
    public static byte[] Encrypt(Dictionary<string, string> values, string passphrase)
    {
        var plain = JsonSerializer.SerializeToUtf8Bytes(values); if (plain.Length > MaxBytes - 60) throw new ArgumentException();
        var salt = RandomNumberGenerator.GetBytes(16); var nonce = RandomNumberGenerator.GetBytes(12); var key = Key(passphrase, salt);
        try
        {
            var cipher = new byte[plain.Length]; var tag = new byte[16];
            using var aes = new AesGcm(key, 16); aes.Encrypt(nonce, plain, cipher, tag, Header);
            return Header.Concat(salt).Concat(nonce).Concat(tag).Concat(cipher).ToArray();
        }
        finally { CryptographicOperations.ZeroMemory(key); CryptographicOperations.ZeroMemory(plain); }
    }
    public static Dictionary<string, string> Decrypt(byte[] bytes, string passphrase)
    {
        if (bytes.Length < Header.Length + 44 || bytes.Length > MaxBytes || !bytes.AsSpan(0, Header.Length).SequenceEqual(Header)) throw new ArgumentException();
        var i = Header.Length; var key = Key(passphrase, bytes.AsSpan(i, 16).ToArray()); var plain = new byte[bytes.Length - i - 44];
        try
        {
            using var aes = new AesGcm(key, 16); aes.Decrypt(bytes.AsSpan(i + 16, 12), bytes.AsSpan(i + 44), bytes.AsSpan(i + 28, 16), plain, Header);
            return JsonSerializer.Deserialize<Dictionary<string, string>>(plain) ?? throw new JsonException();
        }
        finally { CryptographicOperations.ZeroMemory(key); CryptographicOperations.ZeroMemory(plain); }
    }
}

public static class UnifiedSettingsEndpoints
{
    public static void MapUnifiedSettings(this WebApplication app)
    {
        app.MapGet("/api/admin/settings", async (UnifiedSettings settings, IConfiguration config, CancellationToken ct) =>
            !MonitoringServerSecurity.Enabled(config) ? Results.NotFound() : await Handle(async () => Results.Ok(await settings.ReadAsync(ct))));
        app.MapPut("/api/admin/settings", async (HttpContext context, UnifiedSettings settings, IConfiguration config, CancellationToken ct) =>
            !MonitoringServerSecurity.Enabled(config) ? Results.NotFound() : await Handle(async () => {
                var edit = await JsonSerializer.DeserializeAsync<SettingsEdit>(context.Request.Body, Json, ct) ?? throw new JsonException();
                return Results.Ok(await settings.SaveAsync(edit, ct));
            })).WithMetadata(new Microsoft.AspNetCore.Mvc.RequestSizeLimitAttribute(128 * 1024));
        app.MapPost("/api/admin/settings/backup", async (BackupRequest request, UnifiedSettings settings, IConfiguration config, CancellationToken ct) =>
            !MonitoringServerSecurity.Enabled(config) ? Results.NotFound() : await Handle(async () =>
                Results.File(await settings.BackupAsync(request.Passphrase, ct), "application/octet-stream", "fire-monitor-settings.backup")));
    }
    private static JsonSerializerOptions Json => UnifiedSettings.Json;
    private static async Task<IResult> Handle(Func<Task<IResult>> action)
    {
        try { return await action(); }
        catch (InventoryException e) { return Results.Problem(e.Message, statusCode: e.StatusCode); }
        catch (Exception e) when (e is ArgumentException or JsonException or CryptographicException or IOException or InvalidOperationException or UnauthorizedAccessException)
        { return Results.Problem("설정을 처리하지 못했습니다. 입력값·저장 권한을 확인하세요. 기존 비밀번호는 빈칸으로 유지할 수 있습니다.", statusCode: 422); }
    }
}
