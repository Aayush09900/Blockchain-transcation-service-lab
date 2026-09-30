import { MySqlTransactionStore } from "./mysql-store.js";
import { EthersReceiptMonitor } from "./blockchain-adapter.js";

const mysqlUrl = process.env.MYSQL_URL;
const rpcUrl = process.env.CHAIN_RPC_URL;
const expectedChainId = process.env.CHAIN_ID
  ? Number(process.env.CHAIN_ID)
  : undefined;

if (!mysqlUrl || !rpcUrl) {
  throw new Error(
    "MYSQL_URL and CHAIN_RPC_URL are required for the blockchain confirmation worker"
  );
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

let running = true;
let processing = false;

async function reconcileBatch() {
  if (processing) return;

  processing = true;

  try {
    const transactions = await mysqlStore.listSubmitted(batchSize);

    for (const transaction of transactions) {
      try {
        const receipt = await chain.getTransactionReceipt(transaction.txHash);

        if (!receipt) {
          continue;
        }

        if (receipt.status === 1) {
          await mysqlStore.transition(transaction.id, "CONFIRMED");
          continue;
        }

        await mysqlStore.transition(transaction.id, "FAILED", {
          failureReason: "blockchain transaction reverted"
        });
      } catch (error) {
        console.error(JSON.stringify({
          event: "blockchain_confirmation_error",
          transactionId: transaction.id,
          txHash: transaction.txHash,
          message: error instanceof Error ? error.message : String(error)
        }));
      }
    }
  } finally {
    processing = false;
  }
}

async function loop() {
  while (running) {
    try {
      await reconcileBatch();
    } catch (error) {
      console.error(JSON.stringify({
        event: "blockchain_confirmation_loop_error",
        message: error instanceof Error ? error.message : String(error)
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
