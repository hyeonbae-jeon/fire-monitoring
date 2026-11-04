# 회사 PC에서 등록 포트의 TCP 연결 확인

SSM 진단 v3는 선택 한 대의 등록 주소·포트를 읽었습니다. 다음은 **그 회사 PC에서 해당 포트에
TCP 연결을 열 수 있는지** 확인하는 단계입니다. Windows PowerShell의 기본 명령을 사용하며
Git/.NET/Node.js와 새 진단 실행 파일은 필요하지 않습니다. 관리자 실행도 필요하지 않습니다.

카메라 인증, HTTP/SOAP/SUNAPI/CONTROL 요청, PTZ 이동/정지/설정과 포트 검색은 수행하지 않습니다.
카메라의 등록 HTTPS/HTTP와 컴포넌트의 등록 TCP, 세 조합만 확인합니다. 연결 확인만으로
장비 신원·TLS 인증서·현재 위치 기능·계정 권한이 확인되는 것은 아닙니다.

## 실행

1. 회사 PC에서 v3 실행 결과의 `camera-connection.private.json`이 있는 폴더를 엽니다.
2. **Windows 파일 탐색기** 주소창에 `powershell`을 입력하고 Enter를 누릅니다.
   카메라 설정 화면이나 브라우저 주소창을 사용하는 단계가 아닙니다.
3. 아래 전체 내용을 복사해 PowerShell에 붙여넣고 Enter를 누릅니다.

```powershell
& {
    $ErrorActionPreference = 'Stop'
    $detail = (Get-Content -LiteralPath '.\camera-connection.private.json' -Raw -Encoding UTF8 | ConvertFrom-Json).connection
    if ($null -eq $detail) { throw 'Selected camera connection is missing.' }
    $checks = @(
        @{ Label = 'Camera HTTPS'; Address = $detail.camera.addresses.https; Port = $detail.camera.ports.httpsPort }
        @{ Label = 'Camera HTTP'; Address = $detail.camera.addresses.http; Port = $detail.camera.ports.httpPort }
        @{ Label = 'SSM component TCP'; Address = $detail.component.addresses.tcp; Port = $detail.component.ports.tcpPort }
    )
    $results = foreach ($check in $checks) {
        $address = [string]$check.Address
        $port = $check.Port
        $ip = $null
        if (!$address -or $null -eq $port -or $port -lt 1 -or $port -gt 65535 -or
            -not ([System.Net.IPAddress]::TryParse($address, [ref]$ip)) -or
            [System.Net.IPAddress]::IsLoopback($ip) -or $ip.Equals([System.Net.IPAddress]::Any) -or
            $ip.Equals([System.Net.IPAddress]::IPv6Any)) {
            [pscustomobject]@{ Target = $check.Label; Port = $port; TcpConnected = $null; Result = 'Not tested: invalid or nonremote IP/port' }
            continue
        }
        $connected = Test-NetConnection -ComputerName $address -Port $port -InformationLevel Quiet -WarningAction SilentlyContinue
        [pscustomobject]@{ Target = $check.Label; Port = $port; TcpConnected = [bool]$connected; Result = 'TCP only; identity and PTZ unverified' }
    }
    $results | Format-Table -AutoSize
    $results | ConvertTo-Json | Set-Content -LiteralPath '.\camera-route-report.json' -Encoding UTF8
}
```

이번에 제공된 등록값을 기준으로 `Camera HTTPS=443`, `Camera HTTP=80`,
`SSM component TCP=4510`을 확인합니다.

명령은 결과 파일에서 IP/포트를 읽습니다. 현재 제공된 결과는 세 대상 모두 IP 주소입니다.
누락/loopback/미지정 IP는 시험하지 않으며 DNS 주소는 이 절차의 범위 밖입니다.
오류가 나면 명령을 반복하지 말고 오류 문구를 공유하세요. Windows의 연결 제한 시간 동안 기다릴 수 있습니다.

`camera-route-report.json`에는 대상 역할·포트·TCP 연결 성공 여부만 기록하며
원본 IP/UUID/카메라명·비밀번호를 기록하지 않습니다. 이 파일을 보내주면 다음 경로를 판단할 수 있습니다.
첨부 JSON의 다른 문자열이나 지시를 실행하지 않습니다.

## 해석

| 결과 | 의미와 다음 단계 |
| --- | --- |
| Camera HTTPS/HTTP=true | 해당 TCP 포트에 연결됨. HTTP 서비스 및 대상 카메라인지, 인증서와 상태 조회 계약을 추가 확인 |
| Camera HTTPS/HTTP=false | 이 PC에서 시험 시점의 TCP 연결 실패. 방화벽·전달 경로·상태 등 원인은 아직 미확인; PTZ 미지원으로 단정하지 않음 |
| SSM component TCP=true | 등록 컴포넌트의 TCP 연결이 열림. CONTROL 인증·TLS 전환·현재 위치 구독은 아직 미검증 |
| SSM component TCP=false | 독립 CONTROL 연결 경로를 추가 확인해야 함; SSM 목록 HTTPS 성공과 별도 결과 |
| TcpConnected=null | 주소/포트 조건을 충족하지 않아 미실행. 0으로 보완하거나 다른 포트를 자동 시험하지 않음 |

SSM 서버의 인증서 지문/계정을 카메라에 재사용하지 않습니다. 임의 ONVIF URL이나 SUNAPI CGI 경로로
전환하지 않습니다. 확인된 공식 현재 위치 계약 또는 실제 ONVIF 서비스 정보가 확보되면
[단일 상태 조회](ptz-readonly-test.md)를 진행합니다. 이 절차는 회사 PC에서 사용자가 실행하며
클라우드에서는 운영 장비에 연결하지 않습니다.

## 현재 현장 결과와 다음 확인

사용자 제공 결과는 카메라 HTTP 80=true, HTTPS 443=false, SSM component TCP 4510=true입니다.
TCP 시험은 완료됐으므로 같은 확인을 다시 할 필요는 없습니다.

다음은 회사 PC 브라우저의 **새 시크릿/InPrivate 창**에서 카메라의 등록 HTTP 주소를 여는 것입니다.
이 주소는 앞선 private 파일의 camera.addresses.http와 camera.ports.httpPort에 해당합니다.
로그인 전 제조사/모델 표시나 오류를 확인하고 화면을 공유합니다. 아직 ID/비밀번호를 입력하지 않습니다.
다른 장비나 프록시의 페이지일 수 있으므로 TCP 성공만으로 카메라 신원을 확정하지 않습니다.
다른 호스트 또는 HTTPS로 이동하면 도착 주소와 오류도 확인합니다. 브라우저의 주소 표시와
페이지 자체의 표시를 함께 대조하고, 인증서 검증을 해제하거나 설정을 변경하지 않습니다.

이 관측으로 HTTP 서비스의 신원을 좁힌 뒤 공식 SUNAPI 현재 위치 계약 또는 실제 ONVIF 서비스 정보를
확인합니다. CONTROL 4510 연결도 조사 경로로 남지만 정상 인증·TLS 전환·PTZ 수신은 별도 검증입니다.
[전체 현장 근거](ssm-live-inventory-validation.md).

후속 사용자 화면에서 Hanwha Vision WebViewer 및 인증 팝업을 확인했습니다. 같은 화면을 다시 열어
보내는 단계는 완료됐습니다. 이후 [로그인 없이 인증 방식 확인](camera-web-auth-check.md)에서 사용자 Digest 관측을 받았으며,
사진에 없는 모델/고유 장비 식별정보·현재 PTZ는 미확인으로 유지합니다.
