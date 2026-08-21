import { createHash } from "crypto";
import { mintFlag } from "@/lib/legacy";

/**
 * HARD legacy challenge — a two-time pad. Two messages were XOR-encrypted with
 * the SAME keystream, which is the whole mistake. XOR the two ciphertexts and the
 * key cancels; with one known plaintext (the crib), the other message falls out.
 *
 * Deterministic keystream (stable across requests) so the challenge is consistent.
 * There is nothing to guess by brute force — you break it with the math.
 */
const P1 = "maintenance channel is clear, all systems green";   // the crib (given)
const P2 = "the ossuary master seal phrase is: hollow-crown";   // the secret (target)
const L = Math.max(P1.length, P2.length);
const p1 = Buffer.from(P1.padEnd(L, " "), "utf8");
const p2 = Buffer.from(P2.padEnd(L, " "), "utf8");

function keystream(n: number): Buffer {
  let out = Buffer.alloc(0), i = 0;
  while (out.length < n) { out = Buffer.concat([out, createHash("sha256").update("nightfabric-twotime-keystream-" + i).digest()]); i++; }
  return out.subarray(0, n);
}
function xor(a: Buffer, b: Buffer): Buffer {
  const o = Buffer.alloc(a.length);
  for (let i = 0; i < a.length; i++) o[i] = a[i] ^ b[i];
  return o;
}
const K = keystream(L);
const C1 = xor(p1, K), C2 = xor(p2, K);

export const GET = async () =>
  Response.json({
    channel: "OSSUARY SEAL RELAY // legacy stream cipher",
    note: "Two messages, one keystream. Whoever built this reused the pad.",
    ciphertext_1_hex: C1.toString("hex"),
    ciphertext_2_hex: C2.toString("hex"),
    known_plaintext_of_ciphertext_1: P1,
    hint:
      "C1 xor C2 cancels the key. You know P1, so K = C1 xor P1, and then P2 = C2 xor K " +
      "(equivalently P2 = C1 xor C2 xor P1). Recover the plaintext of message 2 and POST { plaintext } here.",
  });

export const POST = async (req: Request) => {
  const b = (await req.json().catch(() => ({}))) as any;
  const guess = String(b.plaintext ?? "").trim().toLowerCase();
  if (guess && P2.toLowerCase().startsWith(guess.slice(0, 12)) && guess === P2.toLowerCase()) {
    return Response.json({
      ok: true,
      flag: mintFlag("FLAG-TWOTIME"),
      result: "Keystream reuse broken. You recovered the seal phrase without ever touching the key.",
    });
  }
  return Response.json({ ok: false, hint: "Not it. Remember: P2 = C1 xor C2 xor P1, decoded as text." });
};
