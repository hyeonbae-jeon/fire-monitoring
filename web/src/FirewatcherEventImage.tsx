import {useEffect,useRef,useState} from 'react';
import type {MailEvent} from './firewatcher-mail';
import type {Position} from './map-model';
import {monitorFetch} from './monitor-server';
import {redOutlineBoxes,type PixelBox} from './alert-location';
import {AlertLocationTool,type AlertProjectionControls} from './AlertLocationTool';
export function FirewatcherEventImage({event,position,canManage,projection}:{event:MailEvent;position:Position|undefined;canManage:boolean;projection:AlertProjectionControls}){
 const [frame,setFrame]=useState<{url:string;width:number;height:number;blob:Blob}|null>(null),[boxes,setBoxes]=useState<PixelBox[]>([]),[selected,setSelected]=useState<PixelBox|null>(null),[error,setError]=useState('');
 const drag=useRef<{x:number;y:number}|null>(null);
 useEffect(()=>{
  const abort=new AbortController();let stopped=false,url:string|null=null;
  setFrame(null);setBoxes([]);setSelected(null);setError('');projection.clear();
  if(!event.detail?.imageSha256)return()=>{stopped=true;abort.abort();};
  void(async()=>{
   try{
    const r=await monitorFetch('/api/firewatcher-mail/image?'+new URLSearchParams({id:event.id}),{signal:abort.signal});
    if(!r.ok)throw new Error('감지 영상을 읽지 못했습니다. 알림 다시 읽기 또는 저장한 ZIP 불러오기를 사용하세요.');
    const blob=await r.blob();if(blob.size>2*1024*1024||blob.type!=='image/jpeg')throw new Error('지원하는 감지 JPEG가 아닙니다.');
    const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(x=>x.toString(16).padStart(2,'0')).join('');
    if(hash!==event.detail?.imageSha256)throw new Error('같은 알림의 감지 영상인지 확인하지 못했습니다.');
    if(stopped)return;url=URL.createObjectURL(blob);const image=new Image();image.src=url;await image.decode();
    if(stopped)return;
    const w=image.naturalWidth,h=image.naturalHeight;if(w<1||h<1||w*h>16_000_000)throw new Error('감지 영상은 1,600만 픽셀 이하여야 합니다.');
    const scale=Math.min(1,1600/w,1000/h),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(w*scale));canvas.height=Math.max(1,Math.round(h*scale));
    const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw new Error('영상 박스 판독을 지원하지 않습니다.');ctx.drawImage(image,0,0,canvas.width,canvas.height);
    const found=redOutlineBoxes(ctx.getImageData(0,0,canvas.width,canvas.height).data,canvas.width,canvas.height).map(b=>({x:b.x*w/canvas.width,y:b.y*h/canvas.height,width:b.width*w/canvas.width,height:b.height*h/canvas.height}));
    setFrame({url,width:w,height:h,blob});setBoxes(found);setSelected(found.length===1?found[0]:null);
   }catch(e){if(!stopped){if(url){URL.revokeObjectURL(url);url=null;}setError((e as Error).message);}}
  })();
  return()=>{stopped=true;abort.abort();if(url)URL.revokeObjectURL(url);};
 },[event.id,event.detail?.imageSha256]);
 function point(e:React.PointerEvent<SVGSVGElement>){const b=e.currentTarget.getBoundingClientRect();return {x:Math.max(0,Math.min(frame!.width,(e.clientX-b.left)/b.width*frame!.width)),y:Math.max(0,Math.min(frame!.height,(e.clientY-b.top)/b.height*frame!.height))};}
 return <section aria-label="원본 감지 영상"><h3>감지 영상</h3>{error&&<p role="alert">{error}</p>}
  {frame&&<><div className="alert-reference" style={{aspectRatio:frame.width/frame.height}}><img src={frame.url} alt="FIREWATCHER 감지 당시 영상"/>
   <svg viewBox={`0 0 ${frame.width} ${frame.height}`} className={canManage?'alert-box-picker':undefined} aria-label="감지 박스 선택" onPointerDown={canManage?e=>{drag.current=point(e);e.currentTarget.setPointerCapture(e.pointerId);}:undefined} onPointerCancel={()=>{drag.current=null;}} onPointerUp={canManage?e=>{
    if(!drag.current)return;const a=drag.current,b=point(e);drag.current=null;if(Math.abs(a.x-b.x)<4||Math.abs(a.y-b.y)<4)return;
    setSelected({x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.abs(a.x-b.x),height:Math.abs(a.y-b.y)});projection.clear();
   }:undefined}>{boxes.map((b,i)=><rect key={i} {...b} fill="none" stroke="#ff7474" strokeWidth={Math.max(1,frame.width/640)}/>)}{selected&&<rect {...selected} fill="none" stroke="#ffce56" strokeWidth={Math.max(2,frame.width/320)}/>}</svg></div>
   <p>원본 {frame.width}×{frame.height} · 빨간 테두리 후보 {boxes.length}개</p>
   <p className="help">여러 박스가 있으면 선택하세요. 빨간 테두리 판독은 원본 AI 박스 좌표와 다를 수 있습니다.</p>{boxes.map((b,i)=><button key={i} onClick={()=>{setSelected(b);projection.clear();}}>감지 박스 {i+1} 선택</button>)}
   {!position&&<p>지도 카메라를 연결하면 위치 후보 계산을 사용할 수 있습니다.</p>}
   {position&&selected&&<AlertLocationTool event={event} position={position} frame={frame} blob={frame.blob} box={selected} projection={projection} canManage={canManage}/>}
  </>}
  {!event.detail?.imageSha256&&<p>감지 영상 수집 전입니다.</p>}
 </section>;
}
