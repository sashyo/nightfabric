import { withAuth } from "@/lib/auth/middleware";
import { hasRole } from "@/lib/auth/tideJWT";

/**
 * A read-only mirror of what the SERVER can see about the caller, for the
 * breach console to diff against what the client THINKS is true.
 *
 * The point of exposing this: a player can compare the roles their browser
 * shows against the roles the server extracted from the *verified* doken, and
 * confirm they are the same object — i.e. that there is no second, client-
 * trusted copy of authorization to tamper with. Everything here is derived from
 * the threshold-signed token, nothing from the request body.
 */
export const GET = withAuth(async (_req, jwt) => {
  const realmRoles = (((jwt.realm_access as any)?.roles ?? []) as string[]).filter(
    (r) => !r.startsWith("_tide_") && !r.startsWith("default-roles"),
  );
  return Response.json({
    // Verified claims — each signed by a threshold of ORKs.
    vuid: (jwt.vuid as string) || (jwt.sub as string),
    handle: (jwt.handle as string) || (jwt.preferred_username as string) || null,
    issuer: jwt.iss,
    audience: jwt.azp,
    roles: realmRoles,
    isCouncil: hasRole(jwt, "tide-realm-admin"),
    // DPoP confirmation thumbprint, if the token is bound.
    dpopBound: !!(jwt.cnf as any)?.jkt,
    jkt: (jwt.cnf as any)?.jkt ?? null,
    exp: jwt.exp,
    serverTime: Math.floor(Date.now() / 1000),
  });
});
