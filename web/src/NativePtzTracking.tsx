import {useEffect,useRef,useState} from 'react';
import type {Position} from './map-model';
import type {CapturedFrame} from './LiveCapture';
import type {DevicePtzObservation} from './DevicePtzStatus';
import type {PreviewRequest} from './TerrainCalibration';
import type {LiveVisualView} from './VisualTracking';
import {approximateNativePose,type NativeAnchor} from './native-approximation';
import {parseNativeProfile,type NativeProfile} from './native-profile';

type Props={position:Position|undefined;frame:CapturedFrame|null;device:DevicePtzObservation|null;initial:PreviewRequest|null;mapReady:boolean;onView:(view:LiveVisualView)=>Promise<void>;onStop:()=>void;onSave:(profile:NativeProfile|null)=>void};
const recent=(t:string|undefined,now:number)=>{const n=Date.parse(t??'');return Number.isFinite(n)&&now-n<4000&&n-now<=2000;};
export function NativePtzTracking(props:Props){
 const initial=props.initial,old=props.position?.orientation,saved=props.position?.nativeTracking,seed=initial?.pose??saved?.pose??old;
 const [heading,setHeading]=useState(seed?.headingDeg??0),[pitch,setPitch]=useState(seed?.pitchDeg??0),[fov,setFov]=useState(seed?.horizontalFovDeg??59),[height,setHeight]=useState(seed?.cameraHeightM??3);
 const [ground,setGround]=useState(String(initial?initial.groundElevationM??'':saved?saved.groundElevationM??'':old?.groundElevationM??''));
 const [confirmed,setConfirmed]=useState(false),[anchor,setAnchor]=useState<(NativeAnchor&{sessionId:string;cameraLabel:string})|null>(null),[zoomScale,setZoomScale]=useState(saved?.zoomScale??true),[aspect,setAspect]=useState<number|null>(null),[now,setNow]=useState(Date.now()),[hidden,setHidden]=useState(document.hidden),[error,setError]=useState(''),[saveMessage,setSaveMessage]=useState('');
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
 function resume(){
  try{
   if(!saved||!props.position||!props.device||!sample||!fresh||!confirmed)throw new Error('선택 카메라의 최신 영상·장비 값을 확인하세요.');
   const profile=parseNativeProfile(saved,props.position);approximateNativePose({sample:profile.deviceAnchor,pose:profile.pose},sample,profile.zoomScale);
   setHeading(profile.pose.headingDeg);setPitch(profile.pose.pitchDeg);setFov(profile.pose.horizontalFovDeg);setHeight(profile.pose.cameraHeightM);setGround(profile.groundElevationM===null?'':String(profile.groundElevationM));setZoomScale(profile.zoomScale);setError('');
   setAnchor({sample:{...profile.deviceAnchor},pose:{...profile.pose},sessionId:props.device.sessionId,cameraLabel:props.device.cameraLabel});
  }catch(e){setError((e as Error).message);}
 }
 function save(){
  try{
   if(!anchor||!owns||!fresh||!props.position||error)throw new Error('추종 중인 기준을 확인하세요.');
   const profile=parseNativeProfile({source:'operator-ptz-anchor',confidence:'approximate',savedAt:new Date().toISOString(),positionAtCalibration:{lat:props.position.lat,lon:props.position.lon},deviceAnchor:{panDeg:anchor.sample.panDeg,tiltDeg:anchor.sample.tiltDeg,zoom:anchor.sample.zoom},pose:{...anchor.pose},groundElevationM:ground.trim()===''?null:Number(ground),zoomScale},props.position);
   props.onSave(profile);setSaveMessage('근사 기준을 지도 설정에 반영했습니다. 카메라·설정에서 중앙 지도 설정 저장 또는 좌표 설정 다운로드로 보관하세요.');
  }catch(e){setError((e as Error).message);}
 }
 return <section aria-label="장비 PTZ 근사 추종"><h3>장비 PTZ 근사 추종</h3>
  <p>설치 위치는 그대로 두고 현재 장비 값을 기준으로 지도 시점이 함께 움직입니다. 지형 정합 검사 없이 운영자가 정한 기준 방향을 사용합니다.</p>
  <p>선택 카메라: {props.position?.name??'없음'} · 수신 이름: {props.device?.cameraLabel??'미수신'}</p>
  {saved&&<div><p>저장된 근사 기준 · Pan {saved.deviceAnchor.panDeg.toFixed(2)}° · Tilt {saved.deviceAnchor.tiltDeg.toFixed(2)}° · Zoom {saved.deviceAnchor.zoom.toFixed(2)}<br/>지도 방위각 {saved.pose.headingDeg}° · 기울기 {saved.pose.pitchDeg}° · 화각 {saved.pose.horizontalFovDeg}°</p>
   <button disabled={!fresh||!confirmed||!props.mapReady||!aspect||!!anchor} onClick={resume}>저장 기준으로 추종 재개</button>{' '}<button onClick={()=>{stop();props.onSave(null);setSaveMessage('저장 기준을 지도 설정에서 제거했습니다. 중앙 저장 또는 JSON으로 변경을 보관하세요.');}}>저장 근사 기준 삭제</button>
   <p className="help">재개는 원래 저장한 장비 기준을 사용합니다. 카메라가 다른 방향에 있어도 새로 기준을 잡을 필요가 없습니다.</p></div>}
  <fieldset disabled={!!anchor}><legend>현재 CCTV에 대응할 지도 기준 시점</legend>
   <label>시험 기준 방위각(°)<input type="number" value={Number.isFinite(heading)?heading:''} onChange={e=>setHeading(e.target.value===''?NaN:Number(e.target.value))}/></label>
   <label>시험 기준 기울기(°)<input type="number" value={Number.isFinite(pitch)?pitch:''} onChange={e=>setPitch(e.target.value===''?NaN:Number(e.target.value))}/></label>
   <label>시험 기준 수평 화각(°)<input type="number" value={Number.isFinite(fov)?fov:''} onChange={e=>setFov(e.target.value===''?NaN:Number(e.target.value))}/></label>
   <label>시험 렌즈 높이(m)<input type="number" value={Number.isFinite(height)?height:''} onChange={e=>setHeight(e.target.value===''?NaN:Number(e.target.value))}/></label>
   <label>시험 지도 지면 고도(m, 빈칸은 자동 조회)<input type="number" value={ground} onChange={e=>setGround(e.target.value)}/></label>
   <label><input type="checkbox" checked={confirmed} disabled={!fresh} onChange={e=>setConfirmed(e.target.checked)}/>수신 영상이 선택한 카메라임을 확인</label>
  </fieldset>
  <label><input type="checkbox" checked={zoomScale} onChange={e=>setZoomScale(e.target.checked)}/>장비 Zoom 배율로 화각도 근사</label>
  <button disabled={!fresh||!confirmed||!props.mapReady||!aspect||!!anchor} onClick={start}>현재 PTZ를 기준으로 시험 추종 시작</button>{' '}
  <button disabled={!anchor} onClick={stop}>장비 추종 중지</button>
  {' '}<button disabled={!owns||!fresh||!!error||props.position?.positionSource!=='operator'} onClick={save}>근사 기준을 지도 설정에 반영</button>
  {saveMessage&&<p role="status">{saveMessage}</p>}
  <p role="status">{anchor?(fresh&&props.mapReady&&!error?'장비 PTZ 근사 추종 중 · 절대 방향 오차 허용':'장비 추종 일시 정지 · 최신 영상·PTZ·지도 상태를 확인하세요.'):'장비 추종 중지 · 기준 시점을 입력하세요.'}</p>
  {anchor&&<p>기준 장비 Pan {anchor.sample.panDeg.toFixed(2)}° · Tilt {anchor.sample.tiltDeg.toFixed(2)}° · Zoom {anchor.sample.zoom.toFixed(2)}</p>}
  {error&&<p role="alert">{error}</p>}
  <p className="help">설치 위치는 바꾸지 않습니다. 기준은 반영 버튼을 눌렀을 때만 지도 설정에 추가하며 주소·계정·영상은 포함하지 않습니다. 세션·카메라 전환이나 탭 숨김은 추종을 종료합니다. 수신 만료·오류에는 지도 갱신을 멈춥니다. 줌 화각과 설치 축의 오차를 포함한 근사 시점입니다.</p>
 </section>;
}
