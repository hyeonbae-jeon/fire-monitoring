import cvModule from '@techstark/opencv-js';
import {fitVisualPose,type FeatureMatch} from './vision-pose';
import type {Pose} from './calibration-model';
import {alignCapturePoint,fitCaptureAlignment,type CaptureAlignment} from './capture-alignment';

// Keep the Emscripten thenable inside an object, avoiding recursive assimilation.
const runtime=new Promise<{cv:any}>(resolve=>{const mod:any=cvModule;if(mod.Mat)resolve({cv:mod});else if(mod instanceof Promise)mod.then(cv=>resolve({cv}));else mod.onRuntimeInitialized=()=>resolve({cv:mod});});
type Features={points:[number,number][];descriptors:any;width:number;height:number;sourceWidth:number;sourceHeight:number};
let reference:Features|null=null,pose:Pose|null=null,referenceAspect=0,alignment:CaptureAlignment|null=null;
function release(f:Features|null){f?.descriptors.delete();}
async function extract(cv:any,blob:Blob,normalizeTo?:Features):Promise<Features>{
 const bitmap=await createImageBitmap(blob);const w=bitmap.width,h=bitmap.height;
 if(w<160||h<120||w*h>36_000_000){bitmap.close();throw new Error('영상 크기를 확인하세요. 최소 160×120, 최대 3,600만 픽셀입니다.');}
 const scale=Math.min(1,960/Math.max(w,h)),width=normalizeTo?.width??Math.round(w*scale),height=normalizeTo?.height??Math.round(h*scale),canvas=new OffscreenCanvas(width,height),g=canvas.getContext('2d')!;g.drawImage(bitmap,0,0,width,height);bitmap.close();
 const rgba=cv.matFromImageData(g.getImageData(0,0,width,height)),gray=new cv.Mat(),mask=cv.Mat.zeros(height,width,cv.CV_8UC1),keys=new cv.KeyPointVector(),descriptors=new cv.Mat();
 const orb=new cv.ORB(3500,1.2,8,31,0,2,0,31,7);let returned=false;
 try{
  cv.cvtColor(rgba,gray,cv.COLOR_RGBA2GRAY);
  let sum=0,sq=0;for(const v of gray.data){sum+=v;sq+=v*v;}if(Math.sqrt(sq/gray.data.length-(sum/gray.data.length)**2)<8)throw new Error('저대비 영상으로 지형 특징점을 확인할 수 없습니다.');
  // Exclude the top sky band, borders, and the central cursor. This is not a cloud detector.
  cv.rectangle(mask,new cv.Point(Math.round(width*.03),Math.round(height*.2)),new cv.Point(Math.round(width*.97),Math.round(height*.95)),new cv.Scalar(255),-1);
  cv.rectangle(mask,new cv.Point(width/2-12,height/2-12),new cv.Point(width/2+12,height/2+12),new cv.Scalar(0),-1);
  orb.detectAndCompute(gray,mask,keys,descriptors);
  const points:[number,number][]=[];for(let i=0;i<keys.size();i++){const p=keys.get(i).pt;points.push([p.x,p.y]);}
  if(points.length<40)throw new Error('지형 특징점이 부족합니다. 선명하고 겹치는 지형이 필요합니다.');
  returned=true;return {points,descriptors,width,height,sourceWidth:w,sourceHeight:h};
 }finally{rgba.delete();gray.delete();mask.delete();keys.delete();orb.delete();if(!returned)descriptors.delete();}
}
function neighbors(cv:any,matcher:any,a:any,b:any){
 const pairs=new cv.DMatchVectorVector(),out=new Map<number,{index:number;distance:number}>();
 try{matcher.knnMatch(a,b,pairs,2);for(let i=0;i<pairs.size();i++){const pair=pairs.get(i);try{if(pair.size()>=2){const m=pair.get(0),n=pair.get(1);if(m.distance<.75*n.distance&&m.distance<=64)out.set(m.queryIdx,{index:m.trainIdx,distance:m.distance});}}finally{pair.delete();}}return out;}finally{pairs.delete();}
}
function hullArea(points:[number,number][]){
 const a=[...points].sort((a,b)=>a[0]-b[0]||a[1]-b[1]);if(a.length<3)return 0;
 const cross=(o:number[],a:number[],b:number[])=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);
 const half=(arr:[number,number][])=>{const h:[number,number][]=[];for(const p of arr){while(h.length>=2&&cross(h.at(-2)!,h.at(-1)!,p)<=0)h.pop();h.push(p);}h.pop();return h;};
 const h=[...half(a),...half(a.reverse())];return Math.abs(h.reduce((s,p,i)=>s+p[0]*h[(i+1)%h.length][1]-p[1]*h[(i+1)%h.length][0],0))/2;
}
function correspondences(cv:any,ref:Features,cur:Features){
 const matcher=new cv.BFMatcher(cv.NORM_HAMMING,false);
 let candidates:{a:number;b:number;distance:number}[]=[];
 try{const forward=neighbors(cv,matcher,ref.descriptors,cur.descriptors),backward=neighbors(cv,matcher,cur.descriptors,ref.descriptors);for(const [a,m] of forward)if(backward.get(m.index)?.index===a)candidates.push({a,b:m.index,distance:m.distance});}finally{matcher.delete();}
 candidates.sort((a,b)=>a.distance-b.distance);
 const unique:typeof candidates=[];for(const m of candidates){if(!unique.some(n=>Math.hypot(ref.points[m.a][0]-ref.points[n.a][0],ref.points[m.a][1]-ref.points[n.a][1])<4||Math.hypot(cur.points[m.b][0]-cur.points[n.b][0],cur.points[m.b][1]-cur.points[n.b][1])<4))unique.push(m);}
 // Withhold every fourth distinct descriptor correspondence BEFORE RANSAC.
 const training=unique.filter((_,i)=>i%4!==0),validation=unique.filter((_,i)=>i%4===0);
 if(training.length<24||validation.length<8)throw new Error(`독립 대응점 부족 · 상호 대응 ${unique.length}개`);
 const p=cv.matFromArray(training.length,1,cv.CV_32FC2,training.flatMap(m=>ref.points[m.a])),q=cv.matFromArray(training.length,1,cv.CV_32FC2,training.flatMap(m=>cur.points[m.b])),mask=new cv.Mat();let homography:any;
 try{
  cv.setRNGSeed?.(4719);homography=cv.findHomography(p,q,cv.RANSAC,2.5,mask,3000,.995);
  if(homography.empty())throw new Error('일관된 영상 대응을 찾지 못했습니다.');
  const h=homography.data64F;
  const error=(m:{a:number;b:number})=>{const [x,y]=ref.points[m.a],z=h[6]*x+h[7]*y+h[8];if(Math.abs(z)<1e-8)return Infinity;return Math.hypot((h[0]*x+h[1]*y+h[2])/z-cur.points[m.b][0],(h[3]*x+h[4]*y+h[5])/z-cur.points[m.b][1]);};
  const fitted=training.filter((m,i)=>mask.data[i]&&error(m)<=2.5),tested=validation.filter(m=>error(m)<=2.5);
  if(fitted.length<24||fitted.length/training.length<.45||tested.length<8||tested.length/validation.length<.5)throw new Error(`영상 대응 독립 검증 실패 · 계산 ${fitted.length}/${training.length}, 검증 ${tested.length}/${validation.length}`);
  for(const [feature,key] of [[ref,'a'],[cur,'b']] as const){const pts=fitted.map(m=>[feature.points[m[key]][0]/feature.width,feature.points[m[key]][1]/feature.height] as [number,number]);const xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]);if(hullArea(pts)<.02||Math.max(...xs)-Math.min(...xs)<.25||Math.max(...ys)-Math.min(...ys)<.1)throw new Error('대응점이 좁은 영역에 몰려 방향·화각을 확정할 수 없습니다.');}
  const normalized=(m:{a:number;b:number},validation:boolean):FeatureMatch=>({reference:[ref.points[m.a][0]/ref.width,ref.points[m.a][1]/ref.height],current:[cur.points[m.b][0]/cur.width,cur.points[m.b][1]/cur.height],validation});
  const matches=[...fitted.map(m=>normalized(m,false)),...tested.map(m=>normalized(m,true))];
  return {matches,features:cur.points.length,mutualCount:unique.length,trainingCount:fitted.length,validationCount:tested.length};
 }finally{p.delete();q.delete();mask.delete();homography?.delete();}
}
function match(cv:any,ref:Features,cur:Features){
 if(alignment&&(cur.sourceWidth!==alignment.captureWidth||cur.sourceHeight!==alignment.captureHeight))throw new Error('캡처 크기가 바뀌었습니다. 비교를 중지하고 캡처 영역을 다시 맞추세요.');
 const {matches,...counts}=correspondences(cv,ref,cur);
 const corrected=alignment?matches.map(m=>({...m,current:alignCapturePoint(m.current,alignment!)})).filter(m=>m.current.every(v=>v>=0&&v<=1)):matches;
 const width=alignment?ref.width:cur.width,height=alignment?ref.height:cur.height;
 return {...fitVisualPose(pose!,referenceAspect,width,height,corrected),...counts,trainingCount:corrected.filter(m=>!m.validation).length,validationCount:corrected.filter(m=>m.validation).length,analysisWidth:width,analysisHeight:height,captureAligned:!!alignment};
}
onmessage=async(e:MessageEvent)=>{
 const {id,type,blob}=e.data;
 try{
  const {cv}=await runtime;
  if(type==='reference'){release(reference);reference=null;pose=e.data.pose;referenceAspect=e.data.aspect;alignment=e.data.alignment??null;reference=await extract(cv,blob);postMessage({id,type:'ready',features:reference.points.length});}
  else if(type==='frame'||type==='align'){
   if(!reference||!pose)throw new Error('기준 영상이 준비되지 않았습니다.');let current:Features|null=null;
   try{
    current=await extract(cv,blob,type==='align'||alignment?reference:undefined);
    if(type==='align'){
     const {matches}=correspondences(cv,reference,current);
     const result=fitCaptureAlignment(matches,reference.width,reference.height,current.sourceWidth,current.sourceHeight);
     postMessage({id,type:'aligned',result});
    }else postMessage({id,type:'result',result:match(cv,reference,current)});
   }finally{release(current);}
  }
 }catch(error){postMessage({id,type:'unknown',reason:error instanceof Error?error.message:'영상 비교 모듈 오류'});}
};
