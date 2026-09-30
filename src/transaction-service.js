import { randomUUID } from "node:crypto";
import {
  requireNonEmptyString,
  validateTransactionHash,
  validateTransactionInput
} from "./validation.js";
import {
  calculateRetryDelayMs,
  isRetryAllowed,
  RETRY_POLICY
} from "./retry-policy.js";

export const TransactionStatus = Object.freeze({
  CREATED: "CREATED",
  BROADCASTING: "BROADCASTING",
  SUBMITTED: "SUBMITTED",
  CONFIRMED: "CONFIRMED",
  REORGED: "REORGED",
  FAILED: "FAILED"
});

const transitions = {
  CREATED: new Set(["BROADCASTING", "FAILED", "SUBMITTED"]),
  BROADCASTING: new Set(["SUBMITTED", "FAILED"]),
  SUBMITTED: new Set(["CONFIRMED", "FAILED"]),
  CONFIRMED: new Set(["REORGED"]),
  REORGED: new Set(["SUBMITTED", "CONFIRMED"]),
  FAILED: new Set(["BROADCASTING"])
};

export class TransactionService {
  constructor() {
    this.transactions = new Map();
    this.idempotency = new Map();
  }

  submit(input) {
    const { idempotencyKey, from, to, amount } = validateTransactionInput(input);
    const existingId = this.idempotency.get(idempotencyKey);

    if (existingId) {
      const existing = this.get(existingId);
      const sameRequest =
        existing.from === from &&
        existing.to === to &&
        existing.amount === amount;

      if (!sameRequest) {
        const error = new Error(
          "idempotency key was already used with a different request"
        );
        error.code = "IDEMPOTENCY_CONFLICT";
        error.statusCode = 409;
        throw error;
      }

      return existing;
    }

    const now = new Date().toISOString();
    const id = randomUUID();

    const tx = {
      id,
      idempotencyKey,
      from,
      to,
      amount,
      status: TransactionStatus.CREATED,
      txHash: null,
      failureReason: null,
      retryable: false,
      retryCount: 0,
      attempts: 0,
      createdAt: now,
      updatedAt: now
    };

    this.transactions.set(id, tx);
    this.idempotency.set(idempotencyKey, id);

    return this.get(id);
  }

  markBroadcasting(id) {
    return this.transition(id, TransactionStatus.BROADCASTING);
  }

  markSubmitted(id, txHash) {
    return this.transition(id, TransactionStatus.SUBMITTED, {
      txHash: validateTransactionHash(txHash),
      attempts: (this.transactions.get(id)?.attempts ?? 0) + 1
    });
  }

  markConfirmed(id) {
    return this.transition(id, TransactionStatus.CONFIRMED, {
      failureReason: null,
      retryable: false
    });
  }

  markFailed(id, reason = "transaction failed", { retryable = false } = {}) {
    return this.transition(id, TransactionStatus.FAILED, {
      failureReason: requireNonEmptyString(reason, "failureReason", 500),
      retryable: Boolean(retryable)
    });
  }

  retry(id) {
    const current = this.get(id);

    if (current.status !== TransactionStatus.FAILED) {
      const error = new Error(
        `retry requires a FAILED transaction; current state is ${current.status}`
      );
      error.code = "RETRY_NOT_ALLOWED";
      error.statusCode = 409;
      throw error;
    }

    if (!isRetryAllowed(current, RETRY_POLICY)) {
      const error = new Error("transaction is not eligible for retry");
      error.code = "RETRY_NOT_ALLOWED";
      error.statusCode = 409;
      throw error;
    }

    const retryCount = current.retryCount + 1;
    const retryAfterMs = calculateRetryDelayMs(retryCount, RETRY_POLICY);

    const transaction = this.transition(
      id,
      TransactionStatus.BROADCASTING,
      {
        txHash: null,
        failureReason: null,
        retryable: false,
        retryCount
      }
    );

    return {
      transaction,
      retryAfterMs
    };
  }

  get(id) {
    const tx = this.transactions.get(id);

    if (!tx) {
      const error = new Error("transaction not found");
      error.code = "NOT_FOUND";
      error.statusCode = 404;
      throw error;
    }

    return structuredClone(tx);
  }

  transition(id, nextStatus, patch = {}) {
    const current = this.transactions.get(id);

    if (!current) {
      const error = new Error("transaction not found");
      error.code = "NOT_FOUND";
      error.statusCode = 404;
      throw error;
    }

    if (current.status === nextStatus) {
      return this.get(id);
    }

    if (!transitions[current.status]?.has(nextStatus)) {
      const error = new Error(
        `invalid transition: ${current.status} -> ${nextStatus}`
      );
      error.code = "INVALID_TRANSITION";
      error.statusCode = 409;
      throw error;
    }

    const updated = {
      ...current,
      ...patch,
      status: nextStatus,
      updatedAt: new Date().toISOString()
    };

    this.transactions.set(id, updated);
    return this.get(id);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const service = new TransactionService();

  console.log(
    JSON.stringify(
      service.submit({
        idempotencyKey: "demo-1",
        from: "0x0000000000000000000000000000000000000001",
        to: "0x0000000000000000000000000000000000000002",
        amount: "0.001"
      }),
      null,
      2
    )
  );
}
