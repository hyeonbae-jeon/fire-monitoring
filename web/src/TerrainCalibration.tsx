import {useEffect,useRef,useState,type ReactNode} from 'react';
import type {Landmark,ManualOrientation,Pose} from './calibration-model';
import type {Position} from './map-model';

export type PreviewRequest = {position:Position;pose:Pose;groundElevationM:number|null;aspectRatio:number};
export type PreviewGround = {groundElevationM:number;groundElevationSource:'map-terrain'|'operator'};
type ImageReference = {url:string;sha256:string;width:number;height:number};
type Props = {position:Position;mapPanel:ReactNode;ready:boolean;previewEpoch:number;onPreview:(request:PreviewRequest)=>Promise<PreviewGround>;onAspect:(aspect:number|null)=>void;onSave:(orientation:ManualOrientation)=>void;onExit:()=>void};

export function TerrainCalibration({position,mapPanel,ready,previewEpoch,onPreview,onAspect,onSave,onExit}:Props){
  const previous=position.orientation;
  const [pose,setPose]=useState<Pose>({headingDeg:previous?.headingDeg??0,pitchDeg:previous?.pitchDeg??0,horizontalFovDeg:previous?.horizontalFovDeg??60,cameraHeightM:previous?.cameraHeightM??5});
  const [image,setImage]=useState<ImageReference|null>(null),[landmarks,setLandmarks]=useState<Landmark[]>([]);
  const [capturedAt,setCapturedAt]=useState(''),[groundInput,setGroundInput]=useState('');
  const [applied,setApplied]=useState<PreviewGround|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  const generation=useRef(0),url=useRef<string|null>(null),mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current++;if(url.current)URL.revokeObjectURL(url.current);onAspect(null);};},[]);
  useEffect(()=>{generation.current++;setApplied(null);setBusy(false);},[ready,previewEpoch]);
  function invalidate(){generation.current++;setApplied(null);setBusy(false);setMessage('');}
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
    if(!image)return;const ticket=++generation.current;setBusy(true);setApplied(null);setError('');setMessage('');
    try{
      const ground=groundInput.trim()===''?null:Number(groundInput);
      if(ground!==null&&(!Number.isFinite(ground)||ground< -500||ground>9000))throw new Error('지도 지면 높이는 -500~9000m 범위여야 합니다.');
      const result=await onPreview({position,pose,groundElevationM:ground,aspectRatio:image.width/image.height});
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
  return <section className="calibration notice" aria-label="영상 지형 보정">
    <h2>영상·지형으로 방향 맞추기 · {position.name}</h2>
    <p>같은 방향·줌의 단독 주간 화면을 선택하세요. 이미지에서 봉우리·능선·건물 등 기준점을 클릭하고 이름을 적은 뒤, 옆의 가상 시점을 맞춥니다. 저장 결과는 정확도를 검증하지 않은 추정입니다.</p>
    {position.positionSource==='synthetic'&&<p className="error">실제 설치 위치를 먼저 추가하세요. 시험 좌표에는 보정값을 저장하지 않습니다.</p>}
    <label>참조 CCTV 이미지<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>{void loadImage(e.target.files?.[0]);e.target.value='';}}/></label>
    <p className="help">이미지는 이 브라우저에서 표시하며 이 앱이 업로드하지 않습니다. 설정에는 이미지 해시·크기·촬영 시각과 기준점만 남습니다.</p>
    <div className="calibration-views"><div>{image?<div className="reference-image" style={{aspectRatio:image.width/image.height}} onClick={e=>{
      if(landmarks.length>=20)return;const box=e.currentTarget.getBoundingClientRect();
      const x=Math.max(0,Math.min(1,(e.clientX-box.left)/box.width)),y=Math.max(0,Math.min(1,(e.clientY-box.top)/box.height));
      if(landmarks.some(p=>Math.hypot(p.x-x,p.y-y)<.002))return;
      setLandmarks(p=>[...p,{label:'기준점 '+(p.length+1),x,y}]);setMessage('');
    }}><img src={image.url} alt="보정용 참조 CCTV 화면" draggable={false}/>{landmarks.map((p,i)=><span key={i} className="reference-point" style={{left:p.x*100+'%',top:p.y*100+'%'}}>{i+1}</span>)}</div>:<div className="reference-placeholder">참조 이미지 대기 · 먼저 가상 지형과 비교할 화면을 선택하세요.</div>}</div>{mapPanel}</div>
    {image&&<><label>참조 화면 촬영 시각<input type="datetime-local" value={capturedAt} onChange={e=>setCapturedAt(e.target.value)}/></label>
      <div className="landmarks">{landmarks.map((p,i)=><div key={i}><label>{i+1}번 기준점 이름<input value={p.label} maxLength={100} onChange={e=>setLandmarks(points=>points.map((point,index)=>index===i?{...point,label:e.target.value}:point))}/></label><button onClick={()=>setLandmarks(points=>points.filter((_,index)=>index!==i))}>기준점 {i+1} 삭제</button></div>)}</div></>}
    <div className="pose-controls">
      <label>가상 방위각 {pose.headingDeg}° · 북=0°, 동=90°<input aria-label="가상 방위각" type="range" min={0} max={359} step={1} value={pose.headingDeg} onChange={e=>control('headingDeg',Number(e.target.value))}/></label>
      <label>가상 기울기 {pose.pitchDeg}° · 위=양수, 아래=음수<input aria-label="가상 기울기" type="range" min={-80} max={80} step={1} value={pose.pitchDeg} onChange={e=>control('pitchDeg',Number(e.target.value))}/></label>
      <label>가상 수평 화각 {pose.horizontalFovDeg}°<input aria-label="가상 수평 화각" type="range" min={5} max={120} value={pose.horizontalFovDeg} onChange={e=>control('horizontalFovDeg',Number(e.target.value))}/></label>
      <label>가상 설치 높이(m)<input aria-label="가상 설치 높이(m)" type="number" min={.5} max={100} step={.5} value={pose.cameraHeightM} onChange={e=>control('cameraHeightM',Number(e.target.value))}/></label>
      <label>지도 지면 높이(m, 선택 입력)<input type="number" min={-500} max={9000} value={groundInput} onChange={e=>{invalidate();setGroundInput(e.target.value);}} placeholder="비우면 로드된 지도 지형 사용"/></label>
    </div>
    <p className="help">슬라이더 초기값은 가상 시험값입니다. 지형 높이·화각·기울기는 실측 PTZ가 아닙니다. 수동 높이는 지도 높이 기준과 맞아야 합니다. 가상 시점에서는 지도 마우스 이동을 잠시 잠그고 슬라이더로 조정합니다.</p>
    <div className="calibration-actions"><button disabled={!ready||!image||busy||position.positionSource!=='operator'||!Number.isFinite(pose.cameraHeightM)||pose.cameraHeightM<.5||pose.cameraHeightM>100} onClick={()=>void preview()}>가상 시점 적용</button><button disabled={!applied||!image||!ready||busy||position.positionSource!=='operator'} onClick={save}>추정 방향을 설정에 반영</button><button onClick={()=>{invalidate();onExit();}}>일반 지도 보기</button></div>
    {applied&&<p>지도 지면 높이 {applied.groundElevationM.toFixed(1)}m · {applied.groundElevationSource==='map-terrain'?'로드된 지형 참고값':'사용자 입력값'}</p>}
    {error&&<p role="alert" className="error">{error}</p>}{message&&<p role="status">{message}</p>}
    {previous&&<div className="saved-orientation"><p><strong>{previous.status==='stale'?'보정 무효 · 방향 UNKNOWN':'저장된 영상·지형 추정'}</strong> · 방위 {previous.headingDeg}° / 기울기 {previous.pitchDeg}° / 화각 {previous.horizontalFovDeg}°<br/>참조 화면 {new Date(previous.reference.capturedAt).toLocaleString()} · 정확도 미검증 · 실시간 방향 확인 안 됨</p><button disabled={previous.status==='stale'} onClick={()=>{invalidate();onSave({...previous,status:'stale'});}}>화면 방향·줌 변경으로 보정 무효화</button></div>}
  </section>;
}
