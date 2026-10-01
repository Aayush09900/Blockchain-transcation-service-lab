-- Shared fixed-window rate-limit state for horizontally scaled API replicas.
CREATE TABLE IF NOT EXISTS rate_limit_clients (
  client_hash CHAR(64) NOT NULL PRIMARY KEY,
  window_started_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  request_count INT UNSIGNED NOT NULL,
  last_seen_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

  KEY ix_rate_limit_last_seen (last_seen_at),
  KEY ix_rate_limit_window (window_started_at)
) ENGINE=InnoDB;
