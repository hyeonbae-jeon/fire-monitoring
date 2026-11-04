using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using System.Globalization;
using System.Security.Cryptography;
using MailKit;
using MailKit.Net.Imap;
using MailKit.Security;
using MimeKit;
using WisenetPtzBridge.Services;

void Check(bool ok, string reason) { if (!ok) throw new Exception(reason); }
var settings = FirewatcherMailSettings.Validate(new(true, "synthetic", "synthetic-app-password", "synthetic@naver.com", "https://alert.example", DateTimeOffset.UtcNow.AddDays(-7)));
const string link = "https://alert.example/sms/synthetic-event/synthetic-recipient";
MimeMessage Message(string body, bool html = false) => new() { From = { new MailboxAddress("Synthetic", settings.AllowedFrom) }, To = { new MailboxAddress("Synthetic", settings.AllowedFrom) }, Subject = "[FIREWATCHER]", Date = DateTimeOffset.UtcNow, Body = new TextPart(html ? "html" : "plain") { Text = body, ContentTransferEncoding = ContentEncoding.QuotedPrintable } };
var message = Message("[Web발신] 합성 연기 발생\r\n" + link + "\r\n" + link);
using (var stream = new MemoryStream())
{
    await message.WriteToAsync(stream); stream.Position = 0;
    Check(FirewatcherMailParser.Links(await MimeMessage.LoadAsync(stream), settings).SequenceEqual([link]), "MIME decoding or link deduplication failed.");
}
Check(FirewatcherMailParser.Links(Message("<html><a href=\"" + link + "\">알림 확인</a></html>", true), settings).SequenceEqual([link]), "HTML-only mail link extraction failed.");
foreach (var forbidden in new[] {"https://other.example/sms/a/b", "http://alert.example/sms/a/b", "https://alert.example:444/sms/a/b", "https://user@alert.example/sms/a/b", "https://alert.example/sms/a/b?clear=1", "https://alert.example/sms/a/b#x", "https://alert.example/admin/clear", "https://alert.example/sms/a/%62", "javascript:alert(1)"})
    Check(!FirewatcherMailParser.IsAllowedLink(forbidden, settings.AlertOrigin), "Unsafe link accepted.");
var wrong = Message(link); wrong.From.Clear(); wrong.From.Add(MailboxAddress.Parse("other@example.com"));
Check(FirewatcherMailParser.Links(wrong, settings).Length == 0, "Unrelated sender accepted.");
wrong = Message(link); wrong.Subject = "Ordinary private mail";
Check(FirewatcherMailParser.Links(wrong, settings).Length == 0, "Unrelated mail accepted.");
wrong = Message(link); wrong.From.Add(MailboxAddress.Parse("other@example.com"));
Check(FirewatcherMailParser.Links(wrong, settings).Length == 0, "Ambiguous sender accepted.");
Check(FirewatcherMailParser.Links(Message(new string('x', 100001) + link), settings).Length == 0, "Oversized body accepted.");

