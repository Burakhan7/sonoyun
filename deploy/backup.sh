#!/usr/bin/env bash
# Daily compressed database dump, keeping the last 14. Installed as a cron job by setup.sh.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET=/var/backups/sonoyun
mkdir -p "$TARGET"
chmod 700 "$TARGET"

FILE="$TARGET/oyun_sohbet-$(date +%Y%m%d-%H%M).sql.gz"
docker compose -f "$DIR/docker-compose.yml" --env-file "$DIR/.env" exec -T postgres \
  pg_dump -U app -d oyun_sohbet --no-owner | gzip >"$FILE.tmp"
mv "$FILE.tmp" "$FILE"

ls -1t "$TARGET"/oyun_sohbet-*.sql.gz | tail -n +15 | xargs -r rm --
echo "$(date -Is) backup ok: $FILE"
