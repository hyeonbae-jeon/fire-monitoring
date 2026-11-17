import type { CameraSite, Point, Scenario, Status, Terrain } from "./model";

const R = 6371008.8, rad = Math.PI / 180;
export function distance(a: Point, b: Point) {
  const dy = (b.latitude - a.latitude) * rad, dx = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dy / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dx / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(Math.min(1, h)));
}
export function height(t: Terrain, p: Point): number | null {
  const x = (p.longitude - t.west) / (t.east - t.west) * (t.elevations[0].length - 1);
  const y = (t.north - p.latitude) / (t.north - t.south) * (t.elevations.length - 1);
  if (x < -1e-8 || y < -1e-8 || x > t.elevations[0].length - 1 + 1e-8 || y > t.elevations.length - 1 + 1e-8) return null;
  const xx = Math.max(0, Math.min(t.elevations[0].length - 1, x)), yy = Math.max(0, Math.min(t.elevations.length - 1, y));
  const ix = Math.min(t.elevations[0].length - 2, Math.floor(xx)), iy = Math.min(t.elevations.length - 2, Math.floor(yy));
  const fx = xx - ix, fy = yy - iy;
  const samples = [[t.elevations[iy][ix], (1-fx)*(1-fy)], [t.elevations[iy][ix+1], fx*(1-fy)],
    [t.elevations[iy+1][ix], (1-fx)*fy], [t.elevations[iy+1][ix+1], fx*fy]];
  let result = 0;
  for (const [z, weight] of samples) { if (weight! > 1e-12) { if (z === null) return null; result += z! * weight!; } }
  return result;
}
export function bearing(a: Point, b: Point) {
  const dl = (b.longitude - a.longitude) * rad, la = a.latitude * rad, lb = b.latitude * rad;
  return (Math.atan2(Math.sin(dl) * Math.cos(lb), Math.cos(la)*Math.sin(lb)-Math.sin(la)*Math.cos(lb)*Math.cos(dl)) / rad + 360) % 360;
}
export function sight(t: Terrain, c: CameraSite, p: Point, targetHeightM = 0): Status {
  const d = distance(c, p);
  if (c.rangeM != null && d > c.rangeM) return "outside";
  if (d > .01 && c.horizontalFovDeg != null && c.horizontalFovDeg < 360 && c.headingDeg != null &&
      Math.abs((bearing(c,p) - c.headingDeg + 540) % 360 - 180) > c.horizontalFovDeg / 2) return "outside";
  if (c.cameraHeightM == null || c.rangeM == null) return "unknown";
  const ground = c.groundElevationM ?? height(t,c), targetGround = height(t,p);
  if (ground == null || targetGround == null) return "unknown";
  const start = ground + c.cameraHeightM, end = targetGround + targetHeightM;
  // Curvature without atmospheric refraction. Coordinates interpolate locally (regional extent only).
  const elevationAngle = Math.atan2(end - start - d*d/(2*R), d) / rad;
  if (c.verticalFovDeg != null && c.tiltDeg != null && Math.abs(elevationAngle - c.tiltDeg) > c.verticalFovDeg/2) return "outside";
  const steps = Math.max(1, Math.ceil(4 * Math.max(
    Math.abs(p.longitude-c.longitude)/(t.east-t.west)*(t.elevations[0].length-1),
    Math.abs(p.latitude-c.latitude)/(t.north-t.south)*(t.elevations.length-1))));
  let unknown = false;
  for (let i=1; i<steps; i++) {
    const f = i/steps;
    const z = height(t, { longitude: c.longitude+(p.longitude-c.longitude)*f, latitude: c.latitude+(p.latitude-c.latitude)*f });
    if (z == null) { unknown = true; continue; }
    if (z + d*d*f*(1-f)/(2*R) > start+(end-start)*f + .01) return "blocked";
  }
  return unknown ? "unknown" : "visible";
}
export function coverage(t: Terrain, cameras: CameraSite[], p: Point, targetHeightM = 0) {
  const details = cameras.filter(c => c.enabled !== false).map(c => ({ uuid: c.uuid, name: c.name, status: sight(t,c,p,targetHeightM) }));
  const statuses = details.map(d => d.status);
  // A positive observation resolves unknowns; otherwise unknowns must not become definitive blind spots.
  const status: Status = statuses.includes("visible") ? "visible" : !statuses.length || statuses.includes("unknown") ? "unknown" : statuses.includes("blocked") ? "blocked" : "outside";
  return { status, details };
}
export type Cell = Point & { west: number; east: number; south: number; north: number; status: Status; elevation: number | null };
export function analyze(s: Scenario, resolution = 64) {
  const t = s.terrain;
  const cells: Cell[] = [];
  for (let y=0;y<resolution;y++) for (let x=0;x<resolution;x++) {
    const west = t.west+(t.east-t.west)*x/resolution, east = t.west+(t.east-t.west)*(x+1)/resolution;
    const north = t.north-(t.north-t.south)*y/resolution, south = t.north-(t.north-t.south)*(y+1)/resolution;
    const p = { longitude: (west+east)/2, latitude: (north+south)/2 };
    cells.push({ ...p, west, east, north, south, elevation: height(t,p), status: coverage(t,s.cameras,p).status });
  }
  return { cells, temples: s.temples.map(temple => {
    const surrounding = cells.filter(c => temple.radiusM > 0 && distance(c,temple) <= temple.radiusM);
    const counts = { visible: 0, blocked: 0, outside: 0, unknown: 0 };
    surrounding.forEach(c => counts[c.status]++);
    const radiusCoveredByDem = temple.longitude - temple.radiusM/(R*rad*Math.cos(temple.latitude*rad)) >= t.west &&
      temple.longitude + temple.radiusM/(R*rad*Math.cos(temple.latitude*rad)) <= t.east &&
      temple.latitude - temple.radiusM/(R*rad) >= t.south && temple.latitude + temple.radiusM/(R*rad) <= t.north;
    return { ...temple, ...coverage(t,s.cameras,temple,temple.targetHeightM), counts, sampledCells: surrounding.length, radiusCoveredByDem };
  }) };
}
export type Analysis = ReturnType<typeof analyze>;
