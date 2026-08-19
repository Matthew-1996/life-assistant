import { describe, expect, it, vi } from "vitest";

import { ApiError } from "../../src/api/client";
import {
  createSupabaseDashboardClient,
  type SupabaseDashboardClientOptions,
} from "../../src/supabase/dashboard";
import type {
  DailyCheckin,
  DailyCheckinRepositoryPort,
} from "../../src/supabase/daily-checkins";
import type { Goal, GoalRepositoryPort } from "../../src/supabase/goals";
import type {
  Journal,
  JournalNormalizationRepositoryPort,
  JournalRepositoryPort,
} from "../../src/supabase/journals";
import { RepositoryError } from "../../src/supabase/repository";

function checkin(
  overrides: Partial<DailyCheckin> = {},
): DailyCheckin {
  return {
    id: 11,
    user_id: "synthetic-owner",
    checkin_date: "2030-04-03",
    sleep_quality: 3,
    energy: 4,
    mood: null,
    life_feeling: 4,
    anchors: { wake: "complete" },
    notes: null,
    revision: 1,
    created_at: "2030-04-03T08:00:00.000Z",
    updated_at: "2030-04-03T08:00:00.000Z",
    ...overrides,
  };
}

function goal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: 21,
    user_id: "synthetic-owner",
    title: "Synthetic active goal",
    domain: "Recovery",
    status: "active",
    priority: 2,
    start_date: "2030-04-01",
    target_date: "2030-04-30",
    revision: 1,
    deleted_at: null,
    created_at: "2030-04-01T08:00:00.000Z",
    updated_at: "2030-04-01T08:00:00.000Z",
    ...overrides,
  };
}

function journal(overrides: Partial<Journal> = {}): Journal {
  return {
    id: 31,
    user_id: "synthetic-owner",
    event_date: "2030-04-02",
    title: "Synthetic journal",
    content: "Synthetic journal content",
    tags: [],
    revision: 1,
    deleted_at: null,
    created_at: "2030-04-02T08:00:00.000Z",
    updated_at: "2030-04-02T08:00:00.000Z",
    ...overrides,
  };
}

function repositories({
  dailyRows = [],
  today = null,
  goalRows = [],
  journalRows = [],
}: {
  dailyRows?: DailyCheckin[];
  today?: DailyCheckin | null;
  goalRows?: Goal[];
  journalRows?: Journal[];
} = {}) {
  const dailyCheckins: DailyCheckinRepositoryPort = {
    get: vi.fn(async () => today),
    list: vi.fn(async () => ({ items: dailyRows, nextCursor: null })),
    create: vi.fn(async () => {
      throw new Error("not configured");
    }),
    update: vi.fn(async () => {
      throw new Error("not configured");
    }),
  };
  const goals: GoalRepositoryPort = {
    list: vi.fn(async () => ({ items: goalRows, nextCursor: null })),
    create: vi.fn(async () => {
      throw new Error("not used");
    }),
    update: vi.fn(async () => {
      throw new Error("not used");
    }),
    archive: vi.fn(async () => {
      throw new Error("not used");
    }),
    restore: vi.fn(async () => {
      throw new Error("not used");
    }),
  };
  const journals: JournalRepositoryPort = {
    list: vi.fn(async () => ({ items: journalRows, nextCursor: null })),
    listDeleted: vi.fn(async () => ({ items: [], nextCursor: null })),
    get: vi.fn(async () => null),
    revisions: vi.fn(async () => []),
    create: vi.fn(async () => {
      throw new Error("not configured");
    }),
    update: vi.fn(async () => {
      throw new Error("not used");
    }),
    softDelete: vi.fn(async () => {
      throw new Error("not used");
    }),
    restore: vi.fn(async () => {
      throw new Error("not used");
    }),
  };
  return { dailyCheckins, goals, journals };
}

function clientOptions(
  repos: ReturnType<typeof repositories>,
): SupabaseDashboardClientOptions {
  return {
    date: "2030-04-03",
    ...repos,
    now: () => new Date("2030-04-03T09:30:00.000Z"),
    createIdempotencyKey: () => "synthetic-adapter-key-0001",
    createOperationId: () => "synthetic-operation-0001",
  };
}

