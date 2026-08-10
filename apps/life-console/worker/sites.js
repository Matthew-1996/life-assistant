function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request, env) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405 });
    }
    const direct = await env.ASSETS.fetch(request);
    if (direct.status !== 404) return withSecurityHeaders(direct);

    const url = new URL(request.url);
    url.pathname = "/index.html";
    url.search = "";
    return withSecurityHeaders(await env.ASSETS.fetch(new Request(url, request)));
  },
};
