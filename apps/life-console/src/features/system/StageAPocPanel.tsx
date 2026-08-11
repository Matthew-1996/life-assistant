import { useState } from "react";

const LOOPBACK_BASE_URL = "http://127.0.0.1:47323";
const PROFILES = ["S", "M", "L"] as const;

type TestState = "idle" | "running" | "passed" | "failed";

interface CapacityResult {
  archive_bytes: number;
  elapsed_ms: number;
  input_bytes: number;
  profile: "S" | "M" | "L";
  synthetic: true;
}

function stateLabel(state: TestState) {
  if (state === "running") return "运行中";
  if (state === "passed") return "通过";
  if (state === "failed") return "失败";
  return "未运行";
}

export function StageAPocPanel() {
  const [loopbackState, setLoopbackState] = useState<TestState>("idle");
  const [transferState, setTransferState] = useState<TestState>("idle");
  const [capacityState, setCapacityState] = useState<TestState>("idle");
  const [capacity, setCapacity] = useState<CapacityResult[]>([]);
  const [message, setMessage] = useState("等待阶段 A 实测。所有内容均为合成数据。");

  async function testLoopback() {
    setLoopbackState("running");
    setMessage("正在请求本机回环健康接口…");
    try {
      const response = await fetch(`${LOOPBACK_BASE_URL}/v1/health`, {
        cache: "no-store",
      });
      const payload = await response.json() as { mode?: string; ok?: boolean };
      if (!response.ok || payload.ok !== true || payload.mode !== "synthetic-poc") {
        throw new Error("unexpected_health_response");
      }
      setLoopbackState("passed");
      setMessage("HTTPS 页面已成功访问本机回环接口。");
    } catch {
      setLoopbackState("failed");
      setMessage("本机回环连接失败；未发送或保存任何真实数据。");
    }
  }

  async function testTransfer() {
    setTransferState("running");
    setMessage("正在生成并转发 S 档合成 ZIP…");
    try {
      const archiveResponse = await fetch("/api/v1/poc/archive?profile=S", {
        cache: "no-store",
      });
      if (!archiveResponse.ok) throw new Error("archive_failed");
      const archive = await archiveResponse.arrayBuffer();
      const response = await fetch(`${LOOPBACK_BASE_URL}/v1/backups`, {
        body: archive,
        headers: {
          "Content-Type": "application/zip",
          "X-Life-Console-Intent": "synthetic-backup",
        },
        method: "POST",
      });
      const payload = await response.json() as { ok?: boolean; synthetic?: boolean };
      if (!response.ok || payload.ok !== true || payload.synthetic !== true) {
        throw new Error("transfer_failed");
      }
      setTransferState("passed");
      setMessage("合成 ZIP 已通过 CORS 预检并写入临时目录。");
    } catch {
      setTransferState("failed");
      setMessage("合成传输失败；临时接收器不会覆盖任何真实备份。");
    }
  }

  async function testCapacity() {
    setCapacityState("running");
    setCapacity([]);
    setMessage("正在依次运行 Worker S/M/L 合成容量档…");
    try {
      const results: CapacityResult[] = [];
      for (const profile of PROFILES) {
        const response = await fetch(`/api/v1/poc/capacity?profile=${profile}`, {
          cache: "no-store",
        });
        const payload = await response.json() as CapacityResult;
        if (!response.ok || payload.synthetic !== true || payload.profile !== profile) {
          throw new Error("capacity_failed");
        }
        results.push(payload);
      }
      setCapacity(results);
      setCapacityState("passed");
      setMessage("Worker 已完成 S/M/L 合成容量档。结果仅用于阶段 A 判断。");
    } catch {
      setCapacityState("failed");
      setMessage("Worker 容量测试失败；阶段 B-E 不会自动启动。");
    }
  }

  return (
    <section aria-labelledby="stage-a-poc-title" className="section card pad">
      <div className="section-head">
        <div>
          <p className="eyebrow">LIFE CONSOLE 2.1.0 · STAGE A</p>
          <h2 id="stage-a-poc-title">HTTPS 回环与 Worker 容量 POC</h2>
          <p className="quiet">
            私有候选仅使用合成数据；不绑定 D1、R2、KEK 或 iCloud。
          </p>
        </div>
        <span className="status blue">POC ONLY</span>
      </div>
      <div className="grid three">
        <article>
          <strong>回环连接</strong>
          <p data-testid="loopback-state">{stateLabel(loopbackState)}</p>
          <button className="button primary" disabled={loopbackState === "running"} onClick={() => void testLoopback()} type="button">
            测试本机连接
          </button>
        </article>
        <article>
          <strong>合成 ZIP 转发</strong>
          <p data-testid="transfer-state">{stateLabel(transferState)}</p>
          <button className="button primary" disabled={transferState === "running"} onClick={() => void testTransfer()} type="button">
            测试合成传输
          </button>
        </article>
        <article>
          <strong>Worker 容量</strong>
          <p data-testid="capacity-state">{stateLabel(capacityState)}</p>
          <button className="button primary" disabled={capacityState === "running"} onClick={() => void testCapacity()} type="button">
            运行 S/M/L
          </button>
        </article>
      </div>
      {capacity.length > 0 && (
        <div aria-label="容量结果" className="signal-list">
          {capacity.map((result) => (
            <div className="day-row" key={result.profile}>
              <strong>{result.profile}</strong>
              <span>{(result.input_bytes / 1024 / 1024).toFixed(2)} MB 输入</span>
              <span>{result.elapsed_ms.toFixed(1)} ms</span>
            </div>
          ))}
        </div>
      )}
      <p aria-live="polite" className="quiet" data-testid="poc-message">{message}</p>
    </section>
  );
}
