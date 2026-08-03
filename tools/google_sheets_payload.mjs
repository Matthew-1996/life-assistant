#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertSourceSnapshotsUnchanged,
  dailyCheckinWorkbookValues,
  excelDateSerial,
  loadDailyCheckinSource,
  loadJournalSource,
  loadPhaseSchedule,
  loadWeeklyReviewSource,
  weeklyReviewWorkbookValues,
  weeklyScaffoldRows,
} from "./life_plan_records.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(scriptDir, "..");
const rootIndex = process.argv.indexOf("--root");
const projectRoot = rootIndex >= 0
  ? path.resolve(process.argv[rootIndex + 1] ?? "")
  : defaultRoot;
const journalRoot = path.join(projectRoot, "journal");
const recordsRoot = path.join(projectRoot, "records");

// 阶段路线从 iCloud-only 的 life-plan-schedule.json 注入（与 GOALS.md 同源），
// 不再硬编码个人日期。
const phaseSchedule = await loadPhaseSchedule(projectRoot);
const DAILY_START = phaseSchedule.phases[0].start;
const DAILY_END = phaseSchedule.phases.at(-1).end;
const JOURNAL_CLEAR_RANGE = "A11:J1000";
const dailyHeaders = [
  "入睡时间", "醒来时间", "离床时间", "睡眠质量 1–5", "白天精力 1–5", "情绪 1–5", "生活实感 1–5",
  "清醒烦躁躺床", "起床锚点", "身体 / 光照", "生活动作", "晚间降速", "什么有帮助或添乱",
];
const weeklyHeaders = [
  "周开始", "周结束", "周次", "阶段", "睡眠质量", "白天精力", "情绪", "生活实感",
  "变好的事实", "反复摩擦", "下周一个实验", "停止 / 减少", "目标决定", "复盘状态",
];
const journalHeaders = [
  "日期", "时间", "标题", "一句话摘要", "明确感受", "场景 / 人物", "标签", "关联主题", "来源文件", "整理状态",
];

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function addDays(value, count) {
  const parsed = new Date(`${value}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + count);
  return parsed.toISOString().slice(0, 10);
}

function dateRange(start, end) {
  const values = [];
  for (let current = start; current <= end; current = addDays(current, 1)) values.push(current);
  return values;
}

function average(values) {
  const usable = values.filter((value) => Number.isInteger(value));
  if (usable.length === 0) return null;
  return usable.reduce((sum, value) => sum + value, 0) / usable.length;
}

async function sourceReceipt(snapshot, pathCategory) {
  let present = true;
  try {
    const info = await fs.lstat(snapshot.filePath);
    present = info.isFile() && !info.isSymbolicLink();
  } catch (error) {
    if (error?.code === "ENOENT") present = false;
    else throw error;
  }
  if (!present && snapshot.bytes.length > 0) {
    throw new Error("同步源存在性与读取快照不一致");
  }
  return {
    path_category: pathCategory,
    present,
    sha256: present ? sha256(snapshot.bytes) : null,
  };
}

const [journalSource, dailySource, weeklySource] = await Promise.all([
  loadJournalSource(journalRoot),
  loadDailyCheckinSource(recordsRoot),
  loadWeeklyReviewSource(recordsRoot),
]);
const snapshots = [journalSource.snapshot, dailySource.snapshot, weeklySource.snapshot];

const dailyByDate = new Map(dailySource.records.map((record) => [record.date, record]));
const dailyDates = dateRange(DAILY_START, DAILY_END);
const dailyValues = dailyDates.map((date) => {
  const record = dailyByDate.get(date);
  return record === undefined ? Array(dailyHeaders.length).fill(null) : dailyCheckinWorkbookValues(record);
});

const weeklyByKey = new Map(weeklySource.records.map((record) => [record.iso_week, record]));
const weeklyValues = weeklyScaffoldRows(phaseSchedule).map((row) => {
  const days = dateRange(row.week_start, row.week_end);
  const records = days.map((day) => dailyByDate.get(day)).filter(Boolean);
  const scoreFields = ["sleep_quality", "energy", "mood", "life_feeling"];
  const averages = scoreFields.map((field) => average(records.map((record) => record.ratings[field])));
  return [
    excelDateSerial(row.week_start, row.iso_week),
    excelDateSerial(row.week_end, row.iso_week),
    row.iso_week,
    row.phase,
    ...averages,
    ...weeklyReviewWorkbookValues(weeklyByKey.get(row.iso_week) ?? null),
  ];
});

const journalRows = journalSource.rows;
const journalDates = journalRows.map((row) => row[0]).filter((value) => typeof value === "number");
const journalPending = journalRows.filter((row) => row[9] === "待整理").length;
const journalLastRow = 10 + Math.max(journalRows.length, 1);

const sourceSnapshots = {
  journal: await sourceReceipt(journalSource.snapshot, "journal-index-jsonl"),
  daily: await sourceReceipt(dailySource.snapshot, "daily-checkins-jsonl"),
  weekly: await sourceReceipt(weeklySource.snapshot, "weekly-reviews-jsonl"),
};
const core = {
  schema_version: 1,
  view_schema_version: 1,
  source_snapshots: sourceSnapshots,
  spreadsheet_properties: {
    locale: "zh_CN",
    timeZone: "Asia/Shanghai",
  },
  format_updates: [
    { sheet: "每日记录", range: `A5:A${4 + dailyValues.length}`, number_format: { type: "DATE", pattern: "yyyy-mm-dd" } },
    { sheet: "每日记录", range: `D5:F${4 + dailyValues.length}`, number_format: { type: "TIME", pattern: "hh:mm" } },
    { sheet: "日记索引", range: "D5", number_format: { type: "DATE", pattern: "yyyy-mm-dd" } },
    { sheet: "日记索引", range: `A11:A${journalLastRow}`, number_format: { type: "DATE", pattern: "yyyy-mm-dd" } },
    { sheet: "日记索引", range: `B11:B${journalLastRow}`, number_format: { type: "TIME", pattern: "hh:mm" } },
    { sheet: "每周复盘", range: `A5:B${4 + weeklyValues.length}`, number_format: { type: "DATE", pattern: "yyyy-mm-dd" } },
  ],
  clear_ranges: [
    { sheet: "日记索引", range: JOURNAL_CLEAR_RANGE },
    { sheet: "每日记录", range: `D4:P${4 + dailyValues.length}` },
    { sheet: "每周复盘", range: `A4:N${4 + weeklyValues.length}` },
  ],
  value_updates: [
    { sheet: "日记索引", range: "A5", values: [[journalRows.length]] },
    {
      sheet: "日记索引",
      range: "D5",
      values: [[journalDates.length === 0 ? "—" : Math.max(...journalDates)]],
    },
    { sheet: "日记索引", range: "G5", values: [[journalPending]] },
    {
      sheet: "日记索引",
      range: `A10:J${10 + journalRows.length}`,
      values: [journalHeaders, ...journalRows],
    },
    {
      sheet: "每日记录",
      range: `D4:P${4 + dailyValues.length}`,
      values: [dailyHeaders, ...dailyValues],
    },
    {
      sheet: "每周复盘",
      range: `A4:N${4 + weeklyValues.length}`,
      values: [weeklyHeaders, ...weeklyValues],
    },
  ],
  verification_ranges: [
    { sheet: "日记索引", range: "A1:J20" },
    { sheet: "每日记录", range: "A1:P8" },
    { sheet: "每周复盘", range: "A1:N16" },
  ],
  privacy_contract: {
    includes: ["full_existing_views", "journal_lightweight_index", "daily_checkins", "weekly_reviews"],
    excludes: ["journal_raw", "apple_health_summary", "apple_sleep_details", "prompts", "credentials", "chat_transcripts"],
  },
};
const payload = {
  ...core,
  payload_sha256: sha256(Buffer.from(JSON.stringify(core), "utf8")),
};
await assertSourceSnapshotsUnchanged(snapshots);
process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
