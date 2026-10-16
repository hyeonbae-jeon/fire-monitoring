import {useEffect,useId,useRef,useState} from 'react';
import type {Landmark,ManualOrientation,Pose} from './calibration-model';
import {DEFAULT_TRIAL_CAMERA_HEIGHT_M} from './calibration-model';
import type {Position} from './map-model';

export type PreviewRequest = {position:Position;pose:Pose;groundElevationM:number|null;aspectRatio:number|null};
export type PreviewGround = {groundElevationM:number;groundElevationSource:'map-terrain'|'operator'};
type ImageReference = {url:string;sha256:string;width:number;height:number};
type Props = {position:Position;ready:boolean;previewEpoch:number;onPreview:(request:PreviewRequest)=>Promise<PreviewGround>;onAspect:(aspect:number|null)=>void;onSave:(orientation:ManualOrientation)=>void;onExit:()=>void};

export function TerrainCalibration({position,ready,previewEpoch,onPreview,onAspect,onSave,onExit}:Props){
  const previous=position.orientation;
  const [pose,setPose]=useState<Pose>({headingDeg:previous?.headingDeg??0,pitchDeg:previous?.pitchDeg??0,horizontalFovDeg:previous?.horizontalFovDeg??60,cameraHeightM:previous?.cameraHeightM??DEFAULT_TRIAL_CAMERA_HEIGHT_M});
  const [image,setImage]=useState<ImageReference|null>(null),[landmarks,setLandmarks]=useState<Landmark[]>([]);
  const [capturedAt,setCapturedAt]=useState(''),[groundInput,setGroundInput]=useState('');
  const [groundMode,setGroundMode]=useState<'map'|'operator'>('map');
  const inputId=useId();
  const validCameraHeight=Number.isFinite(pose.cameraHeightM)&&pose.cameraHeightM>=.5&&pose.cameraHeightM<=100;
  const validGround=groundMode==='map'||(groundInput.trim()!==''&&Number.isFinite(Number(groundInput))&&Number(groundInput)>=-500&&Number(groundInput)<=9000);
  const [applied,setApplied]=useState<PreviewGround|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  const [autoApply,setAutoApply]=useState(false);
  const generation=useRef(0),url=useRef<string|null>(null),mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current++;if(url.current)URL.revokeObjectURL(url.current);onAspect(null);};},[]);
  useEffect(()=>{generation.current++;setApplied(null);setBusy(false);},[ready,previewEpoch]);
  useEffect(()=>{
    if(!autoApply||!ready||!validCameraHeight||!validGround)return;
    const timer=setTimeout(()=>void preview(),250);
    return()=>clearTimeout(timer);
  },[autoApply,ready,pose,groundMode,groundInput,image]);
  function invalidate(){generation.current++;setApplied(null);setBusy(false);setError('');setMessage('');}
  async function loadImage(file?:File){
    if(!file)return;const ticket=++generation.current;setApplied(null);setError('');setMessage('');setBusy(false);
    let nextUrl:string|null=null;
    try{
      if(file.size>10*1024*1024||!['image/png','image/jpeg','image/webp'].includes(file.type))throw new Error('10MB 이하의 PNG/JPEG/WebP 원본 화면을 선택하세요.');
      if(!crypto.subtle)throw new Error('참조 이미지 기록에는 HTTPS 또는 localhost 접속이 필요합니다.');
      nextUrl=URL.createObjectURL(file);const element=new Image();element.src=nextUrl;await element.decode();
      if(element.naturalWidth*element.naturalHeight>36_000_000)throw new Error('이미지는 3,600만 픽셀 이하여야 합니다.');
      const hash=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());
      if(!mounted.current||generation.current!==ticket){URL.revokeObjectURL(nextUrl);return;}
      if(url.current)URL.revokeObjectURL(url.current);url.current=nextUrl;
      setImage({url:nextUrl,sha256:Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join(''),width:element.naturalWidth,height:element.naturalHeight});
      setLandmarks([]);setCapturedAt('');onAspect(element.naturalWidth/element.naturalHeight);
    }catch(e){if(nextUrl)URL.revokeObjectURL(nextUrl);if(mounted.current&&generation.current===ticket)setError((e as Error).message);}
  }
  async function preview(){
    const ticket=++generation.current;setBusy(true);setApplied(null);setError('');setMessage('');
    try{
      if(!validCameraHeight)throw new Error('설치 높이를 0.5~100m로 입력하세요.');
      if(!validGround)throw new Error('지도 지면 고도는 -500~9000m 범위의 숫자를 입력하세요.');
      const ground=groundMode==='map'?null:Number(groundInput);
      const result=await onPreview({position,pose,groundElevationM:ground,aspectRatio:image?image.width/image.height:null});
      if(mounted.current&&generation.current===ticket){setApplied(result);setMessage('가상 시점 적용 완료 · 지형/기준점을 화면과 대조하세요.');}
    }catch(e){if(mounted.current&&generation.current===ticket)setError((e as Error).message);}
    finally{if(mounted.current&&generation.current===ticket)setBusy(false);}
  }
  function save(){
    if(!image||!applied)return;
    try{
      const time=new Date(capturedAt);if(!capturedAt||!Number.isFinite(time.getTime()))throw new Error('참조 화면 촬영 시각을 입력하세요.');
      if(landmarks.length<2||landmarks.some(p=>!p.label.trim()))throw new Error('화면에서 식별한 기준점 2개 이상과 이름을 기록하세요.');
      onSave({...pose,...applied,source:'manual-calibration',status:'estimate',confidence:'unvalidated',
        positionAtCalibration:{lat:position.lat,lon:position.lon},calibratedAt:new Date().toISOString(),
        reference:{sha256:image.sha256,capturedAt:time.toISOString(),width:image.width,height:image.height},landmarks});
      setError('');setMessage('영상·지형 추정값을 지도 설정에 반영했습니다. 중앙 저장 또는 JSON 다운로드로 보관하세요.');
    }catch(e){setError((e as Error).message);}
  }
  const control=(field:keyof Pose,value:number)=>{invalidate();setPose(p=>({...p,[field]:value}));};
  return <section className="calibration map-stage" aria-label="영상 지형 보정">
    <details className="map-floating reference-panel" open><summary>참조 영상 · {position.name}</summary>
    <p className="help">현재 방향은 미확인입니다. 참조 화면의 지형을 지도와 대조하세요.</p>
    <label>참조 CCTV 이미지<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>{void loadImage(e.target.files?.[0]);e.target.value='';}}/></label>
    <p className="help">이미지는 이 브라우저에서 표시하며 이 앱이 업로드하지 않습니다. 설정에는 이미지 해시·크기·촬영 시각과 기준점만 남습니다.</p>
    <div className="reference-view">{image?<div className="reference-image" style={{aspectRatio:image.width/image.height}} onClick={e=>{
      if(landmarks.length>=20)return;const box=e.currentTarget.getBoundingClientRect();
      const x=Math.max(0,Math.min(1,(e.clientX-box.left)/box.width)),y=Math.max(0,Math.min(1,(e.clientY-box.top)/box.height));
      if(landmarks.some(p=>Math.hypot(p.x-x,p.y-y)<.002))return;
      setLandmarks(p=>[...p,{label:'기준점 '+(p.length+1),x,y}]);setMessage('');
    }}><img src={image.url} alt="보정용 참조 CCTV 화면" draggable={false}/>{landmarks.map((p,i)=><span key={i} className="reference-point" style={{left:p.x*100+'%',top:p.y*100+'%'}}>{i+1}</span>)}</div>:<div className="reference-placeholder">단독 주간 화면을 선택하면 여기에 표시됩니다.</div>}</div>
    {image&&<><label>참조 화면 촬영 시각<input type="datetime-local" value={capturedAt} onChange={e=>setCapturedAt(e.target.value)}/></label>
      <div className="landmarks">{landmarks.map((p,i)=><div key={i}><label>{i+1}번 기준점 이름<input value={p.label} maxLength={100} onChange={e=>setLandmarks(points=>points.map((point,index)=>index===i?{...point,label:e.target.value}:point))}/></label><button onClick={()=>setLandmarks(points=>points.filter((_,index)=>index!==i))}>기준점 {i+1} 삭제</button></div>)}</div></>}
    </details>
    <details className="map-floating pose-panel" open><summary>지도 안에서 가상 시점 조정</summary>
    <p className="help">브라우저 지도만 조정합니다. 카메라를 움직이지 않습니다.</p>
    {position.positionSource==='synthetic'&&<p className="help">임의 시험 위치입니다. 보정값 저장에는 실제 설치 위치가 필요합니다.</p>}
    <label className="inline"><input type="checkbox" checked={autoApply} onChange={e=>setAutoApply(e.target.checked)}/>슬라이더 자동 적용</label>
    <div className="pose-controls">
      <label>가상 방위각 {pose.headingDeg}° · 북=0°, 동=90°<input aria-label="가상 방위각" type="range" min={0} max={359} step={1} value={pose.headingDeg} onChange={e=>control('headingDeg',Number(e.target.value))}/></label>
      <label>가상 기울기 {pose.pitchDeg}° · 위=양수, 아래=음수<input aria-label="가상 기울기" type="range" min={-80} max={80} step={1} value={pose.pitchDeg} onChange={e=>control('pitchDeg',Number(e.target.value))}/></label>
      <label>가상 수평 화각 {pose.horizontalFovDeg}°<input aria-label="가상 수평 화각" type="range" min={5} max={120} value={pose.horizontalFovDeg} onChange={e=>control('horizontalFovDeg',Number(e.target.value))}/></label>
      <label>가상 설치 높이(m) · 지면에서 렌즈까지<input aria-label="가상 설치 높이(m)" aria-invalid={!validCameraHeight} aria-describedby={inputId+'-lens-help'} type="number" min={.5} max={100} step={.5} value={Number.isFinite(pose.cameraHeightM)?pose.cameraHeightM:''} onChange={e=>control('cameraHeightM',e.target.value===''?NaN:Number(e.target.value))}/></label>
      <p id={inputId+'-lens-help'} className={validCameraHeight?'help':'error'}>{validCameraHeight?'지면 고도와 별개입니다. 실제 높이를 모르면 시험값으로 비교하세요.':'설치 높이를 0.5~100m로 입력하세요. 빈칸이나 0m에서는 시점을 적용하지 않습니다.'}</p>
      <fieldset className="ground-height-mode"><legend>지도 지면 고도 설정</legend>
        <label className="inline"><input type="radio" name={inputId+'-ground-mode'} checked={groundMode==='map'} onChange={()=>{invalidate();setGroundMode('map');}}/>지도에서 자동 조회 (권장)</label>
        <label className="inline"><input type="radio" name={inputId+'-ground-mode'} checked={groundMode==='operator'} onChange={()=>{invalidate();setGroundMode('operator');}}/>직접 고도 입력</label>
        {groundMode==='operator'&&<><label>지도 지면 고도(m)<input aria-invalid={!validGround} type="number" min={-500} max={9000} value={groundInput} onChange={e=>{invalidate();setGroundInput(e.target.value);}} placeholder="지도 기준 지면 고도"/></label><p className={validGround?'help':'error'}>{validGround?'0m는 지도 기준 고도 0m를 직접 지정합니다. 자동 조회가 아닙니다.':'지도 지면 고도를 -500~9000m로 입력하거나 자동 조회를 선택하세요.'}</p></>}
        <p className="help">지도 기준 지면의 고도입니다. 위의 렌즈 설치 높이와 다릅니다. 자동 조회에 실패하면 높이를 임의로 채우지 않습니다.</p>
      </fieldset>
    </div>
    <p className="help">초기 각도와 새 시점의 설치 높이 3m는 가상 시험값입니다. 시점 적용 중 지도 마우스 이동은 잠기며 일반 지도 보기로 해제합니다.</p>
    <div className="calibration-actions"><button disabled={!ready||busy||!validCameraHeight||!validGround} onClick={()=>void preview()}>가상 시점 적용</button><button disabled={!applied||!image||!ready||busy||position.positionSource!=='operator'} onClick={save}>추정 방향을 설정에 반영</button><button onClick={()=>{setAutoApply(false);invalidate();onExit();}}>일반 지도 보기</button></div>
    {applied&&<p>지도 지면 높이 {applied.groundElevationM.toFixed(1)}m · {applied.groundElevationSource==='map-terrain'?'로드된 지형 참고값':'사용자 입력값'}</p>}
    {error&&<p role="alert" className="error">{error}</p>}{message&&<p role="status">{message}</p>}
    {previous&&<div className="saved-orientation"><p><strong>{previous.status==='stale'?'보정 무효 · 방향 UNKNOWN':'저장된 영상·지형 추정'}</strong> · 방위 {previous.headingDeg}° / 기울기 {previous.pitchDeg}° / 화각 {previous.horizontalFovDeg}°<br/>참조 화면 {new Date(previous.reference.capturedAt).toLocaleString()} · 정확도 미검증 · 실시간 방향 확인 안 됨</p><button disabled={previous.status==='stale'} onClick={()=>{invalidate();onSave({...previous,status:'stale'});}}>화면 방향·줌 변경으로 보정 무효화</button></div>}
    </details>
  </section>;
}
