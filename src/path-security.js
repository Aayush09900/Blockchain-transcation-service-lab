const UUID_V4_OR_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateTransactionId(id) {
  if (typeof id !== "string" || id.length > 64) {
    throw new Error("invalid transaction id");
  }

  if (!UUID_V4_OR_V7.test(id)) {
    throw new Error("invalid transaction id");
  }

  return id;
}

export function parseTransactionId(encodedId) {
  try {
    return validateTransactionId(decodeURIComponent(encodedId));
  } catch {
    throw new Error("invalid transaction id");
  }
}
