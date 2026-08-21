# Hacker News submission

Post as a **Show HN**: title in the title box, the play URL in the URL box, then
add the comment below as the first reply for context.

(Written to read like a person, not a model — no em-dash sprinkles, no
"not X, but Y", no rule-of-three cadence, no punchy one-line fragments.)

---

## Title

Show HN: A cyberpunk game where the hacks are real (except one district)

## URL

https://nightfabric.codesyo.com

---

## First comment (paste right after posting)

Author here. The short version: it's a browser game that's really a playable
argument about one security idea, and I'd like you to try to break it.

Most of the map runs what the game calls the old stack, and you break into it for
real. Seven districts, seven classic bugs, each verified server-side rather than
faked with an animation. One gate reads a JWT and never checks the signature
(forge alg:none). One stores its password as an unsalted SHA-1 you crack with a
rainbow table. There's a SQLi gate, an admin/admin gate, a replayed session token
with no DPoP binding, a 4-digit keypad with no lockout, and an API key that leaks
out of a config response. For the crypto crowd there's also a vault of 100
generated ciphers (single-byte and repeating-key XOR, Vigenere, two-time pads).
You climb a leaderboard by breaking things.

Then there's one district you cannot get into. Same tools, same console. It runs
on threshold cryptography (Tide), where the signing key is never assembled
anywhere, so there is nothing to forge or steal, and every exploit that opens the
other seven does literally nothing. The gate just glitches at you. The whole game
is that one contrast: the same bag of tricks that owns seven doors dying at the
eighth. I wanted people to learn that by failing against it, not by reading me
claim it on a slide.

The login is a real threshold enclave (your password is not stored, not even
hashed), and the leaderboard is signed, so you can cheese the game but not your
rank. Free, multiplayer, in the browser.

Fair warning since HN (rightly) cares: I used an AI agent to stand up the auth
backend through the Tide MCP at mcp.tide.org/mcp, but I wrote this myself.

Come break the golden district. If you get in, that's the bug report I actually
want.

Play: https://nightfabric.codesyo.com
Source: https://github.com/sashyo/nightfabric (MIT)
