#!/usr/bin/env bash
set -euo pipefail

: "${MYSQL_HOST:=127.0.0.1}"
: "${MYSQL_PORT:=3306}"
: "${MYSQL_USER:?MYSQL_USER is required}"
: "${MYSQL_PASSWORD:?MYSQL_PASSWORD is required}"
: "${MYSQL_DATABASE:?MYSQL_DATABASE is required}"
: "${MYSQL_ROOT_PASSWORD:?MYSQL_ROOT_PASSWORD is required}"
: "${MYSQL_RESTORE_DATABASE:=blockchain_transactions_restore}"

for database in "$MYSQL_DATABASE" "$MYSQL_RESTORE_DATABASE"; do
  if [[ ! "$database" =~ ^[A-Za-z0-9_]+$ ]]; then
    echo "database name contains unsupported characters: $database" >&2
    exit 1
  fi
done

BACKUP_DIR="${BACKUP_DIR:-$(mktemp -d)}"
mkdir -p "$BACKUP_DIR"
BACKUP_FILE="$BACKUP_DIR/${MYSQL_DATABASE}.sql"
RESTORE_BACKUP_FILE="$BACKUP_FILE.restore"

cleanup() {
  rm -f "$BACKUP_FILE" "$RESTORE_BACKUP_FILE"
}
trap cleanup EXIT

mysql_root() {
  docker run --rm --network host \
    -e MYSQL_PWD="$MYSQL_ROOT_PASSWORD" \
    mysql:8.4 \
    mysql \
      --no-defaults \
      --host="$MYSQL_HOST" \
      --port="$MYSQL_PORT" \
      --user=root \
      "$@"
}

echo "Creating clean restore database: $MYSQL_RESTORE_DATABASE"
mysql_root -e "DROP DATABASE IF EXISTS \`$MYSQL_RESTORE_DATABASE\`; CREATE DATABASE \`$MYSQL_RESTORE_DATABASE\`;"

echo "Applying canonical MySQL schema to: $MYSQL_RESTORE_DATABASE"
docker run --rm --network host -i \
  -e MYSQL_PWD="$MYSQL_ROOT_PASSWORD" \
  mysql:8.4 \
  mysql \
    --no-defaults \
    --host="$MYSQL_HOST" \
    --port="$MYSQL_PORT" \
    --user=root \
    "$MYSQL_RESTORE_DATABASE" < db/mysql/001_init.sql

echo "Creating logical MySQL data backup: $BACKUP_FILE"
# Use the CI root account so the drill validates complete authoritative data.
# The data-only dump is transformed below so every INSERT targets the clean
# restore database explicitly, independent of dump-session USE directives.
docker run --rm --network host \
  -e MYSQL_PWD="$MYSQL_ROOT_PASSWORD" \
  mysql:8.4 \
  mysqldump \
    --no-defaults \
    --host="$MYSQL_HOST" \
    --port="$MYSQL_PORT" \
    --user=root \
    --single-transaction \
    --skip-lock-tables \
    --skip-add-locks \
    --skip-disable-keys \
    --no-tablespaces \
    --no-create-info \
    --skip-triggers \
    --complete-insert \
    --skip-extended-insert \
    --order-by-primary \
    --set-gtid-purged=OFF \
    "$MYSQL_DATABASE" transactions transaction_outbox > "$BACKUP_FILE"

test -s "$BACKUP_FILE"
INSERT_COUNT="$(grep -c "^INSERT INTO" "$BACKUP_FILE" || true)"
if [[ "$INSERT_COUNT" -eq 0 ]]; then
  echo "logical data backup contains no INSERT statements" >&2
  exit 1
fi
echo "Logical data backup contains $INSERT_COUNT INSERT statements."

{
  echo "SET FOREIGN_KEY_CHECKS=0;"
  sed -E \
    -e "s/^INSERT INTO \`transactions\`/INSERT INTO \`$MYSQL_RESTORE_DATABASE\`.\`transactions\`/" \
    -e "s/^INSERT INTO \`transaction_outbox\`/INSERT INTO \`$MYSQL_RESTORE_DATABASE\`.\`transaction_outbox\`/" \
    "$BACKUP_FILE" | grep "^INSERT INTO"
  echo "SET FOREIGN_KEY_CHECKS=1;"
} > "$RESTORE_BACKUP_FILE"

