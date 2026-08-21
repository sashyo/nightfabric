/**
 * Governed admin writes, made FROM THE BROWSER with the human's own token.
 *
 * WHY THIS EXISTS
 * ---------------
 * TideCloak attributes a change-request authorization to the CALLER of the
 * endpoint, not to the subject of the doken in the body. So proxying the
 * approval through our server — which authenticates as the SkyCloak automation
 * client — records the *service account* as the signer:
 *
 *     authorizers: [{ username: "service-account-skycloak-automation-…" }]
 *
 * And because filing a change request auto-authorizes the filer, that identity
 * had already voted. Every subsequent human signature landed on an identity
 * that was already counted, so the tally sat at 1/2 no matter how many people
 * approved. The enclave signatures were real; they were being credited to a
 * robot.
 *
 * That is not a cosmetic bug. A service account that can both propose and
 * approve is one identity holding two of the votes it is supposed to be split
 * between — exactly the concentration the quorum exists to prevent.
 *
 * So: anything governed goes straight to TideCloak from the browser, signed by
 * the human's DPoP-bound token. The realm's CORS policy permits our origin and
 * allows the `DPoP` header, so this works without a proxy. Our server keeps
 * only the READS that a non-admin player also needs (watching the queue).
 */
import tcConfig from "../../data/tidecloak.json";

const BASE = String((tcConfig as any)["auth-server-url"] ?? "").replace(/\/+$/, "");
const REALM = String((tcConfig as any).realm ?? "");

export function adminUrl(path: string): string {
  if (!BASE || !REALM) {
    throw new Error("adapter JSON is missing auth-server-url or realm");
  }
  return `${BASE}/admin/realms/${REALM}${path}`;
}

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

async function call(f: Fetcher, path: string, init?: RequestInit) {
  const res = await f(adminUrl(path), init);
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* some endpoints return bare text */
  }
  return { ok: res.ok, status: res.status, json, text };
}

/* --------------------------------------------------------- change requests */

export const changeRequests = {
  /** The base64 request model the caller's enclave must sign. */
  approvalModel: (f: Fetcher, id: string) =>
    call(f, `/iga/change-requests/${id}/approval-model`),

  /** Submit this admin's signed doken. Attributed to whoever's token this is. */
  submitApproval: (f: Fetcher, id: string, requestModel: string) =>
    call(f, `/iga/change-requests/${id}/approval-model`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestModel }),
    }),

  commit: (f: Fetcher, id: string) =>
    call(f, `/iga/change-requests/${id}/commit`, { method: "POST" }),

  deny: (f: Fetcher, id: string) =>
    call(f, `/iga/change-requests/${id}/deny`, { method: "POST" }),
};

/* ----------------------------------------------------------------- roles */

export const roles = {
  get: (f: Fetcher, name: string) => call(f, `/roles/${encodeURIComponent(name)}`),

  holders: (f: Fetcher, name: string) =>
    call(f, `/roles/${encodeURIComponent(name)}/users?briefRepresentation=true&max=200`),

  userByName: (f: Fetcher, username: string) =>
    call(f, `/users?username=${encodeURIComponent(username)}&exact=true`),

  /** One role per request: two new roles in one body returns 409 and applies one. */
  grant: (f: Fetcher, userId: string, roleRep: unknown) =>
    call(f, `/users/${userId}/role-mappings/realm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([roleRep]),
    }),

  revoke: (f: Fetcher, userId: string, roleRep: unknown) =>
    call(f, `/users/${userId}/role-mappings/realm`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([roleRep]),
    }),
};
