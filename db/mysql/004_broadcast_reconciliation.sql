-- Persist an explicit operator-facing reconciliation signal for broadcasts
-- whose blockchain outcome remains unknown after the configured recovery window.
ALTER TABLE transactions
  ADD COLUMN reconciliation_required_at TIMESTAMP(6) NULL,
  ADD COLUMN reconciliation_reason VARCHAR(500) NULL,
  ADD KEY ix_transactions_reconciliation (
    status,
    reconciliation_required_at,
    updated_at
  );
