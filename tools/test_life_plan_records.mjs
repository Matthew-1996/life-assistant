import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  assertSourceSnapshotsUnchanged,
  dailyCheckinWorkbookValues,
  dailyDateRows,
  dailyWorkbookSyncPlan,
  isoWeekKey,
  journalRangePlan,
  loadDailyCheckinSource,
  loadJournalSource,
  loadPhaseSchedule,
  loadWeeklyReviewSource,
  normalizePhaseSchedule,
  weeklyReviewWorkbookValues,
  weeklyScaffoldRows,
  weeklyWorkbookSyncPlan,
} from "./life_plan_records.mjs";

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "life-plan-records-test-"));

function checkin(overrides = {}) {
  return {
    schema_version: 2,
    key: "daily-checkin:2026-08-02",
    date: "2026-08-02",
    sleep_time: "01:40",
    wake_time: "09:50",
    out_of_bed_time: "10:10",
    ratings: { sleep_quality: 3, energy: 2, mood: 3, life_feeling: 2 },
    awake_in_bed: "no",
    anchors: { wake: "complete", body_light: "minimum", life_action: "skipped", wind_down: "complete" },
    note_summary: "散步后稍舒服",
    revision: 1,
    created_at: "2026-08-02T03:20:00Z",
    updated_at: "2026-08-02T03:20:00Z",
    ...overrides,
  };
}

function weeklyReview(overrides = {}) {
  return {
    schema_version: 1,
    key: "weekly-review:2026-W02",
    iso_week: "2026-W02",
    week_start: "2026-01-05",
    week_end: "2026-01-11",
    answers: {
      better_summary: "早上离床比前一周容易",
      friction_summary: null,
      experiment_summary: "工作日下午散步十分钟",
      stop_summary: null,
      goal_intent: "continue",
    },
    revision: 1,
    created_at: "2026-01-11T04:00:00Z",
    updated_at: "2026-01-11T04:00:00Z",
    ...overrides,
  };
}

