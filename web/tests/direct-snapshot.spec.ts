import {test,expect,type Page} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {sdk} from './fixtures/vworld-sdk';
import manifest from './fixtures/vision/manifest.json';
const reference=readFileSync('tests/fixtures/vision/reference.png'),current=readFileSync('tests/fixtures/vision/current-1.png');
const root='http://synthetic-device.invalid',url=root+'/stw-cgi/video.cgi?msubmenu=snapshot&action=view&Profile=1';
const username='synthetic-device-user',password='synthetic-device-password';
function status(sequence=1){return {configured:true,status:'live',liveFrameAvailable:true,reasonCode:'receiving',directionStatus:'unknown',automaticDirectionTrackingImplemented:false,frameSource:'hanwha-jpeg-snapshot',observation:{sessionId:'synthetic-direct-session',cameraLabel:'합성 직접 카메라',status:'live',reasonCode:'snapshot-received',capturedAt:new Date().toISOString(),sequence,sceneChanged:false,lowContrast:false,referenceDifference:null}};}
async function fill(page:Page){
 await page.getByLabel('영상 입력 방식').filter({visible:true}).selectOption('direct');
 await page.getByLabel('직접 연결 카메라 이름').fill('합성 직접 카메라');await page.getByLabel('카메라 웹 접속 주소').fill(root+'/wmf/index.html#/uni/channel');await page.getByLabel('카메라 장비 ID').fill(username);await page.getByLabel('카메라 장비 PW').fill(password);
}
test('direct credentials use a localhost POST only; frames refresh and disconnect clears images',async({page})=>{
 let active=false,sequence=0;const external:string[]=[],methods:string[]=[];
 page.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:5081/')&&!r.url().startsWith('blob:'))external.push(r.url());});
 await page.route('**/health',r=>r.fulfill({json:{ok:true,localDesktopDemo:true}}));
 await page.route('**/api/camera-snapshot/session',r=>{
  methods.push(r.request().method());expect(r.request().headers()['x-capture-read-key']).toBe('local-demo-only');expect(r.request().postDataJSON()).toEqual({cameraLabel:'합성 직접 카메라',snapshotUrl:url,username,password});active=true;return r.fulfill({json:status(++sequence)});
 });
 await page.route('**/api/camera-snapshot/status',r=>r.fulfill({json:active?status(++sequence):{configured:true,status:'disconnected',liveFrameAvailable:false,reasonCode:'user-stopped',observation:null}}));
 await page.route('**/api/camera-snapshot/frame?*',r=>{expect(r.request().headers()['x-capture-read-key']).toBe('local-demo-only');expect(r.request().url()).not.toContain(password);return r.fulfill({contentType:'image/png',body:current});});
 await page.route('**/api/camera-snapshot/session?*',r=>{methods.push(r.request().method());active=false;return r.fulfill({json:{status:'disconnected'}});});
 await page.goto('/');await page.getByRole('button',{name:'실시간 화면 시험',exact:true}).click();await fill(page);await page.getByRole('button',{name:'JPEG 연결 시험·수신 시작',exact:true}).click();
 await expect(page.getByRole('img',{name:'읽기 전용으로 수집한 최신 CCTV 화면'})).toBeVisible();await expect(page.getByLabel('카메라 장비 PW')).toHaveValue('');await expect(page.getByLabel('카메라 장비 ID')).toHaveValue('');
 await expect.poll(()=>sequence).toBeGreaterThan(1);expect(await page.evaluate(()=>({local:localStorage.length,session:sessionStorage.length}))).toEqual({local:0,session:0});expect(external).toEqual([]);
 await page.getByRole('button',{name:'직접 연결 종료',exact:true}).click();await expect(page.getByRole('img',{name:'읽기 전용으로 수집한 최신 CCTV 화면'})).toHaveCount(0);expect(methods).toEqual(['POST','DELETE']);
});
test('failed authentication clears the password without claiming a received image',async({page})=>{
 await page.route('**/api/camera-snapshot/session',r=>r.fulfill({status:502,json:{code:'authentication-denied',error:'장비 인증 또는 접근 권한이 거절됐습니다.'}}));
 await page.goto('/');await page.getByRole('button',{name:'실시간 화면 시험',exact:true}).click();await page.getByLabel('영상 조회 키',{exact:true}).fill('synthetic-read-key');await fill(page);await page.getByRole('button',{name:'JPEG 연결 시험·수신 시작',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('장비 인증 또는 접근 권한이 거절');await expect(page.getByLabel('카메라 장비 PW')).toHaveValue('');await expect(page.getByRole('img',{name:'읽기 전용으로 수집한 최신 CCTV 화면'})).toHaveCount(0);
});
test('opted-in native PTZ is displayed separately, expires and never becomes a map heading',async({page})=>{
 let sequence=0,nativeError=false;
 const receivedAt=new Date().toISOString();
 let sample={panDeg:12.5,tiltDeg:-4.25,zoom:2,zoomPulse:0,requestStartedAt:receivedAt,receivedAt,sequence:1};
 await page.route('**/health',r=>r.fulfill({json:{ok:true,localDesktopDemo:true}}));
 await page.route('**/api/camera-snapshot/session',r=>{
  expect(r.request().postDataJSON()).toEqual({cameraLabel:'합성 직접 카메라',snapshotUrl:url,username,password,readDevicePtz:true});
  const now=new Date().toISOString();sample={...sample,requestStartedAt:now,receivedAt:now};
  return r.fulfill({json:status(++sequence)});
 });
 await page.route('**/api/camera-snapshot/status',r=>r.fulfill({json:{...status(++sequence),devicePtz:{enabled:true,status:nativeError?'error':'live',reasonCode:nativeError?'ptz-invalid-response':'ptz-received',sample:nativeError?null:sample}}}));
 await page.route('**/api/camera-snapshot/frame?*',r=>r.fulfill({contentType:'image/png',body:current}));
 await page.goto('/');await page.getByRole('button',{name:'실시간 화면 시험',exact:true}).click();await fill(page);
 const checkbox=page.getByLabel('장비 Pan·Tilt·Zoom 함께 조회');await expect(checkbox).not.toBeChecked();await checkbox.check();
 await page.getByRole('button',{name:'JPEG 연결 시험·수신 시작',exact:true}).click();
 const panel=page.getByRole('region',{name:'장비 PTZ 수신 상태'});
 await expect(panel).toContainText('Pan 12.50° · Tilt -4.25° · Zoom 2.00 · ZoomPulse 0');
 await expect(panel).toContainText('지도 방위각 미보정');await expect(checkbox).toBeDisabled();
 await expect(panel).toContainText('최근 장비 값이 만료됐습니다.',{timeout:7000});await expect(panel).not.toContainText('Pan 12.50°');
 await expect(page.getByRole('img',{name:'읽기 전용으로 수집한 최신 CCTV 화면'})).toBeVisible();
 nativeError=true;await expect(panel).toContainText('604 오류도 이 상태로 처리합니다.');await expect(panel).toContainText('영상 수신은 계속됩니다.');
 expect(await page.evaluate(()=>({local:localStorage.length,session:sessionStorage.length}))).toEqual({local:0,session:0});
 await page.getByRole('button',{name:'라이브 표시 중지',exact:true}).click();await expect(panel).toHaveCount(0);
});
test('direct snapshots feed reference comparison and only opted-in map updates',async({page})=>{
 test.setTimeout(45000);let sequence=0,failed=false;
 await page.route('https://map.vworld.kr/**',r=>r.fulfill({contentType:'application/javascript',body:sdk}));
 await page.route('**/api/camera-snapshot/session',r=>r.fulfill({json:status(++sequence)}));
 await page.route('**/api/camera-snapshot/status',r=>r.fulfill({json:failed?{...status(),status:'error',reasonCode:'authentication-denied',liveFrameAvailable:false,observation:null}:status(++sequence)}));
 await page.route('**/api/camera-snapshot/frame?*',r=>r.fulfill({contentType:'image/png',body:current}));
 const pose=manifest.referencePose;
 const config={schemaVersion:1,crs:'EPSG:4326',positions:[{id:'direct-synthetic',name:'합성 직접 카메라',lat:37.5,lon:127.1,positionSource:'operator',ssmUuid:null,orientation:{...pose,groundElevationM:700,groundElevationSource:'operator',source:'manual-calibration',status:'estimate',confidence:'unvalidated',positionAtCalibration:{lat:37.5,lon:127.1},calibratedAt:'2026-10-20T00:00:00.000Z',reference:{sha256:createHash('sha256').update(reference).digest('hex'),width:800,height:480,capturedAt:'2026-10-20T00:00:00.000Z'},landmarks:[{label:'합성 기준 1',x:.2,y:.3},{label:'합성 기준 2',x:.8,y:.7}]}}]};
 await page.goto('/');await page.getByRole('button',{name:'지도 모니터링',exact:true}).click();await page.getByLabel('위도·경도 JSON 불러오기',{exact:true}).setInputFiles({name:'synthetic.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(config))});
 await page.getByRole('button',{name:'지도 연결',exact:true}).click();await page.getByLabel('VWorld 3D 키').fill('synthetic-map-key');await page.getByRole('button',{name:'VWorld 3D 연결',exact:true}).click();await expect(page.getByText(/VWorld 3D 뷰어 초기화 완료 ·/)).toBeVisible();
 await page.getByRole('button',{name:'실시간 영상',exact:true}).click();await page.getByLabel('지도 영상 조회 키').fill('synthetic-read-key');await fill(page);await page.getByRole('button',{name:'JPEG 연결 시험·수신 시작',exact:true}).click();await expect(page.getByRole('img',{name:'지도에서 확인하는 최신 CCTV 화면'})).toBeVisible();
 await page.getByLabel('추적 기준 원본 사진').setInputFiles({name:'reference.png',mimeType:'image/png',buffer:reference});await page.getByLabel('수집 화면이 선택한 카메라의 라이브 영상과 일치함을 확인').check();await page.getByRole('button',{name:'영상 방향 비교 시작',exact:true}).click();
 const panel=page.getByRole('region',{name:'영상 방향 추정 시험'});await expect(panel).toContainText('영상 대응 추정 · 기준 시점의 정확도 미검증',{timeout:20000});
 const frame=page.frames().find(f=>f!==page.mainFrame())!;expect(await frame.evaluate('views.length')).toBe(0);await page.getByLabel('대응 검증 시 지도 시점 자동 갱신').check();await expect.poll(()=>frame.evaluate('views.length')).toBeGreaterThan(0);
 expect((await frame.evaluate('views.at(-1)')).orientation.heading*180/Math.PI).toBeCloseTo(185,0);
 failed=true;await expect(page.getByRole('img',{name:'지도에서 확인하는 최신 CCTV 화면'})).toHaveCount(0);await expect(panel).toContainText('방향 미확인');await expect(page.locator('.map-bottom-status')).not.toContainText('영상 대응 추정');
 const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'카메라·설정',exact:true}).click();await page.getByRole('button',{name:'좌표 설정 다운로드',exact:true}).click();const stream=await(await downloading).createReadStream();let raw='';for await(const chunk of stream)raw+=chunk.toString();expect(JSON.parse(raw).positions[0].orientation).toEqual(config.positions[0].orientation);for(const secret of [username,password,url])expect(raw).not.toContain(secret);
});
