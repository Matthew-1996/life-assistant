import { type ReactNode, useState } from "react";

import { AppShell, type PageId } from "../../components/shell/AppShell";
import { SupabaseDailyCheckinPanel } from "../checkins/SupabaseDailyCheckinPanel";
import { SupabaseGoalsPanel } from "../goals/SupabaseGoalsPanel";
import { SupabaseJournalsPanel } from "../journals/SupabaseJournalsPanel";
import { SupabaseReviewsPanel } from "../reviews/SupabaseReviewsPanel";
import type { DailyCheckinRepositoryPort } from "../../supabase/daily-checkins";
import type { GoalRepositoryPort } from "../../supabase/goals";
import type { JournalRepositoryPort } from "../../supabase/journals";
import type { ReviewRepositoryPort } from "../../supabase/reviews";

export interface SupabaseCandidateAppProps {
  date: string;
  dailyCheckins: DailyCheckinRepositoryPort;
  goals: GoalRepositoryPort;
  journals: JournalRepositoryPort;
  reviews: ReviewRepositoryPort;
}

function CandidateSystemPage(): ReactNode {
  return (
    <section className="supabase-candidate-system">
      <div className="section-head">
        <div>
          <p className="eyebrow">SYSTEM</p>
          <h2>候选环境边界</h2>
          <p className="quiet">
            本页只连接独立测试资源，用于验证登录、权限和读写闭环。
          </p>
        </div>
        <span className="status blue">Preview only</span>
      </div>
      <dl className="supabase-candidate-facts">
        <div>
          <dt>数据分类</dt>
          <dd>仅纯合成测试数据</dd>
        </div>
        <div>
          <dt>浏览器凭据</dt>
          <dd>项目 URL 与 publishable key</dd>
        </div>
        <div>
          <dt>私人真相源</dt>
          <dd>仍为 ICLOUD_PRIMARY，未切换</dd>
        </div>
        <div>
          <dt>正式环境</dt>
          <dd>未修改、未部署</dd>
        </div>
      </dl>
    </section>
  );
}

export function SupabaseCandidateApp({
  date,
  dailyCheckins,
  goals,
  journals,
  reviews,
}: SupabaseCandidateAppProps) {
  const [activePage, setActivePage] = useState<PageId>("today");
  const pages: Record<PageId, ReactNode> = {
    today: (
      <SupabaseDailyCheckinPanel date={date} repository={dailyCheckins} />
    ),
    records: <SupabaseJournalsPanel repository={journals} />,
    progress: (
      <div className="supabase-candidate-stack">
        <SupabaseGoalsPanel repository={goals} />
        <SupabaseReviewsPanel repository={reviews} />
      </div>
    ),
    system: <CandidateSystemPage />,
  };

  return (
    <AppShell
      activePage={activePage}
      date={date}
      mode="supabase-candidate"
      onNavigate={setActivePage}
    >
      <div
        aria-label="测试候选边界"
        className="service-banner service-banner--candidate"
        role="status"
      >
        Supabase 测试候选：只使用纯合成数据，不读取 iCloud
      </div>
      {pages[activePage]}
    </AppShell>
  );
}
