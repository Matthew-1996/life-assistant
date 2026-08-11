import { createZip } from "./lib/maintenance.js";

const PROFILE_BYTES = { S: 1024 * 1024, M: 4 * 1024 * 1024, L: 8 * 1024 * 1024 };
const encoder = new TextEncoder();
const SECURITY_HEADERS = {
  "Cache-Control": "private, no-store",
  "Content-Security-Policy": [
    "default-src 'self'",
    "base-uri 'none'",
    "connect-src 'self' http://127.0.0.1:47323",
    "font-src 'self'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "img-src 'self' data:",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
  ].join("; "),
  "Referrer-Policy": "no-referrer",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

function jsonResponse(payload, status = 200) {
  return withSecurityHeaders(new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json; charset=utf-8" },
    status,
  }));
}

function requireOwner(request) {
  return Boolean(request.headers.get("oai-authenticated-user-id"));
}

function profileFrom(url) {
  const profile = url.searchParams.get("profile") ?? "S";
  return Object.hasOwn(PROFILE_BYTES, profile) ? profile : null;
}

function syntheticNdjson(targetBytes) {
  const lines = [];
  let size = 0;
  for (let index = 0; size < targetBytes; index += 1) {
    const line = JSON.stringify({
      id: `synthetic-${String(index).padStart(8, "0")}`,
      note: `synthetic-capacity-${index % 997}-${(index * 2654435761 >>> 0).toString(16)}`,
      revision: index % 7,
    }) + "\n";
    lines.push(line);
    size += encoder.encode(line).byteLength;
  }
  return lines.join("");
}

function syntheticArchive(profile) {
  const data = syntheticNdjson(PROFILE_BYTES[profile]);
  const archive = createZip({
    "manifest.json": JSON.stringify({
      format_version: "life-console-poc/1",
      profile,
      synthetic: true,
    }),
    "data/synthetic.ndjson": data,
  });
  return { archive, inputBytes: encoder.encode(data).byteLength };
}

function capacityResponse(profile) {
  const started = performance.now();
  const { archive, inputBytes } = syntheticArchive(profile);
  return jsonResponse({
    archive_bytes: archive.byteLength,
    elapsed_ms: Number((performance.now() - started).toFixed(2)),
    input_bytes: inputBytes,
    profile,
    synthetic: true,
  });
}

function archiveResponse(profile) {
  const { archive } = syntheticArchive(profile);
  return withSecurityHeaders(new Response(archive, {
    headers: {
      "Content-Disposition": `attachment; filename="life-console-stage-a-${profile}.zip"`,
      "Content-Type": "application/zip",
    },
  }));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/v1/poc/")) {
      if (request.method !== "GET") {
        return jsonResponse({ error: { code: "method_not_allowed" } }, 405);
      }
      if (!requireOwner(request)) {
        return jsonResponse({ error: { code: "owner_session_required" } }, 401);
      }
      const profile = profileFrom(url);
      if (!profile) return jsonResponse({ error: { code: "profile_rejected" } }, 400);
      if (url.pathname === "/api/v1/poc/capacity") return capacityResponse(profile);
      if (url.pathname === "/api/v1/poc/archive") return archiveResponse(profile);
      return jsonResponse({ error: { code: "not_found" } }, 404);
    }
    if (url.pathname.startsWith("/api/")) {
      return jsonResponse({
        error: {
          code: "candidate_preview_read_only",
          message: "Stage A candidate exposes synthetic POC APIs only.",
        },
      }, 403);
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return jsonResponse({ error: { code: "method_not_allowed" } }, 405);
    }
    const direct = await env.ASSETS.fetch(request);
    if (direct.status !== 404) return withSecurityHeaders(direct);
    url.pathname = "/index.html";
    url.search = "";
    return withSecurityHeaders(await env.ASSETS.fetch(new Request(url, request)));
  },
};
