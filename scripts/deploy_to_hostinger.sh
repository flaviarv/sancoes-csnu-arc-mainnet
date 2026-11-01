#!/usr/bin/env bash
# deploy_to_hostinger.sh
# ======================
# Called by Lambda after update_sanctions_lists.py completes.
# Copies updated parquets to the Hostinger server via rsync over SSH,
# then calls /reload-data to refresh the in-memory sanctions engine.
#
# Required environment variables (set as Lambda env vars or GitHub secrets):
#   HOSTINGER_HOST       — server IP or hostname (e.g. srv2106257.example.com)
#   HOSTINGER_USER       — SSH user (e.g. root)
#   HOSTINGER_SSH_KEY    — path to SSH private key file (e.g. /tmp/id_rsa)
#   HOSTINGER_DEPLOY_DIR — remote project directory (e.g. /root/sancoes-csnu-arc-mainnet)
#   RELOAD_SECRET        — secret token for /reload-data endpoint
#   APP_URL              — public URL of the app (e.g. http://YOUR_SERVER_IP)
#
# Usage:
#   bash scripts/deploy_to_hostinger.sh
#   HOSTINGER_HOST=x.x.x.x HOSTINGER_USER=root ... bash scripts/deploy_to_hostinger.sh

set -euo pipefail

# ── Validate required env vars ────────────────────────────────────────────────
: "${HOSTINGER_HOST:?HOSTINGER_HOST is required}"
: "${HOSTINGER_USER:?HOSTINGER_USER is required}"
: "${HOSTINGER_SSH_KEY:?HOSTINGER_SSH_KEY is required}"
: "${HOSTINGER_DEPLOY_DIR:?HOSTINGER_DEPLOY_DIR is required}"
: "${RELOAD_SECRET:?RELOAD_SECRET is required}"
: "${APP_URL:?APP_URL is required}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
DATA_RAW="$REPO_ROOT/data/raw"
REMOTE="$HOSTINGER_USER@$HOSTINGER_HOST"
REMOTE_DATA="$HOSTINGER_DEPLOY_DIR/data/raw"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Starting deploy to Hostinger..."

# ── Step 1: copy updated parquets via rsync ───────────────────────────────────
echo "[1/2] Syncing parquets to $REMOTE:$REMOTE_DATA ..."
rsync -avz --delete \
  -e "ssh -i $HOSTINGER_SSH_KEY -o StrictHostKeyChecking=no -o ConnectTimeout=30" \
  "$DATA_RAW/" \
  "$REMOTE:$REMOTE_DATA/"

echo "Sync complete."

# ── Step 2: call /reload-data to refresh in-memory engine ─────────────────────
echo "[2/2] Triggering /reload-data on $APP_URL ..."
HTTP_STATUS=$(curl -s -o /tmp/reload_response.txt -w "%{http_code}" \
  -X POST "$APP_URL/reload-data" \
  -H "Content-Type: application/json" \
  -H "X-Reload-Secret: $RELOAD_SECRET")

if [ "$HTTP_STATUS" = "200" ]; then
  echo "Reload successful: $(cat /tmp/reload_response.txt)"
else
  echo "ERROR: /reload-data returned HTTP $HTTP_STATUS"
  cat /tmp/reload_response.txt
  exit 1
fi

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Deploy complete."
