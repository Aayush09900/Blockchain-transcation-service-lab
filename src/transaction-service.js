import { randomUUID } from "node:crypto";
import {
  requireNonEmptyString,
  validateTransactionInput
} from "./validation.js";

export const TransactionStatus = Object.freeze({
  CREATED: "CREATED",
  SUBMITTED: "SUBMITTED",
  CONFIRMED: "CONFIRMED",
  FAILED: "FAILED"
});

const transitions = {
  CREATED: new Set(["SUBMITTED", "FAILED"]),
  SUBMITTED: new Set(["CONFIRMED", "FAILED"]),
  CONFIRMED: new Set([]),
  FAILED: new Set([])
};

export class TransactionService {
  constructor() {
    this.transactions = new Map();
    this.idempotency = new Map();
  }

  submit(input) {
    const {
      idempotencyKey,
      from,
      to,
      amount
    } = validateTransactionInput(input);

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
      attempts: 0,
      createdAt: now,
      updatedAt: now
    };

    this.transactions.set(id, tx);
    this.idempotency.set(idempotencyKey, id);

    return this.get(id);
  }

  markSubmitted(id, txHash) {
    const hash = requireNonEmptyString(txHash, "txHash", 256);
    return this.transition(id, TransactionStatus.SUBMITTED, {
      txHash: hash,
      attempts: (this.transactions.get(id)?.attempts ?? 0) + 1
    });
  }

  markConfirmed(id) {
    return this.transition(id, TransactionStatus.CONFIRMED, {
      failureReason: null
    });
  }

  markFailed(id, reason = "transaction failed") {
    const failureReason = requireNonEmptyString(reason, "failureReason", 500);

    return this.transition(id, TransactionStatus.FAILED, {
      failureReason
    });
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

    const allowed = transitions[current.status];

    if (!allowed?.has(nextStatus)) {
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

  const tx = service.submit({
    idempotencyKey: "demo-1",
    from: "0xsender",
    to: "0xreceiver",
    amount: "1000000000000000"
  });

  console.log(JSON.stringify(tx, null, 2));
}
