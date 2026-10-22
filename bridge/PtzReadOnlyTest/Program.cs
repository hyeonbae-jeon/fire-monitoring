using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Xml;
using PtzReadOnlyTest;

Console.OutputEncoding = Encoding.UTF8;
Console.InputEncoding = Encoding.UTF8;
var report = new ProbeReport();
int exitCode = 0;
string outputRoot = Path.Combine(AppContext.BaseDirectory, "diagnostics");
try
{
    string? endpoint = null, pin = null;
    bool allowHttp = false;
    for (int i = 0; i < args.Length; i++)
    {
        switch (args[i])
        {
            case "--device-service": endpoint = args[++i]; break;
            case "--pin": pin = args[++i]; break;
            case "--output": outputRoot = Path.GetFullPath(args[++i]); break;
            case "--allow-http": allowHttp = true; break;
            default: throw new ProbeException("ARGUMENT_INVALID");
        }
    }
    Console.WriteLine("단일 카메라 ONVIF 현재 PTZ 읽기 테스트 — 이동/설정 명령 없음");
    Console.WriteLine("SSM 로그인 주소가 아닌, 확인된 카메라/NVR ONVIF Device 서비스의 전체 URL을 입력하세요.");
    endpoint ??= Prompt("ONVIF Device 서비스 URL: ");
    if (!allowHttp && Uri.TryCreate(endpoint, UriKind.Absolute, out var entered) && entered.Scheme == "http")
    {
        Console.WriteLine("HTTP에는 통신 암호화가 없습니다. 확인된 회사망 장비에서만 사용하세요. 비밀번호 평문/Basic 인증은 전송하지 않습니다.");
        allowHttp = Prompt("이 HTTP 서비스 주소로 읽기 시험을 진행하려면 Y 입력: ").Equals("Y", StringComparison.OrdinalIgnoreCase);
    }
    var parsed = OnvifClient.ParseEndpoint(endpoint, allowHttp);
    if (parsed.Scheme == "https") pin ??= Prompt("장비 인증서 SHA-256 지문 (Enter: 운영체제의 정상 인증서 검증): ");
    string label = Prompt("대상 위치명 (백운대/숨은벽 등, 로컬 파일에만 저장): ");
    string uuidInput = Prompt("대상 SSM UUID (Enter: 매핑 미확인): ");
    Guid? cameraUuid = null;
    if (uuidInput.Length > 0)
    {
        if (!Guid.TryParse(uuidInput, out var id) || id == Guid.Empty) throw new ProbeException("SSM_UUID_INVALID");
        cameraUuid = id;
    }
    string username = Prompt("장비 ONVIF 사용자 ID (SSM 계정과 다를 수 있음): ");
    string password = Password();
    using var client = new OnvifClient(endpoint, allowHttp, pin, username, password, report);
    username = ""; password = "";
    Console.WriteLine("장비 정보 및 제공 서비스 조회 중...");
    var identity = await client.DeviceInformation();
    await client.Capabilities();
    var profiles = await client.Profiles();
    Console.WriteLine("프로파일 목록 (회사 PC에서만 확인하고 외부에 공유하지 마세요):");
    for (int i = 0; i < profiles.Count; i++)
        Console.WriteLine($"{i + 1}: {profiles[i].name ?? "(이름 없음)"} / PTZ 설정 {(profiles[i].hasPtz ? "있음" : "없음")}");
    if (!profiles.Any(p => p.hasPtz)) throw new ProbeException("PTZ_PROFILE_NOT_FOUND");
    if (!int.TryParse(Prompt("대상 카메라로 확인한 PTZ 프로파일 번호 (취소: Enter): "), out int selected) ||
        selected < 1 || selected > profiles.Count || !profiles[selected - 1].hasPtz)
        throw new ProbeException("EXPLICIT_PTZ_PROFILE_REQUIRED");
    Console.WriteLine("선택한 프로파일의 GetStatus를 1회 조회합니다...");
    var sample = await client.Status(selected - 1);
    outputRoot = NewFolder(outputRoot);
    var payload = new { schemaVersion = 1, source = "onvif-get-status", endpoint, locationLabel = label,
        ssmUuid = cameraUuid?.ToString(), mappingVerified = false, identity, profile = profiles[selected - 1], sample,
        unitInterpretation = "Use returned space; degrees, north bearing and optical FOV NOT VERIFIED" };
    await File.WriteAllTextAsync(Path.Combine(outputRoot, "ptz-status.private.json"), JsonSerializer.Serialize(payload, Options()));
    Console.WriteLine($"결과: {report.result} / Pan={Value(sample.pan)} / Tilt={Value(sample.tilt)} / Zoom={Value(sample.zoom)}");
    Console.WriteLine("값이 0인 것과 미수신을 구분합니다. 반환값을 각도·북쪽 방향·화각으로 자동 변환하지 않습니다.");
    Console.WriteLine("SSM UUID 매핑과 실시간 갱신은 별도 확인이 필요합니다. 기존 앱 설정은 변경하지 않았습니다.");
}
catch (Exception e)
{
    exitCode = 1; report.result = "failed";
    report.error = e switch
    {
        ProbeException => e.Message,
        HttpRequestException => report.certificateRejected ? "DEVICE_CERTIFICATE_REJECTED" : "DEVICE_CONNECTION_FAILED",
        OperationCanceledException => "TIMEOUT_OR_CANCELLED",
        XmlException => "XML_RESPONSE_INVALID",
        IOException => "LOCAL_IO_FAILED",
        _ => "PROBE_FAILED"
    };
    Console.WriteLine("결과: " + report.error);
    Console.WriteLine("주소/권한/시각 오류를 확인하세요. 다른 암호·포트 자동 재시도나 장치 설정 변경은 하지 않습니다.");
}
finally
{
    try
    {
        if (!Path.GetFileName(outputRoot).StartsWith("test-", StringComparison.Ordinal)) outputRoot = NewFolder(outputRoot);
        await File.WriteAllTextAsync(Path.Combine(outputRoot, "ptz-check-report.json"), JsonSerializer.Serialize(report, Options()));
        Console.WriteLine("공유용 결과: " + Path.Combine(outputRoot, "ptz-check-report.json"));
        Console.WriteLine("ptz-status.private.json에는 주소/식별정보가 있으므로 공개하지 마세요.");
    }
    catch { Console.WriteLine("결과 파일 저장 실패."); exitCode = 1; }
    if (!Console.IsInputRedirected) { Console.WriteLine("Enter를 누르면 종료합니다."); Console.ReadLine(); }
}
return exitCode;

static JsonSerializerOptions Options() => new() { WriteIndented = true };
static string Value(double? value) => value?.ToString("R", CultureInfo.InvariantCulture) ?? "미수신";
static string Prompt(string message) { Console.Write(message); return Console.ReadLine()?.Trim() ?? ""; }
static string NewFolder(string root)
{
    string folder = Path.Combine(root, "test-" + DateTimeOffset.UtcNow.ToString("yyyyMMdd-HHmmss") + "-" + Guid.NewGuid().ToString("N")[..8]);
    Directory.CreateDirectory(folder); return folder;
}
static string Password()
{
    Console.Write("장비 비밀번호 (화면에 표시/저장하지 않음): ");
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
