import test from "node:test";
import assert from "node:assert/strict";
import { toPublicHttpError } from "../src/http-errors.js";

test("pre-submission confirmation errors are safe and client-visible as conflicts", () => {
  assert.deepEqual(
    toPublicHttpError({ code: "TRANSACTION_NOT_SUBMITTED" }),
    {
      statusCode: 409,
      message: "transaction must be submitted before confirmation"
    }
  );
});

test("internal confirmation errors do not expose implementation details", () => {
  assert.deepEqual(
    toPublicHttpError(new Error("private RPC credentials should never leak")),
    {
      statusCode: 500,
      message: "internal server error"
    }
  );
});
