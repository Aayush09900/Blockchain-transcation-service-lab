import mysql from "mysql2/promise";
import { randomUUID } from "node:crypto";
import {
  requireNonEmptyString,
  validateTransactionInput,
  validateTransactionHash,
  validateBlockHash,
  validateBlockNumber
} from "./validation.js";

const transitions = {
  CREATED: new Set(["BROADCASTING", "SUBMITTED", "FAILED"]),
  BROADCASTING: new Set(["SUBMITTED", "FAILED" ]),
  SUBMITTED: new Set(["CONFIRMED", "FAILED"]),
  CONFIRMED: new Set(["REORGED"]),
  REORGED: new Set(["SUBMITTED", "CONFIRMED"]),
  FAILED: new Set([])
};

export class MySqlTransactionStore {
  constructor({
    url = process.env.MYSQL_URL,
    maxPoolSize = 10,
    ssl = process.env.MYSQL_SSL === "true",
    workerId = randomUUID(),
    leaseMs = 60_000
  } = {}) {
    if (!url) {
      const error = new Error("MYSQL_URL is required");
      error.code = "CONFIG_ERROR";
      error.statusCode = 500;
      throw error;
    }

    const parsed = new URL(url);

    const normalizedLeaseMs = Number(leaseMs);

    if (!Number.isFinite(normalizedLeaseMs) || normalizedLeaseMs < 10_000 || normalizedLeaseMs > 900_000) {
      const error = new Error("leaseMs must be between 10000 and 900000 milliseconds");
      error.code = "CONFIG_ERROR";
      error.statusCode = 500;
      throw error;
    }

    this.workerId = String(workerId).slice(0, 64);
    this.leaseMs = Math.trunc(normalizedLeaseMs);

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

  async withAdvisoryLock(lockName, timeoutSeconds, fn) {
    const connection = await this.pool.getConnection();

    try {
      const safeTimeout = Number(timeoutSeconds);

      if (!Number.isInteger(safeTimeout) || safeTimeout < 1 || safeTimeout > 30) {
        const error = new Error("timeoutSeconds must be between 1 and 30");
        error.code = "CONFIG_ERROR";
        error.statusCode = 500;
        throw error;
      }

      const [rows] = await connection.execute(
        "SELECT GET_LOCK(?, ?) AS acquired",
        [String(lockName), safeTimeout]
      );

      if (Number(rows[0]?.acquired) !== 1) {
        const error = new Error("blockchain signer lock is unavailable");
        error.code = "BLOCKCHAIN_SIGNER_LOCK_UNAVAILABLE";
        error.statusCode = 503;
        throw error;
      }

      try {
        return await fn();
      } finally {
        await connection.execute("SELECT RELEASE_LOCK(?) AS released", [
          String(lockName)
        ]);
      }
    } finally {
      connection.release();
    }
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

  async listStaleBroadcasting(before, limit = 100) {
    if (!(before instanceof Date) || Number.isNaN(before.getTime())) {
      const error = new Error("before must be a valid Date");
      error.code = "VALIDATION_ERROR";
      error.statusCode = 400;
      throw error;
    }

    const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 500));

    const [rows] = await this.pool.query(
      `SELECT *
       FROM transactions
       WHERE status = 'BROADCASTING'
         AND updated_at < ?
         AND reconciliation_required_at IS NULL
       ORDER BY updated_at ASC
       LIMIT ?`,
      [before, safeLimit]
    );

    return rows.map(mapRow);
  }

  async markBroadcastReconciliationRequired(id, reason) {
    const normalizedReason = requireNonEmptyString(
      reason,
      "reason",
      500
    );

    const [result] = await this.pool.execute(
      `UPDATE transactions
       SET reconciliation_required_at = CURRENT_TIMESTAMP(6),
           reconciliation_reason = ?
       WHERE id = ?
         AND status = 'BROADCASTING'
         AND reconciliation_required_at IS NULL`,
      [normalizedReason, id]
    );

    return Number(result.affectedRows) === 1;
  }

