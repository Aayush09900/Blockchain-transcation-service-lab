import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateRetryDelayMs,
  isRetryAllowed
} from "../src/retry-policy.js";
import {
  TransactionService,
  TransactionStatus
} from "../src/transaction-service.js";

test("retry backoff is deterministic and capped", () => {
  assert.equal(calculateRetryDelayMs(1), 1_000);
  assert.equal(calculateRetryDelayMs(2), 2_000);
  assert.equal(calculateRetryDelayMs(3), 4_000);
  assert.equal(calculateRetryDelayMs(6), 30_000);
});

test("retry eligibility requires a retryable failed transaction", () => {
  assert.equal(
    isRetryAllowed({
      status: TransactionStatus.FAILED,
      retryable: true,
      retryCount: 0
    }),
    true
  );

  assert.equal(
    isRetryAllowed({
      status: TransactionStatus.FAILED,
      retryable: false,
      retryCount: 0
    }),
    false
  );

  assert.equal(
    isRetryAllowed({
      status: TransactionStatus.SUBMITTED,
      retryable: true,
      retryCount: 0
    }),
    false
  );
});

test("failed submission can retry without creating a second transaction", () => {
  const service = new TransactionService();
  const created = service.submit({
    idempotencyKey: "retryable-submission",
    from: "0x0000000000000000000000000000000000000001",
    to: "0x0000000000000000000000000000000000000002",
    amount: "0.001"
  });

  service.markFailed(created.id, "temporary RPC outage", { retryable: true });

  const retried = service.retry(created.id);

  assert.equal(retried.transaction.id, created.id);
  assert.equal(retried.transaction.idempotencyKey, created.idempotencyKey);
  assert.equal(retried.transaction.status, TransactionStatus.BROADCASTING);
  assert.equal(retried.transaction.retryCount, 1);
  assert.equal(retried.transaction.txHash, null);
  assert.equal(retried.retryAfterMs, 1_000);

  const duplicate = service.submit({
    idempotencyKey: "retryable-submission",
    from: created.from,
    to: created.to,
    amount: created.amount
  });

  assert.equal(duplicate.id, created.id);
  assert.equal(service.transactions.size, 1);
});

test("non-retryable failures remain terminal", () => {
  const service = new TransactionService();
  const created = service.submit({
    idempotencyKey: "terminal-failure",
    from: "0x0000000000000000000000000000000000000001",
    to: "0x0000000000000000000000000000000000000002",
    amount: "0.001"
  });

  service.markFailed(created.id, "verified on-chain revert");

  assert.throws(
    () => service.retry(created.id),
    /transaction is not eligible for retry/
  );

  assert.equal(service.get(created.id).status, TransactionStatus.FAILED);
});

test("retry limit prevents an unbounded retry loop", () => {
  const service = new TransactionService();
  const created = service.submit({
    idempotencyKey: "retry-limit",
    from: "0x0000000000000000000000000000000000000001",
    to: "0x0000000000000000000000000000000000000002",
    amount: "0.001"
  });

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    service.markFailed(created.id, `temporary failure ${attempt}`, {
      retryable: true
    });
    const result = service.retry(created.id);
    assert.equal(result.retryAfterMs, 1_000 * (2 ** (attempt - 1)));

    if (attempt < 3) {
      service.markFailed(created.id, "temporary failure", {
        retryable: true
      });
    }
  }

  service.markFailed(created.id, "temporary failure", { retryable: true });

  assert.throws(
    () => service.retry(created.id),
    /transaction is not eligible for retry/
  );
});

test("creates a transaction with CREATED state", () => {
  const service = new TransactionService();
  const tx = service.submit({
    idempotencyKey: "k1",
    from: "0x0000000000000000000000000000000000000001",
    to: "0x0000000000000000000000000000000000000002",
    amount: "100"
  });

  assert.equal(tx.status, TransactionStatus.CREATED);
  assert.equal(tx.txHash, null);
});

test("returns the same transaction for duplicate idempotency keys", () => {
  const service = new TransactionService();

  const first = service.submit({
    idempotencyKey: "same",
    from: "0x0000000000000000000000000000000000000001",
    to: "0x0000000000000000000000000000000000000002",
    amount: "100"
  });

  const duplicate = service.submit({
    idempotencyKey: "same",
    from: "0x0000000000000000000000000000000000000001",
    to: "0x0000000000000000000000000000000000000002",
    amount: "100"
  });

  assert.equal(duplicate.id, first.id);
});

test("moves CREATED to BROADCASTING before blockchain submission", () => {
  const service = new TransactionService();
  const tx = service.submit({
    idempotencyKey: "broadcasting",
    from: "0x0000000000000000000000000000000000000001",
    to: "0x0000000000000000000000000000000000000002",
    amount: "0.001"
  });

  const broadcasting = service.markBroadcasting(tx.id);

  assert.equal(broadcasting.status, TransactionStatus.BROADCASTING);
});

