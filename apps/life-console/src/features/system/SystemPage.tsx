import type { Dashboard } from "../../data/dashboard";

interface SystemPageProps {
  dashboard: Dashboard;
}

export function SystemPage({ dashboard }: SystemPageProps) {
  const statuses = [
    {
      title: "Life Hub",
      value: dashboard.system.hub === "ready" ? "本机可用" : "不可用",
      tone: dashboard.system.hub === "ready" ? "ready" : "attention",
      description: "仅允许本机 localhost 访问。",
    },
    {
      title: "iCloud 项目",
      value: {
        readable: "已验证可读取",
        writable: "已验证可读写",
        partial: "部分可用",
        unavailable: "不可用",
      }[dashboard.system.icloud],
      tone: dashboard.system.icloud === "writable" ? "ready" : "neutral",
      description:
        dashboard.system.icloud === "readable"
          ? "当前只证明白名单快照可读；用户尚未批准真实写入验收。"
          : "个人记录和状态的唯一真相源。",
    },
    {
      title: "自动化",
      value: dashboard.system.automation === "unknown" ? "未确认" : "正常",
      tone: "neutral",
      description: "机器运行态可按项目规格重建。",
    },
    {
      title: "备份与恢复",
      value: dashboard.system.backup === "ready" ? "最近检查正常" : "未确认",
      tone: dashboard.system.backup === "ready" ? "ready" : "neutral",
      description: "备份状态不替代 iCloud 真相源。",
    },
    {
      title: "Google 表格",
      value: dashboard.system.google === "paused" ? "暂不维护" : "按需使用",
      tone: "neutral",
      description: "保留恢复能力，不属于一期保存链路。",
    },
    {
      title: "移动端",
      value: "方案待定",
      tone: "neutral",
      description: "不会用桌面缩放版代替真实移动方案。",
    },
  ];

  return (
    <section aria-labelledby="system-title">
      <div className="page-heading">
        <div>
          <p className="eyebrow">正常时保持安静</p>
          <h1 id="system-title">系统</h1>
        </div>
        <p>本机保存成功是一期的完成标准。</p>
      </div>

      <div className="system-grid">
        {statuses.map((status) => (
          <article className="system-card" key={status.title}>
            <div>
              <span className={`system-indicator ${status.tone}`} />
              <h2>{status.title}</h2>
            </div>
            <strong>{status.value}</strong>
            <p>{status.description}</p>
          </article>
        ))}
      </div>

      <article className="boundary-card">
        <h2>一期边界</h2>
        <p>
          不开放局域网或公网，不使用云数据库，不从 Google 或浏览器缓存反向补写。
        </p>
      </article>
    </section>
  );
}
