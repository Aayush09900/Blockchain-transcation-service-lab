import test from "node:test";
import assert from "node:assert/strict";
import {
  TransactionService,
  TransactionStatus
} from "../src/transaction-service.js";

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

  service.markBroadcasting(tx.id);
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

  service.markBroadcasting(tx.id);
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

  service.markBroadcasting(tx.id);
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

  service.markBroadcasting(tx.id);
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
