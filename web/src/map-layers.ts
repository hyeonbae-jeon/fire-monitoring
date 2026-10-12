import {parseConfiguration,type MapConfiguration} from './map-model';

type Coordinate=[number,number];
export type LayerGeometry =
 | {type:'LineString';coordinates:Coordinate[]}
 | {type:'MultiLineString';coordinates:Coordinate[][]}
 | {type:'Polygon';coordinates:Coordinate[][]}
 | {type:'MultiPolygon';coordinates:Coordinate[][][]};
export type MapLayer={id:string;name:string;kind:'boundary'|'trails';sourceCrs:string;sourceDate:string;geojson:{type:'FeatureCollection';features:{type:'Feature';id:string;properties:{name:string};geometry:LayerGeometry}[]}};
export type MapBundle=MapConfiguration&{layers:MapLayer[]};
export const MAX_MAP_FILE_BYTES=8*1024*1024;

// GeoJSON is always longitude, latitude. Source CRS records provenance only:
// reprojection must happen before import, never by guessing numeric ranges.
export function parseMapBundle(text:string):MapBundle{
 if(new TextEncoder().encode(text).length>MAX_MAP_FILE_BYTES)throw new Error('지도 자료는 8MB 이하여야 합니다.');
 const v=JSON.parse(text);
 const configuration=parseConfiguration(JSON.stringify({schemaVersion:v?.schemaVersion,crs:v?.crs,positions:v?.positions}));
 if(v.layers===undefined)return {...configuration,layers:[]};
 if(!Array.isArray(v.layers)||v.layers.length>10)throw new Error('지도 레이어는 최대 10개까지 불러올 수 있습니다.');
 let vertices=0,features=0;const ids=new Set<string>();
 const fail=()=>{throw new Error('지도 레이어의 이름·종류·날짜와 EPSG:4326 GeoJSON 좌표·도형을 확인하세요.');};
 const name=(s:unknown,max=200):string=>typeof s==='string'&&s.trim()&&s.length<=max?s:fail();
 const coordinate=(c:unknown):Coordinate=>{
  if(!Array.isArray(c)||c.length!==2||!Number.isFinite(c[0])||!Number.isFinite(c[1])||c[0]<-180||c[0]>180||c[1]<-90||c[1]>90||++vertices>200000)return fail();
  return [c[0],c[1]];
 };
 const line=(a:unknown,ring=false):Coordinate[]=>{
  if(!Array.isArray(a)||a.length<(ring?4:2))return fail();
  const points=a.map(coordinate);
  if(ring&&(points[0][0]!==points.at(-1)![0]||points[0][1]!==points.at(-1)![1]))return fail();
  return points;
 };
 const lines=(a:unknown,ring=false):Coordinate[][]=>Array.isArray(a)&&a.length?a.map(p=>line(p,ring)):fail();
 const geometry=(g:any,kind:MapLayer['kind']):LayerGeometry=>{
  if(kind==='trails'&&g?.type==='LineString')return {type:g.type,coordinates:line(g.coordinates)};
  if(kind==='trails'&&g?.type==='MultiLineString')return {type:g.type,coordinates:lines(g.coordinates)};
  if(kind==='boundary'&&g?.type==='Polygon')return {type:g.type,coordinates:lines(g.coordinates,true)};
  if(kind==='boundary'&&g?.type==='MultiPolygon'&&Array.isArray(g.coordinates)&&g.coordinates.length)return {type:g.type,coordinates:g.coordinates.map((p:unknown)=>lines(p,true))};
  return fail();
 };
 const layers:MapLayer[]=v.layers.map((layer:any)=>{
  const id=name(layer?.id,100);if(ids.has(id)||!['boundary','trails'].includes(layer.kind))return fail();ids.add(id);
  if(typeof layer.sourceCrs!=='string'||!/^EPSG:\d{4,6}$/.test(layer.sourceCrs)||typeof layer.sourceDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(layer.sourceDate)||!Number.isFinite(Date.parse(layer.sourceDate+'T00:00:00Z')))return fail();
  const fc=layer.geojson;if(fc?.type!=='FeatureCollection'||fc.crs!==undefined||!Array.isArray(fc.features)||!fc.features.length)return fail();
  return {id,name:name(layer.name),kind:layer.kind,sourceCrs:layer.sourceCrs,sourceDate:layer.sourceDate,geojson:{type:'FeatureCollection',features:fc.features.map((f:any,i:number)=>{
   if(f?.type!=='Feature'||++features>10000)return fail();
   return {type:'Feature',id:id+'-'+(i+1),properties:{name:typeof f.properties?.name==='string'?name(f.properties.name):name(layer.name)},geometry:geometry(f.geometry,layer.kind)};
  })}};
 });
 return {...configuration,layers};
}

// Rings stay separate (including holes and disjoint parts); no connecting lines.
export function layerLines(layer:MapLayer):Coordinate[][]{
 return layer.geojson.features.flatMap(f=>{
  const g=f.geometry;
  if(g.type==='LineString')return [g.coordinates];
  if(g.type==='MultiLineString'||g.type==='Polygon')return g.coordinates;
  return g.coordinates.flat();
 });
}
