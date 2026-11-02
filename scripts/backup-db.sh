#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
: "${DATABASE_URL:?Set DATABASE_URL without logging it}"
DESTINATION="${1:-}"
[[ -n "$DESTINATION" && "$DESTINATION" != / && ! -e "$DESTINATION" ]] || { echo 'Provide a new explicit backup file path' >&2; exit 2; }
command -v pg_dump >/dev/null || { echo 'Run on a trusted database administration host with pg_dump installed' >&2; exit 1; }
pg_dump --dbname="$DATABASE_URL" --format=custom --no-owner --file="$DESTINATION"
chmod 600 "$DESTINATION"
echo "Backup written to $DESTINATION. Encrypt and copy off-host; verify a restore into a separate database."
