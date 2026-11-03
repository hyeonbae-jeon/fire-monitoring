using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using MailKit.Net.Imap;
using MailKit.Security;
using MimeKit;
using System.Net;

namespace WisenetPtzBridge.Services;

// This is our private mailbox configuration, not a FIREWATCHER API contract.
public sealed record FirewatcherMailSettings(bool Enabled, string UserName, string AppPassword,
    string AllowedFrom, string AlertOrigin, DateTimeOffset ReadFromUtc)
{
    public string Identity => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(
        UserName + "\n" + AllowedFrom + "\n" + AlertOrigin + "\n" + ReadFromUtc.ToUniversalTime().ToString("O"))));
    public static FirewatcherMailSettings Validate(FirewatcherMailSettings value)
    {
        if (!Regex.IsMatch(value.UserName ?? "", @"\A[a-zA-Z0-9_.-]{1,100}\z") ||
            string.IsNullOrWhiteSpace(value.AppPassword) || value.AppPassword.Length > 512 || value.AppPassword.Any(char.IsControl) ||
            !MailboxAddress.TryParse(value.AllowedFrom, out var sender) || sender.Address != value.AllowedFrom ||
            !Uri.TryCreate(value.AlertOrigin, UriKind.Absolute, out var origin) || origin.Scheme is not ("http" or "https") ||
            origin.UserInfo.Length > 0 || origin.AbsolutePath != "/" || origin.Query.Length > 0 || origin.Fragment.Length > 0 ||
            value.ReadFromUtc > DateTimeOffset.UtcNow.AddMinutes(5) || value.ReadFromUtc < DateTimeOffset.UnixEpoch)
            throw new ArgumentException("네이버 아이디·앱 비밀번호·전달 발신 메일·알림 서버 주소·조회 시작일을 확인하세요.");
        return value with { UserName = value.UserName!.ToLowerInvariant(), AllowedFrom = sender.Address.ToLowerInvariant(),
            AlertOrigin = origin.GetLeftPart(UriPartial.Authority), ReadFromUtc = value.ReadFromUtc.ToUniversalTime() };
    }
    public static string SettingsPath => Path.Combine(AppContext.BaseDirectory, "data", "firewatcher-mail-settings.protected");
    public static FirewatcherMailSettings? Load()
    {
        if (!File.Exists(SettingsPath)) return null;
        return Validate(JsonSerializer.Deserialize<FirewatcherMailSettings>(MonitoringServerSetup.Protect(File.ReadAllBytes(SettingsPath), false)) ?? throw new JsonException());
    }
    public static async Task SaveAsync(FirewatcherMailSettings settings)
    {
        Validate(settings);
        var bytes = MonitoringServerSetup.Protect(JsonSerializer.SerializeToUtf8Bytes(settings), true);
        Directory.CreateDirectory(Path.GetDirectoryName(SettingsPath)!);
        var temp = SettingsPath + ".tmp";
        try { await File.WriteAllBytesAsync(temp, bytes); File.Move(temp, SettingsPath, true); }
        finally { if (File.Exists(temp)) File.Delete(temp); }
    }
    public static async Task<ImapClient> ConnectAsync(FirewatcherMailSettings settings, CancellationToken ct)
    {
        var client = new ImapClient { Timeout = 20000 };
        try
        {
            // Always validate the server certificate; never fall back to plaintext or POP.
            await client.ConnectAsync("imap.naver.com", 993, SecureSocketOptions.SslOnConnect, ct);
            client.AuthenticationMechanisms.Remove("XOAUTH2");
            await client.AuthenticateAsync(settings.UserName, settings.AppPassword, ct);
            return client;
        }
        catch { client.Dispose(); throw; }
    }
    public static async Task<int> ConfigureAsync()
    {
        if (!OperatingSystem.IsWindows() || Console.IsInputRedirected)
        { Console.Error.WriteLine("Windows에서 메일수신설정.cmd를 실행하세요."); return 1; }
        try
        {
            var old = Load();
            Console.WriteLine("카메라 설정은 변경하지 않습니다. 네이버 IMAP 받은편지함을 읽기 전용으로 조회합니다.");
            var enabled = MonitoringServerSetup.Read("FIREWATCHER 메일 수신 사용 (y / n)", old?.Enabled == false ? "n" : "y");
            if (enabled is not ("y" or "n")) throw new ArgumentException();
            if (enabled == "n")
            {
                if (old is not null) await SaveAsync(old with { Enabled = false });
                Console.WriteLine("메일 수신을 중지했습니다. 프로그램을 다시 실행하세요."); return 0;
            }
            var user = MonitoringServerSetup.Read("네이버 아이디 (@naver.com 제외)", old?.UserName ?? "");
            var password = MonitoringServerSetup.Read("네이버 애플리케이션 비밀번호 (입력 숨김)", old?.AppPassword ?? "", true);
            var sender = MonitoringServerSetup.Read("아이폰 Mail에서 보내는 메일 주소", old?.AllowedFrom ?? user + "@naver.com");
            var raw = MonitoringServerSetup.Read("FIREWATCHER 문자 링크 또는 알림 서버 주소", old?.AlertOrigin ?? "", true);
            var uri = new Uri(raw);
            if (uri.UserInfo.Length > 0 || uri.Scheme is not ("http" or "https")) throw new ArgumentException();
            var daysText = MonitoringServerSetup.Read("최초 조회 기간 (최근 1~30일, keep: 기존 시작일 유지)", old is null ? "7" : "keep");
            var start = old?.ReadFromUtc ?? DateTimeOffset.UtcNow.AddDays(-7);
            if (daysText != "keep")
            {
                if (!int.TryParse(daysText, out var days) || days is < 1 or > 30) throw new ArgumentException();
                start = DateTimeOffset.UtcNow.AddDays(-days);
            }
            var settings = Validate(new(true, user, password, sender, uri.GetLeftPart(UriPartial.Authority), start));
            Console.WriteLine("네이버 IMAP 연결 확인 중… (메일 발송·읽음 변경·삭제 없음)");
            using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(30));
            using var client = await ConnectAsync(settings, deadline.Token);
            await client.Inbox.OpenAsync(MailKit.FolderAccess.ReadOnly, deadline.Token);
            await client.DisconnectAsync(true, deadline.Token);
            await SaveAsync(settings);
            Console.WriteLine("메일 연결 설정 저장 완료. 프로그램을 다시 실행한 뒤 AI 감지 알림에서 수신 상태를 확인하세요.");
            Console.WriteLine("메일 설정은 이 Windows 계정에서만 복호화됩니다. GitHub시크릿등록.cmd에는 포함하지 않습니다.");
            return 0;
        }
        catch (MailKit.Security.AuthenticationException)
        { Console.Error.WriteLine("네이버 인증 실패. IMAP 사용함과 애플리케이션 비밀번호를 확인하세요. 기존 설정은 유지했습니다."); return 1; }
        catch (Exception e) when (e is not OutOfMemoryException)
        { Console.Error.WriteLine("메일 설정 또는 TLS 연결을 확인하세요. 기존 설정은 유지했습니다. 비밀번호·원본 링크는 채팅에 보내지 마세요."); return 1; }
    }
}

