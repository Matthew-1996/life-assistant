// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SupabaseReviewsPanel } from "../../src/features/reviews/SupabaseReviewsPanel";
import { SESSION_DRAFT_STORAGE_PREFIX } from "../../src/lib/draft-storage";
import type {
  PhaseReview,
  ReviewRepositoryPort,
  WeeklyReview,
} from "../../src/supabase/reviews";
import { RepositoryError } from "../../src/supabase/repository";

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
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: webcrypto,
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: memoryStorage(),
  });
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: memoryStorage(),
  });
});

afterEach(cleanup);

const weekly: WeeklyReview = {
  id: 51, user_id: "synthetic-owner", week_start: "2030-04-01",
  content: "Synthetic weekly", revision: 1, deleted_at: null,
  created_at: "2030-04-07T08:00:00.000Z",
  updated_at: "2030-04-07T08:00:00.000Z",
};
const phase: PhaseReview = {
  id: 61, user_id: "synthetic-owner", period_start: "2030-04-01",
  period_end: "2030-04-30", content: "Synthetic phase", revision: 1,
  deleted_at: null, created_at: "2030-05-01T08:00:00.000Z",
  updated_at: "2030-05-01T08:00:00.000Z",
};

function repository(
  weeklyRows: WeeklyReview[] = [],
  phaseRows: PhaseReview[] = [],
): ReviewRepositoryPort {
  return {
    listWeekly: vi.fn(async () => ({ items: weeklyRows, nextCursor: null })),
    listPhases: vi.fn(async () => ({ items: phaseRows, nextCursor: null })),
    createWeekly: vi.fn(async (_key, input) => ({
      ...weekly, week_start: input.weekStart, content: input.content,
    })),
    createPhase: vi.fn(async (_key, input) => ({
      ...phase, period_start: input.periodStart,
      period_end: input.periodEnd, content: input.content,
    })),
    updateWeekly: vi.fn(async (_id, revision, input) => ({
      ...weekly, revision: revision + 1,
      content: input.content ?? weekly.content,
    })),
    updatePhase: vi.fn(async (_id, revision, input) => ({
      ...phase, revision: revision + 1,
      content: input.content ?? phase.content,
    })),
  };
}

