#!/usr/bin/env bash
# init-nightfabric.sh — bootstrap the NIGHTFABRIC realm on a running TideCloak.
#
# Assumes TideCloak is ALREADY RUNNING (playbook start-tidecloak-dev).
# This script never wipes the H2 database.
#
# Order is load-bearing (canon/concepts.md, playbook bootstrap-realm-from-template):
#   realm import -> idp-review off -> license -> iga.attestor -> IGA on
#   -> create cast -> grant earned roles -> enrol every member (human, browser)
#   -> sign idp settings -> grant tide-realm-admin to the council -> LAST drain
#      (this is the firstAdmin -> multiAdmin flip; no server-driven governed
#       write may run afterwards) -> export adapter JSON.
#
# Usage:  bash scripts/init-nightfabric.sh
#         CAST="admin vex" COUNCIL="admin" bash scripts/init-nightfabric.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
cd "$ROOT"

# `.env` provides DEFAULTS, not overrides. Sourcing it with `set -a` exports
# everything in it and silently clobbers whatever the caller passed on the
# command line — which is how a run aimed at a Skycloak cluster ends up pointed
# at localhost:8080 holding a Skycloak token, failing the realm-exists probe
# with a 401 that reads as "realm is free", and then failing the import for
# reasons that look nothing like the cause. Save the caller's values, then
# restore them after sourcing.
_ARG_TIDECLOAK_URL="${TIDECLOAK_URL:-}"
_ARG_REALM_NAME="${REALM_NAME:-}"
_ARG_CLIENT_NAME="${CLIENT_NAME:-}"
_ARG_CLIENT_APP_URL="${CLIENT_APP_URL:-}"
_ARG_APP_URLS="${APP_URLS:-}"
_ARG_ADAPTER_OUTPUT="${ADAPTER_OUTPUT:-}"

[ -f .env ] && { set -a; . ./.env; set +a; }

[ -n "$_ARG_TIDECLOAK_URL" ]  && TIDECLOAK_URL="$_ARG_TIDECLOAK_URL"
[ -n "$_ARG_REALM_NAME" ]     && REALM_NAME="$_ARG_REALM_NAME"
[ -n "$_ARG_CLIENT_NAME" ]    && CLIENT_NAME="$_ARG_CLIENT_NAME"
[ -n "$_ARG_APP_URLS" ]       && APP_URLS="$_ARG_APP_URLS"
[ -n "$_ARG_ADAPTER_OUTPUT" ] && ADAPTER_OUTPUT="$_ARG_ADAPTER_OUTPUT"
# An explicit APP_URLS also decides CLIENT_APP_URL, unless that was passed too.
if [ -n "$_ARG_CLIENT_APP_URL" ]; then CLIENT_APP_URL="$_ARG_CLIENT_APP_URL"
elif [ -n "$_ARG_APP_URLS" ];    then CLIENT_APP_URL=""
fi
true

TIDECLOAK_URL="${TIDECLOAK_URL:-http://localhost:8080}"
REALM_NAME="${REALM_NAME:-nightfabric}"
CLIENT_NAME="${CLIENT_NAME:-nightfabric-client}"
# Every origin the game will be reached from. ALL of them must be registered
# now: after the multiAdmin flip, adding a redirect URI is a manual enclave
# approval in the admin console, per URI. A tunnel URL and localhost are two
# different origins and you almost always want both.
APP_URLS="${APP_URLS:-http://localhost:3000}"
CLIENT_APP_URL="${CLIENT_APP_URL:-$(printf '%s' "$APP_URLS" | awk '{print $1}')}"
ADMIN_EMAIL="${ADMIN_EMAIL:-info@tide.org}"
ADAPTER_OUTPUT="${ADAPTER_OUTPUT:-$ROOT/app/data/tidecloak.json}"

# The cast. First entry is the realm admin. Handles must be >= 3 characters —
# Keycloak's user profile enforces `length: {min: 3}` on username, and a 1-char
# handle fails validation with a 400 that the create loop would otherwise
# swallow. Members listed in COUNCIL get
# tide-realm-admin, which is what creates a real IGA quorum:
#   quorum = max(1, floor(TotalAdmins * 0.7)) -> 3 admins = 2 approvals needed.
CAST="${CAST:-admin vex judy takemura}"
COUNCIL="${COUNCIL:-admin judy takemura}"

