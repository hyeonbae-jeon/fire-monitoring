import {test,expect,type Page} from '@playwright/test';
import {solveGeographicCalibration,geographicVector,projectGeographic} from '../../src/geographic-calibration';
import {parseConfiguration} from '../../src/map-model';
import type {Landmark,ManualOrientation} from '../../src/calibration-model';
import controls from '../fixtures/geographic-controls.json';
import {sdk} from '../fixtures/vworld-sdk';

const points=()=>structuredClone(controls.landmarks) as Landmark[];
test('independently generated known pose and field of view are recovered; north and image axes use the map convention',()=>{
 const result=solveGeographicCalibration(controls.site,controls.width,controls.height,points());
 expect(result.acceptable).toBe(true);expect(result.pose.headingDeg).toBeCloseTo(180,6);expect(result.pose.pitchDeg).toBeCloseTo(4,6);expect(result.pose.horizontalFovDeg).toBeCloseTo(53,6);
 expect(result.fit.fitRmsPx).toBeLessThan(1e-6);expect(result.fit.validationRmsPx).toBeLessThan(1e-6);
 expect(projectGeographic([0,1,0],{headingDeg:0,pitchDeg:0,horizontalFovDeg:90},2)).toEqual({x:.5,y:.5});
 expect(projectGeographic([1,1,0],{headingDeg:0,pitchDeg:0,horizontalFovDeg:90},2)!.x).toBeCloseTo(1);
 expect(projectGeographic([0,1,1],{headingDeg:0,pitchDeg:0,horizontalFovDeg:90},2)!.y).toBeLessThan(.5);
 expect(projectGeographic([0,-1,0],{headingDeg:0,pitchDeg:0,horizontalFovDeg:90},2)).toBeNull();
 const east=geographicVector(controls.site,{lat:37.5,lon:127.11,heightM:703});expect(east[0]).toBeGreaterThan(800);expect(Math.abs(east[1])).toBeLessThan(1);
});
test('validation points never influence the fit and wrong geographic or image correspondences block application',()=>{
 const base=solveGeographicCalibration(controls.site,1000,600,points()),changed=points();changed[3].x+=.1;
 const invalid=solveGeographicCalibration(controls.site,1000,600,changed);
 expect(invalid.pose).toEqual(base.pose);expect(invalid.fit.fitRmsPx).toBe(base.fit.fitRmsPx);expect(invalid.acceptable).toBe(false);expect(invalid.fit.validationRmsPx).toBeGreaterThan(50);
 const wrong=points();wrong[0].mapPoint={...wrong[1].mapPoint!};expect(()=>solveGeographicCalibration(controls.site,1000,600,wrong)).toThrow('같은 지도 지점');
 expect(()=>solveGeographicCalibration(controls.site,1000,600,points().slice(0,3))).toThrow('검증용');
 const narrow=points();narrow.forEach((m,i)=>{m.x=.5+i*.001;m.y=.5+i*.001;});expect(()=>solveGeographicCalibration(controls.site,1000,600,narrow)).toThrow('분산');
 const missing=points();missing[0].mapPoint!.heightM=NaN;expect(()=>solveGeographicCalibration(controls.site,1000,600,missing)).toThrow('표면 좌표');
});
test('heading wrap, portrait images and independent moderate click noise keep a bounded candidate',()=>{
 for(const [headingDeg,pitchDeg,width,height] of [[359,-2,1000,600],[180,4,600,1000]]){
  const site={...controls.site},expected={headingDeg,pitchDeg,horizontalFovDeg:53},landmarks=points();
  if(headingDeg===359)for(const m of landmarks){m.mapPoint!.lat=75-m.mapPoint!.lat;m.mapPoint!.lon=254.2-m.mapPoint!.lon;}
  for(const m of landmarks){const pixel=projectGeographic(geographicVector(site,m.mapPoint!),expected,width/height)!;m.x=pixel.x;m.y=pixel.y;}
  const result=solveGeographicCalibration(site,width,height,landmarks);expect(result.acceptable).toBe(true);expect(result.pose.headingDeg).toBeCloseTo(headingDeg,5);expect(result.pose.horizontalFovDeg).toBeCloseTo(53,5);
 }
 const noisy=points();noisy.forEach((m,i)=>{m.x+=(i%2?1:-1)/1000;m.y+=(i%3-1)/600;});const result=solveGeographicCalibration(controls.site,1000,600,noisy);
 expect(result.acceptable).toBe(true);expect(Math.abs(result.pose.horizontalFovDeg-53)).toBeLessThan(1);
});

