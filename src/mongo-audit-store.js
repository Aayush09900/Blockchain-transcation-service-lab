import { MongoClient } from "mongodb";

export class MongoAuditStore {
  constructor({
    url = process.env.MONGO_URL,
    databaseName = process.env.MONGO_DATABASE ?? "blockchain_transaction_audit",
    maxPoolSize = Number.parseInt(process.env.MONGO_MAX_POOL_SIZE ?? "20", 10)
  } = {}) {
    if (!url) {
      const error = new Error("MONGO_URL is required");
      error.code = "CONFIG_ERROR";
      error.statusCode = 500;
      throw error;
    }

    this.client = new MongoClient(url, {
      maxPoolSize,
      retryWrites: true,
      retryReads: true,
      appName: "blockchain-transaction-service"
    });

    this.databaseName = databaseName;
    this.events = null;
    this.transactions = null;
  }

  async connect() {
    await this.client.connect();

    const database = this.client.db(this.databaseName);

    this.events = database.collection("transaction_events");
    this.transactions = database.collection("transaction_snapshots");

    await this.events.createIndex(
      { eventId: 1 },
      { unique: true, name: "ux_transaction_event_id" }
    );

    await this.events.createIndex(
      { transactionId: 1, createdAt: -1 },
      { name: "ix_transaction_events_tx_created" }
    );

    await this.transactions.createIndex(
      { transactionId: 1 },
      { unique: true, name: "ux_transaction_snapshot_id" }
    );
  }

  async close() {
    await this.client.close();
  }

  async healthCheck() {
    await this.client.db(this.databaseName).command({ ping: 1 });
    return true;
  }

  async appendEvent(event) {
    const document = {
      eventId: String(event.eventId),
      transactionId: String(event.transactionId),
      eventType: String(event.eventType),
      payload: event.payload,
      createdAt: new Date()
    };

    try {
      await this.events.insertOne(document, {
        writeConcern: { w: "majority" }
      });
    } catch (error) {
      if (error?.code === 11000) {
        return false;
      }

      throw error;
    }

    return true;
  }

  async upsertSnapshot(transaction) {
    await this.transactions.updateOne(
      { transactionId: transaction.id },
      {
        $set: {
          transactionId: transaction.id,
          status: transaction.status,
          from: transaction.from,
          to: transaction.to,
          amount: transaction.amount,
          txHash: transaction.txHash ?? null,
          attempts: transaction.attempts,
          failureReason: transaction.failureReason ?? null,
          updatedAt: new Date(transaction.updatedAt)
        },
        $setOnInsert: {
          createdAt: new Date(transaction.createdAt)
        }
      },
      { upsert: true, writeConcern: { w: "majority" } }
    );
  }

  async listEvents(transactionId, limit = 100) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 500));

    return this.events
      .find({ transactionId })
      .sort({ createdAt: -1 })
      .limit(safeLimit)
      .toArray();
  }
}
