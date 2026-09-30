import { MongoClient } from "mongodb";

export class MongoAuditStore {
  constructor({
    url = process.env.MONGO_URL,
    databaseName = process.env.MONGO_DATABASE ?? "blockchain_transaction_audit",
    maxPoolSize = Number.parseInt(process.env.MONGO_MAX_POOL_SIZE ?? "20", 10),
    tls = process.env.MONGO_TLS === "true"
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
      tls,
      appName: "blockchain-transaction-service"
    });

    this.databaseName = databaseName;
    this.events = null;
    this.transactions = null;
    this.connected = false;
  }

  async connect() {
    if (this.connected) return;

    await this.client.connect();

    const database = this.client.db(this.databaseName);

    this.events = database.collection("transaction_events");
    this.transactions = database.collection("transaction_snapshots");

    await this.events.createIndex(
      { eventId: 1 },
      { unique: true, name: "ux_transaction_event_id" }
    );

    await this.events.createIndex(
      { transactionId: 1, occurredAt: -1, createdAt: -1 },
      { name: "ix_transaction_events_tx_occurred" }
    );

    await this.transactions.createIndex(
      { transactionId: 1 },
      { unique: true, name: "ux_transaction_snapshot_id" }
    );

    this.connected = true;
  }

  async ensureConnected() {
    if (!this.connected) {
      await this.connect();
    }
  }

  async close() {
    await this.client.close();
    this.connected = false;
  }

  async healthCheck() {
    await this.ensureConnected();
    await this.client.db(this.databaseName).command({ ping: 1 });
    return true;
  }

  async appendEvent(event) {
    await this.ensureConnected();

    const document = {
      eventId: String(event.eventId),
      transactionId: String(event.transactionId),
      eventType: String(event.eventType),
      payload: event.payload,
      occurredAt: event.occurredAt ? new Date(event.occurredAt) : new Date(),
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
    await this.ensureConnected();

    const updatedAt = new Date(transaction.updatedAt);
    const createdAt = new Date(transaction.createdAt);

    await this.transactions.updateOne(
      { transactionId: transaction.id },
      [
        {
          $set: {
            transactionId: transaction.id,
            createdAt: {
              $cond: [
                { $eq: [{ $type: "$createdAt" }, "missing"] },
                createdAt,
                "$createdAt"
              ]
            },
            status: {
              $cond: [
                {
                  $or: [
                    { $eq: [{ $type: "$updatedAt" }, "missing"] },
                    { $lt: ["$updatedAt", updatedAt] }
                  ]
                },
                transaction.status,
                "$status"
              ]
            },
            from: {
              $cond: [
                {
                  $or: [
                    { $eq: [{ $type: "$updatedAt" }, "missing"] },
                    { $lt: ["$updatedAt", updatedAt] }
                  ]
                },
                transaction.from,
                "$from"
              ]
            },
            to: {
              $cond: [
                {
                  $or: [
                    { $eq: [{ $type: "$updatedAt" }, "missing"] },
                    { $lt: ["$updatedAt", updatedAt] }
                  ]
                },
                transaction.to,
                "$to"
              ]
            },
            amount: {
              $cond: [
                {
                  $or: [
                    { $eq: [{ $type: "$updatedAt" }, "missing"] },
                    { $lt: ["$updatedAt", updatedAt] }
                  ]
                },
                transaction.amount,
                "$amount"
              ]
            },
            txHash: {
              $cond: [
                {
                  $or: [
                    { $eq: [{ $type: "$updatedAt" }, "missing"] },
                    { $lt: ["$updatedAt", updatedAt] }
                  ]
                },
                transaction.txHash ?? null,
                "$txHash"
              ]
            },
            attempts: {
              $cond: [
                {
                  $or: [
                    { $eq: [{ $type: "$updatedAt" }, "missing"] },
                    { $lt: ["$updatedAt", updatedAt] }
                  ]
                },
                transaction.attempts,
                "$attempts"
              ]
            },
            failureReason: {
              $cond: [
                {
                  $or: [
                    { $eq: [{ $type: "$updatedAt" }, "missing"] },
                    { $lt: ["$updatedAt", updatedAt] }
                  ]
                },
                transaction.failureReason ?? null,
                "$failureReason"
              ]
            },
            updatedAt: {
              $cond: [
                {
                  $or: [
                    { $eq: [{ $type: "$updatedAt" }, "missing"] },
                    { $lt: ["$updatedAt", updatedAt] }
                  ]
                },
                updatedAt,
                "$updatedAt"
              ]
            }
          }
        }
      ],
      {
        upsert: true,
        writeConcern: { w: "majority" }
      }
    );
  }

  async listEvents(transactionId, limit = 100) {
    await this.ensureConnected();

    const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 500));

    return this.events
      .find({ transactionId })
      .sort({ occurredAt: -1, createdAt: -1 })
      .limit(safeLimit)
      .toArray();
  }
}
