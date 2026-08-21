import { useEffect, useState } from "react";

import type { DailyNewsClient, DailyNewsResult } from "../../domain/daily-news";

const categoryLabels = {
  finance: "财经",
  politics: "政治",
  technology: "科技",
} as const;

const scopeLabels = {
  domestic: "国内",
  international: "国际",
} as const;

interface DailyNewsPanelProps {
  client?: DailyNewsClient;
}

type NewsLoadState =
  | "auth-unavailable"
  | "empty"
  | "error"
  | "loading"
  | "stale"
  | "success";

function failedLoadState(error: unknown): NewsLoadState {
  return error instanceof Error && error.message === "daily_news_unauthenticated"
    ? "auth-unavailable"
    : "error";
}

export function DailyNewsPanel({ client }: DailyNewsPanelProps) {
  const [result, setResult] = useState<DailyNewsResult | null>(null);
  const [loadState, setLoadState] = useState<NewsLoadState>(
    client ? "loading" : "empty",
  );

  async function load(allowRebuild: boolean) {
    if (!client) return;
    setLoadState("loading");
    try {
      const nextResult = await client.getDigest({ allowRebuild });
      setResult(nextResult);
      setLoadState(nextResult.state);
    } catch (error) {
      setResult(null);
      setLoadState(failedLoadState(error));
    }
  }

  useEffect(() => {
    void load(true);
  }, [client]);

  const digest = result?.state === "success" || result?.state === "stale"
    ? result.digest
    : null;

  return (
    <section
      aria-label="每日新闻"
      className="card pad news-panel"
      data-news-load-state={loadState}
      role="region"
    >
      <div className="section-head">
        <div>
          <p className="kicker">DAILY DIGEST</p>
          <h2>每日新闻</h2>
        </div>
        <span className="status gray">07:00 更新</span>
      </div>
      {loadState === "loading" ? (
        <p className="empty-state">正在读取公开摘要…</p>
      ) : digest ? (
        <>
          {result?.state === "stale" && (
            <p className="news-panel__stale" role="status">今日更新失败，显示上一份成功摘要。</p>
          )}
          <div className="news-list">
            {digest.items.map((item) => (
              <article className="news-item" key={item.id}>
                <div className="news-item__meta">
                  <span>{categoryLabels[item.category]}</span>
                  <span>{scopeLabels[item.scope]}</span>
                  <span>{item.source}</span>
                </div>
                <h3><a href={item.url} rel="noreferrer" target="_blank">{item.title}</a></h3>
                <p>{item.summary}</p>
              </article>
            ))}
          </div>
          <p className="caption">摘要更新时间：{new Date(digest.generatedAt).toLocaleString("zh-CN")}</p>
        </>
      ) : (
        <div className="news-panel__empty">
          <p className="empty-state">
            {loadState === "auth-unavailable"
              ? "登录会话暂不可用，请重新登录后重试。"
              : loadState === "error"
                ? "新闻摘要读取失败，请稍后重试。"
                : client
                  ? "暂时没有可用摘要。"
                  : "新闻服务尚未连接；上线前保持可重试空态。"}
          </p>
          {client && <button className="secondary-button" onClick={() => void load(true)} type="button">重试</button>}
        </div>
      )}
    </section>
  );
}
