import {
  ApiError,
  type CapturePreview,
  type CommandReceipt,
  type Dashboard,
  type ErrorResponse,
  type LifeConsoleClient,
} from "../api/client";
import type { components } from "../contracts/life-console";
import type {
  DailyAnchors,
  DailyCheckin,
  DailyCheckinFields,
  DailyCheckinRepositoryPort,
} from "./daily-checkins";
import type { Goal, GoalRepositoryPort } from "./goals";
import type {
  Journal,
  JournalNormalizationRepositoryPort,
  JournalRepositoryPort,
} from "./journals";
import { RepositoryError, type Cursor } from "./repository";

type ErrorCode = ErrorResponse["error"]["code"];
type CheckinConflict = components["schemas"]["CheckinConflict"];
type CheckinInput = Parameters<LifeConsoleClient["checkin"]>[1];
type JournalInput = Parameters<LifeConsoleClient["journal"]>[0];

export interface SupabaseDashboardClient extends LifeConsoleClient {
  journalWithIdempotency(
    input: JournalInput,
    idempotencyKey: string,
  ): Promise<CommandReceipt>;
}

const anchorKeys = [
  "wake",
  "body_light",
  "life_action",
  "wind_down",
] as const;
const unsupportedCheckinFields = [
  "sleep_time",
  "wake_time",
  "out_of_bed_time",
  "awake_in_bed",
] as const;

export interface SupabaseDashboardClientOptions {
  date?: string;
  dateProvider?: () => string;
  dailyCheckins: DailyCheckinRepositoryPort;
  goals: GoalRepositoryPort;
  journals: JournalRepositoryPort;
  normalizeJournal?: (input: {
    journalId: number;
    sourceRevision: number;
    taskKey: string;
  }) => Promise<"completed" | "failed" | "pending">;
  now?: () => Date;
  createIdempotencyKey?: () => string;
  createOperationId?: () => string;
}

function compactLine(value: string, maximum: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= maximum
    ? normalized
    : `${normalized.slice(0, maximum - 1).trimEnd()}…`;
}

function ensureIsoDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Supabase dashboard date must be an ISO date");
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (
    Number.isNaN(parsed.getTime())
    || parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new Error("Supabase dashboard date must be an ISO date");
  }
  return value;
}

