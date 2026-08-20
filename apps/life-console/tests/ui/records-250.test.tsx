// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { syntheticDashboard } from "../../src/data/dashboard";
import { RecordsPage } from "../../src/features/records/RecordsPage";

afterEach(cleanup);

describe("Life Console 2.5 records information architecture", () => {
  it("keeps only conversation capture, journals and reviews", () => {
    render(
      <RecordsPage
        dashboard={syntheticDashboard}
        mode="supabase-candidate"
        supabasePanels={(
          <>
            <section aria-label="日记与修订">日记与修订内容</section>
            <section aria-label="复盘">复盘内容</section>
          </>
        )}
      />,
    );

    expect(screen.getByRole("region", { name: "对话式记录面板" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "日记与修订" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "复盘" })).toBeTruthy();
    expect(screen.queryByText("原文保存预览")).toBeNull();
    expect(screen.queryByText("简洁表单兜底")).toBeNull();
    expect(screen.queryByText("已录入与上下文")).toBeNull();
    expect(screen.queryByText("保存结果明确可见，失败时不丢草稿")).toBeNull();
    expect(screen.queryByText("写入语义")).toBeNull();
    expect(screen.queryByRole("heading", { name: "草稿不会自动生效" })).toBeNull();
  });
});