# Two ways to reach the admin API, chosen by whether SKYCLOAK_CREDS is set:
#
#   self-hosted : master-realm admin password (from .env, never a literal)
#   Skycloak    : a confidential automation client in the cluster's own master
#                 realm — Skycloak issues no master admin password at all
#
# Everything downstream is identical; only get_token differs.
SKYCLOAK_CREDS="${SKYCLOAK_CREDS:-}"
if [ -n "$SKYCLOAK_CREDS" ]; then
  [ -s "$SKYCLOAK_CREDS" ] || { echo "ERROR: SKYCLOAK_CREDS='$SKYCLOAK_CREDS' is missing or empty." >&2; exit 1; }
  SC_ID="$(jq -r '.client_id' "$SKYCLOAK_CREDS")"
  SC_SECRET="$(jq -r '.client_secret' "$SKYCLOAK_CREDS")"
  SC_TOKEN_URL="$(jq -r '.token_url' "$SKYCLOAK_CREDS")"
  [ -n "$SC_ID" ] && [ "$SC_ID" != "null" ] || { echo "ERROR: no client_id in $SKYCLOAK_CREDS." >&2; exit 1; }
  AUTH_MODE="skycloak"
else
  KC_USER="${KC_BOOTSTRAP_ADMIN_USERNAME:-admin}"
  KC_PASS="${KC_BOOTSTRAP_ADMIN_PASSWORD:-${KC_ADMIN_PASSWORD:-}}"
  if [ -z "$KC_PASS" ]; then
    echo "ERROR: KC_BOOTSTRAP_ADMIN_PASSWORD is unset. Set it in .env (gitignored)." >&2
    exit 1
  fi
  AUTH_MODE="selfhost"
fi

say() { printf '\n\033[38;5;51m==>\033[0m %s\n' "$*"; }

# Master-admin tokens live ~60s. Mint on demand, never cache across steps.
get_token() {
  if [ "$AUTH_MODE" = "skycloak" ]; then
    curl -s -X POST "$SC_TOKEN_URL" \
      --data-urlencode "grant_type=client_credentials" \
      --data-urlencode "client_id=$SC_ID" \
      --data-urlencode "client_secret=$SC_SECRET" | jq -r '.access_token'
  else
    curl -s -X POST "$TIDECLOAK_URL/realms/master/protocol/openid-connect/token" \
      -H "Content-Type: application/x-www-form-urlencoded" \
      -d "grant_type=password" -d "client_id=admin-cli" \
      --data-urlencode "username=$KC_USER" \
      --data-urlencode "password=$KC_PASS" | jq -r '.access_token'
  fi
}

# With IGA on, a 2xx from an admin endpoint means ACCEPTED, not APPLIED.
# Every mutation below is followed by drain + a read-back assertion.
#
# Master-admin tokens live ~60s. Minting one per change request makes a
# 250-CR bootstrap take longer than the tokens do; cache one and re-mint on
# age instead.
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

# ---------------------------------------------------------------- preflight
say "Preflight"
curl -sf "$TIDECLOAK_URL/realms/master" >/dev/null || {
  echo "ERROR: no TideCloak on $TIDECLOAK_URL. Run the start-tidecloak-dev playbook first." >&2; exit 1; }
[ -n "$(get_token)" ] || { echo "ERROR: master admin login failed — check .env credentials." >&2; exit 1; }
# Distinguish "absent" from "you are not allowed to look". A 401/403 read as
# "free" is how a misdirected run gets all the way to the import before anything
# complains, and the import error then describes the wrong problem.
PF="$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $(tok)" \
  "$TIDECLOAK_URL/admin/realms/$REALM_NAME")"
case "$PF" in
  200) echo "ERROR: realm '$REALM_NAME' already exists on $TIDECLOAK_URL." >&2
       echo "       A realm cannot be un-flipped from multiAdmin. Local container: stop it," >&2
       echo "       delete ./data/keycloakdb*, restart. Hosted: delete the realm or pick a" >&2
       echo "       different REALM_NAME." >&2
       exit 1 ;;
  404) : ;;
  *)   echo "ERROR: probing $TIDECLOAK_URL/admin/realms/$REALM_NAME returned $PF." >&2
       echo "       Not 404, so this is NOT 'realm is free'. Most likely the token is for a" >&2
       echo "       different server than TIDECLOAK_URL points at — check both." >&2
       exit 1 ;;
