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

## 개발 및 실행

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
