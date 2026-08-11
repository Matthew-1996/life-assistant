import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { Miniflare } from "miniflare";

const ORIGIN = "https://life-console.synthetic.test";
const OWNER_ID = "synthetic-owner";
const SYNTHETIC_KEK = Buffer.alloc(32, 7).toString("base64url");

export interface SyntheticMiniflareOptions {
  journalV2?: boolean;
}

export interface SyntheticMiniflareHarness {
  origin: string;
  fetch(path: string, init?: RequestInit): Promise<Response>;
  rawFetch(path: string, init?: RequestInit): Promise<Response>;
  write(
    path: string,
    body: unknown,
    headers?: Record<string, string>,
    method?: "POST" | "PATCH" | "DELETE",
  ): Promise<Response>;
  query<T>(sql: string, ...bindings: unknown[]): Promise<T[]>;
  getR2Text(key: string): Promise<string>;
  listR2Keys(prefix?: string): Promise<string[]>;
  dispose(): Promise<void>;
}

interface SyntheticR2Bucket {
  get(key: string): Promise<{ text(): Promise<string> } | null>;
  list(options: { prefix: string }): Promise<{ objects: { key: string }[] }>;
}

export async function createSyntheticMiniflare(
  options: SyntheticMiniflareOptions = {},
):
Promise<SyntheticMiniflareHarness> {
  const applicationRoot = fileURLToPath(new URL("../../../", import.meta.url));
  const workerPath = fileURLToPath(
    new URL("../../../worker/sites-200.js", import.meta.url),
  );
  const migrationPath = fileURLToPath(
    new URL("../../../d1/migrations/0001_init.sql", import.meta.url),
  );
  const miniflare = new Miniflare({
    compatibilityDate: "2025-08-01",
    modules: true,
    modulesRoot: applicationRoot,
    modulesRules: [{ type: "ESModule", include: ["worker/**/*.js"] }],
    scriptPath: workerPath,
    d1Databases: ["DB"],
    r2Buckets: ["BACKUP_BUCKET"],
    bindings: {
      ALLOW_SYNTHETIC_AUTH: "true",
      ENVIRONMENT: "test",
      KEK_BACKUP_V1: SYNTHETIC_KEK,
      KEK_HEALTH_V1: SYNTHETIC_KEK,
      KEK_JOURNAL_V1: SYNTHETIC_KEK,
      ...(options.journalV2 ? { KEK_JOURNAL_V2: SYNTHETIC_KEK } : {}),
      SESSION_SECRET: "synthetic-session-secret-at-least-32-characters",
      SITE_ORIGIN: ORIGIN,
      SYNTHETIC_OWNER_ID: OWNER_ID,
    },
  });

  const database = await miniflare.getD1Database("DB");
  const bucket = await miniflare.getR2Bucket(
    "BACKUP_BUCKET",
  ) as unknown as SyntheticR2Bucket;
  const migration = (await readFile(migrationPath, "utf8")).replace(/\s+/gu, " ");
  await database.exec(migration);

  async function rawFetch(path: string, init: RequestInit = {}) {
    return miniflare.dispatchFetch(
      `${ORIGIN}${path}`,
      init as never,
    ) as unknown as Promise<Response>;
  }

  async function authenticatedFetch(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set("X-Synthetic-Owner", OWNER_ID);
    return rawFetch(path, { ...init, headers });
  }

  return {
    origin: ORIGIN,
    fetch: authenticatedFetch,
    rawFetch,
    async write(path, body, additionalHeaders = {}, method = "POST") {
      const csrfResponse = await authenticatedFetch("/api/v1/auth/csrf", {
        method: "POST",
        headers: { Origin: ORIGIN },
      });
      const { token } = await csrfResponse.json() as { token: string };
      return authenticatedFetch(path, {
        method,
        headers: {
          "Content-Type": "application/json",
          Origin: ORIGIN,
          "X-Life-CSRF": token,
          ...additionalHeaders,
        },
        body: JSON.stringify(body),
      });
    },
    async query<T>(sql: string, ...bindings: unknown[]) {
      const statement = database.prepare(sql);
      const result = await (bindings.length > 0
        ? statement.bind(...bindings)
        : statement).all<T>();
      return result.results;
    },
    async getR2Text(key) {
      const object = await bucket.get(key);
      if (object === null) throw new Error(`R2 object not found: ${key}`);
      return object.text();
    },
    async listR2Keys(prefix = "") {
      const result = await bucket.list({ prefix });
      return result.objects.map((object) => object.key);
    },
    dispose: () => miniflare.dispose(),
  };
}
