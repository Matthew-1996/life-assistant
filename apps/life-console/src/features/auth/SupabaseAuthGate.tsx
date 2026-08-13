import {
  type FormEvent,
  type ReactElement,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

import type {
  AuthSession,
  LifeConsoleAuthService,
} from "../../supabase/auth";

export interface SupabaseAuthGateProps {
  auth: LifeConsoleAuthService;
  children:
    | ReactNode
    | ((context: SupabaseAuthenticatedContext) => ReactNode);
  deliveryMode?: "magic-link" | "otp";
}

export interface SupabaseAuthenticatedContext {
  session: AuthSession;
  signOut(): Promise<void>;
}

function isEmailRateLimit(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; status?: unknown };
  return candidate.code === "over_email_send_rate_limit"
    || candidate.status === 429;
}

function requestErrorMessage(
  error: unknown,
  deliveryMode: "magic-link" | "otp",
): string {
  if (isEmailRateLimit(error)) {
    return deliveryMode === "magic-link"
      ? "测试环境的邮件发送额度暂时用完。请约 1 小时后再试，期间不要重复点击。"
      : "邮件发送过于频繁，请稍后再试，期间不要重复点击。";
  }
  return deliveryMode === "magic-link"
    ? "暂时无法发送登录链接，请稍后重试。"
    : "暂时无法发送验证码，请稍后重试。";
}

function maskEmail(email: string): string {
  const [localPart, domain] = email.split("@");
  if (!domain) return "***";
  if (localPart.length <= 2) {
    return `${localPart.slice(0, 1)}***@${domain}`;
  }
  return `${localPart[0]}***${localPart.at(-1)}@${domain}`;
}

export function SupabaseAuthGate({
  auth,
  children,
  deliveryMode = "otp",
}: SupabaseAuthGateProps): ReactElement {
  const [session, setSession] = useState<AuthSession | null | undefined>(
    undefined,
  );
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [deliverySent, setDeliverySent] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const authEventVersion = useRef(0);

  useEffect(() => {
    let active = true;
    const initialEventVersion = authEventVersion.current;
    const unsubscribe = auth.subscribe((nextSession) => {
      authEventVersion.current += 1;
      if (active) setSession(nextSession);
    });
    void auth.session()
      .then((currentSession) => {
        if (
          active
          && authEventVersion.current === initialEventVersion
        ) {
          setSession(currentSession);
        }
      })
      .catch(() => {
        if (
          active
          && authEventVersion.current === initialEventVersion
        ) {
          setError("暂时无法检查登录状态，请稍后重试。");
          setSession(null);
        }
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [auth]);

  async function requestOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await auth.requestOtp(email);
      setEmail(email.trim());
      setDeliverySent(true);
    } catch (requestError) {
      setError(requestErrorMessage(requestError, deliveryMode));
    } finally {
      setPending(false);
    }
  }

  async function verifyOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      setSession(await auth.verifyOtp(email, otp));
    } catch {
      setError("验证码无效或已过期，请重新获取。");
    } finally {
      setPending(false);
    }
  }

  async function signOut() {
    setPending(true);
    setError(null);
    try {
      await auth.signOut();
      setOtp("");
      setDeliverySent(false);
      setSession(null);
    } catch {
      setError("暂时无法退出登录，请稍后重试。");
    } finally {
      setPending(false);
    }
  }

  if (session === undefined) {
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

  return (
    <main className="auth-gate-shell">
      <section aria-labelledby="auth-gate-title" className="auth-gate-card">
        <div className="auth-gate-mark" aria-hidden="true" />
        <p className="auth-gate-eyebrow">OWNER ACCESS</p>
        <h1 id="auth-gate-title">登录 Life Console</h1>
        <p className="auth-gate-intro">
          {deliveryMode === "magic-link"
            ? "使用已授权邮箱获取一次性登录链接。系统不会提示邮箱是否存在。"
            : "使用已授权邮箱获取一次性验证码。系统不会提示邮箱是否存在。"}
        </p>

        {!deliverySent ? (
          <form className="auth-gate-form" onSubmit={requestOtp}>
            <label htmlFor="auth-email">邮箱</label>
            <input
              autoComplete="email"
              id="auth-email"
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
            <button
              className="primary-button"
              disabled={pending}
              type="submit"
            >
              {pending
                ? "正在发送…"
                : deliveryMode === "magic-link"
                  ? "发送登录链接"
                  : "发送验证码"}
            </button>
          </form>
        ) : deliveryMode === "magic-link" ? (
          <div className="auth-gate-form">
            <div
              aria-live="polite"
              className="auth-gate-notice"
              role="status"
            >
              <p>若该邮箱已获授权，最新登录链接已发送至 {maskEmail(email)}</p>
              <p>请打开最新邮件并点击一次，页面会自动完成登录。</p>
            </div>
            <button
              className="secondary-button"
              onClick={() => {
                setDeliverySent(false);
                setError(null);
              }}
              type="button"
            >
              更换邮箱
            </button>
          </div>
        ) : (
          <form className="auth-gate-form" onSubmit={verifyOtp}>
            <p aria-live="polite" className="auth-gate-notice" role="status">
              若该邮箱已获授权，验证码已发送至 {maskEmail(email)}
            </p>
            <label htmlFor="auth-otp">6 位验证码</label>
            <input
              autoComplete="one-time-code"
              id="auth-otp"
              inputMode="numeric"
              maxLength={6}
              onChange={(event) =>
                setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))}
              pattern="[0-9]{6}"
              value={otp}
            />
            <button
              className="primary-button"
              disabled={pending || !/^\d{6}$/.test(otp)}
              type="submit"
            >
              {pending ? "正在验证…" : "验证并登录"}
            </button>
          </form>
        )}

        {error ? <p className="auth-gate-error" role="alert">{error}</p> : null}
      </section>
    </main>
  );
}
