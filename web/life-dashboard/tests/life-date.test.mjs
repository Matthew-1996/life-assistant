import assert from "node:assert/strict";
import test from "node:test";

import {
  addCalendarDays,
  buildSevenDayPath,
  phaseState,
  shanghaiDate,
} from "../app/life-date.js";

// 合成数据：与真实个人数据无关，可在公共 CI 运行。
const syntheticPhases = [
  {
    id: "A",
    title: "阶段一",
    dates: "1.05 — 1.18",
    start: "2026-01-05",
    end: "2026-01-18",
    intent: "合成意图一",
    signal: "合成信号一",
    tone: "teal",
  },
  {
    id: "B",
    title: "阶段二",
    dates: "1.19 — 2.01",
    start: "2026-01-19",
    end: "2026-02-01",
    intent: "合成意图二",
    signal: "合成信号二",
    tone: "blue",
  },
];

const syntheticPathThemes = ["锚点甲", "外出乙", "活动丙", "休息丁", "小事戊", "兴趣己", "复盘庚"];

test("uses Asia/Shanghai when the UTC date is crossing midnight", () => {
  assert.equal(shanghaiDate(new Date("2026-08-01T15:59:59Z")), "2026-08-01");
  assert.equal(shanghaiDate(new Date("2026-08-01T16:00:00Z")), "2026-08-02");
});

test("builds exactly seven consecutive local calendar days across month and year boundaries", () => {
  const monthBoundary = buildSevenDayPath("2026-08-29", syntheticPathThemes);
  assert.equal(monthBoundary.length, 7);
  assert.deepEqual(
    monthBoundary.map((item) => item.iso),
    [
      "2026-08-29",
      "2026-08-30",
      "2026-08-31",
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
      "2026-09-04",
    ],
  );
  assert.equal(monthBoundary[0].date, "8/29");
  assert.equal(monthBoundary[0].day, "六");
  assert.equal(monthBoundary[0].label, "锚点甲");
  assert.equal(monthBoundary[6].date, "9/4");
  assert.equal(monthBoundary[6].day, "五");
  assert.equal(monthBoundary[6].label, "复盘庚");

  assert.equal(addCalendarDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addCalendarDays("2026-02-28", 1), "2026-03-01");
});

test("waits for review instead of promoting an unconfirmed phase by date", () => {
  const before = phaseState("2026-01-04", "A", syntheticPhases);
  assert.equal(before.status, "upcoming");
  assert.equal(before.index, -1);
  assert.equal(before.confirmedPhase.id, "A");

  const firstDay = phaseState("2026-01-05", "A", syntheticPhases);
  assert.equal(firstDay.status, "active");
  assert.equal(firstDay.phase.id, "A");
  assert.equal(firstDay.day, 1);
  assert.equal(firstDay.total, 14);

  const transition = phaseState("2026-01-19", "A", syntheticPhases);
  assert.equal(transition.status, "awaiting_review");
  assert.equal(transition.phase, null);
  assert.equal(transition.confirmedPhase.id, "A");
  assert.equal(transition.nextPhase.id, "B");
  assert.equal(transition.index, 0);

  const lastDay = phaseState("2026-02-01", "B", syntheticPhases);
  assert.equal(lastDay.status, "active");
  assert.equal(lastDay.phase.id, "B");
  assert.equal(lastDay.day, lastDay.total);
  assert.equal(lastDay.progress, 100);

  const after = phaseState("2026-02-02", "B", syntheticPhases);
  assert.equal(after.status, "review_due");
  assert.equal(after.phase, null);
  assert.equal(after.progress, 100);

  const stillUnconfirmedAfterRoute = phaseState("2026-02-02", "A", syntheticPhases);
  assert.equal(stillUnconfirmedAfterRoute.status, "awaiting_review");
  assert.equal(stillUnconfirmedAfterRoute.nextPhase.id, "B");
});

test("allows a future phase only after an explicit confirmation parameter", () => {
  const secondPhase = phaseState("2026-01-19", "B", syntheticPhases);
  assert.equal(secondPhase.status, "active");
  assert.equal(secondPhase.phase.id, "B");
  assert.equal(secondPhase.day, 1);
  assert.equal(secondPhase.confirmedIndex, 1);

  const nextReview = phaseState("2026-02-02", "B", syntheticPhases);
  assert.equal(nextReview.status, "review_due");
  assert.equal(nextReview.confirmedPhase.id, "B");
});

test("rejects malformed or impossible inputs", () => {
  assert.throws(() => phaseState("2026-02-30", "A", syntheticPhases), /Invalid calendar date/);
  assert.throws(() => phaseState("2026-01-10", "99", syntheticPhases), /Unknown confirmed phase/);
  assert.throws(() => buildSevenDayPath("08/01/2026", syntheticPathThemes), /Expected YYYY-MM-DD/);
  assert.throws(() => addCalendarDays("2026-08-01", 0.5), /integer/);
});
