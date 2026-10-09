# Open Questions
1. SSM camera inventory 외부 조회 경로
2. Name → UUID → Channel → Device/NVR 관계
3. 독립 프로세스에서 Event Bus 사용 가능 여부
4. `m_fZoom` 의미/범위
5. Pan/Tilt 좌표계/설치 기준
6. SSM DLL 직접참조 vs 장비 API
7. SSM 버전 변경 호환성
8. SSM DLL 재배포 가능 여부
9. VWorld terrain/DEM 기반 가시권 구현 방법

## 추가 handoff 반영 후에도 미확인인 항목

- `MapTile.OnRequest` subscriber와 `MediaService.RequestEx` 경로의 정확한 연결.
  MediaService의 내부 세션 전달 위치가 보고되어도 외부 프로세스의 인증/세션 생성은 미확인.
- 전체 목록의 인증, 카메라 UUID/이름/PtzCap 필드 매핑, 페이지·서버별 조회 완료 조건.
  `DataService` 및 관련 assembly는 다음 정적 분석 후보일 뿐, 사용 가능한 외부 API로 확인되지 않음.
- 실제 선택 대상(현재 목표 9대, 코드에 개수 고정 금지)의 구독 자격 및 PTZ 수신 성공 여부.
- SSM XMap 표시 보정과 실제 북쪽 방위각/설치 좌표의 관계, Zoom → FOV 변환.
- 내부 이벤트 어댑터가 불가능할 때의 SUNAPI/ONVIF 지원 여부 및 읽기 전용 상태 조회 계약.
  대체 어댑터에는 SSM UUID ↔ 장비 ID/ProfileToken/채널 매핑 검증이 필요함.

위 문단은 추가 코드 요약 문서를 받았을 당시의 상태입니다. 2026-10-09 원본 6개 DLL 분석 후 상태는 아래 참조.

## 리포트 확보 후 남은 확인

- 보고서 출력 권한/서버 범위를 포함한 전체 등록 목록 여부 및 실제 수집 시각
- Camera.Guid와 실제 PTZ 이벤트/외부 API UUID의 일치
- PTZ 지원 표시 외의 uint64 PtzCap, ENTITY_CAPABILITY, ChannelSubType
- 실제 조회 인터페이스 인증/필드/페이지 처리와 현재 방향/줌 관측

## 원본 6개 DLL 분석 후 남은 항목

- 내부 카메라 모델 변환 및 로그인/목록 Stub 호출 위치는 확인됨. 실제 HTTP 계약은 WebServiceStub.dll 추가 분석 필요
- MapTile.OnRequest 구독자 및 system sink -> UI 이벤트 연결은 아직 미확인; ControllerService가 다음 후보
- 권한/서버/연합 범위와 페이지/배치 처리, 부분 조회 실패 검출
- strExtendData의 latitude/longitude/heading 실제 값 존재 여부와 단위·의미
- 원본은 net48 대상으로 분석됨; 독립 실행 및 .NET 8 호환성, 외부 사용 조건 미검증
- 실장비 PTZ 수신·단위·설치 보정·Zoom/FOV는 미확인 유지

상세 근거: [ssm-dll-analysis.md](ssm-dll-analysis.md).
