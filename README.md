# Wisenet CCTV 3D Wildfire Monitoring

Wisenet SSM/NVR에 연결된 산불감시 CCTV의 실시간 PTZ 상태를 받아 국립공원별 VWorld 3D 지도에서 현재 감시방향과 가시영역을 표시하는 프로젝트.

## 현재 구현 — Phase 1

중앙 ASP.NET Core Bridge가 전체 목록 입력 파일을 읽고, 동일 서버에서 React 웹앱을 제공합니다.
브라우저에서 이름/UUID/장치/채널/PtzCap을 검색하고 필요한 카메라를 선택하면 중앙
`config/cameras.json`에 저장됩니다. 사용자 PC에는 브라우저만 필요합니다.
대상 수는 제한하거나 9대로 고정하지 않습니다.

**실제 SSM 전체 조회는 아직 미구현입니다.** 첨부 문서에서도 외부 조회 인터페이스는 UNKNOWN이며,
사용자도 미확인 상태라고 답했습니다. `/v3/channels`의 존재만으로 인증, 필드, 페이지 처리 등을
추정하지 않습니다. 현재 `ICameraInventorySource`의 파일 어댑터로 조회 이후 흐름을 검증합니다.
입력 파일은 Bridge가 정의한 형식이며 SSM의 원본 응답 형식이 아닙니다.
`config/inventory.example.json`의 카메라는 모두 합성 데이터입니다.

- 조회: `GET /api/inventory` (입력 파일과 SHA256 버전, `liveSsmConnected=false`)
- 현재 선택 설정: `GET /api/cameras` (`revision`, `configuration`)
- 선택 저장: `PUT /api/cameras` (`X-Inventory-Write-Key` 필수)
- 프로세스 상태: `GET /health` (SSM 연결이나 데이터 준비 상태를 보증하지 않음)
- PTZ 명령 전송, 구독, WebSocket, VWorld 지도는 구현하지 않았습니다.

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
5. 이후 선택 카메라 PTZ 구독 → Bridge API → VWorld 3D

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

## 장치 설정 리포트 가져오기

카메라 목록 탭에서 SSM Excel XML(.xls) 리포트를 읽고 이름/Guid/모델/PTZ 지원 표시를 가져올 수 있습니다.
원본 접속 정보는 전달하지 않습니다. 전체 목록 여부·수집 시각을 확인한 뒤 필요한 카메라를 선택해 저장하세요.
실제 PtzCap/현재 방향은 UNKNOWN입니다. [가져오기 방법](docs/ssm-report-import.md).

## 원본 DLL 조사

제공된 6개 SSM DLL을 실행 없이 분석해 카메라 모델 변환, 로그인/목록 Stub 호출과 PTZ 경로를 확인했습니다.
실제 연결은 미검증이며 원본/전체 디컴파일 소스는 공개 저장소와 패키지에 포함하지 않습니다.
[확인된 사실과 다음 파일](docs/ssm-dll-analysis.md).

추가 WebServiceStub/ControllerService에서 실제 인증·목록 조회 계약과 페이지/배치를 정적으로 확인했습니다.
실제 접속/현재 PTZ는 미검증입니다. [추가 분석 및 현장 확인 순서](docs/ssm-web-controller-analysis.md).

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
[GoogleMapViewer 추가 분석과 설치 경로](docs/ssm-google-map-analysis.md).


## 단일 카메라의 현재 PTZ 읽기 시험

대상 설정 사진은 SUNAPI 등록 방식입니다. 공식 현재 위치 명세와 실제 서비스 정보를 우선 확인합니다.
ONVIF 서비스가 별도 확인되면 설치 없는 Windows `PtzReadOnlyTest.exe`로 대상 프로파일의
GetStatus를 1회 읽을 수 있습니다. 합성 장비 시험과 운영 카메라 상태 수신은 구분하며 이동·설정 명령은 없습니다.
[실행 방법](docs/ptz-readonly-test.md) · [남은 조사와 영상 보정 전환 기준](docs/ptz-investigation-decision.md).
