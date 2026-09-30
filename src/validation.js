import { getAddress, isAddress } from "ethers";

const MAX_IDEMPOTENCY_KEY_LENGTH = 128;
const MAX_ADDRESS_LENGTH = 42;
const MAX_AMOUNT_LENGTH = 80;
const MAX_AMOUNT_DECIMALS = 18;
const MAX_AMOUNT_INTEGER_DIGITS = 47;

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

export function validateEthereumAddress(value, field) {
  const address = requireNonEmptyString(value, field, MAX_ADDRESS_LENGTH);

  if (!isAddress(address)) {
    const error = new Error(`${field} must be a valid Ethereum address`);
    error.code = "VALIDATION_ERROR";
    error.statusCode = 400;
    throw error;
  }

  return getAddress(address);
}

export function validateAmount(value) {
  const amount = requireNonEmptyString(
    value,
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

  const [whole, fraction = ""] = amount.split(".");

  if (whole.length > MAX_AMOUNT_INTEGER_DIGITS) {
    const error = new Error("amount exceeds supported integer precision");
    error.code = "VALIDATION_ERROR";
    error.statusCode = 400;
    throw error;
  }

  if (fraction.length > MAX_AMOUNT_DECIMALS) {
    const error = new Error(
      `amount supports at most ${MAX_AMOUNT_DECIMALS} decimal places`
    );
    error.code = "VALIDATION_ERROR";
    error.statusCode = 400;
    throw error;
  }

  const normalizedFraction = fraction.replace(/0+$/, "");

  return normalizedFraction
    ? `${whole}.${normalizedFraction}`
    : whole;
}

export function validateTransactionHash(value) {
  const hash = requireNonEmptyString(value, "txHash", 66);

  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) {
    const error = new Error("txHash must be a valid 32-byte transaction hash");
    error.code = "VALIDATION_ERROR";
    error.statusCode = 400;
    throw error;
  }

  return hash;
}

export function validateTransactionInput({
  idempotencyKey,
  from,
  to,
  amount
}) {
  return {
    idempotencyKey: requireNonEmptyString(
      idempotencyKey,
      "idempotencyKey",
      MAX_IDEMPOTENCY_KEY_LENGTH
    ),
    from: validateEthereumAddress(from, "from"),
    to: validateEthereumAddress(to, "to"),
    amount: validateAmount(amount)
  };
}

export {
  MAX_IDEMPOTENCY_KEY_LENGTH,
  MAX_ADDRESS_LENGTH,
  MAX_AMOUNT_LENGTH,
  MAX_AMOUNT_DECIMALS
};
