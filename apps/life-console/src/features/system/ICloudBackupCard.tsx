export type BackupUiState =
  | "AGENT_UNAVAILABLE"
  | "READY"
  | "PREPARING"
  | "TRANSFERRING"
  | "VERIFYING"
  | "SUCCESS"
  | "FAILED_RETRYABLE"
  | "FAILED_ACTION";

interface ICloudBackupCardProps {
  lastSuccessAt?: string | null;
  onPrimaryAction?: () => void;
  readOnly?: boolean;
  state: BackupUiState;
}

const stateCopy: Record<BackupUiState, {
  action: string;
  detail: string;
  label: string;
  tone: "blue" | "gray" | "green" | "red";
}> = {
  AGENT_UNAVAILABLE: {
    action: "查看连接方法",
    detail: "启动 Mac 上的本机备份助手后再继续；当前不会创建云端导出。",
    label: "本机备份助手未连接",
    tone: "gray",
  },
  READY: {
    action: "立即备份",
    detail: "本机备份助手已连接，可以接收经校验的完整备份。",
    label: "可以备份到 iCloud",
    tone: "blue",
  },
  PREPARING: {
    action: "正在整理",
    detail: "正在整理云端数据；数据不会写入浏览器存储。",
    label: "正在整理云端数据",
    tone: "blue",
  },
  TRANSFERRING: {
    action: "正在传输",
    detail: "正在交给本机备份助手；页面只保留本次运行状态。",
    label: "正在交给本机备份助手",
    tone: "blue",
  },
  VERIFYING: {
    action: "正在校验",
    detail: "新备份校验完成前，上一份有效备份仍然保留。",
    label: "正在校验新备份",
    tone: "blue",
  },
  SUCCESS: {
    action: "再次备份",
    detail: "新备份已完成完整性校验并替换唯一最新备份。",
    label: "已更新 iCloud 最新备份",
    tone: "green",
  },
  FAILED_RETRYABLE: {
    action: "重试",
    detail: "本次未完成，上一份有效备份未受影响。",
    label: "本次备份未完成",
    tone: "red",
  },
  FAILED_ACTION: {
    action: "查看处理方法",
    detail: "请启动本机助手或允许浏览器访问本地网络；不会降级到不安全连接。",
    label: "需要处理本机连接",
    tone: "red",
  },
};

export function ICloudBackupCard({
  lastSuccessAt = null,
  onPrimaryAction,
  readOnly = false,
  state,
}: ICloudBackupCardProps) {
  const copy = stateCopy[state];
  const inProgress = ["PREPARING", "TRANSFERRING", "VERIFYING"].includes(state);

  return (
    <article className="card pad backup-card" aria-labelledby="icloud-backup-title">
      <div className="section-head">
        <div>
          <p className="eyebrow">唯一备份入口</p>
          <h2 id="icloud-backup-title">iCloud 最新备份</h2>
        </div>
        <span className={`status ${copy.tone}`} role="status">
          {copy.label}
        </span>
      </div>
      <p className="quiet">{copy.detail}</p>
      <div className="backup-scope" aria-label="备份范围">
        <strong>完整数据</strong>
        <span>目标、日记、状态、复盘与 Apple Health</span>
      </div>
      <p className="backup-last-success">
        最近成功：{lastSuccessAt ?? "尚无已确认记录"}
      </p>
      <p className="backup-safety-note">
        新备份校验完成前，上一份有效备份不会被覆盖。
      </p>
      <button
        className="button primary"
        data-readonly={readOnly}
        data-write-control
        disabled={inProgress || (!readOnly && !onPrimaryAction)}
        onClick={onPrimaryAction}
        type="button"
      >
        {copy.action}
      </button>
    </article>
  );
}
