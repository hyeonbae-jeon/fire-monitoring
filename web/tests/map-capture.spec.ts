import {test,expect,type Page} from '@playwright/test';
import {sdk} from './fixtures/vworld-sdk';

const key='synthetic-map-capture-key';
const imageName='지도에서 확인하는 최신 CCTV 화면';
function status(sequence=1,patch:Record<string,unknown>={}){
 return {configured:true,status:'live',liveFrameAvailable:true,directionStatus:'unknown',automaticDirectionTrackingImplemented:false,
  observation:{sessionId:'11111111111141118111111111111111',cameraLabel:'합성 수집 카메라',status:'live',reasonCode:'capturing',capturedAt:new Date().toISOString(),sequence,sceneChanged:false,lowContrast:false,referenceDifference:0},...patch};
}
async function fixture(page:Page){
 return Buffer.from(await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=100;canvas.height=80;const g=canvas.getContext('2d')!;g.fillStyle='#37745f';g.fillRect(0,0,100,80);return canvas.toDataURL('image/jpeg').split(',')[1];}),'base64');
}
async function open(page:Page,connectMap=false){
 if(connectMap)await page.route('https://map.vworld.kr/**',r=>r.fulfill({contentType:'application/javascript',body:sdk}));
 await page.goto('/');await page.getByRole('button',{name:'지도 모니터링',exact:true}).click();
 if(connectMap){await page.getByRole('button',{name:'지도 연결',exact:true}).click();await page.getByLabel('VWorld 3D 키').fill('synthetic-map-key');await page.getByRole('button',{name:'VWorld 3D 연결',exact:true}).click();await expect(page.getByText(/VWorld 3D 뷰어 초기화 완료 ·/)).toBeVisible();}
 await page.getByRole('button',{name:'실시간 영상',exact:true}).click();
}
async function start(page:Page){await page.getByLabel('지도 영상 조회 키').fill(key);await page.getByRole('button',{name:'지도에서 라이브 확인',exact:true}).click();}

test('map and live frames coexist; frames update without camera pose changes, automatic binding or write requests',async({page})=>{
 const jpeg=await fixture(page);let sequence=0;const methods:string[]=[];
 page.on('request',r=>methods.push(r.method()));
 await page.route('**/api/screen-capture/status',r=>{expect(r.request().headers()['x-capture-read-key']).toBe(key);return r.fulfill({json:status(++sequence)});});
 await page.route('**/api/screen-capture/frame?*',r=>{expect(r.request().headers()['x-capture-read-key']).toBe(key);expect(r.request().url()).not.toContain(key);return r.fulfill({contentType:'image/jpeg',body:jpeg});});
 await open(page,true);await start(page);await expect(page.getByRole('img',{name:imageName})).toBeVisible();await expect.poll(()=>sequence).toBeGreaterThanOrEqual(2);
 const frame=page.frames().find(f=>f!==page.mainFrame())!;expect(await frame.evaluate('activeEntities.filter(e=>e.point).length')).toBe(3);expect(await frame.evaluate('views.length')).toBe(0);await expect(page.locator('.map-live-panel')).toContainText('수집 영상과의 장비 일치 미확인');await expect(page.locator('.map-live-panel')).toContainText('현재 방향: 미확인');
 await frame.evaluate('window.picked=activeEntities.filter(e=>e.point)[1];clickHandler({position:{x:1,y:1}})');await expect(page.locator('.map-live-panel')).toContainText('선택 지도 위치: 북한산 시험 B');await expect(page.getByRole('img',{name:imageName})).toBeVisible();expect(await frame.evaluate('views.length')).toBe(0);
 const downloading=page.waitForEvent('download');await page.locator('.map-live-panel').getByRole('link',{name:'참조 화면 저장'}).click();const stream=await (await downloading).createReadStream();const chunks:Buffer[]=[];for await(const part of stream!)chunks.push(Buffer.from(part));expect(Buffer.concat(chunks)).toEqual(jpeg);
 expect(methods.every(method=>method==='GET')).toBe(true);expect(await page.evaluate(()=>({local:localStorage.length,session:sessionStorage.length}))).toEqual({local:0,session:0});
});

