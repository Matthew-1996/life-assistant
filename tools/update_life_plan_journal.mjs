import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";
import {
  assertSourceSnapshotsUnchanged,
  dailyDateRows,
  dailyWorkbookSyncPlan,
  journalRangePlan,
  loadDailyCheckinSource,
  loadJournalSource,
  loadWeeklyReviewSource,
  weeklyScaffoldRows,
  weeklyWorkbookSyncPlan,
  workbookDateKey,
} from "./life_plan_records.mjs";

const inputPath = process.argv[2];
const outputPath = process.argv[3] ?? inputPath;
const previewDir = process.argv[4];
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const journalRoot = path.resolve(process.argv[5] ?? path.join(projectRoot, "journal"));
const recordsRoot = path.resolve(process.argv[6] ?? path.join(projectRoot, "records"));

const receiptSourceDefinitions = [
  {
    key: "journal",
    pathCategory: "journal-index-jsonl",
    filePath: path.join(journalRoot, "index.jsonl"),
  },
  {
    key: "daily",
    pathCategory: "daily-checkins-jsonl",
    filePath: path.join(recordsRoot, "daily-checkins.jsonl"),
  },
  {
    key: "weekly",
    pathCategory: "weekly-reviews-jsonl",
    filePath: path.join(recordsRoot, "weekly-reviews.jsonl"),
  },
];

if (!inputPath || !outputPath || !previewDir) {
  throw new Error(
    "Usage: node update_life_plan_journal.mjs <input.xlsx> [output.xlsx] <preview-dir> [journal-root] [records-root]",
  );
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

async function readPortableSourceSnapshot(definition) {
  let stat;
  try {
    stat = await fs.lstat(definition.filePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { ...definition, present: false, bytes: Buffer.alloc(0), sha256: null };
    }
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error("同步源必须是项目内普通文件；已停止同步");
  }
  const bytes = await fs.readFile(definition.filePath);
  return { ...definition, present: true, bytes, sha256: sha256(bytes) };
}

async function assertPortableSourceSnapshotsUnchanged(snapshots) {
  for (const snapshot of snapshots) {
    let current;
    try {
      const stat = await fs.lstat(snapshot.filePath);
      if (stat.isSymbolicLink() || !stat.isFile()) {
        throw new Error("同步源类型已变化");
      }
      current = { present: true, bytes: await fs.readFile(snapshot.filePath) };
    } catch (error) {
      if (error?.code === "ENOENT") {
        current = { present: false, bytes: Buffer.alloc(0) };
      } else {
        throw new Error("同步期间源台账状态已变更，已停止发布同步结果", { cause: error });
      }
    }
    if (current.present !== snapshot.present || !current.bytes.equals(snapshot.bytes)) {
      throw new Error("同步期间源台账已变更，已停止发布同步结果；请重新同步");
    }
  }
}

function syncReceiptPath(workbookPath) {
  const extension = path.extname(workbookPath);
  const base = path.basename(workbookPath, extension);
  return path.join(path.dirname(workbookPath), `${base}.sync-state.json`);
}

async function writePrivateStagedFile(filePath, bytes) {
  const handle = await fs.open(filePath, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.chmod(filePath, 0o600);
}

const portableSourceSnapshots = await Promise.all(
  receiptSourceDefinitions.map(readPortableSourceSnapshot),
);

const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));

const navy = "#193752";
const teal = "#2A9D8F";
const tealPale = "#E4F3EF";
const bluePale = "#E8F1F8";
const sagePale = "#E8F0E7";
const yellowPale = "#FFF4C7";
const paper = "#F6F1E8";
const white = "#FFFFFF";
const ink = "#193752";
const body = "#40576B";
const line = "#D5DFE6";

const journalSource = await loadJournalSource(journalRoot);
const dailySource = await loadDailyCheckinSource(recordsRoot);
const weeklySource = await loadWeeklyReviewSource(recordsRoot);
const journalRows = journalSource.rows;
const dailyCheckins = dailySource.records;
const weeklyReviews = weeklySource.records;
const sourceSnapshots = [journalSource.snapshot, dailySource.snapshot, weeklySource.snapshot];
for (const [portable, loaded] of portableSourceSnapshots.map(
  (snapshot, index) => [snapshot, sourceSnapshots[index]],
)) {
  if (path.resolve(loaded.filePath) !== path.resolve(portable.filePath)
    || !loaded.bytes.equals(portable.bytes)) {
    throw new Error("同步开始时源台账已变化，已停止同步；请重新运行");
  }
}
await assertPortableSourceSnapshotsUnchanged(portableSourceSnapshots);

