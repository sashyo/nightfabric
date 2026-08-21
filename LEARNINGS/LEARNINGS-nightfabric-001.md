# LEARNINGS — nightfabric-001

**App**: NIGHTFABRIC — a cyberpunk open-world three.js game as a Tide showcase.
Threshold login, doken-gated districts (server-side role checks), self-encrypted
loot, a Forseti-governed crew vault with a `DecryptTimeLock` contract, IGA-quorum
faction promotions, a quorum-gated "nuke" (retroactive role revocation),
DPoP-bound sessions, multiplayer presence/chat over an HTTP heartbeat, and an
in-game **breach console** that runs real attacks against the live deployment.
**Environment**: local Docker `tideorg/tidecloak-dev:latest`, then hosted
**Skycloak 0.14.17** reached over a **cloudflared tunnel**. Keycloak 26.7,
`@tidecloak/nextjs` + `@tideorg/js` + `heimdall-tide` @ 0.14.17-0.14.20,
Next.js 16.3.1.
**Date**: 2026-08-21.
**Scope reached**: both realms fully bootstrapped (license, IGA in Tide mode,
cast enrolled with real vuids, adapter with Ed25519 VVK), crew-vault Forseti
policy threshold-signed via the enclave, first admin seated (M0 written), app
playable and shared publicly over the tunnel with real multi-user sessions.

Each item is a concrete gap, a wrong/missing instruction, or a bug the pack
should warn about — all from real error messages or live state checks, not code
review. Severity in brackets; ordered CRITICAL→LOW.

---

## L-01 — DPoP is NOT enforced by verifying only the JWT signature [CRITICAL]

The pack's server-side verification pattern (`verifyTideJWT` in the exemplars,
`keylessh tideJWT.ts`) verifies the token signature, `iss`, `azp`, `exp` — and
STOPS. With `useDPoP: strict` on the client, every token is sender-constrained
(`cnf.jkt`) and secureFetch sends `Authorization: DPoP <token>` + a `DPoP`
proof. But if the resource server never checks that proof, a **stolen token
replays as a plain `Bearer` and succeeds**. The binding is decorative.

We proved it live: a bare-Bearer replay of a bound token to `/api/whoami`
returned `200`.

**The pack teaches DPoP as a client concern (`useDPoP`, the relay page, the CSP)
and never says the resource server must verify the proof.** It should ship a
`verifyDpop()` companion to `verifyTideJWT()` and state plainly: enabling DPoP
without server-side proof verification provides NONE of DPoP's protection.

What a correct verifier must do (RFC 9449), matched to what `@tidecloak/js`
actually signs (`tidecloak-dpop.js`):
- Require the `DPoP` auth scheme; reject a `cnf.jkt` token presented as `Bearer`.
- Verify the proof JWS with the `jwk` in its own header; `typ: dpop+jwt`.
- `calculateJwkThumbprint(jwk) === token.cnf.jkt`.
- `ath === base64url(sha256(accessToken))`.
- `htm === method`; `htu` host+path === request (see L-02).
- `iat` fresh; `jti` single-use (replay cache).

A working implementation is in this repo at `app/src/lib/auth/dpop.ts`.

## L-02 — Behind a proxy/tunnel, `req.nextUrl.origin` is wrong for htu [HIGH]

Reconstructing the DPoP `htu` (or any absolute self-URL) from
`req.nextUrl.origin` gives `https://localhost:3000` behind a cloudflared tunnel
— the wrong host — so htu verification rejects every legitimate request.
Measured: `x-forwarded-host` + `x-forwarded-proto` reconstruct the true origin
in BOTH the tunnelled and the direct-localhost case. The pack's DPoP material
should call this out; it is the difference between DPoP working and the whole
app 401ing behind any reverse proxy.

## L-03 — Admin-API approvals are attributed to the CALLER, not the doken subject [CRITICAL]

We proxied IGA change-request approvals through the app's server, which
authenticates with the Skycloak automation client. Result: every human enclave
signature was recorded under `service-account-skycloak-automation-…`. Because
filing a change request auto-authorizes the filer, that identity had already
voted, so the tally sat at `1/2` forever no matter how many humans approved.

This is a security bug, not cosmetics: a service account that can both propose
and approve holds two of the votes the quorum is meant to split.

**The pack's `setup-forseti-e2ee` "IGA Role Assignment Flow" shows the approval
submitted to `.../approval-model` but never warns that the endpoint credits the
CALLER.** It must state: governed approvals have to be sent to TideCloak from the
admin's browser with the admin's own DPoP-bound token — never through a
server-side proxy that holds a different identity. (The realm's CORS already
permits the app origin and the `DPoP` header, so direct browser→TideCloak calls
work; the pack should say so.)

## L-04 — The change-request approval count field is `authorizationCount` [MEDIUM]

`canon/iga-change-requests-api.md` implies `authCount` / `approvals`. The live
`GET /iga/change-requests` object (Keycloak 26.7, TideCloak 0.14.17) uses
**`authorizationCount`** (number) and **`authorizers`** (array of
`{username, timestamp}`). Reading `authCount ?? approvals?.length ?? 0` yields a
UI that shows `0/1 signed` next to `readyToCommit: true` — it reports the
signature missing at the same moment it reports the CR ready. Pack should list
the real field names, and advise falling back to `readyToCommit`, not to `0`.

## L-05 — `setUpTideRealm` rewrites the user profile; email-optional must come AFTER it [HIGH]

