# Camera Inventory 구현 및 scaffold 검토

## 근거와 범위

사용자 요청은 읽기 전용 시작, MOVE_PTZ / SET_ABS_PTZ 금지, UNKNOWN 추측 금지,
중앙 Bridge + 브라우저 웹앱입니다. 첨부 문서는 분석 근거와 설계 자료이며, 첨부 TASKS의
git init/첫 커밋 지시는 별도 사용자 요청으로 취급하지 않았습니다. 기존 저장소에서 작업했습니다.

현재 VERIFIED는 첨부 ILSpy 분석에 따른 enum 값 및 내부 처리 경로입니다.
이번 작업은 그 분석을 장비에서 새로 검증한 것이 아닙니다. 사용자 답변에 따라 실제 SSM 조회는
보류합니다. 네트워크의 `/v3/channels` 경로 존재는 전체 목록을 가져올 수 있는 완성된 계약이 아닙니다.

scaffold 문제:

- 기존 inventory stub은 항상 빈 목록을 반환하고 성공처럼 보이는 START/STOP 메서드를 제공했습니다.
- CameraConfig는 위치·보정 설정과 조회 데이터를 섞었으며 capability가 없었습니다.
- CameraRegistry는 메모리에서만 유지되어 재시작 시 선택을 잃었습니다.
- 웹은 지도 placeholder뿐이었고 API 프록시, 선택, 설정 저장이 없었습니다.
- 의존성은 `latest`였으며 lockfile과 타입 검증이 없었습니다.
- 별도 ONVIF probe가 TLS 검증을 우회했습니다. 해당 우회는 제거했고 probe는 실행하지 않았습니다.

## 접근과 아키텍처

```text
검증된 SSM 조회 인터페이스 (UNKNOWN, 현재 연결하지 않음)
  -> 향후 ICameraInventorySource 구현
현재: 운영자가 검증·정규화한 전체 목록 파일
  -> FileCameraInventorySource
  -> GET /api/inventory
  -> 중앙 Bridge가 제공하는 브라우저 UI
  -> PUT /api/cameras
  -> 중앙 cameras.json
향후: 선택 UUID 기반 읽기 전용 PTZ 구독 -> VWorld 3D -> terrain visibility
```

이번 실행 코드에는 SSM HTTP 클라이언트, 내부 DLL 참조, PTZ 명령 디스패처가 없습니다.
설정 저장은 Bridge 로컬 파일만 수정합니다. 구독 START/STOP도 아직 구현하지 않았습니다.
지도와 라이브 PTZ를 빈 데이터로 성공 처리하지 않습니다.

## 목록 입력 계약 (Bridge 자체 형식)

`config/inventory.example.json`을 참조하세요. 원본 SSM JSON과 혼동하지 마세요.

- `schemaVersion`: 1
- `complete`: true. 입력 작성자가 전체 목록 수집 완료를 선언한 경우에만 사용
- `totalCount`: cameras 항목 수와 정확히 일치
- `capturedAt`: 출처에서 목록을 수집한 시각 (시간대 포함)
- `provenance`: 검증된 수집 방식/출처 설명. 인증 정보는 넣지 않음
- `cameras`: `uuid`, `name`, nullable `channel`, nullable `device`, nullable `ptzCap`
- `ptzCap`: unsigned 64비트 **10진 문자열**. JSON 숫자는 JS 정밀도 손실 때문에 거부
- 알 수 없는 필드는 `null`. capability=0은 확인된 비트 없음이며 UNKNOWN과 구분

일부 페이지를 전체로 표시하지 마세요. 현재 어댑터는 총 개수 일치와 `complete=true`를
확인하지만 실제 SSM 서버의 전체 개수나 최신 여부는 검증할 수 없습니다. UI/API가 이 한계를
명시합니다. 빈 전체 목록도 totalCount=0과 complete=true 선언이 필요합니다.
파일을 교체할 때도 임시 파일 생성 후 원자적 이름 변경을 권장합니다.
10 MiB 제한, 잘못된 UUID/중복 UUID/빈 이름/uint64 범위 초과/형식 불일치는 오류로 처리합니다.
미설정/읽기 실패는 503이며 정상적인 0대 목록으로 바꾸지 않습니다.

첨부 VERIFIED 값 `GET_POS_NORMALIZE=268435456`, `ABSOLUTE_ZOOM=17179869184`만
비트 테스트에 사용합니다. `GET_POS_NORMALIZE=true`를 전체 구독 자격으로 단정하지 않습니다.
ENTITY_CAPABILITY.PTZ_CONTROL과 ChannelSubType 확인이 추가로 필요하며 그 외부 조회 매핑은 UNKNOWN입니다.

