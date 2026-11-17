import { useEffect, useRef, useState } from "react";
import type { Analysis } from "./engine";
import { colors, labels, parseCameras, parseScenario, parseTemples, parseTerrain } from "./model";
import type { CameraSite, Scenario, Status, Temple, Terrain } from "./model";

function download(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function read(file: File) {
  if (file.size > 8 * 1024 * 1024) throw new Error("파일 크기는 8MB 이하여야 합니다.");
  return JSON.parse(await file.text()) as unknown;
}
export function VisibilityPanel() {
  const [terrain, setTerrain] = useState<Terrain | null>(null);
  const [cameras, setCameras] = useState<CameraSite[]>([]);
  const [temples, setTemples] = useState<Temple[]>([]);
  const [label, setLabel] = useState("사용자 분석");
  const [synthetic, setSynthetic] = useState(false);
  const [result, setResult] = useState<Analysis | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedTemple, setSelectedTemple] = useState<string | null>(null);
  const [layer, setLayer] = useState("coverage");
  const [onlyBlind, setOnlyBlind] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  useEffect(() => {
    setResult(null);
    if (!terrain || !cameras.some(c => c.enabled !== false)) { setBusy(false); return; }
    setBusy(true);
    let worker: Worker;
    try {
      worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = e => {
        setBusy(false);
        if (e.data.error) setError(e.data.error); else setResult(e.data.result);
        worker.terminate();
      };
      worker.onerror = () => { setBusy(false); setError("가시권 계산에 실패했습니다. 입력 범위를 줄여 다시 시도하세요."); worker.terminate(); };
      worker.postMessage({ label, synthetic, terrain, cameras, temples } satisfies Scenario);
    } catch (e) { setBusy(false); setError((e as Error).message); return; }
    return () => worker.terminate();
  }, [terrain, cameras, temples, label, synthetic]);

  function apply(s: Scenario) {
    setTerrain(s.terrain); setCameras(s.cameras); setTemples(s.temples); setLabel(s.label); setSynthetic(s.synthetic); setSelectedTemple(null);
  }
  async function perform(action: () => Promise<void>) {
    setError(""); setNotice("");
    try { await action(); } catch (e) { if (mounted.current) setError((e as Error).message); }
  }
  async function upload(file: File, kind: string) {
    await perform(async () => {
      const value = await read(file);
      if (kind === "scenario") apply(parseScenario(value));
      else {
        if (kind === "cameras") setCameras(parseCameras(value));
        if (kind === "temples") { setTemples(parseTemples(value)); setSelectedTemple(null); }
        if (kind === "terrain") setTerrain(parseTerrain(value));
        // Preserve synthetic provenance when mixing imported data with demo terrain/cameras.
      }
      setNotice(`${file.name} 파일을 불러왔습니다.`);
    });
  }
  function editCamera(index: number, key: "cameraHeightM" | "rangeM", raw: string) {
    const value = raw === "" ? null : Number(raw);
    const max = key === "rangeM" ? 50000 : 1000, min = key === "rangeM" ? 1 : 0;
    if (value !== null && (!Number.isFinite(value) || value < min || value > max)) return;
    setCameras(old => old.map((c,i) => i === index ? { ...c, [key]: value } : c));
  }
  const counts = { visible: 0, blocked: 0, outside: 0, unknown: 0 };
  result?.cells.forEach(c => counts[c.status]++);
  const active = result?.temples.find(t => t.id === selectedTemple);
  const point = (p: { longitude: number; latitude: number }) => terrain ? [
    (p.longitude-terrain.west)/(terrain.east-terrain.west)*1000,
    (terrain.north-p.latitude)/(terrain.north-terrain.south)*700,
  ] : [0,0];
  const onMap = (p: { longitude: number; latitude: number }) => terrain && p.longitude >= terrain.west && p.longitude <= terrain.east && p.latitude >= terrain.south && p.latitude <= terrain.north;
  function exportResults() {
    if (!result || !terrain) return;
    download("visibility-results.geojson", {
      type: "FeatureCollection", properties: { label, synthetic, source: terrain.source, generatedAt: new Date().toISOString(),
        method: "DEM bilinear LOS; quarter-cell sampling; Earth curvature; no refraction", groundTargetHeightM: 0, resolution: 64, cameras },
      features: [...result.cells.map(c => ({ type: "Feature", properties: { status: c.status, targetHeightM: 0 },
        geometry: { type: "Polygon", coordinates: [[[c.west,c.south],[c.east,c.south],[c.east,c.north],[c.west,c.north],[c.west,c.south]]] } })),
      ...result.temples.map(t => ({ type: "Feature", properties: { ...t, longitude: undefined, latitude: undefined }, geometry: { type: "Point", coordinates: [t.longitude,t.latitude] } }))],
    });
  }
  return <section className="visibility" aria-label="지형 가시권 분석">
    <div className="analysis-heading"><div><p className="eyebrow">TERRAIN VIEWSHED · 사찰 감시</p><h2>지형 너머, 감시가 닿는 곳</h2>
      <p>카메라와 지형 사이의 시선을 계산해 사찰과 주변 사각지대를 확인합니다.</p></div>
      <button onClick={() => void perform(async () => {
        const response = await fetch("/examples/visibility-demo.json");
        if (!response.ok) throw new Error("예제 파일을 불러올 수 없습니다.");
        apply(parseScenario(await response.json()));
      })}>가상 지형 예제 열기</button></div>
    <div className="analysis-notice">{synthetic ? "가상 데이터 포함 · 실제 카메라·사찰의 감시 결과가 아닙니다. 실제 분석은 통합 JSON으로 새로 불러오세요." : "입력 데이터 기반 추정 · 실시간 PTZ 방향과 연동되지 않습니다."}
      <p>시야각을 생략한 카메라는 360° 회전 시 잠재 가시권입니다. 나무·건물·연기·날씨·영상 식별 성능은 포함하지 않습니다.</p></div>
    <div className="import-grid">
      {[["cameras","카메라 JSON"],["terrain","지형 DEM JSON"],["temples","사찰 JSON (선택)"],["scenario","통합 분석 JSON"]].map(([kind,title]) =>
        <label key={kind}>{title}<input type="file" accept=".json,application/json" onChange={e => {
          const f = e.target.files?.[0]; if (f) void upload(f,kind); e.target.value = "";
        }} /></label>)}
    </div>
    <div className="analysis-actions"><button onClick={() => void perform(async () => {
      const response = await fetch("/api/cameras");
      if (!response.ok) throw new Error(`중앙 설정을 불러올 수 없습니다 (HTTP ${response.status}). 카메라 JSON 파일을 불러오세요.`);
      const data = await response.json(); setCameras(parseCameras(data.configuration)); setNotice("중앙 설정의 카메라를 불러왔습니다.");
    })}>중앙 설정 카메라 불러오기</button>
      <button disabled={!terrain} onClick={() => terrain && download("visibility-scenario.json", { label, synthetic, terrain, cameras, temples })}>분석 입력 저장</button>
      <button disabled={!result || busy} onClick={exportResults}>결과 GeoJSON 저장</button>
      <a href="/examples/visibility-demo.json" download>입력 양식 다운로드</a></div>
    {error && <p role="alert" className="error">{error}</p>}
    {notice && <p role="status" className="success">{notice}</p>}
    <p className="help">파일은 브라우저에서 계산하며 중앙 설정을 변경하지 않습니다. 화면을 떠나기 전에 ‘분석 입력 저장’으로 보관하세요. cameras 배열과 camera-map-positions의 positions 배열을 불러올 수 있습니다.</p>
    <details open={cameras.length > 0}><summary>카메라 분석 설정 · {cameras.length}대</summary>
      <p className="help">설치 높이와 최대 거리 미입력 시 ‘데이터 부족’으로 처리합니다. 지반 고도는 groundElevationM 또는 DEM에서 가져옵니다. 실제 시야각은 JSON의 headingDeg/horizontalFovDeg, tiltDeg/verticalFovDeg로 입력합니다.</p>
      {cameras.some(c => c.savedView) && <p className="analysis-notice">지도 위치 파일의 보정 시야는 저장 당시의 추정값입니다. 기본은 360° 잠재 가시권이며 ‘저장 수평 시야 사용’으로 과거 방위각과 수평 시야각을 선택할 수 있습니다. 수직 시야각이 없어 pitch와 장치 pan/tilt/zoom은 계산에 적용하지 않습니다. 위치가 바뀐 보정값은 사용하지 않습니다.</p>}
      <div className="table-scroll"><table><thead><tr><th>사용</th><th>카메라 / 좌표</th><th>지상 설치 높이 (m)</th><th>최대 감시 거리 (m)</th><th>시야</th></tr></thead><tbody>{cameras.map((c,i) => <tr key={c.uuid}>
        <td><input type="checkbox" aria-label={`${c.name} 분석에 사용`} checked={c.enabled !== false} onChange={e => setCameras(old => old.map((v,j) => j === i ? { ...v, enabled: e.target.checked } : v))} /></td>
        <td><strong>{c.name}</strong><small>{c.latitude.toFixed(5)}, {c.longitude.toFixed(5)}{terrain && !onMap(c) && " · DEM 범위 밖"}</small>
          {c.mapPositionId && <small>위치 ID: {c.mapPositionId} · {c.ssmUuid ? "SSM UUID 연결됨" : "SSM UUID 미연결"}</small>}
          <small>지반 고도: {c.groundElevationM == null ? "DEM에서 추출" : `${c.groundElevationM.toFixed(1)}m (입력값)`}</small></td>
        <td><input aria-label={`${c.name} 설치 높이`} type="number" min="0" max="1000" value={c.cameraHeightM ?? ""} placeholder="미입력" onChange={e => editCamera(i,"cameraHeightM",e.target.value)} /></td>
        <td><input aria-label={`${c.name} 최대 거리`} type="number" min="1" max="50000" value={c.rangeM ?? ""} placeholder="미입력" onChange={e => editCamera(i,"rangeM",e.target.value)} /></td>
        <td>{c.horizontalFovDeg == null || c.horizontalFovDeg === 360 ? "360° 잠재 가시권" : `방위 ${c.headingDeg}° / 수평 ${c.horizontalFovDeg}°`}{c.verticalFovDeg != null && <small>틸트 {c.tiltDeg}° / 수직 {c.verticalFovDeg}°</small>}
          {c.savedView && <><small>저장 추정 시야 · {c.savedView.confidence} · {c.savedView.capturedAt ?? "시각 미확인"}</small>
            {!c.savedView.positionMatches && <small>보정 당시 위치 불일치 · 높이·고도·시야 사용 안 함</small>}
            <button disabled={!c.savedView.positionMatches || c.savedView.headingDeg == null || c.savedView.horizontalFovDeg == null}
              aria-label={`${c.name} ${c.horizontalFovDeg == null ? "저장 수평 시야 사용" : "360도 잠재 가시권 사용"}`}
              onClick={() => setCameras(old => old.map((v,j) => j === i ? { ...v,
                headingDeg:v.horizontalFovDeg == null ? v.savedView!.headingDeg : null,
                horizontalFovDeg:v.horizontalFovDeg == null ? v.savedView!.horizontalFovDeg : null,
                tiltDeg:null, verticalFovDeg:null } : v))}>{c.horizontalFovDeg == null ? "저장 수평 시야 사용" : "360° 잠재 가시권 사용"}</button></>}
        </td>
      </tr>)}</tbody></table></div></details>
    {!terrain && <div className="analysis-empty"><h3>{cameras.length ? `카메라 ${cameras.length}대 입력 완료 · 지형 DEM이 필요합니다` : "카메라 위치 JSON부터 불러오세요"}</h3><p>지형 고도 데이터가 준비되면 가시권 계산이 시작됩니다.<br />사찰 좌표는 나중에 추가해도 됩니다. 예제로 결과 표시를 먼저 확인할 수 있습니다.</p></div>}
    {terrain && <>
      <div className="analysis-stats">{(Object.keys(labels) as Status[]).map(s => <div key={s}><span style={{color: colors[s]}}>● {labels[s]}</span><strong>{result ? `${(counts[s]/result.cells.length*100).toFixed(1)}%` : "—"}</strong><small>분석 격자 중심점 비율</small></div>)}</div>
      <div className="analysis-map-heading"><div><h3>{label}</h3><p>{terrain.source} · 북쪽 ↑ · WGS84</p></div>
        <label>지도 레이어<select value={layer} onChange={e => setLayer(e.target.value)}><option value="coverage">통합 가시권</option><option value="terrain">지형 고도</option></select></label></div>
      <p aria-live="polite">{busy ? "지형 가시권 계산 중…" : result ? `분석 완료 · ${result.cells.length}개 격자 · 사찰 ${temples.length}곳` : "사용할 카메라를 선택하세요."}</p>
      <div className="terrain-map" aria-busy={busy}>
        <svg viewBox="-75 -30 1150 780" role="img" aria-label="지형 가시권 지도. 사찰별 상세 결과는 아래 표에서 확인할 수 있습니다.">
          <defs><clipPath id="map-clip"><rect width="1000" height="700" /></clipPath></defs>
          <rect width="1000" height="700" fill="#e6e9e5" />
          <g clipPath="url(#map-clip)">
            {result?.cells.map((c,i) => {
              const [x,y] = point({longitude:c.west,latitude:c.north});
              const fill = layer === "coverage" ? colors[c.status] : c.elevation === null ? colors.unknown : `hsl(90 22% ${Math.max(20,85-c.elevation/25)}%)`;
              return <rect key={i} x={x} y={y} width={1000/64+.15} height={700/64+.15} fill={fill} opacity={layer === "coverage" ? .72 : 1}><title>{labels[c.status]} · {c.latitude.toFixed(5)}, {c.longitude.toFixed(5)} · 고도 {c.elevation?.toFixed(0) ?? "미확인"}m</title></rect>;
            })}
            {active && active.radiusM > 0 && (() => { const [cx,cy] = point(active); return <ellipse cx={cx} cy={cy} rx={active.radiusM/(111195*Math.cos(active.latitude*Math.PI/180))/(terrain.east-terrain.west)*1000} ry={active.radiusM/111195/(terrain.north-terrain.south)*700} fill="none" stroke="#192d44" strokeWidth="3" strokeDasharray="8 5" />; })()}
            {cameras.filter(c => c.enabled !== false && onMap(c)).map(c => { const [x,y] = point(c); return <g key={c.uuid} transform={`translate(${x} ${y})`}><rect x="-8" y="-8" width="16" height="16" fill="#173957" stroke="white" strokeWidth="2" /><text x="13" y="4" className="map-label">{c.name}</text><title>{c.name} · 카메라</title></g>; })}
            {temples.filter(onMap).map(t => { const [x,y] = point(t); const status = result?.temples.find(v => v.id===t.id)?.status ?? "unknown"; return <g key={t.id} transform={`translate(${x} ${y})`}>
              <circle r={selectedTemple === t.id ? 12 : 9} fill={colors[status]} stroke="white" strokeWidth="3" /><text x="15" y="5" className="map-label">{t.name}</text><title>{t.name} · {labels[status]}</title></g>; })}
          </g>
          {[0,.25,.5,.75,1].map(f => <g key={f}><text x={f*1000} y="735" textAnchor="middle" className="map-coordinate">{(terrain.west+(terrain.east-terrain.west)*f).toFixed(4)}°E</text>
            <text x="-12" y={f*700+5} textAnchor="end" className="map-coordinate">{(terrain.north-(terrain.north-terrain.south)*f).toFixed(4)}°N</text></g>)}
        </svg>
      </div>
      <p className="help">■ 카메라 · ● 사찰 · 지형도는 경위도 격자를 화면에 맞춰 표시합니다. 배경 지도·3D 지형은 포함하지 않습니다. {layer === "terrain" ? "지형 색: 밝을수록 낮고, 어두울수록 높음. 회색은 데이터 없음." : "녹색: 감시 가능 · 빨강: 지형 가림 · 황색: 거리·시야 밖 · 회색: 데이터 부족"}</p>
      <div className="analysis-map-heading"><h3>사찰 감시 현황</h3><label className="inline-check"><input type="checkbox" checked={onlyBlind} onChange={e => setOnlyBlind(e.target.checked)} />감시 불가 사찰만</label></div>
      {temples.length === 0 ? <p>사찰 좌표를 취합한 뒤 사찰 JSON을 불러오세요. 현재는 전체 지형 가시권만 계산합니다.</p> : <div className="table-scroll"><table><thead><tr><th>사찰</th><th>좌표</th><th>감시 상태</th><th>주변 지상 사각지대</th></tr></thead><tbody>
        {temples.filter(t => !onlyBlind || ["blocked","outside"].includes(result?.temples.find(v=>v.id===t.id)?.status ?? "unknown")).map(t => {
          const r = result?.temples.find(v=>v.id===t.id); return <tr key={t.id}><td><button className="temple-link" onClick={() => setSelectedTemple(t.id)}>{t.name}</button></td><td>{t.latitude.toFixed(5)}, {t.longitude.toFixed(5)}{!onMap(t) && <small>DEM 범위 밖</small>}</td>
            <td>{r ? labels[r.status] : "계산 대기"}</td><td>{!r || !r.radiusM ? "반경 미설정" : !r.sampledCells ? "격자 표본 없음" : `${r.radiusM}m 내 ${(100*(r.counts.blocked+r.counts.outside)/r.sampledCells).toFixed(1)}% · 미확인 ${(100*r.counts.unknown/r.sampledCells).toFixed(1)}%`}{r && r.radiusM > 0 && !r.radiusCoveredByDem && <small>반경 일부가 DEM 범위 밖 · 범위 내 표본만 집계</small>}</td></tr>;
        })}</tbody></table></div>}
      {active && <section className="temple-detail"><h3>{active.name} · {labels[active.status]}</h3><p>대상 높이: 지상 {active.targetHeightM}m · 점선: 주변 {active.radiusM}m</p>
        <ul>{active.details.map(d => <li key={d.uuid}>{d.name}: {labels[d.status]}</li>)}</ul></section>}
      <p className="help">가시권은 지상 0m 대상, 사찰 위치는 targetHeightM 대상입니다. 주변 비율은 반경 내 64×64 격자 중심점 표본이며 정확한 면적 비율이 아닙니다. DEM을 세분화해도 원본에 없는 지형은 복원되지 않습니다.</p>
    </>}
  </section>;
}
