using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using MailKit;
using MailKit.Search;

namespace WisenetPtzBridge.Services;

public sealed record MailCameraBinding(string CameraId, double Lat, double Lon);
public sealed record ForwardedMailAlert(string Id, string Link, DateTimeOffset? MailSentAt,
    DateTimeOffset? MailReceivedAt, DateTimeOffset FirstSeenAt, MailCameraBinding? Binding);
public sealed record MailAlertState(int Version, string Owner, uint UidValidity, uint LastUid, ForwardedMailAlert[] Events);

// Opaque links are access-bearing data. Persist only encrypted state; never raw SMS/email bodies.
public sealed class MailAlertStore(string path, Func<byte[], bool, byte[]> crypt)
{
    private readonly SemaphoreSlim gate = new(1, 1);
    public async Task<MailAlertState> ReadAsync(string owner, CancellationToken ct = default)
    {
        await gate.WaitAsync(ct);
        try { return Read(owner); }
        finally { gate.Release(); }
    }
    private MailAlertState Read(string owner)
    {
        if (!File.Exists(path)) return new(1, owner, 0, 0, []);
        if (new FileInfo(path).Length > 4 * 1024 * 1024) throw new InvalidDataException();
        var state = JsonSerializer.Deserialize<MailAlertState>(crypt(File.ReadAllBytes(path), false)) ?? throw new InvalidDataException();
        if (state.Version != 1 || state.Events is null || state.Events.Length > 1000) throw new InvalidDataException();
        return state.Owner == owner ? state : new(1, owner, 0, 0, []);
    }
    private async Task WriteAsync(MailAlertState state, CancellationToken ct)
    {
        var bytes = crypt(JsonSerializer.SerializeToUtf8Bytes(state), true);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var temp = path + ".tmp";
        try { await File.WriteAllBytesAsync(temp, bytes, ct); File.Move(temp, path, true); }
        finally { if (File.Exists(temp)) File.Delete(temp); }
    }
    public async Task CommitAsync(string owner, uint validity, uint uid, IEnumerable<ForwardedMailAlert> incoming, CancellationToken ct = default)
    {
        await gate.WaitAsync(ct);
        try
        {
            var current = Read(owner);
            var events = current.Events.Concat(incoming).DistinctBy(e => e.Id).OrderByDescending(e => e.FirstSeenAt).Take(1000).ToArray();
            await WriteAsync(new(1, owner, validity, current.UidValidity == validity ? Math.Max(current.LastUid, uid) : uid, events), ct);
        }
        finally { gate.Release(); }
    }
    public async Task<bool> BindAsync(string owner, string eventId, MailCameraBinding? binding, CancellationToken ct)
    {
        await gate.WaitAsync(ct);
        try
        {
            var state = Read(owner);
            if (!state.Events.Any(e => e.Id == eventId)) return false;
            await WriteAsync(state with { Events = state.Events.Select(e => e.Id == eventId ? e with { Binding = binding } : e).ToArray() }, ct);
            return true;
        }
        finally { gate.Release(); }
    }
    public static string LinkId(string link) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(link))).ToLowerInvariant();
}

