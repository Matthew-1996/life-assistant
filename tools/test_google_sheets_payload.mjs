import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(scriptDir, "google_sheets_payload.mjs");
const root = await fs.mkdtemp(path.join(os.tmpdir(), "google-sheets-payload-test-"));

function timestamp() {
  return "2026-08-03T03:00:00Z";
}

try {
  await fs.mkdir(path.join(root, "journal"), { recursive: true });
  await fs.mkdir(path.join(root, "records"), { recursive: true });
  const journal = {
    id: "journal-test",
    date: "2026-08-02",
    time: null,
    time_precision: "unknown",
    title: "轻量标题",
    summary: "轻量摘要",
    feelings: ["开心"],
    people: ["双双"],
    places: ["家里"],
    tags: ["生活"],
    themes: ["关系"],
    file: "entries/2026/2026-08.md",
    status: "active",
    weekly_reviews: [],
    monthly_reviews: [],
    raw: "RAW_SENTINEL_MUST_NOT_LEAVE_ICLOUD",
  };
  await fs.writeFile(path.join(root, "journal/index.jsonl"), `${JSON.stringify(journal)}\n`);
  const checkin = {
    schema_version: 2,
    key: "daily-checkin:2026-08-03",
    date: "2026-08-03",
    sleep_time: "00:30",
    wake_time: "09:30",
    out_of_bed_time: "10:00",
    ratings: { sleep_quality: 3, energy: 3, mood: 2, life_feeling: 3 },
    awake_in_bed: null,
    anchors: { wake: null, body_light: null, life_action: null, wind_down: null },
    note_summary: null,
    revision: 1,
    created_at: timestamp(),
    updated_at: timestamp(),
  };
  await fs.writeFile(path.join(root, "records/daily-checkins.jsonl"), `${JSON.stringify(checkin)}\n`);
  await fs.writeFile(path.join(root, "records/weekly-reviews.jsonl"), "");

  const first = await execFileAsync("node", [script, "--root", root], { encoding: "utf8" });
  const second = await execFileAsync("node", [script, "--root", root], { encoding: "utf8" });
  const payload = JSON.parse(first.stdout);
  assert.equal(payload.payload_sha256, JSON.parse(second.stdout).payload_sha256);
  assert.equal(payload.source_snapshots.weekly.present, true, "零字节但存在的周台账必须标为 present");
  assert.ok(!first.stdout.includes("RAW_SENTINEL_MUST_NOT_LEAVE_ICLOUD"));
  assert.deepEqual(payload.privacy_contract.excludes, [
    "journal_raw", "apple_health_summary", "apple_sleep_details", "prompts", "credentials", "chat_transcripts",
  ]);
  const journalUpdate = payload.value_updates.find((item) => item.sheet === "日记索引" && item.range.startsWith("A10"));
  assert.equal(journalUpdate.values.length, 2);
  assert.equal(journalUpdate.values[1][2], "轻量标题");
  const dailyUpdate = payload.value_updates.find((item) => item.sheet === "每日记录");
  assert.equal(dailyUpdate.values.length, 93);
  const augustThird = dailyUpdate.values[1 + 2];
  assert.equal(augustThird[1], 9.5 / 24, "醒来时间应进入第二个时间字段");
  assert.equal(augustThird[2], 10 / 24, "离床时间应保持独立");
  const weeklyUpdate = payload.value_updates.find((item) => item.sheet === "每周复盘");
  assert.equal(weeklyUpdate.values.length, 13);
  assert.deepEqual(weeklyUpdate.values[1].slice(4, 8), [3, 3, 2, 3]);
  assert.deepEqual(
    payload.clear_ranges.map((item) => `${item.sheet}!${item.range}`),
    ["日记索引!A11:J1000", "每日记录!D4:P96", "每周复盘!A4:N16"],
  );
  assert.deepEqual(payload.spreadsheet_properties, { locale: "zh_CN", timeZone: "Asia/Shanghai" });
  assert.deepEqual(payload.format_updates, [
    { sheet: "每日记录", range: "A5:A96", number_format: { type: "DATE", pattern: "yyyy-mm-dd" } },
    { sheet: "每日记录", range: "D5:F96", number_format: { type: "TIME", pattern: "hh:mm" } },
    { sheet: "日记索引", range: "D5", number_format: { type: "DATE", pattern: "yyyy-mm-dd" } },
    { sheet: "日记索引", range: "A11:A11", number_format: { type: "DATE", pattern: "yyyy-mm-dd" } },
    { sheet: "日记索引", range: "B11:B11", number_format: { type: "TIME", pattern: "hh:mm" } },
    { sheet: "每周复盘", range: "A5:B16", number_format: { type: "DATE", pattern: "yyyy-mm-dd" } },
  ]);
  console.log("PASS: Google 表格载荷确定、完整且不包含日记原文");
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
