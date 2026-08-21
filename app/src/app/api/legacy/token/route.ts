import { createHmac } from "crypto";
import { mintFlag } from "@/lib/legacy";

/**
 * HARD legacy challenge — a JWT signed with HMAC-SHA256 and a WEAK secret.
 * The token is symmetric, so whoever can guess the signing secret can mint any
 * token they like. Crack the secret offline (it's in every wordlist), then
 * re-sign a token with role=admin and the mainframe trusts it completely.
 *
 * This is the RS256-vs-HS256 lesson's cousin: a shared signing secret is just a
 * password, and Tide's threshold EdDSA doken has no such secret to steal.
 */
const SECRET = "hunter2"; // weak HMAC secret — rockyou classic
const b64u = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
function signHS256(header: object, payload: object, secret: string): string {
  const data = `${b64u(header)}.${b64u(payload)}`;
  const sig = createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${sig}`;
}
const sample = signHS256({ alg: "HS256", typ: "JWT" }, { sub: "u-1041", role: "guest", iss: "oldtown-mainframe" }, SECRET);

export const GET = async () =>
  Response.json({
    api: "MAINFRAME TOKEN SERVICE // legacy",
    your_token: sample,
    algo: "HS256 (HMAC-SHA256, symmetric shared secret)",
    hint:
      "The signing secret is a common word. Crack it offline (jwt.io, hashcat -m 16500, or jwt-cracker), " +
      "then forge a token with role set to \"admin\", signed with the SAME secret, and POST { token } here.",
  });

export const POST = async (req: Request) => {
  const b = (await req.json().catch(() => ({}))) as any;
  const token = String(b.token ?? "");
  const parts = token.split(".");
  if (parts.length !== 3) return Response.json({ ok: false, hint: "Send a full JWT: header.payload.signature" });
  const [h, p, sig] = parts;
  const expect = createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url");
  if (sig !== expect) return Response.json({ ok: false, hint: "Signature does not verify with the real secret. Crack the secret first, then sign with it." });
  let payload: any;
  try { payload = JSON.parse(Buffer.from(p, "base64url").toString("utf8")); } catch { return Response.json({ ok: false, hint: "Payload is not valid JSON." }); }
  if (payload.role !== "admin") return Response.json({ ok: false, hint: "Signature verifies! Now set role to \"admin\" in the payload and re-sign with the same secret." });
  return Response.json({
    ok: true,
    flag: mintFlag("FLAG-JWT-SECRET"),
    result: "Forged an admin token with the cracked secret. The mainframe accepts it without question.",
  });
};
