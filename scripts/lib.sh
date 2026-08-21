# lib.sh — shared admin-API plumbing for the NIGHTFABRIC scripts.
# Source it; do not execute it.
#
# Auto-detects how to reach the admin API:
#   scripts/.skycloak-cluster + .skycloak-creds present -> hosted cluster,
#     authenticate with its automation client (Skycloak issues no master admin
#     password at all)
#   otherwise -> local container, master-realm admin password from .env
#
# It also protects the caller's environment from .env: sourcing .env with
# `set -a` exports everything in it and silently overrides variables passed on
# the command line, which is how a run aimed at a hosted cluster ends up talking
# to localhost with the wrong token.

nf_load_env() {
  local _u="${TIDECLOAK_URL:-}" _r="${REALM_NAME:-}" _c="${CLIENT_NAME:-}" _a="${ADAPTER_OUTPUT:-}"
  [ -f .env ] && { set -a; . ./.env; set +a; }
  [ -n "$_u" ] && TIDECLOAK_URL="$_u"
  [ -n "$_r" ] && REALM_NAME="$_r"
  [ -n "$_c" ] && CLIENT_NAME="$_c"
  [ -n "$_a" ] && ADAPTER_OUTPUT="$_a"
  true
}

nf_auth_init() {
  local here="$1"
  if [ -s "$here/.skycloak-cluster" ] && [ -s "$here/.skycloak-creds" ]; then
    NF_MODE="skycloak"
    TIDECLOAK_URL="${TIDECLOAK_URL_OVERRIDE:-$(jq -r .url "$here/.skycloak-cluster")}"
    NF_SC_ID="$(jq -r .client_id "$here/.skycloak-creds")"
    NF_SC_SECRET="$(jq -r .client_secret "$here/.skycloak-creds")"
    NF_SC_TOKEN_URL="$(jq -r .token_url "$here/.skycloak-creds")"
  else
    NF_MODE="selfhost"
    TIDECLOAK_URL="${TIDECLOAK_URL:-http://localhost:8080}"
    NF_KC_USER="${KC_BOOTSTRAP_ADMIN_USERNAME:-admin}"
    NF_KC_PASS="${KC_BOOTSTRAP_ADMIN_PASSWORD:-${KC_ADMIN_PASSWORD:-}}"
    [ -n "$NF_KC_PASS" ] || {
      echo "ERROR: KC_BOOTSTRAP_ADMIN_PASSWORD unset and no Skycloak cluster files found." >&2
      exit 1; }
  fi
}

nf_get_token() {
  if [ "$NF_MODE" = "skycloak" ]; then
    curl -s -X POST "$NF_SC_TOKEN_URL" \
      --data-urlencode "grant_type=client_credentials" \
      --data-urlencode "client_id=$NF_SC_ID" \
      --data-urlencode "client_secret=$NF_SC_SECRET" | jq -r '.access_token'
  else
    curl -s -X POST "$TIDECLOAK_URL/realms/master/protocol/openid-connect/token" \
      -H "Content-Type: application/x-www-form-urlencoded" \
      -d "grant_type=password" -d "client_id=admin-cli" \
      --data-urlencode "username=$NF_KC_USER" \
      --data-urlencode "password=$NF_KC_PASS" | jq -r '.access_token'
  fi
}

# Admin tokens are short-lived (~60s self-hosted). Cache briefly rather than
# minting per request — a 250-change-request drain outlives a single token, but
# minting one each time makes it take longer than the tokens last.
NF_TOK=""; NF_TOK_AT=0
tok() {
  local now; now=$(date +%s)
  if [ -z "$NF_TOK" ] || [ $((now - NF_TOK_AT)) -ge 40 ]; then
    NF_TOK="$(nf_get_token)"; NF_TOK_AT=$now
  fi
  printf '%s' "$NF_TOK"
}

user_id() {
  curl -s "$TIDECLOAK_URL/admin/realms/$REALM_NAME/users?username=$1&exact=true" \
    -H "Authorization: Bearer $(tok)" | jq -r '.[0].id // empty'
}

# With IGA on, a 2xx from an admin endpoint means ACCEPTED, not APPLIED.
# Always follow a mutation with drain + a read-back assertion.
drain() {
  local ids ready id pass
  ids=$(curl -s "$TIDECLOAK_URL/admin/realms/$REALM_NAME/iga/change-requests?status=PENDING" \
    -H "Authorization: Bearer $(tok)" | jq -r 'if type=="array" then .[].id else empty end' 2>/dev/null || true)
  for id in $ids; do
    curl -s -X POST "$TIDECLOAK_URL/admin/realms/$REALM_NAME/iga/change-requests/$id/authorize" \
      -H "Authorization: Bearer $(tok)" -H "Content-Type: application/json" -d '{}' >/dev/null 2>&1 || true
  done
  for pass in 1 2 3 4 5; do
    ready=$(curl -s "$TIDECLOAK_URL/admin/realms/$REALM_NAME/iga/change-requests?status=PENDING" \
      -H "Authorization: Bearer $(tok)" \
      | jq -r 'if type=="array" then (.[] | select(.readyToCommit==true) | .id) else empty end' 2>/dev/null || true)
    [ -z "$ready" ] && break
    for id in $ready; do
      curl -s -X POST "$TIDECLOAK_URL/admin/realms/$REALM_NAME/iga/change-requests/$id/commit" \
        -H "Authorization: Bearer $(tok)" >/dev/null 2>&1 || true
    done
  done
}

say() { printf '\n\033[38;5;51m==>\033[0m %s\n' "$*"; }
