import { describe, expect, it } from "vitest";

import { projectReviewFields } from "../../src/features/reviews/review-projection";

describe("review structured-data projection", () => {
  it("maps known weekly answer fields to Chinese labels and values", () => {
    expect(projectReviewFields({
      answers: {
        better_summary: "Synthetic improvement",
        friction_summary: "Synthetic friction",
        goal_intent: "adjust",
      },
    })).toEqual({
      fields: [
        { key: "better_summary", label: "变好的地方", value: "Synthetic improvement" },
        { key: "friction_summary", label: "反复摩擦", value: "Synthetic friction" },
        { key: "goal_intent", label: "目标意向", value: "调整" },
      ],
      fallbackText: null,
    });
  });

  it("maps known phase fields and preserves explicit false", () => {
    const projection = projectReviewFields({
      recovery_change: "Synthetic recovery change",
      next_track: "career",
      fitness_conversation: false,
    });
    expect(projection.fields).toEqual([
      { key: "recovery_change", label: "恢复变化", value: "Synthetic recovery change" },
      { key: "next_track", label: "下一方向", value: "职业" },
      { key: "fitness_conversation", label: "是否讨论健身", value: "否" },
    ]);
  });

  it("falls unknown structures back to readable multiline plain text", () => {
    const projection = projectReviewFields({
      answers: { better_summary: "Known" },
      future_shape: { nested: ["alpha", "beta"] },
    });
    expect(projection.fields[0].label).toBe("变好的地方");
    expect(projection.fallbackText).toContain('"future_shape"');
    expect(projection.fallbackText).toContain("\n");
    expect(projection.fallbackText).not.toContain("[object Object]");
  });

  it("returns empty projection for a non-object runtime value", () => {
    expect(projectReviewFields("unexpected")).toEqual({
      fields: [],
      fallbackText: "unexpected",
    });
  });
});
