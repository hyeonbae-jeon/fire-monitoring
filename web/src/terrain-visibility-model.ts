import {destination,type Position} from './map-model';
import {calibrationToken,coverageStatus,type CoveragePlan} from './coverage-model';

export type VisibilityState='visible'|'blocked'|'unknown';
export type HeightSource='scene-most-detailed'|'rendered-scene'|'terrain-provider';
export type VisibilityGrid={cameraId:string;key:string;position:Position;plan:CoveragePlan;spacingM:50|100;radii:number[];bearings:number[];points:[number,number][]};
export type VisibilityPolygon={state:VisibilityState;coordinates:[number,number][]};
export type VisibilityResult={cameraId:string;key:string;cameraHeightM:number;spacingM:50|100;groundElevationM:number;heightSource:HeightSource;computedAt:string;polygons:VisibilityPolygon[];counts:Record<VisibilityState,number>;areaM2:Record<VisibilityState,number>;confidence:'unvalidated'};
const earthRadius=6371008.8,angularSegments=24,epsilon=1e-9;
export const MAX_VISIBILITY_RANGE_M=5000,MAX_HEIGHT_POINTS=3001;
export function visibilityKey(position:Position,plan:CoveragePlan):string{
 return JSON.stringify([position.id,position.lat,position.lon,plan.positionAtPlan,plan.headingDeg,plan.horizontalFovDeg,plan.displayRangeM,plan.source,plan.calibrationToken,calibrationToken(position)]);
}
export function createVisibilityGrid(position:Position,plan:CoveragePlan,spacingM:50|100):VisibilityGrid{
 if(coverageStatus(plan,position)!=='ready')throw new Error('현재 위치에 맞는 범위 시안을 먼저 표시하세요.');
 if(plan.displayRangeM>MAX_VISIBILITY_RANGE_M)throw new Error('지형 가림 시안은 표시 거리 5,000m 이내에서 계산합니다. 범위 표시 거리를 줄여 주세요.');
 if(![50,100].includes(spacingM))throw new Error('높이 표본 간격은 50m 또는 100m여야 합니다.');
 const radialCount=Math.ceil(plan.displayRangeM/spacingM),radii=Array.from({length:radialCount},(_,i)=>plan.displayRangeM*(i+1)/radialCount);
 const bearings=Array.from({length:angularSegments+1},(_,i)=>plan.headingDeg-plan.horizontalFovDeg/2+plan.horizontalFovDeg*i/angularSegments);
 const points:[number,number][]=[[position.lon,position.lat],...bearings.flatMap(b=>radii.map(r=>destination(position,b,r)))];
 if(points.length>MAX_HEIGHT_POINTS)throw new Error('지형 높이 표본 수가 너무 많습니다.');
 return {cameraId:position.id,key:visibilityKey(position,plan),position,plan,spacingM,radii,bearings,points};
}
function validHeight(h:unknown):h is number{return typeof h==='number'&&Number.isFinite(h)&&h>=-500&&h<=9000;}
export function calculateVisibility(grid:VisibilityGrid,heights:unknown,cameraHeightM:number,heightSource:HeightSource):VisibilityResult{
 if(!Number.isFinite(cameraHeightM)||cameraHeightM<.5||cameraHeightM>100)throw new Error('지면 위 렌즈 높이를 0.5~100m로 입력하세요.');
 if(!['scene-most-detailed','rendered-scene','terrain-provider'].includes(heightSource)||!Array.isArray(heights)||heights.length!==grid.points.length||heights.some(h=>h!==null&&!validHeight(h)))throw new Error('지도 지형 높이 응답을 확인할 수 없습니다.');
 if(!validHeight(heights[0]))throw new Error('카메라 설치 지점의 지도 높이가 미확인입니다. 해당 지형을 로딩한 뒤 다시 계산하세요.');
 const groundElevationM=heights[0],eye=groundElevationM+cameraHeightM,n=grid.radii.length;
 const rays:VisibilityState[][]=grid.bearings.map((_,ray)=>{
  let horizon=-Infinity,gap=false;
  return grid.radii.map((distance,j)=>{
   const height=heights[1+ray*n+j];if(height===null){gap=true;return 'unknown';}
   // Compare angles in the camera's local tangent frame on a spherical Earth.
   // No atmospheric refraction or zero-height replacement for missing data.
   const theta=distance/earthRadius,horizontal=(earthRadius+height)*Math.sin(theta);
   const vertical=height-eye-(earthRadius+height)*(1-Math.cos(theta));
   const angle=Math.atan2(vertical,horizontal);
   const state:VisibilityState=angle<horizon-epsilon?'blocked':gap?'unknown':'visible';
   horizon=Math.max(horizon,angle);return state;
  });
 });
 const counts:Record<VisibilityState,number>={visible:0,blocked:0,unknown:0},areaM2:Record<VisibilityState,number>={visible:0,blocked:0,unknown:0},polygons:VisibilityPolygon[]=[];
 for(let ray=0;ray<angularSegments;ray++){
  const states=grid.radii.map((outer,j)=>{
   const corners=[rays[ray][j],rays[ray+1][j],j?rays[ray][j-1]:'visible',j?rays[ray+1][j-1]:'visible'];
   // Mixed boundary cells stay unknown; do not paint through a ridge edge.
   const state:VisibilityState=corners.every(s=>s==='visible')?'visible':corners.every(s=>s==='blocked')?'blocked':'unknown';
   const inner=j?grid.radii[j-1]:0;counts[state]++;
   areaM2[state]+=earthRadius**2*(grid.plan.horizontalFovDeg/angularSegments*Math.PI/180)*(Math.cos(inner/earthRadius)-Math.cos(outer/earthRadius));
   return state;
  });
  for(let start=0;start<n;){
   let end=start+1;while(end<n&&states[end]===states[start])end++;
   const inner=start?grid.radii[start-1]:0,outer=grid.radii[end-1],left=grid.bearings[ray],right=grid.bearings[ray+1];
   const a=destination(grid.position,left,inner),b=destination(grid.position,left,outer),c=destination(grid.position,right,outer),d=destination(grid.position,right,inner);
   // The innermost band is a triangle, not a quad with duplicate vertices.
   polygons.push({state:states[start],coordinates:inner?[a,b,c,d,a]:[a,b,c,a]});start=end;
  }
 }
 return {cameraId:grid.cameraId,key:grid.key,cameraHeightM,spacingM:grid.spacingM,groundElevationM,heightSource,computedAt:new Date().toISOString(),polygons,counts,areaM2,confidence:'unvalidated'};
}
