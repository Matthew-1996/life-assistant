// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../../src/App";
import type { LifeConsoleClient } from "../../src/api/client";
import type { Dashboard } from "../../src/data/dashboard";
import type { DailyCheckinRepositoryPort } from "../../src/supabase/daily-checkins";
import type { GoalRepositoryPort } from "../../src/supabase/goals";
import type { JournalRepositoryPort } from "../../src/supabase/journals";
import type { ReviewRepositoryPort } from "../../src/supabase/reviews";
import {
  markSessionDraftActive,
  saveEncryptedDraft,
  SESSION_DRAFT_STORAGE_PREFIX,
} from "../../src/lib/draft-storage";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: memoryStorage(),
  });
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: memoryStorage(),
  });
  client.dashboard.mockReset().mockResolvedValue(dashboard);
  client.checkin.mockReset();
  client.journal.mockReset();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const dashboard: Dashboard = {
  schema_version: 1,
  generated_at: "2030-01-01T00:00:00.000Z",
  date: "2030-01-01",
  today: {
    focus: { title: "", phase_label: "尚未设置目标" },
    active_projects: [],
    suggested_action: null,
    anchors: {
      wake: null,
      body_light: null,
      life_action: null,
      wind_down: null,
    },
    daily_revision: null,
    confirmations: [],
  },
  progress: {
    ratings: Array.from({ length: 7 }, (_, index) => ({
      date: `2030-01-0${index + 1}`,
      sleep_quality: null,
      energy: null,
      mood: null,
      life_feeling: null,
    })),
    sleep: [],
    sample_counts: { daily: 0, missing: 7 },
  },
  records: { recent_journals: [] },
  system: {
    hub: "unavailable",
    icloud: "unavailable",
    automation: "unknown",
    backup: "unknown",
    google: "paused",
    mobile: "pending",
  },
  source_revisions: {},
};

const client = {
  dashboard: vi.fn(async () => dashboard),
  journal: vi.fn(),
  checkin: vi.fn(),
  preview: vi.fn(),
  enrichmentPreview: vi.fn(),
  enrichmentCommit: vi.fn(),
  enrichmentStatus: vi.fn(),
  enrichmentRetry: vi.fn(),
  enrichNow: vi.fn(),
  enrichmentByJournal: vi.fn(),
  deleteJournal: vi.fn(),
} satisfies LifeConsoleClient;

const dailyCheckins: DailyCheckinRepositoryPort = {
  get: async () => null,
  list: async () => ({ items: [], nextCursor: null }),
  create: async () => { throw new Error("not used"); },
  update: async () => { throw new Error("not used"); },
};
const goals: GoalRepositoryPort = {
  list: async () => ({ items: [], nextCursor: null }),
  create: async () => { throw new Error("not used"); },
  update: async () => { throw new Error("not used"); },
  archive: async () => { throw new Error("not used"); },
  restore: async () => { throw new Error("not used"); },
};
const journals: JournalRepositoryPort = {
  list: async () => ({ items: [], nextCursor: null }),
  listDeleted: async () => ({ items: [], nextCursor: null }),
  get: async () => null,
  revisions: async () => [],
  create: async () => { throw new Error("not used"); },
  update: async () => { throw new Error("not used"); },
  softDelete: async () => { throw new Error("not used"); },
  restore: async () => { throw new Error("not used"); },
};
const reviews: ReviewRepositoryPort = {
  listWeekly: async () => ({ items: [], nextCursor: null }),
  listPhases: async () => ({ items: [], nextCursor: null }),
  createWeekly: async () => { throw new Error("not used"); },
  createPhase: async () => { throw new Error("not used"); },
  updateWeekly: async () => { throw new Error("not used"); },
  updatePhase: async () => { throw new Error("not used"); },
};

function renderCandidate(
  mode: "supabase-candidate" | "supabase-production" = "supabase-candidate",
) {
  const signOut = vi.fn(async () => undefined);
  render(
    <App
      client={client}
      initialDashboard={dashboard}
      mode={mode}
      supabase={{
        dailyCheckins,
        goals,
        journals,
        reviews,
        session: {
          userId: "synthetic-owner",
          email: "owner@example.invalid",
          expiresAt: null,
        },
        signOut,
      }}
    />,
  );
  return { signOut };
}

