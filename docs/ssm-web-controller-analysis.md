# 추가 WebServiceStub / ControllerService DLL 분석

분석일: 2026-10-09 (한국 시간). [원본 크기·SHA256](ssm-web-controller-manifest.json).
ILSpyCmd 9.1.0.7988로 정적으로 디컴파일했고 두 파일 모두 종료 코드 0입니다.
WebServiceStub의 중요 경로·쿠키·서명·분할 조건은 IL에서도 교차 확인했습니다.
DLL 실행, 서버 접속, 인증 시도, PTZ 요청은 하지 않았습니다. 원본 및 전체 출력은
저장소 밖 /workspace/ssm-analysis에 보관합니다. 원본 DLL은 패키지/GitHub에 추가하지 않습니다.
이 문서는 앞선 [6개 DLL 조사](ssm-dll-analysis.md)의 미확인 항목을 갱신합니다.

## 요약

실제 로그인 경로, 서명/세션 쿠키, 카메라 응답 JSON 필드, 서버/컴포넌트/채널 요청 및
권한 매핑의 페이지 처리와 배치 크기를 확인했습니다. 이 정보는 해당 바이너리의 클라이언트
구현 증거이며 실장비 성공이나 공식 외부 SDK 지원의 검증은 아닙니다.
ControllerService는 SPC 조작 장치 담당으로 확인되어 지도 PTZ 라우팅 후보에서 제외합니다.
실시간 PTZ는 이전에 확인한 Media Gateway CONTROL 세션 경로이며, 목록 REST와 같은 것으로
취급하거나 이 REST URL에 PTZ 제어 본문을 보내지 않습니다.

## 로그인 전 상태/공개키 확인

이전 DataService의 WebServiceImplementation.IsAliveServer_withSSL 및
WebServerStatusRequest_SSLInfo를 추가 Stub과 함께 추적했습니다.

- GET /V1/report/status (초기 HTTP 주소/포트 사용)
- 응답 헤더: sslport, serverstatus, locale, ServerVersion, PublicKey
- 응답에 따른 SSL 주소/포트 구성 및 공개키 사용 경로가 있음

이는 서버 주소나 포트가 확인됐다는 뜻이 아닙니다. 보고서의 SSM 서버 HTTPPort와 실제
로그인 대상 서버 주소를 현장에서 대조해야 합니다. HTTP 9999, HTTPS 9991 등 특정 포트를
코드에 임의로 고정하지 않습니다. 응답/TLS 정책과 서버 시각 일치 여부는 실장비 확인이 필요합니다.

회사 PC에서 첫 읽기 확인은 해당 SSM 서버의 위 상태 URL입니다. 결과 공유에는 HTTP 상태와
ServerVersion/sslport/serverstatus 등 비밀이 아닌 헤더만 사용합니다. 로그인 요청/응답 전체,
쿠키, Authorization, 비밀번호, SessionId, Token, secretKey를 채팅/로그로 수집하지 않습니다.

## 정상 로그인 (강제 접속 해제 없이)

WebServiceStub.POST_SESSION -> POST_LOGIN:

- 정상 경로: POST /V1/Session
- 로그인 JSON: id, password, ip, service, clientVersion
- 해당 DLL의 clientVersion은 2.21.00 문자열이며 전달된 version 인자를 그대로 사용하지 않음
- DataService에서 ID/password는 StrongPW.EncryptByRSA를 거쳐 전달됨
- StrongPW의 공개키 처리는 Base64 DER 공개키이며 최종 RSA 암호화는 PKCS#1 v1.5 패딩
- 성공 응답 모델: UID, UserGroupUID, SessionId, Token, secretKey,
  HeartbeatInterval, LicenseFeatureID, LicenseCap, UserStatus 등
- 오류 응답/헤더에 LockTime, MissCount, redirect_url 처리도 있음

