import { createHash } from "crypto";

/**
 * THE VAULT — 100 procedurally-generated, genuinely-hard crypto challenges.
 *
 * Each challenge n is deterministic (derived from a hash of n, so it's stable
 * across requests and identical for everyone) and recovers a secret plaintext
 * PHRASE by an actual cryptanalytic attack — single-byte XOR, Caesar, repeating-
 * key XOR, base-encoding chains, Vigenère, binary, two-time pads. The server
 * verifies the recovered plaintext, so there's nothing to guess: you break it
 * with the math or you don't get in.
 *
 * These are the "old stack" at its most brittle. The point the whole game makes:
 * every one of these is a key or a keystream someone reused or chose badly. The
 * golden Vault Core has no key to attack at all.
 */

const PHRASES = [
  "the fold took the north tower first",
  "twenty shards and not one whole key",
  "meet me under the blackwall relay",
  "the ossuary never forgets a name",
  "sable sells jacks she has already cloned",
  "the drown pump code rusted years ago",
  "kowloon has more floors than the ledger",
  "the architect left no seat behind her",
  "chrome clinic bills for what it cannot read",
  "rust quarter runs on a factory login",
  "the concierge token rides the wire naked",
  "quorum or nothing said the herald",
  "no admin holds the master key here",
  "the festival never ends in the core",
  "she split the key across twenty nodes",
  "a stolen bearer is a stolen session",
  "threshold fourteen or the seal stays shut",
  "the wire remembers every failed hack",
  "nobody wears your face in the vault core",
  "the corps left the streets and the keys",
  "old vaughn keeps a cabinet he cannot open",
  "the pilgrim has waited nine years at the gate",
  "brute the keypad it never locks out",
  "hunter2 was never a good secret",
  "config leaked the master key again",
  "the mainframe trusts an unsigned token",
  "your doken is signed by five orks",
  "the golden gate only takes quorum",
  "morrow lost it all to one legit login",
  "the ork network never sees a whole key",
];

function h(seed: string): Buffer {
  return createHash("sha256").update(seed).digest();
}
function toHex(b: Buffer) { return b.toString("hex"); }

const CATS = ["xor1", "caesar", "xorK", "basechain", "revcaesar", "vigenere", "binary", "twotime"] as const;
const BASE_PTS: Record<string, number> = {
  xor1: 60, caesar: 55, xorK: 150, basechain: 70, revcaesar: 85, vigenere: 130, binary: 70, twotime: 110,
};
const TITLES: Record<string, string> = {
  xor1: "Single-byte XOR", caesar: "Caesar shift", xorK: "Repeating-key XOR (Vigenère on bytes)",
  basechain: "Nested encodings", revcaesar: "Reversed + shifted", vigenere: "Vigenère cipher",
  binary: "Binary ASCII", twotime: "Two-time pad (keystream reuse)",
};

const shiftLetter = (c: string, s: number) => {
  const code = c.charCodeAt(0);
  if (code >= 97 && code <= 122) return String.fromCharCode(((code - 97 + s) % 26) + 97);
  return c;
};
const caesar = (txt: string, s: number) => txt.split("").map((c) => shiftLetter(c, s)).join("");
const vigenere = (txt: string, key: string) => {
  let ki = 0;
  return txt.split("").map((c) => {
    if (c >= "a" && c <= "z") { const s = key.charCodeAt(ki % key.length) - 97; ki++; return shiftLetter(c, s); }
    return c;
  }).join("");
};
const xorBuf = (a: Buffer, key: Buffer) => {
  const o = Buffer.alloc(a.length);
  for (let i = 0; i < a.length; i++) o[i] = a[i] ^ key[i % key.length];
  return o;
};

const VIG_KEYS = ["neon", "dusk", "void", "gold", "rust", "orks", "tide", "fold"];

export interface Vault {
  n: number; category: string; title: string; points: number;
  brief: string; data: Record<string, any>; hints: string[];
  verify: (answer: string) => boolean;
}

