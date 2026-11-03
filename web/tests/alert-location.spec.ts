import {test,expect} from '@playwright/test';
import {pixelDirection,createAlertRayGrid,intersectAlertTerrain,redOutlineBoxes,type AlertLocationRequest} from '../src/alert-location';
import {projectGeographic} from '../src/geographic-calibration';
import type {Position} from '../src/map-model';

const p:Position={id:'synthetic-camera',name:'합성 카메라',lat:37,lon:127,positionSource:'operator',ssmUuid:null,orientation:null,
 nativeTracking:{source:'operator-ptz-anchor',confidence:'approximate',savedAt:'2026-10-25T00:00:00Z',positionAtCalibration:{lat:37,lon:127},deviceAnchor:{panDeg:359,tiltDeg:0,zoom:1},pose:{headingDeg:0,pitchDeg:-10,horizontalFovDeg:60,cameraHeightM:100},groundElevationM:0,zoomScale:true}};
const request=():AlertLocationRequest=>({eventId:'synthetic-event',imageSha256:'synthetic-image',position:structuredClone(p),frame:{width:640,height:360},box:{x:310,y:160,width:20,height:20},device:{panDeg:359,tiltDeg:0,zoom:1},confirmed:true,rangeM:3000});
test('pixel rays invert the existing geographic projection, preserving pitch coupling, aspect and pan wrap',()=>{
 for(const heading of [0,45,179,359])for(const pitch of [-60,-10,30])for(const point of [[.1,.2],[.5,.5],[.85,.9]]){
  const pose={headingDeg:heading,pitchDeg:pitch,horizontalFovDeg:59};
  const ray=pixelDirection(pose,16/9,...point as [number,number]);const back=projectGeographic(ray.direction,pose,16/9)!;
  expect(back.x).toBeCloseTo(point[0],10);expect(back.y).toBeCloseTo(point[1],10);
 }
 const r=request();r.device.panDeg=1;expect(createAlertRayGrid(r).pose.headingDeg).toBe(2);
 r.device.zoom=2;expect(createAlertRayGrid(r).pose.horizontalFovDeg).toBeLessThan(60);
});
test('terrain candidate uses first intersection, curvature, and all foreground samples; sky and missing terrain stay unresolved',()=>{
 const grid=createAlertRayGrid(request());expect(grid.points.length).toBeLessThan(3001);
 const terrain=grid.points.map(()=>0),result=intersectAlertTerrain(grid,terrain,'terrain-provider'),center=result.rays[1];
 expect(center.state).toBe('intersection');expect(center.point!.distanceM).toBeGreaterThan(575);expect(center.point!.distanceM).toBeLessThan(578);
 expect(center.point!.lat).toBeGreaterThan(37);expect(center.point!.lon).toBeCloseTo(127,7);expect(result.meaning).toBe('background-terrain-candidate');
 const gap:unknown[]=terrain.slice();gap[grid.rays[0].samples.length+5]=null;
 expect(intersectAlertTerrain(grid,gap,'terrain-provider').rays[1].state).toBe('terrain-unknown');
 const ridge=terrain.slice(),start=grid.rays[0].samples.length;ridge[start+8]=200;
 expect(intersectAlertTerrain(grid,ridge,'scene-most-detailed').rays[1].point!.distanceM).toBeLessThan(201);
 const sky=request();sky.position.nativeTracking!.pose.pitchDeg=20;
 const skyGrid=createAlertRayGrid(sky);expect(intersectAlertTerrain(skyGrid,skyGrid.points.map(()=>0),'terrain-provider').rays.every(r=>r.state==='beyond-range')).toBe(true);
 expect(()=>intersectAlertTerrain(grid,terrain,'ellipsoid')).toThrow();
 expect(intersectAlertTerrain(grid,grid.points.map(()=>200),'terrain-provider').rays[1].state).toBe('camera-below-terrain');
});
test('historical pose, full frame, finite zoom, unchanged camera and valid heights are prerequisites',()=>{
 for(const mutate of [(r:AlertLocationRequest)=>{r.confirmed=false as true;},(r:AlertLocationRequest)=>{r.device.panDeg=NaN;},(r:AlertLocationRequest)=>{r.device.zoom=0;},(r:AlertLocationRequest)=>{r.box.x=640;},(r:AlertLocationRequest)=>{r.position.nativeTracking!.groundElevationM=null;},(r:AlertLocationRequest)=>{r.position.lat+=.001;}]){
  const r=request();mutate(r);expect(()=>createAlertRayGrid(r)).toThrow();
 }
});
test('red annotation outlines are identified without classifying ordinary grey scenery; multiple candidates remain separate',()=>{
 const w=640,h=360,data=new Uint8ClampedArray(w*h*4);for(let i=0;i<w*h;i++){data[i*4]=120;data[i*4+1]=120;data[i*4+2]=120;data[i*4+3]=255;}
 expect(redOutlineBoxes(data,w,h)).toEqual([]);
 const rect=(x:number,y:number,width:number,height:number)=>{for(let j=y;j<y+height;j++)for(let i=x;i<x+width;i++)if(i===x||i===x+width-1||j===y||j===y+height-1){const k=(j*w+i)*4;data[k]=220;data[k+1]=20;data[k+2]=30;}};
 rect(133,132,11,24);rect(430,210,30,18);
 const boxes=redOutlineBoxes(data,w,h);expect(boxes).toHaveLength(2);expect(boxes).toContainEqual({x:133,y:132,width:11,height:24});
 for(let i=0;i<data.length;i+=4)if(data[i]===220){data[i]=145;data[i+1]=106;data[i+2]=116;}
 expect(redOutlineBoxes(data,w,h)).toHaveLength(2);
});

if(process.env.CCTV_PRIVATE_EVENT_IMAGE){
 test('optional supplied private frame has a red outline without publishing the image',async({page})=>{
  const {readFileSync}=await import('node:fs'),data=readFileSync(process.env.CCTV_PRIVATE_EVENT_IMAGE!);
  const pixels=await page.evaluate(async source=>{const img=new Image();img.src='data:image/jpeg;base64,'+source;await img.decode();const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;const x=c.getContext('2d')!;x.drawImage(img,0,0);return {width:c.width,height:c.height,rgba:Array.from(x.getImageData(0,0,c.width,c.height).data)};},data.toString('base64'));
  const boxes=redOutlineBoxes(new Uint8ClampedArray(pixels.rgba),pixels.width,pixels.height);expect(boxes).toHaveLength(1);expect(boxes[0].width).toBeGreaterThan(4);
 });
}
