# 자동 수신 서버와 현재 관측 범위

수신 서버가 카메라별 JPEG·현재 PTZ를 동시에 읽고, 저장한 `nativeTracking` 기준을 현재 값에 적용합니다.
브라우저에는 서버 로그인 세션으로 영상·PTZ·지도 설정만 전달합니다. 카메라 접속 주소·ID/PW는 보내지 않습니다.
최신 영상과 세 값이 4초 안에 들어온 카메라만 현재 관측 범위를 표시합니다. 중단·만료·기준 좌표 불일치는 범위를 숨깁니다.
다른 PC의 시계가 달라도 수신 서버의 시각과 응답 후 경과 시간으로 만료를 계산합니다.
관측 범위는 입력한 표시 거리와 현재 수평 화각을 적용한 **수평 근사 부채꼴**입니다. 지형 가림과 실제 식별 거리를 측정한 결과는 아닙니다.

## Windows 11 회사 PC: Docker 없이 사용

1. 기존 프로그램에서 중앙 지도 설정을 저장하고 `좌표 설정 다운로드`로 백업합니다.
2. 새 실행패키지를 모두 풀고, 기존 `data/map.demo.json`을 새 폴더의 같은 위치로 복사합니다.
   또는 설정 도구가 묻는 지도 JSON 경로에 다운로드한 9대 설정 파일을 지정합니다.
3. **서버설정.cmd**를 실행합니다. 9대의 영상 방식·주소·장비 ID/PW·표시 거리와 모니터링 로그인 정보를 한 번 입력합니다.
   한화 방식은 기본 웹 주소도 가능하며, NVT 산성주차장은 이미 확인한 GetImage 전체 주소를 가려진 입력란에 붙여넣습니다.
4. 실행파일을 다시 열면 서버 모드로 시작하며 9대를 자동 수신합니다. `http://127.0.0.1:5080`에 로그인하면 지도가 열립니다.
5. 새로 카메라를 선택하면 서버가 이미 수신 중인 영상이 표시됩니다. 저장한 기준으로 자동 계산하므로 카메라별 시작 버튼을 다시 누르지 않습니다.

접속 정보는 `data/server-settings.protected`에 Windows 현재 사용자 DPAPI로 암호화합니다.
파일은 같은 Windows 계정에서만 복호화합니다. 프로그램 업데이트 시 `data` 폴더를 보존합니다.
지도 설정은 별도의 `data/map.demo.json`에 저장하며 카메라 비밀번호가 들어 있지 않습니다.

로그인 후 자동 실행하려면 **서버자동시작등록.ps1**을 실행합니다. 작업 스케줄러에 현재 사용자 로그인 트리거로 등록합니다.
화면 잠금 상태에서도 프로세스가 계속 실행되지만 PC 종료·절전·로그아웃 때에는 수신이 멈춥니다.
PC 상태와 무관한 24시간 감시가 필요하면 아래 외부 서버 배포를 사용합니다.

### 다른 PC에서 접속

기본 수신 주소는 이 PC의 loopback으로 유지합니다. 다른 PC에서 보려면 HTTPS 접근 경로가 필요합니다.
회사에서 사용하는 VPN·HTTPS 프록시가 있으면 그것을 사용할 수 있습니다.
예를 들어 양쪽 PC를 같은 Tailscale 네트워크에 연결한 뒤 수신 PC에서 다음을 실행하면 로그인 페이지를 HTTPS로 제공합니다.

```powershell
tailscale serve --bg http://127.0.0.1:5080
```

Tailscale이 표시한 HTTPS 주소를 다른 PC에서 엽니다. 사이트에서 별도 모니터링 로그인을 요구합니다.
이 프로젝트가 VPN 계정·설치·접근 정책을 자동 변경하지는 않습니다.
VWorld 지도 키에도 실제 HTTPS 사이트 주소를 등록해야 합니다. 지도 키는 SDK 요청에 사용되는 브라우저 키이며 카메라 비밀번호와 다릅니다.

## GitHub Secrets 등록

GitHub Secrets는 GitHub Pages JavaScript에서 직접 읽을 수 없습니다. 비밀번호를 Vite 변수나 공개 ZIP에 넣지 않습니다.
현재 연결된 Codex GitHub 앱은 Secrets 관리 API가 HTTP 403으로 거절될 수 있으며, 그 권한은 코드 푸시 권한과 별개입니다.

설정한 회사 PC에서 GitHub CLI를 설치하고 저장소 Secrets를 관리할 수 있는 계정으로 로그인합니다.

```powershell
gh auth login --hostname github.com --web
```

