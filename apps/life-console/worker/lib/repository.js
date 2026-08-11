import { decryptField, encryptField, sha256Hex } from "./crypto.js";
import { all, batch, first, parseJson, run } from "./db.js";
import { HttpError } from "./errors.js";

const RESOURCE_TABLES = new Set([
  "daily_checkins",
  "weekly_reviews",
  "phase_reviews",
]);

export function nowIso() {
  return new Date().toISOString();
}

export function newId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function auditStatement({
  ownerHash,
  resourceType,
  resourceId,
  action,
  result = "SUCCESS",
  auditContext,
  createdAt = nowIso(),
}) {
  return [
    `INSERT INTO audit_events (
       id, created_at, owner_hash, resource_type, resource_id,
       action, result, ip_hash, user_agent_hash
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      newId("audit"),
      createdAt,
      ownerHash,
      resourceType,
      resourceId,
      action,
      result,
      auditContext.ip_hash,
      auditContext.user_agent_hash,
    ],
  ];
}

export function backupStatement(resourceType, resourceId, revision, createdAt = nowIso()) {
  return [
    `INSERT INTO backup_exports (
       id, created_at, resource_type, resource_id, revision, status
     ) VALUES (?, ?, ?, ?, ?, 'PENDING')
     ON CONFLICT(resource_type, resource_id, revision) DO NOTHING`,
    [newId("backup"), createdAt, resourceType, resourceId, revision],
  ];
}

function requiredString(value, name, maximum = 10_000) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new HttpError(400, "invalid_request", `${name} is invalid.`);
  }
  return value.trim();
}

function optionalString(value, maximum = 10_000) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > maximum) {
    throw new HttpError(400, "invalid_request", "Optional text value is invalid.");
  }
  return value.trim();
}

function requireRevision(value) {
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new HttpError(428, "revision_required", "A valid revision is required.");
  }
  return revision;
}

function keyNameForKid(kid) {
  const names = {
    "journal-v1": "KEK_JOURNAL_V1",
    "journal-v2": "KEK_JOURNAL_V2",
    "health-v1": "KEK_HEALTH_V1",
    "health-v2": "KEK_HEALTH_V2",
    "backup-v1": "KEK_BACKUP_V1",
  };
  return names[kid] ?? null;
}

export function resolveKek(env, kid) {
  const name = keyNameForKid(kid);
  const material = name ? env[name] : null;
  if (!material) {
    throw new HttpError(503, "encryption_key_unavailable", "Encryption key is unavailable.");
  }
  return material;
}

export async function getIdempotentResponse(db, ownerHash, route, key) {
  if (!key || typeof key !== "string" || key.length > 200) {
    throw new HttpError(400, "idempotency_key_required", "Idempotency-Key is required.");
  }
  const keyHash = await sha256Hex(key);
  const existing = await first(
    db,
    `SELECT route, owner_hash, expires_at, cached_response_json
     FROM idempotency_keys WHERE key_hash = ?`,
    [keyHash],
  );
  if (!existing) return { keyHash, response: null };
  if (existing.route !== route || existing.owner_hash !== ownerHash) {
    throw new HttpError(
      409,
      "idempotency_key_reused",
      "Idempotency-Key was already used for a different request.",
    );
  }
  if (Date.parse(existing.expires_at) <= Date.now()) {
    await run(db, "DELETE FROM idempotency_keys WHERE key_hash = ?", [keyHash]);
    return { keyHash, response: null };
  }
  return {
    keyHash,
    response: parseJson(existing.cached_response_json, null),
  };
}

export function idempotencyStatement({
  keyHash,
  route,
  ownerHash,
  response,
  createdAt = nowIso(),
}) {
  const expiresAt = new Date(Date.parse(createdAt) + 24 * 60 * 60 * 1000).toISOString();
  return [
    `INSERT INTO idempotency_keys (
       key_hash, route, owner_hash, created_at, expires_at, cached_response_json
     ) VALUES (?, ?, ?, ?, ?, ?)`,
    [keyHash, route, ownerHash, createdAt, expiresAt, JSON.stringify(response)],
  ];
}

export async function getSystemStatus(db) {
  const migration = await first(
    db,
    `SELECT phase, source_truth, batch_id, rollback_window_until,
            switched_at, rolled_back_at, updated_at
     FROM migration_state WHERE singleton_id = 1`,
  );
  const queue = await first(
    db,
    `SELECT
       SUM(CASE WHEN status IN ('PENDING', 'RETRYING') THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) AS failed,
       MAX(completed_at) AS last_success_at
     FROM backup_exports`,
  );
  return {
    version: "2.0.0",
    mode: "sites-api",
    source_truth: migration?.source_truth ?? "ICLOUD_PRIMARY",
    migration: {
      phase: migration?.phase ?? "NOT_STARTED",
      batch_id: migration?.batch_id ?? null,
      rollback_window_until: migration?.rollback_window_until ?? null,
      switched_at: migration?.switched_at ?? null,
      rolled_back_at: migration?.rolled_back_at ?? null,
      updated_at: migration?.updated_at ?? null,
    },
    encryption: {
      journal_kid: "journal-v1",
      health_kid: "health-v1",
    },
    backup: {
      pending: Number(queue?.pending ?? 0),
      failed: Number(queue?.failed ?? 0),
      last_success_at: queue?.last_success_at ?? null,
    },
  };
}

function numericRating(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clockTime(value) {
  if (!value || typeof value !== "string") return null;
  const match = value.match(/T(\d{2}:\d{2})/u);
  return match?.[1] ?? value.slice(0, 5);
}

export async function buildDashboardProjection(db, env) {
  const [
    latestDaily,
    ratings,
    health,
    goals,
    journals,
    system,
    revisions,
  ] = await Promise.all([
    first(
      db,
      `SELECT date, revision, anchors_encrypted
       FROM daily_checkins
       WHERE deleted_at IS NULL
       ORDER BY date DESC LIMIT 1`,
    ),
    all(
      db,
      `SELECT date, sleep_quality, energy, mood, real_life_score
       FROM daily_checkins
       WHERE deleted_at IS NULL
       ORDER BY date DESC LIMIT 14`,
    ),
    all(
      db,
      `SELECT date, sleep_start, sleep_end
       FROM health_days
       WHERE deleted_at IS NULL
       ORDER BY date DESC LIMIT 14`,
    ),
    listGoals(db),
    listJournals(db),
    getSystemStatus(db),
    first(
      db,
      `SELECT
         COALESCE((SELECT MAX(revision) FROM daily_checkins), 0) AS daily,
         COALESCE((SELECT MAX(revision) FROM journals), 0) AS journal,
         COALESCE((SELECT MAX(revision) FROM goals), 0) AS goals`,
    ),
  ]);
  const date = latestDaily?.date
    ?? health[0]?.date
    ?? new Date().toISOString().slice(0, 10);
  let anchors = {
    wake: null,
    body_light: null,
    life_action: null,
    wind_down: null,
  };
  if (latestDaily?.anchors_encrypted) {
    try {
      anchors = {
        ...anchors,
        ...JSON.parse(await decryptField(
          latestDaily.anchors_encrypted,
          (kid) => resolveKek(env, kid),
        )),
      };
    } catch {
      // Projection remains available even if one optional encrypted field is corrupt.
    }
  }
  const focus = goals.find((goal) => goal.status === "focus");
  const activeProjects = goals
    .filter((goal) => ["focus", "secondary"].includes(goal.status))
    .slice(0, 4)
    .map((goal) => ({
      title: goal.title,
      status: goal.status === "focus" ? "当前重点" : "辅助目标",
      period: [goal.started_at, goal.ended_at].filter(Boolean).join(" 至 ") || "未设置周期",
      summary: "详细描述已加密；在目标详情中查看。",
      plan_path: `cloud-goal:${goal.id}`,
    }));
  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    date,
    today: {
      focus: {
        title: focus?.title ?? "尚未设置当前重点",
        phase_label: focus ? "云端目标 · 进行中" : "等待设置",
      },
      active_projects: activeProjects,
      suggested_action: null,
      anchors,
      daily_revision: Number(latestDaily?.revision ?? 0) || null,
      confirmations: [],
    },
    progress: {
      ratings: ratings.reverse().map((row) => ({
        date: row.date,
        sleep_quality: numericRating(row.sleep_quality),
        energy: numericRating(row.energy),
        mood: numericRating(row.mood),
        life_feeling: numericRating(row.real_life_score),
      })),
      sleep: health.reverse().map((row) => ({
        date: row.date,
        sleep_time: clockTime(row.sleep_start),
        wake_time: clockTime(row.sleep_end),
        out_of_bed_time: null,
      })),
      sample_counts: {
        daily: ratings.length,
        missing: 0,
      },
    },
    records: {
      recent_journals: journals.slice(0, 20).map((journal) => ({
        id: journal.id,
        date: journal.date,
        title: journal.title || "未命名记录",
        summary: journal.deletion_plan_until
          ? `删除计划进行中：${journal.deletion_plan_until}`
          : "原文已加密；打开详情后解密查看。",
        enrichment_state: "raw",
      })),
    },
    system: {
      hub: "ready",
      icloud: system.backup.failed > 0 ? "partial" : "readable",
      automation: "unknown",
      backup: system.backup.failed > 0 ? "unknown" : "ready",
      google: "paused",
      mobile: "pending",
    },
    source_revisions: {
      daily: `d1-daily-${revisions?.daily ?? 0}`,
      journal: `d1-journal-${revisions?.journal ?? 0}`,
      goals: `d1-goals-${revisions?.goals ?? 0}`,
    },
  };
}

export async function listAuditEvents(db, filters = {}) {
  const limit = filters.size ?? 20;
  const boundedLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const where = [];
  const bindings = [];
  if (filters.resource_type) {
    where.push("resource_type = ?");
    bindings.push(filters.resource_type);
  }
  if (filters.action) {
    where.push("action = ?");
    bindings.push(filters.action);
  }
  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  return all(
    db,
    `SELECT id, created_at, owner_hash, resource_type, resource_id,
            action, result, ip_hash, user_agent_hash
     FROM audit_events
     ${whereClause}
     ORDER BY created_at DESC
     LIMIT ?`,
    [...bindings, boundedLimit],
  );
}

export async function listGoals(db) {
  const rows = await all(
    db,
    `SELECT id, revision, created_at, updated_at, title, status,
            priority_order, started_at, ended_at, tags
     FROM goals
     WHERE deleted_at IS NULL
     ORDER BY priority_order, created_at`,
  );
  return rows.map((row) => ({ ...row, tags: parseJson(row.tags, []) }));
}

export async function createGoal(db, input, context) {
  const createdAt = nowIso();
  const id = newId("goal");
  const response = {
    id,
    revision: 1,
    created_at: createdAt,
    updated_at: createdAt,
    title: requiredString(input.title, "title", 200),
    status: requiredString(input.status, "status", 30),
    priority_order: Number(input.priority_order),
    started_at: optionalString(input.started_at, 40),
    ended_at: optionalString(input.ended_at, 40),
    tags: Array.isArray(input.tags) ? input.tags.slice(0, 20) : [],
  };
  if (!Number.isSafeInteger(response.priority_order) || response.priority_order < 1) {
    throw new HttpError(400, "invalid_request", "priority_order is invalid.");
  }
  const description = optionalString(input.description, 20_000);
  const descriptionEncrypted = description
    ? await encryptField(description, {
      kid: "journal-v1",
      kekMaterial: resolveKek(context.env, "journal-v1"),
    })
    : null;
  const statements = [
    [
      `INSERT INTO goals (
         id, revision, created_at, updated_at, encryption_version,
         title, description_encrypted, status, priority_order,
         started_at, ended_at, tags
       ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        createdAt,
        createdAt,
        descriptionEncrypted ? "journal-v1" : null,
        response.title,
        descriptionEncrypted,
        response.status,
        response.priority_order,
        response.started_at,
        response.ended_at,
        JSON.stringify(response.tags),
      ],
    ],
    backupStatement("goal", id, 1, createdAt),
    auditStatement({
      ...context,
      resourceType: "goal",
      resourceId: id,
      action: "CREATE",
      createdAt,
    }),
  ];
  if (context.idempotency) {
    statements.push(idempotencyStatement({
      ...context.idempotency,
      response,
      createdAt,
    }));
  }
  await batch(db, statements);
  return response;
}