function setMerged(sheet, address, value, format = {}) {
  const range = sheet.getRange(address);
  range.merge();
  range.values = [[value]];
  range.format = format;
  return range;
}

function sectionBand(sheet, address, title) {
  return setMerged(sheet, address, title, {
    fill: teal,
    font: { bold: true, color: white, size: 12 },
    verticalAlignment: "center",
    horizontalAlignment: "left",
  });
}

function inspectionRecords(result, label) {
  if (typeof result?.ndjson !== "string") {
    throw new Error(`${label}未返回可校验结果`);
  }
  const records = [];
  for (const lineText of result.ndjson.split("\n")) {
    if (!lineText.trim()) continue;
    try {
      records.push(JSON.parse(lineText));
    } catch {
      throw new Error(`${label}返回了无法解析的校验结果`);
    }
  }
  if (records.length === 0) {
    throw new Error(`${label}未返回任何校验记录`);
  }
  return records;
}

function assertTableInspection(result, expectedSheet, expectedAddress) {
  const records = inspectionRecords(result, `${expectedSheet}表格检查`);
  const matched = records.some((record) => (
    record?.kind === "table"
      && record.sheet === expectedSheet
      && record.address === expectedAddress
  ));
  if (!matched) {
    throw new Error(`${expectedSheet}表格检查未覆盖预期区域 ${expectedAddress}`);
  }
}

async function saveArtifactSilently(blob, targetPath) {
  const originalLog = console.log;
  const originalUmask = process.umask(0o077);
  console.log = () => {};
  try {
    await blob.save(targetPath);
  } finally {
    console.log = originalLog;
    process.umask(originalUmask);
  }
}

const sheetSummary = await workbook.inspect({
  kind: "sheet",
  include: "id,name",
  maxChars: 5000,
});
const existingNames = [];
for (const lineText of sheetSummary.ndjson.split("\n")) {
  if (!lineText.trim()) continue;
  const item = JSON.parse(lineText);
  if (item.name) existingNames.push(item.name);
}

// “日记索引”是完全由 journal/INDEX.jsonl 派生的视图。每次重建该工作表，
// 可同时清除旧记录遗留的行高、校验和条件格式元数据，避免空日记被渲染成
// 一张很长的空白表。没有其他工作表引用它，因此删除后重建不会破坏公式。
if (existingNames.includes("日记索引")) {
  workbook.worksheets.getItem("日记索引").delete();
}
const journal = workbook.worksheets.add("日记索引");
journal.showGridLines = false;
const journalRanges = journalRangePlan(journalRows.length, 0);

setMerged(journal, "A1:J1", "生活日记索引｜由对话自动整理", {
  fill: navy,
  font: { bold: true, color: white, size: 20 },
  verticalAlignment: "center",
  horizontalAlignment: "left",
});
setMerged(
  journal,
  "A2:J2",
  "日记原文按月保存在 iCloud 项目 journal/entries/；本表只保存日期、时间、标题、摘要、标签/场景等轻量索引与整理状态，不保存原文，也不自动发布到网页。",
  {
    fill: bluePale,
    font: { color: body, size: 10 },
    wrapText: true,
    verticalAlignment: "center",
    horizontalAlignment: "left",
  },
);

const cards = [
  ["A4:C4", "已记录篇数"],
  ["D4:F4", "最近记录日期"],
  ["G4:J4", "待整理记录"],
];
for (const [address, label] of cards) {
  setMerged(journal, address, label, {
    fill: teal,
    font: { bold: true, color: white, size: 10 },
    horizontalAlignment: "center",
    verticalAlignment: "center",
    borders: { preset: "outside", style: "thin", color: line },
  });
}

