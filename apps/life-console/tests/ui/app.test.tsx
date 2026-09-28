// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../../src/App";
import { createApiClient, type LifeConsoleClient } from "../../src/api/client";
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
      screen.getByRole("heading", {
        level: 1,
        name: "把重要的事情放在看得见的地方，给今天留出一段真正能完成的时间。",
      }),
    ).toBeTruthy();

    const progress = navigationButton("进展");
    progress.focus();
    await user.keyboard("{Enter}");
    expect(
      screen.getByRole("heading", { level: 1, name: "目标与趋势" }),
    ).toBeTruthy();

    await user.click(navigationButton("记录"));
    expect(
      screen.getByRole("heading", { level: 1, name: "轻量记录，明确保存。" }),
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

  it("keeps a decorative icon and visible label in every navigation control", () => {
    render(<App />);

    for (const label of ["工作台", "记录", "进展", "系统"]) {
      const button = navigationButton(label);
      expect(button.querySelector("svg[aria-hidden='true']")).toBeTruthy();
      expect(button.querySelector(".nav-label")?.textContent).toBe(label);
    }
  });

  it("uses the accepted 2.5 workbench information architecture", () => {
    render(<App />);

    expect(screen.getByRole("region", { name: "本周寄语" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Todo" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "每日新闻" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "今日锚点" })).toBeNull();
    expect(screen.getByRole("region", { name: "健身计划" })).toBeTruthy();
    expect(screen.queryByText("隐私与保存链路")).toBeNull();
  });

  it("keeps confirmed auxiliary goals on the progress page", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(navigationButton("进展"));

    expect(screen.getByText("合成室内训练")).toBeTruthy();
    expect(screen.getByText("合成 Agent 实操")).toBeTruthy();
    expect(screen.getAllByText("活跃目标").length).toBeGreaterThan(0);
    expect(screen.queryByText("只读项目")).toBeNull();
  });

  it("keeps the 2.5 record page focused on the conversation entry", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    await user.click(navigationButton("记录"));

    expect(screen.getByRole("region", { name: "对话式记录面板" })).toBeTruthy();
    expect(container.querySelector(".quick-record-grid")).toBeNull();
    expect(screen.queryByText("运动恢复快速记录")).toBeNull();
    expect(screen.queryByText("今日锚点快速记录")).toBeNull();
    expect(screen.queryByRole("button", { name: "生成预览" })).toBeNull();
    expect(screen.getByRole("button", { name: "保存到 iCloud" })).toBeTruthy();
  });

  it("does not write a conversation draft before explicit save", async () => {
    const user = userEvent.setup();
    const journal = vi.fn();
    const preview = vi.fn();
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

    expect(preview).not.toHaveBeenCalled();
    expect(journal).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "生成预览" })).toBeNull();
  });

  it("removes the legacy dashboard context from the record page", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(navigationButton("记录"));

    expect(screen.queryByRole("region", { name: "已录入与上下文" })).toBeNull();
    expect(screen.getByRole("region", { name: "对话式记录面板" })).toBeTruthy();
  });

  it("anchors the seven-day sleep table to the dashboard date", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(navigationButton("进展"));

    const table = screen.getByRole("table", { name: "最近 7 天睡眠时刻" });
    expect(within(table).getByText("2026-01-12")).toBeTruthy();
    expect(within(table).getByText("2026-01-06")).toBeTruthy();
    expect(screen.queryByText("自然周")).toBeNull();
  });

  it("keeps progress focused on goals, trends and sleep timing", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(navigationButton("进展"));

    expect(screen.getByRole("region", { name: "目标" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "14 天趋势" })).toBeTruthy();
    expect(screen.getByRole("table", { name: "最近 7 天睡眠时刻" })).toBeTruthy();
    expect(screen.queryByText("双轨进展")).toBeNull();
    expect(screen.queryByText("周末只看四件事")).toBeNull();
  });

  it("renders missing trend days as separate markers", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(navigationButton("进展"));

    const mood = screen.getByRole("article", { name: "情绪 14 天趋势" });
    expect(mood.querySelectorAll(".trend-bar-250")).toHaveLength(14);
    expect(mood.querySelectorAll('[data-missing="true"]')).toHaveLength(12);
    expect(within(mood).getByText("数据不足")).toBeTruthy();
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

  it("does not expose the retired advanced journal form", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(navigationButton("记录"));

    expect(screen.queryByText("补充时间、人物或场景")).toBeNull();
    expect(screen.queryByRole("button", { name: "保存日记" })).toBeNull();
    expect(screen.getByRole("button", { name: "保存到 iCloud" })).toBeTruthy();
  });

  it("shows on-demand derived views and the archived mobile site", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(navigationButton("系统"));

    expect(screen.getByText("按需使用")).toBeTruthy();
    expect(screen.getByText("按需重建")).toBeTruthy();
    expect(screen.getAllByText("已归档").length).toBeGreaterThan(0);
    expect(screen.getByText("已验证可读取")).toBeTruthy();
  });

  it("explains runtime flow and source-of-truth boundaries", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(navigationButton("系统"));

    expect(screen.getByText("运行关系")).toBeTruthy();
    expect(screen.getByText("保存确认")).toBeTruthy();
    expect(screen.getByText("数据与展示边界")).toBeTruthy();
    expect(screen.getByText("派生展示与归档边界")).toBeTruthy();
    expect(screen.getByText("设计治理资产关系")).toBeTruthy();
  });

  it("submits a record only through the primary conversation entry", async () => {
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
    expect(screen.queryByLabelText("发生了什么")).toBeNull();
    await user.type(
      screen.getByLabelText("直接描述想记录的内容"),
      "合成表单正文；感到轻松",
    );
    await user.click(screen.getByRole("button", { name: "保存到 iCloud" }));

    await waitFor(() => expect(journal).toHaveBeenCalledTimes(1));
    expect(journal).toHaveBeenCalledWith(expect.objectContaining({
      text: "合成表单正文；感到轻松",
    }));
    expect(screen.getByRole("status").textContent).toContain("已保存到 iCloud");
  });

  it("keeps the retired daily-status form off the record page", async () => {
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
    expect(screen.queryByRole("tab", { name: "每日状态" })).toBeNull();
    expect(screen.queryByLabelText("精力")).toBeNull();
    expect(checkin).not.toHaveBeenCalled();
  });

  it("keeps retired quick anchor controls off records without changing checkin API", async () => {
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
    expect(screen.queryByLabelText("快速记录生活动作状态")).toBeNull();
    expect(screen.queryByRole("button", { name: "保存今日锚点" })).toBeNull();
    expect(checkin).not.toHaveBeenCalled();
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

  it("does not expose legacy local enrichment controls on records", async () => {
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

    expect(screen.queryByText("原始记录")).toBeNull();
    expect(screen.queryByRole("button", { name: "用 DeepSeek 整理此篇" })).toBeNull();
    expect(screen.queryByRole("button", { name: "整理" })).toBeNull();
    expect(enrichNow).not.toHaveBeenCalled();
  });

  it("does not expose the retired local hard-delete flow", async () => {
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

    expect(screen.queryByRole("button", { name: "删除" })).toBeNull();
    expect(screen.queryByRole("button", { name: "永久删除" })).toBeNull();
    expect(deleteJournal).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog", { name: "确认删除这条记录" })).toBeNull();
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
