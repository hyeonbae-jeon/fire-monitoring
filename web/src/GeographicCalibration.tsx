import {useEffect,useRef,useState} from 'react';
import type {Landmark,MapControlPoint} from './calibration-model';
import {solveGeographicCalibration,type CameraSite,type GeographicSolution} from './geographic-calibration';
import type {PreviewGround} from './TerrainCalibration';

export type GeographicCandidate=GeographicSolution&{ground:PreviewGround};
type Props={landmarks:Landmark[];onLandmarks:(points:Landmark[])=>void;ready:boolean;validInputs:boolean;
 context:string;site:{lat:number;lon:number;cameraHeightM:number};width:number;height:number;
 readGround:()=>Promise<PreviewGround>;pickPoint:(signal:AbortSignal)=>Promise<MapControlPoint>;
 onApply:(candidate:GeographicCandidate)=>Promise<void>};
export function GeographicCalibration(props:Props){
 const [result,setResult]=useState<GeographicCandidate|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[picking,setPicking]=useState<number|null>(null);
 const generation=useRef(0),mounted=useRef(true),pick=useRef<AbortController|null>(null);
 const signature=JSON.stringify([props.context,props.ready,props.landmarks]);
 useEffect(()=>{generation.current++;pick.current?.abort();setPicking(null);setResult(null);setBusy(false);setError('');},[signature]);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current++;pick.current?.abort();};},[]);
 async function selectPoint(index:number){
  pick.current?.abort();const controller=new AbortController();pick.current=controller;const ticket=++generation.current;
  setResult(null);setError('');setPicking(index);setBusy(false);
  try{const point=await props.pickPoint(controller.signal);if(mounted.current&&generation.current===ticket)props.onLandmarks(props.landmarks.map((m,i)=>i===index?{...m,mapPoint:point}:m));}
  catch(e){if(mounted.current&&generation.current===ticket)setError((e as Error).message);}
  finally{if(mounted.current&&generation.current===ticket)setPicking(null);}
 }
 async function calculate(){
  const ticket=++generation.current;setBusy(true);setError('');setResult(null);
  try{
   const ground=await props.readGround();if(!mounted.current||generation.current!==ticket)return;
   const camera:CameraSite={...props.site,groundElevationM:ground.groundElevationM};
   const solution=solveGeographicCalibration(camera,props.width,props.height,props.landmarks);
   setResult({...solution,ground});
  }catch(e){if(mounted.current&&generation.current===ticket)setError((e as Error).message);}
  finally{if(mounted.current&&generation.current===ticket)setBusy(false);}
 }
 async function apply(){if(!result?.acceptable)return;const ticket=++generation.current;setBusy(true);setError('');try{await props.onApply(result);}catch(e){if(mounted.current&&generation.current===ticket)setError((e as Error).message);}finally{if(mounted.current&&generation.current===ticket)setBusy(false);}}
 const training=props.landmarks.filter(m=>m.mapPoint&&!m.useForValidation).length,validation=props.landmarks.filter(m=>m.mapPoint&&m.useForValidation).length;
 return <details className="geographic-calibration" open><summary>지도 기준점으로 방향·화각 함께 계산</summary>
  <p className="help">참조 사진에서 기준점을 찍고 지도상의 같은 지형에 연결하세요. 계산용 3개와 계산에 쓰지 않는 검증용 1개 이상이 필요합니다. 카메라 설치 위치·높이는 입력값으로 고정하며, 영상의 기울어진 수평선과 렌즈 왜곡은 보정하지 않습니다.</p>
  <p>지도 연결: 계산용 {training}개 / 검증용 {validation}개</p>
  {props.landmarks.map((m,i)=><div className="geo-point-row" key={m.x+':'+m.y}>
   <strong>{i+1}번 · {m.label}</strong>
   <button disabled={!props.ready||busy||picking!==null} onClick={()=>void selectPoint(i)}>{i+1}번 기준점 지도에서 지정</button>
   {m.mapPoint?<><small>위도 {m.mapPoint.lat.toFixed(6)} / 경도 {m.mapPoint.lon.toFixed(6)} / 지도 고도 {m.mapPoint.heightM.toFixed(1)}m</small><button onClick={()=>props.onLandmarks(props.landmarks.map((p,j)=>i===j?{label:p.label,x:p.x,y:p.y,...(p.useForValidation!==undefined?{useForValidation:p.useForValidation}:{})}:p))}>지도 연결 {i+1} 삭제</button></>:<small>지도 지점 미지정</small>}
   <label className="inline"><input type="checkbox" aria-label={`${i+1}번 기준점 검증용`} checked={!!m.useForValidation} onChange={e=>props.onLandmarks(props.landmarks.map((p,j)=>i===j?{...p,useForValidation:e.target.checked}:p))}/>검증용 · 계산에서 제외</label>
  </div>)}
  {picking!==null&&<p role="status">{picking+1}번 기준점의 같은 지형을 지도에서 클릭하세요. 지도는 마우스로 이동할 수 있습니다. <button onClick={()=>pick.current?.abort()}>기준점 지정 취소</button></p>}
  <button disabled={!props.ready||!props.validInputs||busy||picking!==null||training<3||validation<1} onClick={()=>void calculate()}>기준점으로 방향·화각 계산</button>
  {result&&<div className="geo-fit-result"><p><strong>{result.acceptable?'검증 기준 통과 후보':'후보 적용 불가'}</strong><br/>{result.reason}</p><p>방위각 {result.pose.headingDeg.toFixed(2)}° / 기울기 {result.pose.pitchDeg.toFixed(2)}° / 수평 화각 {result.pose.horizontalFovDeg.toFixed(2)}°</p>
   <p>계산점 RMS {result.fit.fitRmsPx.toFixed(2)}px / 검증점 RMS {result.fit.validationRmsPx.toFixed(2)}px</p>
   <ul>{result.errors.map((e,i)=><li key={i}>{e.label} · {e.validation?'검증':'계산'} · {Number.isFinite(e.errorPx)?e.errorPx.toFixed(2):'계산 불가'}px</li>)}</ul>
   <p className="help">영상 안의 정합 잔차입니다. 지리적 위치 오차나 실제 PTZ 정확도가 아닙니다. 현재 방향·실측 높이는 미확인입니다.</p>
   <button disabled={!result.acceptable||busy||!props.ready} onClick={()=>void apply()}>계산 후보를 지도에 적용</button>
  </div>}
  {error&&<p role="alert" className="error">{error}</p>}
 </details>;
}
