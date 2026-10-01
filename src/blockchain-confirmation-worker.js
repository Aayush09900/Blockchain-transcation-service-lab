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
const staleBroadcastReconciliationSeconds = Math.max(
  60,
  Math.min(
    604_800,
    Number.parseInt(
      process.env.CHAIN_STALE_BROADCAST_RECONCILIATION_SECONDS ?? "3600",
      10
    )
  )
);

let running = true;
let processing = false;
let inFlight = null;
let batchesProcessed = 0;
let recoveredCount = 0;
let confirmedCount = 0;
let reorgedCount = 0;
let reorgRecoveredCount = 0;
let failedCount = 0;
let pendingCount = 0;
let verificationErrorCount = 0;
let rpcErrorCount = 0;
let reconciliationRequiredCount = 0;
let lastHeartbeatAt = 0;

async function reconcileBatch() {
  if (processing) return;

  processing = true;
  inFlight = (async () => {
    try {
      const broadcasting = await mysqlStore.listBroadcasting(batchSize);
      batchesProcessed += 1;

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

      
      const staleBroadcasts = await mysqlStore.listStaleBroadcasting(
        new Date(
          Date.now() - staleBroadcastReconciliationSeconds * 1000
        ),
        batchSize
      );

      for (const transaction of staleBroadcasts) {
        const marked = await mysqlStore.markBroadcastReconciliationRequired(
          transaction.id,
          `broadcast outcome unresolved beyond ${staleBroadcastReconciliationSeconds}s; indexed anchor event not recovered within configured lookback`
        );

        if (marked) {
          reconciliationRequiredCount += 1;
          console.error(JSON.stringify({
            event: "blockchain_broadcast_reconciliation_required",
            transactionId: transaction.id,
            updatedAt: transaction.updatedAt,
            thresholdSeconds: staleBroadcastReconciliationSeconds
          }));
        }
      }

      const confirmedTransactions = await mysqlStore.listConfirmed(batchSize);

      for (const transaction of confirmedTransactions) {
        try {
          const evidence = await chain.verifyConfirmedTransaction({
            txHash: transaction.txHash,
            confirmedBlockNumber: transaction.confirmedBlockNumber,
            confirmedBlockHash: transaction.confirmedBlockHash
          });

          if (evidence.reorged) {
            await mysqlStore.transition(transaction.id, "REORGED", {
              failureReason: evidence.reason
            });
            reorgedCount += 1;
          }
        } catch (error) {
          rpcErrorCount += 1;
          console.error(JSON.stringify({
            event: "blockchain_reorg_check_error",
            transactionId: transaction.id,
            txHash: transaction.txHash,
            message: sanitizeError(error)
          }));
        }
      }

      const reorgedTransactions = await mysqlStore.listReorged(batchSize);

      for (const transaction of reorgedTransactions) {
        try {
          const verification = await chain.verifySubmittedTransaction({
            transactionId: transaction.id,
            sender: transaction.from,
            receiver: transaction.to,
            amountWei: amountToWei(transaction.amount),
            txHash: transaction.txHash,
            anchorContractAddress
          });

          if (verification.confirmed) {
            await mysqlStore.transition(transaction.id, "CONFIRMED", {
              confirmedBlockNumber: verification.receipt.blockNumber,
              confirmedBlockHash: verification.receipt.blockHash
            });
            reorgRecoveredCount += 1;
          } else if (verification.reverted) {
            await mysqlStore.transition(transaction.id, "FAILED", {
              failureReason: "reorged blockchain transaction reverted"
            });
            failedCount += 1;
          } else {
            pendingCount += 1;
          }
        } catch (error) {
          if (error?.code === "BLOCKCHAIN_VERIFICATION_FAILED") {
            verificationErrorCount += 1;
            await mysqlStore.transition(transaction.id, "FAILED", {
              failureReason: "blockchain transaction no longer matches the stored intent after reorg"
            });
            failedCount += 1;
            continue;
          }

          rpcErrorCount += 1;
          console.error(JSON.stringify({
            event: "blockchain_reorg_recovery_error",
            transactionId: transaction.id,
            txHash: transaction.txHash,
            message: sanitizeError(error)
          }));
        }
      }

      const transactions = await mysqlStore.listSubmitted(batchSize);

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

          await mysqlStore.transition(transaction.id, "CONFIRMED", {
            confirmedBlockNumber: verification.receipt.blockNumber,
            confirmedBlockHash: verification.receipt.blockHash
          });
          confirmedCount += 1;
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
      console.log(JSON.stringify({
        event: "blockchain_confirmation_batch_processed",
        totals: { batchesProcessed, recoveredCount, confirmedCount, reorgedCount, reorgRecoveredCount, failedCount, pendingCount, verificationErrorCount, rpcErrorCount, reconciliationRequiredCount }
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
        timestamp: new Date(now).toISOString(),
        running,
        processing,
        totals: { batchesProcessed, recoveredCount, confirmedCount, reorgedCount, reorgRecoveredCount, failedCount, pendingCount, verificationErrorCount, rpcErrorCount, reconciliationRequiredCount }
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
  staleBroadcastReconciliationSeconds,
  chainId: expectedChainId ?? "provider-detected"
}));

await loop();

function amountToWei(amount) {
  return parseEther(amount);
}
