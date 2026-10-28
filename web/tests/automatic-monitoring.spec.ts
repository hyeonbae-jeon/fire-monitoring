import {test,expect} from '@playwright/test';
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
test('server opens nine current ranges without manual starts, switches frames, hides expired sectors and sends CSRF on saves',async({page})=>{
 test.setTimeout(45000);let pan=1,zoom=1,expired=false,hold=false,sequence=0,saveCount=0;
 const image=readFileSync('tests/fixtures/vision/current-1.png'),requests:string[]=[];
 page.on('request',r=>requests.push(r.url()));
 await page.route('https://map.vworld.kr/**',r=>r.fulfill({contentType:'application/javascript',body:sdk}));
 await page.route('**/health',r=>r.fulfill({json:{ok:true,serverMode:true,automaticMonitoring:true}}));
 await page.route('**/api/session',r=>r.fulfill({json:{serverMode:true,csrfToken:'synthetic-csrf-token'}}));
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
