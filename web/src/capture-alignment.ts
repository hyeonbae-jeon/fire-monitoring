import type {FeatureMatch} from './vision-pose';

// A fixed screen-region transform, learned only after the operator confirms
// equal camera direction/zoom. It is never refitted during motion tracking:
// refitting per frame would erase real camera motion as if it were a crop.
export type CaptureAlignment={
 scaleX:number;scaleY:number;offsetX:number;offsetY:number;
 captureWidth:number;captureHeight:number;
 fitRmsPx:number;validationRmsPx:number;maxErrorPx:number;
};
export function alignCapturePoint(point:[number,number],a:CaptureAlignment):[number,number]{
 return [(point[0]-a.offsetX)/a.scaleX,(point[1]-a.offsetY)/a.scaleY];
}
export function fitCaptureAlignment(matches:FeatureMatch[],width:number,height:number,captureWidth:number,captureHeight:number):CaptureAlignment{
 if(![width,height,captureWidth,captureHeight].every(n=>Number.isFinite(n)&&n>0)||matches.some(m=>[...m.reference,...m.current].some(n=>!Number.isFinite(n)||n<0||n>1)))throw new Error('캡처 영역 보정 입력을 확인하세요.');
 const training=matches.filter(m=>!m.validation),validation=matches.filter(m=>m.validation);
 if(training.length<24||validation.length<8)throw new Error('캡처 영역을 맞출 독립 대응점이 부족합니다.');
 const axis=(i:0|1)=>{
  const x=training.reduce((s,m)=>s+m.reference[i],0)/training.length,y=training.reduce((s,m)=>s+m.current[i],0)/training.length;
  const variance=training.reduce((s,m)=>s+(m.reference[i]-x)**2,0);
  if(variance/training.length<.0005)throw new Error('캡처 영역 대응점이 한곳에 몰려 있습니다.');
  const scale=training.reduce((s,m)=>s+(m.reference[i]-x)*(m.current[i]-y),0)/variance;
  return [scale,y-scale*x];
 };
 const [scaleX,offsetX]=axis(0),[scaleY,offsetY]=axis(1);
 if(scaleX<.4||scaleX>2.5||scaleY<.4||scaleY>2.5||Math.abs(offsetX)>1.5||Math.abs(offsetY)>1.5)throw new Error('캡처 영역의 겹침이 부족하거나 크기 차이가 너무 큽니다.');
 const a={scaleX,scaleY,offsetX,offsetY,captureWidth,captureHeight,fitRmsPx:0,validationRmsPx:0,maxErrorPx:0};
 const errors=matches.map(m=>{const p=alignCapturePoint(m.current,a);return Math.hypot((p[0]-m.reference[0])*width,(p[1]-m.reference[1])*height);});
 const rms=(validation:boolean)=>Math.sqrt(errors.reduce((s,e,i)=>s+(matches[i].validation===validation?e*e:0),0)/matches.filter(m=>m.validation===validation).length);
 a.fitRmsPx=rms(false);a.validationRmsPx=rms(true);a.maxErrorPx=Math.max(...errors);
 if(a.fitRmsPx>2||a.validationRmsPx>2.5||a.maxErrorPx>8)throw new Error('캡처 영역 보정 검증 실패 · 기준 사진과 같은 방향·줌인지 확인하세요.');
 return a;
}
