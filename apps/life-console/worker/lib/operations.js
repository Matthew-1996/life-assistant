import { encryptField } from "./crypto.js";
import { all, batch, first } from "./db.js";
import { HttpError } from "./errors.js";
import {
  auditStatement,
  backupStatement,
  idempotencyStatement,
  newId,
  nowIso,
  resolveKek,
} from "./repository.js";

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

function jsonValue(value, fallback) {
  return JSON.stringify(value === undefined ? fallback : value);
}

function requireRevision(value) {
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new HttpError(428, "revision_required", "A valid revision is required.");
  }
  return revision;
}

async function encryptOptional(value, context, kid = "journal-v1") {
  if (value === undefined || value === null || value === "") return null;
  const plaintext = typeof value === "string" ? value : JSON.stringify(value);
  return encryptField(plaintext, {
    kid,
    kekMaterial: resolveKek(context.env, kid),
  });
}

function appendIdempotency(statements, context, response, createdAt) {
  if (!context.idempotency) return;
  statements.push(idempotencyStatement({
    ...context.idempotency,
    response,
    createdAt,
  }));
}

export async function createDailyCheckin(db, input, context) {
  const createdAt = nowIso();
  const id = newId("daily");
  const date = requiredString(input.date, "date", 10);
  const response = { id, revision: 1, date, created_at: createdAt, updated_at: createdAt };
  const [anchorsEncrypted, notesEncrypted] = await Promise.all([
    encryptOptional(input.anchors, context),
    encryptOptional(input.notes, context),
  ]);
  const statements = [
    [
      `INSERT INTO daily_checkins (
         id, revision, created_at, updated_at, encryption_version, date,
         sleep_quality, energy, mood, real_life_score, anchors_encrypted,
         action_items, notes_encrypted, health_day_id
       ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        createdAt,
        createdAt,
        anchorsEncrypted || notesEncrypted ? "journal-v1" : null,
        date,
        optionalString(input.sleep_quality, 40),
        optionalString(input.energy, 40),
        optionalString(input.mood, 40),
        optionalString(input.real_life_score, 40),
        anchorsEncrypted,
        jsonValue(input.action_items, []),
        notesEncrypted,
        optionalString(input.health_day_id, 100),
      ],
    ],
    backupStatement("daily_checkin", id, 1, createdAt),
    auditStatement({
      ...context,
      resourceType: "daily_checkin",
      resourceId: id,
      action: "CREATE",
      createdAt,
    }),
  ];
  appendIdempotency(statements, context, response, createdAt);
  await batch(db, statements);
  return response;
}

export async function createWeeklyReview(db, input, context) {
  const createdAt = nowIso();
  const id = newId("weekly");
  const weekStart = requiredString(input.week_start, "week_start", 10);
  const response = {
    id,
    revision: 1,
    week_start: weekStart,
    created_at: createdAt,
    updated_at: createdAt,
  };
  const summaryEncrypted = await encryptOptional(input.summary, context);
  const statements = [
    [
      `INSERT INTO weekly_reviews (
         id, revision, created_at, updated_at, encryption_version, week_start,
         summary_encrypted, goals_hit_rate, action_items
       ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        createdAt,
        createdAt,
        summaryEncrypted ? "journal-v1" : null,
        weekStart,
        summaryEncrypted,
        jsonValue(input.goals_hit_rate, {}),
        jsonValue(input.action_items, []),
      ],
    ],
    backupStatement("weekly_review", id, 1, createdAt),
    auditStatement({
      ...context,
      resourceType: "weekly_review",
      resourceId: id,
      action: "CREATE",
      createdAt,
    }),
  ];
  appendIdempotency(statements, context, response, createdAt);
  await batch(db, statements);
  return response;
}

