import {
  ApiError,
  type CapturePreview,
  type CheckinRequest,
  type CommandReceipt,
  type Dashboard,
  type ErrorResponse,
  type JournalDeleteReceipt,
  type JournalRequest,
  type LifeConsoleClient,
} from "./client";

export interface SitesSystemStatus {
  version: string;
  mode: "sites-api";
  source_truth: "ICLOUD_PRIMARY" | "SITES_D1_PRIMARY";
  migration: {
    phase:
      | "NOT_STARTED"
      | "PLANNING"
      | "VALIDATING"
      | "READY_TO_SWITCH"
      | "SWITCHED"
      | "ROLLED_BACK";
    batch_id: string | null;
    rollback_window_until: string | null;
    switched_at: string | null;
    rolled_back_at: string | null;
    updated_at: string | null;
  };
  encryption: {
    journal_kid: string;
    health_kid: string;
  };
  backup: {
    pending: number;
    failed: number;
    last_success_at: string | null;
  };
}

interface CsrfResponse {
  token: string;
  expires_at: string;
}

interface CloudMutation {
  id: string;
  revision?: number;
  updated_at?: string;
  deletion_plan_until?: string | null;
}

function idempotencyKey(): string {
  return `sites_${crypto.randomUUID().replaceAll("-", "")}`;
}

function receipt(value: CloudMutation, message: string): CommandReceipt {
  return {
    request_id: crypto.randomUUID(),
    command_id: value.id,
    action: value.revision === 1 ? "created" : "updated",
    source: {
      state: "saved",
      revision: value.revision ?? null,
    },
    read_model: "current",
    message,
  };
}

function unsupported(): never {
  throw new Error("This optional local-only operation is not available in Sites mode.");
}

export interface SitesLifeConsoleClient extends LifeConsoleClient {
  systemStatus(): Promise<SitesSystemStatus>;
  auditEvents(): Promise<{ items: Array<{
    id: string;
    created_at: string;
    resource_type: string;
    resource_id: string | null;
    action: string;
    result: string;
  }> }>;
  triggerBackup(): Promise<{
    batch_id: string;
    object_key: string;
    sha256: string;
  }>;
  createRecoveryPack(input: {
    passphrase: string;
    confirmation: string;
    acknowledged: boolean;
  }): Promise<{
    pack_id: string;
    object_key: string;
    sha256: string;
    key_ids: string[];
    download_url: string;
  }>;
  checkRecoveryDownload(downloadUrl: string): Promise<"available" | "expired">;
  verifyRecoveryPack(input: {
    object_key: string;
    passphrase: string;
  }): Promise<{
    verified: boolean;
    pack_id: string | null;
    key_ids: string[];
  }>;
  rotateKeks(input: { domain: "journal" | "health" }): Promise<CloudMutation>;
  createGoal(input: object): Promise<CloudMutation>;
  createWeeklyReview(input: object): Promise<CloudMutation>;
  createPhaseReview(input: object): Promise<CloudMutation>;
  importHealthDay(input: object): Promise<CloudMutation>;
}

