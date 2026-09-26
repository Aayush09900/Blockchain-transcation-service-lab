import { randomUUID } from "node:crypto";

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

  submit({ idempotencyKey, from, to, amount }) {
    if (!idempotencyKey) throw new Error("idempotencyKey is required");
    if (!from || !to) throw new Error("from and to are required");
    if (!amount || Number(amount) <= 0) throw new Error("amount must be positive");

    const existingId = this.idempotency.get(idempotencyKey);
    if (existingId) return this.get(existingId);

    const id = randomUUID();
    const tx = {
      id,
      idempotencyKey,
      from,
      to,
      amount: String(amount),
      status: TransactionStatus.CREATED,
      txHash: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.transactions.set(id, tx);
    this.idempotency.set(idempotencyKey, id);
    return this.get(id);
  }

  markSubmitted(id, txHash) {
    if (!txHash) throw new Error("txHash is required");
    return this.transition(id, TransactionStatus.SUBMITTED, { txHash });
  }

  markConfirmed(id) {
    return this.transition(id, TransactionStatus.CONFIRMED);
  }

  markFailed(id, reason = "transaction failed") {
    return this.transition(id, TransactionStatus.FAILED, { failureReason: reason });
  }

  get(id) {
    const tx = this.transactions.get(id);
    if (!tx) throw new Error("transaction not found");
    return structuredClone(tx);
  }

  transition(id, nextStatus, patch = {}) {
    const current = this.transactions.get(id);
    if (!current) throw new Error("transaction not found");

    if (current.status === nextStatus) return this.get(id);

    const allowed = transitions[current.status];
    if (!allowed?.has(nextStatus)) {
      throw new Error(`invalid transition: ${current.status} -> ${nextStatus}`);
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
