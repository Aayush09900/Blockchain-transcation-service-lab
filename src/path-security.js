const UUID_V4_OR_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function invalidId() {
  const error = new Error("invalid transaction id");
  error.code = "INVALID_TRANSACTION_ID";
  error.statusCode = 400;
  return error;
}

export function validateTransactionId(id) {
  if (typeof id !== "string" || id.length > 64) {
    throw invalidId();
  }

  if (!UUID_V4_OR_V7.test(id)) {
    throw invalidId();
  }

  return id;
}

export function parseTransactionId(encodedId) {
  try {
    return validateTransactionId(decodeURIComponent(encodedId));
  } catch (error) {
    if (error?.code === "INVALID_TRANSACTION_ID") {
      throw error;
    }

    throw invalidId();
  }
}
