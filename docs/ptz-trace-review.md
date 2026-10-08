# 추가 PTZ handoff 비교 및 반영

비교 대상: 사용자가 첨부한 `PTZ_CODE_TRACE_STATUS.md`, 기존 `CODEX_HANDOFF.md`,
`docs/verified-findings.md`, `docs/open-questions.md`, `docs/ptz-protocol.md` 및 현재 Phase 1 구현.
추가 원문은 `docs/PTZ_CODE_TRACE_STATUS.md`에 그대로 보관함.
첨부 문서 안의 실행 계획과 '첫 Codex 메시지'는 인수인계 자료이며 별도 실행 권한이나 검증 증거로 취급하지 않음.

| 내용 | 기존 전달 여부 | 이번 반영 |
| --- | --- | --- |
| PtzCtrl의 UUID/Command/Action/Pan/Tilt/Zoom | 기존 handoff §3 | 중복 확인 |
| MOVE_PTZ 일반 이동 및 SET_ABS_PTZ 설정 경로 | 기존 handoff §10 | 동작 내용 중복, 정확한 Function_Request 메서드명 추가 |
| ABS_PTZ + GET_ABS_PTZ_START/STOP, 값 33/34 | 기존 handoff §4/6 | 중복 확인 |
| ReqABSPTZPosAll, 이벤트 수신, PTZ 큐 | 기존 handoff §6~8 | 중복 확인 |
| Camera/entity capability/channel subtype/GET_POS_NORMALIZE 구독 조건 | 기존 handoff §9, 현재 UI 설명 | 중복 확인, 실제 대상별 자격은 미확인 유지 |
| GROUND/CEILING 및 Tilt > 90의 Pan 보정 | 기존 handoff §8 | 표시 로직이라는 한계와 물리 좌표 캘리브레이션 필요성 명시 |
| MediaService.RequestEx(ref RequestObj, Guid)의 Media Gateway/CONTROL session 선택 | 기존 문서에 정확한 앞단 경로 없음 | 새 분석 결과로 기록, 구독 OnRequest와의 연결은 UNKNOWN 유지 |
| SetObjectPTZAngle에서 Zoom을 사용하지 않음 | 기존 문서에는 Pan/Tilt 사용만 서술 | 명시적 추가 정보, Zoom/FOV 공식을 추정하지 않음 |
| 외부 인증/접속, 전체 목록/UUID, PTZ 단위, DLL 배포/호환성 | 기존 UNKNOWN과 중복 | 미확인 유지, 9대 전체 PTZ 수신 완료로 표시하지 않음 |
| DataService 및 관련 assembly 조사 | 이전 문서에 구체적 조사 대상으로 없음 | 다음 정적 분석 후보에 추가, 함수명/외부 API는 추정하지 않음 |
| SUNAPI/ONVIF 대체 어댑터와 SSM UUID ↔ 장비 ID 매핑 | 기존 probe에는 ONVIF 실험 코드가 있으나 명시적 대체 설계 없음 | 지원 여부 확인을 전제로 설계 후보 기록 |

## 실행 코드 적용 판단

이번 추가 정보는 내부 코드 위치와 미완료 범위를 정리한 것으로,
SSM 서버 주소/인증/전체 목록 계약/페이지 처리/외부 이벤트 연결 코드를 제공하지 않음.
따라서 현재 파일 입력 Camera Inventory와 Windows 샘플 패키지의 동작을 변경하지 않음.
추측한 SSM 호출이나 장비 제어 코드를 추가하지 않으며, 실행파일 재빌드도 필요하지 않음.

## 다음 조사에 필요한 근거

1. DataService 및 관련 모델에서 camera UUID/이름/PtzCap을 얻는 실제 코드 흐름.
2. 기존 WebServiceStub 채널 조회의 메서드·인증·응답 모델·페이지 처리 코드.
3. MediaService/ControlSession의 인증·세션 초기화와 MapTile.OnRequest subscriber 코드.
4. 검증된 조회 계약 확보 후 한 카메라의 UUID/PtzCap을 확인하고 전체 목록 수집을 검증.
5. 실시간 PTZ 값과 좌표계 확인 후 VWorld를 연결. 개별 장비 조회 시 ID 매핑을 별도 검증.

원본 DLL이나 위 ILSpy 코드가 없는 상태에서는 이 조사 결과를 완료로 표시하지 않음.
MOVE_PTZ/SET_ABS_PTZ는 분석 위치 기록만 유지하고 시험 명령으로 보내지 않음.
