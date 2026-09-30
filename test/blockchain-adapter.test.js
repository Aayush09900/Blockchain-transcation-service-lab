import test from "node:test";
import assert from "node:assert/strict";
import { Interface, id } from "ethers";
import {
  transactionIdToBytes32,
  validateTransactionIntent
} from "../src/blockchain-adapter.js";

const ABI = [
  "function anchor(bytes32 transactionId, address sender, address receiver, uint256 amount)"
];

const anchorInterface = new Interface(ABI);

const transactionId = "550e8400-e29b-41d4-a716-446655440000";
const sender = "0x0000000000000000000000000000000000000001";
const receiver = "0x0000000000000000000000000000000000000002";
const anchorContract = "0x0000000000000000000000000000000000000099";
const anchorer = "0x0000000000000000000000000000000000000008";
const amountWei = 1_000_000_000_000_000n;

function anchorTransaction(overrides = {}) {
  return {
    to: anchorContract,
    from: anchorer,
    data: anchorInterface.encodeFunctionData("anchor", [
      id(transactionId),
      sender,
      receiver,
      amountWei
    ]),
    value: 0n,
    ...overrides
  };
}

test("blockchain intent validation accepts an exact anchor payload", () => {
  assert.doesNotThrow(() =>
    validateTransactionIntent({
      transaction: anchorTransaction(),
      transactionId,
      sender,
      receiver,
      amountWei,
      anchorContractAddress: anchorContract,
      expectedAnchorer: anchorer
    })
  );

  assert.equal(transactionIdToBytes32(transactionId), id(transactionId));
});

test("blockchain intent validation rejects a wrong sender before receipt handling", () => {
  assert.throws(
    () =>
      validateTransactionIntent({
        transaction: anchorTransaction(),
        transactionId,
        sender: "0x0000000000000000000000000000000000000003",
        receiver,
        amountWei,
        anchorContractAddress: anchorContract,
        expectedAnchorer: anchorer
      }),
    /anchor payload does not match transaction/
  );
});

test("blockchain intent validation rejects a wrong transaction ID", () => {
  assert.throws(
    () =>
      validateTransactionIntent({
        transaction: anchorTransaction(),
        transactionId: "650e8400-e29b-41d4-a716-446655440000",
        sender,
        receiver,
        amountWei,
        anchorContractAddress: anchorContract,
        expectedAnchorer: anchorer
      }),
    /anchor payload does not match transaction/
  );
});

test("blockchain intent validation rejects a wrong direct-transfer value", () => {
  assert.throws(
    () =>
      validateTransactionIntent({
        transaction: {
          to: receiver,
          from: sender,
          data: "0x",
          value: amountWei + 1n
        },
        transactionId,
        sender,
        receiver,
        amountWei
      }),
    /transfer does not match transaction/
  );
});

test("blockchain intent validation rejects an unauthorized anchor transaction", () => {
  assert.throws(
    () =>
      validateTransactionIntent({
        transaction: anchorTransaction({
          from: "0x0000000000000000000000000000000000000007"
        }),
        transactionId,
        sender,
        receiver,
        amountWei,
        anchorContractAddress: anchorContract,
        expectedAnchorer: anchorer
      }),
    /anchor transaction sender is not authorized/
  );
});

test("blockchain intent validation rejects non-anchor destinations when anchoring is configured", () => {
  assert.throws(
    () =>
      validateTransactionIntent({
        transaction: {
          to: receiver,
          from: anchorer,
          data: "0x",
          value: 0n
        },
        transactionId,
        sender,
        receiver,
        amountWei,
        anchorContractAddress: anchorContract,
        expectedAnchorer: anchorer
      }),
    /transaction destination does not match anchor contract/
  );
});
