const MAX_IDEMPOTENCY_KEY_LENGTH = 128;
const MAX_ADDRESS_LENGTH = 128;
const MAX_AMOUNT_LENGTH = 80;

export function requireNonEmptyString(value, field, maxLength) {
  if (typeof value !== "string" || value.trim().length === 0) {
    const error = new Error(`${field} is required`);
    error.code = "VALIDATION_ERROR";
    error.statusCode = 400;
    throw error;
  }

  const normalized = value.trim();

  if (normalized.length > maxLength) {
    const error = new Error(`${field} exceeds maximum length`);
    error.code = "VALIDATION_ERROR";
    error.statusCode = 400;
    throw error;
  }

  return normalized;
}

export function validateAmount(value) {
  const amount = requireNonEmptyString(
    String(value ?? ""),
    "amount",
    MAX_AMOUNT_LENGTH
  );

  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(amount)) {
    const error = new Error("amount must be a positive decimal string");
    error.code = "VALIDATION_ERROR";
    error.statusCode = 400;
    throw error;
  }

  if (amount === "0" || /^0(?:\.0+)?$/.test(amount)) {
    const error = new Error("amount must be positive");
    error.code = "VALIDATION_ERROR";
    error.statusCode = 400;
    throw error;
  }

  return amount;
}

export function validateTransactionInput({ idempotencyKey, from, to, amount }) {
  return {
    idempotencyKey: requireNonEmptyString(
      idempotencyKey,
      "idempotencyKey",
      MAX_IDEMPOTENCY_KEY_LENGTH
    ),
    from: requireNonEmptyString(from, "from", MAX_ADDRESS_LENGTH),
    to: requireNonEmptyString(to, "to", MAX_ADDRESS_LENGTH),
    amount: validateAmount(amount)
  };
}
