# Verified Findings
- SSM 2.21 (`2.21.00_260514`) 설치본을 ILSpy로 분석.
- `PtzCtrl`에 `Uuid`, `Command`, `Action`, `Pan`, `Tilt`, `Zoom`이 존재.
- `GET_ABS_PTZ_START/STOP` 존재.
- `ReqABSPTZPos()`는 `ABS_PTZ + GET_ABS_PTZ_START/STOP` 요청 생성.
- `MapTile.OnEvent()`는 `EVENT_TYPE.PTZ_CONTROL`을 수신.
- payload는 `PtzCtrl`.
- `SetObjectPTZAngle()`은 `m_fPan/m_fTilt`로 지도 카메라 방향을 갱신.
- `GET_POS_NORMALIZE` capability가 XMap 실시간 방향 추적의 조건.

세부 코드/enum은 `CODEX_HANDOFF.md` 참조.

## 추가 전달된 코드 추적 정보

출처: [PTZ_CODE_TRACE_STATUS.md](PTZ_CODE_TRACE_STATUS.md). 아래는 사용자가 전달한
SSM 2.21.00_260514 정적 분석 결과이며, 이번 작업에서 원본 DLL이나 실장비로 재검증한 것은 아닙니다.

- `MediaService.RequestEx(ref RequestObj, Guid)`는 카메라 UUID에 해당하는
  Media Gateway/CONTROL session을 찾아 `ControlSession.Request()`로 전달한다고 보고됨.
  기존 문서는 `ControlSession.Request()` 이후의 패킷 생성·전송만 명시했으므로 앞단 경로가 추가됨.
- 절대 위치 설정 코드의 정확한 메서드는 `PTZPanel.Function_Request(float,float,float)`로 보고됨.
  `ABS_PTZ + SET_ABS_PTZ`를 만드는 분석 위치이며, 실행 Bridge에 구현하거나 호출하지 않음.
- `XMapPlane.SetObjectPTZAngle()`은 `m_fZoom`을 사용하지 않는다고 명시됨.
  해당 지도 함수에서 Zoom → 광학 FOV 변환식을 얻을 수 있다는 근거는 없음.

구독 요청/이벤트/PtzCtrl/구독 조건/설치형태에 따른 Pan 보정은 기존 handoff와 중복됨.
위 MediaService 경로만으로 `MapTile.OnRequest`의 최종 subscriber나 외부 프로세스의
인증·연결 방법이 확인된 것은 아님. 상세 비교는 [추가 handoff 비교](ptz-trace-review.md) 참조.

## 장치 설정 리포트 확인

사용자가 제공한 Excel XML 리포트의 Camera 시트에서 고유 Name/Guid 140개, PTZ 표시 지원함 137개/지원 안 함 3개, Model 열을 확인했습니다.
보고서 Guid를 파일 목록의 식별자로 사용하며 실제 PTZ 이벤트 UUID와의 일치는 추가 확인이 필요합니다.
PTZ 표시 문구는 PtzCap 비트가 아니며 위치 조회 가능 여부를 확정하지 않습니다. [상세](ssm-report-import.md).

## 제공된 원본 DLL에서 직접 재검증 (2026-10-09)

여섯 원본을 ILSpyCmd로 정적으로 분석해 PTZ 구독 요청·이벤트 수신·CONTROL 세션 전달을 직접 재확인했습니다.
새로 ObjConverter의 Guid/Name/PtzCap/subType/capability 변환, 채널 조회 및 로그인 Stub 호출,
strExtendData의 latitude/longitude/heading 저장 필드도 확인했습니다.
이는 실장비 수신 성공이나 외부 조회 계약 전체 확인이 아닙니다.
[분석 결과와 미확인 경계](ssm-dll-analysis.md) · [원본 SHA256](ssm-dll-manifest.json).

## WebServiceStub / ControllerService 원본 추가 확인

POST /V1/Session, Session_ID 쿠키 + x-ssm-date + HMAC 인증, 실제 채널 JSON 필드,
컴포넌트 10개/Guid 128개 배치와 권한 매핑 페이지를 원본에서 확인했습니다.
ControllerService는 SPC 조작 장치 담당으로 지도 요청 라우터 후보에서 제외합니다.
[상세 근거와 미확인 범위](ssm-web-controller-analysis.md). 서버 접속/로그인/PTZ 수신 성공은 미검증입니다.

## SystemService / LiveViewer 원본 추가 확인

SystemService의 PTZ_CONTROL → MEDIA_MAN 요청 전달 및 지정된 화면 sink로의 PTZ 이벤트 배분을 확인했습니다.
CLIENT_SDK_MAN/일반 OnCallbackEvent가 이 PTZ 분기의 수신처라고 가정할 수 없습니다.
LiveViewer의 ILiveInput, XScreen/Mediator 및 BaseViewerForm 이벤트 위임도 확인했습니다.
MapTile 직접 연결과 실장비 수신은 미확인입니다. [상세 근거](ssm-routing-analysis.md).

## 현장 상태 응답 및 연결 진단 (2026-10-10)

사용자가 회사 PC에서 실행한 상태 GET 결과는 HTTP 200, serverstatus=START, ServerVersion=2.21.00,
SSL 포트·PublicKey 존재입니다. HTTPS에서는 ERR_CERT_AUTHORITY_INVALID가 관측됐습니다.
제공된 PEM의 자기 서명 및 2031-08-02까지 유효함을 확인했고 SAN이 없습니다.
이 관측으로 운영 서버 인증서의 진위가 독립 확인된 것은 아닙니다.
원본 WebServiceImplementation.LogInSessionRequest의 CLIENT_SDK wire service=12,
비-SVM의 TSM 선택, LogOutRequest의 자기 세션 DELETE /V1/Session도 확인했습니다.
[연결 진단 도구](ssm-connection-test.md)의 합성 서버 검증과 운영 로그인 성공은 구분합니다.

