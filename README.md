# Wisenet CCTV 3D Wildfire Monitoring

Wisenet SSM/NVR에 연결된 산불감시 CCTV의 위치와 방향을 국립공원별 VWorld 3D 지도에서 표시하는 프로젝트.
최종 목표는 중앙 PTZ Bridge + 여러 PC의 브라우저에서 회전형 CCTV의 현재 촬영 방향을 계속 확인하는 것입니다.
현재 라이브 PTZ/자동 방향 추적은 미구현입니다. 수동 범위의 지형 가림 표본 시안은 지원하며 실제 촬영 가시영역은 미검증입니다.

## 산에 가리는 구간 시안 (2026-10-13)

**관측 범위 → 선택 카메라 지형 가림 계산**에서 지도 표면 높이를 읽고 가시선을 비교합니다.
사용자가 정한 렌즈 높이 3m를 기본 시험값으로 사용하며 초록 비가림 추정·빨강 가림 추정·노랑 미확인으로 구분합니다.
카메라별로 계산한 결과를 함께 표시하고 입력 변경 시 재계산합니다. 최대 5,000m이며 실제 PTZ·수직 화각·차폐 정확도는 미검증입니다.
[사용법·높이 조회와 계산 한계](docs/terrain-visibility.md).

## 선택 지점의 위치·지번 조회 (2026-10-13)

지도 상단 **위치·지번**에서 지형 지점을 클릭하면 좌표와 VWorld 지번 주소를 조회하고 복사할 수 있습니다.
등록된 지도 키를 재사용하며 **Geocoder API(주소·좌표 변환)** 사용 설정이 필요합니다.
주소 조회 실패에도 좌표는 남습니다. 실제 화재 위치와의 일치 및 실서비스 주소 응답은 별도 확인해야 합니다.
[사용법·조회 근거와 한계](docs/location-parcel-lookup.md).

## 카메라별 관측 범위 시안 (2026-10-13)

지도 상단 **관측 범위**에서 각 카메라의 방위각·수평 화각·표시 거리를 입력하면 여러 대의 부채꼴을 동시에 표시합니다.
카메라별 표시, 선택한 한 대 보기, 슬라이더 조정과 명시적 브라우저 저장/파일 보관을 지원합니다.
미입력 방향은 UNKNOWN으로 유지합니다. 현재 촬영 범위와 산에 가리는 구간은 확정하지 않습니다.
[범위 시안 사용과 한계](docs/camera-coverage.md).

## 지도 연결과 지도 위 인터페이스 (2026-10-11)

회사 PC 화면 수집 시험은 결과를 기다리고, VWorld 지도 연결을 먼저 진행합니다.
카메라 선택·참조 영상·가상 시점 조절을 지도 위 패널로 배치했습니다. 지도 마커 선택과 슬라이더 자동 적용을 지원합니다.
GitHub Actions의 `VWORLD_API_KEY` Secret으로 지도 전용 Pages 웹사이트를 빌드/배포하는 경로를 추가했습니다.
운영 키 등록, 허용 사이트 및 Pages 활성화 후 실제 키 인증·지형 표출을 확인해야 합니다.
2026-10-12 보완한 실제 주소의 뷰어를 배포한 뒤 사용자가 지도 표출 성공을 확인했습니다.
GitHub Secret 값이 SDK 요청에 반영되는 것도 확인했습니다. 키 재입력은 필요 없으며, 지형 정합과 촬영 방향 정확도는 별도 검증 대상입니다.
Pages는 회사 Bridge/영상과 연결하지 않습니다. 사용자가 승인한 북한산 경계·탐방로와 카메라 이름·좌표 9개를
파일 선택 없이 기본 표시합니다. 로그인은 후속 작업이며 현재 기본 지도 자료는 공개됩니다.
[Secrets/Pages 설정 방법](docs/vworld-github-pages.md). 브라우저 지도 키는 배포 JavaScript와 요청에서 확인 가능하므로 등록 주소 제한을 적용합니다.

## 현재 우선 작업 — 한 대의 실시간 화면 입력 (2026-10-11)

SSM 영상이 표시되는 동일 회사 PC에서 도구를 실행할 수 있다는 사용자 확인에 따라,
선택한 영상 영역을 1초마다 읽는 Windows 도구와 브라우저의 **실시간 화면 시험** 탭을 구현했습니다.
카메라 제어/계정 추출/직접 스트림 요청은 없습니다. 가림·최소화·중지·수집 만료 시 이전 화면을 숨깁니다.
화면 변화만 감지하며 방향은 UNKNOWN입니다. 실제 SSM 영상의 캡처 호환성은 현장 검증이 필요합니다.
정지 화면의 보정은 해당 촬영 시각의 기준이고 회전/줌 변경 뒤 현재 방향을 확정하지 않습니다.
[실행·중지·결과 확인](docs/screen-capture.md) · [Windows 패키지](docs/windows-demo.md).