export async function createPhaseReview(db, input, context) {
  const createdAt = nowIso();
  const id = newId("phase");
  const phaseName = requiredString(input.phase_name, "phase_name", 200);
  const response = {
    id,
    revision: 1,
    phase_name: phaseName,
    created_at: createdAt,
    updated_at: createdAt,
  };
  const bodyEncrypted = await encryptOptional(input.body, context);
  const statements = [
    [
      `INSERT INTO phase_reviews (
         id, revision, created_at, updated_at, encryption_version, phase_name,
         started_at, ended_at, body_encrypted, goals_before, goals_after, actions
       ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        createdAt,
        createdAt,
        bodyEncrypted ? "journal-v1" : null,
        phaseName,
        optionalString(input.started_at, 40),
        optionalString(input.ended_at, 40),
        bodyEncrypted,
        jsonValue(input.goals_before, []),
        jsonValue(input.goals_after, []),
        jsonValue(input.actions, []),
      ],
    ],
    backupStatement("phase_review", id, 1, createdAt),
    auditStatement({
      ...context,
      resourceType: "phase_review",
      resourceId: id,
      action: "CREATE",
      createdAt,
    }),
  ];
  appendIdempotency(statements, context, response, createdAt);
  await batch(db, statements);
  return response;
}

const STRUCTURED_CONFIG = {
  daily_checkins: {
    resource: "daily_checkin",
    encrypted: { anchors: "anchors_encrypted", notes: "notes_encrypted" },
    plain: [
      "sleep_quality",
      "energy",
      "mood",
      "real_life_score",
      "health_day_id",
    ],
    json: ["action_items"],
  },
  weekly_reviews: {
    resource: "weekly_review",
    encrypted: { summary: "summary_encrypted" },
    plain: [],
    json: ["goals_hit_rate", "action_items"],
  },
  phase_reviews: {
    resource: "phase_review",
    encrypted: { body: "body_encrypted" },
    plain: ["phase_name", "started_at", "ended_at"],
    json: ["goals_before", "goals_after", "actions"],
  },
};

export async function updateStructuredRecord(
  db,
  table,
  id,
  expectedRevision,
  input,
  context,
) {
  const config = STRUCTURED_CONFIG[table];
  if (!config) throw new HttpError(400, "invalid_resource_type", "Resource type is invalid.");
  const current = await first(
    db,
    `SELECT * FROM ${table} WHERE id = ? AND deleted_at IS NULL`,
    [id],
  );
  if (!current) throw new HttpError(404, "not_found", "Record was not found.");
  const expected = requireRevision(expectedRevision);
  if (current.revision !== expected) {
    throw new HttpError(409, "revision_conflict", "Record was updated elsewhere.", {
      current_revision: current.revision,
    });
  }
  const updates = [];
  const bindings = [];
  let usesEncryption = Boolean(current.encryption_version);
  for (const field of config.plain) {
    if (input[field] !== undefined) {
      updates.push(`${field} = ?`);
      bindings.push(optionalString(input[field], 10_000));
    }
  }
  for (const field of config.json) {
    if (input[field] !== undefined) {
      updates.push(`${field} = ?`);
      bindings.push(JSON.stringify(input[field]));
    }
  }
  for (const [inputField, column] of Object.entries(config.encrypted)) {
    if (input[inputField] !== undefined) {
      updates.push(`${column} = ?`);
      const encrypted = await encryptOptional(input[inputField], context);
      bindings.push(encrypted);
      usesEncryption ||= Boolean(encrypted);
    }
  }
  if (!updates.length) {
    throw new HttpError(400, "invalid_request", "No supported fields were provided.");
  }
  const revision = expected + 1;
  const updatedAt = nowIso();
  updates.push("revision = ?", "updated_at = ?", "encryption_version = ?");
  bindings.push(revision, updatedAt, usesEncryption ? "journal-v1" : null, id, expected);
  await batch(db, [
    [
      `UPDATE ${table} SET ${updates.join(", ")}
       WHERE id = ? AND revision = ? AND deleted_at IS NULL`,
      bindings,
    ],
    backupStatement(config.resource, id, revision, updatedAt),
    auditStatement({
      ...context,
      resourceType: config.resource,
      resourceId: id,
      action: "UPDATE",
      createdAt: updatedAt,
    }),
  ]);
  return { id, revision, updated_at: updatedAt };
}

export async function softDeleteStructuredRecord(
  db,
  table,
  id,
  expectedRevision,
  context,
) {
  const config = STRUCTURED_CONFIG[table];
  if (!config) throw new HttpError(400, "invalid_resource_type", "Resource type is invalid.");
  const current = await first(
    db,
    `SELECT revision FROM ${table} WHERE id = ? AND deleted_at IS NULL`,
    [id],
  );
  if (!current) throw new HttpError(404, "not_found", "Record was not found.");
  const expected = requireRevision(expectedRevision);
  if (current.revision !== expected) {
    throw new HttpError(409, "revision_conflict", "Record was updated elsewhere.", {
      current_revision: current.revision,
    });
  }
  const revision = expected + 1;
  const deletedAt = nowIso();
  await batch(db, [
    [
      `UPDATE ${table}
       SET revision = ?, updated_at = ?, deleted_at = ?
       WHERE id = ? AND revision = ? AND deleted_at IS NULL`,
      [revision, deletedAt, deletedAt, id, expected],
    ],
    backupStatement(config.resource, id, revision, deletedAt),
    auditStatement({
      ...context,
      resourceType: config.resource,
      resourceId: id,
      action: "DELETE",
      createdAt: deletedAt,
    }),
  ]);
  return { id, revision, deleted_at: deletedAt };
}

export async function importHealthDay(db, input, context) {
  const createdAt = nowIso();
  const id = newId("health_day");
  const date = requiredString(input.date, "date", 10);
  const rawPayload = input.raw_payload ?? input;
  const kid = "health-v1";
  const rawPayloadEncrypted = await encryptField(JSON.stringify(rawPayload), {
    kid,
    kekMaterial: resolveKek(context.env, kid),
  });
  const sourceDeviceEncrypted = await encryptOptional(
    input.source_device,
    context,
    kid,
  );
  const segments = Array.isArray(input.segments) ? input.segments.slice(0, 10_000) : [];
  const response = {
    id,
    revision: 1,
    date,
    segments: segments.length,
    created_at: createdAt,
    updated_at: createdAt,
  };
  const statements = [
    [
      `INSERT INTO health_days (
         id, revision, created_at, updated_at, encryption_version, date,
         sleep_start, sleep_end, sleep_duration_min, steps, active_energy_kcal,
         sleep_quality_device, raw_payload_encrypted, source_device_encrypted,
         encryption_kid
       ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        createdAt,
        createdAt,
        kid,
        date,
        optionalString(input.sleep_start, 40),
        optionalString(input.sleep_end, 40),
        input.sleep_duration_min ?? null,
        input.steps ?? null,
        input.active_energy_kcal ?? null,
        optionalString(input.sleep_quality_device, 80),
        rawPayloadEncrypted,
        sourceDeviceEncrypted,
        kid,
      ],
    ],
  ];
  for (const segment of segments) {
    const [value1, value2, source] = await Promise.all([
      encryptOptional(segment.value_1, context, kid),
      encryptOptional(segment.value_2, context, kid),
      encryptOptional(segment.source, context, kid),
    ]);
    statements.push([
      `INSERT INTO health_segments (
         id, revision, created_at, updated_at, encryption_version,
         health_day_id, segment_type, started_at, duration_min,
         value_1_encrypted, value_2_encrypted, source_encrypted, encryption_kid
       ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        newId("health_segment"),
        createdAt,
        createdAt,
        kid,
        id,
        requiredString(segment.segment_type, "segment_type", 80),
        requiredString(segment.started_at, "started_at", 40),
        Number(segment.duration_min),
        value1,
        value2,
        source,
        kid,
      ],
    ]);
  }
  statements.push(
    backupStatement("health_day", id, 1, createdAt),
    auditStatement({
      ...context,
      resourceType: "health_day",
      resourceId: id,
      action: "CREATE",
      createdAt,
    }),
  );
  appendIdempotency(statements, context, response, createdAt);
  await batch(db, statements);
  return response;
}

export async function updateHealthDay(db, id, expectedRevision, input, context) {
  const current = await first(
    db,
    "SELECT revision FROM health_days WHERE id = ? AND deleted_at IS NULL",
    [id],
  );
  if (!current) throw new HttpError(404, "not_found", "Health day was not found.");
  const expected = requireRevision(expectedRevision);
  if (current.revision !== expected) {
    throw new HttpError(409, "revision_conflict", "Health day was updated elsewhere.", {
      current_revision: current.revision,
    });
  }
  const allowedFields = [
    "sleep_start",
    "sleep_end",
    "sleep_duration_min",
    "steps",
    "active_energy_kcal",
    "sleep_quality_device",
  ];
  const textFields = new Set(["sleep_start", "sleep_end", "sleep_quality_device"]);
  const updates = [];
  const bindings = [];
  for (const field of allowedFields) {
    if (input[field] === undefined) continue;
    updates.push(`${field} = ?`);
    bindings.push(textFields.has(field)
      ? optionalString(input[field], 80)
      : input[field] === null ? null : Number(input[field]));
  }
  if (!updates.length) {
    throw new HttpError(400, "invalid_request", "No supported health fields were provided.");
  }
  const revision = expected + 1;
  const updatedAt = nowIso();
  updates.push("revision = ?", "updated_at = ?");
  bindings.push(revision, updatedAt, id, expected);
  await batch(db, [
    [
      `UPDATE health_days SET ${updates.join(", ")}
       WHERE id = ? AND revision = ? AND deleted_at IS NULL`,
      bindings,
    ],
    backupStatement("health_day", id, revision, updatedAt),
    auditStatement({
      ...context,
      resourceType: "health_day",
      resourceId: id,
      action: "UPDATE",
      createdAt: updatedAt,
    }),
  ]);
  return { id, revision, updated_at: updatedAt };
}

export async function planMigration(db, input, context) {
  const current = await first(db, "SELECT phase FROM migration_state WHERE singleton_id = 1");
  if (!["NOT_STARTED", "ROLLED_BACK"].includes(current?.phase)) {
    throw new HttpError(409, "migration_phase_invalid", "Migration cannot be planned now.");
  }
  const updatedAt = nowIso();
  const batchId = newId("migration");
  const plan = {
    batch_id: batchId,
    expected_counts: input.expected_counts ?? {},
    rollback_days: 7,
    direction: "icloud-to-d1-once",
  };
  await batch(db, [
    [
      `UPDATE migration_state
       SET phase = 'PLANNING', batch_id = ?, plan_json = ?,
           validation_report_json = NULL, updated_at = ?
       WHERE singleton_id = 1`,
      [batchId, JSON.stringify(plan), updatedAt],
    ],
    auditStatement({
      ...context,
      resourceType: "migration",
      resourceId: batchId,
      action: "PLAN",
      createdAt: updatedAt,
    }),
  ]);
  return { phase: "PLANNING", ...plan, updated_at: updatedAt };
}

export async function recordMigrationValidation(db, input, context) {
  const current = await first(
    db,
    "SELECT phase, batch_id FROM migration_state WHERE singleton_id = 1",
  );
  if (!["PLANNING", "VALIDATING"].includes(current?.phase)) {
    throw new HttpError(409, "migration_phase_invalid", "Migration cannot be validated now.");
  }
  const checks = input.checks ?? {};
  const requiredChecks = [
    "counts_match",
    "ids_match",
    "revisions_monotonic",
    "digests_match",
    "encryption_round_trip",
  ];
  const passed = requiredChecks.every((name) => checks[name] === true);
  const phase = passed ? "READY_TO_SWITCH" : "VALIDATING";
  const updatedAt = nowIso();
  const report = {
    checks: Object.fromEntries(requiredChecks.map((name) => [
      name,
      checks[name] === true,
    ])),
    passed,
    validated_at: updatedAt,
  };
  await batch(db, [
    [
      `UPDATE migration_state
       SET phase = ?, validation_report_json = ?, updated_at = ?
       WHERE singleton_id = 1`,
      [phase, JSON.stringify(report), updatedAt],
    ],
    auditStatement({
      ...context,
      resourceType: "migration",
      resourceId: current.batch_id,
      action: "VALIDATE",
      result: passed ? "SUCCESS" : "FAIL",
      createdAt: updatedAt,
    }),
  ]);
  return { phase, report, updated_at: updatedAt };
}

export async function switchTruthSource(db, confirmation, context) {
  if (confirmation !== "CONFIRM SWITCH") {
    throw new HttpError(400, "confirmation_required", "Exact switch confirmation is required.");
  }
  const current = await first(
    db,
    "SELECT phase, batch_id FROM migration_state WHERE singleton_id = 1",
  );
  if (current?.phase !== "READY_TO_SWITCH") {
    throw new HttpError(409, "migration_phase_invalid", "Migration is not ready to switch.");
  }
  const switchedAt = nowIso();
  const rollbackUntil = new Date(
    Date.parse(switchedAt) + 7 * 24 * 60 * 60 * 1000,
  ).toISOString();
  await batch(db, [
    [
      `UPDATE migration_state
       SET phase = 'SWITCHED', source_truth = 'SITES_D1_PRIMARY',
           switched_at = ?, rollback_window_until = ?, updated_at = ?
       WHERE singleton_id = 1`,
      [switchedAt, rollbackUntil, switchedAt],
    ],
    auditStatement({
      ...context,
      resourceType: "migration",
      resourceId: current.batch_id,
      action: "SOURCE_SWITCH",
      createdAt: switchedAt,
    }),
  ]);
  return {
    phase: "SWITCHED",
    source_truth: "SITES_D1_PRIMARY",
    switched_at: switchedAt,
    rollback_window_until: rollbackUntil,
  };
}

export async function rollbackTruthSource(db, confirmation, context) {
  if (confirmation !== "CONFIRM ROLLBACK") {
    throw new HttpError(400, "confirmation_required", "Exact rollback confirmation is required.");
  }
  const current = await first(
    db,
    `SELECT phase, batch_id, switched_at, rollback_window_until
     FROM migration_state WHERE singleton_id = 1`,
  );
  if (
    current?.phase !== "SWITCHED"
    || !current.rollback_window_until
    || Date.parse(current.rollback_window_until) < Date.now()
  ) {
    throw new HttpError(409, "rollback_unavailable", "Rollback window is not available.");
  }
  if (!context.env.BACKUP_BUCKET?.put) {
    throw new HttpError(503, "backup_not_configured", "R2 backup bucket is not configured.");
  }
  const tables = [
    "goals",
    "journals",
    "daily_checkins",
    "weekly_reviews",
    "phase_reviews",
    "health_days",
  ];
  const increment = {};
  for (const table of tables) {
    increment[table] = await all(
      db,
      `SELECT * FROM ${table} WHERE created_at >= ? OR updated_at >= ?`,
      [current.switched_at, current.switched_at],
    );
  }
  const manifest = {
    v: 1,
    batch_id: current.batch_id,
    switched_at: current.switched_at,
    exported_at: nowIso(),
    increment,
  };
  const encrypted = await encryptField(JSON.stringify(manifest), {
    kid: "backup-v1",
    kekMaterial: resolveKek(context.env, "backup-v1"),
  });
  const objectKey = `rolled-back-pending/${current.batch_id}.json.enc`;
  await context.env.BACKUP_BUCKET.put(objectKey, encrypted, {
    httpMetadata: { contentType: "application/octet-stream" },
  });
  const rolledBackAt = nowIso();
  await batch(db, [
    [
      `UPDATE migration_state
       SET phase = 'ROLLED_BACK', source_truth = 'ICLOUD_PRIMARY',
           rolled_back_at = ?, updated_at = ?
       WHERE singleton_id = 1`,
      [rolledBackAt, rolledBackAt],
    ],
    auditStatement({
      ...context,
      resourceType: "migration",
      resourceId: current.batch_id,
      action: "ROLLBACK",
      result: "ROLLED_BACK",
      createdAt: rolledBackAt,
    }),
  ]);
  return {
    phase: "ROLLED_BACK",
    source_truth: "ICLOUD_PRIMARY",
    rolled_back_at: rolledBackAt,
    increment_object: objectKey,
  };
}
