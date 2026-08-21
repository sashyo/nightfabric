/**
 * Datashard contents — generated SERVER-SIDE, and only handed to a caller whose
 * verified doken carries the district's clearance.
 *
 * This is the half of the demo people forget: the neon barrier in the 3D scene
 * is decoration. If a player patches the renderer and walks straight through a
 * gate, they arrive in an empty district, because the shards were never in the
 * bundle. Authorization that lives in the client is a suggestion.
 */
import type { DistrictId } from "./districts";

const FRAGMENTS: Record<DistrictId, string[]> = {
  sprawl: [
    "Ration chit, Sector 12. Expired. Someone kept it anyway.",
    "Street-cam loop, 40s, of nothing at all. Sold as an alibi.",
    "Half a transit pass and a handwritten name that isn't yours.",
    "Busker's setlist. Three songs are banned in two districts.",
  ],
  blackwall: [
    "Substation cold-storage index, partial. 4,102 rows. No key attached — there never was one to attach.",
    "Decommission order for an ORK that never went offline.",
    "Traffic shadow: someone queried the same vuid 9,000 times in one night.",
    "A key-rotation log with no key in it. Just the fact that it happened.",
    "Firmware diff, unsigned. Somebody tried to ship this quietly.",
  ],
  clinic: [
    "Post-op notes, patient unnamed. The clinic can bill it but cannot read it.",
    "Chrome serial batch, flagged: three units, one owner, three cities.",
    "Consent form with the signature field left cryptographic.",
    "Neural baseline, 12kB, sealed. The ripperdoc has never seen the inside.",
  ],
  spire: [
    "Kaishin board minutes. Two names redacted by policy, not by ink.",
    "Quarterly: 'incident contained, zero data recovered by attacker'. Underlined twice.",
    "Vendor contract with a clause about who holds the keys. The answer is nobody.",
    "Access review. Fourteen admins. Nobody could act alone. Someone complains about this.",
  ],
  core: [
    "Fabric genesis record. Twenty shards, threshold fourteen, no whole key at any point.",
    "The Ragnarok clause, in full. Sanctum-9 can leave, and take its realm with it.",
    "A note: 'we never had the key to lose'.",
  ],
  rust: [
    "Salvage manifest. Nine crates of deck hardware, every secure element already dead on arrival.",
    "Handwritten price list for identities. All the entries are crossed out.",
    "A cook-shack ledger that balances, which in this district is the suspicious part.",
    "Scrapper's note: 'stopped buying stolen tokens, they expire before I can sell them'.",
  ],
  kowloon: [
    "Stack census, floor 40 and up. More residents than the building officially has floors.",
    "Clinic referral chain, six ripperdocs deep, no name repeated.",
    "Landlord's key ledger. Every entry reads 'no key held'.",
    "Complaint filed against the wardens for checking clearances at the stairwell.",
  ],
  drown: [
    "Submerged rack inventory. Still drawing power, still refusing to answer.",
    "Tide chart annotated with outage windows that never came.",
    "Salvage claim on a cold-storage array. Denied: nobody could prove they owned the contents.",
    "Diver's log: 'the racks are fine. nobody can read them either.'",
  ],
  ossuary: [
    "Retirement record for an identity that was never breached, only forgotten.",
    "Archivist's standing order: file it, index it, never open it. They could not open it anyway.",
    "A vuid with no name attached and no way left to attach one.",
  ],
};

/** Deterministic pseudo-random from a string seed — same world every session. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

export interface ShardSpawn {
  id: string;
  /** World-space position, relative to the district centre. */
  offset: [number, number];
  /** Only sent to clients that pass the server-side clearance check. */
  payload: string;
}

/** The shards that exist in a district. Positions are stable across sessions. */
export function spawnsFor(id: DistrictId, radius: number): ShardSpawn[] {
  const frags = FRAGMENTS[id];
  return frags.map((payload, i) => {
    const a = hash(`${id}:${i}:angle`) * Math.PI * 2;
    const r = (0.28 + hash(`${id}:${i}:r`) * 0.6) * radius;
    return {
      id: `${id}-${i}`,
      offset: [Math.cos(a) * r, Math.sin(a) * r] as [number, number],
      payload: `[${id.toUpperCase()}//${String(i).padStart(2, "0")}] ${payload}`,
    };
  });
}

/** Positions only — safe to hand to anyone, reveals nothing. */
export function spawnMarkers(id: DistrictId, radius: number) {
  return spawnsFor(id, radius).map(({ id, offset }) => ({ id, offset }));
}
