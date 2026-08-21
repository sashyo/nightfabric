import { withAuth } from "@/lib/auth/middleware";
import { verifyAnyFlag } from "@/lib/legacy";
import { mutate } from "@/lib/store";

/**
 * Claim an Old Town flag for points.
 *
 * The challenge that produced the flag was insecure — but claiming it is NOT.
 * This route runs under withAuth (verified doken + DPoP), the flag is HMAC-signed
 * so a made-up string earns nothing, and each flag scores once per player. You
 * can forge an Old Town token all day; you cannot forge your place on the board.
 */
export const POST = withAuth(async (req, jwt) => {
  const vuid = (jwt.vuid as string) || (jwt.sub as string);
  const handle = (jwt.handle as string) || (jwt.preferred_username as string) || "runner";

  const body = (await req.json().catch(() => ({}))) as any;
  const flagToken = body.flag;
  const hints = Math.max(0, Math.min(9, Number(body.hints) || 0));
  const solution = body.solution === true;
  const v = verifyAnyFlag(String(flagToken || ""));
  if (!v) {
    return Response.json(
      { error: "That flag is not valid. Old Town is insecure — the scoreboard is not." },
      { status: 400 },
    );
  }
  const flag = v.key;

  return Response.json(
    mutate((s) => {
      const row =
        s.scores[vuid] ??
        (s.scores[vuid] = { vuid, handle, points: 0, flags: [], districts: [], at: Date.now() });
      row.handle = handle;
      if (row.flags.includes(flag)) {
        return { already: true, points: row.points, flag, awarded: 0 };
      }
      // Penalties stack: −10 per hint, −10 if you used the map. But revealing the
      // full SOLUTION means you gave up — you get exactly 1 point. Solve it cold
      // to keep it all.
      const base = v.points;
      const mapped = row.usedMap === true;
      const hintPenalty = hints * 10;
      const mapPenalty = mapped ? 10 : 0;
      const pts = solution ? 1 : Math.max(1, base - hintPenalty - mapPenalty);
      row.flags.push(flag);
      row.points += pts;
      row.at = Date.now();
      return {
        claimed: true,
        flag,
        awarded: pts,
        base,
        hintPenalty,
        mapPenalty,
        solution,
        points: row.points,
        lesson: v.lesson,
      };
    }),
  );
});
