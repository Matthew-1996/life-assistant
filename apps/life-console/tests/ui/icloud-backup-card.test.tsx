// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ICloudBackupCard,
  type BackupUiState,
} from "../../src/features/system/ICloudBackupCard";

afterEach(() => cleanup());

describe("iCloud latest backup card", () => {
  it("shows one understandable backup action and the safety boundary", async () => {
    const user = userEvent.setup();
    const action = vi.fn();
    render(<ICloudBackupCard onPrimaryAction={action} state="READY" />);

    expect(screen.getByRole("heading", { name: "iCloud 最新备份" })).toBeTruthy();
    expect(screen.getByText("完整数据")).toBeTruthy();
    expect(screen.getByText(/上一份有效备份不会被覆盖/)).toBeTruthy();
    expect(screen.getByText("此备份可在换机或项目重建时，由 Agent 协助恢复。")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "立即备份" }));
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("renders every synthetic state without recovery or infrastructure concepts", () => {
    const states: BackupUiState[] = [
      "AGENT_UNAVAILABLE",
      "READY",
      "PREPARING",
      "TRANSFERRING",
      "VERIFYING",
      "SUCCESS",
      "FAILED_RETRYABLE",
      "FAILED_ACTION",
    ];
    for (const state of states) {
      const { unmount } = render(
        <ICloudBackupCard readOnly state={state} />,
      );
      expect(screen.getByRole("heading", { name: "iCloud 最新备份" })).toBeTruthy();
      expect(document.body.textContent).not.toContain("PBKDF2");
      expect(document.body.textContent).not.toContain("对象键");
      expect(document.body.textContent).not.toContain("审计事件");
      unmount();
    }
  });

  it("keeps in-progress actions disabled and failures explicit about old backup safety", () => {
    const { rerender } = render(<ICloudBackupCard state="VERIFYING" />);
    expect(
      (screen.getByRole("button", { name: "正在校验" }) as HTMLButtonElement).disabled,
    ).toBe(true);

    rerender(<ICloudBackupCard readOnly state="FAILED_RETRYABLE" />);
    expect(screen.getByText("本次未完成，上一份有效备份未受影响。")).toBeTruthy();
  });
});
