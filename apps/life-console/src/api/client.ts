import type { components, operations } from "../contracts/life-console";

export type Dashboard = components["schemas"]["Dashboard"];
export type CommandReceipt = components["schemas"]["CommandReceipt"];
export type ErrorResponse = components["schemas"]["ErrorResponse"];
export type JournalRequest = components["schemas"]["JournalRequest"];
export type CheckinRequest = components["schemas"]["CheckinRequest"];
export type CapturePreview = components["schemas"]["CapturePreview"];

type Session =
  operations["createSession"]["responses"][200]["content"]["application/json"];

export class ApiError extends Error {
  constructor(public readonly response: ErrorResponse, public readonly status: number) {
    super(response.error.message);
  }
}

export interface LifeConsoleClient {
  dashboard(): Promise<Dashboard>;
  journal(request: Omit<JournalRequest, "idempotency_key">): Promise<CommandReceipt>;
  checkin(date: string, request: Omit<CheckinRequest, "idempotency_key">): Promise<CommandReceipt>;
  preview(text: string, contextEtag: string): Promise<CapturePreview>;
}

function idempotencyKey(): string {
  return `web_${crypto.randomUUID().replaceAll("-", "")}`;
}

export function createApiClient(): LifeConsoleClient {
  let session: Session | null = null;
  let sessionRequest: Promise<Session> | null = null;

  function sessionIsFresh(value: Session): boolean {
    return Date.parse(value.expires_at) > Date.now() + 5_000;
  }

  async function getSession(force = false): Promise<Session> {
    if (!force && session && sessionIsFresh(session)) return session;
    if (!force && sessionRequest) return sessionRequest;
    sessionRequest = fetch("/api/v1/session", {
      credentials: "same-origin",
      cache: "no-store",
    }).then(async (response) => {
      const value = await response.json();
      if (!response.ok) throw new ApiError(value as ErrorResponse, response.status);
      session = value as Session;
      return session;
    }).finally(() => {
      sessionRequest = null;
    });
    return sessionRequest;
  }

  async function request<T>(path: string, body?: object): Promise<T> {
    let state = await getSession();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const options: RequestInit = {
        credentials: "same-origin",
        cache: "no-store",
      };
      if (body) {
        options.method = "POST";
        options.headers = {
          "Content-Type": "application/json",
          "X-Life-CSRF": state.csrf_token,
        };
        options.body = JSON.stringify(body);
      }
      const response = await fetch(path, options);
      const value = await response.json();
      if (response.status === 403 && attempt === 0) {
        session = null;
        state = await getSession(true);
        continue;
      }
      if (!response.ok) throw new ApiError(value as ErrorResponse, response.status);
      return value as T;
    }
    throw new Error("Life Console session retry was exhausted");
  }

  return {
    dashboard: () => request<Dashboard>("/api/v1/dashboard"),
    journal: (value) =>
      request<CommandReceipt>("/api/v1/journals", {
        ...value,
        idempotency_key: idempotencyKey(),
      }),
    checkin: (date, value) =>
      request<CommandReceipt>(`/api/v1/checkins/${date}`, {
        ...value,
        idempotency_key: idempotencyKey(),
      }),
    preview: (text, contextEtag) =>
      request<CapturePreview>("/api/v1/capture/preview", {
        schema_version: 1,
        text,
        context_etag: contextEtag,
      }),
  };
}
