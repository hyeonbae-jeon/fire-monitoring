# Codex 첫 프롬프트
`CODEX_HANDOFF.md`, `README.md`, `TASKS.md`, `docs/verified-findings.md`, `docs/open-questions.md`, `docs/ptz-protocol.md`를 먼저 읽어라.

첫 목표는 **Wisenet SSM에 등록된 전체 카메라에서 이름/UUID/PTZ capability를 읽고 필요한 카메라를 선택하여 설정으로 저장하는 것**이다.

중요:
- 운영 CCTV이므로 읽기 전용으로 시작.
- MOVE_PTZ / SET_ABS_PTZ 금지.
- VERIFIED 항목을 근거로 구현하고 UNKNOWN은 추측하지 말 것.
- 최종 아키텍처는 중앙 PTZ Bridge + VWorld 3D 웹앱.
- 어느 PC에서나 브라우저로 사용할 수 있어야 함.

현재 scaffold를 검토하고 Camera Inventory를 구현하기 위한 접근을 제안한 뒤 필요한 코드를 작성하라.