esac
echo "  TideCloak reachable, credentials good, realm '$REALM_NAME' is free."

# ---------------------------------------------------------------- realm
say "Importing realm '$REALM_NAME' (client: $CLIENT_NAME, app: $CLIENT_APP_URL)"
TMP="$(mktemp)"
sed -e "s|REALM_NAME|$REALM_NAME|g" -e "s|CLIENT_NAME|$CLIENT_NAME|g" \
    -e "s|CLIENT_APP_URL|$CLIENT_APP_URL|g" "$HERE/realm.json.template" > "$TMP"

# Register EVERY origin now. Each URL contributes the bare origin, a wildcard,
# the silent-SSO page and the post-auth handler; web origins get the bare origin
# so the browser is allowed to talk to TideCloak at all.
URLS_JSON="$(printf '%s\n' $APP_URLS | jq -R . | jq -s .)"
TMP2="$(mktemp)"
jq --argjson urls "$URLS_JSON" '
  .clients[0].redirectUris = ($urls | map(., . + "/*", . + "/silent-check-sso.html", . + "/auth/redirect") | unique)
  | .clients[0].webOrigins = ($urls | unique)
' "$TMP" > "$TMP2" && mv "$TMP2" "$TMP"
echo "  origins: $APP_URLS"
IMP_BODY="$(mktemp)"
IMP_CODE="$(curl -s -o "$IMP_BODY" -w '%{http_code}' -X POST "$TIDECLOAK_URL/admin/realms" \
  -H "Authorization: Bearer $(tok)" -H "Content-Type: application/json" \
  --data-binary @"$TMP")"
case "$IMP_CODE" in
  2*) rm -f "$TMP" "$IMP_BODY" ;;
  *) echo "ERROR: realm import failed (HTTP $IMP_CODE): $(head -c 500 "$IMP_BODY")" >&2
     rm -f "$TMP" "$IMP_BODY"; exit 1 ;;
esac
curl -sf -H "Authorization: Bearer $(tok)" "$TIDECLOAK_URL/admin/realms/$REALM_NAME" >/dev/null \
  || { echo "ERROR: realm not readable after import." >&2; exit 1; }
echo "  Realm imported."

# ------------------------------------------- never show the KC profile page
# Tide asserts only a 64-hex username. Without this, every new player is
# stopped by Keycloak's unstyled "Update Account Information" form.
# MUST run before toggle-iga: afterwards a realm-config write is governed.
say "Disabling the first-broker-login profile page"
TOKEN="$(get_token)"
EXECS="$(curl -s "$TIDECLOAK_URL/admin/realms/$REALM_NAME/authentication/flows/first%20broker%20login/executions" -H "Authorization: Bearer $TOKEN")"
CFG_ID="$(printf '%s' "$EXECS" | jq -r '.[]? | select(.providerId=="idp-review-profile") | .authenticationConfig // empty' | head -1)"
EXEC_ID="$(printf '%s' "$EXECS" | jq -r '.[]? | select(.providerId=="idp-review-profile") | .id' | head -1)"
if [ -n "$CFG_ID" ]; then
  curl -s -o /dev/null -X PUT "$TIDECLOAK_URL/admin/realms/$REALM_NAME/authentication/config/$CFG_ID" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{"alias":"review profile config","config":{"update.profile.on.first.login":"off"}}'
elif [ -n "$EXEC_ID" ]; then
  curl -s -o /dev/null -X POST "$TIDECLOAK_URL/admin/realms/$REALM_NAME/authentication/executions/$EXEC_ID/config" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{"alias":"review profile config","config":{"update.profile.on.first.login":"off"}}'
