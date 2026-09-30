CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY,
  idempotency_key VARCHAR(128) NOT NULL UNIQUE,
  sender VARCHAR(128) NOT NULL,
  receiver VARCHAR(128) NOT NULL,
  amount NUMERIC NOT NULL CHECK (amount > 0),
  status VARCHAR(16) NOT NULL CHECK (status IN ('CREATED', 'SUBMITTED', 'CONFIRMED', 'FAILED')),
  tx_hash VARCHAR(256),
  failure_reason VARCHAR(500),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transactions_status_updated_at
  ON transactions (status, updated_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_tx_hash
  ON transactions (tx_hash)
  WHERE tx_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS transaction_events (
  id BIGSERIAL PRIMARY KEY,
  transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  previous_status VARCHAR(16),
  next_status VARCHAR(16) NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transaction_events_transaction_id_created_at
  ON transaction_events (transaction_id, created_at);