export async function updateGoal(db, id, expectedRevision, input, context) {
  const current = await first(
    db,
    `SELECT id, revision, title, status, priority_order, started_at, ended_at,
            tags, description_encrypted
     FROM goals WHERE id = ? AND deleted_at IS NULL`,
    [id],
  );
  if (!current) throw new HttpError(404, "not_found", "Goal was not found.");
  const expected = requireRevision(expectedRevision);
  if (current.revision !== expected) {
    throw new HttpError(409, "revision_conflict", "Goal was updated elsewhere.", {
      current_revision: current.revision,
    });
  }
  const updatedAt = nowIso();
  const revision = current.revision + 1;
  const title = input.title === undefined
    ? current.title
    : requiredString(input.title, "title", 200);
  const status = input.status === undefined
    ? current.status
    : requiredString(input.status, "status", 30);
  const priorityOrder = input.priority_order === undefined
    ? current.priority_order
    : Number(input.priority_order);
  if (!Number.isSafeInteger(priorityOrder) || priorityOrder < 1) {
    throw new HttpError(400, "invalid_request", "priority_order is invalid.");
  }
  const tags = input.tags === undefined
    ? parseJson(current.tags, [])
    : Array.isArray(input.tags) ? input.tags.slice(0, 20) : [];
  let descriptionEncrypted = current.description_encrypted;
  if (input.description !== undefined) {
    const description = optionalString(input.description, 20_000);
    descriptionEncrypted = description
      ? await encryptField(description, {
        kid: "journal-v1",
        kekMaterial: resolveKek(context.env, "journal-v1"),
      })
      : null;
  }
  const statements = [
    [
      `UPDATE goals
       SET revision = ?, updated_at = ?, title = ?, description_encrypted = ?,
           encryption_version = ?, status = ?, priority_order = ?,
           started_at = ?, ended_at = ?, tags = ?
       WHERE id = ? AND revision = ? AND deleted_at IS NULL`,
      [
        revision,
        updatedAt,
        title,
        descriptionEncrypted,
        descriptionEncrypted ? "journal-v1" : null,
        status,
        priorityOrder,
        input.started_at === undefined
          ? current.started_at
          : optionalString(input.started_at, 40),
        input.ended_at === undefined
          ? current.ended_at
          : optionalString(input.ended_at, 40),
        JSON.stringify(tags),
        id,
        expected,
      ],
    ],
    backupStatement("goal", id, revision, updatedAt),
    auditStatement({
      ...context,
      resourceType: "goal",
      resourceId: id,
      action: "UPDATE",
      createdAt: updatedAt,
    }),
  ];
  await batch(db, statements);
  return { id, revision, updated_at: updatedAt };
}

