const SECURITY_HEADERS = {
  "Cache-Control": "private, no-store",
  "Content-Security-Policy": [
    "default-src 'self'",
    "base-uri 'none'",
    "connect-src 'none'",
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
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function jsonResponse(payload, status) {
  return withSecurityHeaders(new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  }));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      return jsonResponse({
        error: {
          code: "candidate_preview_read_only",
          message: "Candidate preview does not expose an API.",
        },
      }, 403);
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return jsonResponse({
        error: {
          code: "method_not_allowed",
          message: "Only GET and HEAD are allowed for candidate assets.",
        },
      }, 405);
    }

    const direct = await env.ASSETS.fetch(request);
    if (direct.status !== 404) return withSecurityHeaders(direct);

    url.pathname = "/index.html";
    url.search = "";
    return withSecurityHeaders(await env.ASSETS.fetch(new Request(url, request)));
  },
};
