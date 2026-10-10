# VWorld 위치 모니터링 시안

## 현재 범위와 실행

Windows 패키지를 실행하고 **지도 모니터링** 탭을 선택합니다. 별도 설치가 필요하지 않습니다.
초기 북한산 3개 지점은 사용자가 허용한 임의 시험 좌표이며 실카메라 위치가 아닙니다.
키 없이 보이는 좌표 배치도는 실제 지도·지형이 아닙니다.
VWorld 3D 키를 화면에 입력하고 연결하면 SDK가 별도 iframe에서 로드됩니다.
키는 소스, JSON 내보내기, 브라우저 저장소에 기록하지 않습니다. 브라우저용 키는 SDK 요청 URL과 개발자 도구에서 확인 가능합니다.
실제 지도에는 인터넷 접근이 필요합니다. 기존 등록 사이트의 키가 이 앱 주소에서도 동작한다고 보장할 수 없습니다.
VWorld 관리 화면에서 실제 접속 주소를 허용하는지 확인해야 합니다. 로컬 패키지는 127.0.0.1 임의 포트를 사용합니다.
등록 도메인을 요청 매개변수로 위장하거나 인증을 우회하지 않습니다.

## 연결 근거와 검증 범위

사용자 사이트 https://hyeonbae-jeon.github.io/bukhansan-weather/ 의 공개 소스
`frontend/index.html`에서 확인한 VWorld v3.0 로더, vw.Map/setOption/start,
vw.CameraPosition/CoordZ/Direction, vw.ws3dInitCallBack → ws3d.viewer 방식에 맞췄습니다.
기존 사이트의 키는 복사하거나 커밋하지 않았습니다. SDK의 parser 로딩(document.write 호환)을
iframe으로 격리하고 준비 콜백은 start 전에 등록합니다.
마커는 Cesium entities로 표시하며 로드된 지형의 clampToHeight를 시도하고 실패 시
CLAMP_TO_GROUND로 대체합니다. 고도는 확정 측량값이 아닙니다. 마커는 식별을 위해 지형 뒤에서도 보이므로 실제 가시성을 나타내지 않습니다.

클라우드의 VWorld 접근은 네트워크 허용 목록에 막혔습니다. 환경 설정 초안에
www.vworld.kr, map.vworld.kr, api.vworld.kr, xdworld.vworld.kr을 추가했지만 저장·게시 및 실제 접속 검증은 별도입니다.
빌드, 좌표 입력·선택·내보내기와 SDK 초기화 메시지 흐름은 테스트할 수 있습니다.
SDK 모의 테스트는 실제 인증, WebGL 지형, 지형 타일 서버의 성공 증거가 아닙니다.
뷰어 준비 상태와 실제 지형 로딩을 구분해 화면에 안내합니다.

## 좌표 설정

`중앙 지도 설정 저장`으로 Bridge에 위치·보정값을 저장하거나 `좌표 설정 다운로드`로 JSON을 보관합니다.
중앙 설정은 다시 실행/다른 브라우저에서 읽을 수 있으며 Inventory 선택 설정과 별도입니다.
실제 UUID 확인 전 임의 UUID로 매핑하지 않습니다.
EPSG:4326 위도(lat)·경도(lon), 최대 1000개 위치, 고유한 로컬 id를 사용합니다.
실제 좌표를 입력할 때 positionSource를 operator로 지정합니다. ssmUuid는 확인 전 null,
orientation은 미확인일 때 null입니다. [영상·지형 수동 보정](terrain-calibration.md)의 근거를 갖춘
manual-calibration 추정값도 저장할 수 있습니다. UNKNOWN 방향을 0도로 대체하지 않습니다.

```json
{"schemaVersion":1,"crs":"EPSG:4326","positions":[
 {"id":"site-1","name":"카메라 위치","lat":37.6585,"lon":126.977,
  "ssmUuid":null,"positionSource":"operator","orientation":null}
]}
```

주황색 부채꼴은 수동 시험 방위각(북=0°, 동=90°), 수평 화각, 거리로 계산합니다.
실제 PTZ 및 촬영 범위가 아닙니다. 시험 부채꼴 값은 JSON 저장에 포함되지 않습니다.
저장된 수동 추정의 방향/화각도 부채꼴로 보여주지만 거리는 임의값이고 지형 차폐는 계산하지 않습니다.
가상 시점 비교는 로드된 지면 높이·입력 설치 높이·기울기·화각을 사용하며 렌즈 왜곡은 보정하지 않습니다.
지도 선택/시점 이동은 브라우저의 지도 조작이며 CCTV 명령이 아닙니다.

## 최종 아키텍처로 이어지는 작업

중앙 PTZ Bridge가 검증된 전체 목록과 UUID 기준 설정, 위치 및 방향 관측을 제공하고
각 PC의 브라우저가 VWorld 3D를 그리는 기존 목표를 유지합니다.
이 로컬 패키지는 기능 시안이며 현재 다른 PC에서 접근할 수 있는 서버 배포는 아닙니다.
위치/보정 중앙 저장 API는 구현했습니다. 운영 인증/HTTPS 프록시와 접근 가능한 중앙 주소 배포는 아직 수행하지 않았습니다.
방향에는 관측 출처(ssm/manual-calibration/image-estimate), 시각, 불확실성, 설치 기준 보정값이 필요합니다.
실제 PTZ 관측의 좌표계/단위가 확인되기 전 시험 방위각과 바로 연결하지 않습니다.
