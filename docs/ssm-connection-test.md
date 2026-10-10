# 회사 PC용 SSM 연결 테스트

Windows 10/11 x64용 별도 실행 파일입니다. Git/.NET/Node.js 또는 Wisenet 프로그램을 설치할 필요가 없습니다.
SSM에 접근할 수 있는 회사 PC에서 실행하세요. 기존 지도/목록 데모 프로그램과 별개이며,
기존 카메라 선택·보정 설정을 변경하지 않습니다. 원본 SSM DLL은 사용하지 않습니다. 현재 진단 버전은 5이며 connection-report.json의 toolVersion으로 확인합니다.

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
7. 로그인 성공 후 **‘카메라 한 대의 등록 주소·포트도 추출’** 안내에서 **Y**를 입력하고,
   대상 이름 일부 **백운대** 또는 정확한 UUID를 입력할 수 있습니다. Enter는 기존 기본 목록만 수집합니다.
   검색 결과가 0개/여러 개이면 대상을 자동 선택하지 않습니다. 선택 결과가 한 대일 때만 연결 정보 파일을 만듭니다.
8. **‘v5: 현재 로컬 도메인과 선택 카메라의 관계’** 안내에서 **Y**를 입력합니다.
   로그인된 같은 HTTPS 서버에 확인된 GET 한 번만 추가합니다. Enter는 추가 조회를 생략합니다.
9. 결과를 확인한 뒤 Enter를 눌러 종료합니다. 테스트에서 만든 세션만 정상 로그아웃을 시도합니다.

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

- **camera-metadata.private.json** (v2): 이름/UUID, entityCapability(10진 문자열), subType/installType,
  설정 latitude/longitude/heading 및 XMap 데이터 조건을 로컬 기록합니다. 설치값과 실시간 PTZ를 구분합니다.
  원본 extendedData 전체·장치 비밀번호/IP 등은 저장하지 않습니다. 형식 오류는 null과 issues로 표시합니다.
  숫자 heading=0은 누락과 구분하지만 기본값인지, 북쪽 보정인지, 어떤 단위인지는 아직 미확인입니다.
  이 파일의 설정 위치가 기존 지도 좌표를 자동 변경하지 않습니다. 운영 데이터가 있으므로 공개 게시하지 않습니다.

공유용 보고서의 configuredHeadingCount/configuredCoordinateCount는 저장된 수치의 존재 수량이며
실시간/설치 검증 수량이 아닙니다. xMapSubscriptionCandidateCount는 확인된 데이터 조건의 후보 수량이고
계정 권한 또는 현재 PTZ 수신 성공이 아닙니다. unknownSubscriptionConditionsCount와
metadataIssueCameraCount를 함께 확인하세요. 누락 값은 0으로 채우지 않습니다.

- **camera-connection.private.json** (v3, 한 대 추출을 선택한 경우만): 선택 카메라와 조회한
  component/server의 UUID, 검증된 networkInfo.addressList/portList 및 연결 방식 enum 숫자를 로컬 기록합니다.
  source로 channel/component/server를 구분하고 serverPort/serverSslPort는 server 행에서만 읽습니다.
  사용자 ID·장비/SSM 비밀번호·DDNS 비밀번호/ID·세션·토큰·원본 networkInfo는 저장하지 않습니다.
  주소는 host/IP만 허용하고 자격 증명/경로/query를 포함한 URL은 버립니다. 포트 0/누락은 null,
  범위 밖 값은 null+issues로 기록합니다. 이 파일에는 운영 주소/UUID가 있으므로 공개하지 않습니다.
  connection-report.json에는 추출 대상 수와 문제 수만 추가하며 주소와 검색어는 넣지 않습니다.

v3는 **같은 목록 GET 응답에서 필드를 추가 추출**하며 네트워크 요청을 추가하지 않습니다.
이 등록 정보는 실제 도달 가능한 주소나 외부 포트 전달을 증명하지 않습니다. `routeVerified=false`를
유지하고 다른 주소 필드/카메라 내부 포트를 조합해 URL을 만들지 않습니다. ONVIF 경로·SUNAPI 현재 위치
명세가 확인된 것도 아닙니다. 카메라/녹화기/MediaGateway로 자동 접속하거나 PTZ 요청을 보내지 않습니다.
주소창 없는 설정 화면에서 접속 정보를 좁힐 때 사용하며, 필드가 없으면 미확인으로 남깁니다.

