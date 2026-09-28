import { test, expect } from "@playwright/test";
for (const width of [1440, 1280, 390])
  test(`fitness candidate CRUD and native dialog at ${width}px`, async ({
    page,
  }) => {
    const failures: string[] = [];
    page.on("pageerror", (error) => failures.push(error.message));
    await page.route("https://**/*", (route) => route.abort());
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/");
    const panel = page.getByRole("region", { name: "健身计划", exact: true });
    await expect(panel).toBeVisible();
    const todo = page.getByRole("region", { name: "Todo", exact: true });
    await expect(todo).toBeVisible();
    await expect(page.getByRole("region", { name: "今日锚点" })).toHaveCount(0);
    expect(
      await panel.evaluate((el) => el.getBoundingClientRect().top),
    ).toBeGreaterThan(
      await todo.evaluate((el) => el.getBoundingClientRect().bottom),
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await panel.getByRole("button", { name: "新增预约", exact: true }).click();
    let dialog = page.getByRole("dialog", { name: "新增预约", exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("健身事件")).toBeFocused();
    // The native modal keeps keyboard navigation inside and restores its trigger.
    await page.keyboard.press("Shift+Tab");
    expect(
      await page.evaluate(() => !!document.activeElement?.closest("dialog")),
    ).toBe(true);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(
      panel.getByRole("button", { name: "新增预约", exact: true }),
    ).toBeFocused();
    await panel.getByRole("button", { name: "新增预约", exact: true }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel("健身事件").fill("浏览器合成预约");
    await dialog.getByLabel("开始时间").fill("18:30");
    await dialog.getByLabel("结束时间").fill("19:30");
    await dialog.getByLabel("地点", { exact: true }).fill("合成场地");
    await dialog
      .getByLabel("备注", { exact: true })
      .fill("<script>safe</script>\n" + "长备注".repeat(200));
    await dialog.getByRole("button", { name: "保存预约" }).click();
    await expect(dialog).toHaveCount(0);
    const item = panel.getByRole("article", {
      name: "浏览器合成预约",
      exact: true,
    });
    await expect(item).toBeVisible();
    await item.getByRole("button", { name: "编辑浏览器合成预约" }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel("健身事件").fill("已改期合成预约");
    await dialog.getByLabel("预约日期").fill("2030-06-02");
    await dialog.getByRole("button", { name: "保存预约" }).click();
    await expect(
      panel.getByRole("heading", { name: "2030 年 6 月" }),
    ).toBeVisible();
    const updated = panel.getByRole("article", {
      name: "已改期合成预约",
      exact: true,
    });
    await expect(updated).toBeVisible();
    await updated.getByRole("button", { name: "编辑已改期合成预约" }).click();
    await page.keyboard.press("Escape");
    await expect(
      updated.getByRole("button", { name: "编辑已改期合成预约" }),
    ).toBeFocused();
    await updated.getByRole("button", { name: "删除已改期合成预约" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "取消" })
      .click();
    await expect(updated).toBeVisible();
    await updated.getByRole("button", { name: "删除已改期合成预约" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "确认删除" })
      .click();
    await expect(updated).toHaveCount(0);
    await expect(panel.getByText("当天暂无预约")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    expect(failures).toEqual([]);
  });
