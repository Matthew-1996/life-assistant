import { expect, test, type Page } from "@playwright/test";

async function expectNoPageOverflow(page: Page, label: string) {
  const width = await page.evaluate(() => ({
    body: document.body.scrollWidth,
    client: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(width.body, `${label}: body overflow`).toBe(width.client);
  expect(width.document, `${label}: document overflow`).toBe(width.client);
}

test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    await route.continue({
      headers: {
        ...route.request().headers(),
        "x-synthetic-owner": "synthetic-owner",
      },
    });
  });
});

for (const viewport of [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "mobile", width: 390, height: 844 },
] as const) {
  test(`renders the 2.5 four-page surface without page overflow on ${viewport.name}`, async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));
    await page.setViewportSize(viewport);
    const response = await page.goto("/");

    expect(response?.status()).toBe(200);
    const csp = response?.headers()["content-security-policy"] ?? "";
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain("img-src 'self' data: https://images.unsplash.com");
    await expect(page.getByRole("region", { name: "本周寄语" })).toBeVisible();
    await expect(page.getByRole("region", { exact: true, name: "Todo" })).toBeVisible();
    await expect(page.getByRole("region", { name: "每日新闻" })).toContainText("新闻服务尚未连接");
    await expect(page.getByRole("region", { name: "今日锚点" })).toBeVisible();
    await expectNoPageOverflow(page, `${viewport.name}: 工作台`);

    const todayLayout = await page.evaluate(() => {
      const primary = document.querySelector<HTMLElement>(".workbench-primary");
      const gantt = document.querySelector<HTMLElement>(".todo-gantt__scroll");
      if (!primary || !gantt) throw new Error("Today responsive regions are missing");
      return {
        columns: getComputedStyle(primary).gridTemplateColumns.split(" ").length,
        ganttClient: gantt.clientWidth,
        ganttScroll: gantt.scrollWidth,
      };
    });
    expect(todayLayout.columns).toBe(viewport.width === 1440 ? 2 : 1);
    expect(todayLayout.ganttScroll).toBeGreaterThanOrEqual(todayLayout.ganttClient);

    await page.getByRole("button", { exact: true, name: "记录" }).click();
    await expect(page.getByRole("region", { name: "对话式记录面板" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "轻量记录，明确保存。" })).toBeVisible();
    await expectNoPageOverflow(page, `${viewport.name}: 记录`);

    await page.getByRole("button", { exact: true, name: "进展" }).click();
    await expect(page.getByRole("region", { exact: true, name: "目标" })).toBeVisible();
    await expect(page.getByRole("region", { name: "14 天趋势" })).toBeVisible();
    await expect(page.getByRole("table", { name: "最近 7 天睡眠时刻" })).toBeVisible();
    await expectNoPageOverflow(page, `${viewport.name}: 进展`);
    const sleepLayout = await page.evaluate(() => {
      const container = document.querySelector<HTMLElement>(".sleep-table-scroll");
      if (!container) throw new Error("Sleep table scroll container is missing");
      return { client: container.clientWidth, scroll: container.scrollWidth };
    });
    expect(sleepLayout.scroll).toBeGreaterThanOrEqual(sleepLayout.client);
    if (viewport.width === 390) expect(sleepLayout.scroll).toBeGreaterThan(sleepLayout.client);

    await page.getByRole("button", { exact: true, name: "系统" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectNoPageOverflow(page, `${viewport.name}: 系统`);
    expect(await page.locator("vite-error-overlay").count()).toBe(0);
    expect(consoleErrors).toEqual([]);
  });
}

test("serves a local SVG favicon instead of the app shell fallback", async ({ request }) => {
  const response = await request.get("/favicon.svg");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("image/svg+xml");
  expect(await response.text()).toContain("<svg");
});
