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
      <section className="hero">
        <div>
          <p className="eyebrow">边界清楚，系统才轻</p>
          <h1 id="system-title">本地工作站，不替代真相源。</h1>
          <p className="lead">
            系统页展示本地 Mac、iCloud 真相源、外部派生、移动端与图表边界，以及设计治理资产之间的关系。
          </p>
        </div>
        <aside className="card hero-card">
          <span className="status blue">核心边界</span>
          <h2>iCloud 项目是唯一真相源</h2>
          <p className="quiet">
            Life Console 只是本地界面与白名单写入入口；外部表格、网页和图表均为派生展示。
          </p>
        </aside>
      </section>

      <section className="section" aria-labelledby="flow-title">
        <div className="section-head">
          <div>
            <h2 id="flow-title">运行关系</h2>
            <p className="quiet">从本机界面到派生展示，保持单向、可解释、可回退。</p>
          </div>
          <span className="status gray">当前状态</span>
        </div>
        <div className="flow">
          {[
            ["01", "本地 Mac", "读取本地白名单接口与安全投影。"],
            ["02", "保存确认", "点击保存后才调用原子工具；草稿不改变事实。"],
            ["03", "iCloud 真相源", "日记、状态、目标与规则继续分层保存。"],
            ["04", "派生展示", "外部表格与网页只展示确定性投影。"],
            ["05", "设计治理", "设计稿、规范与验收说明约束实现。"],
          ].map(([index, title, description]) => (
            <article className="flow-step" key={index}>
              <small>{index}</small>
              <h3>{title}</h3>
              <p className="quiet">{description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section grid two">
        <article className="card pad">
          <div className="section-head">
            <div>
              <h2>数据与展示边界</h2>
              <p className="quiet">明确哪些系统可写，哪些只读，哪些暂缓。</p>
            </div>
            <span className="status blue">单向派生</span>
          </div>
          <table className="table">
            <thead>
              <tr><th>对象</th><th>当前状态</th><th>边界</th></tr>
            </thead>
            <tbody>
              {statuses.map((status) => (
                <tr key={status.title}>
                  <td>{status.title}</td>
                  <td><span className={`status ${status.tone === "ready" ? "green" : "gray"}`}>{status.value}</span></td>
                  <td>{status.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </article>

        <article className="card pad">
          <div className="section-head">
            <div>
              <h2>移动端与图表边界</h2>
              <p className="quiet">移动端不是桌面缩小版；图表只降低认知负担。</p>
            </div>
            <span className="status gray">暂不扩张</span>
          </div>
          <div className="signal-list">
            <div className="day-row">
              <strong>移动端</strong>
              <span>后续按真实场景决定形态，本轮专注 PC。</span>
              <span className="status gray">待定</span>
            </div>
            <div className="day-row">
              <strong>图表</strong>
              <span>展示趋势与缺失，不制造完成率压力。</span>
              <span className="status blue">克制</span>
            </div>
            <div className="day-row">
              <strong>外部同步</strong>
              <span>本地成功不依赖外部刷新，失败不回滚。</span>
              <span className="status green">安全</span>
            </div>
          </div>
        </article>
      </section>

      <section className="section card pad" aria-labelledby="governance-title">
        <div className="section-head">
          <div>
            <h2 id="governance-title">设计治理资产关系</h2>
            <p className="quiet">上传设计稿是当前四页视觉与交互基准。</p>
          </div>
          <span className="status blue">资产图谱</span>
        </div>
        <table className="table">
          <thead>
            <tr><th>资产</th><th>作用</th><th>本次处理</th></tr>
          </thead>
          <tbody>
            <tr><td>Apple 顶层设计系统</td><td>颜色、字体、圆角、导航与表单原则</td><td>作为共享 token</td></tr>
            <tr><td>Life Console UI/UE 规范</td><td>四页信息架构与写入边界</td><td>继续遵循</td></tr>
            <tr><td>试行周设计稿</td><td>四页视觉与区块基准</td><td>同步到 React</td></tr>
            <tr><td>应用代码</td><td>真实交互与本地数据入口</td><td>保留既有安全能力</td></tr>
          </tbody>
        </table>
      </section>

      <section className="section grid three">
        <article className="card pad">
          <span className="status blue">写入</span>
          <h3>保存前不改变真相源</h3>
          <p className="quiet">保存按钮之前，所有输入都是草稿或预览。</p>
        </article>
        <article className="card pad">
          <span className="status gray">隐私</span>
          <h3>页面只读取白名单投影</h3>
          <p className="quiet">不把完整原文、健康明细或外部账号带入界面资产。</p>
        </article>
        <article className="card pad">
          <span className="status green">治理</span>
          <h3>设计与代码同步验收</h3>
          <p className="quiet">页面结构、交互状态与测试共同约束后续修改。</p>
        </article>
      </section>

      <p className="footer-note">本页不执行发布、同步、删除或外部服务操作。</p>
    </section>
  );
}
