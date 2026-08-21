import { issueUnsignedJWT } from "@/lib/legacy";

/**
 * OLD TOWN login. No enclave, no threshold anything. It takes a password over
 * the wire (which a real server would then have to store and could leak), and
 * hands back an UNSIGNED token with no DPoP binding.
 *
 * This is the "login that doesn't go through the Tide enclave" — and the token
 * it issues is the "token that can be stolen".
 */
export const POST = async (req: Request) => {
  const { username } = (await req.json().catch(() => ({}))) as any;
  const who = typeof username === "string" && username ? username.slice(0, 32) : "guest";
  // Password is ignored — that is the joke. There is nothing to verify against
  // because there is no secure store; anyone is "authenticated".
  const token = issueUnsignedJWT(who);
  return Response.json({
    token,
    warning:
      "This token has alg:none, no signature, and no DPoP binding. Decode it, change role to 'root', and send it back. Nothing will stop you.",
  });
};
