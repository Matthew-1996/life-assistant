// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StageAPocPanel } from "../../src/features/system/StageAPocPanel";
import {
  createStageAPocReceipt,
  serializeStageAPocReceipt,
} from "../../src/features/system/stageAPocReceipt";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Stage A POC panel", () => {
  it("tests the loopback health endpoint without browser persistence", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      mode: "synthetic-poc",
      ok: true,
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const storageSpy = vi.spyOn(Storage.prototype, "setItem");

    render(<StageAPocPanel />);
    await userEvent.click(screen.getByRole("button", { name: "测试本机连接" }));

    expect((await screen.findByTestId("loopback-state")).textContent).toBe("通过");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:47323/v1/health",
      { cache: "no-store" },
    );
    expect(storageSpy).not.toHaveBeenCalled();
    storageSpy.mockRestore();
  });

  it("runs S, M, and L capacity profiles sequentially", async () => {
    const fetchMock = vi.fn((url: string) => {
      const profile = new URL(url, "https://candidate.example").searchParams.get("profile");
      return Promise.resolve(new Response(JSON.stringify({
        archive_bytes: 1024,
        elapsed_ms: 1,
        input_bytes: 1024,
        profile,
        synthetic: true,
      }), { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<StageAPocPanel />);
    await userEvent.click(screen.getByRole("button", { name: "运行 S/M/L" }));

    expect((await screen.findByTestId("capacity-state")).textContent).toBe("通过");
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/v1/poc/capacity?profile=S",
      "/api/v1/poc/capacity?profile=M",
      "/api/v1/poc/capacity?profile=L",
    ]);
  });

  it("builds a redacted receipt with only synthetic results", () => {
    const receipt = createStageAPocReceipt({
      capacity: ["S", "M", "L"].map((profile, index) => ({
        archive_bytes: 2048 + index,
        elapsed_ms: 10 + index,
        input_bytes: 1024 + index,
        profile: profile as "S" | "M" | "L",
        synthetic: true as const,
      })),
      capacityState: "passed",
      loopbackState: "passed",
      transferState: "failed",
    }, new Date("2026-08-12T01:02:03.000Z"));
    const serialized = serializeStageAPocReceipt(receipt);

    expect(receipt).toEqual({
      browser_mode: "manual-chrome",
      capacity: [
        { archive_bytes: 2048, elapsed_ms: 10, input_bytes: 1024, profile: "S" },
        { archive_bytes: 2049, elapsed_ms: 11, input_bytes: 1025, profile: "M" },
        { archive_bytes: 2050, elapsed_ms: 12, input_bytes: 1026, profile: "L" },
      ],
      capacity_status: "passed",
      format_version: "life-console-poc-receipt/1",
      generated_at: "2026-08-12T01:02:03.000Z",
      loopback: "passed",
      synthetic: true,
      transfer: "failed",
    });
    expect(serialized).not.toMatch(/cookie|token|user-agent|hostname|\/Users\//i);
  });

  it("enables a local-only receipt download after all three tests finish", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/v1/health")) {
        return Promise.resolve(new Response(JSON.stringify({ mode: "synthetic-poc", ok: true })));
      }
      if (url === "/api/v1/poc/archive?profile=S") {
        return Promise.resolve(new Response(new Uint8Array([0x50, 0x4b]), { status: 200 }));
      }
      if (url.endsWith("/v1/backups")) {
        return Promise.resolve(new Response(JSON.stringify({ ok: true, synthetic: true })));
      }
      const profile = new URL(url, "https://candidate.example").searchParams.get("profile");
      return Promise.resolve(new Response(JSON.stringify({
        archive_bytes: 1024,
        elapsed_ms: 1,
        input_bytes: 1024,
        profile,
        synthetic: true,
      })));
    });
    vi.stubGlobal("fetch", fetchMock);
    const createObjectUrl = vi.fn().mockReturnValue("blob:synthetic-receipt");
    const revokeObjectUrl = vi.fn();
    class MockUrl extends URL {
      static createObjectURL = createObjectUrl;
      static revokeObjectURL = revokeObjectUrl;
    }
    vi.stubGlobal("URL", MockUrl);
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    render(<StageAPocPanel />);
    const download = screen.getByRole("button", { name: "下载去敏验收回执" });
    expect((download as HTMLButtonElement).disabled).toBe(true);

    await userEvent.click(screen.getByRole("button", { name: "测试本机连接" }));
    await userEvent.click(screen.getByRole("button", { name: "测试合成传输" }));
    await userEvent.click(screen.getByRole("button", { name: "运行 S/M/L" }));
    expect((await screen.findByTestId("capacity-state")).textContent).toBe("通过");
    expect((download as HTMLButtonElement).disabled).toBe(false);

    await userEvent.click(download);
    expect(createObjectUrl).toHaveBeenCalledOnce();
    expect(clickSpy).toHaveBeenCalledOnce();
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:synthetic-receipt");
    expect(screen.getByTestId("poc-message").textContent).toContain("不会自动上传");
    clickSpy.mockRestore();
  });
});
