import { withAuth } from "@/lib/auth/middleware";
import { hasRole } from "@/lib/auth/tideJWT";
import { DATASHARD_TAG } from "@/lib/districts";
import { mutate, snapshot } from "@/lib/store";
import { emit } from "@/lib/wire";

/** Your stash: sealed bytes the server holds and cannot open. */
export const GET = withAuth(async (_req, jwt) => {
  const vuid = (jwt.vuid as string) || (jwt.sub as string);
  const s = snapshot();
  return Response.json({
    shards: Object.values(s.shards)
      .filter((x) => x.owner === vuid)
      .sort((a, b) => a.at - b.at),
  });
});

/**
 * Store a sealed datashard.
 *
 * The body is a TideMemory envelope the browser produced with `doEncrypt`. A
 * fresh key was generated for that one call and ElGamal-encrypted across a
 * threshold of ORKs; this process never saw the key and never will. Opening it
 * again requires the owner's live doken plus threshold participation from the
 * Fabric — so this endpoint stores it and, structurally, can do nothing else
 * with it.
 */
export const POST = withAuth(async (req, jwt) => {
  const vuid = (jwt.vuid as string) || (jwt.sub as string);
  const handle = (jwt.handle as string) || (jwt.preferred_username as string) || "runner";

  // Voucher gate: the ORKs enforce this too, but refusing early gives a better
  // error than a timeout inside the enclave.
  if (!hasRole(jwt, `_tide_${DATASHARD_TAG}.selfencrypt`)) {
    return Response.json(
      { error: `Missing voucher gate _tide_${DATASHARD_TAG}.selfencrypt` },
      { status: 403 },
    );
  }

  const body = await req.json().catch(() => null);
  const { shardId, district, sealed } = body ?? {};
  if (typeof shardId !== "string" || typeof sealed !== "string" || !sealed) {
    return Response.json({ error: "shardId and sealed are required" }, { status: 400 });
  }

  // Refuse anything that is not opaque. If a payload arrives that this server
  // can parse as its own plaintext, something upstream is broken and storing it
  // would quietly turn an E2EE demo into a plaintext database.
  if (sealed.length < 32 || /^[\x20-\x7e]*\s(the|and|of|shard|record)\s/i.test(sealed)) {
    return Response.json(
      { error: "Payload does not look like a sealed envelope; refusing to store." },
      { status: 400 },
    );
  }

  const bytes = Math.floor((sealed.length * 3) / 4);

  return Response.json(
    mutate((s) => {
      const key = `${vuid}:${shardId}`;
      s.shards[key] = {
        id: key,
        owner: vuid,
        ownerHandle: handle,
        district: String(district ?? "unknown"),
        sealed,
        bytes,
        tag: DATASHARD_TAG,
        at: Date.now(),
      };
      s.looted[vuid] = Array.from(new Set([...(s.looted[vuid] ?? []), shardId]));
      s.handles[vuid] = handle;
      emit("seal", handle, `sealed a datashard in ${district ?? "the city"} — ${bytes} B, unreadable to this server`);
      return { stored: true, bytes, id: key };
    }),
  );
});