for (const address of ["A5:C5", "D5:F5", "G5:J5"]) {
  journal.getRange(address).merge();
  journal.getRange(address).format = {
    fill: tealPale,
    font: { bold: true, color: ink, size: 18 },
    horizontalAlignment: "center",
    verticalAlignment: "center",
    borders: { preset: "outside", style: "thin", color: line },
  };
}
journal.getRange("A5").formulas = [[journalRanges.formulas.count]];
journal.getRange("D5").formulas = [[journalRanges.formulas.latestDate]];
journal.getRange("D5:F5").format.numberFormat = "yyyy-mm-dd";
journal.getRange("G5").formulas = [[journalRanges.formulas.pending]];

sectionBand(journal, "A7:J7", "对话触发｜你只需要说");
setMerged(
  journal,
  "A8:J8",
  "以“日记：”“日记记录：”“生活记录：”“记录一下：”开头，或明确说“帮我记下来”。助手会完成归档与轻量索引；你无需在这里重复录入。",
  {
    fill: paper,
    font: { color: body, size: 10 },
    wrapText: true,
    verticalAlignment: "center",
    horizontalAlignment: "left",
    borders: { preset: "outside", style: "thin", color: line },
  },
);

journal.getRange("A10:J10").values = [[
  "日期",
  "时间",
  "标题",
  "一句话摘要",
  "明确感受",
  "场景 / 人物",
  "标签",
  "关联主题",
  "来源文件",
  "整理状态",
]];
journal.getRange("A10:J10").format = {
  fill: navy,
  font: { bold: true, color: white, size: 10 },
  wrapText: true,
  horizontalAlignment: "center",
  verticalAlignment: "center",
  borders: { preset: "inside", style: "thin", color: white },
};

if (journalRanges.clearRange !== null) {
  const oldStatusRange = journal.getRange(`J11:J${journalRanges.clearLastRow}`);
  oldStatusRange.conditionalFormats.deleteAll();
  oldStatusRange.dataValidation = null;
  journal.getRange(journalRanges.clearRange).clear({ applyTo: "all" });
}
if (journalRanges.dataRange !== null) {
  journal.getRange(journalRanges.dataRange).values = journalRows;
  journal.getRange(journalRanges.dataRange).format = {
    fill: white,
    font: { color: body, size: 9 },
    wrapText: true,
    verticalAlignment: "top",
    borders: {
      insideHorizontal: { style: "thin", color: line },
      bottom: { style: "thin", color: line },
    },
  };
  journal.getRange(journalRanges.dateRange).format.numberFormat = "yyyy-mm-dd";
  journal.getRange(`B11:B${journalRanges.dataLastRow}`).format.numberFormat = "hh:mm";
  const statusRange = journal.getRange(journalRanges.statusRange);
  statusRange.dataValidation = {
    rule: {
      type: "list",
      values: ["待整理", "已纳入周回顾", "已纳入月回顾"],
    },
  };
  statusRange.conditionalFormats.deleteAll();
  statusRange.conditionalFormats.add("containsText", {
    text: "待整理",
    format: { fill: yellowPale, font: { color: ink } },
  });
  statusRange.conditionalFormats.add("containsText", {
    text: "已纳入周回顾",
    format: { fill: sagePale, font: { color: ink } },
  });
  statusRange.conditionalFormats.add("containsText", {
    text: "已纳入月回顾",
    format: { fill: tealPale, font: { color: ink } },
  });
  // 摘要、标签和场景经常需要 3–4 行；保留固定高度以避免
  // 渲染器与 Excel 在自动调整上产生差异，同时防止轻量索引文本被截断。
  journal.getRange(journalRanges.dataRange).format.rowHeight = 60;
}

journal.freezePanes.unfreeze();
journal.freezePanes.freezeRows(10);

journal.getRange("A1:J1").format.rowHeight = 36;
journal.getRange("A2:J2").format.rowHeight = 42;
journal.getRange("A3:J3").format.rowHeight = 12;
journal.getRange("A4:J4").format.rowHeight = 24;
journal.getRange("A5:J5").format.rowHeight = 38;
journal.getRange("A6:J6").format.rowHeight = 12;
journal.getRange("A7:J7").format.rowHeight = 25;
journal.getRange("A8:J8").format.rowHeight = 42;
journal.getRange("A9:J9").format.rowHeight = 12;
journal.getRange("A10:J10").format.rowHeight = 34;

