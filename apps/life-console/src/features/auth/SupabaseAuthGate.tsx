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
  children: ReactNode;
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
}: SupabaseAuthGateProps): ReactElement {
  const [session, setSession] = useState<AuthSession | null | undefined>(
    undefined,
  );
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
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
      setOtpSent(true);
    } catch {
      setError("暂时无法发送验证码，请稍后重试。");
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
      setOtpSent(false);
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
    return (
      <div className="auth-gate-authenticated">
        <div className="auth-gate-session-bar">
          <span>Owner 会话已验证</span>
          <button
            className="secondary-button"
            disabled={pending}
            onClick={() => void signOut()}
            type="button"
          >
            退出登录
          </button>
        </div>
        {error ? <div role="alert">{error}</div> : null}
        {children}
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
          使用已授权邮箱获取一次性验证码。系统不会提示邮箱是否存在。
        </p>

        {!otpSent ? (
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
              {pending ? "正在发送…" : "发送验证码"}
            </button>
          </form>
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
