import { useState } from "react";

import type {
  SitesLifeConsoleClient,
  SitesSystemStatus,
} from "../../api/sites-client";
import type { Dashboard } from "../../data/dashboard";
import { ICloudBackupCard } from "./ICloudBackupCard";

interface SystemPageProps {
  client?: SitesLifeConsoleClient;
  dashboard: Dashboard;
  mode?: "local" | "sites" | "candidate-preview";
  sitesStatus?: SitesSystemStatus | null;
}

function SitesMigrationPage({
  status,
  onBack,
}: {
  status: SitesSystemStatus | null;
  onBack: () => void;
}) {
  const checks = [
    ["Owner-only 会话", "访问边界已建立；真实迁移仍需单独门禁"],
    ["云端数据结构", "版本化结构与迁移状态机继续保留"],
    ["数据保护", "敏感字段继续加密保存"],
    ["iCloud 最新备份", "本机原子覆盖核心已进入合成验证"],
    ["真实 iCloud 来源", "尚未授权读取或迁移"],
  ];
  return (
    <section aria-labelledby="migration-title">
      <button className="secondary-button" onClick={onBack} type="button">
        返回系统页
      </button>
      <section className="hero migration-hero">
        <div>
          <p className="eyebrow">独立迁移向导 · 阶段 D/E 门禁</p>
          <h1 id="migration-title">迁移只在全量校验通过后切源。</h1>
          <p className="lead">
            当前页面只展示通用能力与前置检查，不读取真实 iCloud 数据，也不允许切换真相源。
          </p>
        </div>
        <aside className="card hero-card">
          <span className="status blue">{status?.migration.phase ?? "NOT_STARTED"}</span>
          <h2>{status?.source_truth ?? "ICLOUD_PRIMARY"}</h2>
          <p className="quiet">真实迁移计划、上传校验和切源都需要后续当次确认。</p>
        </aside>
      </section>
      <section className="section card pad">
        <div className="section-head">
          <h2>前置检查</h2>
          <span className="status gray">候选环境</span>
        </div>
        <div className="signal-list">
          {checks.map(([title, description], index) => (
            <div className="day-row migration-check-row" key={title}>
              <strong>{title}</strong>
              <span>{description}</span>
              <span className={`status ${index < 3 ? "green" : "gray"}`}>
                {index < 3 ? "已验证" : "待门禁"}
              </span>
            </div>
          ))}
        </div>
      </section>
      <section className="section card pad">
        <h2>后续受控步骤</h2>
        <ol className="migration-steps">
          <li>生成仅包含数量和影响范围的迁移计划。</li>
          <li>上传后校验数量、ID、revision、摘要哈希与加密 round-trip。</li>
          <li>PO 输入精确确认文字后切换到 D1。</li>
          <li>在已确认的回滚窗口内保留可逆路径。</li>
        </ol>
        <button className="button primary" disabled type="button">
          等待阶段 D 迁移授权
        </button>
      </section>
    </section>
  );
}

