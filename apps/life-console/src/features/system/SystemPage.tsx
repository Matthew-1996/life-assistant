import { type FormEvent, useEffect, useState } from "react";

import type {
  SitesLifeConsoleClient,
  SitesSystemStatus,
} from "../../api/sites-client";
import type { Dashboard } from "../../data/dashboard";

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
    ["Owner-only 会话", "代码已实现；待正式 Sites 绑定验证"],
    ["D1 Schema", "12 张表与迁移状态机测试通过"],
    ["字段级加密", "合成 KEK round-trip 测试通过"],
    ["R2 备份", "代码已实现；待正式 Bucket 绑定验证"],
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
          <li>7 天回滚窗口内保留 R2 加密增量包。</li>
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
  client,
  status,
}: {
  candidatePreview?: boolean;
  client?: SitesLifeConsoleClient;
  status: SitesSystemStatus | null;
}) {
  const [showMigration, setShowMigration] = useState(false);
  const [audit, setAudit] = useState<Array<{
    id: string;
    resource_type: string;
    action: string;
    result: string;
  }>>([]);
  const [passphrase, setPassphrase] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [recoveryState, setRecoveryState] = useState<
    "idle" | "saving" | "ready" | "verified" | "failed"
  >("idle");
  const [recoveryObject, setRecoveryObject] = useState<string | null>(null);
  const [recoveryDigest, setRecoveryDigest] = useState<string | null>(null);
  const [backupState, setBackupState] = useState<
    "idle" | "saving" | "saved" | "failed"
  >("idle");

  useEffect(() => {
    if (!client) return;
    void client.auditEvents()
      .then((value) => setAudit(value.items))
      .catch(() => setAudit([]));
  }, [client]);

  async function generateRecoveryPack(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !client
      || passphrase.length < 16
      || passphrase !== confirmation
      || !acknowledged
    ) {
      setRecoveryState("failed");
      return;
    }
    setRecoveryState("saving");
    try {
      const result = await client.createRecoveryPack({
        passphrase,
        confirmation,
        acknowledged,
      });
      setRecoveryObject(result.object_key);
      setRecoveryDigest(result.sha256);
      setRecoveryState("ready");
    } catch {
      setRecoveryState("failed");
    }
  }

  async function verifyRecovery() {
    if (!client || !recoveryObject) return;
    setRecoveryState("saving");
    try {
      const result = await client.verifyRecoveryPack({
        object_key: recoveryObject,
        passphrase,
      });
      setRecoveryState(result.verified ? "verified" : "failed");
      if (result.verified) {
        setPassphrase("");
        setConfirmation("");
      }
    } catch {
      setRecoveryState("failed");
    }
  }

  async function triggerBackup() {
    if (!client) return;
    setBackupState("saving");
    try {
      await client.triggerBackup();
      setBackupState("saved");
    } catch {
      setBackupState("failed");
    }
  }
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
              ? "候选环境只展示，不写入。"
              : "云端真相源，边界保持可见。"}
          </h1>
          <p className="lead">
            系统页集中展示真相源、加密、iCloud 冷备、迁移门禁和审计边界。
          </p>
        </div>
        <aside className="card hero-card">
          <span className={`status ${sourceReady ? "green" : "blue"}`}>
            {sourceTruth}
          </span>
          <h2>Life Console {status?.version ?? "2.0.0"}</h2>
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
              ? "仅加载内置合成投影；不绑定 D1、R2、KEK 或 iCloud。"
              : "所有敏感读取与写入都必须经过 Owner 会话、同源和 CSRF 校验。"}
          </p>
        </article>
        <article className="card pad">
          <span className="status green">字段级加密</span>
          <h2>{status?.encryption.journal_kid ?? "journal-v1"} · {status?.encryption.health_kid ?? "health-v1"}</h2>
          <p className="quiet">日记原文和健康明细以 AES-256-GCM DEK/KEK 信封保存。</p>
        </article>
        <article className="card pad">
          <span className={status?.backup.failed ? "status red" : "status blue"}>iCloud 单向冷备</span>
          <h2>{status?.backup.pending ?? 0} 条待处理</h2>
          <p className="quiet">
            失败 {status?.backup.failed ?? 0} 条 · 最近成功 {status?.backup.last_success_at ?? "尚无"}
          </p>
        </article>
        <article className="card pad">
          <span className="status gray">审计</span>
          <h2>追加式事件</h2>
          <p className="quiet">只记录操作者哈希、资源、动作和结果，不记录正文或密文片段。</p>
        </article>
      </section>

      <section className="section grid two">
        <article className="card pad">
          <div className="section-head">
            <div>
              <h2>完整加密备份</h2>
              <p className="quiet">生成 D1 全量密文快照并以 backup-v1 再加密写入 R2。</p>
            </div>
            <span className={`status ${backupState === "failed" ? "red" : "blue"}`}>
              {backupState === "saving"
                ? "生成中"
                : backupState === "saved"
                  ? "已生成"
                  : backupState === "failed" ? "失败" : "待触发"}
            </span>
          </div>
          <button
            className="button primary"
            data-readonly={candidatePreview}
            data-write-control
            disabled={!candidatePreview && (!client || backupState === "saving")}
            onClick={() => void triggerBackup()}
            type="button"
          >
            手动生成完整备份
          </button>
        </article>

        <article className="card pad">
          <div className="section-head">
            <div>
              <h2>恢复包</h2>
              <p className="quiet">口令至少 16 位，可由受信任密码管理器生成和填充。</p>
            </div>
            <span className={`status ${
              recoveryState === "verified"
                ? "green"
                : recoveryState === "failed" ? "red" : "blue"
            }`}>
              {recoveryState === "saving"
                ? "处理中"
                : recoveryState === "ready"
                  ? "待验证"
                  : recoveryState === "verified"
                    ? "已验证"
                    : recoveryState === "failed" ? "需检查" : "未创建"}
            </span>
          </div>
          <form className="form-grid" onSubmit={(event) => void generateRecoveryPack(event)}>
            <label>
              恢复包保护口令
              <input
                autoComplete="new-password"
                minLength={16}
                onChange={(event) => setPassphrase(event.target.value)}
                type="password"
                value={passphrase}
              />
            </label>
            <label>
              再次输入保护口令
              <input
                autoComplete="new-password"
                minLength={16}
                onChange={(event) => setConfirmation(event.target.value)}
                type="password"
                value={confirmation}
              />
            </label>
            <label className="checkbox-row">
              <input
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
                type="checkbox"
              />
              我理解恢复包需要由本人安全保管
            </label>
            <div className="button-row">
              <button
                className="button primary"
                data-readonly={candidatePreview}
                data-write-control
                disabled={!candidatePreview && (!client || recoveryState === "saving")}
                type="submit"
              >
                生成恢复包
              </button>
              {recoveryState === "ready" && (
                <button
                  className="secondary-button"
                  onClick={() => void verifyRecovery()}
                  type="button"
                >
                  立即验证
                </button>
              )}
            </div>
          </form>
          {recoveryState === "ready" && (
            <p className="success-message">
              恢复包已生成 · SHA-256 {recoveryDigest?.slice(0, 12)}…
            </p>
          )}
          {recoveryState === "verified" && (
            <p className="success-message">恢复包验证通过</p>
          )}
          {recoveryState === "failed" && (
            <p className="error-message">恢复包操作失败；请检查口令、确认项与服务状态。</p>
          )}
        </article>
      </section>

      <section className="section card pad">
        <div className="section-head">
          <div>
            <h2>审计事件摘要</h2>
            <p className="quiet">仅展示资源、动作与结果；不含正文、请求体或密文片段。</p>
          </div>
          <span className="status gray">最近 {audit.length} 条</span>
        </div>
        <div className="signal-list">
          {audit.length === 0 && <p className="quiet">暂无可显示的审计事件。</p>}
          {audit.map((event) => (
            <div className="day-row" key={event.id}>
              <strong>{event.resource_type} / {event.action} / {event.result}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="section card pad">
        <div className="section-head">
          <div>
            <h2>迁移与回滚</h2>
            <p className="quiet">完整向导拆为独立子页，系统页只保留状态和入口。</p>
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

      <p className="footer-note">
        本页不生成真实密钥、不执行正式部署、不迁移数据，也不切换真相源。
      </p>
    </section>
  );
}

export function SystemPage({
  client,
  dashboard,
  mode = "local",
  sitesStatus = null,
}: SystemPageProps) {
  if (mode === "sites" || mode === "candidate-preview") {
    return (
      <SitesSystemPage
        candidatePreview={mode === "candidate-preview"}
        client={client}
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
