const DEFAULT_BASE_DELAY_MS = 1_000;
const DEFAULT_MAX_DELAY_MS = 30_000;
const DEFAULT_MAX_RETRIES = 3;

export const RETRY_POLICY = Object.freeze({
  baseDelayMs: DEFAULT_BASE_DELAY_MS,
  maxDelayMs: DEFAULT_MAX_DELAY_MS,
  maxRetries: DEFAULT_MAX_RETRIES
});

export function calculateRetryDelayMs(
  retryNumber,
  {
    baseDelayMs = DEFAULT_BASE_DELAY_MS,
    maxDelayMs = DEFAULT_MAX_DELAY_MS
  } = {}
) {
  const normalizedRetry = Number(retryNumber);

  if (!Number.isInteger(normalizedRetry) || normalizedRetry < 1) {
    throw new Error("retryNumber must be a positive integer");
  }

  const normalizedBase = Number(baseDelayMs);
  const normalizedMax = Number(maxDelayMs);

  if (
    !Number.isFinite(normalizedBase) ||
    normalizedBase < 0 ||
    !Number.isFinite(normalizedMax) ||
    normalizedMax < normalizedBase
  ) {
    throw new Error("retry delay bounds are invalid");
  }

  return Math.min(
    normalizedMax,
    normalizedBase * (2 ** (normalizedRetry - 1))
  );
}

export function isRetryAllowed(
  transaction,
  {
    maxRetries = DEFAULT_MAX_RETRIES
  } = {}
) {
  if (!transaction || transaction.status !== "FAILED") {
    return false;
  }

  if (transaction.retryable !== true) {
    return false;
  }

  const retryCount = Number(transaction.retryCount ?? 0);

  return Number.isInteger(retryCount) && retryCount < maxRetries;
}
