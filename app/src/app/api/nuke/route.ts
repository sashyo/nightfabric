import { withAuth } from "@/lib/auth/middleware";
import { hasRole } from "@/lib/auth/tideJWT";
import { adminFetch } from "@/lib/adminApi";
import { CREW_ROLE } from "@/lib/districts";
import { recordDetonation } from "@/lib/presence";

/**
 * THE BLACKWALL PROTOCOL — the nuke.
 *
 * Revokes `crew-vault-access` from every runner in Sanctum-9. The effect is not
 * cosmetic and not recoverable by holding onto old data: every crew drop ever
 * sealed becomes unopenable, including ones people read yesterday, because the
 * ORKs run the Forseti contract fresh on every single decrypt and the contract
 * checks the role in the doken *at that moment*.
 *
 * Ordinary encryption cannot do this. Once a key is out, ciphertext already in
 * the wild stays readable forever; revocation is a promise about future access
 * at best. Here it is retroactive and enforced by the network.
 *
 * The important design point: this endpoint does NOT ask for permission and
 * then act. It cannot act at all. Arming files real change requests, and they
 * sit there doing nothing until a quorum of council members sign them in their
 * own browser enclaves. There is no code path on this machine — not this route,
 * not the master admin credential, not the database — that detonates alone.
 * That is why the button is safe to put in a game.
 */

const NUKE_ROLE = CREW_ROLE;

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

async function pendingNukes() {
  const res = await adminFetch("/iga/change-requests?status=PENDING");
  if (!res.ok) return [];
  const json = await res.json();
  const items: any[] = Array.isArray(json) ? json : Object.values(json ?? {});
  // Revocations show up as a role action; keep it broad and let the UI label them.
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

export const GET = withAuth(async (_req, jwt) => {
  const [pending, q] = await Promise.all([pendingNukes(), quorum()]);
  return Response.json({
    role: NUKE_ROLE,
    isCouncil: hasRole(jwt, "tide-realm-admin"),
    ...q,
    armed: pending.length > 0,
    requests: pending.map((cr: any) => ({
      id: cr.id,
      actionType: cr.actionType,
      readyToCommit: cr.readyToCommit === true,
      authCount: approvals(cr),
      threshold: cr.threshold ?? null,
    })),
  });
});

/** Arm: file a revocation change request per runner. Detonates nothing. */
export const POST = withAuth(async (_req, jwt) => {
  if (!hasRole(jwt, "tide-realm-admin")) {
    return Response.json(
      { error: "Only a seated council member can arm the Blackwall Protocol." },
      { status: 403 },
    );
  }

  const roleRes = await adminFetch(`/roles/${encodeURIComponent(NUKE_ROLE)}`);
  if (!roleRes.ok) return Response.json({ error: `No role ${NUKE_ROLE}` }, { status: 404 });
  const roleRep = await roleRes.json();

  const holdersRes = await adminFetch(
    `/roles/${encodeURIComponent(NUKE_ROLE)}/users?briefRepresentation=true&max=200`,
  );
  if (!holdersRes.ok) {
    return Response.json({ error: "Could not list role holders" }, { status: 502 });
  }
  const holders: any[] = await holdersRes.json();
  if (holders.length === 0) {
    return Response.json(
      { armed: false, note: `Nobody holds ${NUKE_ROLE}. Nothing to revoke.` },
      { status: 409 },
    );
  }

  const filed: { username: string; status: number }[] = [];
  for (const u of holders) {
    // One role per request, sequentially: concurrent governed writes against the
    // same user collapse into a single change request and you silently file
    // fewer than you think.
    const r = await adminFetch(`/users/${u.id}/role-mappings/realm`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([roleRep]),
    });
    filed.push({ username: u.username, status: r.status });
  }

  const pending = await pendingNukes();
  const q = await quorum();
  return Response.json({
    armed: pending.length > 0,
    filed,
    ...q,
    note:
      `${filed.length} revocation change requests filed. Nothing has been revoked. ` +
      `They require ${q.quorum} of ${q.admins.length} council enclave signatures to commit, ` +
      `and no credential on this server can supply one.`,
  });
});

/** Disarm: deny every pending revocation. Also needs to be a council member. */
export const DELETE = withAuth(async (_req, jwt) => {
  if (!hasRole(jwt, "tide-realm-admin")) {
    return Response.json({ error: "Council members only." }, { status: 403 });
  }
  const pending = await pendingNukes();
  let denied = 0;
  for (const cr of pending) {
    const r = await adminFetch(`/iga/change-requests/${cr.id}/deny`, { method: "POST" });
    if (r.ok) denied++;
  }
  return Response.json({ disarmed: true, denied });
});
