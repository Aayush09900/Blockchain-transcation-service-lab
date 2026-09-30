import mysql from "mysql2/promise";
import { randomUUID } from "node:crypto";
import {
  requireNonEmptyString,
  validateTransactionInput,
  validateTransactionHash
} from "./validation.js";

const transitions = {
  CREATED: new Set(["BROADCASTING", "FAILED"]),
  BROADCASTING: new Set(["SUBMITTED", "FAILED"]),
  SUBMITTED: new Set(["CONFIRMED", "FAILED"]),
  CONFIRMED: new Set([]),
  FAILED: new Set([])
};

export class MySqlTransactionStore {
  constructor({
    url = process.env.MYSQL_URL,
    maxPoolSize = 10,
    ssl = process.env.MYSQL_SSL === "true"
  } = {}) {
    if (!url) {
      const error = new Error("MYSQL_URL is required");
      error.code = "CONFIG_ERROR";
      error.statusCode = 500;
      throw error;
    }

    const parsed = new URL(url);

    this.pool = mysql.createPool({
      host: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : 3306,
      user: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
      database: decodeURIComponent(parsed.pathname.replace(/^\//, "")),
      waitForConnections: true,
      connectionLimit: maxPoolSize,
      maxIdle: maxPoolSize,
      idleTimeout: 60_000,
      queueLimit: 0,
      decimalNumbers: false,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
      ssl: ssl ? { rejectUnauthorized: true } : undefined
    });
  }

  async close() {
    await this.pool.end();
  }

  async healthCheck() {
    const [rows] = await this.pool.execute("SELECT 1 AS ok");
    return rows[0]?.ok === 1;
  }

  async createOrGet({ id = randomUUID(), idempotencyKey, from, to, amount }) {
    const input = validateTransactionInput({
      idempotencyKey,
      from,
      to,
      amount
    });

    const connection = await this.pool.getConnection();

    try {
      await connection.beginTransaction();

      await connection.execute(
        `INSERT INTO transactions
          (id, idempotency_key, sender, receiver, amount, status)
         VALUES (?, ?, ?, ?, CAST(? AS DECIMAL(65, 18)), 'CREATED')
         ON DUPLICATE KEY UPDATE id = id`,
        [
          id,
          input.idempotencyKey,
          input.from,
          input.to,
          input.amount
        ]
      );

      const [rows] = await connection.execute(
        "SELECT * FROM transactions WHERE idempotency_key = ? FOR UPDATE",
        [input.idempotencyKey]
      );

      if (rows.length === 0) {
        const error = new Error("transaction persistence race");
        error.code = "PERSISTENCE_CONFLICT";
        error.statusCode = 503;
        throw error;
      }

      const row = rows[0];
      const createdByThisRequest = row.id === id;

      if (
        row.sender !== input.from ||
        row.receiver !== input.to ||
        canonicalDecimal(row.amount) !== input.amount
      ) {
        const error = new Error(
          "idempotency key was already used with a different request"
        );
        error.code = "IDEMPOTENCY_CONFLICT";
        error.statusCode = 409;
        throw error;
      }

      if (createdByThisRequest) {
        await connection.execute(
          `INSERT INTO transaction_outbox
            (event_id, transaction_id, event_type, payload)
           VALUES (?, ?, 'TRANSACTION_CREATED', ?)`,
          [
            randomUUID(),
            row.id,
            JSON.stringify({
              transactionId: row.id,
              status: row.status,
              idempotencyKey: row.idempotency_key
            })
          ]
        );
      }

      await connection.commit();
      return mapRow(row);
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
  }

  async get(id) {
    const normalizedId = requireNonEmptyString(id, "id", 64);

    const [rows] = await this.pool.execute(
      "SELECT * FROM transactions WHERE id = ?",
      [normalizedId]
    );

    if (rows.length === 0) {
      const error = new Error("transaction not found");
      error.code = "NOT_FOUND";
      error.statusCode = 404;
      throw error;
    }

    return mapRow(rows[0]);
  }

  async listBroadcasting(limit = 100) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 500));

    const [rows] = await this.pool.query(
      `SELECT *
       FROM transactions
       WHERE status = 'BROADCASTING'
       ORDER BY updated_at ASC
       LIMIT ?`,
      [safeLimit]
    );

    return rows.map(mapRow);
  }

