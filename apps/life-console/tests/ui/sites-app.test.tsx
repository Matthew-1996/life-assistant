// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
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

  it("keeps iCloud backup as the only recovery-facing system module", async () => {
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
      screen.getByRole("heading", { name: "云端可用，备份路径保持清晰。" }),
    ).toBeTruthy();
    expect(screen.getByText("云端数据已加密保存")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "iCloud 最新备份" })).toBeTruthy();
    expect(screen.getByText("本机备份助手未连接")).toBeTruthy();
    expect(screen.queryByText("恢复包")).toBeNull();
    expect(screen.queryByText("审计事件摘要")).toBeNull();
    expect(screen.queryByText("完整加密备份")).toBeNull();
    expect(screen.queryByText("迁移与恢复边界")).toBeNull();
    expect(screen.queryByRole("button", { name: "打开迁移向导" })).toBeNull();
    expect(screen.getByText("此备份可在换机或项目重建时，由 Agent 协助恢复。")).toBeTruthy();
  });

  it("keeps backup UI synthetic while the loopback bridge is blocked", async () => {
    const user = userEvent.setup();
    render(
      <App
        client={client()}
        initialDashboard={syntheticDashboard}
        mode="sites"
      />,
    );

    await user.click(navigationButton("系统"));
    await user.click(screen.getByRole("button", { name: "查看连接方法" }));
    expect(screen.getByText(/浏览器回环验证通过后开放/)).toBeTruthy();
    expect(screen.getByText(/当前只实现合成界面状态/)).toBeTruthy();
  });

  it("keeps the retired cloud write tools off the 2.5 progress page", async () => {
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
    expect(screen.getByRole("heading", { name: "目标与趋势" })).toBeTruthy();
    expect(screen.queryByLabelText("目标名称")).toBeNull();
    expect(screen.queryByRole("button", { name: "保存目标" })).toBeNull();
    expect(screen.queryByText("云端写入工具")).toBeNull();
    expect(sitesClient.createGoal).not.toHaveBeenCalled();
  });
});
