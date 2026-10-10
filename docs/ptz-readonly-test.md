# 단일 카메라의 읽기 전용 현재 PTZ 시험

백운대 또는 숨은벽 한 대부터 ONVIF `GetStatus` 응답을 확인하는 별도 Windows 도구입니다.
SSM 목록 연결 성공과 장비 ONVIF 연결 성공은 서로 다른 검증입니다. 사용자가 제공한 두 대상 설정은 SUNAPI 등록 방식입니다. 이 도구는 ONVIF 서비스가 별도 확인될 때 사용하는 대안이며 SUNAPI 조회 기능은 없습니다. 실제 서비스 주소와 장비 계정,
프로파일이 확인되기 전에는 운영 장비에 실행하지 않습니다. 기본 경로·포트를 추측하거나 검색하지 않습니다.

## 회사 PC에서 먼저 확인할 것

1. SSM의 대상 카메라를 선택하고 설정 화면의 장치명/모델과 IP 및 포트·ONVIF 항목을 확인합니다.
   설정을 저장하거나 ONVIF를 새로 켜지 않습니다. 사진은 비밀번호를 가립니다.
2. **ONVIF Device 서비스 전체 URL**을 확인합니다. SSM 로그인 주소, 카메라 웹 설정 주소,
   RTSP 포트가 ONVIF 주소라는 뜻은 아닙니다. 웹 설정에 포트만 있다면 서비스 경로는 추가 확인이 필요합니다.
3. ONVIF가 이미 사용 가능하고 해당 계정으로 읽을 수 있는지 확인합니다. 장비 ONVIF 계정은 SSM 계정과
   다를 수 있습니다. 비밀번호는 회사 PC의 도구에만 입력하며 채팅/설정 파일에 저장하지 않습니다.
4. HTTPS라면 정상 인증서 검증을 사용합니다. 자체 서명 인증서는 **해당 장비의** 인증서 SHA-256 지문을
   확인해서 입력할 수 있습니다. SSM 서버 지문을 장비 지문으로 재사용하지 않습니다.

주소 확인 사진은 조회 경로를 선택하는 자료이며, 실제 지원/권한은 응답으로 검증합니다.
인터넷의 SUNAPI 경로를 추측하여 여러 포트·암호를 시험하지 않습니다.

## 설치 없이 실행

GitHub Actions의 **PTZ read-only test**에서 `PTZ-ReadOnly-Test-Windows` 아티팩트를 받습니다.
다운로드 ZIP 안의 `PTZ-ReadOnly-Test-win-x64.zip`도 풀고 `PtzReadOnlyTest.exe`를 실행합니다.
Git/.NET/Node.js 설치가 필요 없는 Windows x64 패키지입니다. 기존 프로그램과 다른 폴더를 사용합니다.

도구에 확인된 Device 서비스 URL, 선택적 장비 인증서 지문, 위치명, 선택적 SSM UUID,
장비 ID/비밀번호를 입력합니다. 프로파일 목록에서 **대상 영상으로 확인한 PTZ 프로파일 번호를 직접 선택**합니다.
NVR이나 여러 채널이 있는 장치에서 첫 번째 프로파일을 자동으로 고르지 않습니다. 번호를 모르면 Enter로 취소합니다.

HTTPS는 정상 TLS 검증 또는 유효기간 내의 정확한 지문 고정만 허용합니다. 인증서 검증을 전역 해제하지 않습니다.
HTTP 주소는 암호화가 없으므로 로컬 안내를 읽고 명시적으로 선택해야 합니다. 비밀번호 평문과 HTTP Basic은
전송하지 않지만 WS-Security/HTTP Digest도 HTTP 통신 자체를 암호화하지는 않습니다.
프로그램은 HTTPS에서 HTTP로 자동 전환하지 않습니다.

조회 순서:

```text
GetDeviceInformation → GetCapabilities → GetProfiles
→ 운영자가 대상 프로파일 선택 → GetStatus 1회
```

SOAP의 전송 방식은 POST이지만 허용한 네 작업은 읽기 작업입니다. WS-Security PasswordDigest와
정상 HTTP Digest challenge만 처리하며, 다른 암호 재시도나 Basic/평문 PasswordText로 전환하지 않습니다.
카메라 이동·정지·프리셋·설정·영상 요청과 SSM 조작권 획득은 구현하지 않았습니다.
원본 SSM DLL을 로드하거나 배포하지 않습니다.

