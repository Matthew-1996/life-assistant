// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../../src/App";
import { ApiError, createApiClient, type LifeConsoleClient } from "../../src/api/client";
import { syntheticDashboard } from "../../src/data/dashboard";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function navigationButton(name: string) {
  return within(screen.getByRole("navigation", { name: "全局导航" })).getByRole(
    "button",
    { name: new RegExp(`^${name}`) },
  );
}

// The enrichment surface is exercised in dedicated Hub tests; UI mocks only
// need these stubs to satisfy the client contract for unrelated flows.
function enrichmentStubs() {
  return {
    enrichmentPreview: vi.fn(),
    enrichmentCommit: vi.fn(),
    enrichmentStatus: vi.fn(),
    enrichmentRetry: vi.fn(),
    enrichNow: vi.fn(),
    enrichmentByJournal: vi.fn(),
    deleteJournal: vi.fn(),
  };
}

describe("Life Console synthetic UI", () => {
  it("navigates all four pages with keyboard-accessible controls", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(
      screen.getByRole("heading", { level: 1, name: "一周试行控制台。" }),
    ).toBeTruthy();

    const progress = navigationButton("进展");
    progress.focus();
    await user.keyboard("{Enter}");
    expect(
      screen.getByRole("heading", { level: 1, name: "自然周路径，不惩罚空白。" }),
    ).toBeTruthy();

    await user.click(navigationButton("记录"));
    expect(
      screen.getByRole("heading", { level: 1, name: "先预览，再写入。" }),
    ).toBeTruthy();

    await user.click(navigationButton("系统"));
    expect(
      screen.getByRole("heading", { level: 1, name: "本地工作站，不替代真相源。" }),
    ).toBeTruthy();
  });

  it("renders the accepted Apple-style trial week shell", () => {
    const { container } = render(<App />);

    expect(container.querySelector(".topbar")).toBeTruthy();
    expect(container.querySelector(".topbar-inner")).toBeTruthy();
    expect(container.querySelector(".brand-mark")).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "全局导航" })).toBeTruthy();
    expect(screen.getByText("Life Console · Trial Week")).toBeTruthy();
    expect(screen.getByRole("link", { name: "跳到主要内容" })).toBeTruthy();
  });

  it("makes the trial week projects the workbench focus", () => {
    render(<App />);

    const projects = screen.getByRole("region", { name: "本周双轨试行" });
    expect(within(projects).getByText("合成室内训练")).toBeTruthy();
    expect(within(projects).getByText("合成 Agent 实操")).toBeTruthy();
    expect(screen.getByText("今日只做一个")).toBeTruthy();
    expect(screen.getByText("本周路径，轻量可回退。")).toBeTruthy();
    expect(screen.getByText("最低版不是失败")).toBeTruthy();
  });

  it("keeps unknown distinct from skipped in anchor controls", async () => {
    const user = userEvent.setup();
    render(<App />);

    const lifeAction = screen.getByRole("group", { name: "生活动作状态" });
    const unknown = within(lifeAction).getByRole("button", { name: "未记录" });
    const skipped = within(lifeAction).getByRole("button", { name: "跳过" });

    expect(unknown.getAttribute("aria-pressed")).toBe("true");
    expect((unknown as HTMLButtonElement).disabled).toBe(true);
    expect(skipped.getAttribute("aria-pressed")).toBe("false");

    await user.click(skipped);
    expect(unknown.getAttribute("aria-pressed")).toBe("false");
    expect(skipped.getAttribute("aria-pressed")).toBe("true");
  });

  it("renders confirmed auxiliary goals as read-only active projects", () => {
    render(<App />);

    const projects = screen.getByRole("region", { name: "本周双轨试行" });
    expect(within(projects).getByText("合成室内训练")).toBeTruthy();
    expect(within(projects).getByText("合成 Agent 实操")).toBeTruthy();
    expect(
      within(projects).getAllByText("2026-01-12 至 2026-01-18", {
        selector: "span",
      }),
    ).toHaveLength(2);
    expect(within(projects).getAllByText("只读项目")).toHaveLength(2);
  });

  it("shows quick record cards for movement and daily anchors instead of Agent fields", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    await user.click(navigationButton("记录"));

    expect(container.querySelector(".quick-record-grid")).toBeTruthy();
    expect(screen.getByText("运动恢复快速记录")).toBeTruthy();
    expect(screen.getByText("今日锚点快速记录")).toBeTruthy();
    expect(screen.getByLabelText("今天做了什么")).toBeTruthy();
    expect(screen.getByLabelText("身体反应")).toBeTruthy();
    expect(screen.getByLabelText("快速记录起床状态")).toBeTruthy();
    expect(screen.getByLabelText("快速记录身体 / 光照状态")).toBeTruthy();
    expect(screen.queryByText("Agent 实操快速记录")).toBeNull();
    expect(screen.getByRole("button", { name: "生成预览" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "保存到 iCloud" })).toBeTruthy();
  });

  it("previews a conversation draft without writing it", async () => {
    const user = userEvent.setup();
    const journal = vi.fn();
    const preview = vi.fn().mockResolvedValue({
      schema_version: 1,
      state: "available",
      message: "已生成结构化预览",
      intent: "journal",
      preview: {
        event_date: syntheticDashboard.date,
        summary: "今天完成了最低版",
        completion: "minimum",
      },
    });
    const client = {
      dashboard: vi.fn().mockResolvedValue(syntheticDashboard),
      journal,
      checkin: vi.fn(),
      preview,
      ...enrichmentStubs(),
    } satisfies LifeConsoleClient;
    render(<App client={client} initialDashboard={syntheticDashboard} />);
    await user.click(navigationButton("记录"));
    await user.type(
      screen.getByLabelText("直接描述想记录的内容"),
      "今天完成了最低版。",
    );
    await user.click(screen.getByRole("button", { name: "生成预览" }));

    await waitFor(() => expect(preview).toHaveBeenCalledTimes(1));
    expect(journal).not.toHaveBeenCalled();
    expect(screen.getByText("结构化预览")).toBeTruthy();
    expect(screen.getByText("今天完成了最低版")).toBeTruthy();
  });

  it("keeps recorded journals and daily context visible on the record page", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(navigationButton("记录"));

    const context = screen.getByRole("region", { name: "已录入与上下文" });
    expect(within(context).getByText("周末散步")).toBeTruthy();
    expect(within(context).getByText("今日锚点")).toBeTruthy();
    expect(within(context).getByText("醒来")).toBeTruthy();
    expect(within(context).getByText("完成")).toBeTruthy();
    expect(within(context).getByText("Google / XLSX")).toBeTruthy();
    expect(within(context).getByText("按需")).toBeTruthy();
    expect(within(context).getByText("移动网页")).toBeTruthy();
    expect(within(context).getByText("已归档")).toBeTruthy();
  });

  it("derives the current weekday from the dashboard date", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(navigationButton("进展"));

    const current = document.querySelector('.week-path li[data-current="true"]');
    expect(current?.textContent).toContain("周一");
    expect(current?.textContent).toContain("今天");
    expect(current?.textContent).toContain("01-12");
  });

  it("presents low-pressure progress and weekend review guidance", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(navigationButton("进展"));

    expect(screen.getByText("双轨进展")).toBeTruthy();
    expect(screen.getByText("主观信号")).toBeTruthy();
    expect(screen.getByText("缺失值不惩罚")).toBeTruthy();
    expect(screen.getByText("周末只看四件事")).toBeTruthy();
    expect(screen.getByText("下一周只保留、调整或停止哪一件事？")).toBeTruthy();
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

  it("saves conversation capture without browser persistence in demo mode", async () => {
    const user = userEvent.setup();
    const localSet = vi.spyOn(Storage.prototype, "setItem");
    render(<App />);
    await user.click(navigationButton("记录"));

    const text = "这是一段只用于测试的合成记录。";
    await user.type(screen.getByLabelText("直接描述想记录的内容"), text);
    await user.click(screen.getByRole("button", { name: "保存到 iCloud" }));

    expect(screen.getByRole("status").textContent).toContain("合成演示");
    expect(localSet).not.toHaveBeenCalled();
  });

  it("saves conversation capture through the Hub client and refreshes", async () => {
    const user = userEvent.setup();
    const journal = vi.fn().mockResolvedValue({
      request_id: "req_conv",
      command_id: "cmd_conv",
      action: "created",
      source: { state: "saved", revision: null },
      read_model: "current",
      message: "已保存到 iCloud",
    });
    const dashboard = vi.fn().mockResolvedValue(syntheticDashboard);
    const client = {
      dashboard,
      journal,
      checkin: vi.fn(),
      preview: vi.fn(),
      ...enrichmentStubs(),
    } satisfies LifeConsoleClient;
    render(<App client={client} initialDashboard={syntheticDashboard} />);
    await user.click(navigationButton("记录"));

    await user.type(
      screen.getByLabelText("直接描述想记录的内容"),
      "今天去公园散步，很放松。",
    );
    await user.click(screen.getByRole("button", { name: "保存到 iCloud" }));

    await waitFor(() => expect(journal).toHaveBeenCalledTimes(1));
    const sent = journal.mock.calls[0][0];
    expect(sent.text).toBe("今天去公园散步，很放松。");
    expect(sent.time_precision).toBe("unknown");
    expect(sent.event_date).toBe(syntheticDashboard.date);
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain("已保存到 iCloud"),
    );
    // Refreshed the dashboard so the new card (with its status) appears.
    expect(dashboard).toHaveBeenCalled();
  });

  it("keeps advanced form fields collapsed by default", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(navigationButton("记录"));

    const details = screen.getByText("补充时间、人物或场景").closest("details");
    expect(details?.hasAttribute("open")).toBe(false);
    expect(screen.getByRole("button", { name: "保存日记" })).toBeTruthy();
  });

  it("shows on-demand derived views and the private online surface", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(navigationButton("系统"));

    expect(screen.getByText("按需使用")).toBeTruthy();
    expect(screen.getByText("按需重建")).toBeTruthy();
    expect(screen.getAllByText("按需发布").length).toBeGreaterThan(0);
    expect(screen.getByText("已验证可读取")).toBeTruthy();
  });

  it("keeps the private Sites mode read-only and hides diary content", async () => {
    const user = userEvent.setup();
    const privateSnapshot = {
      ...syntheticDashboard,
      records: { recent_journals: [] },
    };
    render(
      <App initialDashboard={privateSnapshot} mode="sites-readonly" />,
    );

    expect(screen.getByText(/私人线上只读版/)).toBeTruthy();
    expect(screen.queryByRole("group", { name: "生活动作状态" })).toBeNull();

    await user.click(navigationButton("记录"));
    expect(screen.getByRole("heading", { level: 1, name: "记录内容只留在本机。" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "保存到 iCloud" })).toBeNull();
    expect(screen.queryByText("合成日记标题")).toBeNull();

    await user.click(navigationButton("系统"));
    expect(screen.getByText("线上不连接")).toBeTruthy();
    expect(screen.getByText("当前入口")).toBeTruthy();
  });

  it("explains runtime flow and source-of-truth boundaries", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(navigationButton("系统"));

    expect(screen.getByText("运行关系")).toBeTruthy();
    expect(screen.getByText("保存确认")).toBeTruthy();
    expect(screen.getByText("数据与展示边界")).toBeTruthy();
    expect(screen.getByText("派生展示与线上边界")).toBeTruthy();
    expect(screen.getByText("设计治理资产关系")).toBeTruthy();
  });

  it("does not show an anchor as saved when the Hub write fails", async () => {
    const user = userEvent.setup();
    const client = {
      dashboard: vi.fn().mockResolvedValue(syntheticDashboard),
      journal: vi.fn(),
      checkin: vi.fn().mockRejectedValue(new Error("synthetic hub failure")),
      preview: vi.fn(),
      ...enrichmentStubs(),
    } satisfies LifeConsoleClient;
    render(<App client={client} initialDashboard={syntheticDashboard} />);

    const group = screen.getByRole("group", { name: "生活动作状态" });
    const unknown = within(group).getByRole("button", { name: "未记录" });
    const complete = within(group).getByRole("button", { name: "完成" });
    await user.click(complete);

    await waitFor(() => expect(client.checkin).toHaveBeenCalledTimes(1));
    expect(unknown.getAttribute("aria-pressed")).toBe("true");
    expect(complete.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("status").textContent).toContain("保存失败");
  });

  it("shows a source-confirmed anchor only after the dashboard refresh", async () => {
    const user = userEvent.setup();
    const updated = structuredClone(syntheticDashboard);
    updated.today.anchors.life_action = "complete";
    updated.today.daily_revision = 4;
    const client = {
      dashboard: vi.fn().mockResolvedValue(updated),
      journal: vi.fn(),
      checkin: vi.fn().mockResolvedValue({
        request_id: "req_anchor",
        command_id: "cmd_anchor",
        action: "updated" as const,
        source: { state: "saved" as const, revision: 4 },
        read_model: "current" as const,
        message: "已保存到 iCloud",
      }),
      preview: vi.fn(),
      ...enrichmentStubs(),
    } satisfies LifeConsoleClient;
    render(<App client={client} initialDashboard={syntheticDashboard} />);

    const group = screen.getByRole("group", { name: "生活动作状态" });
    const complete = within(group).getByRole("button", { name: "完成" });
    await user.click(complete);

    await waitFor(() => expect(complete.getAttribute("aria-pressed")).toBe("true"));
    expect(client.dashboard).toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toBe("已保存到 iCloud");
  });

  it("submits the journal form through the Hub client", async () => {
    const user = userEvent.setup();
    const journal = vi.fn().mockResolvedValue({
      request_id: "req_test",
      command_id: "cmd_test",
      action: "created",
      source: { state: "saved", revision: null },
      read_model: "current",
      message: "已保存到 iCloud",
    });
    const client = {
      dashboard: vi.fn().mockResolvedValue(syntheticDashboard),
      journal,
      checkin: vi.fn(),
      preview: vi.fn(),
      ...enrichmentStubs(),
    } satisfies LifeConsoleClient;
    render(<App client={client} initialDashboard={syntheticDashboard} />);
    await user.click(navigationButton("记录"));
    await user.type(screen.getByLabelText("发生了什么"), "合成表单正文");
    await user.type(screen.getByLabelText("当时的感受（可选）"), "轻松");
    await user.click(screen.getByRole("button", { name: "保存日记" }));

    await waitFor(() => expect(journal).toHaveBeenCalledTimes(1));
    expect(journal).toHaveBeenCalledWith(expect.objectContaining({
      title: "合成表单正文",
      summary: "合成表单正文；感到轻松",
      facts: ["合成表单正文"],
      feelings: ["轻松"],
      text: "合成表单正文\n\n感受：轻松",
    }));
    expect(screen.getByRole("status").textContent).toBe("已保存到 iCloud");
  });

  it("compares current and submitted values on revision conflict", async () => {
    const user = userEvent.setup();
    const response = {
      request_id: "req_conflict",
      error: {
        code: "REVISION_CONFLICT" as const,
        message: "记录已更新",
        retryable: false,
      },
      conflict: {
        target_key: syntheticDashboard.date,
        current_revision: 2,
        current: { life_action: "complete" as const },
        submitted: { life_action: "minimum" as const },
      },
    };
    const client = {
      dashboard: vi.fn().mockResolvedValue(syntheticDashboard),
      journal: vi.fn(),
      checkin: vi.fn().mockRejectedValue(new ApiError(response, 409)),
      preview: vi.fn(),
      ...enrichmentStubs(),
    } satisfies LifeConsoleClient;
    render(<App client={client} initialDashboard={syntheticDashboard} />);
    const group = screen.getByRole("group", { name: "生活动作状态" });
    await user.click(within(group).getByRole("button", { name: "最低版" }));

    expect(await screen.findByRole("region", { name: "状态冲突" })).toBeTruthy();
    expect(screen.getByText("当前值")).toBeTruthy();
    expect(screen.getByText("本次提交")).toBeTruthy();
    expect(within(group).getByRole("button", { name: "未记录" }).getAttribute("aria-pressed")).toBe("true");

    await user.click(screen.getByRole("button", { name: "使用最新记录" }));
    await waitFor(() => {
      expect(screen.queryByRole("region", { name: "状态冲突" })).toBeNull();
    });
  });

  it("submits only explicitly filled checkin fields", async () => {
    const user = userEvent.setup();
    const checkin = vi.fn().mockResolvedValue({
      request_id: "req_checkin",
      command_id: "cmd_checkin",
      action: "updated",
      source: { state: "saved", revision: 2 },
      read_model: "current",
      message: "已保存到 iCloud",
    });
    const client = {
      dashboard: vi.fn().mockResolvedValue(syntheticDashboard),
      journal: vi.fn(),
      checkin,
      preview: vi.fn(),
      ...enrichmentStubs(),
    } satisfies LifeConsoleClient;
    render(<App client={client} initialDashboard={syntheticDashboard} />);
    await user.click(navigationButton("记录"));
    await user.click(screen.getByRole("tab", { name: "每日状态" }));
    await user.selectOptions(screen.getByLabelText("精力"), "4");
    await user.click(screen.getByRole("button", { name: "更新这些状态" }));

    await waitFor(() => expect(checkin).toHaveBeenCalledTimes(1));
    expect(checkin.mock.calls[0][1].fields).toEqual({ energy: 4 });
  });

  it("quick daily anchors save through checkin without switching form tabs", async () => {
    const user = userEvent.setup();
    const checkin = vi.fn().mockResolvedValue({
      request_id: "req_quick_anchor",
      command_id: "cmd_quick_anchor",
      action: "updated",
      source: { state: "saved", revision: 4 },
      read_model: "current",
      message: "已保存到 iCloud",
    });
    const client = {
      dashboard: vi.fn().mockResolvedValue(syntheticDashboard),
      journal: vi.fn(),
      checkin,
      preview: vi.fn(),
      ...enrichmentStubs(),
    } satisfies LifeConsoleClient;
    render(<App client={client} initialDashboard={syntheticDashboard} />);
    await user.click(navigationButton("记录"));
    await user.selectOptions(screen.getByLabelText("快速记录生活动作状态"), "complete");
    await user.selectOptions(screen.getByLabelText("快速记录晚间降速状态"), "skipped");
    await user.click(screen.getByRole("button", { name: "保存今日锚点" }));

    await waitFor(() => expect(checkin).toHaveBeenCalledTimes(1));
    expect(checkin).toHaveBeenCalledWith(syntheticDashboard.date, {
      schema_version: 1,
      expect_revision: syntheticDashboard.today.daily_revision,
      fields: {
        wake: "complete",
        body_light: "minimum",
        life_action: "complete",
        wind_down: "skipped",
      },
    });
    expect(client.journal).not.toHaveBeenCalled();
  });

  it("auto-enriches a conversation entry after saving it", async () => {
    const user = userEvent.setup();
    const saved = structuredClone(syntheticDashboard);
    saved.records.recent_journals = [
      {
        id: "20260112-unknown-abc123abc123",
        date: syntheticDashboard.date,
        title: "今天去公园散步，很放松",
        summary: "今天去公园散步，很放松",
        enrichment_state: "raw",
      },
    ];
    const journal = vi.fn().mockResolvedValue({
      request_id: "r", command_id: "c", action: "created",
      source: { state: "saved", revision: null }, read_model: "current", message: "已保存到 iCloud",
    });
    const enrichNow = vi.fn().mockResolvedValue({
      schema_version: 1, job_id: "job_auto_0001", journal_id: "20260112-unknown-abc123abc123",
      provider: "deepseek", model: "deepseek-v4-flash",
      prompt_version: "journal-enrichment-2026-08-05.1", status: "queued", attempts: 0, max_retries: 2,
    });
    const client = {
      dashboard: vi.fn().mockResolvedValue(saved),
      journal,
      checkin: vi.fn(),
      preview: vi.fn(),
      ...enrichmentStubs(),
      enrichNow,
    } satisfies LifeConsoleClient;
    render(<App client={client} initialDashboard={syntheticDashboard} />);
    await user.click(navigationButton("记录"));

    await user.type(
      screen.getByLabelText("直接描述想记录的内容"),
      "今天去公园散步，很放松。",
    );
    await user.click(screen.getByRole("button", { name: "保存到 iCloud" }));

    await waitFor(() => expect(journal).toHaveBeenCalledTimes(1));
    // 保存后自动触发一次整理，无需再手动点击。
    await waitFor(() => expect(enrichNow).toHaveBeenCalledTimes(1));
    expect(enrichNow.mock.calls[0][0]).toBe("20260112-unknown-abc123abc123");
  });

  it("shows a status label and manually enriches a record", async () => {
    const user = userEvent.setup();
    const enrichNow = vi.fn().mockResolvedValue({
      schema_version: 1, job_id: "job_manual_0001", journal_id: "20260111-unknown-000000000000",
      provider: "deepseek", model: "deepseek-v4-flash",
      prompt_version: "journal-enrichment-2026-08-05.1", status: "queued", attempts: 0, max_retries: 2,
    });
    const enrichmentByJournal = vi.fn().mockResolvedValue({
      schema_version: 1, job_id: "job_manual_0001", journal_id: "20260111-unknown-000000000000",
      provider: "deepseek", model: "deepseek-v4-flash",
      prompt_version: "journal-enrichment-2026-08-05.1", status: "succeeded", attempts: 1, max_retries: 2,
    });
    const client = {
      dashboard: vi.fn().mockResolvedValue(syntheticDashboard),
      journal: vi.fn(),
      checkin: vi.fn(),
      preview: vi.fn(),
      ...enrichmentStubs(),
      enrichNow,
      enrichmentByJournal,
    } satisfies LifeConsoleClient;
    render(<App client={client} initialDashboard={syntheticDashboard} />);
    await user.click(navigationButton("记录"));

    // 卡片显示状态标签，而不是"用 DeepSeek 整理此篇"按钮。
    expect(screen.getByText("原始记录")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "用 DeepSeek 整理此篇" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "整理" }));
    await waitFor(() => expect(enrichNow).toHaveBeenCalledTimes(1));
    expect(enrichNow.mock.calls[0][0]).toBe("20260111-unknown-000000000000");
  });

  it("requires a second confirmation before deleting a record", async () => {
    const user = userEvent.setup();
    const deleteJournal = vi.fn().mockResolvedValue({
      request_id: "r", command_id: "c", action: "deleted",
      journal_id: "20260111-unknown-000000000000", message: "已从当前项目删除这条日记",
    });
    const client = {
      dashboard: vi.fn().mockResolvedValue(syntheticDashboard),
      journal: vi.fn(),
      checkin: vi.fn(),
      preview: vi.fn(),
      ...enrichmentStubs(),
      deleteJournal,
    } satisfies LifeConsoleClient;
    render(<App client={client} initialDashboard={syntheticDashboard} />);
    await user.click(navigationButton("记录"));

    await user.click(screen.getByRole("button", { name: "删除" }));
    // 第一次点击只弹出确认，不删除。
    expect(deleteJournal).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog", { name: "确认删除这条记录" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "确认删除" }));
    await waitFor(() => expect(deleteJournal).toHaveBeenCalledTimes(1));
    expect(deleteJournal.mock.calls[0][0]).toBe("20260111-unknown-000000000000");
    expect(await screen.findByText("已删除这条记录。")).toBeTruthy();
  });
});

describe("Life Console API session", () => {
  it("establishes a session before protected reads and refreshes it once on 403", async () => {
    const session = (suffix: string) => ({
      schema_version: 1 as const,
      csrf_token: `synthetic_csrf_token_${suffix}`,
      expires_at: "2099-01-01T00:00:00Z",
    });
    const error = {
      request_id: "req_expired",
      error: { code: "INVALID_REQUEST", message: "会话无效", retryable: false },
    };
    const responses: Array<readonly [number, unknown]> = [
      [200, session("first")],
      [403, error],
      [200, session("second")],
      [200, syntheticDashboard],
    ];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      const [status, body] = responses.shift()!;
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
      } as Response;
    });

    const result = await createApiClient().dashboard();

    expect(result.date).toBe(syntheticDashboard.date);
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      "/api/v1/session",
      "/api/v1/dashboard",
      "/api/v1/session",
      "/api/v1/dashboard",
    ]);
  });
});