var directory = Path.Combine(Path.GetTempPath(), "mail-check-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(directory);
using var encryption = Aes.Create(); encryption.GenerateKey();
// Use authenticated test encryption off Windows, production DPAPI on Windows.
byte[] Crypt(byte[] value, bool encrypt)
{
    if (OperatingSystem.IsWindows()) return MonitoringServerSetup.Protect(value, encrypt);
    using var aes = new AesGcm(encryption.Key, 16);
    if (encrypt)
    {
        var nonce = RandomNumberGenerator.GetBytes(12); var tag = new byte[16]; var cipher = new byte[value.Length];
        aes.Encrypt(nonce, value, cipher, tag); return nonce.Concat(tag).Concat(cipher).ToArray();
    }
    var plain = new byte[value.Length - 28]; aes.Decrypt(value[..12], value[28..], value[12..28], plain); return plain;
}
try
{
    var path = Path.Combine(directory, "state.protected"); var store = new MailAlertStore(path, Crypt);
    var entry = new ForwardedMailAlert(MailAlertStore.LinkId(link), link, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow, null);
    await store.CommitAsync(settings.Identity, 1, 10, [entry]);
    Check(!Encoding.UTF8.GetString(File.ReadAllBytes(path)).Contains("synthetic-recipient"), "Link persisted without encryption.");
    await store.BindAsync(settings.Identity, entry.Id, new("synthetic-camera", 37, 127), default);
    var restarted = new MailAlertStore(path, Crypt);
    await restarted.CommitAsync(settings.Identity, 1, 11, [entry]);
    var state = await restarted.ReadAsync(settings.Identity);
    Check(state.LastUid == 11 && state.Events.Length == 1 && state.Events[0].Binding?.CameraId == "synthetic-camera", "Restart/deduplication lost binding or cursor.");
    await restarted.CommitAsync(settings.Identity, 2, 1, [entry]);
    state = await restarted.ReadAsync(settings.Identity);
    Check(state.UidValidity == 2 && state.LastUid == 1 && state.Events.Length == 1, "UIDVALIDITY reset lost event or used old cursor.");
    Check((await store.ReadAsync("different-account")).Events.Length == 0, "Mailbox identity crossed accounts.");
    Check(!await store.BindAsync(settings.Identity, new string('0',64), null, default), "Missing event binding accepted.");
    var before = File.ReadAllBytes(path); using var cancelled = new CancellationTokenSource(); cancelled.Cancel();
    try { await store.CommitAsync(settings.Identity, 2, 3, [], cancelled.Token); throw new Exception("Cancelled write advanced cursor."); }
    catch (OperationCanceledException) { }
    Check(before.SequenceEqual(File.ReadAllBytes(path)), "Cancelled transaction modified state.");
    File.WriteAllBytes(path, [1,2,3]);
    try { await store.ReadAsync(settings.Identity); throw new Exception("Corrupt state silently ignored."); }
    catch (Exception ex) when (ex is CryptographicException or ArgumentException or OverflowException) { }

    // Exercise the actual MailKit command path against a synthetic local IMAP server.
    var imapPath = Path.Combine(directory, "imap.protected"); var imapStore = new MailAlertStore(imapPath, Crypt);
    using var listener = new TcpListener(IPAddress.Loopback, 0); listener.Start();
    var commands = new List<string>(); var failures = new List<string>();
    var raw = new MemoryStream(); await message.WriteToAsync(raw); var bytes = raw.ToArray();
    var internalDate = DateTimeOffset.UtcNow.ToString("dd-MMM-yyyy HH:mm:ss +0000", CultureInfo.InvariantCulture);
    var envelope = "(\"" + DateTimeOffset.UtcNow.ToString("r", CultureInfo.InvariantCulture) + "\" \"[FIREWATCHER]\" ((NIL NIL \"synthetic\" \"naver.com\")) NIL NIL ((NIL NIL \"synthetic\" \"naver.com\")) NIL NIL NIL \"<synthetic@example.com>\")";
    var searches = 0;
    var server = Task.Run(async () =>
    {
        using var socket = await listener.AcceptTcpClientAsync(); using var network = socket.GetStream();
        using var reader = new StreamReader(network, Encoding.ASCII, false, 4096, leaveOpen: true);
        async Task Send(string value) { await network.WriteAsync(Encoding.ASCII.GetBytes(value)); await network.FlushAsync(); }
        await Send("* OK [CAPABILITY IMAP4rev1] synthetic ready\r\n");
        while (await reader.ReadLineAsync() is { } command)
        {
            commands.Add(command); var split = command.IndexOf(' '); var tag = command[..split]; var cmd = command[(split+1)..];
            if (cmd.StartsWith("CAPABILITY")) await Send("* CAPABILITY IMAP4rev1\r\n" + tag + " OK capability\r\n");
            else if (cmd.StartsWith("LOGIN")) await Send(tag + " OK login\r\n");
            else if (cmd.StartsWith("LIST")) await Send("* LIST () \"/\" \"INBOX\"\r\n" + tag + " OK list\r\n");
            else if (cmd.StartsWith("EXAMINE")) await Send("* FLAGS (\\Seen)\r\n* 2 EXISTS\r\n* 0 RECENT\r\n* OK [UIDVALIDITY 7] stable\r\n* OK [UIDNEXT 3] next\r\n" + tag + " OK [READ-ONLY] opened\r\n");
            else if (cmd.StartsWith("UID SEARCH"))
            {
                searches++;
                await Send("* SEARCH" + (searches == 1 ? " 1 2" : searches is 2 or 3 ? " 3" : "") + "\r\n" + tag + " OK search\r\n");
            }
            else if (cmd.StartsWith("UID FETCH"))
            {
                var uid = cmd.Split(' ')[2];
                if (cmd.Contains("BODY.PEEK[]"))
                {
                    if (uid == "3" && searches == 2) { await Send(tag + " NO synthetic body read failure\r\n"); continue; }
                    await Send("* " + uid + " FETCH (UID " + uid + " BODY[] {" + bytes.Length + "}\r\n");
                    await network.WriteAsync(bytes); await Send(")\r\n" + tag + " OK body\r\n");
                }
                else await Send("* " + uid + " FETCH (UID " + uid + " RFC822.SIZE " + bytes.Length + " INTERNALDATE \"" + internalDate + "\" ENVELOPE " + envelope + ")\r\n" + tag + " OK summary\r\n");
            }
            else if (cmd == "LOGOUT") { await Send("* BYE\r\n" + tag + " OK logout\r\n"); break; }
            else { failures.Add(cmd.Split(' ')[0]); await Send(tag + " BAD unexpected\r\n"); }
        }
    });
    using var client = new ImapClient();
    // Plaintext exists only on the synthetic loopback in this test. Production is fixed TLS993.
    using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(15));
    await client.ConnectAsync("127.0.0.1", ((IPEndPoint)listener.LocalEndpoint).Port, SecureSocketOptions.None, timeout.Token);
    await client.AuthenticateAsync("synthetic", "synthetic-test-only", timeout.Token);
    await client.Inbox.OpenAsync(FolderAccess.ReadOnly, timeout.Token);
    await FirewatcherMailReceiver.CollectInboxAsync(client.Inbox, settings, imapStore, timeout.Token);
    Check((await imapStore.ReadAsync(settings.Identity)).LastUid == 2, "Initial IMAP cursor missing.");
    try
    {
        await FirewatcherMailReceiver.CollectInboxAsync(client.Inbox, settings, imapStore, timeout.Token);
        throw new Exception("Failed IMAP body read was accepted.");
    }
    catch (ImapCommandException) { }
    Check((await imapStore.ReadAsync(settings.Identity)).LastUid == 2, "Failed body read advanced the durable cursor.");
    await FirewatcherMailReceiver.CollectInboxAsync(client.Inbox, settings, imapStore, timeout.Token);
    await FirewatcherMailReceiver.CollectInboxAsync(client.Inbox, settings, imapStore, timeout.Token);
    await client.DisconnectAsync(true, timeout.Token); await server.WaitAsync(timeout.Token);
    state = await imapStore.ReadAsync(settings.Identity);
    Check(state.UidValidity == 7 && state.LastUid == 3 && state.Events.Length == 1, "IMAP collection or duplicate collapse failed.");
    Check(failures.Count == 0 && commands.Any(c=>c.Contains("EXAMINE")) && commands.Count(c=>c.Contains("BODY.PEEK[]")) == 4 && commands.Any(c=>c.Contains("UID 3:*")) && commands.Any(c=>c.Contains("UID 4:*")) &&
        !commands.Any(c=>c.Contains(" STORE ") || c.Contains("EXPUNGE") || c.Contains(" SELECT ")), "Mailbox must remain read-only and use BODY.PEEK.");
    Console.WriteLine("Mail MIME/filter, encrypted restart/deduplication/binding, cancellation/tamper and actual read-only IMAP command checks passed.");
}
finally { Directory.Delete(directory, true); }

await EventPageChecks.RunAsync(args.FirstOrDefault());