export async function softDeleteGoal(db, id, expectedRevision, context) {
  const expected = requireRevision(expectedRevision);
  const current = await first(
    db,
    "SELECT revision FROM goals WHERE id = ? AND deleted_at IS NULL",
    [id],
  );
  if (!current) throw new HttpError(404, "not_found", "Goal was not found.");
  if (current.revision !== expected) {
    throw new HttpError(409, "revision_conflict", "Goal was updated elsewhere.", {
      current_revision: current.revision,
    });
  }
  const deletedAt = nowIso();
  const revision = expected + 1;
  await batch(db, [
    [
      `UPDATE goals SET revision = ?, updated_at = ?, deleted_at = ?
       WHERE id = ? AND revision = ? AND deleted_at IS NULL`,
      [revision, deletedAt, deletedAt, id, expected],
    ],
    backupStatement("goal", id, revision, deletedAt),
    auditStatement({
      ...context,
      resourceType: "goal",
      resourceId: id,
      action: "DELETE",
      createdAt: deletedAt,
    }),
  ]);
  return { id, revision, deleted_at: deletedAt };
}

export async function listJournals(db, filters = {}) {
  const bindings = [];
  const where = ["deleted_at IS NULL"];
  if (filters.date_from) {
    where.push("date >= ?");
    bindings.push(filters.date_from);
  }
  if (filters.date_to) {
    where.push("date <= ?");
    bindings.push(filters.date_to);
  }
  if (filters.mood) {
    where.push("mood = ?");
    bindings.push(filters.mood);
  }
  if (filters.q) {
    where.push("title_prefix LIKE ?");
    bindings.push(`${filters.q.slice(0, 16)}%`);
  }
  const rows = await all(
    db,
    `SELECT id, revision, created_at, updated_at, date, title, mood, tags,
            deletion_plan_until
     FROM journals
     WHERE ${where.join(" AND ")}
     ORDER BY date DESC, updated_at DESC
     LIMIT 100`,
    bindings,
  );
  return rows.map((row) => ({ ...row, tags: parseJson(row.tags, []) }));
}

