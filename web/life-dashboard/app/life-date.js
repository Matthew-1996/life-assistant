// Reusable date & phase-state logic for the life dashboard.
// No personal data here: user-specific values (the phase list, the confirmed
// phase and the seven-day path themes) are injected as function parameters by
// the gitignored app/life-plan.js glue layer, which sources them from the
// iCloud-only ../personal.config.js.

const weekdayNames = ["日", "一", "二", "三", "四", "五", "六"];
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

export function assertIsoDate(isoDate) {
  if (!isoDatePattern.test(isoDate)) {
    throw new TypeError(`Expected YYYY-MM-DD, received ${isoDate}`);
  }

  const [year, month, day] = isoDate.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new TypeError(`Invalid calendar date: ${isoDate}`);
  }
}

export function shanghaiDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function addCalendarDays(isoDate, offset) {
  assertIsoDate(isoDate);
  if (!Number.isInteger(offset)) {
    throw new TypeError("Day offset must be an integer");
  }

  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + offset)).toISOString().slice(0, 10);
}

export function buildSevenDayPath(today, pathThemes) {
  assertIsoDate(today);

  return pathThemes.map((label, offset) => {
    const iso = addCalendarDays(today, offset);
    const [year, month, day] = iso.split("-").map(Number);
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();

    return {
      day: weekdayNames[weekday],
      date: `${month}/${day}`,
      iso,
      label,
    };
  });
}

export function phaseState(today, confirmedPhaseId, phases) {
  assertIsoDate(today);

  const firstPhase = phases[0];
  const lastPhase = phases.at(-1);
  const confirmedIndex = phases.findIndex((phase) => phase.id === confirmedPhaseId);

  if (confirmedIndex < 0) {
    throw new TypeError(`Unknown confirmed phase: ${confirmedPhaseId}`);
  }

  const confirmedPhase = phases[confirmedIndex];
  const nextPhase = phases[confirmedIndex + 1] ?? null;

  if (today < firstPhase.start) {
    return {
      today,
      status: "upcoming",
      phase: firstPhase,
      index: -1,
      confirmedIndex,
      confirmedPhase,
      nextPhase,
      total: 0,
      day: 0,
      progress: 0,
    };
  }

  const calendarIndex = phases.findIndex(
    (phase) => today >= phase.start && today <= phase.end,
  );

  if (calendarIndex >= 0 && calendarIndex <= confirmedIndex) {
    const phase = phases[calendarIndex];
    const start = Date.parse(`${phase.start}T00:00:00+08:00`);
    const end = Date.parse(`${phase.end}T00:00:00+08:00`);
    const current = Date.parse(`${today}T00:00:00+08:00`);
    const total = Math.round((end - start) / 86400000) + 1;
    const day = Math.round((current - start) / 86400000) + 1;

    return {
      today,
      status: "active",
      phase,
      index: calendarIndex,
      confirmedIndex,
      confirmedPhase,
      nextPhase,
      total,
      day,
      progress: Math.round((day / total) * 100),
    };
  }

  if (today > lastPhase.end && confirmedIndex === phases.length - 1) {
    return {
      today,
      status: "review_due",
      phase: null,
      index: phases.length,
      confirmedIndex,
      confirmedPhase,
      nextPhase,
      total: 0,
      day: 0,
      progress: 100,
    };
  }

  return {
    today,
    status: "awaiting_review",
    phase: null,
    index: confirmedIndex,
    confirmedIndex,
    confirmedPhase,
    nextPhase,
    total: 0,
    day: 0,
    progress: 100,
  };
}
