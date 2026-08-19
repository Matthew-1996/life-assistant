import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Miniflare } from "miniflare";

import { candidateContentSecurityPolicy } from "./supabase-candidate-config.mjs";

const applicationRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const assetsRoot = resolve(applicationRoot, "dist/client");
const origin = "http://127.0.0.1:47821";
const syntheticKek = Buffer.alloc(32, 7).toString("base64url");
const syntheticContentSecurityPolicy = candidateContentSecurityPolicy({
  VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic_only",
  VITE_SUPABASE_URL: "https://synthetic-project.supabase.co",
});

const miniflare = new Miniflare({
  compatibilityDate: "2025-08-01",
  modules: true,
  modulesRoot: applicationRoot,
  modulesRules: [{ type: "ESModule", include: ["worker/**/*.js"] }],
  scriptPath: resolve(applicationRoot, "worker/sites-200.js"),
  d1Databases: ["DB"],
  r2Buckets: ["BACKUP_BUCKET"],
  bindings: {
    ALLOW_SYNTHETIC_AUTH: "true",
    ENVIRONMENT: "test",
    KEK_BACKUP_V1: syntheticKek,
    KEK_HEALTH_V1: syntheticKek,
    KEK_JOURNAL_V1: syntheticKek,
    SESSION_SECRET: "synthetic-session-secret-at-least-32-characters",
    SITE_ORIGIN: origin,
    SYNTHETIC_OWNER_ID: "synthetic-owner",
  },
});

const database = await miniflare.getD1Database("DB");
const migration = (
  await readFile(resolve(applicationRoot, "d1/migrations/0001_init.sql"), "utf8")
).replace(/\s+/gu, " ");
await database.exec(migration);

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function extension(pathname) {
  const match = pathname.match(/\.[a-z0-9]+$/iu);
  return match?.[0] ?? ".html";
}

async function requestBody(request) {
  if (request.method === "GET" || request.method === "HEAD") return undefined;
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function handleApi(request, response, url) {
  const upstream = await miniflare.dispatchFetch(`${origin}${url.pathname}${url.search}`, {
    method: request.method,
    headers: request.headers,
    body: await requestBody(request),
  });
  response.writeHead(upstream.status, Object.fromEntries(upstream.headers));
  response.end(Buffer.from(await upstream.arrayBuffer()));
}

async function handleSyntheticControl(request, response, url) {
  if (
    request.method !== "POST"
    || url.pathname !== "/__synthetic__/expire-deletion-plan"
    || request.headers["x-synthetic-test"] !== "enabled"
  ) {
    response.writeHead(403);
    response.end();
    return;
  }
  const input = JSON.parse((await requestBody(request)).toString("utf8"));
  if (typeof input.id !== "string" || !input.id.startsWith("journal_")) {
    response.writeHead(400);
    response.end();
    return;
  }
  await database.prepare(
    "UPDATE journals SET deletion_plan_until = ? WHERE id = ?",
  ).bind("2020-01-01T00:00:00.000Z", input.id).run();
  response.writeHead(204);
  response.end();
}

async function handleAsset(request, response, url) {
  const relativePath = decodeURIComponent(url.pathname).replace(/^\/+/u, "");
  const requestedPath = resolve(assetsRoot, relativePath || "index.html");
  const safePath = requestedPath.startsWith(`${assetsRoot}/`)
    ? requestedPath
    : resolve(assetsRoot, "index.html");
  let path = safePath;
  let content;
  try {
    content = await readFile(path);
  } catch {
    path = resolve(assetsRoot, "index.html");
    content = await readFile(path);
  }
  response.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Security-Policy": syntheticContentSecurityPolicy,
    "Content-Type": contentTypes[extension(path)] ?? "application/octet-stream",
  });
  response.end(request.method === "HEAD" ? undefined : content);
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", origin);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
    } else if (url.pathname.startsWith("/__synthetic__/")) {
      await handleSyntheticControl(request, response, url);
    } else {
      await handleAsset(request, response, url);
    }
  } catch (error) {
    response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(error instanceof Error ? error.message : "Synthetic server failed");
  }
});

await new Promise((resolveReady) => {
  server.listen(47821, "127.0.0.1", resolveReady);
});
process.stdout.write(`Synthetic Sites server ready at ${origin}\n`);

async function shutdown() {
  await new Promise((resolveClosed) => server.close(resolveClosed));
  await miniflare.dispose();
  process.exit(0);
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
