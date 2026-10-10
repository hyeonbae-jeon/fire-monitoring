# GoogleMapViewer 추가 정적 분석 (2026-10-10)

사용자 제공 HTW.SSM.ConsoleStudio.Views.GoogleMapViewer.dll을 ILSpyCmd로 실행 없이 분석했습니다.
디컴파일 종료 코드 0, C# 파일 182개, net48/x64, AssemblyVersion 및 FileVersion은 1.0.0.0입니다.
[원본 SHA256/크기](ssm-google-map-manifest.json). 원본/전체 디컴파일 소스는 공개하거나 배포하지 않습니다.

사용자가 알려준 회사 설치 경로: `C:\Program Files\Wisenet\SSM Client\Console`.
이 경로는 사용자 진술이며 클라우드에서 회사 PC의 파일 시스템에 접근하거나 해당 DLL을 로드하지 않았습니다.
향후 특정 파일이 필요할 때 이 폴더의 파일명을 안내합니다. 설치 경로에 현장 방향 보정값이 반드시 존재한다고 가정하지 않습니다.

## 직접 확인한 내용

- GoogleMapViewForm은 GOOGLEMAP_VIEW_MAN 화면 입력을 SYSTEM_MAN으로 연결합니다.
- OnEvent는 외부 BaseViewerForm.OnEvent에 먼저 위임한 뒤 연결/GPS/이벤트 등 자체 처리를 수행합니다.
- RequestEx는 목적지 입력에 요청을 전달합니다. 이 메서드만으로 읽기 전용이라는 뜻은 아닙니다.
- VMController_MonitorCellClicked는 Camera.PtzCap 기반 TileStatus/카메라 정보를 구성합니다.
  이 UI 처리의 capability 값을 실제 계정 PTZ 권한 승인으로 사용하지 않습니다.
- GetUserCap은 SSMDataCenter.FindParentUserPermission에 위임합니다. 해당 화면과 실제 계정의
  권한 설정/위치 구독 승인 여부는 이 메서드 존재만으로 확정할 수 없습니다.
- CameraViewControl에는 D2D의 PTZ 줌 조작 호출이 있으므로 모듈 전체를 실행 진단에 로드하지 않습니다.

182개 C# 및 전체 IL에서 headingAngle/m_fPan/GET_ABS_PTZ 직접 참조는 발견되지 않았습니다.
C#의 heading/SetPanAngle/Rotation 직접 사용도 찾지 못했습니다.
NORTH라는 이름은 위도 북반구 구분에서도 쓰이므로 북쪽 보정값 발견으로 취급하지 않습니다.

이는 해당 제공 모듈의 직접 구현에 대한 조사 결과입니다. 외부 BaseViewerForm/D2D와 전체 설치본,
서버 저장 데이터에 방향 정보가 없다는 증명은 아닙니다. 이 파일에서 현재 PTZ 수신·북쪽 보정의
새로운 계약은 확인하지 못했습니다. 기존 DataService의 extendedData.heading 저장 코드는 유효한 조사 단서로 남습니다.

## 후속 읽기 진단 v2

원본 설치 DLL을 더 수집하기보다 이미 성공한 동일 목록 GET 응답에서 설정 메타데이터를 추출합니다.
새 진단은 별도 요청/설정 변경 없이 camera-metadata.private.json을 추가 작성합니다.

- capability: 원본의 16진 문자열을 손실 없는 uint64 10진 문자열 entityCapability로 정규화
- subType/installType: 응답에 존재하는 숫자만 기록; 누락/형식 오류는 null과 명시적 issues
- extendedData: 원본 JSON 전체를 저장하지 않고 latitude/longitude/heading 숫자값만 추출
- xMapSubscriptionConditions: entityCapability의 128 비트, subType 4/8,
  PtzCap의 GET_POS_NORMALIZE 비트를 조합한 데이터 조건; 계정 권한이나 실수신 성공과 구분

설정 heading=0도 관측값으로 보존하며 기본값/실제 북쪽/현재 Pan 여부를 추측하지 않습니다.
저장 좌표는 사용자가 제공한 9개 지도 좌표를 자동 덮어쓰지 않습니다.
응답의 이름/UUID/설정 위치·heading은 로컬 private 파일에만 기록하고 공유용 보고서는 수량/오류만 제공합니다.
메타데이터의 비필수 필드가 잘못된 경우 기존 목록은 유지하고 issues로 구분합니다.
동일 UUID의 메타데이터가 충돌하면 미리보기를 생성하지 않습니다.

실시간 PTZ, 계정 권한 설정 읽기/변경 및 조작권 요청은 여전히 구현하지 않았습니다.
새 API 경로/강제 접속/카메라 이동/SET_ABS_PTZ 요청은 추가하지 않았습니다.
[실행 방법](ssm-connection-test.md). 실제 저장값은 회사 PC에서 v2 실행 후 확인해야 합니다.
