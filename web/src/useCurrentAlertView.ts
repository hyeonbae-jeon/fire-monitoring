import {useEffect,useRef,useState} from 'react';
import type {Position} from './map-model';
import type {MailEvent} from './firewatcher-mail';
import type {AutomaticCamera} from './automatic-monitoring';
import {currentFrameSnapshot,currentEvidenceValid,sameDeviceView,type CurrentFrameSnapshot,type CurrentViewEvidence} from './current-alert-view';
import type {AlertLocationRequest,PixelBox} from './alert-location';
import {monitorFetch} from './monitor-server';
type Options={event:MailEvent;position:Position;blob:Blob;frame:{width:number;height:number};box:PixelBox;rangeM:number;getCurrent:(id:string)=>{camera:AutomaticCamera;now:number}|null;onMatched:(request:AlertLocationRequest)=>void;onClear:()=>void};
export function useCurrentAlertView(options:Options){
 const latest=useRef(options);latest.current=options;
 const [status,setStatus]=useState('현재 CCTV 화면 대조 대기'),[busy,setBusy]=useState(false),[proof,setProof]=useState<CurrentViewEvidence|null>(null),worker=useRef<Worker|null>(null),abort=useRef<AbortController|null>(null),epoch=useRef(0),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 function stop(){epoch.current++;abort.current?.abort();abort.current=null;worker.current?.terminate();worker.current=null;clearTimeout(timer.current);setBusy(false);setProof(null);setStatus('현재 CCTV 화면 대조 대기');}
 useEffect(()=>()=>{epoch.current++;abort.current?.abort();worker.current?.terminate();clearTimeout(timer.current);},[]);
 useEffect(()=>{if(proof){const o=latest.current,live=o.getCurrent(o.position.id);if(!live||!currentEvidenceValid(proof,o.position,live.camera,live.now)){setProof(null);o.onClear();setStatus('현재 영상·PTZ가 만료되거나 방향이 바뀌었습니다. 현재 CCTV 각도로 다시 계산하세요.');}}},[options.getCurrent,options.position,proof]);
 async function start(){
  stop();const token=epoch.current,o=latest.current;o.onClear();setStatus('현재 CCTV 화면과 감지 영상을 대조하는 중…');setBusy(true);
  const controller=new AbortController();abort.current=controller;
  try{
   if(!Number.isFinite(o.rangeM)||o.rangeM<100||o.rangeM>20000)throw new Error('지형 조회 한도를 100~20,000m로 입력하세요.');
   const initial=o.getCurrent(o.position.id),before=initial?currentFrameSnapshot(o.position,initial.camera,initial.now):null;
   if(!before)throw new Error('해당 카메라의 최신 영상·PTZ 수신을 기다립니다.');
   const active=()=>{if(controller.signal.aborted||token!==epoch.current)throw new DOMException('cancelled','AbortError');};
   const stable=()=>{
    active();const current=latest.current,live=current.getCurrent(current.position.id),snapshot=live?currentFrameSnapshot(current.position,live.camera,live.now):null;
    if(!snapshot||snapshot.sessionId!==before.sessionId||!sameDeviceView(before.device,snapshot.device)||current.event.id!==o.event.id||current.event.detail?.imageSha256!==o.event.detail?.imageSha256||JSON.stringify(current.box)!==JSON.stringify(o.box)||JSON.stringify(current.position)!==JSON.stringify(o.position))throw new Error('화면 대조 중 카메라 방향 또는 알림이 변경됐습니다. 다시 계산하세요.');
    return snapshot;
   };
   const read=async(snapshot:CurrentFrameSnapshot)=>{
    const response=await monitorFetch('/api/auto-monitor/frame?'+new URLSearchParams({cameraId:o.position.id,sessionId:snapshot.sessionId,sequence:String(snapshot.sequence)}),{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(8000)])});
    if(!response.ok)throw new Error('현재 CCTV 영상을 가져오지 못했습니다. 다시 계산하세요.');
    const blob=await response.blob();if(blob.size>8*1024*1024||!blob.type.startsWith('image/'))throw new Error('현재 CCTV 영상 크기를 확인하세요.');active();return blob;
   };
   const firstBlob=await read(before);stable();
   const w=new Worker(new URL('./vision-worker.ts',import.meta.url),{type:'module'});worker.current=w;
   timer.current=setTimeout(()=>{if(worker.current===w){stop();setStatus('화면 대조 시간이 초과됐습니다. 다시 계산하세요.');}},25000);
   const compare=(blob:Blob)=>new Promise<any>((resolve,reject)=>{
    const id=crypto.randomUUID(),cancel=()=>reject(new DOMException('cancelled','AbortError'));
    controller.signal.addEventListener('abort',cancel,{once:true});
    const finish=(data:any,error?:Error)=>{controller.signal.removeEventListener('abort',cancel);w.onmessage=null;w.onerror=null;error?reject(error):resolve(data);};
    w.onmessage=e=>{if(e.data.id!==id||token!==epoch.current)return;e.data.type==='same-current-view'?finish(e.data.result):finish(null,new Error('알림 영상과 현재 CCTV의 같은 촬영 구도를 확인하지 못했습니다. 방향·줌 변경이나 가림 여부를 확인하세요.'));};
    w.onerror=()=>finish(null,new Error('현재 CCTV 화면 대조를 완료하지 못했습니다.'));
    w.postMessage({id,type:'same-current-view',referenceBlob:o.blob,blob});
   });
   const first=await compare(firstBlob);let next=stable();
   // Confirm a later image after the initial PTZ receipt; a camera turn must not
   // pair an older frame with the newly reported angle merely because both are fresh.
   const deadline=performance.now()+4000;
   while(next.sequence<=before.sequence||Date.parse(next.capturedAt)<Date.parse(before.ptzReceivedAt)){
    if(performance.now()>deadline)throw new Error('다음 CCTV 화면을 확인하지 못했습니다. 다시 계산하세요.');
    await new Promise(resolve=>setTimeout(resolve,200));next=stable();
   }
   const secondBlob=await read(next);stable();const result=await compare(secondBlob),after=stable();
   clearTimeout(timer.current);w.terminate();worker.current=null;abort.current=null;setBusy(false);
   const width=result.width,height=result.height;
   if(!Number.isInteger(width)||!Number.isInteger(height)||width<160||height<120||width*height>36_000_000||!o.event.detail?.imageSha256)throw new Error('현재 CCTV 영상 크기를 확인하지 못했습니다.');
   const evidence:CurrentViewEvidence={source:'matched-current-cctv',cameraId:o.position.id,sessionId:next.sessionId,verifiedFrames:2,firstFrameSequence:before.sequence,frameSequence:next.sequence,frameCapturedAt:next.capturedAt,ptzReceivedAt:next.ptzReceivedAt,device:before.device,frameWidth:width,frameHeight:height,matchedAt:new Date(after.now).toISOString(),match:{trainingCount:Math.min(first.trainingCount,result.trainingCount),validationCount:Math.min(first.validationCount,result.validationCount),medianShift:Math.max(first.medianShift,result.medianShift),p95Shift:Math.max(first.p95Shift,result.p95Shift)}};
   const box={x:o.box.x/o.frame.width*width,y:o.box.y/o.frame.height*height,width:o.box.width/o.frame.width*width,height:o.box.height/o.frame.height*height};
   setProof(evidence);setStatus('현재 CCTV와 감지 영상의 구도 대응 확인 · 현재 PTZ로 계산');
   latest.current.onMatched({eventId:o.event.id,imageSha256:o.event.detail.imageSha256,position:o.position,frame:{width,height},box,device:before.device,confirmed:true,rangeM:o.rangeM,currentView:evidence});
  }catch(error){if(token===epoch.current){stop();latest.current.onClear();setStatus((error as Error).message);}}
 }
 return {start,stop,busy,status};
}