test('map feed removes occluded frames and keeps scene changes as unknown direction',async({page})=>{
 const jpeg=await fixture(page);let paused=false;
 await page.route('**/api/screen-capture/status',r=>r.fulfill({json:paused?status(2,{status:'paused',liveFrameAvailable:false,observation:{...status().observation,status:'paused',reasonCode:'region-occluded'}}):status(1,{observation:{...status().observation,sceneChanged:true}})}));
 await page.route('**/api/screen-capture/frame?*',r=>r.fulfill({contentType:'image/jpeg',body:jpeg}));await open(page);await start(page);await expect(page.getByRole('img',{name:imageName})).toBeVisible();await expect(page.locator('.map-live-panel')).toContainText('새 방향은 미확인입니다');
 paused=true;await expect(page.getByRole('img',{name:imageName})).toHaveCount(0);await expect(page.locator('.map-live-panel')).toContainText('다른 창이 겹쳐');await expect(page.locator('.map-live-panel').getByRole('link',{name:'참조 화면 저장'})).toHaveCount(0);
});

test('closing the map panel aborts an in-flight frame and switching tabs stops polling and clears transient keys',async({page})=>{
 const jpeg=await fixture(page);let count=0,held=false,release!:()=>void;const gate=new Promise<void>(r=>release=r);
 await page.route('**/api/screen-capture/status',r=>{count++;return r.fulfill({json:status(count)});});
 await page.route('**/api/screen-capture/frame?*',async r=>{held=true;await gate;await r.fulfill({contentType:'image/jpeg',body:jpeg}).catch(()=>{});});
 try{
  await open(page);await start(page);await expect.poll(()=>held).toBe(true);await page.getByRole('button',{name:'실시간 영상',exact:true}).click();release();await page.getByRole('button',{name:'실시간 영상',exact:true}).click();await expect(page.getByRole('img',{name:imageName})).toHaveCount(0);await expect(page.getByLabel('지도 영상 조회 키')).toHaveValue('');
  await page.unroute('**/api/screen-capture/frame?*');await page.route('**/api/screen-capture/frame?*',r=>r.fulfill({contentType:'image/jpeg',body:jpeg}));await start(page);await expect(page.getByRole('img',{name:imageName})).toBeVisible();await page.clock.install();await page.getByRole('button',{name:'카메라 목록',exact:true}).click();const before=count;await page.clock.fastForward(6000);expect(count).toBe(before);await page.getByRole('button',{name:'지도 모니터링',exact:true}).click();await expect(page.getByRole('img',{name:imageName})).toHaveCount(0);await expect(page.getByLabel('지도 영상 조회 키')).toHaveValue('');
 }finally{release();}
});

test('portable mode supplies only the local demo read key; hung responses expire the image in the map',async({page})=>{
 const jpeg=await fixture(page);let count=0,release!:()=>void;const gate=new Promise<void>(r=>release=r);
 await page.route('**/health',r=>r.fulfill({json:{localDesktopDemo:true}}));
 await page.route('**/api/screen-capture/status',async r=>{expect(r.request().headers()['x-capture-read-key']).toBe('local-demo-only');if(++count===1)await r.fulfill({json:status()});else{await gate;await r.abort().catch(()=>{});}});
 await page.route('**/api/screen-capture/frame?*',r=>r.fulfill({contentType:'image/jpeg',body:jpeg}));
 try{await open(page);await page.getByRole('button',{name:'지도에서 라이브 확인',exact:true}).click();await expect(page.getByRole('img',{name:imageName})).toBeVisible();await expect(page.getByRole('img',{name:imageName})).toHaveCount(0,{timeout:6000});await expect(page.locator('.map-live-panel')).toContainText('4초 이상');await expect(page.getByRole('img',{name:'북한산 시험 카메라 좌표 배치도'})).toBeVisible();}finally{release();}
});
