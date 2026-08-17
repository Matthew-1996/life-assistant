import {
  buildJournalNormalizationMessages,
  type JournalContextEntity,
  type JournalNormalization,
} from "../journal/normalization-contract.js";
import {
  JournalNormalizationError,
  validateJournalNormalization,
} from "./journal-normalization-validator.js";

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
  timeoutMs?: number;
}

function invalidResultCode(error: unknown): string {
  if (error instanceof JournalNormalizationError) {
    return "provider_contract_rejected";
  }
  if (error instanceof SyntaxError) return "provider_invalid_json";
  return "provider_invalid_response";
}

function providerHttpCode(status: number): string {
  return `provider_http_${status}`;
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
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
  const timeoutMs = dependencies.timeoutMs ?? 20_000;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let response: Response;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      response = await dependencies.fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${dependencies.credential}`,
          "Content-Type": "application/json",
        },
        body: requestBody,
        signal: controller.signal,
      });
    } catch (error) {
      const code = error instanceof DOMException && error.name === "AbortError"
        ? "provider_timeout"
        : "provider_unavailable";
      if (attempt === 0) continue;
      throw new DeepSeekNormalizationError(code);
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) {
      if (attempt === 0 && retryableStatus(response.status)) continue;
      throw new DeepSeekNormalizationError(providerHttpCode(response.status));
    }
    let invalidCode = "provider_invalid_response";
    try {
      const payload: unknown = await response.json();
      const content = readContent(payload);
      const parsed = JSON.parse(content) as unknown;
      return validateJournalNormalization(
        parsed,
        input.rawText,
        input.contextRevisions,
      );
    } catch (error) {
      invalidCode = invalidResultCode(error);
      if (attempt === 1) {
        throw new DeepSeekNormalizationError(invalidCode);
      }
    }
  }
  throw new DeepSeekNormalizationError("provider_invalid_response");
}
