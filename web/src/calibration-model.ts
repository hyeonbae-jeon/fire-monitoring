import type {Position} from './map-model';
import {measureGeographicCalibration} from './geographic-calibration';

// Operator's trial assumption (2026-10-13), not a measured installation height.
export const DEFAULT_TRIAL_CAMERA_HEIGHT_M=3;

export type MapControlPoint={lat:number;lon:number;heightM:number;source:'map-surface'};
export type Landmark = {label:string;x:number;y:number;mapPoint?:MapControlPoint;useForValidation?:boolean};
export type GeographicFit={method:'geographic-control-points-v1';fitRmsPx:number;validationRmsPx:number;maxErrorPx:number;conditionNumber:number};
export type Pose = {headingDeg:number;pitchDeg:number;horizontalFovDeg:number;cameraHeightM:number};
export type ManualOrientation = Pose & {
  source:'manual-calibration';status:'estimate'|'stale';confidence:'unvalidated';
  groundElevationM:number;groundElevationSource:'map-terrain'|'operator';
  positionAtCalibration:{lat:number;lon:number};calibratedAt:string;
  reference:{sha256:string;capturedAt:string;width:number;height:number};landmarks:Landmark[];geographicFit?:GeographicFit;
};
const range=(n:unknown,min:number,max:number):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max;
const date=(v:unknown):v is string=>typeof v==='string'&&/T.*(Z|[+-]\d{2}:\d{2})$/.test(v)&&Number.isFinite(Date.parse(v));
const fields=(v:unknown,keys:string[],optional:string[]=[]):boolean=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>keys.includes(k)||optional.includes(k))&&keys.every(k=>Object.hasOwn(v,k));
export function validMapControlPoint(v:unknown):v is MapControlPoint{
 const p=v as MapControlPoint;return fields(p,['lat','lon','heightM','source'])&&p.source==='map-surface'&&range(p.lat,-90,90)&&range(p.lon,-180,180)&&range(p.heightM,-500,9000);
}

export function parseOrientation(v:unknown,p:Position):ManualOrientation|null {
  if(v===null)return null;
  const o=v as ManualOrientation;
  if(!fields(o,['source','status','confidence','headingDeg','pitchDeg','horizontalFovDeg','cameraHeightM','groundElevationM','groundElevationSource','positionAtCalibration','calibratedAt','reference','landmarks'],['geographicFit'])||
    p.positionSource!=='operator'||o.source!=='manual-calibration'||!['estimate','stale'].includes(o.status)||o.confidence!=='unvalidated'||
    !range(o.headingDeg,0,359.999999)||!range(o.pitchDeg,-80,80)||!range(o.horizontalFovDeg,5,120)||!range(o.cameraHeightM,.5,100)||!range(o.groundElevationM,-500,9000)||
    !['map-terrain','operator'].includes(o.groundElevationSource)||!fields(o.positionAtCalibration,['lat','lon'])||o.positionAtCalibration.lat!==p.lat||o.positionAtCalibration.lon!==p.lon||!date(o.calibratedAt)||
    !fields(o.reference,['sha256','capturedAt','width','height'])||typeof o.reference.sha256!=='string'||!/^[0-9a-f]{64}$/i.test(o.reference.sha256)||!date(o.reference.capturedAt)||
    !Number.isInteger(o.reference.width)||!Number.isInteger(o.reference.height)||o.reference.width<1||o.reference.height<1||o.reference.width*o.reference.height>36_000_000||
    !Array.isArray(o.landmarks)||o.landmarks.length<2||o.landmarks.length>20||o.landmarks.some(m=>!fields(m,['label','x','y'],['mapPoint','useForValidation'])||typeof m.label!=='string'||!m.label.trim()||m.label.length>100||!range(m.x,0,1)||!range(m.y,0,1)||(m.mapPoint!==undefined&&!validMapControlPoint(m.mapPoint))||(m.useForValidation!==undefined&&typeof m.useForValidation!=='boolean'))||
    new Set(o.landmarks.map(m=>m.x+':'+m.y)).size!==o.landmarks.length)throw new Error('보정 출처, 각도, 높이, 촬영 시각, 이미지 해시와 기준점 2개 이상을 확인하세요.');
  if(o.geographicFit!==undefined){const f=o.geographicFit;if(!fields(f,['method','fitRmsPx','validationRmsPx','maxErrorPx','conditionNumber'])||f.method!=='geographic-control-points-v1'||!range(f.fitRmsPx,0,5)||!range(f.validationRmsPx,0,10)||!range(f.maxErrorPx,0,15)||!range(f.conditionNumber,1,1000)||o.landmarks.filter(m=>m.mapPoint&&!m.useForValidation).length<3||!o.landmarks.some(m=>m.mapPoint&&m.useForValidation))throw new Error('지도 기준점 계산 근거와 별도 검증점을 확인하세요.');
   const measured=measureGeographicCalibration({...o.positionAtCalibration,groundElevationM:o.groundElevationM,cameraHeightM:o.cameraHeightM},o.reference.width,o.reference.height,o.landmarks,o);
   if((['fitRmsPx','validationRmsPx','maxErrorPx'] as const).some(k=>!Number.isFinite(measured[k])||Math.abs(measured[k]-f[k])>.1))throw new Error('저장된 기준점·시점과 계산 오차가 일치하지 않습니다.');
  }
  return o;
}