## 현재 우선 작업 — 영상·지형 보정

사용자 요청(2026-10-10)에 따라 PTZ 인증 조사를 보류하고 백운대 한 대의 영상·지형 수동 보정을 먼저 진행합니다.
실제 설치 위치 확인을 받았습니다. 사용자 승인 카메라 이름·좌표 9개는 Pages 기본 지도에 포함하고
장비 UUID·원본 운영 자료는 private 자료에 보관합니다. 주간 화면·시각·사용자 지형 설명을 확보했고 실지도 대응은 미검증입니다.
참조 이미지를 브라우저에서 표시하고 가상 방위각·기울기·화각·높이를 맞춰 추정 설정을 저장하는 화면을 구현했습니다.
이미지는 업로드하지 않으며 촬영 시각/해시/기준점 메타데이터와 가상 시점만 저장합니다.
결과는 정확도 미검증 추정입니다. 실제 VWorld 인증/지형·영상 정합과 자동 방향 추적은 미검증/미구현입니다.
[보정 사용방법](docs/terrain-calibration.md) · [Windows 패키지](docs/windows-demo.md).

## 현재 구현 — Phase 1

중앙 ASP.NET Core Bridge가 전체 목록 입력 파일을 읽고, 동일 서버에서 React 웹앱을 제공합니다.
브라우저에서 이름/UUID/장치/채널/PtzCap을 검색하고 필요한 카메라를 선택하면 중앙
`config/cameras.json`에 저장됩니다. 사용자 PC에는 브라우저만 필요합니다.
대상 수는 제한하거나 9대로 고정하지 않습니다.

**웹앱의 라이브 SSM 목록 어댑터는 아직 미구현입니다.** 별도 현장 진단에서 정상 인증·목록·로그아웃과
고유 UUID 146개를 확인했습니다. 계정/서버의 전체 등록 범위와 현재 PTZ는 계속 미확인입니다.
현재 `ICameraInventorySource`의 파일 어댑터로 조회 이후 흐름을 검증합니다.
입력 파일은 Bridge가 정의한 형식이며 SSM의 원본 응답 형식이 아닙니다.
`config/inventory.example.json`의 카메라는 모두 합성 데이터입니다.

- 조회: `GET /api/inventory` (입력 파일과 SHA256 버전, `liveSsmConnected=false`)
- 현재 선택 설정: `GET /api/cameras` (`revision`, `configuration`)
- 선택 저장: `PUT /api/cameras` (`X-Inventory-Write-Key` 필수)
- 프로세스 상태: `GET /health` (SSM 연결이나 데이터 준비 상태를 보증하지 않음)
- 지도 설정: `GET/PUT /api/map-configuration` (별도 파일, 저장 키와 revision 충돌 검사)
- VWorld 연결/가상 시점 시안은 구현했으며 PTZ 전송, 구독, WebSocket은 미구현입니다.

접근 설계와 UNKNOWN 확인 목록은 [Camera Inventory 설계](docs/camera-inventory.md)를 참조하세요.
추가 PTZ 코드 추적 문서의 기존/신규 비교와 반영 범위는 [추가 handoff 비교](docs/ptz-trace-review.md)에 정리했습니다.

## 개발 및 실행

설치 없이 Windows PC에서 샘플 UI를 테스트하려면 [Windows 실행 패키지 안내](docs/windows-demo.md)를
참조하세요. 빌드 PC에서는 의존성 설치 후 `python3 scripts/build-portable.py`로 Windows x64
ZIP을 만듭니다. 사용자 PC에는 Git/.NET/Node.js가 필요하지 않습니다. 이 패키지는 실제 SSM에 연결하지 않습니다.

필수: .NET SDK 8.0.425 (`global.json`), Node.js 22.12 이상 또는 24, npm, Python 3.
Linux x64 클라우드에서는 저장소 루트에서 `bash scripts/setup-cloud.sh`로 SDK 검증 설치,
잠금 파일 기반 의존성 설치, 웹/Bridge 빌드, HTTP 통합 테스트를 수행합니다.
Chromium이 설치되어 있으면 브라우저 테스트도 실행합니다. 이 스크립트는 CCTV에 연결하지 않습니다.

도구가 이미 설치된 일반 개발 환경에서는:

```sh
cd web
npm ci
npm run build -- --outDir ../bridge/WisenetPtzBridge/wwwroot --emptyOutDir
cd ..
dotnet build bridge/WisenetPtzBridge -c Release
python3 tests/test_inventory.py
```

