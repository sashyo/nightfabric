import { NextRequest } from "next/server";
import { verifyTideJWT, hasRole, extractToken } from "./tideJWT";
import { verifyDpop, DpopError } from "./dpop";
import type { JWTPayload } from "jose";

type AuthHandler = (req: NextRequest, jwt: JWTPayload) => Promise<Response>;

export function withAuth(handler: AuthHandler) {
  return async (req: NextRequest) => {
    try {
      const { token, scheme } = extractToken(req.headers.get("authorization"));
      const jwt = await verifyTideJWT(token);

      // If the token is sender-constrained, the DPoP proof is not optional.
      // Verifying only the token signature and skipping this is what let a
      // stolen token replay as a plain Bearer.
      const jkt = (jwt.cnf as { jkt?: string } | undefined)?.jkt;
      if (jkt && process.env.DPOP_ENFORCE !== "0") {
        try {
          await verifyDpop(req, token, scheme, jkt);
        } catch (e) {
          // Log the exact reason server-side. If this ever fires on a LEGIT
          // request (breaking the game rather than an attack), the message names
          // which check failed, and DPOP_ENFORCE=0 in .env.local reverts to
          // signature-only while it is diagnosed.
          console.warn("[dpop] rejected:", e instanceof Error ? e.message : e,
            "·", req.method, req.nextUrl.pathname);
          throw e;
        }
      }

      return handler(req, jwt);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unauthorized";
      // DPoP failures get their own signal so the SDK's nonce/retry logic and a
      // human debugging a 401 can tell them apart from a bad token.
      const headers =
        err instanceof DpopError ? { "WWW-Authenticate": 'DPoP error="invalid_dpop_proof"' } : undefined;
      return Response.json({ error: msg }, { status: 401, headers });
    }
  };
}

export function withRole(role: string, handler: AuthHandler) {
  return withAuth(async (req, jwt) => {
    if (!hasRole(jwt, role)) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
    return handler(req, jwt);
  });
}
