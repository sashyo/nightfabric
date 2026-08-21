#!/usr/bin/env bash
# skycloak-up.sh — provision a hosted TideCloak cluster for NIGHTFABRIC.
#
# Needs a device token at $SCRATCH/device_token (see the device-authorization
# step) OR a stored API key at scripts/.skycloak-api-key.
#
# Writes:
#   scripts/.skycloak-api-key   the minted key   (shown once by the API — keep it)
#   scripts/.skycloak-cluster   {id, url}
#   scripts/.skycloak-creds     automation client_id/secret/token_url
#
# All three are bootstrap secrets: shell/CI only, never in app code, never in
# tidecloak.json, never committed (AP-HOST-3).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
cd "$ROOT"

API="https://api.skycloak.io"
VER="2026-06-01.beta"
KEY_FILE="$HERE/.skycloak-api-key"
CLUSTER_FILE="$HERE/.skycloak-cluster"
CREDS_FILE="$HERE/.skycloak-creds"
CLUSTER_NAME="${CLUSTER_NAME:-nightfabric-auth}"
LOCATION="${LOCATION:-us}"
SIZE="${SIZE:-small}"
FLOOR="${FLOOR:-0.14.17}"

say() { printf '\n\033[38;5;51m==>\033[0m %s\n' "$*"; }

# ------------------------------------------------------------------ api key
say "API key"
SKYCLOAK_API_KEY=""
if [ -s "$KEY_FILE" ]; then
  code=$(curl -s -m 20 -o /dev/null -w "%{http_code}" "$API/clusters" \
    -H "API-Key: $(cat "$KEY_FILE")" -H "API-Version: $VER")
  case "$code" in
    200) echo "  reusing stored key"; SKYCLOAK_API_KEY="$(cat "$KEY_FILE")" ;;
    401|403) echo "  stored key is dead ($code) — minting a new one" ;;
    *) echo "ERROR: cannot reach the Skycloak API ($code). Fix connectivity; do NOT mint." >&2; exit 1 ;;
  esac
fi

if [ -z "$SKYCLOAK_API_KEY" ]; then
  [ -n "${DEVICE_TOKEN:-}" ] || { echo "ERROR: DEVICE_TOKEN unset and no usable stored key." >&2; exit 1; }
  # Keys cannot be listed or deleted with a device token, and full_key is shown
  # exactly once — so minting on every run silently burns the per-plan quota.
  mint=$(curl -s -X POST "https://app.skycloak.io/api/cli/keys" \
    -H "Authorization: Bearer $DEVICE_TOKEN" -H "Content-Type: application/json" \
    -d '{"name":"nightfabric-bootstrap","scopes":[
          "clusters:write","realms:write","applications:write",
          "realm-users:write","identity-providers:write",
          "clusters:credentials:read","clusters:logs:read","clusters:events:read"]}')
  SKYCLOAK_API_KEY="$(echo "$mint" | jq -r '.full_key // empty')"
  if [ -z "$SKYCLOAK_API_KEY" ]; then
    echo "ERROR: mint failed: $mint" >&2
    echo "  Four gates each return 403: workspace membership, API-keys permission," >&2
    echo "  verified email, plan key quota. A 401 is the token, not a gate." >&2
    exit 1
  fi
  printf '%s' "$SKYCLOAK_API_KEY" > "$KEY_FILE"; chmod 600 "$KEY_FILE"
  echo "  minted and stored in $KEY_FILE"
fi
H=(-H "API-Key: $SKYCLOAK_API_KEY" -H "API-Version: $VER")

# ----------------------------------------------------------------- version
say "Resolving the TideCloak version"
# Ask Skycloak first. Both documented shapes may be absent: on this deployment
# (2026-08) `/clusters/{cluster_id}` swallows any trailing path segment, so
# `/clusters/supported-versions` and `/clusters/versions` both come back as
# `400 Invalid parameter: cluster_id` trying to parse the word as a UUID. The
# pack's own skycloak-latest-version.sh fails the same way.
#
# When discovery is unavailable we PIN, and we pin UP-FRONT and loudly. What we
# never do is submit a version, get `400 invalid cluster version`, and retry
# with an older one — that walks silently down to a months-old build and nothing
# reports it. A rejection here is a hard failure to surface, not a hint.
#
# Default pin 0.14.17: the pack's VERIFIED-working hosted version, and the exact
# version of the installed @tidecloak/nextjs. Below it, 0.14.11 fails
# setUpTideRealm with KEYGEN_FAILED and 0.13.13 ships a broken automation client.
VERSION="${VERSION:-}"
RAW="$(curl -s "$API/clusters/supported-versions?type=tidecloak" "${H[@]}")"
LIST="$(echo "$RAW" | jq -r 'if type=="array" then .[] elif (type=="object" and .tidecloak) then .tidecloak[] else empty end' 2>/dev/null || true)"
if [ -z "$LIST" ]; then
  RAW2="$(curl -s "$API/clusters/versions" "${H[@]}")"
  LIST="$(echo "$RAW2" | jq -r '.tidecloak[]?' 2>/dev/null || true)"
