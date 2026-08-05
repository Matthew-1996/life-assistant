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
      screen.getByRole("heading", { level: 1, name: "今天，只看必要信息" }),
    ).toBeTruthy();

    const progress = navigationButton("进展");
    progress.focus();
    await user.keyboard("{Enter}");
    expect(
      screen.getByRole("heading", { level: 1, name: "趋势，只是辅助判断" }),
    ).toBeTruthy();

    await user.click(navigationButton("记录"));
    expect(
      screen.getByRole("heading", { level: 1, name: "记录，不打断生活" }),
    ).toBeTruthy();

    await user.click(navigationButton("系统"));
    expect(
      screen.getByRole("heading", { level: 1, name: "正常时，系统保持安静" }),
    ).toBeTruthy();
  });

  it("renders the Apple-style global navigation shell", () => {
    const { container } = render(<App />);

    expect(container.querySelector(".global-nav")).toBeTruthy();
    expect(container.querySelector(".brand-dot")).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "全局导航" })).toBeTruthy();
    const globalNav = container.querySelector(".global-nav");
    expect(globalNav).toBeTruthy();
    expect(
      within(globalNav as HTMLElement).getByRole("button", {
        name: "快速记录",
      }),
    ).toBeTruthy();
  });

  it("keeps the redesigned workbench hero calls to action in React", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    const main = within(screen.getByRole("main"));
    expect(container.querySelector(".status-panel")).toBeTruthy();
    expect(container.querySelector(".info-grid")).toBeTruthy();
    expect(container.querySelector(".privacy-card")).toBeTruthy();
    expect(screen.getByLabelText("今日状态摘要")).toBeTruthy();
    expect(screen.getByText("隐私与保存链路")).toBeTruthy();
    expect(main.getByRole("button", { name: "快速记录" })).toBeTruthy();
    expect(main.getByRole("button", { name: "查看进展" })).toBeTruthy();

    await user.click(main.getByRole("button", { name: "查看进展" }));
    expect(
      screen.getByRole("heading", { level: 1, name: "趋势，只是辅助判断" }),
    ).toBeTruthy();
  });

  it("shows conversation capture and the compact form at the same time", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(navigationButton("记录"));

    expect(container.querySelector(".capture-grid")).toBeTruthy();
    expect(container.querySelector(".conversation-card")).toBeTruthy();
    expect(container.querySelector(".form-card")).toBeTruthy();
    expect(container.querySelector(".feedback-bar")).toBeTruthy();
    expect(screen.getByLabelText("直接描述想记录的内容")).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "简洁表单" })).toBeTruthy();
    expect(screen.getByText("写一句也可以")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "日记" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "每日状态" })).toBeTruthy();
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

  it("derives the current weekday from the dashboard date", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(navigationButton("进展"));

    const current = document.querySelector('.week-path li[data-current="true"]');
    expect(current?.textContent).toContain("周一");
    expect(current?.textContent).toContain("今天");
    expect(current?.textContent).toContain("01-12");
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
    await user.click(screen.getByRole("button", { name: "保存记录" }));

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
    await user.click(screen.getByRole("button", { name: "保存记录" }));

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

  it("shows paused Google and pending mobile states as neutral copy", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(navigationButton("系统"));

    expect(screen.getByText("暂不维护")).toBeTruthy();
    expect(screen.getByText("方案待定")).toBeTruthy();
    expect(screen.getByText("已验证可读取")).toBeTruthy();
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
    await user.click(screen.getByRole("button", { name: "保存记录" }));

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
