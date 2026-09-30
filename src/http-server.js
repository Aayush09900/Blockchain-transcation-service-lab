import http from "node:http";
import { TransactionService } from "./transaction-service.js";
import {
  applySecurityHeaders,
  authenticate,
  createRateLimiter
} from "./security.js";

const PORT = Number.parseInt(process.env.PORT ?? "3000", 10);
const MAX_BODY_BYTES = 32 * 1024;
const API_TOKEN = process.env.API_TOKEN ?? "";
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? "";
const rateLimit = createRateLimiter({
  maxRequests: Number.parseInt(process.env.RATE_LIMIT_MAX ?? "60", 10)
});

const service = new TransactionService();

function json(response, statusCode, body, extraHeaders = {}) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    ...extraHeaders
  });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  let size = 0;
  const chunks = [];

  for await (const chunk of request) {
    size += chunk.length;

    if (size > MAX_BODY_BYTES) {
      const error = new Error("request body too large");
      error.statusCode = 413;
      throw error;
    }

    chunks.push(chunk);
  }

  if (size === 0) return {};

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("invalid JSON");
    error.statusCode = 400;
    throw error;
  }
}

const server = http.createServer(async (request, response) => {
  const origin = request.headers.origin ?? "";

  applySecurityHeaders(
    response,
    CORS_ORIGIN && origin === CORS_ORIGIN ? CORS_ORIGIN : ""
  );

  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type, Idempotency-Key"
    });
    response.end();
    return;
  }

  const rate = rateLimit(request.socket.remoteAddress ?? "unknown");
  if (!rate.allowed) {
    json(response, 429, { error: "rate limit exceeded" }, {
      "Retry-After": String(rate.retryAfterSeconds)
    });
    return;
  }

  try {
    if (request.method === "GET" && request.url === "/health") {
      json(response, 200, { status: "ok" });
      return;
    }

    if (request.method === "GET" && request.url === "/ready") {
      json(response, 200, { status: "ready" });
      return;
    }

    authenticate(request, API_TOKEN);

    if (request.method === "POST" && request.url === "/v1/transactions") {
      const body = await readJson(request);
      const idempotencyKey =
        body.idempotencyKey ?? request.headers["idempotency-key"];

      const transaction = service.submit({
        idempotencyKey,
        from: body.from,
        to: body.to,
        amount: body.amount
      });

      json(response, 201, transaction);
      return;
    }

    const match = request.url?.match(/^\/v1\/transactions\/([^/]+)$/);

    if (request.method === "GET" && match) {
      json(response, 200, service.get(decodeURIComponent(match[1])));
      return;
    }

    json(response, 404, { error: "not found" });
  } catch (error) {
    const statusCode = error.statusCode ?? 400;
    const message = statusCode >= 500 ? "internal server error" : error.message;

    json(response, statusCode, { error: message });
  }
});

server.keepAliveTimeout = 5_000;
server.headersTimeout = 10_000;
server.requestTimeout = 15_000;

server.listen(PORT, () => {
  console.log(JSON.stringify({
    event: "server_started",
    port: PORT,
    environment: process.env.NODE_ENV ?? "development"
  }));
});

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});

process.on("SIGINT", () => {
  server.close(() => process.exit(0));
});

export { server };