const columnWidths = {
  A: 13,
  B: 10,
  C: 22,
  D: 32,
  E: 18,
  F: 20,
  G: 18,
  H: 20,
  I: 34,
  J: 20,
};
for (const [column, width] of Object.entries(columnWidths)) {
  journal.getRange(`${column}:${column}`).format.columnWidth = width;
}

const daily = workbook.worksheets.getItem("每日记录");
const dailyRows = dailyDateRows(daily.getUsedRange(true)?.values ?? []);
const dailySyncPlan = dailyWorkbookSyncPlan(dailyRows, dailyCheckins);
const legacyDailyHeaders = [
  "上床时间", "起床时间", "睡眠质量 1–5", "白天精力 1–5", "情绪 1–5", "生活实感 1–5",
  "清醒烦躁躺床", "起床锚点", "身体 / 光照", "生活动作", "晚间降速", "什么有帮助或添乱",
];
const previousDailyHeaders = [
  "入睡时间", "离床时间", "睡眠质量 1–5", "白天精力 1–5", "情绪 1–5", "生活实感 1–5",
  "清醒烦躁躺床", "起床锚点", "身体 / 光照", "生活动作", "晚间降速", "什么有帮助或添乱",
];
const dailyHeaders = [
  "入睡时间", "醒来时间", "离床时间", "睡眠质量 1–5", "白天精力 1–5", "情绪 1–5", "生活实感 1–5",
  "清醒烦躁躺床", "起床锚点", "身体 / 光照", "生活动作", "晚间降速", "什么有帮助或添乱",
];
const currentDailyHeaders = (daily.getRange("D4:P4").values?.[0] ?? [])
  .map((value) => typeof value === "string" ? value.trim() : "");
const hasCurrentDailyHeader = dailyHeaders
  .every((value, index) => currentDailyHeaders[index] === value);
const hasLegacyDailyHeader = [legacyDailyHeaders, previousDailyHeaders]
  .some((candidate) => candidate.every(
    (value, index) => currentDailyHeaders[index] === value,
  )) && !currentDailyHeaders[12];
if (!hasCurrentDailyHeader && !hasLegacyDailyHeader) {
  throw new Error("‘每日记录’D:P 表头已漂移；为避免清错列，已停止同步");
}

// D:P 是 records/daily-checkins.jsonl 的纯派生视图。先完成全部结构与公式
// 预检，再只清日期行的内容，保留 A:C、格式、条件格式和数据验证；随后按
// 当前完整台账重写。这样删除源记录或把字段改为空时，旧值不会残留。
if (hasLegacyDailyHeader) {
  const migrationRange = daily.getRange("P4:P96");
  const migrationValues = migrationRange.values;
  const migrationFormulas = migrationRange.formulas;
  const hasExistingContent = [migrationValues, migrationFormulas]
    .some((matrix) => Array.isArray(matrix) && matrix.flat(2)
      .some((value) => value !== null && value !== ""));
  if (hasExistingContent) {
    throw new Error("‘每日记录’P4:P96 已有内容；为避免扩展列时覆盖数据，已停止同步");
  }
}
for (const rowNumber of dailySyncPlan.clearRows) {
  const target = daily.getRange(`D${rowNumber}:P${rowNumber}`);
  const formulas = target.formulas;
  const formulaValues = Array.isArray(formulas) ? formulas.flat(2) : [];
  if (formulaValues.some((value) => typeof value === "string" && value.trim())) {
    throw new Error(`‘每日记录’D${rowNumber}:P${rowNumber} 含公式；为避免误删已停止同步`);
  }
}
if (hasLegacyDailyHeader) {
  // 从右向左平移原 E:O 的格式、校验和条件格式，E 留给新的“醒来时间”。
  // 内容随后会由完整台账重建，不会把旧单元格反向当作源数据。
  const sourceColumns = ["O", "N", "M", "L", "K", "J", "I", "H", "G", "F", "E"];
  for (const sourceColumn of sourceColumns) {
    const targetColumn = String.fromCharCode(sourceColumn.charCodeAt(0) + 1);
    daily.getRange(`${sourceColumn}4:${sourceColumn}96`).copyTo(
      daily.getRange(`${targetColumn}4:${targetColumn}96`),
      "all",
    );
  }
}
for (const rowNumber of dailySyncPlan.clearRows) {
  daily.getRange(`D${rowNumber}:P${rowNumber}`).clear({ applyTo: "contents" });
}
for (const write of dailySyncPlan.writes) {
  daily.getRange(`D${write.rowNumber}:P${write.rowNumber}`).values = [[...write.values]];
}
daily.getRange("D4:P4").values = [dailyHeaders];
daily.getRange("A1").values = [["每日记录｜对话同步，不用于考核"]];
daily.getRange("A2").values = [[
  "你只需在对话回访中回复少量信息；本表 D:P 由状态台账完整重建。醒来时间是主要睡眠结束字段，离床时间按需记录；分数 1=很差，5=很好；空白代表未知，不等于 0。",
]];

