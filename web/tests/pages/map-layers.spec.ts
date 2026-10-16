import {test,expect} from '@playwright/test';
import {parseMapBundle,layerLines,type MapBundle} from '../../src/map-layers';

const bundle:MapBundle={schemaVersion:1,crs:'EPSG:4326',positions:Array.from({length:9},(_,i)=>({id:'test-camera-'+i,name:'설치 시험 '+(i+1),lat:37.62+i*.005,lon:126.95+i*.005,ssmUuid:null,positionSource:'operator',orientation:null})),layers:[
 {id:'boundary',name:'시험 공원경계',kind:'boundary',sourceCrs:'EPSG:5181',sourceDate:'2024-04-04',geojson:{type:'FeatureCollection',features:[{type:'Feature',id:'boundary-1',properties:{name:'시험 경계'},geometry:{type:'MultiPolygon',coordinates:[[
  [[126.94,37.61],[127,37.61],[127,37.69],[126.94,37.61]],
  [[126.96,37.64],[126.97,37.64],[126.97,37.65],[126.96,37.64]]
 ],[[[127.01,37.66],[127.02,37.66],[127.02,37.67],[127.01,37.66]]]]}}]}},
 {id:'trails',name:'시험 탐방로',kind:'trails',sourceCrs:'EPSG:5181',sourceDate:'2024-04-04',geojson:{type:'FeatureCollection',features:[{type:'Feature',id:'trails-1',properties:{name:'시험 길'},geometry:{type:'MultiLineString',coordinates:[[[126.95,37.62],[126.96,37.64]],[[126.98,37.66],[126.99,37.67]]]}}]}}
]};
const file=(b:unknown)=>({name:'map-data.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(b))});
import {sdk} from '../fixtures/vworld-sdk';

test('published site immediately displays approved nine camera coordinates and full park layers after reload',async({page})=>{
 const coordinates=[[126.94632,37.65729],[126.97638,37.66294],[126.96187,37.64377],[126.97419,37.62858],[126.94295,37.61806],[127.00971,37.66243],[126.97798,37.65868],[126.99210,37.63216],[126.99059,37.68027]];
 const requests:string[]=[];page.on('request',r=>requests.push(r.method()+' '+r.url()));
 await page.route('https://map.vworld.kr/**',r=>r.fulfill({contentType:'application/javascript',body:sdk}));
 for(let attempt=0;attempt<2;attempt++){
  if(attempt)await page.reload();else await page.goto('./');
  await expect(page.getByText(/VWorld 3D 뷰어 초기화 완료 ·/)).toBeVisible();
  await expect(page.locator('.camera-panel button.camera')).toHaveCount(9);
  await expect(page.getByRole('button',{name:/백운대/})).toBeVisible();
  await expect(page.getByText(/현재 방향 미확인/).last()).toBeVisible();
  const frame=page.frames().find(f=>f!==page.mainFrame())!;
  await expect.poll(()=>frame.evaluate('mockEntities.filter(e=>e.point).slice(-9).map(e=>e.position)')).toEqual(coordinates);
  await expect.poll(()=>frame.evaluate('sources.length')).toBe(2);
  await expect.poll(()=>frame.evaluate('flies.at(-1).destination.bounds')).toEqual([126.933388,37.5965684,127.0456293,37.7386941]);
  expect(await frame.evaluate('layerLoads.map(l=>l.data.features.length)')).toEqual([1,102]);
  await page.getByRole('button',{name:'지도 레이어',exact:true}).click();
  await expect(page.getByLabel('북한산 공원경계',{exact:true})).toBeChecked();await expect(page.getByLabel('북한산 탐방로',{exact:true})).toBeChecked();
  await expect(page.getByLabel('지도자료 JSON 불러오기')).toBeHidden();
  await page.getByLabel('북한산 탐방로',{exact:true}).uncheck();await expect.poll(()=>frame.evaluate('sources.find(s=>s.name==="북한산 탐방로").show')).toBe(false);
 }
 expect(requests.filter(r=>r.includes('/api/')||r.startsWith('POST ')||r.startsWith('PUT '))).toEqual([]);
});

test('GeoJSON validation retains holes and multipart lines, strips attributes and rejects unprojected data',()=>{
 const input=structuredClone(bundle) as any;input.layers[0].geojson.features[0].properties.path='private-device-path';
 const parsed=parseMapBundle(JSON.stringify(input));
 expect(layerLines(parsed.layers[0])).toHaveLength(3);expect(layerLines(parsed.layers[1])).toHaveLength(2);
 expect(JSON.stringify(parsed)).not.toContain('private-device-path');
 for(const change of [
  (b:any)=>{b.layers[1].geojson.features[0].geometry.coordinates[0][0]=[200000,460000];},
  (b:any)=>{b.layers[0].geojson.features[0].geometry.coordinates[0][0].pop();},
  (b:any)=>{b.layers[0].geojson.crs={type:'name',properties:{name:'EPSG:5181'}};},
  (b:any)=>{b.layers.push(b.layers[0]);},
  (b:any)=>{b.layers[0].geojson.features[0].geometry.coordinates[0][0][0].push(500);}
 ]){const b=structuredClone(bundle);change(b);expect(()=>parseMapBundle(JSON.stringify(b))).toThrow(/확인하세요/);}
});

test('local bundle shows nine positions and all separate rings offline, with atomic invalid import',async({page})=>{
 await page.route('https://map.vworld.kr/**',r=>r.abort());await page.goto('./');
 await page.getByRole('button',{name:'지도 연결',exact:true}).click();await page.getByRole('button',{name:'좌표 배치도로 보기'}).click();
 await page.getByRole('button',{name:'지도 레이어',exact:true}).click();
 const requests:string[]=[];page.on('request',r=>requests.push(r.method()+' '+r.url()));
 await page.getByLabel('지도자료 JSON 불러오기').setInputFiles(file(bundle));
 await expect(page.locator('svg [data-layer="boundary"] polyline')).toHaveCount(3);
 await expect(page.locator('svg [data-layer="trails"] polyline')).toHaveCount(2);
 await expect(page.locator('svg circle')).toHaveCount(9);
 const invalid=structuredClone(bundle);invalid.positions[0].lat=91;
 await page.getByLabel('지도자료 JSON 불러오기').setInputFiles(file(invalid));
 await expect(page.getByRole('alert')).toContainText('확인하세요');await expect(page.locator('svg circle')).toHaveCount(9);
 await page.getByLabel('시험 탐방로', {exact:true}).uncheck();await expect(page.locator('svg [data-layer="trails"]')).toHaveCount(0);
 expect(requests.filter(u=>u.startsWith('POST ')||u.startsWith('PUT ')||u.includes('/api/'))).toEqual([]);
});

test('mock SDK receives terrain/tiles classification; layers toggle, survive camera changes and round-trip',async({page})=>{
 await page.route('https://map.vworld.kr/**',r=>r.fulfill({contentType:'application/javascript',body:sdk}));await page.goto('./');
 await expect(page.getByText(/VWorld 3D 뷰어 초기화 완료 ·/)).toBeVisible();
 const frame=page.frames().find(f=>f!==page.mainFrame())!;
 await expect.poll(()=>frame.evaluate('sources.length')).toBe(2);await frame.evaluate('layerLoads=[]');
 await page.getByRole('button',{name:'지도 레이어',exact:true}).click();await page.getByLabel('지도자료 JSON 불러오기').setInputFiles(file(bundle));
 // File.text() and iframe loads are asynchronous. The old published layers
 // also have two ready labels; wait for this bundle's identity before reading.
 await expect(page.getByLabel('시험 공원경계',{exact:true})).toBeChecked();
 await expect.poll(()=>frame.evaluate('sources.map(s=>s.name)')).toEqual(['시험 공원경계','시험 탐방로']);
 await expect.poll(()=>frame.evaluate('layerLoads.length')).toBe(2);
 await expect(page.getByText('표시 준비 완료',{exact:false})).toHaveCount(2);
 expect(await frame.evaluate('layerLoads[0].data.features[0].geometry.coordinates.length')).toBe(3);
 expect(await frame.evaluate('layerLoads.map(x=>x.options.clampToGround)')).toEqual([true,true]);
 expect(await frame.evaluate('sources.map(x=>x.entities.values[0].polyline.classificationType)')).toEqual([2,2]);
 await page.getByLabel('시험 탐방로',{exact:true}).uncheck();await expect.poll(()=>frame.evaluate('sources.find(s=>s.name==="시험 탐방로").show')).toBe(false);
 await page.getByLabel('시험 탐방로',{exact:true}).check();await expect.poll(()=>frame.evaluate('sources.find(s=>s.name==="시험 탐방로").show')).toBe(true);
 await page.getByRole('button',{name:'전체 위치·경계 보기'}).click();await expect.poll(()=>frame.evaluate('flies.at(-1).destination.bounds')).toEqual([126.94,37.61,127.02,37.69]);
 await page.getByRole('button',{name:'카메라·설정',exact:true}).click();await page.getByRole('button',{name:/설치 시험 9/}).click();
 await expect(page.getByText('위도 37.66 / 경도 126.99')).toBeVisible();expect(page.frames().find(f=>f!==page.mainFrame())).toBe(frame);
 expect(await frame.evaluate('sources.length')).toBe(2);expect(await frame.evaluate('layerLoads.length')).toBe(2);
 await page.getByRole('button',{name:'지도 레이어',exact:true}).click();const promise=page.waitForEvent('download');await page.getByRole('button',{name:'지도자료 전체 다운로드'}).click();
 const stream=await (await promise).createReadStream();let text='';for await(const b of stream!)text+=b.toString();expect(parseMapBundle(text)).toEqual(bundle);expect(text).not.toContain('synthetic-pages-key');
});

test('replacing a bundle while its GeoJSON is loading discards stale sources and statuses',async({page})=>{
 await page.route('https://map.vworld.kr/**',r=>r.fulfill({contentType:'application/javascript',body:sdk}));await page.goto('./');await expect(page.getByText(/VWorld 3D 뷰어 초기화 완료 ·/)).toBeVisible();
 const frame=page.frames().find(f=>f!==page.mainFrame())!;await expect.poll(()=>frame.evaluate('sources.length')).toBe(2);await frame.evaluate('layerLoads=[];window.holdLayers=true');
 await page.getByRole('button',{name:'지도 레이어',exact:true}).click();await page.getByLabel('지도자료 JSON 불러오기').setInputFiles(file(bundle));
 await expect.poll(()=>frame.evaluate('pendingLoads.length')).toBe(2);
 const next=structuredClone(bundle);next.layers=next.layers.slice(0,1);next.layers[0].name='새 경계';
 await page.getByLabel('지도자료 JSON 불러오기').setInputFiles(file(next));await expect.poll(()=>frame.evaluate('pendingLoads.length')).toBe(3);
 await frame.evaluate('pendingLoads[0]();pendingLoads[1]();pendingLoads[2]()');
 await expect.poll(()=>frame.evaluate('sources.map(s=>s.name)')).toEqual(['새 경계']);await expect(page.getByText('표시 준비 완료',{exact:false})).toHaveCount(1);
 await frame.evaluate('window.holdLayers=false;window.failLayers=true');await page.getByLabel('지도자료 JSON 불러오기').setInputFiles(file(bundle));
 await expect(page.getByText(/표시 실패/)).toHaveCount(2);await expect(page.getByText(/VWorld 3D 뷰어 초기화 완료 ·/)).toBeVisible();
});
