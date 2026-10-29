import {test,expect,type Page} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {sdk} from './fixtures/vworld-sdk';
import {automaticCoverage,automaticPose,type AutomaticStatus} from '../src/automatic-monitoring';
import {parseConfiguration} from '../src/map-model';

const configuration=parseConfiguration(JSON.stringify({schemaVersion:1,crs:'EPSG:4326',positions:Array.from({length:9},(_,i)=>({
 id:'auto-'+i,name:'합성 자동 카메라 '+i,lat:37.5+i*.001,lon:127.1,positionSource:'operator',ssmUuid:null,orientation:null,
 nativeTracking:{source:'operator-ptz-anchor',confidence:'approximate',savedAt:'2026-10-25T00:00:00Z',positionAtCalibration:{lat:37.5+i*.001,lon:127.1},deviceAnchor:{panDeg:359,tiltDeg:-4,zoom:1},pose:{headingDeg:100+i*10,pitchDeg:0,horizontalFovDeg:60,cameraHeightM:3},groundElevationM:500,zoomScale:true}
}))}));
function state(now:number,pan=1,zoom=1):AutomaticStatus{return {configured:true,serverNow:new Date(now).toISOString(),cameras:configuration.positions.map(p=>({
 cameraId:p.id,name:p.name,source:'hanwha',displayRangeM:1000,needsAttention:false,retryAt:null,
 feed:{status:'live',liveFrameAvailable:true,observation:{sessionId:'session-'+p.id,cameraLabel:p.name,status:'live',reasonCode:'snapshot-received',capturedAt:new Date(now).toISOString(),sequence:now,sceneChanged:false,lowContrast:false,referenceDifference:null},
 devicePtz:{enabled:true,status:'live',reasonCode:'ptz-received',sample:{panDeg:pan,tiltDeg:-2,zoom,zoomPulse:0,requestStartedAt:new Date(now).toISOString(),receivedAt:new Date(now).toISOString(),sequence:now}}}
}))};}
test('nine current sectors use separate anchors, wrap pan, scale zoom and suppress only invalid or expired evidence',()=>{
 const now=Date.now(),s=state(now,1,2),p=configuration.positions[0],c=s.cameras[0];
 expect(automaticCoverage(configuration.positions,s,now)).toHaveLength(9);
 expect(automaticPose(p,c,now)).toMatchObject({headingDeg:102,pitchDeg:-2});
 expect(automaticPose(p,c,now)!.horizontalFovDeg).toBeCloseTo(2*Math.atan(Math.tan(Math.PI/6)/2)*180/Math.PI);
 const telephoto=state(now,1,50);expect(automaticCoverage(configuration.positions,telephoto,now)).toHaveLength(9);
 expect(automaticPose(p,telephoto.cameras[0],now)!.horizontalFovDeg).toBeLessThan(2);
 expect(automaticPose(p,s.cameras[1],now)).toBeNull();
 for(const failure of ['image-stale','ptz-stale','future','camera-name','source-error','position-change']){
  const changed=structuredClone(s),point=structuredClone(p),camera=changed.cameras[0];
  if(failure==='image-stale')camera.feed.observation!.capturedAt=new Date(now-4001).toISOString();
  if(failure==='ptz-stale')camera.feed.devicePtz!.sample!.receivedAt=new Date(now-4001).toISOString();
  if(failure==='future')camera.feed.devicePtz!.sample!.receivedAt=new Date(now+3000).toISOString();
  if(failure==='camera-name')camera.feed.observation!.cameraLabel='다른 카메라';
  if(failure==='source-error')camera.feed.status='error';
  if(failure==='position-change')point.lat+=.001;
  expect(automaticPose(point,camera,now),failure).toBeNull();
  expect(automaticCoverage([point,...configuration.positions.slice(1)],changed,now),failure).toHaveLength(8);
 }
 expect(automaticCoverage(configuration.positions,s,now+4001)).toEqual([]);
 expect(configuration.positions[0].nativeTracking!.deviceAnchor.panDeg).toBe(359);
});
async function mockServer(page:Page,role:'admin'|'viewer',status:()=>AutomaticStatus,onImage:()=>number=()=>0){
 const image=readFileSync('tests/fixtures/vision/current-1.png');
 await page.route('https://map.vworld.kr/**',r=>r.fulfill({contentType:'application/javascript',body:sdk}));
 await page.route('**/health',r=>r.fulfill({json:{ok:true,serverMode:true}}));
 await page.route('**/api/session',r=>r.fulfill({json:{serverMode:true,role,userName:'synthetic-'+role,csrfToken:'synthetic-csrf-token'}}));
 await page.route('**/api/map-client-settings',r=>r.fulfill({json:{vworldApiKey:'synthetic-browser-key'}}));
 await page.route('**/api/map-configuration',r=>r.fulfill({json:{revision:'synthetic-revision',configuration}}));
 await page.route('**/api/auto-monitor/status',r=>r.fulfill({json:status()}));
 await page.route('**/api/auto-monitor/frame?*',async r=>{const delay=onImage();if(delay)await new Promise(resolve=>setTimeout(resolve,delay));await r.fulfill({contentType:'image/png',body:image}).catch(()=>{});});
 await page.goto('/');await expect(page.getByText('최신 관측 방향 9/9대',{exact:false})).toBeVisible();await expect(page.getByText(/VWorld 3D 뷰어 초기화 완료 ·/)).toBeVisible();
 return page.frames().find(f=>f!==page.mainFrame())!;
}
test('images and map entities stay mounted across refreshes; changing PTZ updates existing polygons and current-camera view',async({page})=>{
 test.setTimeout(45000);let images=0,pan=1,zoom=1,expired=false;
 const frame=await mockServer(page,'admin',()=>{const s=state(Date.now(),pan,zoom);if(expired)s.cameras.forEach(c=>c.feed.devicePtz!.sample!.receivedAt=new Date(Date.now()-10000).toISOString());return s;},()=>++images===1?0:1200);
 await expect(page.getByRole('img',{name:'합성 자동 카메라 0 현재 영상'})).toBeVisible();
 await page.evaluate(()=>{const w=window as any;w.firstImage=document.querySelector('.automatic-camera-image');w.imageRemoved=false;new MutationObserver(()=>{if(!w.firstImage.isConnected)w.imageRemoved=true;}).observe(document.body,{childList:true,subtree:true});});
 await frame.evaluate('window.firstCoverage=activeEntities.find(e=>e.polygon&&e.name?.includes("현재 관측 방향"));window.firstMarker=activeEntities.find(e=>e.point);window.firstHierarchy=firstCoverage.polygon.hierarchy');
 await expect.poll(()=>images,{timeout:12000}).toBeGreaterThanOrEqual(3);
 expect(await page.evaluate('window.imageRemoved')).toBe(false);
 expect(await frame.evaluate('firstCoverage===activeEntities.find(e=>e.polygon&&e.name?.includes("현재 관측 방향"))&&firstCoverage.polygon.hierarchy===firstHierarchy&&firstMarker===activeEntities.find(e=>e.point)')).toBe(true);
 pan=20;await expect.poll(()=>frame.evaluate('firstCoverage.polygon.hierarchy')).not.toEqual(await frame.evaluate('firstHierarchy'));
 expect(await frame.evaluate('activeEntities.includes(firstCoverage)&&activeEntities.includes(firstMarker)')).toBe(true);
 await page.getByRole('button',{name:'현재 카메라 시점 보기',exact:true}).click();
 await expect.poll(()=>frame.evaluate('views.at(-1)?.destination')).toEqual([127.1,37.5,503]);
 await expect.poll(async()=>await frame.evaluate('views.at(-1)?.orientation.heading*180/Math.PI')).toBeCloseTo(121);
 pan=40;zoom=2;await expect.poll(async()=>await frame.evaluate('views.at(-1)?.orientation.heading*180/Math.PI')).toBeCloseTo(141);
 expect(await frame.evaluate('ws3d.viewer.scene.screenSpaceCameraController.enableInputs')).toBe(false);
 expect((await frame.evaluate('ws3d.viewer.camera.frustum.fov'))*180/Math.PI).toBeCloseTo(2*Math.atan(Math.tan(Math.PI/6)/2)*180/Math.PI);
 expect(await frame.evaluate('activeEntities.filter(e=>e.polygon&&e.name?.includes("현재 관측 방향")).length')).toBe(9);
 expired=true;await expect(page.getByRole('button',{name:'현재 카메라 시점 보기',exact:true})).toBeDisabled();await expect.poll(()=>frame.evaluate('ws3d.viewer.scene.screenSpaceCameraController.enableInputs')).toBe(true);
 await expect(page.getByText('최신 영상·PTZ를 확인할 수 없어 전체 감시 지도로 돌아왔습니다.')).toBeVisible();
});
test('viewer sees monitoring tools and current-camera view without any configuration or import controls',async({page})=>{
 const frame=await mockServer(page,'viewer',()=>state(Date.now()));
 await expect(page.getByText('synthetic-viewer · 일반 사용자')).toBeVisible();
 for(const name of ['카메라·설정','지도 레이어','지도 연결','위치·지번','중앙 지도 설정 저장'])await expect(page.getByRole('button',{name,exact:true,includeHidden:true})).toHaveCount(0);
 await expect(page.locator('input[type=file]')).toHaveCount(0);
 await expect(page.getByText('감시 방향 보정 (관리자)',{exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'근사 기준을 지도 설정에 반영',exact:true,includeHidden:true})).toHaveCount(0);
 await page.getByRole('button',{name:'현재 카메라 시점 보기',exact:true}).click();await expect.poll(()=>frame.evaluate('views.at(-1)?.destination')).toEqual([127.1,37.5,503]);
 await page.getByRole('button',{name:'전체 감시 지도로 돌아가기',exact:true}).click();await expect.poll(()=>frame.evaluate('ws3d.viewer.scene.screenSpaceCameraController.enableInputs')).toBe(true);
 await page.getByRole('button',{name:'관측 범위',exact:true}).click();await expect(page.getByRole('heading',{name:'현재 관측 범위',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'AI 감지 알림',exact:true}).click();await expect(page.getByText('AI 연동 준비 중 · 현재 실제 감지 알림을 수신하지 않습니다.')).toBeVisible();
 await expect(page.locator('input[type=file]')).toHaveCount(0);
});
test('expired image downloads are discarded without accumulating blob buffers',async({page})=>{
 test.setTimeout(20000);let images=0;
 await page.addInitScript(()=>{const w=window as any;w.activeImageUrls=new Set();w.createdImageUrls=0;const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);URL.createObjectURL=(blob:Blob|MediaSource)=>{const url=create(blob);w.activeImageUrls.add(url);w.createdImageUrls++;return url;};URL.revokeObjectURL=(url:string)=>{w.activeImageUrls.delete(url);revoke(url);};});
 await mockServer(page,'viewer',()=>state(Date.now()),()=>++images===1?0:4500);
 await expect(page.getByRole('img',{name:'합성 자동 카메라 0 현재 영상'})).toBeVisible();
 await expect.poll(()=>page.evaluate('window.createdImageUrls'),{timeout:10000}).toBeGreaterThanOrEqual(2);
 await expect.poll(()=>page.evaluate('window.activeImageUrls.size')).toBeLessThanOrEqual(1);
 await expect(page.getByRole('img',{name:'합성 자동 카메라 0 현재 영상'})).toHaveCount(0);
});
test('server opens nine current ranges without manual starts, switches frames, hides expired sectors and sends CSRF on saves',async({page})=>{
 test.setTimeout(45000);let pan=1,zoom=1,expired=false,hold=false,sequence=0,saveCount=0;
 const image=readFileSync('tests/fixtures/vision/current-1.png'),requests:string[]=[];
 page.on('request',r=>requests.push(r.url()));
 await page.route('https://map.vworld.kr/**',r=>r.fulfill({contentType:'application/javascript',body:sdk}));
 await page.route('**/health',r=>r.fulfill({json:{ok:true,serverMode:true,automaticMonitoring:true}}));
 await page.route('**/api/session',r=>r.fulfill({json:{serverMode:true,role:'admin',userName:'synthetic-admin',csrfToken:'synthetic-csrf-token'}}));
 await page.route('**/api/map-client-settings',r=>r.fulfill({json:{vworldApiKey:'synthetic-browser-key'}}));
 await page.route('**/api/map-configuration',r=>{
  if(r.request().method()==='PUT'){expect(r.request().headers()['x-monitor-csrf']).toBe('synthetic-csrf-token');saveCount++;}
  return r.fulfill({json:{revision:'synthetic-revision',configuration}});
 });
 await page.route('**/api/auto-monitor/status',r=>{
  if(hold)return;
  const serverClock=Date.now()-3600000,s=state(serverClock,pan,zoom);for(const c of s.cameras){c.feed.observation!.sequence=++sequence;if(expired)c.feed.devicePtz!.sample!.receivedAt=new Date(serverClock-10000).toISOString();}
  return r.fulfill({json:s});
 });
 await page.route('**/api/auto-monitor/frame?*',r=>{
  const q=new URL(r.request().url()).searchParams;expect(q.get('sessionId')).toBe('session-'+q.get('cameraId'));return r.fulfill({contentType:'image/png',body:image});
 });
 await page.goto('/');await expect(page.getByText('최신 관측 방향 9/9대',{exact:false})).toBeVisible();
 await expect(page.getByText(/VWorld 3D 뷰어 초기화 완료 ·/)).toBeVisible();
 await expect(page.getByRole('img',{name:'합성 자동 카메라 0 현재 영상'})).toBeVisible();
 await expect(page.getByRole('region',{name:'장비 PTZ 수신 상태'})).toContainText('Pan 1.00°');
 const frame=page.frames().find(f=>f!==page.mainFrame())!,polygons='activeEntities.filter(e=>e.polygon&&e.name?.includes("현재 관측 방향(근사)"))';
 await expect.poll(()=>frame.evaluate(polygons+'.length')).toBe(9);
 const before=await frame.evaluate(polygons+'[0].polygon.hierarchy');pan=40;zoom=2;
 await expect.poll(()=>frame.evaluate(polygons+'[0].polygon.hierarchy')).not.toEqual(before);
 await page.locator('.automatic-camera-list button').nth(4).click();await expect(page.getByRole('img',{name:'합성 자동 카메라 4 현재 영상'})).toBeVisible();
 expired=true;await expect.poll(()=>frame.evaluate(polygons+'.length')).toBe(0);await expect(page.getByText('최신 관측 방향 0/9대',{exact:false})).toBeVisible();
 expect(await frame.evaluate('activeEntities.filter(e=>e.polygon).length')).toBe(0);
 expired=false;await expect.poll(()=>frame.evaluate(polygons+'.length')).toBe(9);
 hold=true;await expect.poll(()=>frame.evaluate(polygons+'.length'),{timeout:10000}).toBe(0);
 hold=false;await expect.poll(()=>frame.evaluate(polygons+'.length'),{timeout:10000}).toBe(9);
 await page.getByRole('button',{name:'카메라·설정',exact:true}).click();
 await page.getByLabel('위도·경도 JSON 불러오기',{exact:true}).setInputFiles({name:'synthetic-saved.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(configuration))});
 await page.getByRole('button',{name:'중앙 지도 설정 저장',exact:true}).click();await expect.poll(()=>saveCount).toBe(1);
 await expect(page.getByLabel('지도 저장 키',{exact:true})).toHaveCount(0);
 expect(requests.filter(u=>u.includes('camera-snapshot')||u.includes('/api/inventory')||u.includes('/api/cameras'))).toEqual([]);
 expect(await page.evaluate(()=>({local:localStorage.length,session:sessionStorage.length}))).toEqual({local:0,session:0});
});

test('administrator corrects the selected automatic range and saves centrally without changing device anchors or other cameras',async({page})=>{
 let expired=false,saveCount=0,stored=structuredClone(configuration);
 const frame=await mockServer(page,'admin',()=>{const s=state(Date.now());if(expired)s.cameras[0].feed.devicePtz!.sample!.receivedAt=new Date(Date.now()-10000).toISOString();return s;});
 await page.route('**/api/map-configuration',r=>{
  if(r.request().method()==='PUT'){
   expect(r.request().headers()['x-monitor-csrf']).toBe('synthetic-csrf-token');
   const body=r.request().postDataJSON();expect(body.configurationRevision).toBe('synthetic-revision');stored=body.configuration;saveCount++;
  }
  return r.fulfill({json:{revision:'synthetic-revision',configuration:stored}});
 });
 const panel=page.getByRole('region',{name:'자동 감시 설정 저장'}),save=panel.getByRole('button',{name:'중앙 지도 설정 저장',exact:true});
 await expect(save).toBeVisible();await expect(save).toBeDisabled();
 await page.getByRole('button',{name:'현재 카메라 시점 보기',exact:true}).click();
 await expect.poll(async()=>frame.evaluate('views.at(-1)?.orientation.heading*180/Math.PI')).toBeCloseTo(102);
 await panel.getByText('감시 방향 보정 (관리자)',{exact:true}).click();
 await panel.getByLabel('방위각 보정량(°)',{exact:true}).fill('-110');
 await panel.getByLabel('기울기 보정량(°)',{exact:true}).fill('1');
 await panel.getByLabel('저장 기준 수평 화각(°)',{exact:true}).fill('65');
 await panel.getByRole('button',{name:'근사 기준을 지도 설정에 반영',exact:true}).click();
 await expect.poll(async()=>frame.evaluate('views.at(-1)?.orientation.heading*180/Math.PI')).toBeCloseTo(352);
 await expect.poll(async()=>frame.evaluate('views.at(-1)?.orientation.pitch*180/Math.PI')).toBeCloseTo(-1);
 expect(saveCount).toBe(0);await expect(save).toBeEnabled();await save.click();await expect.poll(()=>saveCount).toBe(1);await expect(save).toBeDisabled();
 const before=configuration.positions[0],after=stored.positions[0];
 expect(after.lat).toBe(before.lat);expect(after.lon).toBe(before.lon);
 expect(after.nativeTracking!.deviceAnchor).toEqual(before.nativeTracking!.deviceAnchor);
 expect(after.nativeTracking!.pose).toEqual({...before.nativeTracking!.pose,headingDeg:350,pitchDeg:1,horizontalFovDeg:65});
 expect(after.nativeTracking!.groundElevationM).toBe(before.nativeTracking!.groundElevationM);
 expect(stored.positions.slice(1)).toEqual(configuration.positions.slice(1));
 await page.reload();await expect(page.getByText('최신 관측 방향 9/9대',{exact:false})).toBeVisible();
 await page.getByRole('region',{name:'자동 감시 설정 저장'}).getByText('감시 방향 보정 (관리자)',{exact:true}).click();
 await expect(page.getByText('저장 기준: 방위각 350.00° · 기울기 1.00° · 화각 65.00°',{exact:true})).toBeVisible();
 expired=true;await expect(page.getByRole('button',{name:'근사 기준을 지도 설정에 반영',exact:true})).toBeDisabled();
});
