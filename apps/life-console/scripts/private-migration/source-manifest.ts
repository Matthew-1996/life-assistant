import { constants } from "node:fs";
import {
  lstat,
  open,
  realpath,
} from "node:fs/promises";
import {
  isAbsolute,
  relative,
  resolve,
} from "node:path";

import { sha256Hex } from "./canonical-digest";

export const MAX_SOURCE_BYTES = 16 * 1024 * 1024;
export const MAX_SOURCE_RECORDS = 100_000;
const SOURCE_READ_CHUNK_BYTES = 64 * 1024;

export const APPROVED_MIGRATION_RESOURCE_TYPES = [
  "goals",
  "journals",
  "journal_revisions",
  "daily_checkins",
  "weekly_reviews",
  "phase_reviews",
  "health_days",
  "health_segments",
] as const;

export type MigrationResourceType =
  typeof APPROVED_MIGRATION_RESOURCE_TYPES[number];

export interface SourceManifestResource {
  resourceType: MigrationResourceType;
  sourcePath: string;
  sourceDigest: string;
  expectedCount: number;
  approvedFields: string[];
}

export interface SourceManifest {
  approvedRoot: string;
  resources: SourceManifestResource[];
}

const APPROVED_FIELDS: Record<MigrationResourceType, readonly string[]> = {
  goals: [
    "id", "user_id", "record_key", "title", "domain", "status", "priority", "start_date",
    "target_date", "revision", "deleted_at", "created_at", "updated_at",
  ],
  journals: [
    "id", "user_id", "record_key", "event_date", "title", "content", "tags", "metadata", "revision",
    "deleted_at", "created_at", "updated_at",
  ],
  journal_revisions: [
    "id", "user_id", "journal_id", "revision", "snapshot", "reason",
    "created_at",
  ],
  daily_checkins: [
    "id", "user_id", "checkin_date", "sleep_quality", "energy", "mood",
    "life_feeling", "sleep_time", "wake_time", "out_of_bed_time",
    "awake_in_bed", "anchors", "notes", "revision", "created_at", "updated_at",
  ],
  weekly_reviews: [
    "id", "user_id", "record_key", "week_start", "content", "structured_data", "revision", "deleted_at",
    "created_at", "updated_at",
  ],
  phase_reviews: [
    "id", "user_id", "record_key", "period_start", "period_end", "content", "structured_data", "revision",
    "deleted_at", "created_at", "updated_at",
  ],
  health_days: [
    "id", "user_id", "health_date", "summary", "source_revision", "revision",
    "created_at", "updated_at",
  ],
  health_segments: [
    "id", "user_id", "health_day_id", "start_at", "end_at", "source",
    "details", "created_at",
  ],
};

const RESOURCE_KEYS = [
  "resourceType",
  "sourcePath",
  "sourceDigest",
  "expectedCount",
  "approvedFields",
].sort();

function invalidManifest(): Error {
  return new Error("Invalid source manifest");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  return (
    actual.length === expected.length
    && actual.every((key, index) => key === expected[index])
  );
}

function isApprovedResourceType(
  value: unknown,
): value is MigrationResourceType {
  return (
    typeof value === "string"
    && (APPROVED_MIGRATION_RESOURCE_TYPES as readonly string[]).includes(value)
  );
}

function isCanonicalAbsolutePath(value: unknown): value is string {
  return (
    typeof value === "string"
    && isAbsolute(value)
    && resolve(value) === value
  );
}

interface ValidatedRoot {
  path: string;
  realPath: string;
}

interface SourceFileStats {
  isFile(): boolean;
  size: number;
}

interface SourceFileHandle {
  stat(): Promise<SourceFileStats>;
  read(
    buffer: Buffer,
    offset: number,
    length: number,
    position: number | null,
  ): Promise<{ bytesRead: number; buffer: Buffer }>;
  close(): Promise<void>;
}

export interface SourceFileOps {
  open(path: string, flags: number): Promise<SourceFileHandle>;
}

export interface SourceFileOptions {
  fileOps?: SourceFileOps;
}

const defaultFileOps: SourceFileOps = { open };

async function readBoundedSource(
  handle: SourceFileHandle,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (totalBytes <= MAX_SOURCE_BYTES) {
    const remainingBytes = MAX_SOURCE_BYTES + 1 - totalBytes;
    const chunk = Buffer.allocUnsafe(
      Math.min(SOURCE_READ_CHUNK_BYTES, remainingBytes),
    );
    const { bytesRead } = await handle.read(
      chunk,
      0,
      chunk.byteLength,
      null,
    );
    if (
      !Number.isSafeInteger(bytesRead)
      || bytesRead < 0
      || bytesRead > chunk.byteLength
    ) {
      throw invalidManifest();
    }
    if (bytesRead === 0) {
      return Buffer.concat(chunks, totalBytes);
    }
    chunks.push(chunk.subarray(0, bytesRead));
    totalBytes += bytesRead;
  }

  throw invalidManifest();
}

