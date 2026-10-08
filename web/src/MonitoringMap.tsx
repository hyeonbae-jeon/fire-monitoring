import {useEffect,useRef,useState} from 'react';
import template from './vworld-frame.html?raw';
import {sample,parseConfiguration,sector,type MapConfiguration} from './map-model';
export function MonitoringMap(){
 const [configuration,setConfiguration]=useState<MapConfiguration>(sample),[selected,setSelected]=useState(sample.positions[0].id);
 const [key,setKey]=useState(''),[frame,setFrame]=useState<{html:string;session:string}|null>(null),[ready,setReady]=useState(false);
 const [status,setStatus]=useState('좌표 배치도 · VWorld 미연결'),[error,setError]=useState('');
 const [simulation,setSimulation]=useState(false),[heading,setHeading]=useState(0),[fov,setFov]=useState(60),[range,setRange]=useState(1000);
 const iframe=useRef<HTMLIFrameElement>(null),positions=configuration.positions,current=positions.find(p=>p.id===selected);
 const polygon=simulation&&current?sector(current,heading,fov,range):null;
 // Coordinate schematic, not a basemap or a distance-preserving projection.
 const xmin=Math.min(...positions.map(p=>p.lon),126.96)-.005,xmax=Math.max(...positions.map(p=>p.lon),126.99)+.005;
 const ymin=Math.min(...positions.map(p=>p.lat),37.64)-.005,ymax=Math.max(...positions.map(p=>p.lat),37.68)+.005;
 const xy=(lon:number,lat:number)=>[40+(lon-xmin)/(xmax-xmin)*720,440-(lat-ymin)/(ymax-ymin)*400];
 useEffect(()=>{
 if(!frame)return;let completed=false;
 const timer=window.setTimeout(()=>{if(!completed){setStatus('연결 시간 초과');setError('30초 안에 뷰어가 준비되지 않았습니다. 키 등록 주소와 SDK·지형 서버 접속을 확인하세요.');}},30000);
 const listener=(e:MessageEvent)=>{
 if(e.source!==iframe.current?.contentWindow||e.origin!==location.origin||e.data?.scope!=='vworld-prototype'||e.data.session!==frame.session)return;
 if(e.data.type==='ready'){completed=true;clearTimeout(timer);setReady(true);setStatus('VWorld 3D 뷰어 초기화 완료 · 지형 표출은 화면에서 확인하세요.');}
 if(e.data.type==='error'){completed=true;clearTimeout(timer);setReady(false);setStatus('VWorld 연결 실패');setError(String(e.data.message));}
 };window.addEventListener('message',listener);return()=>{clearTimeout(timer);window.removeEventListener('message',listener);};
 },[frame]);
 useEffect(()=>{if(frame&&ready)iframe.current?.contentWindow?.postMessage({scope:'vworld-prototype',session:frame.session,type:'draw',positions,selected,sector:polygon},location.origin);},[frame,ready,configuration,selected,simulation,heading,fov,range]);
 function connect(){const session=crypto.randomUUID(),url='https://map.vworld.kr/js/webglMapInit.js.do?version=3.0&apiKey='+encodeURIComponent(key.trim());setReady(false);setError('');setStatus('VWorld SDK 연결 중…');setFrame({session,html:template.replace('__SDK_URL__',url.replaceAll('&','&amp;').replaceAll('"','&quot;')).replace('__SESSION__',session).replace('__APP_ORIGIN__',JSON.stringify(location.origin))});setKey('');}
 async function importFile(file?:File){if(!file)return;try{if(file.size>1024*1024)throw new Error('좌표 파일은 1MB 이하여야 합니다.');const next=parseConfiguration(await file.text());setConfiguration(next);setSelected(next.positions[0]?.id??'');setSimulation(false);setError('');}catch(e){setError((e as Error).message);}}
 function download(){const url=URL.createObjectURL(new Blob([JSON.stringify(configuration,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='camera-map-positions.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 return <main className="monitoring">
 <section className="notice"><strong>위치 기반 모니터링 시안 · CCTV 읽기/제어 없음</strong><p>초기 3개 지점은 북한산 내부의 임의 시험 좌표입니다. 실제 설치 위치가 아니며 SSM UUID와 연결되지 않았습니다. 실제 방향·화각·촬영 범위는 UNKNOWN입니다.</p><p>기존 키가 허용하는 접속 주소인지 확인하세요. 키는 메모리에서만 사용하며 VWorld SDK 요청에 전달됩니다.</p></section>
 <div className="toolbar"><label>VWorld 3D 키<input type="password" autoComplete="off" value={key} onChange={e=>setKey(e.target.value)}/></label><button onClick={connect} disabled={!key.trim()}>VWorld 3D 연결</button><button onClick={()=>{setFrame(null);setReady(false);setStatus('좌표 배치도 · VWorld 미연결');setError('');}}>좌표 배치도로 보기</button></div>
 <p role="status">{status}</p>{error&&<p role="alert" className="error">{error}</p>}
 <div className="monitor-grid"><aside><h2>카메라 위치</h2>{positions.map(p=><button className={p.id===selected?'camera active':'camera'} key={p.id} onClick={()=>setSelected(p.id)}>{p.name}<small>{p.positionSource==='synthetic'?'시험 좌표':'입력 좌표'} · 방향 UNKNOWN</small></button>)}
 <button disabled={!current||!ready} onClick={()=>iframe.current?.contentWindow?.postMessage({scope:'vworld-prototype',session:frame?.session,type:'draw',positions,selected,sector:polygon,flyTo:true},location.origin)}>선택 위치로 지도 이동</button>
 <p>위도 {current?.lat??'—'} / 경도 {current?.lon??'—'}<br/>SSM UUID: {current?.ssmUuid??'미연결'}</p>
 <label>위도·경도 JSON 불러오기<input type="file" accept=".json,application/json" onChange={e=>{void importFile(e.target.files?.[0]);e.target.value='';}}/></label><button onClick={download}>좌표 설정 다운로드</button><p className="help">지도 설정은 JSON 파일로 보관합니다. Inventory 중앙 선택 설정과 별도이며 키·시험 방향은 포함하지 않습니다.</p></aside>
 <div className="map-panel">{frame?<iframe title="VWorld 3D 지도" ref={iframe} srcDoc={frame.html} sandbox="allow-scripts allow-same-origin"/>:<><p className="schematic-label">좌표 배치도 · 배경 지도/실제 지형 아님 · 북쪽 ↑</p><svg viewBox="0 0 800 480" role="img" aria-label="북한산 시험 카메라 좌표 배치도">{polygon&&<polygon points={polygon.map(([lon,lat])=>xy(lon,lat).join(',')).join(' ')} fill="#f5a623" fillOpacity=".35" stroke="#f5a623"/>}{positions.map(p=>{const[x,y]=xy(p.lon,p.lat);return <g key={p.id} onClick={()=>setSelected(p.id)}><circle cx={x} cy={y} r={p.id===selected?10:6} fill="#55deed"/><text x={x+14} y={y+5} fill="white" fontSize="16">{p.name}</text></g>;})}</svg></>}</div></div>
 <section className="notice simulation"><label className="inline"><input type="checkbox" checked={simulation} onChange={e=>setSimulation(e.target.checked)}/>시험 방향 부채꼴 표시</label><p>주황색은 수동 시험 값입니다. 실제 PTZ/촬영 영역이 아니며 고도·틸트·산에 가리는 구간을 계산하지 않습니다.</p>{simulation&&<div className="simulation-controls"><label>시험 방위각 {heading}° (북=0°, 동=90°)<input type="range" min="0" max="359" value={heading} onChange={e=>setHeading(Number(e.target.value))}/></label><label>시험 수평 화각 {fov}°<input type="range" min="10" max="120" value={fov} onChange={e=>setFov(Number(e.target.value))}/></label><label>시험 거리 {range}m<input type="range" min="100" max="3000" step="100" value={range} onChange={e=>setRange(Number(e.target.value))}/></label></div>}</section>
 <section className="notice"><h2>영상과 지형으로 방향 추정</h2><p>식별 가능한 봉우리·능선과 알려진 카메라 위치를 대조하면 수동 방향 보정부터 시도할 수 있습니다. 촬영 높이·화각·줌과 기준 지점이 필요하며, 영상만으로 정확한 PTZ를 항상 복원할 수는 없습니다.</p><p>대표 영상과 기준 지점이 확보되면 추정 방향·오차를 기록하고, 확인된 방향과 구분해 표시합니다.</p></section></main>;
}
