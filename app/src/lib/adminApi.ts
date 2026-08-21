/**
 * Server-only TideCloak admin API access.
 *
 * The master-admin credential lives here and only here. It never reaches the
 * browser, and the browser never talks to TideCloak's admin API directly —
 * partly for CORS, mostly because handing an admin bearer to a game client
 * would undo the entire point.
 *
 * Master-admin tokens expire in ~60 SECONDS. Mint on demand, never cache.
 */
const BASE = (process.env.TIDECLOAK_URL || "http://localhost:8080").replace(/\/+$/, "");
const REALM = process.env.REALM_NAME || "nightfabric";

/**
 * Two ways to reach the admin API:
 *
 *   password           — self-hosted: the master-realm admin credential
 *   client_credentials — Skycloak: the cluster's automation client. Skycloak
 *                        issues no master admin password at all, so this is the
 *                        only option there.
 *
 * Either way the secret is SERVER-ONLY. It is never bundled, never sent to the
 * browser, and the browser never talks to the admin API directly.
 */
const MODE = process.env.TIDECLOAK_ADMIN_MODE === "client_credentials" ? "cc" : "password";

function missing(name: string): never {
  throw new Error(
    `${name} is not set for the server process. ` +
      "app/.env.local (gitignored) is written by scripts/init-nightfabric.sh.",
  );
}

async function tokenViaPassword(): Promise<string> {
  const username = process.env.KC_BOOTSTRAP_ADMIN_USERNAME || "admin";
  const password =
    process.env.KC_BOOTSTRAP_ADMIN_PASSWORD || process.env.KC_ADMIN_PASSWORD || "";
  if (!password) missing("KC_BOOTSTRAP_ADMIN_PASSWORD");

  const res = await fetch(`${BASE}/realms/master/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "password",
      client_id: "admin-cli",
      username,
      password,
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`master admin login failed: ${res.status}`);
  const j = await res.json();
  if (!j.access_token) throw new Error("master admin login returned no token");
  return j.access_token as string;
}

async function tokenViaClientCredentials(): Promise<string> {
  const id = process.env.SKYCLOAK_CLIENT_ID || missing("SKYCLOAK_CLIENT_ID");
  const secret = process.env.SKYCLOAK_CLIENT_SECRET || missing("SKYCLOAK_CLIENT_SECRET");
  const url =
    process.env.SKYCLOAK_TOKEN_URL ||
    `${BASE}/realms/master/protocol/openid-connect/token`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: id,
      client_secret: secret,
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`automation client login failed: ${res.status}`);
  const j = await res.json();
  if (!j.access_token) throw new Error("automation client returned no token");
  return j.access_token as string;
}

/** Admin tokens are short-lived (~60s self-hosted). Mint on demand, never cache. */
export async function adminToken(): Promise<string> {
  return MODE === "cc" ? tokenViaClientCredentials() : tokenViaPassword();
}

/** Call a realm-scoped admin endpoint. `path` is relative to /admin/realms/{realm}. */
export async function adminFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await adminToken();
  return fetch(`${BASE}/admin/realms/${REALM}${path}`, {
    ...init,
    headers: {
      ...(init.headers as Record<string, string>),
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  });
}

export const realmName = REALM;
export const tidecloakBase = BASE;
