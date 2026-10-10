import {test,expect} from '@playwright/test';
const ns='urn:schemas-microsoft-com:office:spreadsheet';
function workbook(rows:string[][],headers=['Name','Guid','Model','PTZ','IpAddress','Password']) {
 const data=[headers,...rows].map(r=>'<Row>'+r.map(v=>'<Cell><Data ss:Type="String">'+v+'</Data></Cell>').join('')+'</Row>').join('');
 return `<?xml version="1.0"?><Workbook xmlns="${ns}" xmlns:ss="${ns}"><Worksheet ss:Name="Camera"><Table>${data}</Table></Worksheet><Worksheet ss:Name="SSM Server"><Table><Row><Cell><Data>PRIVATE-SERVER-SECRET</Data></Cell></Row></Table></Worksheet></Workbook>`;
}
const A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
test('report preview is local, strips private columns, preserves PTZ UNKNOWN and imports/saves by Guid',async({page,request})=>{
 const original=await(await request.get('/api/inventory')).json();
 const originalConfig=await(await request.get('/api/cameras')).json();
 let posted:any;
 await page.route('**/api/inventory',async route=>{
  if(route.request().method()==='POST')posted=route.request().postDataJSON();await route.continue();
 });
 try {
 await page.goto('/');
 await page.getByLabel('장치 설정 리포트(.xls / Excel XML)').setInputFiles({name:'synthetic.xls',mimeType:'application/vnd.ms-excel',buffer:Buffer.from(workbook([
 ['시험 보고서 A',A,'MODEL-A','지원함','PRIVATE-IP','PRIVATE-PASSWORD'],['시험 보고서 B',B,'MODEL-B','지원 안 함','','']]))});
 await expect(page.getByText('리포트 2대 · PTZ 지원 1대 · 미지원 1대 · 지원 여부 UNKNOWN 0대')).toBeVisible();
 expect(posted).toBeUndefined();
 const button=page.getByRole('button',{name:'리포트를 카메라 목록에 반영'});await expect(button).toBeDisabled();
 await page.getByLabel('보고서 수집 시각 (이 PC의 시간대)').fill('2026-10-09T19:11');
 await page.getByLabel('이 보고서가 등록된 전체 카메라 목록임을 확인했습니다.').check();
 await page.getByLabel('설정 저장 키').fill('synthetic-e2e-config-key');await button.click();
 await expect(page.getByText(/전체 2대 · 검색 결과 2대/)).toBeVisible();
 expect(JSON.stringify(posted)).not.toMatch(/PRIVATE-|IpAddress|Password|Server/);
 expect(posted.document.cameras[0].reportedPtzSupported).toBe(true);
 expect(posted.document.cameras[0].ptzCap).toBeNull();
 const row=page.getByRole('row',{name:/시험 보고서 A/});await expect(row).toContainText('MODEL-A');await expect(row).toContainText('UNKNOWN');
 await page.getByRole('checkbox',{name:new RegExp('시험 보고서 A')}).check();
 await page.getByLabel('설정 저장 키').fill('synthetic-e2e-config-key');await page.getByRole('button',{name:'선택한 카메라 저장'}).click();
 await expect(page.getByText('카메라 1대를 중앙 설정에 저장했습니다.')).toBeVisible();
 const conf=await(await request.get('/api/cameras')).json();expect(conf.configuration.cameras[0].uuid).toBe(A);expect(conf.configuration.cameras[0].reportedPtzSupported).toBe(true);
 await page.reload();await expect(page.getByRole('checkbox',{name:/시험 보고서 A/})).toBeChecked();
 } finally {
 const current=await(await request.get('/api/inventory')).json();
 const doc={schemaVersion:1,complete:true,totalCount:original.totalCount,capturedAt:original.capturedAt,provenance:original.provenance,cameras:original.cameras.map(({uuid,name,channel,device,ptzCap,model,reportedPtzSupported}:any)=>({uuid,name,channel,device,ptzCap,model,reportedPtzSupported}))};
 expect((await request.post('/api/inventory',{headers:{'X-Inventory-Write-Key':'synthetic-e2e-config-key'},data:{document:doc,inventoryVersion:current.version}})).ok()).toBeTruthy();
 const conf=await(await request.get('/api/cameras')).json();const inv=await(await request.get('/api/inventory')).json();
 expect((await request.put('/api/cameras',{headers:{'X-Inventory-Write-Key':'synthetic-e2e-config-key'},data:{cameraUuids:originalConfig.configuration.cameras.map((c:any)=>c.uuid),configurationRevision:conf.revision,inventoryVersion:inv.version}})).ok()).toBeTruthy();
 }
});
test('invalid, duplicate and DTD reports fail with no upload; unknown PTZ text stays unknown',async({page})=>{
 let posts=0;page.on('request',r=>{if(r.method()==='POST')posts++;});await page.goto('/');
 const file=page.getByLabel('장치 설정 리포트(.xls / Excel XML)');
 for(const xml of [workbook([['A',A,'M','지원함'],['B',A,'M','지원함']]),workbook([['A','invalid','M','지원함']]),workbook([],['Name']), '<!DOCTYPE Workbook [<!ENTITY x "secret">]>'+workbook([]), 'binary-not-xml']){
 await file.setInputFiles({name:'invalid.xls',mimeType:'application/vnd.ms-excel',buffer:Buffer.from(xml)});await expect(page.getByRole('alert')).toBeVisible();
 }
 await file.setInputFiles({name:'unknown.xls',mimeType:'application/vnd.ms-excel',buffer:Buffer.from(workbook([['A',A,'M','UNKNOWN']]))});
 await expect(page.getByText(/지원 여부 UNKNOWN 1대/)).toBeVisible();expect(posts).toBe(0);
});
