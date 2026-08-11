// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../../src/App";
import type { SitesLifeConsoleClient } from "../../src/api/sites-client";
import { syntheticDashboard } from "../../src/data/dashboard";

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  function memoryStorage(): Storage {
    const values = new Map<string, string>();
    return {
      get length() {
        return values.size;
      },
      clear: () => values.clear(),
      getItem: (key) => values.get(key) ?? null,
      key: (index) => [...values.keys()][index] ?? null,
      removeItem: (key) => {
        values.delete(key);
      },
      setItem: (key, value) => {
        values.set(key, value);
      },
    };
  }
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: memoryStorage(),
  });
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: memoryStorage(),
  });
});

function client(): SitesLifeConsoleClient {
  return {
    dashboard: vi.fn().mockResolvedValue(syntheticDashboard),
    systemStatus: vi.fn().mockResolvedValue({
      version: "2.0.0",
      mode: "sites-api",
      source_truth: "ICLOUD_PRIMARY",
      migration: {
        phase: "NOT_STARTED",
        batch_id: null,
        rollback_window_until: null,
        switched_at: null,
        rolled_back_at: null,
        updated_at: "2026-01-12T00:00:00Z",
      },
      encryption: {
        journal_kid: "journal-v1",
        health_kid: "health-v1",
      },
      backup: {
        pending: 2,
        failed: 0,
        last_success_at: null,
      },
    }),
    auditEvents: vi.fn().mockResolvedValue({
      items: [{
        id: "audit_synthetic",
        created_at: "2026-01-12T00:00:00Z",
        resource_type: "journal",
        resource_id: "journal_synthetic",
        action: "CREATE",
        result: "SUCCESS",
      }],
    }),
    triggerBackup: vi.fn().mockResolvedValue({
      batch_id: "backup_synthetic",
      object_key: "full-backups/backup_synthetic.json.enc",
      sha256: "a".repeat(64),
    }),
    createRecoveryPack: vi.fn().mockResolvedValue({
      pack_id: "recovery_synthetic",
      object_key: "recovery-packs/recovery_synthetic.zip.enc",
      sha256: "b".repeat(64),
      key_ids: ["journal-v1", "health-v1", "backup-v1"],
      download_url: "https://example.test/api/v1/crypto/recovery-pack/download?redacted",
    }),
    checkRecoveryDownload: vi.fn().mockResolvedValue("available"),
    verifyRecoveryPack: vi.fn().mockResolvedValue({
      verified: true,
      pack_id: "recovery_synthetic",
      key_ids: ["journal-v1", "health-v1", "backup-v1"],
    }),
    rotateKeks: vi.fn(),
    createGoal: vi.fn(),
    createWeeklyReview: vi.fn(),
    createPhaseReview: vi.fn(),
    importHealthDay: vi.fn(),
    journal: vi.fn(),
    checkin: vi.fn(),
    preview: vi.fn(),
    enrichmentPreview: vi.fn(),
    enrichmentCommit: vi.fn(),
    enrichmentStatus: vi.fn(),
    enrichmentRetry: vi.fn(),
    enrichNow: vi.fn(),
    enrichmentByJournal: vi.fn(),
    deleteJournal: vi.fn(),
  };
}

function navigationButton(name: string) {
  return within(screen.getByRole("navigation", { name: "全局导航" })).getByRole(
    "button",
    { name },
  );
}