try {
  const journalRoot = path.join(tempRoot, "journal");
  await fs.mkdir(journalRoot, { recursive: true });
  const journalRecords = Array.from({ length: 137 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10);
    return {
      id: `j-${String(index).padStart(3, "0")}`,
      date,
      time: "12:00",
      status: "active",
      title: `记录 ${index}`,
      summary: `摘要 ${index}`,
      feelings: [],
      people: [],
      places: [],
      tags: [],
      themes: [],
      file: `entries/${date.slice(0, 7)}.md`,
      weekly_reviews: [],
      monthly_reviews: [],
    };
  });
  await fs.writeFile(
    path.join(journalRoot, "index.jsonl"),
    `${journalRecords.map((record) => JSON.stringify(record)).join("\n")}\n`,
  );
  const journalSource = await loadJournalSource(journalRoot);
  assert.equal(journalSource.rows.length, 137, "不得截断 100 条以后的日记");
  assert.equal(journalSource.rows[0][2], "记录 136");
  const unknownTimeRecord = {
    ...journalRecords[0],
    id: "j-unknown-time",
    date: "2026-12-31",
    time: null,
    time_precision: "unknown",
    title: "只知道日期的记录",
  };
  const approximateTimeRecord = {
    ...journalRecords[0],
    id: "j-approximate-time",
    date: "2026-12-30",
    time: "21:00",
    time_precision: "approximate",
    title: "大约九点的记录",
  };
  journalRecords.push(unknownTimeRecord, approximateTimeRecord);
  await fs.writeFile(
    path.join(journalRoot, "index.jsonl"),
    `${journalRecords.map((record) => JSON.stringify(record)).join("\n")}\n`,
  );
  const sourceWithTimePrecisions = await loadJournalSource(journalRoot);
  const unknownTimeRow = sourceWithTimePrecisions.rows.find((row) => row[2] === "只知道日期的记录");
  const approximateTimeRow = sourceWithTimePrecisions.rows.find((row) => row[2] === "大约九点的记录");
  const exactTimeRow = sourceWithTimePrecisions.rows.find((row) => row[2] === "记录 0");
  assert.equal(unknownTimeRow[1], null);
  assert.equal(approximateTimeRow[1], "约 21:00");
  assert.equal(exactTimeRow[1], 0.5);
  unknownTimeRecord.time = "12:00";
  await fs.writeFile(
    path.join(journalRoot, "index.jsonl"),
    `${journalRecords.map((record) => JSON.stringify(record)).join("\n")}\n`,
  );
  await assert.rejects(() => loadJournalSource(journalRoot), /未知时间不得含 HH:MM/);
  const rangePlan = journalRangePlan(137, 110);
  assert.equal(rangePlan.dataRange, "A11:J147");
  assert.equal(rangePlan.clearRange, "A11:J147");
  assert.equal(rangePlan.formulas.count, "=COUNTA(A11:A147)");
  assert.equal(rangePlan.formulas.latestDate, "=IF(COUNTA(A11:A147)=0,\"—\",MAX(A11:A147))");
  assert.equal(rangePlan.formulas.pending, "=COUNTIF(J11:J147,\"待整理\")");
  assert.deepEqual(journalRangePlan(0, 0).formulas, {
    count: "=0",
    latestDate: "=\"—\"",
    pending: "=0",
  });
  assert.equal(journalRangePlan(0, 110).clearRange, "A11:J110");

  const recordsRoot = path.join(tempRoot, "records");
  await fs.mkdir(recordsRoot, { recursive: true });
  const recordPath = path.join(recordsRoot, "daily-checkins.jsonl");
  await fs.writeFile(recordPath, `${JSON.stringify(checkin())}\n`);
  const dailySource = await loadDailyCheckinSource(recordsRoot);
  assert.equal(dailySource.records.length, 1);
  const values = dailyCheckinWorkbookValues(dailySource.records[0]);
  assert.equal(values.length, 13);
  assert.equal(values[2], (10 * 60 + 10) / 1440);
  assert.equal(values[3], 3);
  assert.equal(values[7], "否");
  assert.deepEqual(values.slice(8, 12), ["完成", "最低版", "跳过", "完成"]);

  const rows = dailyDateRows([
    ["每日记录"],
    [null],
    ["日期"],
    [46235],
    [46236],
  ]);
  assert.equal(rows.get("2026-08-02"), 5);
  const populatedPlan = dailyWorkbookSyncPlan(rows, dailySource.records);
  assert.deepEqual(populatedPlan.clearRows, [4, 5]);
  assert.equal(populatedPlan.writes.length, 1);
  assert.equal(populatedPlan.writes[0].rowNumber, 5);
  assert.equal(populatedPlan.writes[0].values[3], 3);
  const afterDeletionPlan = dailyWorkbookSyncPlan(rows, []);
  assert.deepEqual(afterDeletionPlan.clearRows, [4, 5]);
  assert.deepEqual(afterDeletionPlan.writes, []);
  assert.throws(
    () => dailyWorkbookSyncPlan(new Map([["2026-08-01", 4]]), dailySource.records),
    /未预留 2026-08-02/,
  );

  await fs.writeFile(recordPath, `${JSON.stringify({ ...checkin(), raw_transcript: "不应存在" })}\n`);
  await assert.rejects(() => loadDailyCheckinSource(recordsRoot), /字段集无效/);
  await fs.writeFile(recordPath, `${JSON.stringify(checkin({ updated_at: "2026-99-99T25:61:61Z" }))}\n`);
  await assert.rejects(() => loadDailyCheckinSource(recordsRoot), /created_at \/ updated_at 无效/);
  await fs.writeFile(recordPath, JSON.stringify(checkin({ updated_at: "2026-02-31T00:00:00Z" })) + "\n");
  await assert.rejects(() => loadDailyCheckinSource(recordsRoot), /created_at \/ updated_at 无效/);
  const secretSummaries = [
    "s" + "k-abcdefghijklmnopqrstuvwx",
    "ey" + "Jabcdefgh.abcdefgh.abcdefgh-",
    "pass" + "word：\"quoted credential value\"",
    "recovery" + " code: 1234 5678",
    "-----BEGIN ENCRYPTED " + "PRIVATE KEY----- body -----END ENCRYPTED PRIVATE KEY-----",
    "-----BEGIN DSA " + "PRIVATE KEY----- body -----END DSA PRIVATE KEY-----",
    "-----BEGIN PGP " + "PRIVATE KEY BLOCK----- body -----END PGP PRIVATE KEY BLOCK-----",
  ];
  for (const secretSummary of secretSummaries) {
    await fs.writeFile(recordPath, JSON.stringify(checkin({ note_summary: secretSummary })) + "\n");
    await assert.rejects(() => loadDailyCheckinSource(recordsRoot), /note_summary 未通过去敏校验/);
  }

  await fs.writeFile(recordPath, `${JSON.stringify(checkin())}\n`);
  const snapshotSource = await loadDailyCheckinSource(recordsRoot);
  await fs.writeFile(recordPath, `${JSON.stringify(checkin({ revision: 2, updated_at: "2026-08-02T03:21:00Z" }))}\n`);
  await assert.rejects(
    () => assertSourceSnapshotsUnchanged([snapshotSource.snapshot]),
    /源台账已变更/,
  );

  assert.equal(isoWeekKey("2026-08-03"), "2026-W32");
  assert.equal(isoWeekKey("2025-12-29"), "2026-W01");
  // 合成阶段路线（与个人数据无关，可在公共 CI 运行）
  const schedule = {
    anchor_week_start: "2026-01-05",
    weeks: 8,
    phases: [
      { id: "1", start: "2026-01-05", end: "2026-01-14", title: "阶段甲" },
      { id: "2", start: "2026-01-15", end: "2026-01-28", title: "阶段乙" },
      { id: "3", start: "2026-01-29", end: "2026-02-11", title: "阶段丙" },
      { id: "4", start: "2026-02-12", end: "2026-03-01", title: "阶段丁" },
    ],
  };
  const scaffold = weeklyScaffoldRows(schedule);
  assert.equal(scaffold.length, 8);
  assert.deepEqual(scaffold[0], {
    week_start: "2026-01-05",
    week_end: "2026-01-11",
    iso_week: "2026-W02",
    phase: "阶段 1｜阶段甲",
  });
  assert.equal(scaffold[1].phase, "阶段 1 → 阶段 2");
  assert.equal(scaffold[3].phase, "阶段 2 → 阶段 3");
  assert.equal(scaffold[5].phase, "阶段 3 → 阶段 4");
  assert.equal(scaffold.at(-1).iso_week, "2026-W09");

  const weeklyPath = path.join(recordsRoot, "weekly-reviews.jsonl");
  await fs.writeFile(weeklyPath, `${JSON.stringify(weeklyReview())}\n`);
  const weeklySource = await loadWeeklyReviewSource(recordsRoot);
  assert.equal(weeklySource.records.length, 1);
  assert.deepEqual(weeklyReviewWorkbookValues(weeklySource.records[0]), [
    "早上离床比前一周容易",
    null,
    "工作日下午散步十分钟",
    null,
    "继续当前重点",
    "部分复盘",
  ]);
  assert.deepEqual(weeklyReviewWorkbookValues(null), [
    null, null, null, null, null, null,
  ]);
  const weeklyPlan = weeklyWorkbookSyncPlan(scaffold, weeklySource.records);
  assert.equal(weeklyPlan.length, 8);
  assert.equal(weeklyPlan[0].values.length, 10);
  assert.equal(weeklyPlan[0].values[2], "2026-W02");
  assert.equal(weeklyPlan[0].values[4], "早上离床比前一周容易");
  assert.equal(weeklyPlan[1].values[4], null);
  assert.equal(weeklyPlan[1].values[9], null);

  await fs.writeFile(weeklyPath, `${JSON.stringify(weeklyReview({ raw_transcript: "不应存在" }))}\n`);
  await assert.rejects(() => loadWeeklyReviewSource(recordsRoot), /字段集无效/);
  await fs.writeFile(weeklyPath, `${JSON.stringify(weeklyReview({ week_start: "2026-01-06" }))}\n`);
  await assert.rejects(() => loadWeeklyReviewSource(recordsRoot), /周一\/周日/);
  await fs.writeFile(weeklyPath, `${JSON.stringify(weeklyReview({
    answers: { ...weeklyReview().answers, better_summary: "person@example.com" },
  }))}\n`);
  await assert.rejects(() => loadWeeklyReviewSource(recordsRoot), /去敏校验/);
  await fs.writeFile(weeklyPath, `${JSON.stringify(weeklyReview({
    key: "weekly-review:2026-W11",
    iso_week: "2026-W11",
    week_start: "2026-03-09",
    week_end: "2026-03-15",
  }))}\n`);
  const outsideSource = await loadWeeklyReviewSource(recordsRoot);
  assert.throws(
    () => weeklyWorkbookSyncPlan(scaffold, outsideSource.records),
    /未预留 2026-W11/,
  );

  // 阶段路线配置校验：合成数据
  const validSchedule = {
    anchor_week_start: "2026-01-05",
    weeks: 8,
    phases: [
      { id: "1", start: "2026-01-05", end: "2026-01-14", title: "阶段甲" },
      { id: "2", start: "2026-01-15", end: "2026-01-28", title: "阶段乙" },
    ],
  };
  assert.equal(normalizePhaseSchedule(validSchedule).phases.length, 2);
  assert.throws(
    () => normalizePhaseSchedule({ ...validSchedule, anchor_week_start: "2026-01-06" }),
    /必须是周一/,
  );
  assert.throws(() => normalizePhaseSchedule({ ...validSchedule, weeks: 0 }), /正整数/);
  assert.throws(() => normalizePhaseSchedule({ ...validSchedule, phases: [] }), /非空数组/);
  assert.throws(
    () => normalizePhaseSchedule({
      ...validSchedule,
      phases: [
        { id: "1", start: "2026-01-05", end: "2026-01-20", title: "阶段甲" },
        { id: "2", start: "2026-01-15", end: "2026-01-28", title: "阶段乙" },
      ],
    }),
    /不重叠/,
  );
  assert.throws(
    () => normalizePhaseSchedule({
      ...validSchedule,
      phases: [{ id: "1", start: "2026-01-28", end: "2026-01-05", title: "阶段甲" }],
    }),
    /无效 phase/,
  );
  const schedulePath = path.join(tempRoot, "life-plan-schedule.json");
  await fs.writeFile(schedulePath, JSON.stringify(validSchedule));
  assert.equal((await loadPhaseSchedule(tempRoot)).weeks, 8);
  assert.equal((await loadPhaseSchedule(tempRoot)).phases[1].title, "阶段乙");
  await fs.rm(schedulePath);
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}

console.log("life_plan_records tests passed");
