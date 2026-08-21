import { withAuth } from "@/lib/auth/middleware";
import { snapshot } from "@/lib/store";

/** The leaderboard. Reading is open to any authenticated runner. */
export const GET = withAuth(async (_req, jwt) => {
  const me = (jwt.vuid as string) || (jwt.sub as string);
  const rows = Object.values(snapshot().scores)
    .sort((a, b) => b.points - a.points)
    .slice(0, 20)
    .map((r, i) => ({
      rank: i + 1,
      handle: r.handle,
      points: r.points,
      flags: r.flags.length,
      districts: r.districts.length,
      you: r.vuid === me,
    }));
  const mine = snapshot().scores[me]?.points ?? 0;
  return Response.json({ board: rows, mine });
});
