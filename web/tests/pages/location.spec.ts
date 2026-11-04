import {test,expect,type Page,type Route} from '@playwright/test';
import {enteredLocation,parcelAddresses,locationReport,validLocation} from '../../src/location-model';
import {sdk} from '../fixtures/vworld-sdk';

const parcel=(text='합성 시험 지번 1-2')=>({response:{status:'OK',result:[{type:'parcel',text},{type:'road',text:'합성 도로명 (지번 아님)'}]}});
async function reply(route:Route,body:unknown){
 const callback=new URL(route.request().url()).searchParams.get('callback');
 await route.fulfill({contentType:'application/javascript',body:callback+'('+JSON.stringify(body)+');'});
}
async function setup(page:Page){
 await page.route('https://map.vworld.kr/**',r=>r.fulfill({contentType:'application/javascript',body:sdk}));
 await page.goto('./');await expect(page.getByText(/VWorld 3D 뷰어 초기화 완료 ·/)).toBeVisible();
 await page.getByRole('button',{name:'위치·지번',exact:true}).click();
 const frame=page.frames().find(f=>f!==page.mainFrame())!;
 await expect.poll(()=>frame.evaluate('sources.length')).toBe(2);
 return frame;
}

test('terrain selection queries parcel coordinates with the configured key and preserves map overlays and camera selection',async({page})=>{
 let params:URLSearchParams|undefined;
 await page.route('https://api.vworld.kr/req/address**',async r=>{params=new URL(r.request().url()).searchParams;await reply(r,parcel());});
 const frame=await setup(page),original=await frame.evaluate('activeEntities');
 await page.getByRole('button',{name:'지도에서 위치 선택',exact:true}).click();
 await expect.poll(()=>frame.evaluate('ws3d.viewer.scene.canvas.style.cursor')).toBe('crosshair');
 await frame.evaluate('window.picked=activeEntities.filter(e=>e.point)[1];activeEntities[0].show=false;clickHandler({position:{x:100,y:200}})');
 await expect(page.getByText('합성 시험 지번 1-2',{exact:true})).toBeVisible();
 await expect(page.locator('.location-result')).toContainText('37.658680');await expect(page.locator('.location-result')).toContainText('126.977980');
 expect(params!.get('service')).toBe('address');expect(params!.get('request')).toBe('getAddress');expect(params!.get('type')).toBe('PARCEL');expect(params!.get('crs')).toBe('EPSG:4326');
 expect(params!.get('point')!.split(',').map(Number)).toEqual([126.97798,37.65868]);expect(params!.get('key')).toBe('synthetic-pages-key');expect(params!.get('domain')).toBe('http://127.0.0.1:5082/fire-monitoring/');
 expect(await frame.evaluate('renderedShows.at(-1).every(s=>s===false)')).toBe(true);expect(await frame.evaluate('activeEntities[0].show')).toBe(false);
 expect(await frame.evaluate('activeEntities.filter(e=>e.label?.text!=="선택 지점").length')).toBe(original.length);expect(await frame.evaluate('sources.length')).toBe(2);
 await page.getByRole('button',{name:'카메라·설정',exact:true}).click();await expect(page.getByText('위도 37.65729 / 경도 126.94632')).toBeVisible();
 await page.getByRole('button',{name:'종료',exact:true}).click();await expect.poll(()=>frame.evaluate('ws3d.viewer.scene.canvas.style.cursor')).toBe('');await frame.evaluate('window.picked=activeEntities.filter(e=>e.point&&e.label.text!=="선택 지점")[1];clickHandler({position:{x:1,y:1}})');
 await expect(page.getByText('위도 37.66294 / 경도 126.97638')).toBeVisible();
 expect(await page.evaluate(()=>({local:localStorage.length,session:sessionStorage.length}))).toEqual({local:0,session:0});
});

