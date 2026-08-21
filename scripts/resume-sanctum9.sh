#!/usr/bin/env bash
# Resume phase-1 bootstrap for an ALREADY-CREATED realm whose realm/Tide/IGA
# setup succeeded but whose cast creation was interrupted (e.g. a SkyCloak pod
# recycle mid-run). Runs the remaining automatable steps only: cast, starting
# roles, app/.env.local, adapter JSON export, invite links. It does NOT touch
# setUpTideRealm / license (already done) and does NOT re-import the realm.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"

REALM_NAME="${REALM_NAME:-sanctum9}"
CLIENT_NAME="${CLIENT_NAME:-nightfabric-client}"
CAST="${CAST:-sasha vex judy takemura}"
ADAPTER_OUTPUT="${ADAPTER_OUTPUT:-$ROOT/app/data/tidecloak.json}"
CLIENT_APP_URL="${CLIENT_APP_URL:-https://nightfabric.codesyo.com}"

# --- SkyCloak auth (same as init) ---
SKYCLOAK_CREDS="${SKYCLOAK_CREDS:-$HERE/.skycloak-creds}"
[ -s "$SKYCLOAK_CREDS" ] || { echo "ERROR: SKYCLOAK_CREDS='$SKYCLOAK_CREDS' missing." >&2; exit 1; }
SC_ID="$(jq -r '.client_id' "$SKYCLOAK_CREDS")"
SC_SECRET="$(jq -r '.client_secret' "$SKYCLOAK_CREDS")"
SC_TOKEN_URL="$(jq -r '.token_url' "$SKYCLOAK_CREDS")"
TIDECLOAK_URL="${TIDECLOAK_URL:-$(jq -r '.url' "$HERE/.skycloak-cluster")}"

say() { printf '\n\033[38;5;51m==>\033[0m %s\n' "$*"; }
get_token() {
  curl -s -X POST "$SC_TOKEN_URL" \
    --data-urlencode "grant_type=client_credentials" \
    --data-urlencode "client_id=$SC_ID" \
    --data-urlencode "client_secret=$SC_SECRET" | jq -r '.access_token'
}
_TOK=""; _TOK_AT=0
tok() {
  local now; now=$(date +%s)
  if [ -z "$_TOK" ] || [ $((now - _TOK_AT)) -ge 40 ]; then
    _TOK="$(get_token)"; _TOK_AT=$now
  fi
  printf '%s' "$_TOK"
}
drain() {
  local ids ready id pass n=0 total
  ids=$(curl -s "$TIDECLOAK_URL/admin/realms/$REALM_NAME/iga/change-requests?status=PENDING" \
    -H "Authorization: Bearer $(tok)" 2>/dev/null \
    | jq -r 'if type=="array" then .[].id else empty end' 2>/dev/null || true)
  total=$(printf '%s\n' "$ids" | grep -c . || true)
  [ "${total:-0}" -gt 0 ] && printf '    authorizing %s change requests' "$total"
  for id in $ids; do
    curl -s -X POST "$TIDECLOAK_URL/admin/realms/$REALM_NAME/iga/change-requests/$id/authorize" \
      -H "Authorization: Bearer $(tok)" -H "Content-Type: application/json" -d '{}' >/dev/null 2>&1 || true
    n=$((n+1)); [ $((n % 25)) -eq 0 ] && printf '.'
  done
  [ "${total:-0}" -gt 0 ] && printf ' done\n'
  for pass in 1 2 3 4 5 6; do
    ready=$(curl -s "$TIDECLOAK_URL/admin/realms/$REALM_NAME/iga/change-requests?status=PENDING" \
      -H "Authorization: Bearer $(tok)" 2>/dev/null \
      | jq -r 'if type=="array" then (.[] | select(.readyToCommit==true) | .id) else empty end' 2>/dev/null || true)
    [ -z "$ready" ] && break
    n=$(printf '%s\n' "$ready" | grep -c . || true)
    printf '    commit pass %s: %s ready' "$pass" "$n"
    for id in $ready; do
      curl -s -X POST "$TIDECLOAK_URL/admin/realms/$REALM_NAME/iga/change-requests/$id/commit" \
        -H "Authorization: Bearer $(tok)" >/dev/null 2>&1 || true
    done
    printf ' committed\n'
  done
}
user_id() {
  curl -s "$TIDECLOAK_URL/admin/realms/$REALM_NAME/users?username=$1&exact=true" \
    -H "Authorization: Bearer $(tok)" | jq -r '.[0].id // empty'
}

say "Resuming '$REALM_NAME' — cast: $CAST"

# --- cast (idempotent: skip users that already exist) ---
say "Creating the cast: $CAST"
for U in $CAST; do
  if [ -n "$(user_id "$U")" ]; then echo "  $U: already exists — skipping create"; continue; fi
  BODY="$(mktemp)"
  CODE="$(curl -s -o "$BODY" -w '%{http_code}' -X POST "$TIDECLOAK_URL/admin/realms/$REALM_NAME/users" \
    -H "Authorization: Bearer $(tok)" -H "Content-Type: application/json" \
    -d "{\"username\":\"$U\",\"enabled\":true,\"emailVerified\":false,\"attributes\":{\"tideInvitable\":[\"true\"],\"handle\":[\"$U\"]}}")"
  case "$CODE" in
    2*) echo "  $U: HTTP $CODE (accepted — not yet applied)" ;;
    *)  echo "ERROR: creating '$U' returned HTTP $CODE: $(cat "$BODY")" >&2; rm -f "$BODY"; exit 1 ;;
  esac
  rm -f "$BODY"
