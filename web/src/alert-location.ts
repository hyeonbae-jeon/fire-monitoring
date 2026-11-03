import type {Position} from './map-model';
import type {Pose} from './calibration-model';
import {approximateNativePose} from './native-approximation';

export type PixelBox={x:number;y:number;width:number;height:number};
export type EventDevicePose={panDeg:number;tiltDeg:number;zoom:number};
export type AlertLocationRequest={eventId:string;imageSha256:string;position:Position;frame:{width:number;height:number};box:PixelBox;device:EventDevicePose;confirmed:true;rangeM:number};
type GroundPoint={lat:number;lon:number;heightM:number;distanceM:number};
export type LocationRay={role:'left'|'center'|'right';bearingDeg:number;elevationDeg:number;samples:GroundPoint[]};
export type AlertRayGrid={key:string;request:AlertLocationRequest;pose:Pose;rays:LocationRay[];points:[number,number][]};
export type RayHit={role:LocationRay['role'];state:'intersection'|'beyond-range'|'terrain-unknown'|'camera-below-terrain';point:GroundPoint|null;intervalM:[number,number]|null;bearingDeg:number};
export type AlertLocationResult={key:string;cameraId:string;cameraName:string;source:'operator-confirmed-event-ptz';meaning:'background-terrain-candidate';rays:RayHit[];grid:AlertRayGrid;heightSource:string};
const rad=Math.PI/180,deg=180/Math.PI;
const dot=(a:number[],b:number[])=>a.reduce((s,n,i)=>s+n*b[i],0);
const norm=(v:number[])=>Math.hypot(...v);
const unit=(v:number[])=>{const n=norm(v);return v.map(x=>x/n);};
export function pixelDirection(pose:Pick<Pose,'headingDeg'|'pitchDeg'|'horizontalFovDeg'>,aspect:number,x:number,y:number){
 if(![pose.headingDeg,pose.pitchDeg,pose.horizontalFovDeg,aspect,x,y].every(Number.isFinite)||aspect<=0||pose.horizontalFovDeg<=0||pose.horizontalFovDeg>=180||x<0||x>1||y<0||y>1)throw new Error('영상 화각과 픽셀 위치를 확인하세요.');
 const h=pose.headingDeg*rad,p=pose.pitchDeg*rad,t=Math.tan(pose.horizontalFovDeg*rad/2);
 const f=[Math.sin(h)*Math.cos(p),Math.cos(h)*Math.cos(p),Math.sin(p)],r=[Math.cos(h),-Math.sin(h),0],u=[-Math.sin(h)*Math.sin(p),-Math.cos(h)*Math.sin(p),Math.cos(p)];
 const direction=unit(f.map((n,i)=>n+(2*x-1)*t*r[i]+(1-2*y)*t/aspect*u[i]));
 return {direction,bearingDeg:(Math.atan2(direction[0],direction[1])*deg+360)%360,elevationDeg:Math.asin(direction[2])*deg};
}
function ecef(lat:number,lon:number,h:number){lat*=rad;lon*=rad;const n=6378137/Math.sqrt(1-.0066943799901413165*Math.sin(lat)**2);return [(n+h)*Math.cos(lat)*Math.cos(lon),(n+h)*Math.cos(lat)*Math.sin(lon),(n*(1-.0066943799901413165)+h)*Math.sin(lat)];}
function geodetic(v:number[]){
 const e2=.0066943799901413165,q=Math.hypot(v[0],v[1]);let lat=Math.atan2(v[2],q*(1-e2));
 for(let i=0;i<10;i++){const n=6378137/Math.sqrt(1-e2*Math.sin(lat)**2);lat=Math.atan2(v[2]+e2*n*Math.sin(lat),q);}
 const n=6378137/Math.sqrt(1-e2*Math.sin(lat)**2),heightM=Math.abs(Math.cos(lat))>.001?q/Math.cos(lat)-n:v[2]/Math.sin(lat)-n*(1-e2);
 return {lat:lat*deg,lon:Math.atan2(v[1],v[0])*deg,heightM};
}
export function createAlertRayGrid(request:AlertLocationRequest):AlertRayGrid{
 const {position:p,frame:f,box:b,device:d}=request,n=p.nativeTracking;
 const valid=(x:number,lo:number,hi:number)=>Number.isFinite(x)&&x>=lo&&x<=hi;
 if(request.confirmed!==true||!n||n.positionAtCalibration.lat!==p.lat||n.positionAtCalibration.lon!==p.lon||n.groundElevationM===null||!valid(n.groundElevationM,-500,9000)||
  !request.eventId||!request.imageSha256||!Number.isInteger(f.width)||!Number.isInteger(f.height)||!valid(f.width,1,8192)||!valid(f.height,1,8192)||f.width*f.height>36_000_000||
  !valid(b.x,0,f.width)||!valid(b.y,0,f.height)||!valid(b.width,1,f.width)||!valid(b.height,1,f.height)||b.x+b.width>f.width||b.y+b.height>f.height||
  !valid(d.panDeg,0,360)||!valid(d.tiltDeg,-360,360)||!valid(d.zoom,.001,10000)||!valid(request.rangeM,100,20000))throw new Error('감지 당시 PTZ 확인과 원본 영상·박스·카메라 높이가 필요합니다.');
 const pose=approximateNativePose({sample:n.deviceAnchor,pose:n.pose},d,n.zoomScale,.05);
 const origin=ecef(p.lat,p.lon,n.groundElevationM+pose.cameraHeightM),lat=p.lat*rad,lon=p.lon*rad;
 const east=[-Math.sin(lon),Math.cos(lon),0],north=[-Math.sin(lat)*Math.cos(lon),-Math.sin(lat)*Math.sin(lon),Math.cos(lat)],up=[Math.cos(lat)*Math.cos(lon),Math.cos(lat)*Math.sin(lon),Math.sin(lat)];
 const rays:LocationRay[]=(['left','center','right'] as const).map((role,i)=>{
  const sight=pixelDirection(pose,f.width/f.height,(b.x+b.width*i/2)/f.width,(b.y+b.height)/f.height);
  const direction=origin.map((_,k)=>dot(sight.direction,[east[k],north[k],up[k]]));
  const count=Math.ceil(request.rangeM/25),samples=Array.from({length:count+1},(_,j)=>{const distanceM=request.rangeM*j/count;return {...geodetic(origin.map((v,k)=>v+direction[k]*distanceM)),distanceM};});
  return {role,bearingDeg:sight.bearingDeg,elevationDeg:sight.elevationDeg,samples};
 });
 return {key:JSON.stringify(request),request,pose,rays,points:rays.flatMap(ray=>ray.samples.map(p=>[p.lon,p.lat] as [number,number]))};
}
export function intersectAlertTerrain(grid:AlertRayGrid,heights:unknown,heightSource:string):AlertLocationResult{
 if(!['terrain-provider','scene-most-detailed','rendered-scene'].includes(heightSource)||!Array.isArray(heights)||heights.length!==grid.points.length||heights.some(h=>h!==null&&(!Number.isFinite(h)||h< -500||h>9000)))throw new Error('실제 지형 높이를 확인하지 못했습니다.');
 let offset=0;
 const rays=grid.rays.map(ray=>{
  const terrain=heights.slice(offset,offset+ray.samples.length);offset+=ray.samples.length;
  const result=(state:RayHit['state'],point:GroundPoint|null=null,intervalM:RayHit['intervalM']=null):RayHit=>({role:ray.role,state,point,intervalM,bearingDeg:ray.bearingDeg});
  if(terrain[0]===null)return result('terrain-unknown');
  if(ray.samples[0].heightM<=terrain[0])return result('camera-below-terrain');
  for(let i=1;i<terrain.length;i++){
   // Never jump an unknown foreground tile to claim a more distant first intersection.
   if(terrain[i]===null)return result('terrain-unknown');
   const a=ray.samples[i-1],b=ray.samples[i],before=a.heightM-terrain[i-1],after=b.heightM-terrain[i];
   if(after<=0){const fraction=before/(before-after),lonDelta=((b.lon-a.lon+540)%360)-180;
    return result('intersection',{lat:a.lat+(b.lat-a.lat)*fraction,lon:((a.lon+lonDelta*fraction+540)%360)-180,heightM:terrain[i-1]+(terrain[i]-terrain[i-1])*fraction,distanceM:a.distanceM+(b.distanceM-a.distanceM)*fraction},[a.distanceM,b.distanceM]);}
  }
  return result('beyond-range');
 });
 return {key:grid.key,cameraId:grid.request.position.id,cameraName:grid.request.position.name,source:'operator-confirmed-event-ptz',meaning:'background-terrain-candidate',rays,grid,heightSource};
}

