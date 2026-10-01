import { parseUnits } from "ethers";

export const MAX_GAS_LIMIT = 1_000_000n;
export const MIN_GAS_LIMIT = 21_000n;

export function parseOptionalGasLimit(value, field = "CHAIN_GAS_LIMIT") {
  if (value === undefined || value === null || String(value).trim() === "") {
    return null;
  }

  const raw = String(value).trim();

  if (!/^\d+$/.test(raw)) {
    throw configError(`${field} must be a positive integer`);
  }

  const parsed = BigInt(raw);

  if (parsed < MIN_GAS_LIMIT || parsed > MAX_GAS_LIMIT) {
    throw configError(
      `${field} must be between ${MIN_GAS_LIMIT} and ${MAX_GAS_LIMIT}`
    );
  }

  return parsed;
}

export function parseOptionalGwei(
  value,
  field,
  {
    maxGweiDecimals = 9
  } = {}
) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return null;
  }

  const raw = String(value).trim();
  const pattern = new RegExp(
    `^\\d+(?:\\.\\d{1,${maxGweiDecimals}})?$`
  );

  if (!pattern.test(raw)) {
    throw configError(
      `${field} must be a positive decimal value with at most ${maxGweiDecimals} decimals`
    );
  }

  const parsed = parseUnits(raw, 9);

  if (parsed <= 0n) {
    throw configError(`${field} must be greater than zero`);
  }

  return parsed;
}

export function validateFeePolicy({
  gasLimit,
  maxFeePerGas,
  maxPriorityFeePerGas
}) {
  if (
    gasLimit !== null &&
    gasLimit !== undefined &&
    (typeof gasLimit !== "bigint" ||
      gasLimit < MIN_GAS_LIMIT ||
      gasLimit > MAX_GAS_LIMIT)
  ) {
    throw configError("gasLimit is outside the supported safety bounds");
  }

  const hasMaxFee = maxFeePerGas !== null && maxFeePerGas !== undefined;
  const hasMaxPriority =
    maxPriorityFeePerGas !== null && maxPriorityFeePerGas !== undefined;

  if (hasMaxFee !== hasMaxPriority) {
    throw configError(
      "maxFeePerGas and maxPriorityFeePerGas must be configured together"
    );
  }

  if (hasMaxFee) {
    if (maxFeePerGas <= 0n || maxPriorityFeePerGas <= 0n) {
      throw configError("fee ceilings must be greater than zero");
    }

    if (maxPriorityFeePerGas > maxFeePerGas) {
      throw configError(
        "maxPriorityFeePerGas cannot exceed maxFeePerGas"
      );
    }
  }

  return true;
}

export function buildTransactionOverrides({
  gasLimit = null,
  maxFeePerGas = null,
  maxPriorityFeePerGas = null
}) {
  validateFeePolicy({
    gasLimit,
    maxFeePerGas,
    maxPriorityFeePerGas
  });

  const overrides = {};

  if (gasLimit !== null && gasLimit !== undefined) {
    overrides.gasLimit = gasLimit;
  }

  if (maxFeePerGas !== null && maxFeePerGas !== undefined) {
    overrides.maxFeePerGas = maxFeePerGas;
    overrides.maxPriorityFeePerGas = maxPriorityFeePerGas;
  }

  return overrides;
}

function configError(message) {
  const error = new Error(message);
  error.code = "CONFIG_ERROR";
  error.statusCode = 500;
  return error;
}