done
sleep 2; drain
for U in $CAST; do
  ID="$(user_id "$U")"
  [ -n "$ID" ] || { echo "ERROR: user '$U' does not exist after drain." >&2; exit 1; }
  echo "  $U -> $ID"
done

# --- starting roles ---
say "Granting starting roles (crew-vault-access, fixer)"
START_ROLES="crew-vault-access fixer"
for R in $START_ROLES; do
  RJ="$(curl -s "$TIDECLOAK_URL/admin/realms/$REALM_NAME/roles/$R" -H "Authorization: Bearer $(tok)")"
  echo "$RJ" | jq -e '.id' >/dev/null || { echo "ERROR: role '$R' not found in realm." >&2; exit 1; }
  for U in $CAST; do
    HAVE_R="$(curl -s "$TIDECLOAK_URL/admin/realms/$REALM_NAME/users/$(user_id "$U")/role-mappings/realm" \
      -H "Authorization: Bearer $(tok)" | jq -r '[.[].name] | join(",")')"
    case ",$HAVE_R," in *",$R,"*) continue ;; esac
    CODE="$(curl -s -o /dev/null -w '%{http_code}' -X POST \
      "$TIDECLOAK_URL/admin/realms/$REALM_NAME/users/$(user_id "$U")/role-mappings/realm" \
      -H "Authorization: Bearer $(tok)" -H "Content-Type: application/json" --data-binary "[$RJ]")"
    case "$CODE" in 2*) : ;; *) echo "ERROR: granting '$R' to $U returned HTTP $CODE." >&2; exit 1 ;; esac
  done
  echo "  $R: submitted"
  sleep 2; drain
done
for U in $CAST; do
  HAVE="$(curl -s "$TIDECLOAK_URL/admin/realms/$REALM_NAME/users/$(user_id "$U")/role-mappings/realm" \
    -H "Authorization: Bearer $(tok)" | jq -r '[.[].name] | sort | join(",")')"
  for R in $START_ROLES; do
    case ",$HAVE," in *",$R,"*) : ;; *) echo "ERROR: $U missing '$R' after drain. Has: $HAVE" >&2; exit 1 ;; esac
  done
  echo "  $U: $HAVE"
done

# --- server-side app config ---
say "Writing app/.env.local (client_credentials mode -> sanctum9)"
cat > "$ROOT/app/.env.local" <<ENVEOF
TIDECLOAK_URL=$TIDECLOAK_URL
REALM_NAME=$REALM_NAME
TIDECLOAK_ADMIN_MODE=client_credentials
SKYCLOAK_CLIENT_ID=$SC_ID
SKYCLOAK_CLIENT_SECRET=$SC_SECRET
SKYCLOAK_TOKEN_URL=$SC_TOKEN_URL
ENVEOF
chmod 600 "$ROOT/app/.env.local"
grep -q '^\.env\.local$' "$ROOT/app/.gitignore" 2>/dev/null || echo '.env.local' >> "$ROOT/app/.gitignore"
cp "$ROOT/forseti/CrewVaultContract.cs" "$ROOT/app/data/CrewVaultContract.cs" 2>/dev/null || true
echo "  app/.env.local written."

# --- adapter JSON export ---
say "Exporting adapter JSON (jwk + vendorId)"
CU="$(curl -s "$TIDECLOAK_URL/admin/realms/$REALM_NAME/clients?clientId=$CLIENT_NAME" \
  -H "Authorization: Bearer $(tok)" | jq -r '.[0].id')"
mkdir -p "$(dirname "$ADAPTER_OUTPUT")"
curl -s "$TIDECLOAK_URL/admin/realms/$REALM_NAME/vendorResources/get-installations-provider?clientId=$CU&providerId=keycloak-oidc-keycloak-json" \
  -H "Authorization: Bearer $(tok)" > "$ADAPTER_OUTPUT"
jq -e '.jwk.keys[0]' "$ADAPTER_OUTPUT" >/dev/null \
  || { echo "ERROR: adapter JSON has no jwk." >&2; exit 1; }
jq -e '.vendorId' "$ADAPTER_OUTPUT" >/dev/null \
  || { echo "ERROR: adapter JSON has no vendorId." >&2; exit 1; }
echo "  $ADAPTER_OUTPUT  (jwk + vendorId present)"

# --- invite links ---
say "Invite links — open each in a SEPARATE browser profile and create its Tide account"
echo
LINKS=""
for U in $CAST; do
  L="$(curl -s -X POST \
    "$TIDECLOAK_URL/admin/realms/$REALM_NAME/tideAdminResources/get-required-action-link?userId=$(user_id "$U")&lifespan=43200" \
    -H "Authorization: Bearer $(tok)" -H "Content-Type: application/json" \
    -d '["link-tide-account-action"]' | tr -d '"')"
  printf '  \033[1m%-10s\033[0m %s\n\n' "$U" "$L"
  LINKS="$LINKS$U $L"$'\n'
done
printf '%s' "$LINKS" > "$ROOT/invite-links.txt"
echo "  (also written to invite-links.txt)"

cat <<EOF

============================================================
 sanctum9 RESUME COMPLETE — realm live, still in firstAdmin.
   realm    $REALM_NAME
   client   $CLIENT_NAME
   admin    sasha   (cast: $CAST)

 NEXT (interactive — the crypto ceremonies I can't do for you):
   1. cd app && npm run build && npm start   (already wired to sanctum9)
   2. Open sasha's invite link above -> create the Tide account in the enclave.
      (Do the same for vex / judy / takemura when you want them.)
   3. Log in as sasha, open /forge, sign the crew-vault Forseti policy.
   4. bash scripts/seat-council.sh   -> grants tide-realm-admin + flips to quorum.
============================================================
EOF
