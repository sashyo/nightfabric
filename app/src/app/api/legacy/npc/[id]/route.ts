import { mintFlag } from "@/lib/legacy";
import { CLINIC_PW_HASH, SPIRE_SESSION_TOKEN } from "@/lib/hacks";

/**
 * A non-tidified NPC's data socket. These drones run the old stack: no doken, no
 * threshold anything. Poke the socket and it hands over everything it holds —
 * because nothing here decides that you shouldn't have it. Half of what they
 * leak is the recon you need to defeat a district gate.
 *
 * Contrast every Tide-secured surface in this game, which reads identity from a
 * verified doken and hands out nothing it hasn't checked.
 */
const DRONES: Record<string, { name: string; secrets: string[] }> = {
  jax: {
    name: "JAX-7 (corp courier drone)",
    secrets: [
      "manifest: 3 crates deck hardware → Kaishin Spire loading bay, 04:00",
      "SNIFFED — concierge session bearer (unencrypted, no DPoP binding):",
      `    ${SPIRE_SESSION_TOKEN}`,
      "→ replay it at the Kaishin Spire gate. Nothing binds it to a device.",
    ],
  },
  della: {
    name: "DELLA (clinic reception unit)",
    secrets: [
      "patient queue cache — 12 names, unredacted (the clinic itself cannot read the sealed records; this drone kept a plaintext copy it should not have)",
      "maintenance password — stored as unsalted SHA-1 (never the plaintext):",
      `    ${CLINIC_PW_HASH}`,
      "→ run it through a rainbow table. It's a rockyou-tier word; the Chrome Clinic gate wants the plaintext.",
    ],
  },
  rusty: {
    name: "RUST-CTRL (gate controller, Rust Quarter)",
    secrets: [
      "firmware v0.9 — factory build, never reflashed",
      "shipped default login, printed on the housing: admin / admin",
      "→ the Rust Quarter gate never changed it.",
    ],
  },
  buoy: {
    name: "DOCK-BUOY (Tideline mooring beacon)",
    secrets: [
      "dockmaster note taped to the keypad: 'never got round to changing it'",
      "keypad still on its factory code: 0000",
      "→ 4-digit keypad at The Drown, no lockout. Brute-force it — 0000 opens on the first try.",
    ],
  },
  kowdb: {
    name: "KOW-DB (Little Kowloon resident registry)",
    secrets: [
      "engine: MySQL 5.1 (2008), queries built by string concatenation",
      "login query: SELECT * FROM residents WHERE name='<input>' AND pin='<input>'",
      "→ classic injection: ' OR '1'='1' --",
    ],
  },
  crypt: {
    name: "CRYPT-BEACON (Ossuary Row seal relay)",
    secrets: [
      "the seal authorizes on a master API key it fetches from /api/legacy/config",
      "that config endpoint returns the key in its body, to anyone, unauthenticated",
      "→ GET /api/legacy/config, copy the sk_live_… key, present it at the gate.",
    ],
  },
};

export const GET = async (req: Request) => {
  const id = decodeURIComponent(new URL(req.url).pathname.split("/").pop() || "");
  const drone = DRONES[id];
  if (!drone) return Response.json({ error: "no such drone" }, { status: 404 });
  return Response.json({
    name: drone.name,
    // Dumped with no authorization whatsoever — that is the whole point.
    secrets: drone.secrets,
    flag: mintFlag("FLAG-LEAKED-KEY"),
    note: "This drone runs the old stack. It authorized nobody and told you everything.",
  });
};
