# Web App
목표: VWorld 3D, 공원 카테고리, CCTV 선택, Bridge WebSocket PTZ 수신, UUID→위치→Pan/Tilt/Zoom→3D frustum.
VWorld API 키는 코드에 하드코딩하지 않는다.

현재는 Camera Inventory 목록/검색/선택/중앙 저장 UI입니다. VWorld와 라이브 PTZ는 미구현입니다.
`npm ci`, `npm run build`로 타입 검증 및 정적 빌드를 합니다.
`npm run dev`의 `/api`는 `127.0.0.1:5080` Bridge로 프록시됩니다.
중앙 서비스는 웹을 Bridge의 wwwroot로 빌드하고 Bridge에서 함께 제공합니다(루트 README 참고).
사용자 PC의 localhost를 API 주소로 사용하지 않습니다.
