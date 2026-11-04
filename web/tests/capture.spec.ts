import {test,expect,type Page} from '@playwright/test';

const key='synthetic-capture-key';
async function open(page:Page){
 await page.goto('/');await page.getByRole('button',{name:'실시간 화면 시험',exact:true}).click();
 await page.getByLabel('영상 조회 키').fill(key);
 await page.getByRole('button',{name:'라이브 화면 확인',exact:true}).click();
}
async function fixture(page:Page){
 const data=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=100;c.height=80;const g=c.getContext('2d')!;g.fillStyle='#0088cc';g.fillRect(0,0,100,80);return c.toDataURL('image/jpeg').split(',')[1];});
 return Buffer.from(data,'base64');
}
function status(overrides:Record<string,unknown>={}){
 return {configured:true,status:'live',liveFrameAvailable:true,directionStatus:'unknown',automaticDirectionTrackingImplemented:false,
  observation:{sessionId:'11111111111141118111111111111111',cameraLabel:'합성 시험 카메라',status:'live',reasonCode:'capturing',
   capturedAt:new Date().toISOString(),sequence:1,sceneChanged:false,lowContrast:false,referenceDifference:0},...overrides};
}

test('frame fetch uses key header, never URL or browser storage; direction remains unknown',async({page})=>{
 const jpeg=await fixture(page);const requested:string[]=[];
 await page.route('**/api/screen-capture/status',r=>r.fulfill({json:status()}));
 await page.route('**/api/screen-capture/frame?*',async r=>{
  requested.push(r.request().url());expect(r.request().headers()['x-capture-read-key']).toBe(key);
  await r.fulfill({contentType:'image/jpeg',body:jpeg});
 });
 await open(page);await expect(page.getByRole('img',{name:'읽기 전용으로 수집한 최신 CCTV 화면'})).toBeVisible();
 await expect(page.getByText('현재 방향: 미확인')).toBeVisible();
 expect(requested.length).toBeGreaterThan(0);expect(requested.some(u=>u.includes(key))).toBe(false);
 expect(await page.evaluate(()=>({local:localStorage.length,session:sessionStorage.length}))).toEqual({local:0,session:0});
 const downloading=page.waitForEvent('download');await page.getByRole('link',{name:'참조 화면 저장'}).click();
 const download=await downloading;const stream=await download.createReadStream();const buffers:Buffer[]=[];
 for await(const chunk of stream!)buffers.push(Buffer.from(chunk));
 expect(Buffer.concat(buffers)).toEqual(jpeg);expect(download.suggestedFilename()).toMatch(/^cctv-reference-.*\.jpg$/);
 await page.getByRole('button',{name:'라이브 표시 중지',exact:true}).click();
 await expect(page.getByRole('img',{name:'읽기 전용으로 수집한 최신 CCTV 화면'})).toHaveCount(0);
 await expect(page.getByRole('link',{name:'참조 화면 저장'})).toHaveCount(0);
});
test('occlusion replaces live image with paused explanation',async({page})=>{
 const jpeg=await fixture(page);let paused=false;
 await page.route('**/api/screen-capture/status',r=>r.fulfill({json:paused?status({status:'paused',liveFrameAvailable:false,observation:{...status().observation,status:'paused',reasonCode:'region-occluded'}}):status()}));
 await page.route('**/api/screen-capture/frame?*',r=>r.fulfill({contentType:'image/jpeg',body:jpeg}));
 await open(page);await expect(page.getByRole('img',{name:'읽기 전용으로 수집한 최신 CCTV 화면'})).toBeVisible();paused=true;
 await expect(page.getByRole('img',{name:'읽기 전용으로 수집한 최신 CCTV 화면'})).toHaveCount(0);
 await expect(page.getByText('영상 영역에 다른 창이 겹쳐 수집이 일시 중지되었습니다.')).toBeVisible();
});
test('hung status request cannot keep an old frame on screen',async({page})=>{
 const jpeg=await fixture(page);let count=0,release!:()=>void;const gate=new Promise<void>(r=>{release=r;});
 await page.route('**/api/screen-capture/status',async r=>{
  if(++count===1)await r.fulfill({json:status()});else{await gate;await r.abort();}
 });
 await page.route('**/api/screen-capture/frame?*',r=>r.fulfill({contentType:'image/jpeg',body:jpeg}));
 try{
  await open(page);await expect(page.getByRole('img',{name:'읽기 전용으로 수집한 최신 CCTV 화면'})).toBeVisible();
  await expect(page.getByRole('img',{name:'읽기 전용으로 수집한 최신 CCTV 화면'})).toHaveCount(0,{timeout:6000});
  await expect(page.getByText('최신 화면이 4초 이상 들어오지 않았거나 수집 시각을 확인할 수 없습니다.')).toBeVisible();
 }finally{release();}
});
test('scene change is labeled as unknown direction, without claiming PTZ',async({page})=>{
 const jpeg=await fixture(page);
 await page.route('**/api/screen-capture/status',r=>r.fulfill({json:status({observation:{...status().observation,sceneChanged:true}})}));
 await page.route('**/api/screen-capture/frame?*',r=>r.fulfill({contentType:'image/jpeg',body:jpeg}));
 await open(page);await expect(page.getByText(/화면 변화 감지 · 기준 사진 시점/)).toBeVisible();await expect(page.getByText(/장비에서 받은 새 방향은 미확인입니다/)).toBeVisible();
});
test('read errors clear image and show an actionable error',async({page})=>{
 await page.route('**/api/screen-capture/status',r=>r.fulfill({status:401,json:{error:'synthetic denied'}}));
 await open(page);await expect(page.getByRole('alert')).toContainText('HTTP 401');
 await expect(page.getByRole('img',{name:'읽기 전용으로 수집한 최신 CCTV 화면'})).toHaveCount(0);
});
