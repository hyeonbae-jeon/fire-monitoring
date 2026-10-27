import {useState} from 'react';
import type {Position} from './map-model';
import {approvedPositionUpdate} from './approved-position-updates';

export function InstallationPositionEditor({position,onApply}:{position:Position;onApply:(lat:number,lon:number)=>void}){
 const [lat,setLat]=useState(String(position.lat)),[lon,setLon]=useState(String(position.lon));
 const update=approvedPositionUpdate(position);
 return <details><summary>선택 카메라 설치 좌표 수정</summary>
  <p>{position.name} · WGS84 위도·경도</p>
  {update&&<><p>수정 좌표: 위도 {update.lat} / 경도 {update.lon}</p><button onClick={()=>onApply(update.lat,update.lon)}>족두리봉 수정 좌표 적용</button></>}
  <label>수정할 설치 위도<input type="number" step="any" value={lat} onChange={e=>setLat(e.target.value)}/></label>
  <label>수정할 설치 경도<input type="number" step="any" value={lon} onChange={e=>setLon(e.target.value)}/></label>
  <button disabled={!lat.trim()||!lon.trim()||(Number(lat)===position.lat&&Number(lon)===position.lon)} onClick={()=>onApply(Number(lat),Number(lon))}>설치 좌표 수정 적용</button>
  <p className="help">좌표를 바꾸면 이 카메라의 방향·추종 기준을 다시 잡습니다. 수정 후 중앙 지도 설정 저장 또는 JSON 다운로드로 보관하세요.</p>
 </details>;
}
