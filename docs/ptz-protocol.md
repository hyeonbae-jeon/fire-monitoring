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
