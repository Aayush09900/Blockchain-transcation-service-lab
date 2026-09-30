import test from "node:test";
import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import { randomUUID } from "node:crypto";
import { MySqlTransactionStore } from "../src/mysql-store.js";

const runIntegration = process.env.RUN_INTEGRATION_TESTS === "true";
const mysqlUrl = process.env.MYSQL_URL ?? "";

test(
  "MySQL store enforces idempotency, lifecycle, and atomic outbox leasing",
  { skip: !runIntegration || !mysqlUrl },
  async () => {
    const parsed = new URL(mysqlUrl);

    const pool = mysql.createPool({
      host: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : 3306,
      user: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
      database: decodeURIComponent(parsed.pathname.replace(/^\//, "")),
      waitForConnections: true,
      connectionLimit: 4,
      multipleStatements: true
    });

    const connection = await pool.getConnection();

    try {
      const fs = await import("node:fs/promises");
      const migrationFiles = (await fs.readdir("db/mysql"))
        .filter((file) => file.endsWith(".sql"))
        .sort();

      for (const file of migrationFiles) {
        const sql = await fs.readFile(`db/mysql/${file}`, "utf8");
        await connection.query(sql);
      }
    } finally {
      connection.release();
      await pool.end();
    }

    const store = new MySqlTransactionStore({
      url: mysqlUrl,
      maxPoolSize: 4,
      ssl: false
    });

    const competingStore = new MySqlTransactionStore({
      url: mysqlUrl,
      maxPoolSize: 4,
      ssl: false
    });

    const id = randomUUID();
    const key = "integration-" + id;

    try {
      const first = await store.createOrGet({
        id,
        idempotencyKey: key,
        from: "0x0000000000000000000000000000000000000001",
        to: "0x0000000000000000000000000000000000000002",
        amount: "1234567890.123456789"
      });

      assert.equal(first.status, "CREATED");
      assert.equal(first.amount, "1234567890.123456789");

      const duplicate = await store.createOrGet({
        id: randomUUID(),
        idempotencyKey: key,
        from: "0x0000000000000000000000000000000000000001",
        to: "0x0000000000000000000000000000000000000002",
        amount: "1234567890.123456789"
      });

      assert.equal(duplicate.id, id);

      await assert.rejects(
        () =>
          store.createOrGet({
            id: randomUUID(),
            idempotencyKey: key,
            from: "0x0000000000000000000000000000000000000001",
            to: "0x0000000000000000000000000000000000000003",
            amount: "1234567890.123456789"
          }),
        /idempotency key was already used/
      );

      const broadcasting = await store.transition(id, "BROADCASTING");
      assert.equal(broadcasting.status, "BROADCASTING");

      const submitted = await store.transition(id, "SUBMITTED", {
        txHash: "0x2222222222222222222222222222222222222222222222222222222222222222"
      });

      assert.equal(submitted.status, "SUBMITTED");
      assert.equal(submitted.attempts, 1);

      const events = await store.claimOutboxBatch(50);
      assert.equal(events.length >= 2, true);
      assert.ok(events.every((event) => event.lease_token));

      const competingEvents = await competingStore.claimOutboxBatch(50);
      const claimedIds = new Set(events.map((event) => event.id));

      assert.equal(
        competingEvents.some((event) => claimedIds.has(event.id)),
        false
      );

      const published = await store.markOutboxPublished(
        events[0].id,
        events[0].lease_token
      );
      assert.equal(published, true);

      assert.equal(
        await store.markOutboxPublished(
          events[0].id,
          events[0].lease_token
        ),
        false
      );

      const confirmed = await store.transition(id, "CONFIRMED");

      assert.equal(confirmed.status, "CONFIRMED");
      assert.equal(
        confirmed.txHash,
        "0x2222222222222222222222222222222222222222222222222222222222222222"
      );

      await assert.rejects(
        () =>
          store.transition(id, "FAILED", {
            failureReason: "too late"
          }),
        /invalid transition/
      );
    } finally {
      await Promise.allSettled([
        store.close(),
        competingStore.close()
      ]);
    }
  }
);
