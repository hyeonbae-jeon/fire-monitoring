# Open Questions
1. SSM camera inventory 외부 조회 경로
2. Name → UUID → Channel → Device/NVR 관계
3. 독립 프로세스에서 Event Bus 사용 가능 여부
4. `m_fZoom` 의미/범위
5. Pan/Tilt 좌표계/설치 기준
6. SSM DLL 직접참조 vs 장비 API
7. SSM 버전 변경 호환성
8. SSM DLL 재배포 가능 여부
9. VWorld terrain/DEM 기반 가시권 구현 방법

## 추가 handoff 반영 후에도 미확인인 항목

- `MapTile.OnRequest` subscriber와 `MediaService.RequestEx` 경로의 정확한 연결.
  MediaService의 내부 세션 전달 위치가 보고되어도 외부 프로세스의 인증/세션 생성은 미확인.
- 전체 목록의 인증, 카메라 UUID/이름/PtzCap 필드 매핑, 페이지·서버별 조회 완료 조건.
  `DataService` 및 관련 assembly는 다음 정적 분석 후보일 뿐, 사용 가능한 외부 API로 확인되지 않음.
- 실제 선택 대상(현재 목표 9대, 코드에 개수 고정 금지)의 구독 자격 및 PTZ 수신 성공 여부.
- SSM XMap 표시 보정과 실제 북쪽 방위각/설치 좌표의 관계, Zoom → FOV 변환.
- 내부 이벤트 어댑터가 불가능할 때의 SUNAPI/ONVIF 지원 여부 및 읽기 전용 상태 조회 계약.
  대체 어댑터에는 SSM UUID ↔ 장비 ID/ProfileToken/채널 매핑 검증이 필요함.

위 문단은 추가 코드 요약 문서를 받았을 당시의 상태입니다. 2026-10-09 원본 6개 DLL 분석 후 상태는 아래 참조.

## 리포트 확보 후 남은 확인

- 보고서 출력 권한/서버 범위를 포함한 전체 등록 목록 여부 및 실제 수집 시각
- Camera.Guid와 실제 PTZ 이벤트/외부 API UUID의 일치
- PTZ 지원 표시 외의 uint64 PtzCap, ENTITY_CAPABILITY, ChannelSubType
- 실제 조회 인터페이스 인증/필드/페이지 처리와 현재 방향/줌 관측

## 원본 6개 DLL 분석 후 남은 항목

- 내부 카메라 모델 변환 및 로그인/목록 Stub 호출 위치는 확인됨. 실제 HTTP 계약은 WebServiceStub.dll 추가 분석 필요
- MapTile.OnRequest 구독자 및 system sink -> UI 이벤트 연결은 아직 미확인; ControllerService가 다음 후보
- 권한/서버/연합 범위와 페이지/배치 처리, 부분 조회 실패 검출
- strExtendData의 latitude/longitude/heading 실제 값 존재 여부와 단위·의미
- 원본은 net48 대상으로 분석됨; 독립 실행 및 .NET 8 호환성, 외부 사용 조건 미검증
- 실장비 PTZ 수신·단위·설치 보정·Zoom/FOV는 미확인 유지

상세 근거: [ssm-dll-analysis.md](ssm-dll-analysis.md).

## WebServiceStub / ControllerService 추가 분석 이후

앞선 추가 DLL 필요 항목을 정적 조사로 갱신했습니다. HTTP 로그인/목록 계약의 클라이언트 구현은 확인됐으며
상세 path/query/JSON/인증/분할은 [추가 분석](ssm-web-controller-analysis.md) 참조.
현재 남은 것은 실제 서버 주소·포트·TLS·권한·계정 및 실응답 검증, 전체 목록 범위/수집 중 변경/누락 대조입니다.
ControllerService는 조작 장치 모듈이므로 MapTile 연결 조사 대상에서 제외합니다.
SystemService/LiveViewer가 다음 정적 후보이며 실시간 PTZ 연결·단위·실수신 검증은 계속 미완료입니다.

## SystemService / LiveViewer 추가 분석 이후 (최신 상태)

중앙 요청·이벤트 전달은 확인됐고, MapTile와 화면의 직접 연결은 외부 BaseViewerForm/XScreen 구현에 남아 있습니다.
일반 콜백/SDK sink만으로 PTZ를 받을 수 있다는 근거는 없습니다. [라우팅 분석](ssm-routing-analysis.md) 참조.
추가 UI DLL 조사는 독립 목록 조회의 선행 조건이 아닙니다. 우선 회사 서버의 상태 GET 응답,
주소/포트/TLS/버전과 허용 계정의 목록 응답·전체 범위를 확인해야 합니다.
실시간 PTZ의 독립 세션 초기화·수신·단위·설치 보정은 계속 미검증입니다.

## 인증서 고정 진단 준비 후 (2026-10-10)

상태 조회의 서버 버전/SSL 포트/공개키 존재는 사용자 실행 결과로 확인됐습니다.
서버 인증서의 진위는 독립 미확인입니다. 사용자가 최초 관측 지문을 고정한 시험 연결 진행을 요청하여
별도 진단 도구를 구현했습니다. HTTPS/RSA/서명/목록 파싱은 합성 서버에서 검사했으며
운영 로그인/목록 성공, CLIENT_SDK 사용 조건, 계정 전체 범위와 현재 PTZ는 아직 미확인입니다.
[현장 실행 및 결과 공유](ssm-connection-test.md) 후 갱신합니다.

## 현장 목록 조회 성공 후 (최신 상태)

