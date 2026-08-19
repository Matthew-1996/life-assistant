import { describe, expect, it } from "vitest";

import { observeTrend } from "../../src/features/progress/trend-observations";

describe("7+7 day trend observations", () => {
  it("reports up and down without diagnostic wording", () => {
    expect(observeTrend([3, 4, 4], [2, 2, 3])).toEqual({
      state: "up",
      label: "较前 7 天上升",
    });
    expect(observeTrend([1, 2, 2], [4, 3, 3])).toEqual({
      state: "down",
      label: "较前 7 天下降",
    });
  });

  it("requires at least three finite samples in both windows", () => {
    expect(observeTrend([3, 4], [2, 3, 4])).toEqual({
      state: "insufficient",
      label: "数据不足",
    });
    expect(observeTrend([3, Number.NaN, 4], [2, 3, 4])).toEqual({
      state: "insufficient",
      label: "数据不足",
    });
    expect(observeTrend([3, null, 4, 5], [2, undefined, 3, 4]).state).toBe("up");
  });

  it("uses a strict five-percent relative threshold for stability", () => {
    expect(observeTrend([102, 102, 102], [100, 100, 100])).toEqual({
      state: "stable",
      label: "较前 7 天稳定",
    });
    expect(observeTrend([105, 105, 105], [100, 100, 100])).toEqual({
      state: "up",
      label: "较前 7 天上升",
    });
  });

  it("compares absolute values when the previous mean is zero", () => {
    expect(observeTrend([0, 0, 0], [0, 0, 0]).state).toBe("stable");
    expect(observeTrend([1, 1, 1], [0, 0, 0]).state).toBe("up");
    expect(JSON.stringify(observeTrend([1, 1, 1], [0, 0, 0]))).not.toMatch(
      /诊断|疾病|正常|异常/,
    );
  });
});
