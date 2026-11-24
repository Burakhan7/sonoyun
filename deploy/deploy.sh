#!/usr/bin/env bash
# Pulls the latest main and rebuilds changed services. Run on the server from anywhere:
#   bash /opt/sonoyun/deploy/deploy.sh
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR/.."

for file in .env realtime.env web.env badwords.tr.txt; do
  [[ -e "deploy/$file" ]] || { echo "deploy/$file is missing. Run deploy/setup.sh first." >&2; exit 1; }
done

git pull --ff-only
compose() { docker compose -f deploy/docker-compose.yml --env-file deploy/.env "$@"; }

compose build
compose up -d --remove-orphans
docker image prune -f >/dev/null

# Waits until the site answers through Caddy.
DOMAIN="$(grep '^DOMAIN=' deploy/.env | cut -d= -f2)"
for _ in $(seq 1 30); do
  if curl -fsS -o /dev/null "https://$DOMAIN/"; then
    echo "Deployed: https://$DOMAIN"
    compose ps
    exit 0
  fi
  sleep 5
done
echo "The site did not answer in time. Check: docker compose -f deploy/docker-compose.yml logs" >&2
exit 1
