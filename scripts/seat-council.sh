#!/usr/bin/env bash
# seat-council.sh — PHASE 3. Add the rest of the council. Quorum rises to 2.
#
# Run this AFTER seat-first-admin.sh and AFTER the vault policy is signed.
#
# The realm is already multiAdmin at this point, so these grants are governed:
# each one returns 202 and sits as a change request that a human must approve in
# their browser enclave. Right now quorum is 1, so the single seated admin can
# approve them alone — which is exactly why this is the last step. Once they
# commit there are 3 admins and quorum becomes max(1, floor(3 * 0.7)) = 2, and
# every governed change from then on needs two independent enclave signatures.
#
# That is the property the game is built to demonstrate. It is also irreversible,
# so anything you still want done cheaply, do it before running this.
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
COUNCIL="${COUNCIL:-judy takemura}"

say "Preflight"
POL="$(curl -s "$TIDECLOAK_URL/admin/realms/$REALM_NAME/iga/role-policies" -H "Authorization: Bearer $(tok)" \
  | jq -r 'if type=="array" then ([.[] | select(.policy != null and .policy != "")] | length) else 0 end')"
[ "${POL:-0}" -ge 1 ] || { echo "ERROR: no M0 admin policy — run scripts/seat-first-admin.sh first." >&2; exit 1; }

if [ "${SKIP_POLICY_CHECK:-0}" != "1" ]; then
  if ! jq -e '.vaultPolicy != null' "$ROOT/app/data/world.json" >/dev/null 2>&1; then
    cat >&2 <<MSG
ERROR: the crew-vault policy is not signed yet.

  Sign it FIRST, while quorum is still 1 and it costs one popup:
      log in as '$FIRST_ADMIN' at $CLIENT_APP_URL
      open $CLIENT_APP_URL/forge  ->  "SIGN THE VAULT POLICY"

  After this script, quorum is 2 and the same signature needs two council
  members present at once. Re-run with SKIP_POLICY_CHECK=1 to proceed anyway
  (the vault terminal stays sealed in-game).
MSG
    exit 1
  fi
  echo "  Signed vault policy present."
fi

RM="$(curl -s "$TIDECLOAK_URL/admin/realms/$REALM_NAME/clients?clientId=realm-management" \
  -H "Authorization: Bearer $(tok)" | jq -r '.[0].id')"
[ -n "$RM" ] && [ "$RM" != "null" ] || { echo "ERROR: realm-management client not found." >&2; exit 1; }
TRA="$(curl -s "$TIDECLOAK_URL/admin/realms/$REALM_NAME/clients/$RM/roles/tide-realm-admin" -H "Authorization: Bearer $(tok)")"
echo "$TRA" | jq -e '.id' >/dev/null || { echo "ERROR: tide-realm-admin role missing." >&2; exit 1; }

say "Submitting tide-realm-admin grants for: $COUNCIL"
for U in $COUNCIL; do
  ID="$(user_id "$U")"
  [ -n "$ID" ] || { echo "ERROR: '$U' does not exist." >&2; exit 1; }
  CODE="$(curl -s -o /dev/null -w '%{http_code}' -X POST \
    "$TIDECLOAK_URL/admin/realms/$REALM_NAME/users/$ID/role-mappings/clients/$RM" \
    -H "Authorization: Bearer $(tok)" -H "Content-Type: application/json" -d "[$TRA]")"
  echo "  $U: HTTP $CODE"
done

say "Pending change requests"
curl -s "$TIDECLOAK_URL/admin/realms/$REALM_NAME/iga/change-requests?status=PENDING" \
  -H "Authorization: Bearer $(tok)" \
  | jq -r 'if type=="array" then (.[] | "  \(.actionType)  ready=\(.readyToCommit)  id=\(.id)") else . end'

cat <<EOF

============================================================
 SUBMITTED — and deliberately NOT committed by this script.

 A server-side authorize cannot finish these. In Tide multiAdmin mode the
 approval IS a threshold signature produced in an admin's browser enclave;
 there is no endpoint on this machine that can forge one, which is the entire
 point. (POST .../authorize exists and will not help you here.)

 Approve them in-game, as '$FIRST_ADMIN':
   $CLIENT_APP_URL/play  ->  COUNCIL RELAY in The Sprawl (hold E)
   press SIGN on each row, then COMMIT

 Quorum is 1 right now, so you alone can do it. The moment both commit there
 are 3 admins and quorum becomes 2 — from then on promoting a runner to
 'ghost' needs judy or takemura at a second browser, and nothing on this box
 can substitute for them.
============================================================
EOF
