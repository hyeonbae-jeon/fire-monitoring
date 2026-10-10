import {test,expect,type Page,type APIRequestContext} from '@playwright/test';
import {sample} from '../src/map-model';

const saveKey='synthetic-e2e-config-key';
async function reset(request:APIRequestContext){
 const snapshot=await (await request.get('/api/map-configuration')).json();
 const response=await request.put('/api/map-configuration',{headers:{'X-Inventory-Write-Key':saveKey},data:{configurationRevision:snapshot.revision,configuration:sample}});
 expect(response.ok()).toBe(true);
}
test.beforeEach(async({request})=>reset(request));
test.afterEach(async({request})=>reset(request));

async function setup(page:Page,ground:number|null=700){
 await page.route('https://map.vworld.kr/**',r=>r.fulfill({contentType:'application/javascript',body:`
 window.ground=${JSON.stringify(ground)};window.views=[];window.entities=[];
 window.vw={CameraPosition:function(){},CoordZ:function(){},Direction:function(){},Map:function(){this.setOption=function(){};this.start=function(){setTimeout(()=>vw.ws3dInitCallBack(),0)}}};
 window.ws3d={viewer:{entities:{add:e=>{entities.push(e);return e},remove:e=>{entities=entities.filter(x=>x!==e)}},scene:{clampToHeight:()=>null,globe:{getHeight:()=>ground===null?undefined:ground},screenSpaceCameraController:{enableInputs:true}},camera:{frustum:{fov:1,aspectRatio:1},flyTo:()=>{},setView:x=>views.push(x)}}};
 window.Cesium={Cartesian3:{fromDegrees:(...x)=>x,fromDegreesArray:x=>x},Cartographic:{fromDegrees:(...x)=>x,fromCartesian:x=>({height:x[2]})},Cartesian2:function(){},HeightReference:{CLAMP_TO_GROUND:1,NONE:0},Color:{CYAN:'cyan',WHITE:'white',ORANGE:{withAlpha:()=> 'orange'}},Math:{toRadians:x=>x*Math.PI/180}};
 `}));
 await page.goto('/');await page.getByRole('button',{name:'지도 모니터링',exact:true}).click();
 await expect(page.getByText('중앙 지도 설정 불러옴')).toBeVisible();
 await page.getByText('설치 위치 추가',{exact:true}).click();
 await page.getByLabel('카메라 위치 이름',{exact:true}).fill('합성 시험 설치점');
 await page.getByLabel('설치 위도',{exact:true}).fill('37.5');await page.getByLabel('설치 경도',{exact:true}).fill('127.1');
 await page.getByRole('button',{name:'설치 위치 추가하기',exact:true}).click();
 await page.getByLabel('VWorld 3D 키',{exact:true}).fill('synthetic-sdk-key');
 await page.getByRole('button',{name:'VWorld 3D 연결',exact:true}).click();
 await expect(page.getByText(/VWorld 3D 뷰어 초기화 완료 ·/)).toBeVisible();
}
async function image(page:Page,width=320,height=180){
 const data=await page.evaluate(({width,height})=>{const c=document.createElement('canvas');c.width=width;c.height=height;const x=c.getContext('2d')!;x.fillStyle='#7bc';x.fillRect(0,0,width,height);x.fillStyle='#243';x.beginPath();x.moveTo(0,height);x.lineTo(width*.3,height*.2);x.lineTo(width*.7,height*.5);x.lineTo(width,height);x.fill();return c.toDataURL('image/png').split(',')[1];},{width,height});
 await page.getByLabel('참조 CCTV 이미지',{exact:true}).setInputFiles({name:'synthetic-reference.png',mimeType:'image/png',buffer:Buffer.from(data,'base64')});
 await expect(page.getByRole('img',{name:'보정용 참조 CCTV 화면'})).toBeVisible();
}
async function evidence(page:Page){
 const reference=page.locator('.reference-image');const box=(await reference.boundingBox())!;
 await reference.click({position:{x:box.width*.25,y:box.height*.3}});await reference.click({position:{x:box.width*.75,y:box.height*.4}});
 await page.getByLabel('1번 기준점 이름',{exact:true}).fill('합성 봉우리');await page.getByLabel('2번 기준점 이름',{exact:true}).fill('합성 능선');
 await page.getByLabel('참조 화면 촬영 시각',{exact:true}).fill('2026-10-10T09:00');
}
async function range(page:Page,label:string,value:number){
 await page.getByLabel(label,{exact:true}).evaluate((element,value)=>{
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(element,String(value));element.dispatchEvent(new Event('input',{bubbles:true}));
 },value);
}
async function apply(page:Page){await page.getByRole('button',{name:'가상 시점 적용',exact:true}).click();await expect(page.getByText(/가상 시점 적용 완료/)).toBeVisible();}

