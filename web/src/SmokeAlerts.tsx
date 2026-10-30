import {useEffect,useRef,useState} from 'react';
import type {Position} from './map-model';
import {alertCameraKey,alertIdentity,bindAlertCamera,manualSmokeAlert,parseSmokeAlerts,resolveAlertCamera,MAX_ALERT_BYTES,type AlertBinding,type SmokeAlert,type SmokeAlertDocument} from './smoke-alert-model';

function AlertFrame({event}:{event:SmokeAlert}){
 const [image,setImage]=useState<{url:string;width:number;height:number}|null>(null),[error,setError]=useState('');
 const generation=useRef(0),currentUrl=useRef<string|null>(null);
 useEffect(()=>()=>{generation.current++;if(currentUrl.current)URL.revokeObjectURL(currentUrl.current);},[]);
 async function load(file?:File){
  if(!file)return;const ticket=++generation.current;let url:string|null=null;setImage(null);setError('');if(currentUrl.current)URL.revokeObjectURL(currentUrl.current);currentUrl.current=null;
  try{
   if(file.size>10*1024*1024||!['image/png','image/jpeg','image/webp'].includes(file.type))throw new Error('PNG/JPEG/WebP 이미지는 10MB 이하여야 합니다.');
   url=URL.createObjectURL(file);const element=new Image();element.src=url;await element.decode();
   if(element.naturalWidth*element.naturalHeight>36_000_000)throw new Error('참조 영상은 3,600만 픽셀 이하여야 합니다.');
   if(ticket!==generation.current){URL.revokeObjectURL(url);return;}
   if(currentUrl.current)URL.revokeObjectURL(currentUrl.current);currentUrl.current=url;
   setImage({url,width:element.naturalWidth,height:element.naturalHeight});setError('');
  }catch(e){if(url)URL.revokeObjectURL(url);if(ticket===generation.current)setError((e as Error).message);}
 }
 const boxMatches=image&&event.frameSize&&image.width===event.frameSize.width&&image.height===event.frameSize.height;
 return <><label>이 알림의 참조 영상(직접 선택)<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>{void load(e.target.files?.[0]);e.target.value='';}}/></label>
  <p className="help">이 브라우저에서만 표시합니다. 감지 시각·카메라와의 일치는 운영자가 확인해야 합니다.</p>
  {image&&<div className="alert-reference" style={{aspectRatio:image.width/image.height}}><img src={image.url} alt="알림 참조 영상 · 직접 선택"/>{event.box&&boxMatches&&<svg viewBox={`0 0 ${image.width} ${image.height}`} aria-label="입력된 연기 감지 박스"><rect x={event.box.x} y={event.box.y} width={event.box.width} height={event.box.height} fill="none" stroke="#ff4545" strokeWidth={Math.max(2,image.width/300)}/></svg>}</div>}
  {image&&event.box&&!boxMatches&&<p role="alert" className="error">원본 감지 프레임의 해상도와 달라 박스 표시를 보류합니다. 원본 영상을 확인하세요.</p>}
  {!event.box&&<p className="help">감지 박스 좌표·원본 해상도 미입력</p>}
  {error&&<p role="alert" className="error">{error}</p>}
 </>;
}

