import {sector,type Position} from './map-model';

export type CoveragePlan={cameraId:string;positionAtPlan:{lat:number;lon:number};source:'manual-preview'|'manual-calibration';calibrationToken:string|null;headingDeg:number;horizontalFovDeg:number;displayRangeM:number;enabled:boolean;updatedAt:string};
export type CoverageDocument={schemaVersion:1;kind:'coverage-preview';confidence:'unvalidated';plans:CoveragePlan[]};
export type CoverageShape={cameraId:string;name:string;color:string;source:CoveragePlan['source'];coordinates:[number,number][];centerline:[number,number][]};
const colors=['#ffca68','#62d9fa','#f58cc7','#a1da71','#b3a5ff','#fb986c','#60d5bb','#f4df80','#92b7ff'];
export function coverageColor(id:string){let hash=0;for(const c of id)hash=(Math.imul(hash,31)+c.charCodeAt(0))>>>0;return colors[hash%colors.length];}
export function calibrationToken(p:Position):string|null{
 const o=p.orientation;if(!o||o.status!=='estimate')return null;
 return JSON.stringify([o.calibratedAt,o.reference.sha256,o.reference.capturedAt,o.headingDeg,o.horizontalFovDeg,o.pitchDeg,o.cameraHeightM,o.groundElevationM]);
}
export function coverageStatus(plan:CoveragePlan|undefined,p:Position):'unset'|'position-changed'|'calibration-stale'|'hidden'|'ready'{
 if(!plan)return 'unset';
 if(plan.positionAtPlan.lat!==p.lat||plan.positionAtPlan.lon!==p.lon)return 'position-changed';
 if(plan.source==='manual-calibration'&&plan.calibrationToken!==calibrationToken(p))return 'calibration-stale';
 return plan.enabled?'ready':'hidden';
}
export function buildCoverageShapes(positions:Position[],plans:CoveragePlan[],selectedOnly:string|null=null):CoverageShape[]{
 const byId=new Map(plans.map(p=>[p.cameraId,p]));
 return positions.flatMap(p=>{
  const plan=byId.get(p.id);if(!plan||coverageStatus(plan,p)!=='ready'||selectedOnly!==null&&p.id!==selectedOnly)return [];
  const coordinates=sector(p,plan.headingDeg,plan.horizontalFovDeg,plan.displayRangeM);
  return [{cameraId:p.id,name:p.name,color:coverageColor(p.id),source:plan.source,coordinates,centerline:[coordinates[0],coordinates[13]]}];
 });
}
export function serializeCoverage(plans:CoveragePlan[]):string{return JSON.stringify({schemaVersion:1,kind:'coverage-preview',confidence:'unvalidated',plans} satisfies CoverageDocument);}
export function parseCoverage(text:string):CoveragePlan[]{
 const fail=()=>{throw new Error('범위 시안의 형식·출처·좌표·각도·표시 거리와 중복 카메라를 확인하세요.');};
 const fields=(v:any,keys:string[])=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
 const within=(n:unknown,min:number,max:number)=>typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max;
 if(text.length>1024*1024)throw new Error('범위 시안은 1MB 이하여야 합니다.');
 const v=JSON.parse(text);if(!fields(v,['schemaVersion','kind','confidence','plans'])||v.schemaVersion!==1||v.kind!=='coverage-preview'||v.confidence!=='unvalidated'||!Array.isArray(v.plans)||v.plans.length>1000)return fail();
 const ids=new Set<string>();
 return v.plans.map((p:CoveragePlan)=>{
  if(!fields(p,['cameraId','positionAtPlan','source','calibrationToken','headingDeg','horizontalFovDeg','displayRangeM','enabled','updatedAt'])||typeof p.cameraId!=='string'||!p.cameraId.trim()||p.cameraId.length>100||ids.has(p.cameraId)||!fields(p.positionAtPlan,['lat','lon'])||!within(p.positionAtPlan.lat,-90,90)||!within(p.positionAtPlan.lon,-180,180)||!['manual-preview','manual-calibration'].includes(p.source)||!(p.source==='manual-preview'?p.calibrationToken===null:typeof p.calibrationToken==='string'&&p.calibrationToken.length>0&&p.calibrationToken.length<=600)||!within(p.headingDeg,0,359.999999)||!within(p.horizontalFovDeg,5,120)||!within(p.displayRangeM,10,20000)||typeof p.enabled!=='boolean'||typeof p.updatedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$/.test(p.updatedAt)||!Number.isFinite(Date.parse(p.updatedAt)))return fail();
  ids.add(p.cameraId);return {...p,positionAtPlan:{...p.positionAtPlan}};
 });
}
