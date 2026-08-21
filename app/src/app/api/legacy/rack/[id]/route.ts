import { mintVaultFlag } from "@/lib/legacy";

/**
 * Hackable server racks INSIDE the district interiors. These run the old stack:
 * poke the rack and it dumps whatever it's holding, because nothing here decides
 * you shouldn't have it. Each rack mints a UNIQUE signed flag (VAULT-RACK-<id>)
 * worth points, so looting the interiors is its own scoreboard grind.
 *
 * Contrast the golden Vault Core, where a rack would hand you sealed shards you
 * could never read.
 */
const LOOT: Record<string, string[]> = {
  blackwall: ["cold-storage index the corps swore they zeroed", "a substation master schedule, 04:00 sweeps", "3,100 fragments with no keys attached"],
  clinic: ["a plaintext patient queue this drone should never have kept", "the maintenance login, cached", "billing records for procedures the clinic can't itself read"],
  spire: ["board minutes with the names redacted by policy, not ink", "the concierge's session log", "a cargo manifest for the golden gate loading bay"],
  rust: ["salvage tags from four folded corps", "the gate controller's factory firmware", "an admin's forgotten backup, unencrypted"],
  kowloon: ["forty floors of resident records, no landlord", "the 2008 registry's raw query log", "a stack of unpaid utility tokens"],
  drown: ["dive logs from the flooded server farm", "rack humidity telemetry (they still run)", "a corp's drowned, unreadable-to-them archive"],
  ossuary: ["retirement certificates for identities the city let go", "the seal relay's fetch history", "a list of who tried to open the dead, and failed"],
};

export const GET = async (req: Request) => {
  const id = decodeURIComponent(new URL(req.url).pathname.split("/").pop() || "");
  const dist = id.split("-")[0];
  const loot = LOOT[dist] ?? ["an unlabeled data crate", "a corp's forgotten backup", "cache of expired tokens"];
  return Response.json({
    name: `${(dist || "unknown").toUpperCase()} SERVER RACK ${id.split("-")[1] || ""}`.trim(),
    loot,
    flag: mintVaultFlag(`VAULT-RACK-${id}`, 45),
    points: 45,
    note: "old stack. it authorised nobody and handed you everything.",
  });
};
