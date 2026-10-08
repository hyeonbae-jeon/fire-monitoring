# SSM PTZ Protocol Notes
## Subscribe request
```text
REQ_TYPE.PTZ_CONTROL
PtzCtrl.Uuid = camera UUID
PtzCtrl.Command = PTZ_COMMAND.ABS_PTZ
PtzCtrl.Action = PTZ_ACTION.GET_ABS_PTZ_START / STOP
```
## Event
```text
EVENT_TYPE.PTZ_CONTROL
EventObj.m_lstData[0] = PtzCtrl
```
## State
```text
PtzCtrl.m_fPan
PtzCtrl.m_fTilt
PtzCtrl.m_fZoom
```
## Capability gate
```text
PTZ_CAP_TYPE.GET_POS_NORMALIZE = 268435456
```

위 비트 외에도 Camera 여부, ENTITY_CAPABILITY.PTZ_CONTROL,
CAMERA_PTZ/CAMERA_PT_DRIVER ChannelSubType 조건이 필요함.
대상 카메라 전부가 이 조건을 만족하는지는 실장비에서 미확인.

## 내부 전달 경로와 외부 연결의 경계

추가 전달된 정적 분석 결과(`PTZ_CODE_TRACE_STATUS.md`):

```text
MediaService.RequestEx(ref RequestObj, Guid)
  -> 카메라 UUID의 Media Gateway / CONTROL session 조회
  -> ControlSession.Request(RequestObj)
```

기존 handoff에서 ControlSession.Request 이후의 MakeRequestPacket/BeginSend도 확인됐다고 보고됨.
하지만 MapTile.ReqABSPTZPos -> OnRequest의 subscriber가 이 경로와 어떻게 연결되는지,
외부 프로세스가 인증하여 세션을 얻는 방법은 아직 UNKNOWN. 두 경로를 임의로 이어 구현하지 않음.

## 표시값과 물리 좌표

SetObjectPTZAngle의 GROUND/CEILING Pan 부호와 Tilt > 90일 때의 180도 보정은
SSM XMap 표시 로직임. 북쪽 기준 방위각, 실제 설치 방향, Tilt 좌표계는 별도 캘리브레이션이 필요함.
이 함수는 m_fZoom을 사용하지 않으며, Zoom 단위·범위와 광학 FOV 변환은 UNKNOWN.

장비별 SUNAPI/ONVIF 조회로 대체하는 경우에도 지원 여부·명세를 먼저 확인하고,
장비 ID/ProfileToken/채널 ID를 SSM camera UUID와 동일하다고 취급하지 않음.
