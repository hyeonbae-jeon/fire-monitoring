import { test, expect } from "@playwright/test";

const A = "11111111-1111-4111-8111-111111111111";
const C = "33333333-3333-4333-8333-333333333333";
const key = "synthetic-e2e-config-key";

test.beforeEach(async ({ request, page }) => {
  const inv = await (await request.get("/api/inventory")).json();
  const conf = await (await request.get("/api/cameras")).json();
  const reset = await request.put("/api/cameras", {
    headers: { "X-Inventory-Write-Key": key },
    data: { cameraUuids: [], inventoryVersion: inv.version, configurationRevision: conf.revision },
  });
  expect(reset.ok()).toBeTruthy();
  await page.goto("/");
  await expect(page.getByText(/전체 3대/)).toBeVisible();
});

test("shows file mode and true/false/unknown capability without fabricating live SSM", async ({ page }) => {
  await expect(page.getByText("파일 입력 모드 · 실제 SSM 미연결")).toBeVisible();
  await expect(page.getByRole("row", { name: /테스트 카메라 A/ })).toContainText("17448304647");
  await expect(page.getByRole("row", { name: /테스트 고정 카메라/ })).toContainText("없음");
  await expect(page.getByRole("row", { name: /테스트 capability 미확인/ })).toContainText("UNKNOWN");
  await expect(page.getByRole("button", { name: "선택한 카메라 저장" })).toBeDisabled();
});

test("selection survives filtering, saves centrally, and reloads", async ({ page, request }) => {
  await page.getByRole("checkbox", { name: /테스트 카메라 A/ }).check();
  await page.getByRole("searchbox").fill("미확인");
  await page.getByRole("checkbox", { name: /테스트 capability 미확인/ }).check();
  await page.getByLabel("설정 저장 키").fill(key);
  await page.getByRole("button", { name: "선택한 카메라 저장" }).click();
  await expect(page.getByRole("status")).toHaveText("카메라 2대를 중앙 설정에 저장했습니다.");
  const conf = await (await request.get("/api/cameras")).json();
  expect(conf.configuration.cameras.map((c: { uuid: string }) => c.uuid)).toEqual([A, C]);
  await page.reload();
  await expect(page.getByRole("checkbox", { name: /테스트 카메라 A/ })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: /테스트 capability 미확인/ })).toBeChecked();
  await expect(page.getByLabel("설정 저장 키")).toHaveValue("");
});

test("invalid write key reports failure and retains local selection", async ({ page, request }) => {
  await page.getByRole("checkbox", { name: /테스트 카메라 A/ }).check();
  await page.getByLabel("설정 저장 키").fill("wrong");
  await page.getByRole("button", { name: "선택한 카메라 저장" }).click();
  await expect(page.getByRole("alert")).toContainText("valid configuration write key");
  await expect(page.getByRole("checkbox", { name: /테스트 카메라 A/ })).toBeChecked();
  expect((await (await request.get("/api/cameras")).json()).configuration.cameras).toEqual([]);
});

test("another browser's save is not overwritten", async ({ page, request }) => {
  await page.getByRole("checkbox", { name: /테스트 카메라 A/ }).check();
  const inv = await (await request.get("/api/inventory")).json();
  const conf = await (await request.get("/api/cameras")).json();
  const response = await request.put("/api/cameras", {
    headers: { "X-Inventory-Write-Key": key },
    data: { cameraUuids: [C], inventoryVersion: inv.version, configurationRevision: conf.revision },
  });
  expect(response.ok()).toBeTruthy();
  await page.getByLabel("설정 저장 키").fill(key);
  await page.getByRole("button", { name: "선택한 카메라 저장" }).click();
  await expect(page.getByRole("alert")).toContainText("Configuration changed");
  expect((await (await request.get("/api/cameras")).json()).configuration.cameras[0].uuid).toEqual(C);
});

test("inventory failure is visible and disables save", async ({ page }) => {
  await page.route("**/api/inventory", route => route.fulfill({
    status: 503, contentType: "application/json", body: JSON.stringify({ error: "Inventory unavailable" }),
  }));
  await page.reload();
  await expect(page.getByRole("alert")).toHaveText("Inventory unavailable");
  await expect(page.getByRole("button", { name: "선택한 카메라 저장" })).toBeDisabled();
});
