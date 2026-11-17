export type Point = { longitude: number; latitude: number };
export type SavedView = {
  headingDeg: number | null; horizontalFovDeg: number | null; pitchDeg: number | null;
  source: string; confidence: string; capturedAt: string | null; positionMatches: boolean;
};
export type CameraSite = Point & {
  uuid: string; name: string; enabled?: boolean; cameraHeightM: number | null;
  groundElevationM?: number | null; rangeM: number | null;
  headingDeg?: number | null; horizontalFovDeg?: number | null;
  tiltDeg?: number | null; verticalFovDeg?: number | null;
  mapPositionId?: string; ssmUuid?: string | null; savedView?: SavedView;
};
export type Temple = Point & { id: string; name: string; targetHeightM: number; radiusM: number };
export type Terrain = {
  source: string; west: number; south: number; east: number; north: number;
  // Samples are grid NODES, ordered north to south, west to east. null = no data.
  elevations: (number | null)[][];
};
export type Scenario = { label: string; synthetic: boolean; terrain: Terrain; cameras: CameraSite[]; temples: Temple[] };
export type Status = "visible" | "blocked" | "outside" | "unknown";
export const labels: Record<Status, string> = { visible: "감시 가능", blocked: "지형 가림", outside: "거리·시야 밖", unknown: "데이터 부족" };
export const colors: Record<Status, string> = { visible: "#168360", blocked: "#d44949", outside: "#d29a32", unknown: "#8995a5" };

