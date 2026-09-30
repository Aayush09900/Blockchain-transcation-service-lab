import test from "node:test";
import assert from "node:assert/strict";
import {
  createRateLimiter,
  authenticate,
  applySecurityHeaders
} from "../src/security.js";
import {
  parseTransactionId,
  validateTransactionId
} from "../src/path-security.js";
import { toPublicHttpError } from "../src/http-errors.js";
import { sanitizeLogValue } from "../src/logging.js";

test("path traversal payloads are rejected as transaction IDs", () => {
  assert.throws(
    () => parseTransactionId("..%2F..%2Fetc%2Fpasswd"),
    /invalid transaction id/
  );

  assert.throws(
    () => parseTransactionId("%2e%2e%2fsecrets"),
    /invalid transaction id/
  );
});

test("encoded separators and control characters cannot bypass ID validation", () => {
  assert.throws(
    () => parseTransactionId("../../../secret"),
    /invalid transaction id/
  );

  assert.throws(
    () => parseTransactionId("%00secret"),
    /invalid transaction id/
  );

  assert.throws(
    () => parseTransactionId("%E0%A4%A"),
    /invalid transaction id/
  );
});

test("only UUID transaction IDs are accepted", () => {
  assert.doesNotThrow(() =>
    validateTransactionId("550e8400-e29b-41d4-a716-446655440000")
  );

  assert.throws(
    () => validateTransactionId("admin"),
    /invalid transaction id/
  );
});

test("rate limiter remains bounded under unique-client pressure", () => {
  const limiter = createRateLimiter({
    windowMs: 60_000,
    maxRequests: 10,
    maxClients: 3
  });

  limiter("client-a");
  limiter("client-b");
  limiter("client-c");
  limiter("client-d");

  assert.equal(limiter.size(), 3);
});

test("authentication fails closed and rejects malformed bearer headers", () => {
  const request = { headers: { authorization: "Bearer correct-token" } };

  assert.doesNotThrow(() => authenticate(request, "correct-token"));

  assert.throws(
    () => authenticate(request, "wrong-token"),
    /unauthorized/
  );

  assert.throws(
    () => authenticate(
      { headers: { authorization: "Bearer correct-token extra" } },
      "correct-token"
    ),
    /unauthorized/
  );

  assert.throws(
    () => authenticate({ headers: {} }, "correct-token"),
    /unauthorized/
  );
});

test("security headers are applied", () => {
  const headers = new Map();
  const response = {
    setHeader(name, value) {
      headers.set(name, value);
    }
  };

  applySecurityHeaders(response);

  assert.equal(headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(headers.get("X-Frame-Options"), "DENY");
  assert.equal(headers.get("Cache-Control"), "no-store");
});

test("unexpected internal errors are not returned to clients", () => {
  const result = toPublicHttpError(
    new Error("password=super-secret database connection failed")
  );

  assert.equal(result.statusCode, 500);
  assert.equal(result.message, "internal server error");
  assert.equal(result.message.includes("super-secret"), false);
});

test("invalid transaction paths remain client errors", () => {
  const error = new Error("invalid transaction id");
  error.code = "INVALID_TRANSACTION_ID";
  error.statusCode = 400;

  const result = toPublicHttpError(error);

  assert.equal(result.statusCode, 400);
  assert.equal(result.message, "invalid transaction id");
});


test("log sanitization removes control characters and common credential material", () => {
  const result = sanitizeLogValue(
    "boom\nBearer super-secret-token mysql://user:password@example.test/db apiKey=abc123"
  );

  assert.equal(result.includes("\n"), false);
  assert.equal(result.includes("super-secret-token"), false);
  assert.equal(result.includes("password@example.test"), false);
  assert.equal(result.includes("abc123"), false);
  assert.equal(result.includes("REDACTED"), true);
});
