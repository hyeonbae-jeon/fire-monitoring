# 회사 PC의 SSM 목록 조회 검증 (2026-10-10)

사용자가 연결 진단 실행 파일로 회사 PC에서 수집한 connection-report.json 및
camera-preview.private.json을 대조했습니다. 아래는 실제 실행 결과이며 클라우드에서
운영 서버에 접속한 결과가 아닙니다. 원본 파일 및 카메라 이름/UUID/서버 주소는 공개하지 않습니다.

## 현장 결과

- 고정 인증서 지문 일치; HTTPS 상태 GET 200, START, ServerVersion=2.21.00, PublicKey 존재
- 정상 로그인 POST 200, 서버/컴포넌트/채널 GET 모두 200, 자기 테스트 세션 로그아웃 DELETE 200
- 진단 결과 inventory-preview-ok, error=null, logout=ok
- 조회 서버 3개, 컴포넌트 3개; 카메라 146행, 고유 UUID 146개, 빈 이름 없음
- 146개 모두 PtzCap 존재 및 uint64 범위의 손실 없는 10진 문자열
- 미리보기 수집 시각 2026-10-10 19:06:30 한국 시간; complete=false 유지

이 실행에서 HTTPS 지문 고정, RSA 정상 로그인, CLIENT_SDK wire service=12 및
TSM/HMAC/쿠키 인증 목록 조회와 정상 로그아웃이 함께 작동했습니다.
이는 해당 서버·계정·실행에서의 성공이며 다른 서버 버전/계정/라이선스 조건의 보장은 아닙니다.
최초 인증서의 진위가 독립 검증됐다는 뜻도 아닙니다.

## 이전 장치 리포트와 대조

이전 보고서에서 정규화한 140개의 UUID가 이번 조회에 모두 포함됩니다.
공통 140개의 이름도 일치하며 이번 조회에만 있는 UUID가 6개입니다.
이전 보고서에만 있는 UUID는 없습니다. 신규 6개의 등록 시점이나 추가 조회 원인은 미확인입니다.

앞선 서버 라이선스 화면의 130대와 이번 3개 서버의 조회 합계 146대는 같은 범위의 수량이라고
가정하지 않습니다. 각 서버/권한/연합 범위를 대조한 뒤 전체 등록 목록 여부를 확정해야 합니다.
응답 성공, 이전 보고서 전체 포함 및 고유 UUID 일치는 수집 결과의 근거이지만 전체 범위의 증명은 아닙니다.
따라서 기존 선택/보정 설정에 자동 반영하거나 complete=true로 바꾸지 않았습니다.

## PTZ capability 관측

| 항목 | 수량 | 해석 |
| --- | --- | --- |
| PtzCap 미확인/null | 0 | 이번 응답에서 모두 숫자 비트를 받음 |
| PtzCap=0 | 3 | 응답의 비트 값이 0; 필드 누락과 구분 |
| PtzCap가 0이 아님 | 143 | 비트가 존재함; 모든 장치의 위치 조회 성공을 뜻하지 않음 |
| GET_POS_NORMALIZE (268435456) | 6 | 기존 XMap 현재 위치 구독 조건 중 하나를 만족 |
| ABSOLUTE_ZOOM (17179869184) | 127 | 비트 관측만 기록; 위치 읽기 가능성/FOV로 해석하지 않음 |

GET_POS_NORMALIZE 비트가 있는 6개는 읽기 전용 위치 구독의 우선 조사 후보입니다.
첫 진단 미리보기에는 ENTITY_CAPABILITY와 ChannelSubType가 없었습니다. 아래 v2 결과로 이 필드는 확인했으나, 실제 MediaGateway 세션·PTZ 이벤트,
단위·설치 보정·Zoom/FOV도 미확인입니다. 나머지 카메라의 SUNAPI/ONVIF 대체 조회 가능 여부는
이 비트가 없다는 이유만으로 배제하지 않습니다. 현재 Pan/Tilt/Zoom은 아직 수집하지 않았습니다.

## 진단 v2 현장 메타데이터 대조 (2026-10-10 20:43:21 한국 시간)

사용자가 추가 제공한 세 파일을 대조했습니다. 상태·로그인·서버/컴포넌트/채널 조회·로그아웃
10개 요청 모두 HTTP 200이며 `inventory-preview-ok`, `error=null`, `logout=ok`입니다.
메타데이터와 목록의 UUID 집합은 동일한 146개이며 중복이 없습니다. 선택한 북한산 9대도 모두 포함됩니다.

