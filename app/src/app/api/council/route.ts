import { withAuth } from "@/lib/auth/middleware";
import { hasRole } from "@/lib/auth/tideJWT";
import { adminFetch } from "@/lib/adminApi";

/**
 * The faction council — a thin, honest view of TideCloak's IGA change requests.
 *
 * Nothing here is a game abstraction over a workflow table. Promoting a runner
 * to `ghost` creates a real change request; approving it requires each council
 * member's browser enclave to produce a threshold-signed authorisation; and the
 * commit is refused with 412 until the quorum is met. The server below cannot
 * shortcut any of that, and neither can whoever owns the server.
 */

/**
 * How many approvals a change request has collected.
 *
 * The field is `authorizationCount`, with the signers in `authorizers`. It is
 * NOT `authCount` and NOT `approvals` — both of those read as `null`, which a
 * `??` chain happily turns into 0. The result is a UI that shows "0 / 1 signed"
 * next to `readyToCommit: true`, i.e. it tells you the signature did not land
 * at the same time as it tells you the thing is ready to commit. Read both, and
 * fall back to the ready flag rather than to zero.
 */
function approvals(cr: any): number {
  const n = cr?.authorizationCount ?? cr?.authorizers?.length ?? cr?.authCount;
  if (typeof n === "number") return n;
  // Nothing countable, but the server says it is ready: at least the threshold.
  return cr?.readyToCommit === true ? (cr?.threshold ?? 1) : 0;
}

async function listPending() {
  const res = await adminFetch("/iga/change-requests?status=PENDING");
  if (!res.ok) return { error: `change-requests returned ${res.status}`, items: [] as any[] };
  const json = await res.json();
  // The surface has shipped as both an array and an object keyed by id. Handle both.
  const items = Array.isArray(json) ? json : Object.values(json ?? {});
  return { items: items as any[] };
}

async function councilRoster() {
  const rm = await adminFetch("/clients?clientId=realm-management");
  if (!rm.ok) return { admins: [] as string[], quorum: 1 };
  const rmId = (await rm.json())?.[0]?.id;
  if (!rmId) return { admins: [] as string[], quorum: 1 };

  const res = await adminFetch(
    `/clients/${rmId}/roles/tide-realm-admin/users?briefRepresentation=true&max=100`,
  );
  const admins: string[] = res.ok
    ? ((await res.json()) as any[]).map((u) => u.username as string)
    : [];
  return { admins, quorum: Math.max(1, Math.floor(admins.length * 0.7)) };
}

export const GET = withAuth(async (_req, jwt) => {
  const [{ items, error }, roster] = await Promise.all([listPending(), councilRoster()]);
  return Response.json({
    error: error ?? null,
    isCouncil: hasRole(jwt, "tide-realm-admin"),
    ...roster,
    pending: items.map((cr: any) => ({
      id: cr.id,
      actionType: cr.actionType,
      entityType: cr.entityType,
      status: cr.status,
      readyToCommit: cr.readyToCommit === true,
      // Surfacing these two side by side is the whole story: N of M have
      // signed, and the commit stays refused until N reaches M.
      authCount: approvals(cr),
      threshold: cr.threshold ?? null,
      requestedBy: cr.requestedBy ?? cr.createdBy ?? null,
      summary: cr.actionType
        ? `${cr.actionType} on ${cr.entityType ?? "?"}`
        : JSON.stringify(cr).slice(0, 120),
    })),
  });
});

/** Propose a promotion. Creates a real GRANT_ROLES change request. */
export const POST = withAuth(async (req, jwt) => {
  if (!hasRole(jwt, "tide-realm-admin")) {
    return Response.json(
      { error: "Only a seated council member may put a name forward." },
      { status: 403 },
    );
  }
  const { username, role } = (await req.json().catch(() => ({}))) as any;
  if (typeof username !== "string" || !username) {
    return Response.json({ error: "username required" }, { status: 400 });
  }
  // Deliberately narrow: this endpoint exists to promote runners, not to hand
  // out arbitrary realm roles through a game client.
  const wanted = role === "fixer" || role === "ripperdoc" ? role : "ghost";

  const ures = await adminFetch(`/users?username=${encodeURIComponent(username)}&exact=true`);
  const uid = ures.ok ? (await ures.json())?.[0]?.id : null;
  if (!uid) return Response.json({ error: `No runner named ${username}` }, { status: 404 });

  const rres = await adminFetch(`/roles/${encodeURIComponent(wanted)}`);
  if (!rres.ok) return Response.json({ error: `No role ${wanted}` }, { status: 404 });
  const roleRep = await rres.json();

  const grant = await adminFetch(`/users/${uid}/role-mappings/realm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([roleRep]),
  });

  // 2xx means ACCEPTED, not APPLIED. Read the queue back rather than believing
  // the status code — this is the single most expensive assumption in an
  // IGA-enabled realm.
  const { items } = await listPending();
  const mine = items.filter((cr: any) => cr.actionType?.includes("ROLE"));

  return Response.json({
    proposed: true,
    role: wanted,
    username,
    httpStatus: grant.status,
    pendingNow: mine.length,
    note:
      grant.status >= 200 && grant.status < 300
        ? "Accepted, not applied. The grant sits as a change request until the council quorum signs it."
        : `TideCloak returned ${grant.status}.`,
  });
});
