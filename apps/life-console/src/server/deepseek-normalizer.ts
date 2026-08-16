import {
  buildJournalNormalizationMessages,
  JournalNormalizationError,
  validateJournalNormalization,
  type JournalContextEntity,
  type JournalNormalization,
} from "../journal/normalization-contract";

const DEEPSEEK_ENDPOINT = "https://api.deepseek.com/chat/completions";

export class DeepSeekNormalizationError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "DeepSeekNormalizationError";
  }
}

export interface DeepSeekNormalizationInput {
  rawText: string;
  contextEntities: readonly JournalContextEntity[];
  contextRevisions: Readonly<Record<string, string>>;
}

export interface DeepSeekNormalizationDependencies {
  credential: string;
  fetch: typeof globalThis.fetch;
  endpoint?: string;
}

function readContent(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const choices = (value as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return "";
  const message = choices[0] && typeof choices[0] === "object"
    ? (choices[0] as { message?: unknown }).message
    : null;
  if (!message || typeof message !== "object") return "";
  const content = (message as { content?: unknown }).content;
  return typeof content === "string" ? content : "";
}

export async function requestDeepSeekNormalization(
  input: DeepSeekNormalizationInput,
  dependencies: DeepSeekNormalizationDependencies,
): Promise<JournalNormalization> {
  const endpoint = dependencies.endpoint ?? DEEPSEEK_ENDPOINT;
  if (endpoint !== DEEPSEEK_ENDPOINT) {
    throw new DeepSeekNormalizationError("provider_endpoint_is_not_allowlisted");
  }
  if (!dependencies.credential) {
    throw new DeepSeekNormalizationError("provider_key_unavailable");
  }

  const requestBody = JSON.stringify({
    model: "deepseek-v4-flash",
    messages: buildJournalNormalizationMessages(
      input.rawText,
      input.contextEntities,
    ),
    stream: false,
    thinking: { type: "disabled" },
    response_format: { type: "json_object" },
  });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let response: Response;
    try {
      response = await dependencies.fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${dependencies.credential}`,
          "Content-Type": "application/json",
        },
        body: requestBody,
      });
    } catch {
      throw new DeepSeekNormalizationError("provider_unavailable");
    }
    if (!response.ok) {
      throw new DeepSeekNormalizationError("provider_unavailable");
    }
    let payload: unknown;
    try {
      payload = await response.json();
      const content = readContent(payload);
      const parsed = JSON.parse(content) as unknown;
      return validateJournalNormalization(
        parsed,
        input.rawText,
        input.contextRevisions,
      );
    } catch (error) {
      if (
        !(error instanceof SyntaxError)
        && !(error instanceof JournalNormalizationError)
      ) {
        throw new DeepSeekNormalizationError("provider_invalid_response");
      }
      if (attempt === 1) {
        throw new DeepSeekNormalizationError("provider_invalid_response");
      }
    }
  }
  throw new DeepSeekNormalizationError("provider_invalid_response");
}