| 관측 | 전체 146대 | 해석 |
| --- | --- | --- |
| configuredHeading | 모두 null | 정규화 결과에 저장 방향 값 없음 |
| configuredLatitude / configuredLongitude | 모두 null | 정규화 결과에 저장 좌표 값 없음 |
| subType | 모두 0 (NONE) | 기존 XMap의 유형 조건 4/8을 만족하지 않음 |
| installType | 모두 2 (CEILING) | 반환된 설정 enum 값; 실제 천장 설치 여부는 미검증 |
| xMapSubscriptionConditions | 모두 false | 기존 XMap의 전체 데이터 조건을 만족하는 응답 없음 |
| 메타데이터 파싱 문제 | 0대 | 추출된 허용 필드에서 형식 오류 없음 |

선택한 9대의 ENTITY_CAPABILITY에는 PTZ_CONTROL 비트가 있습니다. 그중 3대의
GET_POS_NORMALIZE 비트도 이전 조회와 같지만, subType=0 때문에 전체 XMap 조건은 false입니다.
앞서 기록한 3대는 **위치 비트 기준 조사 후보**이며 전체 구독 조건 충족 또는 실제 수신 성공으로
해석하지 않습니다. 원본 ObjConverter의 subType 직접 매핑과 이번 응답을 근거로 기록했으며,
클라이언트의 다른 경로가 이후 유형을 보완하는지는 미확인입니다. 유형 값을 임의로 4/8로 바꾸지 않습니다.

null은 원본 필드 누락·null·빈 값이 정규화된 결과이므로 저장값 부재와 계정별 필드 제한을 구별하지 못합니다.
목록 조회 성공만으로 계정 PTZ 상태 조회 권한을 확정할 수 없고, 이 결과만으로 권한 부족도 단정하지 않습니다.
installType=2는 물리 설치와 북쪽 방향 보정을 증명하지 않으므로 Pan 반전/회전 규칙을 자동 적용하지 않습니다.
현재 Pan/Tilt/Zoom은 여전히 미수집입니다. 사용자가 제공한 9대 좌표는 유지하며 null로 덮어쓰지 않습니다.

원본과 선택 9대 메타데이터 대조 파일은 Git 제외 경로에 보관합니다.
전체 등록 범위는 여전히 미확인으로 `complete=false`를 유지합니다.

## 진단 v3 현장 등록 접속 정보 대조 (2026-10-10 22:15:12 한국 시간)

사용자가 v3의 네 결과 파일을 제공했습니다. 10개 요청 모두 HTTP 200이며 정상 로그인·목록 조회·
자기 세션 로그아웃이 성공했습니다. 고유 UUID 146개와 목록/메타데이터 UUID 집합 일치를 재확인했고,
이전 리포트 140개 및 선택 9대의 이름/UUID/PtzCap도 그대로입니다. 저장 heading/좌표는 모두 null,
subType=0, installType=2, XMap 전체 데이터 조건 false이며 파싱 문제는 없습니다.

선택한 한 대의 연결 정보는 목록과 동일한 UUID/이름에 대응합니다. 등록 접속 정보 추출 문제는 0개입니다.
운영 주소/UUID는 Git 제외 원본 및 대조 파일에만 보관합니다.

| 조회 계층 | 이번에 확인한 등록값 | 판단 범위 |
| --- | --- | --- |
| 카메라 channel.networkInfo | HTTP 80, HTTPS 443; 두 주소는 같은 외부 IP | 이전 포트 화면과 일치; 회사 PC에서 접근 성공은 미검증 |
| 카메라 연결 방식 | addressType=4, devProtocolType=1, medProtocolType=3 | 원본 enum에서는 각각 HTTPS, SUNAPI, HTTP; ONVIF 지원을 뜻하지 않음 |
| 카메라 tcp/wan | 두 포트 모두 554 | 등록 필드 관측; 이 값을 SSM CONTROL 포트로 사용하지 않음 |
| 카메라 rtsp | 주소 0.0.0.0, 포트 null | 실제 RTSP 서비스 주소·포트로 사용하지 않음 |
| component.networkInfo | TCP 4510, devProtocolType=2, medProtocolType=1 | 원본 enum에서는 SVNP/TCP; 독립 CONTROL 연결 조사 자료 |
| server.networkInfo | TCP/WAN 4510, HTTP 4514, HTTPS 4518, RTSP 558 | 반환된 등록 포트; 실제 서비스/인증서를 시험한 결과가 아님 |
| server 행 | serverPort=9999, serverSslPort=9991 | 이미 성공한 SSM 목록 REST의 포트와 구분 |