export async function getJournal(db, id, env) {
  const row = await first(
    db,
    `SELECT id, revision, created_at, updated_at, date, title, mood, tags,
            content_encrypted, encryption_kid, deletion_plan_until
     FROM journals WHERE id = ? AND deleted_at IS NULL`,
    [id],
  );
  if (!row) throw new HttpError(404, "not_found", "Journal was not found.");
  return {
    ...row,
    tags: parseJson(row.tags, []),
    content: await decryptField(row.content_encrypted, (kid) => resolveKek(env, kid)),
    content_encrypted: undefined,
  };
}

export async function createJournal(db, input, context) {
  const createdAt = nowIso();
  const id = newId("journal");
  const title = optionalString(input.title, 200) ?? "";
  const content = requiredString(input.content, "content", 100_000);
  const date = requiredString(input.date, "date", 10);
  const mood = optionalString(input.mood, 80);
  const tags = Array.isArray(input.tags) ? input.tags.slice(0, 30) : [];
  const kid = "journal-v1";
  const [contentEncrypted, contentDigest] = await Promise.all([
    encryptField(content, {
      kid,
      kekMaterial: resolveKek(context.env, kid),
    }),
    sha256Hex(content),
  ]);
  const response = {
    id,
    revision: 1,
    created_at: createdAt,
    updated_at: createdAt,
    date,
    title,
    mood,
    tags,
  };
  const statements = [
    [
      `INSERT INTO journals (
         id, revision, created_at, updated_at, encryption_version,
         date, title, title_prefix, mood, tags, content_encrypted,
         encryption_kid, content_digest
       ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        createdAt,
        createdAt,
        kid,
        date,
        title,
        title.slice(0, 16),
        mood,
        JSON.stringify(tags),
        contentEncrypted,
        kid,
        contentDigest,
      ],
    ],
    [
      `INSERT INTO journal_revisions (
         id, journal_id, revision, created_at, title, mood, tags,
         content_encrypted, encryption_kid, content_digest
       ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`,
      [
        newId("journal_revision"),
        id,
        createdAt,
        title,
        mood,
        JSON.stringify(tags),
        contentEncrypted,
        kid,
        contentDigest,
      ],
    ],
    backupStatement("journal", id, 1, createdAt),
    auditStatement({
      ...context,
      resourceType: "journal",
      resourceId: id,
      action: "CREATE",
      createdAt,
    }),
  ];
  if (context.idempotency) {
    statements.push(idempotencyStatement({
      ...context.idempotency,
      response,
      createdAt,
    }));
  }
  await batch(db, statements);
  return response;
}

export async function updateJournal(db, id, expectedRevision, input, context) {
  const current = await first(
    db,
    `SELECT revision, date, title, mood, tags, content_encrypted,
            encryption_kid, content_digest
     FROM journals WHERE id = ? AND deleted_at IS NULL`,
    [id],
  );
  if (!current) throw new HttpError(404, "not_found", "Journal was not found.");
  const expected = requireRevision(expectedRevision);
  if (current.revision !== expected) {
    throw new HttpError(409, "revision_conflict", "Journal was updated elsewhere.", {
      current_revision: current.revision,
    });
  }
  const revision = expected + 1;
  const updatedAt = nowIso();
  const title = input.title === undefined
    ? current.title
    : optionalString(input.title, 200) ?? "";
  const date = input.date === undefined
    ? current.date
    : requiredString(input.date, "date", 10);
  const mood = input.mood === undefined
    ? current.mood
    : optionalString(input.mood, 80);
  const tags = input.tags === undefined
    ? parseJson(current.tags, [])
    : Array.isArray(input.tags) ? input.tags.slice(0, 30) : [];
  let contentEncrypted = current.content_encrypted;
  let contentDigest = current.content_digest;
  let kid = current.encryption_kid;
  if (input.content !== undefined) {
    const content = requiredString(input.content, "content", 100_000);
    kid = "journal-v1";
    [contentEncrypted, contentDigest] = await Promise.all([
      encryptField(content, {
        kid,
        kekMaterial: resolveKek(context.env, kid),
      }),
      sha256Hex(content),
  ]);
  }
  await batch(db, [
    [
      `UPDATE journals
       SET revision = ?, updated_at = ?, date = ?, title = ?, title_prefix = ?,
           mood = ?, tags = ?, content_encrypted = ?, encryption_kid = ?,
           encryption_version = ?, content_digest = ?
       WHERE id = ? AND revision = ? AND deleted_at IS NULL`,
      [
        revision,
        updatedAt,
        date,
        title,
        title.slice(0, 16),
        mood,
        JSON.stringify(tags),
        contentEncrypted,
        kid,
        kid,
        contentDigest,
        id,
        expected,
      ],
    ],
    [
      `INSERT INTO journal_revisions (
         id, journal_id, revision, created_at, title, mood, tags,
         content_encrypted, encryption_kid, content_digest
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        newId("journal_revision"),
        id,
        revision,
        updatedAt,
        title,
        mood,
        JSON.stringify(tags),
        contentEncrypted,
        kid,
        contentDigest,
      ],
    ],
    backupStatement("journal", id, revision, updatedAt),
    auditStatement({
      ...context,
      resourceType: "journal",
      resourceId: id,
      action: "UPDATE",
      createdAt: updatedAt,
    }),
  ]);
  return { id, revision, updated_at: updatedAt };
}

