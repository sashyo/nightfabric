import { LEAKED_API_KEY, mintFlag } from "@/lib/legacy";

/**
 * OLD TOWN "public config". It leaks the master API key straight into the
 * response body — the "secrets left in the open" flaw. In a real app this is a
 * misconfigured /config, a source-mapped bundle, or a debug endpoint.
 */
export const GET = async () => {
  return Response.json({
    app: "oldtown-mainframe",
    version: "1.0.4",
    theme: "amber",
    // ← this should absolutely not be here.
    ADMIN_API_KEY: LEAKED_API_KEY,
    flag: mintFlag("FLAG-LEAKED-KEY"),
    note: "Finding this key in a response IS the breach. Take it to POST /api/legacy/admin — no quorum, no second signer.",
  });
};