describe("Life Console Sites mode", () => {
  it("shows cloud identity and cloud save target without changing navigation", async () => {
    const user = userEvent.setup();
    render(
      <App
        client={client()}
        initialDashboard={syntheticDashboard}
        mode="sites"
      />,
    );

    expect(screen.getByText("Life Console · Cloud")).toBeTruthy();
    expect(screen.getByText("Sites API")).toBeTruthy();
    await user.click(navigationButton("记录"));
    expect(screen.getByRole("button", { name: "保存到 云端真相源" })).toBeTruthy();
  });

  it("renders the six-boundary system summary and independent migration page", async () => {
    const user = userEvent.setup();
    render(
      <App
        client={client()}
        initialDashboard={syntheticDashboard}
        mode="sites"
      />,
    );

    await user.click(navigationButton("系统"));
    expect(
      screen.getByRole("heading", { name: "云端真相源，边界保持可见。" }),
    ).toBeTruthy();
    expect(screen.getByText("字段级加密")).toBeTruthy();
    expect(
      screen.getByText("我理解恢复包需要由本人安全保管").closest("label")?.classList,
    ).toContain("checkbox-row");
    await waitFor(() => expect(screen.getByText("2 条待处理")).toBeTruthy());
    await user.click(screen.getByRole("button", { name: "打开迁移向导" }));
    expect(
      screen.getByRole("heading", { name: "迁移只在全量校验通过后切源。" }),
    ).toBeTruthy();
    expect(
      (screen.getByRole("button", {
        name: "等待阶段 D 迁移授权",
      }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      screen.getByText("Owner-only 会话").closest(".day-row")?.classList,
    ).toContain("migration-check-row");
  });

  it("generates and verifies a recovery pack without exposing its passphrase", async () => {
    const user = userEvent.setup();
    const sitesClient = client();
    render(
      <App
        client={sitesClient}
        initialDashboard={syntheticDashboard}
        mode="sites"
      />,
    );

    await user.click(navigationButton("系统"));
    await user.type(
      screen.getByLabelText("恢复包保护口令"),
      "synthetic-passphrase-2026",
    );
    await user.type(
      screen.getByLabelText("再次输入保护口令"),
      "synthetic-passphrase-2026",
    );
    await user.click(screen.getByLabelText("我理解恢复包需要由本人安全保管"));
    await user.click(screen.getByRole("button", { name: "生成恢复包" }));

    await waitFor(() => {
      expect(screen.getByText(/恢复包已生成/)).toBeTruthy();
    });
    expect(sitesClient.createRecoveryPack).toHaveBeenCalledWith({
      passphrase: "synthetic-passphrase-2026",
      confirmation: "synthetic-passphrase-2026",
      acknowledged: true,
    });
    await user.click(screen.getByRole("button", { name: "验证限时下载" }));
    await waitFor(() => {
      expect(screen.getByText("签名下载当前有效")).toBeTruthy();
    });
    (sitesClient.checkRecoveryDownload as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce("expired");
    await user.click(screen.getByRole("button", { name: "验证限时下载" }));
    await waitFor(() => {
      expect(screen.getByText("签名下载已按期失效")).toBeTruthy();
    });
    await user.click(screen.getByRole("button", { name: "立即验证" }));
    await waitFor(() => {
      expect(screen.getByText("恢复包验证通过")).toBeTruthy();
    });
    expect(screen.getByText("journal / CREATE / SUCCESS")).toBeTruthy();
  });

  it("submits password-manager values even without React input events", async () => {
    const user = userEvent.setup();
    const sitesClient = client();
    render(
      <App
        client={sitesClient}
        initialDashboard={syntheticDashboard}
        mode="sites"
      />,
    );

    await user.click(navigationButton("系统"));
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    const passphrase = screen.getByLabelText("恢复包保护口令") as HTMLInputElement;
    const confirmation = screen.getByLabelText("再次输入保护口令") as HTMLInputElement;
    await user.click(screen.getByLabelText("我理解恢复包需要由本人安全保管"));
    valueSetter?.call(passphrase, "password-manager-passphrase-2026");
    valueSetter?.call(confirmation, "password-manager-passphrase-2026");
    await user.click(screen.getByRole("button", { name: "生成恢复包" }));

    await waitFor(() => {
      expect(sitesClient.createRecoveryPack).toHaveBeenCalledWith({
        passphrase: "password-manager-passphrase-2026",
        confirmation: "password-manager-passphrase-2026",
        acknowledged: true,
      });
    });
  });

  it("creates a cloud goal from a locally persisted draft", async () => {
    const user = userEvent.setup();
    const sitesClient = client();
    (sitesClient.createGoal as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "goal_synthetic",
      revision: 1,
    });
    render(
      <App
        client={sitesClient}
        initialDashboard={syntheticDashboard}
        mode="sites"
      />,
    );

    await user.click(navigationButton("进展"));
    await user.type(screen.getByLabelText("目标名称"), "合成云端目标");
    await waitFor(() => {
      const stored = localStorage.getItem("life-console:sites:goal-draft");
      expect(stored).toBeTruthy();
      expect(stored).not.toContain("合成云端目标");
    });
    await user.click(screen.getByRole("button", { name: "保存目标" }));

    await waitFor(() => {
      expect(screen.getByText("已保存到云端 · revision #1")).toBeTruthy();
    });
    expect(sitesClient.createGoal).toHaveBeenCalledWith(expect.objectContaining({
      title: "合成云端目标",
      status: "focus",
    }));
  });
});
