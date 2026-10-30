import {test,expect,type Page} from '@playwright/test';
import {parseDiagnosticReview} from '../../src/diagnostic-review';
import type {Position} from '../../src/map-model';
import controls from '../fixtures/geographic-controls.json';
import {sdk} from '../fixtures/vworld-sdk';

const camera:Position={id:'synthetic-diagnostic',name:'합성 진단 카메라',lat:37.5,lon:127.1,positionSource:'operator',ssmUuid:null,orientation:null};
const second={...camera,id:'other-diagnostic',name:'다른 합성 카메라',lat:37.51};
const diagnostic=()=>({schemaVersion:1,kind:'geographic-calibration-diagnostics',camera:{id:camera.id,name:camera.name,lat:camera.lat,lon:camera.lon,cameraHeightM:3},reference:{sha256:'a'.repeat(64),width:1000,height:600},landmarks:structuredClone(controls.landmarks).slice(0,4)});
test('review parser requires matching camera, valid geography and original ordinal numbers; failed calibration results are not imported',()=>{
 const d=diagnostic();d.landmarks[3].useForValidation=true;
 const review=parseDiagnosticReview(JSON.stringify({...d,status:'rejected',result:{acceptable:false},note:'untrusted text is ignored'}),camera);
 expect(review.points.map(p=>p.number)).toEqual([1,2,3,4]);expect(review.points[3].validation).toBe(true);expect(Object.keys(review)).toEqual(['camera','reference','points']);
 expect(()=>parseDiagnosticReview(JSON.stringify(d),second)).toThrow('현재 선택한 카메라');
 expect(()=>parseDiagnosticReview(JSON.stringify({...d,kind:'camera-ptz-reference'}),camera)).toThrow('종류');
 const bad=diagnostic();bad.landmarks[0].mapPoint.heightM=NaN;expect(()=>parseDiagnosticReview(JSON.stringify(bad),camera)).toThrow('지도 좌표');
 expect(()=>parseDiagnosticReview(' '.repeat(256*1024+1),camera)).toThrow('256KB');
 const missing=diagnostic() as any;delete missing.landmarks[1].mapPoint;
 expect(parseDiagnosticReview(JSON.stringify(missing),camera).points.map(p=>p.number)).toEqual([1,3,4]);
});
async function setup(page:Page){
 await page.route('https://map.vworld.kr/**',r=>r.fulfill({contentType:'application/javascript',body:sdk}));await page.goto('./');
 await expect(page.getByText(/VWorld 3D 뷰어 초기화 완료/)).toBeVisible();
 await page.getByLabel('위도·경도 JSON 불러오기',{exact:true}).setInputFiles({name:'synthetic-map.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({schemaVersion:1,crs:'EPSG:4326',positions:[camera,second]}))});
 await page.getByText('기존 진단 기준점 확인',{exact:true}).click();
 return page.frames().find(f=>f!==page.mainFrame())!;
}
async function upload(page:Page,d=diagnostic()){
 await page.getByLabel('보정 진단 JSON 불러오기',{exact:true}).setInputFiles({name:'synthetic-diagnostics.private.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(d))});
}
test('private diagnostic import draws numbered controls, fits their bounds and excludes them from saved map configuration',async({page})=>{
 const requests:string[]=[];
 const frame=await setup(page);page.on('request',r=>{if(r.method()!=='GET')requests.push(r.url());});
 const d=diagnostic();d.landmarks[3].useForValidation=true;await upload(page,d);
 const controls=()=>frame.evaluate('activeEntities.filter(e=>e.properties?.diagnosticControl).map(e=>({name:e.name,number:e.properties.number,text:e.label.text,color:e.point.color.css,position:e.position}))');
 await expect.poll(async()=>(await controls()).length).toBe(4);
 const markers=await controls();expect(markers.map((p:any)=>p.number)).toEqual([1,2,3,4]);expect(markers[3].color).toBe('#bc8aff');expect(markers[0].color).toBe('#ee984b');
 expect(markers[0].position).toEqual([d.landmarks[0].mapPoint.lon,d.landmarks[0].mapPoint.lat,d.landmarks[0].mapPoint.heightM+2]);
 await page.getByRole('button',{name:'기준점 전체 보기',exact:true}).click();
 await expect.poll(()=>frame.evaluate('flies.at(-1)?.destination?.bounds')).toEqual(expect.any(Array));
 const bounds=await frame.evaluate('flies.at(-1).destination.bounds');expect(bounds[0]).toBeLessThan(127.096);expect(bounds[1]).toBeLessThan(37.485);expect(bounds[3]).toBeGreaterThan(camera.lat);
 expect(await frame.evaluate('flies.at(-1).orientation')).toEqual({heading:0,pitch:-Math.PI/2,roll:0});
 const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'좌표 설정 다운로드',exact:true}).click();
 const file=await downloaded,stream=await file.createReadStream();let text='';for await(const b of stream!)text+=b.toString();
 expect(JSON.parse(text)).toEqual({schemaVersion:1,crs:'EPSG:4326',positions:[camera,second]});expect(requests).toEqual([]);
 await page.getByRole('button',{name:'지도 레이어',exact:true}).click();await expect.poll(async()=>(await controls()).length).toBe(0);
 await page.getByRole('button',{name:'카메라·설정',exact:true}).click();await expect.poll(async()=>(await controls()).length).toBe(4);
 await page.getByRole('button',{name:/다른 합성 카메라/}).click();await expect.poll(async()=>(await controls()).length).toBe(0);
});
test('invalid files retain the previous review and diagnostic overlays are hidden during subsequent depth picking',async({page})=>{
 const frame=await setup(page);await upload(page);
 await expect.poll(()=>frame.evaluate('activeEntities.filter(e=>e.properties?.diagnosticControl).length')).toBe(4);
 await upload(page,{...diagnostic(),camera:{...diagnostic().camera,lat:38}});
 await expect(page.getByRole('alert')).toContainText('현재 선택한 카메라');
 await expect.poll(()=>frame.evaluate('activeEntities.filter(e=>e.properties?.diagnosticControl).length')).toBe(4);
 const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=1000;c.height=600;c.getContext('2d')!.fillRect(0,0,1000,600);return c.toDataURL('image/png').split(',')[1];});
 await page.getByLabel('참조 CCTV 이미지',{exact:true}).setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
 const image=page.locator('.reference-image');await expect(image).toBeVisible();const box=(await image.boundingBox())!;await image.click({position:{x:box.width*.3,y:box.height*.4}});
 await page.getByRole('button',{name:'1번 기준점 지도에서 지정',exact:true}).click();
 await expect.poll(()=>frame.evaluate('ws3d.viewer.scene.canvas.style.cursor')).toBe('crosshair');
 await frame.evaluate(()=>{(window as any).surface=[127.1,37.49,720];(window as any).clickHandler({position:{x:100,y:200}});});
 expect(await frame.evaluate('renderedShows.at(-1).every(v=>v===false)')).toBe(true);
 await expect.poll(()=>frame.evaluate('activeEntities.filter(e=>e.properties?.diagnosticControl).length')).toBe(4);
});
test('diagnostic reference dimensions control layout and projection without an image; loaded originals take precedence',async({page})=>{
 const frame=await setup(page);await upload(page);
 const panel=page.locator('.map-panel');
 await expect(panel).toHaveAttribute('data-reference','true');
 let box=(await panel.boundingBox())!;expect(box.width/box.height).toBeCloseTo(1000/600,2);
 await page.getByRole('button',{name:'가상 시점 적용',exact:true}).click();
 await expect.poll(()=>frame.evaluate('ws3d.viewer.camera.frustum.aspectRatio')).toBeCloseTo(1000/600);
 await page.getByRole('button',{name:'진단 기준점 숨기기',exact:true}).click();
 await expect(panel).not.toHaveAttribute('data-reference');
 await expect.poll(()=>frame.evaluate('ws3d.viewer.scene.screenSpaceCameraController.enableInputs')).toBe(true);
 const portrait=diagnostic();portrait.reference.width=600;portrait.reference.height=1000;await upload(page,portrait);
 await page.getByRole('button',{name:'가상 시점 적용',exact:true}).click();
 await expect.poll(()=>frame.evaluate('ws3d.viewer.camera.frustum.aspectRatio')).toBeCloseTo(.6);
 expect(await frame.evaluate('ws3d.viewer.camera.frustum.fov')).toBeCloseTo(2*Math.atan(Math.tan(Math.PI/6)/.6));
 const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=1200;c.height=600;return c.toDataURL('image/png').split(',')[1];});
 await page.getByLabel('참조 CCTV 이미지',{exact:true}).setInputFiles({name:'synthetic-wide.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
 await expect(page.locator('.reference-image')).toBeVisible();
 box=(await panel.boundingBox())!;expect(box.width/box.height).toBeCloseTo(2,2);
 await page.getByRole('button',{name:'가상 시점 적용',exact:true}).click();
 await expect.poll(()=>frame.evaluate('ws3d.viewer.camera.frustum.aspectRatio')).toBe(2);
 await page.getByRole('button',{name:'진단 기준점 숨기기',exact:true}).click();
 await expect(panel).toHaveAttribute('data-reference','true');
 expect(await frame.evaluate('ws3d.viewer.scene.screenSpaceCameraController.enableInputs')).toBe(false);
 expect(await frame.evaluate('ws3d.viewer.camera.frustum.aspectRatio')).toBe(2);
});
