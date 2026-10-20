import type {Landmark,Pose,GeographicFit} from './calibration-model';

export type CameraSite={lat:number;lon:number;groundElevationM:number;cameraHeightM:number};
export type GeographicSolution={pose:Pose;fit:GeographicFit;errors:{label:string;validation:boolean;errorPx:number;dxPx:number|null;dyPx:number|null;predicted:{x:number;y:number}|null}[];acceptable:boolean;reason:string};
const rad=Math.PI/180,deg=180/Math.PI;
const norm=(v:number[])=>Math.hypot(...v);
const dot=(a:number[],b:number[])=>a.reduce((s,v,i)=>s+v*b[i],0);
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
const wrap=(v:number)=>((v%(2*Math.PI))+2*Math.PI)%(2*Math.PI);
export function geographicVector(camera:CameraSite,target:{lat:number;lon:number;heightM:number}):number[]{
 const ecef=(lat:number,lon:number,h:number)=>{lat*=rad;lon*=rad;const n=6378137/Math.sqrt(1-.0066943799901413165*Math.sin(lat)**2);return [(n+h)*Math.cos(lat)*Math.cos(lon),(n+h)*Math.cos(lat)*Math.sin(lon),(n*(1-.0066943799901413165)+h)*Math.sin(lat)];};
 const eye=ecef(camera.lat,camera.lon,camera.groundElevationM+camera.cameraHeightM),ground=ecef(target.lat,target.lon,target.heightM),d=ground.map((v,i)=>v-eye[i]);
 const lat=camera.lat*rad,lon=camera.lon*rad;
 return [-Math.sin(lon)*d[0]+Math.cos(lon)*d[1],-Math.sin(lat)*Math.cos(lon)*d[0]-Math.sin(lat)*Math.sin(lon)*d[1]+Math.cos(lat)*d[2],Math.cos(lat)*Math.cos(lon)*d[0]+Math.cos(lat)*Math.sin(lon)*d[1]+Math.sin(lat)*d[2]];
}
// Fixed-position rectilinear model. Heights share the map's datum; roll is zero.
export function projectGeographic(vector:number[],pose:Pick<Pose,'headingDeg'|'pitchDeg'|'horizontalFovDeg'>,aspect:number):{x:number;y:number}|null{
 const h=pose.headingDeg*rad,p=pose.pitchDeg*rad,t=Math.tan(pose.horizontalFovDeg*rad/2);
 const forward=dot(vector,[Math.sin(h)*Math.cos(p),Math.cos(h)*Math.cos(p),Math.sin(p)]);
 if(forward<=norm(vector)*.01)return null;
 const right=dot(vector,[Math.cos(h),-Math.sin(h),0]),up=dot(vector,[-Math.sin(h)*Math.sin(p),-Math.cos(h)*Math.sin(p),Math.cos(p)]);
 return {x:.5+right/(2*forward*t),y:.5-up*aspect/(2*forward*t)};
}
export function measureGeographicCalibration(camera:CameraSite,width:number,height:number,landmarks:Landmark[],pose:Pose){
 const errors=landmarks.filter(m=>m.mapPoint).map(m=>{const p=projectGeographic(geographicVector(camera,m.mapPoint!),pose,width/height);return {label:m.label,validation:!!m.useForValidation,errorPx:p?Math.hypot((p.x-m.x)*width,(p.y-m.y)*height):Infinity,dxPx:p?(p.x-m.x)*width:null,dyPx:p?(p.y-m.y)*height:null,predicted:p};});
 const rms=(validation:boolean)=>{const a=errors.filter(e=>e.validation===validation);return Math.sqrt(a.reduce((s,e)=>s+e.errorPx**2,0)/a.length);};
 return {errors,fitRmsPx:rms(false),validationRmsPx:rms(true),maxErrorPx:Math.max(...errors.map(e=>e.errorPx))};
}
function solveLinear(a:number[][],b:number[]):number[]|null{
 const m=a.map((row,i)=>[...row,b[i]]),n=b.length;
 for(let c=0;c<n;c++){
  let pivot=c;for(let r=c+1;r<n;r++)if(Math.abs(m[r][c])>Math.abs(m[pivot][c]))pivot=r;
  if(Math.abs(m[pivot][c])<1e-12)return null;
  [m[c],m[pivot]]=[m[pivot],m[c]];const scale=m[c][c];for(let k=c;k<=n;k++)m[c][k]/=scale;
  for(let r=0;r<n;r++)if(r!==c){const v=m[r][c];for(let k=c;k<=n;k++)m[r][k]-=v*m[c][k];}
 }
 return m.map(row=>row[n]);
}
function condition(a:number[][]):number{
 const m=a.map(row=>[...row]);
 for(let it=0;it<40;it++){
  let p=0,q=1;for(let i=0;i<3;i++)for(let j=i+1;j<3;j++)if(Math.abs(m[i][j])>Math.abs(m[p][q])){p=i;q=j;}
  if(Math.abs(m[p][q])<1e-10)break;
  const angle=.5*Math.atan2(2*m[p][q],m[q][q]-m[p][p]),c=Math.cos(angle),s=Math.sin(angle);
  const pp=c*c*m[p][p]-2*s*c*m[p][q]+s*s*m[q][q],qq=s*s*m[p][p]+2*s*c*m[p][q]+c*c*m[q][q];
  for(let k=0;k<3;k++)if(k!==p&&k!==q){const x=m[k][p],y=m[k][q];m[k][p]=m[p][k]=c*x-s*y;m[k][q]=m[q][k]=s*x+c*y;}
  m[p][p]=pp;m[q][q]=qq;m[p][q]=m[q][p]=0;
 }
 const eigen=m.map((row,i)=>row[i]);return Math.min(...eigen)<=1e-10?Infinity:Math.sqrt(Math.max(...eigen)/Math.min(...eigen));
}
export function solveGeographicCalibration(camera:CameraSite,width:number,height:number,landmarks:Landmark[]):GeographicSolution{
 if(![camera.lat,camera.lon,camera.groundElevationM,camera.cameraHeightM,width,height].every(Number.isFinite)||Math.abs(camera.lat)>90||Math.abs(camera.lon)>180||camera.groundElevationM< -500||camera.groundElevationM>9000||camera.cameraHeightM<.5||camera.cameraHeightM>100||!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>36_000_000||landmarks.length>20)throw new Error('설치 위치·지도 높이·시험 설치 높이·영상 크기를 확인하세요.');
 const paired=landmarks.filter(m=>m.mapPoint),training=paired.filter(m=>!m.useForValidation),validation=paired.filter(m=>m.useForValidation);
 if(training.length<3||validation.length<1)throw new Error('지도에 연결한 계산용 기준점 3개와 별도 검증용 기준점 1개 이상이 필요합니다.');
 for(const m of paired){const p=m.mapPoint!;if(!m.label.trim()||![m.x,m.y,p.lat,p.lon,p.heightM].every(Number.isFinite)||m.x<0||m.x>1||m.y<0||m.y>1||Math.abs(p.lat)>90||Math.abs(p.lon)>180||p.heightM< -500||p.heightM>9000||p.source!=='map-surface')throw new Error('기준점의 영상 위치와 지도 표면 좌표를 확인하세요.');}
 if(new Set(paired.map(m=>m.x+':'+m.y)).size!==paired.length)throw new Error('중복된 영상 기준점을 제거하세요.');
 const vectors=paired.map(m=>geographicVector(camera,m.mapPoint!));
 if(vectors.some(v=>norm(v)<20||norm(v)>50000))throw new Error('기준점은 설치점에서 20m~50km 범위의 식별 가능한 지형을 선택하세요.');
 for(let i=0;i<paired.length;i++)for(let j=i+1;j<paired.length;j++)if(norm(geographicVector({...camera,lat:paired[i].mapPoint!.lat,lon:paired[i].mapPoint!.lon,groundElevationM:paired[i].mapPoint!.heightM,cameraHeightM:0},paired[j].mapPoint!))<1)throw new Error('같은 지도 지점을 여러 기준점으로 지정할 수 없습니다.');
 const span=(key:'x'|'y')=>Math.max(...training.map(m=>m[key]))-Math.min(...training.map(m=>m[key]));
 if(span('x')<.15||span('y')<.05)throw new Error('계산용 기준점을 화면의 좌우와 높이가 다른 지점으로 넓게 분산해 주세요.');
 const indices=paired.map((m,i)=>m.useForValidation?-1:i).filter(i=>i>=0),aspect=width/height;
 const poseOf=(x:number[]):Pose=>({headingDeg:wrap(x[0])*deg,pitchDeg:x[1]*deg,horizontalFovDeg:2*Math.atan(Math.exp(x[2]))*deg,cameraHeightM:camera.cameraHeightM});
 const residual=(x:number[]):number[]|null=>{const pose=poseOf(x),out:number[]=[];for(const i of indices){const p=projectGeographic(vectors[i],pose,aspect);if(!p)return null;out.push((p.x-paired[i].x)*width,(p.y-paired[i].y)*height);}return out;};
 const normal=(x:number[],r:number[])=>{
  const columns:number[][]=[];
  for(let j=0;j<3;j++){const a=[...x],b=[...x];a[j]+=1e-5;b[j]-=1e-5;const ra=residual(a),rb=residual(b);if(!ra||!rb)return null;columns.push(ra.map((v,i)=>(v-rb[i])/2e-5));}
  return {a:columns.map(c=>columns.map(d=>dot(c,d))),g:columns.map(c=>dot(c,r))};
 };
 let best:{x:number[];cost:number}|null=null;
 for(const fov of [20,35,50,70,90,115]){
  const t=Math.tan(fov*rad/2),hs=training.map(m=>{const v=geographicVector(camera,m.mapPoint!);return Math.atan2(v[0],v[1])-Math.atan((m.x-.5)*2*t);}),ps=training.map(m=>{const v=geographicVector(camera,m.mapPoint!);return Math.atan2(v[2],Math.hypot(v[0],v[1]))+Math.atan((m.y-.5)*2*t/aspect);});
  let x=[Math.atan2(hs.reduce((s,v)=>s+Math.sin(v),0),hs.reduce((s,v)=>s+Math.cos(v),0)),clamp(ps.reduce((s,v)=>s+v,0)/ps.length,-79*rad,79*rad),Math.log(t)],lambda=.001;
  for(let it=0;it<80;it++){
   const r=residual(x);if(!r)break;const cost=dot(r,r),n=normal(x,r);if(!n)break;
   if(!best||cost<best.cost)best={x:[...x],cost};
   const step=solveLinear(n.a.map((row,i)=>row.map((v,j)=>v+(i===j?lambda*(n.a[i][i]+1):0))),n.g.map(v=>-v));if(!step)break;
   const next=x.map((v,i)=>v+step[i]);next[0]=wrap(next[0]);next[1]=clamp(next[1],-80*rad,80*rad);next[2]=clamp(next[2],Math.log(Math.tan(2.5*rad)),Math.log(Math.tan(60*rad)));
   const nr=residual(next);
   if(nr&&dot(nr,nr)<cost){x=next;lambda=Math.max(1e-10,lambda/4);if(norm(step)<1e-9){if(dot(nr,nr)<best.cost)best={x:[...x],cost:dot(nr,nr)};break;}}
   else{lambda*=8;if(lambda>1e12)break;}
  }
 }
 if(!best)throw new Error('기준점으로 시점을 계산하지 못했습니다. 동일 지물 대응과 지도 위치를 확인하세요.');
 const pose=poseOf(best.x),r=residual(best.x)!,n=normal(best.x,r);
 const measured=measureGeographicCalibration(camera,width,height,paired,pose),{errors}=measured;
 const fit:GeographicFit={method:'geographic-control-points-v1',fitRmsPx:measured.fitRmsPx,validationRmsPx:measured.validationRmsPx,maxErrorPx:measured.maxErrorPx,conditionNumber:n?condition(n.a):Infinity};
 const stable=Number.isFinite(fit.conditionNumber)&&fit.conditionNumber<1000&&pose.horizontalFovDeg>5.5&&pose.horizontalFovDeg<119.5&&Math.abs(pose.pitchDeg)<79.5;
 const acceptable=stable&&fit.fitRmsPx<=5&&fit.validationRmsPx<=10&&fit.maxErrorPx<=15;
 return {pose,fit,errors,acceptable,reason:!stable?'기준점 배치나 계산 경계로 시점이 불안정합니다. 기준점을 넓게 다시 지정하세요.':!acceptable?'계산 또는 별도 검증점의 영상 오차가 큽니다. 동일 지물 대응과 높이를 확인하세요.':'계산·검증 오차 기준을 통과한 후보입니다. 실제 방향 정확도는 미검증입니다.'};
}