그다음 **GitHub시크릿등록.cmd**를 실행합니다. Windows 암호화 설정을 메모리에서 읽어 `gh secret set`의 표준입력으로 등록합니다.
비밀번호를 명령행 인자·채팅·작업 로그에 넣지 않습니다. 다음 저장소 Actions Secrets를 사용합니다.

| 이름 | 용도 |
| --- | --- |
| `CCTV_CONNECTIONS_JSON` | 9대의 실제 접속 정보와 표시 거리 |
| `CCTV_MAP_CONFIGURATION_JSON` | 9대의 설치 좌표와 저장한 근사 기준 |
| `CCTV_MONITOR_USER` | 모니터링 로그인 이름 |
| `CCTV_MONITOR_PASSWORD_HASH` | PBKDF2-SHA256 모니터링 비밀번호 해시 |
| `CCTV_VWORLD_API_KEY` | 수신 서버 사이트용 지도 SDK 키 |

등록 도구는 위 설정을 공개 빌드·Pages·배포 아티팩트에 넣지 않습니다.
카메라 접속 정보를 변경한 경우 설정 도구에서 해당 값을 수정하고 같은 등록 도구를 다시 실행합니다.

### 로그인은 정상인데 등록 도구만 실패하는 경우

초기 자동 수신 서버 패키지에는 저장된 암호화 설정을 CLI 도구로 다시 읽을 때 메모리 설정 저장소가 빠진 오류가 있었습니다.
`Test-Path .\data\server-settings.protected`가 True이고 `gh auth status`와 `gh secret list --repo hyeonbae-jeon/fire-monitoring`가 정상이어도 등록이 실패할 수 있습니다.
이 오류는 시크릿을 쓰기 전에 발생하며 기존 암호화 설정은 그대로입니다. 수정 패키지에서 같은 `data` 폴더를 사용하고 같은 Windows 계정으로 등록 도구를 다시 실행하면 됩니다.
설정 파일을 삭제하거나 카메라 접속 정보를 다시 입력할 필요는 없습니다. 수정 도구는 시크릿별 진행 상황과 실패 단계를 표시하며 원본 오류에 포함될 수 있는 민감한 값은 출력하지 않습니다.

### GitHub에서 회사 PC 설정 동기화

선택 사항입니다. 이미 Windows 설정 파일로 자동 수신 중이면 GitHub runner가 없어도 작동합니다.

GitHub 저장소의 **Deploy private monitoring server** 워크플로는 `workflow_dispatch`로만 실행하며, `cctv-runtime` 환경을 사용합니다.
같은 Windows 사용자 계정으로 등록한 비공개 self-hosted runner에 `cctv-monitor` 레이블을 지정하고
그 runner의 `CCTV_BRIDGE_EXE` 환경변수에 설치한 실행파일 경로를 설정합니다.
워크플로에서 `windows`를 선택하면 시크릿을 표준입력으로 전달해 DPAPI 설정을 갱신하고 등록된 서버 작업을 재시작합니다.
공용 GitHub runner나 공개 저장소의 PR에서 운영 카메라 수신을 실행하지 않습니다.

## 외부 Linux 서버: Docker 대안

회사 PC가 상시 운영하기 어렵다면 Docker를 사용할 수 있는 VPS·NAS·서버에 같은 프로그램을 배포합니다.
서버에서 카메라 주소로 접근 가능한지는 실제 서버에서 확인해야 합니다. 회사 PC의 접근 성공만으로 다른 서버의 IP 권한까지 확인된 것은 아닙니다.

`deploy/Dockerfile`은 인증정보 없이 앱을 빌드합니다. `deploy/compose.yml`은 실행할 때 위 Secrets와 `CCTV_MONITOR_DOMAIN`을 받습니다.
Caddy가 HTTPS를 제공하고 앱 포트는 외부에 게시하지 않습니다. 지도·인증 키는 Docker volume에 보관합니다.

비공개 Linux self-hosted runner에 `cctv-monitor` 레이블을 설정하고 `cctv-runtime` 환경을 준비합니다.
저장소 또는 환경 변수 **`CCTV_MONITOR_DOMAIN`**에 실제 DNS 도메인을 설정한 뒤 워크플로에서 `docker`를 선택합니다.
시크릿은 컨테이너 실행 환경에만 전달되며 이미지 빌드 인자로 사용하지 않습니다.

회사 PC와 외부 서버 중 어느 쪽도 구성·실행되지 않은 상태에서는 Pages만으로 자동 수신하지 않습니다.
현재 제공되는 것은 설정 도구와 배포 가능한 프로그램이며 회사 PC·VPN·외부 서버 실제 설치는 운영자가 수행해야 합니다.
