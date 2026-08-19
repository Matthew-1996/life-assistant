export interface ProjectedReviewField {
  key: string;
  label: string;
  value: string;
}

export interface ReviewProjection {
  fields: ProjectedReviewField[];
  fallbackText: string | null;
}

const labels: ReadonlyArray<readonly [string, string]> = [
  ["better_summary", "变好的地方"],
  ["friction_summary", "反复摩擦"],
  ["experiment_summary", "下周实验"],
  ["stop_summary", "停止或减少"],
  ["goal_intent", "目标意向"],
  ["recovery_change", "恢复变化"],
  ["main_friction", "主要摩擦"],
  ["life_experience_signal", "生活体验信号"],
  ["journal_cadence", "日记节奏"],
  ["checkin_cadence", "回访节奏"],
  ["checkin_experience", "回访体验"],
  ["next_track", "下一方向"],
  ["fitness_conversation", "是否讨论健身"],
  ["career_timing", "职业时间"],
];

const knownKeys = new Set(labels.map(([key]) => key));
const translatedValues: Record<string, string> = {
  continue: "继续",
  adjust: "调整",
  downgrade: "降低强度",
  pause: "暂停",
  complete: "完成",
  replace: "替换",
  unsure: "不确定",
  weekly: "每周",
  monthly: "每月",
  on_demand: "按需",
  paused: "已暂停",
  undecided: "未决定",
  daily: "每日",
  helpful: "有帮助",
  neutral: "中性",
  disruptive: "有打扰",
  fitness: "健身",
  career: "职业",
  neither: "都不是",
  now: "现在",
  later: "以后",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function displayValue(value: unknown): string | null {
  if (typeof value === "string") return translatedValues[value] ?? value;
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value.map((item) => translatedValues[item] ?? item).join("、");
  }
  return null;
}

export function projectReviewFields(value: unknown): ReviewProjection {
  if (!isRecord(value)) {
    return {
      fields: [],
      fallbackText: value === null || value === undefined ? null : String(value),
    };
  }

  const answers = isRecord(value.answers) ? value.answers : {};
  const flat = { ...value, ...answers };
  delete flat.answers;
  const fields: ProjectedReviewField[] = [];
  const unrenderedKnown: Record<string, unknown> = {};
  for (const [key, label] of labels) {
    if (!(key in flat) || flat[key] === null || flat[key] === undefined) continue;
    const rendered = displayValue(flat[key]);
    if (rendered === null) {
      unrenderedKnown[key] = flat[key];
    } else {
      fields.push({ key, label, value: rendered });
    }
  }

  const unknownTopLevel = Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== "answers" && !knownKeys.has(key)),
  );
  const unknownAnswers = Object.fromEntries(
    Object.entries(answers).filter(([key]) => !knownKeys.has(key)),
  );
  const fallback = {
    ...unknownTopLevel,
    ...unrenderedKnown,
    ...(Object.keys(unknownAnswers).length > 0 ? { answers: unknownAnswers } : {}),
  };
  return {
    fields,
    fallbackText: Object.keys(fallback).length > 0
      ? JSON.stringify(fallback, null, 2)
      : null,
  };
}
