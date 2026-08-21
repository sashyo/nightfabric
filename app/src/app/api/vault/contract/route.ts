import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { withAuth } from "@/lib/auth/middleware";

/**
 * The crew-vault contract source, served verbatim.
 *
 * The ORKs identify a contract by the SHA-512 of its EXACT source bytes, and
 * they compare case-sensitively. So this route must hand back the same bytes
 * that were uploaded — not a re-indented, re-encoded or trimmed copy. Anything
 * that rewrites whitespace here produces a contractId mismatch that surfaces
 * much later as "Policy refers to wrong contract".
 */
const CANDIDATES = [
  join(process.cwd(), "..", "forseti", "CrewVaultContract.cs"),
  join(process.cwd(), "data", "CrewVaultContract.cs"),
];

export const GET = withAuth(async () => {
  const path = CANDIDATES.find((p) => existsSync(p));
  if (!path) {
    return Response.json({ error: "CrewVaultContract.cs not found" }, { status: 500 });
  }
  return Response.json({ source: readFileSync(path, "utf-8"), path });
});
