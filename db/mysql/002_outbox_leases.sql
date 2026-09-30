ALTER TABLE transaction_outbox
  ADD COLUMN lease_token CHAR(36) NULL,
  ADD COLUMN lease_expires_at TIMESTAMP(6) NULL,
  ADD KEY ix_outbox_claim (
    published_at,
    dead_lettered_at,
    next_attempt_at,
    lease_expires_at,
    id
  );
