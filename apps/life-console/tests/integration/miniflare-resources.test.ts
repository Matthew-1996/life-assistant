import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createSyntheticMiniflare,
  type SyntheticMiniflareHarness,
} from "./helpers/miniflare";

async function createGoal(harness: SyntheticMiniflareHarness, key = "goal-key") {
  const response = await harness.write("/api/v1/goals", {
    title: "Synthetic focus",
    status: "focus",
    priority_order: 1,
    tags: ["synthetic"],
  }, { "Idempotency-Key": key });
  return response.json() as Promise<{ id: string; revision: number }>;
}

async function createJournal(
  harness: SyntheticMiniflareHarness,
  key = "journal-key",
) {
  const response = await harness.write("/api/v1/journals", {
    date: "2026-01-12",
    title: "Synthetic journal",
    content: "Synthetic private content",
    mood: "steady",
    tags: ["synthetic"],
  }, { "Idempotency-Key": key });
  return response.json() as Promise<{ id: string; revision: number }>;
}

async function importHealth(harness: SyntheticMiniflareHarness) {
  const response = await harness.write("/api/v1/health/import", {
    date: "2026-01-12",
    steps: 5200,
    raw_payload: { source: "synthetic", samples: [1, 2] },
    source_device: "Synthetic Watch",
    segments: [{
      segment_type: "sleep_core",
      started_at: "2026-01-12T00:00:00Z",
      duration_min: 60,
      value_1: "synthetic-value",
    }],
  }, { "Idempotency-Key": "health-key" });
  return response.json() as Promise<{ id: string; revision: number }>;
}

describe("Life Console Miniflare resource persistence", () => {
  let harness: SyntheticMiniflareHarness;

  beforeEach(async () => {
    harness = await createSyntheticMiniflare();
  });

  afterEach(async () => {
    await harness.dispose();
  });

  it("creates and lists a goal through the real Worker", async () => {
    await createGoal(harness);

    const response = await harness.fetch("/api/v1/goals");
    const payload = await response.json() as { items: { title: string }[] };

    expect(payload.items).toEqual([
      expect.objectContaining({ title: "Synthetic focus" }),
    ]);
  });

  it("deduplicates repeated goal writes in D1", async () => {
    await createGoal(harness, "same-goal-key");
    await createGoal(harness, "same-goal-key");

    const rows = await harness.query<{ count: number }>(
      "SELECT COUNT(*) AS count FROM goals",
    );

    expect(rows).toEqual([{ count: 1 }]);
  });

  it("increments a goal revision through If-Match", async () => {
    const goal = await createGoal(harness);

    const response = await harness.write(`/api/v1/goals/${goal.id}`, {
      title: "Synthetic focus updated",
    }, { "If-Match": "1" }, "PATCH");
    const list = await harness.fetch("/api/v1/goals");
    const payload = await list.json() as { items: { title: string }[] };

    expect(await response.json()).toEqual(expect.objectContaining({
      revision: 2,
    }));
    expect(payload.items[0].title).toBe("Synthetic focus updated");
  });

  it("stores journal content as ciphertext in D1", async () => {
    const journal = await createJournal(harness);

    const rows = await harness.query<{ content_encrypted: string }>(
      "SELECT content_encrypted FROM journals WHERE id = ?",
      journal.id,
    );

    expect(rows[0].content_encrypted).not.toContain("Synthetic private content");
  });

  it("decrypts journal content only at the API boundary", async () => {
    const journal = await createJournal(harness);

    const response = await harness.fetch(`/api/v1/journals/${journal.id}`);

    expect(await response.json()).toEqual(expect.objectContaining({
      content: "Synthetic private content",
    }));
  });

  it("rejects a stale journal revision", async () => {
    const journal = await createJournal(harness);
    await harness.write(`/api/v1/journals/${journal.id}`, {
      content: "First update",
    }, { "If-Match": "1" }, "PATCH");

    const conflict = await harness.write(`/api/v1/journals/${journal.id}`, {
      content: "Stale update",
    }, { "If-Match": "1" }, "PATCH");

    expect(conflict.status).toBe(409);
  });

  it("encrypts daily check-in notes and anchors", async () => {
    await harness.write("/api/v1/daily-checkins", {
      date: "2026-01-12",
      energy: "3",
      anchors: { life_action: "minimum" },
      notes: "Synthetic daily note",
    }, { "Idempotency-Key": "daily-key" });

    const rows = await harness.query<{
      anchors_encrypted: string;
      notes_encrypted: string;
    }>("SELECT anchors_encrypted, notes_encrypted FROM daily_checkins");

    expect(rows[0].anchors_encrypted).not.toContain("life_action");
    expect(rows[0].notes_encrypted).not.toContain("Synthetic daily note");
  });

  it("returns decrypted weekly review content", async () => {
    await harness.write("/api/v1/weekly-reviews", {
      week_start: "2026-01-12",
      summary: "Synthetic weekly summary",
      goals_hit_rate: { focus: 0.8 },
      action_items: ["synthetic"],
    }, { "Idempotency-Key": "weekly-key" });

    const response = await harness.fetch("/api/v1/weekly-reviews");
    const payload = await response.json() as { items: Record<string, unknown>[] };

    expect(payload.items[0]).toEqual(expect.objectContaining({
      summary: "Synthetic weekly summary",
    }));
    expect(payload.items[0]).not.toHaveProperty("summary_encrypted");
  });

  it("returns decrypted phase review content", async () => {
    await harness.write("/api/v1/phase-reviews", {
      phase_name: "Synthetic phase",
      body: "Synthetic phase summary",
      goals_before: ["before"],
      goals_after: ["after"],
    }, { "Idempotency-Key": "phase-key" });

    const response = await harness.fetch("/api/v1/phase-reviews");
    const payload = await response.json() as { items: Record<string, unknown>[] };

    expect(payload.items[0]).toEqual(expect.objectContaining({
      body: "Synthetic phase summary",
    }));
    expect(payload.items[0]).not.toHaveProperty("body_encrypted");
  });

  it("stores Apple Health details as ciphertext in D1", async () => {
    await importHealth(harness);

    const rows = await harness.query<{
      raw_payload_encrypted: string;
      source_device_encrypted: string;
    }>(
      "SELECT raw_payload_encrypted, source_device_encrypted FROM health_days",
    );

    expect(rows[0].raw_payload_encrypted).not.toContain("samples");
    expect(rows[0].source_device_encrypted).not.toContain("Synthetic Watch");
  });

  it("increments a health-day revision", async () => {
    const health = await importHealth(harness);

    const response = await harness.write(`/api/v1/health/days/${health.id}`, {
      steps: 6200,
      active_energy_kcal: 320,
    }, { "If-Match": "1" }, "PATCH");
    const rows = await harness.query<{ steps: number }>(
      "SELECT steps FROM health_days WHERE id = ?",
      health.id,
    );

    expect(await response.json()).toEqual(expect.objectContaining({
      revision: 2,
    }));
    expect(rows).toEqual([{ steps: 6200 }]);
  });

  it("returns decrypted health segments from their endpoint", async () => {
    const health = await importHealth(harness);

    const response = await harness.fetch(
      `/api/v1/health/days/${health.id}/segments`,
    );

    expect(await response.json()).toEqual({
      items: [expect.objectContaining({
        segment_type: "sleep_core",
        value_1: "synthetic-value",
      })],
    });
  });
});
