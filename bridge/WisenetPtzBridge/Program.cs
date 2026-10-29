using System.Security.Cryptography;
using System.Text;
using System.Diagnostics;
using System.Net;
using WisenetPtzBridge.Models;
using WisenetPtzBridge.Services;

// Only the portable package carries this marker; regular Bridge deployment is unchanged.
var desktopDemo = args.Contains("--desktop-demo") ||
    File.Exists(Path.Combine(AppContext.BaseDirectory, "portable-demo.json"));
var noBrowser = args.Contains("--no-browser");
if (args.Contains("--health-probe"))
{
    try { using var probe = new HttpClient { Timeout = TimeSpan.FromSeconds(3) }; var r = await probe.GetAsync("http://127.0.0.1:" + (Environment.GetEnvironmentVariable("MONITOR_PORT") ?? "5080") + "/health"); Environment.ExitCode = r.IsSuccessStatusCode ? 0 : 1; }
    catch { Environment.ExitCode = 1; } return;
}
if (args.Contains("--import-server-settings-stdin")) { Environment.ExitCode = await MonitoringServerSetup.ImportAsync(); return; }
if (args.Contains("--configure-monitoring-server")) { Environment.ExitCode = await MonitoringServerSetup.ConfigureAsync(); return; }
if (args.Contains("--configure-monitoring-accounts")) { Environment.ExitCode = await MonitoringServerSetup.ConfigureAccountsAsync(); return; }
if (args.Contains("--register-github-secrets")) { Environment.ExitCode = await MonitoringServerSetup.RegisterGitHubAsync(); return; }
var builder = WebApplication.CreateBuilder(new WebApplicationOptions
{
    Args = args.Where(a => a is not "--desktop-demo" and not "--no-browser" and not "--server").ToArray(),
    ContentRootPath = desktopDemo ? AppContext.BaseDirectory : null
});
var hasPrivateServerSettings = File.Exists(Path.Combine(AppContext.BaseDirectory, "data", "server-settings.protected"));
MonitoringServerSetup.LoadProtected(builder.Configuration);
if (desktopDemo && !hasPrivateServerSettings && !args.Contains("--server"))
{
    builder.Configuration["MONITOR_SERVER_MODE"] = "false";
    builder.Configuration["CCTV_CONNECTIONS_JSON"] = null;
}
var serverMode = MonitoringServerSecurity.Enabled(builder.Configuration);
if (serverMode)
{
    desktopDemo = false;
    var data = builder.Configuration["CCTV_DATA_DIR"] ?? Path.Combine(AppContext.BaseDirectory, "data");
    builder.Configuration["MAP_CONFIG_FILE"] ??= Path.Combine(data, "map.demo.json");
    builder.Configuration["DIRECT_CAMERA_SNAPSHOT_ENABLED"] = "true";
}
if (desktopDemo)
{
    // Always isolate demo input/output, even if the PC has operational environment variables.
    builder.Configuration["INVENTORY_FILE"] = Path.Combine(AppContext.BaseDirectory, "demo", "inventory.json");
    builder.Configuration["CAMERA_CONFIG_FILE"] = Path.Combine(AppContext.BaseDirectory, "data", "cameras.demo.json");
    builder.Configuration["MAP_CONFIG_FILE"] = Path.Combine(AppContext.BaseDirectory, "data", "map.demo.json");
    builder.Configuration["INVENTORY_WRITE_KEY"] = "local-demo-only";
    builder.Configuration["CAPTURE_SOURCE_DIR"] = Path.Combine(AppContext.BaseDirectory, "data", "capture.private");
    builder.Configuration["CAPTURE_READ_KEY"] = "local-demo-only";
    builder.Configuration["DIRECT_CAMERA_SNAPSHOT_ENABLED"] = "true";
}
builder.Services.AddSingleton<FileCameraInventorySource>();
builder.Services.AddSingleton<ICameraInventorySource>(services => services.GetRequiredService<FileCameraInventorySource>());
builder.Services.AddSingleton<CameraConfiguration>();
builder.Services.AddSingleton<MapConfiguration>();
builder.Services.AddSingleton<ScreenFrameSource>();
builder.Services.AddSingleton<DirectSnapshotSource>();
builder.Services.AddSingleton<AutomaticMonitoring>();
builder.Services.AddHostedService(services => services.GetRequiredService<AutomaticMonitoring>());
MonitoringServerSecurity.Add(builder);
await MonitoringServerSetup.InitializeMapAsync(builder.Configuration, useBundledDefaults: desktopDemo || serverMode);
builder.WebHost.ConfigureKestrel(options =>
{
    options.Limits.MaxRequestBodySize = 1024 * 1024;
    if (desktopDemo) options.Listen(IPAddress.Loopback, 0);
    if (serverMode) options.Listen(IPAddress.Parse(builder.Configuration["MONITOR_LISTEN_ADDRESS"] ?? "127.0.0.1"),
        int.Parse(builder.Configuration["MONITOR_PORT"] ?? "5080"));
});
var app = builder.Build();
app.Use(async (context, next) =>
{
    context.Response.Headers.CacheControl = "no-store";
    context.Response.Headers.XContentTypeOptions = "nosniff";
    try { await next(context); }
    catch (InventoryException ex)
    {
        context.Response.StatusCode = ex.StatusCode;
        await context.Response.WriteAsJsonAsync(new { error = ex.Message });
    }
});
MonitoringServerSecurity.Use(app);
app.UseDefaultFiles();
app.UseStaticFiles();
app.MapDirectSnapshotEndpoints();
app.MapGet("/health", () => Results.Ok(new
{
    ok = true, service = "WisenetPtzBridge", phase = "camera-inventory",
    liveSsmConnected = false, ptzCommandsEnabled = false, localDesktopDemo = desktopDemo,
    serverMode, automaticMonitoring = serverMode && !string.IsNullOrWhiteSpace(builder.Configuration["CCTV_CONNECTIONS_JSON"])
}));
app.MapGet("/api/auto-monitor/status", (HttpContext context, AutomaticMonitoring monitoring, DirectSnapshotSource direct, IConfiguration config) =>
    !serverMode && DirectSnapshotEndpoints.Access(context, direct, config) is { } rejected ? rejected : Results.Ok(monitoring.Status()));
