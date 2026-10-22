import {test,expect,type Page} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {parseMapBundle} from '../../src/map-layers';
import {serializeCoverage,type CoveragePlan} from '../../src/coverage-model';
import {createVisibilityGrid,calculateVisibility,visibilityKey} from '../../src/terrain-visibility-model';
import {sdk} from '../fixtures/vworld-sdk';

const map=parseMapBundle(readFileSync('src/data/bukhansan-map.json','utf8')),position=map.positions[0];
const plan:CoveragePlan={cameraId:position.id,positionAtPlan:{lat:position.lat,lon:position.lon},headingDeg:0,horizontalFovDeg:60,displayRangeM:500,enabled:true,source:'manual-preview',calibrationToken:null,updatedAt:'2026-10-13T00:00:00Z'};
const grid=createVisibilityGrid(position,plan,100);
const profile=(samples:(number|null)[])=>[700,...Array.from({length:grid.bearings.length},()=>samples).flat()];
const visibilityEntities='activeEntities.filter(e=>e.name?.includes("지형 가림"))';
async function setup(page:Page){
 await page.route('https://map.vworld.kr/**',r=>r.fulfill({contentType:'application/javascript',body:sdk}));await page.goto('./');await expect(page.getByText(/VWorld 3D 뷰어 초기화 완료 ·/)).toBeVisible();
 const frame=page.frames().find(f=>f!==page.mainFrame())!;await expect.poll(()=>frame.evaluate('sources.length')).toBe(2);
 await page.getByRole('button',{name:'관측 범위',exact:true}).click();await page.getByLabel('범위 시안 JSON 불러오기').setInputFiles({name:'synthetic-coverage.json',mimeType:'application/json',buffer:Buffer.from(serializeCoverage([plan]))});
 await expect.poll(()=>frame.evaluate('activeEntities.filter(e=>e.name?.includes("범위 시안")).length')).toBe(1);
 await expect(page.getByLabel('지형 가림 시험 렌즈 높이(m)')).toHaveValue('3');await page.getByLabel('지형 가림 시험 렌즈 높이(m)').fill('5');return frame;
}
async function calculate(page:Page){await page.getByRole('button',{name:'선택 카메라 지형 가림 계산',exact:true}).click();}

test('sampled ridge blocks a valley and a higher distant peak can reappear; taller lens reduces blockage',()=>{
 const heights=profile([730,700,700,850,920]),r=calculateVisibility(grid,heights,5,'scene-most-detailed');
 expect(r.counts).toEqual({visible:48,blocked:24,unknown:48});expect(r.polygons.filter(p=>p.state==='blocked')).toHaveLength(24);
 const raised=calculateVisibility(grid,heights,100,'scene-most-detailed');expect(raised.counts).toEqual({visible:120,blocked:0,unknown:0});expect(raised.polygons).toHaveLength(24);
 expect(r.confidence).toBe('unvalidated');expect(r.key).not.toBe(visibilityKey({...position,lat:position.lat+.001},plan));expect(r.key).not.toBe(visibilityKey(position,{...plan,headingDeg:90}));
 const area=Object.values(r.areaM2).reduce((a,b)=>a+b,0);expect(area).toBeCloseTo(6371008.8**2*(Math.PI/3)*(1-Math.cos(500/6371008.8)),3);
});

test('missing terrain never becomes visible, known blockers remain valid and observer/response validation is strict',()=>{
 const r=calculateVisibility(grid,profile([null,700,730,700,700]),5,'scene-most-detailed');expect(r.counts).toEqual({visible:0,blocked:24,unknown:96});
 expect(()=>calculateVisibility(grid,[null,...profile([700,700,700,700,700]).slice(1)],5,'scene-most-detailed')).toThrow(/설치 지점/);
 for(const h of [0,Infinity,NaN,101])expect(()=>calculateVisibility(grid,profile([700,700,700,700,700]),h,'scene-most-detailed')).toThrow(/렌즈 높이/);
 expect(()=>calculateVisibility(grid,[700],5,'scene-most-detailed')).toThrow(/응답/);expect(()=>createVisibilityGrid(position,{...plan,displayRangeM:5001},100)).toThrow(/5,000/);
 expect(()=>createVisibilityGrid({...position,lat:position.lat+.01},plan,100)).toThrow(/현재 위치/);
});

test('curved Earth produces the geometric horizon while legitimate zero-elevation provider samples are accepted',()=>{
 const long=createVisibilityGrid(position,{...plan,displayRangeM:5000},100),r=calculateVisibility(long,Array(long.points.length).fill(0),.5,'terrain-provider');
 expect(r.groundElevationM).toBe(0);expect(r.counts.visible).toBeGreaterThan(0);expect(r.counts.blocked).toBeGreaterThan(0);
 expect(createVisibilityGrid(position,{...plan,displayRangeM:5000},50).points.length).toBeLessThanOrEqual(3001);
});

