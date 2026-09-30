import mysql from "mysql2/promise";
import { randomUUID } from "node:crypto";
import {
  requireNonEmptyString,
  validateTransactionInput,
  validateTransactionHash
} from "./validation.js";

const transitions = {
  CREATED: new Set(["BROADCASTING", "SUBMITTED", "FAILED"]),
  BROADCASTING: new Set(["SUBMITTED", "FAILED" ]),
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

      const [insertResult] = await connection.execute(
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

      let row;

      if (insertResult.affectedRows === 1) {
        const [created] = await connection.execute(
          "SELECT * FROM transactions WHERE idempotency_key = ? FOR UPDATE",
          [input.idempotencyKey]
        );
        row = created[0];

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
      } else {
        const [existing] = await connection.execute(
          "SELECT * FROM transactions WHERE idempotency_key = ? FOR UPDATE",
          [input.idempotencyKey]
        );

        if (existing.length === 0) {
          const error = new Error("transaction persistence race");
          error.code = "PERSISTENCE_CONFLICT";
          error.statusCode = 503;
          throw error;
        }

        row = existing[0];

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

  async claimOutboxBatch(limit = 50) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 500));
    const [rows] = await this.pool.query(
      `SELECT id, event_id, transaction_id, event_type, payload
       FROM transaction_outbox
       WHERE published_at IS NULL
         AND dead_lettered_at IS NULL
         AND (next_attempt_at IS NULL OR next_attempt_at <= CURRENT_TIMESTAMP(6))
       ORDER BY id ASC
       LIMIT ?`,
      [safeLimit]
    );

    return rows;
  }

  async markOutboxPublished(id) {
    await this.pool.execute(
      `UPDATE transaction_outbox
       SET published_at = CURRENT_TIMESTAMP(6),
           attempts = attempts + 1,
           last_error = NULL,
           next_attempt_at = NULL
       WHERE id = ? AND published_at IS NULL`,
      [id]
    );
  }

  async markOutboxFailed(id, message) {
    const attemptsResult = await this.pool.execute(
      "SELECT attempts FROM transaction_outbox WHERE id = ? AND published_at IS NULL",
      [id]
    );

    if (attemptsResult[0].length === 0) return;

    const attempts = Number(attemptsResult[0][0].attempts) + 1;
    const maxAttempts = 10;

    if (attempts >= maxAttempts) {
      await this.pool.execute(
        `UPDATE transaction_outbox
         SET attempts = ?,
             last_error = ?,
             dead_lettered_at = CURRENT_TIMESTAMP(6),
             next_attempt_at = NULL
         WHERE id = ? AND published_at IS NULL`,
        [
          attempts,
          String(message).slice(0, 1000),
          id
        ]
      );
      return;
    }

    const delaySeconds = Math.min(3600, 2 ** Math.min(attempts, 12));
    const nextAttemptAt = new Date(Date.now() + delaySeconds * 1000);

    await this.pool.execute(
      `UPDATE transaction_outbox
       SET attempts = ?,
           last_error = ?,
           next_attempt_at = ?
       WHERE id = ? AND published_at IS NULL`,
      [
        attempts,
        String(message).slice(0, 1000),
        nextAttemptAt,
        id
      ]
    );
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
