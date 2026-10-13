import {useState} from 'react';
import type {Position} from './map-model';
import {calibrationToken,coverageColor,coverageStatus,parseCoverage,serializeCoverage,type CoveragePlan} from './coverage-model';

const storageKey='fire-monitoring:coverage-preview:v1:'+import.meta.env.BASE_URL;
export function readSavedCoverage():{plans:CoveragePlan[];status:string}{
 try{const text=localStorage.getItem(storageKey);return {plans:text?parseCoverage(text):[],status:text?'이 브라우저에 저장한 범위 시안을 불러왔습니다.':'저장한 범위 시안 없음'};}catch{return {plans:[],status:'저장한 범위 시안을 읽지 못했습니다. 새 시안을 만들거나 파일로 불러오세요.'};}
}
function CoverageEditor({position,plan,onApply}:{position:Position;plan:CoveragePlan|undefined;onApply:(plan:CoveragePlan)=>void}){
 const usable=plan&&['ready','hidden'].includes(coverageStatus(plan,position))?plan:undefined;
 const [heading,setHeading]=useState(usable?String(usable.headingDeg):''),[fov,setFov]=useState(String(usable?.horizontalFovDeg??60)),[range,setRange]=useState(String(usable?.displayRangeM??1000)),[error,setError]=useState('');
 function apply(h=heading,f=fov,r=range,fromCalibration=false,enabled=true){
  try{
   if(!h.trim()||!f.trim()||!r.trim())throw new Error('방위각·수평 화각·표시 거리를 입력하세요.');
   const token=fromCalibration?calibrationToken(position):null;
   if(fromCalibration&&!token)throw new Error('사용 가능한 저장 보정값이 없습니다.');
   const next:CoveragePlan={cameraId:position.id,positionAtPlan:{lat:position.lat,lon:position.lon},source:fromCalibration?'manual-calibration':'manual-preview',calibrationToken:token,headingDeg:Number(h),horizontalFovDeg:Number(f),displayRangeM:Number(r),enabled,updatedAt:new Date().toISOString()};
   onApply(parseCoverage(serializeCoverage([next]))[0]);setError('');
  }catch(e){setError((e as Error).message);}
 }
 function slider(which:'heading'|'fov'|'range',value:string){
  const h=which==='heading'?value:heading,f=which==='fov'?value:fov,r=which==='range'?value:range;
  if(which==='heading')setHeading(value);if(which==='fov')setFov(value);if(which==='range')setRange(value);
  if(usable)apply(h,f,r,which==='range'&&usable.source==='manual-calibration'&&Number(h)===usable.headingDeg&&Number(f)===usable.horizontalFovDeg,usable.enabled);
 }
 return <section className="coverage-editor"><h3>{position.name} · 범위 시안 조정</h3>
  <label>범위 방위각(°)<input type="number" min="0" max="359.999999" step="0.1" placeholder="미확인 · 직접 입력" value={heading} onChange={e=>setHeading(e.target.value)}/></label>
  {heading.trim()&&<input aria-label="범위 방위각 조절" type="range" min="0" max="359" step="1" value={Number(heading)||0} onChange={e=>slider('heading',e.target.value)}/>}
  <label>범위 수평 화각(°)<input type="number" min="5" max="120" step="1" value={fov} onChange={e=>setFov(e.target.value)}/></label><input aria-label="범위 화각 조절" type="range" min="5" max="120" value={Number(fov)||5} onChange={e=>slider('fov',e.target.value)}/>
  <label>범위 표시 거리(m)<input type="number" min="10" max="20000" step="10" value={range} onChange={e=>setRange(e.target.value)}/></label><input aria-label="범위 거리 조절" type="range" min="100" max="20000" step="100" value={Number(range)||100} onChange={e=>slider('range',e.target.value)}/>
  <p className="help">북=0°, 동=90°. 초기 화각 60°·거리 1000m는 시안 값입니다. 방향을 입력하고 표시하면 슬라이더 조정이 바로 반영됩니다.</p>
  <button disabled={!heading.trim()||!fov.trim()||!range.trim()} onClick={()=>apply()}>입력값으로 범위 시안 표시</button>
  <button disabled={!calibrationToken(position)} onClick={()=>{const o=position.orientation!;setHeading(String(o.headingDeg));setFov(String(o.horizontalFovDeg));apply(String(o.headingDeg),String(o.horizontalFovDeg),range,true);}}>저장된 보정값으로 범위 표시</button>
  {error&&<p role="alert" className="error">{error}</p>}
 </section>;
}
export function CoverageControls({positions,current,plans,hidden,selectedOnly,suspended,storageStatus,onSelect,onPlans,onHidden,onSelectedOnly,onStorageStatus}:{positions:Position[];current:Position|undefined;plans:CoveragePlan[];hidden:boolean;selectedOnly:boolean;suspended:boolean;storageStatus:string;onSelect:(id:string)=>void;onPlans:(plans:CoveragePlan[])=>void;onHidden:(hidden:boolean)=>void;onSelectedOnly:(selectedOnly:boolean)=>void;onStorageStatus:(status:string)=>void}){
 const [error,setError]=useState(''),[editorRevision,setEditorRevision]=useState(0);
 const byId=new Map(plans.map(p=>[p.cameraId,p])),configured=positions.filter(p=>['ready','hidden'].includes(coverageStatus(byId.get(p.id),p))).length;
 function update(plan:CoveragePlan){onPlans(plans.some(p=>p.cameraId===plan.cameraId)?plans.map(p=>p.cameraId===plan.cameraId?plan:p):[...plans,plan]);onStorageStatus('범위 시안 변경 · 저장 버튼으로 이 브라우저에 보관할 수 있습니다.');setError('');}
 function save(){try{localStorage.setItem(storageKey,serializeCoverage(plans));onStorageStatus('이 브라우저에 범위 시안 저장 완료 · 다른 PC와 공유하지 않습니다.');setError('');}catch{setError('브라우저 저장이 허용되지 않습니다. 범위 시안 다운로드로 보관하세요.');}}
 function clear(){try{localStorage.removeItem(storageKey);onPlans([]);setEditorRevision(v=>v+1);onStorageStatus('이 브라우저의 범위 시안을 지웠습니다.');setError('');}catch{setError('브라우저 저장 시안을 지우지 못했습니다.');}}
 function download(){const url=URL.createObjectURL(new Blob([serializeCoverage(plans)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='camera-coverage-preview.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 async function importFile(file?:File){try{if(!file)return;if(file.size>1024*1024)throw new Error('범위 시안은 1MB 이하여야 합니다.');const next=parseCoverage(await file.text());if(next.some(plan=>!positions.some(p=>p.id===plan.cameraId)))throw new Error('현재 지도에 없는 카메라가 포함되어 있습니다.');onPlans(next);setEditorRevision(v=>v+1);onStorageStatus('범위 시안 파일을 불러왔습니다. 저장 버튼으로 보관하세요.');setError('');}catch(e){setError((e as Error).message);}}
 return <><h2>관측 범위 시안</h2><p className="help">방향·화각·표시 거리로 그린 수평 부채꼴입니다. 아래 지형 가림 계산으로 지도 표면의 가시선을 시험할 수 있습니다. 실시간 촬영 방향은 미확인입니다.</p>
  <p>{configured}/{positions.length}대 범위 설정 · {suspended?'가상 시점 보정 중 숨김':hidden?'전체 숨김':'표시 켜짐'}</p>
  <label className="inline"><input type="checkbox" checked={!hidden} onChange={e=>onHidden(!e.target.checked)}/>범위 시안 전체 표시</label><label className="inline"><input type="checkbox" checked={selectedOnly} onChange={e=>onSelectedOnly(e.target.checked)}/>선택한 카메라 범위만 보기</label>
  <div className="coverage-list">{positions.map(p=>{const plan=byId.get(p.id),status=coverageStatus(plan,p),usable=status==='ready'||status==='hidden';return <div className="coverage-row" key={p.id}><input aria-label={p.name+' 범위 표시'} type="checkbox" checked={status==='ready'} disabled={!usable} onChange={e=>update({...plan!,enabled:e.target.checked})}/><button aria-pressed={p.id===current?.id} onClick={()=>onSelect(p.id)}><i className="coverage-swatch" style={{background:coverageColor(p.id)}}/>{p.name}<small>{status==='unset'?'범위 미설정':status==='position-changed'?'설치 위치 변경 · 재설정 필요':status==='calibration-stale'?'보정 변경·무효 · 재설정 필요':(plan?.source==='manual-calibration'?'기준 영상·지형 추정':'수동 범위 시안')+(status==='hidden'?' · 숨김':'')}</small></button></div>;})}</div>
  {current&&<CoverageEditor key={current.id+':'+current.lat+':'+current.lon+':'+editorRevision} position={current} plan={byId.get(current.id)} onApply={update}/>}
  <details><summary>범위 시안 보관</summary><p>{storageStatus}</p><button onClick={save}>이 브라우저에 범위 시안 저장</button><button onClick={download}>범위 시안 다운로드</button><label>범위 시안 JSON 불러오기<input type="file" accept=".json,application/json" onChange={e=>{void importFile(e.target.files?.[0]);e.target.value='';}}/></label><button onClick={clear}>저장된 범위 시안 지우기</button><p className="help">저장한 시안도 정확도 미검증입니다. 회전·줌 변경 후 다시 조정하세요. 지도 키·SSM 계정·이미지는 저장하지 않습니다.</p></details>
  {error&&<p role="alert" className="error">{error}</p>}
 </>;
}
