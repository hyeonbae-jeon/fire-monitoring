import type {FeatureMatch} from './vision-pose';

export function verifySameCurrentView(matches:FeatureMatch[],referenceAspect:number,currentAspect:number){
 if(!Number.isFinite(referenceAspect)||!Number.isFinite(currentAspect)||referenceAspect<=0||currentAspect<=0||Math.abs(referenceAspect/currentAspect-1)>.01)throw new Error('알림과 현재 영상의 전체 촬영 영역 비율이 다릅니다.');
 const train=matches.filter(m=>!m.validation),test=matches.filter(m=>m.validation);
 if(train.length<24||test.length<8)throw new Error('같은 촬영 구도인지 확인할 수 없습니다.');
 const shifts=(items:FeatureMatch[])=>items.map(m=>{
  if([...m.reference,...m.current].some(v=>!Number.isFinite(v)||v<0||v>1))throw new Error('영상 대응 범위를 확인할 수 없습니다.');
  return Math.hypot(m.reference[0]-m.current[0],m.reference[1]-m.current[1]);
 }).sort((a,b)=>a-b);
 const a=shifts(train),b=shifts(test),median=(x:number[])=>x[Math.floor(x.length/2)],p95=(x:number[])=>x[Math.min(x.length-1,Math.floor(x.length*.95))];
 if(median(a)>.0075||median(b)>.0075||p95(a)>.015||p95(b)>.015)throw new Error('알림 이후 카메라 방향·줌 또는 촬영 영역이 바뀌었습니다.');
 return {trainingCount:train.length,validationCount:test.length,medianShift:Math.max(median(a),median(b)),p95Shift:Math.max(p95(a),p95(b))};
}
