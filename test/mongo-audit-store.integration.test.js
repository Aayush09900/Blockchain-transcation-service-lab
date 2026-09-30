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
        }
      };

      assert.equal(await store.appendEvent(event), true);
      assert.equal(await store.appendEvent(event), false);

      await store.upsertSnapshot({
        id: transactionId,
        from: "0xsender",
        to: "0xreceiver",
        amount: "1",
        status: "CREATED",
        txHash: null,
        attempts: 0,
        failureReason: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      const events = await store.listEvents(transactionId);

      assert.equal(events.length, 1);
      assert.equal(events[0].eventId, event.eventId);
    } finally {
      await store.close();
    }
  }
);
