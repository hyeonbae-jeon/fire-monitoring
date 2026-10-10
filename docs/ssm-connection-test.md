# 회사 PC용 SSM 연결 테스트

Windows 10/11 x64용 별도 실행 파일입니다. Git/.NET/Node.js 또는 Wisenet 프로그램을 설치할 필요가 없습니다.
SSM에 접근할 수 있는 회사 PC에서 실행하세요. 기존 지도/목록 데모 프로그램과 별개이며,
기존 카메라 선택·보정 설정을 변경하지 않습니다. 원본 SSM DLL은 사용하지 않습니다.

## 실행 순서

1. GitHub에 로그인하고 Actions의 **SSM connection test** 실행 결과에서
   **SSM-Connection-Test-Windows** 아티팩트를 다운로드합니다. 아티팩트 ZIP을 풀고,
   안의 SSM-Connection-Test-win-x64.zip도 전체 압축 해제합니다. 보관 기간은 30일입니다.
2. **SsmConnectionTest.exe**를 더블클릭합니다. 주소/인증서 지문/자격 증명은 패키지에 포함되어 있지 않습니다.
3. HTTPS 서버 주소를 `https://서버주소:SSL포트` 형태로 입력합니다. 카메라/상황판 주소를 입력하지 않습니다.
4. 해당 서버 인증서의 **SHA-256 지문 64자리**를 입력합니다. 콜론으로 구분한 값도 가능합니다.
   인증서를 PC 신뢰 저장소에 설치하지 않습니다. 최초 인증서의 진위가 독립 검증되지 않았다면
   그 불확실성은 남습니다. 명시한 서버와 인증서만 허용하고 지문 변경/유효기간 만료 시 중단합니다.
5. HTTPS 상태 조회 결과를 확인합니다. **Enter**는 상태 조회만 하고 종료합니다.
   정상 로그인 및 목록 조회까지 진행하려면 **Y**를 입력합니다.
6. 허용된 SSM 계정 ID와 비밀번호를 회사 PC 콘솔에 입력합니다. 비밀번호는 화면에 표시하지 않고
   파일·로그·명령줄 인자로 저장하지 않습니다. 클라우드나 GitHub로 전송하지 않습니다.
7. 결과를 확인한 뒤 Enter를 눌러 종료합니다. 테스트에서 만든 세션만 정상 로그아웃을 시도합니다.

주소/지문을 입력할 때 Windows 터미널의 붙여넣기(Ctrl+V 또는 우클릭)를 사용할 수 있습니다.
관리자 실행은 필요하지 않습니다. 종료 전 콘솔을 강제로 닫으면 세션 정리 요청이 생략될 수 있습니다.
인증서나 로그인 오류가 발생하면 비밀번호를 반복 입력하기보다 진단 결과를 먼저 확인하세요.

## 결과 파일

실행 파일 옆 `diagnostics/test-…/`에 실행마다 별도 폴더를 만듭니다.

- **connection-report.json**: 공유용. 단계별 HTTP 상태, 서버 상태/버전, 인증서 일치 여부,
  목록 수량, 오류 코드 및 로그아웃 결과만 포함합니다. 주소·ID·비밀번호·공개키·세션·토큰·원본 응답은 포함하지 않습니다.
- **camera-preview.private.json**: 목록 조회가 끝까지 성공한 경우만 생성합니다.
  카메라 이름/UUID 및 손실 없는 10진 문자열 PtzCap가 들어 있으므로 외부/GitHub에 공유하지 않습니다.
  내부 IP/비밀번호/영상은 포함하지 않습니다. 누락 PtzCap는 null이고 실제 0과 구분됩니다.
  파일은 complete=false인 미리보기이며 기존 Bridge 설정에 자동 반영하거나 전체 목록으로 확정하지 않습니다.

