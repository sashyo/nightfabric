import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "NIGHTFABRIC // devlog",
  description:
    "A cyberpunk browser game where you break into most districts for real, and one you can't. Here's what it is.",
};

/**
 * A single devlog post, server-rendered. No client JS, it's an article. Styled
 * with the same tokens as the game so /blog feels like the same world.
 * Punctuation is deliberately plain ASCII: straight quotes, no em dashes.
 */
export default function Blog() {
  return (
    <div style={{ position: "fixed", inset: 0, overflowY: "auto", overflowX: "hidden", WebkitOverflowScrolling: "touch" }}>
    <main
      style={{
        maxWidth: 760,
        margin: "0 auto",
        padding: "64px 22px 96px",
        color: "var(--text)",
        fontFamily: "var(--mono)",
        lineHeight: 1.75,
      }}
    >
      <a href="/" style={{ color: "var(--dim)", fontSize: 12, letterSpacing: "0.2em", textDecoration: "none" }}>
        {"< NIGHTFABRIC"}
      </a>

      <p style={{ color: "var(--cyan)", letterSpacing: "0.28em", fontSize: 12, margin: "34px 0 10px" }}>
        DEVLOG / 001
      </p>
      <h1
        style={{
          fontSize: "clamp(28px, 5vw, 44px)",
          lineHeight: 1.12,
          margin: "0 0 10px",
          letterSpacing: "-0.01em",
          textWrap: "balance",
        }}
      >
        I made a cyberpunk city you can actually{" "}
        <span style={{ color: "var(--magenta)" }}>hack</span> (all but{" "}
        <span style={{ color: "var(--amber)" }}>one</span> district)
      </h1>
      <p style={{ color: "var(--dim)", fontSize: 13, margin: "0 0 40px" }}>
        The district nobody can break into is the reason I built the rest of it.
      </p>

      <Section>
        <p>
          I wanted to make a security argument you could feel instead of read. Every demo I have ever
          sat through just tells you a thing is safe and asks you to trust the slide. I wanted the
          opposite: a place where you try to break in, and mostly you can, right up until you hit the
          one door that has nothing to break. So I built a city.
        </p>
        <p>
          It's called Sanctum-9. Nine districts, and getting into most of them means actually
          exploiting them. You do it in an in-game console, and the server checks the real attack
          instead of playing a "hacking" animation. What's behind the seven you can crack:
        </p>
        <ul style={{ paddingLeft: 20, margin: "6px 0 0" }}>
          <li>Blackwall reads a JWT but never checks the signature, so you forge an <code>alg:none</code> token.</li>
          <li>Chrome Clinic stores its password as an unsalted SHA-1 you crack with a rainbow table.</li>
          <li>Little Kowloon pastes your input straight into SQL: <code>{"' OR '1'='1' --"}</code>.</li>
          <li>Rust Quarter still has <code>admin / admin</code> on the gate controller.</li>
          <li>Kaishin Spire lets you replay a session token sniffed off the wire.</li>
          <li>The Drown has a 4-digit keypad with no lockout that you just brute force.</li>
          <li>Ossuary Row trusts an API key that leaks out of a config response.</li>
        </ul>
        <p>
          Recon drones wander the streets and leak whatever a given gate needs, a hash here, a default
          login there. There's also a "vault" of 100 hand-broken cipher challenges (XOR, Vigenere,
          two-time pads) worth real points. It plays like a CTF with a plot, and you climb a
          leaderboard by breaking things.
        </p>
      </Section>

      <Divider />

      <Section>
        <h2 style={h2}>The one you can't get into</h2>
        <p>
          There's a district called the Vault Core, and no matter what you throw at it, you are not
          getting in. Same console, same tools. You forge, you replay, you inject, and the gate just{" "}
          <span style={{ color: "var(--amber)" }}>glitches</span> at you.
        </p>
        <p>
          It isn't that the lock is tougher. The Core runs on <a href="https://tide.org" style={link}>Tide</a>,
          which is threshold cryptography: the signing key is never actually assembled anywhere. It lives
          in pieces across a bunch of independent nodes and gets used without ever being put back
          together. So there's no key sitting around for a stolen token or a forged pass to line up
          against. Nothing to steal means nothing to guard, and that's the thing the game is trying to
          show you by letting you fail at it.
        </p>
        <p>
          Inside the Core it's a permanent festival. People wander around with everything they own out
          in the open, because nothing there can be lifted, and every other quarter in the city is
          jealous of it.
        </p>
      </Section>

      <Divider />

      <Section>
        <h2 style={h2}>How it's put together</h2>
        <p>
          Three.js on the front, real threshold auth on the back. The login isn't faked. You make an
          account in an actual enclave, and your password gets checked by a quorum of nodes that never
          see it. The leaderboard is signed too, so you can cheat the game itself but you can't fake
          your rank. And if you're losing, there's a nuclear option: rally a council quorum and
          detonate the Blackwall Protocol. It doesn't just reset scores. It revokes everyone's vault
          access, seals every drop ever made, blacks out the city, and effectively bricks the whole
          instance. No single admin can do it. It takes a signed quorum, which is the point.
        </p>
        <p>
          Full disclosure: I vibe coded most of this. I sat with an AI agent and described what I
          wanted, and it wrote the three.js and wired the Tide backend through the{" "}
          <a href="https://tide.org" style={link}>Tide MCP</a>. If you want to build something on the
          same model, point your agent's MCP client at <code>mcp.tide.org/mcp</code> and it walks you
          through the whole threshold setup.
        </p>
        <p>
          The part I did NOT hand off was the writing and the world. I love a good story, so I leaned
          hard into the lore. Every district has people who live there and will talk your ear off: a
          burned-out netrunner who cracked every gate in the city and then stood at the golden one and
          felt small; a grandmother who remembers passwords and watched her daughter's name get stolen
          twice; a pilgrim who has camped at the golden gate for nine years waiting to be raised in. It
          is a security demo, but it is also a city that is a little sad about the world it came from,
          and hopeful about the one it is becoming.
        </p>
        <p>
          It's free, multiplayer, runs in the browser. Come try to break the golden district, and stop
          to hear a few stories on the way. If you get in, I'd genuinely like to know how.
        </p>
        <p>
          It's also open source, so have a crack at the code. Fork it, break it, and if you feel like
          it, add more lore or a new CTF gate. The insecure "old stack" lives in{" "}
          <code>app/src/app/api/legacy</code> and the challenge generator is one file
          (<code>app/src/lib/challenges.ts</code>), so a new puzzle is a small PR. Pull requests with a
          fresh district legend or a nastier exploit are the ones I'd most love to merge.
        </p>
      </Section>

      <div style={{ marginTop: 44, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <a href="/play">
          <button className="nf" style={{ padding: "12px 24px", fontSize: 14 }}>
            {"> PLAY NOW"}
          </button>
        </a>
        <a href="https://github.com/sashyo/nightfabric" style={link} target="_blank" rel="noreferrer">
          {"source on github >"}
        </a>
        <a href="https://tide.org" style={link} target="_blank" rel="noreferrer">
          {"tide.org >"}
        </a>
      </div>

      <p style={{ color: "var(--dim)", fontSize: 12, marginTop: 40, letterSpacing: "0.04em" }}>
        SECURED BY TIDE / no key is ever whole / no one can be you but you
      </p>
    </main>
    </div>
  );
}

const h2: React.CSSProperties = { fontSize: 22, margin: "0 0 12px", color: "var(--cyan)", letterSpacing: "-0.01em" };
const link: React.CSSProperties = { color: "var(--cyan)", textDecoration: "none", borderBottom: "1px solid color-mix(in srgb, var(--cyan) 40%, transparent)" };

function Section({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", flexDirection: "column", gap: 16, fontSize: 15.5 }}>{children}</div>;
}
function Divider() {
  return <div style={{ height: 1, background: "var(--edge)", margin: "36px 0" }} />;
}
