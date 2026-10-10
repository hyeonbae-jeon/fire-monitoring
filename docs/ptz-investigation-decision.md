# PTZ 조회를 우선 검증하고 영상 보정으로 전환하는 기준

사용자와 합의한 순서는 **한 대의 읽기 전용 현재 PTZ → 남은 방향 정보 조사 → 영상/지형 보정**입니다.
원하는 첫 대상은 백운대 또는 숨은벽이며, 운영 CCTV를 움직여 시험하지 않습니다.

## 현재 근거

- SSM 로그인/목록/자기 세션 로그아웃은 현장에서 성공했고 146개의 이름/UUID/PtzCap를 읽었습니다.
- 선택 9대 중 현재 위치 비트 후보는 3대입니다. 실제 상태 수신 성공과 구분합니다.
- 목록의 저장 heading/좌표는 146대 모두 정규화 null입니다. 권한 필드 제한과 저장값 부재를 구분할 근거는 없습니다.
- subType=0으로 기존 XMap 전체 데이터 조건이 false입니다. 유형을 임의 변경하거나 모든 조회 방법이 불가능하다고 단정하지 않습니다.

## SSM CONTROL 추가 정적 조사 (2026-10-10)

기존 원본 DLL을 실행 없이 다시 읽어 추가 확인했습니다.

| 구현 | 추가 확인 |
| --- | --- |
| ControlSession.OnConnected | LoginDigest에 DomainUuid/DomainVersion, CONTROL SessionType, ClientType, ServerSessionID, ClientVersion 등을 구성 |
| StrongPW.EncryptUserIDBySecretKey / Enc_AES | REST 로그인에서 받은 secretKey를 이용한 사용자 ID 암호화 경로. IV를 앞에 붙인 암호문을 hex 문자열로 사용 |
| MediaService.RequestDigestAuthentication | challenge의 Realm/Qop/Nonce/Nc를 사용; auth 분기에서 MD5 또는 SHA256 계산. 일반 HTTP Digest와 별도 계약 |
| MediaService.Res_LogIn | 성공 응답의 UseSSL/SSLPort/HostName에 따라 CONTROL 세션을 다시 TLS로 연결 |
| CS_HEADER_PACKET / ControlSession.MakeRequestPacket | TSM 구분자의 Pack=1 바이너리 헤더와 JSON payload. PTZ는 목록 REST에 POST하는 방식이 아님 |

LDAP·연합 계정 분기도 존재하므로 일반 계정 분기를 모든 경우에 적용하지 않습니다.
추가 분석은 패킷/인증 단서의 확인이며 운영 CONTROL 인증·구독 성공 검증이 아닙니다.
장비/MediaGateway 연결 주소·포트·인증서와 선택 UUID 매핑, 이 클라이언트 유형의 허용 여부가
아직 현장 미확인입니다. 추측한 포트로 인증/구독하지 않고, 전체 UI/SystemService를 초기화하는 방법도 사용하지 않습니다.

## 대상 카메라 설정 사진 확인 (2026-10-10)

사용자가 추가 제공한 두 대상 설정 화면에서 공통으로 XNP-6550RH 모델, SUNAPI 등록 방식,
Wisenet DDNS, 카메라 유형 없음, 마운팅 모드 천장이 표시됩니다. 두 대상의 펌웨어 버전은 다릅니다.
이 관측은 subType=0/installType=2 응답과 부합하지만 물리 설치나 북쪽 원점을 증명하지 않습니다.
스트림의 HTTP/TCP는 영상 전송 설정이며 ONVIF Device 서비스 URL/포트가 아닙니다.
원본 주소/UUID/제품 ID/버전 연결은 Git 제외 파일에만 기록합니다.

등록 방식이 SUNAPI로 확인됐으므로 **해당 모델의 공식 SUNAPI 현재 위치 조회 명세를 우선 조사**합니다.
추가 DLL에서 SUNAPI 현재 위치 HTTP 계약은 확인되지 않았습니다. 제삼자 라이브러리의 경로만으로
VERIFIED로 승격하거나 운영 카메라에 요청하지 않습니다. 현재 확보한 제조사 일반 매뉴얼과
프로토콜 등록 표시는 위치 조회 endpoint·인증·응답 단위를 제공하지 않습니다.
ONVIF는 장비 서비스 URL/지원이 별도 확인되면 사용할 대안입니다. 준비된 시험 도구는 ONVIF 전용이며
SUNAPI 경로를 시험하는 도구가 아닙니다. 카메라 유형/마운팅/연결 방식·ONVIF 설정을 바꾸지 않습니다.

## 추가 카메라 등록 목록 사진

사용자가 제공한 다음 두 사진에는 채널별 카메라 등록 목록과 SAMSUNG/ONVIF 프로토콜,
모델, 접속 상태가 표시됩니다. 녹화기 쪽 등록 화면으로 보이지만 녹화기 모델·접속 경로는 미확인입니다.
같은 XNP-6550RH 모델이 여러 채널에 있고 일부 주소가 iPOLiS로 표시되어, 모델이나 목록 순서만으로
백운대/숨은벽을 특정하지 않습니다. SSM UUID와 이 목록의 채널 매핑도 미확인입니다.