fi

if [ -n "$LIST" ]; then
  # Sort NUMERICALLY — as strings "0.9.8" > "0.14.20", which would select below
  # the floor and fail later as a licensing error dressed up as KEYGEN_FAILED.
  DISCOVERED="$(printf '%s\n' $LIST | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' \
    | awk -v f="$FLOOR" 'function n(v){split(v,a,".");return a[1]*1000000+a[2]*1000+a[3]}
         n($0) >= n(f) {print}' | sort -t. -k1,1n -k2,2n -k3,3n | tail -1)"
  [ -n "$DISCOVERED" ] || { echo "ERROR: nothing at or above floor $FLOOR. Offered: $(echo $LIST|tr '\n' ' ')" >&2; exit 1; }
  echo "  offered:  $(echo $LIST | tr '\n' ' ')"
  VERSION="${VERSION:-$DISCOVERED}"
  echo "  choosing: $VERSION"
else
  VERSION="${VERSION:-0.14.17}"
  cat >&2 <<MSG
  WARNING: Skycloak's version-discovery endpoints are unavailable on this
  deployment (both return 400 'Invalid parameter: cluster_id'). Falling back to
  the pinned version $VERSION.

  That pin is verified-good on hosted and matches the installed
  @tidecloak/nextjs, but it is a PIN: if Skycloak now offers something newer,
  this will not find it. Override with VERSION=x.y.z once discovery is back.
MSG
fi

# ----------------------------------------------------------------- cluster
if [ -s "$CLUSTER_FILE" ] && [ "${FORCE_NEW_CLUSTER:-0}" != "1" ]; then
  CLUSTER_ID="$(jq -r '.id' "$CLUSTER_FILE")"
  say "Reusing cluster $CLUSTER_ID (FORCE_NEW_CLUSTER=1 to replace)"
else
  say "Creating cluster '$CLUSTER_NAME' ($SIZE, $LOCATION, TideCloak $VERSION)"
  BODY="$(jq -n --arg n "$CLUSTER_NAME" --arg s "$SIZE" --arg l "$LOCATION" --arg v "$VERSION" \
    '{type:"tidecloak", name:$n, size:$s, location:$l, version:$v}')"
  RESP="$(curl -s -w '\n%{http_code}' -X POST "$API/clusters" "${H[@]}" \
    -H "Content-Type: application/json" -d "$BODY")"
  CODE="$(printf '%s' "$RESP" | tail -1)"
  JSON="$(printf '%s' "$RESP" | sed '$d')"
  if [ "$CODE" != "201" ] && [ "$CODE" != "200" ]; then
    echo "ERROR: create failed ($CODE): $JSON" >&2
    case "$JSON" in
      *"Plan Limit"*|*plan*) echo "  Trial allows ONE cluster. Delete the old one or upgrade." >&2 ;;
      *"invalid cluster version"*)
         echo "  Skycloak refused version '$VERSION'. Do NOT retry with an older one — that is how" >&2
         echo "  you end up silently provisioning a months-old build. Set VERSION=x.y.z explicitly" >&2
         echo "  to a version Skycloak accepts, or ask them which they now offer." >&2 ;;
      *) echo "  A plain 500 here usually means TideCloak is not enabled for your workspace." >&2
         echo "  It is not on by default in prod; ask Skycloak to enable it." >&2 ;;
    esac
    exit 1
  fi
  # `identityPlatform` is accepted, ignored, and yields a PLAIN KEYCLOAK cluster.
  # We used `type`, but verify anyway — everything downstream depends on it.
  T="$(echo "$JSON" | jq -r '.type')"; V="$(echo "$JSON" | jq -r '.version')"
  [ "$T" = "tidecloak" ] || { echo "ERROR: got type='$T', not tidecloak." >&2; exit 1; }
  [ "$V" = "$VERSION" ] || echo "  WARNING: asked for $VERSION, got $V"
  CLUSTER_ID="$(echo "$JSON" | jq -r '.id')"
  echo "  id=$CLUSTER_ID type=$T version=$V"
fi

