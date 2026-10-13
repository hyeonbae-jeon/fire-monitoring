# GitHub Secrets로 VWorld 지도 시험 배포

회사 PC 없이 브라우저에서 지도 인터페이스를 시험하기 위한 정적 웹사이트입니다.
중앙 PTZ Bridge + VWorld 3D라는 최종 구조는 유지합니다. 이 Pages 시험에서는 회사 API를 호출하거나
CCTV 영상/사용자가 선택한 파일을 업로드하지 않습니다. 사용자 요청에 따라 북한산 공원경계·탐방로와
카메라 이름·설치 좌표 9개를 기본 자료로 표시합니다. 현재 로그인 기능은 없으며 이 기본 자료는 공개됩니다.
원본 GPKG/UUID/IP/계정/영상은 포함하지 않습니다. 별도 입력과 편집은 브라우저에서 사용하며 JSON 다운로드로 보관합니다.

## 설정할 항목

1. 저장소 [Settings → Secrets and variables → Actions](https://github.com/hyeonbae-jeon/fire-monitoring/settings/secrets/actions)에서
   **New repository secret**을 누릅니다. 이름은 `VWORLD_API_KEY`, 값은 VWorld **3D 지도에 사용할 수 있는 브라우저 키**입니다.
   키를 채팅/소스/좌표 JSON에 넣지 않습니다. 다른 저장소에 저장한 Secrets는 자동 공유되지 않습니다.
2. VWorld 키 관리 화면에서 실제 시험 주소 `https://hyeonbae-jeon.github.io/fire-monitoring/`를 허용하는지 확인합니다.
   기존 `bukhansan-weather/`와 호스트는 같지만 경로까지 제한하는지는 확인이 필요합니다.
   기존 키가 허용하지 않으면 등록 주소를 수정하거나 시험용 키를 발급합니다. 등록 도메인을 요청에 위장하지 않습니다.
3. [Settings → Pages](https://github.com/hyeonbae-jeon/fire-monitoring/settings/pages)에서 **Source: GitHub Actions**를 선택합니다.
4. [Actions](https://github.com/hyeonbae-jeon/fire-monitoring/actions)의 **VWorld map preview** 실행을 확인합니다.
   키가 없으면 배포 전에 `Add repository Actions secret VWORLD_API_KEY` 안내와 함께 실패합니다.
   키를 추가한 뒤 해당 실행의 **Re-run all jobs**를 누릅니다. 워크플로가 기본 브랜치에 있으면 Run workflow로도 실행할 수 있습니다.
5. 배포 성공 뒤 `https://hyeonbae-jeon.github.io/fire-monitoring/`에서 지도 초기화와 북한산 지형이 실제로 보이는지 확인합니다.

기능 브랜치 배포가 `github-pages` 환경 규칙으로 거부되면 Settings → Environments → github-pages의
Deployment branches에서 `feat/vworld-monitoring-prototype`을 허용하거나, PR 검토/병합 뒤 main에서 배포합니다.
기본 브랜치 병합은 자동으로 수행하지 않습니다.

## 키가 사용되는 방식

Actions는 `VWORLD_API_KEY`를 빌드 단계의 `VITE_VWORLD_API_KEY`로 전달합니다.
키를 소스에 직접 작성하지 않으며, 지도 전용 모드는 `VITE_MAP_ONLY=true`, 경로는 `/fire-monitoring/`으로 빌드합니다.
**브라우저 SDK용 키는 완성된 웹 JavaScript와 지도 요청에서 확인할 수 있습니다.** GitHub Secrets는 빌드 전 값을 관리하는 장소이며,
배포 후 키를 브라우저에서 숨기지는 못합니다. VWorld의 등록 사이트 제한을 적용합니다.
SSM 계정/비밀번호, Bridge 저장 키, 영상 조회 키는 이 빌드 변수에 넣지 않습니다.

기존 Bridge 배포에서는 `VWORLD_API_KEY` 환경 변수를 설정하면 `/api/map-client-settings`를 통해
브라우저용 지도 키만 전달합니다. 지도 탭을 열면 자동 연결하며, **지도 연결**에서 직접 키 입력 또는 재연결도 가능합니다.
등록된 키가 있으면 **등록된 지도 키 자동 사용** 안내가 표시됩니다. 직접 입력은 **다른 키로 연결 (선택)** 안의 대체 수단입니다.
Windows 루프백 주소와 Pages 주소가 모두 허용되는지는 각각 확인해야 합니다.

## 지도 안의 조작

- 왼쪽 **카메라·설정**: 위치 선택/입력, 로컬 JSON 불러오기/다운로드, Bridge 모드의 중앙 저장.
- 왼쪽 **관측 범위**: 카메라별 방향·화각·표시 거리 시안과 지도 표면의 지형 가림 시안을 표시합니다. 시험 렌즈 높이는 기본 3m입니다. 미입력 방향/현재 촬영 범위는 미확인입니다. [범위 사용법](camera-coverage.md) · [지형 가림](terrain-visibility.md).
- 왼쪽 **지도 레이어**: 기본 공원경계·탐방로의 개별 표시 및 전체 보기. 파일 선택은 필요 없으며 다른 자료 사용은 선택 메뉴입니다. [자료 형식·보관](map-layers.md).
- 왼쪽 **위치·지번**: 지형 지점 선택 또는 좌표 직접 입력으로 지번 주소를 조회합니다. 적용 중인 키의 Geocoder API 사용 설정이 필요합니다. [사용법·확인 상태](location-parcel-lookup.md).
- 오른쪽 위 **참조 영상**: 로컬 CCTV 이미지, 촬영 시각과 기준점 이름.
- 오른쪽 아래 **가상 시점 조정**: 방위각/기울기/수평 화각/높이. **슬라이더 자동 적용**은 250ms 뒤 지도 시점에 반영합니다.
- 실제 지도 마커를 눌러 위치를 선택합니다. 카메라를 바꿔도 지도 뷰어는 유지됩니다.
- 사진 없이 가상 지도 시점을 시험할 수 있습니다. 추정값 저장에는 실제 설치 위치와 기존의 촬영 시각/기준점 근거가 필요합니다.
- **일반 지도 보기**로 지도 마우스 조작을 다시 켭니다. 이 조작은 CCTV 제어/실측 PTZ 수신이 아닙니다.

SDK 초기화 메시지는 실제 지형 타일 성공과 구분합니다. 키 인증/실제 지형 표출은 운영 키와 등록 주소를 갖춘 배포에서 확인해야 합니다.
현재 자동 지형 정합, 실시간 방향 추적 및 정확도 검증은 구현 완료 항목이 아닙니다.

## 2026-10-12 확인 상태

실제 앱 주소의 `vworld-viewer.html`에서 SDK를 실행하도록 보완한 배포 후,
사용자가 Ctrl+F5 새로고침 뒤 지도 표출 성공을 보고했습니다. GitHub Secret 값과 실제 SDK 요청 키의 일치도 값 노출 없이 확인했습니다.
사이트의 키 입력란은 대체 입력 수단이며 등록된 키 사용 시 다시 입력하지 않습니다.
클라우드의 별도 실사이트 진단은 SDK 서버의 HTTP/2 stream 거부/HTTP/1 빈 응답으로 실패했습니다.
이는 해당 환경의 실패 결과로 남기며 원인을 지역/인증/방화벽 등으로 추측하지 않습니다. 사용자 환경의 지도 표출 성공과 구분합니다.
지형·영상 정합과 회전형 카메라의 실제 방향 정확도는 아직 확인하지 않았습니다.
