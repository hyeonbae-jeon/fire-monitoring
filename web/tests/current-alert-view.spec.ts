import {test,expect} from '@playwright/test';
import {verifySameCurrentView} from '../src/same-current-view';
import {currentEvidenceValid,currentFrameSnapshot,sameDeviceView,type CurrentViewEvidence} from '../src/current-alert-view';
import type {Position} from '../src/map-model';
import type {AutomaticCamera} from '../src/automatic-monitoring';
import type {FeatureMatch} from '../src/vision-pose';
test('same-view verification accepts resolution changes but rejects shifted views, aspect crops and withheld-point disagreement',()=>{
 const pairs:FeatureMatch[]=[];for(let y=.3;y<.9;y+=.08)for(let x=.1;x<.9;x+=.1)pairs.push({reference:[x,y],current:[x+.001,y-.001],validation:pairs.length%4===0});
 expect(verifySameCurrentView(pairs,16/9,1920/1080).validationCount).toBeGreaterThanOrEqual(8);
 expect(()=>verifySameCurrentView(pairs,16/9,4/3)).toThrow();
 expect(()=>verifySameCurrentView(pairs.map(m=>({...m,current:[m.current[0]+.04,m.current[1]]})),16/9,16/9)).toThrow();
 expect(()=>verifySameCurrentView(pairs.map(m=>m.validation?{...m,current:[m.current[0]+.04,m.current[1]]}:m),16/9,16/9)).toThrow();
 expect(()=>verifySameCurrentView(pairs.slice(0,10),16/9,16/9)).toThrow();
});
test('current-camera evidence requires fresh paired image/PTZ, stable wrap-aware angles, same session and current camera identity',()=>{
 const now=Date.now(),stamp=new Date(now).toISOString();
 const position:Position={id:'camera',name:'합성 카메라',lat:37,lon:127,ssmUuid:null,positionSource:'operator',orientation:null,nativeTracking:{source:'operator-ptz-anchor',confidence:'approximate',savedAt:stamp,positionAtCalibration:{lat:37,lon:127},deviceAnchor:{panDeg:0,tiltDeg:0,zoom:1},pose:{headingDeg:0,pitchDeg:0,horizontalFovDeg:60,cameraHeightM:3},groundElevationM:500,zoomScale:true}};
 const camera:AutomaticCamera={cameraId:'camera',name:position.name,source:'hanwha',displayRangeM:3000,needsAttention:false,retryAt:null,feed:{status:'live',liveFrameAvailable:true,observation:{sessionId:'session',cameraLabel:position.name,status:'live',reasonCode:'snapshot-received',capturedAt:stamp,sequence:1,sceneChanged:false,lowContrast:false,referenceDifference:null},devicePtz:{enabled:true,status:'live',reasonCode:'ptz-received',sample:{panDeg:359.95,tiltDeg:0,zoom:1,zoomPulse:0,requestStartedAt:stamp,receivedAt:stamp,sequence:1}}}};
 expect(currentFrameSnapshot(position,camera,now)).not.toBeNull();
 const proof:CurrentViewEvidence={source:'matched-current-cctv',cameraId:'camera',sessionId:'session',verifiedFrames:2,firstFrameSequence:0,frameSequence:1,frameCapturedAt:stamp,ptzReceivedAt:stamp,device:{panDeg:.05,tiltDeg:0,zoom:1},frameWidth:640,frameHeight:360,matchedAt:stamp,match:{trainingCount:24,validationCount:8,medianShift:.001,p95Shift:.002}};
 expect(currentEvidenceValid(proof,position,camera,now)).toBe(true);expect(sameDeviceView({panDeg:359.95,tiltDeg:0,zoom:1},proof.device)).toBe(true);
 expect(currentEvidenceValid(proof,position,camera,now+4001)).toBe(false);
 const changed=structuredClone(camera);changed.feed.devicePtz!.sample!.panDeg=30;expect(currentEvidenceValid(proof,position,changed,now)).toBe(false);
 changed.feed.devicePtz!.sample!.panDeg=0;changed.feed.devicePtz!.sample!.zoom=2;expect(currentEvidenceValid(proof,position,changed,now)).toBe(false);
 const session=structuredClone(camera);session.feed.observation!.sessionId='other';expect(currentEvidenceValid(proof,position,session,now)).toBe(false);
 const delayed=structuredClone(camera);delayed.feed.observation!.capturedAt=new Date(now-2500).toISOString();expect(currentFrameSnapshot(position,delayed,now)).toBeNull();
});
