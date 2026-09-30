import test from "node:test";
import assert from "node:assert/strict";
import { BlockchainSubmissionService } from "../src/blockchain-submission-service.js";

const TX_HASH =
  "0x1111111111111111111111111111111111111111111111111111111111111111";

function createStore(status = "CREATED") {
  const transaction = {
    id: "550e8400-e29b-41d4-a716-446655440000",
    idempotencyKey: "test",
    from: "0x0000000000000000000000000000000000000001",
    to: "0x0000000000000000000000000000000000000002",
    amount: "0.001",
    status,
    txHash: status === "SUBMITTED" ? TX_HASH : null,
    failureReason: null,
    attempts: status === "SUBMITTED" ? 1 : 0
  };

  return {
    transaction,
    async get() {
      return structuredClone(this.transaction);
    },
    async transition(id, nextStatus, patch = {}) {
      const current = this.transaction;

      if (current.id !== id) {
        throw new Error("transaction not found");
      }

      if (current.status === nextStatus) {
        if (
          nextStatus === "SUBMITTED" &&
          patch.txHash &&
          current.txHash &&
          current.txHash !== patch.txHash
        ) {
          const error = new Error("transaction hash mismatch");
          error.code = "TX_HASH_MISMATCH";
          error.statusCode = 409;
          throw error;
        }

        return structuredClone(current);
      }

      const allowed = {
        CREATED: ["BROADCASTING", "FAILED"],
        BROADCASTING: ["SUBMITTED", "FAILED"],
        SUBMITTED: ["CONFIRMED", "FAILED"],
        CONFIRMED: [],
        FAILED: []
      };

      if (!allowed[current.status].includes(nextStatus)) {
        const error = new Error(
          `invalid transition: ${current.status} -> ${nextStatus}`
        );
        error.code = "INVALID_TRANSITION";
        error.statusCode = 409;
        throw error;
      }

      this.transaction = {
        ...current,
        ...patch,
        status: nextStatus,
        attempts:
          nextStatus === "SUBMITTED"
            ? current.attempts + 1
            : current.attempts
      };

      return structuredClone(this.transaction);
    }
  };
}

function baseAdapter(overrides = {}) {
  return {
    async broadcastAnchorTransaction() {
      return {
        txHash: TX_HASH,
        transactionId: "550e8400-e29b-41d4-a716-446655440000",
        chainId: "31337"
      };
    },
    async verifySubmittedTransaction() {
      return {
        confirmed: true,
        receipt: { hash: TX_HASH, status: 1, blockNumber: 10 }
      };
    },
    ...overrides
  };
}

test("service-controlled submit broadcasts and persists the returned hash", async () => {
  const store = createStore();
  let broadcasts = 0;
  const blockchain = baseAdapter({
    async broadcastAnchorTransaction() {
      broadcasts += 1;
      return baseAdapter().broadcastAnchorTransaction();
    }
  });

  const service = new BlockchainSubmissionService({ store, blockchain });
  const result = await service.submit(store.transaction.id);

  assert.equal(result.outcome, "SUBMITTED");
  assert.equal(result.transaction.status, "SUBMITTED");
  assert.equal(result.transaction.txHash, TX_HASH);
  assert.equal(broadcasts, 1);
});

test("repeated submit while BROADCASTING does not broadcast twice", async () => {
  const store = createStore();
  let broadcasts = 0;
  const blockchain = baseAdapter({
    async broadcastAnchorTransaction() {
      broadcasts += 1;
      const error = new Error("rpc timeout after send");
      error.code = "TIMEOUT";
      throw error;
    }
  });

  const service = new BlockchainSubmissionService({ store, blockchain });

  const first = await service.submit(store.transaction.id);
  const second = await service.submit(store.transaction.id);

  assert.equal(first.outcome, "BROADCASTING");
  assert.equal(second.outcome, "BROADCASTING");
  assert.equal(second.reconciliationRequired, true);
  assert.equal(broadcasts, 1);
});

test("deterministic broadcast rejection is persisted as FAILED", async () => {
  const store = createStore();
  const blockchain = baseAdapter({
    async broadcastAnchorTransaction() {
      const error = new Error("insufficient funds");
      error.code = "INSUFFICIENT_FUNDS";
      throw error;
    }
  });

  const service = new BlockchainSubmissionService({ store, blockchain });

  await assert.rejects(
    () => service.submit(store.transaction.id),
    (error) => {
      assert.equal(error.code, "BLOCKCHAIN_BROADCAST_REJECTED");
      assert.equal(error.statusCode, 502);
      assert.equal(error.transaction.status, "FAILED");
      return true;
    }
  );
});

test("reconciliation moves a pending broadcast to SUBMITTED without rebroadcasting", async () => {
  const store = createStore();
  const blockchain = baseAdapter({
    async broadcastAnchorTransaction() {
      throw new Error("must not broadcast during reconciliation");
    },
    async verifySubmittedTransaction() {
      return { confirmed: false, receipt: null };
    }
  });

  await store.transition(store.transaction.id, "BROADCASTING");

  const service = new BlockchainSubmissionService({ store, blockchain });
  const result = await service.reconcile(store.transaction.id, TX_HASH);

  assert.equal(result.outcome, "SUBMITTED");
  assert.equal(result.reconciliationRequired, true);
  assert.equal(result.transaction.status, "SUBMITTED");
  assert.equal(result.transaction.txHash, TX_HASH);
});

test("reconciliation confirms a transaction only after blockchain verification", async () => {
  const store = createStore("SUBMITTED");
  const blockchain = baseAdapter();

  const service = new BlockchainSubmissionService({ store, blockchain });
  const result = await service.reconcile(store.transaction.id, TX_HASH);

  assert.equal(result.outcome, "CONFIRMED");
  assert.equal(result.transaction.status, "CONFIRMED");
});

test("reconciliation rejects a malformed external transaction hash", async () => {
  const store = createStore("SUBMITTED");
  const blockchain = baseAdapter();
  const service = new BlockchainSubmissionService({ store, blockchain });

  await assert.rejects(
    () => service.reconcile(store.transaction.id, "0xbad"),
    /valid 32-byte transaction hash/
  );
});

test("reconciliation preserves terminal FAILED state", async () => {
  const store = createStore("FAILED");
  const blockchain = baseAdapter();
  const service = new BlockchainSubmissionService({ store, blockchain });

  await assert.rejects(
    () => service.reconcile(store.transaction.id, TX_HASH),
    /failed transactions cannot be reconciled/
  );
});
