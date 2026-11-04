using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using MailKit;
using MailKit.Search;

namespace WisenetPtzBridge.Services;

public sealed record MailCameraBinding(string CameraId, double Lat, double Lon);
public sealed record ForwardedMailAlert(string Id, string Link, DateTimeOffset? MailSentAt,
    DateTimeOffset? MailReceivedAt, DateTimeOffset FirstSeenAt, MailCameraBinding? Binding,
    FirewatcherEventDetail? Detail = null, DateTimeOffset? DetailCheckedAt = null, string? DetailStatus = null, string IngestionSource = "iphone-mail-forward");
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
        if (new FileInfo(path).Length > 16 * 1024 * 1024) throw new InvalidDataException();
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
    public async Task UpdateDetailAsync(string owner, string id, FirewatcherEventDetail? detail, string status, CancellationToken ct)
    {
        await gate.WaitAsync(ct);
        try
        {
            var state = Read(owner);
            await WriteAsync(state with { Events = state.Events.Select(e => e.Id == id ? e with
                { Detail = detail ?? e.Detail, DetailCheckedAt = DateTimeOffset.UtcNow, DetailStatus = status,
                  Binding = detail is not null && e.Detail is not null && (detail.CameraKey != e.Detail.CameraKey || detail.CameraName != e.Detail.CameraName) ? null : e.Binding } : e).ToArray() }, ct);
        }
        finally { gate.Release(); }
    }
    public async Task AddImportedAsync(string owner, ForwardedMailAlert alert, CancellationToken ct)
    {
        await gate.WaitAsync(ct);
        try
        {
            var state = Read(owner);
            var old = state.Events.FirstOrDefault(e => e.Id == alert.Id);
            var incoming = old is null ? alert : old with { Detail = alert.Detail, DetailCheckedAt = alert.DetailCheckedAt, DetailStatus = alert.DetailStatus, Binding = old.Detail is not null && alert.Detail is not null && (old.Detail.CameraKey != alert.Detail.CameraKey || old.Detail.CameraName != alert.Detail.CameraName) ? null : old.Binding };
            await WriteAsync(state with { Events = state.Events.Where(e => e.Id != alert.Id).Append(incoming).OrderByDescending(e => e.FirstSeenAt).Take(1000).ToArray() }, ct);
        }
        finally { gate.Release(); }
    }
    public static string LinkId(string link) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(link))).ToLowerInvariant();
}

