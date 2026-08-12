import { hmacHex, sha256Hex } from "./crypto.js";
import { HttpError } from "./errors.js";

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const encoder = new TextEncoder();

function constantTimeEqual(left, right) {
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

function sessionSecret(env) {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) {
    throw new HttpError(
      503,
      "security_not_configured",
      "Session security is not configured.",
    );
  }
  return env.SESSION_SECRET;
}

export async function authenticateOwner(request, env) {
  let identity = null;
  if (env.SITES_AUTH?.verify) {
    identity = await env.SITES_AUTH.verify(request);
  } else if (request.headers.get("oai-authenticated-user-id")) {
    identity = { id: request.headers.get("oai-authenticated-user-id") };
  } else if (
    env.ALLOW_SYNTHETIC_AUTH === "true"
    && env.SYNTHETIC_OWNER_ID
    && request.headers.get("X-Synthetic-Owner") === env.SYNTHETIC_OWNER_ID
  ) {
    identity = { id: env.SYNTHETIC_OWNER_ID };
  }

  if (!identity?.id) {
    throw new HttpError(401, "owner_session_required", "Owner session is required.");
  }
  return {
    id: String(identity.id),
    hash: await sha256Hex(String(identity.id)),
  };
}

export function assertSameOrigin(request, env) {
  if (!WRITE_METHODS.has(request.method)) return;
  const expectedOrigin = env.SITE_ORIGIN || new URL(request.url).origin;
  const origin = request.headers.get("Origin");
  if (!origin || origin !== expectedOrigin) {
    throw new HttpError(403, "origin_rejected", "Request origin is not allowed.");
  }
}

export async function createCsrfToken(ownerHash, env, now = Date.now()) {
  const expiresAt = now + 15 * 60 * 1000;
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const payload = `${ownerHash}.${expiresAt}.${nonce}`;
  const signature = await hmacHex(sessionSecret(env), payload);
  return {
    token: `${payload}.${signature}`,
    expires_at: new Date(expiresAt).toISOString(),
  };
}

export async function assertCsrf(request, ownerHash, env, now = Date.now()) {
  if (!WRITE_METHODS.has(request.method)) return;
  const token = request.headers.get("X-Life-CSRF");
  const parts = token?.split(".") ?? [];
  if (parts.length !== 4) {
    throw new HttpError(403, "csrf_rejected", "CSRF token is missing or invalid.");
  }
  const [tokenOwner, expiresAtValue, nonce, providedSignature] = parts;
  const expiresAt = Number(expiresAtValue);
  if (
    tokenOwner !== ownerHash
    || !nonce
    || !Number.isSafeInteger(expiresAt)
    || expiresAt < now
  ) {
    throw new HttpError(403, "csrf_rejected", "CSRF token is missing or invalid.");
  }
  const payload = `${tokenOwner}.${expiresAt}.${nonce}`;
  const expectedSignature = await hmacHex(sessionSecret(env), payload);
  if (!constantTimeEqual(providedSignature, expectedSignature)) {
    throw new HttpError(403, "csrf_rejected", "CSRF token is missing or invalid.");
  }
}

export async function enforceRateLimit(ownerHash, request, env) {
  if (!WRITE_METHODS.has(request.method)) return;
  if (!env.WRITE_RATE_LIMITER?.limit) {
    if (env.ENVIRONMENT === "production") {
      throw new HttpError(
        503,
        "rate_limit_not_configured",
        "Write rate limiting is not configured.",
      );
    }
    return;
  }
  const result = await env.WRITE_RATE_LIMITER.limit({
    key: `${ownerHash}:${request.method}:${new URL(request.url).pathname}`,
  });
  if (!result?.success) {
    throw new HttpError(429, "rate_limited", "Too many write requests.");
  }
}

export async function requestAuditContext(request) {
  const ip = request.headers.get("CF-Connecting-IP") ?? "";
  const userAgent = request.headers.get("User-Agent") ?? "";
  return {
    ip_hash: ip ? await sha256Hex(ip) : null,
    user_agent_hash: userAgent ? await sha256Hex(userAgent) : null,
  };
}
