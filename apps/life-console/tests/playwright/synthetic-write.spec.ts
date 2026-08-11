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

test("creates a goal through the synthetic Sites Worker", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("D1 唯一真相源")).toBeVisible();

  await page.getByRole("button", { name: "进展" }).click();
  await page.getByLabel("目标名称").fill("Playwright synthetic goal");
  await page.getByRole("button", { name: "保存目标" }).click();

  await expect(page.getByText("已保存到云端 · revision #1")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "进展" }).click();
  await expect(page.getByText("Playwright synthetic goal")).toBeVisible();
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
