// @vitest-environment node

import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { JournalRepository } from "../../src/supabase/journals";

interface SyntheticResponse {
  status: number;
  body: unknown;
}

function createJournalRepository(responses: SyntheticResponse[]) {
  const requests: Request[] = [];
  const syntheticFetch: typeof fetch = async (input, init) => {
    requests.push(new Request(input, init));
    const response = responses.shift();
    if (!response) throw new Error("Missing synthetic response");
    return new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { "content-type": "application/json" },
    });
  };
  const client = createClient(
    "https://synthetic.supabase.invalid",
    "public-test-key",
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
      db: { retry: false },
      global: { fetch: syntheticFetch },
    },
  );
  return {
    repository: new JournalRepository(client),
    requests,
  };
}

const syntheticJournal = {
  id: 31,
  user_id: "synthetic-owner",
  event_date: "2030-03-01",
  title: "Synthetic Journal",
  content: "Synthetic journal content",
  tags: ["reflection", "test"],
  revision: 1,
  deleted_at: null,
  created_at: "2030-03-01T08:00:00.000Z",
  updated_at: "2030-03-01T08:00:00.000Z",
};

const syntheticRevision = {
  id: 41,
  user_id: "synthetic-owner",
  journal_id: 31,
  revision: 1,
  snapshot: {
    content: "Synthetic journal content",
    deleted_at: null,
    event_date: "2030-03-01",
    tags: ["reflection", "test"],
    title: "Synthetic Journal",
  },
  reason: "create",
  created_at: "2030-03-01T08:00:00.000Z",
};

