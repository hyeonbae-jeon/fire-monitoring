import {useEffect,useRef,useState} from 'react';

type Props={active:boolean;readKey:string;cameraLabel?:string;sessionId:string;viewing:boolean;onConnected:()=>void;onDisconnected:()=>void};
export function DirectSnapshotConnection({active,readKey,cameraLabel,sessionId,viewing,onConnected,onDisconnected}:Props){
 const [label,setLabel]=useState(cameraLabel??''),[url,setUrl]=useState(''),[username,setUsername]=useState(''),[password,setPassword]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[ownedSession,setOwnedSession]=useState('');
 const controller=useRef<AbortController|null>(null),mounted=useRef(true);
 const enabled=useRef(active);enabled.current=active;
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;controller.current?.abort();};},[]);
 useEffect(()=>{if(!active)controller.current?.abort();},[active]);
 useEffect(()=>{if(cameraLabel)setLabel(cameraLabel);},[cameraLabel]);
 async function connect(){
  const abort=new AbortController();controller.current=abort;setBusy(true);setError('');setMessage('');
  try{
   const device=new URL(url);
   if(device.pathname==='/'||device.pathname==='/wmf/index.html'){
    device.pathname='/stw-cgi/video.cgi';device.search='?msubmenu=snapshot&action=view&Profile=1';device.hash='';
   }
   const response=await fetch('/api/camera-snapshot/session',{method:'POST',headers:{'Content-Type':'application/json','X-Capture-Read-Key':readKey},cache:'no-store',signal:abort.signal,body:JSON.stringify({cameraLabel:label,snapshotUrl:device.href,username,password})});
   const data=await response.json();if(!response.ok)throw new Error(data.error??`직접 영상 연결 실패 (HTTP ${response.status})`);
   if(!mounted.current||!enabled.current)return;setOwnedSession(data.observation.sessionId);setUsername('');setMessage('JPEG 수신 성공 · 지도에서 사용할 카메라가 맞는지 확인하세요.');onConnected();
  }catch(e){if(mounted.current&&!abort.signal.aborted)setError((e as Error).message);}
  finally{if(mounted.current){setPassword('');setBusy(false);}}
 }
 async function disconnect(){
  setBusy(true);setError('');
  try{
   const response=await fetch('/api/camera-snapshot/session?'+new URLSearchParams({sessionId:sessionId||ownedSession}),{method:'DELETE',headers:{'X-Capture-Read-Key':readKey},cache:'no-store'});
   const data=await response.json();if(!response.ok)throw new Error(data.error??'직접 영상 연결을 종료하지 못했습니다.');
   if(!mounted.current)return;setOwnedSession('');setMessage('직접 연결을 종료했습니다.');onDisconnected();
  }catch(e){if(mounted.current)setError((e as Error).message);}
  finally{if(mounted.current)setBusy(false);}
 }
 return <section aria-label="한화 카메라 직접 연결"><h3>한화 JPEG 직접 수신 시험</h3>
  <p>웹뷰어가 열린 최종 장비 주소를 입력하세요. 한화 JPEG 조회 경로 한 개를 시험합니다. DDNS 주소로의 이동이나 여러 경로의 자동 시도는 하지 않습니다. Wisenet과 화면 캡처 도구는 필요하지 않습니다.</p>
  <label>직접 연결 카메라 이름<input autoComplete="off" value={label} maxLength={100} disabled={busy||viewing} onChange={e=>setLabel(e.target.value)}/></label>
  <label>카메라 웹 접속 주소<input type="url" autoComplete="off" placeholder="http://장비주소:포트" value={url} disabled={busy||viewing} onChange={e=>setUrl(e.target.value)}/></label>
  <label>카메라 장비 ID<input autoComplete="off" value={username} maxLength={128} disabled={busy||viewing} onChange={e=>setUsername(e.target.value)}/></label>
  <label>카메라 장비 PW<input type="password" autoComplete="off" value={password} maxLength={512} disabled={busy||viewing} onChange={e=>setPassword(e.target.value)}/></label>
  <button disabled={busy||viewing||!readKey||!label.trim()||!url||!username.trim()||!password} onClick={()=>void connect()}>JPEG 연결 시험·수신 시작</button>{' '}
  <button disabled={busy||!readKey||!(sessionId||ownedSession)} onClick={()=>void disconnect()}>직접 연결 종료</button>
  <p className="help">ID/PW는 이 PC의 실행 프로그램 메모리에서만 사용하며 파일·지도 JSON·브라우저 저장소에 보관하지 않습니다. 영상 조회가 약 15초 동안 없으면 직접 연결을 자동 종료합니다. 현재 한 번에 한 대를 시험합니다.</p>
  {error&&<p role="alert" className="error">{error}</p>}{message&&<p role="status">{message}</p>}
 </section>;
}