  async listConfirmed(limit = 100) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 500));

    const [rows] = await this.pool.query(
      `SELECT *
       FROM transactions
       WHERE status = 'CONFIRMED'
         AND confirmed_block_number IS NOT NULL
         AND confirmed_block_hash IS NOT NULL
       ORDER BY confirmed_block_number DESC
       LIMIT ?`,
      [safeLimit]
    );

    return rows.map(mapRow);
  }

  async listReorged(limit = 100) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 500));

    const [rows] = await this.pool.query(
      `SELECT *
       FROM transactions
       WHERE status = 'REORGED'
         AND tx_hash IS NOT NULL
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

      const hasBlockEvidence =
        patch.confirmedBlockNumber !== undefined ||
        patch.confirmedBlockHash !== undefined;

      if (
        nextStatus === "CONFIRMED" &&
        hasBlockEvidence &&
        (patch.confirmedBlockNumber === undefined ||
          patch.confirmedBlockHash === undefined)
      ) {
        const error = new Error(
          "confirmed block number and hash must be provided together"
        );
        error.code = "VALIDATION_ERROR";
        error.statusCode = 400;
        throw error;
      }

      const confirmedBlockNumber =
        nextStatus === "CONFIRMED" && hasBlockEvidence
          ? validateBlockNumber(patch.confirmedBlockNumber)
          : nextStatus === "REORGED"
            ? null
            : current.confirmed_block_number;

      const confirmedBlockHash =
        nextStatus === "CONFIRMED" && hasBlockEvidence
          ? validateBlockHash(patch.confirmedBlockHash)
          : nextStatus === "REORGED"
            ? null
            : current.confirmed_block_hash;

      const failureReason =
        nextStatus === "FAILED" || nextStatus === "REORGED"
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
             confirmed_block_number = ?,
             confirmed_block_hash = ?,
             failure_reason = ?,
             reconciliation_required_at = NULL,
             reconciliation_reason = NULL,
             attempts = ?,
             updated_at = CURRENT_TIMESTAMP(6)
         WHERE id = ?`,
        [
          nextStatus,
          txHash,
          confirmedBlockNumber,
          confirmedBlockHash,
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
    const connection = await this.pool.getConnection();
    const leaseUntil = new Date(Date.now() + this.leaseMs);

    try {
      await connection.beginTransaction();

      const [rows] = await connection.query(
        `SELECT id
         FROM transaction_outbox
         WHERE published_at IS NULL
           AND dead_lettered_at IS NULL
           AND (next_attempt_at IS NULL OR next_attempt_at <= CURRENT_TIMESTAMP(6))
           AND (claimed_until IS NULL OR claimed_until < CURRENT_TIMESTAMP(6))
         ORDER BY id ASC
         LIMIT ?
         FOR UPDATE SKIP LOCKED`,
        [safeLimit]
      );

      if (rows.length === 0) {
        await connection.commit();
        return [];
      }

      for (const row of rows) {
        await connection.execute(
          `UPDATE transaction_outbox
           SET claimed_by = ?,
               claimed_until = ?
           WHERE id = ?
             AND published_at IS NULL
             AND dead_lettered_at IS NULL`,
          [this.workerId, leaseUntil, row.id]
        );
      }

      const ids = rows.map((row) => row.id);
      const placeholders = ids.map(() => "?").join(", ");

      const [claimedRows] = await connection.query(
        `SELECT id, event_id, transaction_id, event_type, payload, created_at, claimed_by
         FROM transaction_outbox
         WHERE id IN (${placeholders})
           AND claimed_by = ?
         ORDER BY id ASC`,
        [...ids, this.workerId]
      );

      await connection.commit();
      return claimedRows;
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
  }

  async markOutboxPublished(id) {
    await this.pool.execute(
      `UPDATE transaction_outbox
       SET published_at = CURRENT_TIMESTAMP(6),
           attempts = attempts + 1,
           last_error = NULL,
           next_attempt_at = NULL,
           claimed_by = NULL,
           claimed_until = NULL
       WHERE id = ?
         AND published_at IS NULL
         AND claimed_by = ?`,
      [id, this.workerId]
    );
  }

  async markOutboxFailed(id, message) {
    const [rows] = await this.pool.execute(
      `SELECT attempts
       FROM transaction_outbox
       WHERE id = ?
         AND published_at IS NULL
         AND claimed_by = ?`,
      [id, this.workerId]
    );

    if (rows.length === 0) return;

    const attempts = Number(rows[0].attempts) + 1;
    const maxAttempts = 10;

    if (attempts >= maxAttempts) {
      await this.pool.execute(
        `UPDATE transaction_outbox
         SET attempts = ?,
             last_error = ?,
             dead_lettered_at = CURRENT_TIMESTAMP(6),
             next_attempt_at = NULL,
             claimed_by = NULL,
             claimed_until = NULL
         WHERE id = ?
           AND published_at IS NULL
           AND claimed_by = ?`,
        [attempts, String(message).slice(0, 1000), id, this.workerId]
      );
      return;
    }

    const delaySeconds = Math.min(3600, 2 ** Math.min(attempts, 12));
    const nextAttemptAt = new Date(Date.now() + delaySeconds * 1000);

    await this.pool.execute(
      `UPDATE transaction_outbox
       SET attempts = ?,
           last_error = ?,
           next_attempt_at = ?,
           claimed_by = NULL,
           claimed_until = NULL
       WHERE id = ?
         AND published_at IS NULL
         AND claimed_by = ?`,
      [
        attempts,
        String(message).slice(0, 1000),
        nextAttemptAt,
        id,
        this.workerId
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
    confirmedBlockNumber:
      row.confirmed_block_number === null ||
      row.confirmed_block_number === undefined
        ? null
        : Number(row.confirmed_block_number),
    confirmedBlockHash: row.confirmed_block_hash,
    failureReason: row.failure_reason,
    reconciliationRequiredAt:
      row.reconciliation_required_at === null ||
      row.reconciliation_required_at === undefined
        ? null
        : new Date(row.reconciliation_required_at).toISOString(),
    reconciliationReason: row.reconciliation_reason,
    attempts: Number(row.attempts),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  };
}
