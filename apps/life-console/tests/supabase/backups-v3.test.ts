// @vitest-environment node

import type { SupabaseClient } from "@supabase/supabase-js";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";

import {
  BACKUP_FORMAT_VERSION,
  BACKUP_RESOURCE_NAMES,
  BackupRepository,
  createBackupArchive,
  READABLE_BACKUP_FORMATS,
  type LifeConsoleSnapshot,
} from "../../src/supabase/backups";

const legacyResources = {
  goals: [],
  journals: [],
  journal_revisions: [],
  daily_checkins: [],
  weekly_reviews: [],
  phase_reviews: [],
  health_days: [],
  health_segments: [],
};

describe("life-console-backup/3 compatibility", () => {
  it("writes v3 while declaring v2 and v3 as readable", () => {
    expect(BACKUP_FORMAT_VERSION).toBe("life-console-backup/3");
    expect(READABLE_BACKUP_FORMATS).toEqual([
      "life-console-backup/2",
      "life-console-backup/3",
    ]);
    expect(BACKUP_RESOURCE_NAMES).toEqual([
      ...Object.keys(legacyResources),
      "todo_items",
      "todo_status_events",
      "dashboard_messages",
    ]);
  });

  it("reads a legacy schema v2 snapshot with new resources normalized to empty", async () => {
    const legacy = {
      schema_version: 2,
      exported_at: "2030-05-01T00:00:00.000Z",
      ...legacyResources,
    };
    const rpc = vi.fn(async () => ({ data: legacy, error: null, status: 200 }));
    const snapshot = await new BackupRepository({ rpc } as unknown as SupabaseClient).snapshot();

    expect(snapshot).toEqual({
      ...legacy,
      todo_items: [],
      todo_status_events: [],
      dashboard_messages: [],
    });
  });

  it("round-trips v3 private resources and never adds daily news", async () => {
    const snapshot: LifeConsoleSnapshot = {
      schema_version: 3,
      exported_at: "2030-05-01T00:00:00.000Z",
      ...legacyResources,
      todo_items: [{ id: 1, title: "Synthetic Todo" }],
      todo_status_events: [{ id: 2, todo_id: 1 }],
      dashboard_messages: [{ id: 3, message: "Synthetic message" }],
    };
    const archive = await createBackupArchive(snapshot, {
      exportId: "synthetic-v3-export",
      sourceProductVersion: "2.5.0",
      sourceSchemaVersion: "supabase/3",
    });
    const files = unzipSync(archive.bytes);
    const manifest = JSON.parse(strFromU8(files["manifest.json"]));

    expect(manifest.format_version).toBe("life-console-backup/3");
    expect(manifest.resources.todo_items.count).toBe(1);
    expect(strFromU8(files["data/todo_items.ndjson"])).toContain("Synthetic Todo");
    expect(strFromU8(files["data/dashboard_messages.ndjson"])).toContain("Synthetic message");
    expect(JSON.stringify(manifest)).not.toMatch(/daily.news|news/i);
    expect(Object.keys(files)).not.toContain("data/daily_news.ndjson");
  });
});
