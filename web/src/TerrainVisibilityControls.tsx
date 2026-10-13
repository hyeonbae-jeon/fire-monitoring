import type {Position} from './map-model';
import {coverageStatus,type CoveragePlan} from './coverage-model';
import type {useTerrainVisibility} from './useTerrainVisibility';

export function TerrainVisibilityControls({current,plan,ready,suspended,visibility}:{current:Position|undefined;plan:CoveragePlan|undefined;ready:boolean;suspended:boolean;visibility:ReturnType<typeof useTerrainVisibility>}){
 if(!current)return null;
 const result=visibility.currentResult,busy=!!visibility.progress,usable=!!plan&&coverageStatus(plan,current)==='ready',sum=result?Object.values(result.areaM2).reduce((a,b)=>a+b,0):0;
 return <section className="terrain-visibility-controls"><h3>산에 가리는 구간 · 계산 시안</h3>
  <p><strong>계산 대상: {current.name}</strong></p>
  <p className="help">현재 입력한 수평 범위 안에서 지도 표면의 가시선을 표본 계산합니다. 실제 촬영 범위·정확도는 미검증입니다.</p>
  <label>지형 가림 시험 렌즈 높이(m)<input type="number" min="0.5" max="100" step="0.5" placeholder="지면에서 렌즈까지 · 직접 입력" value={visibility.height} onChange={e=>visibility.setHeight(e.target.value)}/></label>
  <p className="help">초기 3m는 사용자가 정한 시험 높이입니다. 실제 설치 높이는 미확인입니다.</p>
  {current.orientation?.status==='estimate'&&<button onClick={()=>visibility.setHeight(String(current.orientation!.cameraHeightM))}>저장 보정의 시험 높이 사용</button>}
  <label>높이 표본 간격<select value={visibility.spacing} onChange={e=>visibility.setSpacing(Number(e.target.value) as 50|100)}><option value="100">100m · 빠른 시안</option><option value="50">50m · 더 촘촘한 시안</option></select></label>
  <button disabled={!ready||!usable||!visibility.height.trim()||suspended||busy} onClick={visibility.start}>선택 카메라 지형 가림 계산</button>
  {busy&&<><p role="status">지형 높이 조회 중 {visibility.progress!.done}/{visibility.progress!.total}</p><button onClick={visibility.cancel}>지형 가림 계산 중지</button></>}
  {!usable&&<p className="help">방위각·화각·거리를 입력하고 범위 시안을 먼저 표시하세요.</p>}
  {suspended&&<p className="help">일반 지도 보기로 돌아온 뒤 계산하세요.</p>}
  {result&&<div className="visibility-summary"><p>표본 계산 · 높이 {result.cameraHeightM}m · 간격 최대 {result.spacingM}m<br/>지도 기준 지면 높이 약 {Math.round(result.groundElevationM)}m<br/>높이 출처: {result.heightSource==='terrain-provider'?'지도 지형 공급자':result.heightSource==='scene-most-detailed'?'지도 3D 표면 상세 조회':'화면에 로딩된 지도 표면'}</p>
   <ul>{(['visible','blocked','unknown'] as const).map(state=><li key={state}><i className={'visibility-swatch '+state}/>{state==='visible'?'비가림 추정':state==='blocked'?'가림 추정':'미확인·경계'} {sum?Math.round(result.areaM2[state]/sum*100):0}%</li>)}</ul>
   <button onClick={visibility.clear}>선택 카메라 가림 계산 지우기</button>
  </div>}
  {visibility.error&&<p role="alert" className="error">{visibility.error}</p>}
  {visibility.renderError&&<p role="alert" className="error">{visibility.renderError}</p>}
  <p className="help">한 대씩 계산하면 다른 카메라의 계산도 함께 표시합니다. 최대 5,000m·방위별 24구간으로 계산하며, 높이가 없는 곳과 가림 경계는 미확인으로 표시합니다.</p>
  <p className="help">초록: 비가림 추정 · 빨강: 가림 추정 · 노랑: 미확인. Tilt·수직 화각·나무·기상은 별도 검증이 필요합니다. 회전·줌 후 범위 시안을 다시 조정하고 계산하세요.</p>
  <p className="help">지면의 가시선 기준입니다. 솟아오른 연기의 가시성은 별도로 대조해야 합니다.</p>
 </section>;
}
