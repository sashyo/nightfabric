import { withAuth } from "@/lib/auth/middleware";
import { beat, leave, roster, lastDetonation } from "@/lib/presence";
import { since as chatSince } from "@/lib/chat";
import { wireSince, emit } from "@/lib/wire";

/**
 * The multiplayer heartbeat: one round-trip carries your pose up and everyone
 * else's back down. No websocket, so it survives a plain `next start` behind a
 * tunnel that only forwards HTTP.
 *
 * Identity comes from `jwt`, which `withAuth` produced by verifying an EdDSA
 * threshold signature against the JWKS embedded in the adapter. The body is
 * read for position only. That split is the whole design: a client that forges
 * `handle: "judy"` in the body changes nothing, because the body is never asked
 * who it is.
 */
export const POST = withAuth(async (req, jwt) => {
  const vuid = (jwt.vuid as string) || (jwt.sub as string);
  const handle = (jwt.handle as string) || (jwt.preferred_username as string) || "runner";
  const roles = (((jwt.realm_access as any)?.roles ?? []) as string[]).filter(
    (r) => !r.startsWith("_tide_") && !r.startsWith("default-roles"),
  );

  const body = await req.json().catch(() => ({}));
  const known = roster().some((p) => p.vuid === vuid);
  const others = beat({ vuid, handle, roles }, body ?? {});
  if (!known) {
    emit("join", handle, `jacked into Sanctum-9 as ${roles.filter((r) => r !== "runner").join(" ") || "runner"}`);
  }

  return Response.json({
    you: { vuid, handle, roles },
    players: others,
    online: others.length + 1,
    // Clients compare this timestamp to the last one they played. Everyone in
    // the world sees the blast within one heartbeat of each other.
    detonation: lastDetonation(),
    // Only what this client has not seen. Shipping the whole log 8 times a
    // second would be an expensive way to do the same thing.
    chat: chatSince((body as any)?.chatSince),
    wire: wireSince((body as any)?.wireSince),
  });
});

/** Read-only roster, for the HUD. */
export const GET = withAuth(async () => Response.json({ players: roster() }));

/** Explicit sign-off so an avatar disappears immediately instead of after TTL. */
export const DELETE = withAuth(async (_req, jwt) => {
  leave((jwt.vuid as string) || (jwt.sub as string));
  return Response.json({ left: true });
});
