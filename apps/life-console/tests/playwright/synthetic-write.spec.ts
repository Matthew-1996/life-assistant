import { expect, test } from "@playwright/test";

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

test("keeps the four-page workbench inside a phone viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(page.getByRole("navigation", { name: "全局导航" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const todayViewport = await page.evaluate(() => ({
    body: document.body.scrollWidth,
    document: document.documentElement.scrollWidth,
    width: window.innerWidth,
  }));
  expect(todayViewport.body).toBeLessThanOrEqual(todayViewport.width);
  expect(todayViewport.document).toBeLessThanOrEqual(todayViewport.width);

  for (const pageName of ["记录", "进展", "系统"] as const) {
    await page.getByRole("button", { name: pageName, exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const viewport = await page.evaluate(() => ({
      body: document.body.scrollWidth,
      document: document.documentElement.scrollWidth,
      width: window.innerWidth,
    }));
    expect(viewport.body).toBeLessThanOrEqual(viewport.width);
    expect(viewport.document).toBeLessThanOrEqual(viewport.width);
  }
});

test("keeps the 2.5 workbench in-screen and stacks columns below 1180px content width", async ({ page }) => {
  for (const width of [1440, 1280, 1024, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(page.getByRole("region", { name: "本周寄语" })).toBeVisible();
    await expect(page.getByRole("region", { exact: true, name: "Todo" })).toBeVisible();
    await expect(page.getByRole("region", { name: "每日新闻" })).toBeVisible();
    await expect(page.getByRole("region", { name: "今日锚点" })).toBeVisible();

    const layout = await page.evaluate(() => {
      const primary = document.querySelector<HTMLElement>(".workbench-primary");
      const gantt = document.querySelector<HTMLElement>(".todo-gantt__scroll");
      if (!primary || !gantt) throw new Error("2.5 workbench layout is missing");
      return {
        body: document.body.scrollWidth,
        columns: getComputedStyle(primary).gridTemplateColumns.split(" ").length,
        document: document.documentElement.scrollWidth,
        ganttClient: gantt.clientWidth,
        ganttScroll: gantt.scrollWidth,
        overflowing: [...document.querySelectorAll<HTMLElement>("body *")]
          .map((element) => ({
            className: element.className,
            clientWidth: element.clientWidth,
            right: Math.round(element.getBoundingClientRect().right),
            scrollWidth: element.scrollWidth,
            tag: element.tagName,
          }))
          .filter((element) => element.right > window.innerWidth + 1 || element.scrollWidth > element.clientWidth + 1)
          .slice(0, 20),
        width: window.innerWidth,
      };
    });
    expect(layout.body, JSON.stringify(layout.overflowing)).toBeLessThanOrEqual(layout.width);
    expect(layout.document).toBeLessThanOrEqual(layout.width);
    expect(layout.ganttClient).toBeLessThanOrEqual(layout.width);
    expect(layout.ganttScroll).toBeGreaterThanOrEqual(layout.ganttClient);
    expect(layout.columns).toBe(width >= 1280 ? 2 : 1);

    for (const pageName of ["记录", "进展", "系统"] as const) {
      await page.getByRole("button", { exact: true, name: pageName }).click();
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const pageWidth = await page.evaluate(() => ({
        body: document.body.scrollWidth,
        document: document.documentElement.scrollWidth,
        width: window.innerWidth,
      }));
      expect(pageWidth.body, `${pageName} @ ${width}px`).toBeLessThanOrEqual(pageWidth.width);
      expect(pageWidth.document, `${pageName} @ ${width}px`).toBeLessThanOrEqual(pageWidth.width);
    }
  }
});

test("keeps the retired Sites goal writer out of the 2.5 progress page", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("region", { name: "本周寄语" })).toBeVisible();

  await page.getByRole("button", { name: "进展" }).click();
  await expect(page.getByRole("region", { exact: true, name: "目标" })).toBeVisible();
  await expect(page.getByRole("region", { name: "14 天趋势" })).toBeVisible();
  await expect(page.getByLabel("目标名称")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "保存目标" })).toHaveCount(0);
});

test("runs conflict and deletion-plan workflow in the browser", async ({ page }) => {
  await page.goto("/");

  const result = await page.evaluate(async () => {
    const csrfResponse = await fetch("/api/v1/auth/csrf", { method: "POST" });
    const { token } = await csrfResponse.json() as { token: string };
    const headers = {
      "Content-Type": "application/json",
      "X-Life-CSRF": token,
    };
    const create = await fetch("/api/v1/journals", {
      method: "POST",
      headers: {
        ...headers,
        "Idempotency-Key": "playwright-journal",
      },
      body: JSON.stringify({
        date: "2026-01-16",
        title: "Playwright journal",
        content: "Synthetic browser content",
      }),
    });
    const journal = await create.json() as { id: string };
    const update = await fetch(`/api/v1/journals/${journal.id}`, {
      method: "PATCH",
      headers: { ...headers, "If-Match": "1" },
      body: JSON.stringify({ content: "Synthetic browser update" }),
    });
    const conflict = await fetch(`/api/v1/journals/${journal.id}`, {
      method: "PATCH",
      headers: { ...headers, "If-Match": "1" },
      body: JSON.stringify({ content: "Stale browser update" }),
    });
    const planned = await fetch(
      `/api/v1/journals/${journal.id}/delete-plan`,
      {
        method: "POST",
        headers: { ...headers, "If-Match": "2" },
        body: "{}",
      },
    );
    const cancelled = await fetch(
      `/api/v1/journals/${journal.id}/delete-plan/cancel`,
      {
        method: "POST",
        headers: { ...headers, "If-Match": "3" },
        body: "{}",
      },
    );
    const replanned = await fetch(
      `/api/v1/journals/${journal.id}/delete-plan`,
      {
        method: "POST",
        headers: { ...headers, "If-Match": "4" },
        body: "{}",
      },
    );
    const earlyPurge = await fetch(`/api/v1/journals/${journal.id}/purge`, {
      method: "DELETE",
      headers: { ...headers, "If-Match": "5" },
      body: "{}",
    });
    const expirePlan = await fetch("/__synthetic__/expire-deletion-plan", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Synthetic-Test": "enabled",
      },
      body: JSON.stringify({ id: journal.id }),
    });
    const purge = await fetch(`/api/v1/journals/${journal.id}/purge`, {
      method: "DELETE",
      headers: { ...headers, "If-Match": "5" },
      body: "{}",
    });
    return {
      update: await update.json(),
      conflictStatus: conflict.status,
      planned: await planned.json(),
      cancelled: await cancelled.json(),
      replanned: await replanned.json(),
      earlyPurgeStatus: earlyPurge.status,
      expirePlanStatus: expirePlan.status,
      purgeStatus: purge.status,
    };
  });

  expect(result.update).toEqual(expect.objectContaining({ revision: 2 }));
  expect(result.conflictStatus).toBe(409);
  expect(result.planned).toEqual(expect.objectContaining({ revision: 3 }));
  expect(result.cancelled).toEqual(expect.objectContaining({
    revision: 4,
    deletion_plan_until: null,
  }));
  expect(result.replanned).toEqual(expect.objectContaining({ revision: 5 }));
  expect(result.earlyPurgeStatus).toBe(409);
  expect(result.expirePlanStatus).toBe(204);
  expect(result.purgeStatus).toBe(200);
});
