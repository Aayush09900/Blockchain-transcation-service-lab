import { MySqlTransactionStore } from "./mysql-store.js";
import { isAddress, parseEther } from "ethers";
import { EthersReceiptMonitor } from "./blockchain-adapter.js";
import { sanitizeError } from "./logging.js";

const mysqlUrl = process.env.MYSQL_URL;
const rpcUrl = process.env.CHAIN_RPC_URL;
const rpcUrls = process.env.CHAIN_RPC_URLS;
const expectedChainId = process.env.CHAIN_ID
  ? Number(process.env.CHAIN_ID)
  : undefined;
const anchorContractAddress =
  process.env.ANCHOR_CONTRACT_ADDRESS || undefined;

if (!mysqlUrl || (!rpcUrl && !rpcUrls) || !anchorContractAddress) {
  throw new Error(
    "MYSQL_URL, CHAIN_RPC_URL or CHAIN_RPC_URLS, and ANCHOR_CONTRACT_ADDRESS are required for the blockchain confirmation worker"
  );
}

if (!isAddress(anchorContractAddress)) {
  throw new Error("ANCHOR_CONTRACT_ADDRESS must be a valid Ethereum address");
}

const mysqlStore = new MySqlTransactionStore({
  url: mysqlUrl,
  maxPoolSize: Number.parseInt(process.env.MYSQL_POOL_MAX ?? "10", 10),
  ssl: process.env.MYSQL_SSL === "true"
});

const chain = EthersReceiptMonitor.fromConfig({
  rpcUrl,
  rpcUrls,
  chainId: expectedChainId
});

const intervalMs = Math.max(
  500,
  Number.parseInt(process.env.CHAIN_CONFIRM_POLL_MS ?? "3000", 10)
);
const batchSize = Math.max(
  1,
  Math.min(
    200,
    Number.parseInt(process.env.CHAIN_CONFIRM_BATCH_SIZE ?? "50", 10)
  )
);
const recoveryLookbackBlocks = Math.max(
  1,
  Math.min(
    2_000_000,
    Number.parseInt(process.env.CHAIN_RECOVERY_LOOKBACK_BLOCKS ?? "20000", 10)
  )
);

let running = true;
let processing = false;
let inFlight = null;

let batchesProcessed = 0;
let recoveredCount = 0;
let confirmedCount = 0;
let failedCount = 0;
let pendingCount = 0;
let verificationErrorCount = 0;
let rpcErrorCount = 0;
let lastHeartbeatAt = 0;

async function reconcileBatch() {
  if (processing) return;

  processing = true;
  inFlight = (async () => {
    let broadcastingCount = 0;
    let submittedCount = 0;

    try {
      const broadcasting = await mysqlStore.listBroadcasting(batchSize);
      broadcastingCount = broadcasting.length;

      for (const transaction of broadcasting) {
        try {
          const recovered = await chain.findAnchorTransaction({
            transactionId: transaction.id,
            contractAddress: anchorContractAddress,
            lookbackBlocks: recoveryLookbackBlocks
          });

          if (!recovered) {
            pendingCount += 1;
            continue;
          }

          const verification = await chain.verifySubmittedTransaction({
            transactionId: transaction.id,
            sender: transaction.from,
            receiver: transaction.to,
            amountWei: amountToWei(transaction.amount),
            txHash: recovered.txHash,
            anchorContractAddress
          });

          if (verification.confirmed) {
            await mysqlStore.transition(transaction.id, "SUBMITTED", {
              txHash: recovered.txHash
            });
            recoveredCount += 1;
          } else {
            pendingCount += 1;
          }
        } catch (error) {
          if (error?.code === "BLOCKCHAIN_VERIFICATION_FAILED") {
            verificationErrorCount += 1;
            await mysqlStore.transition(transaction.id, "FAILED", {
              failureReason: "broadcast recovery verification failed"
            });
            failedCount += 1;
            continue;
          }

          rpcErrorCount += 1;

          console.error(JSON.stringify({
            event: "blockchain_broadcast_recovery_error",
            transactionId: transaction.id,
            message: sanitizeError(error)
          }));
        }
      }

      const transactions = await mysqlStore.listSubmitted(batchSize);
      submittedCount = transactions.length;

      for (const transaction of transactions) {
        try {
          const verification = await chain.verifySubmittedTransaction({
            transactionId: transaction.id,
            sender: transaction.from,
            receiver: transaction.to,
            amountWei: amountToWei(transaction.amount),
            txHash: transaction.txHash,
            anchorContractAddress
          });

          if (!verification.confirmed) {
            if (verification.reverted) {
              await mysqlStore.transition(transaction.id, "FAILED", {
                failureReason: "blockchain transaction reverted"
              });
              failedCount += 1;
            } else {
              pendingCount += 1;
            }
            continue;
          }

          await mysqlStore.transition(transaction.id, "CONFIRMED");
          confirmedCount += 1;

          console.log(JSON.stringify({
            event: "blockchain_confirmation",
            transactionId: transaction.id,
            txHash: transaction.txHash,
            confirmationLatencyMs: Math.max(
              0,
              Date.now() - new Date(transaction.updatedAt).getTime()
            )
          }));
        } catch (error) {
          if (error?.code === "BLOCKCHAIN_VERIFICATION_FAILED") {
            verificationErrorCount += 1;
            await mysqlStore.transition(transaction.id, "FAILED", {
              failureReason: "blockchain transaction verification failed"
            });
            failedCount += 1;
            continue;
          }

          rpcErrorCount += 1;

          console.error(JSON.stringify({
            event: "blockchain_confirmation_error",
            transactionId: transaction.id,
            txHash: transaction.txHash,
            message: sanitizeError(error)
          }));
        }
      }
    } finally {
      batchesProcessed += 1;

      console.log(JSON.stringify({
        event: "blockchain_confirmation_batch_processed",
        batchSize,
        broadcasting: broadcastingCount,
        submitted: submittedCount,
        totals: {
          batchesProcessed,
          recoveredCount,
          confirmedCount,
          failedCount,
          pendingCount,
          verificationErrorCount,
          rpcErrorCount
        }
      }));
      inFlight = null;
      processing = false;
    }
  })();

  await inFlight;
}

async function loop() {
  while (running) {
    try {
      await reconcileBatch();
    } catch (error) {
      console.error(JSON.stringify({
        event: "blockchain_confirmation_loop_error",
        message: sanitizeError(error)
      }));
    }

    const now = Date.now();

    if (now - lastHeartbeatAt >= 30_000) {
      lastHeartbeatAt = now;
      console.log(JSON.stringify({
        event: "blockchain_confirmation_worker_heartbeat",
        running,
        processing,
        timestamp: new Date(now).toISOString(),
        totals: {
          batchesProcessed,
          recoveredCount,
          confirmedCount,
          failedCount,
          pendingCount,
          verificationErrorCount,
          rpcErrorCount
        }
      }));
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

async function shutdown(signal) {
  running = false;

  console.log(JSON.stringify({
    event: "blockchain_confirmation_worker_shutdown",
    signal
  }));

  if (inFlight) {
    await inFlight.catch((error) => {
      console.error(JSON.stringify({
        event: "blockchain_confirmation_worker_shutdown_error",
        message: sanitizeError(error)
      }));
    });
  }

  await mysqlStore.close();
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

await chain.healthCheck(expectedChainId);

console.log(JSON.stringify({
  event: "blockchain_confirmation_worker_started",
  intervalMs,
  batchSize,
  recoveryLookbackBlocks,
  chainId: expectedChainId ?? "provider-detected"
}));

await loop();

function amountToWei(amount) {
  return parseEther(amount);
}
