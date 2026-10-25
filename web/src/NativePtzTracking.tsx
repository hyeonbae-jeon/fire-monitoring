import {useEffect,useRef,useState} from 'react';
import type {Position} from './map-model';
import type {CapturedFrame} from './LiveCapture';
import type {DevicePtzObservation} from './DevicePtzStatus';
import type {PreviewRequest} from './TerrainCalibration';
import type {LiveVisualView} from './VisualTracking';
import {approximateNativePose,type NativeAnchor} from './native-approximation';

type Props={position:Position|undefined;frame:CapturedFrame|null;device:DevicePtzObservation|null;initial:PreviewRequest|null;mapReady:boolean;onView:(view:LiveVisualView)=>Promise<void>;onStop:()=>void};
const recent=(t:string|undefined,now:number)=>{const n=Date.parse(t??'');return Number.isFinite(n)&&now-n<4000&&n-now<=2000;};
export function NativePtzTracking(props:Props){
 const initial=props.initial,old=props.position?.orientation;
 const [heading,setHeading]=useState(initial?.pose.headingDeg??old?.headingDeg??0),[pitch,setPitch]=useState(initial?.pose.pitchDeg??old?.pitchDeg??0),[fov,setFov]=useState(initial?.pose.horizontalFovDeg??59),[height,setHeight]=useState(initial?.pose.cameraHeightM??old?.cameraHeightM??3);
 const [ground,setGround]=useState(String(initial?.groundElevationM??old?.groundElevationM??''));
 const [confirmed,setConfirmed]=useState(false),[anchor,setAnchor]=useState<(NativeAnchor&{sessionId:string;cameraLabel:string})|null>(null),[zoomScale,setZoomScale]=useState(true),[aspect,setAspect]=useState<number|null>(null),[now,setNow]=useState(Date.now()),[hidden,setHidden]=useState(document.hidden),[error,setError]=useState('');
 const callback=useRef(props);callback.current=props;const ticket=useRef(0),mounted=useRef(true);
 const session=props.device?props.device.sessionId+':'+props.device.cameraLabel:'';
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;ticket.current++;callback.current.onStop();};},[]);
 useEffect(()=>{const t=setInterval(()=>setNow(Date.now()),250);const changed=()=>{setHidden(document.hidden);if(document.hidden){setAnchor(null);ticket.current++;callback.current.onStop();}};document.addEventListener('visibilitychange',changed);return()=>{clearInterval(t);document.removeEventListener('visibilitychange',changed);};},[]);
 useEffect(()=>{setAnchor(null);setConfirmed(false);setError('');ticket.current++;callback.current.onStop();},[session]);
 useEffect(()=>{let cancelled=false;setAspect(null);if(props.frame)void createImageBitmap(props.frame.blob).then(im=>{const a=im.width/im.height;im.close();if(!cancelled)setAspect(a);}).catch(()=>{});return()=>{cancelled=true;};},[props.frame?.observation.sessionId]);
 const sample=props.device?.value.sample;
 const fresh=!hidden&&props.device?.value.status==='live'&&!!sample&&recent(sample.receivedAt,now)&&!!props.frame&&recent(props.frame.observation.capturedAt??undefined,now)&&props.frame.observation.sessionId===props.device.sessionId&&props.frame.observation.cameraLabel===props.device.cameraLabel;
 const owns=!!anchor&&anchor.sessionId===props.device?.sessionId&&anchor.cameraLabel===props.device?.cameraLabel;
 useEffect(()=>{
  const id=++ticket.current;
  if(!owns||!fresh||!sample||!aspect||!props.mapReady){callback.current.onStop();return;}
  try{
   const pose=approximateNativePose(anchor!,sample,zoomScale);setError('');
   void callback.current.onView({source:'device-approximate',pose,aspect,capturedAt:sample.receivedAt,groundElevationM:ground.trim()===''?null:Number(ground)}).catch(e=>{if(mounted.current&&ticket.current===id){setError((e as Error).message);callback.current.onStop();}});
  }catch(e){setError((e as Error).message);callback.current.onStop();}
 },[props.device,owns,fresh,aspect,props.mapReady,anchor,zoomScale]);
 function start(){
  try{
   if(!fresh||!sample||!props.device||!confirmed||!props.position)throw new Error('같은 카메라의 최신 영상과 장비 값을 확인하세요.');
   if(!Number.isFinite(heading)||heading<0||heading>=360||!Number.isFinite(pitch)||!Number.isFinite(fov)||fov<5||fov>120||ground.trim()!==''&&(!Number.isFinite(Number(ground))||Number(ground)< -500||Number(ground)>9000))throw new Error('기준 각도·화각·지면 고도를 확인하세요.');
   const next={sample:{...sample},pose:{headingDeg:heading,pitchDeg:pitch,horizontalFovDeg:fov,cameraHeightM:height},sessionId:props.device.sessionId,cameraLabel:props.device.cameraLabel};approximateNativePose(next,sample,zoomScale);setError('');setAnchor(next);
  }catch(e){setError((e as Error).message);}
 }
 function stop(){setAnchor(null);ticket.current++;callback.current.onStop();}
 return <section aria-label="장비 PTZ 근사 추종"><h3>장비 PTZ 근사 추종</h3>
  <p>설치 위치는 그대로 두고 현재 장비 값을 기준으로 지도 시점이 함께 움직입니다. 지형 정합 검사 없이 운영자가 정한 기준 방향을 사용합니다.</p>
  <p>선택 카메라: {props.position?.name??'없음'} · 수신 이름: {props.device?.cameraLabel??'미수신'}</p>
  <fieldset disabled={!!anchor}><legend>현재 CCTV에 대응할 지도 기준 시점</legend>
   <label>시험 기준 방위각(°)<input type="number" value={Number.isFinite(heading)?heading:''} onChange={e=>setHeading(e.target.value===''?NaN:Number(e.target.value))}/></label>
   <label>시험 기준 기울기(°)<input type="number" value={Number.isFinite(pitch)?pitch:''} onChange={e=>setPitch(e.target.value===''?NaN:Number(e.target.value))}/></label>
   <label>시험 기준 수평 화각(°)<input type="number" value={Number.isFinite(fov)?fov:''} onChange={e=>setFov(e.target.value===''?NaN:Number(e.target.value))}/></label>
   <label>시험 렌즈 높이(m)<input type="number" value={Number.isFinite(height)?height:''} onChange={e=>setHeight(e.target.value===''?NaN:Number(e.target.value))}/></label>
   <label>시험 지도 지면 고도(m, 빈칸은 자동 조회)<input type="number" value={ground} onChange={e=>setGround(e.target.value)}/></label>
   <label><input type="checkbox" checked={confirmed} disabled={!fresh} onChange={e=>setConfirmed(e.target.checked)}/>선택 카메라의 현재 영상과 기준 시점을 확인</label>
  </fieldset>
  <label><input type="checkbox" checked={zoomScale} onChange={e=>setZoomScale(e.target.checked)}/>장비 Zoom 배율로 화각도 근사</label>
  <button disabled={!fresh||!confirmed||!props.mapReady||!aspect||!!anchor} onClick={start}>현재 PTZ를 기준으로 시험 추종 시작</button>{' '}
  <button disabled={!anchor} onClick={stop}>장비 추종 중지</button>
  <p role="status">{anchor?(fresh&&props.mapReady&&!error?'장비 PTZ 근사 추종 중 · 절대 방향 오차 허용':'장비 추종 일시 정지 · 최신 영상·PTZ·지도 상태를 확인하세요.'):'장비 추종 중지 · 기준 시점을 입력하세요.'}</p>
  {anchor&&<p>기준 장비 Pan {anchor.sample.panDeg.toFixed(2)}° · Tilt {anchor.sample.tiltDeg.toFixed(2)}° · Zoom {anchor.sample.zoom.toFixed(2)}</p>}
  {error&&<p role="alert">{error}</p>}
  <p className="help">지도 위치와 보정 설정은 자동 저장하지 않습니다. 세션·카메라 전환이나 탭 숨김은 시험을 종료합니다. 수신 만료·오류에는 지도 갱신을 멈춥니다. 줌 화각과 설치 축의 오차를 포함한 시험용 시점이며 정밀 좌표 판독용이 아닙니다.</p>
 </section>;
}