test('map uses excluded terrain samples, draws visible/blocked/unknown bands, and invalidates changes without persistence',async({page})=>{
 const frame=await setup(page);
 await frame.evaluate(({lon,lat})=>{(window as any).terrainHeight=(p:number[])=>{const rad=Math.PI/180,dlat=(p[1]-lat)*rad,dlon=(p[0]-lon)*rad,a=Math.sin(dlat/2)**2+Math.cos(lat*rad)*Math.cos(p[1]*rad)*Math.sin(dlon/2)**2,d=2*6371008.8*Math.asin(Math.sqrt(a));return d>75&&d<125?730:d>350&&d<450?850:d>450?920:700;};},{lon:position.lon,lat:position.lat});
 await calculate(page);await expect(page.locator('.visibility-summary')).toContainText('지도 기준 지면 높이 약 700m');
 await expect.poll(()=>frame.evaluate(visibilityEntities+'.length')).toBe(120);expect(await frame.evaluate(visibilityEntities+'.map(e=>e.polygon.material.css).filter((v,i,a)=>a.indexOf(v)===i).sort()')).toEqual(['#52d38a','#f47b78','#f5cc57'].sort());
 expect(await frame.evaluate('terrainCalls.every(c=>c.points.length<=64&&c.excludedCount>=14)')).toBe(true);expect(await frame.evaluate('activeEntities.filter(e=>e.name?.includes("범위 시안")).length')).toBe(0);
 expect(await frame.evaluate('activeEntities.filter(e=>e.point).length')).toBe(9);expect(await frame.evaluate('sources.length')).toBe(2);
 await page.getByLabel('범위 시안 전체 표시').uncheck();await expect.poll(()=>frame.evaluate(visibilityEntities+'.length')).toBe(0);await page.getByLabel('범위 시안 전체 표시').check();await expect.poll(()=>frame.evaluate(visibilityEntities+'.length')).toBe(120);
 await page.getByLabel('지형 가림 시험 렌즈 높이(m)').fill('10');await expect(page.locator('.visibility-summary')).toHaveCount(0);await expect.poll(()=>frame.evaluate(visibilityEntities+'.length')).toBe(0);await expect.poll(()=>frame.evaluate('activeEntities.filter(e=>e.name?.includes("범위 시안")).length')).toBe(1);
 await calculate(page);await expect(page.locator('.visibility-summary')).toBeVisible();await page.getByLabel('범위 방위각(°)').fill('90');await page.getByRole('button',{name:'입력값으로 범위 시안 표시',exact:true}).click();await expect(page.locator('.visibility-summary')).toHaveCount(0);await expect.poll(()=>frame.evaluate(visibilityEntities+'.length')).toBe(0);
 expect(await page.evaluate(()=>({local:localStorage.length,session:sessionStorage.length}))).toEqual({local:0,session:0});
});

