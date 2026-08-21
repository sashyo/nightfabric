"use client";

import { useState } from "react";
import { useTideCloak } from "@tidecloak/nextjs";
import { OldTownLab } from "./OldTownLab";

/**
 * THE BREACH CONSOLE — the CTF half.
 *
 * This terminal is the exploitable OLD TOWN: a live request console pointed at
 * deliberately-insecure endpoints. You break them for real and claim the flags
 * for points. The other terminal (the FABRIC TERMINAL at /fabric) is where you
 * attack the Tide-secured system and everything holds. Two terminals, two
 * lessons, kept apart on purpose.
 */
export default function Breach() {
  const { authenticated, isInitializing, secureFetch } = useTideCloak();
  const [score, setScore] = useState<number>(0);

  if (isInitializing) return <Wrap><p style={{ color: "var(--dim)" }}>initialising enclave…</p></Wrap>;
  if (!authenticated)
    return (
      <Wrap>
        <p>Log in first — the console runs from your own session.</p>
        <a href="/"><button className="nf">TITLE</button></a>
      </Wrap>
    );

  return (
    <Wrap>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <h1 style={{ fontSize: 24, color: "var(--amber)", margin: 0, letterSpacing: "0.14em" }}>BREACH CONSOLE // OLD TOWN CTF</h1>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--amber)" }}>session points: {score}</span>
          <a href="/play"><button className="nf">← SANCTUM-9</button></a>
        </div>
      </div>

      {/* HOW TO PLAY THIS CONSOLE */}
      <div className="panel" style={{ margin: "14px 0 8px", borderColor: "var(--amber)" }}>
        <p className="label" style={{ color: "var(--amber)" }}>how this works — read me first</p>
        <ol style={{ fontSize: 12.5, color: "var(--text)", lineHeight: 1.9, margin: "4px 0 0", paddingLeft: 20 }}>
          <li>Pick a <b>TARGET</b> below. Each one names a vulnerability class and the endpoints in play. It does NOT hand you the exploit.</li>
          <li>Use the <b>request console</b> (method + URL + headers + body) to actually break it. A response that hands back a <code style={{ color: "var(--amber)" }}>FLAG-…</code> (or a <code>VAULT-…</code>) means you did it.</li>
          <li>Stuck? Reveal <b>hints</b> one at a time — but every hint you use, and using the hack map, costs points. Reveal the full solution and you get just 1 point.</li>
          <li>Paste the flag into <b>CLAIM</b> to bank it on the Tide-signed leaderboard. You can forge an Old Town token all day; you cannot forge your rank.</li>
        </ol>
        <p style={{ fontSize: 11.5, color: "var(--dim)", lineHeight: 1.8, margin: "10px 0 0" }}>
          Everything here is the insecure <b>old stack</b>, exploitable on purpose. Want to attack the
          Tide-secured side and watch it hold instead? That&apos;s the{" "}
          <a href="/fabric" style={{ color: "var(--cyan)" }}>◈ FABRIC TERMINAL</a>.
        </p>
      </div>

      <OldTownLab secureFetch={secureFetch} onClaimed={(a) => setScore((s) => s + a)} />

      <div className="panel" style={{ margin: "10px 0 8px", borderColor: "var(--amber)" }}>
        <p style={{ fontSize: 12, color: "var(--text)", lineHeight: 1.9, margin: 0 }}>
          Hack all of Old Town — every flag, both legacy districts, the whole cipher vault — and it is
          still crumbs next to real clearance. A single <span style={{ color: "var(--violet)" }}>tidified
          district</span> is worth <b>1 trillion</b>, and the golden <b style={{ color: "var(--amber)" }}>Vault Core</b> is ghost-only, ratified by council quorum. You cannot hack your way to the top of this board.
          The valuable path is the one nobody can forge.
        </p>
      </div>
    </Wrap>
  );
}

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <main style={{ height: "100vh", overflow: "auto", padding: "44px 30px" }}>
      <div style={{ maxWidth: 820, margin: "0 auto" }}>{children}</div>
    </main>
  );
}
