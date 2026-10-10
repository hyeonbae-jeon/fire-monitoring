import { test, expect } from '@playwright/test';
import { sample, destination } from '../src/map-model';

test('positions load offline, selection works and export excludes key/simulation', async ({page}) => {
  const external:string[]=[];
  page.on('request', r=>{if(!r.url().startsWith('http://127.0.0.1:5081/'))external.push(r.url());});
  await page.goto('/'); await page.getByRole('button',{name:'지도 모니터링',exact:true}).click();
  await expect(page.getByRole('img',{name:'북한산 시험 카메라 좌표 배치도'})).toBeVisible();
  await page.getByRole('button',{name:/북한산 시험 B/}).click();
  await expect(page.getByText('위도 37.645 / 경도 126.965')).toBeVisible();
  await page.getByLabel('시험 방향 부채꼴 표시').check();
  await expect(page.locator('svg polygon')).toBeVisible();
  await page.getByLabel('VWorld 3D 키').fill('synthetic-test-key');
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'좌표 설정 다운로드'}).click();
  const file=await download;const stream=await file.createReadStream();let text='';for await(const b of stream!)text+=b.toString();
  expect(JSON.parse(text)).toEqual(sample);expect(text).not.toContain('synthetic-test-key');expect(text).not.toContain('heading');
  expect(external).toEqual([]);
});
test('invalid coordinates and duplicate IDs rejected atomically; valid input replaces samples', async ({page}) => {
 await page.goto('/');await page.getByRole('button',{name:'지도 모니터링',exact:true}).click();
 const input=page.getByLabel('위도·경도 JSON 불러오기');
 for(const positions of [[{...sample.positions[0],lat:91}],[sample.positions[0],sample.positions[0]],[{...sample.positions[0],orientation:{heading:0}}]]){
 await input.setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({...sample,positions}))});
 await expect(page.getByRole('alert')).toContainText('확인하세요');await expect(page.getByRole('button',{name:/북한산 시험 C/})).toBeVisible();
 }
 await input.setInputFiles({name:'positions.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({...sample,positions:[{...sample.positions[0],name:'입력 위치',positionSource:'operator'}]}))});
 await expect(page.getByRole('button',{name:/입력 위치/})).toBeVisible();await expect(page.getByRole('button',{name:/북한산 시험 C/})).toHaveCount(0);
});
test('SDK iframe handles parser-loaded dependencies and forwards marker/sector updates (mock, not live VWorld)',async({page})=>{
 await page.route('https://map.vworld.kr/**',route=>route.fulfill({contentType:'application/javascript',body:`
 document.write('<script src="https://map.vworld.kr/test-dependency.js"><'+'/script>');
 window.vw={CameraPosition:function(){},CoordZ:function(){},Direction:function(){},Map:function(){this.setOption=function(){};this.start=function(){setTimeout(()=>vw.ws3dInitCallBack(),0)}}};
 window.calls=[]; window.ws3d={viewer:{entities:{add:e=>{calls.push(e);return e},remove:()=>{}},scene:{clampToHeight:()=>null},camera:{flyTo:()=>{}}}};
 window.Cesium={Cartesian3:{fromDegrees:(...x)=>x,fromDegreesArray:x=>x},Cartesian2:function(){},HeightReference:{CLAMP_TO_GROUND:1,NONE:0},Color:{CYAN:'cyan',WHITE:'white',ORANGE:{withAlpha:()=> 'orange'}},Math:{toRadians:x=>x*Math.PI/180}};
 `}));
 // Separate route prevents recursive document.write from the simulated dependency.
 await page.route('https://map.vworld.kr/test-dependency.js',r=>r.fulfill({contentType:'application/javascript',body:'window.dependencyReady=true;'}));
 await page.goto('/');await page.getByRole('button',{name:'지도 모니터링',exact:true}).click();
 await page.getByLabel('VWorld 3D 키').fill('synthetic-key<&');await page.getByRole('button',{name:'VWorld 3D 연결',exact:true}).click();
 await expect(page.getByText(/VWorld 3D 뷰어 초기화 완료 ·/)).toBeVisible();
 await expect(page.getByLabel('VWorld 3D 키')).toHaveValue('');
 const frame=page.frames().find(f=>f!==page.mainFrame())!;
 await expect.poll(()=>frame.evaluate('calls.filter(x=>x.point).length')).toBe(3);
 expect(await frame.evaluate('dependencyReady')).toBe(true);
 await page.getByLabel('시험 방향 부채꼴 표시').check();
 await expect.poll(()=>frame.evaluate('calls.filter(x=>x.polygon).length')).toBeGreaterThan(0);
 expect(await page.evaluate(()=>({local:localStorage.length,session:sessionStorage.length}))).toEqual({local:0,session:0});
});
test('blocked SDK produces actionable error without removing inventory',async({page})=>{
 await page.route('https://map.vworld.kr/**',r=>r.abort());await page.goto('/');await page.getByRole('button',{name:'지도 모니터링',exact:true}).click();
 await page.getByLabel('VWorld 3D 키').fill('synthetic-key');await page.getByRole('button',{name:'VWorld 3D 연결',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('SDK를 불러오지 못했습니다');await page.getByRole('button',{name:'카메라 목록',exact:true}).click();
 await expect(page.getByRole('table')).toBeVisible();
});
test('north-clockwise convention and physical range are used for illustrative sector',()=>{
 const p=sample.positions[0],north=destination(p,0,1000),east=destination(p,90,1000);
 expect(north[0]).toBeCloseTo(p.lon,6);expect(north[1]-p.lat).toBeCloseTo(1000/111195,5);
 expect(east[0]).toBeGreaterThan(p.lon);expect(east[1]).toBeCloseTo(p.lat,5);
});
