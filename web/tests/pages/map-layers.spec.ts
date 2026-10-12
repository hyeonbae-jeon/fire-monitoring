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
const sdk=`
window.sources=[];window.layerLoads=[];window.pendingLoads=[];window.markers=[];window.flies=[];
window.vw={CameraPosition:function(){},CoordZ:function(){},Direction:function(){},Map:function(){this.setOption=function(){};this.start=function(){setTimeout(()=>vw.ws3dInitCallBack(),0)}}};
window.ws3d={viewer:{entities:{add:e=>{markers.push(e);return e},remove:()=>{}},dataSources:{add:s=>{sources.push(s);return Promise.resolve(s)},remove:s=>{sources=sources.filter(x=>x!==s)}},scene:{canvas:{clientWidth:1200,clientHeight:700},clampToHeight:()=>null,screenSpaceCameraController:{enableInputs:true}},camera:{frustum:{fov:1,aspectRatio:1},flyTo:x=>flies.push(x)}}};
window.Cesium={Cartesian3:{fromDegrees:(...x)=>x,fromDegreesArray:x=>x},Cartesian2:function(){},HeightReference:{CLAMP_TO_GROUND:1,NONE:0},ClassificationType:{BOTH:2},Rectangle:{fromDegrees:(...x)=>({bounds:x})},Color:{CYAN:'cyan',WHITE:'white',fromCssColorString:x=>x,ORANGE:{withAlpha:()=> 'orange'}},Math:{toRadians:x=>x*Math.PI/180},GeoJsonDataSource:{load:(data,options)=>{
 layerLoads.push({data,options});if(window.failLayers)return Promise.reject(new Error('synthetic failure'));
 const source={entities:{values:[{polyline:{}}]},show:true,destroy:function(){this.destroyed=true}};
 return window.holdLayers?new Promise(resolve=>pendingLoads.push(()=>resolve(source))):Promise.resolve(source);
}}};
`;

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
 await page.getByRole('button',{name:'지도 레이어',exact:true}).click();await page.getByLabel('지도자료 JSON 불러오기').setInputFiles(file(bundle));
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
 const frame=page.frames().find(f=>f!==page.mainFrame())!;await frame.evaluate('window.holdLayers=true');
 await page.getByRole('button',{name:'지도 레이어',exact:true}).click();await page.getByLabel('지도자료 JSON 불러오기').setInputFiles(file(bundle));
 await expect.poll(()=>frame.evaluate('pendingLoads.length')).toBe(2);
 const next=structuredClone(bundle);next.layers=next.layers.slice(0,1);next.layers[0].name='새 경계';
 await page.getByLabel('지도자료 JSON 불러오기').setInputFiles(file(next));await expect.poll(()=>frame.evaluate('pendingLoads.length')).toBe(3);
 await frame.evaluate('pendingLoads[0]();pendingLoads[1]();pendingLoads[2]()');
 await expect.poll(()=>frame.evaluate('sources.map(s=>s.name)')).toEqual(['새 경계']);await expect(page.getByText('표시 준비 완료',{exact:false})).toHaveCount(1);
 await frame.evaluate('window.holdLayers=false;window.failLayers=true');await page.getByLabel('지도자료 JSON 불러오기').setInputFiles(file(bundle));
 await expect(page.getByText(/표시 실패/)).toHaveCount(2);await expect(page.getByText(/VWorld 3D 뷰어 초기화 완료 ·/)).toBeVisible();
});
