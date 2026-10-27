import {useEffect,useRef,useState,type MouseEvent} from 'react';
import './LiveCapture.css';
import {DirectSnapshotConnection} from './DirectSnapshotConnection';
import {DevicePtzStatus,type DevicePtz,type DevicePtzObservation} from './DevicePtzStatus';

export type Observation = {
 sessionId:string;cameraLabel:string;status:string;reasonCode:string;capturedAt:string|null;sequence:number;
 sceneChanged:boolean;lowContrast:boolean;referenceDifference:number|null;
};
export type CapturedFrame={blob:Blob;observation:Observation};
type CaptureStatus = {configured:boolean;status:string;reasonCode?:string;liveFrameAvailable:boolean;observation:Observation|null;directionStatus:'unknown';automaticDirectionTrackingImplemented:false;devicePtz?:DevicePtz};
const reason=(s:CaptureStatus)=>{
 const direct:Record<string,string>={'not-connected':'직접 연결할 카메라의 JPEG 주소와 장비 계정을 입력하세요.','user-stopped':'영상 연결이 종료되었습니다.','viewer-inactive':'영상 조회가 없어 직접 연결을 자동 종료했습니다. 다시 연결하세요.','authentication-denied':'장비 인증 또는 접근 권한이 거절됐습니다. 계정과 허용 IP를 확인하세요.','camera-timeout':'카메라 영상 수신 시간이 초과됐습니다. 다시 연결해 주세요.','camera-unreachable':'카메라에 연결할 수 없습니다. 주소·접근 권한·HTTPS 인증서를 확인하세요.','not-jpeg':'JPEG가 아닌 응답을 받았습니다. 실제 스냅샷 요청을 확인하세요.','invalid-jpeg':'수신 이미지의 JPEG 헤더나 크기를 확인할 수 없습니다.','redirect-rejected':'장비가 다른 주소로 이동을 요청했습니다. 최종 장비의 JPEG 주소를 확인하세요.','camera-http-error':'장비의 JPEG 요청이 실패했습니다. 주소와 권한을 확인하세요.','frame-too-large':'수신 이미지가 허용 크기 6MB를 넘었습니다.'};
 if(s.reasonCode&&direct[s.reasonCode]&&!s.liveFrameAvailable)return direct[s.reasonCode];
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

export function LiveCapture({active,desktopDemo,embedded=false,cameraLabel,onFrame,onPtz}:{active:boolean;desktopDemo:boolean;embedded?:boolean;cameraLabel?:string;onFrame?:(frame:CapturedFrame|null)=>void;onPtz?:(value:DevicePtzObservation|null)=>void}){
 const frameListener=useRef(onFrame);frameListener.current=onFrame;
 const ptzListener=useRef(onPtz);ptzListener.current=onPtz;
 const downloadable=useRef<{blob:Blob;capturedAt:string}|null>(null);
 const [key,setKey]=useState(''),[running,setRunning]=useState(false),[snapshot,setSnapshot]=useState<CaptureStatus|null>(null);
 const [image,setImage]=useState<string|null>(null),[error,setError]=useState('');
 const [source,setSource]=useState<'screen'|'direct'|'nvt'>('screen');
 const direct=source!=='screen';
 useEffect(()=>{if(desktopDemo)setKey('local-demo-only');},[desktopDemo]);
 useEffect(()=>{if(!active)setRunning(false);},[active]);
 useEffect(()=>{
  if(!active||!running){setImage(null);frameListener.current?.(null);ptzListener.current?.(null);return;}
  let cancelled=false,blobUrl:string|null=null,lastFrame='',expiresAt=0,timer:ReturnType<typeof setTimeout>|undefined;
  const controller=new AbortController();
  const endpoint=direct?'/api/camera-snapshot':'/api/screen-capture';
  function clear(notify=true){if(blobUrl)URL.revokeObjectURL(blobUrl);blobUrl=null;lastFrame='';expiresAt=0;downloadable.current=null;if(!cancelled)setImage(null);if(notify){frameListener.current?.(null);ptzListener.current?.(null);}}
  function publishPtz(s:CaptureStatus){const o=s.observation;ptzListener.current?.(direct&&o&&s.devicePtz?{value:s.devicePtz,sessionId:o.sessionId,cameraLabel:o.cameraLabel}:null);}
  async function request(path:string){
   const r=await fetch(path,{headers:{'X-Capture-Read-Key':key},signal:controller.signal,cache:'no-store'});
   if(!r.ok)throw new Error(`화면 조회 실패 (HTTP ${r.status})`);return r;
  }
  async function poll(){
   try{
    const s=await (await request(endpoint+'/status')).json() as CaptureStatus;
    if(cancelled)return;setError('');
    if(!s.liveFrameAvailable||!s.observation){clear();setSnapshot(s);return;}
    const o=s.observation,identity=o.sessionId+':'+o.sequence;
    if(identity===lastFrame){setSnapshot(s);publishPtz(s);return;}
    // No key in image URLs; protected frames are fetched with a header.
    const r=await fetch(endpoint+'/frame?'+new URLSearchParams({sessionId:o.sessionId,sequence:String(o.sequence)}),
      {headers:{'X-Capture-Read-Key':key},signal:controller.signal,cache:'no-store'});
    if(r.status===409){clear();setSnapshot({...s,status:'waiting',liveFrameAvailable:false});return;}
    if(!r.ok)throw new Error(`화면 조회 실패 (HTTP ${r.status})`);
    const blob=await r.blob();if(cancelled)return;
    const capturedAt=Date.parse(o.capturedAt??'');
    if(!Number.isFinite(capturedAt)||Date.now()-capturedAt>4000||capturedAt>Date.now()+2000){clear();setSnapshot({...s,status:'stale',liveFrameAvailable:false});return;}
    clear(false);blobUrl=URL.createObjectURL(blob);lastFrame=identity;expiresAt=capturedAt+4000;downloadable.current={blob,capturedAt:o.capturedAt!};setSnapshot(s);setImage(blobUrl);frameListener.current?.({blob,observation:o});publishPtz(s);
   }catch(e){if(!cancelled){clear();setSnapshot(null);setError((e as Error).message);}}
   finally{if(!cancelled)timer=setTimeout(()=>void poll(),1000);}
  }
  setSnapshot(null);setError('');void poll();
  // Remove the displayed image even if a network call never completes.
  const expiry=setInterval(()=>{
    if(blobUrl&&!cancelled&&Date.now()>=expiresAt){clear();setSnapshot(s=>s?{...s,status:'stale',liveFrameAvailable:false}:s);}
  },250);
  return()=>{cancelled=true;controller.abort();if(timer)clearTimeout(timer);clearInterval(expiry);clear();};
 },[active,running,key,source]);
 const observation=snapshot?.observation;
 function saveReference(event:MouseEvent<HTMLAnchorElement>){
  event.preventDefault();const frame=downloadable.current;if(!frame)return;
  // A download must survive the next live frame revoking the displayed URL.
  const url=URL.createObjectURL(frame.blob),link=document.createElement('a');link.href=url;link.download='cctv-reference-'+new Date(frame.capturedAt).toISOString().replace(/[:.]/g,'-')+'.jpg';link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
 }
 const Container=embedded?'section':'main';
 const settings=<><label>{embedded?'지도 영상 조회 키':'영상 조회 키'}<input type="password" autoComplete="off" value={key} disabled={running} onChange={e=>setKey(e.target.value)}/></label>{desktopDemo&&<p>로컬 시험 패키지는 조회 키가 자동으로 입력됩니다.</p>}</>;
 return <Container className={embedded?'map-live-capture':'live-capture'}>
  <section className="notice"><h2>{embedded?'지도에서 실시간 영상 확인':'실시간 화면 수집 시험'}</h2>
   <label>영상 입력 방식<select value={source} disabled={running} onChange={e=>{setSnapshot(null);setError('');setSource(e.target.value as 'screen'|'direct'|'nvt');}}><option value="screen">SSM 화면 캡처</option><option value="direct">한화 카메라 직접 수신</option><option value="nvt">NVT STH775 직접 수신</option></select></label>
   {direct?<p>장비의 JPEG 영상을 약 1초 간격으로 직접 받습니다. 수신 시각은 이 PC 기준이며 원본 영상의 멈춤은 자동으로 판단하지 않습니다.</p>:embedded?<p>수집 도구가 선택한 SSM 영상 영역을 1초마다 확인합니다. 수집 시각은 PC 시간이며 SSM의 라이브 상태도 확인하세요.</p>:<><p>회사 PC에서 <strong>화면캡처.cmd</strong>를 실행하고 SSM 라이브 보기의 단독 CCTV 영상 영역을 선택하세요. 카메라 제어 없이 선택 영역을 1초마다 확인합니다.</p><p>수집 시각은 PC에서 화면을 읽은 시각입니다. 녹화 재생·멈춘 원본 영상을 자동으로 구분하지 않으므로 SSM의 라이브 상태도 확인하세요.</p></>}
   {direct?<p><strong>장비 원시 PTZ 수신</strong> · 각도 조회를 켜면 아래에 값을 표시합니다. 지도 영상 패널의 ‘장비 PTZ 근사 추종’에서 기준 방향을 정해 함께 움직여 볼 수 있습니다.</p>:<p><strong>장비에서 받은 현재 방향: 미확인</strong> · 화면 변화 감지는 회전·줌 측정이 아닙니다. 지도 영상 패널에서 별도 영상 대응 시험을 시작할 수 있습니다. 화면 캡처로는 실제 PTZ를 수신하지 않습니다.</p>}
   {embedded?<details open={!desktopDemo}><summary>영상 조회 설정</summary>{settings}</details>:settings}
   {direct&&<DirectSnapshotConnection key={source} nvt={source==='nvt'} active={active} readKey={key} cameraLabel={cameraLabel} sessionId={observation?.sessionId??''} viewing={running} ptzReceiving={snapshot?.devicePtz?.status==='live'&&!!snapshot.devicePtz.sample} onConnected={()=>setRunning(true)} onDisconnected={()=>{setRunning(false);setSnapshot(null);}}/>}
   <button disabled={!key||running} onClick={()=>setRunning(true)}>{embedded?'지도에서 라이브 확인':'라이브 화면 확인'}</button>{' '}
   <button disabled={!running} onClick={()=>{setRunning(false);setSnapshot(null);setError('');}}>{embedded?'지도 라이브 표시 중지':'라이브 표시 중지'}</button>
   <p className="help">{direct?'표시 중지 후 약 15초 동안 조회가 없으면 직접 연결이 종료됩니다. 즉시 중지하려면 직접 연결 종료를 누르세요.':'표시 중지는 브라우저 조회를 멈춥니다. 화면 수집 자체는 수집 도구에서 중지하세요.'}</p>
  </section>
  {error&&<p className="error" role="alert">{error}</p>}
  {direct&&<DevicePtzStatus active={active&&running} value={snapshot?.devicePtz}/>}
  <section className="live-observation" aria-label={embedded?'지도 수집 화면':'수집 화면'}>
   {image?<img src={image} alt={embedded?'지도에서 확인하는 최신 CCTV 화면':'읽기 전용으로 수집한 최신 CCTV 화면'} onError={()=>{setRunning(false);setSnapshot(null);setImage(null);setError('수집한 이미지를 표시할 수 없습니다. 수집 도구를 확인하세요.');}}/>:<p role="status">{running?(snapshot?reason(snapshot):'화면 수집 상태 확인 중…'):embedded?'지도에서 라이브 확인을 눌러 시작하세요.':'라이브 화면 확인을 눌러 시작하세요.'}</p>}
   {observation&&<p>입력한 카메라 이름: {observation.cameraLabel} · 화면 {observation.sequence}장<br/>최근 수집 시각: {observation.capturedAt?new Date(observation.capturedAt).toLocaleString():'미수집'} · 방향 미확인</p>}
   {image&&observation?.capturedAt&&<a className="capture-download" href={image} onClick={saveReference} download={'cctv-reference-'+new Date(observation.capturedAt).toISOString().replace(/[:.]/g,'-')+'.jpg'}>참조 화면 저장</a>}
   {image&&observation?.sceneChanged&&<p className="error" role="status">화면 변화 감지 · 기준 사진 시점은 현재 방향을 확정하지 못합니다. 장비에서 받은 새 방향은 미확인입니다. 영상 추정 결과는 별도 시험에서 확인하세요.</p>}
   {image&&observation?.lowContrast&&<p>검은 화면 또는 저대비 영상일 수 있습니다. SSM 원본 영상과 캡처 결과를 비교해 주세요.</p>}
  </section>
 </Container>;
}