describe("Supabase candidate product application", () => {
  it("ignores an older dashboard refresh that finishes after a newer one", async () => {
    const deferred: { resolve?: (value: Dashboard) => void } = {};
    const olderDashboard = structuredClone(dashboard);
    olderDashboard.date = "2030-01-02";
    const newerDashboard = structuredClone(dashboard);
    newerDashboard.date = "2030-01-03";
    client.dashboard
      .mockImplementationOnce(() => new Promise((resolve) => {
        deferred.resolve = resolve;
      }))
      .mockResolvedValueOnce(newerDashboard);
    renderCandidate();

    window.dispatchEvent(new Event("focus"));
    await screen.findByText(/2030-01-03/);
    deferred.resolve?.(olderDashboard);
    await waitFor(() => expect(client.dashboard).toHaveBeenCalledTimes(2));

    expect(screen.queryByText(/2030-01-02/)).toBeNull();
    expect(screen.queryByText(/2030-01-03/)).not.toBeNull();
  });

  it("ignores an older refresh error after a newer refresh succeeds", async () => {
    const deferred: { reject?: (reason: Error) => void } = {};
    const newerDashboard = structuredClone(dashboard);
    newerDashboard.date = "2030-01-03";
    client.dashboard
      .mockImplementationOnce(() => new Promise((_resolve, reject) => {
        deferred.reject = reject;
      }))
      .mockResolvedValueOnce(newerDashboard);
    renderCandidate();

    window.dispatchEvent(new Event("focus"));
    await screen.findByText(/2030-01-03/);
    deferred.reject?.(new Error("stale refresh failure"));
    await waitFor(() => expect(client.dashboard).toHaveBeenCalledTimes(2));

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/2030-01-03/)).not.toBeNull();
  });

  it("joins a newer successful refresh before confirming an anchor save", async () => {
    const user = userEvent.setup();
    const deferred: { resolve?: (value: Dashboard) => void } = {};
    const newerDashboard = structuredClone(dashboard);
    newerDashboard.date = "2030-01-03";
    client.dashboard
      .mockResolvedValueOnce(dashboard)
      .mockImplementationOnce(() => new Promise((resolve) => {
        deferred.resolve = resolve;
      }))
      .mockResolvedValueOnce(newerDashboard);
    client.checkin.mockResolvedValueOnce({
      request_id: "synthetic-request",
      command_id: "synthetic-command",
      action: "updated",
      source: { state: "saved", revision: 1 },
      read_model: "current",
      message: "候选状态已保存。",
    });
    renderCandidate();
    await waitFor(() => expect(client.dashboard).toHaveBeenCalledTimes(1));

    const group = screen.getByRole("group", { name: "生活动作状态" });
    await user.click(within(group).getByRole("button", { name: "完成" }));
    await waitFor(() => expect(client.dashboard).toHaveBeenCalledTimes(2));
    window.dispatchEvent(new Event("focus"));
    await screen.findByText(/2030-01-03/);
    deferred.resolve?.(dashboard);

    expect(await screen.findByText("候选状态已保存。")).toBeTruthy();
    expect(screen.queryByText(/但页面暂时无法刷新/)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("reports a write refresh failure only when the newer refresh fails", async () => {
    const user = userEvent.setup();
    const deferred: { resolve?: (value: Dashboard) => void } = {};
    client.dashboard
      .mockResolvedValueOnce(dashboard)
      .mockImplementationOnce(() => new Promise((resolve) => {
        deferred.resolve = resolve;
      }))
      .mockRejectedValueOnce(new Error("latest synthetic refresh failed"));
    client.checkin.mockResolvedValueOnce({
      request_id: "synthetic-request",
      command_id: "synthetic-command",
      action: "updated",
      source: { state: "saved", revision: 1 },
      read_model: "current",
      message: "候选状态已保存。",
    });
    renderCandidate();
    await waitFor(() => expect(client.dashboard).toHaveBeenCalledTimes(1));

    const group = screen.getByRole("group", { name: "生活动作状态" });
    await user.click(within(group).getByRole("button", { name: "完成" }));
    await waitFor(() => expect(client.dashboard).toHaveBeenCalledTimes(2));
    window.dispatchEvent(new Event("focus"));
    await screen.findByRole("alert");
    deferred.resolve?.(dashboard);

    expect(await screen.findByText(/已保存到.*但页面暂时无法刷新/)).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("私有工作台暂不可用");
  });

  it("refreshes the dynamic dashboard date when the page regains focus", async () => {
    renderCandidate();
    await waitFor(() => expect(client.dashboard).toHaveBeenCalledTimes(1));

    window.dispatchEvent(new Event("focus"));

    await waitFor(() => expect(client.dashboard).toHaveBeenCalledTimes(2));
  });

  it("refreshes the displayed Shanghai date without retired simple forms", async () => {
    const user = userEvent.setup();
    const nextDashboard = structuredClone(dashboard);
    nextDashboard.date = "2030-01-02";
    client.dashboard
      .mockResolvedValueOnce(dashboard)
      .mockResolvedValue(nextDashboard);
    renderCandidate();
    await waitFor(() => expect(client.dashboard).toHaveBeenCalledTimes(1));
    const nav = screen.getByRole("navigation", { name: "全局导航" });
    await user.click(within(nav).getByRole("button", { name: "记录" }));
    expect(screen.queryByLabelText("事件日期")).toBeNull();
    expect(screen.queryByRole("tab", { name: "每日状态" })).toBeNull();

    window.dispatchEvent(new Event("focus"));

    await waitFor(() => expect(client.dashboard).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("button", { name: /2030-01-02/ })).toBeTruthy();
  });

  it("restores a failed Today anchor draft after page navigation", async () => {
    const user = userEvent.setup();
    client.checkin.mockRejectedValueOnce(new Error("synthetic failure"));
    renderCandidate();
    const group = screen.getByRole("group", { name: "生活动作状态" });
    await user.click(within(group).getByRole("button", { name: "完成" }));
    const draft = await screen.findByRole("region", {
      name: "今日锚点未保存草稿",
    });
    expect(draft.textContent).toContain("生活动作");
    await waitFor(() => expect(localStorage.getItem(
      `${SESSION_DRAFT_STORAGE_PREFIX}synthetic-owner:today-anchor`,
    )).toBeTruthy());
    const nav = screen.getByRole("navigation", { name: "全局导航" });
    await user.click(within(nav).getByRole("button", { name: "记录" }));
    await user.click(within(nav).getByRole("button", { name: "工作台" }));

    const restored = await screen.findByRole("region", {
      name: "今日锚点未保存草稿",
    });
    expect(restored.textContent).toContain("完成");
  });

  it("retries a failed Today anchor against its original date after midnight", async () => {
    const user = userEvent.setup();
    const nextDashboard = structuredClone(dashboard);
    nextDashboard.date = "2030-01-02";
    nextDashboard.today.daily_revision = 9;
    client.dashboard
      .mockResolvedValueOnce(dashboard)
      .mockResolvedValue(nextDashboard);
    client.checkin
      .mockRejectedValueOnce(new Error("synthetic failure"))
      .mockResolvedValueOnce({
        request_id: "synthetic-request",
        command_id: "synthetic-command",
        action: "updated",
        source: { state: "saved", revision: 1 },
        read_model: "current",
        message: "候选状态已保存。",
      });
    renderCandidate();
    const group = screen.getByRole("group", { name: "生活动作状态" });
    await user.click(within(group).getByRole("button", { name: "完成" }));
    const draft = await screen.findByRole("region", {
      name: "今日锚点未保存草稿",
    });
    expect(draft.textContent).toContain("2030-01-01");

    window.dispatchEvent(new Event("focus"));
    await screen.findByText(/2030-01-02/);
    await user.click(within(draft).getByRole("button", { name: "重试保存" }));

    await waitFor(() => expect(client.checkin).toHaveBeenNthCalledWith(
      2,
      "2030-01-01",
      {
        schema_version: 1,
        expect_revision: null,
        fields: { life_action: "complete" },
      },
    ));
  });

  it("clears the persisted Today anchor draft immediately after success", async () => {
    const user = userEvent.setup();
    client.checkin.mockResolvedValueOnce({
      request_id: "synthetic-request",
      command_id: "synthetic-command",
      action: "updated",
      source: { state: "saved", revision: 1 },
      read_model: "current",
      message: "候选状态已保存。",
    });
    renderCandidate();
    const group = screen.getByRole("group", { name: "生活动作状态" });
    await user.click(within(group).getByRole("button", { name: "完成" }));
    await screen.findByText("候选状态已保存。");
    expect(localStorage.getItem(
      `${SESSION_DRAFT_STORAGE_PREFIX}synthetic-owner:today-anchor`,
    )).toBeNull();
  });

  it("does not expose historical check-in editing on the record page", async () => {
    const user = userEvent.setup();
    const historicalDate = "2029-12-31";
    const historical = {
      id: 81,
      user_id: "synthetic-owner",
      checkin_date: historicalDate,
      sleep_quality: null,
      energy: 3 as const,
      mood: null,
      life_feeling: null,
      anchors: null,
      notes: null,
      revision: 7,
      created_at: "2029-12-31T08:00:00.000Z",
      updated_at: "2029-12-31T08:00:00.000Z",
    };
    const historicalCheckins: DailyCheckinRepositoryPort = {
      ...dailyCheckins,
      get: vi.fn(async (date) => date === historicalDate ? historical : null),
    };
    const checkin = vi.fn(async () => ({
      request_id: "synthetic-request",
      command_id: "synthetic-command",
      action: "updated" as const,
      source: { state: "saved" as const, revision: 8 },
      read_model: "current" as const,
      message: "每日状态已更新到测试云端。",
    }));
    const historicalClient = { ...client, checkin };
    render(
      <App
        client={historicalClient}
        initialDashboard={dashboard}
        mode="supabase-candidate"
        supabase={{
          dailyCheckins: historicalCheckins,
          goals,
          journals,
          reviews,
          session: {
            userId: "synthetic-owner",
            email: "owner@example.invalid",
            expiresAt: null,
          },
          signOut: vi.fn(async () => undefined),
        }}
      />,
    );

    const nav = screen.getByRole("navigation", { name: "全局导航" });
    await user.click(within(nav).getByRole("button", { name: "记录" }));
    expect(screen.queryByRole("tab", { name: "每日状态" })).toBeNull();
    expect(screen.queryByLabelText("精力")).toBeNull();
    expect(historicalCheckins.get).not.toHaveBeenCalled();
    expect(checkin).not.toHaveBeenCalled();
  });

  it("guards the primary conversation form against duplicate submits while saving", async () => {
    const user = userEvent.setup();
    let release: ((value: Awaited<ReturnType<LifeConsoleClient["journal"]>>) => void)
      | undefined;
    const journal = vi.fn(() =>
      new Promise<Awaited<ReturnType<LifeConsoleClient["journal"]>>>((resolve) => {
        release = resolve;
      }));
    render(
      <App
        client={{ ...client, journal }}
        initialDashboard={dashboard}
        mode="supabase-candidate"
        supabase={{
          dailyCheckins,
          goals,
          journals,
          reviews,
          session: {
            userId: "synthetic-owner",
            email: "owner@example.invalid",
            expiresAt: null,
          },
          signOut: vi.fn(async () => undefined),
        }}
      />,
    );
    const nav = screen.getByRole("navigation", { name: "全局导航" });
    await user.click(within(nav).getByRole("button", { name: "记录" }));
    await user.type(
      screen.getByLabelText("直接描述想记录的内容"),
      "Synthetic entry",
    );
    const submit = screen.getByRole("button", { name: "保存到 Supabase 候选环境" });
    await user.click(submit);
    submit.closest("form")?.dispatchEvent(new Event("submit", {
      bubbles: true,
      cancelable: true,
    }));

    expect(journal).toHaveBeenCalledOnce();
    expect(screen.queryByText("已保存到 Supabase 候选环境")).toBeNull();
    expect((screen.getByRole("button", {
      name: "保存中…",
    }) as HTMLButtonElement).disabled).toBe(true);

    release?.({
      request_id: "synthetic-request",
      command_id: "synthetic-command",
      action: "created",
      source: { state: "saved", revision: 1 },
      read_model: "current",
      message: "日记已保存到测试云端。",
    });
    await screen.findByText("日记已保存到测试云端。");
  });

  it("restores the primary conversation draft after navigating away", async () => {
    const user = userEvent.setup();
    renderCandidate();
    const nav = screen.getByRole("navigation", { name: "全局导航" });
    await user.click(within(nav).getByRole("button", { name: "记录" }));
    await user.type(
      screen.getByLabelText("直接描述想记录的内容"),
      "Synthetic journal draft",
    );

    await user.click(within(nav).getByRole("button", { name: "系统" }));
    await user.click(within(nav).getByRole("button", { name: "记录" }));
    expect(await screen.findByDisplayValue("Synthetic journal draft")).toBeTruthy();
  });

  it("restores a main journal key after remount and resets it when the payload changes", async () => {
    const user = userEvent.setup();
    const journalWithIdempotency = vi.fn()
      .mockRejectedValueOnce(new Error("synthetic response loss"))
      .mockRejectedValueOnce(new Error("synthetic retry failure"))
      .mockResolvedValueOnce({
        request_id: "synthetic-request",
        command_id: "synthetic-command",
        action: "created" as const,
        source: { state: "saved" as const, revision: 1 },
        read_model: "current" as const,
        message: "日记原文已保存，整理完成。",
      });
    const keyedClient = { ...client, journalWithIdempotency };
    const renderKeyedCandidate = () => render(
      <App
        client={keyedClient}
        initialDashboard={dashboard}
        mode="supabase-candidate"
        supabase={{
          dailyCheckins,
          goals,
          journals,
          reviews,
          session: {
            userId: "synthetic-owner",
            email: "owner@example.invalid",
            expiresAt: null,
          },
          signOut: vi.fn(async () => undefined),
        }}
      />,
    );
    const first = renderKeyedCandidate();
    let nav = screen.getByRole("navigation", { name: "全局导航" });
    await user.click(within(nav).getByRole("button", { name: "记录" }));
    await user.type(
      screen.getByLabelText("直接描述想记录的内容"),
      "Refresh-safe journal",
    );
    await user.click(screen.getByRole("button", {
      name: "保存到 Supabase 候选环境",
    }));
    await screen.findByText("保存失败，请保留当前内容并重试");
    const firstKey = journalWithIdempotency.mock.calls[0][1];
    first.unmount();

    renderKeyedCandidate();
    nav = screen.getByRole("navigation", { name: "全局导航" });
    await user.click(within(nav).getByRole("button", { name: "记录" }));
    const input = await screen.findByDisplayValue("Refresh-safe journal");
    await user.click(screen.getByRole("button", {
      name: "保存到 Supabase 候选环境",
    }));
    await waitFor(() => expect(journalWithIdempotency).toHaveBeenCalledTimes(2));
    expect(journalWithIdempotency.mock.calls[1][1]).toBe(firstKey);

    await user.type(input, " changed");
    await user.click(screen.getByRole("button", {
      name: "保存到 Supabase 候选环境",
    }));
    await waitFor(() => expect(journalWithIdempotency).toHaveBeenCalledTimes(3));
    expect(journalWithIdempotency.mock.calls[2][1]).not.toBe(firstKey);
    await screen.findByText("日记原文已保存，整理完成。");
    expect(localStorage.getItem(
      `${SESSION_DRAFT_STORAGE_PREFIX}synthetic-owner:records-conversation-v2`,
    )).toBeNull();
  });

  it("uses the accepted 2.5 workbench and truthful service empty states", () => {
    renderCandidate();

    expect(screen.getByText("Life Console · Supabase Candidate")).toBeTruthy();
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "把重要的事情放在看得见的地方，给今天留出一段真正能完成的时间。",
      }),
    ).toBeTruthy();
    expect(screen.getByLabelText("私有候选边界").textContent).toContain(
      "生产环境",
    );
    expect(screen.getByRole("region", { name: "Todo" })).toBeTruthy();
    expect(screen.getByText("当前预览未连接 Todo 数据源。")).toBeTruthy();
    expect(screen.getByRole("region", { name: "每日新闻" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "今日锚点" })).toBeTruthy();
    expect(screen.queryByText("合成室内训练")).toBeNull();
    expect(screen.queryByText("候选环境边界")).toBeNull();
    expect(screen.queryByText(/publishable key/i)).toBeNull();
  });

  it("presents Production as the online truth source instead of a synthetic candidate", async () => {
    const user = userEvent.setup();
    renderCandidate("supabase-production");

    expect(screen.getByText("Life Console · Online")).toBeTruthy();
    expect(screen.getByLabelText("线上唯一真相源").textContent).toContain(
      "Supabase 唯一真相源",
    );
    expect(screen.getByLabelText("线上唯一真相源").textContent).toContain(
      "iCloud 单向备份",
    );
    expect(screen.queryByText(/Supabase Candidate/)).toBeNull();
    expect(screen.queryByText(/纯合成测试数据/)).toBeNull();
    expect(screen.queryByText(/ICLOUD_PRIMARY/)).toBeNull();
    await user.click(within(screen.getByRole("navigation", {
      name: "全局导航",
    })).getByRole("button", { name: "系统" }));
    expect(screen.queryByText(/PRIVATE PREVIEW/)).toBeNull();
  });

  it("keeps all four accepted product pages and puts sign-out in System", async () => {
    const user = userEvent.setup();
    const { signOut } = renderCandidate();
    const nav = screen.getByRole("navigation", { name: "全局导航" });

    await user.click(within(nav).getByRole("button", { name: "记录" }));
    expect(
      screen.getByRole("heading", { level: 1, name: "轻量记录，明确保存。" }),
    ).toBeTruthy();
    expect(screen.getByText("一句话也可以；只有明确保存成功才算已记录。")).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "日记管理与修订" })).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "复盘" })).toBeTruthy();

    await user.click(within(nav).getByRole("button", { name: "进展" }));
    expect(
      screen.getByRole("heading", { level: 1, name: "自然周路径，不惩罚空白。" }),
    ).toBeTruthy();
    expect(await screen.findByText("还没有目标")).toBeTruthy();
    expect(screen.queryByText("2+")).toBeNull();

    await user.click(within(nav).getByRole("button", { name: "系统" }));
    expect(
      screen.getByRole("heading", { level: 1, name: "Life Console 已上线，数据已迁移。" }),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: "iCloud 最新备份" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "退出登录" }));
    expect(signOut).toHaveBeenCalledOnce();
  });

  it("requires an inline confirmation before discarding a Supabase draft on sign-out", async () => {
    const user = userEvent.setup();
    const { signOut } = renderCandidate();
    const key = `${SESSION_DRAFT_STORAGE_PREFIX}synthetic-owner:manual`;
    await saveEncryptedDraft(key, { text: "Synthetic draft" });
    markSessionDraftActive(key, true);
    const nav = screen.getByRole("navigation", { name: "全局导航" });
    await user.click(within(nav).getByRole("button", { name: "系统" }));

    await user.click(screen.getByRole("button", { name: "退出登录" }));
    expect(signOut).not.toHaveBeenCalled();
    const dialog = screen.getByRole("alertdialog", { name: "确认清除未保存草稿" });
    await user.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(signOut).not.toHaveBeenCalled();
    expect(localStorage.getItem(key)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "退出登录" }));
    await user.click(screen.getByRole("button", { name: "清除草稿并退出" }));
    await waitFor(() => expect(signOut).toHaveBeenCalledOnce());
    expect(localStorage.getItem(key)).toBeNull();
  });
});
