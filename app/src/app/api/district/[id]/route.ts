import { withAuth } from "@/lib/auth/middleware";
import { hasRole } from "@/lib/auth/tideJWT";
import { DISTRICT_BY_ID, isDistrictId } from "@/lib/districts";
import { spawnsFor } from "@/lib/loot";
import { snapshot, mutate } from "@/lib/store";
import { districtPoints } from "@/lib/score";
import { emit } from "@/lib/wire";
import { mintFlag } from "@/lib/legacy";
import { HACK_CHALLENGES, verifyHack } from "@/lib/hacks";

/**
 * The gate. Note what is and is not here:
 *
 *   - No session lookup, no database read to decide access. The doken carries
 *     its own proof; we verify the EdDSA threshold signature against the JWKS
 *     embedded in the adapter JSON and read the roles out of it.
 *   - A refusal returns 403 AND NO CONTENT. That is the part that matters. A
 *     player who defeats the barrier in the renderer arrives somewhere empty.
 *
 * LEGACY districts run the old stack: instead of a verified doken they fall to
 * a real, classic exploit — a different one per district (alg:none forge,
 * rainbow-crack, replay, default creds, SQLi, PIN brute-force, leaked key). GET
 * hands back the challenge; POST is where you actually pull off the attack.
 */

/** Award a cleared district exactly once. */
function award(vuid: string, handle: string, id: string, pts: number): number {
  return mutate((store) => {
    const row =
      store.scores[vuid] ??
      (store.scores[vuid] = { vuid, handle, points: 0, flags: [], districts: [], at: Date.now() });
    row.handle = handle;
    if (row.districts.includes(id)) return 0;
    row.districts.push(id);
    row.points += pts;
    row.at = Date.now();
    return pts;
  });
}

export const GET = withAuth(async (req, jwt) => {
  const id = req.nextUrl.pathname.split("/").pop();
  if (!isDistrictId(id)) return Response.json({ error: "No such district" }, { status: 404 });
  const d = DISTRICT_BY_ID[id];
  const who = (jwt.handle as string) || (jwt.preferred_username as string) || "runner";

  if (d.legacy) {
    // Not granted on sight any more — return the exploit the gate is vulnerable
    // to. The player has to actually run it (POST) to get in.
    emit("gate-deny", who, `probed ${d.name} — legacy gate, exploit required`);
    return Response.json(
      { granted: false, legacy: true, district: d.id, refusal: d.refusal, hack: HACK_CHALLENGES[id] },
      { status: 403 },
    );
  }

  if (d.clearance && !hasRole(jwt, d.clearance)) {
    emit("gate-deny", who, `refused at ${d.name} — no ${d.clearance}`);
    return Response.json(
      {
        granted: false,
        district: d.id,
        required: d.clearance,
        refusal: d.refusal,
        sawRoles: ((jwt.realm_access as any)?.roles ?? []).filter(
          (r: string) => !r.startsWith("default-roles") && !r.startsWith("_tide_"),
        ),
      },
      { status: 403 },
    );
  }

  const vuid = (jwt.vuid as string) || (jwt.sub as string);
  emit("gate-pass", who, `cleared into ${d.name}`);
  const awarded = award(vuid, who, d.id, districtPoints(d.id));
  const taken = new Set(snapshot().looted[vuid] ?? []);
  return Response.json({
    granted: true, district: d.id, name: d.name, blurb: d.blurb,
    awarded, points: districtPoints(d.id),
    shards: spawnsFor(d.id, d.radius).filter((s) => !taken.has(s.id)),
  });
});

/** Run the exploit. Body carries the attack payload for this district's kind. */
export const POST = withAuth(async (req, jwt) => {
  const id = req.nextUrl.pathname.split("/").pop();
  if (!isDistrictId(id)) return Response.json({ error: "No such district" }, { status: 404 });
  const d = DISTRICT_BY_ID[id];
  const who = (jwt.handle as string) || (jwt.preferred_username as string) || "runner";

  if (!d.legacy) {
    // The one tidified gate cannot be exploited — there is no code path that
    // trusts anything but the threshold signature. This is the whole point.
    emit("gate-deny", who, `tried to exploit ${d.name} — no legacy path exists`);
    return Response.json(
      { granted: false, glitch: true, district: d.id,
        detail: "This gate is verified server-side against the doken signature. There is nothing here to forge." },
      { status: 403 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const result = verifyHack(id, body ?? {});
  if (!result.ok) {
    emit("gate-deny", who, `failed exploit at ${d.name}`);
    return Response.json({ granted: false, legacy: true, district: d.id, detail: result.detail, hack: HACK_CHALLENGES[id] }, { status: 403 });
  }

  const vuid = (jwt.vuid as string) || (jwt.sub as string);
  emit("gate-pass", who, `HACKED into ${d.name} — ${HACK_CHALLENGES[id]?.kind}`);
  const awarded = award(vuid, who, d.id, districtPoints(d.id));
  const taken = new Set(snapshot().looted[vuid] ?? []);
  return Response.json({
    granted: true, legacy: true, district: d.id, name: d.name, blurb: d.blurb,
    awarded, points: districtPoints(d.id),
    detail: result.detail,
    flag: result.flag ? mintFlag(result.flag) : undefined,
    shards: spawnsFor(d.id, d.radius).filter((x) => !taken.has(x.id)),
  });
});
