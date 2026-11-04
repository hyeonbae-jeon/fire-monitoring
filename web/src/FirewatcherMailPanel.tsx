import {useState} from 'react';
import type {Position} from './map-model';
import {mailCamera,type MailStatus} from './firewatcher-mail';
import {monitorFetch} from './monitor-server';
import {FirewatcherEventImage} from './FirewatcherEventImage';
import type {AlertProjectionControls} from './AlertLocationTool';

const statuses:Record<string,string>={
 'not-configured':'메일 수신 설정 전',disabled:'메일 수신 중지',waiting:'최초 메일 조회 대기',connected:'네이버 메일 연결 정상',
 'windows-only':'메일 수신은 Windows 실행 프로그램에서 지원합니다.','settings-error':'메일 설정을 읽지 못했습니다. 설정한 Windows 계정을 확인하세요.',
 'storage-error':'저장된 알림을 읽지 못했습니다.','authentication-error':'네이버 인증 실패 · IMAP 사용함과 앱 비밀번호를 확인하세요.',
 'connection-or-storage-error':'메일 연결 또는 저장 오류 · 자동 재시도 중'
};
const time=(value:string|null)=>value?new Date(value).toLocaleString():'미확인';
export function FirewatcherMailPanel({state,error,canManage,positions,onRefresh,onSelect,projection}:{state:MailStatus|null;error:string;canManage:boolean;positions:Position[];onRefresh:()=>void;onSelect:(id:string)=>void;projection:AlertProjectionControls}){
 const [importing,setImporting]=useState(false),[importStatus,setImportStatus]=useState('');
 const [selected,setSelected]=useState(''),[cameraId,setCameraId]=useState(''),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const event=state?.events.find(e=>e.id===selected),camera=event?mailCamera(event,positions):undefined;
 async function importPage(file?:File){
  if(!file)return;setImporting(true);setImportStatus('');
  try{
   if(file.size>12*1024*1024)throw new Error('ZIP은 12MB 이하여야 합니다.');
   const r=await monitorFetch('/api/firewatcher-mail/import',{method:'POST',headers:{'Content-Type':'application/zip'},body:file});
   const body=await r.json();if(!r.ok)throw new Error(body.error??'알림 ZIP을 읽지 못했습니다.');
   projection.clear();setSelected(body.eventId);setCameraId('');setConfirmed(false);setImportStatus('저장한 알림 페이지를 불러왔습니다. 문자 자동전달 테스트와는 별개입니다.');onRefresh();
  }catch(e){setImportStatus((e as Error).message);}finally{setImporting(false);}
 }
 async function refreshPage(){if(!event)return;setBusy(true);try{await monitorFetch('/api/firewatcher-mail/refresh',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({eventId:event.id})});onRefresh();}catch{setMessage('알림 페이지를 읽지 못했습니다.');}finally{setBusy(false);}}
 async function bind(remove=false){
  if(!event)return;setBusy(true);setMessage('');
  try{
   const r=await monitorFetch('/api/firewatcher-mail/binding',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({eventId:event.id,cameraId:remove?null:cameraId,confirmCamera:remove||confirmed})});
   if(!r.ok)throw new Error();setMessage(remove?'지도 연결을 해제했습니다.':'알림 카메라 연결을 저장했습니다.');onRefresh();
  }catch{setMessage('지도 연결을 저장하지 못했습니다. 관리자 로그인과 수신 상태를 확인하세요.');}
  finally{setBusy(false);}
 }
 return <section aria-label="FIREWATCHER 메일 알림"><h2>AI 감지 알림</h2>
  <p role="status">{error||statuses[state?.status??'']||'메일 수신 상태 조회 중…'}</p>
  {canManage&&!state?.enabled&&<p>프로그램을 종료하고 실행 폴더의 <strong>메일수신설정.cmd</strong>에서 네이버 계정을 연결한 뒤 다시 실행하세요.</p>}
  <p className="help">전달된 알림의 카메라명·감지 영상을 읽습니다. 현재 CCTV 영상과 감지 영상의 구도를 대조해 현재 장비 각도로 위치 후보를 계산합니다.</p>
  {state?.enabled&&<><p>최근 조회: {time(state.checkedAt)} · 조회 주기 {state.pollSeconds}초</p><p>보관된 알림 {state.events.length}건 · 최근 최대 {state.retainedLimit}건</p></>}
  <button onClick={onRefresh}>수신 상태 새로고침</button>
  {canManage&&<><label>저장한 알림 페이지 ZIP 불러오기<input type="file" accept=".zip,application/zip" disabled={importing} onChange={e=>{void importPage(e.target.files?.[0]);e.target.value='';}}/></label>{importStatus&&<p role="status">{importStatus}</p>}</>}
  {state?.enabled&&state.events.length===0&&<p>수신한 알림 링크가 없습니다. 문자 자동전달이 아직 실행되지 않았다면 정상일 수 있습니다.</p>}
  <div className="smoke-alert-list">{state?.events.slice(0,100).map(e=>{
   const p=mailCamera(e,positions);
   return <button key={e.id} aria-pressed={selected===e.id} onClick={()=>{setSelected(e.id);setCameraId(p?.id??'');setConfirmed(false);setMessage('');projection.clear();}}>{p?.name??e.detail?.cameraName??'카메라 확인 필요'}<small>{e.ingestionSource==='saved-page-import'?'저장 페이지':'메일 도착'} {time(e.mailReceivedAt??e.firstSeenAt)} · {p?'관리자 연결':'미연결'}</small></button>;
  })}</div>
  {(state?.events.length??0)>100&&<p>목록은 최근 100건을 표시합니다.</p>}
  {event&&<div className="smoke-alert-detail"><h3>{event.detail?.cameraName??camera?.name??'카메라 확인 필요'}</h3>
   <p>원본 감지 시각: {event.detail?.displayedTime??event.detail?.reportedTime??'미확인'}{event.detail&&' · 시간대 확인 전'}<br/>메일 작성: {time(event.mailSentAt)}<br/>메일 도착: {time(event.mailReceivedAt)}<br/>프로그램 최초 수신: {time(event.firstSeenAt)}</p>
   {event.detail&&<p>감지 종류: {event.detail.eventType}<br/>제공자 위치 구역 {event.detail.mappingCount}개 · 현재 CCTV 각도 사용</p>}
   {event.detailStatus==='unavailable'&&<p>원본 페이지 조회 실패 · 저장한 ZIP으로도 불러올 수 있습니다.</p>}
   {canManage&&<button disabled={busy} onClick={()=>void refreshPage()}>알림 페이지 다시 읽기</button>}
   <FirewatcherEventImage key={event.id+':'+event.detail?.imageSha256+':'+event.detailCheckedAt+':'+JSON.stringify(camera?.nativeTracking)} event={event} position={camera} canManage={canManage} projection={projection}/>
   <p><a href={event.link} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">원본 알림 페이지 열기 ↗</a></p>
   {camera&&<button onClick={()=>onSelect(camera.id)}>지도에서 알림 카메라 보기</button>}
   {canManage&&<fieldset><legend>알림 카메라 연결</legend><p className="help">원본 페이지의 카메라명을 확인해 이 알림에 연결하세요. 지도에는 카메라 설치점을 표시합니다.</p>
    <label>연결할 지도 카메라<select value={cameraId} onChange={e=>{setCameraId(e.target.value);setConfirmed(false);}}><option value="">선택하세요</option>{positions.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    <label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>원본 알림과 같은 카메라임을 확인했습니다.</label>
    <button disabled={busy||!confirmed||!cameraId} onClick={()=>void bind()}>알림 카메라 연결 저장</button>{event.binding&&<button disabled={busy} onClick={()=>void bind(true)}>지도 연결 해제</button>}
   </fieldset>}
   <p className="help">카메라 위치는 연기 발생점이 아닙니다. 위치 후보는 감지 영상과 구도를 대조한 현재 CCTV 각도를 사용합니다. 지도 연결 해제는 FIREWATCHER 알림을 해제하지 않습니다.</p>
   {message&&<p role="status">{message}</p>}
  </div>}
 </section>;
}
