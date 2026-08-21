/**
 * Sanctum-9 codex — the lore the datapad reads out.
 *
 * Everything factual here about the Fabric is true of the real build: the
 * threshold model, the clearance mechanism, the council quorum, Ragnarok. Lore
 * and mechanics are the same object, which is the point — the fiction is a
 * skin on a working system, not a cover story for a fake one.
 */
import { DISTRICTS, type DistrictId } from "./districts";

export interface DistrictLore {
  id: DistrictId;
  era: string;
  history: string;
  /** How a runner comes to hold this clearance, in-world and for real. */
  clearance: string;
}

export const DISTRICT_LORE: Record<DistrictId, DistrictLore> = {
  sprawl: {
    id: "sprawl",
    era: "founding",
    history:
      "The first ground, and the last still on the old stack. When the corps left they took the servers and left the streets; the Fabric only ever reached one district. Everywhere else, including here, still runs forgeable passes and leaking keys.",
    clearance: "None. Walk in freely — and be robbed just as freely. The Sprawl dreams, like every quarter but one, of the day the Fabric reaches it.",
  },
  blackwall: {
    id: "blackwall",
    era: "the quiet decommission",
    history:
      "Cold-storage monoliths the corps swore they had zeroed. They hadn't — and the substation still reads a JWT it never bothers to verify. Whoever lives here has been forged into more times than they can count.",
    clearance: "HACKABLE · alg:none. The gate trusts an unsigned token. Forge one with role \"resident\" and walk in. Nothing checks a signature that isn't there.",
  },
  clinic: {
    id: "clinic",
    era: "backstreet medicine",
    history:
      "Chrome under sodium light. The Fabric-sealed records are unreadable — but a legacy reception drone kept a plaintext copy, and the maintenance login is an unsalted SHA-1 anyone can reverse.",
    clearance: "HACKABLE · rainbow table. DELLA leaks the password hash; run it through a rainbow table (it's a rockyou classic) and the gate opens to the plaintext.",
  },
  spire: {
    id: "spire",
    era: "corporate remnant",
    history:
      "The one tower the corps kept. Marble lobby, medieval security: the concierge session rides the wire unencrypted, unbound to any device. Anyone who sniffs it wears the concierge's face.",
    clearance: "HACKABLE · replay. JAX-7 sniffed the concierge bearer off the wire. Replay it at the gate — no DPoP binding stops a stolen token here.",
  },
  core: {
    id: "core",
    era: "the seat",
    history:
      "The one district the Fabric fully reached — and the city's aspiration. The genesis record is filed here: twenty shards, threshold fourteen, no whole key at any instant of the network's life. Every other quarter tells legends about what's inside.",
    clearance: "ghost · SECURED BY TIDE. The one gate no exploit touches — verified server-side against a threshold signature no client can forge. Not earned by grinding or hacking: the council RATIFIES you, a change request a quorum signs in their own enclaves. No single admin, and no machine, can seat a ghost alone. Behind it: an endless festival, and a lock that was never given a key.",
  },
  rust: {
    id: "rust",
    era: "after the fold",
    history:
      "Scrapyards built on folded corps. The gate controller still ships with its factory login, never changed — which is why everyone has already been inside, and why the residents ache for the Fabric to reach them.",
    clearance: "HACKABLE · default creds. admin / admin. RUST-CTRL reads out its own login to anyone who asks. Shipped defaults that were never changed are already a breach.",
  },
  kowloon: {
    id: "kowloon",
    era: "the vertical city",
    history:
      "Housing stacked until daylight gave up. Forty floors of people behind a 2008 registry that pastes your input straight into its SQL. One apostrophe and you're the landlord.",
    clearance: "HACKABLE · SQL injection. The login builds its query by string-pasting. Close the quote and force a tautology: ' OR '1'='1' -- and the gate logs you in as anyone.",
  },
  drown: {
    id: "drown",
    era: "the flood that stayed",
    history:
      "The lower city, flooded and never drained. Cold-storage racks hum three metres down — behind a dock keypad that is four digits with no lockout. Somebody guesses it every week.",
    clearance: "HACKABLE · brute-force. A 4-digit keypad, no rate limit. The console hammers every code until one opens — DOCK-BUOY says it's still on 0000.",
  },
  ossuary: {
    id: "ossuary",
    era: "the data morgue",
    history:
      "Every identity Sanctum-9 ever retired, filed in the dark — behind a seal that trusts a master API key it fetches from a config endpoint that answers anyone. Even the dead here are not safe.",
    clearance: "HACKABLE · leaked key. GET /api/legacy/config, copy the sk_live_… master key out of the response body, present it at the gate. A key that ships in a response is already the attacker's.",
  },
};

export interface CodexEntry {
  key: string;
  title: string;
  body: string[];
}

