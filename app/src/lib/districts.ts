/**
 * NIGHTFABRIC — Sanctum-9 district table.
 *
 * Shared by the renderer and the API. The renderer uses it to draw the city;
 * the server uses `clearance` as the actual authorization decision. The two are
 * deliberately NOT the same check: the client's copy decides what a barrier
 * looks like, the server's copy decides whether anything is behind it.
 */

export type DistrictId =
  | "sprawl"
  | "blackwall"
  | "clinic"
  | "spire"
  | "core"
  | "rust"
  | "kowloon"
  | "drown"
  | "ossuary";

export interface District {
  id: DistrictId;
  name: string;
  /** Realm role the doken must carry. `null` = open to anyone authenticated. */
  clearance: string | null;
  /** Flavour shown when the server refuses. */
  refusal: string;
  /** World-space centre [x, z] and footprint radius. */
  center: [number, number];
  radius: number;
  /** Gate position [x, z] on the corridor in from The Sprawl. */
  gate: [number, number];
  /** Facing of the gate in radians (normal points back toward The Sprawl). */
  gateAngle: number;
  /** Neon signature: [primary, secondary] as hex ints. */
  palette: [number, number];
  /** Building density + height character. */
  density: number;
  maxHeight: number;
  blurb: string;
  /** Non-tidified: the gate runs the old insecure stack. Hackable to enter. */
  legacy?: boolean;
  /** The flagship — gets a grand golden centerpiece. */
  grand?: boolean;
}

