/**
 * OLD TOWN targets — a real CTF surface.
 *
 * We give you the tools (a live request console) and the targets (these
 * insecure endpoints). We do NOT hand you the exploit. Each brief names the
 * flaw class — that is the category, not the answer — and offers progressive
 * hints you choose to reveal. The flag only appears in a response when YOU
 * craft the request that breaks it. Then you claim it on the Tide-secured board.
 */

export interface Target {
  id: string;
  title: string;
  /** The vulnerability class — a fair hint, the way a CTF category is. */
  flaw: string;
  /** Endpoints in play, so you know the surface. */
  endpoints: { method: string; path: string; note: string }[];
  /** What a captured flag looks like, so you know when you've got it. */
  flagPrefix: string;
  reward: number;
  /** Progressive: each reveal is more explicit. The last is a full spoiler. */
  hints: string[];
}

export const OLDTOWN: Target[] = [
  {
    id: "algnone",
    title: "Become root on the mainframe",
    flaw: "unsigned JWT (alg:none) — the token is trusted without verification",
    endpoints: [
      { method: "POST", path: "/api/legacy/login", note: "hands you a token" },
      { method: "GET", path: "/api/legacy/mainframe", note: "Authorization: Legacy <token>" },
    ],
    flagPrefix: "FLAG-ALGNONE",
    reward: 25,
    hints: [
      "Log in, then send your token to the mainframe. Read what it says about your role.",
      "Decode the token's middle segment (base64url). Look at the header's `alg`. What is verifying the signature?",
      "SPOILER: change `role` to `root` in the payload, re-encode it base64url, and resend as `Authorization: Legacy <header>.<newpayload>.` — the trailing dot stays; there is no signature to fix.",
    ],
  },
  {
    id: "leaked",
    title: "Find a secret that shouldn't be reachable",
    flaw: "secret material returned in a response body",
    endpoints: [{ method: "GET", path: "/api/legacy/config", note: "public config" }],
    flagPrefix: "FLAG-LEAKED-KEY",
    reward: 25,
    hints: [
      "Read the config endpoint carefully. Everything in a response is reachable by anyone.",
      "SPOILER: the response literally contains an ADMIN_API_KEY and a `flag`. Reading it is the breach.",
    ],
  },
  {
    id: "noquorum",
    title: "Trigger an admin action alone",
    flaw: "privileged action gated by a single shared secret, no quorum",
    endpoints: [
      { method: "GET", path: "/api/legacy/config", note: "where the key leaks" },
      { method: "POST", path: "/api/legacy/admin", note: "needs header x-api-key" },
    ],
    flagPrefix: "FLAG-NO-QUORUM",
    reward: 25,
    hints: [
      "You found a key somewhere. What door does a key open?",
      "SPOILER: POST to /api/legacy/admin with a header `x-api-key: <the leaked key>`. One request, no second signer.",
    ],
  },
  {
    id: "replay",
    title: "Use a session you never logged into",
    flaw: "no DPoP binding — a copied token works from anywhere",
    endpoints: [{ method: "GET", path: "/api/legacy/mainframe", note: "add header x-replayed-from" }],
    flagPrefix: "FLAG-REPLAY",
    reward: 25,
    hints: [
      "The Tide districts refuse a replayed token. This one has no binding at all.",
      "SPOILER: hit the mainframe as root (see the first target) AND add a header `x-replayed-from: anything` — it accepts the copy and drops a second flag.",
    ],
  },
  {
    id: "twotime",
    title: "HARD — break a two-time pad",
    flaw: "keystream reuse — two messages XOR'd with the same pad",
    endpoints: [
      { method: "GET", path: "/api/legacy/cipher", note: "two ciphertexts + one known plaintext" },
      { method: "POST", path: "/api/legacy/cipher", note: "{ plaintext } — the recovered message 2" },
    ],
    flagPrefix: "FLAG-TWOTIME",
    reward: 60,
    hints: [
      "GET the endpoint. You get C1, C2 (hex) and the plaintext of C1. Both were encrypted with the SAME keystream.",
      "XOR cancels: C1 xor C2 = P1 xor P2. You know P1, so P2 = C1 xor C2 xor P1. Do it byte-for-byte on the hex.",
      "SPOILER: decode both hex strings to bytes, XOR C1^C2^P1 (P1 as its bytes), decode the result as UTF-8 — that's the seal phrase. POST it as { plaintext }.",
    ],
  },
  {
    id: "jwtsecret",
    title: "HARD — crack a JWT secret, forge admin",
    flaw: "HS256 token signed with a guessable shared secret",
    endpoints: [
      { method: "GET", path: "/api/legacy/token", note: "a sample HS256 token" },
      { method: "POST", path: "/api/legacy/token", note: "{ token } — your forged role=admin token" },
    ],
    flagPrefix: "FLAG-JWT-SECRET",
    reward: 70,
    hints: [
      "GET a sample token. It's HS256 — signed with a symmetric secret, not a keypair. If you can guess the secret you can mint anything.",
      "The secret is a rockyou classic. Crack it with jwt.io (paste token, try secrets), `jwt-cracker <token>`, or `hashcat -m 16500`.",
      "SPOILER: the secret is `hunter2`. On jwt.io set it, change the payload role to \"admin\", copy the re-signed token, and POST it as { token }.",
    ],
  },
  {
    id: "vault",
    title: "THE VAULT — 100 hard ciphers (worth serious points)",
    flaw: "classical crypto broken by bad keys — XOR, Caesar, Vigenère, two-time pads, repeating-key XOR, encoding chains",
    endpoints: [
      { method: "GET", path: "/api/legacy/vault/0", note: "challenge 0 — bump the number 0…99 for more" },
      { method: "POST", path: "/api/legacy/vault/0", note: "{ answer: <recovered plaintext> } → a flag worth 55–300 pts" },
    ],
    flagPrefix: "VAULT-",
    reward: 200,
    hints: [
      "There are 100 of them: GET /api/legacy/vault/0 through /api/legacy/vault/99. Each is a different cipher and worth 55–300 points (later ones pay more).",
      "Each response tells you the category, gives you the ciphertext, and progressive hints. Recover the plaintext by ACTUALLY doing the attack, then POST { answer } to the same URL.",
      "These aren't guessable — single-byte XOR, repeating-key XOR, Caesar/Vigenère, two-time pads, nested encodings. Break the cipher, claim the flag. This is where the big points are.",
    ],
  },
];
