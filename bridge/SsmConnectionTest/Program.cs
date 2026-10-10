using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using SsmConnectionTest;

Console.OutputEncoding = Encoding.UTF8;
Console.InputEncoding = Encoding.UTF8;
var report = new DiagnosticReport();
SsmClient? client = null;
int exitCode = 0;
string outputRoot = Path.Combine(AppContext.BaseDirectory, "diagnostics");
try
{
    string? endpoint = null, pin = null, connectionTarget = null;
    bool statusOnly = false;
    for (int i = 0; i < args.Length; i++)
    {
        switch (args[i])
        {
            case "--server": endpoint = args[++i]; break;
            case "--pin": pin = args[++i]; break;
            case "--output": outputRoot = Path.GetFullPath(args[++i]); break;
            case "--status-only": statusOnly = true; break;
            case "--connection-camera": connectionTarget = args[++i].Trim(); break;
            default: throw new DiagnosticException("ARGUMENT_INVALID");
        }
    }
    Console.WriteLine("SSM 읽기 전용 연결 테스트 — 카메라 이동/설정/영상 요청 없음");
    Console.WriteLine("최초 인증서의 서버 진위는 미검증입니다. 입력한 지문과 정확히 일치할 때만 연결합니다.");
    endpoint ??= Prompt("HTTPS 서버 주소 (https://주소:SSL포트): ");
    pin ??= Prompt("인증서 SHA-256 지문: ");
    client = new SsmClient(endpoint, pin, report);
    Console.WriteLine("HTTPS 상태 조회 중...");
    await client.Status();
    Console.WriteLine($"인증서 지문 일치 / 상태: {report.serverStatus} / 버전: {report.serverVersion} / 공개키: {(report.publicKeyPresent ? "있음" : "없음")}");
    if (!statusOnly && Prompt("정상 로그인 1회 및 목록 조회를 진행하려면 Y 입력 (Enter: 상태 조회만): ").Equals("Y", StringComparison.OrdinalIgnoreCase))
    {
        string id = Prompt("SSM 로그인 ID: ");
        string secret = Password();
        string clientIp = await LocalAddress(SsmClient.ParseOrigin(endpoint));
        try { await client.Login(id, secret, clientIp); }
        finally { secret = ""; id = ""; }
        Console.WriteLine("로그인 성공. 계정에서 조회 가능한 목록을 읽는 중...");
        if (connectionTarget is null && Prompt("카메라 한 대의 등록 주소·포트도 추출하려면 Y 입력 (Enter: 기본 목록만): ").Equals("Y", StringComparison.OrdinalIgnoreCase))
            connectionTarget = Prompt("대상 이름 일부 또는 UUID (예: 백운대): ");
        if (connectionTarget is not null && string.IsNullOrWhiteSpace(connectionTarget)) throw new DiagnosticException("CONNECTION_TARGET_REQUIRED");
        var cameras = await client.Inventory(connectionTarget);
        Directory.CreateDirectory(outputRoot);
        string folder = NewFolder(outputRoot);
        outputRoot = folder;
        var preview = new { schemaVersion = 1, complete = false, totalCount = cameras.Count, capturedAt = DateTimeOffset.UtcNow,
            provenance = "SSM HTTPS diagnostic; account-visible scope; full coverage NOT VERIFIED", cameras };
        await File.WriteAllTextAsync(Path.Combine(folder, "camera-preview.private.json"), JsonSerializer.Serialize(preview, JsonOptions()));
        await File.WriteAllTextAsync(Path.Combine(folder, "camera-metadata.private.json"), JsonSerializer.Serialize(new {
            schemaVersion = 1, complete = false, capturedAt = preview.capturedAt,
            provenance = "SSM configured metadata; heading meaning and current PTZ NOT VERIFIED", cameras = client.Metadata
        }, JsonOptions()));
        if (client.SelectedConnection is { } selectedConnection)
        {
            await File.WriteAllTextAsync(Path.Combine(folder, "camera-connection.private.json"), JsonSerializer.Serialize(new {
                schemaVersion = 1, complete = false, capturedAt = preview.capturedAt,
                provenance = "SSM configured networkInfo; reachable route and ONVIF/SUNAPI service NOT VERIFIED",
                routeVerified = false, connection = selectedConnection
            }, JsonOptions()));
            Console.WriteLine("선택한 한 대의 등록 주소·포트를 camera-connection.private.json에 저장했습니다. 주소는 화면/공유 보고서에 표시하지 않습니다.");
            Console.WriteLine("카메라 자체 포트와 외부 전달 포트는 다를 수 있습니다. 이 값으로 자동 접속하거나 조회 경로를 만들지 않습니다.");
        }
        Console.WriteLine($"서버 {report.serverCount} / 컴포넌트 {report.componentCount} / 카메라 {report.cameraCount} / PtzCap 미확인 {report.unknownPtzCapCount}");
        Console.WriteLine($"저장 heading 값 있음 {report.configuredHeadingCount} / 좌표 쌍 있음 {report.configuredCoordinateCount} / XMap 구독 조건 후보 {report.xMapSubscriptionCandidateCount}");
        Console.WriteLine("저장 heading은 현재 Pan 또는 북쪽 보정으로 확정한 값이 아닙니다. 계정 PTZ 권한도 별도 확인이 필요합니다.");
        Console.WriteLine("목록은 전체 범위 미확인 미리보기입니다. 기존 선택/설정은 변경하지 않았습니다.");
        Console.WriteLine("camera-preview.private.json에는 카메라 이름/UUID가 있습니다. 외부에 공유하지 마세요.");
        Console.WriteLine("camera-metadata.private.json에는 UUID/설정 좌표·heading이 있습니다. 회사 PC에 보관하세요.");
    }
}
catch (Exception e)
{
    exitCode = 1;
    report.result = "failed";
    report.error = e switch
    {
        DiagnosticException => e.Message,
        HttpRequestException => report.certificateRejected ? "CERTIFICATE_PIN_OR_VALIDITY_REJECTED" : "HTTPS_CONNECTION_FAILED",
        OperationCanceledException => "TIMEOUT_OR_CANCELLED",
        JsonException => "JSON_RESPONSE_INVALID",
        IOException => "LOCAL_IO_FAILED",
        SocketException => "CLIENT_ROUTE_UNAVAILABLE",
        _ => "DIAGNOSTIC_FAILED"
    };
    // Exception messages, response bodies, ID, password and session are deliberately not logged.
    Console.WriteLine("결과: " + report.error);
    Console.WriteLine("401/403/409 등 로그인 오류는 반복 재시도하지 말고 진단 결과를 확인하세요.");
}
finally
{
    if (client is not null)
    {
        await client.Logout();
        client.Dispose();
    }
    if (report.logout is not null) Console.WriteLine("테스트 세션 로그아웃: " + report.logout);
    try
    {
        if (!Path.GetFileName(outputRoot).StartsWith("test-", StringComparison.Ordinal)) outputRoot = NewFolder(outputRoot);
        await File.WriteAllTextAsync(Path.Combine(outputRoot, "connection-report.json"), JsonSerializer.Serialize(report, JsonOptions()));
        Console.WriteLine("공유용 진단 파일: " + Path.Combine(outputRoot, "connection-report.json"));
    }
    catch { Console.WriteLine("진단 파일 저장 실패. 위 결과 코드만 공유하세요."); exitCode = 1; }
    if (!Console.IsInputRedirected) { Console.WriteLine("Enter를 누르면 종료합니다."); Console.ReadLine(); }
}
return exitCode;

