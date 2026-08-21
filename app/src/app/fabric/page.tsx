"use client";

import { useState } from "react";
import { useTideCloak } from "@tidecloak/nextjs";
import { ATTACKS, type AttackResult } from "../breach/attacks";

/**
 * THE FABRIC TERMINAL.
 *
 * The other half of the BREACH CONSOLE, split out so the two ideas don't blur:
 * here you attack the TIDE-SECURED system itself, and every attack holds. (The
 * exploitable Old Town CTF lives on its own terminal.) These are real requests
 * against this live deployment from your own logged-in session, not a simulation.
 */
export default function Fabric() {
  const { authenticated, isInitializing, token, secureFetch, doDecrypt } = useTideCloak();
  const [results, setResults] = useState<Record<string, AttackResult>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [ran, setRan] = useState(false);

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  const run = async (id: string) => {
    const atk = ATTACKS.find((a) => a.id === id);
    if (!atk) return;
    setBusy(id);
    try {
      const r = await atk.run({ origin, secureFetch, token, doDecrypt: (d) => doDecrypt(d as any) });
      setResults((prev) => ({ ...prev, [id]: r }));
      setRan(true);
    } catch (e: any) {
      setResults((prev) => ({ ...prev, [id]: { verdict: "held", detail: e?.message ?? String(e) } }));
    } finally {
      setBusy(null);
    }
  };
  const runAll = async () => { for (const a of ATTACKS) await run(a.id); };

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
        <h1 style={{ fontSize: 24, color: "var(--cyan)", margin: 0, letterSpacing: "0.14em" }}>◈ FABRIC TERMINAL</h1>
        <div style={{ display: "flex", gap: 10 }}>
          <a href="/play"><button className="nf">← SANCTUM-9</button></a>
          <button className="nf" onClick={runAll} disabled={!!busy}>RUN ALL</button>
        </div>
      </div>

      {/* HOW TO USE */}
      <div className="panel" style={{ margin: "14px 0 6px", borderColor: "var(--cyan)" }}>
        <p className="label" style={{ color: "var(--cyan)" }}>how to use this terminal</p>
        <p style={{ fontSize: 12, color: "var(--text)", lineHeight: 1.9, margin: 0 }}>
          These are real attacks against the <b>Tide-secured</b> system — forge a token, replay a
          session, escalate through the admin proxy, dump the database. Hit <b>TRY TO HACK</b> and read
          the status code. The claim: an attacker who is already inside, with a valid session and this
          very manual, still walks away with nothing. Every attack here <b style={{ color: "var(--cyan)" }}>holds</b>.
          {" "}Want the part that <i>does</i> break? That&apos;s the{" "}
          <a href="/breach" style={{ color: "var(--amber)" }}>BREACH CONSOLE</a> — the insecure Old Town CTF.
        </p>
      </div>

      <p style={{ fontSize: 11, color: "var(--amber)", maxWidth: 720 }}>
        These target your own account on a game realm — authorised by definition. Every recipe below
        also runs from a terminal or devtools if you would rather drive it yourself.
      </p>
      <p style={{ fontSize: 10.5, color: "var(--dim)", margin: "0 0 6px" }}>
        <span style={{ color: "var(--cyan)" }}>cyan ✕ = your attack was blocked</span> ·{" "}
        <span style={{ color: "var(--red)" }}>red ☠ = a real breach</span> · nothing here turns
        &ldquo;success green&rdquo; unless the system actually gives something up.
      </p>

      {ran && (
        <div style={{ display: "flex", gap: 18, margin: "10px 0 4px", fontSize: 12 }}>
          <span style={{ color: "var(--cyan)" }}>✕ attacks blocked (you got nothing): {blocked}</span>
          <span style={{ color: breached ? "var(--red)" : "var(--dim)" }}>☠ system breached: {breached}</span>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 14 }}>
        {ATTACKS.map((a) => {
          const r = results[a.id];
          const tint = r?.verdict === "leaked" ? "var(--red)" : r?.verdict === "held" ? "var(--cyan)" : "var(--edge)";
          return (
            <div key={a.id} className="panel" style={{ borderColor: tint }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
                <h2 style={{ fontSize: 14, margin: 0, color: "var(--text)" }}>{a.title}</h2>
                <button className="nf" disabled={busy === a.id} onClick={() => run(a.id)} style={{ padding: "5px 12px" }}>
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
                <summary style={{ fontSize: 10.5, color: "var(--dim)", cursor: "pointer" }}>run it yourself</summary>
                <pre style={{ fontSize: 10.5, color: "#5d7793", background: "#05060d", border: "1px solid var(--edge)", padding: 10, marginTop: 6, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                  {a.recipe({ origin, token })}
                </pre>
              </details>
              {r && (
                <div style={{ borderLeft: `2px solid ${tint}`, paddingLeft: 12, marginTop: 4 }}>
                  <div style={{ fontSize: 12, color: tint, letterSpacing: "0.1em", fontWeight: 700 }}>
                    {r.verdict === "held" ? "✕ ATTACK FAILED — SYSTEM HELD, YOU GOT NOTHING" : r.verdict === "leaked" ? "☠ SYSTEM BREACHED" : "· RESULT"}
                    {r.status != null ? `  ·  HTTP ${r.status}` : ""}
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--text)", lineHeight: 1.7, marginTop: 3 }}>{r.detail}</div>
                  {r.evidence && (
                    <pre style={{ fontSize: 10, color: "#6d87a3", background: "#05060d", border: "1px solid var(--edge)", padding: 10, marginTop: 8, whiteSpace: "pre-wrap", wordBreak: "break-all", maxHeight: 200, overflow: "auto" }}>
                      {r.evidence}
                    </pre>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="panel" style={{ margin: "24px 0", borderColor: "var(--cyan)" }}>
        <p className="label" style={{ color: "var(--cyan)" }}>why every attack held</p>
        <p style={{ fontSize: 12, color: "var(--text)", lineHeight: 1.9, margin: "0 0 10px" }}>
          None of these failed because a wall was high enough. They failed because there was nothing
          to seize. Authority was <strong>removed</strong> — no admin, no server, no operator holds the
          keys — so ownership is not defended, it is <strong>guaranteed</strong>. Your account is yours.
          The system&apos;s assets are the system&apos;s only.
        </p>
        <p style={{ fontSize: 12, color: "var(--green)", lineHeight: 1.9, margin: 0 }}>
          You stop chasing vulnerabilities and threats. There is no monopoly on the system to capture,
          so there is no breach to fear. Security, privacy, ownership, governance, sovereignty — all
          fall out of one move: taking authority away from everyone.
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
