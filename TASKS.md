# Codex Tasks
## P0
- [x] 지정 문서 및 scaffold 검토
- [ ] git init 및 첫 커밋
- [ ] VERIFIED/UNKNOWN 구분 유지

## P1 Camera Inventory
- [ ] SSM camera list 획득
- [x] Name/UUID/PTZ capability 출력 (파일 어댑터)
- [x] GET_POS_NORMALIZE 표시
- [x] 필요한 카메라 선택 UI
- [x] cameras.json 저장

### 이번 구현 상태 (실제 SSM 연결과 구분)
- [x] Bridge 목록 입력 형식 및 파일 어댑터 (SSM native response 아님)
- [x] Name/UUID/Device/Channel/PtzCap 출력, UNKNOWN 표시
- [x] GET_POS_NORMALIZE 및 ABSOLUTE_ZOOM 비트 계산
- [x] 브라우저 검색/카메라 선택 UI
- [x] 중앙 cameras.json 저장, 충돌 검사, 기존 보정 메타데이터 보존
- [x] HTTP 통합/브라우저 테스트 작성
- [ ] 실제 SSM 전체 조회 및 field/pagination/auth 검증 (사용자 확인: 아직 미확인)

상단 P1의 실제 SSM 목록 획득 완료는 주장하지 않습니다. 상세 범위: `docs/camera-inventory.md`.

## P2 PTZ Stream
- [ ] 선택 UUID START
- [ ] PTZ_CONTROL event receive
- [ ] Pan/Tilt/Zoom cache
- [ ] STOP
- [ ] read-only guard

## P3 Bridge
- [ ] REST
- [ ] WebSocket
- [ ] reconnect/logging/health

## P4 Park Model
- [ ] park category
- [ ] camera geolocation
- [ ] calibration offsets

## P5 VWorld 3D
- [ ] park selector
- [ ] markers
- [ ] pan heading
- [ ] tilt
- [ ] zoom-to-FOV
- [ ] frustum

## P6 Terrain visibility
- [ ] DEM/terrain sampling
- [ ] ray casting
- [ ] occlusion
- [ ] visible footprint
