# 제공된 6개 SSM DLL의 정적 분석 결과

분석일: 2026-10-09 (한국 시간). 대상 원본과 SHA256는 [ssm-dll-manifest.json](ssm-dll-manifest.json).
ILSpyCmd 9.1.0.7988로 여섯 어셈블리를 정적으로 디컴파일했습니다. 모두 도구 종료 코드 0입니다.
대상 DLL을 런타임으로 로드하거나 생성자/로그인/조회/제어 메서드를 실행하지 않았습니다.
원본 및 전체 디컴파일 결과는 저장소 밖 `/workspace/ssm-analysis`에 보관합니다.
이 문서는 분석 요약이며 원본 DLL이나 전체 소스는 GitHub/실행 패키지에 배포하지 않습니다.

## 현재 결론

실제 원본에서 현재 PTZ 구독/이벤트 데이터 구조를 재확인했고, 카메라 응답 모델의
이름/UUID/PtzCap 변환과 로그인/채널 목록 조회의 내부 메서드를 새로 확인했습니다.
HTTP 호출은 미제공 WebServiceStub.dll에 위임하므로 실제 URL/메서드/인증 헤더/응답 JSON 계약과
페이지 처리까지 확인된 것은 아닙니다. MapTile.OnRequest를 외부에서 구독하는 호출부도 아직 없습니다.
따라서 실행 Bridge에 추정한 SSM 호출을 추가하지 않습니다. 실장비 접속 성공이나 PTZ 수신을 주장하지 않습니다.

## 원본에서 직접 확인한 사실

### 카메라 모델 변환

DataService의 ObjConverter.convertCamera(ChannelStubModel):