const weekly = workbook.worksheets.getItem("每周复盘");
const weeklyHeaders = [
  "周开始", "周结束", "周次", "阶段", "睡眠质量", "白天精力", "情绪", "生活实感",
  "变好的事实", "反复摩擦", "下周一个实验", "停止 / 减少", "目标决定", "复盘状态",
];
const currentWeeklyHeaders = (weekly.getRange("A4:N4").values?.[0] ?? [])
  .map((value) => typeof value === "string" ? value.trim() : value);
if (!weeklyHeaders.every((value, index) => currentWeeklyHeaders[index] === value)) {
  throw new Error("‘每周复盘’A:N 表头已漂移；为避免清错列，已停止同步");
}

const oldWeeklyRows = [
  ["2026-08-01", "2026-08-07", "8/1–8/7", "阶段 1｜稳住睡眠与生活感"],
  ["2026-08-08", "2026-08-14", "8/8–8/14", "阶段 1｜稳住睡眠与生活感"],
  ["2026-08-15", "2026-08-21", "8/15–8/21", "阶段 2｜低耗完成交接"],
  ["2026-08-22", "2026-08-28", "8/22–8/28", "阶段 2｜低耗完成交接"],
  ["2026-08-29", "2026-09-04", "8/29–9/4", "阶段 2｜低耗完成交接"],
  ["2026-09-05", "2026-09-11", "9/5–9/11", "阶段 3｜离职后减压"],
  ["2026-09-12", "2026-09-18", "9/12–9/18", "阶段 3｜离职后减压"],
  ["2026-09-19", "2026-09-25", "9/19–9/25", "阶段 4｜重建生活结构"],
  ["2026-09-26", "2026-10-02", "9/26–10/2", "阶段 4｜重建生活结构"],
  ["2026-10-03", "2026-10-09", "10/3–10/9", "阶段 4｜重建生活结构"],
  ["2026-10-10", "2026-10-16", "10/10–10/16", "阶段 4｜重建生活结构"],
  ["2026-10-17", "2026-10-23", "10/17–10/23", "阶段 5｜选择下一重点"],
  ["2026-10-24", "2026-10-30", "10/24–10/30", "阶段 5｜选择下一重点"],
  ["2026-10-31", "2026-10-31", "10/31–10/31", "阶段 5｜选择下一重点"],
];
const weeklyScaffold = weeklyScaffoldRows();
const weeklySyncPlan = weeklyWorkbookSyncPlan(weeklyScaffold, weeklyReviews);
const currentWeeklyRows = weekly.getRange("A5:D18").values ?? [];
function matchesWeeklyRows(expectedRows) {
  return expectedRows.every((expected, rowIndex) => {
    const current = currentWeeklyRows[rowIndex] ?? [];
    if (expected === null) {
      return current.every((value) => value === null || value === "");
    }
    return workbookDateKey(current[0]) === expected[0]
      && workbookDateKey(current[1]) === expected[1]
      && current[2] === expected[2]
      && current[3] === expected[3];
  });
}
const expectedNaturalRows = [
  ...weeklyScaffold.map((row) => [row.week_start, row.week_end, row.iso_week, row.phase]),
  null,
  null,
];
if (!matchesWeeklyRows(oldWeeklyRows) && !matchesWeeklyRows(expectedNaturalRows)) {
  throw new Error("‘每周复盘’日期脚手架不是已知旧版或自然周版；为避免覆盖未知内容，已停止同步");
}
const weeklyQualitativeFormulas = weekly.getRange("I5:N18").formulas;
if (Array.isArray(weeklyQualitativeFormulas)
  && weeklyQualitativeFormulas.flat(2).some((value) => typeof value === "string" && value.trim())) {
  throw new Error("‘每周复盘’I:N 含未知公式；为避免误删已停止同步");
}