describe("Supabase dashboard client adapter", () => {
  it("builds a genuine empty natural-week dashboard without fixture content", async () => {
    const repos = repositories();
    const client = createSupabaseDashboardClient(clientOptions(repos));

    const dashboard = await client.dashboard();

    expect(repos.dailyCheckins.list).toHaveBeenCalledWith({ pageSize: 31 });
    expect(repos.dailyCheckins.get).toHaveBeenCalledWith("2030-04-03");
    expect(repos.goals.list).toHaveBeenCalledWith({ pageSize: 100 });
    expect(repos.journals.list).toHaveBeenCalledWith({ pageSize: 10 });
    expect(dashboard.generated_at).toBe("2030-04-03T09:30:00.000Z");
    expect(dashboard.today).toEqual(expect.objectContaining({
      active_projects: [],
      suggested_action: null,
      anchors: {
        wake: null,
        body_light: null,
        life_action: null,
        wind_down: null,
      },
      daily_revision: null,
    }));
    expect(dashboard.progress.ratings.map((item) => item.date)).toEqual([
      "2030-04-01",
      "2030-04-02",
      "2030-04-03",
      "2030-04-04",
      "2030-04-05",
      "2030-04-06",
      "2030-04-07",
    ]);
    expect(dashboard.progress.ratings.every((item) =>
      item.sleep_quality === null
      && item.energy === null
      && item.mood === null
      && item.life_feeling === null
    )).toBe(true);
    expect(dashboard.progress.sleep).toEqual([]);
    expect(dashboard.progress.sample_counts).toEqual({ daily: 0, missing: 7 });
    expect(dashboard.records.recent_journals).toEqual([]);
    expect(dashboard.system.icloud).toBe("unavailable");
    expect(dashboard.system.backup).toBe("unknown");
    expect(JSON.stringify(dashboard)).not.toContain("合成室内训练");
  });

  it("continues goal pagination before deciding that Today has no active goal", async () => {
    const repos = repositories();
    const cursor = {
      id: 80,
      sortValue: "2030-03-01T08:00:00.000Z",
    };
    repos.goals.list = vi.fn(async (options) => options?.cursor
      ? {
        items: [goal({ id: 79, title: "Active goal on page two" })],
        nextCursor: null,
      }
      : {
        items: [goal({ id: 80, status: "completed" })],
        nextCursor: cursor,
      });
    const client = createSupabaseDashboardClient(clientOptions(repos));

    const dashboard = await client.dashboard();

    expect(repos.goals.list).toHaveBeenNthCalledWith(1, { pageSize: 100 });
    expect(repos.goals.list).toHaveBeenNthCalledWith(2, {
      pageSize: 100,
      cursor,
    });
    expect(dashboard.today.focus.title).toBe("Active goal on page two");
    expect(dashboard.today.active_projects).toHaveLength(1);
  });

  it("maps actual check-ins, active goals, and journals deterministically", async () => {
    const current = checkin({
      anchors: { wake: "complete", life_action: "minimum" },
      mood: 5,
      revision: 4,
    });
    const monday = checkin({
      id: 10,
      checkin_date: "2030-04-01",
      sleep_quality: 2,
      energy: null,
      mood: 3,
      life_feeling: null,
    });
    const repos = repositories({
      dailyRows: [current, monday],
      today: current,
      goalRows: [
        goal({ id: 22, title: "Second priority", priority: 2 }),
        goal({
          id: 23,
          title: "First priority",
          domain: null,
          priority: 1,
          start_date: null,
          target_date: null,
        }),
        goal({ id: 24, title: "Draft is hidden", status: "draft" }),
      ],
      journalRows: [
        journal({ id: 31, event_date: "2030-04-02" }),
        journal({
          id: 32,
          event_date: "2030-04-02",
          title: null,
          content: "  Newest\n\nentry with deterministic whitespace.  ",
          updated_at: "2030-04-03T08:00:00.000Z",
        }),
      ],
    });
    const client = createSupabaseDashboardClient(clientOptions(repos));

    const dashboard = await client.dashboard();

    expect(dashboard.today.focus).toEqual({
      title: "First priority",
      phase_label: "进行中",
    });
    expect(dashboard.today.active_projects.map((item) => item.title)).toEqual([
      "First priority",
      "Second priority",
    ]);
    expect(dashboard.today.active_projects[0]).toEqual(expect.objectContaining({
      period: "日期未设置",
      summary: "领域未设置",
    }));
    expect(dashboard.today.anchors).toEqual({
      wake: "complete",
      body_light: null,
      life_action: "minimum",
      wind_down: null,
    });
    expect(dashboard.today.daily_revision).toBe(4);
    expect(dashboard.progress.ratings[0]).toEqual({
      date: "2030-04-01",
      sleep_quality: 2,
      energy: null,
      mood: 3,
      life_feeling: null,
    });
    expect(dashboard.progress.sample_counts).toEqual({ daily: 2, missing: 5 });
    expect(dashboard.records.recent_journals[0]).toEqual(expect.objectContaining({
      id: "32",
      title: "待整理日记",
      summary: "原文已保存，尚未按统一契约整理。",
    }));
  });

  it("creates journals with a fresh idempotency key", async () => {
    const repos = repositories();
    const createKey = vi.fn(() => "synthetic-journal-key-0001");
    repos.journals.create = vi.fn(async (_key, input) => journal({
      title: input.title ?? null,
      event_date: input.date,
      content: input.content,
      tags: input.tags ?? [],
      revision: 1,
    }));
    const client = createSupabaseDashboardClient({
      ...clientOptions(repos),
      createIdempotencyKey: createKey,
    });

    const receipt = await client.journal({
      schema_version: 1,
      event_date: "2030-04-03",
      event_time: null,
      time_precision: "unknown",
      text: "Synthetic journal body",
      title: "Synthetic journal title",
      tags: ["synthetic"],
    });

    expect(repos.journals.create).toHaveBeenCalledWith(
      "synthetic-journal-key-0001",
      {
        date: "2030-04-03",
        title: "Synthetic journal title",
        content: "Synthetic journal body",
        tags: ["synthetic"],
      },
    );
    expect(createKey).toHaveBeenCalledOnce();
    expect(receipt).toEqual(expect.objectContaining({
      action: "created",
      source: { state: "saved", revision: 1 },
      read_model: "current",
    }));
  });

  it("saves raw before starting fallback normalization and reports its state", async () => {
    const repos = repositories();
    let releaseRaw: ((value: Journal) => void) | undefined;
    const createRaw = vi.fn(() => new Promise<Journal>((resolve) => {
      releaseRaw = resolve;
    }));
    (repos.journals as JournalNormalizationRepositoryPort).createRaw = createRaw;
    const normalizeJournal = vi.fn(async () => "completed" as const);
    const client = createSupabaseDashboardClient({
      ...clientOptions(repos),
      normalizeJournal,
    });
    const input = {
      schema_version: 1 as const,
      event_date: "2030-04-03",
      event_time: null,
      time_precision: "unknown" as const,
      text: "Raw-first synthetic journal",
      tags: [],
    };

    const pending = client.journalWithIdempotency(
      input,
      "synthetic-persisted-key",
    );
    expect(createRaw).toHaveBeenCalledWith("synthetic-persisted-key", {
      recordKey: "synthetic-persisted-key",
      date: "2030-04-03",
      eventTime: null,
      timePrecision: "unknown",
      source: "life_console",
      privacy: "owner-only",
      content: "Raw-first synthetic journal",
    });
    expect(normalizeJournal).not.toHaveBeenCalled();

    releaseRaw?.(journal({
      content: input.text,
      raw_revision: 1,
      normalization_status: "pending",
    }));
    const receipt = await pending;
    expect(normalizeJournal).toHaveBeenCalledWith({
      journalId: 31,
      sourceRevision: 1,
      taskKey: "journal:31:revision:1:deepseek",
    });
    expect(receipt.message).toBe("日记原文已保存，整理完成。");
  });

  it("keeps the raw save successful when fallback normalization fails", async () => {
    const repos = repositories();
    (repos.journals as JournalNormalizationRepositoryPort).createRaw = vi.fn(
      async () => journal({ raw_revision: 1, normalization_status: "pending" }),
    );
    const client = createSupabaseDashboardClient({
      ...clientOptions(repos),
      normalizeJournal: vi.fn(async () => "failed" as const),
    });

    const receipt = await client.journalWithIdempotency({
      schema_version: 1,
      event_date: "2030-04-03",
      event_time: null,
      time_precision: "unknown",
      text: "Synthetic provider failure",
      tags: [],
    }, "synthetic-persisted-key");

    expect(receipt.source.state).toBe("saved");
    expect(receipt.message).toBe("日记原文已保存；整理失败，可稍后重试。");
  });

  it("reuses a journal idempotency key after failure and releases it after success", async () => {
    const repos = repositories();
    const createKey = vi.fn()
      .mockReturnValueOnce("synthetic-journal-key-retry")
      .mockReturnValueOnce("synthetic-journal-key-after-success");
    repos.journals.create = vi.fn()
      .mockRejectedValueOnce(
        new RepositoryError(
          "transient",
          503,
          "PGRST000",
          "synthetic unavailable",
        ),
      )
      .mockResolvedValue(journal());
    const client = createSupabaseDashboardClient({
      ...clientOptions(repos),
      createIdempotencyKey: createKey,
    });
    const input = {
      schema_version: 1 as const,
      event_date: "2030-04-03",
      event_time: null,
      time_precision: "unknown" as const,
      text: "Retry-safe synthetic journal",
      title: "Retry-safe synthetic journal",
      tags: ["synthetic"],
    };

    await expect(client.journal(input)).rejects.toMatchObject({ status: 503 });
    await client.journal(input);
    await client.journal(input);

    expect(repos.journals.create).toHaveBeenCalledTimes(3);
    expect(repos.journals.create).toHaveBeenNthCalledWith(
      1,
      "synthetic-journal-key-retry",
      expect.any(Object),
    );
    expect(repos.journals.create).toHaveBeenNthCalledWith(
      2,
      "synthetic-journal-key-retry",
      expect.any(Object),
    );
    expect(repos.journals.create).toHaveBeenNthCalledWith(
      3,
      "synthetic-journal-key-after-success",
      expect.any(Object),
    );
    expect(createKey).toHaveBeenCalledTimes(2);
  });

  it("coalesces concurrent identical journal writes onto one idempotent operation", async () => {
    const repos = repositories();
    const createKey = vi.fn(() => "synthetic-journal-key-concurrent");
    let release: ((value: Journal) => void) | undefined;
    repos.journals.create = vi.fn(
      () => new Promise<Journal>((resolve) => {
        release = resolve;
      }),
    );
    const client = createSupabaseDashboardClient({
      ...clientOptions(repos),
      createIdempotencyKey: createKey,
    });
    const input = {
      schema_version: 1 as const,
      event_date: "2030-04-03",
      event_time: null,
      time_precision: "unknown" as const,
      text: "Concurrent synthetic journal",
      tags: [],
    };

    const first = client.journal(input);
    const second = client.journal(input);
    expect(repos.journals.create).toHaveBeenCalledOnce();
    expect(createKey).toHaveBeenCalledOnce();
    release?.(journal({ content: input.text }));

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
  });

  it("accepts a caller-persisted journal key across client recreation", async () => {
    const repos = repositories();
    repos.journals.create = vi.fn()
      .mockRejectedValueOnce(new RepositoryError(
        "transient", 503, "PGRST000", "synthetic response loss",
      ))
      .mockResolvedValueOnce(journal());
    const input = {
      schema_version: 1 as const,
      event_date: "2030-04-03",
      event_time: null,
      time_precision: "unknown" as const,
      text: "Refresh-safe synthetic journal",
      tags: [],
    };
    const first = createSupabaseDashboardClient(clientOptions(repos));
    await expect(first.journalWithIdempotency(
      input,
      "synthetic-persisted-key",
    )).rejects.toMatchObject({ status: 503 });
    const recreated = createSupabaseDashboardClient(clientOptions(repos));
    await recreated.journalWithIdempotency(input, "synthetic-persisted-key");

    expect(repos.journals.create).toHaveBeenNthCalledWith(
      1, "synthetic-persisted-key", expect.any(Object),
    );
    expect(repos.journals.create).toHaveBeenNthCalledWith(
      2, "synthetic-persisted-key", expect.any(Object),
    );
  });

  it("resolves the Shanghai dashboard date again for every refresh", async () => {
    const repos = repositories();
    let currentDate = "2030-04-03";
    const dateProvider = vi.fn(() => currentDate);
    const client = createSupabaseDashboardClient({
      ...clientOptions(repos),
      date: undefined,
      dateProvider,
    });

    expect((await client.dashboard()).date).toBe("2030-04-03");
    currentDate = "2030-04-04";
    expect((await client.dashboard()).date).toBe("2030-04-04");

    expect(repos.dailyCheckins.get).toHaveBeenNthCalledWith(1, "2030-04-03");
    expect(repos.dailyCheckins.get).toHaveBeenNthCalledWith(2, "2030-04-04");
    expect(dateProvider).toHaveBeenCalledTimes(2);
  });

  it("creates a daily check-in and maps approved fields", async () => {
    const repos = repositories();
    repos.dailyCheckins.create = vi.fn(async (_key, input) => checkin({
      checkin_date: input.date,
      sleep_quality: input.sleepQuality as 4,
      mood: input.mood as 5,
      anchors: input.anchors ?? null,
      notes: input.notes ?? null,
    }));
    const client = createSupabaseDashboardClient(clientOptions(repos));

    const receipt = await client.checkin("2030-04-03", {
      schema_version: 1,
      expect_revision: null,
      fields: {
        sleep_quality: 4,
        mood: 5,
        life_action: "minimum",
        note_summary: "Synthetic note",
      },
    });

    expect(repos.dailyCheckins.create).toHaveBeenCalledWith(
      "synthetic-adapter-key-0001",
      {
        date: "2030-04-03",
        sleepQuality: 4,
        mood: 5,
        anchors: { life_action: "minimum" },
        notes: "Synthetic note",
      },
    );
    expect(receipt.action).toBe("created");
  });

  it("updates a daily check-in by revision and preserves existing anchors", async () => {
    const current = checkin({
      anchors: { wake: "complete", body_light: "minimum" },
      revision: 3,
    });
    const repos = repositories({ today: current });
    repos.dailyCheckins.update = vi.fn(async (_id, revision, fields) => checkin({
      ...current,
      energy: fields.energy as 5,
      anchors: fields.anchors ?? current.anchors,
      revision: revision + 1,
    }));
    const client = createSupabaseDashboardClient(clientOptions(repos));

    const receipt = await client.checkin("2030-04-03", {
      schema_version: 1,
      expect_revision: 3,
      fields: { energy: 5, wind_down: "skipped" },
    });

    expect(repos.dailyCheckins.update).toHaveBeenCalledWith(11, 3, {
      energy: 5,
      anchors: {
        wake: "complete",
        body_light: "minimum",
        wind_down: "skipped",
      },
    });
    expect(receipt).toEqual(expect.objectContaining({
      action: "updated",
      source: { state: "saved", revision: 4 },
    }));
  });

  it("maps a repository revision conflict to ApiError with latest values", async () => {
    const current = checkin({ mood: 3, revision: 1 });
    const latest = checkin({ mood: 5, revision: 2 });
    const repos = repositories({ today: current });
    repos.dailyCheckins.get = vi.fn()
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce(latest);
    repos.dailyCheckins.update = vi.fn(async () => {
      throw new RepositoryError(
        "conflict",
        409,
        "revision_conflict",
        "synthetic conflict",
      );
    });
    const client = createSupabaseDashboardClient(clientOptions(repos));

    let failure: unknown;
    try {
      await client.checkin("2030-04-03", {
        schema_version: 1,
        expect_revision: 1,
        fields: { mood: 4 },
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(ApiError);
    const error = failure as ApiError;
    expect(error.status).toBe(409);
    expect(error.response.error.code).toBe("REVISION_CONFLICT");
    expect(error.response.conflict).toEqual(expect.objectContaining({
      target_key: "2030-04-03",
      current_revision: 2,
      submitted: { mood: 4 },
    }));
    expect(error.response.conflict?.current.mood).toBe(5);
  });

  it("fails unsupported enrichment and deletion explicitly", async () => {
    const client = createSupabaseDashboardClient(clientOptions(repositories()));

    await expect(client.enrichNow("31")).rejects.toMatchObject({
      status: 400,
      response: { error: { code: "INVALID_REQUEST", retryable: false } },
    });
    await expect(client.deleteJournal("31")).rejects.toMatchObject({
      status: 400,
      response: { error: { code: "INVALID_REQUEST", retryable: false } },
    });
  });
});
