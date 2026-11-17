import { test, expect } from "@playwright/test";

test.beforeEach(async ({page}) => {
  await page.route("**/api/inventory", route => route.fulfill({json:{version:"x",cameras:[],totalCount:0,provenance:"test",capturedAt:"2026-01-01T00:00:00Z"}}));
  await page.route("**/api/cameras", route => route.fulfill({json:{revision:"r",configuration:{cameras:[]}}}));
  await page.goto("/");
  await page.getByRole("button",{name:"지형·사찰 가시권",exact:true}).click();
});
test("demo ridge shows visible/blocked temples and per-camera result", async ({page}) => {
  await page.getByRole("button",{name:"가상 지형 예제 열기"}).click();
  await expect(page.getByText(/분석 완료 · 4096개 격자/)).toBeVisible();
  await expect(page.getByRole("row",{name:/가상 사찰 A/})).toContainText("감시 가능");
  await expect(page.getByRole("row",{name:/가상 사찰 B/})).toContainText("지형 가림");
  await page.getByLabel("감시 불가 사찰만").check();
  await expect(page.getByRole("button",{name:/가상 사찰 A/})).toHaveCount(0);
  await page.getByRole("button",{name:/가상 사찰 B/}).click();
  await expect(page.getByText("가상 카메라 A: 지형 가림",{exact:true})).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button",{name:"결과 GeoJSON 저장"}).click();
  const artifact = await download;
  const stream = await artifact.createReadStream(); const chunks: Buffer[]=[];
  for await (const chunk of stream!) chunks.push(chunk);
  const data = JSON.parse(Buffer.concat(chunks).toString());
  expect(data.type).toBe("FeatureCollection");
  expect(data.features).toHaveLength(4098);
  expect(data.properties.synthetic).toBe(true);
  await page.getByRole("button",{name:"카메라 선택",exact:true}).click();
  await page.getByRole("button",{name:"지형·사찰 가시권",exact:true}).click();
  await expect(page.getByText("가상 카메라 A: 지형 가림",{exact:true})).toBeVisible();
});
test("camera-only import works before temples; missing height never becomes blocked", async ({page}) => {
  const cameras = { cameras:[{uuid:"a",name:"실제 형식",longitude:127.005,latitude:37.005,cameraHeightM:null}] };
  const terrain = {source:"test synthetic",west:127,east:127.01,south:37,north:37.01,elevations:[[0,0],[0,0]]};
  await page.getByLabel("카메라 JSON",{exact:true}).setInputFiles({name:"cameras.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(cameras))});
  await page.getByLabel("지형 DEM JSON",{exact:true}).setInputFiles({name:"dem.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(terrain))});
  await expect(page.getByText(/분석 완료 · 4096개 격자 · 사찰 0곳/)).toBeVisible();
  await expect(page.locator(".analysis-stats").getByText("100.0%")).toBeVisible();
  await page.getByLabel("실제 형식 설치 높이").fill("20");
  await page.getByLabel("실제 형식 최대 거리").fill("5000");
  await expect(page.getByText(/분석 완료/)).toBeVisible();
  await expect(page.locator(".analysis-stats>div").first()).toContainText("100.0%");
  await page.getByLabel("실제 형식 분석에 사용").uncheck();
  await expect(page.getByText("사용할 카메라를 선택하세요.",{exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:"결과 GeoJSON 저장"})).toBeDisabled();
});
test("invalid imports leave prior data intact and display error", async ({page}) => {
  await page.getByRole("button",{name:"가상 지형 예제 열기"}).click();
  await expect(page.getByText(/분석 완료/)).toBeVisible();
  await page.getByLabel("지형 DEM JSON",{exact:true}).setInputFiles({name:"bad.json",mimeType:"application/json",buffer:Buffer.from('{"west":null}')});
  await expect(page.getByRole("alert")).toContainText("서쪽 경계");
  await expect(page.getByRole("row",{name:/가상 사찰 B/})).toContainText("지형 가림");
});
test("mobile imports, labels and map fit within viewport", async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await page.getByRole("button",{name:"가상 지형 예제 열기"}).click();
  await expect(page.getByText(/분석 완료/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("map positions imports without DEM, and historical horizontal view is an explicit choice", async ({page}) => {
  const json = {schemaVersion:1,crs:"EPSG:4326",positions:[{id:"map-a",name:"지도 카메라",lat:37.005,lon:127.005,ssmUuid:null,
    nativeTracking:{confidence:"approximate",savedAt:"2026-10-01T00:00:00Z",positionAtCalibration:{lat:37.005,lon:127.005},
      deviceAnchor:{panDeg:240,tiltDeg:10,zoom:2},pose:{headingDeg:90,pitchDeg:-3,horizontalFovDeg:60,cameraHeightM:15},groundElevationM:120}}]};
  await page.getByLabel("카메라 JSON",{exact:true}).setInputFiles({name:"camera-map-positions.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(json))});
  await expect(page.getByText("카메라 1대 입력 완료 · 지형 DEM이 필요합니다",{exact:true})).toBeVisible();
  await expect(page.getByLabel("지도 카메라 설치 높이")).toHaveValue("15");
  await expect(page.getByLabel("지도 카메라 최대 거리")).toHaveValue("");
  await expect(page.getByText(/위치 ID: map-a · SSM UUID 미연결/)).toBeVisible();
  await expect(page.getByRole("row",{name:/지도 카메라/})).toContainText("360° 잠재 가시권");
  await page.getByRole("button",{name:"지도 카메라 저장 수평 시야 사용",exact:true}).click();
  await expect(page.getByRole("row",{name:/지도 카메라/})).toContainText("방위 90° / 수평 60°");
  await page.getByRole("button",{name:"지도 카메라 360도 잠재 가시권 사용",exact:true}).click();
  await expect(page.getByRole("row",{name:/지도 카메라/})).toContainText("360° 잠재 가시권");
});
