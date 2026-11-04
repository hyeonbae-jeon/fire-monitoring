import {useEffect,useRef,useState} from 'react';
import type {Position} from './map-model';
import type {MailEvent} from './firewatcher-mail';
import type {AutomaticCamera} from './automatic-monitoring';
import {currentFrameSnapshot} from './current-alert-view';
import {useCurrentAlertView} from './useCurrentAlertView';
import type {AlertLocationRequest,AlertLocationResult,PixelBox} from './alert-location';

type Projection={start:(request:AlertLocationRequest)=>void;clear:()=>void;result:AlertLocationResult|null;progress:string;error:string;ready:boolean;getCurrent:(id:string)=>{camera:AutomaticCamera;now:number}|null};
export function AlertLocationTool({event,position,frame,blob,box,projection,canManage}:{event:MailEvent;position:Position;frame:{width:number;height:number};blob:Blob;box:PixelBox;projection:Projection;canManage:boolean}){
 const [pan,setPan]=useState(''),[tilt,setTilt]=useState(''),[zoom,setZoom]=useState(''),[range,setRange]=useState('3000'),[confirmed,setConfirmed]=useState(false),[fullFrame,setFullFrame]=useState(false),[error,setError]=useState('');
 const current=projection.getCurrent(position.id),snapshot=current?currentFrameSnapshot(position,current.camera,current.now):null;
 const matching=useCurrentAlertView({event,position,blob,frame,box,rangeM:Number(range),getCurrent:projection.getCurrent,onMatched:projection.start,onClear:projection.clear});
 const autoStarted=useRef(''),autoKey=JSON.stringify([event.id,event.detail?.imageSha256,position.id,box,snapshot?.sessionId]);
 useEffect(()=>{projection.clear();setConfirmed(false);matching.stop();},[pan,tilt,zoom,range,fullFrame,JSON.stringify(box)]);
 useEffect(()=>{if(projection.ready&&snapshot&&autoStarted.current!==autoKey){autoStarted.current=autoKey;void matching.start();}},[projection.ready,!!snapshot,autoKey]);
 const result=projection.result?.grid.request.eventId===event.id?projection.result:null;
 const center=result?.rays.find(r=>r.role==='center'),point=center?.point;
 const reasons:Record<string,string>={'beyond-range':'조회 거리 안에서 지형과 만나지 않았습니다.','terrain-unknown':'앞쪽 지형 정보가 없어 위치 후보를 확정하지 않았습니다.','camera-below-terrain':'렌즈 높이가 조회된 지형 아래입니다. 설치 고도·지형을 확인하세요.'};
 function manual(){
  try{
   matching.stop();if(!pan.trim()||!tilt.trim()||!zoom.trim()||!confirmed||!fullFrame||!event.detail?.imageSha256)throw new Error('감지 당시 PTZ와 전체 영상 영역을 확인하세요.');
   setError('');projection.start({eventId:event.id,imageSha256:event.detail.imageSha256,position,frame:{width:frame.width,height:frame.height},box,device:{panDeg:Number(pan),tiltDeg:Number(tilt),zoom:Number(zoom)},confirmed:true,rangeM:Number(range)});
  }catch(e){setError((e as Error).message);}
 }
 return <details open className="alert-location-tool"><summary>감지 위치 후보 계산</summary>
  <p>현재 CCTV 화면 각도 사용</p>
  <p>{snapshot?`Pan ${snapshot.device.panDeg.toFixed(2)}° · Tilt ${snapshot.device.tiltDeg.toFixed(2)}° · Zoom ${snapshot.device.zoom.toFixed(2)}`:'해당 카메라의 최신 영상·PTZ 수신을 기다립니다.'}</p>
  <p className="help">감지 영상과 현재 화면의 촬영 구도를 대조한 뒤 현재 장비 값과 저장한 보정값으로 계산합니다.</p>
  <label>지형 조회 한도(m)<input type="number" min="100" max="20000" step="100" value={range} onChange={e=>setRange(e.target.value)}/></label>
  <button disabled={!projection.ready||!snapshot||matching.busy||!!projection.progress} onClick={()=>void matching.start()}>현재 CCTV 각도로 계산</button>
  <button onClick={()=>{matching.stop();projection.clear();}}>위치 후보 지우기</button>
  <p role="status">{matching.status}</p>
  {canManage&&<details><summary>과거 알림 PTZ 직접 입력</summary><p className="help">현재 구도가 다른 과거 영상은 당시 값을 알고 있는 경우 직접 입력할 수 있습니다.</p>
   <label>감지 당시 Pan(°)<input type="number" min="0" max="360" step="0.01" value={pan} onChange={e=>setPan(e.target.value)}/></label>
   <label>감지 당시 Tilt(°)<input type="number" min="-360" max="360" step="0.01" value={tilt} onChange={e=>setTilt(e.target.value)}/></label>
   <label>감지 당시 Zoom<input type="number" min="0.001" max="10000" step="0.01" value={zoom} onChange={e=>setZoom(e.target.value)}/></label>
   <label><input type="checkbox" checked={fullFrame} onChange={e=>setFullFrame(e.target.checked)}/>감지 영상이 잘리지 않은 전체 촬영 영역입니다.</label>
   <label><input type="checkbox" checked={confirmed} onChange={e=>{setConfirmed(e.target.checked);projection.clear();}}/>입력한 PTZ가 이 감지 영상을 촬영한 당시의 값입니다.</label>
   <button disabled={!projection.ready||!confirmed||!fullFrame||!pan||!tilt||!zoom||!!projection.progress} onClick={manual}>지형 위치 후보 계산</button>
  </details>}
  {projection.progress&&<p role="status">{projection.progress}</p>}{(error||projection.error)&&<p role="alert">{error||projection.error}</p>}
  {result&&<div role="status">{result.source==='matched-current-cctv'&&<p>현재 수신 화면·PTZ 대조 기준의 근사 위치</p>}{point?<><p><strong>배경 지형 위치 후보</strong><br/>위도 {point.lat.toFixed(6)} / 경도 {point.lon.toFixed(6)}<br/>시선 거리 약 {Math.round(point.distanceM)}m</p><p>박스 하단 중앙의 지형 교차점입니다. 25m 표본 간격은 오차 반경이 아닙니다.</p></>:<p>{reasons[center?.state??'']??'위치 후보 없음'}</p>}</div>}
  <p className="help">공중의 연기·불빛은 배경 지형과 거리가 다를 수 있습니다. 주황색 방향선과 지형 교차점은 발화점 확정 좌표가 아닙니다. 결과는 이 화면에서만 유지합니다.</p>
 </details>;
}
export type {Projection as AlertProjectionControls};