// Find visible red annotations, not the underlying detector's unpublished bounding-box contract.
export function redOutlineBoxes(data:Uint8ClampedArray,width:number,height:number):PixelBox[]{
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>4_000_000||data.length!==width*height*4)throw new Error('박스 판독 영상 크기를 확인하세요.');
 const raw=new Uint8Array(width*height),mask=new Uint8Array(width*height),seen=new Uint8Array(width*height);
 for(let i=0;i<raw.length;i++){const k=i*4;if(data[k]>=80&&data[k]-data[k+1]>30&&data[k]-data[k+2]>20){raw[i]=1;const x=i%width,y=Math.floor(i/width);for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(x+dx>=0&&x+dx<width&&y+dy>=0&&y+dy<height)mask[(y+dy)*width+x+dx]=1;}}
 const boxes:PixelBox[]=[];
 for(let start=0;start<mask.length;start++){
  if(!mask[start]||seen[start])continue;
  const queue=[start];seen[start]=1;let xmin=width,xmax=-1,ymin=height,ymax=-1,count=0;
  for(let j=0;j<queue.length;j++){const p=queue[j],x=p%width,y=Math.floor(p/width);if(raw[p]){count++;xmin=Math.min(xmin,x);xmax=Math.max(xmax,x);ymin=Math.min(ymin,y);ymax=Math.max(ymax,y);}
   for(const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1]]){const nx=x+dx,ny=y+dy,k=ny*width+nx;if(nx>=0&&nx<width&&ny>=0&&ny<height&&mask[k]&&!seen[k]){seen[k]=1;queue.push(k);}}
  }
  const w=xmax-xmin+1,h=ymax-ymin+1;if(w<4||h<4||count<8||w/h<.05||w/h>20)continue;
  let border=0;for(let x=xmin;x<=xmax;x++)for(const y of [ymin,ymax])if([-1,0,1].some(d=>y+d>=0&&y+d<height&&raw[(y+d)*width+x]))border++;
  for(let y=ymin;y<=ymax;y++)for(const x of [xmin,xmax])if([-1,0,1].some(d=>x+d>=0&&x+d<width&&raw[y*width+x+d]))border++;
  if(border/(2*w+2*h)>=.4)boxes.push({x:xmin,y:ymin,width:w,height:h});
 }
 return boxes.sort((a,b)=>b.width*b.height-a.width*a.height).slice(0,20);
}
