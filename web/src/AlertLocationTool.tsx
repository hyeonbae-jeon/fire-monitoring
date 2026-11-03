import {useEffect,useState} from 'react';
import type {Position} from './map-model';
import type {MailEvent} from './firewatcher-mail';
import type {AlertLocationRequest,AlertLocationResult,PixelBox} from './alert-location';

type Projection={start:(request:AlertLocationRequest)=>void;clear:()=>void;result:AlertLocationResult|null;progress:string;error:string;ready:boolean};
export function AlertLocationTool({event,position,frame,box,projection}:{event:MailEvent;position:Position;frame:{width:number;height:number};box:PixelBox;projection:Projection}){
 const [pan,setPan]=useState(''),[tilt,setTilt]=useState(''),[zoom,setZoom]=useState(''),[range,setRange]=useState('3000'),[confirmed,setConfirmed]=useState(false),[fullFrame,setFullFrame]=useState(false),[error,setError]=useState('');
 useEffect(()=>{projection.clear();setConfirmed(false);},[pan,tilt,zoom,range,fullFrame,JSON.stringify(box)]);
 const result=projection.result?.grid.request.eventId===event.id?projection.result:null;
 const center=result?.rays.find(r=>r.role==='center'),point=center?.point;
 const reasons:Record<string,string>={'beyond-range':'조회 거리 안에서 지형과 만나지 않았습니다.','terrain-unknown':'앞쪽 지형 정보가 없어 위치 후보를 확정하지 않았습니다.','camera-below-terrain':'렌즈 높이가 조회된 지형 아래입니다. 설치 고도·지형을 확인하세요.'};
 function start(){
  try{
   if(!pan.trim()||!tilt.trim()||!zoom.trim()||!confirmed||!fullFrame||!event.detail?.imageSha256)throw new Error('감지 당시 PTZ와 전체 영상 영역을 확인하세요.');
   setError('');projection.start({eventId:event.id,imageSha256:event.detail.imageSha256,position,frame:{width:frame.width,height:frame.height},box,device:{panDeg:Number(pan),tiltDeg:Number(tilt),zoom:Number(zoom)},confirmed:true,rangeM:Number(range)});
  }catch(e){setError((e as Error).message);}
 }
 return <details className="alert-location-tool"><summary>감지 위치 후보 계산</summary>
  <p>감지 당시 방향 미제공 · 현재 PTZ를 과거 영상에 자동 적용하지 않습니다.</p>
  <p className="help">당시 장비 값을 알고 있다면 입력하세요. 저장한 카메라 보정값을 사용하므로 전체 방향 설정을 다시 할 필요는 없습니다.</p>
  <label>감지 당시 Pan(°)<input type="number" min="0" max="360" step="0.01" value={pan} onChange={e=>setPan(e.target.value)}/></label>
  <label>감지 당시 Tilt(°)<input type="number" min="-360" max="360" step="0.01" value={tilt} onChange={e=>setTilt(e.target.value)}/></label>
  <label>감지 당시 Zoom<input type="number" min="0.001" max="10000" step="0.01" value={zoom} onChange={e=>setZoom(e.target.value)}/></label>
  <label>지형 조회 한도(m)<input type="number" min="100" max="20000" step="100" value={range} onChange={e=>setRange(e.target.value)}/></label>
  <label><input type="checkbox" checked={fullFrame} onChange={e=>setFullFrame(e.target.checked)}/>감지 영상이 잘리지 않은 전체 촬영 영역입니다.</label>
  <label><input type="checkbox" checked={confirmed} onChange={e=>{setConfirmed(e.target.checked);projection.clear();}}/>입력한 PTZ가 이 감지 영상을 촬영한 당시의 값입니다.</label>
  <button disabled={!projection.ready||!confirmed||!fullFrame||!pan||!tilt||!zoom||!!projection.progress} onClick={start}>지형 위치 후보 계산</button>
  <button onClick={projection.clear}>위치 후보 지우기</button>
  {projection.progress&&<p role="status">{projection.progress}</p>}{(error||projection.error)&&<p role="alert">{error||projection.error}</p>}
  {result&&<div role="status">{point?<><p><strong>배경 지형 위치 후보</strong><br/>위도 {point.lat.toFixed(6)} / 경도 {point.lon.toFixed(6)}<br/>시선 거리 약 {Math.round(point.distanceM)}m</p><p>박스 하단 중앙의 지형 교차점입니다. 25m 간격 표본을 사용했으며 정확도 보증이나 오차 반경을 뜻하지 않습니다.</p></>:<p>{reasons[center?.state??'']??'위치 후보 없음'}</p>}</div>}
  <p className="help">공중의 연기·불빛은 배경 지형과 거리가 다를 수 있습니다. 주황색 방향선과 지형 교차점은 발화점 확정 좌표가 아닙니다. 결과는 이 화면에서만 유지합니다.</p>
 </details>;
}
export type {Projection as AlertProjectionControls};
