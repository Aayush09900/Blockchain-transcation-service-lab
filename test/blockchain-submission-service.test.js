import test from "node:test";
import assert from "node:assert/strict";
import { submitViaBlockchain } from "../src/blockchain-submission-service.js";

const TX_HASH =
  "0x1111111111111111111111111111111111111111111111111111111111111111";

const BASE_TRANSACTION = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  from: "0x0000000000000000000000000000000000000001",
  to: "0x0000000000000000000000000000000000000002",
  amount: "0.001",
  status: "CREATED"
};

function createTransitionRecorder({
  initial = BASE_TRANSACTION,
  failOnSubmitted = null
} = {}) {
  let current = { ...initial };
  const calls = [];

  return {
    calls,
    get current() {
      return current;
    },
    transition: async (id, nextStatus, patch = {}) => {
      calls.push({ id, nextStatus, patch });

      if (failOnSubmitted && nextStatus === "SUBMITTED") {
        throw failOnSubmitted;
      }

      current = {
        ...current,
        status: nextStatus,
        ...patch
      };

      return current;
    }
  };
}

test("service-controlled submit broadcasts once and persists the returned hash", async () => {
  const recorder = createTransitionRecorder();
  let broadcastCalls = 0;

  const blockchain = {
    async broadcastAnchorTransaction(input) {
      broadcastCalls += 1;
      assert.equal(input.transactionId, BASE_TRANSACTION.id);
      assert.equal(input.sender, BASE_TRANSACTION.from);
      assert.equal(input.receiver, BASE_TRANSACTION.to);
      assert.equal(input.amountWei, 1000000000000000n);

      return {
        txHash: TX_HASH,
        transactionId: BASE_TRANSACTION.id,
        chainId: "31337"
      };
    }
  };

  const result = await submitViaBlockchain({
    transaction: BASE_TRANSACTION,
    blockchain,
    transitionTransaction: recorder.transition
  });

  assert.equal(broadcastCalls, 1);
  assert.deepEqual(
    recorder.calls.map((call) => call.nextStatus),
    ["BROADCASTING", "SUBMITTED"]
  );
  assert.equal(result.transaction.status, "SUBMITTED");
  assert.equal(result.transaction.txHash, TX_HASH);
  assert.equal(result.reused, false);
});

test("service submission executes blockchain work inside the distributed signer lock", async () => {
  const recorder = createTransitionRecorder();
  const calls = [];

  const result = await submitViaBlockchain({
    transaction: BASE_TRANSACTION,
    blockchain: {
      async broadcastAnchorTransaction() {
        calls.push("broadcast");
        return {
          txHash: TX_HASH,
          transactionId: BASE_TRANSACTION.id,
          chainId: "31337"
        };
      }
    },
    transitionTransaction: recorder.transition,
    withSubmissionLock: async (operation) => {
      calls.push("lock-acquired");
      const value = await operation();
      calls.push("lock-released");
      return value;
    }
  });

  assert.equal(result.transaction.status, "SUBMITTED");
  assert.deepEqual(calls, [
    "lock-acquired",
    "broadcast",
    "lock-released"
  ]);
});

test("repeated submit is idempotent after execution has started", async () => {
  const transaction = {
    ...BASE_TRANSACTION,
    status: "SUBMITTED",
    txHash: TX_HASH
  };
  const recorder = createTransitionRecorder({ initial: transaction });

  let broadcastCalls = 0;

  const blockchain = {
    async broadcastAnchorTransaction() {
      broadcastCalls += 1;
      throw new Error("must not broadcast twice");
    }
  };

  const result = await submitViaBlockchain({
    transaction,
    blockchain,
    transitionTransaction: recorder.transition
  });

  assert.equal(broadcastCalls, 0);
  assert.equal(recorder.calls.length, 0);
  assert.equal(result.reused, true);
  assert.equal(result.transaction.status, "SUBMITTED");
});

test("broadcast RPC ambiguity leaves the transaction in BROADCASTING", async () => {
  const recorder = createTransitionRecorder();
  const cause = new Error("RPC timeout after request submission");

  await assert.rejects(
    submitViaBlockchain({
      transaction: BASE_TRANSACTION,
      blockchain: {
        async broadcastAnchorTransaction() {
          throw cause;
        }
      },
      transitionTransaction: recorder.transition
    }),
    (error) => {
      assert.equal(error.code, "BLOCKCHAIN_BROADCAST_UNKNOWN");
      assert.equal(error.statusCode, 503);
      assert.equal(error.cause, cause);
      return true;
    }
  );

  assert.deepEqual(
    recorder.calls.map((call) => call.nextStatus),
    ["BROADCASTING"]
  );
  assert.equal(recorder.current.status, "BROADCASTING");
});

test("database failure after on-chain broadcast is treated as an unknown outcome", async () => {
  const persistenceError = new Error("temporary database outage");
  const recorder = createTransitionRecorder({
    failOnSubmitted: persistenceError
  });

  await assert.rejects(
    submitViaBlockchain({
      transaction: BASE_TRANSACTION,
      blockchain: {
        async broadcastAnchorTransaction() {
          return {
            txHash: TX_HASH,
            transactionId: BASE_TRANSACTION.id,
            chainId: "31337"
          };
        }
      },
      transitionTransaction: recorder.transition
    }),
    (error) => {
      assert.equal(error.code, "BLOCKCHAIN_BROADCAST_UNKNOWN");
      assert.equal(error.cause, persistenceError);
      return true;
    }
  );

  assert.deepEqual(
    recorder.calls.map((call) => call.nextStatus),
    ["BROADCASTING", "SUBMITTED"]
  );
});

test("claim transition errors are not misclassified as blockchain ambiguity", async () => {
  const transitionError = new Error("transaction was already claimed");
  const recorder = {
    calls: [],
    transition: async (id, nextStatus) => {
      recorder.calls.push({ id, nextStatus });
      throw transitionError;
    }
  };

  await assert.rejects(
    submitViaBlockchain({
      transaction: BASE_TRANSACTION,
      blockchain: {
        async broadcastAnchorTransaction() {
          throw new Error("must not broadcast after claim failure");
        }
      },
      transitionTransaction: recorder.transition
    }),
    (error) => error === transitionError
  );

  assert.deepEqual(
    recorder.calls.map((call) => call.nextStatus),
    ["BROADCASTING"]
  );
});

test("blockchain execution is fail-closed when the adapter is disabled", async () => {
  const recorder = createTransitionRecorder();

  await assert.rejects(
    submitViaBlockchain({
      transaction: BASE_TRANSACTION,
      blockchain: null,
      transitionTransaction: recorder.transition
    }),
    (error) => {
      assert.equal(error.code, "BLOCKCHAIN_DISABLED");
      assert.equal(error.statusCode, 503);
      return true;
    }
  );

  assert.equal(recorder.calls.length, 0);
});

test("confirmed and failed transactions cannot be resubmitted", async () => {
  for (const status of ["CONFIRMED", "FAILED"]) {
    const transaction = {
      ...BASE_TRANSACTION,
      status,
      txHash: status === "CONFIRMED" ? TX_HASH : null
    };
    const recorder = createTransitionRecorder({ initial: transaction });

    const result = await submitViaBlockchain({
      transaction,
      blockchain: {
        async broadcastAnchorTransaction() {
          throw new Error("must not broadcast terminal state");
        }
      },
      transitionTransaction: recorder.transition
    });

    assert.equal(result.reused, true);
    assert.equal(result.transaction.status, status);
    assert.equal(recorder.calls.length, 0);
  }
});