enum 근거는 제공된 DataStructure의 ADDRESS_TYPE, DEVICE_PROTOCOL_TYPE, MEDIA_PROTOCOL_TYPE입니다.
addressType=4와 화면의 Wisenet DDNS 표시는 서로 다른 설정 항목이므로 표시 불일치만으로 장애를 판단하지 않습니다.
원본 SessionCenter.AddMediaGateway는 MediaGateway의 TCP/WAN 주소 및 TCP 포트를 ControlSession.SetConnectionInfo에
전달합니다. 따라서 이번 component의 TCP 4510은 CONTROL 조사 후보이나 인증·TLS 전환·위치 이벤트 성공은 미확인입니다.
component에 반환된 loopback 주소는 별도 접속용 PC에서 원격 서버 주소로 사용하지 않습니다.

등록된 외부 IP와 카메라 내부 IP가 다르므로 실제 포트 전달이나 내장 설정 화면의 경로가 입증됐다고
해석하지 않습니다. `routeVerified=false`, `complete=false`를 유지합니다. 장비 인증서·계정·공식 SUNAPI
현재 위치 조회 계약 또는 ONVIF 서비스 URL·지원, 현재 Pan/Tilt/Zoom 및 북쪽 보정은 아직 미확인입니다.

다음은 [회사 PC의 제한된 TCP 연결 확인](camera-route-check.md)입니다. 카메라 계정/비밀번호를 보내지 않고,
카메라의 등록 HTTP/HTTPS 포트와 component의 등록 TCP 포트만 확인합니다. 클라우드에서 운영 장비에
접속하지 않았으며 원본 파일을 GitHub에 게시하거나 선택/지도 설정을 변경하지 않았습니다.

## 회사 PC TCP 연결 결과 (2026-10-10 사용자 제공)

사용자가 [TCP 확인 절차](camera-route-check.md)의 camera-route-report.json을 추가 제공했습니다.
세 역할/포트가 앞선 v3 등록값과 일치하며 다음 boolean 결과를 확인했습니다.

| 시험 대상 | 포트 | TcpConnected | 해석 |
| --- | --- | --- | --- |
| 카메라 HTTPS | 443 | false | 시험 PC에서 TCP 연결 실패; 원인은 미확인 |
| 카메라 HTTP | 80 | true | TCP 연결 가능; 실제 HTTP 서비스와 카메라 신원은 아직 미검증 |
| SSM component TCP | 4510 | true | TCP 연결 가능; CONTROL 인증/TLS/현재 위치 응답은 아직 미검증 |

보고서에는 주소/UUID 및 수집 시각이 없으므로 이를 새 장비 식별 응답이나 정확한 시각의 증거로
취급하지 않습니다. 앞선 선택 한 대의 시험 순서로 전달된 결과이며 원본은 Git 제외 경로에 보관합니다.
TCP 443 실패는 인증서 거절 응답이 아닙니다. 카메라의 HTTPS/PTZ 미지원, 설정 오류 또는 계정 권한 부족으로
단정하지 않습니다. 같은 값으로 자동 재시험하거나 다른 포트를 탐색하지 않습니다.

다음 현장 확인은 **등록된 HTTP origin의 로그인 전 웹 화면**입니다. 회사 PC의 새 시크릿/InPrivate 창에서
카메라의 등록 HTTP 주소를 열고 제조사/모델 표시 또는 오류를 확인합니다. 계정 입력·설정 변경·PTZ 조작 없이
우선 대상 서비스 신원을 대조합니다. 다른 호스트로 이동하거나 브라우저가 HTTPS로 전환하면 도착 주소/오류를
확인하고, 그것만으로 카메라 웹 서비스 확인 성공으로 처리하지 않습니다.
해당 모델의 공식 SUNAPI 현재 위치 계약과 장비 계정, 또는 확인된 ONVIF 서비스 정보가 확보된 후에만
단일 현재 상태 조회를 수행합니다. 카메라의 HTTP 포트 연결과 SSM 4510 연결은 두 경로를 계속 조사할 근거이며
현재 PTZ 수신이나 북쪽 보정 성공으로 처리하지 않습니다.

## 로그인 전 WebViewer 화면 관측 (2026-10-10 사용자 제공)

사용자가 InPrivate 브라우저 화면을 제공했습니다. 앞선 카메라 등록 HTTP origin의 주소와
Hanwha Vision WebViewer 제목, `/wmf/index.html#/login`, 브라우저 인증 창을 확인했습니다.
따라서 단순 TCP 연결 이후 HTTP 웹 화면·인증 요구가 관측됐습니다. 모델/MAC/시리얼과 실제
HTTP 상태 코드·WWW-Authenticate는 표시되지 않았으며 현재 PTZ 응답도 없습니다.

