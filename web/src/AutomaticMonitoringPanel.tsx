import {useEffect,useRef,useState} from 'react';
import type {Position} from './map-model';
import {automaticPose,recent,type AutomaticStatus,type AutomaticCamera} from './automatic-monitoring';
import {monitorFetch} from './monitor-server';
import {DevicePtzStatus} from './DevicePtzStatus';
import {AutomaticTrackingEditor} from './AutomaticTrackingEditor';
import type {NativeProfile} from './native-profile';

type Management={onApply:(profile:NativeProfile)=>void;onSave:()=>void;dirty:boolean;saving:boolean;canSave:boolean;status:string};
type CoverageControls={visible:boolean;selectedOnly:boolean;onVisible:(value:boolean)=>void;onSelectedOnly:(value:boolean)=>void};

function AutomaticImage({camera,now}:{camera:AutomaticCamera|undefined;now:number}){
 const [shown,setShown]=useState<{url:string;identity:string;capturedAt:string}|null>(null),[error,setError]=useState('');
 const urls=useRef(new Set<string>()),loading=useRef<{abort:AbortController;identity:string;url?:string}|null>(null);
 const o=camera?.feed.observation,identity=camera?.cameraId+':'+o?.sessionId,fresh=!!camera?.feed.liveFrameAvailable&&recent(o?.capturedAt,now);
 function releaseAll(){urls.current.forEach(url=>URL.revokeObjectURL(url));urls.current.clear();}
 useEffect(()=>()=>{loading.current?.abort.abort();loading.current=null;releaseAll();},[identity]);
 useEffect(()=>{
  if(!camera||!o||!fresh){loading.current?.abort.abort();loading.current=null;setShown(null);releaseAll();return;}
  if(loading.current)return;
  const request:{abort:AbortController;identity:string;url?:string}={abort:new AbortController(),identity};loading.current=request;let candidate:string|null=null;
  const deadline=performance.now()+Math.max(0,4000-(now-Date.parse(o.capturedAt??'')));
  void (async()=>{
   try{
    const r=await monitorFetch('/api/auto-monitor/frame?'+new URLSearchParams({cameraId:camera.cameraId,sessionId:o.sessionId,sequence:String(o.sequence)}),{signal:AbortSignal.any([request.abort.signal,AbortSignal.timeout(5000)])});
    if(!r.ok)throw new Error('영상 갱신을 기다립니다.');const blob=await r.blob();
    if(loading.current!==request)return;
    candidate=URL.createObjectURL(blob);request.url=candidate;urls.current.add(candidate);
    const next=new Image();next.src=candidate;await next.decode();
    if(loading.current!==request||performance.now()>=deadline){URL.revokeObjectURL(candidate);urls.current.delete(candidate);candidate=null;return;}
    setShown({url:candidate,identity,capturedAt:o.capturedAt!});setError('');candidate=null;
   }catch{if(loading.current===request)setError('영상 갱신 지연 · 다시 수신 중');}
   finally{if(candidate){URL.revokeObjectURL(candidate);urls.current.delete(candidate);}if(loading.current===request)loading.current=null;}
  })();
 },[camera?.cameraId,o?.sessionId,o?.sequence,fresh]);
 const visible=shown&&shown.identity===identity&&fresh&&recent(shown.capturedAt,now);
 return <div className="automatic-image-frame">{visible?<img className="automatic-camera-image" src={shown.url} alt={(camera?.name??'선택 카메라')+' 현재 영상'} onLoad={()=>{urls.current.forEach(url=>{if(url!==shown.url&&url!==loading.current?.url){URL.revokeObjectURL(url);urls.current.delete(url);}});}}/>:<p role="status">{error||'최신 영상을 기다립니다.'}</p>}</div>;
}
export function AutomaticMonitoringPanel({positions,current,state,now,error,onSelect,onFit,onView,viewing,viewReady,viewError,management,coverage}:{positions:Position[];current:Position|undefined;state:AutomaticStatus|null;now:number;error:string;onSelect:(id:string)=>void;onFit:()=>void;onView:()=>void;viewing:boolean;viewReady:boolean;viewError:string;management?:Management;coverage?:CoverageControls}){
 const live=positions.filter(p=>automaticPose(p,state?.cameras.find(c=>c.cameraId===p.id),now)),camera=state?.cameras.find(c=>c.cameraId===current?.id);
 return <><h2>자동 감시</h2><p>최신 관측 방향 {live.length}/{positions.length}대 · 저장한 기준과 현재 PTZ로 범위를 갱신합니다.</p>
  {coverage&&<fieldset><legend>관측 범위 표시</legend>
   <label><input type="checkbox" checked={coverage.visible} onChange={e=>coverage.onVisible(e.target.checked)}/>현재 관측 범위 표시</label>
   <label><input type="checkbox" checked={coverage.selectedOnly} onChange={e=>coverage.onSelectedOnly(e.target.checked)}/>선택 카메라만 표시</label>
  </fieldset>}
  <button onClick={onFit}>전체 현재 범위 보기</button>
  {error&&<p role="alert">{error}</p>}
  {state?.configured===false&&<p>수신 서버의 카메라 접속 설정이 필요합니다. 서버설정.cmd 또는 GitHub 서버용 Secrets로 등록하세요.</p>}
  <div className="automatic-camera-list">{positions.map(p=>{
   const c=state?.cameras.find(v=>v.cameraId===p.id),pose=automaticPose(p,c,now);
   const text=pose?'현재 방향 수신 중':c?.needsAttention?'계정·권한 확인 필요':!c?'접속 설정 없음':!p.nativeTracking?'추종 기준 없음':c.feed.liveFrameAvailable?'영상 수신 · 현재 방향 미확인':'수신 끊김 · 재연결 대기';
   return <button key={p.id} aria-pressed={current?.id===p.id} onClick={()=>onSelect(p.id)}>{p.name}<small>{text}{pose?' · '+pose.headingDeg.toFixed(1)+'°':''}</small></button>;
  })}</div>
  {current&&<><h3>{current.name}</h3><button disabled={!viewing&&(!viewReady||!automaticPose(current,camera,now))} aria-pressed={viewing} onClick={onView}>{viewing?'전체 감시 지도로 돌아가기':'현재 카메라 시점 보기'}</button>{viewing&&<p>현재 영상의 장비 값에 맞춰 지도 시점을 갱신합니다.</p>}{viewError&&<p role="status">{viewError}</p>}<AutomaticImage key={current.id} camera={camera} now={now}/>
   <DevicePtzStatus value={camera?.feed.devicePtz} active mapApproximate clockNow={now}/>
   {camera?.feed.observation&&<p>영상 {camera.feed.observation.sequence}장 · 최근 수신 {new Date(camera.feed.observation.capturedAt??'').toLocaleTimeString()}</p>}
   <p>표시 거리 {camera?.displayRangeM??1000}m · 지도에 표시하는 수평 거리입니다. 지형 가림·실제 식별 거리를 뜻하지 않습니다.</p>
   {management&&<section aria-label="자동 감시 설정 저장"><AutomaticTrackingEditor key={current.id+':'+current.nativeTracking?.savedAt} position={current} fresh={!!automaticPose(current,camera,now)} onApply={management.onApply}/>
    <p role="status">{management.status}{management.dirty?' · 저장하지 않은 변경':''}</p>
    <button disabled={!management.canSave||!management.dirty||management.saving} onClick={management.onSave}>중앙 지도 설정 저장</button>
    <p className="help">보정 반영 후 이 버튼으로 저장하세요. 같은 수신 서버의 다른 접속 화면은 새로고침하면 반영됩니다.</p>
   </section>}</>}
 </>;
}
