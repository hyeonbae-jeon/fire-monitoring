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
