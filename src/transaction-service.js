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

const MAX_IDEMPOTENCY_KEY_LENGTH = 128;
const MAX_ADDRESS_LENGTH = 128;
const MAX_AMOUNT_LENGTH = 80;

function requireNonEmptyString(value, field, maxLength) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} is required`);
  }

  const normalized = value.trim();

  if (normalized.length > maxLength) {
    throw new Error(`${field} exceeds maximum length`);
  }

  return normalized;
}

function validateAmount(value) {
  const amount = requireNonEmptyString(String(value ?? ""), "amount", MAX_AMOUNT_LENGTH);

  // Keep monetary/chain amounts as decimal strings. Never use Number()
  // for financial values because it can lose precision.
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(amount)) {
    throw new Error("amount must be a positive decimal string");
  }

  if (amount === "0" || /^0(?:\.0+)?$/.test(amount)) {
    throw new Error("amount must be positive");
  }

  return amount;
}

export class TransactionService {
  constructor() {
    this.transactions = new Map();
    this.idempotency = new Map();
  }

  submit({ idempotencyKey, from, to, amount }) {
    const key = requireNonEmptyString(
      idempotencyKey,
      "idempotencyKey",
      MAX_IDEMPOTENCY_KEY_LENGTH
    );
    const sender = requireNonEmptyString(from, "from", MAX_ADDRESS_LENGTH);
    const receiver = requireNonEmptyString(to, "to", MAX_ADDRESS_LENGTH);
    const normalizedAmount = validateAmount(amount);

    const existingId = this.idempotency.get(key);

    if (existingId) {
      const existing = this.get(existingId);
      const sameRequest =
        existing.from === sender &&
        existing.to === receiver &&
        existing.amount === normalizedAmount;

      if (!sameRequest) {
        throw new Error("idempotency key was already used with a different request");
      }

      return existing;
    }

    const now = new Date().toISOString();
    const id = randomUUID();

    const tx = {
      id,
      idempotencyKey: key,
      from: sender,
      to: receiver,
      amount: normalizedAmount,
      status: TransactionStatus.CREATED,
      txHash: null,
      failureReason: null,
      attempts: 0,
      createdAt: now,
      updatedAt: now
    };

    this.transactions.set(id, tx);
    this.idempotency.set(key, id);

    return this.get(id);
  }

  markSubmitted(id, txHash) {
    const hash = requireNonEmptyString(txHash, "txHash", 256);
    return this.transition(id, TransactionStatus.SUBMITTED, {
      txHash,
      attempts: this.transactions.get(id)?.attempts + 1
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
