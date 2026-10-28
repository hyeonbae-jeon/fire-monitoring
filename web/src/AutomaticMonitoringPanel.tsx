import {useEffect,useState} from 'react';
import type {Position} from './map-model';
import {automaticPose,recent,type AutomaticStatus,type AutomaticCamera} from './automatic-monitoring';
import {monitorFetch} from './monitor-server';
import {DevicePtzStatus} from './DevicePtzStatus';

function AutomaticImage({camera,now}:{camera:AutomaticCamera|undefined;now:number}){
 const [image,setImage]=useState<string|null>(null),[error,setError]=useState('');
 const o=camera?.feed.observation,fresh=!!camera?.feed.liveFrameAvailable&&recent(o?.capturedAt,now);
 useEffect(()=>{
  setImage(null);if(!camera||!o||!fresh)return;
  let cancelled=false,url:string|null=null;const abort=new AbortController();
  void monitorFetch('/api/auto-monitor/frame?'+new URLSearchParams({cameraId:camera.cameraId,sessionId:o.sessionId,sequence:String(o.sequence)}),{signal:abort.signal}).then(async r=>{
   if(!r.ok)throw new Error('최신 영상 수신을 기다립니다.');const blob=await r.blob();if(cancelled)return;
   url=URL.createObjectURL(blob);setImage(url);setError('');
  }).catch(e=>{if(!cancelled)setError((e as Error).message);});
  return()=>{cancelled=true;abort.abort();if(url)URL.revokeObjectURL(url);};
 },[camera?.cameraId,o?.sessionId,o?.sequence,fresh]);
 return image&&fresh?<img className="automatic-camera-image" src={image} alt={(camera?.name??'선택 카메라')+' 현재 영상'}/>:<p role="status">{error||'최신 영상을 기다립니다.'}</p>;
}
export function AutomaticMonitoringPanel({positions,current,state,now,error,onSelect,onFit}:{positions:Position[];current:Position|undefined;state:AutomaticStatus|null;now:number;error:string;onSelect:(id:string)=>void;onFit:()=>void}){
 const live=positions.filter(p=>automaticPose(p,state?.cameras.find(c=>c.cameraId===p.id),now)),camera=state?.cameras.find(c=>c.cameraId===current?.id);
 return <><h2>자동 감시</h2><p>최신 관측 방향 {live.length}/{positions.length}대 · 저장한 기준과 현재 PTZ로 범위를 갱신합니다.</p>
  <button onClick={onFit}>전체 현재 범위 보기</button>
  {error&&<p role="alert">{error}</p>}
  {state?.configured===false&&<p>수신 서버의 카메라 접속 설정이 필요합니다. 서버설정.cmd 또는 GitHub 서버용 Secrets로 등록하세요.</p>}
  <div className="automatic-camera-list">{positions.map(p=>{
   const c=state?.cameras.find(v=>v.cameraId===p.id),pose=automaticPose(p,c,now);
   const text=pose?'현재 방향 수신 중':c?.needsAttention?'계정·권한 확인 필요':!c?'접속 설정 없음':!p.nativeTracking?'추종 기준 없음':c.feed.liveFrameAvailable?'영상 수신 · 현재 방향 미확인':'수신 끊김 · 재연결 대기';
   return <button key={p.id} aria-pressed={current?.id===p.id} onClick={()=>onSelect(p.id)}>{p.name}<small>{text}{pose?' · '+pose.headingDeg.toFixed(1)+'°':''}</small></button>;
  })}</div>
  {current&&<><h3>{current.name}</h3><AutomaticImage key={current.id} camera={camera} now={now}/>
   <DevicePtzStatus value={camera?.feed.devicePtz} active mapApproximate clockNow={now}/>
   {camera?.feed.observation&&<p>영상 {camera.feed.observation.sequence}장 · 최근 수신 {new Date(camera.feed.observation.capturedAt??'').toLocaleTimeString()}</p>}
   <p>표시 거리 {camera?.displayRangeM??1000}m · 현재 PTZ 기준의 근사 관측 범위입니다.</p></>}
 </>;
}
