// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StageAPocPanel } from "../../src/features/system/StageAPocPanel";

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
});
