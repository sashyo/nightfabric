/**
 * REAL exploits, one per legacy district.
 *
 * Nothing here is a "press X to hack" animation. Every gate is defeated by an
 * actual, classic attack that the server verifies for real: an alg:none JWT
 * forgery, a rainbow-table hash crack, a sniffed-token replay, default creds,
 * SQL injection, an unthrottled PIN brute-force, a leaked API key. The player
 * has to actually perform the technique; the recon they need is leaked by
 * hackable drones scattered through the city.
 *
 * The point of the whole exercise is the ONE gate that none of this touches —
 * the golden Vault Core — because it is verified by a threshold of ORKs against
 * a signature no client can produce.
 *
 * SECRETS in this file are insecure ON PURPOSE. In a real app they would never
 * be reachable; here they are, so the attack can be learned by doing it.
 */
import { createHmac, createHash } from "crypto";
import type { DistrictId } from "./districts";
import { LEAKED_API_KEY, type LegacyFlag } from "./legacy";

export type HackKind =
  | "alg-none"     // forge an unsigned JWT
  | "rainbow"      // crack an unsalted hash
  | "mitm-replay"  // replay a sniffed bearer token
  | "default-creds"// admin / admin
  | "sqli"         // ' OR '1'='1' --
  | "weak-pin"     // brute-force a 4-digit PIN, no lockout
  | "leaked-key";  // use a key that leaked in the open

const sha1 = (s: string) => createHash("sha1").update(s).digest("hex");

/** The concierge's real session token — "sniffed" off an unencrypted channel by
 *  the JAX-7 courier drone and replayable because nothing binds it to a device. */
export const SPIRE_SESSION_TOKEN =
  "sess." + createHmac("sha256", "kaishin-concierge").update("supervisor").digest("base64url");

/** The maintenance password behind Chrome Clinic — stored only as an unsalted
 *  SHA-1, the way a legacy system would. It is a rockyou-tier word on purpose,
 *  so a real rainbow table reverses it. */
const CLINIC_PASSWORD = "trustno1";
export const CLINIC_PW_HASH = sha1(CLINIC_PASSWORD); // what leaks; the plaintext is the crack

/** The Drown's dock keypad. Four digits, no lockout — the classic weak default. */
const DROWN_PIN = "0000";

interface HackChallenge {
  kind: HackKind;
  flag: LegacyFlag;
  /** Headline shown on the gate's hack console. */
  title: string;
  /** One line naming the weakness — the "what". */
  weakness: string;
  /** Where the recon comes from — the "where to look". */
  recon: string;
  /** Field the player submits (for the console UI). */
  field: { name: string; label: string; placeholder: string };
}

/** Client-safe challenge specs (no verification secrets). The gate returns the
 *  matching one on a 403 so the console knows what to render. */
export const HACK_CHALLENGES: Partial<Record<DistrictId, HackChallenge>> = {
  blackwall: {
    kind: "alg-none", flag: "FLAG-ALGNONE",
    title: "SUBSTATION ICE · unsigned-token bypass",
    weakness: "The gate reads a JWT but never checks the signature. A token with alg:none is trusted as-is.",
    recon: "No recon needed — forge it. Set the header to {\"alg\":\"none\"} and the payload role to \"resident\".",
    field: { name: "token", label: "forged JWT (header.payload.)", placeholder: "eyJhbGciOiJub25lIn0.eyJyb2xlIjoi…." },
  },
  clinic: {
    kind: "rainbow", flag: "FLAG-RAINBOW",
    title: "CLINIC LOCK · SHA-1 maintenance password",
    weakness: `The maintenance password is stored as an unsalted SHA-1 hash: ${CLINIC_PW_HASH}`,
    recon: "DELLA (clinic drone) leaks the hash. Run it through a rainbow table — it's a rockyou classic.",
    field: { name: "password", label: "cracked plaintext", placeholder: "the word behind the hash" },
  },
  spire: {
    kind: "mitm-replay", flag: "FLAG-MITM",
    title: "SPIRE CONCIERGE · session replay",
    weakness: "The concierge bearer token crosses the wire unencrypted and carries no DPoP binding. Replay it.",
    recon: "JAX-7 (courier drone) sniffed the concierge session. Grab the token it leaks and replay it here.",
    field: { name: "token", label: "sniffed bearer token", placeholder: "sess.…" },
  },
  rust: {
    kind: "default-creds", flag: "FLAG-DEFAULT-CREDS",
    title: "RUST GATE · shipped default login",
    weakness: "The gate controller still has its factory login. It was never changed.",
    recon: "The default is printed on the unit and on every forum: admin / admin.",
    field: { name: "creds", label: "username:password", placeholder: "admin:admin" },
  },
  kowloon: {
    kind: "sqli", flag: "FLAG-SQLI",
    title: "KOWLOON GATE · SQL injection",
    weakness: "The login builds its query by string-pasting your input: WHERE name='<you>' AND pin='<you>'.",
    recon: "Close the quote and make the WHERE always true. Classic: ' OR '1'='1' --",
    field: { name: "username", label: "username field", placeholder: "' OR '1'='1' --" },
  },
  drown: {
    kind: "weak-pin", flag: "FLAG-WEAK-PIN",
    title: "TIDELINE DOCK · 4-digit keypad",
    weakness: "A four-digit keypad with no lockout — 10,000 combinations, unlimited tries.",
    recon: "Brute-force it. The console can hammer every code until one opens (no rate limit stops it).",
    field: { name: "pin", label: "4-digit PIN", placeholder: "0000" },
  },
  ossuary: {
    kind: "leaked-key", flag: "FLAG-LEAKED-KEY",
    title: "OSSUARY SEAL · leaked master key",
    weakness: "The seal trusts a master API key — and that key is sitting in a config response.",
    recon: "GET /api/legacy/config. The key is right there in the body. Send it as the pass.",
    field: { name: "apiKey", label: "master API key", placeholder: "sk_live_…" },
  },
};