fi
TOKEN="$(get_token)"
NOW_CFG="$(curl -s "$TIDECLOAK_URL/admin/realms/$REALM_NAME/authentication/flows/first%20broker%20login/executions" -H "Authorization: Bearer $TOKEN" | jq -r '.[]? | select(.providerId=="idp-review-profile") | .authenticationConfig // empty' | head -1)"
NOW_VAL=""
[ -n "$NOW_CFG" ] && NOW_VAL="$(curl -s "$TIDECLOAK_URL/admin/realms/$REALM_NAME/authentication/config/$NOW_CFG" -H "Authorization: Bearer $TOKEN" | jq -r '.config["update.profile.on.first.login"] // empty')"
[ "$NOW_VAL" = "off" ] || { echo "ERROR: profile page still on (read back '${NOW_VAL:-unset}')." >&2; exit 1; }
echo "  Off."

# ---------------------------------------------------------------- tide + iga
say "Activating Tide license + VRK (setUpTideRealm)"
curl -s -X POST "$TIDECLOAK_URL/admin/realms/$REALM_NAME/vendorResources/setUpTideRealm" \
  -H "Authorization: Bearer $(tok)" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "email=$ADMIN_EMAIL" --data-urlencode "isRagnarokEnabled=true" >/dev/null
curl -s "$TIDECLOAK_URL/admin/realms/$REALM_NAME/identity-provider/instances" \
  -H "Authorization: Bearer $(tok)" | jq -e '.[] | select(.alias=="tide")' >/dev/null \
  || { echo "ERROR: tide IdP absent — license/VRK setup failed." >&2; exit 1; }
echo "  Tide IdP present."

say "Stamping iga.attestor=tide (Tide governance, not Tideless)"
TOKEN="$(get_token)"
REP="$(curl -s "$TIDECLOAK_URL/admin/realms/$REALM_NAME" -H "Authorization: Bearer $TOKEN")"
curl -s -X PUT "$TIDECLOAK_URL/admin/realms/$REALM_NAME" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  --data-binary "$(echo "$REP" | jq '.attributes = ((.attributes // {}) + {"iga.attestor":"tide"})')" >/dev/null

# ------------------------------------------------- email must be optional
# Tide asserts a username (the vuid) and nothing else — no email, ever. But
# Keycloak's DEFAULT user profile marks email `required` for the admin and user
# roles. Two traps here, and each costs a debugging session:
#
#   1. Putting the override in the realm template does nothing — the
#      `components` user-profile block is ignored on realm create.
#   2. Doing it before `setUpTideRealm` does nothing EITHER: that call rewrites
#      the user profile, silently reverting it. The read-back passes, the script
#      reports success, and the 400 still arrives two steps later.
#
# So it goes HERE: after setUpTideRealm, before toggle-iga (afterwards it is a
# governed write that returns 202 and sits in a queue). The symptom it prevents:
#     {"field":"email","errorMessage":"error-user-attribute-required"}
# The wrong fix is a placeholder email (AP-85): Tide does not need one for
# recovery — password reset happens in the enclave — and a fabricated address
# is a real address belonging to someone else. Make the field optional instead.
#
say "Making email optional on the user profile (Tide never asserts one)"
TOKEN="$(get_token)"
UP="$(curl -s "$TIDECLOAK_URL/admin/realms/$REALM_NAME/users/profile" -H "Authorization: Bearer $TOKEN")"
curl -s -o /dev/null -X PUT "$TIDECLOAK_URL/admin/realms/$REALM_NAME/users/profile" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  --data-binary "$(echo "$UP" | jq '(.attributes[] | select(.name=="email")) |= del(.required)')"

REQ="$(curl -s "$TIDECLOAK_URL/admin/realms/$REALM_NAME/users/profile" -H "Authorization: Bearer $(get_token)" \
  | jq -r '.attributes[] | select(.name=="email") | .required // "none"')"
[ "$REQ" = "none" ] || { echo "ERROR: email is still required (got: $REQ) — user creation will 400." >&2; exit 1; }
echo "  Optional."

say "Enabling IGA"
# Form-encoded. A JSON body is parsed by nothing and the missing param fails OPEN to true.
IGA_OUT="$(curl -s -X POST "$TIDECLOAK_URL/admin/realms/$REALM_NAME/tide-admin/toggle-iga" \
  -H "Authorization: Bearer $(tok)" \
  -H "Content-Type: application/x-www-form-urlencoded" --data-urlencode "isIGAEnabled=true")"
case "$IGA_OUT" in *'"enabled":true'*) echo "  IGA enabled." ;;
  *) echo "ERROR: toggle-iga did not report enabled=true: $IGA_OUT" >&2; exit 1 ;; esac

