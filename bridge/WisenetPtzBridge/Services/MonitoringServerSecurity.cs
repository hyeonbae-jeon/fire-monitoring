using System.Globalization;
using System.Net;
using System.Security.Claims;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.RateLimiting;
using System.Threading.RateLimiting;

namespace WisenetPtzBridge.Services;

public static class MonitoringServerSecurity
{
    public static bool Enabled(IConfiguration config) => config["MONITOR_SERVER_MODE"] == "true";
    public static string HashPassword(string password)
    {
        if (password.Length < 12 || password.Length > 512) throw new ArgumentException("모니터링 로그인 비밀번호는 12~512자로 입력하세요.");
        var salt = RandomNumberGenerator.GetBytes(16);
        var hash = Rfc2898DeriveBytes.Pbkdf2(password, salt, 600000, HashAlgorithmName.SHA256, 32);
        return "pbkdf2-sha256$600000$" + Convert.ToBase64String(salt) + "$" + Convert.ToBase64String(hash);
    }
    public static bool VerifyPassword(string password, string encoded)
    {
        try
        {
            var parts = encoded.Split('$');
            if (password.Length > 512 || parts.Length != 4 || parts[0] != "pbkdf2-sha256" || parts[1] != "600000") return false;
            var salt = Convert.FromBase64String(parts[2]); var expected = Convert.FromBase64String(parts[3]);
            return salt.Length == 16 && expected.Length == 32 && CryptographicOperations.FixedTimeEquals(expected,
                Rfc2898DeriveBytes.Pbkdf2(password, salt, 600000, HashAlgorithmName.SHA256, 32));
        }
        catch (FormatException) { return false; }
    }
    public static bool ValidHash(string encoded)
    {
        try
        {
            var p = encoded.Split('$');
            return p.Length == 4 && p[0] == "pbkdf2-sha256" && p[1] == "600000" &&
                Convert.FromBase64String(p[2]).Length == 16 && Convert.FromBase64String(p[3]).Length == 32;
        }
        catch (FormatException) { return false; }
    }
    public static void Add(WebApplicationBuilder builder)
    {
        if (!Enabled(builder.Configuration)) return;
        var hash = builder.Configuration["CCTV_MONITOR_PASSWORD_HASH"] ?? "";
        if (string.IsNullOrWhiteSpace(builder.Configuration["CCTV_MONITOR_USER"]) ||
            builder.Configuration["CCTV_MONITOR_USER"]!.Length > 100 || !ValidHash(hash))
            throw new InvalidOperationException("서버 모드에는 모니터링 로그인 이름과 PBKDF2 비밀번호 해시가 필요합니다.");
        builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme).AddCookie(o =>
        {
            o.Cookie.Name = "CctvMonitor.Session"; o.Cookie.HttpOnly = true; o.Cookie.SameSite = SameSiteMode.Strict;
            o.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest; o.ExpireTimeSpan = TimeSpan.FromHours(8); o.SlidingExpiration = true;
            o.Events.OnRedirectToLogin = c => { c.Response.StatusCode = 401; return Task.CompletedTask; };
        });
        builder.Services.AddAuthorization();
        var protection = builder.Services.AddDataProtection().SetApplicationName("FireMonitoringServer").PersistKeysToFileSystem(new DirectoryInfo(
            Path.Combine(builder.Configuration["CCTV_DATA_DIR"] ?? Path.Combine(AppContext.BaseDirectory, "data"), "auth-keys")));
        if (OperatingSystem.IsWindows()) protection.ProtectKeysWithDpapi();
        builder.Services.AddAntiforgery(o => { o.HeaderName = "X-Monitor-CSRF"; o.Cookie.SameSite = SameSiteMode.Strict; });
        builder.Services.Configure<ForwardedHeadersOptions>(o =>
        {
            o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
            // Loopback proxies (e.g. Tailscale Serve) are trusted by the framework defaults.
            if (builder.Configuration["MONITOR_PROXY_CIDR"] is { Length: > 0 } cidr)
            {
                var p = cidr.Split('/');
                if (p.Length != 2 || !IPAddress.TryParse(p[0], out var ip) || !int.TryParse(p[1], out var prefix))
                    throw new InvalidOperationException("MONITOR_PROXY_CIDR 형식을 확인하세요.");
                o.KnownNetworks.Add(new Microsoft.AspNetCore.HttpOverrides.IPNetwork(ip, prefix));
            }
        });
        builder.Services.AddRateLimiter(o => o.AddPolicy("monitor-login", context => RateLimitPartition.GetFixedWindowLimiter(
            context.Connection.RemoteIpAddress?.ToString() ?? "unknown", _ => new FixedWindowRateLimiterOptions
            { PermitLimit = 5, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 })));
    }
    public static void Use(WebApplication app)
    {
        if (!Enabled(app.Configuration)) return;
        app.UseForwardedHeaders(); app.UseAuthentication(); app.UseAuthorization(); app.UseRateLimiter();
        app.Use(async (context, next) =>
        {
            context.Response.Headers["Content-Security-Policy"] = "frame-ancestors 'self'";
            var host = context.Request.Host.Host;
            var loopback = context.Connection.RemoteIpAddress is { } ip && IPAddress.IsLoopback(ip) &&
                (host == "localhost" || IPAddress.TryParse(host, out var h) && IPAddress.IsLoopback(h));
            if (!context.Request.IsHttps && !loopback)
            { context.Response.StatusCode = 400; await context.Response.WriteAsJsonAsync(new { error = "원격 모니터링에는 HTTPS가 필요합니다." }); return; }
            if (context.Request.Path == "/login" || context.Request.Path == "/health") { await next(context); return; }
            if (context.User.Identity?.IsAuthenticated != true)
            {
                if (context.Request.Path.StartsWithSegments("/api")) { context.Response.StatusCode = 401; await context.Response.WriteAsJsonAsync(new { error = "모니터링에 로그인하세요." }); }
                else context.Response.Redirect("/login");
                return;
            }
            if (context.Request.Path.StartsWithSegments("/api") && context.Request.Method is not ("GET" or "HEAD" or "OPTIONS"))
            {
                try { await context.RequestServices.GetRequiredService<IAntiforgery>().ValidateRequestAsync(context); }
                catch (AntiforgeryValidationException)
                { context.Response.StatusCode = 403; await context.Response.WriteAsJsonAsync(new { error = "로그인 페이지를 다시 열어 요청을 확인하세요." }); return; }
            }
            await next(context);
        });
        app.MapGet("/login", (HttpContext context, IAntiforgery antiforgery) =>
        {
            var token = WebUtility.HtmlEncode(antiforgery.GetAndStoreTokens(context).RequestToken);
            return Results.Content("<!doctype html><html lang=ko><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>산불감시 로그인</title><style>body{font:16px sans-serif;background:#132f3e;color:#f4f8fa;max-width:360px;margin:12vh auto;padding:24px}label,input,button{display:block;width:100%;box-sizing:border-box;margin:12px 0;padding:10px}button{background:#188299;color:white;border:0}a{color:white}</style><h1>산불감시 모니터링</h1><form method=post action=/login><input type=hidden name=__RequestVerificationToken value='" + token + "'><label>로그인 이름<input name=username autocomplete=username maxlength=100 required></label><label>비밀번호<input name=password type=password autocomplete=current-password maxlength=512 required></label><button>로그인</button></form></html>", "text/html; charset=utf-8");
        });
        app.MapPost("/login", async (HttpContext context, IAntiforgery antiforgery) =>
        {
            try { await antiforgery.ValidateRequestAsync(context); }
            catch (AntiforgeryValidationException) { return Results.StatusCode(403); }
            var form = await context.Request.ReadFormAsync();
            if (form["username"] != app.Configuration["CCTV_MONITOR_USER"] ||
                !VerifyPassword(form["password"].ToString(), app.Configuration["CCTV_MONITOR_PASSWORD_HASH"]!))
                return Results.Content("로그인 정보를 확인하세요. <a href=/login>다시 로그인</a>", "text/html; charset=utf-8", statusCode: 401);
            await context.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme,
                new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Name, form["username"].ToString())], CookieAuthenticationDefaults.AuthenticationScheme)));
            return Results.Redirect("/");
        }).RequireRateLimiting("monitor-login");
        app.MapGet("/api/session", (HttpContext context, IAntiforgery antiforgery) => Results.Ok(new
        { serverMode = true, csrfToken = antiforgery.GetAndStoreTokens(context).RequestToken }));
        app.MapPost("/api/logout", async (HttpContext context) =>
        { await context.SignOutAsync(); return Results.Ok(new { ok = true }); });
    }
}