ONVIF 등록 행의 존재는 이 목록에서 ONVIF 연결을 사용한다는 근거이며, 백운대/숨은벽의
ONVIF Device 서비스 URL·상태 조회 지원을 증명하지 않습니다. 하단 ONVIF 설정 버튼도 보이지만
내부 항목·기능은 아직 확인되지 않았습니다. 한 채널의 오류 01은 관측만 기록하고 원인은 추정하지 않습니다.
PTZ 위치 값과 서비스 포트는 이 사진에 없습니다. 다음 확인 대상은 선택한 한 카메라의 웹 설정에 있는
IP/포트·서비스 정보이며, 설정 변경·저장·자동 재등록·PTZ 조작 없이 확인합니다.

## 카메라 IP/포트 화면 및 주소창 미표시

사용자가 추가 제공한 카메라 IP 화면의 MAC은 앞선 대상 장치 정보와 일치합니다.
카메라 자체 HTTP=80, HTTPS=443, RTSP=554를 확인했습니다. 카메라 사설 IP는 운영용 제외 파일에만
기록합니다. 사용자는 설정 화면에 브라우저 주소창이 없다고 확인했습니다. 이 관측만으로
클라이언트의 직접 접속/서버 프록시/외부 포트 전달 경로를 확정하지 않습니다.

제공된 DLL의 ObjConverter.ConvertToNetworkInfoObject, convertCamera 및 WebServiceStub 모델에서
`networkInfo.addressList`의 tcp/wan/http/https/rtsp와 `portList`의 대응 포트, 연결 방식 필드를 확인했습니다.
기존 [SSM 진단 v3](ssm-connection-test.md)는 같은 서버/컴포넌트/채널 GET에서 선택한 한 대의
등록 접속 정보를 추출합니다. 장비 계정/비밀번호는 제외하고 주소/UUID는 private 파일에만 저장합니다.
원본 모듈에서 내장 설정 화면의 최종 URL 생성 위치는 이번 조사에서 찾지 못했습니다.
주소창을 다시 요구하는 대신 v3 응답으로 등록 주소·포트·조회 계층을 대조합니다.
등록값의 존재와 실제 접근 경로/ONVIF 서비스 지원·PTZ 응답은 별개이며, 자동 접속은 하지 않습니다.

## 진단 v3 현장 결과 이후

선택 한 대의 UUID/이름이 목록·메타데이터와 일치하고 등록 접속 정보가 정상 추출됐습니다.
카메라 HTTP 80/HTTPS 443은 이전 화면과 일치합니다. component TCP 4510도 반환돼
독립 CONTROL 조사에 사용할 등록 포트를 확보했습니다. 장비에 실제 접속한 결과는 아닙니다.
원본 enum과 대조한 카메라 devProtocolType=1은 SUNAPI입니다. ONVIF 지원이나 현재 상태 계약을
이 등록 방식으로 추정하지 않습니다. 상세 [현장 대조](ssm-live-inventory-validation.md).

후속 [TCP 확인](camera-route-check.md)에서 카메라 HTTP 80과 component TCP 4510은 연결됐고,
카메라 HTTPS 443은 연결되지 않았습니다. 인증·SOAP·SUNAPI·CONTROL 명령을 시험한 결과는 아닙니다.
후속 사용자 화면에서 Hanwha Vision WebViewer 제목과 브라우저 인증 창을 관측했습니다.
모델/고유 식별정보와 Basic/Digest는 사진으로 확인되지 않아 [로그인 전 인증 응답 확인](camera-web-auth-check.md)을 준비했습니다.
후속 장비 계정 미확인에 따른 현재 우선순위는 아래 SSM CONTROL 조사입니다.
장비 매핑과 공식 상태 조회 계약은 계속 검증 대상으로 남깁니다.
CONTROL 경로는 인증/TLS/현재 위치 수신의 추가 검증 대상으로 유지합니다. 443 실패 원인은 미확인입니다.
성공/실패 모두 현재 PTZ 지원·권한 또는 영상 보정 전환 여부를 직접 증명하지 않습니다.

## 장비 계정 미확인 이후: SSM CONTROL 우선 조사

사용자는 대상 카메라 자체의 로그인 계정을 모른다고 답했습니다. 직접 SUNAPI/ONVIF 인증 시험은
계정 확보를 기다리고, 이미 목록 로그인이 성공한 **SSM 계정 기반 CONTROL 경로를 우선 조사**합니다.
위 F12 인증 방식 확인은 계정 없이 가능한 보조 조사이며 현재 진행의 선행 조건으로 요구하지 않습니다.

이번에 원본에서 다음을 구체적으로 대조했습니다.