export async function setJournalDeletionPlan(
  db,
  id,
  expectedRevision,
  context,
  cancel = false,
) {
  const current = await first(
    db,
    "SELECT revision FROM journals WHERE id = ? AND deleted_at IS NULL",
    [id],
  );
  if (!current) throw new HttpError(404, "not_found", "Journal was not found.");
  const expected = requireRevision(expectedRevision);
  if (current.revision !== expected) {
    throw new HttpError(409, "revision_conflict", "Journal was updated elsewhere.", {
      current_revision: current.revision,
    });
  }
  const updatedAt = nowIso();
  const revision = expected + 1;
  const deletionPlanUntil = cancel
    ? null
    : new Date(Date.parse(updatedAt) + 7 * 24 * 60 * 60 * 1000).toISOString();
  await batch(db, [
    [
      `UPDATE journals
       SET revision = ?, updated_at = ?, deletion_plan_until = ?
       WHERE id = ? AND revision = ? AND deleted_at IS NULL`,
      [revision, updatedAt, deletionPlanUntil, id, expected],
    ],
    backupStatement("journal", id, revision, updatedAt),
    auditStatement({
      ...context,
      resourceType: "journal",
      resourceId: id,
      action: cancel ? "DELETE_PLAN_CANCEL" : "DELETE_PLAN",
      createdAt: updatedAt,
    }),
  ]);
  return {
    id,
    revision,
    updated_at: updatedAt,
    deletion_plan_until: deletionPlanUntil,
  };
}

