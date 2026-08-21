import { getCache } from "@vercel/functions";

import type { RuntimeCacheLike } from "./daily-news-cache.js";
import type {
  DailyNewsDiscoverySource,
} from "./daily-news-discovery.js";
import type { DailyNewsFailureStage } from "./daily-news-service.js";
import {
  verifyDailyNewsOwnerBearer,
  type DailyNewsBearerVerifier,
  type DailyNewsOwnerEnvironment,
} from "./daily-news-service.js";

const RUNS_KEY = "daily-news:v1:cron-runs";
const RUNS_TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_RECEIPTS = 32;
const MAX_FUTURE_MS = 5 * 60 * 1_000;

export type DailyNewsRunState = "running" | "success" | "stale" | "empty" | "failed";

export interface DailyNewsRunningReceipt {
  runId: string;
  startedAt: string;
}

export interface DailyNewsRunCompletion {
  state: Exclude<DailyNewsRunState, "running">;
  finishedAt: string;
  discoverySource: DailyNewsDiscoverySource | "cache" | "none";
  failureStage: DailyNewsFailureStage | null;
  errorCode: string | null;
  digestDate: string | null;
  digestGeneratedAt: string | null;
}

export type DailyNewsRunReceipt = ({
  schemaVersion: 1;
  state: "running";
} & DailyNewsRunningReceipt) | ({
  schemaVersion: 1;
  runId: string;
  startedAt: string;
} & DailyNewsRunCompletion);

export interface DailyNewsRunStorePort {
  start(receipt: DailyNewsRunningReceipt): Promise<DailyNewsRunWriteResult>;
  finish(
    runId: string,
    completion: DailyNewsRunCompletion,
  ): Promise<DailyNewsRunWriteResult>;
  get(runId: string): Promise<DailyNewsRunReceipt | undefined>;
  listRecent(): Promise<DailyNewsRunReceipt[]>;
}

export interface DailyNewsRunWriteResult {
  indexed: boolean;
}

interface DailyNewsRunsOwnerDependencies {
  runs: DailyNewsRunStorePort;
  verifyBearer?: DailyNewsBearerVerifier;
}

export class DailyNewsRunStoreError extends Error {
  constructor(public readonly code: "run_receipt_invalid" | "run_receipt_not_found") {
    super(code);
    this.name = "DailyNewsRunStoreError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index]);
}

function validIso(value: unknown): value is string {
  return typeof value === "string"
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function validRunId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(value);
}

function validErrorCode(value: unknown): value is string | null {
  return value === null
    || (typeof value === "string" && /^[a-z0-9_]{1,80}$/.test(value));
}

const discoverySources = new Set([
  "cache", "gdelt", "publisher_fallback", "gdelt_plus_publisher_fallback", "none",
]);
const failureStages = new Set([
  "discovery", "selection", "summarization", "cache_write",
]);
const completedStates = new Set(["success", "stale", "empty", "failed"]);

function parseReceipt(value: unknown): DailyNewsRunReceipt | null {
  if (!isRecord(value) || value.schemaVersion !== 1 || !validRunId(value.runId)) {
    return null;
  }
  if (value.state === "running") {
    if (!exactKeys(value, ["schemaVersion", "runId", "startedAt", "state"])
      || !validIso(value.startedAt)) return null;
    return value as unknown as DailyNewsRunReceipt;
  }
  if (!exactKeys(value, [
    "schemaVersion", "runId", "startedAt", "state", "finishedAt",
    "discoverySource", "failureStage", "errorCode", "digestDate",
    "digestGeneratedAt",
  ])) return null;
  if (
    typeof value.state !== "string"
    || !completedStates.has(value.state)
    || !validIso(value.startedAt)
    || !validIso(value.finishedAt)
    || typeof value.discoverySource !== "string"
    || !discoverySources.has(value.discoverySource)
    || !(value.failureStage === null
      || (typeof value.failureStage === "string" && failureStages.has(value.failureStage)))
    || !validErrorCode(value.errorCode)
    || !(value.digestDate === null
      || (typeof value.digestDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.digestDate)))
    || !(value.digestGeneratedAt === null || validIso(value.digestGeneratedAt))
    || (value.digestDate === null) !== (value.digestGeneratedAt === null)
    || Date.parse(value.finishedAt) < Date.parse(value.startedAt)
    || (value.state === "success" && (value.failureStage !== null || value.errorCode !== null))
  ) return null;
  return value as unknown as DailyNewsRunReceipt;
}

function validateCompletion(value: DailyNewsRunCompletion): DailyNewsRunCompletion {
  const parsed = parseReceipt({
    schemaVersion: 1,
    runId: "validation",
    startedAt: value.finishedAt,
    ...value,
  });
  if (!parsed || parsed.state === "running") {
    throw new DailyNewsRunStoreError("run_receipt_invalid");
  }
  return value;
}

function runKey(runId: string): string {
  return `daily-news:v1:cron-run:${runId}`;
}

