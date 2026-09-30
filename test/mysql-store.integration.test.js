import test from "node:test";
import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import { randomUUID } from "node:crypto";
import { MySqlTransactionStore } from "../src/mysql-store.js";

const runIntegration = process.env.RUN_INTEGRATION_TESTS === "true";
const mysqlUrl = process.env.MYSQL_URL ?? "";

test(
  "MySQL store enforces idempotency, lifecycle, and outbox semantics",
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
      const sql = await fs.readFile("db/mysql/001_init.sql", "utf8");
      await connection.query(sql);
    } finally {
      connection.release();
      await pool.end();
    }

    const store = new MySqlTransactionStore({
      url: mysqlUrl,
      maxPoolSize: 4,
      ssl: false,
      workerId: "worker-a"
    });

    const competingStore = new MySqlTransactionStore({
      url: mysqlUrl,
      maxPoolSize: 4,
      ssl: false,
      workerId: "worker-b"
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

      const submitted = await store.transition(id, "SUBMITTED", {
        txHash: "0x2222222222222222222222222222222222222222222222222222222222222222"
      });

      assert.equal(submitted.status, "SUBMITTED");
      assert.equal(submitted.attempts, 1);

      const events = await store.claimOutboxBatch(50);
      assert.equal(events.length >= 2, true);

      const competingEvents = await competingStore.claimOutboxBatch(50);
      assert.equal(
        competingEvents.some((event) => events.some((claimed) => claimed.id === event.id)),
        false
      );

      const confirmed = await store.transition(id, "CONFIRMED");

      assert.equal(confirmed.status, "CONFIRMED");
      assert.equal(
        confirmed.txHash,
        "0x2222222222222222222222222222222222222222222222222222222222222222"
      );

      await assert.rejects(
        () => store.transition(id, "FAILED", { failureReason: "too late" }),
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