  async listSubmitted(limit = 100) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 500));

    const [rows] = await this.pool.query(
      `SELECT *
       FROM transactions
       WHERE status = 'SUBMITTED'
         AND tx_hash IS NOT NULL
       ORDER BY updated_at ASC
       LIMIT ?`,
      [safeLimit]
    );

    return rows.map(mapRow);
  }

  async transition(id, nextStatus, patch = {}) {
    const connection = await this.pool.getConnection();

    try {
      await connection.beginTransaction();

      const [rows] = await connection.execute(
        "SELECT * FROM transactions WHERE id = ? FOR UPDATE",
        [id]
      );

      if (rows.length === 0) {
        const error = new Error("transaction not found");
        error.code = "NOT_FOUND";
        error.statusCode = 404;
        throw error;
      }

      const current = rows[0];

      if (current.status === nextStatus) {
        if (
          nextStatus === "SUBMITTED" &&
          patch.txHash &&
          current.tx_hash &&
          current.tx_hash !== patch.txHash
        ) {
          const error = new Error("transaction hash mismatch");
          error.code = "TX_HASH_MISMATCH";
          error.statusCode = 409;
          throw error;
        }

        await connection.commit();
        return mapRow(current);
      }

      if (!transitions[current.status]?.has(nextStatus)) {
        const error = new Error(
          `invalid transition: ${current.status} -> ${nextStatus}`
        );
        error.code = "INVALID_TRANSITION";
        error.statusCode = 409;
        throw error;
      }

      const txHash =
        patch.txHash === undefined
          ? current.tx_hash
          : validateTransactionHash(patch.txHash);

      const failureReason =
        nextStatus === "FAILED"
          ? requireNonEmptyString(
              patch.failureReason ?? "transaction failed",
              "failureReason",
              500
            )
          : null;

      const attempts =
        nextStatus === "SUBMITTED"
          ? Number(current.attempts) + 1
          : Number(current.attempts);

      await connection.execute(
        `UPDATE transactions
         SET status = ?,
             tx_hash = ?,
             failure_reason = ?,
             attempts = ?,
             updated_at = CURRENT_TIMESTAMP(6)
         WHERE id = ?`,
        [
          nextStatus,
          txHash,
          failureReason,
          attempts,
          id
        ]
      );

      await connection.execute(
        `INSERT INTO transaction_outbox
          (event_id, transaction_id, event_type, payload)
         VALUES (?, ?, ?, ?)`,
        [
          randomUUID(),
          id,
          `TRANSACTION_${nextStatus}`,
          JSON.stringify({
            transactionId: id,
            previousStatus: current.status,
            nextStatus,
            txHash,
            attempts,
            failureReason
          })
        ]
      );

      await connection.commit();
      return this.get(id);
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
  }

  async claimOutboxBatch(limit = 50, leaseMs = 30_000) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 500));
    const safeLeaseMs = Math.max(
      1_000,
      Math.min(Number(leaseMs) || 30_000, 300_000)
    );

    const connection = await this.pool.getConnection();

    try {
      await connection.beginTransaction();

      const [rows] = await connection.query(
        `SELECT id, event_id, transaction_id, event_type, payload, attempts
         FROM transaction_outbox
         WHERE published_at IS NULL
           AND dead_lettered_at IS NULL
           AND (next_attempt_at IS NULL OR next_attempt_at <= CURRENT_TIMESTAMP(6))
           AND (lease_expires_at IS NULL OR lease_expires_at <= CURRENT_TIMESTAMP(6))
         ORDER BY id ASC
         LIMIT ?
         FOR UPDATE SKIP LOCKED`,
        [safeLimit]
      );

      if (rows.length === 0) {
        await connection.commit();
        return [];
      }

      const leaseToken = randomUUID();
      const leaseExpiresAt = new Date(Date.now() + safeLeaseMs);

      for (const row of rows) {
        await connection.execute(
          `UPDATE transaction_outbox
           SET lease_token = ?,
               lease_expires_at = ?
           WHERE id = ?
             AND published_at IS NULL
             AND dead_lettered_at IS NULL`,
          [leaseToken, leaseExpiresAt, row.id]
        );

        row.lease_token = leaseToken;
      }

      await connection.commit();
      return rows;
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
  }

  async markOutboxPublished(id, leaseToken) {
    const [result] = await this.pool.execute(
      `UPDATE transaction_outbox
       SET published_at = CURRENT_TIMESTAMP(6),
           attempts = attempts + 1,
           last_error = NULL,
           next_attempt_at = NULL,
           lease_token = NULL,
           lease_expires_at = NULL
       WHERE id = ?
         AND published_at IS NULL
         AND lease_token = ?`,
      [id, leaseToken]
    );

    return result.affectedRows === 1;
  }

  async markOutboxFailed(id, message, leaseToken) {
    const [rows] = await this.pool.execute(
      `SELECT attempts
       FROM transaction_outbox
       WHERE id = ?
         AND published_at IS NULL
         AND lease_token = ?`,
      [id, leaseToken]
    );

    if (rows.length === 0) return false;

    const attempts = Number(rows[0].attempts) + 1;
    const maxAttempts = 10;
    const boundedMessage = String(message).slice(0, 1000);

    if (attempts >= maxAttempts) {
      const [result] = await this.pool.execute(
        `UPDATE transaction_outbox
         SET attempts = ?,
             last_error = ?,
             dead_lettered_at = CURRENT_TIMESTAMP(6),
             next_attempt_at = NULL,
             lease_token = NULL,
             lease_expires_at = NULL
         WHERE id = ?
           AND published_at IS NULL
           AND lease_token = ?`,
        [attempts, boundedMessage, id, leaseToken]
      );
      return result.affectedRows === 1;
    }

    const delaySeconds = Math.min(3600, 2 ** Math.min(attempts, 12));
    const nextAttemptAt = new Date(Date.now() + delaySeconds * 1000);

    const [result] = await this.pool.execute(
      `UPDATE transaction_outbox
       SET attempts = ?,
           last_error = ?,
           next_attempt_at = ?,
           lease_token = NULL,
           lease_expires_at = NULL
       WHERE id = ?
         AND published_at IS NULL
         AND lease_token = ?`,
      [attempts, boundedMessage, nextAttemptAt, id, leaseToken]
    );

    return result.affectedRows === 1;
  }
}

function canonicalDecimal(value) {
  const stringValue = String(value);

  if (!stringValue.includes(".")) {
    return stringValue;
  }

  return stringValue
    .replace(/0+$/, "")
    .replace(/\.$/, "");
}

function mapRow(row) {
  return {
    id: row.id,
    idempotencyKey: row.idempotency_key,
    from: row.sender,
    to: row.receiver,
    amount: canonicalDecimal(row.amount),
    status: row.status,
    txHash: row.tx_hash,
    failureReason: row.failure_reason,
    attempts: Number(row.attempts),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  };
}
