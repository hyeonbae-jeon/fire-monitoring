import {automaticPose,recent,type AutomaticCamera} from './automatic-monitoring';
import type {Position} from './map-model';
import type {EventDevicePose} from './alert-location';

export type CurrentViewEvidence={source:'matched-current-cctv';cameraId:string;sessionId:string;verifiedFrames:2;firstFrameSequence:number;frameSequence:number;frameCapturedAt:string;ptzReceivedAt:string;device:EventDevicePose;frameWidth:number;frameHeight:number;matchedAt:string;match:{trainingCount:number;validationCount:number;medianShift:number;p95Shift:number}};
export type CurrentFrameSnapshot={cameraId:string;camera:AutomaticCamera;sessionId:string;sequence:number;capturedAt:string;device:EventDevicePose;ptzReceivedAt:string;now:number};
export function currentFrameSnapshot(position:Position,camera:AutomaticCamera|undefined,now:number):CurrentFrameSnapshot|null{
 if(!automaticPose(position,camera,now))return null;
 const image=camera!.feed.observation!,sample=camera!.feed.devicePtz!.sample!;
 if(Math.abs(Date.parse(image.capturedAt!)-Date.parse(sample.receivedAt))>2000||!recent(sample.requestStartedAt,now))return null;
 return {cameraId:position.id,camera:camera!,sessionId:image.sessionId,sequence:image.sequence,capturedAt:image.capturedAt!,device:{panDeg:sample.panDeg,tiltDeg:sample.tiltDeg,zoom:sample.zoom},ptzReceivedAt:sample.receivedAt,now};
}
export function sameDeviceView(a:EventDevicePose,b:EventDevicePose){
 const pan=Math.abs(((a.panDeg-b.panDeg+540)%360)-180);
 return [a.panDeg,a.tiltDeg,a.zoom,b.panDeg,b.tiltDeg,b.zoom].every(Number.isFinite)&&a.zoom>0&&b.zoom>0&&pan<=.2&&Math.abs(a.tiltDeg-b.tiltDeg)<=.2&&Math.abs(a.zoom/b.zoom-1)<=.005;
}
export function currentEvidenceValid(evidence:CurrentViewEvidence,position:Position,camera:AutomaticCamera|undefined,now:number){
 const current=currentFrameSnapshot(position,camera,now);
 return evidence.verifiedFrames===2&&evidence.firstFrameSequence<evidence.frameSequence&&evidence.match.trainingCount>=24&&evidence.match.validationCount>=8&&Number.isFinite(evidence.match.medianShift)&&evidence.match.medianShift>=0&&evidence.match.medianShift<=.0075&&Number.isFinite(evidence.match.p95Shift)&&evidence.match.p95Shift>=0&&evidence.match.p95Shift<=.015&&evidence.source==='matched-current-cctv'&&evidence.cameraId===position.id&&!!current&&current.sessionId===evidence.sessionId&&current.sequence>=evidence.frameSequence&&sameDeviceView(evidence.device,current.device);
}