export async function purgeJournal(db, id, expectedRevision, context) {
  const current = await first(
    db,
    `SELECT revision, deletion_plan_until
     FROM journals WHERE id = ? AND deleted_at IS NULL`,
    [id],
  );
  if (!current) throw new HttpError(404, "not_found", "Journal was not found.");
  const expected = requireRevision(expectedRevision);
  if (current.revision !== expected) {
    throw new HttpError(409, "revision_conflict", "Journal was updated elsewhere.", {
      current_revision: current.revision,
    });
  }
  if (
    !current.deletion_plan_until
    || Date.parse(current.deletion_plan_until) > Date.now()
  ) {
    throw new HttpError(
      409,
      "deletion_plan_active",
      "Journal cannot be purged before the deletion plan expires.",
    );
  }
  const purgedAt = nowIso();
  await batch(db, [
    auditStatement({
      ...context,
      resourceType: "journal",
      resourceId: id,
      action: "PURGE",
      createdAt: purgedAt,
    }),
    ["DELETE FROM journals WHERE id = ? AND revision = ?", [id, expected]],
  ]);
  return { id, purged_at: purgedAt };
}

function assertResourceTable(table) {
  if (!RESOURCE_TABLES.has(table)) {
    throw new HttpError(400, "invalid_resource_type", "Resource type is invalid.");
  }
}

export async function listStructuredRecords(db, table, env) {
  assertResourceTable(table);
  const ordering = table === "daily_checkins"
    ? "date DESC"
    : table === "weekly_reviews"
      ? "week_start DESC"
      : "started_at DESC";
  const rows = await all(
    db,
    `SELECT * FROM ${table}
     WHERE deleted_at IS NULL
     ORDER BY ${ordering}
     LIMIT 100`,
  );
  const resolve = (kid) => resolveKek(env, kid);
  return Promise.all(rows.map(async (row) => {
    const value = { ...row };
    const encryptedFields = table === "daily_checkins"
      ? { anchors_encrypted: "anchors", notes_encrypted: "notes" }
      : table === "weekly_reviews"
        ? { summary_encrypted: "summary" }
        : { body_encrypted: "body" };
    for (const [column, output] of Object.entries(encryptedFields)) {
      value[output] = value[column]
        ? await decryptField(value[column], resolve)
        : null;
      delete value[column];
    }
    const jsonFields = table === "daily_checkins"
      ? ["action_items"]
      : table === "weekly_reviews"
        ? ["goals_hit_rate", "action_items"]
        : ["goals_before", "goals_after", "actions"];
    for (const field of jsonFields) value[field] = parseJson(value[field], []);
    return value;
  }));
}