/V1/Session/ForcedDisconnect는 별도 분기입니다. 향후 읽기 진단에 강제 로그인을 사용하지 않습니다.
ID/password 평문을 단순 JSON에 넣으면 기존 클라이언트와 같은 로그인 요청이 아닙니다.
원본 암호화 함수에는 공개키가 null일 때 평문 반환하는 분기가 있으나 새 어댑터에서는
이런 fallback을 그대로 도입하지 않고 키 누락/형식 오류로 중단해야 합니다.
service 값은 실행 종류와 연결된 내부 값입니다. CLIENT_SDK 분기 존재를 근거로 라이선스/권한을
우회하거나 독립 프로그램의 사용 조건이 확인됐다고 해석하지 않습니다.

## 로그인 후 GET 인증

WebServiceStub.GET / GET_PARALLEL에서 확인:

- Cookie: Session_ID=<세션값>
- x-ssm-date: UTC Unix 초
- Authorization: TSM 또는 TSMC 스킴
- 서명 메시지: 요청 URL의 path와 query + ':' + 시각
- HMAC-SHA256 키: 로그인 비밀번호(해당 Stub의 LOGIN_PW)
- 서명은 소문자 16진 문자열; 세션값 + ':' + 서명을 UTF-8/Base64로 인코딩
- TSM/TSMC 선택은 bUser 실행 종류에 따라 달라짐

로그인 본문의 RSA 암호문과 GET 서명 키로 쓰는 값은 구분해야 합니다. 브라우저에 운영 로그인
비밀번호/세션을 넘기지 않으며 중앙 Bridge에서만 다뤄야 합니다. 이 서명식을 독립 합성 벡터나
실서버로 아직 검증하지 않았습니다. 쿠키만 있으면 목록 조회가 된다고 가정하지 않습니다.

## 실제 목록 요청과 분할

| 내부 메서드 | GET path/query | 응답/처리 |
| --- | --- | --- |
| GET_SERVER_LIST | /v3/servers?type=all | ServerStubModel 배열; 클라이언트에서 type 필터 |
| GET_COMPONENTV2_LIST | /v3/servers/{serverGuid}/components | ComponentStubModel 배열 |
| GET_CHANNELV2_LIST | /v3/components/{componentGuid}/channels?serverGuid={serverGuid} | ChannelStubModel 배열 |
| GET_ALL_CHANNELS | /v3/components/channels?serverGuid={serverGuid}&component_guid={쉼표 목록} | 컴포넌트 10개 단위 요청 |
| GET_CHANNEL_GUID_LIST | /v3/channels?serverGuid={serverGuid}&GuidList={쉼표 목록} | 채널 GUID 128개 단위 요청 |
| GET_COMPONENT_GUID_LIST | /v3/components?GuidList={쉼표 목록} | 컴포넌트 GUID 128개 단위 요청 |
| GET_CHANNEL | /v3/channels/{channelGuid}?serverGuid={serverGuid} | 단일 ChannelStubModel |
| GET_CHANNEL_MAPPING | /V1/Domain/Permission?page={page}&size=2000 | 권한 매핑 content 및 페이지 메타데이터 |

권한 매핑은 0부터 시작하는 페이지를 원본에서 20개씩 묶어 요청하며 빈 content를 발견하면 멈춥니다.
모델에는 first, last, number, numberOfElements, size, totalElements, totalPages가 있습니다.
채널 배열 응답과 권한 매핑 페이지 응답을 같은 구조로 파싱하지 않습니다.
GET_PARALLEL은 최대 병렬도 10이며 요청 중 실패 상태를 기록하지만, 비어 있는 URL 목록의
초기 결과는 200입니다. 일부 역직렬화 오류를 로그만 남기고 HTTP 성공 코드로 반환하는 경로도 있습니다.

새 Bridge 수집 완료 기준은 모든 서버/권한 범위 및 필요한 배치 성공, 응답 구조 검사,
고유 UUID와 수량/누락 대조여야 합니다. 원본의 성공 코드를 그대로 complete=true로 바꾸지 않습니다.
실서버의 권한 범위, 전체 카메라 개수, 페이지 메타데이터의 정확성 및 수집 중 목록 변경은 미검증입니다.

## 응답 JSON 필드 확인

ChannelStubModel과 상속 모델에서 확인한 필드:

