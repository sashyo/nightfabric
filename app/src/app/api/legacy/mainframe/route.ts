import { readUnsignedJWT, mintFlag, issueUnsignedJWT } from "@/lib/legacy";

/**
 * The OLD TOWN mainframe. It "authorizes" by decoding the token and reading
 * `role` — with ZERO signature verification. So a client can rewrite the token
 * to `role: root` and walk in. This is the alg:none forgery, and the token also
 * has no DPoP, so a stolen copy works from anywhere (the replay flag).
 */
export const GET = async (req: Request) => {
  const auth = req.headers.get("authorization") || "";
  const token = auth.replace(/^Legacy\s+/i, "").trim();
  const claims = readUnsignedJWT(token);
  if (!claims) {
    return Response.json({ error: "No legacy token. GET a login first." }, { status: 401 });
  }

  // A token minted for a DIFFERENT client (no binding) still works → replay.
  const replayed = req.headers.get("x-replayed-from") ? true : false;

  if (claims.role === "root") {
    return Response.json({
      granted: true,
      flag: mintFlag("FLAG-ALGNONE"),
      replayFlag: replayed ? mintFlag("FLAG-REPLAY") : null,
      loot: "MAINFRAME ROOT — you rewrote an unsigned token and it believed you.",
    });
  }
  return Response.json({
    granted: false,
    yourRole: claims.role,
    hint: "You are 'guest'. The token is alg:none with no signature — decode it, set role to 'root', re-encode, send it back.",
    // Hand them a fresh guest token to tamper with, for convenience.
    sampleToken: issueUnsignedJWT(String(claims.sub || "guest")),
  });
};
