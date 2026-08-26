interface JournalNormalizationApiClientDependencies {
  fetch: typeof globalThis.fetch;
  getAccessToken(): Promise<string | null>;
}

interface JournalNormalizationInput {
  journalId: number;
  sourceRevision: number;
  taskKey: string;
}

export function createJournalNormalizationApiClient(
  dependencies: JournalNormalizationApiClientDependencies,
): (input: JournalNormalizationInput) => Promise<"completed" | "failed"> {
  return async (input) => {
    try {
      const token = await dependencies.getAccessToken();
      if (!token) return "failed";
      const response = await dependencies.fetch("/api/journal-normalize", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          journal_id: input.journalId,
          source_revision: input.sourceRevision,
          task_key: input.taskKey,
        }),
      });
      if (!response.ok) return "failed";
      const result: unknown = await response.json();
      if (
        !result
        || typeof result !== "object"
        || Array.isArray(result)
        || Object.keys(result).length !== 1
        || (result as Record<string, unknown>).status !== "completed"
      ) {
        return "failed";
      }
      return "completed";
    } catch {
      return "failed";
    }
  };
}
