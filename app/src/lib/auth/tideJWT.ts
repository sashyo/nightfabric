import { jwtVerify, createLocalJWKSet } from "jose";
import type { JWTPayload } from "jose";
import { loadTideConfig } from "./tidecloakConfig";

// Lazy initialization — do NOT load config at module level.
// Next.js 16 evaluates module-level code during `next build` for static
// page generation. If tidecloak.json doesn't exist yet (placeholder or
// pre-bootstrap), eager loading throws at build time.
let _jwks: ReturnType<typeof createLocalJWKSet> | null = null;
let _config: ReturnType<typeof loadTideConfig> | null = null;

function getConfig() {
  if (!_config) {
    _config = loadTideConfig();
    if (!_config.jwk) {
      throw new Error(
        "Adapter JSON missing jwk field. Re-export with IGA enabled."
      );
    }
    _jwks = createLocalJWKSet(_config.jwk);
  }
  return { config: _config, JWKS: _jwks! };
}

export async function verifyTideJWT(token: string): Promise<JWTPayload> {
  const { config, JWKS } = getConfig();
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: `${config["auth-server-url"].replace(/\/+$/, "")}/realms/${config.realm}`,
  });

  if (payload.azp !== config.resource) {
    throw new Error("Token azp does not match client");
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) {
    throw new Error("Token expired");
  }
  if (payload.iat && payload.iat > now + 60) {
    throw new Error("Token issued in future");
  }

  return payload;
}

export function hasRole(payload: JWTPayload, role: string): boolean {
  const realmRoles = (payload.realm_access as any)?.roles || [];
  if (realmRoles.includes(role)) return true;

  const resourceAccess = payload.resource_access as any;
  if (resourceAccess) {
    for (const client of Object.values(resourceAccess)) {
      if ((client as any)?.roles?.includes(role)) return true;
    }
  }
  return false;
}

export interface Bearer {
  token: string;
  /** "DPoP" or "Bearer" — the scheme matters: a sender-constrained token
   *  presented as Bearer is invalid, and that distinction is the replay defence. */
  scheme: string;
}

export function extractToken(authHeader: string | null): Bearer {
  if (!authHeader) throw new Error("Missing Authorization header");
  const [scheme, token] = authHeader.split(/\s+/, 2);
  if (!token) throw new Error("Invalid Authorization header format");
  const s = scheme.toLowerCase();
  if (s !== "bearer" && s !== "dpop") throw new Error("Invalid Authorization scheme");
  return { token, scheme };
}