## v4: 카메라 계정 없이 SSM CONTROL 경로 조사

사용자는 대상 카메라의 장비 계정을 모른다고 답했습니다. 설치 코드의 일반 CONTROL 로그인은
SSM User/서버 세션을 사용하므로 이 경로를 우선 조사합니다. SSM 계정 값은 기존과 같이 회사 PC에만
입력하며 카메라 계정 입력은 필요하지 않습니다. 이 진단은 CONTROL 로그인이나 PTZ를 요청하지 않습니다.

실행 순서는 그대로입니다. 정상 SSM 로그인 후 한 대 추출에서 **Y → 백운대**를 입력하세요.
동일한 서버/컴포넌트/채널 GET에서 다음 허용 필드를 추가 추출합니다.

- `camera-connection.private.json`의 schemaVersion=2, `connection.routing`: 각 행의 source,
  guid/parentGuid/type, 해당 Stub에 존재하는 domainGuid/currentDomainGuid/serverGuid/componentGuid/siteGuid,
  서버의 serverVersion/useDdns/useSSL을 정규화합니다. 운영 UUID는 이 private 파일에만 기록합니다.
- 원본 ServerStub → MediaGateway 변환과 type=4097 조건에 따라 `mediaGatewayCandidateUuid`를 기록합니다.
  조회 컴포넌트 UUID를 MediaGateway UUID로 대신 쓰지 않습니다. 타입 누락/다른 타입이면 후보는 null입니다.
- `cameraComponentMatches`와 `componentServerMatches`는 명시적 참조 UUID의 일치 비교입니다.
  누락은 null, 불일치는 false로 유지하며 다른 필드를 이용해 부모를 임의 교체하지 않습니다.
- GUID/enum/bool/version 형식 문제는 null+issues로 기록합니다. 무효 GUID나 서버 문자열을 원문으로
  보관하지 않습니다. `controlRoutingIssueCount`가 해당 문제 수입니다.
- `controlSecretKeyPresent`와 `loginUserUuidPresent`는 정상 REST 로그인 응답의 secretKey/UID 가용성만
  boolean으로 기록합니다. 누락/null은 null, 빈 값/형식 오류는 false입니다. true는 CONTROL 인증 성공 또는
  암호화 키 형식 검증을 뜻하지 않습니다. 키/로그인 UID/세션/토큰 값은 파일과 화면에 기록하지 않습니다.

server의 설정 useSSL은 CONTROL 응답의 UseSSL/SSLPort/HostName을 대신하지 않습니다.
도메인 값도 실제 CONTROL 인증 도메인으로 자동 확정하지 않습니다. `liveControlValidated=false`,
`routeVerified=false`, `complete=false`를 유지합니다. 포트 탐색, 장비 접속, 비밀번호 추출·변경,
SSM 조작권 요청 또는 PTZ 명령은 추가하지 않습니다. 기존 포트 확인용 PowerShell은 기존 필드를 그대로 읽을 수 있습니다.

이번 실행에서는 **connection-report.json과 camera-connection.private.json 두 파일**을 대조하면 됩니다.
후자는 운영 주소/UUID가 있으므로 이 비공개 대화에서 검토하고 공개 GitHub에는 게시하지 않습니다.
기존 미리보기/메타데이터도 생성되지만 추가 자료로 다시 공유할 필요는 없습니다.

다음 단계는 확인된 MediaGateway/도메인 관계를 바탕으로 단일 정상 CONTROL 인증과 장비별
위치 구독을 별도 구현·검증하는 것입니다. 목록/키 가용성 또는 TCP 연결만으로 PTZ 수신 성공을 판단하지 않습니다.

## v5: 현재 로컬 도메인을 별도 응답으로 대조

회사 PC의 v4 결과에서 선택 카메라→컴포넌트→MediaGateway의 명시적 참조가 일치했고,
정상 로그인 응답의 secretKey/UID 존재를 확인했습니다. 현재 PTZ 수신과는 구분합니다.

