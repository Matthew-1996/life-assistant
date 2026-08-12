// @vitest-environment jsdom

import {
  cleanup,
  render,
  screen,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SupabaseDailyCheckinPanel,
} from "../../src/features/checkins/SupabaseDailyCheckinPanel";
import type {
  DailyCheckin,
  DailyCheckinRepositoryPort,
} from "../../src/supabase/daily-checkins";
import { RepositoryError } from "../../src/supabase/repository";

afterEach(() => {
  cleanup();
});

const syntheticCheckin: DailyCheckin = {
  id: 21,
  user_id: "synthetic-owner",
  checkin_date: "2030-02-01",
  sleep_quality: 4,
  energy: 3,
  mood: null,
  life_feeling: 4,
  anchors: { life_action: "minimum" },
  notes: null,
  revision: 1,
  created_at: "2030-02-01T08:00:00.000Z",
  updated_at: "2030-02-01T08:00:00.000Z",
};

function createRepository(
  checkin: DailyCheckin | null = null,
): DailyCheckinRepositoryPort {
  return {
    get: vi.fn(async () => checkin),
    list: vi.fn(async () => ({ items: [], nextCursor: null })),
    create: vi.fn(async (_key, input) => ({
      ...syntheticCheckin,
      checkin_date: input.date,
      energy: input.energy ?? null,
      anchors: input.anchors ?? null,
    })),
    update: vi.fn(async (id, revision, fields) => ({
      ...syntheticCheckin,
      id,
      revision: revision + 1,
      mood: fields.mood ?? syntheticCheckin.mood,
    })),
  };
}

describe("Supabase Daily Check-in panel", () => {
  it("shows loading before an empty form with unknown values", async () => {
    let resolveGet:
      | ((checkin: DailyCheckin | null) => void)
      | undefined;
    const repository = createRepository();
    repository.get = vi.fn(
      () =>
        new Promise<DailyCheckin | null>((resolve) => {
          resolveGet = resolve;
        }),
    );

    render(
      <SupabaseDailyCheckinPanel
        date="2030-02-01"
        repository={repository}
      />,
    );

    expect(screen.getByRole("status").textContent).toContain(
      "正在读取每日状态",
    );
    resolveGet?.(null);
    expect(await screen.findByText("这一天还没有状态记录")).toBeTruthy();
    expect(
      (screen.getByLabelText("精力") as HTMLSelectElement).value,
    ).toBe("");
  });

  it("creates with only explicitly selected fields", async () => {
    const user = userEvent.setup();
    const repository = createRepository();
    render(
      <SupabaseDailyCheckinPanel
        createIdempotencyKey={() => "synthetic-checkin-key-0001"}
        date="2030-02-01"
        repository={repository}
      />,
    );
    await screen.findByText("这一天还没有状态记录");

    await user.selectOptions(screen.getByLabelText("精力"), "4");
    await user.click(screen.getByRole("button", { name: "保存每日状态" }));

    expect(repository.create).toHaveBeenCalledWith(
      "synthetic-checkin-key-0001",
      {
        date: "2030-02-01",
        energy: 4,
      },
    );
    expect(screen.getByRole("status").textContent).toContain(
      "每日状态已保存",
    );
  });

  it("updates only dirty fields on an existing revision", async () => {
    const user = userEvent.setup();
    const repository = createRepository(syntheticCheckin);
    render(
      <SupabaseDailyCheckinPanel
        date="2030-02-01"
        repository={repository}
      />,
    );
    await screen.findByText("已读取 revision #1");

    await user.selectOptions(screen.getByLabelText("情绪"), "4");
    await user.click(screen.getByRole("button", { name: "保存每日状态" }));

    expect(repository.update).toHaveBeenCalledWith(21, 1, { mood: 4 });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("retains dirty values when a revision conflict occurs", async () => {
    const user = userEvent.setup();
    const repository = createRepository(syntheticCheckin);
    repository.update = vi.fn(async () => {
      throw new RepositoryError(
        "conflict",
        409,
        "revision_conflict",
        "synthetic conflict",
      );
    });
    render(
      <SupabaseDailyCheckinPanel
        date="2030-02-01"
        repository={repository}
      />,
    );
    await screen.findByText("已读取 revision #1");

    await user.selectOptions(screen.getByLabelText("情绪"), "5");
    await user.click(screen.getByRole("button", { name: "保存每日状态" }));

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringContaining("记录已在其他页面更新"),
    );
    expect(
      (screen.getByLabelText("情绪") as HTMLSelectElement).value,
    ).toBe("5");
  });

  it("reuses one create key after failure and retains input", async () => {
    const user = userEvent.setup();
    const repository = createRepository();
    repository.create = vi.fn()
      .mockRejectedValueOnce(
        new RepositoryError(
          "transient",
          503,
          "PGRST000",
          "synthetic unavailable",
        ),
      )
      .mockResolvedValueOnce({
        ...syntheticCheckin,
        energy: 4,
      });
    const createIdempotencyKey = vi.fn(
      () => "synthetic-checkin-key-0002",
    );
    render(
      <SupabaseDailyCheckinPanel
        createIdempotencyKey={createIdempotencyKey}
        date="2030-02-01"
        repository={repository}
      />,
    );
    await screen.findByText("这一天还没有状态记录");

    await user.selectOptions(screen.getByLabelText("精力"), "4");
    await user.click(screen.getByRole("button", { name: "保存每日状态" }));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringContaining("尚未保存"),
    );
    expect(
      (screen.getByLabelText("精力") as HTMLSelectElement).value,
    ).toBe("4");

    await user.click(screen.getByRole("button", { name: "保存每日状态" }));
    expect(repository.create).toHaveBeenCalledTimes(2);
    expect(repository.create).toHaveBeenNthCalledWith(
      1,
      "synthetic-checkin-key-0002",
      expect.any(Object),
    );
    expect(repository.create).toHaveBeenNthCalledWith(
      2,
      "synthetic-checkin-key-0002",
      expect.any(Object),
    );
    expect(createIdempotencyKey).toHaveBeenCalledOnce();
  });

  it("does not submit unknown values until the user changes a field", async () => {
    const user = userEvent.setup();
    const repository = createRepository();
    render(
      <SupabaseDailyCheckinPanel
        date="2030-02-01"
        repository={repository}
      />,
    );
    await screen.findByText("这一天还没有状态记录");

    await user.click(screen.getByRole("button", { name: "保存每日状态" }));

    expect(repository.create).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toContain(
      "请先填写至少一项",
    );
  });

  it("submits the approved anchor map as one explicit field", async () => {
    const user = userEvent.setup();
    const repository = createRepository();
    render(
      <SupabaseDailyCheckinPanel
        createIdempotencyKey={() => "synthetic-checkin-key-0003"}
        date="2030-02-01"
        repository={repository}
      />,
    );
    await screen.findByText("这一天还没有状态记录");

    await user.selectOptions(
      screen.getByLabelText("生活动作"),
      "minimum",
    );
    await user.click(screen.getByRole("button", { name: "保存每日状态" }));

    expect(repository.create).toHaveBeenCalledWith(
      "synthetic-checkin-key-0003",
      {
        anchors: { life_action: "minimum" },
        date: "2030-02-01",
      },
    );
  });
});
