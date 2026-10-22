import {useEffect,useState} from 'react';
import {enteredLocation,locationReport,lookupParcel,type SelectedLocation} from './location-model';
type LookupState={point:SelectedLocation;apiKey:string;retry:number;addresses:string[];error:string;loading:boolean;lookedUp:boolean};

export function LocationLookup({point,picking,ready,apiKey,pickError,onPicking,onPoint}:{point:SelectedLocation|null;picking:boolean;ready:boolean;apiKey:string;pickError:string;onPicking:(value:boolean)=>void;onPoint:(value:SelectedLocation|null)=>void}){
 const [lat,setLat]=useState(''),[lon,setLon]=useState(''),[inputError,setInputError]=useState(''),[lookup,setLookup]=useState<LookupState|null>(null),[retry,setRetry]=useState(0),[copyStatus,setCopyStatus]=useState('');
 // Never pair a new point with an earlier address, even before effect cleanup.
 const matching=lookup?.point===point&&lookup?.apiKey===apiKey&&lookup?.retry===retry;
 const addresses=matching?lookup!.addresses:[],error=matching?lookup!.error:'',loading=!!point&&(!matching||lookup!.loading),lookedUp=matching&&lookup!.lookedUp;
 useEffect(()=>{
  setCopyStatus('');
  if(!point)return;
  const controller=new AbortController(),pending:LookupState={point,apiKey,retry,addresses:[],error:'',loading:true,lookedUp:false};setLookup(pending);
  lookupParcel(point,apiKey,controller.signal,location.origin+import.meta.env.BASE_URL).then(a=>{if(!controller.signal.aborted)setLookup({...pending,addresses:a,lookedUp:true,loading:false});}).catch(e=>{if(!controller.signal.aborted)setLookup({...pending,error:e.message,loading:false});});
  return()=>controller.abort();
 },[point,apiKey,retry]);
 return <><h2>위치·지번 조회</h2>
  <button disabled={!ready} aria-pressed={picking} onClick={()=>onPicking(!picking)}>{picking?'위치 선택 종료':'지도에서 위치 선택'}</button>
  <p className="help">{picking?'지도에서 확인할 지형 지점을 클릭하세요. 하늘은 선택할 수 없습니다.':'위치 선택을 켠 뒤 지도를 클릭하면 좌표와 지번 주소를 조회합니다.'}</p>
  {pickError&&<p role="alert" className="error">{pickError}</p>}
  {point&&<div className="location-result" aria-live="polite">
   <strong>선택 지점</strong><p>위도 <output>{point.lat.toFixed(6)}</output><br/>경도 <output>{point.lon.toFixed(6)}</output></p>
   <p>{point.source==='map-surface'?'지도 표면 선택':'좌표 직접 입력'}{point.heightM!==null&&` · 지도 표면 높이 약 ${Math.round(point.heightM)}m`}</p>
   <strong>조회 지번</strong>
   {loading?<p role="status">지번 주소 조회 중…</p>:error?<p role="alert" className="error">{error}</p>:addresses.length?<ul>{addresses.map(a=><li key={a}>{a}</li>)}</ul>:lookedUp?<p>조회된 지번 주소 없음 · 좌표를 사용하세요.</p>:null}
   <button disabled={loading||!apiKey} onClick={()=>setRetry(v=>v+1)}>지번 다시 조회</button>
   <button disabled={loading} onClick={()=>{void (async()=>{try{await navigator.clipboard.writeText(locationReport(point,addresses));setCopyStatus('좌표·지번 복사 완료');}catch{setCopyStatus('복사하지 못했습니다. 표시된 좌표·지번을 직접 복사하세요.');}})();}}>좌표·지번 복사</button>
   <button onClick={()=>{onPoint(null);setInputError('');}}>선택 지점 지우기</button>
   {copyStatus&&<p role="status">{copyStatus}</p>}
  </div>}
  <details><summary>좌표 직접 입력 (선택)</summary><label>조회 위도<input type="number" step="any" value={lat} onChange={e=>setLat(e.target.value)}/></label><label>조회 경도<input type="number" step="any" value={lon} onChange={e=>setLon(e.target.value)}/></label><button onClick={()=>{try{onPoint(enteredLocation(lat,lon));setInputError('');}catch(e){setInputError((e as Error).message);}}}>입력 좌표 조회</button>{inputError&&<p role="alert" className="error">{inputError}</p>}</details>
  <p className="help">선택 좌표를 VWorld 주소 서버로 보내 조회합니다. 키의 Geocoder API(주소·좌표 변환) 사용 설정이 필요합니다. 조회 결과는 이 화면에서만 유지합니다.</p>
  <p className="help">지도에서 찍은 지점은 실제 화재 위치와 대조해야 합니다. 지번 주소는 참고 정보이며 필지 경계나 소유자 정보를 확인한 결과는 아닙니다.</p>
 </>;
}
