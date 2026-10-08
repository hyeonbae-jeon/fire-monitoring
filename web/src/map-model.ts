export type Position = {id:string;name:string;lat:number;lon:number;ssmUuid:string|null;positionSource:'synthetic'|'operator';orientation:null};
export type MapConfiguration = {schemaVersion:1;crs:'EPSG:4326';positions:Position[]};
export const sample:MapConfiguration={schemaVersion:1,crs:'EPSG:4326',positions:[
{id:'demo-1',name:'북한산 시험 A',lat:37.6585,lon:126.977,ssmUuid:null,positionSource:'synthetic',orientation:null},
{id:'demo-2',name:'북한산 시험 B',lat:37.645,lon:126.965,ssmUuid:null,positionSource:'synthetic',orientation:null},
{id:'demo-3',name:'북한산 시험 C',lat:37.671,lon:126.985,ssmUuid:null,positionSource:'synthetic',orientation:null}]};
export function parseConfiguration(text:string):MapConfiguration {
 if(text.length>1024*1024)throw new Error('좌표 파일은 1MB 이하여야 합니다.');
 const v=JSON.parse(text);
 if(v?.schemaVersion!==1||v.crs!=='EPSG:4326'||!Array.isArray(v.positions)||v.positions.length>1000)throw new Error('schemaVersion: 1, crs: EPSG:4326, positions 배열(최대 1000개)이 필요합니다.');
 const ids=new Set<string>();
 const positions:Position[]=v.positions.map((p:Position)=>{
 if(!p||typeof p.id!=='string'||!p.id.trim()||p.id.length>100||ids.has(p.id)||typeof p.name!=='string'||!p.name.trim()||p.name.length>200||!Number.isFinite(p.lat)||p.lat< -90||p.lat>90||!Number.isFinite(p.lon)||p.lon< -180||p.lon>180||!['synthetic','operator'].includes(p.positionSource)||p.orientation!==null||!(p.ssmUuid===null||(typeof p.ssmUuid==='string'&&/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(p.ssmUuid))))throw new Error('중복 ID, 이름, 위도/경도, 출처, UUID 또는 orientation(null)을 확인하세요.');
 ids.add(p.id);return {id:p.id,name:p.name,lat:p.lat,lon:p.lon,ssmUuid:p.ssmUuid,positionSource:p.positionSource,orientation:null};});
 return {schemaVersion:1,crs:'EPSG:4326',positions};
}
// Illustrative horizontal sector, no terrain visibility calculation.
export function destination(p:Position,heading:number,distance:number):[number,number]{
 const rad=Math.PI/180,lat=p.lat*rad,lon=p.lon*rad,b=heading*rad,d=distance/6371008.8;
 const lat2=Math.asin(Math.sin(lat)*Math.cos(d)+Math.cos(lat)*Math.sin(d)*Math.cos(b));
 const lon2=lon+Math.atan2(Math.sin(b)*Math.sin(d)*Math.cos(lat),Math.cos(d)-Math.sin(lat)*Math.sin(lat2));
 return [((lon2/rad+540)%360)-180,lat2/rad];
}
export function sector(p:Position,heading:number,fov:number,range:number):[number,number][]{return [[p.lon,p.lat],...Array.from({length:25},(_,i)=>destination(p,heading-fov/2+fov*i/24,range)),[p.lon,p.lat]];}
