import {useEffect,useRef,useState} from 'react';

type Props={active:boolean;readKey:string;cameraLabel?:string;sessionId:string;viewing:boolean;ptzReceiving:boolean;nvt?:boolean;onConnected:()=>void;onDisconnected:()=>void};
export function DirectSnapshotConnection({active,readKey,cameraLabel,sessionId,viewing,ptzReceiving,nvt=false,onConnected,onDisconnected}:Props){
 const [label,setLabel]=useState(cameraLabel??''),[url,setUrl]=useState(''),[username,setUsername]=useState(''),[password,setPassword]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[ownedSession,setOwnedSession]=useState('');
 const [readDevicePtz,setReadDevicePtz]=useState(false);
 const controller=useRef<AbortController|null>(null),mounted=useRef(true);
 const enabled=useRef(active);enabled.current=active;
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;controller.current?.abort();};},[]);
 useEffect(()=>{if(!active)controller.current?.abort();},[active]);
 useEffect(()=>{if(!viewing)controller.current?.abort();},[viewing]);
 useEffect(()=>{controller.current?.abort();},[sessionId]);
 useEffect(()=>{if(cameraLabel)setLabel(cameraLabel);},[cameraLabel]);
 async function connect(){
  const abort=new AbortController();controller.current=abort;setBusy(true);setError('');setMessage('');
  try{
   let device:URL;
   try{device=new URL(url.trim());}catch{throw new Error(nvt?'NVT JPEG 요청 전체 주소를 확인하세요.':'카메라 웹 접속 주소를 확인하세요.');}
   if(!nvt&&(device.pathname==='/'||device.pathname==='/wmf/index.html')){
    device.pathname='/stw-cgi/video.cgi';device.search='?msubmenu=snapshot&action=view&Profile=1';device.hash='';
   }
   const connection=nvt?{cameraLabel:label,snapshotUrl:device.href,source:'nvt-getimage'}:{cameraLabel:label,snapshotUrl:device.href,username,password,...(readDevicePtz?{readDevicePtz:true}:{})};
   const response=await fetch('/api/camera-snapshot/session',{method:'POST',headers:{'Content-Type':'application/json','X-Capture-Read-Key':readKey},cache:'no-store',signal:abort.signal,body:JSON.stringify(connection)});
   const data=await response.json();if(!response.ok)throw new Error(data.error??`직접 영상 연결 실패 (HTTP ${response.status})`);
   if(!mounted.current||!enabled.current)return;setOwnedSession(data.observation.sessionId);setUsername('');setMessage('JPEG 수신 성공 · 지도에서 사용할 카메라가 맞는지 확인하세요.');onConnected();
  }catch(e){if(mounted.current&&!abort.signal.aborted)setError((e as Error).message);}
  finally{if(mounted.current){setPassword('');if(nvt)setUrl('');setBusy(false);}}
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
 async function saveReference(){
  const abort=new AbortController();controller.current=abort;setBusy(true);setError('');setMessage('');
  try{
   const response=await fetch('/api/camera-snapshot/reference',{method:'POST',headers:{'Content-Type':'application/json','X-Capture-Read-Key':readKey},body:JSON.stringify({sessionId}),cache:'no-store',signal:abort.signal});
   if(!response.ok){const data=await response.json();throw new Error(data.error??`기준 묶음 저장 실패 (HTTP ${response.status})`);}
   if(!response.headers.get('Content-Type')?.startsWith('application/zip'))throw new Error('기준 묶음 ZIP 응답을 확인할 수 없습니다.');
   const blob=await response.blob();if(!mounted.current||!enabled.current||abort.signal.aborted)return;
   const downloadUrl=URL.createObjectURL(blob),link=document.createElement('a');link.href=downloadUrl;link.download='cctv-ptz-reference-'+new Date().toISOString().replace(/[:.]/g,'-')+'.zip';link.click();setTimeout(()=>URL.revokeObjectURL(downloadUrl),30000);
   setMessage('영상·PTZ 기준 묶음을 저장했습니다. 같은 방식으로 다른 시점도 저장하세요.');
  }catch(e){if(mounted.current&&!abort.signal.aborted)setError((e as Error).message);}
  finally{if(mounted.current)setBusy(false);}
 }
 return <section aria-label={nvt?'NVT 카메라 직접 연결':'한화 카메라 직접 연결'}><h3>{nvt?'NVT GetImage 직접 수신':'한화 JPEG 직접 수신 시험'}</h3>
  <p>{nvt?'NVT 웹뷰어의 Network에서 확인한 GetImage.cgi 요청 전체 주소를 붙여넣으세요. USER·PWD 값은 변환하지 않고 그대로 사용합니다.':'웹뷰어가 열린 최종 장비 주소를 입력하세요. 한화 JPEG 조회 경로 한 개를 시험합니다. DDNS 주소로의 이동이나 여러 경로의 자동 시도는 하지 않습니다. Wisenet과 화면 캡처 도구는 필요하지 않습니다.'}</p>
  <label>직접 연결 카메라 이름<input autoComplete="off" value={label} maxLength={100} disabled={busy||viewing} onChange={e=>setLabel(e.target.value)}/></label>
  {nvt?<label>NVT JPEG 요청 전체 주소<input type="password" autoComplete="off" placeholder="GetImage.cgi 요청 전체 주소 붙여넣기" value={url} disabled={busy||viewing} onChange={e=>setUrl(e.target.value)}/></label>:<>
  <label>카메라 웹 접속 주소<input type="url" autoComplete="off" placeholder="http://장비주소:포트" value={url} disabled={busy||viewing} onChange={e=>setUrl(e.target.value)}/></label>
  <label>카메라 장비 ID<input autoComplete="off" value={username} maxLength={128} disabled={busy||viewing} onChange={e=>setUsername(e.target.value)}/></label>
  <label>카메라 장비 PW<input type="password" autoComplete="off" value={password} maxLength={512} disabled={busy||viewing} onChange={e=>setPassword(e.target.value)}/></label>
  <label><input type="checkbox" checked={readDevicePtz} disabled={busy||viewing} onChange={e=>setReadDevicePtz(e.target.checked)}/>장비 Pan·Tilt·Zoom 함께 조회</label>
  <p className="help">숨은벽에서 확인한 현재 값 조회를 사용합니다. 회전 명령은 보내지 않습니다. 지도 방위각·기울기·화각 보정은 다음 단계입니다.</p></>}
  {nvt&&<p className="help">영상만 수신합니다. NVT 장비 PTZ 조회와 지도 자동 추종은 아직 지원하지 않습니다.</p>}
  <button disabled={busy||viewing||!readKey||!label.trim()||!url||!nvt&&(!username.trim()||!password)} onClick={()=>void connect()}>JPEG 연결 시험·수신 시작</button>{' '}
  <button disabled={busy||!readKey||!(sessionId||ownedSession)} onClick={()=>void disconnect()}>직접 연결 종료</button>
  {!nvt&&<><button disabled={busy||!viewing||!readKey||!sessionId||!ptzReceiving} onClick={()=>void saveReference()}>영상·PTZ 기준 묶음 저장</button>
  <p className="help">카메라가 멈춘 상태에서 저장하세요. 같은 JPEG 경로의 원본과 저장 전후 PTZ·시각을 한 ZIP에 담습니다. 전후 값이 바뀌면 저장을 거절합니다. 센서 촬영 시각의 동기화를 보장하지는 않습니다.</p></>}
  <p className="help">{nvt?'인증값이 담긴 요청 주소':'ID/PW'}는 이 PC의 실행 프로그램 메모리에서만 사용하며 파일·지도 JSON·브라우저 저장소에 보관하지 않습니다. 영상 조회가 약 15초 동안 없으면 직접 연결을 자동 종료합니다. 현재 한 번에 한 대를 시험합니다.</p>
  {error&&<p role="alert" className="error">{error}</p>}{message&&<p role="status">{message}</p>}
 </section>;
}
