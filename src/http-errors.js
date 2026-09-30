export function toPublicHttpError(error) {
  if (error?.code === "NOT_FOUND") {
    return { statusCode: 404, message: "transaction not found" };
  }

  if (error?.code === "IDEMPOTENCY_CONFLICT") {
    return { statusCode: 409, message: "idempotency conflict" };
  }

  if (error?.code === "IDEMPOTENCY_KEY_MISMATCH") {
    return { statusCode: 400, message: "idempotency key mismatch" };
  }

  if (error?.code === "BLOCKCHAIN_VERIFICATION_FAILED") {
    return { statusCode: 409, message: "blockchain transaction verification failed" };
  }

  if (error?.code === "INVALID_TRANSITION") {
    return { statusCode: 409, message: "invalid transaction state transition" };
  }

  if (error?.code === "INVALID_TRANSACTION_ID") {
    return { statusCode: 400, message: "invalid transaction id" };
  }

  if (error?.code === "TX_HASH_MISMATCH") {
    return { statusCode: 409, message: "transaction hash mismatch" };
  }

  if (error?.code === "PERSISTENCE_CONFLICT") {
    return { statusCode: 503, message: "transaction persistence unavailable" };
  }

  if (error?.code === "BLOCKCHAIN_BROADCAST_UNKNOWN") {
    return {
      statusCode: 503,
      message:
        "blockchain broadcast outcome is unknown; reconciliation is required"
    };
  }

  if (error?.code === "EXTERNAL_TX_HASH_NOT_ALLOWED") {
    return {
      statusCode: 400,
      message: "transaction hash is service-controlled"
    };
  }

  if (error?.code === "SUBMIT_BODY_NOT_ALLOWED") {
    return {
      statusCode: 400,
      message: "submit request body must be empty"
    };
  }

  if (error?.code === "VALIDATION_ERROR") {
    return { statusCode: 400, message: error.message };
  }

  if (error?.code === "BLOCKCHAIN_DISABLED") {
    return { statusCode: 503, message: "blockchain adapter disabled" };
  }

  if (error?.code === "TRANSACTION_NOT_SUBMITTED") {
    return {
      statusCode: 409,
      message: "transaction must be submitted before confirmation"
    };
  }

  if (error?.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
    return {
      statusCode: error.statusCode,
      message: error.message || "bad request"
    };
  }

  return {
    statusCode: 500,
    message: "internal server error"
  };
}