test('manual virtual pose, evidence-only central persistence and explicit stale state (mock SDK)',async({page,request},testInfo)=>{
 const writes:string[]=[];page.on('request',r=>{if(r.method()==='PUT')writes.push(r.postData()??'');});
 await setup(page);await image(page);await evidence(page);
 await range(page,'가상 방위각',90);await range(page,'가상 기울기',-5);await apply(page);
 const frame=page.frames().find(f=>f!==page.mainFrame())!;
 const state=await frame.evaluate('({view:views.at(-1),frustum:ws3d.viewer.camera.frustum,inputs:ws3d.viewer.scene.screenSpaceCameraController.enableInputs})');
 expect(state.view.destination).toEqual([127.1,37.5,705]);expect(state.view.orientation.heading).toBeCloseTo(Math.PI/2);expect(state.view.orientation.pitch).toBeCloseTo(-5*Math.PI/180);expect(state.inputs).toBe(false);
 expect(state.frustum.fov).toBeCloseTo(Math.PI/3);expect(state.frustum.aspectRatio).toBeCloseTo(16/9);
 const mapBox=(await page.locator('.map-panel').boundingBox())!;expect(mapBox.width/mapBox.height).toBeCloseTo(16/9,1);
 await page.getByRole('button',{name:'추정 방향을 설정에 반영',exact:true}).click();await expect(page.getByText('저장된 영상·지형 추정',{exact:true})).toBeVisible();
 await page.screenshot({path:testInfo.outputPath('manual-calibration-mock.png'),fullPage:true});
 await page.getByLabel('지도 저장 키',{exact:true}).fill(saveKey);await page.getByRole('button',{name:'중앙 지도 설정 저장',exact:true}).click();
 await expect(page.getByLabel('지도 저장 키',{exact:true})).toHaveValue('');
 const saved=await (await request.get('/api/map-configuration')).json();const o=saved.configuration.positions[0].orientation;
 expect(o).toMatchObject({source:'manual-calibration',status:'estimate',confidence:'unvalidated',headingDeg:90,pitchDeg:-5,groundElevationM:700,groundElevationSource:'map-terrain'});
 expect(o.reference).toMatchObject({width:320,height:180});expect(o.reference.sha256).toMatch(/^[a-f0-9]{64}$/);expect(o.landmarks).toHaveLength(2);
 expect(writes).toHaveLength(1);for(const forbidden of ['data:image','blob:','synthetic-sdk-key',saveKey,'synthetic-reference.png'])expect(writes[0]).not.toContain(forbidden);
 await page.reload();await page.getByRole('button',{name:'지도 모니터링',exact:true}).click();await expect(page.getByText('저장된 영상·지형 추정',{exact:true})).toBeVisible();
 await expect(page.getByRole('img',{name:'보정용 참조 CCTV 화면'})).toHaveCount(0);
 await page.getByRole('button',{name:'화면 방향·줌 변경으로 보정 무효화',exact:true}).click();await expect(page.getByText('보정 무효 · 방향 UNKNOWN',{exact:true})).toBeVisible();await expect(page.locator('svg polygon')).toHaveCount(0);
 await page.getByLabel('지도 저장 키',{exact:true}).fill(saveKey);await page.getByRole('button',{name:'중앙 지도 설정 저장',exact:true}).click();await expect(page.getByLabel('지도 저장 키',{exact:true})).toHaveValue('');
 expect((await (await request.get('/api/map-configuration')).json()).configuration.positions[0].orientation.status).toBe('stale');
});
test('missing terrain stays unknown; explicit zero height and portrait field of view work',async({page})=>{
 await setup(page,null);await image(page,180,320);await evidence(page);
 await page.getByRole('button',{name:'가상 시점 적용',exact:true}).click();await expect(page.getByRole('alert')).toContainText('지도 지형 높이를 아직 읽지 못했습니다');
 await expect(page.getByRole('button',{name:'추정 방향을 설정에 반영',exact:true})).toBeDisabled();
 await page.getByLabel('지도 지면 높이(m, 선택 입력)',{exact:true}).fill('0');await apply(page);
 const frame=page.frames().find(f=>f!==page.mainFrame())!;const state=await frame.evaluate('({view:views.at(-1),frustum:ws3d.viewer.camera.frustum})');
 expect(state.view.destination[2]).toBe(5);expect(state.frustum.fov).toBeCloseTo(2*Math.atan(Math.tan(Math.PI/6)/(180/320)));
 await page.getByRole('button',{name:'추정 방향을 설정에 반영',exact:true}).click();await expect(page.getByText('저장된 영상·지형 추정',{exact:true})).toBeVisible();
 await range(page,'가상 방위각',45);await expect(page.getByRole('button',{name:'추정 방향을 설정에 반영',exact:true})).toBeDisabled();await apply(page);
 await page.getByRole('button',{name:'일반 지도 보기',exact:true}).click();await expect(page.getByRole('button',{name:'추정 방향을 설정에 반영',exact:true})).toBeDisabled();await expect.poll(()=>frame.evaluate('ws3d.viewer.scene.screenSpaceCameraController.enableInputs')).toBe(true);
});
test('a matched view alone cannot be saved without capture time and two landmarks',async({page})=>{
 await setup(page);await image(page);await apply(page);
 await page.getByRole('button',{name:'추정 방향을 설정에 반영',exact:true}).click();await expect(page.getByRole('alert')).toContainText('촬영 시각');
 await page.getByLabel('참조 화면 촬영 시각',{exact:true}).fill('2026-10-10T09:00');await page.getByRole('button',{name:'추정 방향을 설정에 반영',exact:true}).click();await expect(page.getByRole('alert')).toContainText('기준점 2개');
 await evidence(page);await page.getByRole('button',{name:'추정 방향을 설정에 반영',exact:true}).click();await expect(page.getByText('저장된 영상·지형 추정',{exact:true})).toBeVisible();
 await image(page);await expect(page.getByLabel('참조 화면 촬영 시각',{exact:true})).toHaveValue('');await expect(page.getByLabel('1번 기준점 이름',{exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'추정 방향을 설정에 반영',exact:true})).toBeDisabled();
});
