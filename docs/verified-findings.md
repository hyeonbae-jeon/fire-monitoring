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
