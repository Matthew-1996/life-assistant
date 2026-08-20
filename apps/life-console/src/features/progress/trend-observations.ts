export type TrendObservation =
  | { state: "up"; label: "较前 7 天上升" }
  | { state: "down"; label: "较前 7 天下降" }
  | { state: "stable"; label: "较前 7 天稳定" }
  | { state: "insufficient"; label: "数据不足" };

export type TrendSample = number | null | undefined;

function finite(values: readonly TrendSample[]): number[] {
  return values.filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value),
  );
}

function mean(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

export function observeTrend(
  recentWindow: readonly TrendSample[],
  previousWindow: readonly TrendSample[],
): TrendObservation {
  const recent = finite(recentWindow);
  const previous = finite(previousWindow);
  if (recent.length < 3 || previous.length < 3) {
    return { state: "insufficient", label: "数据不足" };
  }
  const recentMean = mean(recent);
  const previousMean = mean(previous);
  const change = recentMean - previousMean;
  const stable = previousMean === 0
    ? change === 0
    : Math.abs(change) < Math.abs(previousMean) * 0.05;
  if (stable) return { state: "stable", label: "较前 7 天稳定" };
  return change > 0
    ? { state: "up", label: "较前 7 天上升" }
    : { state: "down", label: "较前 7 天下降" };
}