app.MapGet("/api/auto-monitor/frame", (HttpContext context, string cameraId, string sessionId, long sequence,
    AutomaticMonitoring monitoring, DirectSnapshotSource direct, IConfiguration config) =>
{
    if (!serverMode && DirectSnapshotEndpoints.Access(context, direct, config) is { } rejected) return rejected;
    var bytes = monitoring.Frame(cameraId, sessionId, sequence);
    return bytes is null ? Results.Json(new { error = "최신 영상이 없거나 수신이 만료됐습니다." }, statusCode: 409) : Results.File(bytes, "image/jpeg");
});
app.MapGet("/api/inventory", async (ICameraInventorySource source, CancellationToken ct) =>
    Results.Ok(await source.ReadAsync(ct)));
app.MapGet("/api/cameras", async (CameraConfiguration registry, CancellationToken ct) =>
    Results.Ok(await registry.ReadAsync(ct)));
app.MapGet("/api/map-configuration", async (MapConfiguration registry, CancellationToken ct) =>
    Results.Ok(await registry.ReadAsync(ct)));
// VWorld's browser SDK must receive its domain-restricted map key. Never expose SSM or write keys here.
app.MapGet("/api/map-client-settings", (IConfiguration config) => Results.Ok(new
{
    vworldApiKey = string.IsNullOrWhiteSpace(config["VWORLD_API_KEY"]) ? null : config["VWORLD_API_KEY"]!.Trim()
}));
IResult? CaptureAccess(HttpContext context, ScreenFrameSource source, IConfiguration config)
{
    context.Response.Headers["Cross-Origin-Resource-Policy"] = "same-origin";
    if (!source.Configured) return null;
    var expected = config["CAPTURE_READ_KEY"];
    if (string.IsNullOrWhiteSpace(expected))
        return Results.Json(new { error = "Capture reads are disabled. Configure CAPTURE_READ_KEY." }, statusCode: 503);
    var provided = context.Request.Headers["X-Capture-Read-Key"].ToString();
    if (!CryptographicOperations.FixedTimeEquals(SHA256.HashData(Encoding.UTF8.GetBytes(expected)),
        SHA256.HashData(Encoding.UTF8.GetBytes(provided))))
        return Results.Json(new { error = "A valid capture read key is required." }, statusCode: 401);
    return null;
}
app.MapGet("/api/screen-capture/status", (HttpContext context, ScreenFrameSource source, IConfiguration config) =>
    CaptureAccess(context, source, config) ?? Results.Ok(source.Status()));
