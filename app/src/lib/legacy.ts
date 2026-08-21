/**
 * OLD TOWN — the part of Sanctum-9 the Fabric never secured.
 *
 * Everything in this file is DELIBERATELY, TEXTBOOK INSECURE. It exists so the
 * game can show the contrast: in a normal app someone holds the keys, tokens
 * are forgeable, secrets leak, and one request is enough. Every flaw here is one
 * a real attacker exploits every day — and every one is SOLVABLE, on purpose.
 *
 * None of this touches Tide. The Tide-protected routes (withAuth + verifyTideJWT
 * + verifyDpop) are a different world; that is the whole point.
 *
 * The flags you capture here are cheap. The lesson is that they are cheap for
 * EVERYONE — including whoever is attacking you.
 */

import { createHmac } from "crypto";

/** A secret that should never be in a response body. It is, on purpose. */
export const LEAKED_API_KEY = "sk_live_0LDT0WN_4dm1n_M4STER_KEY_do_not_ship";

/** Flags and what they teach. Points are low: this stuff is trivial to take. */
export const LEGACY_FLAGS = {
  "FLAG-ALGNONE": {
    points: 25,
    title: "Forged an unsigned JWT",
    lesson: "The token had `alg: none` and no signature. You edited `role` to `root` at runtime and the server believed it.",
  },
  "FLAG-LEAKED-KEY": {
    points: 25,
    title: "Found a secret in the open",
    lesson: "The API key was sitting in a config response. Secrets in client-reachable responses are already leaked.",
  },
  "FLAG-NO-QUORUM": {
    points: 25,
    title: "Wiped the mainframe alone",
    lesson: "One request, one key, no second signer. Authority with no quorum is authority anyone who steals it holds.",
  },
  "FLAG-REPLAY": {
    points: 25,
    title: "Replayed a stolen token",
    lesson: "The token had no DPoP binding, so it worked from a client that never logged in. A stolen bearer is a stolen session.",
  },
  "FLAG-PRICE-TAMPER": {
    points: 20,
    title: "Tampered a client-supplied price",
    lesson: "The vending machine trusted a price the client sent. Never let the client decide what something costs.",
  },
  "FLAG-DEFAULT-CREDS": {
    points: 20,
    title: "Walked in on default credentials",
    lesson: "admin / admin. Shipped defaults that were never changed are already a breach.",
  },
  "FLAG-WEAK-PIN": {
    points: 20,
    title: "Guessed a weak PIN",
    lesson: "0000. A four-digit space with no lockout is brute-forced in seconds.",
  },
  "FLAG-CONTENT-INJECT": {
    points: 20,
    title: "Injected content with no sanitization",
    lesson: "The billboard rendered whatever you sent. Unsanitized output is how defacement and XSS start.",
  },
  "FLAG-RAINBOW": {
    points: 25,
    title: "Cracked a password from its hash",
    lesson: "The maintenance password was stored as an unsalted SHA-1. A rainbow table reverses common words instantly — hashing is not encryption.",
  },
  "FLAG-SQLI": {
    points: 25,
    title: "Bypassed a login with SQL injection",
    lesson: "The gate built its query by pasting your input into a string. `' OR '1'='1' --` turned the WHERE clause into a tautology and logged you in as anyone.",
  },
  "FLAG-MITM": {
    points: 25,
    title: "Replayed a token sniffed off the wire",
    lesson: "The concierge's session token crossed an unencrypted channel with no DPoP binding. A sniffed bearer is a stolen session — Tide binds every token to the device that requested it.",
  },
  "FLAG-TWOTIME": {
    points: 60,
    title: "Broke a two-time pad",
    lesson: "Two messages were XOR-encrypted with the SAME keystream. XOR the ciphertexts together and the key cancels out, leaking the difference of the plaintexts — and with one known crib, the other message falls out. Never reuse a keystream.",
  },
  "FLAG-JWT-SECRET": {
    points: 70,
    title: "Cracked a JWT signing secret and forged admin",
    lesson: "The API signed its tokens with HMAC-SHA256 and a guessable secret. Crack the secret offline, re-sign a token with role=admin, and the server trusts it completely. A symmetric signing secret is a password — and this one was in a wordlist.",
  },
} as const;

export type LegacyFlag = keyof typeof LEGACY_FLAGS;

/**
 * A base64url "JWT" with `alg: none` and NO signature — the classic broken
 * pattern. The server that reads it does not verify anything, so a client can
 * rewrite the payload freely. This is what Tide's threshold-signed doken exists
 * to make impossible.
 */
export function issueUnsignedJWT(sub: string): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString("base64url");
  const header = b64({ alg: "none", typ: "JWT" });
  const payload = b64({ sub, role: "guest", iss: "oldtown", iat: Math.floor(Date.now() / 1000) });
  // No signature segment on purpose. (A real one would be header.payload.sig.)
  return `${header}.${payload}.`;
}

/** Read a legacy JWT WITHOUT verifying it — trusts whatever the client sends. */
export function readUnsignedJWT(token: string): any {
  try {
    const [, payload] = token.split(".");
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"));
  } catch {
    return null;
  }
}

/** A "flag token" the player carries back to the Tide-secured scoreboard. It IS
 *  signed (HMAC over a server secret) so the SCORE can't be faked — the meta
 *  point: the scoreboard is protected by real crypto even though the challenge
 *  is not. */
const FLAG_SECRET = process.env.FLAG_SECRET || "nightfabric-oldtown-flag-secret";
export function mintFlag(flag: LegacyFlag): string {
  const sig = createHmac("sha256", FLAG_SECRET).update(flag).digest("base64url");
  return `${flag}.${sig}`;
}
export function verifyFlag(token: string): LegacyFlag | null {
  const [flag, sig] = (token || "").split(".");
  if (!flag || !sig) return null;
  const expect = createHmac("sha256", FLAG_SECRET).update(flag).digest("base64url");
  if (sig !== expect) return null;
  return (flag in LEGACY_FLAGS ? (flag as LegacyFlag) : null);
}

/** Vault (procedural) challenges each carry their own point value in the signed
 *  flag, so we don't need a fixed entry per challenge. Token: KEY.POINTS.SIG. */
export function mintVaultFlag(key: string, points: number): string {
  const body = `${key}.${points}`;
  const sig = createHmac("sha256", FLAG_SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}

/** Verify ANY flag (fixed Old Town flag OR a procedural vault flag) and return
 *  its scoring key, points and lesson. Used by the claim route. */
export function verifyAnyFlag(token: string): { key: string; points: number; lesson: string } | null {
  const t = token || "";
  // fixed Old Town flag: FLAG-xxx.sig
  const fixed = verifyFlag(t);
  if (fixed) return { key: fixed, points: LEGACY_FLAGS[fixed].points, lesson: LEGACY_FLAGS[fixed].lesson };
  // vault flag: VAULT-<n>.<points>.<sig>
  const parts = t.split(".");
  if (parts.length === 3 && parts[0].startsWith("VAULT-")) {
    const [key, pts, sig] = parts;
    const expect = createHmac("sha256", FLAG_SECRET).update(`${key}.${pts}`).digest("base64url");
    const points = Number(pts);
    if (sig === expect && Number.isFinite(points) && points > 0 && points <= 500) {
      return { key, points, lesson: "You broke a real cipher by hand — recovered the plaintext with the attack, not a guess." };
    }
  }
  return null;
}
