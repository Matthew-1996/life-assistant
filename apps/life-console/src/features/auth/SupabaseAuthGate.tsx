import {
  type FormEvent,
  type ReactElement,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

import { createRecoveryRedirect } from "./recovery-redirect";
import type {
  AuthSession,
  LifeConsoleAuthService,
} from "../../supabase/auth";

export interface SupabaseAuthGateProps {
  auth: LifeConsoleAuthService;
  children:
    | ReactNode
    | ((context: SupabaseAuthenticatedContext) => ReactNode);
  mode?: "sign-in" | "recovery";
}

export interface SupabaseAuthenticatedContext {
  session: AuthSession;
  signOut(): Promise<void>;
}

type ViewMode = "sign-in" | "forgot-password" | "recovery" | "reset-sent";

function isInvalidCredentials(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Invalid login credentials")
    || message.includes("invalid_credentials")
    || message.includes("Email not confirmed");
}

function signInErrorMessage(error: unknown): string {
  if (isInvalidCredentials(error)) {
    return "邮箱或密码不正确，请重试。";
  }
  return "暂时无法登录，请稍后重试。";
}

function resetPasswordErrorMessage(error: unknown): string {
  return "暂时无法发送重置邮件，请稍后重试。";
}

export function SupabaseAuthGate({
  auth,
  children,
  mode = "sign-in",
}: SupabaseAuthGateProps): ReactElement {
  const [session, setSession] = useState<AuthSession | null | undefined>(
    undefined,
  );
  const [view, setView] = useState<ViewMode>(mode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const authEventVersion = useRef(0);

  const [recoveryCompleted, setRecoveryCompleted] = useState(false);

  useEffect(() => {
    let active = true;
    const initialEventVersion = authEventVersion.current;
    const unsubscribe = auth.subscribe((nextSession) => {
      authEventVersion.current += 1;
      if (active) {
        setSession(nextSession);
        if (nextSession) {
          setError(null);
        } else if (mode === "recovery" && authEventVersion.current === initialEventVersion + 1) {
          setError("恢复链接无效或已过期，请重新发起密码重置。");
          setView("sign-in");
        }
      }
    });

    void auth.session()
      .then((currentSession) => {
        if (
          active
          && authEventVersion.current === initialEventVersion
        ) {
          setSession(currentSession);
          if (mode === "recovery" && !currentSession) {
            setError("恢复链接无效或已过期，请重新发起密码重置。");
            setView("sign-in");
          }
        }
      })
      .catch(() => {
        if (
          active
          && authEventVersion.current === initialEventVersion
          && mode !== "recovery"
        ) {
          setError("暂时无法检查登录状态，请稍后重试。");
          setSession(null);
        }
      });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [auth, mode]);

  async function handleSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const signedInSession = await auth.signIn(email.trim(), password);
      setPassword("");
      setSession(signedInSession);
    } catch (signInError) {
      setError(signInErrorMessage(signInError));
    } finally {
      setPending(false);
    }
  }

  async function handleRequestReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await auth.requestPasswordReset(
        email.trim(),
        createRecoveryRedirect(window.location.origin),
      );
      setView("reset-sent");
    } catch (resetError) {
      setError(resetPasswordErrorMessage(resetError));
    } finally {
      setPending(false);
    }
  }

  async function handleSetNewPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || newPassword !== confirmPassword) return;
    setPending(true);
    setError(null);
    try {
      await auth.updatePassword(newPassword);
      setNewPassword("");
      setConfirmPassword("");
      setRecoveryCompleted(true);
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : "暂时无法设置新密码，请稍后重试。",
      );
    } finally {
      setPending(false);
    }
  }

  async function signOut() {
    setPending(true);
    setError(null);
    try {
      await auth.signOut();
      setEmail("");
      setPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setView("sign-in");
      setSession(null);
    } catch {
      setError("暂时无法退出登录，请稍后重试。");
    } finally {
      setPending(false);
    }
  }

  if (session === undefined) {
    if (mode === "recovery") {
      return (
        <main className="auth-gate-shell">
          <section aria-labelledby="auth-gate-title" className="auth-gate-card">
            <div className="auth-gate-mark" aria-hidden="true" />
            {renderRecoveryView()}
            {error ? <p className="auth-gate-error" role="alert">{error}</p> : null}
          </section>
        </main>
      );
    }
    return (
      <main className="auth-gate-shell">
        <div
          aria-label="登录状态"
          className="auth-gate-loading"
          role="status"
        >
          正在检查登录状态…
        </div>
      </main>
    );
  }

  if (session) {
    if (mode === "recovery" && !recoveryCompleted) {
      return (
        <main className="auth-gate-shell">
          <section aria-labelledby="auth-gate-title" className="auth-gate-card">
            <div className="auth-gate-mark" aria-hidden="true" />
            {renderRecoveryView()}
            {error ? <p className="auth-gate-error" role="alert">{error}</p> : null}
          </section>
        </main>
      );
    }
    const authenticatedChildren = typeof children === "function"
      ? children({ session, signOut })
      : children;
    return (
      <div className="auth-gate-authenticated">
        {error ? <div role="alert">{error}</div> : null}
        {authenticatedChildren}
      </div>
    );
  }

  function renderSignInView() {
    return (
      <>
        <p className="auth-gate-eyebrow">OWNER ACCESS</p>
        <h1 id="auth-gate-title">登录 Life Console</h1>
        <p className="auth-gate-intro">
          使用已授权邮箱和密码登录。系统不会提示邮箱是否存在。
        </p>

        <form className="auth-gate-form" onSubmit={handleSignIn}>
          <label htmlFor="auth-email">邮箱</label>
          <input
            autoComplete="username"
            disabled={pending}
            id="auth-email"
            onChange={(event) => setEmail(event.target.value)}
            required
            type="email"
            value={email}
          />
          <label htmlFor="auth-password">密码</label>
          <input
            autoComplete="current-password"
            disabled={pending}
            id="auth-password"
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
          <button
            className="primary-button"
            disabled={pending || !email.trim() || !password}
            type="submit"
          >
            {pending ? "正在登录…" : "登录"}
          </button>
          <button
            className="secondary-button"
            disabled={pending}
            onClick={() => {
              setError(null);
              setView("forgot-password");
            }}
            type="button"
          >
            忘记密码？
          </button>
        </form>
      </>
    );
  }

  function renderForgotPasswordView() {
    return (
      <>
        <p className="auth-gate-eyebrow">PASSWORD RESET</p>
        <h1 id="auth-gate-title">重置密码</h1>
        <p className="auth-gate-intro">
          输入邮箱地址，若该邮箱已获授权，我们会发送重置链接。
        </p>

        <form className="auth-gate-form" onSubmit={handleRequestReset}>
          <label htmlFor="auth-reset-email">邮箱</label>
          <input
            autoComplete="email"
            disabled={pending}
            id="auth-reset-email"
            onChange={(event) => setEmail(event.target.value)}
            required
            type="email"
            value={email}
          />
          <button
            className="primary-button"
            disabled={pending || !email.trim()}
            type="submit"
          >
            {pending ? "正在发送…" : "发送重置邮件"}
          </button>
          <button
            className="secondary-button"
            disabled={pending}
            onClick={() => {
              setError(null);
              setView("sign-in");
            }}
            type="button"
          >
            返回登录
          </button>
        </form>
      </>
    );
  }

  function renderResetSentView() {
    return (
      <>
        <p className="auth-gate-eyebrow">EMAIL SENT</p>
        <h1 id="auth-gate-title">检查邮箱</h1>
        <div
          aria-live="polite"
          className="auth-gate-notice"
          role="status"
        >
          <p>若该邮箱已获授权，重置邮件已发送。</p>
          <p>请打开最新邮件并点击重置链接设置新密码。</p>
        </div>
        <div className="auth-gate-form">
          <button
            className="secondary-button"
            onClick={() => {
              setError(null);
              setEmail("");
              setView("sign-in");
            }}
            type="button"
          >
            返回登录
          </button>
        </div>
      </>
    );
  }

  function renderRecoveryView() {
    const canSubmit = newPassword.length >= 1 && newPassword === confirmPassword;
    return (
      <>
        <p className="auth-gate-eyebrow">SET NEW PASSWORD</p>
        <h1 id="auth-gate-title">设置新密码</h1>
        <p className="auth-gate-intro">
          请输入新密码并再次确认。
        </p>

        <form className="auth-gate-form" onSubmit={handleSetNewPassword}>
          <label htmlFor="auth-new-password">新密码</label>
          <input
            autoComplete="new-password"
            disabled={pending}
            id="auth-new-password"
            onChange={(event) => setNewPassword(event.target.value)}
            required
            type="password"
            value={newPassword}
          />
          <label htmlFor="auth-confirm-password">确认新密码</label>
          <input
            autoComplete="new-password"
            disabled={pending}
            id="auth-confirm-password"
            onChange={(event) => setConfirmPassword(event.target.value)}
            required
            type="password"
            value={confirmPassword}
          />
          {newPassword && confirmPassword && newPassword !== confirmPassword ? (
            <p className="auth-gate-error" role="alert">两次输入的密码不一致。</p>
          ) : null}
          <button
            className="primary-button"
            disabled={pending || !canSubmit}
            type="submit"
          >
            {pending ? "正在设置…" : "设置密码并登录"}
          </button>
        </form>
      </>
    );
  }

  return (
    <main className="auth-gate-shell">
      <section aria-labelledby="auth-gate-title" className="auth-gate-card">
        <div className="auth-gate-mark" aria-hidden="true" />
        {view === "sign-in" && renderSignInView()}
        {view === "forgot-password" && renderForgotPasswordView()}
        {view === "reset-sent" && renderResetSentView()}
        {view === "recovery" && renderRecoveryView()}
        {error ? <p className="auth-gate-error" role="alert">{error}</p> : null}
      </section>
    </main>
  );
}
