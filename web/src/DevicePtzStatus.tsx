import {useEffect,useState} from 'react';

export type DevicePtz = {enabled:boolean;status:string;reasonCode:string;sample:null|{
 panDeg:number;tiltDeg:number;zoom:number;zoomPulse:number|null;requestStartedAt:string;receivedAt:string;sequence:number;
}};
export type DevicePtzObservation={value:DevicePtz;sessionId:string;cameraLabel:string};
const reasons:Record<string,string>={
 'waiting':'장비 각도 응답을 기다립니다.', 'ptz-stale':'최근 장비 값이 만료됐습니다.',
 'ptz-invalid-response':'장비 각도 응답 오류·누락·채널 불일치입니다. 604 오류도 이 상태로 처리합니다.',
 'nvt-ptz-invalid-response':'NVT 현재 위치 응답의 Pan·Tilt·Zoom 세 값과 범위를 확인할 수 없습니다.',
 'ptz-authentication-denied':'장비 각도 조회 권한이 거절됐습니다.', 'ptz-redirect-rejected':'장비 각도 조회에서 주소 이동이 요청됐습니다.',
 'ptz-http-error':'장비 각도 조회 요청이 실패했습니다.', 'ptz-timeout':'장비 각도 수신 시간이 초과됐습니다.', 'ptz-unreachable':'장비 각도 조회에 연결할 수 없습니다.',
};
export function DevicePtzStatus({value,active}:{value?:DevicePtz;active:boolean}){
 const [now,setNow]=useState(Date.now());
 useEffect(()=>{if(!active)return;setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),250);return()=>clearInterval(timer);},[active]);
 if(!active||!value?.enabled)return null;
 const sample=value.sample,received=Date.parse(sample?.receivedAt??'');
 const fresh=value.status==='live'&&sample&&Number.isFinite(received)&&now-received<=4000&&received-now<=2000;
 return <section aria-label="장비 PTZ 수신 상태"><h3>장비 Pan·Tilt·Zoom</h3>
  {fresh?<><p>Pan {sample.panDeg.toFixed(2)}° · Tilt {sample.tiltDeg.toFixed(2)}° · Zoom {sample.zoom.toFixed(2)}{sample.zoomPulse!==null&&<> · ZoomPulse {sample.zoomPulse}</>}</p>
   <p>장비 값 {sample.sequence}회 · 최근 수신: {new Date(received).toLocaleString()}</p></>:<p role="status">장비 PTZ 미확인 · {value.status==='live'?'최근 장비 값이 만료됐습니다.':reasons[value.reasonCode]??'장비 각도를 확인할 수 없습니다.'}</p>}
  <p>지도 방위각 미보정 · Pan은 장비의 회전 기준값입니다. Zoom은 수평 화각이 아닙니다. 영상과 각도는 별도 조회이며 수신 시각은 이 PC 기준입니다.</p>
  {value.status==='error'&&<p>영상 수신은 계속됩니다. 각도 재조회는 직접 연결을 종료한 뒤 다시 시작하세요.</p>}
 </section>;
}
