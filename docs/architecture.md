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
