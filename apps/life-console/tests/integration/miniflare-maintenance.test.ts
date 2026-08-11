import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createSyntheticMiniflare,
  type SyntheticMiniflareHarness,
} from "./helpers/miniflare";

async function createGoal(harness: SyntheticMiniflareHarness) {
  return harness.write("/api/v1/goals", {
    title: "Synthetic audit content",
    status: "focus",
    priority_order: 1,
  }, { "Idempotency-Key": crypto.randomUUID() });
}

describe("Life Console Miniflare maintenance flows", () => {
  let harness: SyntheticMiniflareHarness;

  beforeEach(async () => {
    harness = await createSyntheticMiniflare({ journalV2: true });
  });

  afterEach(async () => {
    await harness.dispose();
  });

  it("keeps audit responses free of resource content", async () => {
    await createGoal(harness);

    const response = await harness.fetch(
      "/api/v1/audit/events?resource_type=goal&action=CREATE",
    );
    const payload = await response.json() as { items: unknown[] };

    expect(payload.items).toHaveLength(1);
    expect(JSON.stringify(payload)).not.toContain("Synthetic audit content");
  });

  it("queues a backup export for a new resource revision", async () => {
    await createGoal(harness);

    const rows = await harness.query<{
      resource_type: string;
      revision: number;
      status: string;
    }>(
      "SELECT resource_type, revision, status FROM backup_exports",
    );

    expect(rows).toEqual([{
      resource_type: "goal",
      revision: 1,
      status: "PENDING",
    }]);
  });

  it("writes an encrypted full backup object to R2", async () => {
    const response = await harness.write("/api/v1/backup/trigger", {
      reason: "synthetic-integration",
    });
    const payload = await response.json() as { object_key: string };
    const object = await harness.getR2Text(payload.object_key);

    expect(payload.object_key).toMatch(/^full-backups\/.+\.json\.enc$/u);
    expect(object).not.toContain("migration_state");
  });

  it("creates and verifies a passphrase-protected recovery pack", async () => {
    const recovery = await harness.write("/api/v1/crypto/recovery-pack", {
      passphrase: "synthetic-passphrase-2026",
      confirmation: "synthetic-passphrase-2026",
      acknowledged: true,
    });
    const pack = await recovery.json() as { object_key: string };

    const verified = await harness.write(
      "/api/v1/crypto/verify-recovery-pack",
      {
        object_key: pack.object_key,
        passphrase: "synthetic-passphrase-2026",
      },
    );

    expect(await verified.json()).toEqual(expect.objectContaining({
      verified: true,
      key_ids: expect.arrayContaining([
        "journal-v1",
        "health-v1",
        "backup-v1",
      ]),
    }));
  });

  it("switches and rolls back the migration state machine", async () => {
    await harness.write("/api/v1/migration/plan", {
      expected_counts: { journals: 0, health_days: 0 },
    });
    await harness.write("/api/v1/migration/validate", {
      checks: {
        counts_match: true,
        ids_match: true,
        revisions_monotonic: true,
        digests_match: true,
        encryption_round_trip: true,
      },
    });
    const switched = await harness.write("/api/v1/migration/switch", {
      confirmation: "CONFIRM SWITCH",
    });
    const rolledBack = await harness.write("/api/v1/migration/rollback", {
      confirmation: "CONFIRM ROLLBACK",
    });

    expect(await switched.json()).toEqual(expect.objectContaining({
      phase: "SWITCHED",
      source_truth: "SITES_D1_PRIMARY",
    }));
    expect(await rolledBack.json()).toEqual(expect.objectContaining({
      phase: "ROLLED_BACK",
      source_truth: "ICLOUD_PRIMARY",
    }));
    expect(await harness.listR2Keys("rolled-back-pending/")).toHaveLength(1);
  });

  it("rotates journal envelopes to the configured v2 KEK", async () => {
    const createdResponse = await harness.write("/api/v1/journals", {
      date: "2026-01-14",
      title: "Synthetic rotation",
      content: "Content remains decryptable after rotation",
    }, { "Idempotency-Key": "rotation-journal" });
    const created = await createdResponse.json() as { id: string };

    const rotated = await harness.write("/api/v1/crypto/rotate-keks", {
      domain: "journal",
    });
    const rows = await harness.query<{ encryption_kid: string }>(
      "SELECT encryption_kid FROM journals WHERE id = ?",
      created.id,
    );
    const detail = await harness.fetch(`/api/v1/journals/${created.id}`);

    expect(await rotated.json()).toEqual(expect.objectContaining({
      target_kid: "journal-v2",
      records_rotated: 2,
    }));
    expect(rows).toEqual([{ encryption_kid: "journal-v2" }]);
    expect(await detail.json()).toEqual(expect.objectContaining({
      content: "Content remains decryptable after rotation",
    }));
  });

  it("cancels and recreates a deletion plan before purging", async () => {
    const createdResponse = await harness.write("/api/v1/journals", {
      date: "2026-01-15",
      title: "Synthetic deletion",
      content: "Synthetic content scheduled for deletion",
    }, { "Idempotency-Key": "deletion-journal" });
    const created = await createdResponse.json() as { id: string };

    const planned = await harness.write(
      `/api/v1/journals/${created.id}/delete-plan`,
      {},
      { "If-Match": "1" },
    );
    const cancelled = await harness.write(
      `/api/v1/journals/${created.id}/delete-plan/cancel`,
      {},
      { "If-Match": "2" },
    );
    const replanned = await harness.write(
      `/api/v1/journals/${created.id}/delete-plan`,
      {},
      { "If-Match": "3" },
    );
    const activePurge = await harness.write(
      `/api/v1/journals/${created.id}/purge`,
      {},
      { "If-Match": "4" },
      "DELETE",
    );
    await harness.query(
      "UPDATE journals SET deletion_plan_until = ? WHERE id = ?",
      "2020-01-01T00:00:00.000Z",
      created.id,
    );
    const purged = await harness.write(
      `/api/v1/journals/${created.id}/purge`,
      {},
      { "If-Match": "4" },
      "DELETE",
    );

    expect(await planned.json()).toEqual(expect.objectContaining({ revision: 2 }));
    expect(await cancelled.json()).toEqual(expect.objectContaining({
      revision: 3,
      deletion_plan_until: null,
    }));
    expect(await replanned.json()).toEqual(expect.objectContaining({ revision: 4 }));
    expect(activePurge.status).toBe(409);
    expect(purged.status).toBe(200);
    expect(await harness.query<{ count: number }>(
      "SELECT COUNT(*) AS count FROM journals WHERE id = ?",
      created.id,
    )).toEqual([{ count: 0 }]);
  });
});
