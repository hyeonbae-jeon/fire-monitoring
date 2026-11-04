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
 await page.route('**/api/firewatcher-mail',r=>r.fulfill({json:{configured:false,enabled:false,status:'not-configured',checkedAt:null,pollSeconds:30,skippedMessages:0,retainedLimit:1000,source:'iphone-mail-forward',events:[]}}));
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
 await expect(page.getByRole('button',{name:'관측 범위',exact:true,includeHidden:true})).toHaveCount(0);
 const sectors='activeEntities.filter(e=>e.polygon&&e.name?.includes("현재 관측 방향"))';
 await expect(page.getByRole('group',{name:'관측 범위 표시',exact:true})).toBeVisible();
 await page.getByLabel('선택 카메라만 표시',{exact:true}).check();await expect.poll(()=>frame.evaluate(sectors+'.length')).toBe(1);
 await page.locator('.automatic-camera-list button').nth(2).click();
 await expect.poll(()=>frame.evaluate(sectors+'[0].name')).toContain('합성 자동 카메라 2');
 await expect(page.getByRole('img',{name:'합성 자동 카메라 2 현재 영상'})).toBeVisible();
 await page.getByLabel('현재 관측 범위 표시',{exact:true}).uncheck();await expect.poll(()=>frame.evaluate(sectors+'.length')).toBe(0);
 await expect(page.getByRole('img',{name:'합성 자동 카메라 2 현재 영상'})).toBeVisible();
 await page.getByLabel('선택 카메라만 표시',{exact:true}).uncheck();await page.getByLabel('현재 관측 범위 표시',{exact:true}).check();await expect.poll(()=>frame.evaluate(sectors+'.length')).toBe(9);
 await page.getByRole('button',{name:'AI 감지 알림',exact:true}).click();await expect(page.getByText('메일 수신 설정 전',{exact:true})).toBeVisible();
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

test('mail alert requires explicit camera confirmation, stores binding with CSRF and displays a camera-installation marker',async({page})=>{
 const requests:string[]=[];page.on('request',r=>requests.push(r.url()));
 const frame=await mockServer(page,'admin',()=>state(Date.now()));
 const event={id:'a'.repeat(64),link:'https://alert.example/sms/synthetic-event/synthetic-recipient',mailSentAt:'2026-11-03T10:00:00Z',mailReceivedAt:'2026-11-03T10:01:00Z',firstSeenAt:'2026-11-03T10:02:00Z',binding:null as null|{cameraId:string;lat:number;lon:number}};
 const mail={configured:true,enabled:true,status:'connected',checkedAt:new Date().toISOString(),pollSeconds:30,skippedMessages:0,retainedLimit:1000,source:'iphone-mail-forward',events:[event]};
 await page.route('**/api/firewatcher-mail',r=>r.fulfill({json:mail}));
 let writes=0;
 await page.route('**/api/firewatcher-mail/binding',r=>{
  expect(r.request().headers()['x-monitor-csrf']).toBe('synthetic-csrf-token');
  expect(r.request().postDataJSON()).toEqual({eventId:event.id,cameraId:'auto-2',confirmCamera:true});
  const p=configuration.positions[2];event.binding={cameraId:p.id,lat:p.lat,lon:p.lon};writes++;
  return r.fulfill({json:{ok:true}});
 });
 await page.getByRole('button',{name:'AI 감지 알림',exact:true}).click();
 const panel=page.getByRole('region',{name:'FIREWATCHER 메일 알림'});
 await panel.getByRole('button',{name:'수신 상태 새로고침'}).click();
 await expect(panel.getByText('네이버 메일 연결 정상',{exact:true})).toBeVisible();
 await panel.getByRole('button',{name:/카메라 확인 필요/}).click();
 const save=panel.getByRole('button',{name:'알림 카메라 연결 저장'});
 await expect(save).toBeDisabled();
 await panel.getByLabel('연결할 지도 카메라').selectOption('auto-2');await expect(save).toBeDisabled();
 await expect(panel.getByText('원본 감지 시각: 미확인',{exact:false})).toBeVisible();
 const link=panel.getByRole('link',{name:'원본 알림 페이지 열기 ↗'});await expect(link).toHaveAttribute('referrerpolicy','no-referrer');
 await expect.poll(()=>frame.evaluate('activeEntities.filter(e=>e.name?.includes("알림 자료 카메라 위치")).length')).toBe(0);
 await panel.getByLabel('원본 알림과 같은 카메라임을 확인했습니다.').check();await save.click();
 await expect.poll(()=>writes).toBe(1);
 await expect.poll(()=>frame.evaluate('activeEntities.filter(e=>e.name?.includes("알림 자료 카메라 위치")).length')).toBe(1);
 await expect(panel.getByRole('button',{name:'지도에서 알림 카메라 보기'})).toBeVisible();
 expect(requests.filter(r=>r.startsWith('https://alert.example'))).toEqual([]);
 expect(await page.evaluate(()=>({local:localStorage.length,session:sessionStorage.length}))).toEqual({local:0,session:0});
});

