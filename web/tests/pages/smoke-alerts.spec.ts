import {test,expect,type Page} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {parseMapBundle} from '../../src/map-layers';
import {parseSmokeAlerts,bindAlertCamera,resolveAlertCamera,buildAlertMarkers,alertIdentity,type SmokeAlert,type SmokeAlertDocument} from '../../src/smoke-alert-model';
import {sdk} from '../fixtures/vworld-sdk';

const map=parseMapBundle(readFileSync('src/data/bukhansan-map.json','utf8')),position=map.positions[7];
const event:SmokeAlert={eventId:'synthetic-event-1',cameraKey:'synthetic-camera-1',cameraName:'합성 AI 알림 카메라',detectedAt:'2026-10-13T09:00:00+09:00',frameSize:{width:640,height:360},box:{x:220,y:80,width:30,height:40}};
const document:SmokeAlertDocument={schemaVersion:1,kind:'smoke-alert-preview',source:'operator-input',sourceInstance:'합성 시험 사무소',events:[event]};
const alarms='activeEntities.filter(e=>e.name?.includes("알림 자료 카메라 위치"))';
async function setup(page:Page){
 await page.route('https://map.vworld.kr/**',r=>r.fulfill({contentType:'application/javascript',body:sdk}));await page.goto('./');await expect(page.getByText(/VWorld 3D 뷰어 초기화 완료 ·/)).toBeVisible();
 const frame=page.frames().find(f=>f!==page.mainFrame())!;await expect.poll(()=>frame.evaluate('sources.length')).toBe(2);await page.getByRole('button',{name:'AI 감지 알림',exact:true}).click();return frame;
}
async function load(page:Page,body:unknown=document){await page.getByLabel('정규화 알림 JSON 불러오기').setInputFiles({name:'synthetic-alerts.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(body))});}
async function bind(page:Page,id=position.id){await page.getByLabel('동일 장비로 확인한 지도 카메라').selectOption(id);}
async function image(page:Page,width:number,height:number){
 const data=await page.evaluate(({width,height})=>{const canvas=window.document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d')!;ctx.fillStyle='#244c46';ctx.fillRect(0,0,width,height);return canvas.toDataURL('image/png').split(',')[1];},{width,height});
 await page.getByLabel('이 알림의 참조 영상(직접 선택)').setInputFiles({name:'synthetic-frame.png',mimeType:'image/png',buffer:Buffer.from(data,'base64')});
}

test('operator contract rejects ambiguous dates, unscaled boxes, duplicate events and raw vendor/private fields',()=>{
 expect(parseSmokeAlerts(JSON.stringify(document))).toEqual(document);
 for(const detectedAt of ['2026-10-13 09:00:00','2026-10-13T09:00:00','2026-02-30T09:00:00+09:00','2026-10-13T24:00:00Z','2026-10-13T09:00:00+09:60'])expect(()=>parseSmokeAlerts(JSON.stringify({...document,events:[{...event,detectedAt}]}))).toThrow();
 for(const detectedAt of ['2024-02-29T09:00:00Z','2026-10-13T09:00:00.12+09:00','2026-10-13T09:00:00-04:00'])expect(()=>parseSmokeAlerts(JSON.stringify({...document,events:[{...event,detectedAt}]}))).not.toThrow();
 for(const patch of [{frameSize:null},{box:{x:620,y:80,width:30,height:40}},{box:{x:-1,y:0,width:1,height:1}},{frameSize:{width:640.5,height:360}},{frameSize:{width:8192,height:8192}},{url:'https://synthetic.invalid/private-image'},{latitude:37},{Authorization:'synthetic-value'}])expect(()=>parseSmokeAlerts(JSON.stringify({...document,events:[{...event,...patch}]}))).toThrow();
 expect(()=>parseSmokeAlerts(JSON.stringify({...document,events:[event,event]}))).toThrow();expect(()=>parseSmokeAlerts(JSON.stringify({...document,source:'live-firewatcher'}))).toThrow();expect(()=>parseSmokeAlerts(JSON.stringify({...document,events:Array.from({length:501},(_,i)=>({...event,eventId:String(i)}))}))).toThrow();
 expect(()=>parseSmokeAlerts('합'.repeat(400_000))).toThrow(/1MB/);expect(()=>parseSmokeAlerts('synthetic-secret-invalid-json')).toThrow(/알림 자료의 형식/);
});

test('bindings are explicit and scoped; moved cameras invalidate them and grouped markers always mean installation positions',()=>{
 const d={...document,events:[{...event,cameraName:position.name},{...event,eventId:'synthetic-event-2',cameraName:position.name,detectedAt:'2026-10-13T10:00:00+09:00'}]},first=d.events[0];
 expect(buildAlertMarkers(d,[],map.positions)).toEqual([]);
 const binding=bindAlertCamera(d,first,position),markers=buildAlertMarkers(d,[binding],map.positions);
 expect(markers).toEqual([{cameraId:position.id,name:position.name,lat:position.lat,lon:position.lon,count:2,latestAt:d.events[1].detectedAt,locationMeaning:'camera-installation',sourceMode:'operator-input'}]);
 expect(resolveAlertCamera({...d,sourceInstance:'다른 시험 사무소'},first,[binding],map.positions)).toBeNull();
 for(const change of [{cameraKey:'another-source-camera'},{cameraName:position.name+'도봉'}])expect(resolveAlertCamera(d,{...first,...change},[binding],map.positions)).toBeNull();
 expect(resolveAlertCamera(d,first,[binding],map.positions.filter(p=>p.id!==position.id))).toBeNull();expect(resolveAlertCamera(d,first,[binding],[{...position,lat:position.lat+.001}])).toBeNull();
 expect(alertIdentity(d,first)).not.toBe(alertIdentity(d,{...first,box:null}));
});

test('explicit camera selection draws a camera-only marker, follows filters, and clears without sending alerts to a server',async({page})=>{
 const requests:{method:string;url:string}[]=[];page.on('request',r=>requests.push({method:r.method(),url:r.url()}));
 const frame=await setup(page);await load(page,{...document,events:[{...event,cameraName:position.name}]});
 await expect(page.getByText(/지도 연결 0건/)).toBeVisible();expect(await frame.evaluate(alarms+'.length')).toBe(0);
 await bind(page);await expect.poll(()=>frame.evaluate(alarms+'.length')).toBe(1);const marker=await frame.evaluate(alarms+'[0]');expect(marker.position.slice(0,2)).toEqual([position.lon,position.lat]);expect(marker.label.text).toContain('카메라 위치 · 연기 위치 미확인');await expect(page.getByText('연기 발생 지점: 미확인',{exact:true})).toBeVisible();
 await page.getByLabel('알림 카메라 표시').uncheck();await expect.poll(()=>frame.evaluate(alarms+'.length')).toBe(0);await page.getByLabel('알림 카메라 표시').check();await expect.poll(()=>frame.evaluate(alarms+'.length')).toBe(1);
 expect(await frame.evaluate('sources.length')).toBe(2);expect(await frame.evaluate('activeEntities.filter(e=>e.point).length')).toBe(10);
 await page.getByRole('button',{name:'지도 연결',exact:true}).click();await page.getByRole('button',{name:'좌표 배치도로 보기',exact:true}).click();await expect(page.locator('g[data-alert="'+position.id+'"]')).toHaveCount(1);await expect(page.locator('g[data-alert] title')).toContainText('연기 위치 미확인');
 await page.getByRole('button',{name:'AI 감지 알림',exact:true}).click();await page.getByRole('button',{name:'이 화면의 알림 자료 지우기',exact:true}).click();await expect(page.locator('g[data-alert]')).toHaveCount(0);
 expect(requests.every(r=>r.method==='GET')).toBe(true);expect(requests.every(r=>new URL(r.url).hostname==='127.0.0.1'||new URL(r.url).hostname==='map.vworld.kr')).toBe(true);expect(await page.evaluate(()=>({local:localStorage.length,session:sessionStorage.length}))).toEqual({local:0,session:0});
});

test('camera coordinates changed by a new map import require an explicit reconfirmation',async({page})=>{
 const frame=await setup(page);await load(page);await bind(page);await expect.poll(()=>frame.evaluate(alarms+'.length')).toBe(1);
 const moved=structuredClone(map);moved.positions[7].lat+=.001;await page.getByRole('button',{name:'지도 레이어',exact:true}).click();await page.getByLabel('지도자료 JSON 불러오기').setInputFiles({name:'synthetic-moved-map.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(moved))});
 await expect.poll(()=>frame.evaluate(alarms+'.length')).toBe(0);await page.getByRole('button',{name:'AI 감지 알림',exact:true}).click();await expect(page.getByText(/지도 좌표 변경·카메라 제거/)).toBeVisible();await expect(page.getByLabel('동일 장비로 확인한 지도 카메라')).toHaveValue('');
 await bind(page);await expect.poll(()=>frame.evaluate(alarms+'[0]?.position[1]')).toBe(moved.positions[7].lat);
 await load(page,{...document,sourceInstance:'합성 다른 사무소'});await expect.poll(()=>frame.evaluate(alarms+'.length')).toBe(0);
});

test('pixel boxes require exactly matching original dimensions and event changes discard reference frames',async({page})=>{
 await setup(page);await load(page);await image(page,640,360);await expect(page.getByRole('img',{name:'알림 참조 영상 · 직접 선택'})).toBeVisible();await expect(page.locator('.alert-reference svg rect')).toHaveAttribute('x','220');await expect(page.locator('.alert-reference svg')).toHaveAttribute('viewBox','0 0 640 360');
 await image(page,320,180);await expect(page.getByRole('alert')).toContainText('해상도와 달라 박스 표시를 보류');await expect(page.locator('.alert-reference svg')).toHaveCount(0);
 await load(page,{...document,events:[{...event,detectedAt:'2026-10-13T10:00:00+09:00'}]});await expect(page.locator('.alert-reference')).toHaveCount(0);await image(page,640,360);await expect(page.locator('.alert-reference svg')).toHaveCount(1);
 await load(page,{...document,events:[{...event,box:null}]});await expect(page.locator('.alert-reference')).toHaveCount(0);await image(page,640,360);await expect(page.locator('.alert-reference svg')).toHaveCount(0);
 await load(page,{...document,events:[{...event,box:{x:639,y:1,width:30,height:40}}]});await expect(page.getByRole('alert')).toContainText('알림 자료의 형식');await expect(page.locator('.alert-reference img')).toHaveCount(1);await expect(page.locator('.alert-reference svg')).toHaveCount(0);
});

test('manual Korean-time input stays unbound, uses an operator reference ID and clears an earlier frame',async({page})=>{
 const frame=await setup(page);await load(page);await image(page,640,360);await page.getByText('알림 한 건 직접 입력',{exact:true}).click();await page.getByLabel('출처·사무소 이름').fill('합성 입력 사무소');await page.getByLabel('알림 카메라 이름',{exact:true}).fill(position.name);await page.getByLabel('감지 시각(한국시간)').fill('2026-10-13T09:35');await page.getByRole('button',{name:'입력 알림 자료 표시',exact:true}).click();
 await expect(page.getByText(/합성 입력 사무소 · 1건 · 지도 연결 0건/)).toBeVisible();await expect(page.locator('.smoke-alert-detail')).toContainText('오전 9:35:00 KST');await expect(page.locator('.smoke-alert-detail')).toContainText('알림 참조 ID: operator-');await expect(page.locator('.alert-reference')).toHaveCount(0);expect(await frame.evaluate(alarms+'.length')).toBe(0);
 await bind(page);await expect.poll(()=>frame.evaluate(alarms+'.length')).toBe(1);await page.reload();await expect(page.getByText(/VWorld 3D 뷰어 초기화 완료 ·/)).toBeVisible();await page.getByRole('button',{name:'AI 감지 알림',exact:true}).click();await expect(page.locator('.smoke-alert-detail')).toHaveCount(0);
});

test('alarm markers select cameras, suspend in virtual views and are excluded from surface picking',async({page})=>{
 await page.route('https://api.vworld.kr/req/address**',r=>{const callback=new URL(r.request().url()).searchParams.get('callback');return r.fulfill({contentType:'application/javascript',body:callback+'({response:{status:"NOT_FOUND"}})'});});
 const frame=await setup(page);await load(page);await bind(page);await expect.poll(()=>frame.evaluate(alarms+'.length')).toBe(1);await frame.evaluate('window.picked='+alarms+'[0];clickHandler({position:{x:1,y:1}})');await expect(page.locator('.map-bottom-status')).toContainText(position.name);
 await frame.evaluate(({lon,lat})=>{void (window as any).collectTerrain({requestId:'synthetic-exclusion-check',points:[[lon,lat]]});},{lon:position.lon,lat:position.lat});await expect.poll(()=>frame.evaluate('terrainCalls.some(c=>c.excludedNames.some(n=>n.includes("카메라 위치 · 연기 위치 미확인")))')).toBe(true);
 await page.getByRole('button',{name:'가상 시점 적용',exact:true}).click();await expect.poll(()=>frame.evaluate(alarms+'.length')).toBe(0);await expect(page.getByText('가상 시점 보정 중 알림 카메라 표시 숨김',{exact:true})).toBeVisible();await page.getByRole('button',{name:'일반 지도 보기',exact:true}).click();await expect.poll(()=>frame.evaluate(alarms+'.length')).toBe(1);
 await page.getByRole('button',{name:'위치·지번',exact:true}).click();await page.getByRole('button',{name:'지도에서 위치 선택',exact:true}).click();await expect.poll(()=>frame.evaluate('ws3d.viewer.scene.canvas.style.cursor')).toBe('crosshair');await frame.evaluate('clickHandler({position:{x:1,y:2}})');await expect(page.locator('.location-result')).toBeVisible();expect(await frame.evaluate('renderedShows.at(-1).every(v=>v===false)')).toBe(true);expect(await frame.evaluate(alarms+'.length')).toBe(1);
});

test('alarm rendering failure is isolated and alert controls fit tablet and mobile widths',async({page})=>{
 const frame=await setup(page);await load(page);await frame.evaluate('window.originalAdd=ws3d.viewer.entities.add;ws3d.viewer.entities.add=e=>{if(e.name?.includes("알림 자료 카메라 위치"))throw new Error("synthetic failure");return originalAdd(e)}');await bind(page);await expect(page.getByRole('alert')).toContainText('알림 카메라를 지도에 표시하지 못했습니다');expect(await frame.evaluate('activeEntities.filter(e=>e.point).length')).toBe(9);expect(await frame.evaluate('sources.length')).toBe(2);
 await frame.evaluate('ws3d.viewer.entities.add=originalAdd');await page.getByLabel('알림 카메라 표시').uncheck();await page.getByLabel('알림 카메라 표시').check();await expect.poll(()=>frame.evaluate(alarms+'.length')).toBe(1);await expect(page.getByRole('alert')).toHaveCount(0);
 await frame.evaluate('ws3d.viewer.scene.clampToHeight=()=>[0,0,NaN]');await page.getByLabel('알림 카메라 표시').uncheck();await page.getByLabel('알림 카메라 표시').check();await expect.poll(()=>frame.evaluate(alarms+'[0]?.position.length')).toBe(2);
 await frame.evaluate('ws3d.viewer.scene.clampToHeight=()=>[0,0,700]');await page.getByLabel('알림 카메라 표시').uncheck();await page.getByLabel('알림 카메라 표시').check();await expect.poll(()=>frame.evaluate(alarms+'[0]?.position')).toEqual([position.lon,position.lat,703]);
 for(const width of [800,390]){await page.setViewportSize({width,height:844});expect(await page.evaluate(()=>window.document.documentElement.scrollWidth<=innerWidth)).toBe(true);const tab=await page.getByRole('button',{name:'AI 감지 알림',exact:true}).boundingBox();expect(tab!.x+tab!.width).toBeLessThanOrEqual(width);await expect(page.getByLabel('동일 장비로 확인한 지도 카메라')).toBeVisible();}
});
