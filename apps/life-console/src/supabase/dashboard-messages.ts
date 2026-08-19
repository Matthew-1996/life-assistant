import type { SupabaseClient } from "@supabase/supabase-js";

import {
  LifeConsoleRepository,
  RepositoryError,
  type SupabaseResult,
} from "./repository";

export interface DashboardImageMetadata {
  image_url?: string;
  image_author_name?: string;
  image_author_url?: string;
  image_platform_url?: string;
}

export interface DashboardMessage {
  id: number;
  user_id: string;
  week_start: string;
  message: string;
  quote_source: string | null;
  image_url: string | null;
  image_author_name: string | null;
  image_author_url: string | null;
  image_platform_url: string | null;
  fallback_theme: string;
  generated_at: string;
  revision: number;
  created_at: string;
  updated_at: string;
}

export interface UpsertDashboardMessageInput {
  idempotencyKey: string;
  weekStart: string;
  expectedRevision: number | null;
  message: string;
  quoteSource: string | null;
  imageMetadata: DashboardImageMetadata;
  fallbackTheme: string;
}

export interface DashboardMessageRepositoryPort {
  getCurrentWeek(weekStart: string): Promise<DashboardMessage | null>;
  upsert(input: UpsertDashboardMessageInput): Promise<DashboardMessage>;
}

function invalid(message: string): RepositoryError {
  return new RepositoryError("validation", 400, "invalid_request", message);
}

function isoDate(value: string): string {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)
    || Number.isNaN(parsed.getTime())
    || parsed.toISOString().slice(0, 10) !== value) {
    throw invalid("Week start must be an ISO date");
  }
  return value;
}

export class DashboardMessageRepository implements DashboardMessageRepositoryPort {
  private readonly repository: LifeConsoleRepository;

  constructor(
    private readonly client: SupabaseClient,
    repository?: LifeConsoleRepository,
  ) {
    this.repository = repository ?? new LifeConsoleRepository(client);
  }

  async getCurrentWeek(weekStart: string): Promise<DashboardMessage | null> {
    const rows = await this.repository.executeRead<DashboardMessage[]>(async () =>
      await this.client
        .from("dashboard_messages")
        .select("*")
        .eq("week_start", isoDate(weekStart))
        .limit(1) as SupabaseResult<DashboardMessage[]>
    );
    return rows?.[0] ?? null;
  }

  async upsert(input: UpsertDashboardMessageInput): Promise<DashboardMessage> {
    const message = input.message.trim();
    const fallbackTheme = input.fallbackTheme.trim();
    if (message.length < 1 || message.length > 1000 || fallbackTheme.length < 1) {
      throw invalid("Dashboard message input is invalid");
    }
    if (input.expectedRevision !== null
      && (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1)) {
      throw invalid("Expected revision must be a positive integer or null");
    }
    const rows = await this.repository.executeIdempotentWrite<DashboardMessage[]>(
      input.idempotencyKey,
      async () => await this.client.rpc("upsert_dashboard_message", {
        p_idempotency_key: input.idempotencyKey,
        p_week_start: isoDate(input.weekStart),
        p_expected_revision: input.expectedRevision,
        p_message: message,
        p_quote_source: input.quoteSource?.trim() || null,
        p_image_metadata: input.imageMetadata,
        p_fallback_theme: fallbackTheme,
      }) as SupabaseResult<DashboardMessage[]>,
    );
    const result = rows[0];
    if (!result) {
      throw new RepositoryError("unknown", 500, "empty_message_result", "Message write returned no row");
    }
    return result;
  }
}
