import {
  canonicalJson,
  createCanonicalNdjsonHasher,
  sha256Hex,
} from "./canonical-digest";
import {
  MAX_SOURCE_RECORDS,
  type MigrationResourceType,
  readSourceFile,
  type SourceFileOptions,
  type SourceManifest,
  validateSourceManifest,
} from "./source-manifest";

interface DryRunResourceReport {
  resourceType: MigrationResourceType;
  count: number;
  canonicalSha256: string | null;
  errors: string[];
}

export interface DryRunReport {
  resources: DryRunResourceReport[];
  overallDigest: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function* parseLines(content: string): Generator<string> {
  let start = 0;
  while (start < content.length) {
    const newline = content.indexOf("\n", start);
    if (newline === -1) {
      yield content.slice(start);
      return;
    }
    yield content.slice(start, newline);
    start = newline + 1;
  }
}

export async function createDryRunReport(
  candidate: SourceManifest,
  options: SourceFileOptions = {},
): Promise<DryRunReport> {
  const manifest = await validateSourceManifest(candidate, options);
  const resources: DryRunResourceReport[] = [];

  for (const resource of manifest.resources) {
    const bytes = await readSourceFile(resource.sourcePath, options);
    if (sha256Hex(bytes) !== resource.sourceDigest) {
      throw new Error("Invalid source manifest");
    }

    let content: string;
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      resources.push({
        resourceType: resource.resourceType,
        count: 0,
        canonicalSha256: null,
        errors: ["file: must be valid UTF-8"],
      });
      continue;
    }

    const errors: string[] = [];
    const approvedFields = new Set(resource.approvedFields);
    const canonicalHasher = createCanonicalNdjsonHasher();
    let allRowsValid = true;
    let canonicalError = false;
    let count = 0;
    for (const line of parseLines(content)) {
      count += 1;
      if (count > MAX_SOURCE_RECORDS) {
        throw new Error("Invalid source manifest");
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        allRowsValid = false;
        errors.push(`line ${count}: must be valid JSON`);
        continue;
      }
      if (!isObject(parsed)) {
        allRowsValid = false;
        errors.push(`line ${count}: must be a JSON object`);
        continue;
      }
      if (Object.keys(parsed).some((field) => !approvedFields.has(field))) {
        allRowsValid = false;
        errors.push(
          `line ${count}: contains a field not listed in approvedFields`,
        );
        continue;
      }
      try {
        canonicalHasher.update(parsed);
      } catch {
        allRowsValid = false;
        canonicalError = true;
      }
    }
    if (count !== resource.expectedCount) {
      errors.push(
        `count: expected ${resource.expectedCount} records but found ${count}`,
      );
    }
    if (canonicalError) {
      errors.push("file: contains a value that cannot be canonicalized");
    }

    resources.push({
      resourceType: resource.resourceType,
      count,
      canonicalSha256: allRowsValid ? canonicalHasher.digest() : null,
      errors,
    });
  }

  return {
    resources,
    overallDigest: sha256Hex(canonicalJson(
      [...resources].sort((left, right) =>
        left.resourceType.localeCompare(right.resourceType)
      ),
    )),
  };
}
