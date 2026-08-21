import { withAuth } from "@/lib/auth/middleware";
import { mutate } from "@/lib/store";

/**
 * The hack map. Reveals where every hackable target sits — but using it stamps
 * your record, and from then on each flag you claim is worth 10 less. Skill or
 * convenience; pick one.
 */
const TARGETS = [
  { name: "Vending Machine", type: "device", x: -18, z: 130, hack: "tamper the price" },
  { name: "CCTV Camera", type: "device", x: 110, z: 78, hack: "default credentials" },
  { name: "Service Door", type: "device", x: -120, z: 108, hack: "weak PIN" },
  { name: "Ad Billboard", type: "device", x: 60, z: -50, hack: "content injection" },
  { name: "JAX-7 (drone)", type: "drone", x: 96, z: -40, hack: "dump its data" },
  { name: "DELLA (drone)", type: "drone", x: -150, z: -40, hack: "dump its data" },
  { name: "Rust Quarter gate", type: "legacy-district", x: 175, z: -175, hack: "forge a resident pass" },
  { name: "Little Kowloon gate", type: "legacy-district", x: 175, z: 175, hack: "forge a resident pass" },
  { name: "Breach Terminal", type: "console", x: -70, z: 40, hack: "the full CTF console" },
];

export const POST = withAuth(async (_req, jwt) => {
  const vuid = (jwt.vuid as string) || (jwt.sub as string);
  const handle = (jwt.handle as string) || (jwt.preferred_username as string) || "runner";
  const already = mutate((s) => {
    const row = s.scores[vuid] ?? (s.scores[vuid] = { vuid, handle, points: 0, flags: [], districts: [], at: Date.now() });
    const was = !!row.usedMap;
    row.usedMap = true;
    return was;
  });
  return Response.json({ targets: TARGETS, penaltyActive: true, alreadyUsed: already });
});
