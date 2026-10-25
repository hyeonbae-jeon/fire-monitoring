import {useEffect,useRef,useState} from 'react';
import type {Position} from './map-model';
import {MAX_DIAGNOSTIC_BYTES,parseDiagnosticReview,type DiagnosticReview as Review} from './diagnostic-review';

export function DiagnosticReview({position,ready,onDocument,onFit,renderError}:{position:Position;ready:boolean;onDocument:(review:Review|null)=>void;onFit:(review:Review)=>void;renderError:string}){
 const [review,setReview]=useState<Review|null>(null),[error,setError]=useState('');
 const mounted=useRef(true),generation=useRef(0);
 useEffect(()=>{mounted.current=true;onDocument(null);return()=>{mounted.current=false;generation.current++;};},[]);
 async function load(file?:File){
  if(!file)return;const ticket=++generation.current;setError('');
  try{
   if(file.size>MAX_DIAGNOSTIC_BYTES)throw new Error('보정 진단 파일은 256KB 이하여야 합니다.');
   const next=parseDiagnosticReview(await file.text(),position);
   if(!mounted.current||generation.current!==ticket)return;
   setReview(next);onDocument(next);
  }catch(e){if(mounted.current&&generation.current===ticket)setError((e as Error).message);}
 }
 return <details className="diagnostic-review"><summary>기존 진단 기준점 확인</summary>
  <p>진단 파일에 기록된 번호와 좌표를 지도에 표시합니다. 사진·지도에서 같은 지형을 지정했는지 확인하는 읽기 전용 보기입니다.</p>
  <label>보정 진단 JSON 불러오기<input type="file" accept=".json,application/json" onChange={e=>{void load(e.target.files?.[0]);e.target.value='';}}/></label>
  {review&&<><p>진단 기준점 {review.points.length}개 · {review.camera.name}<br/>주황: 계산점 / 보라: 검증점<br/>기록된 참조 사진 {review.reference.width}×{review.reference.height}<br/>기록된 촬영 시각: {review.reference.capturedAt?.replace('T',' ')??'미입력'}</p>
   {!ready&&<p className="help">현재는 좌표 배치도에 표시합니다. 실제 지형과 비교하려면 VWorld 3D를 연결하세요.</p>}
   <button disabled={!ready} onClick={()=>onFit(review)}>기준점 전체 보기</button>{' '}
   <button onClick={()=>{generation.current++;setReview(null);setError('');onDocument(null);}}>진단 기준점 숨기기</button>
   <ul>{review.points.map(p=><li key={p.number}>{p.number}번 · {p.label} · {p.validation?'검증':'계산'}<small>위도 {p.lat.toFixed(6)} / 경도 {p.lon.toFixed(6)} / 고도 {p.heightM.toFixed(1)}m</small></li>)}</ul>
   <p className="help">이 보기의 기준점은 좌표 설정 다운로드·중앙 저장에 추가하지 않습니다. 파일은 이 브라우저에서만 읽습니다.</p>
  </>}
  {error&&<p role="alert" className="error">{error}</p>}{renderError&&review&&<p role="alert" className="error">{renderError}</p>}
 </details>;
}
