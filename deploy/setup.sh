#!/usr/bin/env bash
# One-time server setup. Run on the server from the repository root:
#   sudo bash deploy/setup.sh <domain> <acme-email> <admin-ip>
# Creates the secret files with random values. Existing files are never overwritten.
set -euo pipefail

DOMAIN="${1:?usage: setup.sh <domain> <acme-email> <admin-ip>}"
ACME_EMAIL="${2:?usage: setup.sh <domain> <acme-email> <admin-ip>}"
ADMIN_IP="${3:?usage: setup.sh <domain> <acme-email> <admin-ip>}"
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

command -v docker >/dev/null || { echo "Docker is not installed." >&2; exit 1; }
docker compose version >/dev/null || { echo "Docker Compose plugin is missing." >&2; exit 1; }

secret() { openssl rand -base64 48 | tr -d '\n/+=' | cut -c1-48; }

write_once() {
  local file="$1"
  if [[ -e "$file" ]]; then
    echo "Keeping existing $file"
    cat >/dev/null
  else
    # Subshell, so the strict umask only applies to secret files.
    (umask 077 && cat >"$file")
    echo "Created $file"
  fi
}

INTERNAL_API_SECRET="$(secret)"
ADMIN_PASSWORD="$(secret | cut -c1-24)"

write_once .env <<EOF
DOMAIN=$DOMAIN
ACME_EMAIL=$ACME_EMAIL
POSTGRES_PASSWORD=$(secret)
NEXT_PUBLIC_SENTRY_DSN=
NEXT_PUBLIC_PLAUSIBLE_DOMAIN=
EOF

write_once realtime.env <<EOF
JWT_SECRET=$(secret)
INTERNAL_API_SECRET=$INTERNAL_API_SECRET
GUEST_LIMIT_PER_HOUR=30
EOF

write_once web.env <<EOF
INTERNAL_API_SECRET=$INTERNAL_API_SECRET
ADMIN_USER=admin
ADMIN_PASSWORD=$ADMIN_PASSWORD
ADMIN_IP_ALLOWLIST=$ADMIN_IP
EOF

if [[ ! -e badwords.tr.txt ]]; then
  cp ../apps/realtime/badwords.tr.txt badwords.tr.txt
  # The realtime container runs as a non-root user and must be able to read it.
  chmod 644 badwords.tr.txt
  echo "Created badwords.tr.txt from the template. Fill it before launch."
fi

# Daily database backup at 03:30 server time.
CRON_LINE="30 3 * * * $DIR/backup.sh >> /var/log/sonoyun-backup.log 2>&1"
( crontab -l 2>/dev/null | grep -v 'sonoyun.*backup.sh' || true; echo "$CRON_LINE" ) | crontab -
echo "Installed daily backup."

echo
echo "Admin password is in $DIR/web.env (ADMIN_PASSWORD)."
echo "Next: bash deploy/deploy.sh"
