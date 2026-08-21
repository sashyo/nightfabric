"use client";

import { useEffect, useState } from "react";
import { CODEX, districtsForCodex } from "@/lib/lore";
import { TideMark } from "./TideMark";

/* ------------------------------------------------------------- chrome */

export function Panel({
  title, tint, onClose, children, wide,
}: {
  title: string; tint: string; onClose: () => void; children: React.ReactNode; wide?: boolean;
}) {
  return (
    <div
      style={{
        position: "absolute", inset: 0, display: "grid", placeItems: "center",
        background: "rgba(2,3,10,0.72)", zIndex: 40, backdropFilter: "blur(3px)",
      }}
      onClick={onClose}
    >
      <div
        className="panel"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: wide ? "min(980px, 94vw)" : "min(720px, 94vw)",
          maxHeight: "84vh", overflow: "auto", borderColor: tint,
          boxShadow: `0 0 60px ${tint}22`,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14 }}>
          <h2 style={{ margin: 0, fontSize: 15, letterSpacing: "0.2em", color: tint }}>{title}</h2>
          <button className="nf" onClick={onClose} style={{ padding: "4px 10px" }}>ESC</button>
        </div>
        {children}
      </div>
    </div>
  );
}

const cell: React.CSSProperties = {
  fontSize: 11.5, padding: "8px 10px", borderBottom: "1px solid #16223a", verticalAlign: "top",
};

function Bytes({ n }: { n: number }) {
  return <span style={{ color: "var(--dim)" }}>{n.toLocaleString()} B</span>;
}

/* ------------------------------------------------------------- stash */

export interface StashShard {
  id: string; district: string; sealed: string; bytes: number; at: number;
}