test('a late cancelled address cannot replace a newer point or its address',async({page})=>{
 let held:Route|undefined,firstCallback='';
 await page.route('https://api.vworld.kr/req/address**',async r=>{
  if(!firstCallback){held=r;firstCallback=new URL(r.request().url()).searchParams.get('callback')!;return;}
  await reply(r,parcel('합성 두 번째 지점 지번'));
 });
 const frame=await setup(page);await page.getByRole('button',{name:'지도에서 위치 선택',exact:true}).click();
 await expect.poll(()=>frame.evaluate('ws3d.viewer.scene.canvas.style.cursor')).toBe('crosshair');
 await frame.evaluate('clickHandler({position:{x:1,y:1}})');await expect.poll(()=>firstCallback).not.toBe('');
 await expect(page.getByRole('status').filter({hasText:'지번 주소 조회 중'})).toBeVisible();
 await frame.evaluate('window.surface=[126.97,37.65,600];clickHandler({position:{x:2,y:2}})');
 await expect(page.getByText('합성 두 번째 지점 지번',{exact:true})).toBeVisible();
 await page.evaluate(({callback,body})=>(window as any)[callback](body),{callback:firstCallback,body:parcel('이전 지점 주소')});
 await held!.fulfill({contentType:'application/javascript',body:firstCallback+'('+JSON.stringify(parcel('이전 지점 주소'))+');'}).catch(()=>{});
 await expect(page.locator('.location-result')).toContainText('37.650000');await expect(page.getByText('이전 지점 주소',{exact:true})).toHaveCount(0);
 await expect(page.getByText('합성 두 번째 지점 지번',{exact:true})).toBeVisible();
});

test('sky and unsupported flat-globe picks clear old results without inventing coordinates',async({page})=>{
 await page.route('https://api.vworld.kr/req/address**',r=>reply(r,parcel()));
 const frame=await setup(page);await page.getByRole('button',{name:'지도에서 위치 선택',exact:true}).click();await expect.poll(()=>frame.evaluate('ws3d.viewer.scene.canvas.style.cursor')).toBe('crosshair');await frame.evaluate('clickHandler({position:{x:1,y:1}})');
 await expect(page.getByText('합성 시험 지번 1-2',{exact:true})).toBeVisible();
 await frame.evaluate('window.surface=null;window.globePicks=0;ws3d.viewer.scene.globe.pick=()=>{window.globePicks++;return [126,37,0]};clickHandler({position:{x:2,y:2}})');
 await expect(page.getByRole('alert')).toContainText('지도 표면 위치를 읽지 못했습니다');await expect(page.locator('.location-result')).toHaveCount(0);
 expect(await frame.evaluate('globePicks')).toBe(0);expect(await frame.evaluate('activeEntities.some(e=>e.label?.text==="선택 지점")')).toBe(false);
 await frame.evaluate('ws3d.viewer.scene.pickPositionSupported=false;Cesium.EllipsoidTerrainProvider=function(){};ws3d.viewer.terrainProvider=new Cesium.EllipsoidTerrainProvider();clickHandler({position:{x:3,y:3}})');
 expect(await frame.evaluate('globePicks')).toBe(0);await expect(page.locator('.location-result')).toHaveCount(0);
 await frame.evaluate('ws3d.viewer.scene.pickPositionSupported=true;window.surface=[126,37,0];clickHandler({position:{x:3,y:4}})');await expect(page.locator('.location-result')).toHaveCount(0);
 // Explicit non-ellipsoid terrain can support the ray fallback.
 await frame.evaluate('ws3d.viewer.scene.pickPositionSupported=false;ws3d.viewer.terrainProvider={};ws3d.viewer.camera.getPickRay=p=>p;ws3d.viewer.scene.globe.pick=()=>[126.97,37.65,650];clickHandler({position:{x:4,y:4}})');
 await expect(page.locator('.location-result')).toContainText('37.650000');await expect(page.getByText('합성 시험 지번 1-2',{exact:true})).toBeVisible();
});

