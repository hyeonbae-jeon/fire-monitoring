import { useState } from 'react';
import { parseSsmReport, type ReportCamera } from './ssm-report';
export function ReportImport({version, writeKey, dirty, onImported}: {
  version: string | null; writeKey: string; dirty: boolean; onImported: () => Promise<void>;
}) {
  const [cameras, setCameras] = useState<ReportCamera[] | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [captured, setCaptured] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function read(file?: File) {
    setCameras(null); setConfirmed(false); setError(''); setCaptured('');
    if (!file) return;
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('리포트는 10MB 이하여야 합니다.');
      setCameras(parseSsmReport(await file.text()));
    } catch (e) { setError((e as Error).message); }
  }
  async function save() {
    if (!cameras || !confirmed || !captured || !writeKey) return;
    if (dirty && !window.confirm('저장하지 않은 선택을 버리고 리포트 목록을 가져올까요?')) return;
    setBusy(true); setError('');
    try {
      const time = new Date(captured);
      if (!Number.isFinite(time.getTime())) throw new Error('수집 시각을 확인하세요.');
      const response = await fetch('/api/inventory', {method:'POST', headers:{'Content-Type':'application/json','X-Inventory-Write-Key':writeKey}, body:JSON.stringify({
        inventoryVersion:version, document:{schemaVersion:1,complete:true,totalCount:cameras.length,capturedAt:time.toISOString(),
          provenance:'SSM device settings report / Camera sheet / Guid column; operator-confirmed coverage; PTZ display text only', cameras}
      })});
      if (!response.ok) { const body = await response.json().catch(()=>null); throw new Error(body?.error ?? `리포트 가져오기 실패 (HTTP ${response.status})`); }
      await onImported(); setCameras(null); setConfirmed(false); setCaptured('');
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="notice report-import"><h2>SSM 장치 설정 리포트 가져오기</h2>
    <p>원본은 브라우저에서 읽습니다. 이름·Guid·모델·PTZ 지원 표시만 서버에 전달하며 IP, MAC, 시리얼, 저장 경로, 서버 시트는 제외합니다. 실제 SSM 연결이나 CCTV 명령은 없습니다.</p>
    <label>장치 설정 리포트(.xls / Excel XML)<input disabled={busy} type="file" accept=".xls,application/vnd.ms-excel,text/xml,application/xml" onChange={e=>{void read(e.target.files?.[0]);e.target.value='';}} /></label>
    {error && <p role="alert" className="error">{error}</p>}
    {cameras && <>
      <p role="status">리포트 {cameras.length}대 · PTZ 지원 {cameras.filter(c=>c.reportedPtzSupported===true).length}대 · 미지원 {cameras.filter(c=>c.reportedPtzSupported===false).length}대 · 지원 여부 UNKNOWN {cameras.filter(c=>c.reportedPtzSupported===null).length}대</p>
      <p>Guid는 보고서 식별자입니다. PTZ 지원 표시는 PtzCap 비트/위치 조회 가능 여부가 아닙니다. 목록 전체 여부는 보고서만으로 확정할 수 없습니다.</p>
      <details><summary>가져올 이름·Guid·모델 확인</summary><div className="table-scroll"><table><thead><tr><th>이름</th><th>보고서 Guid</th><th>모델</th><th>PTZ 지원 표시</th></tr></thead><tbody>{cameras.map(c=><tr key={c.uuid}><td>{c.name}</td><td>{c.uuid}</td><td>{c.model??'UNKNOWN'}</td><td>{c.reportedPtzSupported===null?'UNKNOWN':c.reportedPtzSupported?'지원함':'지원 안 함'}</td></tr>)}</tbody></table></div></details>
      <label>보고서 수집 시각 (이 PC의 시간대)<input type="datetime-local" value={captured} onChange={e=>setCaptured(e.target.value)} /></label>
      <label className="inline"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>이 보고서가 등록된 전체 카메라 목록임을 확인했습니다.</label>
      <p>아래 설정 저장 키를 입력한 뒤 가져오세요. 기존 목록 파일을 교체하지만 기존 카메라 선택 설정은 유지합니다. UUID가 사라지면 별도로 안내합니다.</p>
      <button disabled={busy||!confirmed||!captured||!writeKey} onClick={()=>void save()}>리포트를 카메라 목록에 반영</button>
    </>}
  </section>;
}
