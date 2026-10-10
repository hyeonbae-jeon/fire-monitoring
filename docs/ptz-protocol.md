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

## 현재 위치·북쪽 보정의 다음 조사 범위 (2026-10-10)

현재 연결 진단은 목록 조회만 수행하고 PTZ 상태 요청은 수행하지 않습니다.
목록 로그인 성공은 PTZ 권한 승인이나 거절을 증명하지 않습니다.
설치 DLL의 CHANNEL_PERMISSION.PTZ_CONTROL 및 USER_PERMISSION.PTZ_CONFIG enum은 확인됐지만,
실제 계정에서 해당 권한이 부여됐는지 또는 상태 구독에 어떤 권한이 필요한지는 미확인입니다.
장치 ENTITY_CAPABILITY.PTZ_CONTROL과 계정 CHANNEL_PERMISSION.PTZ_CONTROL을 혼동하지 않습니다.
PTZ_AUTHORITY 요청도 존재하지만 조회 허용 여부 확인을 대신해 조작권 요청을 보내지 않습니다.

ObjConverter는 ChannelStubModel의 extendedData JSON 문자열에서 heading을 읽어 Camera.headingAngle에 저장합니다.
이후 SystemService도 headingAngle을 갱신합니다. 그러나 현재 진단 미리보기는 이 필드를 저장하지 않습니다.
다음 읽기 진단의 우선 항목은 선택된 UUID의 capability/subType/installType 및
extendedData 안의 latitude/longitude/heading 존재·값입니다. 전체 extendedData나 장치 접속 정보를 공유 로그에 복사하지 않습니다.
설정 heading이 실시간 Pan이거나 북쪽 보정값이라는 뜻은 아직 입증되지 않았습니다.

heading 사용처를 더 찾을 설치 목록의 후보는 HTW.SSM.ConsoleStudio.Views.GoogleMapViewer.dll입니다.
MapTile 화면 연결 조사 후보인 CustomControl.ViewForm/XScreenControl11과 용도가 다릅니다.
추가 파일에 북쪽 보정 구현이 있다고 확정하거나 제공된 기존 DLL에 개별 현장 설정값이 있다고 가정하지 않습니다.

운영 설정값/권한 범위는 회사 SSM 실응답 및 사용자 그룹의 대상 카메라 권한에서 확인합니다.
현재 PTZ는 별도 MediaGateway CONTROL 세션의 허용된 위치 구독을 구현·검증해야 합니다.
대안 SUNAPI/ONVIF GetStatus는 카메라별 공식 API 명세와 실제 지원·자격 증명·UUID 매핑을 확인한 뒤 검토합니다.
카메라 Pan 원점과 지리적 북쪽은 같다고 가정하지 않습니다. 보정은 등록 설치 방향 또는
시각이 일치하는 현재 영상·PTZ 관측·식별 가능한 지형 기준점을 대조하고 단위/부호를 확인해 산출합니다.
설정/북쪽 지정/프리셋 이동은 하지 않으며 MOVE_PTZ / SET_ABS_PTZ 금지는 유지합니다.

## 저장 메타데이터 이후와 단일 상태 조회 시험

진단 v2 현장에서 146개의 정규화 heading/좌표는 null, subType=0, installType=2였습니다.
현재 PTZ 관측은 별도 미확인입니다. 추가 두 대상 설정 사진은 SUNAPI 등록과 카메라 유형 없음/천장 표시를 확인합니다.
CONTROL 로그인 digest·사용자 ID 암호화·TLS 전환도 더 조사했으나 현장 세션은 미검증입니다.
[추가 조사와 전환 기준](ptz-investigation-decision.md),
[공식 ONVIF 계약에 한정한 대안 시험 도구](ptz-readonly-test.md)를 참조합니다.
SUNAPI 현재 위치 계약은 아직 미확인으로 추측한 HTTP 경로를 시험하지 않습니다.
