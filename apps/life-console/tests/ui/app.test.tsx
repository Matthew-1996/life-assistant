// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../../src/App";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function navigationButton(name: string) {
  return within(screen.getByRole("navigation", { name: "主导航" })).getByRole(
    "button",
    { name: new RegExp(`^${name}`) },
  );
}

describe("Life Console synthetic UI", () => {
  it("navigates all four pages with keyboard-accessible controls", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(
      screen.getByRole("heading", { level: 1, name: "今日" }),
    ).toBeTruthy();

    const progress = navigationButton("进展");
    progress.focus();
    await user.keyboard("{Enter}");
    expect(
      screen.getByRole("heading", { level: 1, name: "进展" }),
    ).toBeTruthy();

    await user.click(navigationButton("记录"));
    expect(
      screen.getByRole("heading", { level: 1, name: "记录" }),
    ).toBeTruthy();

    await user.click(navigationButton("系统"));
    expect(
      screen.getByRole("heading", { level: 1, name: "系统" }),
    ).toBeTruthy();
  });

  it("keeps unknown distinct from skipped in anchor controls", async () => {
    const user = userEvent.setup();
    render(<App />);

    const lifeAction = screen.getByRole("group", { name: "生活动作状态" });
    const unknown = within(lifeAction).getByRole("button", { name: "未记录" });
    const skipped = within(lifeAction).getByRole("button", { name: "跳过" });

    expect(unknown.getAttribute("aria-pressed")).toBe("true");
    expect(skipped.getAttribute("aria-pressed")).toBe("false");

    await user.click(skipped);
    expect(unknown.getAttribute("aria-pressed")).toBe("false");
    expect(skipped.getAttribute("aria-pressed")).toBe("true");
  });

  it("renders separate trend segments across missing values", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(navigationButton("进展"));

    const moodChart = screen.getByRole("img", {
      name: "情绪趋势，缺失点断开",
    });
    expect(moodChart.querySelectorAll("polyline")).toHaveLength(2);
    const moodCard = moodChart.closest("article");
    expect(moodCard).not.toBeNull();
    expect(within(moodCard!).getByText("样本 2 · 缺失 1")).toBeTruthy();
  });

  it("shows conversation handoff without browser persistence", async () => {
    const user = userEvent.setup();
    const localSet = vi.spyOn(Storage.prototype, "setItem");
    render(<App />);
    await user.click(navigationButton("记录"));

    const text = "这是一段只用于测试的合成记录。";
    await user.type(screen.getByLabelText("直接描述想记录的内容"), text);
    await user.click(
      screen.getByRole("button", { name: "生成保存预览" }),
    );

    expect(screen.getByText("前往现有生活助手对话继续")).toBeTruthy();
    expect(localSet).not.toHaveBeenCalled();
  });

  it("keeps advanced form fields collapsed by default", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(navigationButton("记录"));
    await user.click(screen.getByRole("tab", { name: "简洁表单" }));

    const details = screen.getByText("补充时间信息").closest("details");
    expect(details?.hasAttribute("open")).toBe(false);
    expect(screen.getByRole("button", { name: "保存日记" })).toBeTruthy();
  });

  it("shows paused Google and pending mobile states as neutral copy", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(navigationButton("系统"));

    expect(screen.getByText("暂不维护")).toBeTruthy();
    expect(screen.getByText("方案待定")).toBeTruthy();
  });
});
