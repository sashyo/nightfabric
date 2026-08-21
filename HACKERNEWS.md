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

Author here. This started as a three.js experiment and kind of got out of hand.

You play a runner in a neon city, and getting into most districts means actually
breaking in. Every gate has a different real vulnerability that you exploit in a
little in-game console, and the server checks the genuine attack instead of
playing a scripted "hacking" animation. One gate reads a JWT but never verifies
the signature, so you forge an alg:none token. Another stores its password as an
unsalted SHA-1 that you crack with a rainbow table. There's a SQL injection one,
an admin/admin one, a 4-digit keypad with no lockout that you just brute force,
and a couple more. NPCs wandering the streets leak the specific hint each gate
needs. It's basically a CTF with a plot, and you climb a leaderboard by breaking
things.

The reason I actually built it is the one district you can't get into. Same
tools, same console, but that gate runs on Tide (threshold cryptography), where
the signing key is never assembled anywhere in the first place, so there's
nothing to forge or steal. Every exploit that opens the other seven districts
does absolutely nothing here. The gate just glitches at you. I wanted people to
find that out by failing against it, rather than reading me assert "this part is
secure" on a slide. Inside that district it's a permanent festival where nobody
guards anything, because there's nothing to take, and every other quarter in the
game is jealous of it.

Practical bits: it's free, multiplayer, runs in the browser. The login is a real
threshold enclave (your password isn't stored, not even as a hash), and scores
are signed, so you can cheese the game but not your rank on the board.

Since HN has strong (and fair) feelings about this: I used an AI agent to stand
up the auth backend through the Tide MCP at mcp.tide.org/mcp, which walks you
through the threshold setup. I wrote this post myself.

Play: https://nightfabric.codesyo.com
Source: https://github.com/sashyo/nightfabric

If you find a way into the golden district, that's the bug report I actually want.