test -s "$RESTORE_BACKUP_FILE"
RESTORE_INSERT_COUNT="$(grep -c "^INSERT INTO" "$RESTORE_BACKUP_FILE" || true)"
if [[ "$RESTORE_INSERT_COUNT" -ne "$INSERT_COUNT" ]]; then
  echo "restore SQL lost INSERT statements during target-qualification" >&2
  echo "backup inserts: $INSERT_COUNT" >&2
  echo "restore inserts: $RESTORE_INSERT_COUNT" >&2
  exit 1
fi

echo "Restoring logical MySQL data into: $MYSQL_RESTORE_DATABASE"
mysql_root "$MYSQL_RESTORE_DATABASE" -e "source $RESTORE_BACKUP_FILE"

query_counts() {
  local database="$1"

  mysql_root --batch --skip-column-names \
    -e "SELECT (SELECT COUNT(*) FROM \`$database\`.transactions), (SELECT COUNT(*) FROM \`$database\`.transaction_outbox);"
}

query_orphaned_outbox() {
  local database="$1"

  mysql_root --batch --skip-column-names \
    -e "SELECT COUNT(*) FROM \`$database\`.transaction_outbox o LEFT JOIN \`$database\`.transactions t ON t.id = o.transaction_id WHERE t.id IS NULL;"
}

query_fingerprints() {
  local database="$1"

  mysql_root --batch --skip-column-names \
    -e "
      SELECT
        COALESCE(
          SHA2(
            GROUP_CONCAT(
              SHA2(
                CONCAT_WS(
                  CHAR(0),
                  id,
                  idempotency_key,
                  sender,
                  receiver,
                  amount,
                  status,
                  tx_hash,
                  confirmed_block_number,
                  confirmed_block_hash,
                  failure_reason,
                  attempts,
                  created_at,
                  updated_at
                ),
                256
              )
              ORDER BY id
              SEPARATOR ''
            ),
            256
          ),
          SHA2('', 256)
        )
      FROM \`$database\`.transactions;

      SELECT
        COALESCE(
          SHA2(
            GROUP_CONCAT(
              SHA2(
                CONCAT_WS(
                  CHAR(0),
                  id,
                  event_id,
                  transaction_id,
                  event_type,
                  CAST(payload AS CHAR),
                  attempts,
                  last_error,
                  next_attempt_at,
                  dead_lettered_at,
                  published_at,
                  claimed_by,
                  claimed_until,
                  created_at
                ),
                256
              )
              ORDER BY id
              SEPARATOR ''
            ),
            256
          ),
          SHA2('', 256)
        )
      FROM \`$database\`.transaction_outbox;
    "
}

ORIGINAL_COUNTS="$(query_counts "$MYSQL_DATABASE")"
RESTORED_COUNTS="$(query_counts "$MYSQL_RESTORE_DATABASE")"
ORIGINAL_FINGERPRINTS="$(query_fingerprints "$MYSQL_DATABASE")"
RESTORED_FINGERPRINTS="$(query_fingerprints "$MYSQL_RESTORE_DATABASE")"
ORPHANED_OUTBOX="$(query_orphaned_outbox "$MYSQL_RESTORE_DATABASE")"

if [[ "$ORIGINAL_COUNTS" != "$RESTORED_COUNTS" ]]; then
  echo "backup/restore row-count verification failed" >&2
  echo "original:" >&2
  printf '%s\n' "$ORIGINAL_COUNTS" >&2
  echo "restored:" >&2
  printf '%s\n' "$RESTORED_COUNTS" >&2
  exit 1
fi

if [[ "$ORIGINAL_FINGERPRINTS" != "$RESTORED_FINGERPRINTS" ]]; then
  echo "backup/restore content verification failed" >&2
  echo "original fingerprints:" >&2
  printf '%s\n' "$ORIGINAL_FINGERPRINTS" >&2
  echo "restored fingerprints:" >&2
  printf '%s\n' "$RESTORED_FINGERPRINTS" >&2
  exit 1
fi

if [[ "$ORPHANED_OUTBOX" != "0" ]]; then
  echo "restored outbox contains orphaned transaction references" >&2
  printf '%s\n' "$ORPHANED_OUTBOX" >&2
  exit 1
fi

echo "Backup/restore drill passed."
echo "Row counts:"
printf '%s\n' "$ORIGINAL_COUNTS"
