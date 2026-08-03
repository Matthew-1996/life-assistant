export const phases = [
  {
    id: "01",
    title: "稳住睡眠与生活感",
    dates: "8.01 — 8.14",
    start: "2026-08-01",
    end: "2026-08-14",
    intent: "先恢复基本节律，不急着一次解决人生。",
    signal: "起床更稳定，白天精力或生活实感略回升",
    tone: "teal",
  },
  {
    id: "02",
    title: "低耗完成交接",
    dates: "8.15 — 8.31",
    start: "2026-08-15",
    end: "2026-08-31",
    intent: "把交接和设备迁移安全收口，保护睡眠。",
    signal: "职责清楚收口，个人资料可以恢复",
    tone: "blue",
  },
  {
    id: "03",
    title: "离职后减压",
    dates: "9.01 — 9.14",
    start: "2026-09-01",
    end: "2026-09-14",
    intent: "先让身心从持续高压中降下来。",
    signal: "能体验没有工作目的的时间",
    tone: "sage",
  },
  {
    id: "04",
    title: "重建生活结构",
    dates: "9.15 — 10.12",
    start: "2026-09-15",
    end: "2026-10-12",
    intent: "有余量后，只探索一个辅助目标。",
    signal: "新的节奏由自己选择，成本现实",
    tone: "gold",
  },
  {
    id: "05",
    title: "选择下一重点",
    dates: "10.13 — 10.31",
    start: "2026-10-13",
    end: "2026-10-31",
    intent: "基于真实恢复情况决定下一步。",
    signal: "形成一个 4–6 周的小实验",
    tone: "coral",
  },
];

// Project-relative truth mirrored from GOALS.md. A calendar date can advance
// only inside this confirmed boundary; it must never confirm a later phase.
export const confirmedPhaseTruth = Object.freeze({
  phaseId: "01",
  source: "GOALS.md",
  reviewDate: "2026-08-14",
});

const pathThemes = [
  "守住今天三个锚点",
  "低目的外出",
  "一次轻活动",
  "保护吃饭与休息",
  "只收好一件小事",
  "关系或兴趣时间",
  "10 分钟轻复盘",
];

const weekdayNames = ["日", "一", "二", "三", "四", "五", "六"];
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function assertIsoDate(isoDate) {
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

export function buildSevenDayPath(today = shanghaiDate()) {
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

export function phaseState(
  today = shanghaiDate(),
  confirmedPhaseId = confirmedPhaseTruth.phaseId,
) {
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
