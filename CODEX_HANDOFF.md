# CODEX HANDOFF — Wisenet SSM 산불 CCTV 3D 감시영역 시스템

## 0. Codex가 가장 먼저 읽을 것
이 프로젝트의 목표는 **Wisenet SSM에 등록된 산불감시 CCTV 중 필요한 카메라(현재 9대)의 실시간 PTZ(Pan/Tilt/Zoom)를 얻어, 국립공원별로 분류하고 VWorld 3D 지도에 현재 감시방향/시야영역을 표시**하는 것이다.

최종 배포 목표는 **특정 관제 PC에 종속되지 않고 여러 PC에서 웹브라우저로 사용할 수 있는 구조**다.

Codex 원칙:
1. 아래 VERIFIED 항목은 실제 Wisenet SSM 2.21 설치파일을 ILSpy로 역분석해 확인한 사실이다.
2. UNKNOWN 항목을 추측으로 확정하지 말 것.
3. 구현 순서: **SSM 카메라 목록/UUID 확보 → 필요한 9대 선택 → 실시간 PTZ → VWorld 3D → DEM 가시영역**.
4. 운영 중 CCTV이므로 초기 구현은 읽기 전용. MOVE_PTZ/SET_ABS_PTZ 금지.
5. 비밀번호/내부 IP/토큰 하드코딩 금지.

## 1. 운영 환경
### VERIFIED
- Wisenet SSM 버전: `2.21.00_260514`
- 확인된 카메라 모델: `Hanwha Vision XNP-6550RH`
- 카메라는 NVR을 거쳐 SSM에 연결된 운영 환경.
- 분석용 SSM 설치 폴더 복사본을 별도 PC에서 정적 분석함.
- 분석 경로 예: `C:\Users\전현배\Desktop\Wisenet\SSM Client`
- SSM 전체 CCTV는 많고, 우선 프로젝트 대상은 9대.
- 대상 수는 향후 확장될 수 있으므로 9를 하드코딩하지 말 것.

## 2. 최종 권장 아키텍처
```text
[Wisenet SSM / NVR / Cameras]
             |
             v
[PTZ Bridge Service]  <-- 내부망 PC/서버 1대
  - SSM camera inventory / UUID
  - selected camera configuration
  - PTZ subscription
  - PTZ event receive
  - REST + WebSocket
             |
             v
[VWorld 3D Web App]
  - 브라우저 기반
  - 공원 선택
  - CCTV 선택
  - Pan/Tilt/Zoom
  - 3D direction/frustum
  - later: DEM line-of-sight / terrain occlusion
```
사용자 PC마다 SSM DLL을 설치/복사하지 말고 **Bridge 1대 + 웹 클라이언트 다수** 구조를 우선한다.

## 3. VERIFIED — 핵심 PTZ 데이터 구조
`HTW.SSM.Libraries.DataStructure.Control.PtzCtrl : BaseCommand`

주요 필드:
```csharp
public PTZ_COMMAND m_nCommand;
public PTZ_ACTION  m_nAction;
public int   m_nX;
public int   m_nY;
public int   m_nZ;
public int   m_nSpeed;
public float m_fPan;
public float m_fTilt;
public float m_fZoom;
public List<PtzCtrl.ListItem> m_lstItem;
```

직렬화 JSON 필드:
`ParentUuid`, `Uuid`, `TypeName`, `Command`, `Action`, `X1`, `Y1`, `X2`, `Y2`, `X`, `Y`, `Z`, `History`, `Speed`, `Pan`, `Tilt`, `Zoom`, `ChannelSubType`, `CameraInstallType`, `PtzInstallType`, `Profile`, `SubViewIndex`, `ViewModeType`, `Enable`, `ItemList`, `SessionIDList`.