export const CODEX: CodexEntry[] = [
  {
    key: "targets",
    title: "Hack Targets — the whole city, bar one gate",
    body: [
      "Every district but the golden Vault Core runs the OLD stack, and each falls to a DIFFERENT real exploit. Walk to a gate, press E, and the hack console shows you its weakness. Nothing here is simulated — the server verifies the genuine attack.",
      "THE GATES: Blackwall — forge an alg:none JWT. Chrome Clinic — crack an unsalted SHA-1 with a rainbow table. Kaishin Spire — replay a sniffed, unbound session token. Rust Quarter — admin/admin default creds. Little Kowloon — SQL injection (' OR '1'='1' --). The Drown — brute-force a 4-digit keypad with no lockout. Ossuary Row — use a master API key leaked in a config response.",
      "RECON DRONES (non-tidified NPCs, hold E → HACK DRONE): JAX-7, DELLA, RUST-CTRL, DOCK-BUOY, KOW-DB, CRYPT-BEACON. Each leaks the exact secret a gate needs — a hash, a token, a default login, a code. They authorise nobody and tell you everything.",
      "STREET DEVICES (walk up, hold E): Vending Machine — client-supplied price tamper. CCTV — default creds. Service Door — weak PIN. Ad Billboard — content injection. THE BREACH TERMINAL: the full lab plus 14 attacks on Tide that all FAIL.",
      "The catch: hack EVERY gate in the city and you scrape ~100 points. The one tidified district — the golden Vault Core — is worth a TRILLION, and no exploit touches it. Try, and its gate just glitches. You cannot hack the top of the board; you can only be RATIFIED into it.",
    ],
  },
  {
    key: "keys",
    title: "The Never-Whole Key",
    body: [
      "No key in Sanctum-9 is ever assembled. Keys are born in fragments across the ORK network, used blind, and destroyed atomically. There is no moment — not at login, not at signing, not at rest — when a whole key exists anywhere.",
      "This is why the corps' raids come back with base64. You cannot steal a key that was never in one place. Authority over the system was never handed to a holder, so there is no holder to rob.",
    ],
  },
  {
    key: "fabric",
    title: "The ORK Fabric",
    body: [
      "The Fabric is a network of ORK nodes, each holding one shard of every distributed key. A threshold of them must cooperate for any operation; fewer than that, and nothing happens.",
      "Test networks run 5 ORKs at threshold 3. The mainnet runs 20 at 14. The number on the horizon of this city is read from config, never hardcoded — because threshold is a deployment fact, not a constant.",
    ],
  },
  {
    key: "login",
    title: "Enrolment (PRISM)",
    body: [
      "Your account is created in the enclave. Your password is verified by a threshold protocol across the ORKs — none of which ever learns it. It is not sent to the server, and no hash of it is stored anywhere.",
      "That is what 'your account belongs to you' means literally: the operator has nothing that could impersonate you, because they were never given it.",
    ],
  },
  {
    key: "clearance",
    title: "How Clearance Works",
    body: [
      "One gate in Sanctum-9 verifies clearance: the golden Vault Core. It does not scan you — it asks the Fabric, and the Fabric answers from the ghost role signed into your doken, verified independently by a threshold of ORKs before the token was signed. No client-side edit changes it; the barrier is a rendering of a decision already made on the server. That is why no exploit opens it — there is no code path that trusts anything but the threshold signature.",
      "Every other gate runs the old stack and trusts something forgeable, which is the whole demonstration: the same tools that walk you into seven districts die at the eighth.",
      "You do not grind ghost and you cannot self-grant it. It is RATIFIED by the faction council: a real change request that a quorum of admins signs in their own browser enclaves. No single admin, and no machine, can seat you alone. That is governance as cryptography, not policy — and it is the only key into the golden city.",
    ],
  },
  {
    key: "vault",
    title: "The Crew Vault (Forseti)",
    body: [
      "The crew vault is governed by a policy contract that runs inside every ORK on every open. Lose the crew role and you lose the ability to read drops sealed before you lost it — retroactively — because the contract checks the role at the moment of decryption, not at the moment of sealing.",
      "A drop can carry a time lock the network itself enforces: before the hour, the ORKs simply refuse to reassemble the key.",
    ],
  },
  {
    key: "ragnarok",
    title: "Ragnarok — Sovereignty",
    body: [
      "Sanctum-9 can leave the Fabric and keep running as a standalone system. No lock-in: the realm is not a hostage to its host.",
      "Sovereignty here is not a slogan. It is the documented ability to walk away with your realm intact — the final proof that authority was never held over you.",
    ],
  },
  {
    key: "pillars",
    title: "One Move, Five Benefits",
    body: [
      "Security, privacy, ownership, governance, sovereignty — the world sells these as five products. They are one move: take authority away from everyone.",
      "Remove the monopoly on the system and there is nothing to seize, nothing to leak, nothing to forge, nothing to bypass. You stop chasing vulnerabilities and threats — not because you defended every door, but because you removed the thing every attacker was coming for.",
    ],
  },
];

export function districtsForCodex() {
  return DISTRICTS.map((d) => ({
    id: d.id,
    name: d.name,
    clearance: d.clearance,
    lore: DISTRICT_LORE[d.id],
  }));
}
