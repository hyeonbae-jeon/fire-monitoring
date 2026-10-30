// This exporter uses Excel 2003 SpreadsheetML, not binary XLS or XLSX.
// Parse locally; never send the original workbook or non-allowlisted columns to Bridge.
export type ReportCamera = {
  uuid: string; name: string; channel: null; device: null; ptzCap: null;
  model: string | null; reportedPtzSupported: boolean | null;
};
const namespace = 'urn:schemas-microsoft-com:office:spreadsheet';
export function parseSsmReport(text: string): ReportCamera[] {
  if (text.length > 10 * 1024 * 1024) throw new Error('리포트는 10MB 이하여야 합니다.');
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('DTD/ENTITY가 있는 파일은 허용하지 않습니다.');
  const xml = new DOMParser().parseFromString(text.replace(/^\uFEFF/, ''), 'application/xml');
  if (xml.querySelector('parsererror') || xml.documentElement.localName !== 'Workbook' || xml.documentElement.namespaceURI !== namespace)
    throw new Error('SSM 장치 리포트의 Excel XML(.xls) 형식이 필요합니다. 바이너리 XLS/XLSX는 미지원입니다.');
  const sheets = Array.from(xml.getElementsByTagNameNS(namespace, 'Worksheet')).filter(s => s.getAttributeNS(namespace, 'Name') === 'Camera');
  if (sheets.length !== 1) throw new Error('Camera 시트가 정확히 하나 있어야 합니다.');
  const tables = Array.from(sheets[0].children).filter(e => e.localName === 'Table' && e.namespaceURI === namespace);
  if (tables.length !== 1) throw new Error('Camera 표가 정확히 하나 있어야 합니다.');
  const rows = Array.from(tables[0].children).filter(e => e.localName === 'Row' && e.namespaceURI === namespace);
  function cells(row: Element): Map<number, string> {
    let index = 0; const values = new Map<number, string>();
    for (const c of Array.from(row.children).filter(e => e.localName === 'Cell' && e.namespaceURI === namespace)) {
      index = c.hasAttributeNS(namespace, 'Index') ? Number(c.getAttributeNS(namespace, 'Index')) : index + 1;
      if (!Number.isInteger(index) || index < 1 || values.has(index)) throw new Error('셀 인덱스가 올바르지 않습니다.');
      const data = Array.from(c.children).filter(e => e.localName === 'Data' && e.namespaceURI === namespace);
      if (data.length > 1) throw new Error('셀 Data가 중복되었습니다.');
      values.set(index, data[0]?.textContent?.trim() ?? '');
      const merge = Number(c.getAttributeNS(namespace, 'MergeAcross') ?? 0);
      if (!Number.isInteger(merge) || merge < 0) throw new Error('병합 셀이 올바르지 않습니다.');
      index += merge;
    }
    return values;
  }
  if (!rows.length) throw new Error('Camera 헤더가 없습니다.');
  const columns = new Map<string, number>();
  for (const [i, title] of cells(rows[0])) {
    if (columns.has(title)) throw new Error('헤더가 중복되었습니다.');
    columns.set(title, i);
  }
  for (const field of ['Name', 'Guid', 'PTZ', 'Model']) if (!columns.has(field)) throw new Error(`필수 열 ${field}가 없습니다.`);
  const seen = new Set<string>(); const result: ReportCamera[] = [];
  for (const row of rows.slice(1)) {
    const values = cells(row);
    if ([...values.values()].every(v => !v)) continue;
    const get = (field: string) => values.get(columns.get(field)!) ?? '';
    const uuid = get('Guid').replace(/^\{([0-9a-f-]+)\}$/i, '$1').toLowerCase(), name = get('Name');
    if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(uuid) || uuid === '00000000-0000-0000-0000-000000000000' || seen.has(uuid) || !name || name.length > 500)
      throw new Error('이름 또는 Guid가 없거나 중복/잘못된 값입니다. 전체 파일을 확인하세요.');
    seen.add(uuid);
    const support = get('PTZ');
    // PTZ display text is not a uint64 mask nor proof of read-position subscription support.
    result.push({uuid, name, channel: null, device: null, ptzCap: null, model: get('Model') || null,
      reportedPtzSupported: support === '지원함' ? true : support === '지원 안 함' ? false : null});
  }
  if (!result.length) throw new Error('카메라가 없는 리포트는 가져오지 않습니다.');
  return result;
}
