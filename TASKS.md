# Codex Tasks

## 현재 우선 작업 — 백운대 영상·지형 수동 보정 (2026-10-10)
- [x] 사용자 요청으로 현재 PTZ 인증 조사/진단 v5 현장 시험을 보류
- [x] 백운대 실제 설치 좌표 사용자 확인을 private 자료에 기록
- [x] 단독 참조 이미지 로컬 표시, 이미지 해시/촬영 시각/기준점 기록
- [x] 가상 방위각/기울기/화각/설치 높이와 지도 시점 비교 화면
- [x] 추정/미검증 상태, 방향·줌 변경 시 수동 무효화/UNKNOWN
- [x] 위치·보정 중앙 저장 API, 저장 키, revision 충돌 및 손상 파일 보존
- [x] HTTP 통합 27개, 브라우저 15개(모의 SDK), 로컬 패키지 시작/저장/재시작 1개 통과
- [ ] 실제 VWorld 인증/지형 로딩 및 백운대 주간 원본과 정합 검증
- [ ] 보정에 사용하지 않은 기준점으로 오차 확인 후 다른 카메라 확대
- [ ] 자동 영상 변화 감지/능선 대응/실시간 추정 (현재 범위 밖)

아래 PTZ 조사 항목은 기록/향후 목표이며 보정의 선행 조건이 아닙니다.
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
- [x] 실제 UUID-좌표 매핑은 private 자료로 보관; 중앙 지도 설정 저장 API 구현

## SSM 장치 리포트 입력
- [x] Excel XML의 Camera Name/Guid/Model/PTZ 읽기 및 민감 열 제외
- [x] 미리보기, 전체 범위·수집 시각 확인, 인증된 중앙 목록 교체
- [x] 보고서 PTZ bool과 PtzCap UNKNOWN 구분, 선택·모델 정보 저장
- [ ] 보고서 출력 범위와 실시간 이벤트 UUID 일치 검증

## 원본 SSM DLL 정적 조사
- [x] 제공된 6개 원본 SHA256 기록, 실행 없이 디컴파일
- [x] UUID/이름/PtzCap 모델 변환, 로그인/조회 Stub 호출, CONTROL 세션 및 PTZ 이벤트 경로 확인
- [x] 위치/heading 확장 필드 존재와 실제 의미 미확인 구분
- [x] WebServiceStub 실제 인증/조회 계약 및 페이지 처리 정적 확인
- [x] ControllerService 요청·이벤트 연결 조사 (SPC 조작 장치 담당)
- [ ] 독립 읽기 전용 연결 및 실장비 PTZ 수신 검증

## 추가 WebServiceStub / ControllerService 정적 조사
- [x] 실제 로그인 경로, 쿠키/서명, RSA 처리 및 성공 응답 필드 확인
- [x] 서버/컴포넌트/채널 조회 JSON, 권한 매핑 페이지와 배치 크기 확인
- [x] ControllerService를 SPC 조작 장치 모듈로 확인하여 지도 라우터 후보에서 제외
- [ ] 현장 상태 GET 및 버전/SSL/권한/응답 검증
- [x] SystemService 중앙 PTZ 요청 전달 및 지정 sink 이벤트 배분 확인
- [x] LiveViewer의 SYSTEM_MAN 입력 및 외부 BaseViewerForm/XScreen 위임 확인
- [ ] MapTile와 화면의 직접 연결 (독립 목록 조회의 선행 조건 아님)

## 인증서 고정 연결 진단
- [x] 현장 HTTP 상태 GET: 200 / START / 2.21.00 / SSL 포트·공개키 존재 (사용자 실행 결과)
- [x] 제공된 인증서를 정적으로 검사: 자기 서명, 유효기간 내, SAN 없음; 서버 진위 독립 확인은 미완료
- [x] 독립 HTTPS 지문 고정, 상태 조회, 정상 로그인 1회 및 이름/UUID/PtzCap 미리보기 도구 구현
- [x] CLIENT_SDK wire service=12 / TSM / 자기 세션 로그아웃 계약을 원본에서 추가 확인
- [x] 합성 HTTPS 계약 테스트 14개 및 인증서 날짜/가용성 검사 4개 통과
- [x] 회사 PC에서 지문 고정 HTTPS 상태·로그인·목록 조회·자기 세션 로그아웃 성공 확인 (고유 UUID 146개)
- [ ] 계정/서버/연합의 전체 등록 범위 대조 후 목록 선택 설정에 반영

- [x] 이전 보고서 140개 UUID/이름 전체 일치 및 추가 6개 대조
- [x] GET_POS_NORMALIZE 비트 관측 후보 6개 확인 (PTZ 수신 성공과 구분)

## 북한산 운용 대상 및 사무소 확장
- [x] 사용자 선택 기준 기록: 이름에 북한산 포함, 북한산도봉 제외
- [x] 현장 목록에서 대상 9개 확인, GET_POS_NORMALIZE 후보 3개 관측
- [ ] 선택 대상 9개의 앱 설정 저장·재시작 검증
- [ ] UUID 기반 사무소 메타데이터 및 분류/필터 UI 구현 (타 사무소 확장 요구)
- [x] 사용자 제공 대상 9개 위치 좌표를 고유 SSM UUID에 연결하고 기존 지도 JSON 입력 검증
- [ ] 실제 현재 PTZ 수신 및 설치 방향 보정 확인

