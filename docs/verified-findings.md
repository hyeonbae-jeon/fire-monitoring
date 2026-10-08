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