- ControlSession.OnConnected와 MediaService.RequestDigestAuthentication의 일반 계정 분기는
  DataCenter.UserUuid의 User.Name/비밀번호 및 ServerSessionID를 사용합니다. 카메라 networkInfo의 계정을
  입력받는 분기가 아닙니다. 연합/LDAP 분기는 별도이며 일반 분기로 대신하지 않습니다.
- ObjConverter.convert(ServerStubModel)는 server.guid → MediaGateway.Uuid,
  domainGuid → SystemUuid, currentDomainGuid → ParentUuid를 매핑합니다.
  DataManager는 서버 type=4097인 행을 MediaGateway로 변환합니다. 컴포넌트는 별도 Recorder 계층일 수 있어
  componentUuid를 그대로 CONTROL 대상 UUID로 쓰면 안 됩니다.
- DataManager의 일부 카메라 조회 경로는 camera.ParentUuid를 channel.componentGuid로 보완합니다.
  따라서 원본 parentGuid와 명시적 componentGuid/serverGuid를 따로 읽어 실제 관계를 대조해야 합니다.
- REST CLIENT_SDK wire service=12와 CONTROL의 MODEL_TYPE.CLIENT_SDK=4096은 서로 다른 enum입니다.
  STREAM_TYPE.CONTROL=1도 별도입니다. 운영 CONTROL에서 이 클라이언트 유형이 허용되는지는 미검증입니다.

[SSM 진단 v4](ssm-connection-test.md)는 기존 요청을 추가하지 않고 선택 한 대의 이 관계·도메인·타입을
추출합니다. REST 로그인 응답의 secretKey/UID 존재 여부만 기록하며 값은 파일/로그에 쓰지 않습니다.
CONTROL 로그인·TLS 전환·위치 구독을 아직 보내지 않습니다. type/참조가 없거나 불일치하면 UNKNOWN 또는
false로 기록하고 추측으로 부모 UUID·도메인·포트를 보완하지 않습니다. 카메라 장비 계정은 입력할 필요가 없습니다.

v4 현장 결과로 MediaGateway/도메인 관계를 확인한 뒤 정상 CONTROL 인증·TLS 및 한 대의 위치 수신을
별도 검증해야 합니다. 이 조사와 4510 TCP 성공을 현재 PTZ 조회 성공으로 처리하지 않습니다.

## 현장 검증 순서

1. 진단 v4에서 기존 SSM 계정으로 정상 로그인하고 한 대를 선택해 MediaGateway/도메인/명시적 참조를 대조합니다.
   카메라 계정·설정 변경은 필요하지 않으며 새 CONTROL 인증이나 PTZ 요청은 보내지 않습니다.
2. 실제 관계가 확인되면 정상 CONTROL 인증·TLS 전환 및 한 대의 읽기 전용 위치 구독 도구를 별도로 구현·검증합니다.
   TLS 응답/인증서를 확인하고 지정한 대상만 허용합니다. 타입/권한/인증 실패 시 임의 보완·강제 접속하지 않습니다.
3. 대응하는 SSM UUID와 영상의 일치를 확인합니다. 정규화 좌표/각도 단위와 부호, 북쪽 원점 및
   Zoom/FOV는 별도 자료로 확인합니다. 수신값만으로 지리적 방향을 확정하지 않습니다.
4. 장비 계정과 공식 SUNAPI 현재 위치 계약 또는 실제 ONVIF 서비스 URL/지원이 확보되면 직접 조회도 검토합니다.
   ONVIF 대상 매핑이 확인된 경우에만 [단일 GetStatus 도구](ptz-readonly-test.md)의 프로파일을 직접 선택해 시험합니다.
   알 수 없는 경로를 시험하거나 권한/설정을 변경하지 않습니다.

## 영상 기반 보정으로 넘어가는 시점

다음은 서로 다른 판단입니다.

- 주소/계정/인증서/프로파일을 모르는 상태: **검증 대기**이며 미지원으로 결론 내리지 않습니다.
- 실제 응답이 기능 미지원 또는 위치 값 미제공을 나타냄: 해당 경로의 한계를 기록하고 다른 확인된 경로를 검토합니다.
- 허용된 조회 경로/필요 정보를 더 확보하기 어렵고 사용자가 영상 보정을 선택함: 영상 기반 작업을 진행합니다.
  모든 장비 내부에 방향 정보가 없다는 증명을 요구하지 않습니다.

PTZ가 읽혀도 북쪽 보정값은 없을 수 있습니다. 이때는 **현재 PTZ 수신 + 지형 기준점 수동 보정**을 함께 사용합니다.
영상 보정 시작 자료는 한 대의 사용자 제공 위치, 설치 높이/고도, 같은 방향의 주간 원본 화면과
식별 가능한 봉우리/건물 등 여러 기준점입니다. VWorld 가상 시점만 맞추며 실제 카메라를 이동하지 않습니다.
방향 변경/줌 변경을 감지했는데 재보정이 안 되면 UNKNOWN으로 표시합니다.
첫 시험에서 오차를 확인한 뒤 야간 능선 비교와 자동 추정을 검토합니다.

[영상 보정 방법과 한계](video-direction-feasibility.md).
