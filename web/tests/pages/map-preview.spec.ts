import {test,expect} from '@playwright/test';

import {sdk} from '../fixtures/vworld-sdk';

test('Pages subpath loads and auto connects with configured browser key without company API calls',async({page})=>{
 const urls:string[]=[];page.on('request',r=>urls.push(r.url()));
 await page.route('https://map.vworld.kr/**',r=>{expect(new URL(r.request().url()).searchParams.get('apiKey')).toBe('synthetic-pages-key');return r.fulfill({contentType:'application/javascript',body:sdk});});
 await page.goto('./');await expect(page.getByText(/VWorld 3D 뷰어 초기화 완료 ·/)).toBeVisible();
 const actualFrame=page.frames().find(f=>f!==page.mainFrame())!;
 expect(actualFrame.url()).toBe('http://127.0.0.1:5082/fire-monitoring/vworld-viewer.html');
 expect(new URL(actualFrame.url()).search).toBe('');
 expect(await actualFrame.evaluate(()=>location.protocol)).toBe('http:');
 await page.getByRole('button',{name:'지도 연결',exact:true}).click();
 await expect(page.getByText('등록된 지도 키 자동 사용 · 다시 입력할 필요 없습니다.')).toBeVisible();
 await expect(page.getByLabel('VWorld 3D 키')).toBeHidden();
 await page.getByRole('button',{name:'카메라·설정',exact:true}).click();
 expect(urls.some(u=>u.includes('/api/')||u.endsWith('/health'))).toBe(false);
 await expect(page.getByRole('button',{name:'중앙 지도 설정 저장'})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'카메라 목록',exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>({local:localStorage.length,session:sessionStorage.length}))).toEqual({local:0,session:0});
 await page.getByLabel('슬라이더 자동 적용').check();
 const frame=page.frames().find(f=>f!==page.mainFrame())!;
 await expect.poll(()=>frame.evaluate('views.length')).toBeGreaterThan(0);
 await page.getByLabel('가상 방위각',{exact:true}).evaluate(e=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(e,'120');e.dispatchEvent(new Event('input',{bubbles:true}));});
 await expect.poll(()=>frame.evaluate('views.at(-1).orientation.heading')).toBeCloseTo(120*Math.PI/180);
 await expect(page.getByRole('button',{name:'추정 방향을 설정에 반영'})).toBeDisabled();
});

test('floating controls fit on desktop and mobile without horizontal overflow',async({page},testInfo)=>{
 await page.route('https://map.vworld.kr/**',r=>r.fulfill({contentType:'application/javascript',body:sdk}));
 await page.setViewportSize({width:1440,height:1000});await page.goto('./');
 await expect(page.getByText(/VWorld 3D 뷰어 초기화 완료 ·/)).toBeVisible();
 const bounds=await page.locator('.map-workspace').boundingBox();
 for(const panel of ['.camera-panel','.reference-panel','.pose-panel']){
  const b=(await page.locator(panel).boundingBox())!;expect(b.x).toBeGreaterThanOrEqual(bounds!.x);expect(b.x+b.width).toBeLessThanOrEqual(bounds!.x+bounds!.width+1);expect(b.y+b.height).toBeLessThanOrEqual(bounds!.y+bounds!.height);
 }
 await page.screenshot({path:testInfo.outputPath('map-workspace-desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});await expect(page.getByLabel('가상 방위각',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:testInfo.outputPath('map-workspace-mobile.png'),fullPage:true});
});

test('map marker selection updates the panel and retains the same viewer on camera changes',async({page})=>{
 await page.route('https://map.vworld.kr/**',r=>r.fulfill({contentType:'application/javascript',body:sdk}));
 await page.goto('./');await expect(page.getByText(/VWorld 3D 뷰어 초기화 완료 ·/)).toBeVisible();
 const frame=page.frames().find(f=>f!==page.mainFrame())!;
 await expect.poll(()=>frame.evaluate('mockEntities.filter(e=>e.point).length')).toBeGreaterThanOrEqual(9);
 await frame.evaluate('window.picked=mockEntities.filter(e=>e.point).slice(-9)[1];clickHandler({position:{x:1,y:1}})');
 await expect(page.getByText('위도 37.66294 / 경도 126.97638')).toBeVisible();
 await expect.poll(()=>frame.evaluate('flies.at(-1).destination')).toEqual([126.97638,37.66294,4500]);
 await page.getByRole('button',{name:/백운대/}).click();
 expect(page.frames().find(f=>f!==page.mainFrame())).toBe(frame);
 await expect.poll(()=>frame.evaluate('flies.at(-1).destination')).toEqual([126.97798,37.65868,4500]);
});

test('Pages camera height recovery uses map altitude without a blank-field convention or company API',async({page})=>{
 const companyRequests:string[]=[];
 page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/'))companyRequests.push(r.url());});
 await page.route('https://map.vworld.kr/**',r=>r.fulfill({contentType:'application/javascript',body:sdk}));
 await page.goto('./');await expect(page.getByText(/VWorld 3D 뷰어 초기화 완료 ·/)).toBeVisible();
 await page.getByRole('button',{name:/^숨은벽/}).click();
 const frame=page.frames().find(f=>f!==page.mainFrame())!;
 const height=page.getByLabel('가상 설치 높이(m)',{exact:true});
 const apply=page.getByRole('button',{name:'가상 시점 적용',exact:true});
 await expect(page.getByLabel('지도에서 자동 조회 (권장)',{exact:true})).toBeChecked();
 await expect(page.getByLabel('지도 지면 고도(m)',{exact:true})).toHaveCount(0);
 await height.fill('');await expect(height).toHaveValue('');await expect(apply).toBeDisabled();
 await height.fill('0');await expect(apply).toBeDisabled();
 await height.fill('20');await apply.click();
 await expect(page.getByText('지도 지면 높이 700.0m · 로드된 지형 참고값')).toBeVisible();
 expect(await frame.evaluate('views.at(-1).destination')).toEqual([126.97638,37.66294,720]);
 await page.getByLabel('직접 고도 입력',{exact:true}).check();await expect(apply).toBeDisabled();
 await page.getByLabel('지도 지면 고도(m)',{exact:true}).fill('0');await apply.click();
 await expect(page.getByText('지도 지면 높이 0.0m · 사용자 입력값')).toBeVisible();
 expect(await frame.evaluate('views.at(-1).destination[2]')).toBe(20);
 await page.getByLabel('지도에서 자동 조회 (권장)',{exact:true}).check();await apply.click();
 await expect(page.getByText('지도 지면 높이 700.0m · 로드된 지형 참고값')).toBeVisible();
 expect(await frame.evaluate('views.at(-1).destination[2]')).toBe(720);
 await expect(page.getByRole('button',{name:'추정 방향을 설정에 반영',exact:true})).toBeDisabled();
 expect(companyRequests).toEqual([]);
});
