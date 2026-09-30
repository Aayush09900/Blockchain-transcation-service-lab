import { MySqlTransactionStore } from "./mysql-store.js";
import { isAddress, parseEther } from "ethers";
import { EthersReceiptMonitor } from "./blockchain-adapter.js";
import { sanitizeError } from "./logging.js";

const mysqlUrl = process.env.MYSQL_URL;
const rpcUrl = process.env.CHAIN_RPC_URL;
const expectedChainId = process.env.CHAIN_ID
  ? Number(process.env.CHAIN_ID)
  : undefined;
const anchorContractAddress =
  process.env.ANCHOR_CONTRACT_ADDRESS || undefined;

if (!mysqlUrl || !rpcUrl || !anchorContractAddress) {
  throw new Error(
    "MYSQL_URL, CHAIN_RPC_URL and ANCHOR_CONTRACT_ADDRESS are required for the blockchain confirmation worker"
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

async function reconcileBatch() {
  if (processing) return;

  processing = true;
  inFlight = (async () => {
    try {
      const broadcasting = await mysqlStore.listBroadcasting(batchSize);

      for (const transaction of broadcasting) {
        try {
          const recovered = await chain.findAnchorTransaction({
            transactionId: transaction.id,
            contractAddress: anchorContractAddress,
            lookbackBlocks: recoveryLookbackBlocks
          });

          if (!recovered) {
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
          }
        } catch (error) {
          if (error?.code === "BLOCKCHAIN_VERIFICATION_FAILED") {
            await mysqlStore.transition(transaction.id, "FAILED", {
              failureReason: "broadcast recovery verification failed"
            });
            continue;
          }

          console.error(JSON.stringify({
            event: "blockchain_broadcast_recovery_error",
            transactionId: transaction.id,
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
            }
            continue;
          }

          await mysqlStore.transition(transaction.id, "CONFIRMED");
        } catch (error) {
          if (error?.code === "BLOCKCHAIN_VERIFICATION_FAILED") {
            await mysqlStore.transition(transaction.id, "FAILED", {
              failureReason: "blockchain transaction verification failed"
            });
            continue;
          }

          console.error(JSON.stringify({
            event: "blockchain_confirmation_error",
            transactionId: transaction.id,
            txHash: transaction.txHash,
            message: sanitizeError(error)
          }));
        }
      }
    } finally {
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
  chainId: expectedChainId ?? "provider-detected"
}));

await loop();

function amountToWei(amount) {
  return parseEther(amount);
}
