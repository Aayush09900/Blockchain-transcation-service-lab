import pg from "pg";
import {
  requireNonEmptyString,
  validateTransactionInput
} from "./validation.js";

const { Pool } = pg;

const transitions = {
  CREATED: new Set(["SUBMITTED", "FAILED"]),
  SUBMITTED: new Set(["CONFIRMED", "FAILED"]),
  CONFIRMED: new Set([]),
  FAILED: new Set([])
};

export class PostgresTransactionStore {
  constructor({ connectionString = process.env.DATABASE_URL } = {}) {
    if (!connectionString) {
      throw new Error("DATABASE_URL is required for PostgreSQL persistence");
    }

    this.pool = new Pool({
      connectionString,
      max: Number.parseInt(process.env.DB_POOL_MAX ?? "10", 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      ssl:
        process.env.DB_SSL === "true"
          ? { rejectUnauthorized: true }
          : undefined
    });
  }

  async close() {
    await this.pool.end();
  }

  async healthCheck() {
    const result = await this.pool.query("SELECT 1 AS ok");
    return result.rows[0]?.ok === 1;
  }

  async createOrGet({ id, idempotencyKey, from, to, amount }) {
    const input = validateTransactionInput({
      idempotencyKey,
      from,
      to,
      amount
    });

    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");

      const inserted = await client.query(
        `INSERT INTO transactions
          (id, idempotency_key, sender, receiver, amount, status)
         VALUES ($1, $2, $3, $4, $5, 'CREATED')
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING *`,
        [
          id,
          input.idempotencyKey,
          input.from,
          input.to,
          input.amount
        ]
      );

      if (inserted.rowCount === 0) {
        const existing = await client.query(
          "SELECT * FROM transactions WHERE idempotency_key = $1 FOR UPDATE",
          [input.idempotencyKey]
        );

        if (existing.rowCount === 0) {
          const error = new Error("transaction could not be created");
          error.code = "PERSISTENCE_CONFLICT";
          error.statusCode = 503;
          throw error;
        }

        const row = existing.rows[0];

        if (
          row.sender !== input.from ||
          row.receiver !== input.to ||
          row.amount.toString() !== input.amount
        ) {
          const error = new Error(
            "idempotency key was already used with a different request"
          );
          error.code = "IDEMPOTENCY_CONFLICT";
          error.statusCode = 409;
          throw error;
        }

        await client.query("COMMIT");
        return mapRow(row);
      }

      await client.query(
        `INSERT INTO transaction_events
          (transaction_id, next_status, event_type)
         VALUES ($1, 'CREATED', 'TRANSACTION_CREATED')`,
        [id]
      );

      await client.query("COMMIT");
      return mapRow(inserted.rows[0]);
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the original error.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async get(id) {
    const result = await this.pool.query(
      "SELECT * FROM transactions WHERE id = $1",
      [id]
    );

    if (result.rowCount === 0) {
      const error = new Error("transaction not found");
      error.code = "NOT_FOUND";
      error.statusCode = 404;
      throw error;
    }

    return mapRow(result.rows[0]);
  }

  async transition(id, nextStatus, patch = {}) {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");

      const currentResult = await client.query(
        "SELECT * FROM transactions WHERE id = $1 FOR UPDATE",
        [id]
      );

      if (currentResult.rowCount === 0) {
        const error = new Error("transaction not found");
        error.code = "NOT_FOUND";
        error.statusCode = 404;
        throw error;
      }

      const current = currentResult.rows[0];

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

        await client.query("COMMIT");
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
          : requireNonEmptyString(patch.txHash, "txHash", 256);

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
          ? current.attempts + 1
          : current.attempts;

      const updated = await client.query(
        `UPDATE transactions
         SET status = $2,
             tx_hash = $3,
             failure_reason = $4,
             attempts = $5,
             updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [id, nextStatus, txHash, failureReason, attempts]
      );

      await client.query(
        `INSERT INTO transaction_events
          (transaction_id, previous_status, next_status, event_type, metadata)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          id,
          current.status,
          nextStatus,
          `TRANSACTION_${nextStatus}`,
          JSON.stringify({
            hasTxHash: Boolean(txHash),
            attempt: attempts
          })
        ]
      );

      await client.query("COMMIT");
      return mapRow(updated.rows[0]);
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the original error.
      }
      throw error;
    } finally {
      client.release();
    }
  }
}

function mapRow(row) {
  return {
    id: row.id,
    idempotencyKey: row.idempotency_key,
    from: row.sender,
    to: row.receiver,
    amount: row.amount.toString(),
    status: row.status,
    txHash: row.tx_hash,
    failureReason: row.failure_reason,
    attempts: row.attempts,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}
