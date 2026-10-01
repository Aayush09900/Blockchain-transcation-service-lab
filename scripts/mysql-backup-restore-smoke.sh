#!/usr/bin/env bash
set -Eeuo pipefail

MYSQL_IMAGE="${MYSQL_IMAGE:-mysql:8.4}"
MYSQL_ROOT_PASSWORD="${MYSQL_ROOT_PASSWORD:-root}"
MYSQL_DATABASE="${MYSQL_DATABASE:-blockchain_transactions}"
MYSQL_CONTAINER="mysql-backup-restore-${GITHUB_RUN_ID:-local}-$$"
BACKUP_FILE="$(mktemp)"

cleanup() {
  docker rm -f "$MYSQL_CONTAINER" >/dev/null 2>&1 || true
  rm -f "$BACKUP_FILE"
}
trap cleanup EXIT

fail() {
  echo "MySQL backup/restore drill failed: $*" >&2
  exit 1
}

echo "Starting disposable MySQL ${MYSQL_IMAGE} container..."
docker run --detach --rm \
  --name "$MYSQL_CONTAINER" \
  -e "MYSQL_ROOT_PASSWORD=$MYSQL_ROOT_PASSWORD" \
  -e "MYSQL_DATABASE=$MYSQL_DATABASE" \
  "$MYSQL_IMAGE" >/dev/null

for attempt in $(seq 1 30); do
  if docker exec "$MYSQL_CONTAINER" mysqladmin ping -h 127.0.0.1 -uroot -p"$MYSQL_ROOT_PASSWORD" --silent >/dev/null 2>&1; then
    break
  fi
  if [[ "$attempt" -eq 30 ]]; then
    fail "MySQL did not become ready"
  fi
  sleep 2
done

echo "Applying canonical schema..."
docker exec -i "$MYSQL_CONTAINER" mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE" < db/mysql/001_init.sql

echo "Seeding deterministic transaction and outbox fixtures..."
docker exec "$MYSQL_CONTAINER" mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE" -e "
INSERT INTO transactions
  (id, idempotency_key, sender, receiver, amount, status, tx_hash)
VALUES
  ('11111111-1111-4111-8111-111111111111', 'backup-drill-1', '0x0000000000000000000000000000000000000001', '0x0000000000000000000000000000000000000002', 1.250000000000000000, 'CONFIRMED', NULL),
  ('22222222-2222-4222-8222-222222222222', 'backup-drill-2', '0x0000000000000000000000000000000000000003', '0x0000000000000000000000000000000000000004', 2.500000000000000000, 'SUBMITTED', NULL);

INSERT INTO transaction_outbox
  (event_id, transaction_id, event_type, payload, attempts, next_attempt_at)
VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'TransactionCreated',
   JSON_OBJECT('transactionId', '11111111-1111-4111-8111-111111111111', 'status', 'CONFIRMED'), 0, NULL),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222', 'TransactionCreated',
   JSON_OBJECT('transactionId', '22222222-2222-4222-8222-222222222222', 'status', 'SUBMITTED'), 1, NULL);
"

snapshot() {
  local tx_hash outbox_hash
  tx_hash="$(docker exec "$MYSQL_CONTAINER" mysql -N -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE" -e "
    SELECT SHA2(
      COALESCE(
        GROUP_CONCAT(
          CONCAT_WS('#',
            id,
            idempotency_key,
            sender,
            receiver,
            amount,
            status,
            COALESCE(tx_hash, '<NULL>'),
            confirmed_block_number,
            COALESCE(confirmed_block_hash, '<NULL>'),
            COALESCE(failure_reason, '<NULL>'),
            attempts,
            created_at,
            updated_at
          )
          ORDER BY id SEPARATOR '||'
        ),
        ''
      ),
      256
    )
    FROM transactions;
  ")"

  outbox_hash="$(docker exec "$MYSQL_CONTAINER" mysql -N -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE" -e "
    SELECT SHA2(
      COALESCE(
        GROUP_CONCAT(
          CONCAT_WS('#',
            id,
            event_id,
            transaction_id,
            event_type,
            CAST(payload AS CHAR),
            attempts,
            COALESCE(last_error, '<NULL>'),
            COALESCE(next_attempt_at, '<NULL>'),
            COALESCE(dead_lettered_at, '<NULL>'),
            COALESCE(published_at, '<NULL>'),
            COALESCE(claimed_by, '<NULL>'),
            COALESCE(claimed_until, '<NULL>'),
            created_at
          )
          ORDER BY id SEPARATOR '||'
        ),
        ''
      ),
      256
    )
    FROM transaction_outbox;
  ")"

  printf '%s|%s|%s|%s\n'     "$(docker exec "$MYSQL_CONTAINER" mysql -N -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE" -e 'SELECT COUNT(*) FROM transactions;')"     "$(docker exec "$MYSQL_CONTAINER" mysql -N -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE" -e 'SELECT COUNT(*) FROM transaction_outbox;')"     "$tx_hash"     "$outbox_hash"
}

BEFORE="$(snapshot)"
echo "Snapshot before backup: $BEFORE"

echo "Creating logical backup..."
docker exec "$MYSQL_CONTAINER" mysqldump \
  --single-transaction \
  --routines \
  --triggers \
  --events \
  --hex-blob \
  --no-tablespaces \
  --set-gtid-purged=OFF \
  -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE" > "$BACKUP_FILE"

[[ -s "$BACKUP_FILE" ]] || fail "backup file is empty"
grep -q "CREATE TABLE.*transactions" "$BACKUP_FILE" || fail "transactions schema missing from backup"
grep -q "CREATE TABLE.*transaction_outbox" "$BACKUP_FILE" || fail "outbox schema missing from backup"
grep -q "INSERT INTO.*transactions" "$BACKUP_FILE" || fail "transactions data missing from backup"
grep -q "INSERT INTO.*transaction_outbox" "$BACKUP_FILE" || fail "outbox data missing from backup"

echo "Destroying database..."
docker exec "$MYSQL_CONTAINER" mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -e "
DROP DATABASE \`$MYSQL_DATABASE\`;
CREATE DATABASE \`$MYSQL_DATABASE\`;
"

echo "Restoring database from logical backup..."
docker exec -i "$MYSQL_CONTAINER" mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE" < "$BACKUP_FILE"

AFTER="$(snapshot)"
echo "Snapshot after restore:  $AFTER"

[[ "$BEFORE" == "$AFTER" ]] || fail "restored data does not exactly match the pre-backup snapshot"

echo "Verifying restored foreign-key enforcement..."
if docker exec "$MYSQL_CONTAINER" mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE" -e "
  INSERT INTO transaction_outbox
    (event_id, transaction_id, event_type, payload)
  VALUES
    ('cccccccc-cccc-4ccc-8ccc-cccccccccccc',
     'ffffffff-ffff-4fff-8fff-ffffffffffff',
     'InvalidReference',
     JSON_OBJECT('transactionId', 'ffffffff-ffff-4fff-8fff-ffffffffffff'));
" >/dev/null 2>&1; then
  fail "foreign-key constraint was not preserved"
fi

echo "MySQL backup/restore drill passed."
