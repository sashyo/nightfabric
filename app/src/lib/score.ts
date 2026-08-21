/**
 * The Sanctum-9 scoreboard.
 *
 * The meta-joke of the whole feature: the CHALLENGES in Old Town are insecure,
 * but the SCOREBOARD is not. Every point is written under a verified Tide doken,
 * so you cannot forge your rank the way you forge an Old Town token. The thing
 * worth protecting is protected; the throwaway stuff is not.
 *
 * Point values encode the lesson:
 *   - Old Town flags are CHEAP. Anyone can grab them — that is the problem.
 *   - Tidified districts are worth far more, and you cannot fake the clearance.
 *   - The golden Vault Core is the prize: ghost-only, council-ratified, top value.
 */
import { DISTRICT_BY_ID, type DistrictId } from "./districts";
import { LEGACY_FLAGS, type LegacyFlag } from "./legacy";

export const GOLDEN_DISTRICT: DistrictId = "core";

/** Points for clearing a district (awarded once). */
/**
 * The economy makes the lesson unavoidable: the honest, UNHACKABLE path is worth
 * more than every hack combined. Farming all of Old Town — 4 flags (~100) plus
 * both legacy districts (~30) — tops out around 130. A single tidified clearance is worth a TRILLION,
 * and the golden Vault Core a quadrillion. No amount of hacking competes; you
 * reach the top only with real, council-granted clearance.
 */
export function districtPoints(id: DistrictId): number {
  const d = DISTRICT_BY_ID[id];
  // The ONE tidified district — the golden Vault Core — is worth a TRILLION.
  // Every other district runs the old stack and can be hacked into for crumbs.
  // Farming every hackable gate in the city tops out around a hundred points;
  // the single unhackable, council-ratified clearance is worth a trillion. No
  // amount of hacking competes — you reach the top only with real Tide clearance.
  if (id === GOLDEN_DISTRICT) return 1_000_000_000_000; // the one tidified prize — a TRILLION
  if (d.legacy) return 15;                              // hacked in — cheap, anyone can
  return 10;                                            // open — trivial
}

export function flagPoints(flag: LegacyFlag): number {
  return LEGACY_FLAGS[flag].points;             // cheap on purpose
}
