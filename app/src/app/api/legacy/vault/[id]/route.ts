import { vault, VAULT_COUNT } from "@/lib/challenges";
import { mintVaultFlag } from "@/lib/legacy";

/**
 * THE VAULT — 100 procedural crypto challenges (n = 0..99).
 *   GET  /api/legacy/vault/<n>            -> the challenge (ciphertext, brief, hints, points)
 *   POST /api/legacy/vault/<n> {answer}   -> verifies your recovered plaintext, drops a signed flag
 *
 * No auth here (it's the old stack). The flag you get is HMAC-signed and carries
 * its own point value, so you can't fake a claim on the Tide-secured board.
 */
function parseN(req: Request): number | null {
  const raw = decodeURIComponent(new URL(req.url).pathname.split("/").pop() || "");
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n >= VAULT_COUNT) return null;
  return n;
}

export const GET = async (req: Request) => {
  const n = parseN(req);
  if (n === null) return Response.json({ error: `Vault index must be 0..${VAULT_COUNT - 1}` }, { status: 404 });
  const c = vault(n);
  return Response.json({
    vault: n,
    total: VAULT_COUNT,
    category: c.category,
    title: c.title,
    points: c.points,
    brief: c.brief,
    data: c.data,
    hints: c.hints,
    submit: `POST /api/legacy/vault/${n} with { "answer": "<recovered plaintext>" }`,
  });
};

export const POST = async (req: Request) => {
  const n = parseN(req);
  if (n === null) return Response.json({ error: `Vault index must be 0..${VAULT_COUNT - 1}` }, { status: 404 });
  const c = vault(n);
  const b = (await req.json().catch(() => ({}))) as any;
  const answer = String(b.answer ?? "");
  if (c.verify(answer)) {
    return Response.json({
      ok: true,
      flag: mintVaultFlag(`VAULT-${n}`, c.points),
      points: c.points,
      result: `Vault ${n} (${c.title}) cracked. You recovered the plaintext by breaking the cipher. Claim the flag on the board.`,
    });
  }
  return Response.json({ ok: false, hint: "That's not the plaintext. Re-run the attack — check padding/whitespace and case." });
};
