import {useState} from 'react';
import type {Position} from './map-model';
import {parseNativeProfile,type NativeProfile} from './native-profile';

export function AutomaticTrackingEditor({position,fresh,onApply}:{position:Position;fresh:boolean;onApply:(profile:NativeProfile)=>void}){
 const saved=position.nativeTracking;
 const [heading,setHeading]=useState('0'),[pitch,setPitch]=useState('0'),[fov,setFov]=useState(String(saved?.pose.horizontalFovDeg??60)),[error,setError]=useState('');
 function apply(){
  try{
   if(!saved||!fresh)throw new Error('선택 카메라의 저장 기준과 최신 영상·PTZ를 확인하세요.');
   const h=Number(heading),p=Number(pitch),f=Number(fov);
   if(!heading.trim()||!pitch.trim()||!fov.trim()||!Number.isFinite(h)||Math.abs(h)>180||!Number.isFinite(p)||Math.abs(p)>90||!Number.isFinite(f)||f<5||f>120)throw new Error('방향 보정량과 기준 화각을 확인하세요.');
   const correctedPitch=saved.pose.pitchDeg+p;
   if(correctedPitch< -80||correctedPitch>80)throw new Error('보정 후 기준 기울기는 -80°부터 80°까지 입력하세요.');
   const profile=parseNativeProfile({...saved,savedAt:new Date().toISOString(),pose:{...saved.pose,headingDeg:((saved.pose.headingDeg+h)%360+360)%360,pitchDeg:correctedPitch,horizontalFovDeg:f}},position);
   onApply(profile);setHeading('0');setPitch('0');setError('');
  }catch(e){setError((e as Error).message);}
 }
 return <details className="automatic-tracking-editor"><summary>감시 방향 보정 (관리자)</summary>
  {saved?<><p>설치 위치와 장비 기준은 유지하고 지도 방향만 보정합니다. 먼저 현재 카메라 시점과 영상을 비교하세요.</p>
   <p>저장 기준: 방위각 {saved.pose.headingDeg.toFixed(2)}° · 기울기 {saved.pose.pitchDeg.toFixed(2)}° · 화각 {saved.pose.horizontalFovDeg.toFixed(2)}°</p>
   <label>방위각 보정량(°)<input type="number" min="-180" max="180" step="0.1" value={heading} onChange={e=>setHeading(e.target.value)}/></label>
   <p className="help">위에서 본 지도 기준으로 +는 시계 방향, -는 반시계 방향입니다.</p>
   <label>기울기 보정량(°)<input type="number" min="-90" max="90" step="0.1" value={pitch} onChange={e=>setPitch(e.target.value)}/></label>
   <p className="help">+는 위쪽, -는 아래쪽입니다.</p>
   <label>저장 기준 수평 화각(°)<input type="number" min="5" max="120" step="0.1" value={fov} onChange={e=>setFov(e.target.value)}/></label>
   <p className="help">현재 줌의 화각이 아니라 저장된 기준 줌의 화각입니다. 방향만 어긋났으면 유지하세요.</p>
   <button disabled={!fresh} onClick={apply}>근사 기준을 지도 설정에 반영</button>
   {!fresh&&<p>최신 영상·PTZ 수신을 기다립니다.</p>}
   {error&&<p role="alert">{error}</p>}
  </>:<p>저장된 장비 추종 기준이 없습니다. 기존 기준이 포함된 지도 설정을 먼저 불러오세요.</p>}
 </details>;
}