sleep 2; drain

# ---------------------------------------------------------------- the cast
say "Creating the cast: $CAST"
for U in $CAST; do
  # Capture the response. A silent create loop turns one bad handle into
  # "role not found" three steps later, pointing at entirely the wrong step.
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
  [ -n "$ID" ] || { echo "ERROR: user '$U' does not exist after drain (2xx != applied)." >&2; exit 1; }
  echo "  $U -> $ID"
done

# Earned district roles, granted while still firstAdmin so they apply unattended.
# `ghost` is deliberately NOT granted here — in-game promotion to ghost is the
# IGA quorum ceremony, and must be approved by the council through the enclave.
say "Granting starting roles (crew-vault-access, fixer) — netrunner/ripperdoc/ghost stay locked"
# ONE NEW ROLE PER USER PER REQUEST, and drain before the next.
#
# Measured on TideCloak-dev / Keycloak 26.7: a role-mappings POST carrying two
# roles the user does not yet have returns **409** — and applies the first one
# anyway. Two sequential single-role POSTs are no better: the second lands while
# the first is still an open change request and the pair collapses. Either way
# you get a success-ish status code and half the roles, and the failure surfaces
# much later as a gate refusing someone who looks correctly provisioned.
#
# So: outer loop over roles, inner loop over users (different users do not
# conflict with each other), drain between rounds.
#
# What is deliberately NOT granted: netrunner and ripperdoc, so there is always
# a gate the player is genuinely refused at; and ghost, which exists to be won
# through the council quorum ceremony rather than handed out by a script.
START_ROLES="crew-vault-access fixer"
for R in $START_ROLES; do
  RJ="$(curl -s "$TIDECLOAK_URL/admin/realms/$REALM_NAME/roles/$R" -H "Authorization: Bearer $(tok)")"
  echo "$RJ" | jq -e '.id' >/dev/null || { echo "ERROR: role '$R' not found in realm." >&2; exit 1; }
  for U in $CAST; do
    [ "$U" = "admin" ] && continue
    CODE="$(curl -s -o /dev/null -w '%{http_code}' -X POST \
      "$TIDECLOAK_URL/admin/realms/$REALM_NAME/users/$(user_id "$U")/role-mappings/realm" \
      -H "Authorization: Bearer $(tok)" -H "Content-Type: application/json" --data-binary "[$RJ]")"
    case "$CODE" in
      2*) : ;;
      *) echo "ERROR: granting '$R' to $U returned HTTP $CODE." >&2; exit 1 ;;
    esac
  done
  echo "  $R: submitted for all players"
  sleep 2; drain
done

for U in $CAST; do
  [ "$U" = "admin" ] && continue
  HAVE="$(curl -s "$TIDECLOAK_URL/admin/realms/$REALM_NAME/users/$(user_id "$U")/role-mappings/realm" \
    -H "Authorization: Bearer $(tok)" | jq -r '[.[].name] | sort | join(",")')"
  for R in $START_ROLES; do
    case ",$HAVE," in
      *",$R,"*) : ;;
      *) echo "ERROR: $U is missing '$R' after drain. Has: $HAVE" >&2; exit 1 ;;
    esac
  done
  echo "  $U: $HAVE"
done

# ------------------------------------------------- server-side app config
say "Writing app/.env.local (server-only; gitignored)"
# The game's API routes proxy TideCloak's admin API for the council screen and
# the admin-policy fetch. That credential belongs to the SERVER process only —
# it is never bundled, never sent to the browser, and the browser never talks to
# the admin API directly.
if [ "$AUTH_MODE" = "skycloak" ]; then
  # Hosted: there is no master-admin password to hand the app. It authenticates
  # to the admin API with the cluster's automation client, same as this script.
  cat > "$ROOT/app/.env.local" <<ENVEOF
TIDECLOAK_URL=$TIDECLOAK_URL
REALM_NAME=$REALM_NAME
TIDECLOAK_ADMIN_MODE=client_credentials
SKYCLOAK_CLIENT_ID=$SC_ID
SKYCLOAK_CLIENT_SECRET=$SC_SECRET
SKYCLOAK_TOKEN_URL=$SC_TOKEN_URL
ENVEOF
else
  cat > "$ROOT/app/.env.local" <<ENVEOF
