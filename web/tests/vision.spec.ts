import {test,expect} from '@playwright/test';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {sdk} from './fixtures/vworld-sdk';
import manifest from './fixtures/vision/manifest.json';
import {fitVisualPose,referenceRay} from '../src/vision-pose';
import {projectGeographic} from '../src/geographic-calibration';

const fixture=(name:string)=>readFileSync('tests/fixtures/vision/'+name);
const reference=fixture('reference.png'),first=fixture('current-1.png'),second=fixture('current-2.png');
const pose=manifest.referencePose;
test('relative pose recovers known motion and zoom; withheld points cannot move the fitted pose',()=>{
 const expected={...pose,headingDeg:185,pitchDeg:7,horizontalFovDeg:65};
 const pairs=[];for(let y=.3;y<.9;y+=.1)for(let x=.15;x<.9;x+=.1){const current=projectGeographic(referenceRay(x,y,pose,800/480),expected,800/480)!;if(current.x>0&&current.x<1&&current.y>0&&current.y<1)pairs.push({reference:[x,y] as [number,number],current:[current.x,current.y] as [number,number],validation:pairs.length%4===0});}
 const result=fitVisualPose(pose,800/480,800,480,pairs);expect(result.pose.headingDeg).toBeCloseTo(185,5);expect(result.pose.pitchDeg).toBeCloseTo(7,5);expect(result.pose.horizontalFovDeg).toBeCloseTo(65,5);
 expect(()=>fitVisualPose(pose,800/480,800,480,pairs.map(p=>p.validation?{...p,current:[p.current[0]+.08,p.current[1]]}:p))).toThrow('독립 검증');
 expect(()=>fitVisualPose(pose,800/480,800,600,pairs)).toThrow('비율');
 const north={...pose,headingDeg:359},across={...pose,headingDeg:2,pitchDeg:6,horizontalFovDeg:68};
 const wrapped=pairs.map(p=>{const q=projectGeographic(referenceRay(...p.reference,north,800/480),across,800/480)!;return {...p,current:[q.x,q.y] as [number,number]};});
 expect(fitVisualPose(north,800/480,800,480,wrapped).pose.headingDeg).toBeCloseTo(2,5);
});
test('packaged offline OpenCV worker matches independently generated views and rejects black or unrelated images',async({page})=>{
 test.setTimeout(40000);const external:string[]=[];page.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:5081/')&&!r.url().startsWith('blob:')&&!r.url().startsWith('data:'))external.push(r.url());});await page.goto('/');
 const workerFile=readdirSync('../bridge/WisenetPtzBridge/wwwroot/assets/').find(n=>n.startsWith('vision-worker-'))!;
 const result=await page.evaluate(async({workerFile,reference,first,second,pose})=>{
  const blob=(data:string)=>new Blob([Uint8Array.from(atob(data),c=>c.charCodeAt(0))],{type:'image/png'});
  const w=new Worker('/assets/'+workerFile,{type:'module'});let id=0;
  const ask=(data:object)=>new Promise<any>((resolve,reject)=>{const n=String(++id);const timer=setTimeout(()=>reject(new Error('worker timeout')),15000);w.onerror=e=>{clearTimeout(timer);reject(new Error(e.message));};w.onmessage=e=>{if(e.data.id===n){clearTimeout(timer);resolve(e.data);}};w.postMessage({id:n,...data});});
  try{
   const ready=await ask({type:'reference',blob:blob(reference),pose,aspect:800/480});
   const a=await ask({type:'frame',blob:blob(first)}),b=await ask({type:'frame',blob:blob(second)});
   const canvas=document.createElement('canvas');canvas.width=800;canvas.height=480;const g=canvas.getContext('2d')!;g.fillRect(0,0,800,480);const black=await new Promise<Blob>(r=>canvas.toBlob(b=>r(b!),'image/png'));
   const rejected=await ask({type:'frame',blob:black});
   let seed=9417;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)|0;return (seed>>>0)/4294967296;};
   for(let i=0;i<1500;i++){g.fillStyle=`rgb(${rand()*255},${rand()*255},${rand()*255})`;g.beginPath();g.arc(rand()*800,100+rand()*350,2+rand()*7,0,Math.PI*2);g.fill();}
   const noise=await new Promise<Blob>(r=>canvas.toBlob(b=>r(b!),'image/png'));const unrelated=await ask({type:'frame',blob:noise});
   const original=await createImageBitmap(blob(reference));canvas.width=800;canvas.height=480;g.drawImage(original,0,0);g.fillStyle='#777';g.fillRect(0,0,800,290);g.fillRect(0,310,800,170);original.close();
   const strip=await new Promise<Blob>(r=>canvas.toBlob(b=>r(b!),'image/png'));const narrow=await ask({type:'frame',blob:strip});
   canvas.width=400;const cropped=await new Promise<Blob>(r=>canvas.toBlob(b=>r(b!),'image/png'));const wrongSize=await ask({type:'frame',blob:cropped});
   return {ready,a,b,rejected,unrelated,wrongSize,narrow};
  }finally{w.terminate();}
 },{workerFile,reference:reference.toString('base64'),first:first.toString('base64'),second:second.toString('base64'),pose});
 expect(result.ready.type,JSON.stringify(result.ready)).toBe('ready');
 for(const [i,key] of ['a','b'].entries()){
  const a=result[key];expect(a.type,JSON.stringify(a)).toBe('result');expect(a.result.pose.headingDeg).toBeCloseTo(manifest.expected[i].headingDeg,0);expect(a.result.pose.pitchDeg).toBeCloseTo(manifest.expected[i].pitchDeg,0);expect(Math.abs(a.result.pose.horizontalFovDeg-manifest.expected[i].horizontalFovDeg)).toBeLessThan(1);expect(a.result.validationCount).toBeGreaterThanOrEqual(8);
 }
 expect(result.rejected.type).toBe('unknown');
 expect(result.unrelated.type).toBe('unknown');expect(result.wrongSize.type).toBe('unknown');expect(result.narrow.type).toBe('unknown');
 expect(external).toEqual([]);
});

