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
    from: "0x1",
    to: "0x2",
    amount: "100"
  });

  assert.equal(tx.status, TransactionStatus.CREATED);
  assert.equal(tx.txHash, null);
});

test("returns the same transaction for duplicate idempotency keys", () => {
  const service = new TransactionService();

  const first = service.submit({
    idempotencyKey: "same",
    from: "0x1",
    to: "0x2",
    amount: "100"
  });

  const duplicate = service.submit({
    idempotencyKey: "same",
    from: "0x1",
    to: "0x2",
    amount: "100"
  });

  assert.equal(duplicate.id, first.id);
});

test("moves CREATED to SUBMITTED with tx hash", () => {
  const service = new TransactionService();
  const tx = service.submit({
    idempotencyKey: "k2",
    from: "0x1",
    to: "0x2",
    amount: "100"
  });

  const submitted = service.markSubmitted(tx.id, "0xhash");
  assert.equal(submitted.status, TransactionStatus.SUBMITTED);
  assert.equal(submitted.txHash, "0xhash");
});

test("moves SUBMITTED to CONFIRMED", () => {
  const service = new TransactionService();
  const tx = service.submit({
    idempotencyKey: "k3",
    from: "0x1",
    to: "0x2",
    amount: "100"
  });

  service.markSubmitted(tx.id, "0xhash");
  const confirmed = service.markConfirmed(tx.id);

  assert.equal(confirmed.status, TransactionStatus.CONFIRMED);
});

test("does not allow a confirmed transaction to become failed", () => {
  const service = new TransactionService();
  const tx = service.submit({
    idempotencyKey: "k4",
    from: "0x1",
    to: "0x2",
    amount: "100"
  });

  service.markSubmitted(tx.id, "0xhash");
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
    from: "0x1",
    to: "0x2",
    amount: "100"
  });

  service.markSubmitted(tx.id, "0xhash");
  const failed = service.markFailed(tx.id, "RPC timeout");

  assert.equal(failed.status, TransactionStatus.FAILED);
  assert.equal(failed.failureReason, "RPC timeout");
});

test("rejects invalid amounts and missing idempotency keys", () => {
  const service = new TransactionService();

  assert.throws(
    () => service.submit({ from: "0x1", to: "0x2", amount: "100" }),
    /idempotencyKey is required/
  );

  assert.throws(
    () => service.submit({
      idempotencyKey: "k6",
      from: "0x1",
      to: "0x2",
      amount: "0"
    }),
    /amount must be positive/
  );
});


test("rejects reusing an idempotency key for a different request", () => {
  const service = new TransactionService();

  service.submit({
    idempotencyKey: "conflict",
    from: "0x1",
    to: "0x2",
    amount: "100"
  });

  assert.throws(
    () => service.submit({
      idempotencyKey: "conflict",
      from: "0x1",
      to: "0x3",
      amount: "100"
    }),
    /idempotency key was already used with a different request/
  );
});

test("preserves exact decimal amount without Number conversion", () => {
  const service = new TransactionService();
  const amount = "123456789012345678901234567890.123456789";

  const tx = service.submit({
    idempotencyKey: "precision",
    from: "0x1",
    to: "0x2",
    amount
  });

  assert.equal(tx.amount, amount);
});

test("rejects malformed decimal amounts", () => {
  const service = new TransactionService();

  assert.throws(
    () => service.submit({
      idempotencyKey: "bad-amount",
      from: "0x1",
      to: "0x2",
      amount: "1e18"
    }),
    /amount must be a positive decimal string/
  );
});
