import { useEffect, useState } from "react";

import type {
  SitesLifeConsoleClient,
  SitesSystemStatus,
} from "../../api/sites-client";
import type { Dashboard } from "../../data/dashboard";
import { useHasActiveSessionDrafts } from "../../hooks/useSessionDraft";
import { clearAllSessionDrafts } from "../../lib/draft-storage";
import type { AuthSession } from "../../supabase/auth";
import type {
  BackupRepository,
  BackupStatus,
} from "../../supabase/backups";
import { ICloudBackupCard } from "./ICloudBackupCard";

interface SystemPageProps {
  client?: SitesLifeConsoleClient;
  dashboard: Dashboard;
  mode?: "local" | "sites" | "candidate-preview" | "supabase-candidate" | "supabase-production";
  onSignOut?: () => Promise<void>;
  ownerSession?: AuthSession;
  sitesStatus?: SitesSystemStatus | null;
  backups?: BackupRepository;
}

function SupabaseSystemPage({
  onSignOut,
  session,
  backups,
  production = false,
}: {
  onSignOut?: () => Promise<void>;
  session?: AuthSession;
  backups?: BackupRepository;
  production?: boolean;
}) {
  const [showConnectionHelp, setShowConnectionHelp] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const hasUnsavedDrafts = useHasActiveSessionDrafts(session?.userId);
  const [backupStatus, setBackupStatus] = useState<BackupStatus | null>(null);
  const [backupError, setBackupError] = useState(false);

  async function loadBackupStatus() {
    if (!backups) return;
    try {
      setBackupStatus(await backups.latest());
      setBackupError(false);
    } catch {
      setBackupError(true);
    }
  }

  useEffect(() => {
    void loadBackupStatus();
    if (!backups) return;
    const interval = window.setInterval(() => void loadBackupStatus(), 30_000);
    return () => window.clearInterval(interval);
  }, [backups]);

  async function requestBackup() {
    if (!backups || backupStatus?.status === "pending") return;
    try {
      setBackupStatus(await backups.start());
      setBackupError(false);
    } catch {
      setBackupError(true);
    }
  }

  const backupState = backupError
    ? "FAILED_RETRYABLE"
    : backupStatus?.status === "pending"
      ? "PREPARING"
      : backupStatus?.status === "success"
        ? "SUCCESS"
        : backupStatus?.status === "failed"
          ? "FAILED_RETRYABLE"
          : "READY";

  async function signOut(discardDrafts = false) {
    if (!onSignOut) return;
    if (hasUnsavedDrafts && !discardDrafts) {
      setConfirmingSignOut(true);
      return;
    }
    setSigningOut(true);
    try {
      if (discardDrafts) clearAllSessionDrafts(session?.userId);
      await onSignOut();
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <section aria-labelledby="system-title">
      <section className="hero">
        <div>
          <p className="eyebrow">
            {production ? "OWNER-ONLY · ONLINE PRIMARY" : "OWNER-ONLY · PRIVATE PREVIEW"}
          </p>
          <h1 id="system-title">Life Console 已上线，数据已迁移。</h1>
          <p className="lead">
            系统页只保留登录、数据同步状态与 iCloud 最新备份。底层资源和工程配置不会暴露在产品界面。
          </p>
        </div>
        <aside className="card hero-card">
          <span className={`status ${session ? "green" : "gray"}`}>
            {session ? "Owner 会话已验证" : "会话未确认"}
          </span>
          <h2>Life Console 2.3.0</h2>
          <p className="quiet">Supabase 是生活记录唯一真相源；iCloud 仅保存验证通过的恢复备份。</p>
        </aside>
      </section>

      <section className="section grid two system-status-grid">
        <article className="card pad">
          <span className="status green">登录</span>
          <h2>{session ? "本人会话有效" : "需要重新登录"}</h2>
          <p className="quiet">会话过期后返回登录页，不从缓存回落到演示工作台。</p>
        </article>
        <article className="card pad">
          <span className="status blue">同步边界</span>
          <h2>Supabase 单一真相源</h2>
          <p className="quiet">网页、对话与自动回访统一写入线上；iCloud 不再接收活跃写入。</p>
        </article>
      </section>

      <section className="section">
        <ICloudBackupCard
          lastSuccessAt={backupStatus?.completedAt}
          onPrimaryAction={backups ? () => void requestBackup() : () => setShowConnectionHelp(true)}
          state={backups ? backupState : "AGENT_UNAVAILABLE"}
        />
        {showConnectionHelp && (
          <p className="service-banner" role="status">
            请确认 Mac 本机备份助手正在运行；未成功前上一份有效备份保持不变。
          </p>
        )}
      </section>

      <section className="section card pad">
        <div className="section-head">
          <div>
            <h2>账号与访问</h2>
            <p className="quiet">退出后将清除当前 Supabase 浏览器会话并返回登录页。</p>
          </div>
          <span className="status gray">仅本人</span>
        </div>
        <button
          className="button ghost"
          disabled={signingOut || !onSignOut}
          onClick={() => void signOut()}
          type="button"
        >
          {signingOut ? "正在退出…" : "退出登录"}
        </button>
        {confirmingSignOut && (
          <div
            aria-label="确认清除未保存草稿"
            className="confirm-dialog"
            role="alertdialog"
          >
            <p>
              当前浏览器会话还有未保存草稿。退出会清除这些草稿，是否继续？
            </p>
            <div className="button-row">
              <button
                className="secondary-button"
                disabled={signingOut}
                onClick={() => setConfirmingSignOut(false)}
                type="button"
              >
                取消
              </button>
              <button
                className="primary-button danger"
                disabled={signingOut}
                onClick={() => void signOut(true)}
                type="button"
              >
                清除草稿并退出
              </button>
            </div>
          </div>
        )}
      </section>

      <p className="footer-note">
        当前状态：SUPABASE_PRIMARY · iCloud 只读备份 · Owner-only。
      </p>
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
  const [showConnectionHelp, setShowConnectionHelp] = useState(false);
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
            系统页只保留运行状态、数据保护、iCloud 最新备份和必要系统信息。
          </p>
        </div>
        <aside className="card hero-card">
          <span className={`status ${sourceReady ? "green" : "blue"}`}>
            {sourceTruth}
          </span>
          <h2>Life Console {status?.version ?? "2.1.0"}</h2>
          <p className="quiet">备份完整并校验通过后，可由 Agent 协助未来重建。</p>
        </aside>
      </section>

      <section className="section grid two system-status-grid">
        <article className="card pad">
          <span className="status blue">运行模式</span>
          <h2>{candidatePreview ? "Static preview / Synthetic only" : "Sites API / Owner-only"}</h2>
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
            <h2>系统信息</h2>
            <p className="quiet">保留必要边界，不展示底层资源、密钥版本或运维事件。</p>
          </div>
          <span className="status gray">Life Console 2.1.0</span>
        </div>
        <div className="signal-list">
          <div className="day-row">
            <strong>访问范围</strong>
            <span>{candidatePreview ? "合成只读预览" : "Owner-only"}</span>
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
        当前只实现合成界面状态；不调用 Worker 导出、不读取真实数据，也不改变数据来源。
      </p>
    </section>
  );
}

export function SystemPage({
  dashboard,
  mode = "local",
  onSignOut,
  ownerSession,
  backups,
  sitesStatus = null,
}: SystemPageProps) {
  if (mode === "supabase-candidate" || mode === "supabase-production") {
    return (
      <SupabaseSystemPage
        onSignOut={onSignOut}
        session={ownerSession}
        backups={backups}
        production={mode === "supabase-production"}
      />
    );
  }
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
