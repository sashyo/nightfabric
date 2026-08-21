# NIGHTFABRIC // Sanctum-9

A cyberpunk open-world browser game where you break into most districts with **real** exploits, and one district you can't, because it runs on threshold cryptography (Tide) and has no key to steal.

**Play:** https://nightfabric.codesyo.com
**Devlog:** https://nightfabric.codesyo.com/blog
**Built on Tide:** https://tide.org

![secured by tide](https://img.shields.io/badge/secured%20by-Tide-00e5ff)

---

## What it is

You're a runner in Sanctum-9. Getting into most districts means actually breaking in. Each gate has its own vulnerability, and you exploit it in an in-game console while the **server verifies the genuine attack** (nothing is a scripted animation).

| District | Real exploit |
|---|---|
| Blackwall | forge an `alg:none` JWT (the gate never checks the signature) |
| Chrome Clinic | crack an unsalted SHA-1 with a rainbow table |
| Little Kowloon | SQL injection: `' OR '1'='1' --` |
| Rust Quarter | default credentials (`admin / admin`) |
| Kaishin Spire | replay a session token sniffed off the wire (no DPoP binding) |
| The Drown | brute-force a 4-digit keypad with no lockout |
| Ossuary Row | use a master API key leaked in a config response |

Plus **The Vault**: 100 procedurally generated, genuinely hard cipher challenges (single-byte and repeating-key XOR, Caesar, Vigenère, two-time pads, encoding chains) worth serious points. Recon drones in the streets leak the secrets each gate needs.

### The one you can't hack

The golden **Vault Core** runs on [Tide](https://tide.org) threshold cryptography. The signing key is never assembled anywhere, so there is nothing to forge or steal. Every exploit that opens the other seven districts does nothing here; the gate just glitches. Behind it is a grand festival where nobody guards anything, and every other district dreams of getting in. You can only be **raised** into it by a council quorum, never hack your way in.

The scoreboard is signed too, so you can cheat the game but not your rank. And if you can't win, you can rally a council quorum and detonate the **Blackwall Protocol** to nuke the whole leaderboard to zero, which no single admin could ever do alone.

## How it's built

- **Frontend:** Next.js + React + three.js, procedural WebAudio (a hard-techno soundtrack), no external assets.
- **Auth:** real [TideCloak](https://tide.org) threshold auth. The login is a genuine enclave; your password is checked by a quorum of ORK nodes that never learn it. Tokens are EdDSA threshold-signed dokens, sender-bound with DPoP.
- **The insecure "old stack"** (`app/src/app/api/legacy/*`, `app/src/lib/legacy.ts`, `app/src/lib/challenges.ts`) is deliberately, textbook broken so you can exploit it. It never touches Tide.

The whole Tide backend was scaffolded with an AI agent pointed at the **Tide MCP** (`mcp.tide.org/mcp`). If you want to build your own Tide-secured app, connect your agent's MCP client to it.

## Run it locally

```bash
# 1) provision a realm (SkyCloak or self-hosted) — see scripts/
bash scripts/init-nightfabric.sh          # phase 1: realm, roles, invites
#    ... complete the enclave account setup + Forseti signing (browser) ...
bash scripts/seat-council.sh              # phase 3: grant admin, flip to quorum

# 2) the app
cd app
cp data/tidecloak.example.json data/tidecloak.json   # or let the bootstrap write the real one
npm install
npm run build && npm start                # http://localhost:3000
```

The bootstrap writes a real `app/data/tidecloak.json` and `app/.env.local`; both are gitignored. `data/tidecloak.example.json` shows the shape.

## Layout

```
app/            Next.js game (three.js engine in app/src/game/, API in app/src/app/api/)
scripts/        3-phase Tide bootstrap (init / seat-first-admin / seat-council)
forseti/        the crew-vault policy contract (C#)
recording/      trailer + screenshots
```

## License

MIT — see [LICENSE](LICENSE).
