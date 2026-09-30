import pg from "pg";

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
      ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: true } : undefined
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
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");

      const existing = await client.query(
        "SELECT * FROM transactions WHERE idempotency_key = $1 FOR UPDATE",
        [idempotencyKey]
      );

      if (existing.rowCount > 0) {
        const row = existing.rows[0];

        if (
          row.sender !== from ||
          row.receiver !== to ||
          row.amount.toString() !== amount
        ) {
          const error = new Error(
            "idempotency key was already used with a different request"
          );
          error.code = "IDEMPOTENCY_CONFLICT";
          throw error;
        }

        await client.query("COMMIT");
        return mapRow(row);
      }

      const inserted = await client.query(
        `INSERT INTO transactions
          (id, idempotency_key, sender, receiver, amount, status)
         VALUES ($1, $2, $3, $4, $5, 'CREATED')
         RETURNING *`,
        [id, idempotencyKey, from, to, amount]
      );

      await client.query(
        `INSERT INTO transaction_events
          (transaction_id, next_status, event_type)
         VALUES ($1, 'CREATED', 'TRANSACTION_CREATED')`,
        [id]
      );

      await client.query("COMMIT");
      return mapRow(inserted.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
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
        throw error;
      }

      const current = currentResult.rows[0];

      if (current.status === nextStatus) {
        await client.query("COMMIT");
        return mapRow(current);
      }

      if (!transitions[current.status]?.has(nextStatus)) {
        const error = new Error(
          `invalid transition: ${current.status} -> ${nextStatus}`
        );
        error.code = "INVALID_TRANSITION";
        throw error;
      }

      const updated = await client.query(
        `UPDATE transactions
         SET status = $2,
             tx_hash = COALESCE($3, tx_hash),
             failure_reason = $4,
             attempts = COALESCE($5, attempts),
             updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [
          id,
          nextStatus,
          patch.txHash ?? null,
          patch.failureReason ?? null,
          patch.attempts ?? null
        ]
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
          JSON.stringify({ hasTxHash: Boolean(patch.txHash) })
        ]
      );

      await client.query("COMMIT");
      return mapRow(updated.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
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
