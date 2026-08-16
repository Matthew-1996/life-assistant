import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  journalContractVersion,
  journalPromptVersion,
  type JournalContextEntity,
  type JournalNormalization,
} from "../journal/normalization-contract.js";
import {
  JournalRepository,
  type JournalNormalizationJob,
} from "../supabase/journals.js";
import {
  LifeConsoleRepository,
  RepositoryError,
  type SupabaseResult,
} from "../supabase/repository.js";
import {
  DeepSeekNormalizationError,
  requestDeepSeekNormalization,
} from "./deepseek-normalizer.js";

export interface JournalNormalizationEnvironment {
  supabaseUrl: string;
  supabasePublishableKey: string;
  deepSeekApiKey: string;
}

interface StoredJournal {
  id: number;
  content: string;
  raw_revision: number;
}

interface StoredContextEntity {
  display_name: string;
  aliases: string[];
  relation: string;
  revision: string;
}

export interface JournalNormalizationStore {
  getJournal(id: number): Promise<StoredJournal | null>;
  getContextEntities(): Promise<StoredContextEntity[]>;
  beginNormalization(input: {
    journalId: number;
    sourceRevision: number;
    processor: "deepseek";
    taskKey: string;
  }): Promise<Pick<JournalNormalizationJob, "id" | "source_revision">>;
  completeNormalization(input: {
    jobId: string;
    sourceRevision: number;
    normalization: JournalNormalization;
  }): Promise<void>;
  failNormalization(input: {
    jobId: string;
    sourceRevision: number;
    failureCode: string;
  }): Promise<void>;
}

export interface JournalNormalizationServiceDependencies {
  createStore(
    environment: JournalNormalizationEnvironment,
    bearer: string,
  ): JournalNormalizationStore;
  normalize(
    input: {
      rawText: string;
      contextEntities: JournalContextEntity[];
      contextRevisions: Record<string, string>;
    },
    environment: JournalNormalizationEnvironment,
  ): Promise<JournalNormalization>;
}

function json(status: number, value: string): Response {
  return Response.json({ status: value }, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer ([^\s]+)$/.exec(authorization);
  return match?.[1] ?? null;
}

function validBody(value: unknown): value is {
  journal_id: number;
  source_revision: number;
  task_key: string;
} {
  if (!value || typeof value !== "object") return false;
  const body = value as Record<string, unknown>;
  return Number.isSafeInteger(body.journal_id)
    && Number(body.journal_id) > 0
    && Number.isSafeInteger(body.source_revision)
    && Number(body.source_revision) > 0
    && typeof body.task_key === "string"
    && body.task_key.length >= 16
    && body.task_key.length <= 200
    && Object.keys(body).length === 3;
}

function responseForError(error: unknown): Response {
  if (error instanceof RepositoryError) {
    if (error.kind === "unauthorized" || error.kind === "forbidden") {
      return json(401, "unauthenticated");
    }
    if (error.kind === "conflict") return json(409, "conflict");
    if (error.kind === "validation") return json(400, "invalid_request");
  }
  return json(503, "normalization_failed");
}

export async function normalizeJournalRequest(
  request: Request,
  environment: JournalNormalizationEnvironment,
  dependencies: JournalNormalizationServiceDependencies = defaultDependencies,
): Promise<Response> {
  if (request.method !== "POST") return json(405, "method_not_allowed");
  const bearer = bearerToken(request);
  if (!bearer) return json(401, "unauthenticated");
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, "invalid_request");
  }
  if (!validBody(body)) return json(400, "invalid_request");

  try {
    const store = dependencies.createStore(environment, bearer);
    const journal = await store.getJournal(body.journal_id);
    if (!journal) return json(404, "not_found");
    if (journal.raw_revision !== body.source_revision) {
      return json(409, "conflict");
    }
    const storedContext = await store.getContextEntities();
    const contextEntities = storedContext.map((entity) => ({
      text: entity.display_name,
      aliases: [...entity.aliases],
      relation: entity.relation,
      revision: entity.revision,
    }));
    const contextRevisions = Object.fromEntries(
      storedContext.map((entity) => [entity.display_name, entity.revision]),
    );
    const job = await store.beginNormalization({
      journalId: body.journal_id,
      sourceRevision: body.source_revision,
      processor: "deepseek",
      taskKey: body.task_key,
    });
    let normalization: JournalNormalization;
    try {
      normalization = await dependencies.normalize({
        rawText: journal.content,
        contextEntities,
        contextRevisions,
      }, environment);
    } catch (error) {
      const failureCode = error instanceof DeepSeekNormalizationError
        ? error.code
        : "provider_unavailable";
      try {
        await store.failNormalization({
          jobId: job.id,
          sourceRevision: body.source_revision,
          failureCode,
        });
      } catch {
        // The response remains fail-closed; no source content is emitted.
      }
      return json(503, "normalization_failed");
    }
    await store.completeNormalization({
      jobId: job.id,
      sourceRevision: body.source_revision,
      normalization,
    });
    return json(200, "completed");
  } catch (error) {
    return responseForError(error);
  }
}