| 내부 응답 모델 멤버 | 변환된 Camera | 확인 위치(디컴파일 C#) |
| --- | --- | --- |
| BaseObjStubModel.guid | Uuid | ObjConverter.cs:1034 |
| BaseObjStubModel.parentGuid | ParentUuid | 1035 |
| BaseUnitStubModel.name | Name | 1037 |
| BaseUnitStubModel.capability | Capability (16진 문자열 -> ulong) | 1053–1056 |
| channel.subType | ChannelSubType | 1063 |
| channel.ptzCap | PtzCap | 1081 |

위 이름은 내부 C# 멤버입니다. 실제 HTTP JSON의 필드 이름, JSON 숫자/문자열 직렬화 방식은
WebServiceStub 모델 정의가 없으므로 미확인입니다. Bridge 자체 형식의 ptzCap 10진 문자열과 혼동하지 않습니다.
Camera.PtzCap/PtzCapEx의 저장형은 ulong이며 JsonProperty("PtzCap")도 직접 확인했습니다.
보고서 Guid와 실제 이 응답/이벤트 UUID가 같은 값인지는 실응답 또는 보고서 생성 코드와 대조해야 합니다.

### 카메라 위치/방향 관련 저장 필드

ObjConverter.cs:1097–1141은 channel.strExtendData를 문자열 dictionary로 역직렬화하고
latitude, longitude, heading 키를 Camera.latitude/longitude/headingAngle로 옮깁니다.
Camera에는 별도로 m_fAngle, 설치 형식도 있습니다.

이는 설정/확장 정보가 들어갈 필드가 있다는 증거입니다. 현재 보고서에는 값이 없고,
실제 카메라의 strExtendData가 채워져 있는지, 좌표계·단위와 heading의 의미/시점도 미확인입니다.
heading을 실시간 Pan 또는 북쪽 기준 방위각으로 바로 사용하지 않습니다.

### 채널 조회의 호출 경로와 범위

- WebServiceImplementation.GET_ALL_CHANNELS -> WebServiceStub.GET_ALL_CHANNELS
- GET_CHANNELV2_LIST, GET_CHANNEL_GUID_LIST, GET_CHANNEL도 해당 Stub 메서드에 위임
- DataManager.GET_ALLOBJECT_INFO_V2_CM은 서버별 component 목록을 모은 뒤 GET_ALL_CHANNELS 호출
- 일반 GET_ALLOBJECT_INFO_V2는 사용자 그룹 할당 정보를 사용하고 GetUnitsByRecorderGuidList에서
  GET_COMPONENT_GUID_LIST/GET_CHANNEL_GUID_LIST 경로로 목록을 가져옴
- CM 경로에서 Camera로 변환하는 type 분기(8192)도 확인됨

따라서 GET_ALL_CHANNELS라는 이름만으로 로그인 권한/서버/연합 도메인을 포함한 전체 시스템 수집을
확정할 수 없습니다. 내부 일부 조회 실패 시 continue하는 분기도 있으므로 향후 Bridge에서는 이를
그대로 성공 처리하지 않고 실패/누락 범위를 분리해야 합니다. 페이지/배치 분할은 Stub 내부 확인이 필요합니다.

### 로그인과 별도의 Media Gateway 세션

WebServiceImplementation.LogInRequest (1043 이후):

- StrongPW.EncryptByRSA를 통해 ID/비밀번호를 가공
- WebServiceStub.SetAuth 및 POST_SESSION 호출
- GET_LOGIN_RESULT로 사용자/그룹/세션/토큰 관련 값을 읽음
- SetSessionInfo가 WebServiceStub.SESSION에 세션 값을 전달

이 래퍼만으로 초기 공개키 획득, 실제 요청 경로/헤더/본문, TLS 및 재접속 계약을 확정할 수 없습니다.
비밀번호/키 값을 분석 결과나 설정 문서에 기록하지 않습니다.
CLIENT_SDK 분기가 있지만 외부 SDK가 제공/허용된다는 증거로 해석하지 않습니다.

MediaService.Init은 DataCenter로 SessionCenter를 만들고 응답/이벤트/미디어 콜백을 연결합니다.
SessionCenter.AddMediaGateway는 CONTROL용 ControlSession과 연결 정보를 구성합니다.
ControlSession.SetLogInInfo는 domain GUID, domain version, SystemManagerSessionID를 사용하며
OnConnected의 신규 로그인 분기에서 LoginDigest.ServerSessionID를 채웁니다.
MediaService에는 Digest challenge 및 SSL 전환 처리도 있습니다.
즉 서버 로그인과 Media Gateway CONTROL 세션을 함께 이해해야 하며 이름/UUID만으로 연결할 수 없습니다.

### PTZ 읽기 경로 재확인

- MapTile.ReqABSPTZPos는 ABS_PTZ + GET_ABS_PTZ_START/STOP 요청을 생성
- enum 값 START=33, STOP=34. GET_ABS_PTZ=31도 존재하지만 일회 조회의 실제 호출/응답 성공은 미확인
- 구독 자격은 Camera + ENTITY_CAPABILITY.PTZ_CONTROL + PTZ/PT_DRIVER subtype + GET_POS_NORMALIZE
- MediaService.Request의 PTZ 분기는 PtzCtrl.Uuid로 RequestEx 호출
- RequestEx는 부모 Media Gateway를 찾고 CONTROL 세션의 ControlSession.Request로 전달
- ControlSession.Request에는 PTZ_CONTROL 패킷 생성/송신 분기가 있음
- ControlSession.MakeEventObject는 payload를 객체로 역직렬화하고 OnEvent에서 Fire_OnEvent 호출
- MediaService.OnEvent는 system sink로 이벤트 전달
- MapTile.OnEvent의 PTZ_CONTROL 분기에서 PtzCtrl을 XMap 큐에 넣음

마지막 system sink -> UI dispatcher -> MapTile 연결과 OnRequest 구독자는 제공된 6개에서 아직 확인하지 못했습니다.
이벤트 이름 PTZ_CONTROL은 제어 요청과 상태 이벤트 양쪽에서 사용됩니다. 이름만으로 모든 명령을 허용하지 않습니다.
MOVE_PTZ/SET_ABS_PTZ는 계속 금지합니다. START/STOP은 상태 구독이지만 서버에 요청을 보내는
동작이므로 계약과 권한이 확인되기 전에는 시험하지 않았습니다.
실장비 Pan/Tilt/Zoom 값의 단위·범위·좌표계 및 Zoom -> FOV 관계는 여전히 미확인입니다.

## 다음에 필요한 최소 파일

1. **WebServiceStub.dll**: 직접 참조가 IL에서도 확인됨. POST_SESSION/GET_LOGIN_RESULT,
   GET_ALL_CHANNELS 및 ChannelStubModel의 실제 구현이 여기로 넘어감. 최우선.
2. **HTW.SSM.ConsoleStudio.Services.ControllerService.dll**: system sink/manager 간
   요청·이벤트 라우팅을 조사할 후보. 그 안에 MapTile 구독자가 있다고 확정한 것은 아님.

둘 다 사용자가 보내준 설치 파일 목록에 있습니다. 추가 UI 호출부가 필요하면
HTW.SSM.ConsoleStudio.Views.LiveViewer.dll 또는 ConsoleStudio2.exe를 뒤이어 조사합니다.
이 두 파일의 역할은 아직 분석 전이므로 후보로만 기록합니다.

## 아키텍처 및 검증 한계

ILSpy가 생성한 프로젝트의 대상은 여섯 개 모두 net48입니다. DataStructure 어셈블리 버전은
1.0.9630.28729이며 나머지는 1.0.0.0입니다. 이것만으로 SSM 제품의 정확한 릴리스/패치 버전을
확정하지 않습니다. 보고서의 2.21.00과 자동으로 동일 바이너리라고 단정하지 않습니다.
참조가 없는 Stub/네이티브 UI 관련 타입 때문에 C# 출력에 unresolved/invalid-IL 경고 주석이 있습니다.
중요 Stub 호출 대상은 IL의 [WebServiceStub] 참조로 교차 확인했습니다. 디컴파일 성공은
원본 재빌드, 외부 독립 실행, .NET 8 직접 참조 호환성이 검증됐다는 뜻이 아닙니다.

중앙 Bridge + 여러 PC의 브라우저 목표를 유지합니다. 확인 후 독립 REST/프로토콜 어댑터를
작성할지, 회사 PC에 설치된 구성요소를 사용하는 Windows 보조 프로세스를 둘지 결정합니다.
SSM DLL을 각 브라우저 PC나 공개 ZIP에 배포하는 방식은 추가하지 않았습니다.
이번 변경은 분석 문서만이며 기존 실행 패키지의 동작은 바꾸지 않습니다.

## 추가 파일 분석으로 갱신된 상태

위의 WebServiceStub/ControllerService 추가 필요 항목은 이후 두 원본을 받아 조사했습니다.
로그인/목록 경로·인증 서명·응답 JSON·페이지 및 배치 처리를 확인했으며 ControllerService는 조작 장치 모듈로 제외했습니다.
[최신 추가 분석](ssm-web-controller-analysis.md) 참조. 실장비 성공과 PTZ 연결은 미검증입니다.
