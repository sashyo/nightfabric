import { withAuth } from "@/lib/auth/middleware";
import { hasRole } from "@/lib/auth/tideJWT";
import { mutate, snapshot } from "@/lib/store";

/**
 * Signed Forseti policy bytes for the crew vault.
 *
 * Every player needs these to encrypt or decrypt, so they live on the server
 * rather than in one admin's localStorage. They are not a secret — the policy
 * describes the rule, it does not enforce it. Enforcement is the ORK network
 * running the contract. Handing the policy to an unauthorized player gains them
 * nothing.
 */
export const GET = withAuth(async () => {
  const p = snapshot().vaultPolicy;
  if (!p) {
    return Response.json(
      { ready: false, reason: "No signed crew-vault policy yet. An admin must sign it at /forge." },
      { status: 404 },
    );
  }
  return Response.json({ ready: true, policyBytes: Array.from(Buffer.from(p, "base64")) });
});

/** Store the policy after a completed signing ceremony. Admin only. */
export const POST = withAuth(async (req, jwt) => {
  if (!hasRole(jwt, "tide-realm-admin")) {
    return Response.json({ error: "Council members only." }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const bytes = body?.policyBytes;
  if (!Array.isArray(bytes) || bytes.length < 64) {
    return Response.json({ error: "policyBytes (number[]) required" }, { status: 400 });
  }

  // Storing unsigned bytes is the failure that poisons every later call: the
  // app then fetches stale garbage forever and every encrypt fails with a
  // message about something else. Refuse anything implausibly small.
  const buf = Buffer.from(Uint8Array.from(bytes));
  return Response.json(
    mutate((s) => {
      s.vaultPolicy = buf.toString("base64");
      return { stored: true, bytes: buf.length };
    }),
  );
});