계정에서 보이는 서버→컴포넌트→채널을 순차 조회합니다. 이름/UUID/카메라 type/PtzCap를 검사하고,
카메라 UUID 중복은 같은 값이면 합치고 불일치면 중단합니다. 부분 실패, 응답 구조 오류 및
HTTP 성공만으로 전체 목록을 확정하지 않습니다. 권한/연합 범위, 현장 등록 수와 목록 변경은 추가 대조가 필요합니다.
서버 화면의 수량과 보고서 수량이 다를 수 있으므로 코드에 기대 수량을 고정하지 않습니다.

## 연결·명령 범위

고정한 HTTPS origin으로만 요청하고 리다이렉트/HTTP fallback/인증서 자동 교체를 허용하지 않습니다.
운영체제 전체의 인증서 신뢰를 바꾸지 않으며 프록시를 거치지 않고 지정 서버로 직접 연결합니다.
허용 요청은 다음뿐입니다.

- GET /V1/report/status
- POST /V1/Session: 정상 로그인 한 번. 강제 로그인/자동 재시도 없음
- GET /v3/servers?type=all
- GET /v3/servers/{UUID}/components
- GET /v3/components/{UUID}/channels?serverGuid={UUID}
- DELETE /V1/Session: 이번 테스트 세션 정리

로그인 body의 ID/password는 상태 헤더 PublicKey로 RSA PKCS#1 v1.5 암호화합니다.
net48 DLL에서 확인한 CLIENT_SDK의 **wire service=12**, clientVersion=2.21.00 및 **TSM** 서명을 사용합니다.
CLIENT_SDK 사용 가능 여부는 서버의 실제 응답으로 확인해야 하며, 거절되면 다른 service/계정으로
자동 전환하지 않습니다. 버전/상태/공개키가 확인되지 않으면 로그인하지 않습니다.
GET/로그아웃에는 Session_ID 쿠키와 path+query/UTC Unix 초에 대한 비밀번호 HMAC-SHA256 서명을 사용합니다.
세션/비밀번호는 실행 중 메모리에서만 유지하며 메모리 전체의 완전 삭제를 보장하는 도구는 아닙니다.

타임아웃은 요청 및 본문 읽기 각각 20초, 전체 테스트 10분, 최대 500요청, JSON 응답 최대 16MiB입니다.
실시간 PTZ 구독·이동·설정·영상 조회는 구현하지 않습니다. MOVE_PTZ / SET_ABS_PTZ 호출은 없습니다.

## 오류 해석

- CERTIFICATE_PIN_OR_VALIDITY_REJECTED: 지문 불일치/유효기간 오류. 받은 지문을 자동 갱신하지 않음
- HTTPS_CONNECTION_FAILED: 연결/SSL 실패. 주소·포트·네트워크 확인
- PUBLIC_KEY_MISSING / PUBLIC_KEY_INVALID: 로그인 암호화 키 확인 실패. 평문 로그인하지 않음
- SERVER_CONTRACT_UNVERIFIED: 확인된 2.21.00 계약 또는 START 상태와 다름
- HTTP_401 / HTTP_403: 인증/권한 또는 서명 문제. PC 시각도 확인 필요
- HTTP_409: 중복 접속 등 충돌 가능성. 강제 접속하지 않음
- HTTP_3xx: 리다이렉트 응답. 다른 주소로 자격 증명을 전달하지 않음
- ARRAY_RESPONSE_REQUIRED / RESPONSE_FIELD_INVALID / PTZ_CAP_INVALID: 실제 응답이 확인된 계약과 다름
- logout=failed: 세션 정리 실패. 정상 로그아웃 성공이라고 해석하지 않음

## 검증 범위

.NET 빌드, 합성 HTTPS 서버로 지문/RSA/서명/쿠키/정상 세션 정리/목록 파싱/민감 정보 제외/실패 처리를 검증합니다.
Windows self-contained ZIP을 생성·무결성 확인합니다. 운영 SSM 로그인/목록 조회 및 Windows 콘솔 실행은
회사 PC에서 이 도구를 실행한 뒤 검증할 수 있습니다. 클라우드에서 운영 서버에 접속하지 않습니다.