test('viewer can read forwarded mail and see confirmed camera but receives no binding or mailbox administration controls',async({page})=>{
 await mockServer(page,'viewer',()=>state(Date.now()));
 const p=configuration.positions[1];
 await page.route('**/api/firewatcher-mail',r=>r.fulfill({json:{configured:true,enabled:true,status:'connected',checkedAt:new Date().toISOString(),pollSeconds:30,skippedMessages:0,retainedLimit:1000,source:'iphone-mail-forward',events:[{
  id:'b'.repeat(64),link:'https://alert.example/sms/test/recipient',mailSentAt:null,mailReceivedAt:null,firstSeenAt:new Date().toISOString(),binding:{cameraId:p.id,lat:p.lat,lon:p.lon}
 }]}}));
 await page.getByRole('button',{name:'AI 감지 알림',exact:true}).click();
 const panel=page.getByRole('region',{name:'FIREWATCHER 메일 알림'});await panel.getByRole('button',{name:'수신 상태 새로고침'}).click();
 await panel.getByRole('button',{name:/합성 자동 카메라 1/}).click();
 await expect(panel.getByRole('button',{name:'지도에서 알림 카메라 보기'})).toBeVisible();
 await expect(panel.getByLabel('연결할 지도 카메라')).toHaveCount(0);
 await expect(panel.getByRole('button',{name:'알림 카메라 연결 저장'})).toHaveCount(0);
 await expect(page.getByText('수동 알림 자료 시험',{exact:true})).toHaveCount(0);
 await expect(panel.locator('input')).toHaveCount(0);
});

test('event image and red box load without remote browser access; historical PTZ gates terrain candidates and editing invalidates them',async({page})=>{
 const frame=await mockServer(page,'admin',()=>state(Date.now()));
 await frame.evaluate('window.terrainHeight=()=>500');
 const encoded=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=640;c.height=360;const x=c.getContext('2d')!;x.fillStyle='#666';x.fillRect(0,0,640,360);x.strokeStyle='#f01020';x.lineWidth=2;x.strokeRect(300,210,30,30);return c.toDataURL('image/jpeg',.95).split(',')[1];});
 const bytes=Buffer.from(encoded,'base64'),{createHash}=await import('node:crypto'),sha=createHash('sha256').update(bytes).digest('hex'),p=configuration.positions[0];
 const event={id:'c'.repeat(64),link:'https://alert.example/sms/test/recipient',mailSentAt:null,mailReceivedAt:null,firstSeenAt:new Date().toISOString(),binding:{cameraId:p.id,lat:p.lat,lon:p.lon},detail:{cameraKey:'synthetic-provider-camera',cameraName:'합성 감지 카메라',eventType:'Smoke',reportedTime:'2026-11-03T00:28:14.000Z',displayedTime:'2026-11-03 00:28:14',mappingCount:0,hasDevicePose:false,imageSha256:sha},detailStatus:'ready',ingestionSource:'saved-page-import'};
 await page.route('**/api/firewatcher-mail',r=>r.fulfill({json:{configured:true,enabled:true,status:'connected',checkedAt:new Date().toISOString(),pollSeconds:30,skippedMessages:0,retainedLimit:1000,source:'iphone-mail-forward',events:[event]}}));
 await page.route('**/api/firewatcher-mail/image?*',r=>r.fulfill({contentType:'image/jpeg',body:bytes}));
 const remote:string[]=[];page.on('request',r=>{if(r.url().startsWith('https://alert.example'))remote.push(r.url());});
 await page.getByRole('button',{name:'AI 감지 알림',exact:true}).click();const panel=page.getByRole('region',{name:'FIREWATCHER 메일 알림'});
 await panel.getByRole('button',{name:'수신 상태 새로고침'}).click();await panel.getByRole('button',{name:/합성 자동 카메라 0/}).click();
 await expect(panel.getByRole('img',{name:'FIREWATCHER 감지 당시 영상'})).toBeVisible();
 await expect(panel.getByText('원본 640×360 · 빨간 테두리 후보 1개')).toBeVisible();
 await panel.getByText('과거 알림 PTZ 직접 입력',{exact:true}).click();const calculate=panel.getByRole('button',{name:'지형 위치 후보 계산',exact:true});
 await expect(calculate).toBeDisabled();await expect(panel.getByLabel('감지 당시 Pan(°)')).toHaveValue('');
 await panel.getByLabel('감지 당시 Pan(°)').fill('359');await panel.getByLabel('감지 당시 Tilt(°)').fill('-4');await panel.getByLabel('감지 당시 Zoom',{exact:true}).fill('1');
 await panel.getByLabel('감지 영상이 잘리지 않은 전체 촬영 영역입니다.').check();
 await panel.getByLabel('입력한 PTZ가 이 감지 영상을 촬영한 당시의 값입니다.').check();await calculate.click();
 await expect(panel.getByText('배경 지형 위치 후보',{exact:true})).toBeVisible();
 await expect.poll(()=>frame.evaluate('activeEntities.filter(e=>e.name==="배경 지형 위치 후보 · 발화점 미확인").length')).toBe(3);
 await panel.getByLabel('감지 당시 Pan(°)').fill('5');
 await expect.poll(()=>frame.evaluate('activeEntities.filter(e=>e.name==="배경 지형 위치 후보 · 발화점 미확인").length')).toBe(0);
 await expect(calculate).toBeDisabled();expect(remote).toEqual([]);
});