public sealed class FirewatcherMailReceiver : BackgroundService
{
    private readonly bool enabledServer;
    private readonly MailAlertStore store;
    private readonly FirewatcherPageReader pages;
    private readonly string imageDirectory;
    private readonly SemaphoreSlim detailGate = new(1, 1);
    private FirewatcherMailSettings? settings;
    private string status = "not-configured";
    private DateTimeOffset? checkedAt;
    private int skipped;
    public FirewatcherMailReceiver(IConfiguration config, FirewatcherPageReader pages)
    {
        this.pages = pages;
        imageDirectory = Path.Combine(config["CCTV_DATA_DIR"] ?? Path.Combine(AppContext.BaseDirectory, "data"), "firewatcher-images");
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
        if (!enabledServer || !OperatingSystem.IsWindows()) return;
        while (!stoppingToken.IsCancellationRequested)
        {
            try { settings = FirewatcherMailSettings.Load(); if (settings?.Enabled != true) status = settings is null ? "not-configured" : "disabled"; }
            catch { settings = null; status = "settings-error"; }
            if (settings?.Enabled != true)
            {
                if (status != "settings-error") status = settings is null ? "not-configured" : "disabled";
                try { await Task.Delay(1000, stoppingToken); } catch (OperationCanceledException) { break; }
                continue;
            }
            try { await PollAsync(settings, stoppingToken); status = "connected"; checkedAt = DateTimeOffset.UtcNow; }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (MailKit.Security.AuthenticationException) { status = "authentication-error"; }
            catch (Exception) { status = "connection-or-storage-error"; } // Never log exceptions containing credentials, MIME or links.
            try
            {
                var pending = (await store.ReadAsync(settings.Identity, stoppingToken)).Events
                    .Where(e => e.Detail is null && (e.DetailCheckedAt is null || e.DetailCheckedAt < DateTimeOffset.UtcNow.AddMinutes(-5)))
                    .OrderByDescending(e => e.FirstSeenAt).Take(2);
                foreach (var alert in pending) await RefreshDetailAsync(alert.Id, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch { /* Page failures do not change the IMAP connection status. */ }
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
    private async Task<string?> SaveImageAsync(string id, byte[]? image, CancellationToken ct)
    {
        if (image is null) return null;
        if (!FirewatcherEventPage.IsJpeg(image) || id.Length != 64 || id.Any(c => !char.IsAsciiHexDigit(c))) throw new InvalidDataException();
        Directory.CreateDirectory(imageDirectory);
        var path = Path.Combine(imageDirectory, id + ".protected"); var temp = path + ".tmp";
        try { await File.WriteAllBytesAsync(temp, MonitoringServerSetup.Protect(image, true), ct); File.Move(temp, path, true); }
        finally { if (File.Exists(temp)) File.Delete(temp); }
        foreach (var old in new DirectoryInfo(imageDirectory).GetFiles("*.protected").OrderByDescending(f => f.LastWriteTimeUtc).Skip(100)) old.Delete();
        return Convert.ToHexString(SHA256.HashData(image)).ToLowerInvariant();
    }
    public async Task RefreshDetailAsync(string id, CancellationToken ct)
    {
        if (settings?.Enabled != true) return;
        await detailGate.WaitAsync(ct);
        try
        {
            var alert = (await store.ReadAsync(settings.Identity, ct)).Events.FirstOrDefault(e => e.Id == id);
            if (alert is null || alert.DetailCheckedAt > DateTimeOffset.UtcNow.AddSeconds(-5)) return;
            try
            {
                var result = await pages.ReadAsync(alert.Link, settings.AlertOrigin, ct);
                var hash = await SaveImageAsync(id, result.Image, ct);
                await store.UpdateDetailAsync(settings.Identity, id, result.Page.Detail with { ImageSha256 = hash }, hash is null ? "page-only" : "ready", ct);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
            catch { await store.UpdateDetailAsync(settings.Identity, id, null, "unavailable", ct); }
        }
        finally { detailGate.Release(); }
    }
    public async Task<IResult> ImportPageAsync(HttpContext context, CancellationToken ct)
    {
        if (settings?.Enabled != true) return Results.Conflict(new { error = "메일 수신 설정을 먼저 연결하세요." });
        try
        {
            using var bytes = new MemoryStream(); var buffer = new byte[8192]; int n;
            while ((n = await context.Request.Body.ReadAsync(buffer, ct)) > 0)
            { if (bytes.Length + n > FirewatcherEventPage.MaxZipBytes) return Results.StatusCode(413); await bytes.WriteAsync(buffer.AsMemory(0,n), ct); }
            var imported = FirewatcherEventPage.ReadArchive(bytes.ToArray(), settings.AlertOrigin);
            var id = MailAlertStore.LinkId(imported.Link);
            await detailGate.WaitAsync(ct);
            try
            {
                var hash = await SaveImageAsync(id, imported.Image, ct);
                await store.AddImportedAsync(settings.Identity, new(id, imported.Link, null, null, DateTimeOffset.UtcNow, null,
                    imported.Page.Detail with { ImageSha256 = hash }, DateTimeOffset.UtcNow, hash is null ? "page-only" : "ready", "saved-page-import"), ct);
            }
            finally { detailGate.Release(); }
            return Results.Ok(new { ok = true, eventId = id });
        }
        catch (Exception e) when (e is not OperationCanceledException)
        { return Results.BadRequest(new { error = "알림 HTML 한 개와 감지 JPG가 포함된 ZIP인지, 설정한 알림 서버가 같은지 확인하세요." }); }
    }
    public async Task<IResult> ImageAsync(string id, CancellationToken ct)
    {
        if (settings?.Enabled != true || id.Length != 64 || id.Any(c => !char.IsAsciiHexDigit(c))) return Results.NotFound();
        var alert = (await store.ReadAsync(settings.Identity, ct)).Events.FirstOrDefault(e => e.Id == id);
        var path = Path.Combine(imageDirectory, id + ".protected");
        if (alert?.Detail?.ImageSha256 is null || !File.Exists(path)) return Results.NotFound();
        try
        {
            if (new FileInfo(path).Length > FirewatcherEventPage.MaxImageBytes + 8192) return Results.NotFound();
            var image = MonitoringServerSetup.Protect(await File.ReadAllBytesAsync(path, ct), false);
            if (Convert.ToHexString(SHA256.HashData(image)).ToLowerInvariant() != alert.Detail.ImageSha256) return Results.NotFound();
            return Results.File(image, "image/jpeg");
        }
        catch (Exception e) when (e is not OperationCanceledException) { return Results.NotFound(); }
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
