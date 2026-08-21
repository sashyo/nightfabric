import { withAuth } from "@/lib/auth/middleware";
import { hasRole } from "@/lib/auth/tideJWT";
import { adminFetch } from "@/lib/adminApi";

/**
 * Step 3 of the policy-signing ceremony: fetch the realm's signed admin policy,
 * which gets attached to the approved request before it goes to the ORKs.
 *
 * Proxied because (a) the browser cannot reach TideCloak's admin API across
 * origins and (b) it would need an admin bearer to do it. Gated on the caller's
 * own verified doken carrying tide-realm-admin — a proxy that forwards its
 * privilege to anyone who asks is just a slower way to leak the credential.
 *
 * The bytes arrive base64 in the `policy` field. Decoding them here, rather
 * than passing the base64 text through as char codes, is the difference between
 * a working signature and `Index out of range` inside the ORK.
 */
export const GET = withAuth(async (_req, jwt) => {
  if (!hasRole(jwt, "tide-realm-admin")) {
    return Response.json(
      { error: "Policy signing is an admin ceremony. Council members only." },
      { status: 403 },
    );
  }

  const res = await adminFetch("/iga/role-policies");
  if (!res.ok) {
    return Response.json(
      { error: `TideCloak returned ${res.status} for /iga/role-policies` },
      { status: 502 },
    );
  }

  const json = await res.json();
  const list = Array.isArray(json) ? json : [json];
  const withPolicy = list.find((p: any) => p && typeof p.policy === "string" && p.policy);
  if (!withPolicy) {
    return Response.json(
      {
        error:
          "No signed admin policy on this realm. It is written during the firstAdmin ceremony; " +
          "if it is missing, the realm bootstrap did not complete.",
      },
      { status: 409 },
    );
  }

  return Response.json({
    policyBytes: Array.from(Buffer.from(withPolicy.policy, "base64")),
    name: withPolicy.name ?? null,
  });
});
