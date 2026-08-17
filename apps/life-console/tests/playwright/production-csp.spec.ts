import { expect, test } from "@playwright/test";

test("starts the real client under the Production script CSP", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/api/**", async (route) => {
    await route.continue({
      headers: {
        ...route.request().headers(),
        "x-synthetic-owner": "synthetic-owner",
      },
    });
  });

  const response = await page.goto("/");

  expect(response?.headers()["content-security-policy"]).toContain(
    "script-src 'self'",
  );
  expect(pageErrors).not.toEqual(
    expect.arrayContaining([
      expect.stringContaining("unsafe-eval"),
    ]),
  );
  await expect(
    page.getByRole("navigation", { name: "全局导航" }),
  ).toBeVisible();
});