/** Deterministic challenge n (0..99). */
export function vault(n: number): Vault {
  const secret = PHRASES[n % PHRASES.length];
  const cat = CATS[n % CATS.length];
  const points = Math.min(300, BASE_PTS[cat] + Math.floor(n / 8) * 8);
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  const ok = (ans: string) => norm(ans) === norm(secret);

  let brief = "", data: Record<string, any> = {}, hints: string[] = [];

  switch (cat) {
    case "xor1": {
      const key = Buffer.from([(h("xor1:" + n)[0] % 254) + 1]);
      data = { ciphertext_hex: toHex(xorBuf(Buffer.from(secret, "utf8"), key)) };
      brief = "The plaintext was XOR'd with a single repeating byte. Try all 256 keys and keep the one that decodes to readable text.";
      hints = ["Convert the hex to bytes. XOR every byte with the same guess key k (0..255).", "The right k gives printable ASCII across the whole message.", "SPOILER: it's a phrase in plain English — score it by how many bytes land in a-z/space."];
      break;
    }
    case "caesar": {
      const s = (h("cae:" + n)[0] % 25) + 1;
      data = { ciphertext: caesar(secret, s) };
      brief = "A Caesar shift of the alphabet. Find the shift (1-25) that turns this back into English.";
      hints = ["Only a-z were rotated; spaces stayed.", "Try all 25 shifts, or use letter frequency.", `SPOILER: the shift is ${s}. Rotate each letter back by ${s}.`];
      break;
    }
    case "xorK": {
      const kl = 3 + (h("xk:" + n)[1] % 3); // 3..5
      const key = h("xk:" + n).subarray(0, kl);
      data = { ciphertext_hex: toHex(xorBuf(Buffer.from(secret, "utf8"), key)), key_length: kl };
      brief = `Repeating-key XOR with a ${kl}-byte key. Recover the key (the length is given), then decrypt.`;
      hints = ["Split the ciphertext into columns by position mod key_length.", "Each column is single-byte XOR — solve each column independently.", "SPOILER: for each column, brute the byte that makes that column printable, assemble the key, XOR the whole thing."];
      break;
    }
    case "basechain": {
      const inner = Buffer.from(secret, "utf8").toString("hex");
      const outer = Buffer.from(inner, "utf8").toString("base64");
      data = { blob: outer };
      brief = "Two layers of encoding, no encryption. Peel them off.";
      hints = ["The outer layer is base64. Decode it.", "What you get is hex. Decode that to bytes.", "SPOILER: atob the blob, then hex-decode the result to UTF-8 text."];
      break;
    }
    case "revcaesar": {
      const s = (h("rc:" + n)[0] % 25) + 1;
      data = { ciphertext: caesar(secret.split("").reverse().join(""), s) };
      brief = "The message was reversed, then Caesar-shifted. Undo both.";
      hints = ["Two steps were applied. Undo them in the opposite order.", "First un-shift the Caesar, then reverse the string.", `SPOILER: shift is ${s}. Rotate letters back by ${s}, then reverse the whole string.`];
      break;
    }
    case "vigenere": {
      const key = VIG_KEYS[h("vg:" + n)[0] % VIG_KEYS.length];
      data = { ciphertext: vigenere(secret, key), key_length: key.length };
      brief = `Vigenère cipher (a-z only). The key is a short lowercase word; its length is given. Recover the plaintext.`;
      hints = ["Every key_length-th letter shares the same Caesar shift.", "Solve each of the key_length shifts with frequency analysis, or guess the key word.", `SPOILER: the key is "${key}". Subtract it (mod 26) from the letters.`];
      break;
    }
    case "binary": {
      data = { bits: Buffer.from(secret, "utf8").toString("binary").split("").map((c) => c.charCodeAt(0).toString(2).padStart(8, "0")).join(" ") };
      brief = "8-bit ASCII in binary, space-separated. Decode it.";
      hints = ["Each group of 8 bits is one character.", "Convert each byte to decimal, then to its ASCII character.", "SPOILER: parseInt(group, 2) for each group, then String.fromCharCode."];
      break;
    }
    case "twotime": {
      const crib = "system status nominal all relays green and holding steady now";
      const L = Math.max(crib.length, secret.length);
      const p1 = Buffer.from(crib.padEnd(L, " "), "utf8");
      const p2 = Buffer.from(secret.padEnd(L, " "), "utf8");
      let ks = Buffer.alloc(0), i = 0;
      while (ks.length < L) { ks = Buffer.concat([ks, h("tt:" + n + ":" + i)]); i++; }
      ks = ks.subarray(0, L);
      data = { ciphertext_1_hex: toHex(xorBuf(p1, ks)), ciphertext_2_hex: toHex(xorBuf(p2, ks)), known_plaintext_of_1: crib };
      brief = "Two messages, ONE keystream (a two-time pad). You're given C1, C2 and the plaintext of C1. Recover message 2.";
      hints = ["C1 xor C2 = P1 xor P2. You know P1.", "So P2 = C1 xor C2 xor P1 (byte-for-byte, then decode as text).", "SPOILER: decode both hex to bytes, XOR them together, XOR with P1's bytes, read the UTF-8. Trailing spaces are padding."];
      break;
    }
  }

  return { n, category: cat, title: TITLES[cat], points, brief, data, hints, verify: ok };
}

export const VAULT_COUNT = 100;
