/**
 * Who is in Sanctum-9 right now.
 *
 * The security-relevant detail: a presence record's IDENTITY is never taken
 * from the request body. The handle, the vuid and the roles all come from the
 * caller's verified doken — a token signed by a threshold of ORKs, each of
 * which checked the claims independently. A client can lie about where it is
 * standing; it cannot lie about who it is. So the name floating over a head in
 * the world is a threshold-signed assertion, not a nickname someone typed.
 *
 * Position IS client-supplied and therefore untrusted. That is fine: it is
 * cosmetic. Nothing in the game grants access based on where an avatar appears
 * to be — the district gate checks the doken server-side, every time. An
 * attacker who teleports their avatar into Vault Core arrives in an empty room.
 *
 * In-memory on purpose. Presence is ephemeral and worthless once stale; there
 * is nothing here to persist and nothing here worth stealing.
 */

export interface Presence {
  vuid: string;
  handle: string;
  /** Non-`_tide_` realm roles, from the doken. Drives the avatar's colour. */
  roles: string[];
  x: number;
  z: number;
  yaw: number;
  pitch: number;
  district: string | null;
  /** Server clock, ms. Used for eviction — never trusted from the client. */
  at: number;
}

/** Drop anyone who has not reported in for this long. */
const TTL_MS = 12_000;

const ROSTER = new Map<string, Presence>();

function sane(n: unknown, limit: number): number {
  const v = typeof n === "number" && Number.isFinite(n) ? n : 0;
  return Math.max(-limit, Math.min(limit, v));
}

/** Record a heartbeat and return everyone else who is currently live. */
export function beat(
  identity: { vuid: string; handle: string; roles: string[] },
  pose: { x?: unknown; z?: unknown; yaw?: unknown; pitch?: unknown; district?: unknown },
): Presence[] {
  const now = Date.now();

  ROSTER.set(identity.vuid, {
    vuid: identity.vuid,
    handle: identity.handle,
    roles: identity.roles,
    x: sane(pose.x, 1200),
    z: sane(pose.z, 1200),
    yaw: sane(pose.yaw, Math.PI * 4),
    pitch: sane(pose.pitch, Math.PI),
    district: typeof pose.district === "string" ? pose.district.slice(0, 24) : null,
    at: now,
  });

  const others: Presence[] = [];
  for (const [vuid, p] of ROSTER) {
    if (now - p.at > TTL_MS) {
      ROSTER.delete(vuid);
      continue;
    }
    if (vuid !== identity.vuid) others.push(p);
  }
  return others;
}

/** Live roster including the caller — for the "who's online" readout. */
export function roster(): Presence[] {
  const now = Date.now();
  const out: Presence[] = [];
  for (const [vuid, p] of ROSTER) {
    if (now - p.at > TTL_MS) ROSTER.delete(vuid);
    else out.push(p);
  }
  return out.sort((a, b) => a.handle.localeCompare(b.handle));
}

export function leave(vuid: string) {
  ROSTER.delete(vuid);
}

/* ------------------------------------------------------------ detonation */

/**
 * The Blackwall Protocol going off is a WORLD event, so it rides the presence
 * heartbeat every client is already running — no second transport.
 *
 * Only the server writes this, and only after it has confirmed the revocation
 * actually committed on the realm. A client cannot announce a detonation that
 * did not cryptographically happen, which matters: the whole point of the
 * mechanic is that the bang and the access change are the same event.
 */
export interface Detonation {
  at: number;
  by: string;
  /** How many runners lost the role. */
  victims: number;
}

let LAST: Detonation | null = null;

export function recordDetonation(by: string, victims: number): Detonation {
  LAST = { at: Date.now(), by, victims };
  return LAST;
}

export function lastDetonation(): Detonation | null {
  return LAST;
}