app.MapGet("/api/screen-capture/frame", (HttpContext context, string sessionId, long sequence,
    ScreenFrameSource source, IConfiguration config) =>
{
    var rejected = CaptureAccess(context, source, config);
    if (rejected is not null) return rejected;
    var jpeg = source.Frame(sessionId, sequence);
    return jpeg is null ? Results.Json(new { error = "The requested frame is unavailable or no longer current." }, statusCode: 409)
        : Results.File(jpeg, "image/jpeg");
});
app.MapPut("/api/map-configuration", async (HttpContext context, MapSaveRequest request,
    MapConfiguration registry, IConfiguration config, CancellationToken ct) =>
{
    var expected = config["INVENTORY_WRITE_KEY"];
    if (!serverMode && string.IsNullOrWhiteSpace(expected))
        return Results.Json(new { error = "Map writes are disabled. Configure INVENTORY_WRITE_KEY." }, statusCode: 503);
    var provided = context.Request.Headers["X-Inventory-Write-Key"].ToString();
    if (!serverMode && !CryptographicOperations.FixedTimeEquals(SHA256.HashData(Encoding.UTF8.GetBytes(expected!)),
        SHA256.HashData(Encoding.UTF8.GetBytes(provided))))
        return Results.Json(new { error = "A valid configuration write key is required." }, statusCode: 401);
    return Results.Ok(await registry.SaveAsync(request, ct));
});
app.MapPut("/api/cameras", async (HttpContext context, SelectionRequest request,
    CameraConfiguration registry, IConfiguration config, CancellationToken ct) =>
{
    var expected = config["INVENTORY_WRITE_KEY"];
    if (string.IsNullOrWhiteSpace(expected))
        return Results.Json(new { error = "Configuration writes are disabled. Configure INVENTORY_WRITE_KEY on the Bridge." }, statusCode: 503);
    var provided = context.Request.Headers["X-Inventory-Write-Key"].ToString();
    if (!CryptographicOperations.FixedTimeEquals(SHA256.HashData(Encoding.UTF8.GetBytes(expected)),
        SHA256.HashData(Encoding.UTF8.GetBytes(provided))))
        return Results.Json(new { error = "A valid configuration write key is required." }, statusCode: 401);
    return Results.Ok(await registry.SaveAsync(request, ct));
});
app.MapPost("/api/inventory", async (HttpContext context, InventoryImportRequest request,
    FileCameraInventorySource source, IConfiguration config, CancellationToken ct) =>
{
    var expected = config["INVENTORY_WRITE_KEY"];
    if (string.IsNullOrWhiteSpace(expected))
        return Results.Json(new { error = "Inventory import is disabled. Configure INVENTORY_WRITE_KEY." }, statusCode: 503);
    var provided = context.Request.Headers["X-Inventory-Write-Key"].ToString();
    if (!CryptographicOperations.FixedTimeEquals(SHA256.HashData(Encoding.UTF8.GetBytes(expected)),
        SHA256.HashData(Encoding.UTF8.GetBytes(provided))))
        return Results.Json(new { error = "A valid configuration write key is required." }, statusCode: 401);
    return Results.Ok(await source.ImportAsync(request, ct));
});
// Phase 1 has no SSM network client or PTZ command dispatcher.
if (desktopDemo || serverMode && OperatingSystem.IsWindows())
{
    await app.StartAsync();
    var address = app.Urls.Single();
    Console.WriteLine(serverMode
        ? $"\nCCTV MONITORING SERVER\nBrowser: {address}\nCamera credentials stay on this server. Close this window or press Ctrl+C to stop.\n"
        : $"\nLOCAL CAMERA INVENTORY — INITIAL SAMPLE / REPORT IMPORT — SSM NOT CONNECTED\nBrowser: {address}\nSave key: local-demo-only (public demo value, not an operational credential)\nClose this window or press Ctrl+C to stop.\n");
    if (OperatingSystem.IsWindows() && !noBrowser)
    {
        try { Process.Start(new ProcessStartInfo(address) { UseShellExecute = true }); }
        catch (Exception ex) when (ex is System.ComponentModel.Win32Exception or InvalidOperationException)
        {
            Console.WriteLine("Could not open the browser. Enter the Browser address above manually.");
        }
    }
    await app.WaitForShutdownAsync();
}
else await app.RunAsync();
