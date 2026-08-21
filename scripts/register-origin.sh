#!/usr/bin/env bash
# register-origin.sh — add an app origin (a new tunnel URL) to the realm client.
#
#   bash scripts/register-origin.sh https://new-name.trycloudflare.com
#
# WHY YOU WILL NEED THIS
# ----------------------
# A cloudflared QUICK tunnel gets a fresh random *.trycloudflare.com hostname
# every time it restarts. That hostname is an OAuth redirect URI and a CORS web
# origin, so a new one means the login round-trip breaks with
# "Invalid parameter: redirect_uri" until the realm knows about it.
#
# COST DEPENDS ENTIRELY ON WHEN YOU RUN IT:
#
#   before the multiAdmin flip : applies straight away, no human
#   after  the multiAdmin flip : files a change request that a QUORUM of council
#                                members must sign in their browser enclaves
#
# That asymmetry is why the bootstrap registers every origin up front. If you
# expect to move the game around, get a stable hostname (a named cloudflared
# tunnel on a domain you own, or a Tailscale Funnel URL) instead of re-running
# this after every restart.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
cd "$ROOT"

NEW="${1:-}"
[ -n "$NEW" ] || { echo "usage: $0 https://your-app-origin" >&2; exit 1; }
case "$NEW" in http://*|https://*) : ;; *) echo "ERROR: origin must start with http:// or https://" >&2; exit 1 ;; esac
NEW="${NEW%/}"

REALM_NAME="${REALM_NAME:-nightfabric}"
CLIENT_NAME="${CLIENT_NAME:-nightfabric-client}"

# Prefer the Skycloak cluster if one is provisioned; fall back to .env.
if [ -s "$HERE/.skycloak-cluster" ] && [ -s "$HERE/.skycloak-creds" ]; then
  TIDECLOAK_URL="$(jq -r .url "$HERE/.skycloak-cluster")"
  SC_ID="$(jq -r .client_id "$HERE/.skycloak-creds")"
  SC_SECRET="$(jq -r .client_secret "$HERE/.skycloak-creds")"
  SC_TOKEN_URL="$(jq -r .token_url "$HERE/.skycloak-creds")"
  get_token() {
    curl -s -X POST "$SC_TOKEN_URL" \
      --data-urlencode grant_type=client_credentials \
      --data-urlencode "client_id=$SC_ID" --data-urlencode "client_secret=$SC_SECRET" | jq -r .access_token
  }
else
  [ -f .env ] && { set -a; . ./.env; set +a; }
  TIDECLOAK_URL="${TIDECLOAK_URL:-http://localhost:8080}"
  get_token() {
    curl -s -X POST "$TIDECLOAK_URL/realms/master/protocol/openid-connect/token" \
      -H "Content-Type: application/x-www-form-urlencoded" \
      -d "grant_type=password" -d "client_id=admin-cli" \
      --data-urlencode "username=${KC_BOOTSTRAP_ADMIN_USERNAME:-admin}" \
      --data-urlencode "password=${KC_BOOTSTRAP_ADMIN_PASSWORD:-}" | jq -r .access_token
  }
fi

TOKEN="$(get_token)"
[ -n "$TOKEN" ] && [ "$TOKEN" != "null" ] || { echo "ERROR: could not get an admin token." >&2; exit 1; }

CU="$(curl -s "$TIDECLOAK_URL/admin/realms/$REALM_NAME/clients?clientId=$CLIENT_NAME" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.[0].id // empty')"
[ -n "$CU" ] || { echo "ERROR: client '$CLIENT_NAME' not found in realm '$REALM_NAME'." >&2; exit 1; }

REP="$(curl -s "$TIDECLOAK_URL/admin/realms/$REALM_NAME/clients/$CU" -H "Authorization: Bearer $TOKEN")"
UPDATED="$(echo "$REP" | jq --arg u "$NEW" '
  .redirectUris = ((.redirectUris // []) + [$u, $u + "/*", $u + "/silent-check-sso.html", $u + "/auth/redirect"] | unique)
  | .webOrigins  = ((.webOrigins  // []) + [$u] | unique)')"

CODE="$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$TIDECLOAK_URL/admin/realms/$REALM_NAME/clients/$CU" \
  -H "Authorization: Bearer $(get_token)" -H "Content-Type: application/json" --data-binary "$UPDATED")"
echo "PUT client -> HTTP $CODE"

# 2xx means ACCEPTED, not APPLIED. Read it back.
sleep 2
HAS="$(curl -s "$TIDECLOAK_URL/admin/realms/$REALM_NAME/clients/$CU" -H "Authorization: Bearer $(get_token)" \
  | jq --arg u "$NEW" '(.redirectUris // []) | index($u) != null')"

if [ "$HAS" = "true" ]; then
  echo "  Applied. $NEW can now complete a login round-trip."
else
  PEND="$(curl -s "$TIDECLOAK_URL/admin/realms/$REALM_NAME/iga/change-requests?status=PENDING" \
    -H "Authorization: Bearer $(get_token)" | jq -r 'if type=="array" then length else 0 end')"
  cat <<MSG
  NOT applied yet — $PEND change request(s) pending.

  The realm is multiAdmin, so this is a governed write: a quorum of council
  members has to sign it in their browser enclaves. Approve it in-game at the
  COUNCIL RELAY in The Sprawl, or in the admin console:
      $TIDECLOAK_URL/admin/$REALM_NAME/console/  ->  Change Requests

  Until then, logins from $NEW will fail with an invalid redirect_uri.
MSG
fi
