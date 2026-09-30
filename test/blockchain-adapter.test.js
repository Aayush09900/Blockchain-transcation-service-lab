import test from "node:test";
import assert from "node:assert/strict";
import { FallbackProvider } from "ethers";
import { id, Interface } from "ethers";
import {
  EthersReceiptMonitor,
  createRpcProvider
} from "../src/blockchain-adapter.js";

const CONTRACT = "0x00000000000000000000000000000000000000c1";
const SENDER = "0x0000000000000000000000000000000000000001";
const RECEIVER = "0x0000000000000000000000000000000000000002";
const TX_HASH =
  "0x1111111111111111111111111111111111111111111111111111111111111111";
const TRANSACTION_ID = "adapter-test-001";

const anchorInterface = new Interface([
  "function anchor(bytes32 transactionId, address sender, address receiver, uint256 amount)"
]);

function anchorTransaction({ amount = 7n, transactionId = TRANSACTION_ID } = {}) {
  return {
    from: SENDER,
    to: CONTRACT,
    value: 0n,
    data: anchorInterface.encodeFunctionData("anchor", [
      id(transactionId),
      SENDER,
      RECEIVER,
      amount
    ])
  };
}

function monitorFor({
  transaction,
  receipt,
  getTransactionError,
  currentBlock,
  block
} = {}) {
  return new EthersReceiptMonitor({
    provider: {
      async getTransaction() {
        if (getTransactionError) throw getTransactionError;
        return transaction;
      },
      async getTransactionReceipt() {
        return receipt;
      },
      async getBlockNumber() {
        return currentBlock ?? receipt?.blockNumber ?? 0;
      },
      async getBlock() {
        return block ?? null;
      }
    }
  });
}

test("multiple RPC endpoints create a failover provider", () => {
  const provider = createRpcProvider({
    rpcUrls: "https://primary.example,https://secondary.example",
    chainId: 11155111
  });

  assert.equal(provider instanceof FallbackProvider, true);
  assert.equal(provider.providerConfigs.length, 2);
  assert.equal(provider.quorum, 1);

  provider.destroy();
});

test("confirmed block evidence detects a reorganization", async () => {
  const blockHash =
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const receipt = {
    hash: TX_HASH,
    status: 1,
    blockNumber: 200,
    blockHash
  };

  const monitor = monitorFor({
    transaction: anchorTransaction(),
    receipt,
    block: {
      number: 200,
      hash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    }
  });

  const result = await monitor.verifyConfirmedTransaction({
    txHash: TX_HASH,
    confirmedBlockNumber: 200,
    confirmedBlockHash: blockHash
  });

  assert.equal(result.reorged, true);
  assert.match(result.reason, /canonical/);
});

test("confirmed block evidence remains valid when receipt and canonical block match", async () => {
  const blockHash =
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const monitor = monitorFor({
    transaction: anchorTransaction(),
    receipt: {
      hash: TX_HASH,
      status: 1,
      blockNumber: 201,
      blockHash
    },
    block: {
      number: 201,
      hash: blockHash
    }
  });

  const result = await monitor.verifyConfirmedTransaction({
    txHash: TX_HASH,
    confirmedBlockNumber: 201,
    confirmedBlockHash: blockHash
  });

  assert.equal(result.reorged, false);
});

test("pending receipt is not treated as confirmation", async () => {
  const monitor = monitorFor({
    transaction: anchorTransaction(),
    receipt: null
  });

  const result = await monitor.verifySubmittedTransaction({
    transactionId: TRANSACTION_ID,
    sender: SENDER,
    receiver: RECEIVER,
    amountWei: 7n,
    txHash: TX_HASH,
    anchorContractAddress: CONTRACT
  });

  assert.equal(result.confirmed, false);
  assert.equal(result.receipt, null);
});

test("matching mined receipt is confirmed and remains idempotently verifiable", async () => {
  const receipt = {
    hash: TX_HASH,
    status: 1,
    blockNumber: 100,
    blockHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  };

  const monitor = monitorFor({
    transaction: anchorTransaction(),
    receipt
  });

  const first = await monitor.verifySubmittedTransaction({
    transactionId: TRANSACTION_ID,
    sender: SENDER,
    receiver: RECEIVER,
    amountWei: 7n,
    txHash: TX_HASH,
    anchorContractAddress: CONTRACT
  });

  const second = await monitor.verifySubmittedTransaction({
    transactionId: TRANSACTION_ID,
    sender: SENDER,
    receiver: RECEIVER,
    amountWei: 7n,
    txHash: TX_HASH,
    anchorContractAddress: CONTRACT
  });

  assert.equal(first.confirmed, true);
  assert.equal(second.confirmed, true);
  assert.equal(second.receipt.blockNumber, 100);
});

test("reverted receipt is reported as a verified blockchain failure", async () => {
  const monitor = monitorFor({
    transaction: anchorTransaction(),
    receipt: { hash: TX_HASH, status: 0, blockNumber: 101, blockHash: "0xbb".padEnd(66, "0") }
  });

  const result = await monitor.verifySubmittedTransaction({
    transactionId: TRANSACTION_ID,
    sender: SENDER,
    receiver: RECEIVER,
    amountWei: 7n,
    txHash: TX_HASH,
    anchorContractAddress: CONTRACT
  });

  assert.equal(result.confirmed, false);
  assert.equal(result.reverted, true);
});

test("RPC errors propagate without inventing a FAILED state", async () => {
  const rpcError = new Error("RPC unavailable");
  const monitor = monitorFor({
    transaction: anchorTransaction(),
    receipt: null,
    getTransactionError: rpcError
  });

  await assert.rejects(
    monitor.verifySubmittedTransaction({
      transactionId: TRANSACTION_ID,
      sender: SENDER,
      receiver: RECEIVER,
      amountWei: 7n,
      txHash: TX_HASH,
      anchorContractAddress: CONTRACT
    }),
    (error) => error === rpcError
  );
});

test("missing receipt does not trigger a reorg while the stored block remains canonical", async () => {
  const blockHash =
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const monitor = monitorFor({
    transaction: anchorTransaction(),
    receipt: null,
    block: {
      number: 202,
      hash: blockHash
    }
  });

  const result = await monitor.verifyConfirmedTransaction({
    txHash: TX_HASH,
    confirmedBlockNumber: 202,
    confirmedBlockHash: blockHash
  });

  assert.equal(result.reorged, false);
  assert.equal(result.verified, false);
});

test("on-chain payload mismatch is rejected even with a successful receipt", async () => {
  const monitor = monitorFor({
    transaction: anchorTransaction({ amount: 8n }),
    receipt: {
      hash: TX_HASH,
      status: 1,
      blockNumber: 102,
      blockHash: "0xcc".padEnd(66, "0")
    }
  });

  await assert.rejects(
    monitor.verifySubmittedTransaction({
      transactionId: TRANSACTION_ID,
      sender: SENDER,
      receiver: RECEIVER,
      amountWei: 7n,
      txHash: TX_HASH,
      anchorContractAddress: CONTRACT
    }),
    /anchor payload does not match transaction/
  );
});