function SitesSystemPage({
  candidatePreview,
  status,
}: {
  candidatePreview?: boolean;
  status: SitesSystemStatus | null;
}) {
  const [showMigration, setShowMigration] = useState(false);
  const [showConnectionHelp, setShowConnectionHelp] = useState(false);
  if (showMigration) {
    return (
      <SitesMigrationPage
        status={status}
        onBack={() => setShowMigration(false)}
      />
    );
  }
  const sourceTruth = candidatePreview
    ? "SYNTHETIC_ONLY"
    : status?.source_truth ?? "ICLOUD_PRIMARY";
  const sourceReady = sourceTruth === "SITES_D1_PRIMARY";
  return (
    <section aria-labelledby="system-title">
      <section className="hero">
        <div>
          <p className="eyebrow">
            {candidatePreview
              ? "mode=CANDIDATE_PREVIEW · 合成数据"
              : "Owner-only · Sites API"}
          </p>
          <h1 id="system-title">
            {candidatePreview
              ? "合成候选只展示备份状态。"
              : "云端可用，备份路径保持清晰。"}
          </h1>
          <p className="lead">
            系统页只保留运行状态、数据保护、iCloud 最新备份、迁移边界和必要系统信息。
          </p>
        </div>
        <aside className="card hero-card">
          <span className={`status ${sourceReady ? "green" : "blue"}`}>
            {sourceTruth}
          </span>
          <h2>Life Console {status?.version ?? "2.1.0"}</h2>
          <p className="quiet">
            当前迁移阶段：{status?.migration.phase ?? "NOT_STARTED"}
          </p>
        </aside>
      </section>

      <section className="section grid two system-status-grid">
        <article className="card pad">
          <span className="status blue">运行模式</span>
          <h2>{candidatePreview ? "Static preview / Owner-only" : "Sites API / Owner-only"}</h2>
          <p className="quiet">
            {candidatePreview
              ? "仅加载内置合成投影；不连接任何真实数据或存储。"
              : "所有敏感读取与写入都必须经过 Owner 会话、同源和 CSRF 校验。"}
          </p>
        </article>
        <article className="card pad">
          <span className="status green">数据保护</span>
          <h2>云端数据已加密保存</h2>
          <p className="quiet">系统继续保护敏感字段；普通使用不需要理解或操作密钥。</p>
        </article>
      </section>

      <section className="section">
        <ICloudBackupCard
          lastSuccessAt={status?.backup.last_success_at}
          onPrimaryAction={candidatePreview ? undefined : () => setShowConnectionHelp(true)}
          readOnly={candidatePreview}
          state={candidatePreview ? "READY" : "AGENT_UNAVAILABLE"}
        />
        {showConnectionHelp && (
          <p className="service-banner" role="status">
            本机助手的安装与连接流程将在浏览器回环验证通过后开放；当前不会创建云端导出。
          </p>
        )}
      </section>

      <section className="section card pad">
        <div className="section-head">
          <div>
            <h2>迁移与恢复边界</h2>
            <p className="quiet">迁移和恢复继续使用独立受控流程；当前系统页不直接执行。</p>
          </div>
          <span className="status gray">{status?.migration.phase ?? "NOT_STARTED"}</span>
        </div>
        <button
          className="button primary"
          onClick={() => setShowMigration(true)}
          type="button"
        >
          打开迁移向导
        </button>
      </section>

      <section className="section card pad">
        <div className="section-head">
          <div>
            <h2>系统信息</h2>
            <p className="quiet">保留必要边界，不展示底层资源、密钥版本或运维事件。</p>
          </div>
          <span className="status gray">Life Console 2.1.0</span>
        </div>
        <div className="signal-list">
          <div className="day-row">
            <strong>访问范围</strong>
            <span>Owner-only</span>
          </div>
          <div className="day-row">
            <strong>当前真相源</strong>
            <span>{sourceTruth}</span>
          </div>
          <div className="day-row">
            <strong>备份边界</strong>
            <span>只有本机代理校验通过后才替换 iCloud 最新备份</span>
          </div>
        </div>
      </section>

      <p className="footer-note">
        当前只实现合成界面状态；不调用 Worker 导出、不执行部署、不读取真实数据，也不切换真相源。
      </p>
    </section>
  );
}

export function SystemPage({
  dashboard,
  mode = "local",
  sitesStatus = null,
}: SystemPageProps) {
  if (mode === "sites" || mode === "candidate-preview") {
    return (
      <SitesSystemPage
        candidatePreview={mode === "candidate-preview"}
        status={sitesStatus}
      />
    );
  }
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
      value: "按需使用",
      tone: "neutral",
      description: "只读单向派生，不属于日常保存链路。",
    },
    {
      title: "XLSX",
      value: "按需重建",
      tone: "neutral",
      description: "本地可视化备选，不接受反向写回。",
    },
    {
      title: "移动网页",
      value: "已归档",
      tone: "neutral",
      description: "既有私密实例保留，不再维护或部署。",
    },
  ];

  return (
    <section aria-labelledby="system-title">
      <section className="hero">
        <div>
          <p className="eyebrow">边界清楚，系统才轻</p>
          <h1 id="system-title">本地工作站，不替代真相源。</h1>
          <p className="lead">
            系统页展示本地 Mac、iCloud 真相源、按需派生、已归档移动网页与设计治理资产之间的关系。
          </p>
        </div>
        <aside className="card hero-card">
          <span className="status blue">核心边界</span>
          <h2>iCloud 项目是唯一真相源</h2>
          <p className="quiet">
            Life Console 是主要入口；Google 表格和 XLSX 只按需派生，归档网页不再维护或部署。
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
            ["04", "派生展示", "Google 表格与 XLSX 按需展示确定性投影。"],
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
              <h2>派生展示与归档边界</h2>
              <p className="quiet">按需展示只降低认知负担；归档网页不再扩张。</p>
            </div>
            <span className="status gray">暂不扩张</span>
          </div>
          <div className="signal-list">
            <div className="day-row">
              <strong>移动网页</strong>
              <span>既有私密实例保留，不再维护源码或产生新部署。</span>
              <span className="status gray">已归档</span>
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
