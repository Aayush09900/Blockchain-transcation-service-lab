import test from "node:test";
import assert from "node:assert/strict";
import { MongoAuditStore } from "../src/mongo-audit-store.js";

const runIntegration = process.env.RUN_INTEGRATION_TESTS === "true";
const mongoUrl = process.env.MONGO_URL ?? "";

test(
  "MongoDB audit store is idempotent and queryable",
  { skip: !runIntegration || !mongoUrl },
  async () => {
    const databaseName =
      process.env.MONGO_TEST_DATABASE ?? "blockchain_transaction_audit_test";

    const store = new MongoAuditStore({
      url: mongoUrl,
      databaseName,
      maxPoolSize: 4
    });

    await store.connect();

    const transactionId = "00000000-0000-4000-8000-000000000001";

    try {
      const event = {
        eventId: "00000000-0000-4000-8000-000000000002",
        transactionId,
        eventType: "TEST_EVENT",
        payload: {
          status: "CREATED"
        },
        occurredAt: "2026-01-01T00:00:00.000Z"
      };

      assert.equal(await store.appendEvent(event), true);
      assert.equal(await store.appendEvent(event), false);

      await store.upsertSnapshot({
        id: transactionId,
        from: "0x0000000000000000000000000000000000000001",
        to: "0x0000000000000000000000000000000000000002",
        amount: "1",
        status: "CREATED",
        txHash: null,
        attempts: 0,
        failureReason: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      });

      await store.upsertSnapshot({
        id: transactionId,
        from: "0x0000000000000000000000000000000000000001",
        to: "0x0000000000000000000000000000000000000002",
        amount: "1",
        status: "CONFIRMED",
        txHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
        attempts: 2,
        failureReason: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:02.000Z"
      });

      await store.upsertSnapshot({
        id: transactionId,
        from: "0x0000000000000000000000000000000000000001",
        to: "0x0000000000000000000000000000000000000002",
        amount: "1",
        status: "CREATED",
        txHash: null,
        attempts: 0,
        failureReason: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:01.000Z"
      });

      const events = await store.listEvents(transactionId);

      assert.equal(events.length, 1);
      assert.equal(events[0].eventId, event.eventId);
      assert.equal(events[0].occurredAt.toISOString(), "2026-01-01T00:00:00.000Z");

      const snapshot = await store.transactions.findOne({ transactionId });

      assert.equal(snapshot.status, "CONFIRMED");
      assert.equal(snapshot.txHash, "0x1111111111111111111111111111111111111111111111111111111111111111");
    } finally {
      await store.close();
    }
  }
);