/** Read a base64url alg:none JWT without verifying anything. */
function readAlgNone(token: string): { alg?: string; role?: string } | null {
  try {
    const [h, p] = token.split(".");
    const header = JSON.parse(Buffer.from(h, "base64url").toString("utf-8"));
    const payload = JSON.parse(Buffer.from(p, "base64url").toString("utf-8"));
    return { alg: header.alg, role: payload.role };
  } catch {
    return null;
  }
}

export interface HackResult { ok: boolean; flag?: LegacyFlag; detail: string; }

/**
 * Verify a submitted exploit against a district's REAL weakness. Server-only.
 * Every branch is the genuine check a broken system would (fail to) do.
 */
export function verifyHack(id: DistrictId, sub: Record<string, unknown>): HackResult {
  const c = HACK_CHALLENGES[id];
  if (!c) return { ok: false, detail: "no legacy exploit for this gate" };

  switch (c.kind) {
    case "alg-none": {
      const t = String(sub.token ?? "");
      const j = readAlgNone(t);
      if (!j) return { ok: false, detail: "not a readable JWT" };
      if (j.alg !== "none") return { ok: false, detail: `header alg is "${j.alg}", not "none" — this gate only falls to an unsigned token` };
      if (j.role !== "resident" && j.role !== "root")
        return { ok: false, detail: `payload role is "${j.role}"; forge it to "resident"` };
      return { ok: true, flag: c.flag, detail: "unsigned token accepted — the gate never checked a signature" };
    }
    case "rainbow": {
      const pw = String(sub.password ?? "").trim();
      if (!pw) return { ok: false, detail: "submit the cracked plaintext" };
      if (sha1(pw) !== CLINIC_PW_HASH) return { ok: false, detail: "that word does not hash to the leaked value — keep cracking" };
      return { ok: true, flag: c.flag, detail: "hash reversed — the password was never encrypted, only hashed" };
    }
    case "mitm-replay": {
      const t = String(sub.token ?? "").trim();
      if (t !== SPIRE_SESSION_TOKEN) return { ok: false, detail: "that is not the concierge's live token — sniff the real one from JAX-7" };
      return { ok: true, flag: c.flag, detail: "replayed a valid bearer from a device that never logged in — no binding stopped it" };
    }
    case "default-creds": {
      const raw = String(sub.creds ?? "");
      const [u, p] = raw.split(":");
      if (u === "admin" && p === "admin") return { ok: true, flag: c.flag, detail: "factory login still worked" };
      return { ok: false, detail: "not the default — try the value shipped on every one of these units" };
    }
    case "sqli": {
      const u = String(sub.username ?? "");
      // The naive gate would run: WHERE name='<u>' AND pin='<?>'. Any input that
      // closes the quote and forces a tautology (and comments out the rest)
      // bypasses it. We detect a real injection, not a magic string.
      const tautology = /'\s*or\s*'?\d*'?\s*=\s*'?\d*/i.test(u) || /'\s*or\s+1\s*=\s*1/i.test(u);
      const closesQuote = u.includes("'");
      if (closesQuote && tautology) return { ok: true, flag: c.flag, detail: "the WHERE clause became always-true — logged in as the first row" };
      return { ok: false, detail: "the query still filters you out — close the quote and make the condition always true" };
    }
    case "weak-pin": {
      const pin = String(sub.pin ?? "");
      if (!/^\d{4}$/.test(pin)) return { ok: false, detail: "PIN is four digits" };
      if (pin !== DROWN_PIN) return { ok: false, detail: "wrong code — the keypad shrugs and lets you try again (no lockout)" };
      return { ok: true, flag: c.flag, detail: "correct code — an unthrottled 4-digit space is no lock at all" };
    }
    case "leaked-key": {
      const k = String(sub.apiKey ?? "").trim();
      if (k !== LEAKED_API_KEY) return { ok: false, detail: "wrong key — the real one is in the /api/legacy/config body" };
      return { ok: true, flag: c.flag, detail: "a key that ships in a response is already the attacker's key" };
    }
  }
}
