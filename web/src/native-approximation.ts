import type {Pose} from './calibration-model';
import type {DevicePtz} from './DevicePtzStatus';
export type NativeSample=NonNullable<DevicePtz['sample']>;
export type NativeAnchor={sample:NativeSample;pose:Pose};
export function approximateNativePose(anchor:NativeAnchor,sample:NativeSample,zoomScale:boolean):Pose{
 const p=anchor.pose,a=anchor.sample;
 if(![a.panDeg,a.tiltDeg,a.zoom,sample.panDeg,sample.tiltDeg,sample.zoom,p.headingDeg,p.pitchDeg,p.horizontalFovDeg,p.cameraHeightM].every(Number.isFinite)||a.zoom<=0||sample.zoom<=0)throw new Error('장비 값과 기준 각도를 확인하세요.');
 const delta=((sample.panDeg-a.panDeg+180)%360+360)%360-180;
 const headingDeg=((p.headingDeg+delta)%360+360)%360,pitchDeg=p.pitchDeg-(sample.tiltDeg-a.tiltDeg);
 const horizontalFovDeg=zoomScale?2*Math.atan(Math.tan(p.horizontalFovDeg*Math.PI/360)*a.zoom/sample.zoom)*180/Math.PI:p.horizontalFovDeg;
 if(pitchDeg< -80||pitchDeg>80||horizontalFovDeg<5||horizontalFovDeg>120||p.cameraHeightM<.5||p.cameraHeightM>100)throw new Error('현재 각도·줌이 시험 범위 밖입니다. 기준 각도 또는 줌 화각 근사를 확인하세요.');
 return {headingDeg,pitchDeg,horizontalFovDeg,cameraHeightM:p.cameraHeightM};
}