export function SmokeAlerts({document,bindings,positions,hidden,onDocument,onBindings,onHidden,onSelect,renderError}:{document:SmokeAlertDocument|null;bindings:AlertBinding[];positions:Position[];hidden:boolean;onDocument:(d:SmokeAlertDocument|null)=>void;onBindings:(b:AlertBinding[])=>void;onHidden:(v:boolean)=>void;onSelect:(id:string)=>void;renderError:string}){
 const [selected,setSelected]=useState(''),[error,setError]=useState(''),[source,setSource]=useState(''),[name,setName]=useState(''),[externalId,setExternalId]=useState(''),[time,setTime]=useState('');
 const loadGeneration=useRef(0);
 useEffect(()=>()=>{loadGeneration.current++;},[]);
 const events=document?[...document.events].sort((a,b)=>Date.parse(b.detectedAt)-Date.parse(a.detectedAt)):[];
 const current=events.find(e=>e.eventId===selected)??events[0],bound=document&&current?resolveAlertCamera(document,current,bindings,positions):null;
 const key=document&&current?alertCameraKey(document,current):null;
 const old=key?bindings.find(b=>b.key===key):null;
 function apply(d:SmokeAlertDocument){onDocument(d);setSelected([...d.events].sort((a,b)=>Date.parse(b.detectedAt)-Date.parse(a.detectedAt))[0]?.eventId??'');setError('');}
 async function load(file?:File){
  if(!file)return;const ticket=++loadGeneration.current;
  try{if(file.size>MAX_ALERT_BYTES)throw new Error('알림 자료는 1MB 이하여야 합니다.');const next=parseSmokeAlerts(await file.text());if(ticket===loadGeneration.current)apply(next);}catch(e){if(ticket===loadGeneration.current)setError((e as Error).message);}
 }
 function bind(id:string){
  if(!document||!current||!key)return;
  const p=positions.find(p=>p.id===id),kept=bindings.filter(b=>b.key!==key);onBindings(p?[...kept,bindAlertCamera(document,current,p)]:kept);
 }
 return <><h2>AI 연기감지 알림 자료</h2><p className="alert-input-mode">직접 입력·파일 시안 · FIREWATCHER 자동수신 미연동</p>
  <p className="help">알림의 카메라를 직접 연결하면 지도에서 설치 위치를 강조합니다. 연기·발화 위치는 미확인으로 남습니다.</p>
  <label className="inline"><input type="checkbox" checked={!hidden} onChange={e=>onHidden(!e.target.checked)}/>알림 카메라 표시</label>
  <label>정규화 알림 JSON 불러오기<input type="file" accept=".json,application/json" onChange={e=>{void load(e.target.files?.[0]);e.target.value='';}}/></label>
  <details><summary>알림 한 건 직접 입력</summary><label>출처·사무소 이름<input value={source} maxLength={100} placeholder="사무소별로 구분" onChange={e=>setSource(e.target.value)}/></label><label>알림 카메라 이름<input value={name} maxLength={200} onChange={e=>setName(e.target.value)}/></label><label>출처 카메라 ID(미확인 시 이름 사용)<input value={externalId} maxLength={200} onChange={e=>setExternalId(e.target.value)}/></label><label>감지 시각(한국시간)<input type="datetime-local" value={time} onChange={e=>setTime(e.target.value)}/></label><button onClick={()=>{try{loadGeneration.current++;apply(manualSmokeAlert(source,name,externalId,time));}catch(e){setError((e as Error).message);}}}>입력 알림 자료 표시</button><p className="help">입력은 현재 알림 자료를 대체합니다. 원본 시스템에 메시지를 보내거나 알림을 해제하지 않습니다.</p></details>
  {document&&<><p>{document.sourceInstance} · {events.length}건 · 지도 연결 {events.filter(e=>resolveAlertCamera(document,e,bindings,positions)).length}건</p>
   <div className="smoke-alert-list">{events.map(e=><button key={e.eventId} aria-pressed={e.eventId===current?.eventId} onClick={()=>setSelected(e.eventId)}><strong>{e.cameraName}</strong><small>{new Date(e.detectedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})} KST<br/>{resolveAlertCamera(document,e,bindings,positions)?'카메라 위치 연결됨 · 연기 위치 미확인':'지도 카메라 연결 필요'}</small></button>)}</div>
  </>}
  {document&&current&&<section className="smoke-alert-detail"><h3>{current.cameraName}</h3><p>감지 시각: {new Date(current.detectedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})} KST<br/>출처 카메라 ID: {current.cameraKey}<br/>알림 참조 ID: {current.eventId}</p>
   <label>동일 장비로 확인한 지도 카메라<select value={bound?.id??''} onChange={e=>bind(e.target.value)}><option value="">연결 미확인</option>{positions.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
   {old&&!bound&&<p className="error">지도 좌표 변경·카메라 제거로 연결 확인이 필요합니다.</p>}
   {bound&&<><p>표시 위치: 카메라 설치점<br/>위도 {bound.lat} / 경도 {bound.lon}</p><button onClick={()=>onSelect(bound.id)}>연결 카메라 지도 보기</button></>}
   <p><strong>연기 발생 지점: 미확인</strong></p><p className="help">빨간 박스는 영상 픽셀 영역입니다. 감지 시점의 방향·화각·원본 프레임과 지형 보정이 있어야 위치 후보를 검토할 수 있습니다.</p>
   <AlertFrame key={alertIdentity(document,current)} event={current}/>
  </section>}
  {document&&<button onClick={()=>{loadGeneration.current++;onDocument(null);onBindings([]);setSelected('');setError('');}}>이 화면의 알림 자료 지우기</button>}
  {error&&<p role="alert" className="error">{error}</p>}{renderError&&<p role="alert" className="error">{renderError}</p>}
  <p className="help">자료·카메라 연결·참조 영상은 브라우저 메모리에서만 유지합니다. 실제 API 응답 형식·인증·좌표 의미를 확인한 뒤 중앙 Bridge의 읽기 전용 자동수신을 연결할 수 있습니다.</p>
 </>;
}