export function createRuntimeDailyNewsRunStore(
  runtime: RuntimeCacheLike = getCache(),
  now: () => Date = () => new Date(),
): DailyNewsRunStorePort {
  const options = {
    name: "Life Console daily news Cron runs",
    tags: ["daily-news-runs"],
    ttl: RUNS_TTL_SECONDS,
  };
  let indexMutation = Promise.resolve();

  async function readIndex(): Promise<string[]> {
    const value = await runtime.get(RUNS_KEY);
    if (value === null || value === undefined) return [];
    if (
      !Array.isArray(value)
      || value.length > MAX_RECEIPTS
      || value.some((runId) => !validRunId(runId))
      || new Set(value).size !== value.length
    ) return [];
    return value as string[];
  }

  async function readReceipt(runId: string): Promise<DailyNewsRunReceipt | null> {
    return parseReceipt(await runtime.get(runKey(runId)));
  }

  function withinRetention(receipt: DailyNewsRunReceipt): boolean {
    const earliest = now().getTime() - RUNS_TTL_SECONDS * 1_000;
    const latest = now().getTime() + MAX_FUTURE_MS;
    const timestamp = Date.parse(receipt.startedAt);
    return timestamp >= earliest && timestamp <= latest;
  }

  async function read(): Promise<DailyNewsRunReceipt[]> {
    const receipts = await Promise.all((await readIndex()).map(readReceipt));
    return receipts
      .filter((receipt): receipt is DailyNewsRunReceipt => (
        receipt !== null && withinRetention(receipt)
      ))
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
      .slice(0, MAX_RECEIPTS);
  }

  async function writeReceipt(receipt: DailyNewsRunReceipt): Promise<void> {
    await runtime.set(runKey(receipt.runId), receipt, options);
  }

  async function index(receipt: DailyNewsRunReceipt): Promise<void> {
    const mutation = indexMutation.then(async () => {
      const existing = await read();
      const runIds = [receipt, ...existing.filter((item) => item.runId !== receipt.runId)]
        .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
        .slice(0, MAX_RECEIPTS)
        .map((item) => item.runId);
      await runtime.set(RUNS_KEY, runIds, options);
    });
    indexMutation = mutation.catch(() => undefined);
    await mutation;
  }

  return {
    async start(receipt) {
      const parsed = parseReceipt({ schemaVersion: 1, state: "running", ...receipt });
      if (!parsed) throw new DailyNewsRunStoreError("run_receipt_invalid");
      await writeReceipt(parsed);
      try {
        await index(parsed);
        return { indexed: true };
      } catch {
        return { indexed: false };
      }
    },

    async finish(runId, completion) {
      if (!validRunId(runId)) throw new DailyNewsRunStoreError("run_receipt_invalid");
      validateCompletion(completion);
      const running = await readReceipt(runId);
      if (!running) throw new DailyNewsRunStoreError("run_receipt_not_found");
      const completed = parseReceipt({
        schemaVersion: 1,
        runId,
        startedAt: running.startedAt,
        ...completion,
      });
      if (!completed) throw new DailyNewsRunStoreError("run_receipt_invalid");
      await writeReceipt(completed);
      try {
        await index(completed);
        return { indexed: true };
      } catch {
        return { indexed: false };
      }
    },

    async get(runId) {
      if (!validRunId(runId)) throw new DailyNewsRunStoreError("run_receipt_invalid");
      const receipt = await readReceipt(runId);
      return receipt && withinRetention(receipt) ? receipt : undefined;
    },

    listRecent: read,
  };
}

function ownerJsonResponse(status: number, value: unknown): Response {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function bearerToken(request: Request): string | null {
  const match = /^Bearer ([^\s]+)$/.exec(request.headers.get("authorization") ?? "");
  return match?.[1] ?? null;
}

export async function dailyNewsRunsOwnerRequest(
  request: Request,
  environment: DailyNewsOwnerEnvironment,
  dependencies: DailyNewsRunsOwnerDependencies,
): Promise<Response> {
  if (request.method !== "GET") {
    return ownerJsonResponse(405, { status: "method_not_allowed" });
  }
  const bearer = bearerToken(request);
  if (!bearer) return ownerJsonResponse(401, { status: "unauthenticated" });
  try {
    const verify = dependencies.verifyBearer ?? verifyDailyNewsOwnerBearer;
    if (!await verify(bearer, environment)) {
      return ownerJsonResponse(401, { status: "unauthenticated" });
    }
  } catch {
    return ownerJsonResponse(503, { status: "auth_unavailable" });
  }
  try {
    const requestedRunId = new URL(request.url).searchParams.get("runId");
    if (requestedRunId !== null) {
      return ownerJsonResponse(200, {
        run: await dependencies.runs.get(requestedRunId) ?? null,
      });
    }
    return ownerJsonResponse(200, { runs: await dependencies.runs.listRecent() });
  } catch {
    return ownerJsonResponse(503, { status: "runs_unavailable" });
  }
}
