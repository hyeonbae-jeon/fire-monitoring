import {useEffect,useRef,useState} from 'react';
import type {CapturedFrame} from './LiveCapture';
import type {Position} from './map-model';
import type {Pose} from './calibration-model';
import {angularDistance,type VisualPose} from './vision-pose';
import type {CaptureAlignment} from './capture-alignment';

type Estimate=VisualPose&{trainingCount:number;validationCount:number;analysisWidth:number;analysisHeight:number;mutualCount:number;features:number};
export type LiveVisualView={pose:Pose;aspect:number;capturedAt:string};
type Props={position:Position|undefined;frame:CapturedFrame|null;mapReady:boolean;onView:(view:LiveVisualView)=>Promise<void>;onStop:()=>void};
const fresh=(frame:CapturedFrame|null)=>{const t=Date.parse(frame?.observation.capturedAt??'');return !!frame&&Number.isFinite(t)&&Date.now()-t<4000&&t<=Date.now()+2000;};
export function VisualTracking(props:Props){
 const orientation=props.position?.orientation;
 const [reference,setReference]=useState<Blob|null>(null),[referenceStatus,setReferenceStatus]=useState('저장된 기준 사진을 선택하세요.'),[confirmed,setConfirmed]=useState(false),[running,setRunning]=useState(false),[autoMap,setAutoMap]=useState(false),[result,setResult]=useState<Estimate|null>(null),[status,setStatus]=useState('방향 미확인 · 비교 중지'),[mapError,setMapError]=useState('');
 const [alignment,setAlignment]=useState<CaptureAlignment|null>(null),[sameView,setSameView]=useState(false),[aligning,setAligning]=useState(false);
 const alignmentWorking=useRef(aligning),sameViewBinding=useRef(sameView);alignmentWorking.current=aligning;sameViewBinding.current=sameView;
 const callbacks=useRef(props);callbacks.current=props;
 const worker=useRef<Worker|null>(null),prepared=useRef(false),busy=useRef(false),ticket=useRef(''),jobFrame=useRef<CapturedFrame|null>(null),history=useRef<Estimate|null>(null),consecutive=useRef(0),lastIdentity=useRef(''),loadTicket=useRef(0),mounted=useRef(true),timeout=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),latest=useRef(props.frame),auto=useRef(autoMap),working=useRef(running),binding=useRef(confirmed);
 latest.current=props.frame;auto.current=autoMap;working.current=running;binding.current=confirmed;
 const analysisEpoch=useRef(0),jobEpoch=useRef(0),viewRequest=useRef(0),resultExpiresAt=useRef(0);
 const session=props.frame?props.frame.observation.sessionId+':'+props.frame.observation.cameraLabel:'';
 function unknown(message:string){analysisEpoch.current++;viewRequest.current++;resultExpiresAt.current=0;history.current=null;consecutive.current=0;setResult(null);setStatus('방향 미확인 · '+message);callbacks.current.onStop();}
 function dispose(){worker.current?.terminate();worker.current=null;prepared.current=false;busy.current=false;ticket.current='';clearTimeout(timeout.current);jobFrame.current=null;lastIdentity.current='';}
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;loadTicket.current++;dispose();callbacks.current.onStop();};},[]);
 useEffect(()=>{
  const hidden=()=>{if(document.hidden){setRunning(false);setAligning(false);setAutoMap(false);unknown('브라우저 탭이 숨겨져 비교 중지');}};
  document.addEventListener('visibilitychange',hidden);const expiry=setInterval(()=>{if(resultExpiresAt.current&&Date.now()>=resultExpiresAt.current)unknown('추정 화면 만료');},250);
  return()=>{document.removeEventListener('visibilitychange',hidden);clearInterval(expiry);};
 },[]);
 useEffect(()=>{setConfirmed(false);setRunning(false);setAligning(false);setAlignment(null);setSameView(false);setAutoMap(false);unknown('수집 세션·이름을 확인하고 같은 카메라임을 다시 확인하세요.');},[session]);
 async function load(file?:File){
  if(!file||!orientation)return;const token=++loadTicket.current;setRunning(false);setAligning(false);setAlignment(null);setSameView(false);setAutoMap(false);setReference(null);unknown('참조 사진 확인 중');
  try{
   if(file.size>10*1024*1024||!['image/png','image/jpeg','image/webp'].includes(file.type))throw new Error('10MB 이하의 원본 참조 이미지를 선택하세요.');
   const hash=await crypto.subtle.digest('SHA-256',await file.arrayBuffer()),sha=Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
   if(sha!==orientation.reference.sha256)throw new Error('저장한 기준 사진의 해시와 다릅니다. 같은 원본 파일이 필요합니다.');
   const image=await createImageBitmap(file);const valid=image.width===orientation.reference.width&&image.height===orientation.reference.height;image.close();if(!valid)throw new Error('저장된 기준 영상 크기와 다릅니다.');
   if(!mounted.current||loadTicket.current!==token)return;setReference(file);setReferenceStatus('기준 사진 해시·크기 일치');setStatus('방향 미확인 · 비교 시작 대기');
  }catch(e){if(mounted.current&&loadTicket.current===token)setReferenceStatus((e as Error).message);}
 }
 useEffect(()=>{
  if((!running&&!aligning)||!reference||!orientation||!confirmed){dispose();return;}
  const w=new Worker(new URL('./vision-worker.ts',import.meta.url),{type:'module'});worker.current=w;prepared.current=false;busy.current=true;const init=crypto.randomUUID();ticket.current=init;setStatus('방향 미확인 · 로컬 영상 비교 모듈 준비 중');
  timeout.current=setTimeout(()=>{if(worker.current===w){dispose();setRunning(false);setAligning(false);unknown('비교 모듈 준비 시간 초과');}},20000);
  w.onmessage=e=>{
   if(worker.current!==w||ticket.current!==e.data.id)return;clearTimeout(timeout.current);busy.current=false;
   if(e.data.type==='ready'){
    prepared.current=true;
    if(aligning){
     const f=latest.current;
     if(!f||!fresh(f)||!sameViewBinding.current||!binding.current){setAligning(false);unknown('캡처 영역 보정에는 같은 시점의 최신 수집 화면이 필요합니다.');return;}
     busy.current=true;jobFrame.current=f;jobEpoch.current=analysisEpoch.current;const id=crypto.randomUUID();ticket.current=id;
     setStatus('방향 미확인 · 같은 시점의 캡처 영역 맞추는 중');
     timeout.current=setTimeout(()=>{dispose();setAligning(false);unknown('캡처 영역 보정 시간 초과');},3500);
     w.postMessage({id,type:'align',blob:f.blob});
    }else setStatus('방향 미확인 · 다음 수집 화면 대기');
    return;
   }
   if(e.data.type==='unknown'){if(!prepared.current)setRunning(false);if(aligning)setAligning(false);unknown(String(e.data.reason));return;}
   const frame=jobFrame.current;jobFrame.current=null;
   if(jobEpoch.current!==analysisEpoch.current||(aligning?(!alignmentWorking.current||!sameViewBinding.current):!working.current)||!binding.current||!fresh(frame)||!fresh(latest.current)||!frame||!latest.current||frame.observation.sessionId!==latest.current.observation.sessionId||frame.observation.cameraLabel!==latest.current.observation.cameraLabel||frame.observation.sequence>latest.current.observation.sequence){if(aligning)setAligning(false);unknown('분석 화면 만료 또는 수집 변경');return;}
   if(e.data.type==='aligned'){
    setAlignment(e.data.result as CaptureAlignment);setAligning(false);setStatus('캡처 영역 보정 완료 · 영상 방향 비교를 시작하세요.');return;
   }
   const estimate=e.data.result as Estimate;
   if(!estimate||!Number.isFinite(estimate.pose?.headingDeg)||!Number.isFinite(estimate.fitRmsPx)){unknown('분석 응답 오류');return;}
   const previous=history.current;consecutive.current=previous&&angularDistance(previous.pose.headingDeg,estimate.pose.headingDeg)<=3&&Math.abs(previous.pose.pitchDeg-estimate.pose.pitchDeg)<=3&&Math.abs(previous.pose.horizontalFovDeg/estimate.pose.horizontalFovDeg-1)<=.05?consecutive.current+1:1;history.current=estimate;
   if(consecutive.current<2){setResult(null);setStatus('방향 미확인 · 첫 영상 대응 후보, 다음 화면으로 확인 중');callbacks.current.onStop();return;}
   resultExpiresAt.current=Date.parse(frame.observation.capturedAt!)+4000;setResult(estimate);setStatus('영상 대응 추정 · 기준 시점의 정확도 미검증');
   if(auto.current&&callbacks.current.mapReady){const request=++viewRequest.current;setMapError('');void callbacks.current.onView({pose:estimate.pose,aspect:estimate.analysisWidth/estimate.analysisHeight,capturedAt:frame.observation.capturedAt!}).catch(e=>{if(mounted.current&&auto.current&&viewRequest.current===request){setMapError((e as Error).message);callbacks.current.onStop();}});}
  };
  w.onerror=()=>{if(worker.current===w){dispose();setRunning(false);setAligning(false);unknown('로컬 영상 비교 모듈 오류');}};
  w.postMessage({id:init,type:'reference',blob:reference,pose:orientation,aspect:orientation.reference.width/orientation.reference.height,alignment:aligning?null:alignment});
  return()=>{if(worker.current===w)dispose();};
 },[running,aligning,reference,confirmed]);
 useEffect(()=>{
  if(!running||!confirmed||!props.frame||!fresh(props.frame)||props.frame.observation.lowContrast){if(running)unknown('수집 중지·만료·저대비 영상');return;}
  const f=props.frame,identity=f.observation.sessionId+':'+f.observation.sequence;
  if(!prepared.current||busy.current||identity===lastIdentity.current)return;
  lastIdentity.current=identity;busy.current=true;jobFrame.current=f;jobEpoch.current=analysisEpoch.current;const id=crypto.randomUUID();ticket.current=id;
  timeout.current=setTimeout(()=>{dispose();setRunning(false);unknown('영상 분석 시간 초과');},3500);
  worker.current!.postMessage({id,type:'frame',blob:f.blob});
 },[props.frame,running,confirmed]);
 useEffect(()=>{viewRequest.current++;if(!autoMap)callbacks.current.onStop();},[autoMap]);
 useEffect(()=>{if(!props.mapReady){setAutoMap(false);callbacks.current.onStop();}},[props.mapReady]);
 const valid=orientation?.status==='estimate'&&!!props.position&&props.position.lat===orientation.positionAtCalibration.lat&&props.position.lon===orientation.positionAtCalibration.lon;
 return <section className="visual-tracking" aria-label="영상 방향 추정 시험"><h3>영상 방향 추정 시험</h3>
  <p>선택 지도 카메라: {props.position?.name??'없음'}<br/>수집 이름: {props.frame?.observation.cameraLabel??'미수집'}</p>
  <p className="help">원본 사진과 현재 화면을 이 PC 안에서 비교합니다. 기준 수동 시점의 오차를 포함하는 추정이며 실제 PTZ 수신값이 아닙니다.</p>
  {!valid?<p>선택 카메라에 유효한 수동 보정 시안을 먼저 불러오세요.</p>:<>
   <label>추적 기준 원본 사진<input type="file" accept="image/png,image/jpeg,image/webp" disabled={running||aligning} onChange={e=>{void load(e.target.files?.[0]);e.target.value='';}}/></label><p role="status">{referenceStatus}</p>
   <label className="inline"><input type="checkbox" checked={confirmed} disabled={!props.frame||running||aligning} onChange={e=>setConfirmed(e.target.checked)}/>수집 화면이 선택한 카메라의 라이브 영상과 일치함을 확인</label>
   <fieldset><legend>캡처 영역 보정 (필요할 때 한 번)</legend>
    <p className="help">캡처 비율이 달라도 비교합니다. 잘림·늘어짐 때문에 대응이 실패하면 기준 사진과 같은 방향·줌에서 영역을 맞추세요. 같은 카메라여도 다른 방향·줌에서는 맞추지 마세요.</p>
    <label className="inline"><input type="checkbox" checked={sameView} disabled={!reference||!confirmed||running||aligning} onChange={e=>setSameView(e.target.checked)}/>기준 사진과 현재 영상의 방향·줌이 같음을 확인</label>
    <button disabled={!reference||!confirmed||!sameView||!fresh(props.frame)||running||aligning} onClick={()=>{setAlignment(null);setAutoMap(false);unknown('캡처 영역 보정 준비');setAligning(true);}}>캡처 영역 맞추기</button>{' '}
    <button disabled={!alignment||running||aligning} onClick={()=>{setAlignment(null);setSameView(false);unknown('캡처 영역 보정 해제');}}>캡처 영역 보정 해제</button>
    {alignment&&<p role="status">캡처 영역 보정 사용 중 · 계산 RMS {alignment.fitRmsPx.toFixed(2)}px / 검증 RMS {alignment.validationRmsPx.toFixed(2)}px · 영역을 다시 선택하거나 SSM 배치를 바꾸면 다시 맞추세요.</p>}
   </fieldset>
   <button disabled={!reference||!confirmed||!fresh(props.frame)||running||aligning} onClick={()=>setRunning(true)}>영상 방향 비교 시작</button>{' '}
   <button disabled={!running&&!aligning} onClick={()=>{setRunning(false);setAligning(false);setAutoMap(false);unknown('비교 중지');}}>영상 방향 비교 중지</button>
   <label className="inline"><input type="checkbox" checked={autoMap} disabled={!running||!props.mapReady} onChange={e=>setAutoMap(e.target.checked)}/>대응 검증 시 지도 시점 자동 갱신</label>
  </>}
  <p role="status">{status}</p>
  {result&&<p>방위각 {result.pose.headingDeg.toFixed(2)}° · 기울기 {result.pose.pitchDeg.toFixed(2)}° · 수평 화각 {result.pose.horizontalFovDeg.toFixed(2)}°<br/>계산 대응 {result.trainingCount}개 / 독립 검증 {result.validationCount}개<br/>계산 RMS {result.fitRmsPx.toFixed(2)}px / 검증 RMS {result.validationRmsPx.toFixed(2)}px · 분석 폭 {result.analysisWidth}px</p>}
  {mapError&&<p role="alert">지도 갱신 실패: {mapError}</p>}
  <p className="help">대응 실패·수집 만료·가림 시 방향은 미확인으로 돌아갑니다. 지도 설정에 자동 저장하지 않습니다. 재생 영상 여부는 SSM에서 직접 확인하세요.</p>
 </section>;
}
