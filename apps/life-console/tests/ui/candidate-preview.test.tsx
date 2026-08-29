// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { App } from "../../src/App";
import { candidateHealthRepository } from "../../src/data/candidate-health";
import { syntheticDashboard } from "../../src/data/dashboard";
import { syntheticDailyNewsClient } from "../../src/data/daily-news";
import { createCandidateTodoRepository } from "../../src/features/todos/candidate-todo-repository";

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
  it("previews Todo status filtering with synthetic rows in both scopes and Gantt", async () => {
    const user = userEvent.setup();
    render(
      <App
        initialDashboard={syntheticDashboard}
        mode="candidate-preview"
        todos={createCandidateTodoRepository()}
      />,
    );

    const gantt = screen.getByRole("region", { name: "Todo 14 天甘特" });
    expect(await screen.findByRole("article", { name: /整理旅行清单/ })).toBeTruthy();
    expect(screen.getByRole("article", { name: /准备本周采购/ })).toBeTruthy();
    expect(screen.queryByRole("article", { name: /完成房间整理/ })).toBeNull();
    expect(within(gantt).queryByText("完成房间整理")).toBeNull();

    await user.click(screen.getByRole("checkbox", { name: "已完成" }));
    expect(await screen.findByRole("article", { name: /完成房间整理/ })).toBeTruthy();
    expect(within(gantt).getByText("完成房间整理")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "全部" }));
    expect((screen.getByRole("checkbox", { name: "已完成" }) as HTMLInputElement).checked).toBe(true);
    expect(await screen.findByRole("article", { name: /完成房间整理/ })).toBeTruthy();
    expect(within(gantt).getByText("完成房间整理")).toBeTruthy();
  });

  it("shows the synthetic read-only identity across all four pages", async () => {
    const user = userEvent.setup();
    render(
      <App
        candidateHealth={candidateHealthRepository}
        initialDashboard={syntheticDashboard}
        mode="candidate-preview"
      />,
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
      screen.getByRole("heading", { name: "目标与趋势" }),
    ).toBeTruthy();

    await user.click(navigationButton("系统"));
    expect(screen.getByText("mode=CANDIDATE_PREVIEW · 合成数据")).toBeTruthy();
  });

  it("shows populated synthetic activity and sleep trends", async () => {
    const user = userEvent.setup();
    render(
      <App
        candidateHealth={candidateHealthRepository}
        initialDashboard={syntheticDashboard}
        mode="candidate-preview"
      />,
    );

    await user.click(navigationButton("进展"));

    for (const label of ["步数", "活动能量", "锻炼分钟", "睡眠时长"]) {
      const card = await screen.findByRole("article", {
        name: `${label} 14 天趋势`,
      });
      expect(
        within(card).getByText("前 7 天有效 3 · 最近 7 天有效 3"),
      ).toBeTruthy();
    }
  });

  it("shows a complete synthetic daily-news digest on the workbench", async () => {
    render(
      <App
        dailyNews={syntheticDailyNewsClient}
        initialDashboard={syntheticDashboard}
        mode="candidate-preview"
      />,
    );

    const panel = screen.getByRole("region", { name: "每日新闻" });
    expect(await within(panel).findByText("合成示例：人工智能基础设施持续演进")).toBeTruthy();
    expect(within(panel).getAllByRole("article")).toHaveLength(6);
    expect(within(panel).getAllByText("合成示例")).toHaveLength(6);
    expect(within(panel).getAllByText("科技")).toHaveLength(2);
    expect(within(panel).getAllByText("财经")).toHaveLength(2);
    expect(within(panel).getAllByText("政治")).toHaveLength(2);
    expect(within(panel).getAllByText("国内")).toHaveLength(3);
    expect(within(panel).getAllByText("国际")).toHaveLength(3);
    expect(within(panel).queryByText("新闻服务尚未连接；上线前保持可重试空态。")).toBeNull();
  });

  it("shows the synthetic journal title and original text below conversation capture", async () => {
    const user = userEvent.setup();
    render(
      <App initialDashboard={syntheticDashboard} mode="candidate-preview" />,
    );

    await user.click(navigationButton("记录"));

    const conversation = screen.getByRole("region", { name: "对话式记录面板" });
    const journal = await screen.findByRole("article", { name: "周末散步" });
    expect(within(journal).getByText("在附近公园散步，感觉节奏比较放松。")).toBeTruthy();
    expect(
      conversation.compareDocumentPosition(journal) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("edits a synthetic journal in memory and resets it after remount", async () => {
    const user = userEvent.setup();
    const first = render(
      <App initialDashboard={syntheticDashboard} mode="candidate-preview" />,
    );
    await user.click(navigationButton("记录"));

    const journal = await screen.findByRole("article", { name: "周末散步" });
    await user.click(within(journal).getByRole("button", { name: "编辑 周末散步" }));
    const title = screen.getByLabelText("编辑日记标题");
    const content = screen.getByLabelText("编辑日记正文");
    await user.clear(title);
    await user.type(title, "合成散步修订");
    await user.clear(content);
    await user.type(content, "这是只在当前页面生效的合成原文。");
    await user.click(screen.getByRole("button", { name: "保存修改" }));

    const updated = await screen.findByRole("article", { name: "合成散步修订" });
    expect(within(updated).getByText("这是只在当前页面生效的合成原文。")).toBeTruthy();
    first.unmount();

    render(
      <App initialDashboard={syntheticDashboard} mode="candidate-preview" />,
    );
    await user.click(navigationButton("记录"));
    expect(await screen.findByRole("article", { name: "周末散步" })).toBeTruthy();
    expect(screen.queryByRole("article", { name: "合成散步修订" })).toBeNull();
  });

  it("soft deletes and restores a synthetic journal without permanent delete", async () => {
    const user = userEvent.setup();
    render(
      <App initialDashboard={syntheticDashboard} mode="candidate-preview" />,
    );
    await user.click(navigationButton("记录"));

    const journal = await screen.findByRole("article", { name: "周末散步" });
    await user.click(within(journal).getByRole("button", { name: "删除日记" }));
    const dialog = screen.getByRole("dialog", { name: "移到已删除" });
    expect(within(dialog).getByText(/不会永久删除/)).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "确认移到已删除" }));

    expect(await screen.findByText("日记已移到已删除，可随时恢复。")).toBeTruthy();
    expect(screen.queryByRole("article", { name: "周末散步" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "查看已删除 (1)" }));
    const deleted = screen.getByRole("region", { name: "已删除日记" });
    expect(within(deleted).getByText("周末散步")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "永久删除" })).toBeNull();
    await user.click(within(deleted).getByRole("button", { name: "恢复日记" }));

    expect(await screen.findByRole("article", { name: "周末散步" })).toBeTruthy();
    expect(screen.getByText("日记已恢复。")).toBeTruthy();
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
