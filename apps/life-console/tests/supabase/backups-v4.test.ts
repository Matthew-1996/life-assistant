// @vitest-environment node
import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import {
  createBackupArchive,
  LEGACY_BACKUP_RESOURCE_NAMES,
  type LifeConsoleSnapshot,
} from "../../src/supabase/backups";
const base = {
  exported_at: "2030-05-01T00:00:00Z",
  ...Object.fromEntries(LEGACY_BACKUP_RESOURCE_NAMES.map((n) => [n, []])),
  todo_items: [],
  todo_status_events: [],
  dashboard_messages: [],
};
const options = {
  exportId: "synthetic-v4",
  sourceProductVersion: "2.10.0",
  sourceSchemaVersion: "supabase/4",
};
describe("fitness backup coverage", () => {
  it("includes active and soft deleted appointments but excludes subscription access material", async () => {
    const appointments = [
      { id: "active", revision: 2, notes: "合成备注", deleted_at: null },
      { id: "deleted", revision: 3, deleted_at: "2030-05-01T00:00:00Z" },
    ];
    const result = await createBackupArchive(
      {
        ...base,
        schema_version: 4,
        fitness_appointments: appointments,
        fitness_calendar_subscription: [{ token_hash: "synthetic-hash" }],
      } as unknown as LifeConsoleSnapshot,
      options,
    );
    const files = unzipSync(result.bytes);
    expect(result.manifest.format_version).toBe("life-console-backup/4");
    expect(
      strFromU8(files["data/fitness_appointments.ndjson"])
        .trim()
        .split("\n")
        .map((s) => JSON.parse(s)),
    ).toEqual(appointments);
    expect(Object.keys(files).join()).not.toMatch(
      /subscription|receipts|owners/,
    );
  });
  it("rejects v4 missing appointment coverage rather than writing an empty backup", async () => {
    await expect(
      createBackupArchive(
        { ...base, schema_version: 4 } as unknown as LifeConsoleSnapshot,
        options,
      ),
    ).rejects.toMatchObject({ code: "backup_snapshot_invalid" });
  });
  it("keeps older snapshots explicitly v3 with no invented fitness coverage", async () => {
    const result = await createBackupArchive(
      { ...base, schema_version: 3 } as unknown as LifeConsoleSnapshot,
      options,
    );
    expect(result.manifest.format_version).toBe("life-console-backup/3");
    expect(result.manifest.source_schema_version).toBe("supabase/3");
    expect(Object.keys(unzipSync(result.bytes))).not.toContain(
      "data/fitness_appointments.ndjson",
    );
  });
});
