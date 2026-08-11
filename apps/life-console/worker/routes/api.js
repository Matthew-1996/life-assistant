import { first, requireDatabase } from "../lib/db.js";
import { HttpError } from "../lib/errors.js";
import {
  createFullBackup,
  createRecoveryPack,
  rotateKeks,
  verifyRecoveryPack,
} from "../lib/maintenance.js";
import {
  createDailyCheckin,
  createPhaseReview,
  createWeeklyReview,
  importHealthDay,
  planMigration,
  recordMigrationValidation,
  rollbackTruthSource,
  softDeleteStructuredRecord,
  switchTruthSource,
  updateHealthDay,
  updateStructuredRecord,
} from "../lib/operations.js";
import {
  buildDashboardProjection,
  createGoal,
  createJournal,
  getBackupPayload,
  getBackupQueue,
  getHealthDay,
  getJournal,
  getMigrationState,
  getSystemStatus,
  getIdempotentResponse,
  listAuditEvents,
  listGoals,
  listHealthSegments,
  listHealthDays,
  listJournals,
  listStructuredRecords,
  purgeJournal,
  reportBackupQueueItem,
  setJournalDeletionPlan,
  softDeleteGoal,
  updateGoal,
  updateJournal,
} from "../lib/repository.js";
import {
  assertCsrf,
  assertSameOrigin,
  authenticateOwner,
  createCsrfToken,
  enforceRateLimit,
  requestAuditContext,
} from "../lib/security.js";

function routeMatch(pathname, pattern) {
  const names = [];
  const expression = pattern
    .split("/")
    .map((segment) => {
      if (!segment.startsWith(":")) return segment;
      names.push(segment.slice(1));
      return "([^/]+)";
    })
    .join("/");
  const match = pathname.match(new RegExp(`^${expression}$`, "u"));
  if (!match) return null;
  return Object.fromEntries(names.map((name, index) => [
    name,
    decodeURIComponent(match[index + 1]),
  ]));
}

async function jsonBody(request) {
  const contentType = request.headers.get("Content-Type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "content_type_required", "JSON content type is required.");
  }
  try {
    const value = await request.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new TypeError("JSON object required");
    }
    return value;
  } catch {
    throw new HttpError(400, "invalid_json", "Request body must be valid JSON.");
  }
}

