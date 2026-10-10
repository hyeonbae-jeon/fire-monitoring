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
var builder = WebApplication.CreateBuilder(new WebApplicationOptions
{
    Args = args.Where(a => a is not "--desktop-demo" and not "--no-browser").ToArray(),
    ContentRootPath = desktopDemo ? AppContext.BaseDirectory : null
});
if (desktopDemo)
{
    // Always isolate demo input/output, even if the PC has operational environment variables.
    builder.Configuration["INVENTORY_FILE"] = Path.Combine(AppContext.BaseDirectory, "demo", "inventory.json");
    builder.Configuration["CAMERA_CONFIG_FILE"] = Path.Combine(AppContext.BaseDirectory, "data", "cameras.demo.json");
    builder.Configuration["MAP_CONFIG_FILE"] = Path.Combine(AppContext.BaseDirectory, "data", "map.demo.json");
    builder.Configuration["INVENTORY_WRITE_KEY"] = "local-demo-only";
}
builder.Services.AddSingleton<FileCameraInventorySource>();
builder.Services.AddSingleton<ICameraInventorySource>(services => services.GetRequiredService<FileCameraInventorySource>());
builder.Services.AddSingleton<CameraConfiguration>();
builder.Services.AddSingleton<MapConfiguration>();
builder.WebHost.ConfigureKestrel(options =>
{
    options.Limits.MaxRequestBodySize = 1024 * 1024;
    if (desktopDemo) options.Listen(IPAddress.Loopback, 0);
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
app.UseDefaultFiles();
app.UseStaticFiles();
app.MapGet("/health", () => Results.Ok(new
{
    ok = true, service = "WisenetPtzBridge", phase = "camera-inventory",
    liveSsmConnected = false, ptzCommandsEnabled = false, localDesktopDemo = desktopDemo
}));
app.MapGet("/api/inventory", async (ICameraInventorySource source, CancellationToken ct) =>
    Results.Ok(await source.ReadAsync(ct)));
app.MapGet("/api/cameras", async (CameraConfiguration registry, CancellationToken ct) =>
    Results.Ok(await registry.ReadAsync(ct)));
app.MapGet("/api/map-configuration", async (MapConfiguration registry, CancellationToken ct) =>
    Results.Ok(await registry.ReadAsync(ct)));
app.MapPut("/api/map-configuration", async (HttpContext context, MapSaveRequest request,
    MapConfiguration registry, IConfiguration config, CancellationToken ct) =>
{
    var expected = config["INVENTORY_WRITE_KEY"];
    if (string.IsNullOrWhiteSpace(expected))
        return Results.Json(new { error = "Map writes are disabled. Configure INVENTORY_WRITE_KEY." }, statusCode: 503);
    var provided = context.Request.Headers["X-Inventory-Write-Key"].ToString();
    if (!CryptographicOperations.FixedTimeEquals(SHA256.HashData(Encoding.UTF8.GetBytes(expected)),
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
if (desktopDemo)
{
    await app.StartAsync();
    var address = app.Urls.Single();
    Console.WriteLine($"\nLOCAL CAMERA INVENTORY — INITIAL SAMPLE / REPORT IMPORT — SSM NOT CONNECTED\nBrowser: {address}\nSave key: local-demo-only (public demo value, not an operational credential)\nClose this window or press Ctrl+C to stop.\n");
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