export async function listHealthDays(db, filters = {}) {
  const bindings = [];
  const where = ["deleted_at IS NULL"];
  if (filters.date_from) {
    where.push("date >= ?");
    bindings.push(filters.date_from);
  }
  if (filters.date_to) {
    where.push("date <= ?");
    bindings.push(filters.date_to);
  }
  return all(
    db,
    `SELECT id, revision, created_at, updated_at, date, sleep_start, sleep_end,
            sleep_duration_min, steps, active_energy_kcal, sleep_quality_device
     FROM health_days
     WHERE ${where.join(" AND ")}
     ORDER BY date DESC
     LIMIT 366`,
    bindings,
  );
}

export async function getHealthDay(db, id, env) {
  const row = await first(
    db,
    `SELECT * FROM health_days WHERE id = ? AND deleted_at IS NULL`,
    [id],
  );
  if (!row) throw new HttpError(404, "not_found", "Health day was not found.");
  const segments = await all(
    db,
    `SELECT id, revision, segment_type, started_at, duration_min,
            value_1_encrypted, value_2_encrypted, source_encrypted,
            encryption_kid
     FROM health_segments
     WHERE health_day_id = ? AND deleted_at IS NULL
     ORDER BY started_at`,
    [id],
  );
  const resolve = (kid) => resolveKek(env, kid);
  return {
    ...row,
    raw_payload: JSON.parse(await decryptField(row.raw_payload_encrypted, resolve)),
    source_device: row.source_device_encrypted
      ? await decryptField(row.source_device_encrypted, resolve)
      : null,
    raw_payload_encrypted: undefined,
    source_device_encrypted: undefined,
    segments: await Promise.all(segments.map(async (segment) => ({
      id: segment.id,
      revision: segment.revision,
      segment_type: segment.segment_type,
      started_at: segment.started_at,
      duration_min: segment.duration_min,
      value_1: segment.value_1_encrypted
        ? await decryptField(segment.value_1_encrypted, resolve)
        : null,
      value_2: segment.value_2_encrypted
        ? await decryptField(segment.value_2_encrypted, resolve)
        : null,
      source: segment.source_encrypted
        ? await decryptField(segment.source_encrypted, resolve)
        : null,
    }))),
  };
}

export async function listHealthSegments(db, healthDayId, env) {
  const day = await first(
    db,
    "SELECT id FROM health_days WHERE id = ? AND deleted_at IS NULL",
    [healthDayId],
  );
  if (!day) throw new HttpError(404, "not_found", "Health day was not found.");
  const rows = await all(
    db,
    `SELECT id, revision, segment_type, started_at, duration_min,
            value_1_encrypted, value_2_encrypted, source_encrypted,
            encryption_kid
     FROM health_segments
     WHERE health_day_id = ? AND deleted_at IS NULL
     ORDER BY started_at`,
    [healthDayId],
  );
  const resolve = (kid) => resolveKek(env, kid);
  return Promise.all(rows.map(async (row) => ({
    id: row.id,
    revision: row.revision,
    segment_type: row.segment_type,
    started_at: row.started_at,
    duration_min: row.duration_min,
    value_1: row.value_1_encrypted
      ? await decryptField(row.value_1_encrypted, resolve)
      : null,
    value_2: row.value_2_encrypted
      ? await decryptField(row.value_2_encrypted, resolve)
      : null,
    source: row.source_encrypted
      ? await decryptField(row.source_encrypted, resolve)
      : null,
  })));
}

export async function getBackupQueue(db, filters = {}) {
  const limit = filters.size ?? 50;
  const boundedLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const status = filters.status;
  const allowedStatuses = new Set([
    "PENDING",
    "SUCCESS",
    "FAILED",
    "RETRYING",
    "SKIPPED",
  ]);
  if (status && !allowedStatuses.has(status)) {
    throw new HttpError(400, "invalid_request", "Backup status filter is invalid.");
  }
  return all(
    db,
    `SELECT id, created_at, resource_type, resource_id, revision, status,
            attempts, next_attempt_at, last_error, completed_at, sync_agent
     FROM backup_exports
     ${status ? "WHERE status = ?" : ""}
     ORDER BY created_at DESC
     LIMIT ?`,
    status ? [status, boundedLimit] : [boundedLimit],
  );
}