function naturalWeek(date: string): string[] {
  const current = new Date(`${ensureIsoDate(date)}T00:00:00Z`);
  const monday = new Date(current);
  monday.setUTCDate(current.getUTCDate() - ((current.getUTCDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(monday);
    day.setUTCDate(monday.getUTCDate() + index);
    return day.toISOString().slice(0, 10);
  });
}

function apiError(
  code: ErrorCode,
  status: number,
  message: string,
  retryable: boolean,
  requestId: string,
  conflict?: CheckinConflict,
): ApiError {
  return new ApiError(
    {
      request_id: requestId,
      error: { code, message: compactLine(message, 240), retryable },
      ...(conflict ? { conflict } : {}),
    },
    status,
  );
}

function mapRepositoryError(error: unknown, requestId: string): ApiError {
  if (error instanceof ApiError) return error;
  if (!(error instanceof RepositoryError)) {
    return apiError(
      "HUB_UNAVAILABLE",
      503,
      "测试云端暂不可用，请稍后重试。",
      true,
      requestId,
    );
  }
  if (error.kind === "conflict") {
    return apiError(
      "REVISION_CONFLICT",
      409,
      "记录已在其他位置更新。",
      false,
      requestId,
    );
  }
  if (error.kind === "validation") {
    return apiError(
      "INVALID_REQUEST",
      error.status || 400,
      error.message,
      false,
      requestId,
    );
  }
  if (error.kind === "transient") {
    return apiError(
      "HUB_UNAVAILABLE",
      error.status || 503,
      "测试云端暂不可用，请稍后重试。",
      true,
      requestId,
    );
  }
  return apiError(
    "SOURCE_INVALID",
    error.status || 500,
    "测试云端拒绝了本次操作。",
    false,
    requestId,
  );
}

function compareGoals(left: Goal, right: Goal): number {
  const priority = (left.priority ?? Number.MAX_SAFE_INTEGER)
    - (right.priority ?? Number.MAX_SAFE_INTEGER);
  if (priority !== 0) return priority;
  const target = (left.target_date ?? "9999-12-31").localeCompare(
    right.target_date ?? "9999-12-31",
  );
  return target || left.id - right.id;
}

function goalPeriod(goal: Goal): string {
  if (goal.start_date && goal.target_date) {
    return `${goal.start_date} 至 ${goal.target_date}`;
  }
  if (goal.start_date) return `${goal.start_date} 起`;
  if (goal.target_date) return `目标 ${goal.target_date}`;
  return "日期未设置";
}

function recentJournals(journals: Journal[]): Dashboard["records"]["recent_journals"] {
  return [...journals]
    .filter((journal) => journal.deleted_at === null)
    .sort((left, right) =>
      right.event_date.localeCompare(left.event_date) || right.id - left.id
    )
    .slice(0, 10)
    .map((journal) => {
      const normalized = journal.metadata
        && "summary" in journal.metadata
        ? journal.metadata
        : null;
      const rawSummary = compactLine(journal.content, 240);
      const summary = compactLine(normalized?.summary || rawSummary, 240);
      const title = compactLine(
        journal.title ?? normalized?.title ?? rawSummary,
        100,
      );
      const state = journal.normalization_status === "completed"
        ? "enriched"
        : journal.normalization_status === "processing"
          ? "working"
          : journal.normalization_status === "failed"
            ? "failed"
            : "raw";
      return {
        id: String(journal.id),
        date: journal.event_date,
        title: title || "未命名记录",
        summary,
        enrichment_state: state,
      };
    });
}

async function listAllGoals(repository: GoalRepositoryPort): Promise<Goal[]> {
  const goals: Goal[] = [];
  const knownIds = new Set<number>();
  const visitedCursors = new Set<string>();
  let cursor: Cursor | undefined;

  do {
    const page = await repository.list({
      pageSize: 100,
      ...(cursor ? { cursor } : {}),
    });
    for (const goal of page.items) {
      if (!knownIds.has(goal.id)) {
        knownIds.add(goal.id);
        goals.push(goal);
      }
    }
    if (!page.nextCursor) break;
    const marker = `${page.nextCursor.sortValue}:${page.nextCursor.id}`;
    if (visitedCursors.has(marker)) {
      throw new RepositoryError(
        "unknown",
        500,
        "goal_cursor_cycle",
        "Goal pagination returned a repeated cursor",
      );
    }
    visitedCursors.add(marker);
    cursor = page.nextCursor;
  } while (cursor);

  return goals;
}

function checkinCurrent(
  checkin: DailyCheckin | null,
): CheckinConflict["current"] {
  return {
    sleep_time: null,
    wake_time: null,
    out_of_bed_time: null,
    sleep_quality: checkin?.sleep_quality ?? null,
    energy: checkin?.energy ?? null,
    mood: checkin?.mood ?? null,
    life_feeling: checkin?.life_feeling ?? null,
    awake_in_bed: null,
    wake: checkin?.anchors?.wake ?? null,
    body_light: checkin?.anchors?.body_light ?? null,
    life_action: checkin?.anchors?.life_action ?? null,
    wind_down: checkin?.anchors?.wind_down ?? null,
  };
}

function submittedConflictFields(
  fields: CheckinInput["fields"],
): CheckinConflict["submitted"] {
  const submitted: CheckinConflict["submitted"] = {};
  for (const key of [
    "sleep_time",
    "wake_time",
    "out_of_bed_time",
    "sleep_quality",
    "energy",
    "mood",
    "life_feeling",
    "awake_in_bed",
    ...anchorKeys,
  ] as const) {
    const value = fields[key];
    if (value !== undefined) {
      Object.assign(submitted, { [key]: value });
    }
  }
  return submitted;
}

function checkinConflict(
  date: string,
  current: DailyCheckin | null,
  fields: CheckinInput["fields"],
): CheckinConflict {
  return {
    target_key: date,
    current_revision: current?.revision ?? null,
    current: checkinCurrent(current),
    submitted: submittedConflictFields(fields),
  };
}

function mapCheckinFields(
  fields: CheckinInput["fields"],
  current: DailyCheckin | null,
): DailyCheckinFields {
  for (const key of unsupportedCheckinFields) {
    if (fields[key] !== undefined) {
      throw new RepositoryError(
        "validation",
        400,
        "unsupported_checkin_field",
        `${key} is not supported by the Supabase candidate`,
      );
    }
  }

  const mapped: DailyCheckinFields = {};
  if (fields.sleep_quality !== undefined) {
    mapped.sleepQuality = fields.sleep_quality;
  }
  if (fields.energy !== undefined) mapped.energy = fields.energy;
  if (fields.mood !== undefined) mapped.mood = fields.mood;
  if (fields.life_feeling !== undefined) {
    mapped.lifeFeeling = fields.life_feeling;
  }
  if (fields.note_summary !== undefined) mapped.notes = fields.note_summary;

  const anchorPatch: DailyAnchors = {};
  for (const key of anchorKeys) {
    const value = fields[key];
    if (value !== undefined) anchorPatch[key] = value;
  }
  if (Object.keys(anchorPatch).length > 0) {
    mapped.anchors = current
      ? { ...(current.anchors ?? {}), ...anchorPatch }
      : anchorPatch;
  }
  return mapped;
}

function commandReceipt(
  action: "created" | "updated",
  revision: number,
  message: string,
  operationId: string,
): CommandReceipt {
  return {
    request_id: `request-${operationId}`,
    command_id: `command-${operationId}`,
    action,
    source: { state: "saved", revision },
    read_model: "current",
    message,
  };
}

function unsupported(
  operation: string,
  operationId: () => string,
): Promise<never> {
  return Promise.reject(
    apiError(
      "INVALID_REQUEST",
      400,
      `${operation}不属于当前 Supabase 候选范围。`,
      false,
      `request-${operationId()}`,
    ),
  );
}

export function createSupabaseDashboardClient({
  date: rawDate,
  dateProvider,
  dailyCheckins,
  goals,
  journals,
  normalizeJournal,
  now = () => new Date(),
  createIdempotencyKey = () =>
    `web_${crypto.randomUUID().replaceAll("-", "")}`,
  createOperationId = () => crypto.randomUUID().replaceAll("-", ""),
}: SupabaseDashboardClientOptions): SupabaseDashboardClient {
  if (!rawDate && !dateProvider) {
    throw new Error("Supabase dashboard requires a date or date provider");
  }
  const resolveDate = () => ensureIsoDate(
    dateProvider ? dateProvider() : rawDate as string,
  );
  const journalWrites = new Map<
    string,
    {
      key: string;
      pending?: Promise<{
        journal: Journal;
        normalizationStatus: "completed" | "failed" | "pending";
      }>;
    }
  >();

  function supportsRawFirstJournal(
    repository: JournalRepositoryPort,
  ): repository is JournalNormalizationRepositoryPort {
    return "createRaw" in repository
      && typeof repository.createRaw === "function";
  }

  function normalizationMessage(
    status: "completed" | "failed" | "pending",
  ): string {
    if (status === "completed") return "日记原文已保存，整理完成。";
    if (status === "failed") {
      return "日记原文已保存；整理失败，可稍后重试。";
    }
    return "日记原文已保存，正在等待整理。";
  }

  async function createJournalRecord(
    input: JournalInput,
    idempotencyKey: string,
  ): Promise<{
    journal: Journal;
    normalizationStatus: "completed" | "failed" | "pending";
  }> {
    if (!supportsRawFirstJournal(journals)) {
      return {
        journal: await journals.create(idempotencyKey, {
          date: input.event_date,
          title: input.title ?? null,
          content: input.text,
          tags: input.tags ?? [],
        }),
        normalizationStatus: "pending",
      };
    }
    const journal = await journals.createRaw(idempotencyKey, {
      recordKey: idempotencyKey,
      date: input.event_date,
      eventTime: input.event_time ?? null,
      timePrecision: input.time_precision,
      source: "life_console",
      privacy: "owner-only",
      content: input.text,
    });
    const sourceRevision = journal.raw_revision;
    if (!normalizeJournal || !Number.isSafeInteger(sourceRevision)) {
      return { journal, normalizationStatus: "pending" };
    }
    try {
      const normalizationStatus = await normalizeJournal({
        journalId: journal.id,
        sourceRevision: sourceRevision as number,
        taskKey: `journal:${journal.id}:revision:${sourceRevision}:deepseek`,
      });
      return { journal, normalizationStatus };
    } catch {
      return { journal, normalizationStatus: "failed" };
    }
  }

  async function dashboard(): Promise<Dashboard> {
    const date = resolveDate();
    const [checkinPage, goalRows, journalPage, today] = await Promise.all([
      dailyCheckins.list({ pageSize: 31 }),
      listAllGoals(goals),
      journals.list({ pageSize: 10 }),
      dailyCheckins.get(date),
    ]);
    const week = naturalWeek(date);
    const weekSet = new Set(week);
    const byDate = new Map<string, DailyCheckin>();
    [...checkinPage.items]
      .sort((left, right) =>
        right.checkin_date.localeCompare(left.checkin_date) || right.id - left.id
      )
      .forEach((checkin) => {
        if (weekSet.has(checkin.checkin_date) && !byDate.has(checkin.checkin_date)) {
          byDate.set(checkin.checkin_date, checkin);
        }
      });
    if (today && weekSet.has(date)) byDate.set(date, today);

    const activeGoals = [...goalRows]
      .filter((goal) => goal.status === "active" && goal.deleted_at === null)
      .sort(compareGoals)
      .slice(0, 2);
    const journalsForDashboard = recentJournals(journalPage.items);
    const sourceRevisions: Record<string, string> = {};
    if (today) sourceRevisions.daily = String(today.revision);
    const latestJournal = [...journalPage.items].sort((left, right) =>
      right.updated_at.localeCompare(left.updated_at) || right.id - left.id
    )[0];
    if (latestJournal) {
      sourceRevisions.journal = `${latestJournal.updated_at}:${latestJournal.revision}`;
    }
    const latestGoal = [...goalRows].sort((left, right) =>
      right.updated_at.localeCompare(left.updated_at) || right.id - left.id
    )[0];
    if (latestGoal) {
      sourceRevisions.goals = `${latestGoal.updated_at}:${latestGoal.revision}`;
    }

    return {
      schema_version: 1,
      generated_at: now().toISOString(),
      date,
      today: {
        focus: {
          title: activeGoals[0]?.title ?? "",
          phase_label: activeGoals.length > 0 ? "进行中" : "尚未设置目标",
        },
        active_projects: activeGoals.map((goal) => ({
          title: goal.title,
          status: "进行中",
          period: goalPeriod(goal),
          summary: goal.domain ?? "领域未设置",
          plan_path: `supabase-goal:${goal.id}`,
        })),
        suggested_action: null,
        anchors: {
          wake: today?.anchors?.wake ?? null,
          body_light: today?.anchors?.body_light ?? null,
          life_action: today?.anchors?.life_action ?? null,
          wind_down: today?.anchors?.wind_down ?? null,
        },
        daily_revision: today?.revision ?? null,
        confirmations: [],
      },
      progress: {
        ratings: week.map((weekDate) => {
          const checkin = byDate.get(weekDate);
          return {
            date: weekDate,
            sleep_quality: checkin?.sleep_quality ?? null,
            energy: checkin?.energy ?? null,
            mood: checkin?.mood ?? null,
            life_feeling: checkin?.life_feeling ?? null,
          };
        }),
        sleep: [],
        sample_counts: {
          daily: byDate.size,
          missing: 7 - byDate.size,
        },
      },
      records: { recent_journals: journalsForDashboard },
      system: {
        hub: "unavailable",
        icloud: "unavailable",
        automation: "unknown",
        backup: "unknown",
        google: "paused",
        mobile: "pending",
      },
      source_revisions: sourceRevisions,
    };
  }

  async function journal(input: JournalInput): Promise<CommandReceipt> {
    const operationId = createOperationId();
    const fingerprint = JSON.stringify([
      input.event_date,
      input.title ?? null,
      input.text,
      input.tags ?? [],
    ]);
    let write = journalWrites.get(fingerprint);
    if (!write) {
      write = { key: createIdempotencyKey() };
      journalWrites.set(fingerprint, write);
    }
    try {
      write.pending ??= createJournalRecord(input, write.key);
      const { journal: created, normalizationStatus } = await write.pending;
      if (journalWrites.get(fingerprint) === write) {
        journalWrites.delete(fingerprint);
      }
      return commandReceipt(
        "created",
        created.revision,
        normalizationMessage(normalizationStatus),
        operationId,
      );
    } catch (error) {
      if (journalWrites.get(fingerprint) === write) {
        write.pending = undefined;
      }
      throw mapRepositoryError(error, `request-${operationId}`);
    }
  }

  async function journalWithIdempotency(
    input: JournalInput,
    idempotencyKey: string,
  ): Promise<CommandReceipt> {
    const operationId = createOperationId();
    try {
      const { journal: created, normalizationStatus } =
        await createJournalRecord(input, idempotencyKey);
      return commandReceipt(
        "created",
        created.revision,
        normalizationMessage(normalizationStatus),
        operationId,
      );
    } catch (error) {
      throw mapRepositoryError(error, `request-${operationId}`);
    }
  }

  async function checkin(
    targetDate: string,
    input: CheckinInput,
  ): Promise<CommandReceipt> {
    const operationId = createOperationId();
    const requestId = `request-${operationId}`;
    let current: DailyCheckin | null = null;
    try {
      current = await dailyCheckins.get(targetDate);
      const fields = mapCheckinFields(input.fields, current);
      if (input.expect_revision === null) {
        if (current) {
          throw apiError(
            "REVISION_CONFLICT",
            409,
            "这一天已经有状态记录。",
            false,
            requestId,
            checkinConflict(targetDate, current, input.fields),
          );
        }
        const created = await dailyCheckins.create(createIdempotencyKey(), {
          date: targetDate,
          ...fields,
        });
        return commandReceipt(
          "created",
          created.revision,
          "每日状态已保存到测试云端。",
          operationId,
        );
      }
      if (!current) {
        throw apiError(
          "REVISION_CONFLICT",
          409,
          "这一天的状态记录已不存在。",
          false,
          requestId,
          checkinConflict(targetDate, null, input.fields),
        );
      }
      const updated = await dailyCheckins.update(
        current.id,
        input.expect_revision,
        fields,
      );
      return commandReceipt(
        "updated",
        updated.revision,
        "每日状态已更新到测试云端。",
        operationId,
      );
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error instanceof RepositoryError && error.kind === "conflict") {
        const latest = await dailyCheckins.get(targetDate).catch(() => current);
        throw apiError(
          "REVISION_CONFLICT",
          409,
          "记录已在其他位置更新。",
          false,
          requestId,
          checkinConflict(targetDate, latest, input.fields),
        );
      }
      throw mapRepositoryError(error, requestId);
    }
  }

  async function preview(
    text: string,
    _contextEtag: string,
  ): Promise<CapturePreview> {
    const summary = compactLine(text, 120);
    if (!summary) {
      throw apiError(
        "INVALID_REQUEST",
        400,
        "请输入需要预览的记录。",
        false,
        `request-${createOperationId()}`,
      );
    }
    return {
      schema_version: 1,
      state: "available",
      message: "已生成结构化预览；此步骤尚未保存。",
      intent: "journal",
      preview: { date: resolveDate(), source: "对话式记录", summary },
    };
  }

  return {
    dashboard,
    journal,
    journalWithIdempotency,
    checkin,
    preview,
    enrichmentPreview: () => unsupported("日记整理预览", createOperationId),
    enrichmentCommit: () => unsupported("日记整理", createOperationId),
    enrichmentStatus: () => unsupported("日记整理状态", createOperationId),
    enrichmentRetry: () => unsupported("日记整理重试", createOperationId),
    enrichNow: () => unsupported("日记整理", createOperationId),
    enrichmentByJournal: () => unsupported("日记整理状态", createOperationId),
    deleteJournal: () => unsupported("日记删除", createOperationId),
  };
}