test('unavailable observer data and SDK errors preserve the basic range and an overlay mutation discards the old batch',async({page})=>{
 const frame=await setup(page);await frame.evaluate('window.terrainHeight=()=>null');await calculate(page);await expect(page.getByRole('alert')).toContainText('설치 지점');expect(await frame.evaluate(visibilityEntities+'.length')).toBe(0);
 await frame.evaluate('window.terrainHeight=null;window.failTerrain=true');await calculate(page);await expect(page.getByRole('alert')).toContainText('높이를 조회하지 못했습니다');
 await frame.evaluate('window.failTerrain=false;window.holdTerrain=true');await calculate(page);await expect.poll(()=>frame.evaluate('pendingTerrain.length')).toBe(1);
 await frame.evaluate('showLocation({lon:126.95,lat:37.65,heightM:700});window.holdTerrain=false;pendingTerrain[0].resolve(pendingTerrain[0].points.map(p=>[p[0],p[1],2000]))');
 await expect(page.locator('.visibility-summary')).toContainText('지도 기준 지면 높이 약 700m');expect(await frame.evaluate('terrainCalls.at(-1).excludedNames.includes("선택 지점")')).toBe(true);
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('cancellation and a plan change cannot apply a late result; timeout stops further sampling',async({page})=>{
 const frame=await setup(page);await frame.evaluate('window.holdTerrain=true');await calculate(page);await expect.poll(()=>frame.evaluate('pendingTerrain.length')).toBe(1);await page.getByRole('button',{name:'지형 가림 계산 중지',exact:true}).click();
 await frame.evaluate('window.holdTerrain=false;pendingTerrain[0].resolve(pendingTerrain[0].result())');await expect(page.locator('.visibility-summary')).toHaveCount(0);
 await frame.evaluate('window.holdTerrain=true');await calculate(page);await expect.poll(()=>frame.evaluate('pendingTerrain.length')).toBe(2);await page.getByLabel('범위 방위각(°)').fill('45');await page.getByRole('button',{name:'입력값으로 범위 시안 표시',exact:true}).click();
 await expect(page.getByRole('button',{name:'지형 가림 계산 중지'})).toHaveCount(0);await frame.evaluate('window.holdTerrain=false;pendingTerrain[1].resolve(pendingTerrain[1].result())');await expect(page.locator('.visibility-summary')).toHaveCount(0);
 await page.clock.install();await frame.evaluate('window.holdTerrain=true');await calculate(page);await expect.poll(()=>frame.evaluate('pendingTerrain.length')).toBe(3);await page.clock.fastForward(90001);await expect(page.getByRole('alert')).toContainText('시간 초과');
});

test('per-camera results coexist, follow visibility filters and invalidate when installation coordinates change',async({page})=>{
 const frame=await setup(page),second=map.positions[1],secondPlan:CoveragePlan={...plan,cameraId:second.id,positionAtPlan:{lat:second.lat,lon:second.lon}};
 await page.getByLabel('범위 시안 JSON 불러오기').setInputFiles({name:'two-cameras.json',mimeType:'application/json',buffer:Buffer.from(serializeCoverage([plan,secondPlan]))});
 await expect.poll(()=>frame.evaluate('activeEntities.filter(e=>e.name?.includes("범위 시안")).length')).toBe(2);await calculate(page);await expect.poll(()=>frame.evaluate(visibilityEntities+'.length')).toBe(24);
 await page.locator('.coverage-list').getByRole('button',{name:new RegExp(second.name)}).click();await expect(page.getByLabel('지형 가림 시험 렌즈 높이(m)')).toHaveValue('3');await calculate(page);await expect.poll(()=>frame.evaluate(visibilityEntities+'.length')).toBe(48);
 await frame.evaluate('window.picked=activeEntities.find(e=>e.name?.includes("bukhansan-camera-1 · 지형 가림"));clickHandler({position:{x:1,y:1}})');await expect(page.getByLabel('지형 가림 시험 렌즈 높이(m)')).toHaveValue('5');
 await page.locator('.coverage-list').getByRole('button',{name:new RegExp(second.name)}).click();await expect(page.getByLabel('지형 가림 시험 렌즈 높이(m)')).toHaveValue('3');
 await page.getByLabel('선택한 카메라 범위만 보기').check();await expect.poll(()=>frame.evaluate(visibilityEntities+'.length')).toBe(24);await page.getByLabel('선택한 카메라 범위만 보기').uncheck();await expect.poll(()=>frame.evaluate(visibilityEntities+'.length')).toBe(48);
 await page.getByRole('button',{name:'가상 시점 적용',exact:true}).click();await expect.poll(()=>frame.evaluate(visibilityEntities+'.length')).toBe(0);await page.getByRole('button',{name:'일반 지도 보기',exact:true}).click();await expect.poll(()=>frame.evaluate(visibilityEntities+'.length')).toBe(48);
 const moved=structuredClone(map);moved.positions[0].lat+=.001;await page.getByRole('button',{name:'지도 레이어',exact:true}).click();await page.getByLabel('지도자료 JSON 불러오기').setInputFiles({name:'moved-camera.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(moved))});
 await expect.poll(()=>frame.evaluate(visibilityEntities+'.length')).toBe(24);await page.getByRole('button',{name:'관측 범위',exact:true}).click();await expect(page.locator('.visibility-summary')).toHaveCount(0);
});

test('terrain provider heights and rendered-scene fallback retain their distinct sources',async({page})=>{
 const frame=await setup(page);
 await frame.evaluate('Cesium.EllipsoidTerrainProvider=function(){};ws3d.viewer.terrainProvider={availability:{}};Cesium.sampleTerrainMostDetailed=(provider,positions)=>Promise.resolve(positions.map(()=>({height:0})))');
 await calculate(page);await expect(page.locator('.visibility-summary')).toContainText('지도 지형 공급자');await expect(page.locator('.visibility-summary')).toContainText('높이 약 0m');expect(await frame.evaluate('terrainCalls.length')).toBe(0);
 await page.getByRole('button',{name:'선택 카메라 가림 계산 지우기',exact:true}).click();await frame.evaluate('ws3d.viewer.terrainProvider=undefined;delete ws3d.viewer.scene.clampToHeightMostDetailed;ws3d.viewer.scene.clampToHeight=p=>[p[0],p[1],700]');
 await calculate(page);await expect(page.locator('.visibility-summary')).toContainText('화면에 로딩된 지도 표면');await expect(page.locator('.visibility-summary')).toContainText('높이 약 700m');
});
