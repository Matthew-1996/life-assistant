// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { App } from "../../src/App";
import { syntheticDashboard } from "../../src/data/dashboard";

afterEach(() => {
  cleanup();
});

function navigationButton(name: string) {
  return within(screen.getByRole("navigation", { name: "全局导航" })).getByRole(
    "button",
    { name },
  );
}

describe("Life Console candidate preview", () => {
  it("shows the synthetic read-only identity across all four pages", async () => {
    const user = userEvent.setup();
    render(
      <App initialDashboard={syntheticDashboard} mode="candidate-preview" />,
    );

    expect(screen.getByText("Life Console · Candidate")).toBeTruthy();
    expect(screen.getByText("候选预览 · 合成数据")).toBeTruthy();
    expect(
      screen.getByText("合成候选预览：不绑定真实数据或存储"),
    ).toBeTruthy();
    expect(screen.queryByText("HTTPS 回环与 Worker 容量 POC")).toBeNull();

    await user.click(navigationButton("记录"));
    expect(screen.getByRole("heading", { name: "轻量记录，明确保存。" })).toBeTruthy();

    await user.click(navigationButton("进展"));
    expect(
      screen.getByRole("heading", { name: "自然周路径，不惩罚空白。" }),
    ).toBeTruthy();

    await user.click(navigationButton("系统"));
    expect(screen.getByText("mode=CANDIDATE_PREVIEW · 合成数据")).toBeTruthy();
  });

  it("only exposes the Stage A POC controls in the dedicated build", () => {
    render(
      <App
        initialDashboard={syntheticDashboard}
        mode="candidate-preview"
        stageAPocEnabled
      />,
    );

    expect(
      screen.getByRole("heading", { name: "HTTPS 回环与 Worker 容量 POC" }),
    ).toBeTruthy();
  });

  it("intercepts write controls without invoking a client", async () => {
    const user = userEvent.setup();
    render(
      <App initialDashboard={syntheticDashboard} mode="candidate-preview" />,
    );

    await user.click(navigationButton("记录"));
    await user.type(
      screen.getByLabelText("直接描述想记录的内容"),
      "合成候选记录",
    );
    const save = screen.getByRole("button", { name: "保存到 候选预览" });
    expect(save.getAttribute("data-readonly")).toBe("true");
    await user.click(save);

    expect(
      screen.getByRole("status", { name: "候选预览提示" }).textContent,
    ).toContain("只读预览模式：候选不可写");
  });
});