## 4. VERIFIED — PTZ enum
`PTZ_ACTION`:
```text
GET_ABS_PTZ       = 31
SET_ABS_PTZ       = 32
GET_ABS_PTZ_START = 33
GET_ABS_PTZ_STOP  = 34
MOVE_3AXIS        = 35
HOME_GO           = 36
HOME_SET          = 37
SIMPLE_FOCUS      = 38
LIST_CHANGE       = 39
```
`PTZ_COMMAND`에는 `MOVE_PTZ`, `ABS_PTZ`, `PRESET` 등이 존재.

## 5. VERIFIED — PTZ capability
`PTZ_CAP_TYPE : ulong`
```text
PAN                 = 1
TILT                = 2
ZOOM                = 4
PRESET              = 32
GET_POSITION        = 2097152
SET_POSITION        = 4194304
GET_POSITION_SPEED  = 8388608
SET_POSITION_SPEED  = 16777216
GET_POS_NORMALIZE   = 268435456
SET_POS_NORMALIZE   = 536870912
ABSOLUTE_ZOOM       = 17179869184
```
SSM XMap은 `GET_POS_NORMALIZE`를 실제 구독 조건으로 사용한다.

## 6. VERIFIED — 절대 PTZ 구독
`MapTile.ReqABSPTZPos(Guid UID, bool bStart)`:
```csharp
PtzCtrl ptzCtrl = new PtzCtrl();
ptzCtrl.Uuid = UID;
ptzCtrl.m_nCommand = PTZ_COMMAND.ABS_PTZ;
ptzCtrl.m_nAction = bStart ? PTZ_ACTION.GET_ABS_PTZ_START : PTZ_ACTION.GET_ABS_PTZ_STOP;
requestObj.m_lstData.Add(ptzCtrl);
requestObj.m_nCommand = REQ_TYPE.PTZ_CONTROL;
requestObj.m_nSubCommand = SUB_REQ_TYPE.NONE;
OnRequest(requestObj);
```
`ReqABSPTZPosAll(bool)`도 존재하며 대상 카메라들을 순회해 START/STOP 요청을 보낸다.

## 7. VERIFIED — PTZ 이벤트 수신
`MapTile.OnEvent(EventObj evtObj)`:
```csharp
case EVENT_TYPE.PTZ_CONTROL:
    if (m_plMapPlane != null && evtObj.m_lstData.Count > 0 && evtObj.m_lstData[0].GetType() == typeof(PtzCtrl))
        m_plMapPlane.SetPtzCtrlQueue((PtzCtrl)evtObj.m_lstData[0]);
    break;
```
즉 실시간 PTZ 상태는 `EVENT_TYPE.PTZ_CONTROL` 이벤트 경로로 들어온다.

## 8. VERIFIED — 지도에서 현재 PTZ 사용
`XMapPlane.SetPtzCtrlQueue(PtzCtrl)`는 `m_PtzQueue`에 추가.

`XMapPlane.SetObjectPTZAngle(XMapObjects xObject)`:
- `xObject.UID`와 `PtzCtrl.Uuid` 매칭
- `m_fPan`, `m_fTilt` 사용
- CEILING/GROUND 설치형태 보정
- `xObject.SetPanAngle(...)` 호출

GROUND:
```csharp
float pan = ptzCtrl.m_fPan;
if (ptzCtrl.m_fTilt > 90f) pan += 180f;
xObject.SetPanAngle(pan);
```
CEILING:
```csharp
float pan = -ptzCtrl.m_fPan;
if (ptzCtrl.m_fTilt > 90f) pan -= 180f;
xObject.SetPanAngle(pan);
```

## 9. VERIFIED — 지도에 카메라 추가 시 구독 조건
`XMapPlane.AddObject(...)`에서 다음을 모두 만족하면 `ReqABSPTZPos(objectInfo.Uuid, true)` 호출:
- object is Camera
- `ENTITY_CAPABILITY.PTZ_CONTROL`
- ChannelSubType = `CAMERA_PTZ` 또는 `CAMERA_PT_DRIVER`
- `PtzCap & GET_POS_NORMALIZE`

