# PTZ Bridge
첫 milestone은 SSM camera inventory다.
출력 필드: Name, UUID, Device/Channel, PtzCap, GET_POS_NORMALIZE.
그 다음 선택 카메라에 대해 READ-ONLY `GET_ABS_PTZ_START/STOP`을 구현한다.
초기 구현에서 `MOVE_PTZ` / `SET_ABS_PTZ` 금지.

현재는 `ICameraInventorySource` + `FileCameraInventorySource`로 구현했습니다.
실제 SSM 조회/구독/이벤트 어댑터는 아직 없습니다. 중앙 웹 UI, GET inventory/config,
인증 키를 요구하는 PUT selection, 원자적 JSON 저장은 구현했습니다.
실행 환경변수 및 빌드는 루트 README, 계약은 `docs/camera-inventory.md`를 참조하세요.