// A5:N18 是脚本受管区。自然周脚手架、每日均值公式和用户明确周回答
// 都从源台账完整重建；删除周记录后定性列不会残留，也不会伪造目标决定。
weekly.getRange("M5:N18").dataValidation = null;
weekly.getRange("N5:N18").conditionalFormats.deleteAll();
weekly.getRange("A5:N18").clear({ applyTo: "all" });
const scaffoldValues = weeklySyncPlan.map((row) => row.values.slice(0, 4));
const reviewValues = weeklySyncPlan.map((row) => row.values.slice(4));
weekly.getRange("A5:D16").values = scaffoldValues;
weekly.getRange("I5:N16").values = reviewValues;
const scoreColumns = ["G", "H", "I", "J"];
const weeklyFormulas = weeklySyncPlan.map((_, index) => {
  const rowNumber = index + 5;
  return scoreColumns.map((dailyColumn) => (
    `=IFERROR(AVERAGEIFS('每日记录'!$${dailyColumn}$5:$${dailyColumn}$96,`
    + `'每日记录'!$A$5:$A$96,">="&$A${rowNumber},`
    + `'每日记录'!$A$5:$A$96,"<="&$B${rowNumber}),"")`
  ));
});
weekly.getRange("E5:H16").formulas = weeklyFormulas;
weekly.getRange("A5:N16").format = {
  fill: white,
  font: { color: body, size: 9 },
  wrapText: true,
  verticalAlignment: "top",
  borders: {
    insideHorizontal: { style: "thin", color: line },
    insideVertical: { style: "thin", color: line },
    bottom: { style: "thin", color: line },
  },
};
weekly.getRange("A5:D16").format.fill = paper;
weekly.getRange("E5:H16").format.fill = bluePale;
weekly.getRange("I5:N16").format.fill = yellowPale;
weekly.getRange("A5:B16").format.numberFormat = "yyyy-mm-dd";
weekly.getRange("E5:H16").format.numberFormat = "0.0";
weekly.getRange("A5:N16").format.rowHeight = 62;
weekly.getRange("A17:N18").format.rowHeightPx = 1;
weekly.getRange("M5:M16").dataValidation = {
  rule: {
    type: "list",
    values: [
      "继续当前重点", "调整当前重点", "降为辅助目标", "暂停当前重点",
      "完成当前重点", "替换当前重点", "暂不决定",
    ],
  },
};
weekly.getRange("N5:N16").dataValidation = {
  rule: { type: "list", values: ["部分复盘", "已复盘"] },
};
weekly.getRange("M17:N18").dataValidation = {
  allowBlank: true,
  list: { inCellDropDown: false, source: [""] },
};
const weeklyStatusRange = weekly.getRange("N5:N16");
weeklyStatusRange.conditionalFormats.add("containsText", {
  text: "部分复盘",
  format: { fill: yellowPale, font: { color: ink } },
});
weeklyStatusRange.conditionalFormats.add("containsText", {
  text: "已复盘",
  format: { fill: tealPale, font: { color: ink } },
});
weekly.getRange("A1").values = [["每周复盘｜只选择下一周一个小实验"]];
weekly.getRange("A2").values = [[
  "分数由每日状态自动汇总；复盘回答由对话同步，无需手填。空白代表未知，不补数据、不评价意志力。",
]];
weekly.freezePanes.unfreeze();
weekly.freezePanes.freezeRows(4);
weekly.freezePanes.freezeColumns(3);
const weeklyColumnWidths = {
  A: 13, B: 13, C: 12, D: 24, E: 12, F: 12, G: 10, H: 12,
  I: 26, J: 26, K: 28, L: 24, M: 20, N: 14,
};
for (const [column, width] of Object.entries(weeklyColumnWidths)) {
  weekly.getRange(`${column}:${column}`).format.columnWidth = width;
}

