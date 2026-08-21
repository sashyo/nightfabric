import { withAuth } from "@/lib/auth/middleware";
import { hasRole } from "@/lib/auth/tideJWT";
import { adminFetch } from "@/lib/adminApi";
import { CREW_ROLE } from "@/lib/districts";
import { recordDetonation } from "@/lib/presence";
import { mutate } from "@/lib/store";
import { emit } from "@/lib/wire";

const NUKE_ROLE = CREW_ROLE;

/**
 * Its own POST route rather than a PUT on /api/nuke.
 *
 * PUT was the natural verb and it cost an hour: through a cloudflared quick
 * tunnel, `PUT /api/nuke` kept returning 405 while the same request to the
 * origin returned 401, and `PUT /api/council/[id]` worked fine. Cloudflare's
 * edge had cached the 405 from before the handler existed, and no cache-buster
 * or no-cache header shook it loose. A distinct path with POST — which is the
 * right verb for "do this thing" anyway — sidesteps it entirely.
 *
 * Worth remembering when publishing behind any CDN: a method that 405s once can
 * stay 405 at the edge long after you implement it.
 */

async function pendingNukes() {
  const res = await adminFetch("/iga/change-requests?status=PENDING");
  if (!res.ok) return [];
  const json = await res.json();
  const items: any[] = Array.isArray(json) ? json : Object.values(json ?? {});
  return items.filter((cr) => String(cr.actionType ?? "").toUpperCase().includes("ROLE"));
}

async function quorum() {
  const rm = await adminFetch("/clients?clientId=realm-management");
  if (!rm.ok) return { admins: [] as string[], quorum: 1 };
  const rmId = (await rm.json())?.[0]?.id;
  if (!rmId) return { admins: [] as string[], quorum: 1 };
  const res = await adminFetch(
    `/clients/${rmId}/roles/tide-realm-admin/users?briefRepresentation=true&max=100`,
  );
  const admins: string[] = res.ok ? ((await res.json()) as any[]).map((u) => u.username) : [];
  return { admins, quorum: Math.max(1, Math.floor(admins.length * 0.7)) };
}

/**
 * Detonate: commit every pending revocation, then CHECK whether it worked.
 *
 * The order matters. We do not announce a blast because the commits returned
 * 200 — we announce it because the role is afterwards held by nobody. Under
 * quorum, `commit` returns 412, the holder count is unchanged, and no
 * detonation is recorded. The explosion and the cryptographic revocation are
 * the same event or they are neither.
 */
export const POST = withAuth(async (_req, jwt) => {
  if (!hasRole(jwt, "tide-realm-admin")) {
    return Response.json({ error: "Council members only." }, { status: 403 });
  }

  const before = await adminFetch(
    `/roles/${encodeURIComponent(NUKE_ROLE)}/users?briefRepresentation=true&max=200`,
  );
  const beforeCount = before.ok ? ((await before.json()) as any[]).length : 0;

  const pending = await pendingNukes();
  if (pending.length === 0) {
    return Response.json({ detonated: false, reason: "Nothing armed." }, { status: 409 });
  }

  let blocked = 0;
  for (const cr of pending) {
    const r = await adminFetch(`/iga/change-requests/${cr.id}/commit`, { method: "POST" });
    if (r.status === 412) blocked++;
  }

  const after = await adminFetch(
    `/roles/${encodeURIComponent(NUKE_ROLE)}/users?briefRepresentation=true&max=200`,
  );
  const afterCount = after.ok ? ((await after.json()) as any[]).length : beforeCount;
  const victims = Math.max(0, beforeCount - afterCount);

  if (victims === 0) {
    const q = await quorum();
    return Response.json(
      {
        detonated: false,
        under_quorum: blocked > 0,
        blocked,
        message:
          blocked > 0
            ? `412 on ${blocked} request(s) — still under quorum (${q.quorum} of ${q.admins.length} needed). The Fabric will not seal it, so nothing went off.`
            : "Nothing was revoked. No detonation recorded.",
      },
      { status: 412 },
    );
  }

  const by = (jwt.handle as string) || (jwt.preferred_username as string) || "council";
  const det = recordDetonation(by, victims);
  // The Blackwall Protocol also wipes the leaderboard — a citywide reset that
  // NO single admin can trigger. It took a council quorum to get here.
  const wiped = mutate((s) => {
    const n = Object.keys(s.scores).length;
    s.scores = {};
    return n;
  });
  emit("boom", by, `DETONATED the Blackwall Protocol — ${victims} lost ${NUKE_ROLE}, ${wiped} scores wiped`);
  return Response.json({
    detonated: true,
    victims,
    detonation: det,
    scoresWiped: wiped,
    message: `Committed. ${victims} runner(s) lost ${NUKE_ROLE} and the leaderboard is wiped. No single admin could have done this — it took a council quorum.`,
  });
});
