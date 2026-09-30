CREATE TABLE IF NOT EXISTS transactions (
  id CHAR(36) NOT NULL PRIMARY KEY,
  idempotency_key VARCHAR(128) NOT NULL,
  sender VARCHAR(128) NOT NULL,
  receiver VARCHAR(128) NOT NULL,
  amount DECIMAL(65, 18) NOT NULL,
  status ENUM('CREATED', 'SUBMITTED', 'CONFIRMED', 'FAILED') NOT NULL,
  tx_hash CHAR(66) NULL,
  failure_reason VARCHAR(500) NULL,
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),

  UNIQUE KEY ux_transactions_idempotency_key (idempotency_key),
  UNIQUE KEY ux_transactions_tx_hash (tx_hash),
  KEY ix_transactions_status_updated_at (status, updated_at),
  KEY ix_transactions_created_at (created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS transaction_outbox (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  event_id CHAR(36) NOT NULL,
  transaction_id CHAR(36) NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  payload JSON NOT NULL,
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  last_error VARCHAR(1000) NULL,
  published_at TIMESTAMP(6) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

  UNIQUE KEY ux_outbox_event_id (event_id),
  KEY ix_outbox_pending (published_at, id),
  KEY ix_outbox_transaction_id (transaction_id),

  CONSTRAINT fk_outbox_transaction
    FOREIGN KEY (transaction_id)
    REFERENCES transactions(id)
    ON DELETE CASCADE
) ENGINE=InnoDB;
