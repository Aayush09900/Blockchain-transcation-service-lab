import test from "node:test";
import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import { randomUUID } from "node:crypto";
import { MySqlTransactionStore } from "../src/mysql-store.js";

const runIntegration = process.env.RUN_INTEGRATION_TESTS === "true";
const mysqlUrl = process.env.MYSQL_URL ?? "";

async function poolForTest(url, callback) {
  const parsed = new URL(url);
  const testPool = mysql.createPool({
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 3306,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: decodeURIComponent(parsed.pathname.replace(/^\//, ""))
  });

  try {
    return await callback(testPool);
  } finally {
    await testPool.end();
  }
}

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
      for (const schemaFile of [
        "db/mysql/001_init.sql",
        "db/mysql/005_rate_limit_clients.sql"
      ]) {
        const sql = await fs.readFile(schemaFile, "utf8");
        await connection.query(sql);
      }
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

    await poolForTest(mysqlUrl, async (testPool) => {
      await testPool.query("TRUNCATE TABLE rate_limit_clients");
    });

    const rateLimitKey = "integration-rate-" + id;
    const rateLimitOptions = {
      windowMs: 1_000,
      maxRequests: 2,
      maxClients: 10
    };

    assert.equal(
      (
        await store.consumeRateLimit(
          rateLimitKey,
          rateLimitOptions
        )
      ).allowed,
      true
    );

    assert.equal(
      (
        await store.consumeRateLimit(
          rateLimitKey,
          rateLimitOptions
        )
      ).allowed,
      true
    );

    const globallyDenied = await competingStore.consumeRateLimit(
      rateLimitKey,
      rateLimitOptions
    );

    assert.equal(globallyDenied.allowed, false);
    assert.equal(globallyDenied.remaining, 0);
    assert.equal(globallyDenied.retryAfterSeconds >= 1, true);

    await new Promise((resolve) => setTimeout(resolve, 1_100));

    assert.equal(
      (
        await competingStore.consumeRateLimit(
          rateLimitKey,
          rateLimitOptions
        )
      ).allowed,
      true
    );

    const capOptions = {
      windowMs: 60_000,
      maxRequests: 10,
      maxClients: 2
    };

    await poolForTest(mysqlUrl, async (testPool) => {
      await testPool.query("TRUNCATE TABLE rate_limit_clients");
    });

    await store.consumeRateLimit("cap-a-" + id, capOptions);
    await store.consumeRateLimit("cap-b-" + id, capOptions);
    await store.consumeRateLimit("cap-c-" + id, capOptions);

    await poolForTest(mysqlUrl, async (testPool) => {
      const [rows] = await testPool.execute(
        "SELECT COUNT(*) AS client_count FROM rate_limit_clients"
      );

      assert.equal(Number(rows[0].client_count) <= 2, true);
    });

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

      let releaseFirst;
      let firstEntered;
      const firstEnteredPromise = new Promise((resolve) => {
        firstEntered = resolve;
      });
      const releaseFirstPromise = new Promise((resolve) => {
        releaseFirst = resolve;
      });
      const lockEvents = [];

      const firstLock = store.withAdvisoryLock(
        "integration-blockchain-signer",
        5,
        async () => {
          lockEvents.push("first-start");
          firstEntered();
          await releaseFirstPromise;
          lockEvents.push("first-end");
        }
      );

      await firstEnteredPromise;

      const secondLock = competingStore.withAdvisoryLock(
        "integration-blockchain-signer",
        5,
        async () => {
          lockEvents.push("second-start");
          lockEvents.push("second-end");
        }
      );

      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.deepEqual(lockEvents, ["first-start"]);

      releaseFirst();

      await Promise.all([firstLock, secondLock]);
      assert.deepEqual(lockEvents, [
        "first-start",
        "first-end",
        "second-start",
        "second-end"
      ]);

      const submitted = await store.transition(id, "SUBMITTED", {
        txHash: "0x2222222222222222222222222222222222222222222222222222222222222222"
      });

      assert.equal(submitted.status, "SUBMITTED");
      assert.equal(submitted.attempts, 1);

      const staleId = randomUUID();
      await store.createOrGet({
        id: staleId,
        idempotencyKey: "stale-" + staleId,
        from: "0x0000000000000000000000000000000000000001",
        to: "0x0000000000000000000000000000000000000002",
        amount: "1"
      });
      await store.transition(staleId, "BROADCASTING");

      await poolForTest(mysqlUrl, async (testPool) => {
        await testPool.execute(
          "UPDATE transactions SET updated_at = CURRENT_TIMESTAMP(6) - INTERVAL 2 HOUR WHERE id = ?",
          [staleId]
        );
      });

      const stale = await store.listStaleBroadcasting(
        new Date(Date.now() - 60 * 60 * 1000),
        10
      );
      assert.equal(stale.some((row) => row.id === staleId), true);
      assert.equal(stale[0]?.reconciliationRequiredAt, null);

      assert.equal(
        await store.markBroadcastReconciliationRequired(
          staleId,
          "broadcast outcome unresolved"
        ),
        true
      );
      assert.equal(
        await store.markBroadcastReconciliationRequired(
          staleId,
          "broadcast outcome unresolved again"
        ),
        false
      );

      const marked = await store.get(staleId);
      assert.ok(marked.reconciliationRequiredAt);
      assert.equal(marked.reconciliationReason, "broadcast outcome unresolved");

      const noLongerUnmarked = await store.listStaleBroadcasting(
        new Date(Date.now() - 60 * 60 * 1000),
        10
      );
      assert.equal(noLongerUnmarked.some((row) => row.id === staleId), false);

      const recoveredStale = await store.transition(staleId, "SUBMITTED", {
        txHash: "0x4444444444444444444444444444444444444444444444444444444444444444"
      });
      assert.equal(recoveredStale.status, "SUBMITTED");
      assert.equal(recoveredStale.reconciliationRequiredAt, null);
      assert.equal(recoveredStale.reconciliationReason, null);

      const events = await store.claimOutboxBatch(50);
      assert.equal(events.length >= 2, true);

      const competingEvents = await competingStore.claimOutboxBatch(50);
      assert.equal(
        competingEvents.some((event) => events.some((claimed) => claimed.id === event.id)),
        false
      );

      const reclaimedEvent = events[0];
      await poolForTest(mysqlUrl, async (testPool) => {
        await testPool.execute(
          "UPDATE transaction_outbox SET claimed_until = CURRENT_TIMESTAMP(6) - INTERVAL 1 SECOND WHERE id = ?",
          [reclaimedEvent.id]
        );
      });

      const recoveredEvents = await competingStore.claimOutboxBatch(1);
      assert.equal(recoveredEvents[0]?.id, reclaimedEvent.id);

      await store.markOutboxPublished(reclaimedEvent.id);

      await poolForTest(mysqlUrl, async (testPool) => {
        const [rows] = await testPool.execute(
          "SELECT claimed_by, published_at FROM transaction_outbox WHERE id = ?",
          [reclaimedEvent.id]
        );
        assert.equal(rows[0]?.claimed_by, "worker-b");
        assert.equal(rows[0]?.published_at, null);
      });

      await competingStore.markOutboxPublished(reclaimedEvent.id);

      const confirmed = await store.transition(id, "CONFIRMED", {
        confirmedBlockNumber: 123,
        confirmedBlockHash:
          "0x3333333333333333333333333333333333333333333333333333333333333333"
      });

      assert.equal(confirmed.status, "CONFIRMED");
      assert.equal(confirmed.confirmedBlockNumber, 123);
      assert.equal(
        confirmed.confirmedBlockHash,
        "0x3333333333333333333333333333333333333333333333333333333333333333"
      );
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