function configuration(){return {schemaVersion:1,crs:'EPSG:4326',positions:[{id:'visual-synthetic',name:'합성 영상 카메라',lat:37.5,lon:127.1,positionSource:'operator',ssmUuid:null,orientation:{...pose,groundElevationM:700,groundElevationSource:'operator',source:'manual-calibration',status:'estimate',confidence:'unvalidated',positionAtCalibration:{lat:37.5,lon:127.1},calibratedAt:'2026-10-20T00:00:00.000Z',reference:{sha256:createHash('sha256').update(reference).digest('hex'),width:800,height:480,capturedAt:'2026-10-20T00:00:00.000Z'},landmarks:[{label:'합성 기준 1',x:.2,y:.3},{label:'합성 기준 2',x:.8,y:.7}]}}]};}
test('local live comparison requires operator binding, updates only opted-in map, and removes estimates on occlusion',async({page},testInfo)=>{
 test.setTimeout(45000);let sequence=0,paused=false,sessionId='synthetic-vision-session';const methods:string[]=[];page.on('request',r=>{if(r.url().includes('/api/'))methods.push(r.method());});
 await page.route('https://map.vworld.kr/**',r=>r.fulfill({contentType:'application/javascript',body:sdk}));
 await page.route('**/api/screen-capture/status',r=>r.fulfill({json:{configured:true,status:paused?'paused':'live',liveFrameAvailable:!paused,directionStatus:'unknown',automaticDirectionTrackingImplemented:false,observation:{sessionId,cameraLabel:'사용자 입력 합성 이름',status:paused?'paused':'live',reasonCode:paused?'region-occluded':'capturing',capturedAt:new Date().toISOString(),sequence:++sequence,sceneChanged:true,lowContrast:false,referenceDifference:.2}}}));
 await page.route('**/api/screen-capture/frame?*',r=>r.fulfill({contentType:'image/png',body:first}));
 await page.goto('/');await page.getByRole('button',{name:'지도 모니터링',exact:true}).click();
 await page.getByLabel('위도·경도 JSON 불러오기',{exact:true}).setInputFiles({name:'synthetic.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(configuration()))});
 await page.getByRole('button',{name:'지도 연결',exact:true}).click();await page.getByLabel('VWorld 3D 키').fill('synthetic-key');await page.getByRole('button',{name:'VWorld 3D 연결',exact:true}).click();await expect(page.getByText(/VWorld 3D 뷰어 초기화 완료 ·/)).toBeVisible();
 await page.getByRole('button',{name:'실시간 영상',exact:true}).click();await page.getByLabel('지도 영상 조회 키').fill('synthetic-capture-key');await page.getByRole('button',{name:'지도에서 라이브 확인',exact:true}).click();
 const panel=page.getByRole('region',{name:'영상 방향 추정 시험'});await expect(page.getByRole('img',{name:'지도에서 확인하는 최신 CCTV 화면'})).toBeVisible();
 await page.getByLabel('추적 기준 원본 사진').setInputFiles({name:'wrong.png',mimeType:'image/png',buffer:second});await expect(panel).toContainText('기준 사진의 해시와 다릅니다');
 await page.getByLabel('추적 기준 원본 사진').setInputFiles({name:'reference.png',mimeType:'image/png',buffer:reference});await expect(panel).toContainText('기준 사진 해시·크기 일치');await expect(page.getByRole('button',{name:'영상 방향 비교 시작',exact:true})).toBeDisabled();
 await page.getByLabel('수집 화면이 선택한 카메라의 라이브 영상과 일치함을 확인').check();await page.getByRole('button',{name:'영상 방향 비교 시작',exact:true}).click();
 await expect(panel).toContainText('영상 대응 추정 · 기준 시점의 정확도 미검증',{timeout:20000});
 const frame=page.frames().find(f=>f!==page.mainFrame())!;expect(await frame.evaluate('views.length')).toBe(0);
 await page.getByLabel('대응 검증 시 지도 시점 자동 갱신').check();await expect.poll(()=>frame.evaluate('views.length')).toBeGreaterThan(0);
 const view=await frame.evaluate('views.at(-1)');expect(view.destination).toEqual([127.1,37.5,703]);expect(view.orientation.heading*180/Math.PI).toBeCloseTo(185,0);
 await expect(page.locator('.map-bottom-status')).toContainText('영상 대응 추정');
 await panel.locator('p').filter({hasText:/방위각 .*°/}).scrollIntoViewIfNeeded();await page.screenshot({path:testInfo.outputPath('live-visual-estimate-synthetic.png'),fullPage:false});
 await frame.evaluate('window.originalSend=parent.postMessage.bind(parent);window.delayedMap=[];parent.postMessage=(data,...rest)=>{if(data.type==="calibration-ready")delayedMap.push([data,...rest]);else originalSend(data,...rest);}');
 await expect.poll(()=>frame.evaluate('delayedMap.length')).toBeGreaterThan(0);
 paused=true;await expect(panel).toContainText('방향 미확인');await expect(page.locator('.map-bottom-status')).not.toContainText('영상 대응 추정');
 await frame.evaluate('parent.postMessage=originalSend;delayedMap.forEach(args=>originalSend(...args));delayedMap=[]');await expect(page.locator('.map-bottom-status')).not.toContainText('영상 대응 추정');
 const count=await frame.evaluate('views.length');await page.waitForTimeout(1200);expect(await frame.evaluate('views.length')).toBe(count);
 paused=false;sessionId='synthetic-new-session';await expect(page.getByLabel('수집 화면이 선택한 카메라의 라이브 영상과 일치함을 확인')).not.toBeChecked();await expect(page.getByRole('button',{name:'영상 방향 비교 시작',exact:true})).toBeDisabled();expect(await frame.evaluate('views.length')).toBe(count);
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'카메라·설정',exact:true}).click();await page.getByRole('button',{name:'좌표 설정 다운로드',exact:true}).click();const stream=await (await download).createReadStream();let raw='';for await(const chunk of stream)raw+=chunk.toString();expect(JSON.parse(raw).positions[0].orientation.headingDeg).toBe(180);expect(raw).not.toContain('synthetic-capture-key');expect(methods.every(m=>m==='GET')).toBe(true);
 await page.getByRole('button',{name:'실시간 영상',exact:true}).click();await expect(page.getByLabel('추적 기준 원본 사진')).toHaveValue('');await expect(page.getByLabel('수집 화면이 선택한 카메라의 라이브 영상과 일치함을 확인')).not.toBeChecked();
});
