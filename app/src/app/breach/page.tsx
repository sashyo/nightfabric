"use client";

import { useState } from "react";
import { useTideCloak } from "@tidecloak/nextjs";
import { ATTACKS, type AttackResult } from "./attacks";
import { OldTownLab } from "./OldTownLab";

/**
 * THE BREACH CONSOLE.
 *
 * Real attacks against this exact deployment, fired from your own session. This
 * is not a simulation and not a checklist — each button sends the request and
 * shows you the status and body that came back. The whole point of Tide is that
 * you can hand an attacker the manual and the credentials and still lose them
 * nothing, so the honest way to demo it is to let people try.
 *
 * Everything here targets YOUR account on a game realm. That is authorised
 * testing by definition; do not point these at systems you do not own.
 */
export default function Breach() {
  const { authenticated, isInitializing, token, secureFetch, doDecrypt, IAMService } =
    useTideCloak();
  const [results, setResults] = useState<Record<string, AttackResult>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [ran, setRan] = useState(false);
  const [score, setScore] = useState<number>(0);

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  const run = async (id: string) => {
    const atk = ATTACKS.find((a) => a.id === id);
    if (!atk) return;
    setBusy(id);
    try {
      const r = await atk.run({
        origin,
        secureFetch,
        token,
        doDecrypt: (d) => doDecrypt(d as any),
      });
      setResults((prev) => ({ ...prev, [id]: r }));
      setRan(true);
    } catch (e: any) {
      setResults((prev) => ({
        ...prev,
        [id]: { verdict: "held", detail: e?.message ?? String(e) },
      }));
    } finally {
      setBusy(null);
    }
  };

  const runAll = async () => {
    for (const a of ATTACKS) await run(a.id);
  };

  if (isInitializing) return <Wrap><p style={{ color: "var(--dim)" }}>initialising enclave…</p></Wrap>;
  if (!authenticated)
    return (
      <Wrap>
        <p>Log in first — the attacks run from your own session.</p>
        <a href="/"><button className="nf">TITLE</button></a>
      </Wrap>
    );

  const blocked = Object.values(results).filter((r) => r.verdict === "held").length;
  const breached = Object.values(results).filter((r) => r.verdict === "leaked").length;

  return (
    <Wrap>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <h1 style={{ fontSize: 24, color: "var(--red)", margin: 0, letterSpacing: "0.14em" }}>
          BREACH CONSOLE
        </h1>
        <div style={{ display: "flex", gap: 10 }}>
          <a href="/play"><button className="nf">← SANCTUM-9</button></a>
          <button className="nf red" onClick={runAll} disabled={!!busy}>
            RUN ALL
          </button>
        </div>
      </div>

      <p style={{ fontSize: 12, color: "var(--dim)", lineHeight: 1.8, maxWidth: 720 }}>
        Real requests against this live deployment, from your logged-in session — not a simulation.
        Each one is an attack a real intruder would try. Run them, read the status codes, and check
        the claim: an attacker who is already inside, with a valid session and the manual, still
        walks away with nothing.
      </p>
      <p style={{ fontSize: 11, color: "var(--amber)", maxWidth: 720 }}>
        These target your own account on a game realm — authorised by definition. Every recipe below
        also runs from a terminal or the devtools console if you would rather drive it yourself.
      </p>

      <p style={{ fontSize: 10.5, color: "var(--dim)", margin: "0 0 6px" }}>
        <span style={{ color: "var(--cyan)" }}>cyan ✕ = your attack was blocked</span> ·{" "}
        <span style={{ color: "var(--red)" }}>red ☠ = a real breach</span> · nothing here turns
        &ldquo;success green&rdquo; unless the system actually gives something up.
      </p>

      {ran && (
        <div style={{ display: "flex", gap: 18, margin: "10px 0 4px", fontSize: 12 }}>
          <span style={{ color: "var(--cyan)" }}>✕ attacks blocked (you got nothing): {blocked}</span>
          <span style={{ color: breached ? "var(--red)" : "var(--dim)" }}>
            ☠ system breached: {breached}
          </span>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 14 }}>
        {ATTACKS.map((a) => {
          const r = results[a.id];
          // Colour language: an attacker's failed hack must never look like a win.
          // HELD = your attack was BLOCKED (cyan, "system held"); LEAKED = a real
          // breach (alarm red); INFO = neutral. Green is not used here at all.
          const tint =
            r?.verdict === "leaked" ? "var(--red)" : r?.verdict === "held" ? "var(--cyan)" : "var(--edge)";
          return (
            <div key={a.id} className="panel" style={{ borderColor: tint }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
                <h2 style={{ fontSize: 14, margin: 0, color: "var(--text)" }}>{a.title}</h2>
                <button className="nf red" disabled={busy === a.id} onClick={() => run(a.id)} style={{ padding: "5px 12px" }}>
                  {busy === a.id ? "ATTACKING…" : "TRY TO HACK"}
                </button>
              </div>
              <p style={{ fontSize: 11.5, color: "var(--dim)", lineHeight: 1.7, margin: "8px 0 4px" }}>
                <span style={{ color: "var(--amber)" }}>premise · </span>{a.premise}
              </p>
              <p style={{ fontSize: 11.5, color: "var(--dim)", lineHeight: 1.7, margin: "0 0 8px" }}>
                <span style={{ color: "var(--cyan)" }}>defence · </span>{a.mechanism}
              </p>

              <details style={{ marginBottom: r ? 10 : 0 }}>
                <summary style={{ fontSize: 10.5, color: "var(--dim)", cursor: "pointer" }}>
                  run it yourself
                </summary>
                <pre style={{
                  fontSize: 10.5, color: "#5d7793", background: "#05060d",
                  border: "1px solid var(--edge)", padding: 10, marginTop: 6,
                  whiteSpace: "pre-wrap", wordBreak: "break-all",
                }}>
                  {a.recipe({ origin, token })}
                </pre>
              </details>

              {r && (
                <div style={{
                  borderLeft: `2px solid ${tint}`, paddingLeft: 12, marginTop: 4,
                }}>
                  <div style={{ fontSize: 12, color: tint, letterSpacing: "0.1em", fontWeight: 700 }}>
                    {r.verdict === "held"
                      ? "✕ ATTACK FAILED — SYSTEM HELD, YOU GOT NOTHING"
                      : r.verdict === "leaked"
                        ? "☠ SYSTEM BREACHED"
                        : "· RESULT"}
                    {r.status != null ? `  ·  HTTP ${r.status}` : ""}
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--text)", lineHeight: 1.7, marginTop: 3 }}>
                    {r.detail}
                  </div>
                  {r.evidence && (
                    <pre style={{
                      fontSize: 10, color: "#6d87a3", background: "#05060d",
                      border: "1px solid var(--edge)", padding: 10, marginTop: 8,
                      whiteSpace: "pre-wrap", wordBreak: "break-all", maxHeight: 200, overflow: "auto",
                    }}>
                      {r.evidence}
                    </pre>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ===================== OLD TOWN — the part Tide didn't touch ===================== */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginTop: 48 }}>
        <h1 style={{ fontSize: 24, color: "var(--amber)", margin: 0, letterSpacing: "0.14em" }}>OLD TOWN</h1>
        <span style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--amber)" }}>session points: {score}</span>
      </div>
      <OldTownLab secureFetch={secureFetch} onClaimed={(a) => setScore((s) => s + a)} />

      <div className="panel" style={{ margin: "10px 0 8px", borderColor: "var(--amber)" }}>
        <p style={{ fontSize: 12, color: "var(--text)", lineHeight: 1.9, margin: 0 }}>
          Hack all of Old Town — every flag, both legacy districts — and you scrape together maybe
          <b style={{ color: "var(--amber)" }}> ~130 points</b>. A single <span style={{ color: "var(--violet)" }}>tidified
          district</span> is worth <b>1 trillion</b>, and the golden <b style={{ color: "var(--amber)" }}>Vault Core</b> a <b>quadrillion</b> — ghost-only, ratified by council quorum. You cannot hack your way to the top
          of this board. The valuable path is the one nobody can forge.
        </p>
      </div>

      <div className="panel" style={{ margin: "24px 0", borderColor: "var(--cyan)" }}>
        <p className="label" style={{ color: "var(--cyan)" }}>why every attack held</p>
        <p style={{ fontSize: 12, color: "var(--text)", lineHeight: 1.9, margin: "0 0 10px" }}>
          None of these failed because a wall was high enough. They failed because there was nothing
          to seize. Authority was <strong>removed</strong> — no admin, no server, no operator holds
          the keys — so ownership is not defended, it is <strong>guaranteed</strong>. Your account is
          yours. The system's assets are the system's only.
        </p>
        <p style={{ fontSize: 12, color: "var(--dim)", lineHeight: 1.9, margin: 0 }}>
          The database dump is the one attack that "succeeds", and it proves the point: it yields
          base64 and timestamps. The question a security model must survive is not whether the
          attacker gets in — it is what they hold when they do, and here it is nothing.
        </p>
        <p style={{ fontSize: 12, color: "var(--green)", lineHeight: 1.9, margin: "10px 0 0" }}>
          That is the shift: you stop chasing vulnerabilities and threats. There is no monopoly on
          the system to capture, so there is no breach to fear. Security, privacy, ownership,
          governance, sovereignty — all fall out of one move: taking authority away from everyone.
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
