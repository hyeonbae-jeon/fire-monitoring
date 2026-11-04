import {validMapControlPoint,type MapControlPoint} from './calibration-model';
import type {Position} from './map-model';

export const MAX_DIAGNOSTIC_BYTES=256*1024;
export type DiagnosticPoint=MapControlPoint&{number:number;label:string;validation:boolean};
export type DiagnosticReview={camera:{id:string;name:string;lat:number;lon:number};reference:{sha256:string;width:number;height:number;capturedAt?:string};points:DiagnosticPoint[]};
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const label=(v:unknown,max=100):v is string=>typeof v==='string'&&!!v.trim()&&v.length<=max&&!/[\u0000-\u001f]/.test(v);
export function matchesDiagnosticCamera(review:DiagnosticReview,position?:Position){
 return !!position&&position.positionSource==='operator'&&review.camera.id===position.id&&Math.abs(review.camera.lat-position.lat)<1e-7&&Math.abs(review.camera.lon-position.lon)<1e-7;
}
export function parseDiagnosticReview(text:string,position:Position):DiagnosticReview{
 if(new TextEncoder().encode(text).length>MAX_DIAGNOSTIC_BYTES)throw new Error('보정 진단 파일은 256KB 이하여야 합니다.');
 let d:any;try{d=JSON.parse(text);}catch{throw new Error('보정 진단 JSON을 읽을 수 없습니다.');}
 const c=d?.camera,r=d?.reference;
 if(d?.schemaVersion!==1||d.kind!=='geographic-calibration-diagnostics'||!label(c?.id,200)||!label(c?.name,200)||!finite(c?.lat)||Math.abs(c.lat)>90||!finite(c?.lon)||Math.abs(c.lon)>180||
  typeof r?.sha256!=='string'||!/^[0-9a-f]{64}$/i.test(r.sha256)||!Number.isInteger(r.width)||!Number.isInteger(r.height)||r.width<1||r.height<1||r.width*r.height>36_000_000||!Array.isArray(d.landmarks)||d.landmarks.length<1||d.landmarks.length>20)
  throw new Error('보정 진단 다운로드로 받은 파일의 종류·카메라·참조 사진 정보를 확인하세요.');
 const points:DiagnosticPoint[]=[];
 for(const [i,m] of d.landmarks.entries()){
  if(!label(m?.label)||!finite(m.x)||m.x<0||m.x>1||!finite(m.y)||m.y<0||m.y>1||(m.useForValidation!==undefined&&typeof m.useForValidation!=='boolean'))throw new Error('진단 기준점의 이름·영상 좌표·검증 역할을 확인하세요.');
  if(m.mapPoint!==undefined){if(!validMapControlPoint(m.mapPoint))throw new Error('진단 기준점의 지도 좌표·고도를 확인하세요.');points.push({...m.mapPoint,number:i+1,label:m.label,validation:m.useForValidation===true});}
 }
 if(!points.length)throw new Error('지도에 연결된 기준점이 없는 진단 파일입니다.');
 const capturedAt=typeof r.capturedAt==='string'&&r.capturedAt.length<=80&&/^\d{4}-\d{2}-\d{2}T[0-9:.+Z-]+$/.test(r.capturedAt)&&Number.isFinite(Date.parse(r.capturedAt))?r.capturedAt:undefined;
 const review:DiagnosticReview={camera:{id:c.id,name:c.name,lat:c.lat,lon:c.lon},reference:{sha256:r.sha256,width:r.width,height:r.height,...(capturedAt?{capturedAt}:{})},points};
 if(!matchesDiagnosticCamera(review,position))throw new Error('현재 선택한 카메라와 진단 파일의 설치 좌표·식별자가 다릅니다. 같은 카메라를 먼저 선택하세요.');
 return review;
}
export function diagnosticBounds(review:DiagnosticReview){
 const locations=[[review.camera.lon,review.camera.lat],...review.points.map(p=>[p.lon,p.lat])];
 const west=Math.min(...locations.map(p=>p[0])),east=Math.max(...locations.map(p=>p[0])),south=Math.min(...locations.map(p=>p[1])),north=Math.max(...locations.map(p=>p[1]));
 const dx=Math.max(.0005,(east-west)*.15),dy=Math.max(.0005,(north-south)*.15);
 return [Math.max(-180,west-dx),Math.max(-90,south-dy),Math.min(180,east+dx),Math.min(90,north+dy)];
}
