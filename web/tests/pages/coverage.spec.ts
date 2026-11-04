import {test,expect,type Page} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {parseMapBundle} from '../../src/map-layers';
import {buildCoverageShapes,calibrationToken,parseCoverage,serializeCoverage,type CoveragePlan} from '../../src/coverage-model';
import type {ManualOrientation} from '../../src/calibration-model';
import {sdk} from '../fixtures/vworld-sdk';
const map=parseMapBundle(readFileSync('src/data/bukhansan-map.json','utf8'));
const plans:CoveragePlan[]=map.positions.map((p,i)=>({cameraId:p.id,positionAtPlan:{lat:p.lat,lon:p.lon},source:'manual-preview',calibrationToken:null,headingDeg:i*40,horizontalFovDeg:30,displayRangeM:1500,enabled:true,updatedAt:'2026-10-13T00:00:00Z'}));
const file=(p:CoveragePlan[])=>({name:'synthetic-coverage.json',mimeType:'application/json',buffer:Buffer.from(serializeCoverage(p))});
async function setup(page:Page){await page.route('https://map.vworld.kr/**',r=>r.fulfill({contentType:'application/javascript',body:sdk}));await page.goto('./');await expect(page.getByText(/VWorld 3D 뷰어 초기화 완료 ·/)).toBeVisible();await page.getByRole('button',{name:'관측 범위',exact:true}).click();return page.frames().find(f=>f!==page.mainFrame())!;}
const count='activeEntities.filter(e=>e.polygon&&e.name?.includes("범위 시안")).length';

test('unknown directions stay unset; operator preview updates geometry without changing current-direction state',async({page})=>{
 const requests:string[]=[];page.on('request',r=>requests.push(r.method()+' '+r.url()));
 const frame=await setup(page);await expect(page.locator('.coverage-row')).toHaveCount(9);await expect(page.getByText('범위 미설정',{exact:true})).toHaveCount(9);
 expect(await frame.evaluate(count)).toBe(0);await expect(page.getByLabel('범위 방위각(°)',{exact:true})).toHaveValue('');await expect(page.getByRole('button',{name:'입력값으로 범위 시안 표시'})).toBeDisabled();
 await page.getByLabel('범위 방위각(°)',{exact:true}).fill('90');await page.getByRole('button',{name:'입력값으로 범위 시안 표시'}).click();await expect.poll(()=>frame.evaluate(count)).toBe(1);
 await expect(page.getByText(/범위 시안 1대 · 실제 촬영 범위·지형 가림 미확인/)).toBeVisible();await expect(page.getByText(/현재 방향 미확인/).last()).toBeVisible();
 const before=await frame.evaluate('activeEntities.filter(e=>e.polygon&&e.name?.includes("범위 시안"))[0].polygon.hierarchy');
 await page.getByLabel('범위 방위각 조절',{exact:true}).evaluate(e=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(e,'180');e.dispatchEvent(new Event('input',{bubbles:true}));});
 await expect.poll(()=>frame.evaluate('activeEntities.filter(e=>e.polygon&&e.name?.includes("범위 시안"))[0].polygon.hierarchy')).not.toEqual(before);
 await page.getByLabel('범위 방위각(°)',{exact:true}).fill('360');await page.getByRole('button',{name:'입력값으로 범위 시안 표시'}).click();await expect(page.getByRole('alert')).toContainText('확인하세요');expect(await frame.evaluate(count)).toBe(1);
 expect(await page.evaluate(()=>localStorage.length)).toBe(0);expect(requests.filter(r=>r.includes('/api/')||r.startsWith('POST ')||r.startsWith('PUT '))).toEqual([]);
});

test('nine simultaneous previews retain layers/markers, select by polygon, filter and explicitly persist',async({page})=>{
 const frame=await setup(page);await page.getByLabel('범위 시안 JSON 불러오기').setInputFiles(file(plans));await expect.poll(()=>frame.evaluate(count)).toBe(9);
 expect(await frame.evaluate('activeEntities.filter(e=>e.point).length')).toBe(9);expect(await frame.evaluate('sources.length')).toBe(2);
 expect(await page.evaluate(()=>localStorage.length)).toBe(0);
 await frame.evaluate('window.picked=activeEntities.find(e=>e.name==="백운대 · 범위 시안");clickHandler({position:{x:1,y:1}})');await expect(page.locator('.coverage-editor h3')).toContainText('백운대');await expect.poll(()=>frame.evaluate(count)).toBe(9);
 await page.getByLabel('선택한 카메라 범위만 보기').check();await expect.poll(()=>frame.evaluate(count)).toBe(1);await page.getByLabel('선택한 카메라 범위만 보기').uncheck();await expect.poll(()=>frame.evaluate(count)).toBe(9);
 await page.getByLabel('숨은벽 범위 표시',{exact:true}).uncheck();await expect.poll(()=>frame.evaluate(count)).toBe(8);await page.getByLabel('숨은벽 범위 표시',{exact:true}).check();
 await page.getByLabel('범위 시안 전체 표시').uncheck();await expect.poll(()=>frame.evaluate(count)).toBe(0);await page.getByLabel('범위 시안 전체 표시').check();await expect.poll(()=>frame.evaluate(count)).toBe(9);
 await page.getByRole('button',{name:'가상 시점 적용',exact:true}).click();await expect.poll(()=>frame.evaluate(count)).toBe(0);await expect(page.getByText('가상 시점 보정 중 범위 시안 숨김',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'일반 지도 보기',exact:true}).click();await expect.poll(()=>frame.evaluate(count)).toBe(9);expect(await frame.evaluate('sources.length')).toBe(2);
 await page.getByText('범위 시안 보관',{exact:true}).click();await page.getByRole('button',{name:'이 브라우저에 범위 시안 저장'}).click();await expect(page.getByText(/범위 시안 저장 완료/)).toBeVisible();
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'범위 시안 다운로드'}).click();const stream=await (await download).createReadStream();let text='';for await(const b of stream!)text+=b.toString();expect(parseCoverage(text)).toEqual(plans);expect(text).not.toContain('synthetic-pages-key');
 await page.reload();await expect(page.getByText(/VWorld 3D 뷰어 초기화 완료 ·/)).toBeVisible();const restored=page.frames().find(f=>f!==page.mainFrame())!;await expect.poll(()=>restored.evaluate(count)).toBe(9);
 await page.getByRole('button',{name:'관측 범위',exact:true}).click();await page.getByText('범위 시안 보관',{exact:true}).click();await page.getByRole('button',{name:'저장된 범위 시안 지우기'}).click();await expect.poll(()=>restored.evaluate(count)).toBe(0);expect(await page.evaluate(()=>localStorage.length)).toBe(0);
});