async function setup(page:Page){
 await page.route('https://map.vworld.kr/**',r=>r.fulfill({contentType:'application/javascript',body:sdk}));await page.goto('./');await expect(page.getByText(/VWorld 3D 뷰어 초기화 완료 ·/)).toBeVisible();
 const data={schemaVersion:1,crs:'EPSG:4326',positions:[{id:'synthetic-geo',name:'합성 기준 카메라',lat:37.5,lon:127.1,ssmUuid:null,positionSource:'operator',orientation:null},{id:'synthetic-other',name:'다른 합성 카메라',lat:37.51,lon:127.1,ssmUuid:null,positionSource:'operator',orientation:null}]};
 await page.getByLabel('위도·경도 JSON 불러오기',{exact:true}).setInputFiles({name:'synthetic.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});
 const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=1000;c.height=600;c.getContext('2d')!.fillRect(0,0,1000,600);return c.toDataURL('image/png').split(',')[1];});
 await page.getByLabel('참조 CCTV 이미지',{exact:true}).setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});await expect(page.getByRole('img',{name:'보정용 참조 CCTV 화면'})).toBeVisible();
 return page.frames().find(f=>f!==page.mainFrame())!;
}
async function imagePoints(page:Page){
 const reference=page.locator('.reference-image');
 for(const m of controls.landmarks.slice(0,4)){const box=(await reference.boundingBox())!;await reference.click({position:{x:m.x*box.width,y:m.y*box.height}});}
}
test('map point capture, joint solve, explicit application and private export preserve evidence without company requests',async({page},testInfo)=>{
 const requests:string[]=[];page.on('request',r=>{if(r.url().includes('/api/')||r.method()!=='GET')requests.push(r.url());});
 const frame=await setup(page);await imagePoints(page);
 await page.getByLabel('4번 기준점 검증용',{exact:true}).check();
 for(let i=0;i<4;i++){
  await page.getByRole('button',{name:`${i+1}번 기준점 지도에서 지정`,exact:true}).click();await expect.poll(()=>frame.evaluate('ws3d.viewer.scene.canvas.style.cursor')).toBe('crosshair');
  const p=controls.landmarks[i].mapPoint;await frame.evaluate(p=>{(window as any).surface=[p.lon,p.lat,p.heightM];(window as any).clickHandler({position:{x:100,y:200}});},p);
  await expect(page.getByText(`위도 ${p.lat.toFixed(6)} / 경도 ${p.lon.toFixed(6)} / 지도 고도 ${p.heightM.toFixed(1)}m`,{exact:true})).toBeVisible();
 }
 const before=await frame.evaluate('views.length');
 await page.getByRole('button',{name:'기준점으로 방향·화각 계산',exact:true}).click();await expect(page.getByText('검증 기준 통과 후보',{exact:true})).toBeVisible();
 await page.locator('.reference-panel').evaluate(element=>{element.scrollTop=element.scrollHeight;});
 await expect(page.getByRole('button',{name:'계산 후보를 지도에 적용',exact:true})).toBeInViewport();
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await page.screenshot({path:testInfo.outputPath('geographic-candidate-synthetic.png'),fullPage:true});
 expect(await frame.evaluate('views.length')).toBe(before);await expect(page.getByRole('button',{name:'추정 방향을 설정에 반영',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'계산 후보를 지도에 적용',exact:true}).click();await expect(page.getByText(/지도 기준점 계산 후보를 적용했습니다/)).toBeVisible();
 const v=await frame.evaluate('views.at(-1)');expect(v.destination).toEqual([127.1,37.5,703]);expect(v.orientation.heading).toBeCloseTo(Math.PI,2);
 await page.getByLabel('참조 화면 촬영 시각',{exact:true}).fill('2026-10-20T19:32');await page.getByRole('button',{name:'추정 방향을 설정에 반영',exact:true}).click();
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'좌표 설정 다운로드',exact:true}).click();const stream=await (await download).createReadStream();let raw='';for await(const chunk of stream)raw+=chunk.toString();
 const saved=parseConfiguration(raw),o=saved.positions[0].orientation!;
 expect(o.source).toBe('manual-calibration');expect(o.confidence).toBe('unvalidated');expect(o.geographicFit?.validationRmsPx).toBeLessThan(5);expect(o.landmarks.filter(m=>m.mapPoint)).toHaveLength(4);
 expect(raw).not.toContain('data:image');expect(raw).not.toContain('synthetic-pages-key');expect(requests).toEqual([]);
 const changed=JSON.parse(raw);changed.positions[0].orientation.headingDeg+=1;expect(()=>parseConfiguration(JSON.stringify(changed))).toThrow('일치');
 await page.getByRole('button',{name:'4번 기준점 지도에서 지정',exact:true}).click();await expect.poll(()=>frame.evaluate('geoPicking')).not.toBeNull();
 await frame.evaluate('window.surface=[127.101,37.485,800];clickHandler({position:{x:1,y:1}})');
 await expect(page.getByText('위도 37.485000 / 경도 127.101000 / 지도 고도 800.0m',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'기준점으로 방향·화각 계산',exact:true}).click();await expect(page.getByText('후보 적용 불가',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'계산 후보를 지도에 적용',exact:true})).toBeDisabled();
 await frame.evaluate('ws3d.viewer.scene.globe.getHeight=()=>undefined');await page.getByRole('button',{name:'기준점으로 방향·화각 계산',exact:true}).click();await expect(page.getByRole('alert')).toContainText('지도 지형 높이를 아직 읽지 못했습니다');
 await page.getByLabel('가상 설치 높이(m)',{exact:true}).fill('20');await expect(page.getByRole('button',{name:'계산 후보를 지도에 적용',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'추정 방향을 설정에 반영',exact:true})).toBeDisabled();
});
test('sky picks, cancellation, stale messages and camera changes cannot bind the wrong landmark',async({page})=>{
 const frame=await setup(page);await imagePoints(page);
 await page.getByRole('button',{name:'1번 기준점 지도에서 지정',exact:true}).click();await expect.poll(()=>frame.evaluate('ws3d.viewer.scene.canvas.style.cursor')).toBe('crosshair');
 const oldRequest=await frame.evaluate('geoPicking');
 await frame.evaluate('window.surface=null;clickHandler({position:{x:1,y:1}})');await expect(page.getByText(/하늘이나 로딩되지 않은 지점/)).toBeVisible();await expect(page.getByText(/위도 37\.490000/)).toHaveCount(0);
 await page.getByRole('button',{name:'기준점 지정 종료',exact:true}).click();await expect.poll(()=>frame.evaluate('ws3d.viewer.scene.canvas.style.cursor')).toBe('');
 await frame.evaluate(id=>parent.postMessage({scope:'vworld-prototype',session,type:'geo-point-picked',requestId:id,point:{lat:37.49,lon:127.096,heightM:850,source:'map-surface'}},location.origin),oldRequest);
 await expect(page.getByText(/위도 37\.490000/)).toHaveCount(0);
 await page.getByRole('button',{name:'1번 기준점 지도에서 지정',exact:true}).click();await page.getByRole('button',{name:'지도 연결',exact:true}).click();await expect.poll(()=>frame.evaluate('geoPicking')).toBeNull();
 await page.getByRole('button',{name:'카메라·설정',exact:true}).click();await page.getByRole('button',{name:'1번 기준점 지도에서 지정',exact:true}).click();await expect.poll(()=>frame.evaluate('geoPicking')).not.toBeNull();
 await page.getByRole('button',{name:/^다른 합성 카메라/}).click();await expect(page.getByText('위도 37.51 / 경도 127.1')).toBeVisible();await expect.poll(()=>frame.evaluate('geoPicking')).toBeNull();
 await expect(page.getByLabel('1번 기준점 이름',{exact:true})).toHaveCount(0);
});
test('reference enlargement records the same normalized pixels and remains within the viewport',async({page})=>{
 await setup(page);await page.getByRole('button',{name:'참조 영상 크게 보기',exact:true}).click();
 const dialog=page.locator('dialog');await expect(dialog).toBeVisible();const image=dialog.locator('.reference-image'),box=(await image.boundingBox())!;
 await image.click({position:{x:box.width*.25,y:box.height*.4}});await page.getByRole('button',{name:'확대 화면 닫기',exact:true}).click();
 await expect(page.getByLabel('1번 기준점 이름',{exact:true})).toBeVisible();expect(await page.locator('.reference-point').count()).toBe(1);
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'참조 영상 크게 보기',exact:true}).click();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