describe("Journal Repository", () => {
  it("creates raw text through the v2 RPC before any normalization", async () => {
    const pendingJournal = {
      ...syntheticJournal,
      normalization_status: "pending",
      raw_revision: 1,
      source: "life_console",
      time_precision: "unknown",
    };
    const { repository, requests } = createJournalRepository([
      { status: 200, body: [pendingJournal] },
    ]);

    await expect(repository.createRaw("synthetic-idempotency-key", {
      recordKey: "journal:synthetic-stable-key",
      date: "2030-03-01",
      eventTime: null,
      timePrecision: "unknown",
      source: "life_console",
      privacy: "owner-only",
      content: "Synthetic journal content",
    })).resolves.toEqual(pendingJournal);

    expect(new URL(requests[0].url).pathname).toBe(
      "/rest/v1/rpc/create_journal_v2",
    );
    expect(JSON.parse(await requests[0].text())).toEqual({
      p_content: "Synthetic journal content",
      p_event_date: "2030-03-01",
      p_event_time: null,
      p_idempotency_key: "synthetic-idempotency-key",
      p_privacy: "owner-only",
      p_record_key: "journal:synthetic-stable-key",
      p_source: "life_console",
      p_time_precision: "unknown",
    });
  });

  it("begins and completes normalization behind the raw revision", async () => {
    const job = {
      id: "00000000-0000-4000-8000-000000000240",
      journal_id: 31,
      source_revision: 1,
      status: "processing",
      processor: "agent",
    };
    const completed = {
      ...syntheticJournal,
      title: "Structured synthetic title",
      normalization_status: "completed",
      raw_revision: 1,
      normalized_source_revision: 1,
      revision: 2,
    };
    const { repository, requests } = createJournalRepository([
      { status: 200, body: [job] },
      { status: 200, body: [completed] },
    ]);

    await expect(repository.beginNormalization({
      journalId: 31,
      sourceRevision: 1,
      contractVersion: "journal-normalization/1.0.0",
      promptVersion: "journal-normalization-prompt/1.0.0",
      processor: "agent",
      taskKey: "task:synthetic-1",
    })).resolves.toEqual(job);
    await expect(repository.completeNormalization({
      jobId: job.id,
      sourceRevision: 1,
      metadata: {
        title: "Structured synthetic title",
        summary: "Synthetic summary",
        facts: [], feelings: [], people: [], places: [], themes: [],
        planning_clues: [], inferences: [], tags: [],
      },
      title: "Structured synthetic title",
      tags: [],
    })).resolves.toEqual(completed);

    expect(new URL(requests[0].url).pathname).toBe(
      "/rest/v1/rpc/begin_journal_normalization",
    );
    expect(new URL(requests[1].url).pathname).toBe(
      "/rest/v1/rpc/complete_journal_normalization",
    );
  });

  it("records normalization failure without retrying or hiding staleness", async () => {
    const job = {
      id: "00000000-0000-4000-8000-000000000240",
      journal_id: 31,
      source_revision: 1,
      status: "failed",
      processor: "deepseek",
    };
    const failed = createJournalRepository([
      { status: 200, body: [job] },
    ]);
    await expect(failed.repository.failNormalization({
      jobId: job.id,
      sourceRevision: 1,
      failureCode: "provider_unavailable",
    })).resolves.toEqual(job);
    expect(JSON.parse(await failed.requests[0].text())).toEqual({
      p_expected_source_revision: 1,
      p_failure_code: "provider_unavailable",
      p_job_id: job.id,
    });

    const stale = createJournalRepository([
      {
        status: 409,
        body: { code: "journal_source_stale", message: "synthetic stale" },
      },
    ]);
    await expect(stale.repository.completeNormalization({
      jobId: job.id,
      sourceRevision: 1,
      metadata: {
        title: "Synthetic title",
        summary: "Synthetic summary",
        facts: [], feelings: [], people: [], places: [], themes: [],
        planning_clues: [], inferences: [], tags: [],
      },
      title: "Synthetic title",
      tags: [],
    })).rejects.toMatchObject({
      code: "journal_source_stale",
      kind: "conflict",
      status: 409,
    });
    expect(stale.requests).toHaveLength(1);
  });
  it("lists active journals through the fixed event-date cursor", async () => {
    const { repository, requests } = createJournalRepository([
      { status: 200, body: [syntheticJournal] },
    ]);

    await expect(repository.list({ pageSize: 20 })).resolves.toEqual({
      items: [syntheticJournal],
      nextCursor: null,
    });

    const url = new URL(requests[0].url);
    expect(url.pathname).toBe("/rest/v1/journals");
    expect(url.searchParams.get("deleted_at")).toBe("is.null");
    expect(url.searchParams.get("order")).toBe(
      "event_date.desc,id.desc",
    );
  });

  it("reads one active journal through the transient retry boundary", async () => {
    const { repository, requests } = createJournalRepository([
      {
        status: 503,
        body: { code: "PGRST000", message: "synthetic unavailable" },
      },
      { status: 200, body: [syntheticJournal] },
    ]);

    await expect(repository.get(31)).resolves.toEqual(syntheticJournal);
    expect(requests).toHaveLength(2);
    const url = new URL(requests[1].url);
    expect(url.searchParams.get("id")).toBe("eq.31");
    expect(url.searchParams.get("deleted_at")).toBe("is.null");
    expect(url.searchParams.get("limit")).toBe("1");
  });

  it("lists append-only revisions newest first", async () => {
    const { repository, requests } = createJournalRepository([
      { status: 200, body: [syntheticRevision] },
    ]);

    await expect(repository.revisions(31)).resolves.toEqual([
      syntheticRevision,
    ]);
    const url = new URL(requests[0].url);
    expect(url.pathname).toBe("/rest/v1/journal_revisions");
    expect(url.searchParams.get("journal_id")).toBe("eq.31");
    expect(url.searchParams.get("order")).toBe("revision.desc");
  });

  it("maps normalized create input to the idempotent RPC once", async () => {
    const { repository, requests } = createJournalRepository([
      { status: 200, body: [syntheticJournal] },
    ]);

    await expect(
      repository.create("synthetic-journal-key-0001", {
        date: "2030-03-01",
        title: " Synthetic Journal ",
        content: "Synthetic journal content",
        tags: [" reflection ", "test", "reflection"],
      }),
    ).resolves.toEqual(syntheticJournal);

    expect(requests).toHaveLength(1);
    expect(new URL(requests[0].url).pathname).toBe(
      "/rest/v1/rpc/create_journal",
    );
    expect(JSON.parse(await requests[0].text())).toEqual({
      p_content: "Synthetic journal content",
      p_event_date: "2030-03-01",
      p_idempotency_key: "synthetic-journal-key-0001",
      p_tags: ["reflection", "test"],
      p_title: "Synthetic Journal",
    });
  });

  it("rejects invalid create and update input before fetching", async () => {
    const { repository, requests } = createJournalRepository([]);

    for (const input of [
      {
        date: "not-a-date",
        content: "Synthetic journal content",
      },
      {
        date: "2030-02-30",
        content: "Synthetic journal content",
      },
      {
        date: "2030-03-01",
        title: "x".repeat(201),
        content: "Synthetic journal content",
      },
      {
        date: "2030-03-01",
        content: " ",
      },
      {
        date: "2030-03-01",
        content: "x".repeat(100_001),
      },
    ]) {
      await expect(
        repository.create("synthetic-journal-key-0002", input),
      ).rejects.toMatchObject({ kind: "validation", status: 400 });
    }
    await expect(
      repository.update(31, 1, {}),
    ).rejects.toMatchObject({ kind: "validation", status: 400 });
    expect(requests).toHaveLength(0);
  });

  it("normalizes explicit update fields behind a revision guard", async () => {
    const updated = {
      ...syntheticJournal,
      event_date: "2030-03-02",
      title: null,
      content: "Synthetic revised content",
      tags: ["revised"],
      revision: 2,
    };
    const { repository, requests } = createJournalRepository([
      { status: 200, body: [updated] },
    ]);

    await expect(
      repository.update(31, 1, {
        date: "2030-03-02",
        title: " ",
        content: "Synthetic revised content",
        tags: [" revised ", "revised"],
      }),
    ).resolves.toEqual(updated);

    const url = new URL(requests[0].url);
    expect(requests[0].method).toBe("PATCH");
    expect(url.searchParams.get("id")).toBe("eq.31");
    expect(url.searchParams.get("revision")).toBe("eq.1");
    expect(JSON.parse(await requests[0].text())).toEqual({
      content: "Synthetic revised content",
      event_date: "2030-03-02",
      revision: 2,
      tags: ["revised"],
      title: null,
    });
  });

  it("does not retry writes or hide revision conflicts", async () => {
    const transient = createJournalRepository([
      {
        status: 503,
        body: { code: "PGRST000", message: "synthetic unavailable" },
      },
    ]);
    await expect(
      transient.repository.create("synthetic-journal-key-0003", {
        date: "2030-03-01",
        content: "Synthetic journal content",
      }),
    ).rejects.toMatchObject({ kind: "transient", status: 503 });
    expect(transient.requests).toHaveLength(1);

    const conflict = createJournalRepository([
      { status: 200, body: [] },
    ]);
    await expect(
      conflict.repository.update(31, 1, {
        content: "Synthetic conflict",
      }),
    ).rejects.toMatchObject({
      code: "revision_conflict",
      kind: "conflict",
      status: 409,
    });
    expect(conflict.requests).toHaveLength(1);
  });
});