const object = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("JSON 객체가 필요합니다.");
  return v as Record<string, unknown>;
};
const num = (v: unknown, label: string, min: number, max: number): number => {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) throw new Error(`${label}: ${min}~${max} 사이의 숫자가 필요합니다.`);
  return v;
};
const optional = (v: unknown, label: string, min: number, max: number) => v == null ? null : num(v, label, min, max);
const text = (v: unknown, label: string) => {
  if (typeof v !== "string" || !v.trim()) throw new Error(`${label} 값이 필요합니다.`);
  return v;
};
const position = (o: Record<string, unknown>): Point => ({ longitude: num(o.longitude, "경도", -180, 180), latitude: num(o.latitude, "위도", -85, 85) });
function rows(value: unknown, key: string, max: number): unknown[] {
  const list = Array.isArray(value) ? value : object(value)[key];
  if (!Array.isArray(list) || list.length > max) throw new Error(`${key}: 최대 ${max}개 배열이 필요합니다.`);
  return list;
}
function unique<T>(list: T[], key: (v: T) => string) {
  if (new Set(list.map(key)).size !== list.length) throw new Error("중복된 ID가 있습니다.");
  return list;
}
export function parseCameras(value: unknown): CameraSite[] {
  if (!Array.isArray(value) && "positions" in object(value)) return parseMapPositions(object(value));
  return unique(rows(value, "cameras", 32).map(raw => {
    const o = object(raw);
    if (o.enabled != null && typeof o.enabled !== "boolean") throw new Error("enabled는 boolean이어야 합니다.");
    const horizontalFovDeg = optional(o.horizontalFovDeg, "수평 시야각", 0.1, 360);
    const headingDeg = optional(o.headingDeg, "방위각", 0, 360);
    const verticalFovDeg = optional(o.verticalFovDeg, "수직 시야각", 0.1, 180);
    const tiltDeg = optional(o.tiltDeg, "틸트", -90, 90);
    if ((horizontalFovDeg != null && horizontalFovDeg < 360 && headingDeg == null) || (verticalFovDeg != null && tiltDeg == null)) throw new Error("시야각과 함께 실제 방위각/틸트를 입력하세요. 보정 오프셋은 방향으로 사용하지 않습니다.");
    return { ...position(o), uuid: text(o.uuid, "카메라 UUID"), name: text(o.name, "카메라 이름"), enabled: o.enabled !== false,
      cameraHeightM: optional(o.cameraHeightM, "설치 높이", 0, 1000), groundElevationM: optional(o.groundElevationM, "지반 고도", -500, 9000),
      rangeM: optional(o.rangeM, "최대 거리", 1, 50000), headingDeg, horizontalFovDeg, tiltDeg, verticalFovDeg,
      ...(o.mapPositionId == null ? {} : { mapPositionId: text(o.mapPositionId,"위치 ID"), ssmUuid: o.ssmUuid == null ? null : text(o.ssmUuid,"SSM UUID") }),
      ...(o.savedView == null ? {} : { savedView: parseSavedView(o.savedView) }) };
  }), c => c.uuid.toLowerCase());
}
function parseSavedView(value: unknown): SavedView {
  const o = object(value);
  if (typeof o.positionMatches !== "boolean") throw new Error("저장 시야의 위치 일치 여부가 필요합니다.");
  return { headingDeg: optional(o.headingDeg,"저장 방위각",0,360), horizontalFovDeg: optional(o.horizontalFovDeg,"저장 수평 시야각",.1,360),
    pitchDeg: optional(o.pitchDeg,"저장 pitch",-90,90), source: text(o.source,"보정 출처"), confidence: text(o.confidence,"보정 신뢰도"),
    capturedAt: o.capturedAt == null ? null : text(o.capturedAt,"보정 시각"), positionMatches: o.positionMatches };
}
function parseMapPositions(root: Record<string, unknown>): CameraSite[] {
  if (root.schemaVersion !== 1 || root.crs !== "EPSG:4326") throw new Error("지도 위치 파일은 schemaVersion: 1, crs: EPSG:4326 형식이어야 합니다.");
  const cameras = rows(root,"positions",32).map(raw => {
    const o = object(raw), id = text(o.id,"위치 ID");
    const p = position({ longitude:o.lon, latitude:o.lat });
    const tracking = o.nativeTracking == null ? null : object(o.nativeTracking);
    const orientation = o.orientation == null ? null : object(o.orientation);
    const candidates = [
      ...(tracking?.pose == null ? [] : [{ meta:tracking, pose:object(tracking.pose), ground:tracking.groundElevationM, time:tracking.savedAt, source:"nativeTracking" }]),
      ...(orientation == null ? [] : [{ meta:orientation, pose:orientation, ground:orientation.groundElevationM, time:orientation.calibratedAt, source:"orientation" }]),
    ].map(c => {
      const at = c.meta.positionAtCalibration == null ? null : object(c.meta.positionAtCalibration);
      return { ...c, matches: at !== null && typeof at.lat === "number" && typeof at.lon === "number" &&
        Math.abs(at.lat-p.latitude) <= 1e-7 && Math.abs(at.lon-p.longitude) <= 1e-7 };
    });
    const calibration = candidates.find(c => c.matches) ?? candidates[0];
    const ssmUuid = o.ssmUuid == null ? null : text(o.ssmUuid,"SSM UUID");
    if (o.enabled != null && typeof o.enabled !== "boolean") throw new Error("enabled는 boolean이어야 합니다.");
    return {
      ...p, uuid:ssmUuid ?? `map-position:${id}`, mapPositionId:id, ssmUuid,
      name:text(o.name,"카메라 이름"), enabled:o.enabled !== false,
      cameraHeightM:calibration?.matches ? optional(calibration.pose.cameraHeightM,"설치 높이",0,1000) : null,
      groundElevationM:calibration?.matches ? optional(calibration.ground,"지반 고도",-500,9000) : null,
      rangeM:optional(o.rangeM,"최대 거리",1,50000), headingDeg:null, horizontalFovDeg:null, tiltDeg:null, verticalFovDeg:null,
      ...(calibration == null ? {} : { savedView:parseSavedView({
        headingDeg:calibration.pose.headingDeg, horizontalFovDeg:calibration.pose.horizontalFovDeg, pitchDeg:calibration.pose.pitchDeg,
        source:calibration.source, confidence:calibration.meta.confidence ?? "미확인", capturedAt:calibration.time ?? null, positionMatches:calibration.matches,
      }) }),
    };
  });
  unique(cameras,c => c.mapPositionId);
  return unique(cameras,c => c.uuid.toLowerCase());
}
export function parseTemples(value: unknown): Temple[] {
  return unique(rows(value, "temples", 500).map(raw => {
    const o = object(raw);
    return { ...position(o), id: text(o.id, "사찰 ID"), name: text(o.name, "사찰 이름"),
      targetHeightM: o.targetHeightM == null ? 0 : num(o.targetHeightM, "감시 대상 높이", 0, 500),
      radiusM: o.radiusM == null ? 0 : num(o.radiusM, "주변 반경", 0, 10000) };
  }), t => t.id);
}
export function parseTerrain(value: unknown): Terrain {
  const o = object(value);
  const west = num(o.west, "서쪽 경계", -180, 180), east = num(o.east, "동쪽 경계", -180, 180);
  const south = num(o.south, "남쪽 경계", -85, 85), north = num(o.north, "북쪽 경계", -85, 85);
  if (east <= west || north <= south || east - west > 1 || north - south > 1) throw new Error("경계 순서를 확인하세요. 지역 분석용 최대 1도 범위입니다.");
  if (!Array.isArray(o.elevations) || o.elevations.length < 2 || o.elevations.length > 256) throw new Error("DEM은 2~256행이어야 합니다.");
  let width = 0;
  const elevations = o.elevations.map((row: unknown, i: number) => {
    if (!Array.isArray(row) || row.length < 2 || row.length > 256 || (i > 0 && row.length !== width)) throw new Error("DEM은 2~256열의 직사각 배열이어야 합니다.");
    width = row.length;
    return row.map(v => v === null ? null : num(v, "DEM 고도", -500, 9000));
  });
  return { west, south, east, north, elevations, source: text(o.source, "DEM 출처") };
}
export function parseScenario(value: unknown): Scenario {
  const o = object(value);
  if (typeof o.synthetic !== "boolean") throw new Error("synthetic 여부가 필요합니다.");
  return { label: text(o.label, "분석명"), synthetic: o.synthetic, terrain: parseTerrain(o.terrain), cameras: parseCameras(o.cameras), temples: parseTemples(o.temples ?? []) };
}