[사무소별 선택 기준](docs/office-selection-policy.md). 운영 이름/UUID와 선택 미리보기는 로컬에만 보관합니다.

## GoogleMapViewer 및 저장 heading 조사
- [x] 사용자 제공 Console 설치 경로 기록
- [x] GoogleMapViewer 실행 없이 C#/IL 조사; heading/current Pan 직접 사용은 발견하지 못함
- [x] 동일 목록 GET에서 capability/subType/installType 및 확장 좌표/heading만 추출하는 진단 v2 구현
- [x] XMap 데이터 조건과 계정 권한/실수신 성공 구분
- [x] 회사 PC 진단 v2 목록/메타데이터 146개 및 선택 9개 대조: heading/좌표 null, subType=0, installType=2
- [ ] subType=0 원인 및 실제 설치/북쪽 보정 확인 (전체 XMap 데이터 조건 false와 실제 수신 가능성 구분)

[분석](docs/ssm-google-map-analysis.md). 실제 방향 보정값 발견 또는 PTZ 수신 성공으로 처리하지 않습니다.

## 단일 현재 PTZ 검증과 영상 보정 전환
- [x] 두 대상 설정 사진: XNP-6550RH/SUNAPI, 유형 없음/천장 표시 확인
- [x] CONTROL login digest·사용자 ID 암호화·TLS 전환 추가 정적 조사
- [x] 공식 ONVIF WSDL 확인 및 단일 GetStatus 읽기 도구 구현
- [x] 합성 ONVIF 실행 검증 22개 통과 (운영 연결과 구분)
- [ ] 대상의 서비스 URL/포트·장비 계정 및 공식 SUNAPI 현재 위치 명세 확인
- [ ] 한 대의 현재 위치 수신·space/시각/SSM UUID 매핑 검증
- [ ] 위치 갱신/좌표계 및 북쪽 기준·Zoom/FOV 별도 검증
- [x] PTZ 우선 검증과 영상/지형 보정으로 전환할 조건 문서화

[시험 도구](docs/ptz-readonly-test.md) · [추가 조사와 전환 기준](docs/ptz-investigation-decision.md).

## 주소창 없는 카메라 설정 화면의 접속 정보 조사
- [x] 대상 MAC 일치 및 카메라 자체 HTTP 80/HTTPS 443/RTSP 554 확인; 외부 포트와 구분
- [x] 원본 networkInfo 주소/포트 매핑 확인; 기존 목록 GET의 선택 한 대 추출을 진단 v3에 추가
- [x] 합성 SSM 검증 28개 통과: 추가 네트워크 요청 없음, 명시적 선택, credential URL/범위 오류/비밀 필드 제외
- [x] 회사 PC v3에서 선택 한 대의 연결 정보·동일 UUID 대조; 카메라 HTTP/HTTPS 포트 화면 일치 및 component TCP 4510 확인
- [x] 회사 PC TCP 결과 대조: 카메라 HTTP 80=true/HTTPS 443=false, component TCP 4510=true (신원·인증·PTZ와 구분)
- [x] 등록 HTTP origin의 사용자 화면에서 Hanwha Vision WebViewer 제목 및 브라우저 인증 요구 관측
- [x] 사용자 WWW-Authenticate=Digest 관측 및 장비 계정 모름 반영
- [ ] 모델/MAC 등 고유 장비 매핑 및 직접 조회에 필요한 장비 계정 확보
- [ ] 카메라 443 실패 원인 조사 및 CONTROL 인증/TLS 별도 검증
- [ ] 실제 도달 경로·ONVIF 서비스 또는 공식 SUNAPI 현재 위치 계약 확인 후 단일 상태 응답 검증

## 카메라 장비 계정 미확인: SSM CONTROL 조사
- [x] 사용자 장비 계정 미확인 반영; 일반 CONTROL의 현재 SSM User/세션 인증 경로 정적 확인
- [x] ServerStub type=4097 → MediaGateway와 컴포넌트/Recorder 계층 구분; REST service=12 vs CONTROL ClientType=4096 확인
- [x] 같은 목록 GET의 한 대 도메인/부모/타입 관계 및 로그인 키/UID 가용성만 기록하는 진단 v4 구현
- [x] 합성 SSM 시험 36개 및 인증서 검사 4개 통과; 관계 불일치/누락·비밀 값 제외·추가 요청 없음 확인
- [x] 회사 PC v4: 146대/선택 9대 유지, MediaGateway·컴포넌트 참조/도메인 일치 및 로그인 키/UID 존재 확인
- [x] GET_DOMAIN→DEFAULT_MGMT_UID 갱신 정적 확인 및 로컬 도메인 선택 GET을 진단 v5에 추가
- [x] v5 합성 HTTPS 51개 및 인증서 검사 4개 통과; Windows 패키지 생성·무결성/개인정보 제외 검증
- [ ] 회사 PC에서 v5 현재 로컬 도메인·버전·등록 관계 대조 (사용자 요청으로 보류)
- [ ] 확인된 관계로 정상 CONTROL 인증/TLS 및 한 대 읽기 전용 현재 위치 수신 검증 (보류)
