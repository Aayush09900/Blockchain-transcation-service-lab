import http from "node:http";
import { randomUUID } from "node:crypto";
import { TransactionService } from "./transaction-service.js";
import { PostgresTransactionStore } from "./postgres-store.js";
import {
  applySecurityHeaders,
  authenticate,
  createRateLimiter
} from "./security.js";
import { parseTransactionId } from "./path-security.js";
import { toPublicHttpError } from "./http-errors.js";

const PORT = Number.parseInt(process.env.PORT ?? "3000", 10);
const MAX_BODY_BYTES = 32 * 1024;
const API_TOKEN = process.env.API_TOKEN ?? "";
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? "";
const rateLimit = createRateLimiter({
  maxRequests: Number.parseInt(process.env.RATE_LIMIT_MAX ?? "60", 10),
  maxClients: Number.parseInt(process.env.RATE_LIMIT_MAX_CLIENTS ?? "10000", 10)
});

const memoryService = new TransactionService();
const postgresStore = process.env.DATABASE_URL
  ? new PostgresTransactionStore()
  : null;

const persistenceMode = postgresStore ? "postgres" : "memory";

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
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      const error = new Error("request body must be a JSON object");
      error.statusCode = 400;
      throw error;
    }

    return body;
  } catch (error) {
    if (error.statusCode) {
      throw error;
    }

    const invalidJson = new Error("invalid JSON");
    invalidJson.statusCode = 400;
    throw invalidJson;
  }
}

async function createTransaction(body, request) {
  const idempotencyKey =
    body.idempotencyKey ?? request.headers["idempotency-key"];

  if (!postgresStore) {
    return memoryService.submit({
      idempotencyKey,
      from: body.from,
      to: body.to,
      amount: body.amount
    });
  }

  return postgresStore.createOrGet({
    id: randomUUID(),
    idempotencyKey,
    from: body.from,
    to: body.to,
    amount: String(body.amount ?? "")
  });
}

async function getTransaction(id) {
  return postgresStore ? postgresStore.get(id) : memoryService.get(id);
}

async function transitionTransaction(id, nextStatus, patch = {}) {
  if (postgresStore) {
    return postgresStore.transition(id, nextStatus, patch);
  }

  if (nextStatus === "SUBMITTED") {
    return memoryService.markSubmitted(id, patch.txHash);
  }

  if (nextStatus === "CONFIRMED") {
    return memoryService.markConfirmed(id);
  }

  return memoryService.markFailed(id, patch.failureReason);
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
      "Access-Control-Allow-Headers":
        "Authorization, Content-Type, Idempotency-Key"
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
      if (postgresStore) {
        const healthy = await postgresStore.healthCheck();

        if (!healthy) {
          json(response, 503, { status: "not ready" });
          return;
        }
      }

      json(response, 200, { status: "ready" });
      return;
    }

    authenticate(request, API_TOKEN);

    if (request.method === "POST" && request.url === "/v1/transactions") {
      const body = await readJson(request);
      const transaction = await createTransaction(body, request);

      json(response, 201, transaction);
      return;
    }

    const submitMatch = request.url?.match(
      /^\/v1\/transactions\/([^/]+)\/submit$/
    );

    if (request.method === "POST" && submitMatch) {
      const body = await readJson(request);
      const transaction = await transitionTransaction(
        parseTransactionId(submitMatch[1]),
        "SUBMITTED",
        { txHash: body.txHash }
      );

      json(response, 200, transaction);
      return;
    }

    const confirmMatch = request.url?.match(
      /^\/v1\/transactions\/([^/]+)\/confirm$/
    );

    if (request.method === "POST" && confirmMatch) {
      const transaction = await transitionTransaction(
        parseTransactionId(confirmMatch[1]),
        "CONFIRMED"
      );

      json(response, 200, transaction);
      return;
    }

    const failMatch = request.url?.match(
      /^\/v1\/transactions\/([^/]+)\/fail$/
    );

    if (request.method === "POST" && failMatch) {
      const body = await readJson(request);
      const transaction = await transitionTransaction(
        parseTransactionId(failMatch[1]),
        "FAILED",
        { failureReason: body.reason ?? "transaction failed" }
      );

      json(response, 200, transaction);
      return;
    }

    const match = request.url?.match(/^\/v1\/transactions\/([^/]+)$//);

    if (request.method === "GET" && match) {
      json(
        response,
        200,
        await getTransaction(parseTransactionId(match[1]))
      );
      return;
    }

    json(response, 404, { error: "not found" });
  } catch (error) {
    const publicError = toPublicHttpError(error);

    if (publicError.statusCode >= 500) {
      console.error(JSON.stringify({
        event: "request_error",
        name: error?.name ?? "Error",
        code: error?.code ?? "INTERNAL"
      }));
    }

    json(response, publicError.statusCode, { error: publicError.message });
  }
});

server.keepAliveTimeout = 5_000;
server.headersTimeout = 10_000;
server.requestTimeout = 15_000;

server.listen(PORT, () => {
  console.log(JSON.stringify({
    event: "server_started",
    port: PORT,
    persistence: persistenceMode,
    environment: process.env.NODE_ENV ?? "development"
  }));
});

async function shutdown(signal) {
  console.log(JSON.stringify({ event: "shutdown_started", signal }));

  server.close(async () => {
    if (postgresStore) {
      await postgresStore.close();
    }

    process.exit(0);
  });
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

export { server };