## 회사 PC 정상 로그인·목록 조회 성공 (2026-10-10)

사용자 진단 결과에서 지문 고정 HTTPS 상태/로그인/목록 GET/자기 세션 로그아웃이 모두 HTTP 200입니다.
3개 서버·3개 컴포넌트에서 고유 UUID 146개, 이름 및 uint64 PtzCap를 읽었습니다.
이전 보고서의 140개는 이름/UUID가 모두 일치하며 이번에만 있는 6개가 있습니다.
GET_POS_NORMALIZE 비트는 6개에서 관측됐으나 현재 PTZ 수신은 아직 미검증입니다.
전체 범위는 미확인이므로 complete=false입니다. [현장 검증과 대조](ssm-live-inventory-validation.md).

## GoogleMapViewer 원본 추가 조사

원본 C#/IL에서 headingAngle/current Pan/절대 위치 구독 직접 참조는 발견되지 않았습니다.
외부 BaseViewerForm 이벤트 위임 및 SSMDataCenter 권한 조회 위임을 확인했습니다.
같은 목록 GET의 설정 메타데이터만 추출하는 진단 v2를 구현했습니다. 회사 응답의 저장 필드는 아래 v2 현장 결과에서 확인했습니다.
[근거와 경계](ssm-google-map-analysis.md).

## 진단 v2 현장 메타데이터 확인 (2026-10-10)

회사 PC에서 재조회한 146개의 목록/메타데이터 UUID 집합이 일치하고 모든 요청은 HTTP 200입니다.
146개 모두 configuredHeading/Latitude/Longitude=null, subType=0, installType=2이며 추출 형식 문제는 없습니다.
기존 XMap 전체 데이터 구독 조건은 146개 모두 false입니다. 선택 9대 중 위치 비트 후보 3개는 유지되나,
subType 조건을 충족하지 않습니다. 권한 부족·실제 설치 형태·현재 PTZ 수신 가능성은 이 결과로 확정하지 않습니다.
사용자 제공 위치를 유지합니다. [관측과 해석 범위](ssm-live-inventory-validation.md).

## 단일 현재 상태 조회 준비 및 대상 설정 사진

두 대상의 사용자 설정 사진에서 XNP-6550RH/SUNAPI 등록과 유형 없음/천장 설정 표시를 확인했습니다.
ONVIF 서비스 URL과 실제 위치 응답은 사진으로 확인되지 않았습니다. 독립 CONTROL의 로그인 digest,
사용자 ID 암호화 및 성공 응답에 따른 TLS 전환을 추가 정적 확인했습니다.
공식 ONVIF WSDL의 GetStatus 등 네 읽기 작업에 한정한 독립 시험 도구를 준비합니다.
표준 계약/합성 장비 검증과 운영 장비의 지원·수신 성공은 구분합니다.
[추가 조사](ptz-investigation-decision.md) · [시험 방법](ptz-readonly-test.md).

## 카메라 포트 관측과 선택 한 대의 등록 접속 정보 추출

대상 IP/포트 설정에서 HTTP 80/HTTPS 443/RTSP 554를 확인했고 사용자가 주소창 미표시를 확인했습니다.
카메라 내부 포트와 실제 외부 접속 포트는 구분합니다. 원본 Stub 모델과 ObjConverter에서
networkInfo 주소/포트·연결 방식의 매핑을 확인하여 같은 목록 GET에서 선택 한 대의 연결 정보를
추출하는 진단 v3를 추가했습니다. 계정/비밀 필드는 제외하고 운영 주소는 private 파일에만 저장합니다.
설정 화면의 최종 URL 생성은 찾지 못했습니다. 운영 networkInfo 실값은 아래 v3 결과에서 확인했고,
접근 경로는 계속 미검증입니다.
[근거와 다음 확인](ptz-investigation-decision.md).

## 진단 v3 현장 등록값 확인 (2026-10-10)

회사 PC 실행 결과에서 10개 요청 모두 HTTP 200, 고유 UUID 146개 및 선택 9대의 이름/UUID/PtzCap 유지,
선택 한 대의 연결 정보 추출 성공을 확인했습니다. 카메라 등록 HTTP 80/HTTPS 443은 포트 화면과 일치합니다.
원본 enum에 따라 devProtocolType=1은 SUNAPI, medProtocolType=3은 HTTP, addressType=4는 HTTPS입니다.
component TCP 4510과 server의 목록 REST 포트는 별도 필드로 반환됐습니다.
SessionCenter.AddMediaGateway의 TCP/WAN 주소·TCP 포트 → ControlSession.SetConnectionInfo 전달도 확인했습니다.
이는 등록값/정적 구현의 근거이며 장비 도달 여부·신원·CONTROL 인증·현재 PTZ 성공은 아닙니다.
저장 heading/좌표 null 및 전체 XMap 조건 false가 재확인됐습니다. [현장 대조](ssm-live-inventory-validation.md).

## 등록 포트의 회사 PC TCP 시험 결과

사용자 camera-route-report.json에서 카메라 HTTP 80=true, HTTPS 443=false,
SSM component TCP 4510=true를 확인했습니다. 역할/포트는 앞선 v3 등록 정보와 일치합니다.
보고서에 주소/UUID/수집 시각은 없으며 TCP 연결만 시험했습니다. HTTP 장비 신원, CONTROL 인증/TLS,
현재 PTZ 및 북쪽 보정은 계속 미검증입니다. [해석과 다음 단계](ssm-live-inventory-validation.md).
