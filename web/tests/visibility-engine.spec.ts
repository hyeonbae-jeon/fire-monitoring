import { test, expect } from "@playwright/test";
import { analyze, coverage, height, sight } from "../src/visibility/engine";
import { parseCameras, parseScenario, parseTemples, parseTerrain } from "../src/visibility/model";
import type { CameraSite, Terrain } from "../src/visibility/model";

const terrain = (ridge = 0): Terrain => ({ source: "test synthetic", west: 127, east: 127.01, south: 37, north: 37.01,
  elevations: Array.from({length: 5}, () => [0,0,ridge,0,0]) });
const camera: CameraSite = { uuid: "test-a", name: "Test A", longitude: 127.001, latitude: 37.005, cameraHeightM: 10, rangeM: 5000 };
const target = { longitude: 127.009, latitude: 37.005 };

test("flat terrain is visible, ridge blocks, tall target clears ridge", () => {
  expect(sight(terrain(),camera,target)).toBe("visible");
  expect(sight(terrain(100),camera,target)).toBe("blocked");
  expect(sight(terrain(100),camera,target,300)).toBe("visible");
});
test("known range, compass wraparound and vertical FOV constrain visibility", () => {
  expect(sight(terrain(),{...camera,rangeM:100},target)).toBe("outside");
  expect(sight(terrain(),{...camera,headingDeg:270,horizontalFovDeg:30},target)).toBe("outside");
  const north = {...target,longitude:camera.longitude,latitude:37.009};
  expect(sight(terrain(),{...camera,headingDeg:355,horizontalFovDeg:20},north)).toBe("visible");
  expect(sight(terrain(),{...camera,tiltDeg:80,verticalFovDeg:10},target)).toBe("outside");
});
test("multiple cameras union coverage; unknown does not erase a positive observation", () => {
  const b = {...camera,uuid:"test-b",longitude:127.008};
  expect(coverage(terrain(100),[camera,b],target).status).toBe("visible");
  expect(coverage(terrain(),[{...camera,cameraHeightM:null},b],target).status).toBe("visible");
  expect(coverage(terrain(100),[camera,{...b,cameraHeightM:null}],target).status).toBe("unknown");
  expect(coverage(terrain(),[{...camera,enabled:false}],target).status).toBe("unknown");
});
test("missing path samples and out-of-DEM targets stay unknown", () => {
  const t = terrain(); t.elevations[2][2] = null;
  expect(sight(t,camera,target)).toBe("unknown");
  expect(sight(terrain(),camera,{...target,latitude:37.02})).toBe("unknown");
  expect(sight(terrain(),{...camera,cameraHeightM:null},target)).toBe("unknown");
  expect(sight(terrain(),{...camera,rangeM:null},target)).toBe("unknown");
});
test("bilinear interpolation respects node orientation, edges and nodata weights", () => {
  const t = {...terrain(),elevations:[[0,10],[20,null]]};
  expect(height(t,{longitude:127,latitude:37.01})).toBe(0);
  expect(height(t,{longitude:127.005,latitude:37.01})).toBeCloseTo(5);
  expect(height(t,{longitude:127.005,latitude:37.005})).toBe(null);
  expect(height(t,{longitude:127,latitude:37})).toBe(20);
  expect(height(t,{longitude:126,latitude:37})).toBe(null);
});
test("earth curvature can block distant ground even on a flat DEM", () => {
  const t = {...terrain(),east:127.5,elevations:[Array(101).fill(0),Array(101).fill(0)]};
  expect(sight(t,{...camera,rangeM:50000},{...target,longitude:127.4})).toBe("blocked");
});
test("temple target height is separate from surrounding ground coverage; partial radius is flagged", () => {
  const r = analyze({label:"test",synthetic:true,terrain:terrain(100),cameras:[camera],temples:[{
    ...target,id:"t",name:"T",targetHeightM:300,radiusM:1000,
  }]},16);
  expect(r.cells).toHaveLength(256);
  expect(r.temples[0].status).toBe("visible");
  expect(r.temples[0].counts.blocked).toBeGreaterThan(0);
  expect(r.temples[0].radiusCoveredByDem).toBe(false);
});
test("legacy camera schema accepts absent range; offset is never interpreted as heading", () => {
  const c = parseCameras({ cameras:[{...camera,rangeM:undefined,headingOffsetDeg:180,ptz:{getPosNormalize:true}}] })[0];
  expect(c.rangeM).toBe(null);
  expect(c.headingDeg).toBe(null);
  expect(() => parseCameras([{...camera,horizontalFovDeg:45}])).toThrow(/방위각/);
});
test("reject duplicate IDs, invalid coordinates, nonfinite heights, bad DEM dimensions", () => {
  expect(() => parseCameras([camera,camera])).toThrow(/중복/);
  expect(() => parseCameras([{...camera,latitude:null}])).toThrow(/위도/);
  expect(() => parseCameras([{...camera,cameraHeightM:Infinity}])).toThrow();
  expect(() => parseTerrain({...terrain(),elevations:[[0,0],[0]]})).toThrow(/직사각/);
  expect(() => parseTerrain({...terrain(),east:126})).toThrow(/경계/);
  expect(() => parseTemples([{...target,id:"a",name:"A",radiusM:-1}])).toThrow();
  expect(() => parseScenario({label:"oops",terrain:terrain(),cameras:[]})).toThrow(/synthetic/);
});
