import {useEffect,useMemo,useRef,useState} from 'react';
import type {Position} from './map-model';
import {DEFAULT_TRIAL_CAMERA_HEIGHT_M} from './calibration-model';
import {coverageStatus,type CoveragePlan} from './coverage-model';
import {calculateVisibility,createVisibilityGrid,visibilityKey,type VisibilityGrid,type VisibilityResult,type HeightSource} from './terrain-visibility-model';

type Ticket={id:string;session:string;grid:VisibilityGrid;height:number;timer:number};
type Options={positions:Position[];current:Position|undefined;plans:CoveragePlan[];ready:boolean;session:string|null;post:(type:string,data?:object)=>void};
export function useTerrainVisibility(options:Options){
 const latest=useRef(options);latest.current=options;
 const [results,setResults]=useState<VisibilityResult[]>([]),[heightInputs,setHeightInputs]=useState<Record<string,string>>({}),[spacings,setSpacings]=useState<Record<string,50|100>>({});
 const [progress,setProgress]=useState<{cameraId:string;done:number;total:number}|null>(null),[error,setError]=useState<{cameraId:string;text:string}|null>(null),[renderError,setRenderError]=useState('');
 const ticket=useRef<Ticket|null>(null),sessionRef=useRef(options.session);
 function cancel(){const t=ticket.current;if(t){clearTimeout(t.timer);latest.current.post('terrain-cancel',{requestId:t.id});ticket.current=null;}setProgress(null);}
 function stillMatches(t:Ticket){
  const o=latest.current,p=o.positions.find(p=>p.id===t.grid.cameraId),plan=o.plans.find(p=>p.cameraId===t.grid.cameraId);
  return o.ready&&o.session===t.session&&o.current?.id===t.grid.cameraId&&p&&plan&&coverageStatus(plan,p)==='ready'&&visibilityKey(p,plan)===t.grid.key;
 }
 useEffect(()=>{
  if(sessionRef.current!==options.session||!options.ready){sessionRef.current=options.session;cancel();setResults(r=>r.length?[]:r);return;}
  if(ticket.current&&(!stillMatches(ticket.current)||options.current?.id!==ticket.current.grid.cameraId))cancel();
  setResults(r=>{const valid=r.filter(v=>{const p=options.positions.find(p=>p.id===v.cameraId),plan=options.plans.find(p=>p.cameraId===v.cameraId);return p&&plan&&['ready','hidden'].includes(coverageStatus(plan,p))&&visibilityKey(p,plan)===v.key;});return valid.length===r.length?r:valid;});
 },[options.positions,options.plans,options.current?.id,options.session,options.ready]);
 useEffect(()=>()=>{if(ticket.current){clearTimeout(ticket.current.timer);ticket.current=null;}},[]);
 const validResults=useMemo(()=>results.filter(v=>{const p=options.positions.find(p=>p.id===v.cameraId),plan=options.plans.find(p=>p.cameraId===v.cameraId);return p&&plan&&['ready','hidden'].includes(coverageStatus(plan,p))&&visibilityKey(p,plan)===v.key;}),[results,options.positions,options.plans]);
 function invalidateCurrent(){
  const id=latest.current.current?.id;if(!id)return;
  if(ticket.current?.grid.cameraId===id)cancel();
  setResults(r=>r.some(v=>v.cameraId===id)?r.filter(v=>v.cameraId!==id):r);setError(null);
 }
 function setHeight(value:string){const id=latest.current.current?.id;if(id){invalidateCurrent();setHeightInputs(v=>({...v,[id]:value}));}}
 function setSpacing(value:50|100){const id=latest.current.current?.id;if(id){invalidateCurrent();setSpacings(v=>({...v,[id]:value}));}}
 function start(){
  const o=latest.current,p=o.current,plan=o.plans.find(v=>v.cameraId===p?.id);if(!p)return;
  try{
   if(!o.ready||!o.session)throw new Error('VWorld 지도에 먼저 연결하세요.');
   const input=heightInputs[p.id]??String(DEFAULT_TRIAL_CAMERA_HEIGHT_M);if(!input.trim()||!Number.isFinite(Number(input))||Number(input)<.5||Number(input)>100)throw new Error('지면 위 렌즈 높이를 0.5~100m로 입력하세요. 모르면 시험 높이를 사용하세요.');
   if(!plan)throw new Error('범위 시안을 먼저 표시하세요.');
   const grid=createVisibilityGrid(p,plan,spacings[p.id]??100);cancel();invalidateCurrent();setRenderError('');
   const id=crypto.randomUUID(),timer=window.setTimeout(()=>{if(ticket.current?.id===id){cancel();setError({cameraId:p.id,text:'지형 높이 조회 시간 초과. 지형 로딩 후 다시 계산하세요.'});}},90000);
   ticket.current={id,session:o.session,grid,height:Number(input),timer};setProgress({cameraId:p.id,done:0,total:grid.points.length});setError(null);
   o.post('terrain-heights',{requestId:id,points:grid.points});
  }catch(e){setError({cameraId:p.id,text:(e as Error).message});}
 }
 function receive(data:any){
  const t=ticket.current;if(!t||data.requestId!==t.id)return;
  if(!stillMatches(t)){cancel();return;}
  if(data.type==='terrain-progress'){
   if(Number.isInteger(data.done)&&data.done>=0&&data.done<=t.grid.points.length)setProgress({cameraId:t.grid.cameraId,done:data.done,total:t.grid.points.length});return;
  }
  if(data.type!=='terrain-heights'&&data.type!=='terrain-error')return;
  clearTimeout(t.timer);ticket.current=null;setProgress(null);
  try{
   if(data.type==='terrain-error')throw new Error('현재 지도에서 지형 높이를 조회하지 못했습니다. 지형 로딩과 높이 조회 지원을 확인한 뒤 다시 계산하세요.');
   const result=calculateVisibility(t.grid,data.heights,t.height,data.heightSource as HeightSource);
   setResults(r=>[...r.filter(v=>v.cameraId!==result.cameraId),result]);setError(null);
  }catch(e){setError({cameraId:t.grid.cameraId,text:(e as Error).message});}
 }
 return {results:validResults,currentResult:validResults.find(v=>v.cameraId===options.current?.id),height:heightInputs[options.current?.id??'']??String(DEFAULT_TRIAL_CAMERA_HEIGHT_M),spacing:spacings[options.current?.id??'']??100,setHeight,setSpacing,start,cancel,clear:invalidateCurrent,receive,progress,error:error&&error.cameraId===options.current?.id?error.text:'',renderError,setRenderError};
}
