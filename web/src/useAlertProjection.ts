import {useEffect,useRef,useState} from 'react';
import type {Position} from './map-model';
import type {AutomaticStatus} from './automatic-monitoring';
import {currentEvidenceValid} from './current-alert-view';
import type {MailStatus} from './firewatcher-mail';
import {createAlertRayGrid,intersectAlertTerrain,type AlertLocationRequest,type AlertLocationResult,type AlertRayGrid} from './alert-location';
type Options={active:boolean;ready:boolean;session:string|null;positions:Position[];mail:MailStatus|null;automatic:AutomaticStatus|null;now:number;post:(type:string,data?:object)=>void};
type Ticket={id:string;grid:AlertRayGrid;timer:ReturnType<typeof setTimeout>};
export function useAlertProjection(options:Options){
 const latest=useRef(options);latest.current=options;
 const ticket=useRef<Ticket|null>(null),[result,setResult]=useState<AlertLocationResult|null>(null),[error,setError]=useState(''),[progress,setProgress]=useState('');
 function matches(request:AlertLocationRequest){const o=latest.current,p=o.positions.find(p=>p.id===request.position.id),event=o.mail?.events.find(e=>e.id===request.eventId);
  return o.active&&o.ready&&!!p&&JSON.stringify(p)===JSON.stringify(request.position)&&event?.detail?.imageSha256===request.imageSha256&&event.binding?.cameraId===p.id&&event.binding.lat===p.lat&&event.binding.lon===p.lon&&(!request.currentView||currentEvidenceValid(request.currentView,p,o.automatic?.cameras.find(c=>c.cameraId===p.id),o.now));
 }
 function clear(){const t=ticket.current;if(t){clearTimeout(t.timer);latest.current.post('terrain-cancel',{requestId:t.id});ticket.current=null;}setResult(null);setProgress('');setError('');}
 const session=useRef(options.session);
 useEffect(()=>{if(session.current!==options.session||!options.active||!options.ready||ticket.current&&!matches(ticket.current.grid.request)||result&&!matches(result.grid.request)){session.current=options.session;clear();}},[options.session,options.active,options.ready,options.positions,options.mail,options.automatic,options.now]);
 useEffect(()=>()=>{if(ticket.current)clearTimeout(ticket.current.timer);},[]);
 function start(request:AlertLocationRequest){
  clear();
  try{
   if(!matches(request))throw new Error('같은 알림 영상·지도 카메라 연결과 VWorld 지형을 먼저 확인하세요.');
   const grid=createAlertRayGrid(request),id=crypto.randomUUID();
   const timer=setTimeout(()=>{if(ticket.current?.id===id){ticket.current=null;setProgress('');setError('지형 조회 시간이 초과됐습니다. 지도 지형 로딩 후 다시 계산하세요.');latest.current.post('terrain-cancel',{requestId:id});}},45000);
   ticket.current={id,grid,timer};setProgress(`지형 높이 조회 중 · 0/${grid.points.length}`);latest.current.post('terrain-heights',{requestId:id,points:grid.points});
  }catch(e){setError((e as Error).message);}
 }
 function receive(data:any){
  const t=ticket.current;if(!t||data.requestId!==t.id)return;
  if(!matches(t.grid.request)){clear();return;}
  if(data.type==='terrain-progress'){setProgress(`지형 높이 조회 중 · ${data.done}/${t.grid.points.length}`);return;}
  if(!['terrain-heights','terrain-error'].includes(data.type))return;
  clearTimeout(t.timer);ticket.current=null;setProgress('');
  try{if(data.type==='terrain-error')throw new Error('지형 높이를 읽지 못했습니다. 평면 고도를 대신 적용하지 않습니다.');setResult(intersectAlertTerrain(t.grid,data.heights,data.heightSource));}
  catch(e){setError((e as Error).message);}
 }
 return {result,error,progress,start,clear,receive};
}
