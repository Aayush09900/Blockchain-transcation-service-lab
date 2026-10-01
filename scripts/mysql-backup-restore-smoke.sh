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

cleanup() {
  rm -f "$BACKUP_FILE"
}
trap cleanup EXIT

echo "Creating logical MySQL backup: $BACKUP_FILE"
docker run --rm --network host \
  -e MYSQL_PWD="$MYSQL_PASSWORD" \
  mysql:8.4 \
  mysqldump \
    --host="$MYSQL_HOST" \
    --port="$MYSQL_PORT" \
    --user="$MYSQL_USER" \
    --single-transaction \
    --routines \
    --triggers \
    "$MYSQL_DATABASE" > "$BACKUP_FILE"

test -s "$BACKUP_FILE"

echo "Creating clean restore database: $MYSQL_RESTORE_DATABASE"
docker run --rm --network host \
  -e MYSQL_PWD="$MYSQL_ROOT_PASSWORD" \
  mysql:8.4 \
  mysql \
    --host="$MYSQL_HOST" \
    --port="$MYSQL_PORT" \
    --user=root \
    -e "DROP DATABASE IF EXISTS \`$MYSQL_RESTORE_DATABASE\`; CREATE DATABASE \`$MYSQL_RESTORE_DATABASE\`;"

echo "Restoring backup into: $MYSQL_RESTORE_DATABASE"
docker run --rm --network host \
  -e MYSQL_PWD="$MYSQL_ROOT_PASSWORD" \
  mysql:8.4 \
  mysql \
    --host="$MYSQL_HOST" \
    --port="$MYSQL_PORT" \
    --user=root \
    "$MYSQL_RESTORE_DATABASE" < "$BACKUP_FILE"

query_counts() {
  local database="$1"

  docker run --rm --network host \
    -e MYSQL_PWD="$MYSQL_ROOT_PASSWORD" \
    mysql:8.4 \
    mysql \
      --host="$MYSQL_HOST" \
      --port="$MYSQL_PORT" \
      --user=root \
      --batch --skip-column-names \
      -e "SELECT 'transactions', COUNT(*) FROM \`${database}\`.`transactions`; SELECT 'transaction_outbox', COUNT(*) FROM \`${database}\`.`transaction_outbox\`;"
}

ORIGINAL_COUNTS="$(query_counts "$MYSQL_DATABASE")"
RESTORED_COUNTS="$(query_counts "$MYSQL_RESTORE_DATABASE")"

if [[ "$ORIGINAL_COUNTS" != "$RESTORED_COUNTS" ]]; then
  echo "backup/restore row-count verification failed" >&2
  echo "original:" >&2
  printf '%s\n' "$ORIGINAL_COUNTS" >&2
  echo "restored:" >&2
  printf '%s\n' "$RESTORED_COUNTS" >&2
  exit 1
fi

echo "Backup/restore drill passed."
printf '%s\n' "$ORIGINAL_COUNTS"
