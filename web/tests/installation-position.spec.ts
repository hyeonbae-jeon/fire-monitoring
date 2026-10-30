import {test,expect} from '@playwright/test';

test('correcting one installation preserves other saved cameras and persists the new site without old anchors',async({page})=>{
 const old={lat:37.61806,lon:126.94295};
 const profile=(p:typeof old)=>({source:'operator-ptz-anchor',confidence:'approximate',savedAt:'2026-10-25T00:00:00Z',positionAtCalibration:p,deviceAnchor:{panDeg:10,tiltDeg:0,zoom:1},pose:{headingDeg:100,pitchDeg:0,horizontalFovDeg:59,cameraHeightM:3},groundElevationM:null,zoomScale:true});
 const first={id:'operator-imported-jokduri',name:'족두리봉',...old,ssmUuid:null,positionSource:'operator',orientation:null,nativeTracking:profile(old)};
 const other={...first,id:'synthetic-saved',name:'합성 기존 카메라',lat:37.5,lon:127.1,nativeTracking:profile({lat:37.5,lon:127.1})};
 let configuration={schemaVersion:1,crs:'EPSG:4326',positions:[first,other]},saved=false;
 await page.route('**/api/map-configuration',async r=>{
  if(r.request().method()==='PUT'){
   expect(r.request().headers()['x-inventory-write-key']).toBe('synthetic-map-write-key');
   configuration=r.request().postDataJSON().configuration;saved=true;
  }
  await r.fulfill({json:{revision:saved?'after-correction':'before-correction',configuration}});
 });
 await page.goto('/');await page.getByRole('button',{name:'지도 모니터링',exact:true}).click();
 await page.getByText('선택 카메라 설치 좌표 수정',{exact:true}).click();
 const apply=page.getByRole('button',{name:'설치 좌표 수정 적용',exact:true});await expect(apply).toBeDisabled();
 await page.getByLabel('수정할 설치 위도').fill('95');await apply.click();await expect(page.getByRole('alert')).toContainText('위도/경도');
 await page.getByRole('button',{name:'족두리봉 수정 좌표 적용',exact:true}).click();
 await expect(page.locator('.camera-panel')).toContainText('위도 37.61785 / 경도 126.94291');await expect(page.getByRole('alert')).toHaveCount(0);
 await page.getByLabel('지도 저장 키').fill('synthetic-map-write-key');await page.getByRole('button',{name:'중앙 지도 설정 저장',exact:true}).click();await expect.poll(()=>saved).toBe(true);
 const corrected=configuration.positions[0];expect(corrected.lat).toBe(37.61785);expect(corrected.lon).toBe(126.94291);expect(corrected.id).toBe(first.id);expect(corrected.orientation).toBeNull();expect(corrected).not.toHaveProperty('nativeTracking');expect(configuration.positions[1]).toEqual(other);
 await page.reload();await page.getByRole('button',{name:'지도 모니터링',exact:true}).click();await expect(page.locator('.camera-panel')).toContainText('위도 37.61785 / 경도 126.94291');
 const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'좌표 설정 다운로드',exact:true}).click();const download=await downloading,stream=await download.createReadStream();let raw='';for await(const c of stream!)raw+=c.toString();expect(JSON.parse(raw)).toEqual(configuration);
});
