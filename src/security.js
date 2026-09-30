import { timingSafeEqual } from "node:crypto";

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_REQUESTS = 60;
const DEFAULT_MAX_CLIENTS = 10_000;

export function createRateLimiter({
  windowMs = DEFAULT_WINDOW_MS,
  maxRequests = DEFAULT_MAX_REQUESTS,
  maxClients = DEFAULT_MAX_CLIENTS
} = {}) {
  if (!Number.isInteger(maxClients) || maxClients < 1) {
    throw new Error("maxClients must be a positive integer");
  }

  const clients = new Map();

  function prune(now) {
    for (const [key, value] of clients) {
      if (now - value.startedAt >= windowMs) {
        clients.delete(key);
      }
    }
  }

  function evictOldest() {
    const oldestKey = clients.keys().next().value;
    if (oldestKey !== undefined) {
      clients.delete(oldestKey);
    }
  }

  const rateLimit = function rateLimit(key) {
    const normalizedKey = String(key || "unknown");
    const now = Date.now();
    const current = clients.get(normalizedKey);

    prune(now);

    if (!current || now - current.startedAt >= windowMs) {
      if (!current && clients.size >= maxClients) {
        evictOldest();
      }

      clients.set(normalizedKey, { startedAt: now, count: 1 });
      return { allowed: true, remaining: Math.max(0, maxRequests - 1) };
    }

    current.count += 1;

    if (current.count > maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.ceil(
          (windowMs - (now - current.startedAt)) / 1000
        )
      };
    }

    return {
      allowed: true,
      remaining: maxRequests - current.count
    };
  };

  rateLimit.size = () => clients.size;

  return rateLimit;
}

export function applySecurityHeaders(response, corsOrigin = "") {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Security-Policy", "default-src 'none'");
  response.setHeader("X-DNS-Prefetch-Control", "off");
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  response.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()"
  );

  if (process.env.NODE_ENV === "production") {
    response.setHeader(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains"
    );
  }

  if (corsOrigin) {
    response.setHeader("Access-Control-Allow-Origin", corsOrigin);
    response.setHeader("Vary", "Origin");
  }
}

function tokensEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function authenticate(request, expectedToken) {
  if (!expectedToken) {
    throw new Error("API authentication is not configured");
  }

  const header = request.headers.authorization ?? "";
  const [scheme, token, extra] = header.split(" ");

  if (
    scheme !== "Bearer" ||
    !token ||
    extra ||
    !tokensEqual(token, expectedToken)
  ) {
    const error = new Error("unauthorized");
    error.statusCode = 401;
    throw error;
  }
}
