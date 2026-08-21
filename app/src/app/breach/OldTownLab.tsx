"use client";

import { useState } from "react";
import { OLDTOWN } from "./oldtown";

/**
 * The Old Town lab. A real HTTP console so you can hack the insecure endpoints
 * yourself, a claim box for flags you actually capture, and briefings that name
 * the flaw but not the answer (hints are opt-in, escalating to a spoiler you
 * choose to reveal).
 */
export function OldTownLab({
  secureFetch,
  onClaimed,
}: {
  secureFetch: (u: string, i?: RequestInit) => Promise<Response>;
  onClaimed: (awarded: number) => void;
}) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  // --- request console state ---
  const [method, setMethod] = useState("GET");
  const [url, setUrl] = useState("/api/legacy/config");
  const [headers, setHeaders] = useState("");
  const [body, setBody] = useState("");
  const [resp, setResp] = useState<{ status: number; text: string } | null>(null);
  const [sending, setSending] = useState(false);

  const send = async () => {
    setSending(true);
    setResp(null);
    try {
      const h: Record<string, string> = {};
      headers.split("\n").forEach((line) => {
        const i = line.indexOf(":");
        if (i > 0) h[line.slice(0, i).trim()] = line.slice(i + 1).trim();
      });
      const full = url.startsWith("http") ? url : origin + (url.startsWith("/") ? url : "/" + url);
      const init: RequestInit = { method, headers: h };
      if (method !== "GET" && method !== "HEAD" && body.trim()) init.body = body;
      const r = await fetch(full, init);
      const t = await r.text();
      let pretty = t;
      try { pretty = JSON.stringify(JSON.parse(t), null, 2); } catch { /* raw */ }
      setResp({ status: r.status, text: pretty });
    } catch (e: any) {
      setResp({ status: 0, text: e?.message ?? String(e) });
    } finally {
      setSending(false);
    }
  };

  // --- token tool (decode / re-encode arbitrary JSON — a tool, not the answer) ---
  const [tok, setTok] = useState("");
  const [decoded, setDecoded] = useState("");
  const b64urlDecode = (s: string) => {
    try { return decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/")))); }
    catch { return atob(s.replace(/-/g, "+").replace(/_/g, "/")); }
  };
  const b64urlEncode = (s: string) =>
    btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const decode = () => {
    const parts = tok.split(".");
    if (parts.length < 2) { setDecoded("not a dotted token"); return; }
    try { setDecoded(JSON.stringify(JSON.parse(b64urlDecode(parts[1])), null, 2)); }
    catch { setDecoded(b64urlDecode(parts[1])); }
  };
  const reencode = () => {
    const parts = tok.split(".");
    try {
      const payload = b64urlEncode(JSON.stringify(JSON.parse(decoded)));
      setTok(`${parts[0] || ""}.${payload}.${parts[2] ?? ""}`);
    } catch { /* leave as-is */ }
  };

  // hints revealed per target — feeds the spoiler penalty on claim
  const [revealed, setRevealed] = useState<Record<string, number>>({});

  // --- claim ---
  const [flag, setFlag] = useState("");
  const [claimMsg, setClaimMsg] = useState("");
  const claim = async () => {
    setClaimMsg("");
    const f = flag.trim();
    const target = OLDTOWN.find((t) => t.flagPrefix === f.split(".")[0]);
    const hints = target ? (revealed[target.id] ?? 0) : 0;
    const solution = !!target && hints >= target.hints.length;   // last hint is the full solution
    const r = await secureFetch(origin + "/api/score/claim", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ flag: f, hints, solution }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setClaimMsg(j.error ?? "rejected"); return; }
    if (j.already) { setClaimMsg(`already claimed ${j.flag} — no points`); return; }
    const bits: string[] = [];
    if (j.solution) bits.push("solution revealed → 1 pt");
    else {
      if (j.hintPenalty) bits.push(`−${j.hintPenalty} hints`);
      if (j.mapPenalty) bits.push(`−${j.mapPenalty} map`);
    }
    const note = bits.length ? ` (${j.base} ${bits.join(" ")} = ${j.awarded})` : "";
    setClaimMsg(`✓ ${j.flag} — +${j.awarded} pts${note}. ${j.lesson ?? ""}`);
    setFlag("");
    onClaimed(j.awarded ?? 0);
  };

  // --- hack map (reveals target locations; −10 per hack once used) ---
  const [mapTargets, setMapTargets] = useState<{ name: string; x: number; z: number; hack: string }[] | null>(null);
  const revealMap = async () => {
    const r = await secureFetch(origin + "/api/score/map", { method: "POST" });
    const j = await r.json().catch(() => ({}));
    setMapTargets(j.targets ?? []);
  };

  const inp: React.CSSProperties = {
    background: "#0a0803", border: "1px solid var(--edge)", color: "var(--text)",
    fontFamily: "var(--mono)", fontSize: 12, padding: "7px 9px", width: "100%",
  };
  const cell: React.CSSProperties = { fontSize: 11, padding: "6px 8px", borderBottom: "1px solid #16223a", verticalAlign: "top" };

  return (
    <div>
      <p style={{ fontSize: 12, color: "var(--dim)", lineHeight: 1.8, maxWidth: 720 }}>
        We hand you the tools and the targets. <b style={{ color: "var(--amber)" }}>The exploit is
        yours to find.</b> Use the console below (or your own terminal / devtools) to break these
        endpoints. When a response hands you a <code>FLAG-…</code>, paste it into Claim for points.
        Each hint costs <b style={{ color: "var(--red)" }}>−10</b>; reveal the full <b>solution</b> and
        the flag is worth just <b>1</b>. The <b style={{ color: "var(--amber)" }}>hack map</b> costs another
        −10 per flag. Solve it cold to keep everything.
      </p>

      <div className="panel" style={{ borderColor: mapTargets ? "var(--red)" : "var(--edge)", margin: "0 0 14px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <p className="label" style={{ margin: 0, color: mapTargets ? "var(--red)" : "var(--amber)" }}>
            {mapTargets ? "hack map active · −10 per flag" : "hack map — reveal every target's location"}
          </p>
          {!mapTargets && <button className="nf red" onClick={revealMap}>REVEAL MAP (−10/hack)</button>}
        </div>
        {mapTargets && (
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
            <tbody>
              {mapTargets.map((t) => (
                <tr key={t.name}>
                  <td style={{ ...cell, color: "var(--amber)", width: 190 }}>{t.name}</td>
                  <td style={{ ...cell, fontFamily: "var(--mono)", color: "var(--dim)", width: 110 }}>{t.x}, {t.z}</td>
                  <td style={cell}>{t.hack}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* request console */}
      <div className="panel" style={{ borderColor: "var(--amber)", margin: "14px 0" }}>
        <p className="label" style={{ color: "var(--amber)" }}>request console</p>
        <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
          <select value={method} onChange={(e) => setMethod(e.target.value)} style={{ ...inp, width: 90 }}>
            {["GET", "POST", "PUT", "DELETE"].map((m) => <option key={m}>{m}</option>)}
          </select>
          <input value={url} onChange={(e) => setUrl(e.target.value)} style={{ ...inp, flex: 1, minWidth: 220 }} placeholder="/api/legacy/…" />
          <button className="nf amber" disabled={sending} onClick={send}>{sending ? "…" : "SEND"}</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <textarea value={headers} onChange={(e) => setHeaders(e.target.value)} rows={3} style={{ ...inp, resize: "vertical" }}
            placeholder={"headers, one per line\nAuthorization: Legacy <token>\nx-api-key: <key>"} />
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} style={{ ...inp, resize: "vertical" }}
            placeholder={"body (JSON) for POST/PUT\n{}"} />
        </div>
        {resp && (
          <pre style={{
            marginTop: 8, fontSize: 11, background: "#05060d", border: "1px solid var(--edge)",
            padding: 10, maxHeight: 240, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all",
            color: resp.status >= 200 && resp.status < 300 ? "var(--green)" : "var(--red)",
          }}>
            {`HTTP ${resp.status}\n`}<span style={{ color: "#8a9bb8" }}>{resp.text}</span>
          </pre>
        )}
      </div>

      {/* token tool */}
      <div className="panel" style={{ borderColor: "var(--edge)", margin: "0 0 14px" }}>
        <p className="label">token tool — decode / edit / re-encode</p>
        <input value={tok} onChange={(e) => setTok(e.target.value)} style={inp} placeholder="paste a token (header.payload.sig)" />
        <div style={{ display: "flex", gap: 8, margin: "8px 0" }}>
          <button className="nf" onClick={decode} style={{ padding: "5px 10px" }}>DECODE ▾</button>
          <button className="nf" onClick={reencode} style={{ padding: "5px 10px" }}>▴ RE-ENCODE</button>
        </div>
        <textarea value={decoded} onChange={(e) => setDecoded(e.target.value)} rows={4} style={{ ...inp, resize: "vertical" }}
          placeholder="decoded payload (edit me, then RE-ENCODE)" />
        <p style={{ fontSize: 10, color: "var(--dim)", margin: "6px 0 0" }}>
          A generic tool — it does not know the answer. Edit the JSON however you like and re-encode.
        </p>
      </div>

      {/* targets + progressive hints */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {OLDTOWN.map((t) => (
          <TargetCard
            key={t.id}
            t={t}
            shown={revealed[t.id] ?? 0}
            onReveal={() => setRevealed((r) => ({ ...r, [t.id]: Math.min((r[t.id] ?? 0) + 1, t.hints.length) }))}
          />
        ))}
      </div>

      {/* tidified targets — same tools, no exploit */}
      <div className="panel" style={{ borderColor: "var(--cyan)", margin: "14px 0" }}>
        <p className="label" style={{ color: "var(--cyan)" }}>tidified targets — same tools, no exploit</p>
        <p style={{ fontSize: 11.5, color: "var(--dim)", lineHeight: 1.7, margin: "0 0 8px" }}>
          Point the console at these all you like — <span style={{ color: "var(--cyan)" }}>GET /api/district/&lt;id&gt;</span>
          {" "}returns 401/403 with no content. And the hint just <span style={{ color: "var(--red)" }}>glitches</span>:
          there is nothing to find, because clearance is verified by the Fabric, not by anything you can send.
          Free to try — you will get nothing.
        </p>
        {TIDIFIED.map((t) => <TidifiedCard key={t.id} t={t} />)}
      </div>

      {/* claim */}
      <div className="panel" style={{ borderColor: "var(--green)", margin: "16px 0 8px" }}>
        <p className="label" style={{ color: "var(--green)" }}>claim a flag</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input value={flag} onChange={(e) => setFlag(e.target.value)} style={{ ...inp, flex: 1, minWidth: 260 }}
            placeholder="paste the FLAG-… you captured" />
          <button className="nf" disabled={!flag.trim()} onClick={claim}>CLAIM</button>
        </div>
        {claimMsg && <p style={{ fontSize: 11.5, color: claimMsg.startsWith("✓") ? "var(--green)" : "var(--amber)", marginTop: 8, lineHeight: 1.6 }}>{claimMsg}</p>}
        <p style={{ fontSize: 10, color: "var(--dim)", margin: "8px 0 0" }}>
          Claiming runs through your real Tide session — a made-up flag earns nothing. You can break
          Old Town, but you cannot forge your rank.
        </p>
      </div>
    </div>
  );
}

const TIDIFIED = [
  { id: "blackwall", name: "Blackwall Substation", need: "netrunner" },
  { id: "clinic", name: "Chrome Clinic", need: "ripperdoc" },
  { id: "spire", name: "Kaishin Spire", need: "fixer" },
  { id: "drown", name: "The Drown", need: "netrunner" },
  { id: "core", name: "Vault Core (golden)", need: "ghost" },
];

function glitchText(seed: number): string {
  const blocks = "▓▒░█▌▐▚▞╳";
  const words = ["no exploit exists", "the Fabric verifies clearance", "server-side", "no forged input changes it", "signature holds", "nothing to find here"];
  let out = "";
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 4; j++) out += blocks[(seed + i * 7 + j * 3) % blocks.length];
    out += " " + words[(seed + i) % words.length] + " ";
  }
  return out.trim();
}

function TidifiedCard({ t }: { t: { id: string; name: string; need: string } }) {
  const [hint, setHint] = useState<string | null>(null);
  return (
    <div style={{ borderTop: "1px solid var(--edge-soft, #16203c)", padding: "8px 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: "var(--cyan)" }}>{t.name}</span>
        <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--dim)" }}>GET /api/district/{t.id} — needs {t.need}</span>
        <button className="nf" style={{ padding: "3px 8px", fontSize: 10 }} onClick={() => setHint(glitchText(t.id.length * 13))}>
          NEED A HINT? (free)
        </button>
      </div>
      {hint && (
        <p style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--red)", margin: "6px 0 0", letterSpacing: "0.04em" }}>
          H1NT ▸ {hint} <span style={{ color: "var(--green)" }}>[free — there is no exploit]</span>
        </p>
      )}
    </div>
  );
}

function TargetCard({ t, shown, onReveal }: {
  t: (typeof import("./oldtown"))["OLDTOWN"][number];
  shown: number;
  onReveal: () => void;
}) {
  return (
    <div className="panel" style={{ borderColor: "var(--edge)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <h2 style={{ fontSize: 14, margin: 0, color: "var(--text)" }}>
          {t.title} <span style={{ color: "var(--amber)", fontSize: 11 }}>+{t.reward}</span>
        </h2>
        <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--dim)" }}>flag: {t.flagPrefix}.…</span>
      </div>
      <p style={{ fontSize: 11.5, color: "var(--dim)", margin: "8px 0 6px" }}>
        <span style={{ color: "var(--red)" }}>flaw · </span>{t.flaw}
      </p>
      <div style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "#7f93b0", marginBottom: 8 }}>
        {t.endpoints.map((e, i) => (
          <div key={i}><span style={{ color: "var(--amber)" }}>{e.method}</span> {e.path} <span style={{ color: "var(--dim)" }}>— {e.note}</span></div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {shown < t.hints.length && (
          <button className="nf" style={{ padding: "4px 9px", fontSize: 10 }} onClick={onReveal}>
            {shown === 0 ? "NEED A HINT? (−10)" : shown === t.hints.length - 1 ? "REVEAL SOLUTION (→1 pt)" : "ANOTHER HINT (−10)"}
          </button>
        )}
        <span style={{ fontSize: 10, color: shown ? "var(--red)" : "var(--dim)" }}>
          {shown >= t.hints.length ? `solution shown · worth 1` : shown ? `−${shown * 10} · worth ${Math.max(1, t.reward - shown * 10)}` : `full ${t.reward}`}
        </span>
      </div>
      {t.hints.slice(0, shown).map((h, i) => (
        <p key={i} style={{ fontSize: 11.5, lineHeight: 1.65, margin: "8px 0 0",
          color: h.startsWith("SPOILER") ? "var(--amber)" : "var(--text)" }}>
          {h.startsWith("SPOILER") ? <><b>⚠ </b>{h}</> : <>▸ {h}</>}
        </p>
      ))}
    </div>
  );
}