say "Waiting for the cluster to come up"
for i in $(seq 1 60); do
  S="$(curl -s "${H[@]}" "$API/clusters/$CLUSTER_ID" | jq -r '.status')"
  printf '\r  %s (%ss)   ' "$S" "$((i*15))"
  case "$S" in
    available) echo; break ;;
    failed) echo; echo "ERROR: provisioning failed." >&2; exit 1 ;;
  esac
  sleep 15
done
[ "$S" = "available" ] || { echo "ERROR: not available after 15min." >&2; exit 1; }

TIDECLOAK_URL="https://${CLUSTER_ID}.${LOCATION}.skycloak.io"
jq -n --arg id "$CLUSTER_ID" --arg url "$TIDECLOAK_URL" --arg v "$VERSION" \
  '{id:$id,url:$url,version:$v}' > "$CLUSTER_FILE"
echo "  $TIDECLOAK_URL"

# ------------------------------------------------------------- automation
say "Fetching the automation client (Skycloak issues no master admin password)"
# `status: available` from the control plane runs AHEAD of the cluster actually
# serving: the credentials endpoint returns a non-JSON error page for a while
# after. Piping that straight into jq gives "Invalid numeric literal at line 1,
# column 3", which reads like a malformed credential and is really a race.
# Retry until it parses.
CID=""; CSEC=""; TURL=""
for i in $(seq 1 20); do
  curl -s "${H[@]}" "$API/clusters/$CLUSTER_ID/credentials" -o "$CREDS_FILE" || true
  chmod 600 "$CREDS_FILE" 2>/dev/null || true
  if jq -e '.client_id and .client_secret and .token_url' "$CREDS_FILE" >/dev/null 2>&1; then
    CID="$(jq -r '.client_id' "$CREDS_FILE")"
    CSEC="$(jq -r '.client_secret' "$CREDS_FILE")"
    TURL="$(jq -r '.token_url' "$CREDS_FILE")"
    break
  fi
  printf '\r  credentials not serving yet (%ss)   ' "$((i*10))"
  sleep 10
done
echo
[ -n "$CID" ] || { echo "ERROR: no automation credentials after 200s. Last body:" >&2
                   head -c 300 "$CREDS_FILE" >&2; echo >&2; exit 1; }
echo "  client_id $CID"

TOK=""
for i in $(seq 1 12); do
  TOK="$(curl -s -X POST "$TURL" \
    --data-urlencode "grant_type=client_credentials" \
    --data-urlencode "client_id=$CID" --data-urlencode "client_secret=$CSEC" \
    | jq -r '.access_token // empty' 2>/dev/null || true)"
  [ -n "$TOK" ] && break
  printf '\r  token endpoint not ready (%ss)   ' "$((i*10))"
  sleep 10
done
echo
[ -n "$TOK" ] || { echo "ERROR: client_credentials never succeeded — a 500 here means a broken cluster version." >&2; exit 1; }

CODE=""
for i in $(seq 1 12); do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' "$TIDECLOAK_URL/admin/realms" -H "Authorization: Bearer $TOK")"
  [ "$CODE" = "200" ] && break
  printf '\r  admin API returned %s (%ss)   ' "$CODE" "$((i*10))"
  sleep 10
done
echo
[ "$CODE" = "200" ] || { echo "ERROR: admin API returned $CODE." >&2; exit 1; }
echo "  admin token OK"

say "Confirming the Tide vendor surface is present"
# READ-ONLY. Never probe with POST /tide-admin/toggle-iga: it reads a FORM param
# and a JSON body's missing param fails OPEN to true — the old probe silently
# ENABLED IGA on master and kicked off a Phase-6 ADOPT scan.
CODE="$(curl -s -o /dev/null -w '%{http_code}' \
  "$TIDECLOAK_URL/admin/realms/master/iga/change-requests?status=PENDING" \
  -H "Authorization: Bearer $TOK")"
[ "$CODE" = "200" ] || { echo "ERROR: iga surface returned $CODE — this is plain Keycloak, wrong cluster type." >&2; exit 1; }
echo "  200 — real TideCloak"

cat <<EOF

============================================================
 CLUSTER READY
   id        $CLUSTER_ID
   url       $TIDECLOAK_URL
   version   $VERSION
   console   $TIDECLOAK_URL/admin/master/console/

 Next:
   TIDECLOAK_URL=$TIDECLOAK_URL \\
   SKYCLOAK_CREDS=$CREDS_FILE \\
   APP_URLS="<tunnel-url> http://localhost:3000" \\
   bash scripts/init-nightfabric.sh
============================================================
EOF
