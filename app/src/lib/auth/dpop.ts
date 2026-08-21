/**
 * Server-side DPoP proof verification (RFC 9449).
 *
 * WHY THIS EXISTS
 * ---------------
 * The adapter enables `useDPoP: strict`, so the SDK sender-constrains every
 * token: it carries `cnf.jkt`, and secureFetch presents it as
 * `Authorization: DPoP <token>` with a fresh `DPoP: <proof>` header signed by a
 * key that never leaves the browser.
 *
 * None of that means anything unless the RESOURCE SERVER checks the proof.
 * Verifying only the token signature — which is all `verifyTideJWT` did — leaves
 * a DPoP-bound token replayable as a plain Bearer, because nothing ever looks at
 * the binding. The breach console caught exactly this: "replay without a proof →
 * HTTP 200". This module closes it, so a stolen token is inert without the
 * browser-held key.
 *
 * WHAT THE SDK SIGNS (verified against @tidecloak/js tidecloak-dpop.js)
 *   header:  { alg: "ES256", typ: "dpop+jwt", jwk: {crv,kty,x,y} }
 *   payload: { jti, htm, htu: origin+pathname, iat, ath: b64url(sha256(token)) }
 *
 * The htu the browser signs uses the PAGE origin. Behind the tunnel,
 * `req.nextUrl.origin` is wrong (`https://localhost:3000`), but
 * `x-forwarded-host` + `x-forwarded-proto` reconstruct the real origin in both
 * the tunnelled and the localhost case. Measured, not assumed.
 */
import { NextRequest } from "next/server";
import { importJWK, jwtVerify, calculateJwkThumbprint, decodeProtectedHeader } from "jose";

/** In-memory replay guard. A jti may be presented once within its lifetime. */
const SEEN = new Map<string, number>();
const JTI_TTL_MS = 5 * 60_000;
/** iat must be within this window of now (covers clock skew both ways). */
const IAT_SKEW_S = 300;

function pruneSeen(now: number) {
  if (SEEN.size < 4096) return;
  for (const [jti, exp] of SEEN) if (exp < now) SEEN.delete(jti);
}

async function sha256b64url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  // base64url, no padding.
  let bin = "";
  const bytes = new Uint8Array(digest);
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Origin the browser used, reconstructed from proxy headers (see file header). */
function requestOrigin(req: NextRequest): { origin: string; host: string } {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  return { origin: `${proto}://${host}`, host };
}

export class DpopError extends Error {}

/**
 * Throws DpopError if the request does not carry a valid proof binding the
 * presented token to the key named by `jkt`.
 */
export async function verifyDpop(
  req: NextRequest,
  accessToken: string,
  scheme: string,
  jkt: string,
): Promise<void> {
  // A sender-constrained token presented as a plain Bearer is invalid per
  // RFC 9449 §7.1 — this IS the replay attack, so refuse it here.
  if (scheme.toLowerCase() !== "dpop") {
    throw new DpopError("token is DPoP-bound but was presented as Bearer (no proof)");
  }

  const proof = req.headers.get("DPoP");
  if (!proof) throw new DpopError("missing DPoP proof header");

  // 1. The proof is self-signed by the holder key carried in its own header.
  let header: any;
  try {
    header = decodeProtectedHeader(proof);
  } catch {
    throw new DpopError("malformed DPoP proof");
  }
  if (header.typ !== "dpop+jwt") throw new DpopError("DPoP proof has wrong typ");
  if (!header.jwk) throw new DpopError("DPoP proof carries no jwk");

  let payload: any;
  try {
    const key = await importJWK(header.jwk, header.alg);
    ({ payload } = await jwtVerify(proof, key, { typ: "dpop+jwt" }));
  } catch {
    throw new DpopError("DPoP proof signature invalid");
  }

  // 2. The proof's key must be the one the token was bound to. This is what
  //    stops an attacker minting their own valid proof for a stolen token.
  const proofJkt = await calculateJwkThumbprint(header.jwk as any, "sha256");
  if (proofJkt !== jkt) throw new DpopError("DPoP key does not match token cnf.jkt");

  // 3. Bind the proof to THIS exact access token (RFC 9449 §7).
  if (payload.ath !== (await sha256b64url(accessToken))) {
    throw new DpopError("DPoP ath does not match the presented token");
  }

  // 4. Method + URL binding: a proof captured for GET /a cannot open POST /b.
  if (payload.htm !== req.method) throw new DpopError("DPoP htm does not match method");
  const { origin } = requestOrigin(req);
  const expectedHtu = `${origin}${req.nextUrl.pathname}`;
  // Compare host + path, scheme-tolerant, to survive proxy scheme quirks.
  try {
    const got = new URL(String(payload.htu));
    const want = new URL(expectedHtu);
    if (got.host !== want.host || got.pathname !== want.pathname) {
      throw new DpopError(`DPoP htu ${got.host}${got.pathname} != ${want.host}${want.pathname}`);
    }
  } catch (e) {
    if (e instanceof DpopError) throw e;
    throw new DpopError("DPoP htu is not a valid URL");
  }

  // 5. Freshness + single use.
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.iat !== "number" || Math.abs(now - payload.iat) > IAT_SKEW_S) {
    throw new DpopError("DPoP proof is stale");
  }
  const jti = String(payload.jti ?? "");
  if (!jti) throw new DpopError("DPoP proof has no jti");
  const nowMs = Date.now();
  pruneSeen(nowMs);
  if ((SEEN.get(jti) ?? 0) > nowMs) throw new DpopError("DPoP proof replayed (jti seen)");
  SEEN.set(jti, nowMs + JTI_TTL_MS);
}
