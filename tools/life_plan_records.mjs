import fs from "node:fs/promises";
import path from "node:path";

export const JOURNAL_FIRST_DATA_ROW = 11;

const ratingFields = ["sleep_quality", "energy", "mood", "life_feeling"];
const anchorFields = ["wake", "body_light", "life_action", "wind_down"];
const anchorValues = new Set(["complete", "minimum", "skipped", null]);
const yesNoValues = new Set(["yes", "no", null]);
const weeklyAnswerFields = [
  "better_summary",
  "friction_summary",
  "experiment_summary",
  "stop_summary",
  "goal_intent",
];
const weeklyTextFields = weeklyAnswerFields.slice(0, 4);
const weeklyGoalIntents = new Set([
  "continue",
  "adjust",
  "downgrade",
  "pause",
  "complete",
  "replace",
  "unsure",
]);
const allowedWeeklyFields = new Set([
  "schema_version",
  "key",
  "iso_week",
  "week_start",
  "week_end",
  "answers",
  "revision",
  "created_at",
  "updated_at",
]);
const allowedCheckinFields = new Set([
  "schema_version",
  "key",
  "date",
  "sleep_time",
  "wake_time",
  "out_of_bed_time",
  "ratings",
  "awake_in_bed",
  "anchors",
  "note_summary",
  "revision",
  "created_at",
  "updated_at",
]);
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const journalTimePrecisions = new Set(["exact", "approximate", "unknown"]);
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const sensitiveSummaryPatterns = [
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?![A-Za-z0-9_-])/,
  /-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY(?: BLOCK)?-----.*?(?:-----END(?: [A-Z0-9]+)* PRIVATE KEY(?: BLOCK)?-----|$)/i,
  /(?<![A-Za-z0-9_-])sk-[A-Za-z0-9_-]{16,}(?![A-Za-z0-9_-])/,
  /(?<![A-Za-z0-9_])gh[pousr]_[A-Za-z0-9]{20,}(?![A-Za-z0-9_])/,
  /(?<![A-Za-z0-9-])xox[baprs]-[A-Za-z0-9-]{10,}(?![A-Za-z0-9-])/,
  /(?:恢复码|恢复代码|恢复密钥|recovery code|backup code)\s*[:=：]?\s*["']?(?:(?:[A-Za-z0-9]{4}[\s-]+)+[A-Za-z0-9]{4}|[A-Za-z0-9-]{8,})["']?/i,
  /\b(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key)\s*[:=：]\s*(?:"[^"]{6,}"|'[^']{6,}'|[^\s,;\uff0c\uff1b]{6,})/i,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /(?<!\d)1[3-9]\d{9}(?!\d)/,
  /(?<!\d)\d{17}[\dXx](?!\d)/,
  /(?<!\d)\d{12,19}(?!\d)/,
];

export function compactText(value) {
  if (typeof value !== "string") return "";
  return value.replaceAll(/\s+/g, " ").trim();
}

function stringList(value) {
  if (Array.isArray(value)) {
    return value.map(compactText).filter(Boolean);
  }
  const single = compactText(value);
  return single ? [single] : [];
}

function joined(value) {
  return stringList(value).join("、");
}

function hasReview(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.trim().length > 0;
  return value !== null && typeof value === "object" && Object.keys(value).length > 0;
}

function journalReviewStatus(record) {
  if (hasReview(record.monthly_reviews)) return "已纳入月回顾";
  if (hasReview(record.weekly_reviews)) return "已纳入周回顾";
  return "待整理";
}

function validIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const test = new Date(Date.UTC(year, month - 1, day));
  return test.getUTCFullYear() === year
    && test.getUTCMonth() === month - 1
    && test.getUTCDate() === day;
}