## 선택 및 저장

PUT 본문:

```json
{
  "cameraUuids": ["11111111-1111-4111-8111-111111111111"],
  "configurationRevision": "GET /api/cameras 결과 revision",
  "inventoryVersion": "GET /api/inventory 결과 version"
}
```

UUID로 식별하므로 표시명 변경은 같은 카메라 설정을 갱신합니다. 서버는 현재 전체 목록에
존재하는 UUID만 허용합니다. capability UNKNOWN 또는 false인 카메라도 목록/설정에 보관할 수 있습니다.
필터를 바꿔도 선택은 유지됩니다. 기존 선택이 새 목록에서 사라졌으면 UI가 별도로 표시하며
목록 완전성 확인 후 명시적으로 제거해야 저장할 수 있습니다.

선택되지 않은 카메라는 cameras 배열에서 제거되며 빈 선택은 명시적인 전체 해제입니다.
계속 선택된 UUID의 위치/공원/보정값/model/확장 메타데이터는 보존하고, 관측 이름·channel·device·
capability와 enabled만 갱신합니다. 새 카메라의 미확인 위치·보정값은 null입니다.
기존 설정이 손상됐으면 덮어쓰지 않습니다. 예전 cameras.example.json의 placeholder UUID는
운영 설정으로 복사하지 마세요.

다른 브라우저가 먼저 저장했거나 목록 파일이 바뀌면 409로 거부합니다. 같은 디렉터리에 임시 파일을
기록·flush한 뒤 이름을 원자적으로 교체합니다. 인스턴스 내부 gate와 sidecar lock으로 Bridge끼리의
동시 쓰기를 막습니다. 한 설정 파일은 중앙 Bridge 한 곳에서 관리하세요. 외부 편집기는 lock을
따르지 않으므로 Bridge를 멈춘 뒤 수정하세요. 동일 파일/별칭을 목록 입력과 출력에 겸용하지 마세요.

저장 키가 없으면 쓰기 비활성(503), 틀린 키는 401입니다. 키는 서버 환경에 보관하며 UI에서는
메모리에만 유지하고 저장 성공 시 비웁니다. 전체 조회에 별도 로그인 UI를 구현하지 않았으므로
중앙 배포는 TLS와 인증 프록시 뒤에서 제공하세요. 실제 운영 배포/SSM 연결은 이번 검증 대상이 아닙니다.

## 실제 SSM 어댑터를 구현하기 전에 확인할 것

추가 코드 추적 문서와 비교 결과는 [ptz-trace-review.md](ptz-trace-review.md) 참조.
다음 정적 분석 후보는 DataService/관련 모델, WebServiceStub의 실제 채널 조회,
MediaService/ControlSession 초기화 및 MapTile.OnRequest subscriber임.
내부 RequestEx 경로가 보고됐어도 전체 목록 계약이나 외부 인증이 확인된 것은 아님.

1. 지원되는 외부 인터페이스(공식 SDK/API/검증된 export), 버전 및 사용·재배포 조건
2. 로그인/세션/계정 권한/TLS 방식. 비밀값은 채팅이나 소스에 남기지 않음
3. 정확한 camera UUID와 channel/device 관계, 이름, uint64 PtzCap 필드 매핑
4. 페이지/서버/컴포넌트별 조회 범위와 전체 수집 완료 조건. 부분 실패는 전체 성공으로 처리하지 않음
5. ENTITY_CAPABILITY/ChannelSubType 필드 매핑 및 UNKNOWN 처리
6. 실제 read-only 계정으로 전체 조회 결과와 SSM 화면의 수·UUID 대조

검증된 응답 표본과 명세를 확보하면 ICameraInventorySource만 교체하며 선택·설정·웹 구조는 유지합니다.
SSM 접속 실패/일부 페이지 실패/UUID 충돌 시에도 기존 선택 설정은 보존해야 합니다.

## 검증

HTTP 통합 테스트는 실제 .NET 프로세스와 임시 파일을 사용합니다. 브라우저 테스트는 실제 Bridge가
제공하는 빌드된 웹앱을 Chromium에서 실행합니다. 테스트 데이터는 전부 합성이며 장비 요청은 없습니다.
테스트는 uint64 최대값, UNKNOWN, 잘못된/부분 목록, 선택 검증, 인증, 메타데이터 보존,
재시작 지속성, 동시 저장/오래된 목록 충돌, 손상 파일 보존과 웹 선택 흐름을 확인합니다.
실제 SSM 전체 조회, PTZ, VWorld, 여러 운영 PC 접속 및 운영 배포는 미검증입니다.
