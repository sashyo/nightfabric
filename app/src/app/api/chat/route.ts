import { withAuth } from "@/lib/auth/middleware";
import { say, since } from "@/lib/chat";

function identity(jwt: any) {
  return {
    vuid: (jwt.vuid as string) || (jwt.sub as string),
    handle: (jwt.handle as string) || (jwt.preferred_username as string) || "runner",
    roles: (((jwt.realm_access as any)?.roles ?? []) as string[]).filter(
      (r) => !r.startsWith("_tide_") && !r.startsWith("default-roles"),
    ),
  };
}

/** Send. The body carries text; who said it comes from the doken. */
export const POST = withAuth(async (req, jwt) => {
  const body = await req.json().catch(() => ({}));
  const res = say(identity(jwt), (body as any)?.text);
  if (!res.ok) return Response.json({ error: res.error }, { status: 400 });
  return Response.json({ sent: true, line: res.line });
});

/** Backfill for a client that just joined. */
export const GET = withAuth(async (req) => {
  const n = Number(req.nextUrl.searchParams.get("since") ?? 0);
  return Response.json({ lines: since(n) });
});
