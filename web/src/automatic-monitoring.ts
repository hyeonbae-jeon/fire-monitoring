import {useEffect,useState} from 'react';
import {monitorFetch} from './monitor-server';
import type {Observation} from './LiveCapture';
import type {DevicePtz} from './DevicePtzStatus';
import type {Position} from './map-model';
import {sector} from './map-model';
import {approximateNativePose} from './native-approximation';
import {coverageColor,type CoverageShape} from './coverage-model';

export type AutomaticCamera={cameraId:string;name:string;source:string;displayRangeM:number;needsAttention:boolean;retryAt:string|null;feed:{status:string;reasonCode?:string;liveFrameAvailable:boolean;observation:Observation|null;devicePtz?:DevicePtz}};
export type AutomaticStatus={configured:boolean;serverNow?:string;cameras:AutomaticCamera[]};
export const recent=(value:string|null|undefined,now:number)=>{const time=Date.parse(value??'');return Number.isFinite(time)&&now-time<4000&&time-now<=2000;};
export function automaticPose(p:Position,c:AutomaticCamera|undefined,now:number){
 const n=p.nativeTracking,s=c?.feed.devicePtz?.sample,o=c?.feed.observation;
 if(!n||!c||c.cameraId!==p.id||!o||!s||c.feed.status!=='live'||!c.feed.liveFrameAvailable||c.feed.devicePtz?.status!=='live'||o.cameraLabel!==p.name||
  !recent(o.capturedAt,now)||!recent(s.receivedAt,now)||n.positionAtCalibration.lat!==p.lat||n.positionAtCalibration.lon!==p.lon)return null;
 try{return approximateNativePose({sample:n.deviceAnchor,pose:n.pose},s,n.zoomScale,.05);}catch{return null;}
}
export function automaticCoverage(positions:Position[],state:AutomaticStatus|null,now:number):CoverageShape[]{
 if(!state?.configured)return [];
 return positions.flatMap(p=>{
  const c=state.cameras.find(v=>v.cameraId===p.id),pose=automaticPose(p,c,now);
  if(!c||!pose||!Number.isFinite(c.displayRangeM)||c.displayRangeM<10||c.displayRangeM>20000)return [];
  const coordinates=sector(p,pose.headingDeg,pose.horizontalFovDeg,c.displayRangeM);
  return [{cameraId:p.id,name:p.name,color:coverageColor(p.id),source:'device-approximate' as const,coordinates,centerline:[coordinates[0],coordinates[13]] as [number,number][]}];
 });
}
export function useAutomaticMonitoring(enabled:boolean){
 const [state,setState]=useState<AutomaticStatus|null>(null),[error,setError]=useState(''),[now,setNow]=useState(Date.now());
 useEffect(()=>{
  if(!enabled){setState(null);return;}
  let cancelled=false,serverOffset=0,timer:ReturnType<typeof setTimeout>|undefined;const abort=new AbortController();
  async function poll(){try{
   const started=Date.now();
   const r=await monitorFetch('/api/auto-monitor/status',{signal:abort.signal});if(!r.ok)throw new Error('자동 수신 상태를 읽지 못했습니다.');
   const data=await r.json();if(typeof data?.configured!=='boolean'||!Array.isArray(data.cameras)||data.cameras.length>9)throw new Error('자동 수신 상태 형식을 확인하세요.');
   if(!cancelled){const serverTime=Date.parse(data.serverNow??'');if(Number.isFinite(serverTime))serverOffset=serverTime-started;setNow(Date.now()+serverOffset);setState(data);setError('');}
  }catch(e){if(!cancelled){setState(null);setError((e as Error).message);}}finally{if(!cancelled)timer=setTimeout(()=>void poll(),1000);}}
  void poll();const clock=setInterval(()=>setNow(Date.now()+serverOffset),250);
  return()=>{cancelled=true;abort.abort();clearInterval(clock);clearTimeout(timer);};
 },[enabled]);
 return {state,error,now};
}