export async function readSourceFile(
  sourcePath: string,
  options: SourceFileOptions = {},
): Promise<Uint8Array> {
  let handle: SourceFileHandle | undefined;
  let bytes: Uint8Array | undefined;
  let failed = false;

  try {
    handle = await (options.fileOps ?? defaultFileOps).open(
      sourcePath,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    const stats = await handle.stat();
    if (
      !stats.isFile()
      || !Number.isSafeInteger(stats.size)
      || stats.size < 0
      || stats.size > MAX_SOURCE_BYTES
    ) {
      failed = true;
    } else {
      bytes = await readBoundedSource(handle);
    }
  } catch {
    failed = true;
  } finally {
    if (handle) {
      try {
        await handle.close();
      } catch {
        failed = true;
      }
    }
  }

  if (failed || !bytes) throw invalidManifest();
  return bytes;
}

async function validateRoot(approvedRoot: unknown): Promise<ValidatedRoot> {
  if (!isCanonicalAbsolutePath(approvedRoot)) throw invalidManifest();
  try {
    const stats = await lstat(approvedRoot);
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw invalidManifest();
    return {
      path: approvedRoot,
      realPath: await realpath(approvedRoot),
    };
  } catch {
    throw invalidManifest();
  }
}

async function validateResource(
  candidate: unknown,
  approvedRoot: ValidatedRoot,
  options: SourceFileOptions,
): Promise<SourceManifestResource> {
  if (!isObject(candidate) || !hasExactKeys(candidate, RESOURCE_KEYS)) {
    throw invalidManifest();
  }
  const {
    resourceType,
    sourcePath,
    sourceDigest,
    expectedCount,
    approvedFields,
  } = candidate;
  if (
    !isApprovedResourceType(resourceType)
    || !isCanonicalAbsolutePath(sourcePath)
    || typeof sourceDigest !== "string"
    || !/^[0-9a-f]{64}$/.test(sourceDigest)
    || !Number.isSafeInteger(expectedCount)
    || (expectedCount as number) < 0
    || !Array.isArray(approvedFields)
    || approvedFields.some((field) => typeof field !== "string")
    || new Set(approvedFields).size !== approvedFields.length
  ) {
    throw invalidManifest();
  }

  const pathFromRoot = relative(approvedRoot.path, sourcePath);
  if (
    pathFromRoot.length === 0
    || pathFromRoot === ".."
    || pathFromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
    || isAbsolute(pathFromRoot)
  ) {
    throw invalidManifest();
  }
  const allowedFields = new Set(APPROVED_FIELDS[resourceType]);
  if (approvedFields.some((field) => !allowedFields.has(field))) {
    throw invalidManifest();
  }

  try {
    if (
      await realpath(sourcePath)
      !== resolve(approvedRoot.realPath, pathFromRoot)
    ) {
      throw invalidManifest();
    }
    if (sha256Hex(await readSourceFile(sourcePath, options)) !== sourceDigest) {
      throw invalidManifest();
    }
  } catch {
    throw invalidManifest();
  }

  return candidate as unknown as SourceManifestResource;
}

export async function validateSourceManifest(
  candidate: unknown,
  options: SourceFileOptions = {},
): Promise<SourceManifest> {
  if (
    !isObject(candidate)
    || !hasExactKeys(candidate, ["approvedRoot", "resources"])
    || !Array.isArray(candidate.resources)
    || candidate.resources.length !== APPROVED_MIGRATION_RESOURCE_TYPES.length
  ) {
    throw invalidManifest();
  }
  const approvedRoot = await validateRoot(candidate.approvedRoot);
  const resources = await Promise.all(
    candidate.resources.map((resource) =>
      validateResource(resource, approvedRoot, options)
    ),
  );
  const resourceTypes = new Set(
    resources.map((resource) => resource.resourceType),
  );
  if (
    resourceTypes.size !== resources.length
    || APPROVED_MIGRATION_RESOURCE_TYPES.some(
      (resourceType) => !resourceTypes.has(resourceType),
    )
  ) {
    throw invalidManifest();
  }
  return candidate as unknown as SourceManifest;
}