function dateObject(value, id = "日期") {
  if (!validIsoDate(value)) throw new Error(`${id} 不是有效 YYYY-MM-DD`);
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function addIsoDays(value, days) {
  const parsed = dateObject(value);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

export function isoWeekKey(value) {
  const parsed = dateObject(value, "自然周开始日期");
  const dayNumber = (parsed.getUTCDay() + 6) % 7;
  parsed.setUTCDate(parsed.getUTCDate() - dayNumber + 3);
  const isoYear = parsed.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const weekNumber = Math.ceil((((parsed - yearStart) / 86_400_000) + 1) / 7);
  return `${isoYear}-W${String(weekNumber).padStart(2, "0")}`;
}

export function excelDateSerial(value, id = "记录") {
  const normalized = compactText(value);
  if (!validIsoDate(normalized)) throw new Error(`${id} 的 date 不是有效 YYYY-MM-DD`);
  const [year, month, day] = normalized.split("-").map(Number);
  return (Date.UTC(year, month - 1, day) - Date.UTC(1899, 11, 30)) / 86_400_000;
}

export function excelTimeSerial(value, id = "记录") {
  const normalized = compactText(value);
  if (!timePattern.test(normalized)) throw new Error(`${id} 的时间不是 HH:MM`);
  const [hours, minutes] = normalized.split(":").map(Number);
  return (hours * 60 + minutes) / 1_440;
}

function journalTimeWorkbookValue(record, id) {
  const time = compactText(record.time);
  const precision = compactText(record.time_precision) || (time ? "exact" : "unknown");
  if (!journalTimePrecisions.has(precision)) {
    throw new Error(`${id} 的 time_precision 无效`);
  }
  if (precision === "unknown") {
    if (time) throw new Error(`${id} 的未知时间不得含 HH:MM`);
    return null;
  }
  if (!time) throw new Error(`${id} 的 ${precision} 时间缺少 HH:MM`);
  const serial = excelTimeSerial(time, id);
  return precision === "approximate" ? `约 ${time}` : serial;
}

function peopleAndPlaces(record) {
  const people = joined(record.people);
  const places = joined(record.places);
  return [people ? `人物：${people}` : "", places ? `地点：${places}` : ""]
    .filter(Boolean)
    .join("；");
}

async function readJsonLines(filePath, missingIsEmpty) {
  let bytes;
  try {
    bytes = await fs.readFile(filePath);
  } catch (error) {
    if (missingIsEmpty && error?.code === "ENOENT") bytes = Buffer.alloc(0);
    else throw error;
  }
  const content = bytes.toString("utf8");
  if (!Buffer.from(content, "utf8").equals(bytes)) {
    throw new Error(`${path.basename(filePath)} 不是有效 UTF-8`);
  }
  const records = [];
  for (const [offset, lineText] of content.split(/\r?\n/).entries()) {
    if (!lineText.trim()) continue;
    let record;
    try {
      record = JSON.parse(lineText);
    } catch (error) {
      throw new Error(`${path.basename(filePath)} 第 ${offset + 1} 行不是有效 JSON`, { cause: error });
    }
    if (record === null || typeof record !== "object" || Array.isArray(record)) {
      throw new Error(`${path.basename(filePath)} 第 ${offset + 1} 行必须是对象`);
    }
    records.push(record);
  }
  return { records, snapshot: { filePath, bytes } };
}

export async function assertSourceSnapshotsUnchanged(snapshots) {
  for (const snapshot of snapshots) {
    let current;
    try {
      current = await fs.readFile(snapshot.filePath);
    } catch (error) {
      if (error?.code === "ENOENT") current = Buffer.alloc(0);
      else throw error;
    }
    if (!current.equals(snapshot.bytes)) {
      throw new Error("同步期间源台账已变更，已停止覆盖工作簿；请重新同步");
    }
  }
}

export async function loadJournalSource(root) {
  const source = await readJsonLines(path.join(root, "index.jsonl"), true);
  const rows = source.records
    .filter((record) => record.status === "active")
    .sort((left, right) => {
      const leftKey = `${compactText(left.date)}T${compactText(left.time)}T${compactText(left.id)}`;
      const rightKey = `${compactText(right.date)}T${compactText(right.time)}T${compactText(right.id)}`;
      return rightKey.localeCompare(leftKey);
    })
    .map((record) => {
      const id = compactText(record.id) || "未知 ID";
      return [
        excelDateSerial(record.date, `日记 ${id}`),
        journalTimeWorkbookValue(record, `日记 ${id}`),
        compactText(record.title),
        compactText(record.summary),
        joined(record.feelings),
        peopleAndPlaces(record),
        joined(record.tags),
        joined(record.themes),
        compactText(record.file),
        journalReviewStatus(record),
      ];
    });
  return { rows, snapshot: source.snapshot };
}

export async function loadJournalRows(root) {
  return (await loadJournalSource(root)).rows;
}

function validateExactFields(record, expected) {
  const actual = Object.keys(record).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((field, index) => field === wanted[index]);
}

function timestampValue(value) {
  if (typeof value !== "string" || !timestampPattern.test(value)) return null;
  const epoch = Date.parse(value);
  if (Number.isNaN(epoch)) return null;
  return new Date(epoch).toISOString().replace(".000Z", "Z") === value ? epoch : null;
}

function validateDailyCheckin(record, lineNumber) {
  const prefix = `daily-checkins.jsonl 第 ${lineNumber} 行`;
  if (!validateExactFields(record, allowedCheckinFields)) {
    throw new Error(`${prefix}字段集无效；为避免原文泄漏已停止同步`);
  }
  const date = compactText(record.date);
  if (!validIsoDate(date)
    || record.schema_version !== 2
    || record.key !== `daily-checkin:${date}`
    || !Number.isInteger(record.revision)
    || record.revision < 1) {
    throw new Error(`${prefix}的日期、稳定键、版本或 revision 无效`);
  }
  const createdAt = timestampValue(record.created_at);
  const updatedAt = timestampValue(record.updated_at);
  if (createdAt === null || updatedAt === null || createdAt > updatedAt) {
    throw new Error(`${prefix}的 created_at / updated_at 无效`);
  }
  for (const [field, value] of [
    ["sleep_time", record.sleep_time],
    ["wake_time", record.wake_time],
    ["out_of_bed_time", record.out_of_bed_time],
  ]) {
    if (value !== null && (typeof value !== "string" || !timePattern.test(value))) {
      throw new Error(`${prefix}的 ${field} 无效`);
    }
  }
  if (record.ratings === null || typeof record.ratings !== "object" || Array.isArray(record.ratings)
    || !validateExactFields(record.ratings, ratingFields)) {
    throw new Error(`${prefix}的 ratings 结构无效`);
  }
  for (const field of ratingFields) {
    const value = record.ratings[field];
    if (value !== null && (!Number.isInteger(value) || value < 1 || value > 5)) {
      throw new Error(`${prefix}的 ratings.${field} 无效`);
    }
  }
  if (record.anchors === null || typeof record.anchors !== "object" || Array.isArray(record.anchors)
    || !validateExactFields(record.anchors, anchorFields)) {
    throw new Error(`${prefix}的 anchors 结构无效`);
  }
  for (const field of anchorFields) {
    if (!anchorValues.has(record.anchors[field])) {
      throw new Error(`${prefix}的 anchors.${field} 无效`);
    }
  }
  if (!yesNoValues.has(record.awake_in_bed)) {
    throw new Error(`${prefix}的 awake_in_bed 无效`);
  }
  if (record.note_summary !== null) {
    if (typeof record.note_summary !== "string"
      || compactText(record.note_summary) !== record.note_summary
      || record.note_summary.length > 160
      || sensitiveSummaryPatterns.some((pattern) => pattern.test(record.note_summary))) {
      throw new Error(`${prefix}的 note_summary 未通过去敏校验`);
    }
  }
  return record;
}

export async function loadDailyCheckinSource(root) {
  const source = await readJsonLines(path.join(root, "daily-checkins.jsonl"), true);
  const seen = new Set();
  const records = source.records.map((record, index) => {
    const validated = validateDailyCheckin(record, index + 1);
    if (seen.has(validated.date)) {
      throw new Error("daily-checkins.jsonl 存在重复日期，已停止同步");
    }
    seen.add(validated.date);
    return validated;
  }).sort((left, right) => left.date.localeCompare(right.date));
  return { records, snapshot: source.snapshot };
}

export async function loadDailyCheckins(root) {
  return (await loadDailyCheckinSource(root)).records;
}

function validateWeeklyReview(record, lineNumber) {
  const prefix = `weekly-reviews.jsonl 第 ${lineNumber} 行`;
  if (!validateExactFields(record, allowedWeeklyFields)) {
    throw new Error(`${prefix}字段集无效；为避免原始回复泄漏已停止同步`);
  }
  const weekStart = compactText(record.week_start);
  const weekEnd = compactText(record.week_end);
  if (!validIsoDate(weekStart) || !validIsoDate(weekEnd)) {
    throw new Error(`${prefix}的自然周日期无效`);
  }
  const startDate = dateObject(weekStart);
  const expectedEnd = addIsoDays(weekStart, 6);
  const expectedIsoWeek = isoWeekKey(weekStart);
  if (startDate.getUTCDay() !== 1
    || weekEnd !== expectedEnd
    || record.iso_week !== expectedIsoWeek
    || record.key !== `weekly-review:${expectedIsoWeek}`
    || record.schema_version !== 1
    || !Number.isInteger(record.revision)
    || record.revision < 1) {
    throw new Error(`${prefix}的周一/周日、ISO 周、稳定键、版本或 revision 无效`);
  }
  const createdAt = timestampValue(record.created_at);
  const updatedAt = timestampValue(record.updated_at);
  if (createdAt === null || updatedAt === null || createdAt > updatedAt) {
    throw new Error(`${prefix}的 created_at / updated_at 无效`);
  }
  if (record.answers === null || typeof record.answers !== "object" || Array.isArray(record.answers)
    || !validateExactFields(record.answers, weeklyAnswerFields)) {
    throw new Error(`${prefix}的 answers 结构无效`);
  }
  for (const field of weeklyTextFields) {
    const value = record.answers[field];
    if (value !== null && (typeof value !== "string"
      || compactText(value) !== value
      || value.length === 0
      || value.length > 160
      || sensitiveSummaryPatterns.some((pattern) => pattern.test(value)))) {
      throw new Error(`${prefix}的 answers.${field} 未通过去敏校验`);
    }
  }
  if (record.answers.goal_intent !== null
    && !weeklyGoalIntents.has(record.answers.goal_intent)) {
    throw new Error(`${prefix}的 answers.goal_intent 无效`);
  }
  if (!weeklyAnswerFields.some((field) => record.answers[field] !== null)) {
    throw new Error(`${prefix}不能是一条全空周复盘`);
  }
  return record;
}

export async function loadWeeklyReviewSource(root) {
  const source = await readJsonLines(path.join(root, "weekly-reviews.jsonl"), true);
  const seenKeys = new Set();
  const seenWeeks = new Set();
  const records = source.records.map((record, index) => {
    const validated = validateWeeklyReview(record, index + 1);
    if (seenKeys.has(validated.key) || seenWeeks.has(validated.iso_week)) {
      throw new Error("weekly-reviews.jsonl 存在重复自然周，已停止同步");
    }
    seenKeys.add(validated.key);
    seenWeeks.add(validated.iso_week);
    return validated;
  }).sort((left, right) => left.week_start.localeCompare(right.week_start));
  return { records, snapshot: source.snapshot };
}

export async function loadWeeklyReviews(root) {
  return (await loadWeeklyReviewSource(root)).records;
}

export function weeklyReviewWorkbookValues(record) {
  if (record === null) return [null, null, null, null, null, null];
  const goalLabels = {
    continue: "继续当前重点",
    adjust: "调整当前重点",
    downgrade: "降为辅助目标",
    pause: "暂停当前重点",
    complete: "完成当前重点",
    replace: "替换当前重点",
    unsure: "暂不决定",
  };
  const answered = weeklyAnswerFields.filter((field) => record.answers[field] !== null).length;
  return [
    record.answers.better_summary,
    record.answers.friction_summary,
    record.answers.experiment_summary,
    record.answers.stop_summary,
    record.answers.goal_intent === null ? null : goalLabels[record.answers.goal_intent],
    answered === weeklyAnswerFields.length ? "已复盘" : "部分复盘",
  ];
}

// 阶段路线配置从 iCloud-only 的 life-plan-schedule.json 运行时注入，
// 不入 git（个人日程数据，与 GOALS.md 同源）。
export async function loadPhaseSchedule(root) {
  if (typeof root !== "string" || !root) {
    throw new Error("loadPhaseSchedule 需要项目根目录");
  }
  const schedulePath = path.join(root, "life-plan-schedule.json");
  let raw;
  try {
    raw = JSON.parse(await fs.readFile(schedulePath, "utf8"));
  } catch (error) {
    throw new Error(`无法读取阶段路线配置 ${schedulePath}: ${error.message}`);
  }
  return normalizePhaseSchedule(raw);
}

export function normalizePhaseSchedule(schedule) {
  if (!schedule || typeof schedule !== "object" || Array.isArray(schedule)) {
    throw new Error("阶段路线配置必须是对象");
  }
  const { anchor_week_start, weeks, phases } = schedule;
  if (typeof anchor_week_start !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(anchor_week_start)) {
    throw new Error("阶段路线配置缺少有效的 anchor_week_start（YYYY-MM-DD）");
  }
  if (dateObject(anchor_week_start).getUTCDay() !== 1) {
    throw new Error("anchor_week_start 必须是周一");
  }
  if (!Number.isInteger(weeks) || weeks < 1) {
    throw new Error("阶段路线配置的 weeks 必须是正整数");
  }
  if (!Array.isArray(phases) || phases.length === 0) {
    throw new Error("阶段路线配置的 phases 必须是非空数组");
  }
  let prevEnd = null;
  for (const phase of phases) {
    if (
      !phase || typeof phase !== "object" || Array.isArray(phase)
      || typeof phase.id !== "string" || !phase.id.trim()
      || typeof phase.title !== "string" || !phase.title.trim()
      || typeof phase.start !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(phase.start)
      || typeof phase.end !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(phase.end)
      || phase.start > phase.end
    ) {
      throw new Error("阶段路线配置含无效 phase（需要非空 id/title 与 YYYY-MM-DD 的 start<=end）");
    }
    if (prevEnd !== null && phase.start <= prevEnd) {
      throw new Error("阶段路线配置的 phases 必须有序且不重叠");
    }
    prevEnd = phase.end;
  }
  return Object.freeze({
    anchor_week_start,
    weeks,
    phases: phases.map((phase) => Object.freeze({ ...phase })),
  });
}

function phaseIndexLabel(id) {
  // 兼容 "01" 与 "1" 两种 id 风格，保持旧工作簿 "阶段 1｜…" 的显示格式
  return /^\d+$/.test(id) ? String(Number(id)) : id;
}

function phaseLabel(phase) {
  return `阶段 ${phaseIndexLabel(phase.id)}｜${phase.title}`;
}

function phaseForDate(value, phases) {
  const phase = phases.find((entry) => entry.start <= value && value <= entry.end);
  if (!phase) throw new Error(`自然周日期 ${value} 不在当前阶段路线内`);
  return phase;
}

function phaseForWeek(weekStart, weekEnd, phases) {
  const startPhase = phaseForDate(weekStart, phases);
  const endPhase = phaseForDate(weekEnd, phases);
  return startPhase.id === endPhase.id
    ? phaseLabel(startPhase)
    : `阶段 ${phaseIndexLabel(startPhase.id)} → 阶段 ${phaseIndexLabel(endPhase.id)}`;
}

export function weeklyScaffoldRows(schedule) {
  const normalized = normalizePhaseSchedule(schedule);
  return Array.from({ length: normalized.weeks }, (_, index) => {
    const weekStart = addIsoDays(normalized.anchor_week_start, index * 7);
    const weekEnd = addIsoDays(weekStart, 6);
    return {
      week_start: weekStart,
      week_end: weekEnd,
      iso_week: isoWeekKey(weekStart),
      phase: phaseForWeek(weekStart, weekEnd, normalized.phases),
    };
  });
}

export function weeklyWorkbookSyncPlan(scaffold, records) {
  if (!Array.isArray(scaffold) || !Array.isArray(records)) {
    throw new Error("每周复盘同步输入无效");
  }
  const rowsByWeek = new Map();
  for (const row of scaffold) {
    if (row === null || typeof row !== "object"
      || dateObject(row.week_start).getUTCDay() !== 1
      || row.week_end !== addIsoDays(row.week_start, 6)
      || row.iso_week !== isoWeekKey(row.week_start)
      || typeof row.phase !== "string"
      || !row.phase.trim()) {
      throw new Error("每周复盘脚手架含无效自然周");
    }
    if (rowsByWeek.has(row.iso_week)) throw new Error("每周复盘脚手架含重复 ISO 周");
    rowsByWeek.set(row.iso_week, row);
  }
  const recordsByWeek = new Map();
  for (const record of records) {
    if (recordsByWeek.has(record.iso_week)) throw new Error("周复盘源含重复 ISO 周");
    if (!rowsByWeek.has(record.iso_week)) {
      throw new Error(`‘每周复盘’未预留 ${record.iso_week}；台账未丢失，请先扩展工作簿周期`);
    }
    recordsByWeek.set(record.iso_week, record);
  }
  return scaffold.map((row) => ({
    ...row,
    values: [
      excelDateSerial(row.week_start, row.iso_week),
      excelDateSerial(row.week_end, row.iso_week),
      row.iso_week,
      row.phase,
      ...weeklyReviewWorkbookValues(recordsByWeek.get(row.iso_week) ?? null),
    ],
  }));
}

export function journalRangePlan(recordCount, previousUsedRowCount = 0) {
  if (!Number.isInteger(recordCount) || recordCount < 0) throw new Error("recordCount 必须是非负整数");
  const dataLastRow = recordCount > 0 ? JOURNAL_FIRST_DATA_ROW + recordCount - 1 : null;
  const clearLastRow = Math.max(previousUsedRowCount, dataLastRow ?? 0);
  const dataRange = dataLastRow === null ? null : `A${JOURNAL_FIRST_DATA_ROW}:J${dataLastRow}`;
  const clearRange = clearLastRow >= JOURNAL_FIRST_DATA_ROW
    ? `A${JOURNAL_FIRST_DATA_ROW}:J${clearLastRow}`
    : null;
  const dateRange = dataLastRow === null ? null : `A${JOURNAL_FIRST_DATA_ROW}:A${dataLastRow}`;
  const statusRange = dataLastRow === null ? null : `J${JOURNAL_FIRST_DATA_ROW}:J${dataLastRow}`;
  return {
    recordCount,
    dataLastRow,
    clearLastRow: clearLastRow >= JOURNAL_FIRST_DATA_ROW ? clearLastRow : null,
    dataRange,
    clearRange,
    dateRange,
    statusRange,
    formulas: dataLastRow === null
      ? { count: "=0", latestDate: "=\"—\"", pending: "=0" }
      : {
          count: `=COUNTA(${dateRange})`,
          latestDate: `=IF(COUNTA(${dateRange})=0,"\u2014",MAX(${dateRange}))`,
          pending: `=COUNTIF(${statusRange},"待整理")`,
        },
  };
}

export function workbookDateKey(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const utc = Date.UTC(1899, 11, 30) + Math.round(value) * 86_400_000;
    return new Date(utc).toISOString().slice(0, 10);
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const text = compactText(value);
  return validIsoDate(text) ? text : null;
}

export function dailyCheckinWorkbookValues(record) {
  const anchorLabels = { complete: "完成", minimum: "最低版", skipped: "跳过" };
  return [
    record.sleep_time === null ? null : excelTimeSerial(record.sleep_time, record.key),
    record.wake_time === null ? null : excelTimeSerial(record.wake_time, record.key),
    record.out_of_bed_time === null ? null : excelTimeSerial(record.out_of_bed_time, record.key),
    record.ratings.sleep_quality,
    record.ratings.energy,
    record.ratings.mood,
    record.ratings.life_feeling,
    record.awake_in_bed === null ? null : (record.awake_in_bed === "yes" ? "是" : "否"),
    ...anchorFields.map((field) => record.anchors[field] === null ? null : anchorLabels[record.anchors[field]]),
    record.note_summary,
  ];
}

export function dailyDateRows(usedValues) {
  if (!Array.isArray(usedValues)) throw new Error("‘每日记录’的已用区域无效");
  const headerIndex = usedValues.findIndex((row) => Array.isArray(row) && compactText(row[0]) === "日期");
  if (headerIndex < 0) throw new Error("‘每日记录’缺少‘日期’表头");
  const rows = new Map();
  for (let index = headerIndex + 1; index < usedValues.length; index += 1) {
    const key = workbookDateKey(usedValues[index]?.[0]);
    if (key === null) continue;
    if (rows.has(key)) throw new Error(`‘每日记录’存在重复日期 ${key}`);
    rows.set(key, index + 1);
  }
  return rows;
}

export function dailyWorkbookSyncPlan(dateRows, records) {
  if (!(dateRows instanceof Map) || !Array.isArray(records)) {
    throw new Error("每日记录同步输入无效");
  }
  const clearRows = [...dateRows.values()];
  if (clearRows.some((rowNumber) => !Number.isInteger(rowNumber) || rowNumber < 1)) {
    throw new Error("‘每日记录’日期行映射无效");
  }
  const missingDates = records
    .map((record) => record.date)
    .filter((date) => !dateRows.has(date));
  if (missingDates.length > 0) {
    throw new Error(
      `‘每日记录’未预留 ${missingDates.join("、")} 的日期行；台账未丢失，请先扩展工作簿日期范围`,
    );
  }
  const writes = records.map((record) => ({
    date: record.date,
    rowNumber: dateRows.get(record.date),
    values: dailyCheckinWorkbookValues(record),
  }));
  return { clearRows, writes };
}
