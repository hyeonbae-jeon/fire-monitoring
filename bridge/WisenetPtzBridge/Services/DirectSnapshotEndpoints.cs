using System.Net;
using System.Security.Cryptography;
using System.Text;

namespace WisenetPtzBridge.Services;

public static class DirectSnapshotEndpoints
{
    private static IResult? Access(HttpContext context, DirectSnapshotSource source, IConfiguration config)
    {
        context.Response.Headers["Cross-Origin-Resource-Policy"] = "same-origin";
        var host = context.Request.Host.Host;
        if (context.Connection.RemoteIpAddress is not { } remote || !IPAddress.IsLoopback(remote) ||
            !(host.Equals("localhost", StringComparison.OrdinalIgnoreCase) || IPAddress.TryParse(host, out var ip) && IPAddress.IsLoopback(ip)) ||
            context.Request.Headers["Sec-Fetch-Site"] == "cross-site")
            return Results.Json(new { error = "직접 카메라 시험은 이 PC의 localhost 브라우저에서만 사용할 수 있습니다." }, statusCode: 403);
        var origin = context.Request.Headers.Origin.ToString();
        if (origin.Length != 0 && origin != $"{context.Request.Scheme}://{context.Request.Host}")
            return Results.Json(new { error = "다른 사이트의 직접 카메라 요청은 허용하지 않습니다." }, statusCode: 403);
        if (!source.Configured) return Results.Json(new { error = "이 실행 환경에서는 직접 카메라 시험이 활성화되지 않았습니다." }, statusCode: 503);
        var expected = config["CAPTURE_READ_KEY"];
        if (string.IsNullOrWhiteSpace(expected)) return Results.Json(new { error = "로컬 영상 조회 키를 설정하세요." }, statusCode: 503);
        var provided = context.Request.Headers["X-Capture-Read-Key"].ToString();
        if (!CryptographicOperations.FixedTimeEquals(SHA256.HashData(Encoding.UTF8.GetBytes(expected)), SHA256.HashData(Encoding.UTF8.GetBytes(provided))))
            return Results.Json(new { error = "올바른 로컬 영상 조회 키가 필요합니다." }, statusCode: 401);
        return null;
    }
    public static void MapDirectSnapshotEndpoints(this WebApplication app)
    {
        app.MapPost("/api/camera-snapshot/session", async (HttpContext context, DirectSnapshotRequest request, DirectSnapshotSource source, IConfiguration config, CancellationToken ct) =>
        {
            if (Access(context, source, config) is { } rejected) return rejected;
            try { return Results.Ok(await source.StartAsync(request, ct)); }
            catch (SnapshotException ex) { return Results.Json(new { error = ex.Message, code = ex.Code }, statusCode: ex.StatusCode); }
        });
        app.MapDelete("/api/camera-snapshot/session", async (HttpContext context, string sessionId, DirectSnapshotSource source, IConfiguration config) =>
        {
            if (Access(context, source, config) is { } rejected) return rejected;
            try { await source.StopAsync(sessionId); return Results.Ok(source.Status()); }
            catch (SnapshotException ex) { return Results.Json(new { error = ex.Message, code = ex.Code }, statusCode: ex.StatusCode); }
        });
        app.MapGet("/api/camera-snapshot/status", (HttpContext context, DirectSnapshotSource source, IConfiguration config) =>
            Access(context, source, config) ?? Results.Ok(source.Status(renewLease: true)));
        app.MapGet("/api/camera-snapshot/frame", (HttpContext context, string sessionId, long sequence, DirectSnapshotSource source, IConfiguration config) =>
        {
            if (Access(context, source, config) is { } rejected) return rejected;
            var jpeg = source.FrameBytes(sessionId, sequence);
            return jpeg is null ? Results.Json(new { error = "요청한 직접 수신 영상이 없거나 만료됐습니다." }, statusCode: 409) : Results.File(jpeg, "image/jpeg");
        });
    }
}