응답의 Media/PTZ 서비스 주소가 입력 URL과 scheme/host/port가 다르면 자격 증명을 보내기 전에
`SERVICE_ORIGIN_MISMATCH`로 중단합니다. NAT 주소나 별도 서비스 포트일 수 있으므로
장비가 지원하지 않는다고 결론 내리지 말고 실제 서비스 주소를 확인해야 합니다.
Media1 방식의 GetProfiles를 사용하며 Media2만 제공하는 경우는 이번 도구의 지원 범위 밖입니다.

## 결과 공유와 해석

실행 폴더의 `diagnostics/test-…`에 결과를 저장합니다.

| 파일 | 내용 | 공유 범위 |
| --- | --- | --- |
| ptz-check-report.json | 작업별 HTTP 결과, 값 수신 여부, 오류 코드 | 주소/계정/UUID/원본 응답을 제외한 진단 결과 |
| ptz-status.private.json | 장비 주소·식별정보, 선택 프로파일/SourceToken, 입력 UUID, Pan/Tilt/Zoom 및 space·시각 | 회사 PC에서 보관; 공개 GitHub에 올리지 않음 |

`ptz-position-received`는 세 위치 값이 모두 반환됐다는 뜻입니다. `partial-position-received`와
`status-without-position`은 일부/전체 값 미수신이며 null을 0으로 바꾸지 않습니다.
서버 HTTP 200이나 MoveStatus만으로 위치 수신 성공을 판단하지 않습니다.
`AUTHENTICATION_OR_PERMISSION_REJECTED`는 인증/권한 확인이 필요하다는 뜻이며 자동 반복하지 않습니다.
`SOAP_NOT_AUTHORIZED_OR_CLOCK_SKEW`는 계정 또는 장비/PC 시각 문제 등을 구분해서 확인해야 합니다.

ONVIF 좌표는 정규화 값일 수 있습니다. 반환된 `space`를 함께 기록하며 각도·지리적 북쪽·화각으로
자동 변환하지 않습니다. 한 번 받은 값의 실시간 갱신과 물리적인 방향도 아직 입증되지 않습니다.
SSM UUID와 장비/프로파일의 매핑은 사용자 선택 기록일 뿐 자동 검증이 아닙니다.
앱의 선택·지도 좌표·보정 설정은 변경하지 않습니다.

## 구현 근거와 검증 범위

공식 [ONVIF Network Interface Specifications](https://github.com/onvif/specs),
commit `82b6f3d37f3cbca646c464c40278a85503e2282d`를 읽어 다음 WSDL의 작업과 namespace를 확인했습니다.

- [Device WSDL](https://github.com/onvif/specs/blob/82b6f3d37f3cbca646c464c40278a85503e2282d/wsdl/ver10/device/wsdl/devicemgmt.wsdl): GetDeviceInformation, GetCapabilities
- [Media WSDL](https://github.com/onvif/specs/blob/82b6f3d37f3cbca646c464c40278a85503e2282d/wsdl/ver10/media/wsdl/media.wsdl): GetProfiles
- [PTZ WSDL](https://github.com/onvif/specs/blob/82b6f3d37f3cbca646c464c40278a85503e2282d/wsdl/ver20/ptz/wsdl/ptz.wsdl): GetStatus

이것은 표준 계약의 근거이며 선택 장비의 ONVIF 구현/지원/권한을 증명하지 않습니다.
기존 `probe/WisenetPtzProbe.cs`는 원본 응답 출력과 자동 프로파일 선택이 있는 초기 실험이므로
이 절차에서는 사용하지 않습니다.

클라우드 검증은 실제 실행 파일과 합성 HTTP/HTTPS 장비 사이에서 수행합니다. 독립 WS-Security 및
HTTP Digest 검증, 네 읽기 작업만 전송, 프로파일 직접 선택·XML escaping, 지문/정상 TLS 검증,
다른 origin/리다이렉트/DTD/중복/비유한 숫자 차단, 누락과 0 구분, 민감 정보 제외를 검사합니다.
회사 운영 카메라의 상태 수신은 다음 현장 결과로 확인해야 합니다.

개발 PC의 빌드/검증/패키지 생성:

```sh
dotnet build bridge/PtzReadOnlyTest -c Release
python3 tests/test_ptz_readonly.py
python3 scripts/build-ptz-diagnostic.py
```
