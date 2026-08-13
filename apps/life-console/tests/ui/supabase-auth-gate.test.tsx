// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
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
  vi.restoreAllMocks();
});

const syntheticSession: AuthSession = {
  userId: "synthetic-owner",
  email: "owner@example.invalid",
  expiresAt: "2027-01-15T08:00:00.000Z",
};

function createAuthService(
  initialSession: AuthSession | null = null,
): LifeConsoleAuthService & {
  emit(nextSession: AuthSession | null): void;
} {
  let listener: ((nextSession: AuthSession | null) => void) | undefined;
  const auth: LifeConsoleAuthService & {
    emit(nextSession: AuthSession | null): void;
  } = {
    session: vi.fn(async () => initialSession),
    signIn: vi.fn(async () => syntheticSession),
    requestPasswordReset: vi.fn(async () => undefined),
    updatePassword: vi.fn(async () => {
      if (initialSession && listener) {
        listener(initialSession);
      }
    }),
    signOut: vi.fn(async () => undefined),
    subscribe: vi.fn((nextListener) => {
      listener = nextListener;
      void auth.session().then(
        (currentSession) => {
          nextListener(currentSession);
        },
        () => {
          // If session() rejects, rely on subsequent auth state events
        },
      );
      return vi.fn();
    }),
    emit(nextSession) {
      listener?.(nextSession);
    },
  };
  return auth;
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

  it("signs in with email and password with trimmed email", async () => {
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
      "  owner@example.invalid  ",
    );
    await user.type(screen.getByLabelText("密码"), "synthetic-password");
    await user.click(screen.getByRole("button", { name: "登录" }));

    expect(auth.signIn).toHaveBeenCalledWith(
      "owner@example.invalid",
      "synthetic-password",
    );
    expect(await screen.findByText("私有工作区")).toBeTruthy();
  });

  it("shows a neutral error for invalid credentials without disclosing email existence", async () => {
    const user = userEvent.setup();
    const auth = createAuthService();
    auth.signIn = vi.fn(async () => {
      throw new Error("Invalid login credentials");
    });
    render(
      <SupabaseAuthGate auth={auth}>
        <div>私有工作区</div>
      </SupabaseAuthGate>,
    );
    await screen.findByRole("heading", { name: "登录 Life Console" });

    await user.type(
      screen.getByRole("textbox", { name: "邮箱" }),
      "unknown@example.invalid",
    );
    await user.type(screen.getByLabelText("密码"), "wrong-password");
    await user.click(screen.getByRole("button", { name: "登录" }));

    expect(auth.signIn).toHaveBeenCalledWith(
      "unknown@example.invalid",
      "wrong-password",
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "邮箱或密码不正确，请重试",
    );
    expect(screen.getByRole("alert").textContent).not.toContain("unknown");
    expect(screen.queryByText("私有工作区")).toBeNull();
  });

  it("disables inputs and button while sign-in is pending to prevent duplicate submission", async () => {
    const user = userEvent.setup();
    let resolveSignIn: ((session: AuthSession) => void) | undefined;
    const auth = createAuthService();
    auth.signIn = vi.fn(
      () =>
        new Promise<AuthSession>((resolve) => {
          resolveSignIn = resolve;
        }),
    );
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
    await user.type(screen.getByLabelText("密码"), "synthetic-password");
    fireEvent.click(screen.getByRole("button", { name: "登录" }));

    const emailInput = screen.getByRole("textbox", { name: "邮箱" });
    const passwordInput = screen.getByLabelText("密码");
    const loginButton = screen.getByRole("button", { name: "正在登录…" });
    expect(emailInput.hasAttribute("disabled")).toBe(true);
    expect(passwordInput.hasAttribute("disabled")).toBe(true);
    expect(loginButton.hasAttribute("disabled")).toBe(true);

    resolveSignIn?.(syntheticSession);
    expect(await screen.findByText("私有工作区")).toBeTruthy();
  });

  it("requests password reset and shows neutral acknowledgement", async () => {
    const user = userEvent.setup();
    const originalLocation = window.location;
    const originSpy = vi
      .spyOn(window, "location", "get")
      .mockReturnValue({
        ...originalLocation,
        origin: "https://preview.example.invalid",
      } as Location);

    const auth = createAuthService();
    render(
      <SupabaseAuthGate auth={auth}>
        <div>私有工作区</div>
      </SupabaseAuthGate>,
    );
    await screen.findByRole("heading", { name: "登录 Life Console" });

    await user.click(screen.getByRole("button", { name: "忘记密码？" }));
    expect(
      screen.getByRole("heading", { name: "重置密码" }),
    ).toBeTruthy();
    await user.type(
      screen.getByRole("textbox", { name: "邮箱" }),
      "owner@example.invalid",
    );
    await user.click(screen.getByRole("button", { name: "发送重置邮件" }));

    expect(auth.requestPasswordReset).toHaveBeenCalledWith(
      "owner@example.invalid",
      "https://preview.example.invalid/auth/recovery",
    );
    expect(screen.getByRole("status").textContent).toContain(
      "若该邮箱已获授权",
    );
    expect(screen.getByRole("status").textContent).toContain("重置邮件已发送");

    originSpy.mockRestore();
  });

  it("returns to login after password reset request", async () => {
    const user = userEvent.setup();
    const auth = createAuthService();
    render(
      <SupabaseAuthGate auth={auth}>
        <div>私有工作区</div>
      </SupabaseAuthGate>,
    );
    await screen.findByRole("heading", { name: "登录 Life Console" });

    await user.click(screen.getByRole("button", { name: "忘记密码？" }));
    expect(
      screen.getByRole("heading", { name: "重置密码" }),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "返回登录" }));

    expect(
      screen.getByRole("heading", { name: "登录 Life Console" }),
    ).toBeTruthy();
  });

  it("shows password recovery set-password form and updates password", async () => {
    const user = userEvent.setup();
    const auth = createAuthService(syntheticSession);
    auth.session = vi.fn(async () => {
      throw new Error("recovery flow uses auth state change");
    });
    render(
      <SupabaseAuthGate auth={auth} mode="recovery">
        <div>私有工作区</div>
      </SupabaseAuthGate>,
    );

    expect(
      await screen.findByRole("heading", { name: "设置新密码" }),
    ).toBeTruthy();
    await user.type(screen.getByLabelText("新密码"), "new-synthetic-password");
    await user.type(
      screen.getByLabelText("确认新密码"),
      "different-password",
    );
    const submitButton = screen.getByRole("button", { name: "设置密码并登录" });
    expect(submitButton.hasAttribute("disabled")).toBe(true);

    const confirmInput = screen.getByLabelText("确认新密码");
    await user.clear(confirmInput);
    await user.type(confirmInput, "new-synthetic-password");
    expect(submitButton.hasAttribute("disabled")).toBe(false);
    await user.click(submitButton);

    expect(auth.updatePassword).toHaveBeenCalledWith("new-synthetic-password");
    expect(await screen.findByText("私有工作区")).toBeTruthy();
  });

  it("rejects password recovery when no recovery session exists", async () => {
    const auth = createAuthService();
    auth.session = vi.fn(async () => null);
    render(
      <SupabaseAuthGate auth={auth} mode="recovery">
        <div>私有工作区</div>
      </SupabaseAuthGate>,
    );

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain(
        "恢复链接无效或已过期",
      );
    });
    expect(screen.queryByLabelText("新密码")).toBeNull();
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
