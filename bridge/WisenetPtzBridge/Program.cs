using System.Security.Cryptography;
using System.Text;
using WisenetPtzBridge.Models;
using WisenetPtzBridge.Services;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddSingleton<ICameraInventorySource, FileCameraInventorySource>();
builder.Services.AddSingleton<CameraConfiguration>();
builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = 1024 * 1024);
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
    liveSsmConnected = false, ptzCommandsEnabled = false
}));
app.MapGet("/api/inventory", async (ICameraInventorySource source, CancellationToken ct) =>
    Results.Ok(await source.ReadAsync(ct)));
app.MapGet("/api/cameras", async (CameraConfiguration registry, CancellationToken ct) =>
    Results.Ok(await registry.ReadAsync(ct)));
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
// Phase 1 has no SSM network client or PTZ command dispatcher.
app.Run();
