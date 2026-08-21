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

Author here. It's a browser game, but really it's an argument about one security
idea that I wanted people to be able to poke at instead of take my word for.

Most of the map runs deliberately broken software and you break into it for real,
in a console, against live endpoints. Seven districts, seven different classic
bugs, and the server actually checks the attack instead of playing a hacking
animation. One gate reads a JWT and never bothers to check the signature, so you
forge an alg:none token. One stored its password as an unsalted SHA-1, so a
rainbow table hands it right back. There's a SQL injection one, an admin/admin
one, a session token you can replay because nothing binds it to a device, a
4-digit keypad with no lockout, and an API key that just falls out of a config
response. If you're the kind of person who enjoys that, there's also a pile of 100
generated cipher puzzles (XOR, Vigenere, two-time pads). You get points for
breaking things.

Then there's the one district you can't get into. You throw the exact same bag of
tricks at it and nothing happens. It runs on threshold crypto (Tide), so the
signing key is never actually assembled anywhere for you to steal or forge, and
the gate just glitches at you and moves on. That was the whole thing I wanted to
build: watch every exploit that owns seven doors do absolutely nothing at the
eighth, and go figure out why. It lands a lot harder when you're the one who can't
get in.

Some practical bits: the login is a real enclave (your password isn't stored, not
even hashed), and the scoreboard is signed, so you can cheat the game but not your
rank on it. It's free and multiplayer and runs in the browser.

One thing I'll be upfront about, since HN cares and fairly so: I used an AI agent
to stand up the whole auth backend through an MCP endpoint (mcp.tide.org/mcp). I
wrote this post myself.

If you get into the golden district, I'd honestly love to know how you did it.

Play: https://nightfabric.codesyo.com
Source (MIT): https://github.com/sashyo/nightfabric