test('viewer automatically projects a red box with matched current CCTV angles and removes the result when PTZ changes',async({page})=>{
 test.setTimeout(40000);let pan=1;
 const frame=await mockServer(page,'viewer',()=>state(Date.now(),pan));await frame.evaluate('window.terrainHeight=()=>500');
 const fixture=readFileSync('tests/fixtures/vision/current-1.png').toString('base64');
 const encoded=await page.evaluate(async source=>{const image=new Image();image.src='data:image/png;base64,'+source;await image.decode();const c=document.createElement('canvas');c.width=image.naturalWidth;c.height=image.naturalHeight;const x=c.getContext('2d')!;x.drawImage(image,0,0);const pixels=x.getImageData(0,0,c.width,c.height);for(let i=0;i<pixels.data.length;i+=4){const grey=Math.round(.299*pixels.data[i]+.587*pixels.data[i+1]+.114*pixels.data[i+2]);pixels.data[i]=grey;pixels.data[i+1]=grey;pixels.data[i+2]=grey;}x.putImageData(pixels,0,0);x.strokeStyle='#f01020';x.lineWidth=2;x.strokeRect(300,310,30,30);return c.toDataURL('image/jpeg',.98).split(',')[1];},fixture);
 const bytes=Buffer.from(encoded,'base64'),{createHash}=await import('node:crypto'),sha=createHash('sha256').update(bytes).digest('hex'),p=configuration.positions[0];
 const event={id:'d'.repeat(64),link:'https://alert.example/sms/test/recipient',mailSentAt:null,mailReceivedAt:new Date().toISOString(),firstSeenAt:new Date().toISOString(),binding:{cameraId:p.id,lat:p.lat,lon:p.lon},detail:{cameraKey:'synthetic-provider',cameraName:'합성 감지 카메라',eventType:'Smoke',reportedTime:'2026-11-03T00:28:14.000Z',displayedTime:null,mappingCount:0,hasDevicePose:false,imageSha256:sha},detailStatus:'ready'};
 await page.route('**/api/firewatcher-mail',r=>r.fulfill({json:{configured:true,enabled:true,status:'connected',checkedAt:new Date().toISOString(),pollSeconds:30,skippedMessages:0,retainedLimit:1000,source:'iphone-mail-forward',events:[event]}}));
 await page.route('**/api/firewatcher-mail/image?*',r=>r.fulfill({contentType:'image/jpeg',body:bytes}));
 await page.getByRole('button',{name:'AI 감지 알림',exact:true}).click();const panel=page.getByRole('region',{name:'FIREWATCHER 메일 알림'});
 await panel.getByRole('button',{name:'수신 상태 새로고침'}).click();await panel.getByRole('button',{name:/합성 자동 카메라 0/}).click();
 await expect(panel.getByText('현재 수신 화면·PTZ 대조 기준의 근사 위치',{exact:true})).toBeVisible({timeout:20000});
 await expect(panel.getByText('배경 지형 위치 후보',{exact:true})).toBeVisible();
 await expect(panel.getByLabel('감지 당시 Pan(°)')).toHaveCount(0);await expect(panel.getByText('과거 알림 PTZ 직접 입력',{exact:true})).toHaveCount(0);
 await expect.poll(()=>frame.evaluate('activeEntities.filter(e=>e.name==="배경 지형 위치 후보 · 발화점 미확인").length')).toBe(3);
 pan=30;await expect.poll(()=>frame.evaluate('activeEntities.filter(e=>e.name==="배경 지형 위치 후보 · 발화점 미확인").length')).toBe(0);
 await expect(panel.getByText('현재 영상·PTZ가 만료되거나 방향이 바뀌었습니다. 현재 CCTV 각도로 다시 계산하세요.')).toBeVisible();
});