test('position changes and calibration invalidation suppress affected previews; malformed import is atomic',async({page})=>{
 const frame=await setup(page);await page.getByLabel('범위 시안 JSON 불러오기').setInputFiles(file(plans));await expect.poll(()=>frame.evaluate(count)).toBe(9);
 const invalid=structuredClone(plans);invalid[0].displayRangeM=Infinity;await page.getByLabel('범위 시안 JSON 불러오기').setInputFiles(file(invalid));await expect(page.getByRole('alert')).toContainText('확인하세요');expect(await frame.evaluate(count)).toBe(9);
 const changed=structuredClone(map);changed.positions[0].lat+=.001;
 await page.getByRole('button',{name:'지도 레이어',exact:true}).click();await page.getByLabel('지도자료 JSON 불러오기').setInputFiles({name:'changed.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(changed))});await expect.poll(()=>frame.evaluate(count)).toBe(8);
 await page.getByRole('button',{name:'관측 범위',exact:true}).click();await expect(page.getByText('설치 위치 변경 · 재설정 필요',{exact:true})).toBeVisible();
 const p=map.positions[0];const o:ManualOrientation={source:'manual-calibration',status:'estimate',confidence:'unvalidated',headingDeg:80,pitchDeg:-5,horizontalFovDeg:45,cameraHeightM:5,groundElevationM:700,groundElevationSource:'operator',positionAtCalibration:{lat:p.lat,lon:p.lon},calibratedAt:'2026-10-13T00:00:00Z',reference:{sha256:'a'.repeat(64),capturedAt:'2026-10-12T00:00:00Z',width:320,height:180},landmarks:[{label:'합성 기준 A',x:.2,y:.2},{label:'합성 기준 B',x:.8,y:.3}]};
 const calibrated=structuredClone(map);calibrated.positions[0].orientation=o;
 await page.getByRole('button',{name:'지도 레이어',exact:true}).click();await page.getByLabel('지도자료 JSON 불러오기').setInputFiles({name:'calibrated.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(calibrated))});await page.getByRole('button',{name:'관측 범위',exact:true}).click();
 await page.getByRole('button',{name:'저장된 보정값으로 범위 표시'}).click();await expect.poll(()=>frame.evaluate(count)).toBe(9);await expect(page.getByText('기준 영상·지형 추정',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'화면 방향·줌 변경으로 보정 무효화'}).click();await expect.poll(()=>frame.evaluate(count)).toBe(8);await expect(page.getByText('보정 변경·무효 · 재설정 필요',{exact:true})).toBeVisible();
});

test('coverage editor remains within the mobile viewport and geometry failures do not disable the map',async({page})=>{
 const frame=await setup(page);await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await frame.evaluate('Cesium.Color.fromCssColorString=()=>{throw new Error("synthetic render failure")}');await page.getByLabel('범위 시안 JSON 불러오기').setInputFiles(file(plans));await expect(page.getByRole('alert')).toContainText('범위 시안을 지도에 표시하지 못했습니다');
 await expect(page.getByText(/VWorld 3D 뷰어 초기화 완료 ·/)).toBeVisible();expect(await frame.evaluate(count)).toBe(0);expect(await frame.evaluate('activeEntities.filter(e=>e.point).length')).toBe(9);
});

test('saved coverage is unvalidated, uses physical radius and rejects mismatched evidence and malformed values',()=>{
 const p=map.positions[0],plan=plans[0],shape=buildCoverageShapes([p],[plan])[0];
 const rad=Math.PI/180,[lon,lat]=shape.centerline[1],dlat=(lat-p.lat)*rad,dlon=(lon-p.lon)*rad;
 const a=Math.sin(dlat/2)**2+Math.cos(p.lat*rad)*Math.cos(lat*rad)*Math.sin(dlon/2)**2;
 expect(2*6371008.8*Math.atan2(Math.sqrt(a),Math.sqrt(1-a))).toBeCloseTo(1500,4);
 expect(buildCoverageShapes([{...p,lat:p.lat+.001}],[plan])).toHaveLength(0);
 expect(buildCoverageShapes([p],[{...plan,source:'manual-calibration',calibrationToken:'no matching evidence'}])).toHaveLength(0);expect(calibrationToken(p)).toBeNull();
 for(const invalid of [[plan,plan],[{...plan,headingDeg:360}],[{...plan,horizontalFovDeg:0}],[{...plan,displayRangeM:0}],[{...plan,source:'live-ptz'}],[{...plan,apiKey:'not-allowed'}]])expect(()=>parseCoverage(serializeCoverage(invalid as CoveragePlan[]))).toThrow(/확인하세요/);
});
