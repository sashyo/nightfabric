import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "NIGHTFABRIC // devlog",
  description:
    "I stopped believing security demos, so I built one you can actually break. Notes on keys, vibe coding, and a city.",
};

/**
 * A single devlog essay, server-rendered. No client JS, it's an article. Styled
 * with the same tokens as the game. Punctuation is plain ASCII on purpose:
 * straight quotes, no em dashes.
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
          I never believed a security demo, so I built one you can break
        </h1>
        <p style={{ color: "var(--dim)", fontSize: 13, margin: "0 0 40px" }}>
          Notes on keys, on vibe coding, and on a city that is a little sad about where it came from.
        </p>

        <Section>
          <p>
            For a long stretch of my career my job was to sit in rooms while someone told me their
            product was secure. There was usually a slide with a padlock on it. I would nod. I never
            actually believed it, and for years I couldn't say why. You can't see the absence of a bug.
            You are being asked to trust that the people on stage found all of theirs.
          </p>
          <p>
            The thing that finally got under my skin was noticing every one of those talks had the same
            shape. Here is our wall. Please trust that it is tall enough. And a wall is a strange thing
            to be proud of, because it is only interesting until somebody finds the one spot you forgot
            to check.
          </p>
          <p>
            The security work I actually trust is the boring kind, where getting in wins you nothing,
            because there was never anything behind the door worth carrying out. If a system never holds
            a master key, then a stolen login and a forged token and a dumped database all bottom out in
            the same sad place: base64 and a shrug. You quit guarding the key by never having one.
          </p>
        </Section>

        <Divider />

        <Section>
          <h2 style={h2}>The city, and the seven doors</h2>
          <p>
            I wanted to feel that idea instead of argue about it, so I built a game where you can try. It
            is a cyberpunk sprawl called Sanctum-9, nine districts under permanent rain. Seven of them
            run what everyone in the game calls the old stack, and each one is broken in a different,
            real way. You don't watch a "hacking" animation. You open a console and actually do it, and
            the server checks the genuine attack.
          </p>
          <p>
            Blackwall reads a token and never checks the signature, so you forge an unsigned one. Chrome
            Clinic kept its password as a plain hash you reverse with a rainbow table. Little Kowloon
            pastes whatever you type straight into its database, so you inject. Rust Quarter never
            changed its factory login. Kaishin Spire lets you replay a session sniffed off the wire. The
            Drown's keypad has no lockout, so you brute it. Ossuary Row leaks its master key in a config
            file. There is also a back room with a hundred hand-rolled cipher puzzles for the people who
            like that sort of pain. Break things, climb a board.
          </p>
          <p>
            Then there is one district you cannot get into, no matter what you throw at it. It runs on
            threshold cryptography, so there is no key sitting anywhere to steal, and every trick that
            opens the rest of the city does exactly nothing. The gate just glitches at you. I have
            watched people spend twenty minutes trying, and the moment it clicks for them is worth more
            than any slide I ever sat through. You learn it because you failed at it.
          </p>
        </Section>

        <Divider />

        <Section>
          <h2 style={h2}>I vibe coded most of it</h2>
          <p>
            Might as well be honest about it. I sat with an AI agent, described what I wanted, and it
            wrote the three.js and stood up the whole threshold-auth backend through an MCP endpoint
            (Tide's, at <code>mcp.tide.org/mcp</code>). The part that genuinely surprised me was how
            little of the hard security plumbing I ever touched by hand. I described the shape of the
            thing; it handled the enclave, the signing, the token binding.
          </p>
          <p>
            The part I kept for myself was the writing, because I love a good story. So I filled the
            streets with people who will talk to you, and every one of them is standing next to
            something true about how the city works. Some are grieving the world before the Fabric, back
            when a stolen password could wear your face for an afternoon. Some are dreaming out loud
            about the golden district they can see but can't reach, and trading legends about what is
            actually inside it. I'm not going to spoil any of that here. Go stand on a corner and let
            someone tell you. Think of this as the trailer, not the script.
          </p>
        </Section>

        <Divider />

        <Section>
          <h2 style={h2}>Have a go</h2>
          <p>
            It's free, it's multiplayer, it runs in the browser. The login is a real enclave, so your
            password isn't stored anywhere, not even as a hash. The leaderboard is signed, so you can
            cheese the game but not your rank. And if you're losing badly, you can rally a council quorum
            and detonate the whole instance to zero, which no single admin could ever do on their own.
          </p>
          <p>
            It's open source too, so pull it apart. The insecure endpoints live in{" "}
            <code>app/src/app/api/legacy</code> and the 100-cipher vault is one file. If you feel like
            it, add a new district legend or a nastier puzzle and send a PR. Those are the ones I would
            most love to merge.
          </p>
          <p>
            Mostly, though, go try to get into the golden district. I still half believe it's impossible,
            which is sort of the whole point. If you manage it, come tell me how.
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