export async function getBackupPayload(db, queueId, env) {
  const queue = await first(
    db,
    `SELECT id, resource_type, resource_id, revision, status
     FROM backup_exports WHERE id = ?`,
    [queueId],
  );
  if (!queue) throw new HttpError(404, "not_found", "Backup queue item was not found.");
  const definitions = {
    goal: ["goals", { description_encrypted: "description" }, ["tags"]],
    journal: ["journals", { content_encrypted: "content" }, ["tags"]],
    daily_checkin: [
      "daily_checkins",
      { anchors_encrypted: "anchors", notes_encrypted: "notes" },
      ["action_items"],
    ],
    weekly_review: ["weekly_reviews", { summary_encrypted: "summary" }, [
      "goals_hit_rate",
      "action_items",
    ]],
    phase_review: ["phase_reviews", { body_encrypted: "body" }, [
      "goals_before",
      "goals_after",
      "actions",
    ]],
    health_day: [
      "health_days",
      {
        raw_payload_encrypted: "raw_payload",
        source_device_encrypted: "source_device",
      },
      [],
    ],
  };
  const definition = definitions[queue.resource_type];
  if (!definition) {
    throw new HttpError(400, "invalid_resource_type", "Backup resource type is invalid.");
  }
  const [table, encryptedFields, jsonFields] = definition;
  const row = await first(db, `SELECT * FROM ${table} WHERE id = ?`, [queue.resource_id]);
  if (!row) {
    return {
      queue_id: queue.id,
      resource_type: queue.resource_type,
      resource_id: queue.resource_id,
      revision: queue.revision,
      deleted: true,
      data: null,
    };
  }
  const data = { ...row };
  for (const [column, output] of Object.entries(encryptedFields)) {
    data[output] = data[column]
      ? await decryptField(data[column], (kid) => resolveKek(env, kid))
      : null;
    delete data[column];
  }
  for (const field of jsonFields) data[field] = parseJson(data[field], []);
  return {
    queue_id: queue.id,
    resource_type: queue.resource_type,
    resource_id: queue.resource_id,
    revision: Number(data.revision ?? queue.revision),
    queued_revision: queue.revision,
    deleted: Boolean(data.deleted_at),
    data,
  };
}

export async function reportBackupQueueItem(db, id, input, context) {
  const current = await first(
    db,
    `SELECT id, resource_type, resource_id, revision, attempts
     FROM backup_exports WHERE id = ?`,
    [id],
  );
  if (!current) throw new HttpError(404, "not_found", "Backup queue item was not found.");
  const allowed = new Set(["SUCCESS", "FAILED", "RETRYING", "SKIPPED"]);
  if (!allowed.has(input.status)) {
    throw new HttpError(400, "invalid_request", "Backup status is invalid.");
  }
  const updatedAt = nowIso();
  const attempts = Number(current.attempts ?? 0) + 1;
  const completedAt = ["SUCCESS", "SKIPPED"].includes(input.status) ? updatedAt : null;
  const retryAfter = Math.min(
    Math.max(Number(input.retry_after_seconds) || 0, 0),
    24 * 60 * 60,
  );
  const nextAttemptAt = input.status === "RETRYING"
    ? optionalString(input.next_attempt_at, 40)
      ?? new Date(Date.parse(updatedAt) + retryAfter * 1000).toISOString()
    : null;
  const lastError = input.status === "SUCCESS"
    ? null
    : optionalString(input.error, 512);
  await batch(db, [
    [
      `UPDATE backup_exports
       SET status = ?, attempts = ?, next_attempt_at = ?, last_error = ?,
           completed_at = ?, sync_agent = ?
       WHERE id = ?`,
      [
        input.status,
        attempts,
        nextAttemptAt,
        lastError,
        completedAt,
        optionalString(input.sync_agent, 120),
        id,
      ],
    ],
    auditStatement({
      ...context,
      resourceType: "backup",
      resourceId: id,
      action: "REPORT",
      result: input.status === "SUCCESS" ? "SUCCESS" : input.status,
      createdAt: updatedAt,
    }),
  ]);
  return {
    id,
    status: input.status,
    attempts,
    next_attempt_at: nextAttemptAt,
    completed_at: completedAt,
  };
}

export async function getMigrationState(db) {
  const row = await first(
    db,
    "SELECT * FROM migration_state WHERE singleton_id = 1",
  );
  return {
    ...row,
    plan: parseJson(row?.plan_json, null),
    validation_report: parseJson(row?.validation_report_json, null),
    plan_json: undefined,
    validation_report_json: undefined,
  };
}