Bridge 실행 전 환경변수를 설정하세요. 루트 `.env.example`은 참조용이며 자동 로드되지 않습니다.

| 변수 | 용도 |
| --- | --- |
| `INVENTORY_FILE` | Bridge 형식으로 검증·정규화된 전체 목록 JSON의 절대 경로 |
| `CAMERA_CONFIG_FILE` | 중앙 선택 설정의 절대 경로, 예: 저장소의 `config/cameras.json` |
| `MAP_CONFIG_FILE` | 중앙 위치·영상 보정 설정의 별도 절대 경로 |
| `INVENTORY_WRITE_KEY` | 운영자가 안전하게 관리하는 설정 저장 키. 미설정 시 쓰기 비활성 |
| `ASPNETCORE_URLS` | 개발 기본값 `http://127.0.0.1:5080`; 중앙 배포 시 프록시/네트워크에 맞춰 지정 |

```sh
cd bridge/WisenetPtzBridge
dotnet bin/Release/net8.0/WisenetPtzBridge.dll
```

합성 목록으로만 시연하려면 `INVENTORY_FILE`을 `config/inventory.example.json`의 절대 경로로
지정하고, `CAMERA_CONFIG_FILE`은 운영 설정과 다른 임시 경로로 지정하세요. 실제 SSM 목록처럼
취급하면 안 됩니다. 키는 서버 환경/비밀 관리에 설정하고 UI에 입력하며, 브라우저 저장소에 보관하지 않습니다.

웹 개발 서버는 `web`에서 `npm run dev`로 시작합니다. `/api`는 중앙 Bridge의 개발 포트로
프록시합니다. 중앙 배포에서는 빌드한 웹앱을 Bridge가 직접 제공하므로 API 주소를 사용자 PC의
localhost로 설정할 필요가 없습니다. 인터넷이나 내부망에 제공할 때는 접근 가능한 중앙 호스트와
TLS/인증 프록시, 방화벽 접근 제어를 구성하세요. 조회 API도 인증 프록시로 보호해야 합니다.
Vite 개발 서버를 운영 서비스로 공개하지 마세요. SSM DLL은 브라우저로 배포하지 않습니다.

브라우저 테스트는 위 웹/Bridge 빌드 후 `web`에서 `npm run test:e2e`를 실행합니다.
Playwright Chromium이 필요하며, 시스템 Chromium은 `CHROMIUM_EXECUTABLE`로 지정할 수 있습니다.
`DOTNET_EXECUTABLE`로 dotnet 경로를 지정할 수도 있습니다. 테스트 서버와 파일은 임시로 만들어
종료 시 정리하며 운영 설정을 사용하지 않습니다.

## Codex 시작 순서
1. `CODEX_HANDOFF.md` 전체 읽기
2. `TASKS.md` 읽기
3. `docs/verified-findings.md` / `docs/open-questions.md` 읽기
4. **Camera Inventory**부터 구현
5. 현재 사용자 결정: 영상·지형 수동 보정 한 대 → 실제 정합 확인 → 확장. 현재 PTZ 조회 조사는 보류.

## 폴더
- `bridge/` : SSM/NVR 연동, PTZ 상태 API
- `web/` : VWorld 3D 웹앱
- `config/` : 공원/카메라 설정
- `docs/` : 분석 결과/설계
- `probe/` : 실험용 코드

운영 CCTV이므로 초기 개발은 읽기 전용으로 진행한다.

## VWorld 위치 모니터링 시안

지도 모니터링 탭에 북한산 임의 좌표, VWorld v3 연결, 좌표 JSON 입력/내보내기와 수동 시험 부채꼴을 추가했습니다.
실제 SSM/PTZ/영상은 연결하지 않습니다. 지도 키와 등록 주소가 필요하며 클라우드 실지도 접속은 아직 미검증입니다.
[지도 실행과 좌표 형식](docs/vworld-monitoring.md) · [영상 방향 추정 검토](docs/video-direction-feasibility.md)

Pages는 북한산 공원경계·탐방로와 카메라 설치 위치 9개를 기본 표시합니다.
지도 상단 **지도 레이어**에서 개별 레이어 표시를 조정합니다. 다른 지도자료 JSON 사용도 선택 메뉴로 지원합니다.
일반 Bridge/Windows 빌드는 중앙 설정과 기존 시험 좌표를 유지합니다. [지도 레이어 사용·변환](docs/map-layers.md).

## 장치 설정 리포트 가져오기

카메라 목록 탭에서 SSM Excel XML(.xls) 리포트를 읽고 이름/Guid/모델/PTZ 지원 표시를 가져올 수 있습니다.
원본 접속 정보는 전달하지 않습니다. 전체 목록 여부·수집 시각을 확인한 뒤 필요한 카메라를 선택해 저장하세요.
실제 PtzCap/현재 방향은 UNKNOWN입니다. [가져오기 방법](docs/ssm-report-import.md).