const guide = workbook.worksheets.getItem("使用说明");
guide.showGridLines = false;
guide.getRange("B5").values = [[
  "只需在对话回访中回复愿意提供的状态；助手会同日合并并同步。",
]];
guide.getRange("C5").values = [[
  "D:P 由台账生成，请勿手填；醒来是主要睡眠结束字段，离床按需记录；缺项保持未知，删除源记录后同步清空。",
]];
sectionBand(guide, "A47:H47", "对话式生活日记");
const guideRows = [
  [
    "A48:B48",
    "怎么触发",
    "C48:H48",
    "以“日记：”“日记记录：”“生活记录：”“记录一下：”开头，或明确说“帮我记下来”；助手归档后只回一条简短回执。",
    tealPale,
  ],
  [
    "A49:B49",
    "储存位置",
    "C49:H49",
    "原文保存在 iCloud 项目 journal/entries/ 的按月文件；“日记索引”表只保存轻量索引与整理状态。",
    bluePale,
  ],
  [
    "A50:B50",
    "隐私边界",
    "C50:H50",
    "归档副本在当前 iCloud 项目；日记工具不自动发布。撤回会保留原文，永久删除需单独确认且不清理旧 ZIP；秘密不写入。",
    paper,
  ],
  [
    "A51:B51",
    "定期整理",
    "C51:H51",
    "按你明确选择的周度、月度或按需节奏整理；未选择时不自动续期。候选偏好或规划线索写入长期记忆前先向你确认。",
    sagePale,
  ],
];
for (const [leftAddr, leftValue, rightAddr, rightValue, fill] of guideRows) {
  setMerged(guide, leftAddr, leftValue, {
    fill,
    font: { bold: true, color: ink, size: 10 },
    verticalAlignment: "center",
    borders: { preset: "outside", style: "thin", color: line },
  });
  setMerged(guide, rightAddr, rightValue, {
    fill: white,
    font: { color: body, size: 10 },
    wrapText: true,
    verticalAlignment: "center",
    borders: { preset: "outside", style: "thin", color: line },
  });
}
guide.getRange("A46:H46").format.rowHeight = 10;
guide.getRange("A47:H47").format.rowHeight = 25;
guide.getRange("A48:H51").format.rowHeight = 36;

const keyInspect = await workbook.inspect({
  kind: "table",
  range: "日记索引!A1:J20",
  include: "values,formulas",
  tableMaxRows: 20,
  tableMaxCols: 10,
  maxChars: 10000,
});
assertTableInspection(keyInspect, "日记索引", "A1:J20");

const guideInspect = await workbook.inspect({
  kind: "table",
  range: "使用说明!A47:H51",
  include: "values,formulas",
  tableMaxRows: 10,
  tableMaxCols: 8,
  maxChars: 5000,
});
assertTableInspection(guideInspect, "使用说明", "A47:H51");

const dailyInspect = await workbook.inspect({
  kind: "table",
  range: "每日记录!A1:P8",
  include: "values,formulas",
  tableMaxRows: 8,
  tableMaxCols: 16,
  maxChars: 10000,
});
assertTableInspection(dailyInspect, "每日记录", "A1:P8");

const weeklyInspect = await workbook.inspect({
  kind: "table",
  range: "每周复盘!A1:N18",
  include: "values,formulas",
  tableMaxRows: 18,
  tableMaxCols: 14,
  maxChars: 16000,
});
assertTableInspection(weeklyInspect, "每周复盘", "A1:N18");

const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 300 },
  summary: "final formula error scan",
  maxChars: 6000,
});
const formulaErrorMatches = inspectionRecords(errors, "公式错误扫描")
  .filter((record) => record?.kind === "match")
  .length;