test("moves CREATED to SUBMITTED with tx hash", () => {
  const service = new TransactionService();
  const tx = service.submit({
    idempotencyKey: "k2",
    from: "0x0000000000000000000000000000000000000001",
    to: "0x0000000000000000000000000000000000000002",
    amount: "100"
  });

  const submitted = service.markSubmitted(tx.id, "0x1111111111111111111111111111111111111111111111111111111111111111");
  assert.equal(submitted.status, TransactionStatus.SUBMITTED);
  assert.equal(submitted.txHash, "0x1111111111111111111111111111111111111111111111111111111111111111");
});

test("moves SUBMITTED to CONFIRMED", () => {
  const service = new TransactionService();
  const tx = service.submit({
    idempotencyKey: "k3",
    from: "0x0000000000000000000000000000000000000001",
    to: "0x0000000000000000000000000000000000000002",
    amount: "100"
  });

  service.markSubmitted(tx.id, "0x1111111111111111111111111111111111111111111111111111111111111111");
  const confirmed = service.markConfirmed(tx.id);

  assert.equal(confirmed.status, TransactionStatus.CONFIRMED);
});

test("does not allow a confirmed transaction to become failed", () => {
  const service = new TransactionService();
  const tx = service.submit({
    idempotencyKey: "k4",
    from: "0x0000000000000000000000000000000000000001",
    to: "0x0000000000000000000000000000000000000002",
    amount: "100"
  });

  service.markSubmitted(tx.id, "0x1111111111111111111111111111111111111111111111111111111111111111");
  service.markConfirmed(tx.id);

  assert.throws(
    () => service.markFailed(tx.id),
    /invalid transition/
  );
});

test("allows a broadcast failure from SUBMITTED", () => {
  const service = new TransactionService();
  const tx = service.submit({
    idempotencyKey: "k5",
    from: "0x0000000000000000000000000000000000000001",
    to: "0x0000000000000000000000000000000000000002",
    amount: "100"
  });

  service.markSubmitted(tx.id, "0x1111111111111111111111111111111111111111111111111111111111111111");
  const failed = service.markFailed(tx.id, "RPC timeout");

  assert.equal(failed.status, TransactionStatus.FAILED);
  assert.equal(failed.failureReason, "RPC timeout");
});

test("rejects invalid amounts and missing idempotency keys", () => {
  const service = new TransactionService();

  assert.throws(
    () => service.submit({ from: "0x0000000000000000000000000000000000000001", to: "0x0000000000000000000000000000000000000002", amount: "100" }),
    /idempotencyKey is required/
  );

  assert.throws(
    () => service.submit({
      idempotencyKey: "k6",
      from: "0x0000000000000000000000000000000000000001",
      to: "0x0000000000000000000000000000000000000002",
      amount: "0"
    }),
    /amount must be positive/
  );
});

test("rejects reusing an idempotency key for a different request", () => {
  const service = new TransactionService();

  service.submit({
    idempotencyKey: "conflict",
    from: "0x0000000000000000000000000000000000000001",
    to: "0x0000000000000000000000000000000000000002",
    amount: "100"
  });

  assert.throws(
    () => service.submit({
      idempotencyKey: "conflict",
      from: "0x0000000000000000000000000000000000000001",
      to: "0x0000000000000000000000000000000000000003",
      amount: "100"
    }),
    /idempotency key was already used with a different request/
  );
});

test("preserves exact decimal amount without Number conversion", () => {
  const service = new TransactionService();
  const amount = "12345678901234567890.123456789";

  const tx = service.submit({
    idempotencyKey: "precision",
    from: "0x0000000000000000000000000000000000000001",
    to: "0x0000000000000000000000000000000000000002",
    amount
  });

  assert.equal(tx.amount, amount);
});

test("rejects malformed blockchain transaction hashes", () => {
  const service = new TransactionService();
  const tx = service.submit({
    idempotencyKey: "hash-validation",
    from: "0x0000000000000000000000000000000000000001",
    to: "0x0000000000000000000000000000000000000002",
    amount: "0.001"
  });

  assert.throws(
    () => service.markSubmitted(tx.id, "0xhash"),
    /valid 32-byte transaction hash/
  );
});

test("rejects malformed decimal amounts", () => {
  const service = new TransactionService();

  assert.throws(
    () => service.submit({
      idempotencyKey: "bad-amount",
      from: "0x0000000000000000000000000000000000000001",
      to: "0x0000000000000000000000000000000000000002",
      amount: "1e18"
    }),
    /amount must be a positive decimal string/
  );
});

test("rejects numeric amounts to avoid floating-point precision loss", () => {
  const service = new TransactionService();

  assert.throws(
    () => service.submit({
      idempotencyKey: "numeric-amount",
      from: "0x0000000000000000000000000000000000000001",
      to: "0x0000000000000000000000000000000000000002",
      amount: 1.5
    }),
    /amount is required/
  );
});