export function createSitesApiClient(): SitesLifeConsoleClient {
  let csrf: CsrfResponse | null = null;

  async function getCsrf(): Promise<string> {
    if (csrf && Date.parse(csrf.expires_at) > Date.now() + 5_000) {
      return csrf.token;
    }
    csrf = await request<CsrfResponse>("/api/v1/auth/csrf", {
      method: "POST",
      skipCsrf: true,
    });
    return csrf.token;
  }

  async function request<T>(
    path: string,
    options: {
      method?: "GET" | "POST" | "PATCH" | "DELETE";
      body?: object;
      revision?: number | null;
      idempotent?: boolean;
      skipCsrf?: boolean;
    } = {},
  ): Promise<T> {
    const method = options.method ?? "GET";
    const headers = new Headers();
    if (options.body) headers.set("Content-Type", "application/json");
    if (options.revision !== undefined && options.revision !== null) {
      headers.set("If-Match", String(options.revision));
    }
    if (options.idempotent) headers.set("Idempotency-Key", idempotencyKey());
    if (method !== "GET" && !options.skipCsrf) {
      headers.set("X-Life-CSRF", await getCsrf());
    }
    const response = await fetch(path, {
      method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      credentials: "same-origin",
      cache: "no-store",
    });
    const value = await response.json();
    if (!response.ok) {
      throw new ApiError(value as ErrorResponse, response.status);
    }
    return value as T;
  }

  return {
    dashboard: () => request<Dashboard>("/api/v1/dashboard"),
    systemStatus: () => request<SitesSystemStatus>("/api/v1/system/status"),
    auditEvents: () => request("/api/v1/audit/events?size=20"),
    triggerBackup: () => request("/api/v1/backup/trigger", {
      method: "POST",
      body: { reason: "manual-ui" },
    }),
    createRecoveryPack: (value) => request("/api/v1/crypto/recovery-pack", {
      method: "POST",
      body: value,
    }),
    checkRecoveryDownload: async (downloadUrl) => {
      const url = new URL(downloadUrl, window.location.origin);
      if (
        url.origin !== window.location.origin
        || url.pathname !== "/api/v1/crypto/recovery-pack/download"
      ) {
        throw new Error("Invalid recovery download URL.");
      }
      const response = await fetch(url, {
        credentials: "same-origin",
        cache: "no-store",
      });
      await response.arrayBuffer();
      if (response.ok) return "available";
      if (response.status === 410) return "expired";
      throw new Error("Recovery download verification failed.");
    },
    verifyRecoveryPack: (value) =>
      request("/api/v1/crypto/verify-recovery-pack", {
        method: "POST",
        body: value,
      }),
    rotateKeks: (value) => request("/api/v1/crypto/rotate-keks", {
      method: "POST",
      body: value,
    }),
    createGoal: (value) => request("/api/v1/goals", {
      method: "POST",
      idempotent: true,
      body: value,
    }),
    createWeeklyReview: (value) => request("/api/v1/weekly-reviews", {
      method: "POST",
      idempotent: true,
      body: value,
    }),
    createPhaseReview: (value) => request("/api/v1/phase-reviews", {
      method: "POST",
      idempotent: true,
      body: value,
    }),
    importHealthDay: (value) => request("/api/v1/health/import", {
      method: "POST",
      idempotent: true,
      body: value,
    }),
    journal: async (value: Omit<JournalRequest, "idempotency_key">) => {
      const result = await request<CloudMutation>("/api/v1/journals", {
        method: "POST",
        idempotent: true,
        body: {
          date: value.event_date,
          title: value.title,
          content: value.text,
          tags: value.tags,
          mood: value.feelings?.[0] ?? null,
        },
      });
      return receipt(result, "已保存到云端真相源");
    },
    checkin: async (
      date: string,
      value: Omit<CheckinRequest, "idempotency_key">,
    ) => {
      const fields = value.fields as Record<string, unknown>;
      const anchors = Object.fromEntries(
        ["wake", "body_light", "life_action", "wind_down"]
          .filter((key) => fields[key] !== undefined)
          .map((key) => [key, fields[key]]),
      );
      const body = {
        date,
        sleep_quality: fields.sleep_quality?.toString(),
        energy: fields.energy?.toString(),
        mood: fields.mood?.toString(),
        real_life_score: fields.life_feeling?.toString(),
        anchors: Object.keys(anchors).length ? anchors : undefined,
        notes: fields.note_summary,
      };
      const isUpdate = value.expect_revision !== null
        && value.expect_revision !== undefined;
      const result = await request<CloudMutation>(
        isUpdate
          ? `/api/v1/daily-checkins/by-date/${encodeURIComponent(date)}`
          : "/api/v1/daily-checkins",
        {
          method: isUpdate ? "PATCH" : "POST",
          body,
          revision: value.expect_revision,
          idempotent: !isUpdate,
        },
      );
      return receipt(result, "已保存到云端真相源");
    },
    preview: async (text: string) => ({
      schema_version: 1,
      state: "available",
      message: "已在浏览器中生成预览，尚未写入云端",
      intent: "journal",
      preview: {
        summary: text.replace(/\s+/g, " ").trim().slice(0, 120),
      },
    }) as CapturePreview,
    enrichmentPreview: async () => unsupported(),
    enrichmentCommit: async () => unsupported(),
    enrichmentStatus: async () => unsupported(),
    enrichmentRetry: async () => unsupported(),
    enrichNow: async () => unsupported(),
    enrichmentByJournal: async () => unsupported(),
    deleteJournal: async (journalId: string) => {
      const journal = await request<{ revision: number }>(
        `/api/v1/journals/${encodeURIComponent(journalId)}`,
      );
      const result = await request<CloudMutation>(
        `/api/v1/journals/${encodeURIComponent(journalId)}/delete-plan`,
        {
          method: "POST",
          revision: journal.revision,
          body: {},
        },
      );
      return {
        request_id: crypto.randomUUID(),
        command_id: result.id,
        action: "deleted",
        journal_id: journalId,
        message: `删除计划已创建，截止 ${result.deletion_plan_until ?? "未知"}`,
      } satisfies JournalDeleteReceipt;
    },
  };
}