## 10. VERIFIED — 제어/전송 경로
일반 이동:
`PTZPanel -> PtzCommandWating -> TickPTZ_MoveCommand() -> PtzCtrl(Command=MOVE_PTZ) -> RequestEX()`

절대 PTZ 설정:
```csharp
ptzCtrl.Uuid = CurrentPTZTargetCamera.Uuid;
ptzCtrl.m_nCommand = PTZ_COMMAND.ABS_PTZ;
ptzCtrl.m_nAction = PTZ_ACTION.SET_ABS_PTZ;
ptzCtrl.m_nSpeed = 50;
ptzCtrl.m_fPan = fPan;
ptzCtrl.m_fTilt = fTilt;
ptzCtrl.m_fZoom = fZoom;
requestObj.m_nCommand = REQ_TYPE.PTZ_CONTROL;
RequestEX(requestObj);
```

`ControlSession.Request(RequestObj)`에서 `REQ_TYPE.PTZ_CONTROL`은 `MakeRequestPacket(..., MessageType.Command)` 후 `BeginSend(...)`로 네트워크 전송된다.

## 11. VERIFIED — SSM REST/Web 구조 단서
`WebServiceStub.dll`에서 카메라/채널/프리셋 관련 REST 경로 확인:
- `/v3/channels?...`
- `/v3/channels/{channelGuid}/preset?...`
- `/v2/devices/`
- Session/Server/Component/Channel 관련 모델
`PresetStubModel`에는 `CameraUID`, `Index`, `Name`, `Pan`, `Tilt`, `Zoom`, `SubViewIndex`가 존재.

## 12. UNKNOWN — 반드시 추가 확인
1. 외부 독립 프로세스가 SSM 내부 Event Bus에 가장 안정적으로 붙는 방법
2. `MapTile.OnRequest` 이벤트의 최종 subscriber
3. SSM 전체 카메라 목록/UUID를 외부에서 얻는 가장 안정적인 인터페이스
4. 실장비에서 `PtzCtrl.m_fZoom` 의미/단위
5. XNP-6550RH의 Pan/Tilt 이벤트 좌표계 기준
6. SSM 내부 DLL 직접 사용의 버전 민감도
7. SSM DLL 재배포 가능 여부

## 13. 개발 우선순위
### Phase 1 — Camera Inventory
- 전체 SSM 카메라 목록
- 이름 / UUID / channel / device / PtzCap
- GET_POS_NORMALIZE 여부
- 필요한 카메라 선택
- `config/cameras.json` 저장

### Phase 2 — PTZ Bridge
- 선택 카메라 START
- `EVENT_TYPE.PTZ_CONTROL` 수신
- UUID별 Pan/Tilt/Zoom 상태 유지
- 종료 시 STOP

### Phase 3 — Park Configuration
- parkId
- 위도/경도
- 지표고도/카메라높이
- headingOffset/tiltOffset

### Phase 4 — VWorld 3D
- 공원 선택
- 카메라 marker
- 실시간 Pan/Tilt
- Zoom → FOV
- 3D frustum

### Phase 5 — Terrain Visibility
- DEM/terrain sampling
- ray casting
- 산 능선 차폐 제거
- 실제 가시영역 표시

## 14. 최종 사용자 경험
```text
[공원 선택]
북한산국립공원 ▼

[CCTV 목록]
● CCTV A
● CCTV B
...

[VWorld 3D]
- CCTV 위치
- 현재 방향
- 실시간 Pan/Tilt/Zoom
- 3D 시야체적
- 실제 산악 가시영역
```

## 15. 개발 안전수칙
- 초기에는 읽기 전용.
- MOVE_PTZ / SET_ABS_PTZ 금지.
- Camera UUID를 식별 키로 사용.
- 표시명은 변경 가능하므로 식별자로 사용하지 말 것.
- 카메라 수 하드코딩 금지.
- park/camera는 설정 또는 DB 기반.
- credentials는 환경변수/secret 저장.
- Bridge와 Web UI 분리.
- 최종 사용자는 브라우저만 있으면 되도록 설계.