| wire JSON | 형식/의미 |
| --- | --- |
| guid, parentGuid, name | 문자열, Camera 변환 시 UUID/부모 UUID/이름 |
| type | long; 앞선 Camera 변환 분기의 값은 8192 |
| subType | long; ChannelSubType 변환 |
| capability, capability2 | 문자열; 앞선 변환 코드에서 16진 ulong 처리 |
| ptzCap | ulong 숫자; Bridge 출력에서는 손실 없는 10진 문자열 필요 |
| componentGuid, siteGuid, deviceId | 관계/장비 식별 필드; guid와 동일하다고 가정하지 않음 |
| extendedData | JSON 문자열(외부 객체 필드); 안에 latitude/longitude/heading dictionary가 있을 수 있음 |

extendedData는 C#의 strExtendData에 JsonProperty로 매핑됩니다. entities도 별도 JsonProperty가 있습니다.
기본값 ulong 0으로 역직렬화될 수 있으므로 필드 누락을 실제 capability=0으로 해석하면 안 됩니다.
미확인 PTZ capability는 계속 null이며 보고서의 PTZ 지원 bool과 구분합니다.
설정 heading의 실제 값·단위·시점은 아직 미확인입니다. 현재 Pan/Tilt/Zoom 값의 대체값이 아닙니다.

## ControllerService 조사 결과

ControllerManager, SPC_2000, SPC_7000 및 HIDLib 참조를 확인했습니다.
MAN_TYPE.CONTROL_DEVICE_MAN, CONTROLLER_CONTROL 요청/이벤트, USB 장치 연결과 조작기 설정을 처리합니다.
MapTile 참조나 OnRequest 구독은 확인되지 않았습니다. 이전 문서에서 조사 후보였던 이 모듈을
중앙 지도 PTZ 라우터로 사용하지 않습니다. ControllerService 분석을 위한 추가 HID DLL은 현재 필요 없습니다.

## 다음 조사와 현장 확인

추가 제공된 SystemService/LiveViewer에서 중앙 요청 전달과 PTZ 이벤트의 지정 sink 배분을 확인했습니다.
MapTile와 화면의 직접 연결은 미확인입니다. 일반 OnCallbackEvent나 CLIENT_SDK_MAN으로 PTZ 이벤트를
받는다고 가정할 수 없습니다. [추가 라우팅 분석](ssm-routing-analysis.md) 참조.
기존 UI/서비스 전체 로딩보다 독립 중앙 Bridge에서 목록 REST 계약부터 현장 검증하는 접근을 유지합니다.

현장에서는 상태 GET -> 서버 버전/SSL/공개키 확인 -> 허용된 계정의 정상 로그인 -> 작은 범위의
목록 조회 -> 전체 수집 대조 -> 한 카메라의 검증된 PTZ 상태 구독 순서로 진행합니다.
아직 계정/주소/권한/실응답이 없으므로 이 단계들을 실행하지 않았습니다. MOVE_PTZ/SET_ABS_PTZ 금지는 유지합니다.
중앙 PTZ Bridge + VWorld 브라우저 구조와 원본 DLL을 공개 배포하지 않는 원칙도 유지합니다.
이번 변경은 분석 문서만이며 기존 실행 패키지는 변경하지 않습니다.

## 후속 연결 진단 구현 (2026-10-10)

위 문단은 최초 정적 분석 시점입니다. 이후 현장 상태 GET 응답으로 2.21.00/START/SSL 포트·공개키 존재가 확인됐습니다.
추가 추적에서 WebServiceImplementation의 CLIENT_SDK 정상 로그인 service 값은 enum 순번 6이 아닌 **12**,
비-SVM WebServiceStub의 bUser=true는 **TSM**, 자기 세션 LogOutRequest는 **DELETE /V1/Session**임을 확인했습니다.
독립 [연결 진단 도구](ssm-connection-test.md)에 이 계약만 구현했습니다. 강제 접속/제어 요청은 없습니다.
운영 HTTPS는 독립 검증되지 않은 최초 인증서를 사용자가 명시적으로 고정하는 시험이며,
회사 PC에서의 정상 로그인·목록 수집 성공은 아직 확인되지 않았습니다.
