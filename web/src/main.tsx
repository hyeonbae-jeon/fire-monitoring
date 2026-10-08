import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

type Camera = {
  uuid: string; name: string; channel: string | null; device: string | null;
  ptzCap: string | null; getPosNormalize: boolean | null; absoluteZoom: boolean | null;
};
type Inventory = {
  version: string; source: string; liveSsmConnected: boolean; capturedAt: string;
  provenance: string; totalCount: number; cameras: Camera[];
};
type Configuration = {
  revision: string;
  configuration: { cameras: { uuid: string; name: string; enabled?: boolean }[] };
};
async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error ?? `요청 실패 (HTTP ${response.status})`);
  }
  return response.json() as Promise<T>;
}
const flag = (value: boolean | null) => value === null ? "UNKNOWN" : value ? "있음" : "없음";

function App() {
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [configuration, setConfiguration] = useState<Configuration | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [writeKey, setWriteKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    setBusy(true); setError(""); setMessage("");
    // On failure keep the user's selection visible, but prevent stale saves.
    setInventory(null);
    try {
      const [inv, conf] = await Promise.all([
        api<Inventory>("/api/inventory"), api<Configuration>("/api/cameras"),
      ]);
      setInventory(inv); setConfiguration(conf);
      setSelected(new Set(conf.configuration.cameras.filter(c => c.enabled !== false).map(c => c.uuid.toLowerCase())));
      setDirty(false);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  useEffect(() => { void load(); }, []);
  const known = new Set(inventory?.cameras.map(c => c.uuid) ?? []);
  const missing = [...selected].filter(id => !known.has(id));
  const filter = query.trim().toLocaleLowerCase();
  const visible = inventory?.cameras.filter(c =>
    [c.name, c.uuid, c.device, c.channel].some(v => v?.toLocaleLowerCase().includes(filter))) ?? [];

  function toggle(id: string) {
    setSelected(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setDirty(true); setMessage("");
  }
  async function save() {
    if (!inventory || !configuration) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await api<Configuration>("/api/cameras", {
        method: "PUT", headers: { "Content-Type": "application/json", "X-Inventory-Write-Key": writeKey },
        body: JSON.stringify({ cameraUuids: [...selected], configurationRevision: configuration.revision, inventoryVersion: inventory.version }),
      });
      setConfiguration(result); setDirty(false); setWriteKey("");
      setMessage(`카메라 ${selected.size}대를 중앙 설정에 저장했습니다.`);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <div className="app">
    <header><p className="eyebrow">중앙 PTZ Bridge · Camera Inventory</p><h1>산불감시 카메라 선택</h1>
      <p>카메라 목록을 확인하고 사용할 대상을 UUID 기준으로 저장합니다.</p></header>
    <main>
      <section className="notice" aria-label="연결 상태">
        <strong>파일 입력 모드 · 실제 SSM 미연결</strong>
        <p>SSM 전체 조회 인터페이스는 UNKNOWN입니다. 전체 목록 여부는 입력 작성자의 선언이며 자동 검증되지 않습니다.
          CCTV에는 명령을 보내지 않습니다. PTZ 구독 및 VWorld 3D는 다음 단계입니다.</p>
        {inventory && <p>입력: {inventory.provenance} · 수집 시각: {new Date(inventory.capturedAt).toLocaleString()}</p>}
      </section>
      <div className="toolbar">
        <label>이름 / UUID / 장치 / 채널 검색<input type="search" value={query} onChange={e => setQuery(e.target.value)} /></label>
        <button disabled={busy} onClick={() => { if (!dirty || window.confirm("저장하지 않은 선택을 버리고 다시 불러올까요?")) void load(); }}>목록 다시 불러오기</button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {message && <p className="success" role="status">{message}</p>}
      <p aria-live="polite">전체 {inventory?.totalCount ?? "—"}대 · 검색 결과 {visible.length}대 · 선택 {selected.size}대 {dirty && "· 저장하지 않은 변경"}</p>
      {missing.length > 0 && <section className="error"><strong>기존 선택 중 현재 목록에 없는 UUID</strong>
        <p>목록의 완전성을 확인하세요. 제거하지 않으면 저장할 수 없습니다.</p>
        <ul>{missing.map(id => <li key={id}><code>{id}</code> <button disabled={busy} onClick={() => toggle(id)}>선택에서 제거</button></li>)}</ul>
      </section>}
      <div className="table-scroll"><table><thead><tr><th>선택</th><th>이름 / UUID</th><th>장치 / 채널</th><th>PtzCap (uint64)</th><th>GET_POS_NORMALIZE</th><th>ABSOLUTE_ZOOM</th></tr></thead>
        <tbody>{visible.map(camera => <tr key={camera.uuid}>
          <td><input type="checkbox" aria-label={`${camera.name} (${camera.uuid}) 선택`} checked={selected.has(camera.uuid)} disabled={busy} onChange={() => toggle(camera.uuid)} /></td>
          <td><strong>{camera.name}</strong><code className="uuid">{camera.uuid}</code></td>
          <td>{camera.device ?? "UNKNOWN"}<br />{camera.channel ?? "UNKNOWN"}</td>
          <td><code>{camera.ptzCap ?? "UNKNOWN"}</code></td>
          <td>{flag(camera.getPosNormalize)}</td><td>{flag(camera.absoluteZoom)}</td>
        </tr>)}</tbody></table></div>
      {inventory && visible.length === 0 && <p>표시할 카메라가 없습니다.</p>}
      <p className="help">GET_POS_NORMALIZE는 capability 비트입니다. PTZ 구독에는 ENTITY_CAPABILITY 및 ChannelSubType 확인도 필요합니다.</p>
      <section className="save"><label>설정 저장 키<input type="password" autoComplete="off" value={writeKey} onChange={e => setWriteKey(e.target.value)} /></label>
        <button disabled={busy || !inventory || !configuration || missing.length > 0 || !writeKey || !dirty} onClick={() => void save()}>선택한 카메라 저장</button>
        <p>선택 해제한 카메라는 설정에서 제거됩니다. 0대 저장은 전체 선택 해제입니다. 키는 브라우저 저장소에 보관하지 않습니다.</p>
      </section>
    </main>
  </div>;
}
createRoot(document.getElementById("root")!).render(<App />);
