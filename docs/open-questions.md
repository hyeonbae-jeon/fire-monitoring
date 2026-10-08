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

다음 분석에는 해당 버전의 실제 DLL 또는 인증/조회/세션 관련 ILSpy 코드가 필요함.
현재 받은 추가 문서는 코드 위치 요약이며 실제 DLL이나 완전한 외부 접속 계약이 아님.
