export type SelectedLocation={lat:number;lon:number;heightM:number|null;source:'map-surface'|'entered-coordinates'};
export function validLocation(value:unknown):value is SelectedLocation{
 const p=value as SelectedLocation|null;
 return !!p&&Number.isFinite(p.lat)&&p.lat>=-90&&p.lat<=90&&Number.isFinite(p.lon)&&p.lon>=-180&&p.lon<=180&&
  (p.source==='map-surface'?typeof p.heightM==='number'&&Number.isFinite(p.heightM)&&p.heightM>=-500&&p.heightM<=9000:p.source==='entered-coordinates'&&p.heightM===null);
}
export function enteredLocation(latitude:string,longitude:string):SelectedLocation{
 const p:SelectedLocation={lat:Number(latitude),lon:Number(longitude),heightM:null,source:'entered-coordinates'};
 if(!latitude.trim()||!longitude.trim()||!validLocation(p))throw new Error('위도 -90~90, 경도 -180~180의 좌표를 입력하세요.');
 return p;
}
export function parcelAddresses(body:unknown):string[]{
 const response=(body as {response?:{status?:unknown;result?:unknown;error?:{code?:unknown}}})?.response;
 if(response?.status==='NOT_FOUND')return [];
 if(response?.status==='ERROR')throw new Error('VWorld 주소 조회가 거절됐습니다. 키의 Geocoder API 사용 설정·등록 주소와 이용 한도를 확인하세요.');
 if(response?.status!=='OK'||!Array.isArray(response.result))throw new Error('VWorld 주소 응답 형식을 확인할 수 없습니다. 좌표로 위치를 확인하세요.');
 const addresses:string[]=[];
 for(const row of response.result){
  if(typeof row?.type!=='string'||row.type.toLowerCase()!=='parcel')continue;
  if(typeof row.text!=='string'||!row.text.trim()||row.text.length>500)throw new Error('VWorld 지번 주소 응답을 확인할 수 없습니다.');
  if(!addresses.includes(row.text.trim()))addresses.push(row.text.trim());
 }
 return addresses;
}
// Browser JSONP uses VWorld's own endpoint; no third-party CORS proxy or credentials.
export function lookupParcel(point:SelectedLocation,key:string,signal:AbortSignal,siteUrl:string):Promise<string[]>{
 if(!validLocation(point))return Promise.reject(new Error('조회할 좌표를 확인하세요.'));
 if(!key.trim())return Promise.reject(new Error('지도 키로 먼저 연결하세요. Geocoder API 사용 설정도 필요합니다.'));
 return new Promise((resolve,reject)=>{
  const callback='vworldParcel_'+crypto.randomUUID().replaceAll('-',''),script=document.createElement('script');
  const callbacks=window as unknown as Record<string,unknown>;
  const url=new URL('https://api.vworld.kr/req/address');
  url.search=new URLSearchParams({service:'address',request:'getAddress',version:'2.0',crs:'EPSG:4326',point:point.lon+','+point.lat,type:'PARCEL',format:'json',key:key.trim(),domain:siteUrl,callback}).toString();
  let finished=false;
  const finish=(error:Error|null,addresses:string[]=[])=>{
   if(finished)return;finished=true;clearTimeout(timer);signal.removeEventListener('abort',abort);script.remove();
   // A cancelled response may already be in flight. Make its callback inert.
   callbacks[callback]=()=>{};window.setTimeout(()=>{delete callbacks[callback];},60000);
   if(error)reject(error);else resolve(addresses);
  };
  const abort=()=>finish(new DOMException('주소 조회가 취소됐습니다.','AbortError'));
  const timer=window.setTimeout(()=>finish(new Error('주소 조회 시간 초과. VWorld 연결과 Geocoder API 사용 설정을 확인하세요.')),10000);
  callbacks[callback]=(body:unknown)=>{try{finish(null,parcelAddresses(body));}catch(e){finish(e as Error);}};
  script.onerror=()=>finish(new Error('VWorld 주소 서버에 연결하지 못했습니다. 네트워크와 Geocoder API 사용 설정을 확인하세요.'));
  script.onload=()=>{if(!finished)finish(new Error('VWorld 주소 응답을 읽지 못했습니다. Geocoder API 사용 설정을 확인하세요.'));};
  signal.addEventListener('abort',abort,{once:true});
  if(signal.aborted){abort();return;}
  script.src=url.toString();script.referrerPolicy='strict-origin-when-cross-origin';document.head.append(script);
 });
}
export function locationReport(point:SelectedLocation,addresses:string[]):string{
 return ['선택 지점 (실제 화재 위치 확인 필요)',`위도: ${point.lat.toFixed(6)}`,`경도: ${point.lon.toFixed(6)}`,`선택 방식: ${point.source==='map-surface'?'지도 표면 선택':'좌표 직접 입력'}`,...(addresses.length?addresses.map(a=>'조회 지번 (참고): '+a):['조회 지번: 미확인'])].join('\n');
}
