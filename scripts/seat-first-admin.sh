#!/usr/bin/env bash
# seat-first-admin.sh — PHASE 2. Seat ONE admin. Quorum becomes 1.
#
# Why this is its own phase, and why it comes BEFORE signing the vault policy:
#
# Committing the first `tide-realm-admin` grant is what writes the realm's M0
# admin policy. That commit does four things in one transaction, in this order:
#
#     sign the producer unit (firstAdmin pack, still alive)
#       -> sign the M0 admin Policy   (only this pack can: it alone carries Policy:1)
#       -> persist the policy row
#       -> ONLY THEN flip firstAdmin -> multiAdmin, which BURNS the pack
#
# Step 3 of every later policy-signing ceremony has to ATTACH that M0 policy.
# Before this script runs, `GET /iga/role-policies` returns `[]` and the forge
# fails with "Policy supplied has not been signed" — there is nothing to attach.
#
# So the cheap window for signing app policies is not "before the flip". It is
# AFTER this script and BEFORE seat-council.sh, when exactly one admin exists
# and quorum is max(1, floor(1 * 0.7)) = 1: every approval is one popup.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
cd "$ROOT"

# shellcheck source=lib.sh
. "$HERE/lib.sh"
nf_load_env
nf_auth_init "$HERE"

REALM_NAME="${REALM_NAME:-nightfabric}"
CLIENT_NAME="${CLIENT_NAME:-nightfabric-client}"
CLIENT_APP_URL="${CLIENT_APP_URL:-http://localhost:3000}"
ADAPTER_OUTPUT="${ADAPTER_OUTPUT:-$ROOT/app/data/tidecloak.json}"
FIRST_ADMIN="${FIRST_ADMIN:-admin}"

say "Preflight"
ID="$(user_id "$FIRST_ADMIN")"
[ -n "$ID" ] || { echo "ERROR: user '$FIRST_ADMIN' not found — run init-nightfabric.sh first." >&2; exit 1; }
KEY="$(curl -s "$TIDECLOAK_URL/admin/realms/$REALM_NAME/users?username=$FIRST_ADMIN&exact=true" \
  -H "Authorization: Bearer $(tok)" | jq -r '.[0].attributes.tideUserKey[0] // empty')"
[ -n "$KEY" ] || { echo "ERROR: '$FIRST_ADMIN' has not linked a Tide account yet." >&2; exit 1; }
echo "  $FIRST_ADMIN exists and is linked."

say "Pointing the Tide IdP at this realm's console origin, then signing IdP settings"
# Both need healthy ORKs and must happen while still firstAdmin.
TOKEN="$(tok)"
INST="$(curl -s "$TIDECLOAK_URL/admin/realms/$REALM_NAME/identity-provider/instances/tide" -H "Authorization: Bearer $TOKEN")"
curl -s -X PUT "$TIDECLOAK_URL/admin/realms/$REALM_NAME/identity-provider/instances/tide" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "$(echo "$INST" | jq --arg d "$TIDECLOAK_URL/realms/$REALM_NAME/tide-console/" '.config.CustomAdminUIDomain=$d')" >/dev/null
curl -s -X POST "$TIDECLOAK_URL/admin/realms/$REALM_NAME/vendorResources/sign-idp-settings" \
  -H "Authorization: Bearer $(tok)" >/dev/null
echo "  Signed."

say "Granting tide-realm-admin to '$FIRST_ADMIN' (writes M0, then flips to multiAdmin)"
RM="$(curl -s "$TIDECLOAK_URL/admin/realms/$REALM_NAME/clients?clientId=realm-management" \
  -H "Authorization: Bearer $(tok)" | jq -r '.[0].id')"
[ -n "$RM" ] && [ "$RM" != "null" ] || { echo "ERROR: realm-management client not found." >&2; exit 1; }
TRA="$(curl -s "$TIDECLOAK_URL/admin/realms/$REALM_NAME/clients/$RM/roles/tide-realm-admin" -H "Authorization: Bearer $(tok)")"
echo "$TRA" | jq -e '.id' >/dev/null || { echo "ERROR: tide-realm-admin role missing: $TRA" >&2; exit 1; }

CODE="$(curl -s -o /dev/null -w '%{http_code}' -X POST \
  "$TIDECLOAK_URL/admin/realms/$REALM_NAME/users/$ID/role-mappings/clients/$RM" \
  -H "Authorization: Bearer $(tok)" -H "Content-Type: application/json" -d "[$TRA]")"
echo "  HTTP $CODE (accepted — not yet applied)"
sleep 2; drain

# Read back. A 2xx here means nothing; the flip is the whole point of the step.
curl -s "$TIDECLOAK_URL/admin/realms/$REALM_NAME/users/$ID/role-mappings/clients/$RM" \
  -H "Authorization: Bearer $(tok)" | jq -e '.[] | select(.name=="tide-realm-admin")' >/dev/null \
  || { echo "ERROR: $FIRST_ADMIN did not receive tide-realm-admin." >&2; exit 1; }
echo "  Granted."

say "Checking the M0 admin policy was written"
# This is the actual success condition. Without it, every later policy-signing
# ceremony fails at step 3 with nothing to attach.
POLICIES="$(curl -s "$TIDECLOAK_URL/admin/realms/$REALM_NAME/iga/role-policies" -H "Authorization: Bearer $(tok)")"
N="$(echo "$POLICIES" | jq -r 'if type=="array" then ([.[] | select(.policy != null and .policy != "")] | length) else 0 end')"
if [ "${N:-0}" -lt 1 ]; then
  echo "ERROR: no signed admin policy after the grant commit." >&2
  echo "       /iga/role-policies returned: $(echo "$POLICIES" | head -c 300)" >&2
  echo "       Without it the forge cannot attach an admin policy and signing will fail." >&2
  exit 1
fi
echo "  M0 present: $(echo "$POLICIES" | jq -r '[.[].name] | join(", ")')"

say "Re-exporting adapter JSON"
CU="$(curl -s "$TIDECLOAK_URL/admin/realms/$REALM_NAME/clients?clientId=$CLIENT_NAME" \
  -H "Authorization: Bearer $(tok)" | jq -r '.[0].id')"
curl -s "$TIDECLOAK_URL/admin/realms/$REALM_NAME/vendorResources/get-installations-provider?clientId=$CU&providerId=keycloak-oidc-keycloak-json" \
  -H "Authorization: Bearer $(tok)" > "$ADAPTER_OUTPUT"
jq -e '.jwk.keys[0]' "$ADAPTER_OUTPUT" >/dev/null || { echo "ERROR: adapter lost its jwk." >&2; exit 1; }

cat <<EOF

============================================================
 PHASE 2 COMPLETE — one admin seated, realm is multiAdmin.
   admin        $FIRST_ADMIN
   IGA quorum   max(1, floor(1 * 0.7)) = 1   <- every approval is ONE popup

 Do the expensive things NOW, while quorum is 1:

   1.  Log out and back in as '$FIRST_ADMIN' (the doken needs the new role).
   2.  http://localhost:3000/forge  -> SIGN THE VAULT POLICY
   3.  bash scripts/seat-council.sh   (adds the rest of the council; each grant
       is one enclave approval at quorum 1, after which quorum rises to 2)
============================================================
EOF
