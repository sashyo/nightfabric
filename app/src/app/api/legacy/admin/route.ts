import { LEAKED_API_KEY, mintFlag } from "@/lib/legacy";

/**
 * OLD TOWN admin action. Guarded only by the leaked API key — one request, one
 * secret, no quorum, no second signer. Contrast with the BLACKWALL PROTOCOL,
 * which cannot fire without a council quorum. This is "authorization not secured
 * by quorum": whoever holds the key holds all of it, alone.
 */
export const POST = async (req: Request) => {
  const key = req.headers.get("x-api-key") || "";
  if (key !== LEAKED_API_KEY) {
    return Response.json(
      { error: "Need the ADMIN_API_KEY. It is leaking from /api/legacy/config." },
      { status: 403 },
    );
  }
  return Response.json({
    executed: true,
    flag: mintFlag("FLAG-NO-QUORUM"),
    loot: "You wiped the OLD TOWN mainframe by yourself. One key. No one had to co-sign.",
  });
};
