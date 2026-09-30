import test from "node:test";
import assert from "node:assert/strict";
import {
  MIN_GAS_LIMIT,
  MAX_GAS_LIMIT,
  buildTransactionOverrides,
  parseOptionalGasLimit,
  parseOptionalGwei,
  validateFeePolicy
} from "../src/blockchain-fee-policy.js";

test("gas limit parser enforces explicit safety bounds", () => {
  assert.equal(parseOptionalGasLimit("50000"), 50000n);
  assert.equal(parseOptionalGasLimit(""), null);

  assert.throws(
    () => parseOptionalGasLimit("20000"),
    /CHAIN_GAS_LIMIT must be between/
  );

  assert.throws(
    () => parseOptionalGasLimit(String(MAX_GAS_LIMIT + 1n)),
    /CHAIN_GAS_LIMIT must be between/
  );

  assert.equal(MIN_GAS_LIMIT, 21000n);
});

test("gwei parser preserves exact wei precision", () => {
  assert.equal(parseOptionalGwei("2.5", "CHAIN_MAX_FEE_GWEI"), 2_500_000_000n);
  assert.equal(parseOptionalGwei("", "CHAIN_MAX_FEE_GWEI"), null);

  assert.throws(
    () => parseOptionalGwei("1.1234567891", "CHAIN_MAX_FEE_GWEI"),
    /at most 9 decimals/
  );

  assert.throws(
    () => parseOptionalGwei("0", "CHAIN_MAX_FEE_GWEI"),
    /greater than zero/
  );
});

test("fee policy requires a coherent EIP-1559 ceiling pair", () => {
  assert.throws(
    () => validateFeePolicy({
      gasLimit: 100000n,
      maxFeePerGas: 3_000_000_000n,
      maxPriorityFeePerGas: null
    }),
    /must be configured together/
  );

  assert.throws(
    () => validateFeePolicy({
      gasLimit: 100000n,
      maxFeePerGas: 1_000_000_000n,
      maxPriorityFeePerGas: 2_000_000_000n
    }),
    /cannot exceed/
  );

  assert.equal(
    validateFeePolicy({
      gasLimit: 100000n,
      maxFeePerGas: 3_000_000_000n,
      maxPriorityFeePerGas: 1_000_000_000n
    }),
    true
  );
});

test("transaction overrides are restricted to the configured policy", () => {
  assert.deepEqual(
    buildTransactionOverrides({
      gasLimit: 100000n,
      maxFeePerGas: 3_000_000_000n,
      maxPriorityFeePerGas: 1_000_000_000n
    }),
    {
      gasLimit: 100000n,
      maxFeePerGas: 3_000_000_000n,
      maxPriorityFeePerGas: 1_000_000_000n
    }
  );

  assert.deepEqual(buildTransactionOverrides({}), {});
});