test('manual coordinates survive lookup errors, use the active key, and copied reports exclude credentials',async({page})=>{
 let key='';
 await page.route('https://api.vworld.kr/req/address**',async r=>{key=new URL(r.request().url()).searchParams.get('key')!;await reply(r,{response:{status:'ERROR',error:{code:'INVALID_KEY',text:'must not show synthetic-secret'}}});});
 const frame=await setup(page);await page.getByRole('button',{name:'지도 연결',exact:true}).click();await page.getByText('다른 키로 연결 (선택)',{exact:true}).click();await page.getByLabel('VWorld 3D 키').fill('synthetic-other-key');await page.getByRole('button',{name:'VWorld 3D 연결',exact:true}).click();
 await expect(page.getByText(/VWorld 3D 뷰어 초기화 완료 ·/)).toBeVisible();expect(page.frames().find(f=>f!==page.mainFrame())).not.toBe(frame);
 await page.getByRole('button',{name:'위치·지번',exact:true}).click();await page.getByText('좌표 직접 입력 (선택)',{exact:true}).click();await page.getByRole('button',{name:'입력 좌표 조회',exact:true}).click();await expect(page.getByRole('alert')).toContainText('위도 -90~90');
 await page.getByLabel('조회 위도').fill('37.65868');await page.getByLabel('조회 경도').fill('126.97798');await page.getByRole('button',{name:'입력 좌표 조회',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('Geocoder API');await expect(page.locator('.location-result')).toContainText('37.658680');expect(key).toBe('synthetic-other-key');await expect(page.getByText(/must not show/)).toHaveCount(0);
 await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async(text:string)=>{(window as any).copiedLocation=text;}}}));await page.getByRole('button',{name:'좌표·지번 복사',exact:true}).click();await expect(page.getByText('좌표·지번 복사 완료',{exact:true})).toBeVisible();
 const copied=await page.evaluate('window.copiedLocation');expect(copied).toContain('위도: 37.658680');expect(copied).toContain('조회 지번: 미확인');expect(copied).not.toContain('synthetic-other-key');
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('missing and timed out addresses leave coordinates available for reporting',async({page})=>{
 let missing=true;
 await page.route('https://api.vworld.kr/req/address**',r=>missing?reply(r,{response:{status:'NOT_FOUND'}}):Promise.resolve());
 await setup(page);await page.getByText('좌표 직접 입력 (선택)',{exact:true}).click();await page.getByLabel('조회 위도').fill('37.65');await page.getByLabel('조회 경도').fill('126.97');await page.getByRole('button',{name:'입력 좌표 조회',exact:true}).click();
 await expect(page.getByText('조회된 지번 주소 없음 · 좌표를 사용하세요.',{exact:true})).toBeVisible();
 missing=false;await page.clock.install();await page.getByRole('button',{name:'지번 다시 조회',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'지번 주소 조회 중'})).toBeVisible();await page.clock.fastForward(10001);
 await expect(page.getByRole('alert')).toContainText('주소 조회 시간 초과');await expect(page.locator('.location-result')).toContainText('37.650000');await expect(page.getByRole('button',{name:'좌표·지번 복사',exact:true})).toBeEnabled();
});

test('only validated coordinates and parcel responses are used; road addresses are never treated as parcel addresses',()=>{
 const point=enteredLocation('37.65','126.97');expect(validLocation(point)).toBe(true);expect(parcelAddresses(parcel())).toEqual(['합성 시험 지번 1-2']);
 expect(parcelAddresses({response:{status:'OK',result:[{type:'road',text:'합성 도로명'}]}})).toEqual([]);
 for(const args of [['','126'],['91','126'],['37','181'],['NaN','126']])expect(()=>enteredLocation(...args as [string,string])).toThrow();
 for(const body of [null,{response:{status:'OK',result:{text:'unknown'}}},{response:{status:'OK',result:[{type:'parcel',text:''}]}}])expect(()=>parcelAddresses(body)).toThrow();
 expect(validLocation({...point,source:'map-surface',heightM:null})).toBe(false);expect(locationReport(point,[])).toContain('실제 화재 위치 확인 필요');
});
