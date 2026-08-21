import { withAuth } from "@/lib/auth/middleware";
import { hasRole } from "@/lib/auth/tideJWT";
import { DISTRICTS } from "@/lib/districts";
import { mutate } from "@/lib/store";

/**
 * Who the Fabric says you are — computed from the *verified* doken, not from
 * anything the browser claimed. The renderer draws its HUD from this, so the
 * displayed clearances and the enforced clearances come from one place.
 */
export const GET = withAuth(async (_req, jwt) => {
  const vuid = (jwt.vuid as string) || (jwt.sub as string);
  const handle = (jwt.handle as string) || (jwt.preferred_username as string) || "runner";

  mutate((s) => {
    s.handles[vuid] = handle;
  });

  const realmRoles = ((jwt.realm_access as any)?.roles ?? []) as string[];

  return Response.json({
    vuid,
    handle,
    // Every claim below was signed by a threshold of ORKs, each of which
    // verified it independently before contributing a partial signature.
    // No single machine — including this one — could have forged it.
    issuer: jwt.iss,
    tokenExp: jwt.exp,
    isCouncil: hasRole(jwt, "tide-realm-admin"),
    roles: realmRoles.filter((r) => !r.startsWith("default-roles")).sort(),
    clearances: DISTRICTS.map((d) => ({
      id: d.id,
      granted: d.clearance === null || hasRole(jwt, d.clearance),
      clearance: d.clearance,
    })),
  });
});