TIDECLOAK_URL=$TIDECLOAK_URL
REALM_NAME=$REALM_NAME
TIDECLOAK_ADMIN_MODE=password
KC_BOOTSTRAP_ADMIN_USERNAME=$KC_USER
KC_BOOTSTRAP_ADMIN_PASSWORD=$KC_PASS
ENVEOF
fi
chmod 600 "$ROOT/app/.env.local"
grep -q '^\.env\.local$' "$ROOT/app/.gitignore" 2>/dev/null || echo '.env.local' >> "$ROOT/app/.gitignore"

# The ORKs identify a contract by SHA-512 of its exact bytes. Copy, never rewrite.
cp "$ROOT/forseti/CrewVaultContract.cs" "$ROOT/app/data/CrewVaultContract.cs"
echo "  app/.env.local + contract copy in place."

# ---------------------------------------------------------------- enrolment
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
cat <<'BANNER'
  ------------------------------------------------------------------
  Each link creates a real Tide account: the password is verified by
  threshold protocol (PRISM) across the ORK network and is never sent
  to, stored by, or hashed on this server. Use a different browser
  profile per character so the sessions do not collide.
  ------------------------------------------------------------------
BANNER
echo "  (also written to invite-links.txt)"
echo
say "Waiting for all ${CAST// /, } to link (polling every 5s, Ctrl-C is safe — re-run resumes)"
while :; do
  MISSING=""
  for U in $CAST; do
    K="$(curl -s "$TIDECLOAK_URL/admin/realms/$REALM_NAME/users?username=$U&exact=true" \
      -H "Authorization: Bearer $(tok)" | jq -r '.[0].attributes.tideUserKey[0] // empty')"
    [ -z "$K" ] && MISSING="$MISSING $U"
  done
  [ -z "$MISSING" ] && break
  printf '\r  still waiting for:%s   ' "$MISSING"
  sleep 5
done
echo; echo "  All accounts linked."
sleep 2; drain

# ---------------------------------------------------------------- adapter
say "Exporting adapter JSON (Tide endpoint — the standard KC path omits jwk/vendorId/homeOrkUrl)"
CU="$(curl -s "$TIDECLOAK_URL/admin/realms/$REALM_NAME/clients?clientId=$CLIENT_NAME" \
  -H "Authorization: Bearer $(tok)" | jq -r '.[0].id')"
mkdir -p "$(dirname "$ADAPTER_OUTPUT")"
curl -s "$TIDECLOAK_URL/admin/realms/$REALM_NAME/vendorResources/get-installations-provider?clientId=$CU&providerId=keycloak-oidc-keycloak-json" \
  -H "Authorization: Bearer $(tok)" > "$ADAPTER_OUTPUT"
jq -e '.jwk.keys[0]' "$ADAPTER_OUTPUT" >/dev/null \
  || { echo "ERROR: adapter JSON has no jwk — server-side JWT verification cannot work." >&2; exit 1; }
jq -e '.vendorId' "$ADAPTER_OUTPUT" >/dev/null \
  || { echo "ERROR: adapter JSON has no vendorId — Forseti policy signing needs it as the keyId." >&2; exit 1; }
echo "  $ADAPTER_OUTPUT  (jwk + vendorId present)"

cat <<EOF

============================================================
 PHASE 1 COMPLETE — the realm is live and still in firstAdmin.
   realm    $REALM_NAME
   client   $CLIENT_NAME
   cast     $CAST

 STOP HERE AND DO THIS, IN THIS ORDER. It is a one-way door.

   1.  cd app && npm install && npm run dev
   2.  Log in as 'admin' at $CLIENT_APP_URL
   3.  Open  $CLIENT_APP_URL/forge  and sign the crew-vault Forseti policy.
       This is the single irreducible human step in the whole build: the VVK
       signature can only be produced by an admin's browser enclave. There is
       no server-side signing endpoint, and after the flip in phase 2 it costs
       a fresh multi-admin ceremony every time.
   4.  Then run:  bash scripts/seat-council.sh
       That grants tide-realm-admin to the council and flips the realm to
       multiAdmin — after which no server-driven governed write works again.
============================================================
EOF