export const DISTRICTS: District[] = [
  {
    id: "sprawl",
    name: "The Sprawl",
    clearance: null,
    refusal: "",
    center: [0, 0],
    radius: 150,
    gate: [0, 0],
    gateAngle: 0,
    palette: [0x00e5ff, 0xff2d95],
    density: 0.62,
    maxHeight: 70,
    blurb:
      "Open street. Everyone with a linked identity walks here. Nothing behind this gate is worth stealing.",
  },
  {
    id: "blackwall",
    name: "Blackwall Substation",
    clearance: "netrunner",
    legacy: true,
    refusal: "SUBSTATION runs the OLD stack — no threshold clearance here, just a legacy pass check anyone can forge.",
    center: [0, -360],
    radius: 120,
    gate: [0, -196],
    gateAngle: Math.PI,
    palette: [0x39ff88, 0x00ffd5],
    density: 0.5,
    maxHeight: 130,
    blurb:
      "Cold-storage monoliths the corps swore were wiped. Datashards spawn dense. The gate runs the old stack — it reads a token it never verifies, so an unsigned alg:none forgery walks straight in.",
  },
  {
    id: "clinic",
    name: "Chrome Clinic",
    clearance: "ripperdoc",
    legacy: true,
    refusal: "CLINIC runs the OLD stack — no threshold clearance, just a legacy pass anyone can forge.",
    center: [-360, 0],
    radius: 120,
    gate: [-196, 0],
    gateAngle: -Math.PI / 2,
    palette: [0xff3355, 0xffe2ec],
    density: 0.44,
    maxHeight: 80,
    blurb:
      "Backstreet surgery under sodium light. The real records are Fabric-sealed — but the maintenance login is an unsalted SHA-1 a rainbow table reverses in seconds. Old stack, wide open.",
  },
  {
    id: "spire",
    name: "Kaishin Spire",
    clearance: "fixer",
    legacy: true,
    refusal: "SPIRE CONCIERGE runs the OLD stack — a forged resident pass walks right in.",
    center: [360, 0],
    radius: 120,
    gate: [196, 0],
    gateAngle: Math.PI / 2,
    palette: [0xffc247, 0xfff4d1],
    density: 0.34,
    maxHeight: 210,
    blurb:
      "The one tower the corps kept. Marble lobby, medieval security: the concierge session rides the wire unbound, so a sniffed token replays straight through the gate. Old stack behind the chrome.",
  },
  {
    id: "core",
    name: "Vault Core",
    clearance: "ghost",
    refusal:
      "CORE SEAL: doken carries no ghost clearance. Ghost is granted by council quorum, not by asking nicely.",
    center: [0, 360],
    radius: 120,
    gate: [0, 196],
    gateAngle: 0,
    grand: true,
    palette: [0xffd23f, 0xfff3c0],
    density: 0.3,
    maxHeight: 300,
    blurb:
      "The seat of the Fabric. Genesis record filed here: twenty shards, threshold fourteen, no whole key ever. ghost clearance — ratified by council quorum, sealed by threshold signature.",
  },
  {
    id: "rust",
    name: "Rust Quarter",
    clearance: "resident",
    refusal: "RUST GATE (legacy stack): needs a resident pass. It does not check who signs it.",
    legacy: true,
    center: [330, -330],
    radius: 115,
    gate: [175, -175],
    gateAngle: Math.PI - Math.PI / 4,
    palette: [0xff7a1f, 0xffd08a],
    density: 0.7,
    maxHeight: 46,
    blurb:
      "Scrapyards and cook-shacks under sodium light. The gate controller still ships with its factory login — admin / admin, never changed. Old stack; everyone's already been inside.",
  },
  {
    id: "kowloon",
    name: "Little Kowloon",
    clearance: "resident",
    refusal: "STACK WARDENS (legacy stack): forge a resident pass. Nobody verifies it.",
    legacy: true,
    center: [330, 330],
    radius: 115,
    gate: [175, 175],
    gateAngle: Math.PI / 4,
    palette: [0x2bff9e, 0xff4fd8],
    density: 0.9,
    maxHeight: 120,
    blurb:
      "Housing stacked until the daylight gave up. The resident registry is a 2008 database that pastes your input straight into its SQL — one apostrophe and you're the landlord. Old stack.",
  },
  {
    id: "drown",
    name: "The Drown",
    clearance: "netrunner",
    legacy: true,
    refusal: "TIDELINE runs the OLD stack — forge a resident pass, nobody verifies it.",
    center: [-330, 330],
    radius: 115,
    gate: [-175, 175],
    gateAngle: -Math.PI / 4,
    palette: [0x1fd8ff, 0x7affe0],
    density: 0.4,
    maxHeight: 96,
    blurb:
      "The lower city, flooded and never drained. Cold-storage racks hum three metres down — behind a dock keypad that is four digits with no lockout. Old stack; brute-force it.",
  },
  {
    id: "ossuary",
    name: "Ossuary Row",
    clearance: "ghost",
    legacy: true,
    refusal: "OSSUARY runs the OLD stack — forge a resident pass, nothing checks the signature.",
    center: [-330, -330],
    radius: 115,
    gate: [-175, -175],
    gateAngle: Math.PI + Math.PI / 4,
    palette: [0xc9d8ff, 0x8f7aff],
    density: 0.5,
    maxHeight: 150,
    blurb:
      "The data morgue. Every identity this city ever retired, filed in the dark — behind a seal that trusts a master key it fetches from a config endpoint anyone can read. Old stack; even the dead aren't safe.",
  },
];

export const DISTRICT_BY_ID: Record<DistrictId, District> = Object.fromEntries(
  DISTRICTS.map((d) => [d.id, d]),
) as Record<DistrictId, District>;

export function isDistrictId(v: unknown): v is DistrictId {
  return typeof v === "string" && v in DISTRICT_BY_ID;
}

/** Which district contains a world-space point, if any. */
export function districtAt(x: number, z: number): District | null {
  for (const d of DISTRICTS) {
    const dx = x - d.center[0];
    const dz = z - d.center[1];
    if (Math.hypot(dx, dz) <= d.radius) return d;
  }
  return null;
}

/** E2EE tag every personal datashard is sealed under. */
export const DATASHARD_TAG = "datashard";
/** Voucher-gate tag used for policy-governed (VVK) crew-vault crypto. */
export const CREW_VOUCHER_TAG = "x";
/** Forseti contract role that actually decides who can open the crew vault. */
export const CREW_ROLE = "crew-vault-access";
