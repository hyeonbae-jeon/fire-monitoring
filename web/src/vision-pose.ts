import {projectGeographic,solveLinear,condition} from './geographic-calibration';
import type {Pose} from './calibration-model';

export type FeatureMatch={reference:[number,number];current:[number,number];validation:boolean};
export type VisualPose={pose:Pose;fitRmsPx:number;validationRmsPx:number;maxErrorPx:number;conditionNumber:number};
const r=Math.PI/180,d=180/Math.PI;
const dot=(a:number[],b:number[])=>a.reduce((s,v,i)=>s+v*b[i],0);
export const angularDistance=(a:number,b:number)=>Math.abs(((a-b+540)%360)-180);
export function referenceRay(x:number,y:number,pose:Pose,aspect:number){
 const h=pose.headingDeg*r,p=pose.pitchDeg*r,t=Math.tan(pose.horizontalFovDeg*r/2),right=(x-.5)*2*t,up=(.5-y)*2*t/aspect;
 return [Math.sin(h)*Math.cos(p)+right*Math.cos(h)-up*Math.sin(h)*Math.sin(p),Math.cos(h)*Math.cos(p)-right*Math.sin(h)-up*Math.cos(h)*Math.sin(p),Math.sin(p)+up*Math.cos(p)];
}
// Every frame is fitted directly to the fixed reference, never to the last frame.
// The reference pose is an unvalidated manual estimate, not measured PTZ.
export function fitVisualPose(reference:Pose,referenceAspect:number,width:number,height:number,matches:FeatureMatch[]):VisualPose{
 if(![reference.headingDeg,reference.pitchDeg,reference.horizontalFovDeg,referenceAspect,width,height].every(Number.isFinite)||reference.horizontalFovDeg<5||reference.horizontalFovDeg>120||referenceAspect<=0||width<1||height<1)throw new Error('참조 영상과 기준 시점의 크기·수치를 확인하세요.');
 if(matches.some(m=>[...m.reference,...m.current].some(v=>!Number.isFinite(v)||v<0||v>1)))throw new Error('특징점 좌표 오류');
 const training=matches.filter(m=>!m.validation),validation=matches.filter(m=>m.validation);
 if(training.length<24||validation.length<8)throw new Error('계산용 또는 독립 검증 특징점 부족');
 const vectors=matches.map(m=>referenceRay(...m.reference,reference,referenceAspect)),aspect=width/height;
 const selected=matches.map((m,i)=>m.validation?-1:i).filter(i=>i>=0);
 const poseOf=(x:number[]):Pose=>({...reference,headingDeg:(x[0]*d%360+360)%360,pitchDeg:x[1]*d,horizontalFovDeg:2*Math.atan(Math.exp(x[2]))*d});
 const residual=(x:number[])=>{const pose=poseOf(x),out:number[]=[];for(const i of selected){const p=projectGeographic(vectors[i],pose,aspect);if(!p)return null;out.push((p.x-matches[i].current[0])*width,(p.y-matches[i].current[1])*height);}return out;};
 const normal=(x:number[],res:number[])=>{const cols:number[][]=[];for(let j=0;j<3;j++){const a=[...x],b=[...x];a[j]+=1e-5;b[j]-=1e-5;const ra=residual(a),rb=residual(b);if(!ra||!rb)return null;cols.push(ra.map((v,i)=>(v-rb[i])/2e-5));}return {a:cols.map(c=>cols.map(v=>dot(c,v))),g:cols.map(c=>dot(c,res))};};
 let best:{x:number[];cost:number}|null=null;
 for(const scale of [.7,1,1.4]){
  const fov=Math.max(5.1,Math.min(119.9,reference.horizontalFovDeg*scale)),t=Math.tan(fov*r/2);
  const hs=selected.map(i=>Math.atan2(vectors[i][0],vectors[i][1])-Math.atan((matches[i].current[0]-.5)*2*t));
  const ps=selected.map(i=>Math.atan2(vectors[i][2],Math.hypot(vectors[i][0],vectors[i][1]))+Math.atan((matches[i].current[1]-.5)*2*t/aspect));
  let x=[Math.atan2(hs.reduce((s,v)=>s+Math.sin(v),0),hs.reduce((s,v)=>s+Math.cos(v),0)),ps.reduce((s,v)=>s+v,0)/ps.length,Math.log(t)],lambda=.001;
  for(let it=0;it<70;it++){
   const res=residual(x);if(!res)break;const cost=dot(res,res),n=normal(x,res);if(!n)break;
   if(!best||cost<best.cost)best={x:[...x],cost};
   const step=solveLinear(n.a.map((row,i)=>row.map((v,j)=>v+(i===j?lambda*(n.a[i][i]+1):0))),n.g.map(v=>-v));if(!step)break;
   const next=x.map((v,i)=>v+step[i]);next[1]=Math.max(-80*r,Math.min(80*r,next[1]));next[2]=Math.max(Math.log(Math.tan(2.5*r)),Math.min(Math.log(Math.tan(60*r)),next[2]));
   const nr=residual(next);if(nr&&dot(nr,nr)<cost){x=next;lambda=Math.max(1e-10,lambda/4);if(Math.hypot(...step)<1e-9){if(dot(nr,nr)<best.cost)best={x:[...x],cost:dot(nr,nr)};break;}}else{lambda*=8;if(lambda>1e12)break;}
  }
 }
 if(!best)throw new Error('회전·화각 모델을 계산하지 못했습니다.');
 const pose=poseOf(best.x),res=residual(best.x)!,n=normal(best.x,res),c=n?condition(n.a):Infinity;
 const errors=matches.map((m,i)=>{const p=projectGeographic(vectors[i],pose,aspect);return p?Math.hypot((p.x-m.current[0])*width,(p.y-m.current[1])*height):Infinity;});
 const rms=(validation:boolean)=>Math.sqrt(errors.reduce((s,v,i)=>s+(matches[i].validation===validation?v*v:0),0)/matches.filter(m=>m.validation===validation).length);
 const result={pose,fitRmsPx:rms(false),validationRmsPx:rms(true),maxErrorPx:Math.max(...errors),conditionNumber:c};
 if(c>=1000||pose.horizontalFovDeg<=5.5||pose.horizontalFovDeg>=119.5||Math.abs(pose.pitchDeg)>=79.5||angularDistance(pose.headingDeg,reference.headingDeg)>45||Math.abs(pose.pitchDeg-reference.pitchDeg)>30||pose.horizontalFovDeg/reference.horizontalFovDeg<.6||pose.horizontalFovDeg/reference.horizontalFovDeg>1.8)throw new Error('기준 영상과의 변화량 또는 계산 안정성 범위를 벗어났습니다.');
 if(result.fitRmsPx>2||result.validationRmsPx>2.5||result.maxErrorPx>8)throw new Error('영상 대응은 있으나 회전·화각 모델의 독립 검증 오차가 큽니다.');
 return result;
}