public static partial class FirewatcherMailParser
{
    [GeneratedRegex("https?://[^\\s<>\\\"']+", RegexOptions.IgnoreCase)]
    private static partial Regex Urls();
    [GeneratedRegex(@"\A/sms/[A-Za-z0-9_-]{1,200}/[A-Za-z0-9_-]{1,200}\z")]
    private static partial Regex EventPath();
    public static bool IsAllowedLink(string link, string origin) =>
        Uri.TryCreate(link, UriKind.Absolute, out var uri) && uri.Scheme is "http" or "https" &&
        uri.UserInfo.Length == 0 && uri.Query.Length == 0 && uri.Fragment.Length == 0 &&
        string.Equals(uri.GetLeftPart(UriPartial.Authority), origin, StringComparison.OrdinalIgnoreCase) &&
        EventPath().IsMatch(uri.AbsolutePath) && !link.Contains('%') && !link.Contains('\\');
    public static string[] Links(MimeMessage message, FirewatcherMailSettings settings)
    {
        if (message.From.Mailboxes.Count() != 1 || !string.Equals(message.From.Mailboxes.Single().Address, settings.AllowedFrom, StringComparison.OrdinalIgnoreCase) ||
            message.Sender is not null && !string.Equals(message.Sender.Address, settings.AllowedFrom, StringComparison.OrdinalIgnoreCase) ||
            !(message.Subject ?? "").StartsWith("[FIREWATCHER]", StringComparison.Ordinal)) return [];
        var text = message.TextBody;
        if (text is null && message.HtmlBody is { Length: < 200000 } html) text = WebUtility.HtmlDecode(html);
        if (text is null || text.Length > 100000) return [];
        return Urls().Matches(text).Select(m => m.Value.TrimEnd('.', ',', ')', ']', '}', ';'))
            .Where(link => IsAllowedLink(link, settings.AlertOrigin)).Select(link => new Uri(link).AbsoluteUri).Distinct(StringComparer.Ordinal).Take(20).ToArray();
    }
}