HTTPS 지문 고정·정상 로그인·목록 GET·자기 세션 로그아웃은 사용자 회사 PC 실행에서 성공했습니다.
이전의 운영 로그인 미확인 항목은 이 서버/계정 실행 범위에서 해소됐습니다.
[146개 목록 대조](ssm-live-inventory-validation.md)에서 이전 보고서 140개 전체 포함을 확인했습니다.
전체 서버/권한/연합 범위, 130대 라이선스 화면과의 범위 차이, 신규 6개의 추가 원인·시점은 미확인입니다.
이 시점에는 위치 비트 후보 6개의 ENTITY_CAPABILITY/subType가 미확인이었습니다. 아래 v2 결과에서 갱신하며, 독립 CONTROL 세션/이벤트와 물리 방향 보정은 남아 있습니다.

## GoogleMapViewer 조사 이후

추가 모듈에서도 heading 사용/북쪽 보정 구현은 직접 확인되지 않았습니다. 모든 설치 모듈에
없다고 판단하지 않습니다. [진단 v2](ssm-connection-test.md)의 실제 채널 메타데이터는 아래에서 갱신합니다. 계정 PTZ 권한과 실제 상태 구독은 별도 미확인입니다.

## 진단 v2 현장 결과 이후 (최신 상태)

146개 모두 저장 heading/좌표의 정규화 결과가 null입니다. 원본의 누락/빈 값과 계정 필드 제한을
구분할 근거는 없으며, 다른 저장 경로의 보정값도 미확인입니다. subType=0이 전부인 이유와
클라이언트의 유형 보완 여부, installType=2가 실제 설치를 반영하는지는 확인이 필요합니다.
전체 XMap 데이터 조건 false는 계정 권한 거절이나 모든 상태 조회 방법의 불가능을 증명하지 않습니다.
다음 실장비 검증은 한 카메라의 읽기 전용 상태 응답과 UUID/단위/시각을 확인하는 것입니다.
SSM 독립 CONTROL 세션 또는 검증된 장비 API 계약이 필요하며, 이동·절대 위치 설정은 금지합니다.
북쪽 보정에는 이후 실제 화면의 알려진 지형과 관측 PTZ 값의 대조가 필요합니다.
[현장 근거](ssm-live-inventory-validation.md).

## 단일 PTZ 검증 준비와 설정 사진 이후

대상 두 대는 SUNAPI로 등록되어 있고 유형 없음/천장 설정입니다. 확인된 스트림 HTTP/TCP를
ONVIF 서비스 주소로 대체하지 않습니다. 다음은 실제 카메라의 서비스 주소/포트와 공식 SUNAPI
현재 위치 조회 계약 확인입니다. ONVIF가 제공되는 경우 준비된 GetStatus 도구를 사용합니다.
독립 CONTROL의 운영 연결/구독은 여전히 미검증입니다. 계정/접속 정보 미확인을 기능 미지원으로
분류하지 않습니다. [남은 검증과 영상 보정 전환 기준](ptz-investigation-decision.md).

## IP/포트 관측 및 진단 v3 이후

카메라 자체 HTTP/HTTPS/RTSP 포트는 확인됐지만 설정 화면의 최종 URL과 외부 접속/전달 경로는 미확인입니다.
SSM networkInfo의 정적 필드 매핑과 v3의 선택 한 대 현장 등록값을 확인했습니다.
카메라 HTTP 80/HTTPS 443 및 component TCP 4510은 확인된 설정값입니다.
후속 TCP 시험에서는 HTTP 80과 component 4510 연결 성공, 카메라 HTTPS 443 연결 실패를 관측했습니다.
실제 장비 신원·HTTP 서비스·CONTROL TLS/인증, 443 연결 실패 원인은 미확인입니다.
후속 사용자 화면에서 Hanwha Vision WebViewer와 브라우저 인증 요구를 관측했습니다.
HTTP 웹 화면 관측은 확보됐으나 모델/MAC/시리얼, 해당 인증 요청의 상태·WWW-Authenticate 방식,
장비 계정 보유 여부와 고유 장비 매핑은 미확인입니다. 팝업만으로 Basic/Digest를 구분하지 않습니다.
카메라와 SSM CONTROL의 포트/계정을 구분합니다.
ONVIF 서비스 URL/지원, 공식 SUNAPI 현재 위치 계약 및 독립 CONTROL 현재 위치 수신이 남아 있습니다.
사용자는 주소창이 없다고 확인했으므로 주소창 재확인을 선행 조건으로 두지 않습니다.
[v3 대조](ssm-live-inventory-validation.md) · [회사 PC TCP 확인](camera-route-check.md).
[로그인 전 인증 방식 확인](camera-web-auth-check.md).

## 카메라 장비 계정 미확인 이후

사용자는 장비 계정을 모른다고 답했습니다. 직접 SUNAPI/ONVIF 인증은 계정 확보를 기다립니다.
일반 CONTROL 인증이 SSM User/ServerSessionID를 사용하는 정적 경로를 확인했으나 운영 CONTROL의
CLIENT_SDK 허용·권한·TLS/현재 위치 수신은 미검증입니다. REST service=12와 CONTROL ClientType=4096을 구분합니다.
ServerStub → MediaGateway(type=4097)와 Recorder/component는 별도 계층입니다.
v3에는 타입/도메인/명시적 부모 관계가 없어 현재 componentUuid를 CONTROL 대상으로 확정할 수 없습니다.
같은 GET의 이 필드를 추출하는 [진단 v4](ssm-connection-test.md)로 현장 관계를 대조한 뒤 진행합니다.