const finalNames = [];
let effectivePreviewDir = previewDir;
let ephemeralPreviewDir = null;
if (previewDir === "-") {
  const createdPreviewDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "life-plan-private-preview-"),
  );
  try {
    await fs.chmod(createdPreviewDir, 0o700);
  } catch (error) {
    await fs.rm(createdPreviewDir, { recursive: true, force: true });
    throw error;
  }
  ephemeralPreviewDir = createdPreviewDir;
  effectivePreviewDir = ephemeralPreviewDir;
} else {
  await fs.mkdir(effectivePreviewDir, { recursive: true });
}
async function writePrivatePreview(filePath, bytes) {
  await fs.writeFile(filePath, bytes, { mode: 0o600 });
  await fs.chmod(filePath, 0o600);
}
try {
  const finalSheetSummary = await workbook.inspect({
    kind: "sheet",
    include: "id,name",
    maxChars: 5000,
  });
  for (const lineText of finalSheetSummary.ndjson.split("\n")) {
    if (!lineText.trim()) continue;
    const item = JSON.parse(lineText);
    if (item.name) finalNames.push(item.name);
  }
  for (const sheetName of finalNames) {
    const preview = await workbook.render({
      sheetName,
      autoCrop: "all",
      scale: 1,
      format: "png",
    });
    const safeName = sheetName.replaceAll(/[\\/:*?"<>|]/g, "_");
    await writePrivatePreview(
      path.join(effectivePreviewDir, `${safeName}.png`),
      new Uint8Array(await preview.arrayBuffer()),
    );
  }
  const journalFocusLastRow = Math.max(10, Math.min(journalRanges.dataLastRow ?? 10, 30));
  const journalFocus = await workbook.render({
    sheetName: "日记索引",
    range: `A1:J${journalFocusLastRow}`,
    scale: 2,
    format: "png",
  });
  await writePrivatePreview(
    path.join(effectivePreviewDir, "日记索引_焦点.png"),
    new Uint8Array(await journalFocus.arrayBuffer()),
  );
} finally {
  if (ephemeralPreviewDir !== null) {
    await fs.rm(ephemeralPreviewDir, { recursive: true, force: true });
  }
}

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await assertSourceSnapshotsUnchanged(sourceSnapshots);
await assertPortableSourceSnapshotsUnchanged(portableSourceSnapshots);
const output = await SpreadsheetFile.exportXlsx(workbook);
const stagedOutputPath = path.join(
  path.dirname(outputPath),
  `.${path.basename(outputPath)}.sync-${process.pid}-${Date.now()}.tmp.xlsx`,
);
const receiptPath = syncReceiptPath(outputPath);
const stagedReceiptPath = path.join(
  path.dirname(receiptPath),
  `.${path.basename(receiptPath)}.sync-${process.pid}-${Date.now()}.tmp`,
);
try {
  await saveArtifactSilently(output, stagedOutputPath);
  await fs.chmod(stagedOutputPath, 0o600);
  const stagedWorkbookBytes = await fs.readFile(stagedOutputPath);
  const workbookSha256 = sha256(stagedWorkbookBytes);
  const sources = Object.fromEntries(portableSourceSnapshots.map((snapshot) => [
    snapshot.key,
    {
      path_category: snapshot.pathCategory,
      present: snapshot.present,
      sha256: snapshot.sha256,
    },
  ]));
  const syncedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const receipt = {
    schema_version: 1,
    workbook_sha256: workbookSha256,
    sources,
    synced_at: syncedAt,
  };
  await writePrivateStagedFile(
    stagedReceiptPath,
    Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8"),
  );
  await assertSourceSnapshotsUnchanged(sourceSnapshots);
  await assertPortableSourceSnapshotsUnchanged(portableSourceSnapshots);
  await fs.rename(stagedOutputPath, outputPath);
  await fs.chmod(outputPath, 0o600);
  const publishedWorkbookBytes = await fs.readFile(outputPath);
  if (sha256(publishedWorkbookBytes) !== workbookSha256) {
    throw new Error("工作簿发布后的字节校验失败，未发布同步收据");
  }
  await assertSourceSnapshotsUnchanged(sourceSnapshots);
  await assertPortableSourceSnapshotsUnchanged(portableSourceSnapshots);
  await fs.rename(stagedReceiptPath, receiptPath);
  await fs.chmod(receiptPath, 0o600);
} finally {
  for (const cleanupPath of [
    stagedOutputPath,
    stagedReceiptPath,
    `${stagedOutputPath}.inspect.ndjson`,
    `${outputPath}.inspect.ndjson`,
  ]) {
    try {
      await fs.unlink(cleanupPath);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}
console.log(JSON.stringify({
  counts: {
    journal_records: journalRows.length,
    daily_checkins: dailyCheckins.length,
    weekly_reviews: weeklyReviews.length,
    rendered_sheets: finalNames.length,
    internal_table_checks: 3,
  },
  path_categories: [
    "journal-source-directory",
    "records-source-directory",
    "input-xlsx-workbook",
    "output-xlsx-workbook",
    "sync-state-receipt-json",
    "preview-png-directory",
  ],
  formula_error_scan: {
    matches_reported: formulaErrorMatches,
    max_results: 300,
  },
}));
