export const LIFE_CONSOLE_SCHEMA_VERSION = 1 as const;

export type AnchorValue = "complete" | "minimum" | "skipped";
export type AnchorState = AnchorValue | null;
export type RatingValue = 1 | 2 | 3 | 4 | 5;
export type Rating = RatingValue | null;

export interface Confirmation {
  id: string;
  type:
    | "revision_conflict"
    | "health_conflict"
    | "purge_plan"
    | "goal_change"
    | "service_issue";
  title: string;
  message: string;
  action_label: string;
}

export interface RatingSample {
  date: string;
  sleep_quality: Rating;
  energy: Rating;
  mood: Rating;
  life_feeling: Rating;
}

export interface SleepSample {
  date: string;
  sleep_time: string | null;
  wake_time: string | null;
  out_of_bed_time: string | null;
}

export interface Dashboard {
  schema_version: typeof LIFE_CONSOLE_SCHEMA_VERSION;
  generated_at: string;
  date: string;
  today: {
    focus: {
      title: string;
      phase_label: string;
    };
    suggested_action: {
      id: string;
      label: string;
      writable: boolean;
    } | null;
    anchors: {
      wake: AnchorState;
      body_light: AnchorState;
      life_action: AnchorState;
      wind_down: AnchorState;
    };
    daily_revision: number | null;
    confirmations: Confirmation[];
  };
  progress: {
    ratings: RatingSample[];
    sleep: SleepSample[];
    sample_counts: {
      daily: number;
      missing: number;
    };
  };
  records: {
    recent_journals: Array<{
      date: string;
      title: string;
      summary: string;
    }>;
  };
  system: {
    hub: "ready" | "unavailable";
    icloud: "ready" | "partial" | "unavailable";
    automation: "ready" | "attention" | "unknown";
    backup: "ready" | "attention" | "unknown";
    google: "paused" | "on_demand";
    mobile: "pending";
  };
  source_revisions: Record<string, string>;
}

export interface JournalRequest {
  schema_version: typeof LIFE_CONSOLE_SCHEMA_VERSION;
  idempotency_key: string;
  event_date: string;
  event_time?: string | null;
  time_precision: "exact" | "approximate" | "unknown";
  text: string;
}

export interface CheckinFields {
  sleep_time?: string;
  wake_time?: string;
  out_of_bed_time?: string;
  sleep_quality?: RatingValue;
  energy?: RatingValue;
  mood?: RatingValue;
  life_feeling?: RatingValue;
  awake_in_bed?: "yes" | "no";
  wake?: AnchorValue;
  body_light?: AnchorValue;
  life_action?: AnchorValue;
  wind_down?: AnchorValue;
  note_summary?: string;
}

export interface CheckinRequest {
  schema_version: typeof LIFE_CONSOLE_SCHEMA_VERSION;
  idempotency_key: string;
  expect_revision: number | null;
  fields: CheckinFields;
}

export interface CommandReceipt {
  request_id: string;
  command_id: string;
  action: "created" | "updated" | "unchanged";
  source: {
    state: "saved";
    revision: number | null;
  };
  read_model: "current" | "pending_refresh";
  message: string;
}

export type ErrorCode =
  | "INVALID_REQUEST"
  | "REVISION_CONFLICT"
  | "SOURCE_INVALID"
  | "HUB_UNAVAILABLE"
  | "TOOL_TIMEOUT"
  | "PREVIEW_EXPIRED";

export interface ErrorResponse {
  request_id: string;
  error: {
    code: ErrorCode;
    message: string;
    retryable: boolean;
  };
}

export interface CapturePreview {
  schema_version: typeof LIFE_CONSOLE_SCHEMA_VERSION;
  state: "available" | "handoff_required" | "unavailable";
  message: string;
  preview_token?: string;
  intent?: "journal" | "checkin" | "mixed" | "unknown";
  preview?: Record<string, unknown>;
}
