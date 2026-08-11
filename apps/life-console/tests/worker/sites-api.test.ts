import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error The deployed Worker is intentionally framework-free JavaScript.
import worker from "../../worker/sites-200.js";
import {
  decryptWithPassphrase,
  generateKekMaterial,
} from "../../worker/lib/crypto.js";
import { D1TestDatabase } from "./helpers/d1";

const origin = "https://example.test";
const owner = "synthetic-owner";

describe("Life Console 2.0.0 synthetic Sites API", () => {
  let d1: D1TestDatabase;
  let env: Record<string, unknown>;
  let bucketObjects: Map<string, string>;

  beforeEach(() => {
    d1 = new D1TestDatabase();
    bucketObjects = new Map();
    env = {
      DB: d1,
      ASSETS: { fetch: vi.fn() },
      ALLOW_SYNTHETIC_AUTH: "true",
      SYNTHETIC_OWNER_ID: owner,
      SESSION_SECRET: "synthetic-session-secret-at-least-32-characters",
      SITE_ORIGIN: origin,
      ENVIRONMENT: "test",
      KEK_JOURNAL_V1: generateKekMaterial(),
      KEK_HEALTH_V1: generateKekMaterial(),
      KEK_BACKUP_V1: generateKekMaterial(),
      BACKUP_BUCKET: {
        put: vi.fn(async (key: string, value: string) => {
          bucketObjects.set(key, value);
        }),
        get: vi.fn(async (key: string) => {
          const value = bucketObjects.get(key);
          return value === undefined ? null : { text: async () => value };
        }),
      },
    };
  });

  afterEach(() => {
    d1.close();
  });

  function headers(extra: Record<string, string> = {}) {
    return {
      "X-Synthetic-Owner": owner,
      ...extra,
    };
  }

  async function csrfToken() {
    const response = await worker.fetch(
      new Request(`${origin}/api/v1/auth/csrf`, {
        method: "POST",
        headers: headers({ Origin: origin }),
      }),
      env,
    );
    expect(response.status).toBe(200);
    return (await response.json() as { token: string }).token;
  }

  it("returns owner and empty bootstrap state", async () => {
    const [ownerResponse, bootstrapResponse] = await Promise.all([
      worker.fetch(
        new Request(`${origin}/api/v1/auth/me`, { headers: headers() }),
        env,
      ),
      worker.fetch(
        new Request(`${origin}/api/v1/bootstrap`, { headers: headers() }),
        env,
      ),
    ]);

    expect(ownerResponse.status).toBe(200);
    expect(await ownerResponse.json()).toEqual(expect.objectContaining({
      role: "owner",
      version: "2.0.0",
    }));
    expect(await bootstrapResponse.json()).toEqual(expect.objectContaining({
      goals: [],
      journals: [],
      health: [],
      system: expect.objectContaining({
        source_truth: "ICLOUD_PRIMARY",
      }),
    }));
  });

  it("accepts the authenticated owner header supplied by Sites", async () => {
    const platformEnv = {
      ...env,
      ALLOW_SYNTHETIC_AUTH: "false",
      SYNTHETIC_OWNER_ID: undefined,
    };
    const response = await worker.fetch(
      new Request(`${origin}/api/v1/auth/me`, {
        headers: { "oai-authenticated-user-id": owner },
      }),
      platformEnv,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expect.objectContaining({ role: "owner" }));
  });

  it("creates a goal once for a repeated idempotency key", async () => {
    const csrf = await csrfToken();
    const requestInit = {
      method: "POST",
      headers: headers({
        Origin: origin,
        "Content-Type": "application/json",
        "X-Life-CSRF": csrf,
        "Idempotency-Key": "synthetic-goal-key",
      }),
      body: JSON.stringify({
        title: "合成恢复目标",
        status: "focus",
        priority_order: 1,
        tags: ["synthetic"],
      }),
    };

    const first = await worker.fetch(
      new Request(`${origin}/api/v1/goals`, requestInit),
      env,
    );
    const repeated = await worker.fetch(
      new Request(`${origin}/api/v1/goals`, requestInit),
      env,
    );

    expect(first.status).toBe(200);
    expect(await repeated.json()).toEqual(await first.clone().json());
    expect(
      d1.database.prepare("SELECT COUNT(*) AS count FROM goals").get(),
    ).toEqual({ count: 1 });
    expect(
      d1.database.prepare("SELECT COUNT(*) AS count FROM audit_events").get(),
    ).toEqual({ count: 1 });
  });

  it("encrypts journal content and rejects stale revisions", async () => {
    const csrf = await csrfToken();
    const createResponse = await worker.fetch(
      new Request(`${origin}/api/v1/journals`, {
        method: "POST",
        headers: headers({
          Origin: origin,
          "Content-Type": "application/json",
          "X-Life-CSRF": csrf,
          "Idempotency-Key": "synthetic-journal-key",
        }),
        body: JSON.stringify({
          date: "2026-01-12",
          title: "合成日记",
          content: "这是一段只用于测试的合成原文。",
          tags: ["synthetic"],
        }),
      }),
      env,
    );
    const created = await createResponse.json() as { id: string };
    const stored = d1.database.prepare(
      "SELECT content_encrypted FROM journals WHERE id = ?",
    ).get(created.id) as { content_encrypted: string };
    expect(stored.content_encrypted).not.toContain("合成原文");

    const readResponse = await worker.fetch(
      new Request(`${origin}/api/v1/journals/${created.id}`, {
        headers: headers(),
      }),
      env,
    );
    expect(await readResponse.json()).toEqual(expect.objectContaining({
      content: "这是一段只用于测试的合成原文。",
    }));

    const updateHeaders = headers({
      Origin: origin,
      "Content-Type": "application/json",
      "X-Life-CSRF": csrf,
      "If-Match": "1",
    });
    const updated = await worker.fetch(
      new Request(`${origin}/api/v1/journals/${created.id}`, {
        method: "PATCH",
        headers: updateHeaders,
        body: JSON.stringify({ content: "合成更新原文。" }),
      }),
      env,
    );
    expect(updated.status).toBe(200);

    const conflict = await worker.fetch(
      new Request(`${origin}/api/v1/journals/${created.id}`, {
        method: "PATCH",
        headers: updateHeaders,
        body: JSON.stringify({ content: "过期提交。" }),
      }),
      env,
    );
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual(expect.objectContaining({
      error: expect.objectContaining({ code: "revision_conflict" }),
    }));
  });

  it("rejects writes without same-origin and CSRF protection", async () => {
    const response = await worker.fetch(
      new Request(`${origin}/api/v1/goals`, {
        method: "POST",
        headers: headers({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          title: "不应保存",
          status: "focus",
          priority_order: 1,
        }),
      }),
      env,
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual(expect.objectContaining({
      error: expect.objectContaining({ code: "origin_rejected" }),
    }));
  });

  it("creates encrypted daily reviews and health imports", async () => {
    const csrf = await csrfToken();
    const baseHeaders = headers({
      Origin: origin,
      "Content-Type": "application/json",
      "X-Life-CSRF": csrf,
    });
    const daily = await worker.fetch(
      new Request(`${origin}/api/v1/daily-checkins`, {
        method: "POST",
        headers: {
          ...baseHeaders,
          "Idempotency-Key": "synthetic-daily-key",
        },
        body: JSON.stringify({
          date: "2026-01-12",
          energy: "3",
          anchors: { life_action: "minimum" },
          notes: "合成状态备注",
        }),
      }),
      env,
    );
    expect(daily.status).toBe(200);

    const health = await worker.fetch(
      new Request(`${origin}/api/v1/health/import`, {
        method: "POST",
        headers: {
          ...baseHeaders,
          "Idempotency-Key": "synthetic-health-key",
        },
        body: JSON.stringify({
          date: "2026-01-12",
          sleep_duration_min: 420,
          steps: 5200,
          raw_payload: { source: "synthetic", samples: [1, 2] },
          source_device: "Synthetic Watch",
          segments: [{
            segment_type: "sleep_core",
            started_at: "2026-01-12T00:00:00Z",
            duration_min: 60,
            source: "synthetic",
          }],
        }),
      }),
      env,
    );
    expect(health.status).toBe(200);

    const storedDaily = d1.database.prepare(
      "SELECT anchors_encrypted, notes_encrypted FROM daily_checkins",
    ).get() as { anchors_encrypted: string; notes_encrypted: string };
    expect(storedDaily.anchors_encrypted).not.toContain("life_action");
    expect(storedDaily.notes_encrypted).not.toContain("合成状态备注");
    const storedHealth = d1.database.prepare(
      "SELECT raw_payload_encrypted, source_device_encrypted FROM health_days",
    ).get() as {
      raw_payload_encrypted: string;
      source_device_encrypted: string;
    };
    expect(storedHealth.raw_payload_encrypted).not.toContain("samples");
    expect(storedHealth.source_device_encrypted).not.toContain("Synthetic Watch");
  });

  it("enforces the migration state machine and writes encrypted rollback increment", async () => {
    const csrf = await csrfToken();
    const writeHeaders = headers({
      Origin: origin,
      "Content-Type": "application/json",
      "X-Life-CSRF": csrf,
    });
    const plan = await worker.fetch(
      new Request(`${origin}/api/v1/migration/plan`, {
        method: "POST",
        headers: writeHeaders,
        body: JSON.stringify({
          expected_counts: { journals: 1, health_days: 1 },
        }),
      }),
      env,
    );
    expect(await plan.json()).toEqual(expect.objectContaining({
      phase: "PLANNING",
      direction: "icloud-to-d1-once",
    }));

    const validate = await worker.fetch(
      new Request(`${origin}/api/v1/migration/validate`, {
        method: "POST",
        headers: writeHeaders,
        body: JSON.stringify({
          checks: {
            counts_match: true,
            ids_match: true,
            revisions_monotonic: true,
            digests_match: true,
            encryption_round_trip: true,
          },
        }),
      }),
      env,
    );
    expect(await validate.json()).toEqual(expect.objectContaining({
      phase: "READY_TO_SWITCH",
    }));

    const switched = await worker.fetch(
      new Request(`${origin}/api/v1/migration/switch`, {
        method: "POST",
        headers: writeHeaders,
        body: JSON.stringify({ confirmation: "CONFIRM SWITCH" }),
      }),
      env,
    );
    expect(await switched.json()).toEqual(expect.objectContaining({
      phase: "SWITCHED",
      source_truth: "SITES_D1_PRIMARY",
    }));

    const rolledBack = await worker.fetch(
      new Request(`${origin}/api/v1/migration/rollback`, {
        method: "POST",
        headers: writeHeaders,
        body: JSON.stringify({ confirmation: "CONFIRM ROLLBACK" }),
      }),
      env,
    );
    expect(await rolledBack.json()).toEqual(expect.objectContaining({
      phase: "ROLLED_BACK",
      source_truth: "ICLOUD_PRIMARY",
    }));
    expect(
      (env.BACKUP_BUCKET as { put: ReturnType<typeof vi.fn> }).put,
    ).toHaveBeenCalledWith(
      expect.stringMatching(/^rolled-back-pending\/migration_.+\.json\.enc$/),
      expect.not.stringContaining("expected_counts"),
      expect.objectContaining({
        httpMetadata: { contentType: "application/octet-stream" },
      }),
    );
  });

  it("returns decrypted structured reviews without exposing encrypted columns", async () => {
    const csrf = await csrfToken();
    const writeHeaders = headers({
      Origin: origin,
      "Content-Type": "application/json",
      "X-Life-CSRF": csrf,
    });
    const weekly = await worker.fetch(
      new Request(`${origin}/api/v1/weekly-reviews`, {
        method: "POST",
        headers: {
          ...writeHeaders,
          "Idempotency-Key": "synthetic-weekly-key",
        },
        body: JSON.stringify({
          week_start: "2026-01-12",
          summary: "合成周复盘正文",
          goals_hit_rate: { focus: 0.8 },
          action_items: ["synthetic"],
        }),
      }),
      env,
    );
    expect(weekly.status).toBe(200);

    const phase = await worker.fetch(
      new Request(`${origin}/api/v1/phase-reviews`, {
        method: "POST",
        headers: {
          ...writeHeaders,
          "Idempotency-Key": "synthetic-phase-key",
        },
        body: JSON.stringify({
          phase_name: "合成阶段",
          body: "合成阶段复盘正文",
          goals_before: ["before"],
          goals_after: ["after"],
        }),
      }),
      env,
    );
    expect(phase.status).toBe(200);

    const weeklyList = await worker.fetch(
      new Request(`${origin}/api/v1/weekly-reviews`, { headers: headers() }),
      env,
    );
    const weeklyBody = await weeklyList.json() as { items: Record<string, unknown>[] };
    expect(weeklyBody.items[0]).toEqual(expect.objectContaining({
      summary: "合成周复盘正文",
      goals_hit_rate: { focus: 0.8 },
    }));
    expect(weeklyBody.items[0]).not.toHaveProperty("summary_encrypted");

    const phaseList = await worker.fetch(
      new Request(`${origin}/api/v1/phase-reviews`, { headers: headers() }),
      env,
    );
    const phaseBody = await phaseList.json() as { items: Record<string, unknown>[] };
    expect(phaseBody.items[0]).toEqual(expect.objectContaining({
      body: "合成阶段复盘正文",
      goals_before: ["before"],
      goals_after: ["after"],
    }));
    expect(phaseBody.items[0]).not.toHaveProperty("body_encrypted");
  });

  it("updates health trends and exposes segments through the dedicated endpoint", async () => {
    const csrf = await csrfToken();
    const writeHeaders = headers({
      Origin: origin,
      "Content-Type": "application/json",
      "X-Life-CSRF": csrf,
    });
    const imported = await worker.fetch(
      new Request(`${origin}/api/v1/health/import`, {
        method: "POST",
        headers: {
          ...writeHeaders,
          "Idempotency-Key": "synthetic-health-update-key",
        },
        body: JSON.stringify({
          date: "2026-01-13",
          steps: 5000,
          raw_payload: { source: "synthetic" },
          segments: [{
            segment_type: "sleep_deep",
            started_at: "2026-01-13T01:00:00Z",
            duration_min: 45,
            value_1: "synthetic-value",
          }],
        }),
      }),
      env,
    );
    const created = await imported.json() as { id: string };

    const updated = await worker.fetch(
      new Request(`${origin}/api/v1/health/days/${created.id}`, {
        method: "PATCH",
        headers: {
          ...writeHeaders,
          "If-Match": "1",
        },
        body: JSON.stringify({ steps: 6200, active_energy_kcal: 320 }),
      }),
      env,
    );
    expect(updated.status).toBe(200);
    expect(await updated.json()).toEqual(expect.objectContaining({ revision: 2 }));

    const segments = await worker.fetch(
      new Request(`${origin}/api/v1/health/days/${created.id}/segments`, {
        headers: headers(),
      }),
      env,
    );
    expect(await segments.json()).toEqual({
      items: [expect.objectContaining({
        segment_type: "sleep_deep",
        value_1: "synthetic-value",
      })],
    });
  });

  it("filters raw-free audit events and reports backup queue outcomes", async () => {
    const csrf = await csrfToken();
    const writeHeaders = headers({
      Origin: origin,
      "Content-Type": "application/json",
      "X-Life-CSRF": csrf,
    });
    await worker.fetch(
      new Request(`${origin}/api/v1/goals`, {
        method: "POST",
        headers: {
          ...writeHeaders,
          "Idempotency-Key": "synthetic-audit-goal-key",
        },
        body: JSON.stringify({
          title: "合成审计目标",
          status: "focus",
          priority_order: 1,
        }),
      }),
      env,
    );

    const audit = await worker.fetch(
      new Request(`${origin}/api/v1/audit/events?resource_type=goal&action=CREATE`, {
        headers: headers(),
      }),
      env,
    );
    const auditBody = await audit.json() as { items: Record<string, unknown>[] };
    expect(auditBody.items).toHaveLength(1);
    expect(auditBody.items[0]).toEqual(expect.objectContaining({
      resource_type: "goal",
      action: "CREATE",
    }));
    expect(JSON.stringify(auditBody)).not.toContain("合成审计目标");

    const queue = d1.database.prepare(
      "SELECT id FROM backup_exports ORDER BY created_at DESC LIMIT 1",
    ).get() as { id: string };
    d1.database.prepare(
      "UPDATE backup_exports SET status = 'SUCCESS' WHERE id = ?",
    ).run(queue.id);
    const pendingOnly = await worker.fetch(
      new Request(`${origin}/api/v1/backup/queue?status=PENDING`, {
        headers: headers(),
      }),
      env,
    );
    expect(await pendingOnly.json()).toEqual({ items: [] });
    d1.database.prepare(
      "UPDATE backup_exports SET status = 'PENDING' WHERE id = ?",
    ).run(queue.id);
    const payload = await worker.fetch(
      new Request(`${origin}/api/v1/backup/queue/${queue.id}/payload`, {
        headers: headers(),
      }),
      env,
    );
    expect(await payload.json()).toEqual(expect.objectContaining({
      queue_id: queue.id,
      resource_type: "goal",
      revision: 1,
      deleted: false,
      data: expect.objectContaining({ title: "合成审计目标" }),
    }));
    const reported = await worker.fetch(
      new Request(`${origin}/api/v1/backup/queue/${queue.id}/report`, {
        method: "POST",
        headers: writeHeaders,
        body: JSON.stringify({
          status: "SUCCESS",
          sync_agent: "synthetic-agent",
        }),
      }),
      env,
    );
    expect(reported.status).toBe(200);
    expect(await reported.json()).toEqual(expect.objectContaining({
      id: queue.id,
      status: "SUCCESS",
    }));
  });

  it("writes encrypted full backups and passphrase-protected recovery packs to R2", async () => {
    const csrf = await csrfToken();
    const writeHeaders = headers({
      Origin: origin,
      "Content-Type": "application/json",
      "X-Life-CSRF": csrf,
    });
    const backup = await worker.fetch(
      new Request(`${origin}/api/v1/backup/trigger`, {
        method: "POST",
        headers: writeHeaders,
        body: JSON.stringify({ reason: "synthetic-manual" }),
      }),
      env,
    );
    expect(backup.status).toBe(200);
    expect(await backup.json()).toEqual(expect.objectContaining({
      object_key: expect.stringMatching(/^full-backups\/.+\.json\.enc$/),
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));

    const recovery = await worker.fetch(
      new Request(`${origin}/api/v1/crypto/recovery-pack`, {
        method: "POST",
        headers: writeHeaders,
        body: JSON.stringify({
          passphrase: "synthetic-passphrase-2026",
          confirmation: "synthetic-passphrase-2026",
          acknowledged: true,
        }),
      }),
      env,
    );
    expect(recovery.status).toBe(200);
    expect(await recovery.json()).toEqual(expect.objectContaining({
      object_key: expect.stringMatching(/^recovery-packs\/.+\.zip\.enc$/),
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
    const calls = (env.BACKUP_BUCKET as {
      put: ReturnType<typeof vi.fn>;
    }).put.mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][1]).not.toContain("goals");
    expect(calls[1][1]).not.toContain(env.KEK_JOURNAL_V1 as string);
    expect(await decryptWithPassphrase(
      calls[1][1],
      "synthetic-passphrase-2026",
    )).toMatch(/^UEsDB/u);

    const recoveryKey = calls[1][0] as string;
    const verified = await worker.fetch(
      new Request(`${origin}/api/v1/crypto/verify-recovery-pack`, {
        method: "POST",
        headers: writeHeaders,
        body: JSON.stringify({
          object_key: recoveryKey,
          passphrase: "synthetic-passphrase-2026",
        }),
      }),
      env,
    );
    expect(await verified.json()).toEqual(expect.objectContaining({
      verified: true,
      key_ids: expect.arrayContaining(["journal-v1", "health-v1", "backup-v1"]),
    }));
  });

  it("rotates journal envelopes only when the v2 KEK is preconfigured", async () => {
    const csrf = await csrfToken();
    const writeHeaders = headers({
      Origin: origin,
      "Content-Type": "application/json",
      "X-Life-CSRF": csrf,
    });
    const createdResponse = await worker.fetch(
      new Request(`${origin}/api/v1/journals`, {
        method: "POST",
        headers: {
          ...writeHeaders,
          "Idempotency-Key": "synthetic-rotation-journal-key",
        },
        body: JSON.stringify({
          date: "2026-01-14",
          title: "合成轮换",
          content: "轮换后仍可解密的合成正文",
        }),
      }),
      env,
    );
    const created = await createdResponse.json() as { id: string };

    const missingKey = await worker.fetch(
      new Request(`${origin}/api/v1/crypto/rotate-keks`, {
        method: "POST",
        headers: writeHeaders,
        body: JSON.stringify({ domain: "journal" }),
      }),
      env,
    );
    expect(missingKey.status).toBe(503);

    env.KEK_JOURNAL_V2 = generateKekMaterial();
    const rotated = await worker.fetch(
      new Request(`${origin}/api/v1/crypto/rotate-keks`, {
        method: "POST",
        headers: writeHeaders,
        body: JSON.stringify({ domain: "journal" }),
      }),
      env,
    );
    expect(await rotated.json()).toEqual(expect.objectContaining({
      domain: "journal",
      target_kid: "journal-v2",
      records_rotated: expect.any(Number),
    }));
    expect(
      d1.database.prepare(
        "SELECT encryption_kid FROM journals WHERE id = ?",
      ).get(created.id),
    ).toEqual({ encryption_kid: "journal-v2" });

    const detail = await worker.fetch(
      new Request(`${origin}/api/v1/journals/${created.id}`, {
        headers: headers(),
      }),
      env,
    );
    expect(await detail.json()).toEqual(expect.objectContaining({
      content: "轮换后仍可解密的合成正文",
    }));
  });
});
