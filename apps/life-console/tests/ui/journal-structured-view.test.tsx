// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { JournalStructuredView } from "../../src/features/journals/JournalStructuredView";
import type { Journal } from "../../src/supabase/journals";

afterEach(cleanup);

const baseJournal: Journal = {
  id: 31,
  user_id: "synthetic-owner",
  event_date: "2030-03-01",
  title: "Synthetic title",
  content: "Synthetic raw text\nwith a second line.",
  tags: [],
  revision: 2,
  deleted_at: null,
  created_at: "2030-03-01T08:00:00.000Z",
  updated_at: "2030-03-01T08:00:00.000Z",
};

describe("JournalStructuredView", () => {
  it("preserves raw text and renders the one fixed structured section order", () => {
    render(<JournalStructuredView journal={{
      ...baseJournal,
      normalization_status: "completed",
      metadata: {
        title: "Synthetic title",
        summary: "Synthetic summary",
        facts: [{
          text: "Synthetic fact",
          basis: "explicit_text",
          evidence: "Synthetic raw text",
        }],
        feelings: [],
        people: [{
          text: "Synthetic Person",
          relation: "confirmed relation",
          basis: "confirmed_profile",
          evidence: "Synthetic raw text",
          profile_revision: "profile-revision-1",
        }],
        places: [],
        themes: [],
        planning_clues: [],
        inferences: [],
        tags: [],
      },
    }} />);

    const view = screen.getByRole("article", { name: "Synthetic title" });
    expect(view.querySelector(".journal-raw-text")?.textContent).toBe(
      baseJournal.content,
    );
    const labels = Array.from(view.querySelectorAll("h4")).map(
      (heading) => heading.textContent,
    );
    expect(labels).toEqual([
      "用户原话", "摘要", "明确事实", "明确感受", "人物", "地点或场景",
      "生活主题", "可能的规划线索", "待用户确认的推测", "标签",
    ]);
    expect(within(view).getByText(/来自已确认个人档案/)).toBeTruthy();
    expect(within(view).getAllByText("未记录").length).toBeGreaterThan(3);
  });

  it.each([
    ["pending", "等待整理"],
    ["failed", "整理失败，原文已保存"],
    ["stale", "原文已更新，等待重新整理"],
  ] as const)("shows %s without treating raw save as failed", (status, label) => {
    render(<JournalStructuredView journal={{
      ...baseJournal,
      normalization_status: status,
      metadata: {},
    }} />);
    expect(screen.getByText(label)).toBeTruthy();
    expect(document.querySelector(".journal-raw-text")?.textContent).toBe(
      baseJournal.content,
    );
  });

  it("keeps legacy records readable without reconstructing Markdown", () => {
    render(<JournalStructuredView journal={{
      ...baseJournal,
      normalization_status: "legacy",
    }} />);
    expect(screen.getByText("历史记录，尚未按统一契约整理")).toBeTruthy();
    expect(document.querySelector(".journal-raw-text")?.textContent).toBe(
      baseJournal.content,
    );
    expect(screen.getAllByText("未记录").length).toBeGreaterThan(5);
  });
});