추가 정적 조사에서 `WebServiceStub.GET_DOMAIN`의 **GET /V1/Domain?type=local**과
`converterManagementServer`의 guid/version 변환, `DataManager`의 DEFAULT_MGMT_UID 갱신을 확인했습니다.
따라서 등록 서버의 domainGuid만으로 현재 로컬 로그인 도메인과 일반/연합 분기를 확정하지 않습니다.
v5는 기존 실행에 **Y → 백운대 → 로컬 도메인 Y**를 추가하면, 같은 HTTPS 세션으로 이 GET을 한 번 수행합니다.
명령줄에서 선택할 경우 `--connection-camera <확인된 UUID 또는 이름> --local-domain`을 사용합니다.

- **camera-control-routing.private.json**: 선택 UUID와 기존 등록 관계, 로컬 응답에서 허용한
  guid/version/sslUse만 기록합니다. 이름, Google/VWorld 키, 정책, extendedData 및 원본 도메인 응답은 제외합니다.
- 서버 domainGuid/currentDomainGuid, 컴포넌트 domainGuid, 서버 버전 및 카메라/컴포넌트 참조를 대조합니다.
  누락은 null, 불일치는 false입니다. 버전을 임의 축약하거나 연합 도메인을 로컬 도메인으로 바꾸지 않습니다.
- `configuredLocalRoutingConsistent=true`일 때만 `loginDomainCandidateUuid`를 기록합니다.
  이 값은 **등록 관계 후보**이며 CONTROL 인증·계정 권한·TLS·현재 PTZ 성공을 뜻하지 않습니다.
- 로컬 도메인 응답이 0개/여러 개이거나 배열이 아니면 자동 선택하지 않고 중단합니다.
  형식 오류는 원문을 버리고 null+issues로 기록합니다. 실패 시에도 자기 테스트 세션 로그아웃을 시도합니다.
- 공유용 보고서에는 `localDomainRequested`, `localDomainRowCount`, `localDomainIssueCount`,
  `configuredLocalRoutingConsistent`만 추가합니다. 도메인 UUID/주소/키는 public 보고서와 콘솔에 표시하지 않습니다.

이번에는 **connection-report.json과 camera-control-routing.private.json** 두 파일을 대조합니다.
후자는 운영 UUID가 있으므로 비공개 검토용이며 GitHub에 올리지 않습니다. 기존 네 파일도 생성됩니다.
현재 위치 응답이나 CONTROL 패킷을 수집하는 도구는 아직 아닙니다. sslUse/useSSL은 설정 필드이며
CONTROL의 실제 TLS 전환 응답/인증서를 대신하지 않습니다. 별도 LDAP/연합 인증도 자동 시험하지 않습니다.

## 연결·명령 범위

고정한 HTTPS origin으로만 요청하고 리다이렉트/HTTP fallback/인증서 자동 교체를 허용하지 않습니다.
운영체제 전체의 인증서 신뢰를 바꾸지 않으며 프록시를 거치지 않고 지정 서버로 직접 연결합니다.
허용 요청은 다음뿐입니다.

- GET /V1/report/status
- POST /V1/Session: 정상 로그인 한 번. 강제 로그인/자동 재시도 없음
- GET /v3/servers?type=all
- GET /v3/servers/{UUID}/components
- GET /v3/components/{UUID}/channels?serverGuid={UUID}
- GET /V1/Domain?type=local: v5에서 한 대 선택 후 명시적으로 요청한 경우 한 번
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
- LOCAL_DOMAIN_SELECTION_AMBIGUOUS / LOCAL_DOMAIN_ROW_INVALID: 로컬 도메인을 안전하게 한 개로 대조할 수 없음
- CONNECTION_SELECTION_REQUIRED / LOCAL_DOMAIN_REQUIRES_INVENTORY: 한 대 선택/목록 조회 없이 로컬 도메인을 요청함
- logout=failed: 세션 정리 실패. 정상 로그아웃 성공이라고 해석하지 않음

## 검증 범위

.NET 빌드, 합성 HTTPS 서버로 지문/RSA/서명/쿠키/정상 세션 정리/목록 파싱/민감 정보 제외/실패 처리를 검증합니다.
Windows self-contained ZIP을 생성·무결성 확인합니다. 운영 SSM 로그인/목록 조회 및 Windows 콘솔 실행은
회사 PC에서 이 도구를 실행한 뒤 검증할 수 있습니다. 클라우드에서 운영 서버에 접속하지 않습니다.
