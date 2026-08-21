"use client";

import { useEffect, useState } from "react";
import { useTideCloak } from "@tidecloak/nextjs";

const LINES = [
  "SANCTUM-9 // municipal identity fabric",
  "",
  "  password store ................ none. never existed.",
  "  password hashes ............... none. nothing to crack.",
  "  token signing key ............. not on this machine.",
  "  encryption keys ............... never assembled, anywhere.",
  "",
  "  authentication ................ threshold protocol across the ORK network",
  "  clearance ..................... verified server-side, per district",
  "  loot .......................... end-to-end encrypted to you alone",
  "  promotion ..................... council quorum, sealed by threshold signature",
  "",
  "> the corps own this city. they do not own its keys.",
  "> nobody does. that is the whole trick.",
];

export default function Title() {
  const { authenticated, isInitializing, initError, login, logout } = useTideCloak();
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (shown >= LINES.length) return;
    const t = setTimeout(() => setShown((n) => n + 1), shown === 0 ? 250 : 95);
    return () => clearTimeout(t);
  }, [shown]);

  return (
    <main
      style={{
        height: "100vh",
        display: "grid",
        placeItems: "center",
        background:
          "radial-gradient(1100px 700px at 50% 118%, #2a0d3f 0%, #0a0618 46%, #04030a 100%)",
        overflow: "auto",
      }}
    >
      <div style={{ width: "min(880px, 92vw)", padding: "40px 0" }}>
        <h1
          className="flicker"
          style={{
            fontSize: "clamp(38px, 9vw, 96px)",
            lineHeight: 0.92,
            margin: 0,
            letterSpacing: "-0.03em",
            color: "var(--cyan)",
            textShadow: "0 0 26px rgba(0,229,255,0.55), 0 0 90px rgba(255,45,149,0.28)",
          }}
        >
          NIGHT<span style={{ color: "var(--magenta)" }}>FABRIC</span>
        </h1>
        <p style={{ color: "var(--dim)", letterSpacing: "0.3em", fontSize: 11, margin: "10px 0 26px" }}>
          AN OPEN WORLD WITH REAL LOCKS
        </p>

        <pre
          style={{
            fontSize: 12.5,
            lineHeight: 1.65,
            color: "var(--text)",
            margin: 0,
            minHeight: 300,
            whiteSpace: "pre-wrap",
          }}
        >
          {LINES.slice(0, shown).join("\n")}
          <span style={{ color: "var(--green)" }}>{shown < LINES.length ? "█" : ""}</span>
        </pre>

        <div style={{ marginTop: 30, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          {isInitializing ? (
            <span style={{ color: "var(--dim)", fontSize: 12 }}>initialising enclave…</span>
          ) : initError ? (
            <div className="panel" style={{ borderColor: "var(--red)", maxWidth: 640 }}>
              <p className="label" style={{ color: "var(--red)" }}>enclave did not come up</p>
              <p style={{ fontSize: 12, margin: 0, color: "var(--text)" }}>{initError.message}</p>
              <p style={{ fontSize: 11, margin: "8px 0 0", color: "var(--dim)" }}>
                Usual cause: <code>data/tidecloak.json</code> is still the placeholder, or the realm
                bootstrap has not run. A missing <code>jwk</code> field means IGA was not enabled.
              </p>
            </div>
          ) : authenticated ? (
            <>
              <a href="/play">
                <button className="nf">JACK IN →</button>
              </a>
              <button className="nf magenta" onClick={() => logout()}>
                DISCONNECT
              </button>
            </>
          ) : (
            <>
              <button className="nf" onClick={() => login()}>
                LINK IDENTITY
              </button>
              <span style={{ color: "var(--dim)", fontSize: 11, maxWidth: 460, lineHeight: 1.6 }}>
                Your password is checked by a threshold of independent nodes, none of which learn it.
                It is not sent here. There is no hash of it anywhere to steal.
              </span>
            </>
          )}
        </div>

        <div style={{ marginTop: 40, paddingTop: 18, borderTop: "1px solid var(--edge)", display: "flex", gap: 18, flexWrap: "wrap", alignItems: "center", fontSize: 11.5, color: "var(--dim)", letterSpacing: "0.04em" }}>
          <span style={{ color: "var(--cyan)", letterSpacing: "0.24em" }}>◈ SECURED BY TIDE</span>
          <span>no key is ever whole · no one can be you but you</span>
          <a href="/blog" style={{ color: "var(--cyan)" }}>devlog</a>
          <a href="https://tide.org" target="_blank" rel="noreferrer" style={{ color: "var(--cyan)" }}>tide.org →</a>
          <span>build your own: point your agent&apos;s MCP client at <code style={{ color: "var(--gold, #ffd23f)" }}>mcp.tide.org/mcp</code></span>
        </div>
      </div>
    </main>
  );
}