export function StashPanel({
  shards, onDecrypt, onClose,
}: {
  shards: StashShard[];
  onDecrypt: (s: StashShard) => Promise<string>;
  onClose: () => void;
}) {
  const [open, setOpen] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<Record<string, string>>({});

  const reveal = async (s: StashShard) => {
    setBusy(s.id);
    setErr((e) => ({ ...e, [s.id]: "" }));
    try {
      const plain = await onDecrypt(s);
      setOpen((o) => ({ ...o, [s.id]: plain }));
    } catch (e: any) {
      setErr((x) => ({ ...x, [s.id]: e?.message ?? String(e) }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel title="PERSONAL STASH // SELF-ENCRYPTED" tint="var(--cyan)" onClose={onClose} wide>
      <p style={{ fontSize: 11.5, color: "var(--dim)", lineHeight: 1.7, marginTop: 0 }}>
        Each of these was sealed with a key generated fresh for that one call and then encrypted
        across the ORK network. Opening one requires your live session <em>and</em> a threshold of
        nodes to cooperate — it is not a local unwrap. This binding is to your identity, not to a
        role: handing another runner the decrypt role would not let them read a single one of these.
      </p>
      {shards.length === 0 ? (
        <p style={{ fontSize: 12, color: "var(--dim)" }}>Nothing jacked yet. Datashards glow in the districts.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            {shards.map((s) => (
              <tr key={s.id}>
                <td style={{ ...cell, width: 110, color: "var(--cyan)" }}>{s.district}</td>
                <td style={cell}>
                  {open[s.id] ? (
                    <span style={{ color: "var(--green)" }}>{open[s.id]}</span>
                  ) : (
                    <code style={{ color: "#4a5f7a", wordBreak: "break-all", fontSize: 10.5 }}>
                      {s.sealed.slice(0, 96)}…
                    </code>
                  )}
                  {err[s.id] && (
                    <div style={{ color: "var(--red)", fontSize: 10.5, marginTop: 4 }}>{err[s.id]}</div>
                  )}
                </td>
                <td style={{ ...cell, width: 80 }}><Bytes n={s.bytes} /></td>
                <td style={{ ...cell, width: 120 }}>
                  {!open[s.id] && (
                    <button className="nf" disabled={busy === s.id} onClick={() => reveal(s)} style={{ padding: "5px 9px" }}>
                      {busy === s.id ? "ASKING FABRIC…" : "DECRYPT"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

/* -------------------------------------------------------- crew vault */

export interface VaultEntry {
  id: string; authorHandle: string; sealed: string; bytes: number; note: string; at: number;
}

export function VaultPanel({
  policyReady, canOpen, entries, onSeal, onOpen, onClose,
}: {
  policyReady: boolean;
  canOpen: boolean;
  entries: VaultEntry[];
  onSeal: (text: string, lockMinutes: number) => Promise<void>;
  onOpen: (e: VaultEntry) => Promise<string>;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [lock, setLock] = useState(0);
  const [busy, setBusy] = useState(false);
  const [open, setOpenMap] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string>("");

  return (
    <Panel title="CREW VAULT // POLICY-GOVERNED" tint="var(--amber)" onClose={onClose} wide>
      <p style={{ fontSize: 11.5, color: "var(--dim)", lineHeight: 1.7, marginTop: 0 }}>
        Different mechanism from your stash. These drops are sealed with the crew key, and who may
        open them is decided by a policy contract that runs <em>inside every ORK</em> on every
        attempt. Lose the <code>crew-vault-access</code> role and you lose the ability to read drops
        that were sealed before you lost it — which ordinary encryption cannot do, because the
        ciphertext is already out and the key is already known.
      </p>
      <div style={{ marginBottom: 12 }}><TideMark label="SECURED BY TIDE · THRESHOLD E2EE" style={{ color: "var(--amber)", borderColor: "color-mix(in srgb, var(--amber) 45%, transparent)", background: "color-mix(in srgb, var(--amber) 8%, transparent)", textShadow: "0 0 6px color-mix(in srgb, var(--amber) 55%, transparent)" }} /></div>

      {!policyReady && (
        <div className="panel" style={{ borderColor: "var(--red)", marginBottom: 14 }}>
          <p className="label" style={{ color: "var(--red)" }}>vault is dead</p>
          <p style={{ fontSize: 11.5, margin: 0 }}>
            No signed policy on this realm. A council member must sign it once, in their browser, at{" "}
            <a href="/forge">/forge</a>. There is no server-side signing endpoint — the signature can
            only come from an admin&apos;s enclave.
          </p>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="drop contents…"
          style={{
            flex: "1 1 320px", background: "#06080f", border: "1px solid var(--edge)",
            color: "var(--text)", fontFamily: "var(--mono)", fontSize: 12, padding: "8px 10px",
          }}
        />
        <label style={{ fontSize: 11, color: "var(--dim)", display: "flex", alignItems: "center", gap: 6 }}>
          time-lock
          <input
            type="number" min={0} max={1440} value={lock}
            onChange={(e) => setLock(Math.max(0, Number(e.target.value) || 0))}
            style={{
              width: 68, background: "#06080f", border: "1px solid var(--edge)",
              color: "var(--text)", fontFamily: "var(--mono)", fontSize: 12, padding: "8px",
            }}
          />
          min
        </label>
        <button
          className="nf amber"
          disabled={!policyReady || !canOpen || !text.trim() || busy}
          onClick={async () => {
            setBusy(true); setErr("");
            try { await onSeal(text.trim(), lock); setText(""); }
            catch (e: any) { setErr(e?.message ?? String(e)); }
            finally { setBusy(false); }
          }}
        >
          {busy ? "SEALING…" : "SEAL DROP"}
        </button>
      </div>
      {lock > 0 && (
        <p style={{ fontSize: 11, color: "var(--amber)", margin: "0 0 12px" }}>
          Tagged <code>DecryptTimeLock</code>. For the next {lock} minutes the ORK network will
          refuse to reassemble the key — not hide the button, refuse to participate.
        </p>
      )}
      {err && <p style={{ color: "var(--red)", fontSize: 11.5 }}>{err}</p>}

      {entries.length === 0 ? (
        <p style={{ fontSize: 12, color: "var(--dim)" }}>Vault is empty.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td style={{ ...cell, width: 100, color: "var(--amber)" }}>{e.authorHandle}</td>
                <td style={cell}>
                  {open[e.id] ? (
                    <span style={{ color: "var(--green)" }}>{open[e.id]}</span>
                  ) : (
                    <code style={{ color: "#4a5f7a", wordBreak: "break-all", fontSize: 10.5 }}>
                      {e.sealed.slice(0, 90)}…
                    </code>
                  )}
                  {e.note && <div style={{ color: "var(--dim)", fontSize: 10.5, marginTop: 3 }}>{e.note}</div>}
                </td>
                <td style={{ ...cell, width: 80 }}><Bytes n={e.bytes} /></td>
                <td style={{ ...cell, width: 130 }}>
                  {!open[e.id] && (
                    <button
                      className="nf amber"
                      disabled={!policyReady}
                      style={{ padding: "5px 9px" }}
                      onClick={async () => {
                        setErr("");
                        try {
                          const plain = await onOpen(e);
                          setOpenMap((o) => ({ ...o, [e.id]: plain }));
                        } catch (x: any) { setErr(x?.message ?? String(x)); }
                      }}
                    >
                      OPEN
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {!canOpen && (
        <p style={{ fontSize: 11, color: "var(--dim)", marginTop: 12 }}>
          You are holding every byte in this table and cannot read one of them. That is the intended
          state without <code>crew-vault-access</code>.
        </p>
      )}
    </Panel>
  );
}

/* ----------------------------------------------------------- council */

export interface ChangeRequest {
  id: string; actionType: string; summary: string;
  readyToCommit: boolean; authCount: number; threshold: number | null;
}

export function CouncilPanel({
  isCouncil, admins, quorum, pending, onPropose, onSign, onCommit, onRefresh, onClose,
}: {
  isCouncil: boolean;
  admins: string[];
  quorum: number;
  pending: ChangeRequest[];
  onPropose: (username: string) => Promise<string>;
  onSign: (id: string) => Promise<string>;
  onCommit: (id: string) => Promise<string>;
  onRefresh: () => void;
  onClose: () => void;
}) {
  const [who, setWho] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = setInterval(onRefresh, 4000);
    return () => clearInterval(t);
  }, [onRefresh]);

  const run = async (f: () => Promise<string>) => {
    setBusy(true);
    try { setMsg(await f()); } catch (e: any) { setMsg(e?.message ?? String(e)); }
    finally { setBusy(false); onRefresh(); }
  };

  return (
    <Panel title="COUNCIL RELAY // IGA QUORUM" tint="var(--violet)" onClose={onClose} wide>
      <p style={{ fontSize: 11.5, color: "var(--dim)", lineHeight: 1.7, marginTop: 0 }}>
        {admins.length} seated · quorum <strong style={{ color: "var(--violet)" }}>{quorum}</strong>{" "}
        (max(1, floor({admins.length} × 0.7))). Promoting a runner does not change anything by
        itself — it files a change request. Each approval is a threshold signature produced in that
        member&apos;s own browser enclave. The commit is refused with <code>412</code> until the
        quorum is reached, and no amount of database access on this machine shortcuts it.
      </p>
      <p style={{ fontSize: 11, color: "var(--dim)", marginTop: -4 }}>
        Council: {admins.join(", ") || "—"}
      </p>
      <div style={{ margin: "4px 0 8px" }}><TideMark label="SECURED BY TIDE · QUORUM GOVERNED" style={{ color: "var(--violet)", borderColor: "color-mix(in srgb, var(--violet) 45%, transparent)", background: "color-mix(in srgb, var(--violet) 8%, transparent)", textShadow: "0 0 6px color-mix(in srgb, var(--violet) 55%, transparent)" }} /></div>

      {isCouncil ? (
        <div style={{ display: "flex", gap: 8, margin: "14px 0", flexWrap: "wrap" }}>
          <input
            value={who} onChange={(e) => setWho(e.target.value)}
            placeholder="runner handle to promote to ghost…"
            style={{
              flex: "1 1 280px", background: "#06080f", border: "1px solid var(--edge)",
              color: "var(--text)", fontFamily: "var(--mono)", fontSize: 12, padding: "8px 10px",
            }}
          />
          <button className="nf violet" disabled={!who.trim() || busy} onClick={() => run(() => onPropose(who.trim()))}>
            PUT NAME FORWARD
          </button>
        </div>
      ) : (
        <p style={{ fontSize: 11.5, color: "var(--amber)" }}>
          You are not seated. You can watch the queue; you cannot move it.
        </p>
      )}

      {msg && <p style={{ fontSize: 11.5, color: "var(--green)", whiteSpace: "pre-wrap" }}>{msg}</p>}

      <p className="label" style={{ marginTop: 16 }}>pending change requests</p>
      {pending.length === 0 ? (
        <p style={{ fontSize: 12, color: "var(--dim)" }}>Queue is clear.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            {pending.map((cr) => (
              <tr key={cr.id}>
                <td style={{ ...cell, color: "var(--violet)" }}>{cr.actionType || "?"}</td>
                <td style={cell}>{cr.summary}</td>
                <td style={{ ...cell, width: 96, color: cr.readyToCommit ? "var(--green)" : "var(--amber)" }}>
                  {cr.authCount}
                  {cr.threshold != null ? ` / ${cr.threshold}` : ""} signed
                </td>
                <td style={{ ...cell, width: 190 }}>
                  {isCouncil && (
                    <div style={{ display: "flex", gap: 6 }}>
                      <button className="nf violet" disabled={busy} style={{ padding: "5px 8px" }}
                        onClick={() => run(() => onSign(cr.id))}>SIGN</button>
                      <button className="nf" disabled={busy} style={{ padding: "5px 8px" }}
                        onClick={() => run(() => onCommit(cr.id))}>COMMIT</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

/* -------------------------------------------------------------- raid */

export function RaidPanel({ data, onClose }: { data: any; onClose: () => void }) {
  return (
    <Panel title="CORPO RAID // FULL SERVER DUMP" tint="var(--red)" onClose={onClose} wide>
      <p style={{ fontSize: 11.5, color: "var(--dim)", lineHeight: 1.7, marginTop: 0 }}>
        You are now inside. This is everything the operator of Sanctum-9 has, unredacted — the
        complete server-side state, handed over with no authorization check beyond being logged in.
        The interesting question was never whether an attacker gets in. It is what they hold when
        they do.
      </p>
      <ul style={{ fontSize: 11.5, lineHeight: 1.8, color: "var(--text)", paddingLeft: 18 }}>
        {(data?.notes ?? []).map((n: string, i: number) => <li key={i}>{n}</li>)}
      </ul>
      <pre
        style={{
          fontSize: 10.5, lineHeight: 1.5, color: "#5d7793", background: "#05060d",
          border: "1px solid var(--edge)", padding: 12, maxHeight: "40vh", overflow: "auto",
          whiteSpace: "pre-wrap", wordBreak: "break-all",
        }}
      >
        {JSON.stringify(data?.contents ?? {}, null, 2)}
      </pre>
    </Panel>
  );
}

/* --------------------------------------------------------------- npcs */

export interface NpcView {
  id: string;
  name: string;
  tag: string;
  kind: string;
  color: string;
  line: string;
  hackable?: string;
}

/** Decode a JWT payload without verifying it — this is exactly what a thief can do. */
function peek(token: string | null): any {
  if (!token) return null;
  try {
    const p = token.split(".")[1];
    return JSON.parse(atob(p.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null;
  }
}

export function NpcPanel({
  npc, token, onNext, onClose, onHack,
}: {
  npc: NpcView;
  token: string | null;
  onNext: () => void;
  onClose: () => void;
  onHack?: (drone: string) => Promise<{ name: string; secrets: string[]; flag: string } | null>;
}) {
  const [handed, setHanded] = useState(false);
  const [dump, setDump] = useState<{ name: string; secrets: string[]; flag: string } | null>(null);
  const [hacking, setHacking] = useState(false);
  const claims = handed ? peek(token) : null;
  const jkt = claims?.cnf?.jkt ?? null;

  return (
    <Panel title={`${npc.name} — ${npc.tag}`} tint={npc.color} onClose={onClose}>
      <p style={{ fontSize: 13, lineHeight: 1.85, color: "var(--text)", marginTop: 0 }}>
        &ldquo;{npc.line}&rdquo;
      </p>

      {npc.hackable && !dump && (
        <div style={{ marginTop: 16 }}>
          <button className="nf amber" disabled={hacking}
            onClick={async () => { setHacking(true); try { const d = await onHack?.(npc.hackable!); if (d) setDump(d); } finally { setHacking(false); } }}>
            {hacking ? "PROBING SOCKET…" : "HACK DRONE"}
          </button>
          <p style={{ fontSize: 11, color: "var(--dim)", marginTop: 10, lineHeight: 1.7 }}>
            It runs the old stack — no doken, no threshold. Its data socket authorizes nobody.
          </p>
        </div>
      )}
      {dump && (
        <div className="panel" style={{ borderColor: "var(--amber)", marginTop: 16 }}>
          <p className="label" style={{ color: "var(--amber)" }}>exfiltrated · {dump.name}</p>
          <ul style={{ fontSize: 11.5, lineHeight: 1.7, color: "var(--text)", paddingLeft: 16, margin: "0 0 10px" }}>
            {dump.secrets.map((sx, i) => <li key={i}>{sx}</li>)}
          </ul>
          <p style={{ fontSize: 11, color: "var(--green)", margin: 0, wordBreak: "break-all" }}>
            flag captured: <code>{dump.flag}</code> — claim it at the BREACH TERMINAL for points.
          </p>
          <p style={{ fontSize: 10.5, color: "var(--dim)", margin: "8px 0 0", lineHeight: 1.6 }}>
            A Tide-secured drone would have handed you nothing — identity checked, data sealed. This
            one trusted the network. That is the difference.
          </p>
        </div>
      )}
      {npc.kind === "phisher" && !npc.hackable && !handed && (
        <div style={{ marginTop: 18 }}>
          <button className="nf red" onClick={() => setHanded(true)}>
            HAND OVER YOUR DOKEN
          </button>
          <p style={{ fontSize: 11, color: "var(--dim)", marginTop: 10, lineHeight: 1.7 }}>
            Go ahead. This is a local game and it is your own token — the point is to look at what
            he actually walks away with.
          </p>
        </div>
      )}

      {handed && (
        <div className="panel" style={{ borderColor: "var(--red)", marginTop: 18 }}>
          <p className="label" style={{ color: "var(--red)" }}>what sable now holds</p>
          <p style={{ fontSize: 11.5, lineHeight: 1.8, margin: "0 0 12px" }}>
            Your roles, your handle, and the ability to <em>fetch</em> your sealed shards until this
            token expires. Real damage — read it as such. Now the part he was not counting on:
          </p>

          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <tbody>
              <tr>
                <td style={{ ...cell, width: 110, color: "var(--dim)" }}>expires in</td>
                <td style={cell}>
                  {claims?.exp
                    ? `${Math.max(0, claims.exp - Math.floor(Date.now() / 1000))}s — then it is scrap`
                    : "—"}
                </td>
              </tr>
              <tr>
                <td style={{ ...cell, color: "var(--dim)" }}>cnf.jkt</td>
                <td style={cell}>
                  {jkt ? (
                    <code style={{ color: "var(--green)", wordBreak: "break-all" }}>{jkt}</code>
                  ) : (
                    <span style={{ color: "var(--amber)" }}>
                      absent — this token is not DPoP-bound
                    </span>
                  )}
                </td>
              </tr>
              <tr>
                <td style={{ ...cell, color: "var(--dim)" }}>decrypt</td>
                <td style={{ ...cell, color: "var(--green)" }}>
                  impossible without your enclave session
                </td>
              </tr>
            </tbody>
          </table>

          <p style={{ fontSize: 11.5, lineHeight: 1.8, margin: "12px 0 0", color: "var(--dim)" }}>
            {jkt ? (
              <>
                That <code>cnf.jkt</code> is a thumbprint of a key pair generated in your browser and
                never sent anywhere. Every request has to be signed by it, and refreshing needs it
                too — so replaying this token from Sable&apos;s deck fails, and it dies on its own in
                minutes.
              </>
            ) : (
              <>
                No confirmation claim on this token, so it is bearer-only: whoever holds it can use
                it until it expires. That is the state DPoP exists to prevent — check that{" "}
                <code>useDPoP</code> is set in the provider.
              </>
            )}{" "}
            Either way the shards stay shut. Decryption needs a threshold of ORKs to co-operate with
            a live session key that lives in your enclave iframe and dies when you close the tab. He
            has your ciphertext. He is going to keep having your ciphertext.
          </p>
        </div>
      )}

      <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
        <button className="nf" onClick={onNext}>SAY MORE</button>
        <button className="nf magenta" onClick={onClose}>WALK AWAY</button>
      </div>
    </Panel>
  );
}

/* --------------------------------------------------------------- nuke */

export interface NukeState {
  role: string;
  isCouncil: boolean;
  admins: string[];
  quorum: number;
  armed: boolean;
  requests: { id: string; actionType: string; readyToCommit: boolean; authCount: number; threshold: number | null }[];
}

export function NukePanel({
  state, onArm, onDisarm, onSign, onDetonate, onRefresh, onClose,
}: {
  state: NukeState;
  onArm: () => Promise<string>;
  onDisarm: () => Promise<string>;
  onSign: (id: string) => Promise<string>;
  onDetonate: () => Promise<string>;
  onRefresh: () => void;
  onClose: () => void;
}) {
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    const t = setInterval(onRefresh, 4000);
    return () => clearInterval(t);
  }, [onRefresh]);

  const run = async (f: () => Promise<string>) => {
    setBusy(true);
    try { setMsg(await f()); } catch (e: any) { setMsg(e?.message ?? String(e)); }
    finally { setBusy(false); onRefresh(); }
  };

  const signed = state.requests.reduce((n, r) => Math.max(n, r.authCount), 0);
  const ready = state.requests.length > 0 && state.requests.every((r) => r.readyToCommit);

  return (
    <Panel title="BLACKWALL PROTOCOL" tint="var(--red)" onClose={onClose} wide>
      <p style={{ fontSize: 12, color: "var(--text)", lineHeight: 1.85, marginTop: 0 }}>
        Strips <code>{state.role}</code> from every runner in Sanctum-9. Every crew drop ever sealed
        becomes unopenable — <strong>including the ones people read yesterday</strong> — because the
        ORKs run the contract fresh on each decrypt and check the role in the doken at that moment.
      </p>
      <p style={{ fontSize: 11.5, color: "var(--dim)", lineHeight: 1.8 }}>
        Ordinary encryption cannot do that. Once a key is out, ciphertext already in the wild stays
        readable forever and &ldquo;revocation&rdquo; is a promise about future requests. Here it is
        retroactive, and the network is what enforces it.
      </p>

      <div className="panel" style={{ borderColor: "var(--amber)", margin: "16px 0" }}>
        <p className="label" style={{ color: "var(--amber)" }}>why this button is safe to leave lying around</p>
        <p style={{ fontSize: 11.5, margin: 0, lineHeight: 1.8 }}>
          Arming it detonates nothing. It files change requests that need{" "}
          <strong style={{ color: "var(--red)" }}>{state.quorum}</strong> of{" "}
          {state.admins.length} council enclave signatures. There is no path on this server — not
          this route, not the master admin credential, not the database — that can supply one.
          Someone who owned the whole host could press it all day.
        </p>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 14, margin: "18px 0" }}>
        <div style={{
          width: 110, height: 110, borderRadius: "50%",
          border: `3px solid ${state.armed ? "var(--red)" : "#2f4258"}`,
          display: "grid", placeItems: "center",
          boxShadow: state.armed ? "0 0 40px rgba(255,43,70,0.45)" : "none",
        }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 26, color: state.armed ? "var(--red)" : "#2f4258" }}>
              {signed}/{state.quorum}
            </div>
            <div style={{ fontSize: 8.5, letterSpacing: "0.2em", color: "var(--dim)" }}>SIGNED</div>
          </div>
        </div>
        <div style={{ fontSize: 12, lineHeight: 1.8 }}>
          <div style={{ color: state.armed ? "var(--red)" : "var(--dim)", letterSpacing: "0.16em" }}>
            {state.armed ? (ready ? "QUORUM MET — READY TO COMMIT" : "ARMED — AWAITING SIGNATURES") : "SAFE"}
          </div>
          <div style={{ color: "var(--dim)", fontSize: 11 }}>
            council: {state.admins.join(", ") || "—"}
          </div>
        </div>
      </div>

      {!state.isCouncil && (
        <p style={{ fontSize: 11.5, color: "var(--amber)" }}>
          You are not seated. You can watch the counter move; you cannot move it.
        </p>
      )}

      {state.isCouncil && !state.armed && (
        confirm ? (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: 11.5, color: "var(--red)" }}>
              File {state.admins.length ? "revocations" : "revocations"} against every crew member?
            </span>
            <button className="nf red" disabled={busy} onClick={() => { setConfirm(false); run(onArm); }}>
              YES — ARM IT
            </button>
            <button className="nf" onClick={() => setConfirm(false)}>CANCEL</button>
          </div>
        ) : (
          <button className="nf red" disabled={busy} onClick={() => setConfirm(true)}>
            ARM THE PROTOCOL
          </button>
        )
      )}

      {state.isCouncil && state.armed && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className="nf red" disabled={busy}
            onClick={() => run(async () => {
              const out: string[] = [];
              for (const r of state.requests) out.push(await onSign(r.id));
              return out.join("\n");
            })}>
            SIGN ALL ({state.requests.length})
          </button>
          <button className="nf red" disabled={busy} onClick={() => run(onDetonate)}>
            DETONATE
          </button>
          <button className="nf magenta" disabled={busy} onClick={() => run(onDisarm)}>
            DISARM
          </button>
        </div>
      )}

      {msg && (
        <pre style={{ fontSize: 11, color: "var(--green)", whiteSpace: "pre-wrap", marginTop: 14 }}>
          {msg}
        </pre>
      )}

      {state.requests.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 14 }}>
          <tbody>
            {state.requests.map((r) => (
              <tr key={r.id}>
                <td style={{ ...cell, color: "var(--red)", width: 190 }}>{r.actionType}</td>
                <td style={{ ...cell, color: r.readyToCommit ? "var(--green)" : "var(--amber)" }}>
                  {r.authCount}{r.threshold != null ? ` / ${r.threshold}` : ""} signed
                  {r.readyToCommit ? " · ready" : " · under quorum"}
                </td>
                <td style={{ ...cell, fontSize: 9.5, color: "#3f5876" }}>{r.id.slice(0, 8)}…</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

/* --------------------------------------------------------------- codex */


export function CodexPanel({
  clearances, onClose,
}: {
  clearances: { id: string; granted: boolean; clearance: string | null }[];
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"districts" | string>("districts");
  const districts = districtsForCodex();

  return (
    <Panel title="DATAPAD // SANCTUM-9 CODEX" tint="var(--cyan)" onClose={onClose} wide>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
        <button
          className="nf"
          onClick={() => setTab("districts")}
          style={{ padding: "4px 10px", fontSize: 9.5, opacity: tab === "districts" ? 1 : 0.5 }}
        >
          DISTRICTS
        </button>
        {CODEX.map((c) => (
          <button
            key={c.key}
            className="nf"
            onClick={() => setTab(c.key)}
            style={{ padding: "4px 10px", fontSize: 9.5, opacity: tab === c.key ? 1 : 0.5 }}
          >
            {c.title.toUpperCase()}
          </button>
        ))}
      </div>

      {tab === "districts" ? (
        <div>
          <p style={{ fontSize: 11.5, color: "var(--dim)", lineHeight: 1.75, marginTop: 0 }}>
            Clearance is not bought and cannot be self-granted. A gate reads the roles signed into
            your doken; higher clearance is ratified by the council quorum. Green rows are open to you
            right now.
          </p>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <tbody>
              {districts.map((d) => {
                const c = clearances.find((x) => x.id === d.id);
                const ok = c?.granted ?? d.clearance === null;
                return (
                  <tr key={d.id}>
                    <td style={{ ...cell, width: 150, color: ok ? "var(--green)" : "var(--cyan)", verticalAlign: "top" }}>
                      {d.name}
                      <div style={{ fontSize: 9, color: "var(--dim)" }}>{d.lore.era}</div>
                    </td>
                    <td style={{ ...cell, width: 96, color: ok ? "var(--green)" : "var(--red)", verticalAlign: "top" }}>
                      {ok ? "OPEN" : d.clearance}
                    </td>
                    <td style={cell}>
                      <div style={{ color: "var(--text)", marginBottom: 4 }}>{d.lore.history}</div>
                      <div style={{ color: "var(--amber)", fontSize: 10.5 }}>{d.lore.clearance}</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        (() => {
          const e = CODEX.find((c) => c.key === tab)!;
          return (
            <div>
              <h3 style={{ fontSize: 15, color: "var(--cyan)", margin: "0 0 12px", letterSpacing: "0.08em" }}>
                {e.title}
              </h3>
              {e.body.map((para, i) => (
                <p key={i} style={{ fontSize: 12, color: "var(--text)", lineHeight: 1.9, margin: "0 0 12px" }}>
                  {para}
                </p>
              ))}
            </div>
          );
        })()
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------- devices */

export function DevicePanel({
  device, dtype, label, onExploit, onClose,
}: {
  device: string;
  dtype: string;
  label: string;
  onExploit: (device: string, body: any) => Promise<any>;
  onClose: () => void;
}) {
  const [fields, setFields] = useState<Record<string, string>>({});
  const [res, setRes] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const set = (k: string, v: string) => setFields((f) => ({ ...f, [k]: v }));
  const inp: React.CSSProperties = {
    background: "#06080f", border: "1px solid var(--edge)", color: "var(--text)",
    fontFamily: "var(--mono)", fontSize: 12, padding: "8px 10px",
  };

  const config: Record<string, { flaw: string; fields: { k: string; ph: string; type?: string }[]; body: () => any }> = {
    vending: { flaw: "the price is whatever the client sends", fields: [{ k: "price", ph: "price in eddies", type: "number" }], body: () => ({ price: Number(fields.price) }) },
    cctv: { flaw: "off-the-shelf camera, shipped credentials", fields: [{ k: "user", ph: "username" }, { k: "pass", ph: "password" }], body: () => ({ user: fields.user, pass: fields.pass }) },
    keypad: { flaw: "4-digit PIN, no lockout, no log", fields: [{ k: "pin", ph: "PIN" }], body: () => ({ pin: fields.pin }) },
    billboard: { flaw: "renders whatever you submit, unsanitized", fields: [{ k: "content", ph: "text to put on the sign" }], body: () => ({ content: fields.content }) },
  };
  const c = config[dtype] ?? config.vending;

  const go = async () => {
    setBusy(true); setRes(null);
    try { setRes(await onExploit(device, c.body())); } finally { setBusy(false); }
  };

  return (
    <Panel title={`${label} // LEGACY DEVICE`} tint="var(--amber)" onClose={onClose}>
      <p style={{ fontSize: 11.5, color: "var(--dim)", lineHeight: 1.7, marginTop: 0 }}>
        Un-tidified street hardware. <span style={{ color: "var(--red)" }}>flaw · </span>{c.flaw}.
        Break it yourself — the device only yields a flag when you actually pull off the exploit.
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "10px 0" }}>
        {c.fields.map((f) => (
          <input key={f.k} type={f.type ?? "text"} value={fields[f.k] ?? ""} placeholder={f.ph}
            onChange={(e) => set(f.k, e.target.value)} style={{ ...inp, flex: "1 1 140px" }} />
        ))}
        <button className="nf amber" disabled={busy} onClick={go}>{busy ? "…" : "EXPLOIT"}</button>
      </div>
      {res && (
        <div className="panel" style={{ borderColor: res.ok ? "var(--amber)" : "var(--edge)", marginTop: 8 }}>
          {res.ok ? (
            <>
              <p style={{ fontSize: 12, color: "var(--amber)", fontWeight: 700, margin: "0 0 6px" }}>☠ EXPLOITED</p>
              <p style={{ fontSize: 11.5, color: "var(--text)", lineHeight: 1.7, margin: "0 0 8px" }}>{res.result}</p>
              {res.rendered && (
                <div style={{ border: "1px solid var(--cyan)", padding: "10px 12px", margin: "0 0 8px", textAlign: "center", color: "var(--cyan)", fontFamily: "var(--mono)" }}>
                  {res.rendered}
                </div>
              )}
              <p style={{ fontSize: 11, color: "var(--green)", margin: 0, wordBreak: "break-all" }}>
                flag: <code>{res.flag}</code> — claim it at the BREACH TERMINAL.
              </p>
            </>
          ) : (
            <p style={{ fontSize: 11.5, color: "var(--dim)", margin: 0 }}>▸ {res.hint}</p>
          )}
        </div>
      )}
    </Panel>
  );
}

/* ---------------------------------------------------------------- HackPanel */

interface HackChallengeUI {
  kind: string;
  flag: string;
  title: string;
  weakness: string;
  recon: string;
  field: { name: string; label: string; placeholder: string };
}

/**
 * The gate hack console. Each legacy district falls to a DIFFERENT real attack;
 * this console fetches the challenge and lets you actually run it — forge an
 * unsigned JWT, crack a hash with a rainbow table, replay a sniffed token, use
 * default creds, inject SQL, brute-force a PIN, or paste a leaked key. No magic
 * button: the server verifies the genuine exploit, and only the golden Vault
 * Core has no such path.
 */
export function HackPanel({
  districtId, onProbe, onFetch, onRun, onClose,
}: {
  districtId: string;
  onProbe: () => Promise<HackChallengeUI | null>;
  onFetch: (path: string) => Promise<any>;
  onRun: (submission: Record<string, unknown>) => Promise<{ ok: boolean; detail: string }>;
  onClose: () => void;
}) {
  const [c, setC] = useState<HackChallengeUI | null>(null);
  const [val, setVal] = useState("");
  const [busy, setBusy] = useState(false);
  const [msgs, setMsgs] = useState<{ ok: boolean; text: string }[]>([]);
  const [auto, setAuto] = useState("");

  useEffect(() => { onProbe().then(setC).catch(() => setC(null)); }, [onProbe]);

  const push = (ok: boolean, text: string) => setMsgs((m) => [...m.slice(-40), { ok, text }]);

  const inp: React.CSSProperties = {
    background: "#06080f", border: "1px solid var(--edge)", color: "var(--text)",
    fontFamily: "var(--mono)", fontSize: 12.5, padding: "9px 11px", width: "100%",
  };

  // Build the submission for a raw value, applying the alg:none forge if needed.
  const submissionFor = (raw: string): Record<string, unknown> => {
    if (!c) return {};
    if (c.kind === "alg-none") {
      const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const role = raw.trim() || "resident";
      return { token: `${b64({ alg: "none", typ: "JWT" })}.${b64({ role, sub: "runner", iss: "oldtown" })}.` };
    }
    return { [c.field.name]: raw };
  };

  const attempt = async (raw: string) => {
    if (!c || busy) return;
    setBusy(true);
    const r = await onRun(submissionFor(raw));
    push(r.ok, r.detail);
    setBusy(false);
    return r.ok;
  };

  // Automated attacks — genuinely iterate against the (unthrottled) gate.
  const RAINBOW = ["password","123456","letmein","admin","trustno1","qwerty","dragon","monkey","iloveyou","000000","sunshine","princess","football","welcome","shadow","master","hunter2","superman"];
  const runRainbow = async () => {
    if (!c || busy) return; setBusy(true);
    for (const w of RAINBOW) {
      setAuto(`rainbow table → ${w}`);
      const r = await onRun({ [c.field.name]: w });
      if (r.ok) { push(true, `cracked: "${w}" — ${r.detail}`); setAuto(""); setBusy(false); return; }
    }
    push(false, "wordlist exhausted — not in this table"); setAuto(""); setBusy(false);
  };
  const runBrute = async () => {
    if (!c || busy) return; setBusy(true);
    for (let i = 0; i <= 9999; i++) {
      const pin = String(i).padStart(4, "0");
      setAuto(`brute-force → ${pin}`);
      const r = await onRun({ [c.field.name]: pin });
      if (r.ok) { push(true, `opened on ${pin} — ${r.detail}`); setAuto(""); setBusy(false); return; }
      if (i > 40) { push(false, "…(stopped after 40 tries — the point is there is NO lockout to stop this)"); break; }
    }
    setAuto(""); setBusy(false);
  };
  const pullConfig = async () => {
    setBusy(true);
    const j = await onFetch("/api/legacy/config");
    const key = j?.ADMIN_API_KEY || j?.config?.ADMIN_API_KEY || (typeof j === "object" ? Object.values(j).find((v) => String(v).startsWith("sk_live_")) : "");
    if (key) { setVal(String(key)); push(true, `pulled key from /api/legacy/config → ${key}`); }
    else push(false, "no key field found in the config response");
    setBusy(false);
  };

  if (!c) return (
    <Panel title="HACK CONSOLE" tint="var(--amber)" onClose={onClose}>
      <p style={{ fontSize: 12, color: "var(--dim)" }}>probing the gate…</p>
    </Panel>
  );

  const isForge = c.kind === "alg-none";

  return (
    <Panel title={`HACK CONSOLE // ${c.title}`} tint="var(--amber)" onClose={onClose} wide>
      <p style={{ fontSize: 12.5, color: "var(--text)", lineHeight: 1.7, margin: "0 0 8px" }}>
        <span style={{ color: "var(--red)" }}>WEAKNESS · </span>{c.weakness}
      </p>
      <p style={{ fontSize: 11.5, color: "var(--dim)", lineHeight: 1.7, margin: "0 0 14px" }}>
        <span style={{ color: "var(--cyan)" }}>RECON · </span>{c.recon}
      </p>

      <p className="label" style={{ margin: "0 0 6px" }}>{isForge ? "role to forge into the payload" : c.field.label}</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          style={{ ...inp, flex: 1, minWidth: 220 }}
          value={val}
          placeholder={isForge ? "resident" : c.field.placeholder}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") attempt(val); }}
          disabled={busy}
        />
        <button className="nf" style={{ padding: "8px 14px" }} disabled={busy} onClick={() => attempt(val)}>
          {isForge ? "FORGE & SUBMIT" : "RUN EXPLOIT"}
        </button>
      </div>

      {/* per-attack helpers */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
        {c.kind === "rainbow" && (
          <button className="nf" style={{ padding: "6px 12px", fontSize: 11 }} disabled={busy} onClick={runRainbow}>▶ RUN RAINBOW TABLE</button>
        )}
        {c.kind === "weak-pin" && (
          <button className="nf" style={{ padding: "6px 12px", fontSize: 11 }} disabled={busy} onClick={runBrute}>▶ BRUTE-FORCE 0000→9999</button>
        )}
        {c.kind === "leaked-key" && (
          <button className="nf" style={{ padding: "6px 12px", fontSize: 11 }} disabled={busy} onClick={pullConfig}>▶ PULL /api/legacy/config</button>
        )}
        {c.kind === "sqli" && (
          <button className="nf" style={{ padding: "6px 12px", fontSize: 11 }} disabled={busy} onClick={() => setVal("' OR '1'='1' --")}>▶ USE CLASSIC PAYLOAD</button>
        )}
        {c.kind === "default-creds" && (
          <button className="nf" style={{ padding: "6px 12px", fontSize: 11 }} disabled={busy} onClick={() => setVal("admin:admin")}>▶ TRY admin:admin</button>
        )}
      </div>

      {auto && <p style={{ fontSize: 11, color: "var(--amber)", margin: "10px 0 0", fontFamily: "var(--mono)" }}>⟳ {auto}</p>}

      {msgs.length > 0 && (
        <div style={{ marginTop: 14, background: "#06080f", border: "1px solid var(--edge)", padding: "8px 10px", maxHeight: 160, overflow: "auto" }}>
          {msgs.map((m, i) => (
            <p key={i} style={{ fontSize: 11, margin: "2px 0", fontFamily: "var(--mono)", color: m.ok ? "var(--green)" : "var(--dim)" }}>
              {m.ok ? "✔ " : "✕ "}{m.text}
            </p>
          ))}
        </div>
      )}

      <p style={{ fontSize: 10, color: "var(--dim)", margin: "12px 0 0", lineHeight: 1.6 }}>
        This gate runs the old stack — there IS a way in. The one gate with no such path is the golden Vault Core: it verifies a threshold signature no client can forge.
      </p>
    </Panel>
  );
}
