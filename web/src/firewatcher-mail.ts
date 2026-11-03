import {useEffect,useState} from 'react';
import type {Position} from './map-model';
import type {AlertMarker} from './smoke-alert-model';
import {monitorFetch} from './monitor-server';

export type EventDetail={cameraKey:string;cameraName:string;eventType:string;reportedTime:string;displayedTime:string|null;mappingCount:number;hasDevicePose:boolean;imageSha256:string|null};
export type MailEvent={id:string;link:string;mailSentAt:string|null;mailReceivedAt:string|null;firstSeenAt:string;binding:{cameraId:string;lat:number;lon:number}|null;detail?:EventDetail|null;detailCheckedAt?:string|null;detailStatus?:string|null;ingestionSource?:string};
export type MailStatus={configured:boolean;enabled:boolean;status:string;checkedAt:string|null;pollSeconds:number;skippedMessages:number;retainedLimit:number;source:'iphone-mail-forward';events:MailEvent[]};
export function mailCamera(event:MailEvent,positions:Position[]){return positions.find(p=>p.id===event.binding?.cameraId&&p.lat===event.binding.lat&&p.lon===event.binding.lon);}
export function mailMarkers(state:MailStatus|null,positions:Position[]):AlertMarker[]{
 const markers=new Map<string,AlertMarker>();
 for(const event of state?.events??[]){
  const p=mailCamera(event,positions);if(!p)continue;
  const old=markers.get(p.id);
  if(old){old.count++;if(event.firstSeenAt>old.latestAt)old.latestAt=event.firstSeenAt;}
  else markers.set(p.id,{cameraId:p.id,name:p.name,lat:p.lat,lon:p.lon,count:1,latestAt:event.firstSeenAt,locationMeaning:'camera-installation',sourceMode:'iphone-mail-forward'});
 }
 return [...markers.values()];
}
export function useFirewatcherMail(enabled:boolean){
 const [state,setState]=useState<MailStatus|null>(null),[error,setError]=useState(''),[epoch,setEpoch]=useState(0);
 useEffect(()=>{
  if(!enabled)return;
  let stopped=false;const abort=new AbortController();let timer:ReturnType<typeof setTimeout>;
  const poll=async()=>{
   try{
    const response=await monitorFetch('/api/firewatcher-mail',{signal:AbortSignal.any([abort.signal,AbortSignal.timeout(10000)])});
    if(!response.ok)throw new Error();const data=await response.json();
    if(data?.source!=='iphone-mail-forward'||!Array.isArray(data.events))throw new Error();
    if(!stopped){setState(data);setError('');}
   }catch{if(!stopped)setError('메일 수신 상태를 가져오지 못했습니다.');}
   finally{if(!stopped)timer=setTimeout(poll,15000);}
  };
  void poll();return()=>{stopped=true;abort.abort();clearTimeout(timer);};
 },[enabled,epoch]);
 return {state:enabled?state:null,error,refresh:()=>setEpoch(v=>v+1)};
}
