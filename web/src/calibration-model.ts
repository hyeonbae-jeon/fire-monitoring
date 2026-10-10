import type {Position} from './map-model';

export type Landmark = {label:string;x:number;y:number};
export type Pose = {headingDeg:number;pitchDeg:number;horizontalFovDeg:number;cameraHeightM:number};
export type ManualOrientation = Pose & {
  source:'manual-calibration';status:'estimate'|'stale';confidence:'unvalidated';
  groundElevationM:number;groundElevationSource:'map-terrain'|'operator';
  positionAtCalibration:{lat:number;lon:number};calibratedAt:string;
  reference:{sha256:string;capturedAt:string;width:number;height:number};landmarks:Landmark[];
};
const range=(n:unknown,min:number,max:number):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max;
const date=(v:unknown):v is string=>typeof v==='string'&&/T.*(Z|[+-]\d{2}:\d{2})$/.test(v)&&Number.isFinite(Date.parse(v));
const fields=(v:unknown,keys:string[]):boolean=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>keys.includes(k))&&keys.every(k=>Object.hasOwn(v,k));

export function parseOrientation(v:unknown,p:Position):ManualOrientation|null {
  if(v===null)return null;
  const o=v as ManualOrientation;
  if(!fields(o,['source','status','confidence','headingDeg','pitchDeg','horizontalFovDeg','cameraHeightM','groundElevationM','groundElevationSource','positionAtCalibration','calibratedAt','reference','landmarks'])||
    p.positionSource!=='operator'||o.source!=='manual-calibration'||!['estimate','stale'].includes(o.status)||o.confidence!=='unvalidated'||
    !range(o.headingDeg,0,359.999999)||!range(o.pitchDeg,-80,80)||!range(o.horizontalFovDeg,5,120)||!range(o.cameraHeightM,.5,100)||!range(o.groundElevationM,-500,9000)||
    !['map-terrain','operator'].includes(o.groundElevationSource)||!fields(o.positionAtCalibration,['lat','lon'])||o.positionAtCalibration.lat!==p.lat||o.positionAtCalibration.lon!==p.lon||!date(o.calibratedAt)||
    !fields(o.reference,['sha256','capturedAt','width','height'])||typeof o.reference.sha256!=='string'||!/^[0-9a-f]{64}$/i.test(o.reference.sha256)||!date(o.reference.capturedAt)||
    !Number.isInteger(o.reference.width)||!Number.isInteger(o.reference.height)||o.reference.width<1||o.reference.height<1||o.reference.width*o.reference.height>36_000_000||
    !Array.isArray(o.landmarks)||o.landmarks.length<2||o.landmarks.length>20||o.landmarks.some(m=>!fields(m,['label','x','y'])||typeof m.label!=='string'||!m.label.trim()||m.label.length>100||!range(m.x,0,1)||!range(m.y,0,1))||
    new Set(o.landmarks.map(m=>m.x+':'+m.y)).size!==o.landmarks.length)throw new Error('보정 출처, 각도, 높이, 촬영 시각, 이미지 해시와 기준점 2개 이상을 확인하세요.');
  return o;
}