function createSupabaseStore(
  environment: JournalNormalizationEnvironment,
  bearer: string,
): JournalNormalizationStore {
  const client = createClient(
    environment.supabaseUrl,
    environment.supabasePublishableKey,
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
      db: { retry: false },
      global: { headers: { Authorization: `Bearer ${bearer}` } },
    },
  );
  return new SupabaseJournalNormalizationStore(client);
}

class SupabaseJournalNormalizationStore implements JournalNormalizationStore {
  private readonly journals: JournalRepository;
  private readonly repository: LifeConsoleRepository;

  constructor(private readonly client: SupabaseClient) {
    this.repository = new LifeConsoleRepository(client);
    this.journals = new JournalRepository(client, this.repository);
  }

  async getJournal(id: number): Promise<StoredJournal | null> {
    const journal = await this.journals.get(id);
    if (!journal) return null;
    if (!Number.isSafeInteger(journal.raw_revision)) {
      throw new RepositoryError(
        "unknown", 500, "raw_revision_unavailable", "Journal source unavailable",
      );
    }
    return {
      id: journal.id,
      content: journal.content,
      raw_revision: journal.raw_revision as number,
    };
  }

  async getContextEntities(): Promise<StoredContextEntity[]> {
    return await this.repository.executeRead<StoredContextEntity[]>(
      async () => await this.client
        .from("journal_context_entities")
        .select("display_name,aliases,relation,revision")
        .eq("active", true) as SupabaseResult<StoredContextEntity[]>,
    ) ?? [];
  }

  beginNormalization(input: {
    journalId: number;
    sourceRevision: number;
    processor: "deepseek";
    taskKey: string;
  }): Promise<JournalNormalizationJob> {
    return this.journals.beginNormalization({
      ...input,
      contractVersion: journalContractVersion,
      promptVersion: journalPromptVersion,
    });
  }

  async completeNormalization(input: {
    jobId: string;
    sourceRevision: number;
    normalization: JournalNormalization;
  }): Promise<void> {
    await this.journals.completeNormalization({
      jobId: input.jobId,
      sourceRevision: input.sourceRevision,
      metadata: input.normalization,
      title: input.normalization.title,
      tags: input.normalization.tags,
    });
  }

  async failNormalization(input: {
    jobId: string;
    sourceRevision: number;
    failureCode: string;
  }): Promise<void> {
    await this.journals.failNormalization(input);
  }
}

const defaultDependencies: JournalNormalizationServiceDependencies = {
  createStore: createSupabaseStore,
  normalize: (input, environment) => requestDeepSeekNormalization(input, {
    credential: environment.deepSeekApiKey,
    fetch: globalThis.fetch,
  }),
};
