import { createHash } from "node:crypto";

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalValue(value: unknown): unknown {
  if (
    value === null
    || typeof value === "string"
    || typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalValue);
  }
  if (isObject(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalValue(value[key])]),
    );
  }
  throw new TypeError("Value is not canonical JSON");
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

export function canonicalNdjson(rows: readonly unknown[]): string {
  return rows.length === 0
    ? ""
    : `${rows.map(canonicalJson).join("\n")}\n`;
}

export interface CanonicalNdjsonHasher {
  update(value: unknown): void;
  digest(): string;
}

export function createCanonicalNdjsonHasher(): CanonicalNdjsonHasher {
  const hash = createHash("sha256");
  return {
    update(value: unknown): void {
      hash.update(canonicalJson(value));
      hash.update("\n");
    },
    digest(): string {
      return hash.digest("hex");
    },
  };
}

export function sha256Hex(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}
