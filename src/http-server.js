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
import { validateTransactionInput, requireNonEmptyString } from "./validation.js";
import { loadConfig } from "./config.js";

const config = loadConfig();

const rateLimit = createRateLimiter({
  maxRequests: config.rateLimitMax,
  maxClients: config.rateLimitMaxClients
});

const memoryService = new TransactionService();
const postgresStore = config.databaseUrl
  ? new PostgresTransactionStore({
      connectionString: config.databaseUrl,
      maxPoolSize: config.dbPoolMax,
      ssl: config.dbSsl
    })
  : null;

const persistenceMode = postgresStore ? "postgres" : "memory";

function json(response, requestId, statusCode, body, extraHeaders = {}) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "X-Request-ID": requestId,
    ...extraHeaders
  });
  response.end(JSON.stringify(body));
}

function clientKey(request) {
  return request.socket.remoteAddress ?? "unknown";
}

function assertJsonRequest(request) {
  const contentType = request.headers["content-type"] ?? "";

  if (!contentType.toLowerCase().startsWith("application/json")) {
    const error = new Error("content-type must be application/json");
    error.statusCode = 415;
    throw error;
  }
}

async function readJson(request) {
  let size = 0;
  const chunks = [];

  for await (const chunk of request) {
    size += chunk.length;

    if (size > 32 * 1024) {
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
    if (error?.statusCode) {
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

  const input = validateTransactionInput({
    idempotencyKey,
    from: body.from,
    to: body.to,
    amount: body.amount
  });

  if (!postgresStore) {
    return memoryService.submit(input);
  }

  return postgresStore.createOrGet({
    id: randomUUID(),
    ...input
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
  const incomingRequestId =
    request.headers["x-request-id"]?.toString() || randomUUID();

  if (incomingRequestId.length > 128) {
    response.writeHead(400, {
      "Content-Type": "application/json; charset=utf-8"
    });
    response.end(JSON.stringify({ error: "invalid request id" }));
    return;
  }

  const requestId = incomingRequestId;
  const origin = request.headers.origin ?? "";

  applySecurityHeaders(
    response,
    config.corsOrigin && origin === config.corsOrigin
      ? config.corsOrigin
      : ""
  );

  response.setHeader("X-Request-ID", requestId);

  if (request.method === "OPTIONS") {
    if (!config.corsOrigin) {
      response.writeHead(204, {
        "X-Request-ID": requestId
      });
      response.end();
      return;
    }

    if (origin !== config.corsOrigin) {
      json(response, requestId, 403, { error: "origin not allowed" });
      return;
    }

    response.writeHead(204, {
      "X-Request-ID": requestId,
      "Access-Control-Allow-Origin": config.corsOrigin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers":
        "Authorization, Content-Type, Idempotency-Key, X-Request-ID",
      "Access-Control-Max-Age": "600",
      "Vary": "Origin"
    });
    response.end();
    return;
  }

  const rate = rateLimit(clientKey(request));

  if (!rate.allowed) {
    json(response, requestId, 429, { error: "rate limit exceeded" }, {
      "Retry-After": String(rate.retryAfterSeconds)
    });
    return;
  }

  try {
    const parsedUrl = new URL(request.url ?? "/", "http://localhost");
    const pathname = parsedUrl.pathname;

    if (request.method === "GET" && pathname === "/health") {
      json(response, requestId, 200, { status: "ok" });
      return;
    }

    if (request.method === "GET" && pathname === "/ready") {
      if (postgresStore) {
        const healthy = await postgresStore.healthCheck();

        if (!healthy) {
          json(response, requestId, 503, { status: "not ready" });
          return;
        }
      }

      json(response, requestId, 200, { status: "ready" });
      return;
    }

    authenticate(request, config.apiToken);

    if (request.method === "POST" && pathname === "/v1/transactions") {
      assertJsonRequest(request);
      const body = await readJson(request);
      const transaction = await createTransaction(body, request);

      json(response, requestId, 201, transaction);
      return;
    }

    const submitMatch = pathname.match(
      /^\/v1\/transactions\/([^/]+)\/submit$/
    );

    if (request.method === "POST" && submitMatch) {
      assertJsonRequest(request);
      const body = await readJson(request);
      const transaction = await transitionTransaction(
        parseTransactionId(submitMatch[1]),
        "SUBMITTED",
        { txHash: body.txHash }
      );

      json(response, requestId, 200, transaction);
      return;
    }

    const confirmMatch = pathname.match(
      /^\/v1\/transactions\/([^/]+)\/confirm$/
    );

    if (request.method === "POST" && confirmMatch) {
      const transaction = await transitionTransaction(
        parseTransactionId(confirmMatch[1]),
        "CONFIRMED"
      );

      json(response, requestId, 200, transaction);
      return;
    }

    const failMatch = pathname.match(
      /^\/v1\/transactions\/([^/]+)\/fail$/
    );

    if (request.method === "POST" && failMatch) {
      assertJsonRequest(request);
      const body = await readJson(request);
      const transaction = await transitionTransaction(
        parseTransactionId(failMatch[1]),
        "FAILED",
        {
          failureReason: body.reason
            ? requireNonEmptyString(body.reason, "reason", 500)
            : "transaction failed"
        }
      );

      json(response, requestId, 200, transaction);
      return;
    }

    const match = pathname.match(/^\/v1\/transactions\/([^/]+)$/);

    if (request.method === "GET" && match) {
      json(
        response,
        requestId,
        200,
        await getTransaction(parseTransactionId(match[1]))
      );
      return;
    }

    json(response, requestId, 404, { error: "not found" });
  } catch (error) {
    const publicError = toPublicHttpError(error);

    if (publicError.statusCode >= 500) {
      console.error(JSON.stringify({
        event: "request_error",
        requestId,
        name: error?.name ?? "Error",
        code: error?.code ?? "INTERNAL"
      }));
    }

    json(response, requestId, publicError.statusCode, {
      error: publicError.message
    });
  }
});

server.keepAliveTimeout = 5_000;
server.headersTimeout = 10_000;
server.requestTimeout = 15_000;

server.listen(config.port, () => {
  console.log(JSON.stringify({
    event: "server_started",
    port: config.port,
    persistence: persistenceMode,
    environment: config.nodeEnv
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