static JsonSerializerOptions JsonOptions() => new() { WriteIndented = true };
static string NewFolder(string root)
{
    var folder = Path.Combine(root, "test-" + DateTimeOffset.UtcNow.ToString("yyyyMMdd-HHmmss") + "-" + Guid.NewGuid().ToString("N")[..8]);
    Directory.CreateDirectory(folder);
    return folder;
}
static string Prompt(string message) { Console.Write(message); return Console.ReadLine()?.Trim() ?? ""; }
static string Password()
{
    Console.Write("SSM 비밀번호 (화면에 표시/저장하지 않음): ");
    if (Console.IsInputRedirected) return Console.ReadLine() ?? "";
    var buffer = new StringBuilder();
    while (true)
    {
        var key = Console.ReadKey(intercept: true);
        if (key.Key == ConsoleKey.Enter) { Console.WriteLine(); return buffer.ToString(); }
        if (key.Key == ConsoleKey.Backspace) { if (buffer.Length > 0) buffer.Length--; }
        else if (!char.IsControl(key.KeyChar)) buffer.Append(key.KeyChar);
    }
}
static async Task<string> LocalAddress(Uri origin)
{
    var addresses = await Dns.GetHostAddressesAsync(origin.Host);
    var address = addresses.FirstOrDefault(a => a.AddressFamily == AddressFamily.InterNetwork) ?? addresses.First();
    using var route = new Socket(address.AddressFamily, SocketType.Dgram, ProtocolType.Udp);
    // Connect selects the local route; no UDP payload is sent.
    route.Connect(new IPEndPoint(address, origin.Port));
    return ((IPEndPoint)route.LocalEndPoint!).Address.ToString();
}
