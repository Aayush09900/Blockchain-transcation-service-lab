ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS signed_transaction TEXT NULL;

ALTER TABLE transaction_outbox
  ADD COLUMN IF NOT EXISTS claim_token CHAR(36) NULL,
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMP(6) NULL;

CREATE INDEX IF NOT EXISTS ix_outbox_claims
  ON transaction_outbox (claimed_at, published_at, dead_lettered_at, next_attempt_at);
