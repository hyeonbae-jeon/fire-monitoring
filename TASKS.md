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
- [x] 추가 PTZ_CODE_TRACE_STATUS 문서 비교 및 새 내부 코드 위치/미확인 범위 기록
- [ ] 실제 DLL/ILSpy 코드로 DataService 조회 및 MediaService/ControlSession 초기화 조사
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

## VWorld 위치 시안 (실장비 정보 확보 전)
- [x] WGS84 북한산 임의 위치, 선택, JSON 입력/내보내기
- [x] 기존 사이트와 같은 v3 SDK 연결 코드 및 모의 SDK 브라우저 검증
- [x] 실제 방향 UNKNOWN 및 수동 시험 부채꼴 구분
- [x] 영상/지형 기반 방향 추정 가능 조건 검토
- [ ] 등록 주소·실제 키로 VWorld 인증/3D 지형 로딩 확인
- [ ] 실제 UUID-좌표 매핑 및 중앙 지도 설정 저장

## SSM 장치 리포트 입력
- [x] Excel XML의 Camera Name/Guid/Model/PTZ 읽기 및 민감 열 제외
- [x] 미리보기, 전체 범위·수집 시각 확인, 인증된 중앙 목록 교체
- [x] 보고서 PTZ bool과 PtzCap UNKNOWN 구분, 선택·모델 정보 저장
- [ ] 보고서 출력 범위와 실시간 이벤트 UUID 일치 검증

## 원본 SSM DLL 정적 조사
- [x] 제공된 6개 원본 SHA256 기록, 실행 없이 디컴파일
- [x] UUID/이름/PtzCap 모델 변환, 로그인/조회 Stub 호출, CONTROL 세션 및 PTZ 이벤트 경로 확인
- [x] 위치/heading 확장 필드 존재와 실제 의미 미확인 구분
- [ ] WebServiceStub 실제 인증/조회 계약 및 페이지 처리
- [ ] ControllerService 요청·이벤트 연결 조사
- [ ] 독립 읽기 전용 연결 및 실장비 PTZ 수신 검증
