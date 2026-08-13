// @vitest-environment jsdom

import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SupabaseAuthGate } from "../../src/features/auth/SupabaseAuthGate";
import type {
  AuthSession,
  LifeConsoleAuthService,
} from "../../src/supabase/auth";

afterEach(() => {
  cleanup();
});

const syntheticSession: AuthSession = {
  userId: "synthetic-owner",
  email: "owner@example.invalid",
  expiresAt: "2027-01-15T08:00:00.000Z",
};

function createAuthService(
  session: AuthSession | null = null,
): LifeConsoleAuthService & {
  emit(nextSession: AuthSession | null): void;
} {
  let listener: ((nextSession: AuthSession | null) => void) | undefined;
  return {
    session: vi.fn(async () => session),
    requestOtp: vi.fn(async () => undefined),
    verifyOtp: vi.fn(async () => syntheticSession),
    signOut: vi.fn(async () => undefined),
    subscribe: vi.fn((nextListener) => {
      listener = nextListener;
      return vi.fn();
    }),
    emit(nextSession) {
      listener?.(nextSession);
    },
  };
}

describe("Supabase Auth gate", () => {
  it("shows loading before resolving to the unauthenticated login card", async () => {
    let resolveSession: ((session: AuthSession | null) => void) | undefined;
    const auth = createAuthService();
    auth.session = vi.fn(
      () =>
        new Promise<AuthSession | null>((resolve) => {
          resolveSession = resolve;
        }),
    );

    render(
      <SupabaseAuthGate auth={auth}>
        <div>私有工作区</div>
      </SupabaseAuthGate>,
    );

    expect(
      screen.getByRole("status", { name: "登录状态" }).textContent,
    ).toContain("正在检查登录状态");
    expect(screen.queryByText("私有工作区")).toBeNull();

    resolveSession?.(null);
    expect(
      await screen.findByRole("heading", { name: "登录 Life Console" }),
    ).toBeTruthy();
    expect(screen.queryByText("私有工作区")).toBeNull();
  });

  it("requests an OTP and shows neutral feedback with a masked email", async () => {
    const user = userEvent.setup();
    const auth = createAuthService();
    render(
      <SupabaseAuthGate auth={auth}>
        <div>私有工作区</div>
      </SupabaseAuthGate>,
    );
    await screen.findByRole("heading", { name: "登录 Life Console" });

    await user.type(
      screen.getByRole("textbox", { name: "邮箱" }),
      "owner@example.invalid",
    );
    await user.click(screen.getByRole("button", { name: "发送验证码" }));

    expect(auth.requestOtp).toHaveBeenCalledWith("owner@example.invalid");
    expect(screen.getByRole("status").textContent).toContain(
      "若该邮箱已获授权，验证码已发送至 o***r@example.invalid",
    );
    expect(
      screen.getByRole("textbox", { name: "6 位验证码" }),
    ).toBeTruthy();
  });

  it("uses a Magic Link handoff for the remote candidate without showing an OTP field", async () => {
    const user = userEvent.setup();
    const auth = createAuthService();
    render(
      <SupabaseAuthGate auth={auth} deliveryMode="magic-link">
        <div>私有工作区</div>
      </SupabaseAuthGate>,
    );
    await screen.findByRole("heading", { name: "登录 Life Console" });

    await user.type(
      screen.getByRole("textbox", { name: "邮箱" }),
      "owner@example.invalid",
    );
    await user.click(screen.getByRole("button", { name: "发送登录链接" }));

    expect(auth.requestOtp).toHaveBeenCalledWith("owner@example.invalid");
    expect(screen.getByRole("status").textContent).toContain(
      "最新登录链接已发送至 o***r@example.invalid",
    );
    expect(screen.getByRole("status").textContent).toContain(
      "打开最新邮件并点击一次",
    );
    expect(screen.queryByRole("textbox", { name: "6 位验证码" })).toBeNull();
  });

  it("explains the hosted email limit instead of showing a generic send failure", async () => {
    const user = userEvent.setup();
    const auth = createAuthService();
    auth.requestOtp = vi.fn(async () => {
      throw Object.assign(new Error("synthetic rate limit"), {
        code: "over_email_send_rate_limit",
        status: 429,
      });
    });
    render(
      <SupabaseAuthGate auth={auth} deliveryMode="magic-link">
        <div>私有工作区</div>
      </SupabaseAuthGate>,
    );
    await screen.findByRole("heading", { name: "登录 Life Console" });

    await user.type(
      screen.getByRole("textbox", { name: "邮箱" }),
      "owner@example.invalid",
    );
    await user.click(screen.getByRole("button", { name: "发送登录链接" }));

    expect(screen.getByRole("alert").textContent).toContain(
      "邮件发送额度暂时用完",
    );
    expect(screen.getByRole("alert").textContent).toContain("不要重复点击");
  });

  it("requires six digits before verifying and preserves ReactNode children", async () => {
    const user = userEvent.setup();
    const auth = createAuthService();
    render(
      <SupabaseAuthGate auth={auth}>
        <div>私有工作区</div>
      </SupabaseAuthGate>,
    );
    await screen.findByRole("heading", { name: "登录 Life Console" });

    await user.type(
      screen.getByRole("textbox", { name: "邮箱" }),
      "owner@example.invalid",
    );
    await user.click(screen.getByRole("button", { name: "发送验证码" }));
    const otp = screen.getByRole("textbox", { name: "6 位验证码" });
    const verify = screen.getByRole("button", { name: "验证并登录" });

    await user.type(otp, "12345");
    expect(verify.hasAttribute("disabled")).toBe(true);
    await user.type(otp, "6");
    expect(verify.hasAttribute("disabled")).toBe(false);
    await user.click(verify);

    expect(auth.verifyOtp).toHaveBeenCalledWith(
      "owner@example.invalid",
      "123456",
    );
    expect(await screen.findByText("私有工作区")).toBeTruthy();
    expect(screen.queryByText("Owner 会话已验证")).toBeNull();
    expect(screen.queryByRole("button", { name: "退出登录" })).toBeNull();
  });

  it("passes the Owner session and sign-out capability to a render-prop child", async () => {
    const user = userEvent.setup();
    const auth = createAuthService(syntheticSession);
    render(
      <SupabaseAuthGate auth={auth}>
        {({ session, signOut }) => (
          <section>
            <p>Owner {session.userId}</p>
            <button onClick={() => void signOut()} type="button">
              从系统页退出
            </button>
          </section>
        )}
      </SupabaseAuthGate>,
    );

    expect(await screen.findByText("Owner synthetic-owner")).toBeTruthy();
    expect(screen.queryByText("Owner 会话已验证")).toBeNull();
    await user.click(screen.getByRole("button", { name: "从系统页退出" }));
    expect(auth.signOut).toHaveBeenCalledOnce();
    expect(
      await screen.findByRole("heading", { name: "登录 Life Console" }),
    ).toBeTruthy();
  });

  it("returns to login when the authenticated session expires", async () => {
    const auth = createAuthService(syntheticSession);
    render(
      <SupabaseAuthGate auth={auth}>
        {({ session }) => <div>Owner {session.userId}</div>}
      </SupabaseAuthGate>,
    );

    expect(await screen.findByText("Owner synthetic-owner")).toBeTruthy();
    auth.emit(null);
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "登录 Life Console" }),
      ).toBeTruthy();
    });
  });

  it("does not let a stale initial session overwrite a newer auth event", async () => {
    let resolveSession: ((session: AuthSession | null) => void) | undefined;
    const auth = createAuthService();
    auth.session = vi.fn(
      () =>
        new Promise<AuthSession | null>((resolve) => {
          resolveSession = resolve;
        }),
    );
    render(
      <SupabaseAuthGate auth={auth}>
        <div>私有工作区</div>
      </SupabaseAuthGate>,
    );

    act(() => auth.emit(syntheticSession));
    expect(await screen.findByText("私有工作区")).toBeTruthy();
    await act(async () => resolveSession?.(null));

    expect(screen.getByText("私有工作区")).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: "登录 Life Console" }),
    ).toBeNull();
  });

  it("ignores a stale initial session failure after a newer auth event", async () => {
    let rejectSession: ((error: Error) => void) | undefined;
    const auth = createAuthService();
    auth.session = vi.fn(
      () =>
        new Promise<AuthSession | null>((_resolve, reject) => {
          rejectSession = reject;
        }),
    );
    render(
      <SupabaseAuthGate auth={auth}>
        <div>私有工作区</div>
      </SupabaseAuthGate>,
    );

    act(() => auth.emit(syntheticSession));
    expect(await screen.findByText("私有工作区")).toBeTruthy();
    await act(async () =>
      rejectSession?.(new Error("stale synthetic failure")));

    expect(screen.getByText("私有工作区")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