function expectedRevision(request) {
  const value = request.headers.get("If-Match");
  if (!value) {
    throw new HttpError(428, "revision_required", "If-Match revision is required.");
  }
  return Number(value.replace(/^W\//u, "").replaceAll('"', ""));
}

async function idempotentCreate({
  db,
  request,
  owner,
  route,
  create,
}) {
  const key = request.headers.get("Idempotency-Key");
  const state = await getIdempotentResponse(db, owner.hash, route, key);
  if (state.response) return state.response;
  return create({
    keyHash: state.keyHash,
    route,
    ownerHash: owner.hash,
  });
}

function filtersFromUrl(url) {
  return {
    date_from: url.searchParams.get("date_from"),
    date_to: url.searchParams.get("date_to"),
    mood: url.searchParams.get("mood"),
    q: url.searchParams.get("q"),
  };
}

export async function handleApi(request, env) {
  const url = new URL(request.url);
  const owner = await authenticateOwner(request, env);
  assertSameOrigin(request, env);

  if (request.method === "POST" && url.pathname === "/api/v1/auth/csrf") {
    const token = await createCsrfToken(owner.hash, env);
    return { owner_hash: owner.hash, ...token };
  }

  await assertCsrf(request, owner.hash, env);
  await enforceRateLimit(owner.hash, request, env);

  if (request.method === "GET" && url.pathname === "/api/v1/auth/me") {
    return { owner_hash: owner.hash, role: "owner", version: "2.0.0" };
  }

  const db = requireDatabase(env);
  const context = {
    env,
    ownerHash: owner.hash,
    auditContext: await requestAuditContext(request),
  };

  if (request.method === "GET" && url.pathname === "/api/v1/system/status") {
    return getSystemStatus(db);
  }
  if (request.method === "GET" && url.pathname === "/api/v1/dashboard") {
    return buildDashboardProjection(db, env);
  }
  if (request.method === "GET" && url.pathname === "/api/v1/bootstrap") {
    const [dashboard, system, goals, journals, health] = await Promise.all([
      buildDashboardProjection(db, env),
      getSystemStatus(db),
      listGoals(db),
      listJournals(db),
      listHealthDays(db),
    ]);
    return { dashboard, system, goals, journals, health };
  }
  if (request.method === "GET" && url.pathname === "/api/v1/audit/events") {
    return {
      items: await listAuditEvents(db, {
        size: url.searchParams.get("size") ?? 20,
        resource_type: url.searchParams.get("resource_type"),
        action: url.searchParams.get("action"),
      }),
    };
  }
  if (request.method === "GET" && url.pathname === "/api/v1/backup/queue") {
    return {
      items: await getBackupQueue(db, {
        size: url.searchParams.get("size") ?? 50,
        status: url.searchParams.get("status"),
      }),
    };
  }
  if (request.method === "POST" && url.pathname === "/api/v1/backup/trigger") {
    return createFullBackup(db, await jsonBody(request), context);
  }
  let params = routeMatch(url.pathname, "/api/v1/backup/queue/:id/payload");
  if (params && request.method === "GET") {
    return getBackupPayload(db, params.id, env);
  }
  params = routeMatch(url.pathname, "/api/v1/backup/queue/:id/report");
  if (params && request.method === "POST") {
    return reportBackupQueueItem(
      db,
      params.id,
      await jsonBody(request),
      context,
    );
  }
  if (request.method === "GET" && url.pathname === "/api/v1/migration/status") {
    return getMigrationState(db);
  }
  if (request.method === "POST" && url.pathname === "/api/v1/migration/plan") {
    return planMigration(db, await jsonBody(request), context);
  }
  if (request.method === "POST" && url.pathname === "/api/v1/migration/validate") {
    return recordMigrationValidation(db, await jsonBody(request), context);
  }
  if (request.method === "POST" && url.pathname === "/api/v1/migration/switch") {
    const input = await jsonBody(request);
    return switchTruthSource(db, input.confirmation, context);
  }
  if (request.method === "POST" && url.pathname === "/api/v1/migration/rollback") {
    const input = await jsonBody(request);
    return rollbackTruthSource(db, input.confirmation, context);
  }
  if (request.method === "POST" && url.pathname === "/api/v1/crypto/recovery-pack") {
    return createRecoveryPack(db, await jsonBody(request), context);
  }
  if (
    request.method === "POST"
    && url.pathname === "/api/v1/crypto/verify-recovery-pack"
  ) {
    return verifyRecoveryPack(await jsonBody(request), context);
  }
  if (request.method === "POST" && url.pathname === "/api/v1/crypto/rotate-keks") {
    return rotateKeks(db, await jsonBody(request), context);
  }

  if (request.method === "GET" && url.pathname === "/api/v1/goals") {
    return { items: await listGoals(db) };
  }
  if (request.method === "POST" && url.pathname === "/api/v1/goals") {
    const input = await jsonBody(request);
    return idempotentCreate({
      db,
      request,
      owner,
      route: "POST /api/v1/goals",
      create: (idempotency) => createGoal(db, input, {
        ...context,
        idempotency,
      }),
    });
  }
  params = routeMatch(url.pathname, "/api/v1/goals/:id");
  if (params && request.method === "PATCH") {
    return updateGoal(
      db,
      params.id,
      expectedRevision(request),
      await jsonBody(request),
      context,
    );
  }
  if (params && request.method === "DELETE") {
    return softDeleteGoal(db, params.id, expectedRevision(request), context);
  }

  if (request.method === "GET" && url.pathname === "/api/v1/journals") {
    return { items: await listJournals(db, filtersFromUrl(url)) };
  }
  if (request.method === "POST" && url.pathname === "/api/v1/journals") {
    const input = await jsonBody(request);
    return idempotentCreate({
      db,
      request,
      owner,
      route: "POST /api/v1/journals",
      create: (idempotency) => createJournal(db, input, {
        ...context,
        idempotency,
      }),
    });
  }
  params = routeMatch(url.pathname, "/api/v1/journals/:id");
  if (params && request.method === "GET") {
    return getJournal(db, params.id, env);
  }
  if (params && request.method === "PATCH") {
    return updateJournal(
      db,
      params.id,
      expectedRevision(request),
      await jsonBody(request),
      context,
    );
  }
  params = routeMatch(url.pathname, "/api/v1/journals/:id/delete-plan");
  if (params && request.method === "POST") {
    return setJournalDeletionPlan(
      db,
      params.id,
      expectedRevision(request),
      context,
    );
  }
  params = routeMatch(url.pathname, "/api/v1/journals/:id/delete-plan/cancel");
  if (params && request.method === "POST") {
    return setJournalDeletionPlan(
      db,
      params.id,
      expectedRevision(request),
      context,
      true,
    );
  }
  params = routeMatch(url.pathname, "/api/v1/journals/:id/purge");
  if (params && request.method === "DELETE") {
    return purgeJournal(db, params.id, expectedRevision(request), context);
  }

  const structuredRoutes = {
    "/api/v1/daily-checkins": "daily_checkins",
    "/api/v1/weekly-reviews": "weekly_reviews",
    "/api/v1/phase-reviews": "phase_reviews",
  };
  if (request.method === "GET" && structuredRoutes[url.pathname]) {
    return {
      items: await listStructuredRecords(db, structuredRoutes[url.pathname], env),
    };
  }
  if (request.method === "POST" && structuredRoutes[url.pathname]) {
    const table = structuredRoutes[url.pathname];
    const input = await jsonBody(request);
    const creators = {
      daily_checkins: createDailyCheckin,
      weekly_reviews: createWeeklyReview,
      phase_reviews: createPhaseReview,
    };
    return idempotentCreate({
      db,
      request,
      owner,
      route: `POST ${url.pathname}`,
      create: (idempotency) => creators[table](db, input, {
        ...context,
        idempotency,
      }),
    });
  }
  params = routeMatch(url.pathname, "/api/v1/daily-checkins/by-date/:date");
  if (params && request.method === "PATCH") {
    const current = await first(
      db,
      `SELECT id FROM daily_checkins
       WHERE date = ? AND deleted_at IS NULL`,
      [params.date],
    );
    if (!current) {
      throw new HttpError(404, "not_found", "Daily check-in was not found.");
    }
    return updateStructuredRecord(
      db,
      "daily_checkins",
      current.id,
      expectedRevision(request),
      await jsonBody(request),
      context,
    );
  }
  for (const [basePath, table] of Object.entries(structuredRoutes)) {
    params = routeMatch(url.pathname, `${basePath}/:id`);
    if (params && request.method === "PATCH") {
      return updateStructuredRecord(
        db,
        table,
        params.id,
        expectedRevision(request),
        await jsonBody(request),
        context,
      );
    }
    if (params && request.method === "DELETE") {
      return softDeleteStructuredRecord(
        db,
        table,
        params.id,
        expectedRevision(request),
        context,
      );
    }
  }

  if (request.method === "GET" && url.pathname === "/api/v1/health/days") {
    return { items: await listHealthDays(db, filtersFromUrl(url)) };
  }
  if (request.method === "POST" && url.pathname === "/api/v1/health/import") {
    const input = await jsonBody(request);
    return idempotentCreate({
      db,
      request,
      owner,
      route: "POST /api/v1/health/import",
      create: (idempotency) => importHealthDay(db, input, {
        ...context,
        idempotency,
      }),
    });
  }
  params = routeMatch(url.pathname, "/api/v1/health/days/:id");
  if (params && request.method === "GET") {
    return getHealthDay(db, params.id, env);
  }
  if (params && request.method === "PATCH") {
    return updateHealthDay(
      db,
      params.id,
      expectedRevision(request),
      await jsonBody(request),
      context,
    );
  }
  params = routeMatch(url.pathname, "/api/v1/health/days/:id/segments");
  if (params && request.method === "GET") {
    return { items: await listHealthSegments(db, params.id, env) };
  }

  throw new HttpError(404, "not_found", "API route was not found.");
}
