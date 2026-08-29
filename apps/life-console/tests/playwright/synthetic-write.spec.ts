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

test("keeps mobile controls above the fixed bottom navigation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const navigation = page.getByRole("navigation", { name: "全局导航" });
  const anchorButton = page
    .getByRole("group", { name: "起床状态" })
    .getByRole("button", { name: "完成" });

  await expect(navigation).toBeVisible();
  await expect(anchorButton).toBeVisible();
  await anchorButton.evaluate((element) => element.scrollIntoView({ block: "end" }));

  const [navigationBox, anchorButtonBox] = await Promise.all([
    navigation.boundingBox(),
    anchorButton.boundingBox(),
  ]);
  expect(navigationBox).not.toBeNull();
  expect(anchorButtonBox).not.toBeNull();
  expect(anchorButtonBox!.y + anchorButtonBox!.height).toBeLessThanOrEqual(navigationBox!.y);
});

test("keeps mobile Todo form controls from overlapping each other", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const todoControls = page.locator(".todo-quick-form input, .todo-quick-form select, .todo-quick-form button");
  await expect(todoControls).toHaveCount(5);

  const overlappingPairs = await todoControls.evaluateAll((elements) => {
    const controls = elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        bottom: rect.bottom,
        label: element.getAttribute("aria-label") ?? element.textContent?.trim() ?? element.tagName,
        left: rect.left,
        right: rect.right,
        top: rect.top,
      };
    });
    const overlaps: string[] = [];
    for (let leftIndex = 0; leftIndex < controls.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < controls.length; rightIndex += 1) {
        const left = controls[leftIndex];
        const right = controls[rightIndex];
        const horizontalOverlap = Math.min(left.right, right.right) - Math.max(left.left, right.left);
        const verticalOverlap = Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top);
        if (horizontalOverlap > 0.5 && verticalOverlap > 0.5) {
          overlaps.push(`${left.label} ↔ ${right.label}`);
        }
      }
    }
    return overlaps;
  });

  expect(overlappingPairs).toEqual([]);
});

test("keeps the mobile Todo status menu compact and floating inside its panel", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const statusTrigger = page.getByRole("button", { name: "项目状态：未开始、进行中" });
  const form = page.locator(".todo-quick-form");
  const formTopBefore = await form.evaluate((element) => element.getBoundingClientRect().top);
  const triggerRect = await statusTrigger.evaluate((element) => element.getBoundingClientRect());
  expect(triggerRect.height).toBeGreaterThanOrEqual(30);
  expect(triggerRect.height).toBeLessThanOrEqual(36);

  await statusTrigger.click();
  const formTopAfter = await form.evaluate((element) => element.getBoundingClientRect().top);
  expect(Math.abs(formTopAfter - formTopBefore)).toBeLessThanOrEqual(0.5);

  const statusFilter = page.getByRole("group", { name: "项目状态选项" });
  const statusOptions = statusFilter.locator(".todo-status-filter__option");
  await expect(statusOptions).toHaveCount(3);

  const geometry = await statusOptions.evaluateAll((elements) => {
    const panelRect = elements[0]?.closest(".todo-panel")?.getBoundingClientRect();
    const menuRect = elements[0]?.closest(".todo-status-filter__menu")?.getBoundingClientRect();
    if (!panelRect) throw new Error("Todo panel is missing");
    if (!menuRect) throw new Error("Todo status menu is missing");
    const options = elements.map((element) => {
      const rect = element.getBoundingClientRect();
      const checkbox = element.querySelector('input[type="checkbox"]');
      if (!checkbox) throw new Error("Todo status checkbox is missing");
      const checkboxRect = checkbox.getBoundingClientRect();
      return {
        bottom: rect.bottom,
        checkboxHeight: checkboxRect.height,
        checkboxWidth: checkboxRect.width,
        height: rect.height,
        label: element.textContent?.trim() ?? "unknown status",
        left: rect.left,
        right: rect.right,
        top: rect.top,
      };
    });
    const invalidTargets = options
      .filter((option) => option.height < 36
        || option.left < panelRect.left - 0.5
        || option.right > panelRect.right + 0.5)
      .map((option) => option.label);
    const oversizedCheckboxes = options
      .filter((option) => option.checkboxHeight < 12
        || option.checkboxHeight > 16
        || option.checkboxWidth < 12
        || option.checkboxWidth > 16)
      .map((option) => option.label);
    const overlaps: string[] = [];
    for (let leftIndex = 0; leftIndex < options.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < options.length; rightIndex += 1) {
        const left = options[leftIndex];
        const right = options[rightIndex];
        const horizontalOverlap = Math.min(left.right, right.right) - Math.max(left.left, right.left);
        const verticalOverlap = Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top);
        if (horizontalOverlap > 0.5 && verticalOverlap > 0.5) {
          overlaps.push(`${left.label} ↔ ${right.label}`);
        }
      }
    }
    return {
      invalidTargets,
      menuInsidePanel: menuRect.left >= panelRect.left - 0.5
        && menuRect.right <= panelRect.right + 0.5,
      overlaps,
      oversizedCheckboxes,
    };
  });

  expect(geometry.invalidTargets).toEqual([]);
  expect(geometry.menuInsidePanel).toBe(true);
  expect(geometry.overlaps).toEqual([]);
  expect(geometry.oversizedCheckboxes).toEqual([]);
});

test("contains mobile Todo date-time controls when iOS includes their padding in the native width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const dateTimeControls = page.locator(".todo-quick-form input[type='datetime-local']");
  await expect(dateTimeControls).toHaveCount(2);
  await dateTimeControls.evaluateAll((inputs) => {
    for (const input of inputs) input.style.width = "calc(100% + 20px)";
  });

  const overflowingControls = await dateTimeControls.evaluateAll((inputs) => inputs
    .map((input) => {
      const inputRect = input.getBoundingClientRect();
      const labelRect = input.closest("label")?.getBoundingClientRect();
      if (!labelRect) throw new Error("Todo date-time label is missing");
      return inputRect.right > labelRect.right + 0.5
        ? input.getAttribute("aria-label") ?? input.tagName
        : null;
    })
    .filter((label): label is string => label !== null));

  expect(overflowingControls).toEqual([]);
});

test("contains the mobile journal date filter when iOS includes its padding in the native width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.evaluate(() => {
    const panel = document.createElement("section");
    panel.className = "supabase-journals-panel";
    panel.innerHTML = `
      <div class="supabase-record-filter">
        <label>
          筛选日记日期
          <input type="date">
        </label>
      </div>
    `;
    document.body.append(panel);
  });

  const dateFilter = page.getByLabel("筛选日记日期");
  await expect(dateFilter).toBeVisible();
  await dateFilter.evaluate((input) => {
    input.style.width = "calc(100% + 28px)";
  });

  const boundary = await dateFilter.evaluate((input) => {
    const inputRect = input.getBoundingClientRect();
    const filterRect = input.closest(".supabase-record-filter")?.getBoundingClientRect();
    if (!filterRect) throw new Error("Journal date filter container is missing");
    return {
      inputLeft: inputRect.left,
      inputRight: inputRect.right,
      filterLeft: filterRect.left,
      filterRight: filterRect.right,
    };
  });

  expect(boundary.inputLeft).toBeGreaterThanOrEqual(boundary.filterLeft - 0.5);
  expect(boundary.inputRight).toBeLessThanOrEqual(boundary.filterRight + 0.5);
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
