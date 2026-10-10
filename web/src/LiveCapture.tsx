import {useEffect, useState} from 'react';
import './LiveCapture.css';

type Observation = {
 sessionId:string;cameraLabel:string;status:string;reasonCode:string;capturedAt:string|null;sequence:number;
 sceneChanged:boolean;lowContrast:boolean;referenceDifference:number|null;
};
type CaptureStatus = {configured:boolean;status:string;liveFrameAvailable:boolean;observation:Observation|null;directionStatus:'unknown';automaticDirectionTrackingImplemented:false};
const reason=(s:CaptureStatus)=>{
 if(s.status==='disabled')return '이 실행 환경에는 화면 수집이 설정되지 않았습니다.';
 if(s.status==='waiting')return '수집 도구에서 영상 영역을 선택하고 수집 시작을 누르세요.';
 if(s.status==='invalid')return '수집 상태를 읽을 수 없습니다. 수집 도구를 확인하세요.';
 if(s.status==='stale')return '최신 화면이 4초 이상 들어오지 않았거나 수집 시각을 확인할 수 없습니다.';
 if(s.observation?.reasonCode==='target-resized')return 'SSM 창 크기가 바뀌었습니다. 영상 영역을 다시 선택하세요.';
 if(s.observation?.reasonCode==='region-occluded')return '영상 영역에 다른 창이 겹쳐 수집이 일시 중지되었습니다.';
 if(s.observation?.reasonCode==='target-unavailable')return 'SSM 창이 닫히거나 최소화되어 수집이 일시 중지되었습니다.';
 if(s.observation?.reasonCode==='capture-error')return '화면 수집에 오류가 있습니다. 수집 도구를 확인하세요.';
 return s.status==='stopped'?'화면 수집이 중지되었습니다.':'최신 화면을 기다립니다.';
};

