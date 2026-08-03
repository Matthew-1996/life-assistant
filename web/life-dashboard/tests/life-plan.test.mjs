import assert from "node:assert/strict";
import test from "node:test";

import {
  addCalendarDays,
  buildSevenDayPath,
  confirmedPhaseTruth,
  phaseState,
  shanghaiDate,
} from "../app/life-plan.js";

test("uses Asia/Shanghai when the UTC date is crossing midnight", () => {
  assert.equal(shanghaiDate(new Date("2026-08-01T15:59:59Z")), "2026-08-01");
  assert.equal(shanghaiDate(new Date("2026-08-01T16:00:00Z")), "2026-08-02");
});

test("builds exactly seven consecutive local calendar days across month and year boundaries", () => {
  const monthBoundary = buildSevenDayPath("2026-08-29");
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
  assert.equal(monthBoundary[6].date, "9/4");
  assert.equal(monthBoundary[6].day, "五");

  assert.equal(addCalendarDays("2026-12-31", 1), "2027-01-01");
});

test("uses GOALS as the explicit confirmed phase truth", () => {
  assert.deepEqual(confirmedPhaseTruth, {
    phaseId: "01",
    source: "GOALS.md",
    reviewDate: "2026-08-14",
  });
});

test("waits for review instead of promoting an unconfirmed phase by date", () => {
  const before = phaseState("2026-07-31");
  assert.equal(before.status, "upcoming");
  assert.equal(before.index, -1);
  assert.equal(before.confirmedPhase.id, "01");

  const firstDay = phaseState("2026-08-01");
  assert.equal(firstDay.status, "active");
  assert.equal(firstDay.phase.id, "01");
  assert.equal(firstDay.day, 1);
  assert.equal(firstDay.total, 14);

  const transition = phaseState("2026-08-15");
  assert.equal(transition.status, "awaiting_review");
  assert.equal(transition.phase, null);
  assert.equal(transition.confirmedPhase.id, "01");
  assert.equal(transition.nextPhase.id, "02");
  assert.equal(transition.index, 0);

  const lastDay = phaseState("2026-10-31", "05");
  assert.equal(lastDay.status, "active");
  assert.equal(lastDay.phase.id, "05");
  assert.equal(lastDay.day, lastDay.total);
  assert.equal(lastDay.progress, 100);

  const after = phaseState("2026-11-01", "05");
  assert.equal(after.status, "review_due");
  assert.equal(after.phase, null);
  assert.equal(after.progress, 100);

  const stillUnconfirmedAfterRoute = phaseState("2026-11-01");
  assert.equal(stillUnconfirmedAfterRoute.status, "awaiting_review");
  assert.equal(stillUnconfirmedAfterRoute.nextPhase.id, "02");
});

test("allows a future phase only after an explicit confirmation parameter", () => {
  const secondPhase = phaseState("2026-08-15", "02");
  assert.equal(secondPhase.status, "active");
  assert.equal(secondPhase.phase.id, "02");
  assert.equal(secondPhase.day, 1);
  assert.equal(secondPhase.confirmedIndex, 1);

  const nextReview = phaseState("2026-09-01", "02");
  assert.equal(nextReview.status, "awaiting_review");
  assert.equal(nextReview.confirmedPhase.id, "02");
  assert.equal(nextReview.nextPhase.id, "03");
});

test("rejects malformed or impossible date keys", () => {
  assert.throws(() => phaseState("2026-02-30"), /Invalid calendar date/);
  assert.throws(() => phaseState("2026-08-15", "99"), /Unknown confirmed phase/);
  assert.throws(() => buildSevenDayPath("08/01/2026"), /Expected YYYY-MM-DD/);
  assert.throws(() => addCalendarDays("2026-08-01", 0.5), /integer/);
});