브랜드 표시는 선택한 SSM UUID와의 고유 장비 매핑 증명이 아닙니다. 팝업의 외형만으로
Basic/Digest나 계정 오류를 판단하지 않습니다. 주소의 fragment는 HTTP 요청에 포함되지 않습니다.
팝업을 띄운 요청도 사진으로 특정할 수 없어 추측한 API나 인증을 시험하지 않습니다.
당시 다음 확인은 [로그인 없이 해당 응답의 인증 방식 확인](camera-web-auth-check.md)이었으며,
후속 사용자 답변의 Digest 관측은 아래에 반영했습니다.
장비 계정 보유 여부는 값 없이 사용자에게 확인하며, 원본 주소가 포함된 화면 관측은 private 기록으로만 보관합니다.

후속 답변에서 사용자는 카메라 장비 계정을 모른다고 확인했습니다. 직접 카메라 로그인 시험 대신
[SSM 계정 기반 CONTROL 조사](ptz-investigation-decision.md)를 우선합니다. v4는 같은 GET에서
MediaGateway/도메인 관계를 추가 기록하며 후속 v4 결과는 아래에서 대조했습니다.

## 진단 v4 현장 관계 및 Digest 관측 (2026-10-10)

첨부한 v4 보고서의 정상 로그인/목록/로그아웃 10개 요청 모두 HTTP 200이며 `inventory-preview-ok`,
`error=null`, `logout=ok`입니다. 미리보기와 메타데이터는 각각 146개로 UUID 집합이 같고,
이전 v3의 전체 이름/UUID/PtzCap 및 선택 9대도 그대로입니다. 저장 좌표/heading은 모두 null,
XMap 전체 데이터 조건 후보 0, 형식 문제 0입니다. 전체 설치 범위는 아직 미확인입니다.

| 항목 | 실제 관측 | 해석 |
| --- | --- | --- |
| 카메라 componentGuid | 조회 컴포넌트 guid와 일치 | cameraComponentMatches=true |
| 컴포넌트 serverGuid | 조회 서버 guid와 일치 | componentServerMatches=true |
| 서버 type / 컴포넌트 type | 4097 / 4104 | MediaGateway / Recorder 계층을 구분 |
| MediaGateway 후보 | 조회 서버 UUID | 컴포넌트 UUID를 대신 사용하지 않음 |
| server domainGuid/currentDomainGuid/parentGuid | 서로 일치 | 등록 도메인 관계의 일치; 현재 로컬 Domain 응답은 아직 없음 |
| component domainGuid | 서버 domainGuid와 일치 | 같은 등록 도메인 관계 |
| serverVersion | 2.21.00 | 상태 헤더 버전과 일치 |
| server useSSL / useDdns | false / false | 설정 관측; CONTROL의 실제 TLS 협상 결과가 아님 |
| controlSecretKeyPresent / loginUserUuidPresent | true / true | 로그인 키/UID 존재만 확인; 값은 저장하지 않음 |
| connectionDetailIssueCount / controlRoutingIssueCount | 0 / 0 | 추출한 허용 필드의 형식 문제 없음 |

connection 파일의 `routeVerified=false`와 `liveControlValidated=false`를 유지합니다.
카메라/컴포넌트의 parentGuid 누락은 임의로 채우지 않습니다. 등록된 관계가 맞다는 결과와
실제 CONTROL 인증·TLS·현재 위치 수신은 별개입니다.

사용자가 카메라 웹 응답의 **WWW-Authenticate 선두가 Digest**라고 추가 확인했습니다.
HTTP Digest 제공 관측으로 기록하며 헤더 전체/nonce/realm은 받지 않습니다. 알고리즘/qop,
응답 코드/요청 경로와 장비 고유 매핑, 장비 계정 및 현재 PTZ는 이번 관측으로 확인되지 않습니다.
이 HTTP 인증을 SSM 바이너리 CONTROL LoginDigest의 운영 검증으로 해석하지 않습니다.

추가 정적 조사에서 확인한 로컬 도메인 GET을 [진단 v5](ssm-connection-test.md)에 선택 실행으로 추가했습니다.
현재 로컬 도메인과 등록 관계를 대조한 다음 CONTROL 일반/연합 분기·인증/TLS를 검증해야 합니다.

## 다음 단계

1. 조회 계정의 전체 서버/권한 범위와 등록 수량 대조
2. 전체 범위 확인 후 목록을 Camera Inventory에 반영하고 필요한 UUID 선택·설정 저장
3. v5의 현재 로컬 Domain 응답을 대조하고 SSM CONTROL 인증·TLS·한 대 위치 수신 검증
4. 확인된 경로에서 한 카메라의 허용된 읽기 전용 현재 위치 응답과 UUID/값/수신 시각 검증

MOVE_PTZ / SET_ABS_PTZ 금지를 유지합니다. 이번 검토는 결과 대조 및 문서 반영만 수행했으며
카메라 제어, 운영 서버 재접속, 전체 목록 확정 및 기존 선택 설정 변경은 하지 않았습니다.
