# SSM PTZ 코드 추적 완료 범위와 다음 작업 (Codex 추가 인수인계)

## 결론
**SSM 2.21.00_260514에서 PTZ 제어, 절대 PTZ 구독 요청, PTZ 이벤트 수신, XMap 방향 반영 코드 위치는 확인됨.** 하지만 **독립 실행형 프로그램에서 SSM에 인증/접속하여 이벤트를 받는 구현은 미완료**. 카메라 목록/UUID 조회 API와 실장비 값의 단위 역시 미확인이다. '모든 9대 PTZ 수신 가능'은 아직 검증되지 않은 목표다.

## 코드 위치 / 확인된 호출

| 목적 | 클래스/메서드 | 확인 내용 |
|---|---|---|
| PTZ payload | `HTW.SSM.Libraries.DataStructure.Control.PtzCtrl` | `Uuid`, `m_nCommand`, `m_nAction`, `m_fPan`, `m_fTilt`, `m_fZoom` |
| 일반 이동 | `PTZPanel.TickPTZ_MoveCommand()` | `REQ_TYPE.PTZ_CONTROL`, `PTZ_COMMAND.MOVE_PTZ`, action/speed 구성 후 `RequestEX()` |
| 절대 위치 설정 | `PTZPanel.Function_Request(float,float,float)` | `ABS_PTZ + SET_ABS_PTZ`, `m_fPan/Tilt/Zoom` 기록 후 `RequestEX()` |
| 절대 위치 구독 | `MapTile.ReqABSPTZPos(Guid UID,bool bStart)` | `ABS_PTZ + GET_ABS_PTZ_START(33)` 또는 `GET_ABS_PTZ_STOP(34)` 후 `OnRequest(requestObj)` |
| 일괄 구독 | `MapTile.ReqABSPTZPosAll(bool)` | XMap 대상 카메라 중 지원 카메라에 대해 구독/해제 |
| PTZ 이벤트 수신 | `MapTile.OnEvent(EventObj)` | `EVENT_TYPE.PTZ_CONTROL`, 첫 payload가 `PtzCtrl`이면 `SetPtzCtrlQueue()` |
| PTZ 큐 | `XMapPlane.SetPtzCtrlQueue(PtzCtrl)` | 큐에 추가 |
| 방향 표시 | `XMapPlane.SetObjectPTZAngle(XMapObjects)` | UUID 일치 항목을 찾아 `m_fPan/m_fTilt`로 지도 방향 조정 |
| 컨트롤 전달 | `MediaService.RequestEx(ref RequestObj,Guid)` | 카메라 UUID의 Media Gateway/CONTROL session을 찾아 `ControlSession.Request()` |

### 구독 요청 (확인된 ILSpy 코드 요지)
```csharp
var requestObj = new RequestObj();
var ptzCtrl = new PtzCtrl();
ptzCtrl.Uuid = UID;
ptzCtrl.m_nCommand = PTZ_COMMAND.ABS_PTZ;
ptzCtrl.m_nAction = bStart ? PTZ_ACTION.GET_ABS_PTZ_START : PTZ_ACTION.GET_ABS_PTZ_STOP;
requestObj.m_lstData.Add(ptzCtrl);
requestObj.m_nCommand = REQ_TYPE.PTZ_CONTROL;
requestObj.m_nSubCommand = SUB_REQ_TYPE.NONE;
OnRequest(requestObj);
```

### 이벤트 수신 (확인된 ILSpy 코드 요지)
```csharp
case EVENT_TYPE.PTZ_CONTROL:
    if (m_plMapPlane != null && evtObj.m_lstData.Count > 0 &&
        evtObj.m_lstData[0].GetType() == typeof(PtzCtrl))
        m_plMapPlane.SetPtzCtrlQueue((PtzCtrl)evtObj.m_lstData[0]);
    break;
```

### 구독 자격
XMap의 `AddObject`는 `Camera`, `ENTITY_CAPABILITY.PTZ_CONTROL`,
`CHANNEL_SUB_TYPE.CAMERA_PTZ` 또는 `CAMERA_PT_DRIVER`,
`(PtzCap & PTZ_CAP_TYPE.GET_POS_NORMALIZE) == GET_POS_NORMALIZE`일 때 `ReqABSPTZPos(uuid,true)`를 호출한다.
`GET_POS_NORMALIZE = 268435456 (0x10000000)`. 지원하지 않는 카메라는 별도 확인 필요.

### 방향 보정
`SetObjectPTZAngle`에서 GROUND는 Pan 그대로, CEILING은 Pan 부호를 뒤집고, Tilt > 90일 때 180도 보정한다. 이는 **SSM 지도 표시 로직**이며 VWorld에서 실제 북쪽 기준 방위각/광학 시야각으로 쓰려면 장비 실측 및 설치 방향 캘리브레이션이 필요하다. `m_fZoom`은 해당 지도 함수에서 사용하지 않는다.

## 미확인 — 완료로 표시하지 말 것
1. `MapTile.OnRequest` 이벤트 구독자/외부 SSM transport 연결의 정확한 호출 경로.
2. SSM 등록 전체 카메라 목록/이름/UUID/PtzCap을 외부에서 얻는 경로.
3. 실제 카메라/NVR/SSM 환경에서 9대가 `GET_POS_NORMALIZE`를 지원하는지.
4. 실시간 PTZ 수신 성공 여부, 단위/좌표계, Zoom과 FOV 관계.
5. SSM 내부 DLL 외부 로드/배포 라이선스 및 업데이트 호환성.
6. 외부 PC에서의 SSM/NVR 네트워크 접근, 인증 및 권한.

## Codex 다음 실행 계획
1. SSM `DataService` 및 관련 assembly에서 camera inventory / UUID / PtzCap의 실제 조회 흐름을 **읽기 전용**으로 추적. 추정 함수명은 증거로 취급하지 말 것.
2. 샘플 장비 1대에서 UUID/PtzCap 확인. 필요한 9대를 공원별로 선택하고 `config/cameras.json`에 저장하는 UI/CLI 구현.
3. SSM 내부 event adapter가 불가능하면 공식 SUNAPI/ONVIF 장비별 조회 경로로 대체하는 adapter 설계. 이 경우 SSM UUID와 장비 ID의 매핑을 별도 관리.
4. 선택된 카메라에만 read-only PTZ 구독/조회. 연결 끊김, 권한 부족, 미지원 장비를 구분해서 표시.
5. 중앙 Bridge의 REST/WebSocket으로 웹에 PTZ 전달. VWorld 3D는 실제 PTZ 검증 후 연결.
6. 실장비에 `MOVE_PTZ`, `SET_ABS_PTZ`를 시험 명령으로 보내지 말 것.

## 첫 Codex 메시지
> `docs/PTZ_CODE_TRACE_STATUS.md`를 먼저 읽어라. 이미 확인된 SSM 내부 PTZ 위치를 다시 추측하지 말고, 미확인 항목인 SSM 카메라 목록/UUID 획득 경로를 우선 조사하라. SSM 2.21.00_260514의 실제 DLL 또는 사용자가 제공한 ILSpy 코드가 필요하면 요청하라. 운영 카메라에 제어 명령을 보내지 말고 읽기 전용으로 진행하라. 9대 선택, 공원별 분류, 중앙 Bridge, VWorld 3D 웹앱 순서를 유지하라.
