import {useState} from 'react';
import type {Position} from './map-model';
import {mailCamera,type MailStatus} from './firewatcher-mail';
import {monitorFetch} from './monitor-server';

const statuses:Record<string,string>={
 'not-configured':'메일 수신 설정 전',disabled:'메일 수신 중지',waiting:'최초 메일 조회 대기',connected:'네이버 메일 연결 정상',
 'windows-only':'메일 수신은 Windows 실행 프로그램에서 지원합니다.','settings-error':'메일 설정을 읽지 못했습니다. 설정한 Windows 계정을 확인하세요.',
 'storage-error':'저장된 알림을 읽지 못했습니다.','authentication-error':'네이버 인증 실패 · IMAP 사용함과 앱 비밀번호를 확인하세요.',
 'connection-or-storage-error':'메일 연결 또는 저장 오류 · 자동 재시도 중'
};
const time=(value:string|null)=>value?new Date(value).toLocaleString():'미확인';
export function FirewatcherMailPanel({state,error,canManage,positions,onRefresh,onSelect}:{state:MailStatus|null;error:string;canManage:boolean;positions:Position[];onRefresh:()=>void;onSelect:(id:string)=>void}){
 const [selected,setSelected]=useState(''),[cameraId,setCameraId]=useState(''),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const event=state?.events.find(e=>e.id===selected),camera=event?mailCamera(event,positions):undefined;
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
  <p className="help">아이폰에서 전달한 메일의 알림 링크입니다. 원본 감지 시각·카메라 자동 판독은 아직 연결 전입니다. 알림은 원본 페이지에서 확인하세요.</p>
  {state?.enabled&&<><p>최근 조회: {time(state.checkedAt)} · 조회 주기 {state.pollSeconds}초</p><p>보관된 알림 {state.events.length}건 · 최근 최대 {state.retainedLimit}건</p></>}
  <button onClick={onRefresh}>수신 상태 새로고침</button>
  {state?.enabled&&state.events.length===0&&<p>수신한 알림 링크가 없습니다. 문자 자동전달이 아직 실행되지 않았다면 정상일 수 있습니다.</p>}
  <div className="smoke-alert-list">{state?.events.slice(0,100).map(e=>{
   const p=mailCamera(e,positions);
   return <button key={e.id} aria-pressed={selected===e.id} onClick={()=>{setSelected(e.id);setCameraId(p?.id??'');setConfirmed(false);setMessage('');}}>{p?.name??'카메라 확인 필요'}<small>메일 도착 {time(e.mailReceivedAt)} · {p?'관리자 연결':'미연결'}</small></button>;
  })}</div>
  {(state?.events.length??0)>100&&<p>목록은 최근 100건을 표시합니다.</p>}
  {event&&<div className="smoke-alert-detail"><h3>{camera?.name??'카메라 확인 필요'}</h3>
   <p>원본 감지 시각: 미확인<br/>메일 작성: {time(event.mailSentAt)}<br/>메일 도착: {time(event.mailReceivedAt)}<br/>프로그램 최초 수신: {time(event.firstSeenAt)}</p>
   <p><a href={event.link} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">원본 알림 페이지 열기 ↗</a></p>
   {camera&&<button onClick={()=>onSelect(camera.id)}>지도에서 알림 카메라 보기</button>}
   {canManage&&<fieldset><legend>알림 카메라 연결</legend><p className="help">원본 페이지의 카메라명을 확인해 이 알림에 연결하세요. 지도에는 카메라 설치점을 표시합니다.</p>
    <label>연결할 지도 카메라<select value={cameraId} onChange={e=>{setCameraId(e.target.value);setConfirmed(false);}}><option value="">선택하세요</option>{positions.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    <label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>원본 알림과 같은 카메라임을 확인했습니다.</label>
    <button disabled={busy||!confirmed||!cameraId} onClick={()=>void bind()}>알림 카메라 연결 저장</button>{event.binding&&<button disabled={busy} onClick={()=>void bind(true)}>지도 연결 해제</button>}
   </fieldset>}
   <p className="help">카메라 위치는 연기 발생점이 아닙니다. 현재 PTZ를 과거 감지 방향으로 적용하지 않습니다. 지도 연결 해제는 FIREWATCHER 알림을 해제하지 않습니다.</p>
   {message&&<p role="status">{message}</p>}
  </div>}
 </section>;
}
