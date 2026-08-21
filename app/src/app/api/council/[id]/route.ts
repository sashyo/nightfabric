import { withAuth } from "@/lib/auth/middleware";
import { hasRole } from "@/lib/auth/tideJWT";
import { adminFetch } from "@/lib/adminApi";

/**
 * One change request: fetch its enclave challenge, submit a signed approval,
 * or try to commit it.
 *
 * GET  -> the base64 request model the council member's enclave must sign
 * POST -> submit that member's signed doken   (body: { requestModel })
 * PUT  -> attempt commit; 412 while under quorum
 *
 * There is no fourth verb that skips to the end. A server-side "approve"
 * exists in the API surface but in Tide MultiAdmin mode it cannot produce the
 * threshold signature — only the browser enclave can.
 */

function idFrom(req: Request) {
  return decodeURIComponent(new URL(req.url).pathname.split("/").pop() ?? "");
}

const councilOnly = (jwt: any) =>
  hasRole(jwt, "tide-realm-admin")
    ? null
    : Response.json({ error: "Council members only." }, { status: 403 });

export const GET = withAuth(async (req, jwt) => {
  const no = councilOnly(jwt);
  if (no) return no;
  const res = await adminFetch(`/iga/change-requests/${idFrom(req)}/approval-model`);
  const text = await res.text();
  if (!res.ok) return Response.json({ error: text || res.statusText }, { status: res.status });
  return new Response(text, { headers: { "Content-Type": "application/json" } });
});

export const POST = withAuth(async (req, jwt) => {
  const no = councilOnly(jwt);
  if (no) return no;
  const body = await req.json().catch(() => null);
  if (typeof body?.requestModel !== "string") {
    return Response.json({ error: "requestModel (base64) required" }, { status: 400 });
  }
  const res = await adminFetch(`/iga/change-requests/${idFrom(req)}/approval-model`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requestModel: body.requestModel }),
  });
  const text = await res.text();
  if (!res.ok) return Response.json({ error: text || res.statusText }, { status: res.status });
  // Response carries { recorded, authCount, threshold } — the running tally.
  return new Response(text, { headers: { "Content-Type": "application/json" } });
});

export const PUT = withAuth(async (req, jwt) => {
  const no = councilOnly(jwt);
  if (no) return no;
  const res = await adminFetch(`/iga/change-requests/${idFrom(req)}/commit`, { method: "POST" });
  const text = await res.text();
  if (res.status === 412) {
    return Response.json(
      {
        committed: false,
        under_quorum: true,
        message: "412 — still under quorum. The Fabric will not seal it yet.",
      },
      { status: 412 },
    );
  }
  if (!res.ok) return Response.json({ error: text || res.statusText }, { status: res.status });
  return Response.json({ committed: true, raw: text.slice(0, 400) });
});
