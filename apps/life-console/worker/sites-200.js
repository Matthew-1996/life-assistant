import { batch, requireDatabase } from "./lib/db.js";
import { errorPayload } from "./lib/errors.js";
import { auditStatement } from "./lib/repository.js";
import { authenticateOwner, requestAuditContext } from "./lib/security.js";
import { handleApi } from "./routes/api.js";

const SECURITY_HEADERS = {
  "Cache-Control": "private, no-store",
  "Content-Security-Policy": [
    "default-src 'self'",
    "base-uri 'none'",
    "connect-src 'self'",
    "font-src 'self'",
    "form-action 'self'",
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
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function jsonResponse(payload, status, requestId = null) {
  return withSecurityHeaders(new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...(requestId ? { "X-Request-Id": requestId } : {}),
    },
  }));
}

async function serveApi(request, env) {
  const requestId = crypto.randomUUID();
  try {
    return jsonResponse(await handleApi(request, env), 200, requestId);
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 500;
    if (status >= 400 && status !== 401) {
      try {
        const owner = await authenticateOwner(request, env);
        const segments = new URL(request.url).pathname.split("/").filter(Boolean);
        await batch(requireDatabase(env), [
          auditStatement({
            ownerHash: owner.hash,
            resourceType: segments[2] ?? "api",
            resourceId: segments[3] ?? null,
            action: `${request.method}_${error?.code ?? "error"}`.slice(0, 100),
            result: status === 409 ? "CONFLICT" : "FAIL",
            auditContext: await requestAuditContext(request),
          }),
        ]);
      } catch {
        // Error reporting must never replace the original API response.
      }
    }
    if (status >= 500) {
      console.error("Life Console API request failed", {
        request_id: requestId,
        method: request.method,
        path: new URL(request.url).pathname,
        status,
      });
    }
    return jsonResponse(errorPayload(error, requestId), status, requestId);
  }
}

async function serveSpa(request, env) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return jsonResponse({
      error: {
        code: "method_not_allowed",
        message: "Only GET and HEAD are allowed for static assets.",
      },
    }, 405);
  }

  const direct = await env.ASSETS.fetch(request);
  if (direct.status !== 404) {
    return withSecurityHeaders(direct);
  }

  const url = new URL(request.url);
  url.pathname = "/index.html";
  url.search = "";
  return withSecurityHeaders(await env.ASSETS.fetch(new Request(url, request)));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/v1/")) {
      return serveApi(request, env);
    }
    return serveSpa(request, env);
  },
};
