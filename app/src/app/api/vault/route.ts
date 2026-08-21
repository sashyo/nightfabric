import { withAuth } from "@/lib/auth/middleware";
import { hasRole } from "@/lib/auth/tideJWT";
import { CREW_ROLE } from "@/lib/districts";
import { mutate, snapshot } from "@/lib/store";
import { emit } from "@/lib/wire";

/**
 * The crew vault. Everything here is policy-governed VVK ciphertext: sealed
 * with the organisational key, opened by anyone whose doken satisfies the
 * Forseti contract — and by nobody else, including this server.
 *
 * Contrast with /api/stash, which is self-encryption: identity-bound, and not
 * shareable no matter what roles you hand out.
 */
export const GET = withAuth(async (_req, jwt) => {
  const s = snapshot();
  return Response.json({
    // Whether the policy exists at all — the vault terminal is dead without it.
    policyReady: s.vaultPolicy !== null,
    // Ciphertext is handed to any authenticated player on purpose. Holding it
    // is not the same as being able to read it, and the demo is stronger for
    // letting an unauthorized player hold the bytes and fail to open them.
    entries: s.vault.slice().sort((a, b) => b.at - a.at),
    canOpen: hasRole(jwt, CREW_ROLE),
  });
});

/** Seal a drop into the crew vault. Body carries VVK ciphertext from the browser. */
export const POST = withAuth(async (req, jwt) => {
  if (!hasRole(jwt, CREW_ROLE)) {
    return Response.json(
      { error: `Sealing a crew drop needs the ${CREW_ROLE} role.` },
      { status: 403 },
    );
  }
  const body = await req.json().catch(() => null);
  const { sealed, note, tags } = body ?? {};
  if (typeof sealed !== "string" || !sealed || sealed.length < 32) {
    return Response.json({ error: "sealed envelope required" }, { status: 400 });
  }
  // Tags are not decoration: the contract reads them, and a drop whose tags are
  // lost can never be opened again because decryption must present the same set.
  const tagList = Array.isArray(tags) ? tags.filter((t) => typeof t === "string").slice(0, 8) : [];
  if (tagList.length === 0) {
    return Response.json({ error: "at least one tag required" }, { status: 400 });
  }

  const vuid = (jwt.vuid as string) || (jwt.sub as string);
  const handle = (jwt.handle as string) || (jwt.preferred_username as string) || "runner";

  return Response.json(
    mutate((s) => {
      const entry = {
        id: `drop-${s.vault.length + 1}-${Date.now().toString(36)}`,
        author: vuid,
        authorHandle: handle,
        sealed,
        bytes: Math.floor((sealed.length * 3) / 4),
        note: typeof note === "string" ? note.slice(0, 120) : "",
        tags: tagList,
        at: Date.now(),
      };
      s.vault.push(entry);
      s.handles[vuid] = handle;
      emit("drop", handle, `sealed a crew drop — ${entry.bytes} B under the Forseti contract`);
      return { stored: true, id: entry.id, bytes: entry.bytes };
    }),
  );
});
