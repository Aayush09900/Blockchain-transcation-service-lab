export function toPublicHttpError(error) {
  if (error?.code === "NOT_FOUND") {
    return { statusCode: 404, message: "transaction not found" };
  }

  if (error?.code === "IDEMPOTENCY_CONFLICT") {
    return { statusCode: 409, message: "idempotency conflict" };
  }

  if (error?.code === "INVALID_TRANSITION") {
    return { statusCode: 409, message: "invalid transaction state transition" };
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
