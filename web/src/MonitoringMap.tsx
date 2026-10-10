import {useEffect,useRef,useState} from 'react';
import template from './vworld-frame.html?raw';
import {sample,parseConfiguration,sector,type MapConfiguration,type Position} from './map-model';
import {TerrainCalibration,type PreviewGround,type PreviewRequest} from './TerrainCalibration';
import type {ManualOrientation} from './calibration-model';

type MapSnapshot={revision:string;configuration:MapConfiguration};
async function requestMap(options?:RequestInit):Promise<MapSnapshot>{
 const response=await fetch('/api/map-configuration',options);
 const body=await response.json().catch(()=>null);
 if(!response.ok)throw new Error(body?.error??'지도 설정 요청 실패');
 if(typeof body?.revision!=='string')throw new Error('지도 설정 응답을 확인하세요.');
 return {revision:body.revision,configuration:parseConfiguration(JSON.stringify(body.configuration))};
}
export function MonitoringMap(){
 const [configuration,setConfiguration]=useState<MapConfiguration>(sample),[selected,setSelected]=useState(sample.positions[0].id);
 const [revision,setRevision]=useState<string|null>(null),[dirty,setDirty]=useState(false),[writeKey,setWriteKey]=useState(''),[saving,setSaving]=useState(false),[storageStatus,setStorageStatus]=useState('중앙 지도 설정을 읽는 중…');
 const [name,setName]=useState(''),[latitude,setLatitude]=useState(''),[longitude,setLongitude]=useState(''),[uuid,setUuid]=useState('');
 const [key,setKey]=useState(''),[frame,setFrame]=useState<{html:string;session:string}|null>(null),[ready,setReady]=useState(false);
 const [status,setStatus]=useState('좌표 배치도 · VWorld 미연결'),[error,setError]=useState('');
 const [simulation,setSimulation]=useState(false),[heading,setHeading]=useState(0),[fov,setFov]=useState(60),[range,setRange]=useState(1000),[showEstimate,setShowEstimate]=useState(true);
 const [aspect,setAspect]=useState<number|null>(null),[previewEpoch,setPreviewEpoch]=useState(0),[calibrating,setCalibrating]=useState(false);
 const edits=useRef(0),iframe=useRef<HTMLIFrameElement>(null),pending=useRef(new Map<string,{resolve:(ground:PreviewGround)=>void;reject:(error:Error)=>void;timer:number}>());
 const positions=configuration.positions,current=positions.find(p=>p.id===selected);
 const estimate=current?.orientation?.status==='estimate'?current.orientation:null;
 const polygon=calibrating?null:simulation&&current?sector(current,heading,fov,range):showEstimate&&estimate&&current?sector(current,estimate.headingDeg,estimate.horizontalFovDeg,range):null;
 const xmin=Math.min(...positions.map(p=>p.lon),126.96)-.005,xmax=Math.max(...positions.map(p=>p.lon),126.99)+.005;
 const ymin=Math.min(...positions.map(p=>p.lat),37.64)-.005,ymax=Math.max(...positions.map(p=>p.lat),37.68)+.005;
 const xy=(lon:number,lat:number)=>[40+(lon-xmin)/(xmax-xmin)*720,440-(lat-ymin)/(ymax-ymin)*400];
 async function loadCentral(){
  const ticket=edits.current;setSaving(true);setError('');
  try{
   const next=await requestMap();if(ticket!==edits.current){setStorageStatus('현재 입력을 유지했습니다. 중앙 설정을 다시 불러온 뒤 저장하세요.');return;}setRevision(next.revision);
   const document=next.revision==='none'?sample:next.configuration;
   setConfiguration(document);setSelected(document.positions[0]?.id??'');setDirty(false);
   setStorageStatus(next.revision==='none'?'중앙 저장된 지도 설정 없음 · 초기 시험 좌표 표시':'중앙 지도 설정 불러옴');exitPreview();
  }catch(e){setRevision(null);setStorageStatus('중앙 저장 사용 불가 · JSON 파일로 보관할 수 있습니다.');setError((e as Error).message);}
  finally{setSaving(false);}
 }
 useEffect(()=>{void loadCentral();},[]);
 function cancelPending(message:string){pending.current.forEach(p=>{clearTimeout(p.timer);p.reject(new Error(message));});pending.current.clear();}
 function post(type:string,data:object={}){if(frame)iframe.current?.contentWindow?.postMessage({scope:'vworld-prototype',session:frame.session,type,...data},location.origin);}
 function exitPreview(){cancelPending('가상 시점 요청이 취소됐습니다.');setPreviewEpoch(v=>v+1);setCalibrating(false);post('end-calibration');post('draw',{positions,selected,sector:null,flyTo:true});}
 useEffect(()=>{
  if(!frame)return;let completed=false;
  const timer=window.setTimeout(()=>{if(!completed){setStatus('연결 시간 초과');setError('30초 안에 뷰어가 준비되지 않았습니다. 키 등록 주소와 SDK·지형 서버 접속을 확인하세요.');}},30000);
  const listener=(e:MessageEvent)=>{
   if(e.source!==iframe.current?.contentWindow||e.origin!==location.origin||e.data?.scope!=='vworld-prototype'||e.data.session!==frame.session)return;
   if(e.data.type==='ready'){completed=true;clearTimeout(timer);setReady(true);setStatus('VWorld 3D 뷰어 초기화 완료 · 지형 표출은 화면에서 확인하세요.');}
   if(e.data.type==='error'){completed=true;clearTimeout(timer);setReady(false);setStatus('VWorld 연결 실패');setError(String(e.data.message));cancelPending('VWorld 연결 실패');}
   if(e.data.type==='calibration-ready'||e.data.type==='calibration-error'){
    const p=pending.current.get(e.data.requestId);if(!p)return;clearTimeout(p.timer);pending.current.delete(e.data.requestId);
    if(e.data.type==='calibration-error')p.reject(new Error(String(e.data.message)));
    else if(Number.isFinite(e.data.groundElevationM)&&e.data.groundElevationM>=-500&&e.data.groundElevationM<=9000&&['operator','map-terrain'].includes(e.data.groundElevationSource))p.resolve({groundElevationM:e.data.groundElevationM,groundElevationSource:e.data.groundElevationSource});
    else p.reject(new Error('지도 높이 응답을 확인하세요.'));
   }
  };
  window.addEventListener('message',listener);return()=>{clearTimeout(timer);window.removeEventListener('message',listener);cancelPending('지도 연결이 바뀌었습니다.');};
 },[frame]);
 useEffect(()=>{if(frame&&ready)post('draw',{positions,selected,sector:polygon});},[frame,ready,configuration,selected,simulation,heading,fov,range,showEstimate,calibrating]);
 function preview(request:PreviewRequest):Promise<PreviewGround>{
  if(!frame||!ready)return Promise.reject(new Error('VWorld 3D에 먼저 연결하세요.'));
  cancelPending('새 가상 시점 요청으로 교체됐습니다.');setCalibrating(true);
  return new Promise((resolve,reject)=>{
   const requestId=crypto.randomUUID(),timer=window.setTimeout(()=>{pending.current.delete(requestId);reject(new Error('가상 시점 응답 시간 초과. 지형 로딩을 확인하세요.'));},15000);
   pending.current.set(requestId,{resolve,reject,timer});post('calibrate',{requestId,...request});
  });
 }
 function connect(){
  const session=crypto.randomUUID(),url='https://map.vworld.kr/js/webglMapInit.js.do?version=3.0&apiKey='+encodeURIComponent(key.trim());
  exitPreview();setReady(false);setError('');setStatus('VWorld SDK 연결 중…');
  setFrame({session,html:template.replace('__SDK_URL__',url.replaceAll('&','&amp;').replaceAll('"','&quot;')).replace('__SESSION__',session).replace('__APP_ORIGIN__',JSON.stringify(location.origin))});setKey('');
 }
 async function importFile(file?:File){
  if(!file)return;try{if(file.size>1024*1024)throw new Error('좌표 파일은 1MB 이하여야 합니다.');
   const next=parseConfiguration(await file.text());edits.current++;exitPreview();setConfiguration(next);setSelected(next.positions[0]?.id??'');setDirty(true);setSimulation(false);setError('');
  }catch(e){setError((e as Error).message);}
 }
 function download(){const url=URL.createObjectURL(new Blob([JSON.stringify(configuration,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='camera-map-positions.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 function addPosition(){
  try{
   if(!latitude.trim()||!longitude.trim())throw new Error('설치 위도와 경도를 입력하세요.');
   const position:Position={id:crypto.randomUUID(),name:name.trim(),lat:Number(latitude),lon:Number(longitude),ssmUuid:uuid.trim()||null,positionSource:'operator',orientation:null};
   const kept=positions.every(p=>p.positionSource==='synthetic')?[]:positions;
   const next=parseConfiguration(JSON.stringify({...configuration,positions:[...kept,position]}));
   edits.current++;exitPreview();setConfiguration(next);setSelected(position.id);setDirty(true);setError('');setName('');setLatitude('');setLongitude('');setUuid('');
  }catch(e){setError((e as Error).message);}
 }
 function saveOrientation(orientation:ManualOrientation){
  if(!current)return;
  const next=parseConfiguration(JSON.stringify({...configuration,positions:positions.map(p=>p.id===current.id?{...p,orientation}:p)}));
  edits.current++;setConfiguration(next);setDirty(true);
 }
 async function saveCentral(){
  if(revision===null)return;const ticket=edits.current;setSaving(true);setError('');
  try{
   const result=await requestMap({method:'PUT',headers:{'Content-Type':'application/json','X-Inventory-Write-Key':writeKey},body:JSON.stringify({configurationRevision:revision,configuration})});
   if(ticket===edits.current){setConfiguration(result.configuration);setDirty(false);}setRevision(result.revision);setWriteKey('');setStorageStatus(ticket===edits.current?'중앙 지도 설정 저장 완료 · 다른 브라우저에서 다시 불러올 수 있습니다.':'이전 설정 저장 완료 · 이후 변경은 추가 저장이 필요합니다.');
  }catch(e){setError((e as Error).message);}finally{setSaving(false);}
 }
 const mapPanel=<div className="map-panel" style={aspect?{height:'auto',aspectRatio:aspect}:undefined}>{frame?<iframe title="VWorld 3D 지도" ref={iframe} srcDoc={frame.html} sandbox="allow-scripts allow-same-origin"/>:<><p className="schematic-label">좌표 배치도 · 실제 지형 아님 · 북쪽 ↑</p><svg viewBox="0 0 800 480" role="img" aria-label="북한산 시험 카메라 좌표 배치도">{polygon&&<polygon points={polygon.map(([lon,lat])=>xy(lon,lat).join(',')).join(' ')} fill="#f5a623" fillOpacity=".35" stroke="#f5a623"/>}{positions.map(p=>{const[x,y]=xy(p.lon,p.lat);return <g key={p.id} onClick={()=>{exitPreview();setSelected(p.id);}}><circle cx={x} cy={y} r={p.id===selected?10:6} fill="#55deed"/><text x={x+14} y={y+5} fill="white" fontSize="16">{p.name}</text></g>;})}</svg></>}</div>;
 return <main className="monitoring">
  <section className="notice"><strong>영상·지형 보정 · 현재 PTZ 수신은 보류</strong><p>설치 위치에서 VWorld 가상 시점을 참조 화면에 맞춥니다. 저장값은 영상·지형 추정이며 현재 실측 방향·촬영 영역은 아직 확인하지 않았습니다. 초기 3개 지점은 임의 시험 좌표입니다.</p><p>키는 메모리에서만 사용하며 VWorld SDK 요청에 전달됩니다. 실제 접속 주소가 키 등록 범위에 포함돼야 합니다.</p></section>
  <div className="toolbar"><label>VWorld 3D 키<input type="password" autoComplete="off" value={key} onChange={e=>setKey(e.target.value)}/></label><button onClick={connect} disabled={!key.trim()}>VWorld 3D 연결</button><button onClick={()=>{exitPreview();setFrame(null);setReady(false);setStatus('좌표 배치도 · VWorld 미연결');setError('');}}>좌표 배치도로 보기</button></div>
  <p role="status">{status}</p>{error&&<p role="alert" className="error">{error}</p>}
  <div className="monitor-grid"><aside><h2>카메라 위치</h2>
   {positions.map(p=><button className={p.id===selected?'camera active':'camera'} key={p.id} onClick={()=>{exitPreview();setSelected(p.id);}}>{p.name}<small>{p.positionSource==='synthetic'?'시험 좌표':'입력 좌표'} · {p.orientation?.status==='estimate'?'영상·지형 추정':'방향 UNKNOWN'}</small></button>)}
   <button disabled={!current||!ready} onClick={exitPreview}>선택 위치로 지도 이동</button>
   <p>위도 {current?.lat??'—'} / 경도 {current?.lon??'—'}<br/>SSM UUID: {current?.ssmUuid??'미연결'}</p>
   <details><summary>설치 위치 추가</summary><label>카메라 위치 이름<input value={name} onChange={e=>setName(e.target.value)} maxLength={200}/></label><label>설치 위도<input type="number" value={latitude} onChange={e=>setLatitude(e.target.value)}/></label><label>설치 경도<input type="number" value={longitude} onChange={e=>setLongitude(e.target.value)}/></label><label>SSM UUID(선택)<input value={uuid} onChange={e=>setUuid(e.target.value)}/></label><button onClick={addPosition}>설치 위치 추가하기</button><p className="help">처음 실제 위치를 추가하면 초기 시험 좌표를 대체합니다. UUID는 확인된 값만 입력하세요.</p></details>
   <label>위도·경도 JSON 불러오기<input type="file" accept=".json,application/json" onChange={e=>{void importFile(e.target.files?.[0]);e.target.value='';}}/></label><button onClick={download}>좌표 설정 다운로드</button>
   <p className="help">JSON에는 저장한 추정값·기준점 메타데이터가 포함됩니다. 지도 키·참조 이미지·시험 부채꼴 값은 포함하지 않습니다.</p>
  </aside><div className="terrain-workspace">
   {current&&<TerrainCalibration key={current.id+':'+current.lat+':'+current.lon} position={current} mapPanel={mapPanel} ready={ready} previewEpoch={previewEpoch} onPreview={preview} onAspect={setAspect} onSave={saveOrientation} onExit={exitPreview}/>}
   {!current&&mapPanel}
  </div></div>
  <section className="save"><p>{storageStatus} {dirty&&'· 저장하지 않은 변경'}</p><label>지도 저장 키<input type="password" autoComplete="off" value={writeKey} onChange={e=>setWriteKey(e.target.value)}/></label><button disabled={saving||!dirty||!writeKey||revision===null} onClick={()=>void saveCentral()}>중앙 지도 설정 저장</button><button disabled={saving} onClick={()=>{if(!dirty||window.confirm('저장하지 않은 지도 설정을 버리고 다시 불러올까요?'))void loadCentral();}}>중앙 지도 설정 다시 불러오기</button><p>Windows 로컬 패키지의 저장 키는 local-demo-only입니다. 중앙 배포에서는 Bridge 저장 키를 사용합니다.</p></section>
  <section className="notice simulation"><label className="inline"><input type="checkbox" checked={showEstimate} disabled={!estimate} onChange={e=>setShowEstimate(e.target.checked)}/>저장 추정 방향 부채꼴 표시</label><label className="inline"><input type="checkbox" checked={simulation} onChange={e=>setSimulation(e.target.checked)}/>시험 방향 부채꼴 표시</label><p>부채꼴은 수평 방향 시각화입니다. 표시 거리는 임의값이며 산에 가리는 구간이나 실제 촬영 범위를 계산하지 않습니다. 가상 시점 보정 중에는 부채꼴을 숨깁니다.</p><div className="simulation-controls">{simulation&&<><label>시험 방위각 {heading}° (북=0°, 동=90°)<input type="range" min="0" max="359" value={heading} onChange={e=>setHeading(Number(e.target.value))}/></label><label>시험 수평 화각 {fov}°<input type="range" min="10" max="120" value={fov} onChange={e=>setFov(Number(e.target.value))}/></label></>}<label>표시 거리 {range}m<input type="range" min="100" max="3000" step="100" value={range} onChange={e=>setRange(Number(e.target.value))}/></label></div></section>
 </main>;
}
