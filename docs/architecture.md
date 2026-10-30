# Architecture
```text
Wisenet SSM / NVR
      |
      v
PTZ Bridge Service
  - camera inventory
  - selected camera registry
  - PTZ subscription
  - current-state cache
  - REST + WebSocket
      |
      v
VWorld 3D Web App
  - park selector
  - camera selector
  - live PTZ
  - 3D frustum
  - terrain visibility
```

## API 초안
- `GET /health`
- `GET /api/parks`
- `GET /api/cameras`
- `GET /api/ptz`
- `GET /api/ptz/{uuid}`
- `WS /ws/ptz`

## 현재 구현된 지도 설정 경로

중앙 Bridge가 웹앱과 `GET/PUT /api/map-configuration`을 제공하고 `MAP_CONFIG_FILE`에 저장합니다.
사용자는 로컬 참조 이미지와 가상 지도 시점을 수동으로 맞추며 서버에는 이미지 원본 없이 위치·추정·근거 메타데이터만 저장합니다.
현재 상태는 `manual-calibration` / `estimate` 또는 `stale` / `unvalidated`이며 실시간 PTZ 캐시와 구분합니다.
변화 감지는 수동이고 실제 가시영역·오차 계산은 아직 없습니다. [사용 및 운영 범위](terrain-calibration.md).