describe("Supabase Reviews panel", () => {
  it("shows real empty states after loading", async () => {
    render(<SupabaseReviewsPanel repository={repository()} />);
    expect(await screen.findByText("还没有周复盘")).toBeTruthy();
    expect(screen.getByText("还没有阶段复盘")).toBeTruthy();
  });

  it("keeps load failure distinct from empty state and retries", async () => {
    const user = userEvent.setup();
    const repo = repository();
    vi.mocked(repo.listWeekly)
      .mockRejectedValueOnce(new Error("synthetic unavailable"))
      .mockResolvedValueOnce({ items: [weekly], nextCursor: null });
    render(<SupabaseReviewsPanel repository={repo} />);

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringContaining("没有把失败误报为空记录"),
    );
    expect(screen.queryByText("还没有周复盘")).toBeNull();
    expect(screen.queryByText("还没有阶段复盘")).toBeNull();

    await user.click(screen.getByRole("button", { name: "重新加载复盘" }));
    expect(await screen.findByText("Synthetic weekly")).toBeTruthy();
    expect(repo.listWeekly).toHaveBeenCalledTimes(2);
  });

  it("loads additional weekly and phase pages with their active cursors", async () => {
    const user = userEvent.setup();
    const repo = repository();
    const olderWeekly = {
      ...weekly,
      id: 52,
      week_start: "2030-03-25",
      content: "Older synthetic weekly",
    };
    const olderPhase = {
      ...phase,
      id: 62,
      period_start: "2030-03-01",
      period_end: "2030-03-31",
      content: "Older synthetic phase",
    };
    const weeklyCursor = { sortValue: weekly.week_start, id: weekly.id };
    const phaseCursor = { sortValue: phase.period_start, id: phase.id };
    vi.mocked(repo.listWeekly)
      .mockResolvedValueOnce({ items: [weekly], nextCursor: weeklyCursor })
      .mockResolvedValueOnce({ items: [olderWeekly], nextCursor: null });
    vi.mocked(repo.listPhases)
      .mockResolvedValueOnce({ items: [phase], nextCursor: phaseCursor })
      .mockResolvedValueOnce({ items: [olderPhase], nextCursor: null });

    render(<SupabaseReviewsPanel repository={repo} />);
    await screen.findByText("Synthetic weekly");
    await user.click(screen.getByRole("button", {
      name: "加载更多周复盘",
    }));
    expect(await screen.findByText("Older synthetic weekly")).toBeTruthy();
    expect(repo.listWeekly).toHaveBeenNthCalledWith(2, {
      cursor: weeklyCursor,
    });

    await user.click(screen.getByRole("button", {
      name: "加载更多阶段复盘",
    }));
    expect(await screen.findByText("Older synthetic phase")).toBeTruthy();
    expect(repo.listPhases).toHaveBeenNthCalledWith(2, {
      cursor: phaseCursor,
    });
  });

  it("shows review periods and filters the currently loaded records", async () => {
    const user = userEvent.setup();
    const earlierWeekly = {
      ...weekly,
      id: 52,
      week_start: "2030-03-25",
      content: "Earlier weekly note",
    };
    const earlierPhase = {
      ...phase,
      id: 62,
      period_start: "2030-03-01",
      period_end: "2030-03-31",
      content: "Earlier phase note",
    };
    render(
      <SupabaseReviewsPanel
        repository={repository(
          [weekly, earlierWeekly],
          [phase, earlierPhase],
        )}
      />,
    );

    expect(await screen.findByText("周起始日：2030-04-01")).toBeTruthy();
    expect(screen.getByText("阶段：2030-04-01 — 2030-04-30")).toBeTruthy();

    await user.type(
      screen.getByLabelText("筛选已加载周复盘"),
      "2030-03-25",
    );
    expect(screen.getByText("Earlier weekly note")).toBeTruthy();
    expect(screen.queryByText("Synthetic weekly")).toBeNull();

    await user.type(
      screen.getByLabelText("筛选已加载阶段复盘"),
      "Earlier phase",
    );
    expect(screen.getByText("Earlier phase note")).toBeTruthy();
    expect(screen.queryByText("Synthetic phase")).toBeNull();
  });

  it("creates weekly and phase reviews through separate inputs", async () => {
    const user = userEvent.setup();
    const repo = repository();
    render(
      <SupabaseReviewsPanel
        createIdempotencyKey={(kind) => `synthetic-${kind}-key-0001`}
        repository={repo}
      />,
    );
    await screen.findByText("还没有周复盘");
    await user.type(screen.getByLabelText("周起始日"), "2030-04-01");
    await user.type(screen.getByLabelText("周复盘内容"), "Weekly draft");
    await user.click(screen.getByRole("button", { name: "新建周复盘" }));
    await waitFor(() => expect(repo.createWeekly).toHaveBeenCalledWith(
      "synthetic-weekly-key-0001",
      { weekStart: "2030-04-01", content: "Weekly draft" },
    ));

    await user.type(screen.getByLabelText("阶段开始日"), "2030-04-01");
    await user.type(screen.getByLabelText("阶段结束日"), "2030-04-30");
    await user.type(screen.getByLabelText("阶段复盘内容"), "Phase draft");
    await user.click(screen.getByRole("button", { name: "新建阶段复盘" }));
    await waitFor(() => expect(repo.createPhase).toHaveBeenCalledWith(
      "synthetic-phase-key-0001",
      {
        periodStart: "2030-04-01",
        periodEnd: "2030-04-30",
        content: "Phase draft",
      },
    ));
    expect(localStorage.getItem(
      `${SESSION_DRAFT_STORAGE_PREFIX}anonymous:reviews`,
    )).toBeNull();
  });

  it("does not duplicate a review returned by an idempotent create replay", async () => {
    const user = userEvent.setup();
    const repo = repository([weekly]);
    render(<SupabaseReviewsPanel repository={repo} />);
    await screen.findByText("Synthetic weekly");
    await user.type(screen.getByLabelText("周起始日"), "2030-04-08");
    await user.type(screen.getByLabelText("周复盘内容"), "Replayed weekly");
    await user.click(screen.getByRole("button", { name: "新建周复盘" }));
    expect(await screen.findByText("Replayed weekly")).toBeTruthy();
    expect(screen.queryByText("Synthetic weekly")).toBeNull();
  });

  it("shows an explicit saving state for both create operations", async () => {
    const user = userEvent.setup();
    const repo = repository();
    let releaseWeekly: ((value: WeeklyReview) => void) | undefined;
    let releasePhase: ((value: PhaseReview) => void) | undefined;
    repo.createWeekly = vi.fn(() => new Promise<WeeklyReview>((resolve) => {
      releaseWeekly = resolve;
    }));
    repo.createPhase = vi.fn(() => new Promise<PhaseReview>((resolve) => {
      releasePhase = resolve;
    }));
    render(<SupabaseReviewsPanel repository={repo} />);
    await screen.findByText("还没有周复盘");

    await user.type(screen.getByLabelText("周起始日"), "2030-04-01");
    await user.type(screen.getByLabelText("周复盘内容"), "Weekly pending");
    await user.click(screen.getByRole("button", { name: "新建周复盘" }));
    const weeklyPending = screen.getByRole("button", {
      name: "正在保存周复盘…",
    });
    expect((weeklyPending as HTMLButtonElement).disabled).toBe(true);

    releaseWeekly?.(weekly);
    await screen.findByText("Synthetic weekly");

    await user.type(screen.getByLabelText("阶段开始日"), "2030-04-01");
    await user.type(screen.getByLabelText("阶段结束日"), "2030-04-30");
    await user.type(screen.getByLabelText("阶段复盘内容"), "Phase pending");
    await user.click(screen.getByRole("button", { name: "新建阶段复盘" }));
    const phasePending = screen.getByRole("button", {
      name: "正在保存阶段复盘…",
    });
    expect((phasePending as HTMLButtonElement).disabled).toBe(true);

    releasePhase?.(phase);
    await screen.findByText("Synthetic phase");
  });

  it("updates weekly reviews with their expected revision", async () => {
    const user = userEvent.setup();
    const repo = repository([weekly]);
    render(<SupabaseReviewsPanel repository={repo} />);
    await screen.findByText("Synthetic weekly");
    await user.click(screen.getByRole("button", { name: "编辑周复盘" }));
    const input = screen.getByLabelText("编辑周复盘内容");
    await user.clear(input);
    await user.type(input, "Weekly revised");
    await user.click(screen.getByRole("button", { name: "保存周复盘" }));
    expect(repo.updateWeekly).toHaveBeenCalledWith(
      51, 1, { content: "Weekly revised" },
    );
  });

  it("disables an edit submit and shows saving while it is pending", async () => {
    const user = userEvent.setup();
    const repo = repository([weekly]);
    let release: ((value: WeeklyReview) => void) | undefined;
    repo.updateWeekly = vi.fn(() => new Promise<WeeklyReview>((resolve) => {
      release = resolve;
    }));
    render(<SupabaseReviewsPanel repository={repo} />);
    await screen.findByText("Synthetic weekly");
    await user.click(screen.getByRole("button", { name: "编辑周复盘" }));
    await user.click(screen.getByRole("button", { name: "保存周复盘" }));

    const pending = screen.getByRole("button", { name: "正在保存周复盘…" });
    expect((pending as HTMLButtonElement).disabled).toBe(true);
    expect(repo.updateWeekly).toHaveBeenCalledOnce();

    release?.({ ...weekly, revision: 2 });
    await waitFor(() => {
      expect(screen.queryByRole("button", {
        name: "正在保存周复盘…",
      })).toBeNull();
    });
  });

  it("retains phase input after a revision conflict", async () => {
    const user = userEvent.setup();
    const repo = repository([], [phase]);
    repo.updatePhase = vi.fn(async () => {
      throw new RepositoryError(
        "conflict", 409, "revision_conflict", "synthetic conflict",
      );
    });
    render(<SupabaseReviewsPanel repository={repo} />);
    await screen.findByText("Synthetic phase");
    await user.click(screen.getByRole("button", { name: "编辑阶段复盘" }));
    const input = screen.getByLabelText("编辑阶段复盘内容");
    await user.clear(input);
    await user.type(input, "Conflicting phase draft");
    await user.click(screen.getByRole("button", { name: "保存阶段复盘" }));
    expect((input as HTMLTextAreaElement).value).toBe(
      "Conflicting phase draft",
    );
    expect(
      screen.getByRole("region", { name: "复盘已在其他页面更新" }),
    ).toBeTruthy();
  });

  it("loads the latest conflicted review and can restore the retained draft", async () => {
    const user = userEvent.setup();
    const repo = repository([], [phase]);
    const latestPhase = {
      ...phase,
      content: "Latest server phase",
      revision: 2,
      updated_at: "2030-05-01T09:00:00.000Z",
    };
    vi.mocked(repo.listPhases)
      .mockResolvedValueOnce({ items: [phase], nextCursor: null })
      .mockResolvedValueOnce({ items: [latestPhase], nextCursor: null })
      .mockResolvedValue({ items: [latestPhase], nextCursor: null });
    vi.mocked(repo.updatePhase)
      .mockRejectedValueOnce(new RepositoryError(
        "conflict", 409, "revision_conflict", "synthetic conflict",
      ))
      .mockResolvedValueOnce({
        ...latestPhase,
        content: "My retained phase draft",
        revision: 3,
      });
    const view = render(<SupabaseReviewsPanel repository={repo} />);
    await screen.findByText("Synthetic phase");
    await user.click(screen.getByRole("button", { name: "编辑阶段复盘" }));
    const edit = screen.getByLabelText("编辑阶段复盘内容");
    await user.clear(edit);
    await user.type(edit, "My retained phase draft");
    await user.click(screen.getByRole("button", { name: "保存阶段复盘" }));

    expect(await screen.findByLabelText("冲突前草稿")).toHaveProperty(
      "value",
      "My retained phase draft",
    );
    await user.click(screen.getByRole("button", { name: "载入最新" }));
    await waitFor(() => {
      expect(screen.getByLabelText("服务器最新内容")).toHaveProperty(
        "value",
        "Latest server phase",
      );
    });
    expect(edit).toHaveProperty("value", "My retained phase draft");
    expect(screen.getByLabelText("冲突前草稿")).toHaveProperty(
      "value",
      "My retained phase draft",
    );

    await waitFor(() => expect(localStorage.length).toBeGreaterThan(0));
    view.unmount();
    render(<SupabaseReviewsPanel repository={repo} />);
    const restoredEdit = await screen.findByLabelText("编辑阶段复盘内容");
    expect(restoredEdit).toHaveProperty("value", "My retained phase draft");
    expect(screen.getByLabelText("服务器最新内容")).toHaveProperty(
      "value",
      "Latest server phase",
    );

    await user.click(screen.getByRole("button", {
      name: "恢复冲突前草稿",
    }));
    expect(restoredEdit).toHaveProperty("value", "My retained phase draft");
    await user.click(screen.getByRole("button", { name: "保存阶段复盘" }));
    expect(repo.updatePhase).toHaveBeenNthCalledWith(
      2,
      phase.id,
      2,
      { content: "My retained phase draft" },
    );
  });

  it("reuses the weekly idempotency key after failure", async () => {
    const user = userEvent.setup();
    const repo = repository();
    repo.createWeekly = vi.fn()
      .mockRejectedValueOnce(new RepositoryError(
        "transient", 503, "PGRST000", "unavailable",
      ))
      .mockResolvedValueOnce(weekly);
    const key = vi.fn(() => "synthetic-weekly-key-0002");
    render(
      <SupabaseReviewsPanel
        createIdempotencyKey={key}
        repository={repo}
      />,
    );
    await screen.findByText("还没有周复盘");
    await user.type(screen.getByLabelText("周起始日"), "2030-04-01");
    await user.type(screen.getByLabelText("周复盘内容"), "Weekly retry");
    await user.click(screen.getByRole("button", { name: "新建周复盘" }));
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "新建周复盘" }));
    expect(repo.createWeekly).toHaveBeenCalledTimes(2);
    expect(key).toHaveBeenCalledOnce();
  });

  it("restores a failed weekly request and reuses its key after remount", async () => {
    const user = userEvent.setup();
    const repo = repository();
    repo.createWeekly = vi.fn(async () => {
      throw new RepositoryError(
        "transient", 503, "PGRST000", "unavailable",
      );
    });
    const key = vi.fn(() => "synthetic-weekly-key-remount");
    const first = render(
      <SupabaseReviewsPanel
        createIdempotencyKey={key}
        draftScope="synthetic-owner"
        repository={repo}
      />,
    );
    await screen.findByText("还没有周复盘");
    await user.type(screen.getByLabelText("周起始日"), "2030-04-01");
    await user.type(screen.getByLabelText("周复盘内容"), "Weekly retry after navigation");
    await user.click(screen.getByRole("button", { name: "新建周复盘" }));
    await screen.findByRole("alert");
    await waitFor(() => expect(localStorage.length).toBeGreaterThan(0));
    first.unmount();

    render(
      <SupabaseReviewsPanel
        createIdempotencyKey={key}
        draftScope="synthetic-owner"
        repository={repo}
      />,
    );
    expect(await screen.findByDisplayValue("Weekly retry after navigation")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "新建周复盘" }));
    await waitFor(() => expect(repo.createWeekly).toHaveBeenNthCalledWith(
      2,
      "synthetic-weekly-key-remount",
      expect.any(Object),
    ));
    expect(key).toHaveBeenCalledOnce();
  });

  it("restores a failed phase request and reuses its key after remount", async () => {
    const user = userEvent.setup();
    const repo = repository();
    repo.createPhase = vi.fn(async () => {
      throw new RepositoryError(
        "transient", 503, "PGRST000", "unavailable",
      );
    });
    const key = vi.fn(() => "synthetic-phase-key-remount");
    const first = render(
      <SupabaseReviewsPanel
        createIdempotencyKey={key}
        draftScope="synthetic-owner"
        repository={repo}
      />,
    );
    await screen.findByText("还没有阶段复盘");
    await user.type(screen.getByLabelText("阶段开始日"), "2030-04-01");
    await user.type(screen.getByLabelText("阶段结束日"), "2030-04-30");
    await user.type(
      screen.getByLabelText("阶段复盘内容"),
      "Phase retry after navigation",
    );
    await user.click(screen.getByRole("button", { name: "新建阶段复盘" }));
    await screen.findByRole("alert");
    await waitFor(() => expect(localStorage.length).toBeGreaterThan(0));
    first.unmount();

    render(
      <SupabaseReviewsPanel
        createIdempotencyKey={key}
        draftScope="synthetic-owner"
        repository={repo}
      />,
    );
    expect(await screen.findByDisplayValue(
      "Phase retry after navigation",
    )).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "新建阶段复盘" }));
    await waitFor(() => expect(repo.createPhase).toHaveBeenNthCalledWith(
      2,
      "synthetic-phase-key-remount",
      expect.any(Object),
    ));
    expect(key).toHaveBeenCalledOnce();
  });
});