## 원본 DLL 조사

제공된 6개 SSM DLL을 실행 없이 분석해 카메라 모델 변환, 로그인/목록 Stub 호출과 PTZ 경로를 확인했습니다.
원본/전체 디컴파일 소스는 공개 저장소와 패키지에 포함하지 않습니다. 현재 PTZ 수신은 미검증입니다.
[확인된 사실과 다음 파일](docs/ssm-dll-analysis.md).

추가 WebServiceStub/ControllerService에서 실제 인증·목록 조회 계약과 페이지/배치를 정적으로 확인했습니다.
인증/목록 현장 접속은 아래 결과로 확인했고 현재 PTZ는 미검증입니다. [추가 분석 및 현장 확인 순서](docs/ssm-web-controller-analysis.md).

추가 SystemService/LiveViewer에서 중앙 PTZ 요청·이벤트 라우터를 확인했습니다.
일반 콜백의 수신과 실장비 연결은 미검증입니다. [라우팅 분석](docs/ssm-routing-analysis.md).

## 회사 PC에서 실제 SSM 연결 시험

별도 **SsmConnectionTest.exe**는 인증서 SHA-256 지문을 고정한 HTTPS 상태 조회와 선택적 정상 로그인·목록 조회를 제공합니다.
Git/.NET/Node.js 설치가 필요 없는 Windows x64 패키지는 Actions의 **SSM connection test**에서 받습니다.
카메라 이동/설정/영상 요청은 없으며 기존 지도 데모·선택 설정을 변경하지 않습니다.
운영 서버 연결은 회사 PC에서 검증해야 합니다. [실행 및 결과 공유 방법](docs/ssm-connection-test.md).

회사 PC에서 지문 고정 HTTPS 로그인·목록 조회·로그아웃이 성공했고 고유 UUID 146개를 확인했습니다.
이전 보고서의 140개가 모두 포함됩니다. 전체 범위 및 현재 PTZ는 계속 미확인입니다.
[현장 검증 결과](docs/ssm-live-inventory-validation.md).

진단 v2는 동일 목록 조회에서 설치 형태·장치 capability·저장 좌표/heading을 추가로 읽고,
운영 값은 camera-metadata.private.json에만 기록합니다. 현재 PTZ 또는 북쪽 보정으로 확정하지 않습니다.

진단 v3는 선택한 한 대의 등록 주소·포트를 같은 목록 응답에서 추가 추출할 수 있습니다.
운영 주소는 camera-connection.private.json에만 보관하며 카메라 계정/비밀번호는 제외합니다.
주소창 없는 설정 화면의 접속 정보 대조에 사용하고, 추출값으로 다른 장비에 자동 접속하지 않습니다.
회사 PC v3에서 선택 한 대의 등록 접속 정보를 확인했습니다. 후속 TCP 시험은 카메라 HTTP 80과
component 4510 성공, 카메라 HTTPS 443 실패입니다. 후속 화면에서 Hanwha Vision WebViewer와
인증 요구와 후속 WWW-Authenticate=Digest 답변을 관측했습니다. [인증 응답 확인 기록](docs/camera-web-auth-check.md).
고유 장비 매핑과 현재 PTZ 수신은 아직 미검증입니다.
카메라 장비 계정은 미확인입니다. 아래 CONTROL 조사와 진단 v5 현장 실행은 현재 사용자 요청으로 보류합니다.
진단 v4의 현장 결과에서 한 대의 컴포넌트/MediaGateway 참조 일치와 로그인 키/UID 존재를 확인했습니다.
진단 v5는 한 대 선택 후 현재 로컬 도메인 GET을 한 번 선택 실행하여 인증 도메인 후보를 대조합니다.
운영 값은 private 파일에 보관하며 CONTROL 접속·PTZ 요청은 아직 추가하지 않습니다.
[GoogleMapViewer 추가 분석과 설치 경로](docs/ssm-google-map-analysis.md).


## 단일 카메라의 현재 PTZ 읽기 시험

대상 설정 사진은 SUNAPI 등록 방식입니다. 공식 현재 위치 명세와 실제 서비스 정보를 우선 확인합니다.
ONVIF 서비스가 별도 확인되면 설치 없는 Windows `PtzReadOnlyTest.exe`로 대상 프로파일의
GetStatus를 1회 읽을 수 있습니다. 합성 장비 시험과 운영 카메라 상태 수신은 구분하며 이동·설정 명령은 없습니다.
[실행 방법](docs/ptz-readonly-test.md) · [남은 조사와 영상 보정 전환 기준](docs/ptz-investigation-decision.md).