export function LiveCapture({active,desktopDemo}:{active:boolean;desktopDemo:boolean}){
 const [key,setKey]=useState(''),[running,setRunning]=useState(false),[snapshot,setSnapshot]=useState<CaptureStatus|null>(null);
 const [image,setImage]=useState<string|null>(null),[error,setError]=useState('');
 useEffect(()=>{if(desktopDemo)setKey('local-demo-only');},[desktopDemo]);
 useEffect(()=>{if(!active)setRunning(false);},[active]);
 useEffect(()=>{
  if(!active||!running){setImage(null);return;}
  let cancelled=false,blobUrl:string|null=null,lastFrame='',expiresAt=0,timer:ReturnType<typeof setTimeout>|undefined;
  const controller=new AbortController();
  function clear(){if(blobUrl)URL.revokeObjectURL(blobUrl);blobUrl=null;lastFrame='';expiresAt=0;if(!cancelled)setImage(null);}
  async function request(path:string){
   const r=await fetch(path,{headers:{'X-Capture-Read-Key':key},signal:controller.signal,cache:'no-store'});
   if(!r.ok)throw new Error(`화면 조회 실패 (HTTP ${r.status})`);return r;
  }
  async function poll(){
   try{
    const s=await (await request('/api/screen-capture/status')).json() as CaptureStatus;
    if(cancelled)return;setError('');
    if(!s.liveFrameAvailable||!s.observation){clear();setSnapshot(s);return;}
    const o=s.observation,identity=o.sessionId+':'+o.sequence;
    if(identity===lastFrame){setSnapshot(s);return;}
    // No key in image URLs; protected frames are fetched with a header.
    const r=await fetch('/api/screen-capture/frame?'+new URLSearchParams({sessionId:o.sessionId,sequence:String(o.sequence)}),
      {headers:{'X-Capture-Read-Key':key},signal:controller.signal,cache:'no-store'});
    if(r.status===409){clear();setSnapshot({...s,status:'waiting',liveFrameAvailable:false});return;}
    if(!r.ok)throw new Error(`화면 조회 실패 (HTTP ${r.status})`);
    const blob=await r.blob();if(cancelled)return;
    const capturedAt=Date.parse(o.capturedAt??'');
    if(!Number.isFinite(capturedAt)||Date.now()-capturedAt>4000||capturedAt>Date.now()+2000){clear();setSnapshot({...s,status:'stale',liveFrameAvailable:false});return;}
    clear();blobUrl=URL.createObjectURL(blob);lastFrame=identity;expiresAt=capturedAt+4000;setSnapshot(s);setImage(blobUrl);
   }catch(e){if(!cancelled){clear();setSnapshot(null);setError((e as Error).message);}}
   finally{if(!cancelled)timer=setTimeout(()=>void poll(),1000);}
  }
  setSnapshot(null);setError('');void poll();
  // Remove the displayed image even if a network call never completes.
  const expiry=setInterval(()=>{
    if(blobUrl&&!cancelled&&Date.now()>=expiresAt){clear();setSnapshot(s=>s?{...s,status:'stale',liveFrameAvailable:false}:s);}
  },250);
  return()=>{cancelled=true;controller.abort();if(timer)clearTimeout(timer);clearInterval(expiry);clear();};
 },[active,running,key]);
 const observation=snapshot?.observation;
 return <main className="live-capture">
  <section className="notice"><h2>실시간 화면 수집 시험</h2>
   <p>회사 PC에서 <strong>화면캡처.cmd</strong>를 실행하고 SSM 라이브 보기의 단독 CCTV 영상 영역을 선택하세요. 카메라 제어 없이 선택 영역을 1초마다 확인합니다.</p>
   <p>수집 시각은 PC에서 화면을 읽은 시각입니다. 녹화 재생·멈춘 원본 영상을 자동으로 구분하지 않으므로 SSM의 라이브 상태도 확인하세요.</p>
   <p><strong>현재 방향: 미확인</strong> · 화면 변화 감지는 회전·줌 측정이 아닙니다. 자동 방향 추적은 아직 구현되지 않았습니다.</p>
   <label>영상 조회 키<input type="password" autoComplete="off" value={key} disabled={running} onChange={e=>setKey(e.target.value)}/></label>
   {desktopDemo&&<p>로컬 시험 패키지는 조회 키가 자동으로 입력됩니다.</p>}
   <button disabled={!key||running} onClick={()=>setRunning(true)}>라이브 화면 확인</button>{' '}
   <button disabled={!running} onClick={()=>{setRunning(false);setSnapshot(null);setError('');}}>라이브 표시 중지</button>
   <p className="help">표시 중지는 브라우저 조회를 멈춥니다. 화면 수집 자체는 수집 도구에서 중지하세요.</p>
  </section>
  {error&&<p className="error" role="alert">{error}</p>}
  <section className="live-observation" aria-label="수집 화면">
   {image?<img src={image} alt="읽기 전용으로 수집한 최신 CCTV 화면" onError={()=>{setRunning(false);setSnapshot(null);setImage(null);setError('수집한 이미지를 표시할 수 없습니다. 수집 도구를 확인하세요.');}}/>:<p role="status">{running?(snapshot?reason(snapshot):'화면 수집 상태 확인 중…'):'라이브 화면 확인을 눌러 시작하세요.'}</p>}
   {observation&&<p>입력한 카메라 이름: {observation.cameraLabel} · 화면 {observation.sequence}장<br/>최근 수집 시각: {observation.capturedAt?new Date(observation.capturedAt).toLocaleString():'미수집'} · 방향 미확인</p>}
   {image&&observation?.capturedAt&&<a className="capture-download" href={image} download={'cctv-reference-'+new Date(observation.capturedAt).toISOString().replace(/[:.]/g,'-')+'.jpg'}>참조 화면 저장</a>}
   {image&&observation?.sceneChanged&&<p className="error" role="status">화면 변화 감지 · 기존 사진의 보정값을 현재 방향으로 사용할 수 없습니다. 새 방향은 미확인입니다.</p>}
   {image&&observation?.lowContrast&&<p>검은 화면 또는 저대비 영상일 수 있습니다. SSM 원본 영상과 캡처 결과를 비교해 주세요.</p>}
  </section>
 </main>;
}
