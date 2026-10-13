import type {Position} from './map-model';

// Our operator-input contract. This is not a discovered FIREWATCHER API schema.
export type SmokeAlert={eventId:string;cameraKey:string;cameraName:string;detectedAt:string;frameSize:{width:number;height:number}|null;box:{x:number;y:number;width:number;height:number}|null};
export type SmokeAlertDocument={schemaVersion:1;kind:'smoke-alert-preview';source:'operator-input';sourceInstance:string;events:SmokeAlert[]};
export type AlertBinding={key:string;cameraId:string;positionAtBinding:{lat:number;lon:number}};
export type AlertMarker={cameraId:string;name:string;lat:number;lon:number;count:number;latestAt:string;locationMeaning:'camera-installation';sourceMode:'operator-input'};
export const MAX_ALERT_BYTES=1024*1024;
const fields=(v:any,keys:string[])=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const text=(v:unknown,max:number)=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
const positiveInteger=(v:unknown,max:number)=>typeof v==='number'&&Number.isInteger(v)&&v>0&&v<=max;
function validTimestamp(value:unknown):boolean{
 if(typeof value!=='string')return false;
 const parts=/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d{1,3})?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
 if(!parts)return false;
 const instant=Date.parse(value);if(!Number.isFinite(instant))return false;
 const offset=parts[3]==='Z'?0:(parts[4]==='+'?1:-1)*(Number(parts[5])*60+Number(parts[6]));
 // Date.parse normalizes impossible dates such as February 30; reject them.
 return new Date(instant+offset*60_000).toISOString().slice(0,19)===parts[1];
}
export function parseSmokeAlerts(raw:string):SmokeAlertDocument{
 const fail=()=>{throw new Error('알림 자료의 형식·출처·중복 알림번호·시각(시간대 포함)·원본 해상도와 박스를 확인하세요.');};
 if(new TextEncoder().encode(raw).length>MAX_ALERT_BYTES)throw new Error('알림 자료는 1MB 이하여야 합니다.');
 let v:any;try{v=JSON.parse(raw);}catch(_){return fail();}
 if(!fields(v,['schemaVersion','kind','source','sourceInstance','events'])||v.schemaVersion!==1||v.kind!=='smoke-alert-preview'||v.source!=='operator-input'||!text(v.sourceInstance,100)||!Array.isArray(v.events)||v.events.length>500)return fail();
 const ids=new Set<string>();
 const events=v.events.map((e:SmokeAlert)=>{
  if(!fields(e,['eventId','cameraKey','cameraName','detectedAt','frameSize','box'])||!text(e.eventId,100)||ids.has(e.eventId)||!text(e.cameraKey,200)||!text(e.cameraName,200)||!validTimestamp(e.detectedAt))return fail();
  ids.add(e.eventId);
  if(e.frameSize!==null&&(!fields(e.frameSize,['width','height'])||!positiveInteger(e.frameSize.width,8192)||!positiveInteger(e.frameSize.height,8192)||e.frameSize.width*e.frameSize.height>36_000_000))return fail();
  if(e.box!==null&&(!e.frameSize||!fields(e.box,['x','y','width','height'])||![e.box.x,e.box.y,e.box.width,e.box.height].every(n=>Number.isFinite(n))||e.box.x<0||e.box.y<0||e.box.width<=0||e.box.height<=0||e.box.x+e.box.width>e.frameSize.width||e.box.y+e.box.height>e.frameSize.height))return fail();
  return {...e,frameSize:e.frameSize?{...e.frameSize}:null,box:e.box?{...e.box}:null};
 });
 return {schemaVersion:1,kind:'smoke-alert-preview',source:'operator-input',sourceInstance:v.sourceInstance,events};
}
export function alertIdentity(document:SmokeAlertDocument,event:SmokeAlert):string{return JSON.stringify([document.sourceInstance,event.eventId,event.cameraKey,event.cameraName,event.detectedAt,event.frameSize,event.box]);}
export function alertCameraKey(document:SmokeAlertDocument,event:SmokeAlert):string{return JSON.stringify([document.sourceInstance,event.cameraKey,event.cameraName]);}
export function bindAlertCamera(document:SmokeAlertDocument,event:SmokeAlert,position:Position):AlertBinding{return {key:alertCameraKey(document,event),cameraId:position.id,positionAtBinding:{lat:position.lat,lon:position.lon}};}
export function resolveAlertCamera(document:SmokeAlertDocument,event:SmokeAlert,bindings:AlertBinding[],positions:Position[]):Position|null{
 const binding=bindings.find(b=>b.key===alertCameraKey(document,event));
 const p=binding?positions.find(p=>p.id===binding.cameraId):undefined;
 return p&&p.lat===binding!.positionAtBinding.lat&&p.lon===binding!.positionAtBinding.lon?p:null;
}
export function buildAlertMarkers(document:SmokeAlertDocument|null,bindings:AlertBinding[],positions:Position[]):AlertMarker[]{
 if(!document)return [];
 const markers=new Map<string,AlertMarker>();
 for(const event of document.events){
  const p=resolveAlertCamera(document,event,bindings,positions);if(!p)continue;
  const old=markers.get(p.id);if(old){old.count++;if(Date.parse(event.detectedAt)>Date.parse(old.latestAt))old.latestAt=event.detectedAt;}
  else markers.set(p.id,{cameraId:p.id,name:p.name,lat:p.lat,lon:p.lon,count:1,latestAt:event.detectedAt,locationMeaning:'camera-installation',sourceMode:'operator-input'});
 }
 return [...markers.values()];
}
export function manualSmokeAlert(sourceInstance:string,cameraName:string,cameraKey:string,localTime:string):SmokeAlertDocument{
 if(!localTime.trim())throw new Error('감지 시각(한국시간)을 입력하세요.');
 const stamp=localTime.length===16?localTime+':00':localTime;
 return parseSmokeAlerts(JSON.stringify({schemaVersion:1,kind:'smoke-alert-preview',source:'operator-input',sourceInstance,events:[{eventId:'operator-'+crypto.randomUUID(),cameraKey:cameraKey.trim()||cameraName,cameraName,detectedAt:stamp+'+09:00',frameSize:null,box:null}]}));
}
