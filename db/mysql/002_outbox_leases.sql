-- Apply this migration to existing deployments before starting multiple outbox workers.
ALTER TABLE transaction_outbox
  ADD COLUMN claimed_by VARCHAR(64) NULL,
  ADD COLUMN claimed_until TIMESTAMP(6) NULL,
  ADD KEY ix_outbox_claimed_until (claimed_until, published_at, dead_lettered_at, id);
