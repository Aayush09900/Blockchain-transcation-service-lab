const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_REQUESTS = 60;

export function createRateLimiter({
  windowMs = DEFAULT_WINDOW_MS,
  maxRequests = DEFAULT_MAX_REQUESTS
} = {}) {
  const clients = new Map();

  return function rateLimit(key) {
    const now = Date.now();
    const current = clients.get(key);

    if (!current || now - current.startedAt >= windowMs) {
      clients.set(key, { startedAt: now, count: 1 });
      return { allowed: true, remaining: maxRequests - 1 };
    }

    current.count += 1;

    if (current.count > maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.ceil((windowMs - (now - current.startedAt)) / 1000)
      };
    }

    return { allowed: true, remaining: maxRequests - current.count };
  };
}

export function applySecurityHeaders(response, corsOrigin = "") {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Security-Policy", "default-src 'none'");

  if (corsOrigin) {
    response.setHeader("Access-Control-Allow-Origin", corsOrigin);
    response.setHeader("Vary", "Origin");
  }
}

export function authenticate(request, expectedToken) {
  if (!expectedToken) {
    throw new Error("API authentication is not configured");
  }

  const header = request.headers.authorization ?? "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token || token !== expectedToken) {
    const error = new Error("unauthorized");
    error.statusCode = 401;
    throw error;
  }
}
