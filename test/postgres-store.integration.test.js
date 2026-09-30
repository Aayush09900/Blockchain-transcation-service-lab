import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { PostgresTransactionStore } from "../src/postgres-store.js";

const runIntegration = process.env.RUN_INTEGRATION_TESTS === "true";
const databaseUrl = process.env.DATABASE_URL ?? "";

test(
  "PostgreSQL store enforces idempotency, lifecycle, and attempt tracking",
  { skip: !runIntegration || !databaseUrl },
  async () => {
    const { Client } = pg;
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();

    try {
      const fs = await import("node:fs/promises");
      const sql = await fs.readFile("db/001_init.sql", "utf8");
      await client.query(sql);
    } finally {
      await client.end();
    }

    const store = new PostgresTransactionStore({
      connectionString: databaseUrl,
      ssl: false
    });

    const id = randomUUID();
    const key = "integration-" + id;

    try {
      const first = await store.createOrGet({
        id,
        idempotencyKey: key,
        from: "0xsender",
        to: "0xreceiver",
        amount: "12345678901234567890.00"
      });

      assert.equal(first.status, "CREATED");
      assert.equal(first.amount, "12345678901234567890");

      const duplicate = await store.createOrGet({
        id: randomUUID(),
        idempotencyKey: key,
        from: "0xsender",
        to: "0xreceiver",
        amount: "12345678901234567890"
      });

      assert.equal(duplicate.id, id);

      await assert.rejects(
        () =>
          store.createOrGet({
            id: randomUUID(),
            idempotencyKey: key,
            from: "0xsender",
            to: "0xother",
            amount: "12345678901234567890"
          }),
        /idempotency key was already used/
      );

      const submitted = await store.transition(id, "SUBMITTED", {
        txHash: "0xintegrationhash"
      });

      assert.equal(submitted.status, "SUBMITTED");
      assert.equal(submitted.attempts, 1);

      const confirmed = await store.transition(id, "CONFIRMED");

      assert.equal(confirmed.status, "CONFIRMED");
      assert.equal(confirmed.txHash, "0xintegrationhash");

      await assert.rejects(
        () => store.transition(id, "FAILED", { failureReason: "too late" }),
        /invalid transition/
      );
    } finally {
      await store.close();
    }
  }
);
