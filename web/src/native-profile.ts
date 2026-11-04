import type {Pose} from './calibration-model';
export type NativeProfile={source:'operator-ptz-anchor';confidence:'approximate';savedAt:string;positionAtCalibration:{lat:number;lon:number};deviceAnchor:{panDeg:number;tiltDeg:number;zoom:number};pose:Pose;groundElevationM:number|null;zoomScale:boolean};
const fields=(v:any,keys:string[])=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const range=(v:unknown,a:number,b:number)=>typeof v==='number'&&Number.isFinite(v)&&v>=a&&v<=b;
export function parseNativeProfile(v:unknown,p:{lat:number;lon:number;positionSource:string}):NativeProfile{
 const n=v as NativeProfile;
 if(!fields(n,['source','confidence','savedAt','positionAtCalibration','deviceAnchor','pose','groundElevationM','zoomScale'])||p.positionSource!=='operator'||n.source!=='operator-ptz-anchor'||n.confidence!=='approximate'||typeof n.savedAt!=='string'||!/T.*(Z|[+-]\d{2}:\d{2})$/.test(n.savedAt)||!Number.isFinite(Date.parse(n.savedAt))||!fields(n.positionAtCalibration,['lat','lon'])||n.positionAtCalibration.lat!==p.lat||n.positionAtCalibration.lon!==p.lon||!fields(n.deviceAnchor,['panDeg','tiltDeg','zoom'])||!range(n.deviceAnchor.panDeg,0,360)||!range(n.deviceAnchor.tiltDeg,-360,360)||!range(n.deviceAnchor.zoom,Number.MIN_VALUE,10000)||!fields(n.pose,['headingDeg','pitchDeg','horizontalFovDeg','cameraHeightM'])||!range(n.pose.headingDeg,0,359.999999)||!range(n.pose.pitchDeg,-80,80)||!range(n.pose.horizontalFovDeg,5,120)||!range(n.pose.cameraHeightM,.5,100)||(n.groundElevationM!==null&&!range(n.groundElevationM,-500,9000))||typeof n.zoomScale!=='boolean')throw new Error('장비 추종 기준의 출처·설치 위치·장비 값·지도 각도를 확인하세요.');
 return n;
}
