import { MySqlTransactionStore } from "./mysql-store.js";
import { MongoAuditStore } from "./mongo-audit-store.js";
import { sanitizeError } from "./logging.js";

const mysqlUrl = process.env.MYSQL_URL;
const mongoUrl = process.env.MONGO_URL;

if (!mysqlUrl || !mongoUrl) {
  throw new Error("MYSQL_URL and MONGO_URL are required for the outbox worker");
}

const mysqlStore = new MySqlTransactionStore({
  url: mysqlUrl,
  maxPoolSize: Number.parseInt(process.env.MYSQL_POOL_MAX ?? "10", 10),
  ssl: process.env.MYSQL_SSL === "true",
  leaseMs: Number.parseInt(process.env.OUTBOX_LEASE_MS ?? "60000", 10)
});

const mongoStore = new MongoAuditStore({
  url: mongoUrl,
  databaseName:
    process.env.MONGO_DATABASE ?? "blockchain_transaction_audit",
  maxPoolSize: Number.parseInt(process.env.MONGO_MAX_POOL_SIZE ?? "20", 10),
  tls: process.env.MONGO_TLS === "true"
});

const intervalMs = Math.max(
  250,
  Number.parseInt(process.env.OUTBOX_POLL_MS ?? "1000", 10)
);

const batchSize = Math.max(
  1,
  Math.min(Number.parseInt(process.env.OUTBOX_BATCH_SIZE ?? "50", 10) || 50, 500)
);

let running = true;
let processing = false;
let inFlight = null;

async function publishBatch() {
  if (processing) return;

  processing = true;
  inFlight = (async () => {
    try {
      const events = await mysqlStore.claimOutboxBatch(batchSize);

      for (const event of events) {
      try {
        const payload = JSON.parse(event.payload);

        await mongoStore.appendEvent({
          eventId: event.event_id,
          transactionId: event.transaction_id,
          eventType: event.event_type,
          payload,
          occurredAt: event.created_at
        });

        const transaction = await mysqlStore.get(event.transaction_id);
        await mongoStore.upsertSnapshot(transaction);

        await mysqlStore.markOutboxPublished(event.id);
      } catch (error) {
        await mysqlStore.markOutboxFailed(
          event.id,
          sanitizeError(error)
        );
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
      await publishBatch();
    } catch (error) {
      console.error(JSON.stringify({
        event: "outbox_publish_loop_error",
        message: sanitizeError(error)
      }));
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

async function shutdown(signal) {
  running = false;

  console.log(JSON.stringify({
    event: "outbox_worker_shutdown",
    signal
  }));

  if (inFlight) {
    await inFlight.catch((error) => {
      console.error(JSON.stringify({
        event: "outbox_worker_shutdown_error",
        message: sanitizeError(error)
      }));
    });
  }

  await Promise.allSettled([
    mysqlStore.close(),
    mongoStore.close()
  ]);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

await mongoStore.connect();

console.log(JSON.stringify({
  event: "outbox_worker_started",
  intervalMs,
  batchSize
}));

await loop();
