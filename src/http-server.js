import http from "node:http";
import { randomUUID } from "node:crypto";
import { parseEther } from "ethers";
import { MySqlTransactionStore } from "./mysql-store.js";
import { MongoAuditStore } from "./mongo-audit-store.js";
import { EthersBlockchainAdapter } from "./blockchain-adapter.js";
import {
  applySecurityHeaders,
  authenticate,
  createRateLimiter
} from "./security.js";
import { parseTransactionId } from "./path-security.js";
import { toPublicHttpError } from "./http-errors.js";
import {
  requireNonEmptyString,
  validateTransactionHash,
  validateTransactionInput
} from "./validation.js";
import { loadConfig } from "./config.js";

const config = loadConfig();

const rateLimit = createRateLimiter({
  maxRequests: config.rateLimitMax,
  maxClients: config.rateLimitMaxClients
});

const mysqlStore = new MySqlTransactionStore({
  url: config.mysqlUrl,
  maxPoolSize: config.mysqlPoolMax,
  ssl: config.mysqlSsl
});

const mongoStore = new MongoAuditStore({
  url: config.mongoUrl,
  databaseName: config.mongoDatabase,
  maxPoolSize: config.mongoMaxPoolSize
});

const blockchain = config.blockchainEnabled
  ? EthersBlockchainAdapter.fromConfig({
      rpcUrl: config.chainRpcUrl,
      privateKey: config.signerPrivateKey,
      contractAddress: config.anchorContractAddress,
      chainId: config.chainId
    })
  : null;

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
    if (error?.statusCode) throw error;

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

  return mysqlStore.createOrGet({
    id: randomUUID(),
    ...input
  });
}

async function getTransaction(id) {
  return mysqlStore.get(id);
}

async function transitionTransaction(id, nextStatus, patch = {}) {
  return mysqlStore.transition(id, nextStatus, patch);
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
      json(response, requestId, 200, {
        status: "ok",
        blockchain: Boolean(blockchain)
      });
      return;
    }

    if (request.method === "GET" && pathname === "/ready") {
      await mysqlStore.healthCheck();

      if (blockchain) {
        await blockchain.healthCheck(config.chainId);
      }

      json(response, requestId, 200, {
        status: "ready"
      });
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
        { txHash: validateTransactionHash(body.txHash) }
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

    const anchorMatch = pathname.match(
      /^\/v1\/transactions\/([^/]+)\/anchor$/
    );

    if (request.method === "POST" && anchorMatch) {
      if (!blockchain) {
        const error = new Error("blockchain adapter is disabled");
        error.code = "BLOCKCHAIN_DISABLED";
        error.statusCode = 503;
        throw error;
      }

      const transaction = await getTransaction(
        parseTransactionId(anchorMatch[1])
      );

      if (transaction.status !== "CREATED") {
        const error = new Error(
          `transaction cannot be anchored from status ${transaction.status}`
        );
        error.code = "INVALID_TRANSITION";
        error.statusCode = 409;
        throw error;
      }

      const broadcasting = await transitionTransaction(
        transaction.id,
        "BROADCASTING"
      );

      try {
        const result = await blockchain.anchorTransaction({
          transactionId: broadcasting.id,
          sender: broadcasting.from,
          receiver: broadcasting.to,
          amountWei: parseEther(broadcasting.amount)
        });

        const updated = await transitionTransaction(
          broadcasting.id,
          "SUBMITTED",
          { txHash: result.txHash }
        );

        json(response, requestId, 200, {
          transaction: updated,
          blockchain: result
        });
        return;
      } catch (blockchainError) {
        await transitionTransaction(
          broadcasting.id,
          "FAILED",
          {
            failureReason:
              blockchainError instanceof Error
                ? blockchainError.message
                : String(blockchainError)
          }
        );

        throw blockchainError;
      }
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

    const eventsMatch = pathname.match(
      /^\/v1\/transactions\/([^/]+)\/events$/
    );

    if (request.method === "GET" && eventsMatch) {
      const transactionId = parseTransactionId(eventsMatch[1]);
      const events = await mongoStore.listEvents(transactionId);

      json(response, requestId, 200, { events });
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

async function start() {
  await mysqlStore.healthCheck();

  if (blockchain) {
    await blockchain.healthCheck(config.chainId);
  }

  server.listen(config.port, () => {
    console.log(JSON.stringify({
      event: "server_started",
      port: config.port,
      database: "mysql",
      auditStore: "mongodb",
      blockchain: Boolean(blockchain),
      environment: config.nodeEnv
    }));
  });
}

async function shutdown(signal) {
  console.log(JSON.stringify({ event: "shutdown_started", signal }));

  server.close(async () => {
    await Promise.allSettled([
      mysqlStore.close(),
      mongoStore.close()
    ]);

    process.exit(0);
  });
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

await start();

export { server };