Tide asserts only a username, but Keycloak's default profile marks `email`
required for roles `admin`/`user`, so the FIRST `POST /users` 400s with
`error-user-attribute-required`. Two traps the pack misses:
1. Putting the fix in the realm import (`components` user-profile block) does
   nothing — it is ignored on create.
2. Doing it BEFORE `setUpTideRealm` does nothing either — that call rewrites the
   user profile and silently reverts it. The read-back passes, the script
   reports success, and the 400 arrives two steps later.
Correct order: import → **setUpTideRealm** → make email optional
(`PUT /users/profile`, delete `.required`) → toggle-iga (after IGA it is a
governed write). The pack's bootstrap never makes email optional at all and
never warns about the rewrite.

## L-06 — The forge/M0 window is AFTER first-admin, not "before the flip" [HIGH]

`setup-forseti-e2ee` says sign app policies "while still firstAdmin", because
step 3 attaches the realm admin policy from `GET /iga/role-policies`. But that
endpoint returns `[]` until the FIRST `tide-realm-admin` grant commits — that
commit is what writes the M0 admin policy. So an app policy CANNOT be signed
before any admin is seated; there is nothing to attach.

The real cheap window is: seat exactly ONE admin (quorum = `max(1, floor(1*0.7))`
= 1, every approval one popup) → sign app policies → THEN seat the rest (quorum
rises to 2). The pack's "grant tide-realm-admin LAST" advice is right for
avoiding the multiAdmin flip on governed writes, but it collides with policy
signing and the pack never reconciles the two. Recommend a documented 3-phase
bootstrap: realm+cast → seat-first-admin (writes M0) → sign policies → seat-rest.

## L-07 — One role-mappings POST with two NEW roles returns 409 and applies one [MEDIUM]

`POST /users/{id}/role-mappings/realm` with a body of two roles the user does
not yet have returns **409** and applies the first anyway. Two sequential
single-role POSTs are no better: the second lands while the first is an open
change request and the pair collapses. Reliable pattern under IGA: one NEW role
per user per request, drain between rounds. The pack's role-assignment examples
send arrays and never mention this.

## L-08 — `.env` sourced with `set -a` clobbers caller-provided variables [MEDIUM]

`templates/shared/bootstrap-tidecloak.sh` does `set -a; . ./.env; set +a`. When
a caller runs `TIDECLOAK_URL=https://cluster… bash bootstrap.sh` (self-host →
hosted), the `.env` value overrides the CLI arg, so the run targets localhost
with a hosted token. The realm-exists probe reads the resulting 401 as "realm is
free" and the failure surfaces much later at import. Fix: save caller vars before
sourcing `.env`, restore after (`.env` = defaults, not overrides). Also: the
probe should distinguish 404 (absent) from 401/403 (wrong server/token).

## L-09 — Skycloak version-discovery endpoints are gone on current prod [MEDIUM]

`provision-tidecloak-skycloak` and `templates/shared/skycloak-latest-version.sh`
call `GET /clusters/supported-versions?type=tidecloak` and `GET
/clusters/versions`. On prod (2026-08) BOTH return
`400 "Invalid parameter: cluster_id"` — `/clusters/{cluster_id}` swallows the
trailing path segment and tries to parse the word as a UUID. The pack's own
helper fails identically. Playbook should: pin explicitly when discovery is
unavailable (0.14.17 verified floor), NEVER walk the version list downward on a
`400 invalid cluster version` (silent downgrade), and note the endpoint may be
absent.

## L-10 — Skycloak `status: available` precedes the cluster actually serving [LOW]

Immediately after status flips to `available`, `GET /clusters/{id}/credentials`
returns a non-JSON error page for a while; piping it into `jq` gives "Invalid
numeric literal at line 1, column 3", which reads like a malformed credential and
is really a race. Retry until it parses; likewise retry `client_credentials` and
the first `/admin/realms` call. Pack's Step 2/3 should poll, not assume.

## L-11 — Bootstrap drain: cache the admin token [LOW]

`bootstrap-tidecloak.sh` mints a fresh master token per change request. A
250-CR bootstrap outlives a 60s token and the drain stalls. Cache one token,
re-mint on age (~40s). The pack code re-fetches per curl.

## L-12 — The pack's `get_token` hardcodes `password=password` [LOW]

Several playbook snippets and `bootstrap-tidecloak.sh`'s `get_token` send
`password=password` literally, contradicting the pack's own AP-41 (no hardcoded
credentials). Should read `KC_BOOTSTRAP_ADMIN_PASSWORD` from the environment.

## L-13 — Edge CDNs cache a 405 for a method the route didn't yet implement [LOW]

Through cloudflared, `PUT /api/nuke` returned 405 while the origin returned 401
for the same request, and `PUT /api/council/[id]` worked. Cloudflare had cached
the 405 from before the handler existed; no cache-buster or `no-cache` header
cleared it. Not Tide-specific, but worth a note in the hosting/tunnel guidance:
behind a CDN, a method that 405s once can stay 405 — use a distinct path or POST.

---

## What the pack got RIGHT and saved us

- The "2xx means ACCEPTED not APPLIED under IGA; drain then read back" rule
  (canon/concepts.md) caught L-05 and L-07 at the point of failure instead of
  three steps later.
- `templates/forseti-compile-harness/check.sh` compiled the crew-vault contract
  and computed the SHA-512 contractId in one shot — no wasted enclave approvals.
- The CSP guidance (`frame-src 'self' *`, do NOT add `frame-ancestors`) was
  exactly right; SWE + DPoP relay worked first try.
- The firstAdmin→multiAdmin one-way-door framing is correct and load-bearing;
  the only gap is reconciling it with policy signing (L-06).