public sealed class FirewatcherMailReceiver : BackgroundService
{
    private readonly bool enabledServer;
    private readonly MailAlertStore store;
    private FirewatcherMailSettings? settings;
    private string status = "not-configured";
    private DateTimeOffset? checkedAt;
    private int skipped;
    public FirewatcherMailReceiver(IConfiguration config)
    {
        enabledServer = MonitoringServerSecurity.Enabled(config);
        store = new(Path.Combine(config["CCTV_DATA_DIR"] ?? Path.Combine(AppContext.BaseDirectory, "data"), "firewatcher-mail-state.protected"), MonitoringServerSetup.Protect);
        if (!enabledServer) return;
        if (!OperatingSystem.IsWindows()) { status = "windows-only"; return; }
        try { settings = FirewatcherMailSettings.Load(); status = settings?.Enabled == true ? "waiting" : settings is null ? "not-configured" : "disabled"; }
        catch { status = "settings-error"; }
    }
    public async Task<object> StatusAsync(CancellationToken ct)
    {
        var events = Array.Empty<ForwardedMailAlert>();
        if (settings?.Enabled == true)
        {
            try { events = (await store.ReadAsync(settings.Identity, ct)).Events.Where(e => FirewatcherMailParser.IsAllowedLink(e.Link, settings.AlertOrigin)).ToArray(); }
            catch (Exception e) when (e is not OperationCanceledException) { status = "storage-error"; }
        }
        return new { configured = settings is not null, enabled = settings?.Enabled == true, status, checkedAt, pollSeconds = 30,
            skippedMessages = skipped, retainedLimit = 1000, source = "iphone-mail-forward", events };
    }
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!enabledServer || settings?.Enabled != true) return;
        while (!stoppingToken.IsCancellationRequested)
        {
            try { await PollAsync(settings, stoppingToken); status = "connected"; checkedAt = DateTimeOffset.UtcNow; }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (MailKit.Security.AuthenticationException) { status = "authentication-error"; }
            catch (Exception) { status = "connection-or-storage-error"; } // Never log exceptions containing credentials, MIME or links.
            try { await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken); }
            catch (OperationCanceledException) { break; }
        }
    }
    private async Task PollAsync(FirewatcherMailSettings s, CancellationToken stoppingToken)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
        deadline.CancelAfter(TimeSpan.FromSeconds(60)); var ct = deadline.Token;
        using var client = await FirewatcherMailSettings.ConnectAsync(s, ct);
        var inbox = client.Inbox; await inbox.OpenAsync(FolderAccess.ReadOnly, ct);
        Interlocked.Add(ref skipped, await CollectInboxAsync(inbox, s, store, ct));
        await client.DisconnectAsync(true, ct);
    }
    public static async Task<int> CollectInboxAsync(IMailFolder inbox, FirewatcherMailSettings s, MailAlertStore store, CancellationToken ct)
    {
        var skippedCount = 0;
        var current = await store.ReadAsync(s.Identity, ct);
        var after = current.UidValidity == inbox.UidValidity ? current.LastUid : 0;
        var query = SearchQuery.FromContains(s.AllowedFrom).And(SearchQuery.SubjectContains("[FIREWATCHER]"))
            .And(SearchQuery.DeliveredAfter(s.ReadFromUtc.UtcDateTime.Date));
        if (after == uint.MaxValue) return 0;
        if (after > 0) query = query.And(SearchQuery.Uids(new UniqueIdRange(new UniqueId(after + 1), UniqueId.MaxValue)));
        var ids = (await inbox.SearchAsync(query, ct)).OrderBy(id => id.Id).Take(50).ToArray();
        foreach (var uid in ids)
        {
            // Fetch sizes/headers first, then only bounded matching messages. BODY.PEEK leaves mail unread.
            var summary = (await inbox.FetchAsync([uid], MessageSummaryItems.Size | MessageSummaryItems.InternalDate | MessageSummaryItems.Envelope, ct)).FirstOrDefault();
            var incoming = new List<ForwardedMailAlert>();
            if (summary is not null && summary.Size <= 512 * 1024 && summary.InternalDate >= s.ReadFromUtc &&
                summary.Envelope?.From.Mailboxes.Count() == 1 && string.Equals(summary.Envelope.From.Mailboxes.Single().Address, s.AllowedFrom, StringComparison.OrdinalIgnoreCase) &&
                summary.Envelope.Subject?.StartsWith("[FIREWATCHER]", StringComparison.Ordinal) == true)
            {
                var message = await inbox.GetMessageAsync(uid, ct);
                foreach (var link in FirewatcherMailParser.Links(message, s))
                    incoming.Add(new(MailAlertStore.LinkId(link), link, message.Date == DateTimeOffset.MinValue ? null : message.Date,
                        summary.InternalDate, DateTimeOffset.UtcNow, null));
            }
            if (incoming.Count == 0) skippedCount++;
            // Persist events and cursor in one atomic write. A failed body read/write never advances the cursor.
            await store.CommitAsync(s.Identity, inbox.UidValidity, uid.Id, incoming, ct);
        }
        return skippedCount;
    }
    public async Task<IResult> SaveBindingAsync(MailAlertBindingRequest request, MapConfiguration maps, CancellationToken ct)
    {
        if (settings?.Enabled != true) return Results.Conflict(new { error = "메일 수신 설정을 먼저 연결하세요." });
        if (request.EventId is null || request.EventId.Length != 64 || request.ConfirmCamera != true)
            return Results.BadRequest(new { error = "알림 페이지에서 같은 카메라인지 확인한 뒤 연결하세요." });
        MailCameraBinding? binding = null;
        if (request.CameraId is not null)
        {
            var map = await maps.ReadAsync(ct);
            var camera = map.Configuration.Positions.FirstOrDefault(p => p.Id == request.CameraId);
            if (camera is null) return Results.BadRequest(new { error = "지도 카메라를 확인하세요." });
            binding = new(camera.Id, camera.Lat, camera.Lon);
        }
        return await store.BindAsync(settings.Identity, request.EventId, binding, ct) ? Results.Ok(new { ok = true }) : Results.NotFound();
    }
}
public sealed record MailAlertBindingRequest(string EventId, string? CameraId, bool ConfirmCamera);
