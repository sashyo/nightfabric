"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTideCloak } from "@tidecloak/nextjs";
import { Nightfabric, type Focus, type GameEvent } from "@/game/engine";
import {
  DISTRICTS, DISTRICT_BY_ID, DATASHARD_TAG, CREW_VOUCHER_TAG,
  type DistrictId,
} from "@/lib/districts";
import {
  StashPanel, VaultPanel, CouncilPanel, RaidPanel, NpcPanel, NukePanel, CodexPanel, DevicePanel, HackPanel,
  type StashShard, type VaultEntry, type ChangeRequest, type NukeState,
} from "./Panels";
import { NPCS_BY_ID, AMBIENT_CHATTER } from "@/lib/npcs";
import { changeRequests, roles as tcRoles } from "@/lib/tcAdmin";
import { ATTACKS } from "../breach/attacks";
import { STARTER_CONTRACTS, type Contract } from "@/game/contracts";
import { CREW_ROLE } from "@/lib/districts";
import { TideMark } from "./TideMark";

/* ---------------------------------------------------------------- types */

interface Me {
  vuid: string; handle: string; roles: string[]; isCouncil: boolean; tokenExp: number;
  clearances: { id: DistrictId; granted: boolean; clearance: string | null }[];
}
type Tone = "ok" | "deny" | "info" | "crypto";
interface Trace { id: number; tone: Tone; head: string; body: string }

/**
 * secureFetch builds the DPoP proof from `new URL(url).origin`, which throws on
 * a relative path ("Failed to construct 'URL': Invalid URL"). Every call must be
 * absolute. Same-origin either way — this only satisfies the URL parser.
 */
const api = (p: string) => new URL(p, window.location.origin).toString();

const TONE: Record<Tone, string> = {
  ok: "var(--green)", deny: "var(--red)", info: "var(--dim)", crypto: "var(--cyan)",
};

/** Test network ships 5 ORKs at threshold 3; mainnet is 20 at 14. Never hardcode as truth. */
const ORKS = 5;
const THRESHOLD = 3;

export default function Play() {
  const {
    authenticated, isInitializing, token, logout,
    secureFetch, doEncrypt, doDecrypt, IAMService, forceRefreshToken,
  } = useTideCloak();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Nightfabric | null>(null);
  const payloads = useRef(new Map<string, string>());
  const focusRef = useRef<Focus | null>(null);
  const seq = useRef(0);

  const [me, setMe] = useState<Me | null>(null);
  const [focus, setFocus] = useState<Focus | null>(null);
  const [hud, setHud] = useState({ x: 0, z: 0, district: null as DistrictId | null, fps: 60 });
  const hudRef = useRef<DistrictId | null>(null);
  const lastBlast = useRef<number>(0);
  const [flash, setFlash] = useState(0);
  const [cityDark, setCityDark] = useState(false);
  const [glitch, setGlitch] = useState(false);
  const [contracts, setContracts] = useState<Contract[]>(() =>
    STARTER_CONTRACTS.map((c) => ({ ...c })),
  );
  const [eddies, setEddies] = useState(0);
  const [muted, setMuted] = useState(false);
  const [reward, setReward] = useState<string | null>(null);
  const [bounties, setBounties] = useState<
    { id: string; title: string; hint: string; event: string; count: number; have: number; reward: number; done: boolean }[]
  >([]);
  const [lamp, setLamp] = useState(false);
  const [exposure, setExposure] = useState(1.85);
  const [chat, setChat] = useState<
    { seq: number; vuid: string; handle: string; roles: string[]; text: string; at: number }[]
  >([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const chatSeq = useRef(0);
  const [wire, setWire] = useState<
    { seq: number; kind: string; handle: string; text: string; at: number }[]
  >([]);
  const wireSeq = useRef(0);
  const chatInput = useRef<HTMLInputElement>(null);
  const [trace, setTrace] = useState<Trace[]>([]);
  const [panel, setPanel] = useState<null | "stash" | "vault" | "council" | "raid" | "npc" | "nuke" | "codex" | "device" | "hack">(null);
  const [talking, setTalking] = useState<{ id: string; line: number } | null>(null);
  const [device, setDevice] = useState<{ device: string; dtype: string; label: string } | null>(null);
  const [hackDistrict, setHackDistrict] = useState<DistrictId | null>(null);
  const [inside, setInside] = useState<DistrictId | null>(null);

  const [stash, setStash] = useState<StashShard[]>([]);
  const [vault, setVault] = useState<{ policyReady: boolean; canOpen: boolean; entries: VaultEntry[] }>({
    policyReady: false, canOpen: false, entries: [],
  });
  const [council, setCouncil] = useState<{
    isCouncil: boolean; admins: string[]; quorum: number; pending: ChangeRequest[];
  }>({ isCouncil: false, admins: [], quorum: 1, pending: [] });
  const [raid, setRaid] = useState<any>(null);
  const [board, setBoard] = useState<{ rank: number; handle: string; points: number; flags: number; districts: number; you: boolean }[]>([]);
  const [online, setOnline] = useState<
    { handle: string; roles: string[]; district: string | null; x: number; z: number }[]
  >([]);
  const [nuke, setNuke] = useState<NukeState>({
    role: "crew-vault-access", isCouncil: false, admins: [], quorum: 1, armed: false, requests: [],
  });

  const log = useCallback((tone: Tone, head: string, body: string) => {
    setTrace((t) => [{ id: seq.current++, tone, head, body }, ...t].slice(0, 40));
  }, []);

  // Map a trace event to an SFX cue by keyword — one place, so new logs get
  // sound for free.
  const sfx = useCallback((cue: string) => engineRef.current?.sfx.play(cue), []);

  // Advance any contract watching for this event. Restoring on refresh would
  // need persistence we do not have; a fresh session gets a fresh checklist,
  // which for an onboarding coach is fine.
  // Fire an SFX cue for an event. (Quest/eddie rewards removed — points come
  // only from real hacking and clearances now.)
  const progress = useCallback((_event: string) => {}, []);

  const loadMe = useCallback(async () => {
    try {
      const res = await secureFetch(api("/api/whoami"));
      if (!res.ok) return;
      const j: Me = await res.json();
      setMe(j);
      for (const c of j.clearances) {
        if (c.id !== "sprawl") engineRef.current?.setClearance(c.id, c.granted ? true : null);
      }
    } catch { /* HUD degrades quietly; the gates still enforce */ }
  }, [secureFetch]);

  const loadBoard = useCallback(async () => {
    try {
      const j = await (await secureFetch(api("/api/score"))).json();
      setBoard(j.board ?? []);
      if (typeof j.mine === "number") setEddies(j.mine);   // eddies ARE your points
    } catch { /* ignore */ }
  }, [secureFetch]);

  // Apply a granted response — shared by legitimate clearance and by a
  // successful exploit. `hacked` flips the copy from "cleared" to "HACKED".
  const enterDistrict = useCallback(
    (id: DistrictId, j: any, hacked: boolean) => {
      const d = DISTRICT_BY_ID[id];
      engineRef.current?.setClearance(id, true);
      engineRef.current?.setShards(id, j.shards ?? []);
      for (const shard of j.shards ?? []) payloads.current.set(shard.id, shard.payload);
      if (hacked) {
        sfx("hack"); progress("ice");
        log("deny", `☠ HACKED · ${d.name}`, `${j.detail ?? "exploit succeeded"} ${j.awarded ? `+${j.awarded} pts.` : ""} a tidified gate would never fall to this.`);
        if (j.flag) log("ok", "flag captured", `${j.flag} — cash it at the BREACH TERMINAL`);
      } else {
        sfx("gate"); progress("gate-pass");
        log("ok", `200 · ${d.name}`, `clearance verified against the doken signature · ${(j.shards ?? []).length} datashards released`);
      }
      if (j.awarded > 0) {
        setReward(`${hacked ? "☠ HACKED" : "◆"} ${d.name} — +${j.awarded} pts`);
        engineRef.current?.sfx.play("commit");
        setTimeout(() => setReward(null), 3000);
        loadBoard();
      }
    },
    [sfx, log, progress, loadBoard],
  );

  // Probe a gate. Grants immediately if you legitimately hold the clearance (or
  // it is open). Legacy gates return an exploit challenge instead of opening —
  // you have to actually run the attack (the hack console, opened with E).
  const askGate = useCallback(
    async (id: DistrictId) => {
      const d = DISTRICT_BY_ID[id];
      try {
        const res = await secureFetch(api(`/api/district/${id}`));
        const j = await res.json();
        if (res.ok && j.granted) { enterDistrict(id, j, false); return; }
        engineRef.current?.setClearance(id, false);
        if (j.legacy && j.hack) {
          log("info", `legacy gate · ${d.name}`, `${j.hack.title}. it runs the old stack — press E at the gate to break in.`);
        } else if (!d.legacy) {
          log("deny", `403 · ${d.name}`, `${j.refusal ?? "refused"}${j.required ? ` · needs ${j.required}` : ""}`);
        }
      } catch (e: any) {
        log("deny", "gate error", e?.message ?? String(e));
      }
    },
    [secureFetch, log, enterDistrict],
  );

  // Submit an exploit attempt for a legacy gate. Returns the server's verdict so
  // the console can show progress; enters the district on success.
  const runHack = useCallback(
    async (id: DistrictId, submission: Record<string, unknown>): Promise<{ ok: boolean; detail: string }> => {
      try {
        const res = await secureFetch(api(`/api/district/${id}`), {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(submission),
        });
        const j = await res.json().catch(() => ({}));
        if (res.ok && j.granted) {
          enterDistrict(id, j, true);
          setPanel(null); setHackDistrict(null);
          return { ok: true, detail: j.detail ?? "exploit succeeded" };
        }
        return { ok: false, detail: j.detail ?? j.refusal ?? "exploit rejected" };
      } catch (e: any) {
        return { ok: false, detail: e?.message ?? String(e) };
      }
    },
    [secureFetch, enterDistrict],
  );

  const doFun = useCallback(
    (action: string) => {
      if (action === "claw") {
        const prizes = ["a chipped eddie", "half a ramen coupon", "NOTHING (rigged, obviously)", "a mystery datachip", "one (1) synth-cat sticker", "your dignity, briefly"];
        const won = prizes[Math.floor(Math.random() * prizes.length)];
        engineRef.current?.pulseFabric(2, 0xff2d95); sfx("claw");
        log("info", "LUCKY CLAW", `the claw descends… you win: ${won}`);
      } else if (action === "graffiti") {
        const tag = me?.handle ?? "runner";
        secureFetch(api("/api/chat"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: `▓▒░ ${tag} woz ‘ere ░▒▓` }) }).catch(() => {});
        progress("graffiti");
        log("ok", "TAG WALL", "sprayed. the whole street can read it — and so can the server. (this one is not encrypted, that is the joke)");
      } else if (action === "juke") {
        const tracks = ["NEON RAIN (slowed)", "BLACKWALL BREAKS", "vuid://midnight", "THRESHOLD (extended mix)", "ORK FUNK vol.3", "cvk lullaby"];
        const track = tracks[Math.floor(Math.random() * tracks.length)];
        engineRef.current?.pulseFabric(3, 0xb46cff); sfx("juke");
        log("info", "SYNTH JUKE", `now playing: ${track} ♪`);
      }
    },
    [me, secureFetch, log, sfx, progress],
  );

  // Build the world once authenticated.
  useEffect(() => {
    if (!authenticated || !canvasRef.current || engineRef.current) return;
    const onEvent = (e: GameEvent) => {
      if (e.type === "tick") { hudRef.current = e.district; setHud({ x: e.x, z: e.z, district: e.district, fps: e.fps }); }
      else if (e.type === "focus") { focusRef.current = e.focus; setFocus(e.focus); }
      else if (e.type === "gateApproach") askGate(e.district);
      else if (e.type === "interior") setInside(e.district);
    };
    const nf = new Nightfabric(canvasRef.current, onEvent, ORKS);
    engineRef.current = nf;
    nf.setShards("sprawl", []);
    askGate("sprawl");
    nf.start();
    log("info", "sanctum-9 online", `rendering ${DISTRICTS.length} districts · the Fabric on the horizon is ${ORKS} ORKs at threshold ${THRESHOLD}`);
    return () => { nf.dispose(); engineRef.current = null; };
  }, [authenticated, askGate, log]);

  useEffect(() => { if (authenticated) loadMe(); }, [authenticated, loadMe]);
  useEffect(() => {
    if (!authenticated) return;
    loadBoard();
    const t = setInterval(loadBoard, 5000);
    return () => clearInterval(t);
  }, [authenticated, loadBoard]);

  // Run a real attack from a world ICE node, in place, reporting to the trace.
  const runIce = useCallback(
    async (attackId: string) => {
      const atk = ATTACKS.find((a) => a.id === attackId);
      if (!atk) return;
      log("info", `attempting hack · ${atk.title}`, atk.premise);
      engineRef.current?.pulseFabric(THRESHOLD, 0xff2b46);
      try {
        const r = await atk.run({
          origin: window.location.origin,
          secureFetch: (u, i) => secureFetch(u, i),
          token,
          doDecrypt: (d) => doDecrypt(d as any),
        });
        const held = r.verdict === "held";
        engineRef.current?.crackIce(attackId, held);
        sfx(held ? "ice-held" : "deny"); progress("ice");
        // Clarity: a held attack FAILED for the hacker. Never phrase it as a win.
        log(
          held ? "crypto" : r.verdict === "leaked" ? "deny" : "info",
          held ? "✕ HACK FAILED — SYSTEM HELD" : r.verdict === "leaked" ? "☠ BREACHED" : "result",
          `${held ? "you got nothing. " : ""}${r.detail}${r.status != null ? `  (HTTP ${r.status})` : ""}`,
        );
      } catch (e: any) {
        log("deny", "hack error", e?.message ?? String(e));
      }
    },
    [secureFetch, token, doDecrypt, log],
  );

  const jackShard = useCallback(
    async (shardId: string) => {
      const plain = payloads.current.get(shardId);
      if (!plain) return;
      const district = shardId.split("-")[0];
      sfx("jack");
    log("crypto", "doEncrypt", `sealing under tag "${DATASHARD_TAG}" · fresh per-call key · ElGamal across the Fabric`);
      engineRef.current?.pulseFabric(THRESHOLD, 0x00e5ff);
      try {
        const [sealed] = await doEncrypt([{ data: plain, tags: [DATASHARD_TAG] }]);
        const res = await secureFetch(api("/api/stash"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shardId, district, sealed }),
        });
        const j = await res.json();
        if (!res.ok) throw new Error(j.error ?? res.statusText);
        engineRef.current?.removeShard(shardId);
        payloads.current.delete(shardId);
        sfx("seal"); progress("seal");
        log("ok", "sealed", `${j.bytes} B of ciphertext stored · plaintext never left this tab · the server cannot reopen it`);
      } catch (e: any) {
        log("deny", "encrypt failed", e?.message ?? String(e));
      }
    },
    [doEncrypt, secureFetch, log],
  );

  const openPanel = useCallback(
    async (kind: "stash" | "vault" | "council" | "raid" | "nuke") => {
      document.exitPointerLock?.();
      setPanel(kind);
      try {
        if (kind === "stash") {
          const j = await (await secureFetch(api("/api/stash"))).json();
          setStash(j.shards ?? []);
        } else if (kind === "vault") {
          const j = await (await secureFetch(api("/api/vault"))).json();
          setVault({ policyReady: !!j.policyReady, canOpen: !!j.canOpen, entries: j.entries ?? [] });
        } else if (kind === "council") {
          progress("council-open");
          await refreshCouncil();
        } else if (kind === "nuke") {
          await refreshNuke();
        } else if (kind === "raid") {
          const j = await (await secureFetch(api("/api/raid"))).json();
          setRaid(j); progress("raid");
          log("info", "raid", `dumped ${j.bytes} B of server state · found: base64 and timestamps`);
        }
      } catch (e: any) {
        log("deny", `${kind} error`, e?.message ?? String(e));
      }
    },
    [secureFetch, log, progress],
  );

  const refreshNuke = useCallback(async () => {
    try {
      setNuke(await (await secureFetch(api("/api/nuke"))).json());
    } catch { /* ignore */ }
  }, [secureFetch]);

  const armNuke = async () => {
    // Filed by THIS admin, so the auto-authorization that comes with filing is
    // a real council member's vote rather than a service account's. With a
    // quorum of 2 that means one more human, which is the entire point.
    const roleRes = await tcRoles.get(secureFetch, CREW_ROLE);
    if (!roleRes.ok) throw new Error(`role ${CREW_ROLE} not found`);
    const rep = roleRes.json;

    const holders = await tcRoles.holders(secureFetch, CREW_ROLE);
    const list: any[] = holders.ok ? holders.json ?? [] : [];
    if (list.length === 0) throw new Error(`Nobody holds ${CREW_ROLE}. Nothing to revoke.`);

    let filed = 0;
    for (const u of list) {
      const r = await tcRoles.revoke(secureFetch, u.id, rep);
      if (r.ok) filed++;
    }
    engineRef.current?.pulseFabric(THRESHOLD, 0xff2b46);
    await refreshNuke();
    const note = `${filed} revocation change request(s) filed as ${me?.handle ?? "you"}. Nothing revoked yet — a quorum must sign.`;
    log("deny", "BLACKWALL ARMED", note);
    return note;
  };

  const disarmNuke = async () => {
    const s = await (await secureFetch(api("/api/nuke"))).json();
    let denied = 0;
    for (const r of s.requests ?? []) {
      const d = await changeRequests.deny(secureFetch, r.id);
      if (d.ok) denied++;
    }
    log("ok", "blackwall disarmed", `${denied} revocations denied`);
    await refreshNuke();
    return `disarmed — ${denied} revocation(s) denied`;
  };

  const detonate = async () => {
    // Commit each armed revocation with THIS admin's credentials, then let the
    // server confirm the role is actually gone before it announces a blast.
    const st = await (await secureFetch(api("/api/nuke"))).json();
    let blocked = 0;
    for (const r of st.requests ?? []) {
      const c = await changeRequests.commit(secureFetch, r.id);
      if (c.status === 412) blocked++;
    }
    const res = await secureFetch(api("/api/nuke/detonate"), { method: "POST" });
    const j = await res.json();
    if (res.status === 412 || !j.detonated) {
      return blocked > 0
        ? `412 on ${blocked} request(s) — still under quorum. Nothing went off.`
        : (j.message ?? "Nothing was revoked.");
    }
    return j.message as string;
  };

  const refreshCouncil = useCallback(async () => {
    try {
      const j = await (await secureFetch(api("/api/council"))).json();
      setCouncil({
        isCouncil: !!j.isCouncil, admins: j.admins ?? [],
        quorum: j.quorum ?? 1, pending: j.pending ?? [],
      });
    } catch { /* ignore */ }
  }, [secureFetch]);

  // A panel owns the keyboard while it is open. Doing this in one place beats
  // remembering it at each of the five call sites that open one.
  useEffect(() => {
    engineRef.current?.setInputEnabled(panel === null && !chatOpen);
  }, [panel, chatOpen]);

  /* -------------------------------------------------------- multiplayer */

  useEffect(() => {
    if (!authenticated) return;
    let alive = true;

    // 8Hz. The renderer interpolates between beats, so this is smooth at 60fps
    // without putting 60 requests/sec through the tunnel.
    const tick = async () => {
      const nf = engineRef.current;
      if (!nf) return;
      try {
        const res = await secureFetch(api("/api/presence"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // Pose only. The server takes identity from the verified doken and
          // ignores anything this body might claim about who we are.
          body: JSON.stringify({ ...nf.pose, district: hudRef.current, chatSince: chatSeq.current, wireSince: wireSeq.current }),
        });
        if (!res.ok || !alive) return;
        const j = await res.json();
        nf.setPlayers(j.players ?? []);

        const lines = j.chat ?? [];
        if (lines.length) {
          chatSeq.current = Math.max(chatSeq.current, ...lines.map((l: any) => l.seq));
          setChat((prev) => [...prev, ...lines].slice(-60));
          // Float each new line over whoever said it.
          for (const l of lines) nf.saySomething(l.vuid, l.text);
          if (lines.some((l: any) => l.vuid !== me?.vuid)) sfx("chat");
        }

        const ev = j.wire ?? [];
        if (ev.length) {
          wireSeq.current = Math.max(wireSeq.current, ...ev.map((e: any) => e.seq));
          setWire((prev) => [...prev, ...ev].slice(-50));
          for (const e of ev) { if (e.kind === "join") sfx("join"); if (e.kind === "boom") sfx("boom"); }
        }

        // A detonation is a world event: everyone playing sees it within one
        // heartbeat, whether or not they were near the detonator.
        const det = j.detonation;
        if (det?.at && det.at > lastBlast.current) {
          const first = lastBlast.current !== 0;
          lastBlast.current = det.at;
          // Do not replay an old blast for someone who just joined — only fire
          // for one that lands while they are here.
          if (first || Date.now() - det.at < 15_000) {
            nf.detonate();
            sfx("boom");
            setFlash(1);
            setCityDark(true);
            setReward("☢ BLACKWALL PROTOCOL DETONATED — THE BOARD IS ZERO");
            setTimeout(() => setFlash(0.35), 200);
            setTimeout(() => setFlash(0), 750);
            setTimeout(() => setReward(null), 5000);
            loadBoard();
            log("deny", "☢ BLACKWALL PROTOCOL DETONATED",
              `${det.by} committed it · ${det.victims} runner(s) lost crew-vault-access · EVERY score wiped, the leaderboard is zero · no single admin could do this — it took a council quorum`);
          } else {
            lastBlast.current = det.at;
          }
        }
        setOnline(
          (j.players ?? []).map((p: any) => ({
            handle: p.handle, roles: p.roles ?? [], district: p.district, x: p.x, z: p.z,
          })),
        );
      } catch { /* a dropped beat is not worth a log line */ }
    };

    const id = setInterval(tick, 125);
    tick();

    // No sendBeacon on unload: it always sends a POST and cannot attach the
    // Authorization/DPoP headers, so it would only ever 401. Sign off explicitly
    // when the component unmounts; a hard tab-kill falls through to the server's
    // 12s TTL, which is what that TTL is for.
    return () => {
      alive = false;
      clearInterval(id);
      secureFetch(api("/api/presence"), { method: "DELETE" }).catch(() => {});
    };
  }, [authenticated, secureFetch]);

  /* ---------------------------------------------------------- keyboard */

  const emote = useCallback(
    (text: string) => {
      engineRef.current?.sfx.play("emote");
      secureFetch(api("/api/chat"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      }).catch(() => {});
    },
    [secureFetch],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      const el = e.target as HTMLElement | null;
      const typing =
        !!el?.tagName &&
        (["input", "textarea", "select"].includes(el.tagName.toLowerCase()) ||
          el.isContentEditable);

      // Escape still closes a panel from inside a field — that is the one key
      // worth stealing back.
      if (k === "escape") { (el as HTMLElement | null)?.blur?.(); setPanel(null); return; }
      if (typing || panel) return;
      if (k === "tab") { e.preventDefault(); openPanel("stash"); return; }
      if (k === "m") { const nm = !muted; setMuted(nm); engineRef.current?.sfx.setMuted(nm); return; }
      const EMOTES: Record<string, string> = {
        "1": "😎 jacked in", "2": "🔥 nice", "3": "💀 rekt",
        "4": "🫡 respect", "5": "👀 watching", "6": "🚨 heads up",
      };
      if (EMOTES[k] && !chatOpen) { e.preventDefault(); emote(EMOTES[k]); return; }
      if (k === "t" && !chatOpen) {
        e.preventDefault();
        setChatOpen(true);
        setTimeout(() => chatInput.current?.focus(), 0);
        return;
      }
      if (k === "f") { setLamp((v) => !v); return; }
      if (k !== "e") return;
      const f = focusRef.current;
      if (!f) return;
      e.preventDefault();
      if (f.kind === "shard") jackShard(f.id);
      else if (f.kind === "npc") {
        document.exitPointerLock?.();
        const n = NPCS_BY_ID[f.id];
        if (n?.bounty) {
          setBounties((prev) =>
            prev.some((b) => b.id === n.bounty!.id)
              ? prev
              : [...prev, { ...n.bounty!, have: 0, done: false }],
          );
        }
        setTalking({ id: f.id, line: 0 });
        setPanel("npc");
      }
      else if (f.kind === "vault") openPanel("vault");
      else if (f.kind === "council") openPanel("council");
      else if (f.kind === "nuke") openPanel("nuke");
      else if (f.kind === "breach") { progress("breach"); window.location.assign("/breach"); }
      else if (f.kind === "fabric") { window.location.assign("/fabric"); }
      else if (f.kind === "codex") { document.exitPointerLock?.(); progress("codex"); setPanel("codex"); }
      else if (f.kind === "ice") { runIce(f.attack); }
      else if (f.kind === "fun") { doFun(f.action); }
      else if (f.kind === "device") { document.exitPointerLock?.(); setDevice({ device: f.device, dtype: f.dtype, label: f.label.replace("HACK: ", "") }); setPanel("device"); }
      else if (f.kind === "raid") openPanel("raid");
      else if (f.kind === "gate") {
        const dd = DISTRICT_BY_ID[f.district];
        const cleared = f.label.startsWith("ENTER") || me?.clearances.find((x) => x.id === f.district)?.granted;
        if (cleared) { engineRef.current?.enterInterior(f.district); log("ok", `entering ${dd.name}`, "stepping through the gate…"); }
        else if (dd?.legacy) { document.exitPointerLock?.(); setHackDistrict(f.district); setPanel("hack"); }
        else {                                              // the golden Vault Core — nothing to forge
          setGlitch(true); sfx("deny"); setTimeout(() => setGlitch(false), 420);
          log("deny", `▓▒ GLITCH · ${dd.name}`, "this gate is tidified — verified server-side against the doken signature. there is nothing to forge. (free)");
        }
      }
      else if (f.kind === "exit") { engineRef.current?.exitInterior(); log("info", "back to the streets", "you step back out of the gate."); }
      else if (f.kind === "prop") {
        if (f.action === "dance") { emote("💃 dances in the festival light"); engineRef.current?.pulseFabric(2, 0xffd23f); sfx("juke"); log("ok", "you join the festival", "the crowd folds you in. nobody here is afraid of losing a thing."); }
        else if (f.action === "toast") { sfx("commit"); log("ok", "you drink from the fountain", "cool and clean. to a district where nothing can be stolen — not by a corp, not by an admin, not by the machine."); }
        else if (f.action === "genesis") {
          engineRef.current?.pulseFabric(THRESHOLD, 0xffd23f); sfx("commit");
          setReward("◈ THE GENESIS SHARD — twenty pieces, never whole"); setTimeout(() => setReward(null), 3200);
          log("crypto", "you touch the genesis shard", "twenty shards turn around your hand and never once touch. threshold fourteen — it has never been assembled, not at any instant of the network's life. the legend is TRUE.");
        }
        else if (f.action === "bag") {
          sfx("commit"); engineRef.current?.pulseFabric(2, 0x39ff88);
          setReward("you set it down — and nothing takes it"); setTimeout(() => setReward(null), 3200);
          log("ok", "you set down your loot and walk away", "it's sealed to you alone — no forged pass, no stolen token, no admin can lift it. for the first time you don't look back. the legend is TRUE.");
        }
        else if (f.action === "face") {
          sfx("deny"); engineRef.current?.pulseFabric(2, 0x6cf5ff);
          log("crypto", "you try to wear another face", "you press a stolen identity to the mirror. the Fabric refuses — a name here is twenty shards no one can reassemble. out there anyone can be you; in here, no one steals your face. the legend is TRUE.");
        }
        else if (f.action === "fireworks") {
          engineRef.current?.pulseFabric(THRESHOLD, 0xff2d95); sfx("juke");
          setReward("🎆 the sky over the Core erupts"); setTimeout(() => setReward(null), 2600);
          log("ok", "you slam the launcher", "the whole plaza looks up. the festival never ends — it just gets louder.");
        }
        else if (f.action === "warm") { sfx("hack"); log("info", "you warm your hands", "the brazier hisses. out here the only heat is the one you keep an eye on."); }
        else if (f.action === "wish") { sfx("commit"); engineRef.current?.pulseFabric(2, 0xffd23f); setReward("✦ you made a wish"); setTimeout(() => setReward(null), 2600); log("ok", "you make a wish at the shrine", "you already know what you wished: that one day the whole city is like this one."); }
        else if (f.action === "ride") { sfx("juke"); engineRef.current?.pulseFabric(2, 0x6cf5ff); setReward("🚕 joyride over the Core"); setTimeout(() => setReward(null), 2600); log("ok", "a flying car swings down", "you take a lap over the golden plaza — fireworks at eye level, the genesis shard turning below."); }
        else if (f.action === "haggle") { sfx("hack"); log("info", "you haggle at the stall", "the vendor knocks off a few eddies and warns you: 'watch your jack round here — this quarter's still the old stack.'"); }
        else if (f.action === "busker") { emote("🎵 tips the busker"); sfx("juke"); log("ok", "you tip the busker", "she nods and plays on — a slow synth line about a golden gate nobody can pick."); }
        else if (f.action === "rumor") { sfx("hack"); const rumors = ["'inside the Core, your shadow can't be worn by anyone else. no one steals your face.'","'twenty ORKs stand around the genesis shard and no fourteen have ever agreed to move it. so it never moves.'","'the Architect burned the one master key and split it into twenty. the Core is a monument to a key that no longer exists.'","'they don't lock anything in there. there's nothing to steal, so there's nothing to guard.'"]; log("info", "you buy a rumour", rumors[Math.floor(Math.random() * rumors.length)] + " — the myths of the golden city."); }
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [panel, chatOpen, muted, emote, jackShard, openPanel, askGate, me, sfx, log]);

  const send = async () => {
    const text = draft.trim();
    setDraft("");
    setChatOpen(false);
    if (!text) return;
    progress("chat-sent");
    try {
      const res = await secureFetch(api("/api/chat"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        log("deny", "not sent", j.error ?? res.statusText);
      }
      // The line arrives back through the heartbeat like everyone else's, so
      // there is one code path for rendering rather than an optimistic copy
      // that can disagree with the server.
    } catch (e: any) {
      log("deny", "chat error", e?.message ?? String(e));
    }
  };

  /* ----------------------------------------------------------- crypto */

  const decryptShard = async (s: StashShard) => {
    log("crypto", "doDecrypt", "threshold decryption of the per-call key · requires live Fabric participation");
    engineRef.current?.pulseFabric(THRESHOLD, 0x39ff88);
    const [plain] = await doDecrypt([{ encrypted: s.sealed, tags: [DATASHARD_TAG] }]);
    sfx("decrypt"); progress("decrypt");
    log("ok", "opened", "plaintext exists only in this tab");
    return String(plain);
  };

  const policyBytes = async (): Promise<Uint8Array> => {
    const res = await secureFetch(api("/api/vault/policy"));
    const j = await res.json();
    if (!res.ok || !j.ready) throw new Error(j.reason ?? "crew-vault policy is not signed yet");
    return Uint8Array.from(j.policyBytes);
  };

  const sealDrop = async (text: string, lockMinutes: number) => {
    const tags = [CREW_VOUCHER_TAG];
    if (lockMinutes > 0) {
      tags.push(`DecryptTimeLock:${Math.floor(Date.now() / 1000) + lockMinutes * 60}`);
    }
    const pol = await policyBytes();
    log("crypto", "IAMService.doEncrypt(+policy)",
      `VVK encryption under the crew key · contract decides who opens it · tags [${tags.join(", ")}]`);
    engineRef.current?.pulseFabric(THRESHOLD, 0xffc247);
    const [sealed] = await IAMService.doEncrypt([{ data: text, tags }], pol);
    const res = await secureFetch(api("/api/vault"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sealed, tags, note: lockMinutes > 0 ? `time-locked ${lockMinutes}m` : "" }),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error ?? res.statusText);
    log("ok", "drop sealed", `${j.bytes} B · every ORK will run the contract before anyone opens it`);
    const fresh = await (await secureFetch(api("/api/vault"))).json();
    setVault({ policyReady: !!fresh.policyReady, canOpen: !!fresh.canOpen, entries: fresh.entries ?? [] });
  };

  const openDrop = async (e: VaultEntry & { tags?: string[] }) => {
    const pol = await policyBytes();
    const tags = e.tags?.length ? e.tags : [CREW_VOUCHER_TAG];
    log("crypto", "IAMService.doDecrypt(+policy)", `every ORK runs CrewVaultContract · majority must Allow`);
    engineRef.current?.pulseFabric(THRESHOLD, 0xffc247);
    try {
      const [plain] = await IAMService.doDecrypt([{ encrypted: e.sealed, tags }], pol);
      log("ok", "drop opened", "contract allowed · key reassembled from threshold shares");
      return String(plain);
    } catch (err: any) {
      const m = err?.message ?? String(err);
      log("deny", "contract denied", m);
      throw new Error(m);
    }
  };

  /* ---------------------------------------------------------- council */

  const propose = async (username: string) => {
    const u = await tcRoles.userByName(secureFetch, username);
    const uid = u.ok ? u.json?.[0]?.id : null;
    if (!uid) throw new Error(`No runner named ${username}`);

    const r = await tcRoles.get(secureFetch, "ghost");
    if (!r.ok) throw new Error("role ghost not found");

    const g = await tcRoles.grant(secureFetch, uid, r.json);
    await refreshCouncil();
    const note = g.ok
      ? "Accepted, not applied. The grant sits as a change request until the quorum signs it."
      : `TideCloak returned ${g.status}: ${g.text?.slice(0, 120)}`;
    log("info", `proposed ghost for ${username}`, note);
    return `HTTP ${g.status} — ${note}`;
  };

  const signCR = async (id: string) => {
    // Direct to TideCloak. Going through our own API would authenticate as the
    // service account and credit the approval to it — see lib/tcAdmin.ts.
    const got = await changeRequests.approvalModel(secureFetch, id);
    if (!got.ok) throw new Error(got.json?.error ?? got.text?.slice(0, 160) ?? "no approval model");
    const model: string = got.json?.requestModel ?? got.json?.changeRequest?.requestModel;
    if (!model) throw new Error("change request carries no requestModel");

    log("crypto", "enclave approval", "your browser produces the threshold signature — no server can");
    const bytes = Uint8Array.from(atob(model), (c) => c.charCodeAt(0));
    const approvals = await IAMService._tc!.requestTideOperatorApproval([{ id, request: bytes }]);
    const first: any = approvals?.[0];
    const signed = first?.approved?.request ?? first?.request;
    if (!signed || first?.denied) throw new Error("approval denied or dismissed");

    const b64 = btoa(String.fromCharCode(...new Uint8Array(signed)));
    const post = await changeRequests.submitApproval(secureFetch, id, b64);
    if (!post.ok) throw new Error(post.json?.error ?? post.text?.slice(0, 160) ?? "approval rejected");

    engineRef.current?.pulseFabric(THRESHOLD, 0xb46cff);
    sfx("sign");
    const j = post.json ?? {};
    const n = j.authorizationCount ?? j.authorizers?.length ?? j.authCount ?? "?";
    const t = j.threshold ?? council.quorum;
    await refreshCouncil();
    await refreshNuke();
    return `signed as ${me?.handle ?? "you"} · ${n} of ${t} approvals recorded`;
  };

  const commitCR = async (id: string) => {
    const res = await changeRequests.commit(secureFetch, id);
    if (res.status === 412) {
      return "412 — still under quorum. The Fabric will not seal it yet.";
    }
    if (!res.ok) throw new Error(res.json?.error ?? res.text?.slice(0, 160) ?? "commit failed");
    sfx("commit");
    log("ok", "committed", "sealed by threshold signature · roles propagate on next token refresh (up to 120s)");
    await refreshCouncil();
    await refreshNuke();
    return "committed — sealed by the Fabric. The runner must refresh their doken to see it.";
  };

  const denyCR = async (id: string) => {
    const res = await changeRequests.deny(secureFetch, id);
    if (!res.ok) throw new Error(res.json?.error ?? "deny failed");
    await refreshCouncil();
    await refreshNuke();
    return "denied";
  };

  /* ------------------------------------------------------------- gates */

  if (isInitializing) return <Center>initialising enclave…</Center>;
  if (!authenticated)
    return (
      <Center>
        <p>not linked to the Fabric.</p>
        <a href="/"><button className="nf">RETURN TO TITLE</button></a>
      </Center>
    );

  const expIn = me ? Math.max(0, me.tokenExp - Math.floor(Date.now() / 1000)) : 0;

  // Chat and the wire share one column, ordered by when things happened, so a
  // refusal and the swearing about it sit next to each other.
  const feed = [
    ...chat.map((c) => ({ type: "chat" as const, ...c, at: (c as any).at ?? 0 })),
    ...wire.map((w) => ({ type: "wire" as const, ...w, roles: [] as string[] })),
  ].sort((a, b) => (a.at ?? 0) - (b.at ?? 0)).slice(-45);

  return (
    <main style={{ position: "fixed", inset: 0, overflow: "hidden" }}>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block", cursor: "crosshair" }} />

      {glitch && <div className="glitch-overlay" />}
      {/* detonation flash — sits above the canvas, below the panels */}
      <div
        style={{
          position: "absolute", inset: 0, pointerEvents: "none", zIndex: 30,
          background: "#fff",
          opacity: flash,
          transition: flash === 0 ? "opacity 1.4s cubic-bezier(.2,0,.1,1)" : "none",
          mixBlendMode: "screen",
        }}
      />
      {cityDark && (
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0, zIndex: 31,
          pointerEvents: "none", textAlign: "center", padding: "6px 0",
          background: "rgba(58,16,22,0.85)", borderBottom: "1px solid var(--red)",
          color: "var(--red)", fontSize: 10.5, letterSpacing: "0.24em",
        }}>
          GRID DOWN · CREW VAULT SEALED TO EVERYONE
        </div>
      )}

      {/* eddies + reward toast */}
      <div style={{
        position: "absolute", top: 14, left: "50%", transform: "translateX(-50%)",
        textAlign: "center", zIndex: 22, pointerEvents: "none",
      }}>
        <div className="panel" style={{ display: "inline-block", padding: "4px 14px", borderColor: "var(--amber)" }}>
          <span style={{ color: "var(--amber)", fontSize: 13, letterSpacing: "0.1em" }}>
            ¤ {eddies.toLocaleString()}
          </span>
          <span style={{ color: "var(--dim)", fontSize: 9.5 }}> eddies · your score</span>
        </div>
        {reward && (
          <div style={{
            marginTop: 6, fontSize: 12, color: "var(--green)",
            textShadow: "0 0 12px rgba(57,255,136,0.6)", letterSpacing: "0.08em",
          }}>
            {reward}
          </div>
        )}
      </div>

      {/* crosshair */}
      <div style={{
        position: "absolute", left: "50%", top: "50%", width: 3, height: 3,
        marginLeft: -1.5, marginTop: -1.5, background: "var(--cyan)",
        boxShadow: "0 0 8px var(--cyan)", pointerEvents: "none",
      }} />

      {/* identity */}
      <div className="panel" style={{ position: "absolute", top: 14, left: 14, width: 268, pointerEvents: "auto" }}>
        <p className="label">runner</p>
        <p style={{ margin: "0 0 2px", fontSize: 15, color: "var(--cyan)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={me?.handle}>{me?.handle ?? "…"}</p>
        <p style={{ margin: "0 0 10px", fontSize: 9.5, color: "#3f5876", wordBreak: "break-all" }}>
          {me?.vuid?.slice(0, 40)}…
        </p>
        <p className="label">roles in the doken</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 10 }}>
          {(me?.roles ?? []).filter((r) => !r.startsWith("_tide_")).map((r) => (
            <span key={r} style={{
              fontSize: 9.5, padding: "2px 6px", border: "1px solid var(--edge)",
              color: r === "ghost" ? "var(--violet)" : "var(--dim)",
            }}>{r}</span>
          ))}
        </div>
        <p style={{ fontSize: 9.5, color: "var(--dim)", margin: 0, lineHeight: 1.6 }}>
          signed by {ORKS} ORKs at threshold {THRESHOLD} · expires in {expIn}s
        </p>
        <div style={{ marginTop: 8 }}><TideMark label="SECURED BY TIDE · YOUR DOKEN" /></div>
        <p className="label" style={{ marginTop: 12 }}>visibility</p>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="range" min={0.6} max={3} step={0.02} value={exposure}
            onChange={(e) => {
              const v = Number(e.target.value);
              setExposure(v);
              engineRef.current?.setExposure(v);
              try { localStorage.setItem("nf.exposure", String(v)); } catch { /* fine */ }
            }}
            style={{ flex: 1, accentColor: "var(--cyan)" }}
          />
          <span style={{ fontSize: 9.5, color: "var(--dim)", width: 26 }}>
            {exposure.toFixed(2)}
          </span>
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
          <button
            className="nf"
            style={{ padding: "4px 8px", fontSize: 9.5, flex: 1 }}
            onClick={() => { engineRef.current?.toggleLamp(); setLamp((v) => !v); }}
          >
            {lamp ? "LAMP ON [F]" : "LAMP OFF [F]"}
          </button>
          <button
            className="nf"
            style={{ padding: "4px 8px", fontSize: 9.5, flex: 1 }}
            onClick={() => { const m = !muted; setMuted(m); engineRef.current?.sfx.setMuted(m); }}
          >
            {muted ? "SOUND OFF [M]" : "SOUND ON [M]"}
          </button>
        </div>

        <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
          <button className="nf" style={{ padding: "4px 8px", fontSize: 9.5 }}
            onClick={async () => { await forceRefreshToken(); await loadMe(); log("info", "token refreshed", "new doken minted — role changes land here"); }}>
            REFRESH DOKEN
          </button>
          <button className="nf magenta" style={{ padding: "4px 8px", fontSize: 9.5 }} onClick={() => logout()}>
            EXIT
          </button>
        </div>
      </div>

      {/* top-right column: clearances + leaderboard */}
      <div style={{
        position: "absolute", top: 14, right: 14, width: 250, zIndex: 20,
        display: "flex", flexDirection: "column", gap: 10,
        maxHeight: "calc(100vh - 28px)", overflowY: "auto", overflowX: "hidden",
      }}>
        <div className="panel">
          <p className="label">district clearance</p>
          {DISTRICTS.map((d) => {
            const c = me?.clearances.find((x) => x.id === d.id);
            const ok = c?.granted ?? d.clearance === null;
            // Every gate except the golden Vault Core runs the old, forgeable
            // stack — so it reads HACKABLE (amber), not role-locked (red).
            const state = ok ? "GRANTED" : d.legacy ? "HACKABLE" : d.grand ? "◈ TIDE" : String(d.clearance);
            const col = ok ? "var(--green)" : d.legacy ? "var(--amber)" : "var(--red)";
            return (
              <div key={d.id} style={{
                display: "flex", justifyContent: "space-between", fontSize: 11,
                padding: "3px 0", color: col,
              }}>
                <span style={{ color: hud.district === d.id ? "var(--cyan)" : undefined }}>{d.name}</span>
                <span>{state}</span>
              </div>
            );
          })}
          <p style={{ fontSize: 9.5, color: "var(--dim)", margin: "10px 0 0", lineHeight: 1.6 }}>
            Amber gates run the old stack — walk up and the client forges a pass. Only the golden Vault Core (◈ TIDE) is verified server-side and cannot be forged.
          </p>
          <Minimap x={hud.x} z={hud.z} players={online} />
          <p className="label" style={{ marginTop: 12 }}>in sanctum-9 · {online.length + 1}</p>
          <div style={{ fontSize: 10.5, lineHeight: 1.75 }}>
            <div style={{ color: "var(--cyan)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={me?.handle}>{shortName(me?.handle ?? "you")} <span style={{ color: "var(--dim)" }}>· you</span></div>
            {online.map((p) => (
              <div key={p.handle} style={{ color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p.handle}>
                {shortName(p.handle)}{" "}
                <span style={{ color: "var(--dim)" }}>
                  · {p.roles.filter((r) => r !== "runner").join(" ") || "runner"}{p.district ? ` · ${p.district}` : ""}
                </span>
              </div>
            ))}
            {online.length === 0 && <div style={{ color: "var(--dim)" }}>nobody else jacked in.</div>}
          </div>
        </div>

        <div className="panel" style={{ borderColor: "var(--amber)" }}>
          <p className="label" style={{ margin: "0 0 6px", color: "var(--amber)" }}>leaderboard</p>
          {board.length === 0 ? (
            <p style={{ fontSize: 10, color: "var(--dim)", margin: 0 }}>No scores yet. Clear districts, hack Old Town at the BREACH TERMINAL.</p>
          ) : (
            board.slice(0, 8).map((r) => (
              <div key={r.rank} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 10.5, padding: "2px 0", color: r.you ? "var(--cyan)" : "var(--text)" }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }} title={r.handle}>{r.rank}. {shortName(r.handle)}{r.you ? " ·you" : ""}</span>
                <span style={{ color: "var(--amber)", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{r.points.toLocaleString()}</span>
              </div>
            ))
          )}
          <p style={{ fontSize: 9, color: "var(--dim)", margin: "8px 0 0", lineHeight: 1.5 }}>
            Hacking every gate in the city scrapes ~100 pts. The one tidified district — the golden Vault Core — is worth a TRILLION, and you can&apos;t hack it. The top belongs to real clearance.
          </p>
          <div style={{ marginTop: 8 }}><TideMark label="SCOREBOARD SIGNED BY TIDE" style={{ color: "var(--amber)", borderColor: "color-mix(in srgb, var(--amber) 45%, transparent)", background: "color-mix(in srgb, var(--amber) 8%, transparent)", textShadow: "0 0 6px color-mix(in srgb, var(--amber) 55%, transparent)" }} /></div>
        </div>
      </div>

      {/* the wire + street comms — bottom-left, clear of the centre prompts */}
      <div style={{ position: "absolute", bottom: 14, left: 14, width: 360, zIndex: 20, display: "flex", flexDirection: "column", gap: 6 }}>
        <div className="panel" style={{ maxHeight: "34vh", overflow: "auto", padding: "10px 12px" }}>
          <p className="label" style={{ margin: "0 0 6px" }}>the wire · verified events + street comms</p>
          {feed.length === 0 ? (
            <p style={{ fontSize: 10.5, color: "var(--dim)", margin: 0 }}>Quiet out there. Press T to say something.</p>
          ) : (
            feed.map((f) =>
              f.type === "chat" ? (
                <div key={`c${f.seq}`} style={{ fontSize: 11, lineHeight: 1.6 }}>
                  <span style={{ color: roleColor(f.roles) }}>{f.handle}</span>
                  <span style={{ color: "var(--dim)" }}> · </span>
                  <span style={{ color: "var(--text)" }}>{f.text}</span>
                </div>
              ) : (
                <div key={`w${f.seq}`} style={{ fontSize: 10.5, lineHeight: 1.6 }}>
                  <span style={{ color: WIRE_TINT[f.kind] ?? "var(--dim)" }}>{WIRE_MARK[f.kind] ?? "·"} {f.handle}</span>{" "}
                  <span style={{ color: "var(--dim)" }}>{f.text}</span>
                </div>
              ),
            )
          )}
        </div>
        {chatOpen && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#06080f", border: "1px solid var(--cyan)", padding: "6px 10px", boxShadow: "0 0 18px rgba(0,229,255,0.18)" }}>
            <span style={{ color: "var(--cyan)", fontSize: 12 }}>▶ SAY</span>
            <input ref={chatInput} value={draft} maxLength={200}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); send(); } else if (e.key === "Escape") { e.preventDefault(); setDraft(""); setChatOpen(false); } }}
              onBlur={() => setChatOpen(false)}
              placeholder="everyone can read it — including the server. (Enter to send, Esc to cancel)"
              style={{ flex: 1, background: "transparent", border: "none", color: "var(--text)", fontFamily: "var(--mono)", fontSize: 11.5, padding: 0, outline: "none" }} />
          </div>
        )}
      </div>

      {/* controls */}
      <div style={{ position: "absolute", bottom: 14, right: 14, fontSize: 10, color: "var(--dim)", textAlign: "right", lineHeight: 1.8 }}>
        click to look · WASD move · SHIFT sprint<br />
        E interact · T chat · 1-6 emote · F lamp · M mute<br />
        TAB stash · ESC close<br />
        <span style={{ color: "#2d4159" }}>{Math.round(hud.x)}, {Math.round(hud.z)} · {hud.fps} fps</span>
      </div>

      {/* focus prompt */}
      {focus && !panel && (
        <div style={{ position: "absolute", bottom: 96, left: "50%", transform: "translateX(-50%)", textAlign: "center", pointerEvents: "none" }}>
          <div className="panel" style={{ borderColor: "var(--cyan)", padding: "8px 18px" }}>
            <span style={{ color: "var(--cyan)", fontSize: 12, letterSpacing: "0.16em" }}>[E] {focus.label}</span>
          </div>
        </div>
      )}

      {panel === "stash" && (<StashPanel shards={stash} onDecrypt={decryptShard} onClose={() => setPanel(null)} />)}
      {panel === "vault" && (
        <VaultPanel policyReady={vault.policyReady} canOpen={vault.canOpen} entries={vault.entries} onSeal={sealDrop} onOpen={openDrop} onClose={() => setPanel(null)} />
      )}
      {panel === "council" && (
        <CouncilPanel isCouncil={council.isCouncil} admins={council.admins} quorum={council.quorum} pending={council.pending} onPropose={propose} onSign={signCR} onCommit={commitCR} onRefresh={refreshCouncil} onClose={() => setPanel(null)} />
      )}
      {panel === "nuke" && (
        <NukePanel state={nuke} onArm={armNuke} onDisarm={disarmNuke} onSign={signCR} onDetonate={detonate} onRefresh={refreshNuke} onClose={() => setPanel(null)} />
      )}
      {panel === "raid" && <RaidPanel data={raid} onClose={() => setPanel(null)} />}
      {panel === "codex" && (<CodexPanel clearances={me?.clearances ?? []} onClose={() => setPanel(null)} />)}
      {panel === "device" && device && (
        <DevicePanel
          device={device.device} dtype={device.dtype} label={device.label}
          onClose={() => { setPanel(null); setDevice(null); }}
          onExploit={async (dev, body) => {
            try {
              const r = await fetch(api(`/api/legacy/device/${dev}`), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
              const j = await r.json();
              if (j.ok) { engineRef.current?.sfx.play("hack"); progress("ice"); log("deny", `exploited ${device.label}`, j.result); }
              return j;
            } catch (e: any) { return { ok: false, hint: e?.message ?? String(e) }; }
          }}
        />
      )}
      {panel === "hack" && hackDistrict && (
        <HackPanel
          districtId={hackDistrict}
          onProbe={async () => {
            const r = await secureFetch(api(`/api/district/${hackDistrict}`));
            const j = await r.json().catch(() => ({}));
            return j.hack ?? null;
          }}
          onFetch={async (path) => {
            const r = await fetch(api(path));
            return r.json().catch(() => ({}));
          }}
          onRun={(sub) => runHack(hackDistrict, sub)}
          onClose={() => { setPanel(null); setHackDistrict(null); }}
        />
      )}
      {panel === "npc" && talking && (() => {
        const n = NPCS_BY_ID[talking.id];
        if (!n) return null;
        return (
          <NpcPanel
            npc={{ id: n.id, name: n.name, tag: n.tag, kind: n.kind, color: `#${n.color.toString(16).padStart(6, "0")}`, line: (() => { const pool = [...n.lines, ...AMBIENT_CHATTER]; return pool[talking.line % pool.length]; })(), hackable: n.hackable }}
            token={token}
            onNext={() => setTalking({ id: n.id, line: talking.line + 1 })}
            onClose={() => { setPanel(null); setTalking(null); }}
            onHack={async (drone) => {
              try {
                const r = await fetch(api(`/api/legacy/npc/${drone}`));
                if (!r.ok) return null;
                const d = await r.json();
                log("deny", `hacked ${n.name}`, "legacy drone — dumped its data with no authorization. flag captured.");
                engineRef.current?.sfx.play("hack"); progress("ice");
                return d;
              } catch { return null; }
            }}
          />
        );
      })()}
    </main>
  );
}

/* --------------------------------------------------------------- bits */

const WIRE_MARK: Record<string, string> = {
  "gate-pass": "▸", "gate-deny": "✕", seal: "◆", open: "◇", drop: "▣",
  propose: "⁂", sign: "✓", commit: "★", arm: "⚠", boom: "✷", join: "+",
};
const WIRE_TINT: Record<string, string> = {
  "gate-pass": "var(--green)", "gate-deny": "var(--red)", seal: "var(--cyan)",
  open: "var(--cyan)", drop: "var(--amber)", propose: "var(--violet)",
  sign: "var(--violet)", commit: "var(--green)", arm: "var(--red)",
  boom: "var(--red)", join: "var(--dim)",
};

/** Keep long handles (or a raw vuid fallback) from blowing out the HUD panels. */
function shortName(h: string): string {
  if (!h) return "runner";
  return h.length > 18 ? h.slice(0, 14) + "…" : h;
}

function roleColor(roles: string[] = []): string {
  if (roles.includes("ghost")) return "var(--violet)";
  if (roles.includes("netrunner")) return "var(--green)";
  if (roles.includes("fixer")) return "var(--amber)";
  return "var(--cyan)";
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <main style={{ height: "100vh", display: "grid", placeItems: "center", gap: 14, textAlign: "center" }}>
      <div style={{ color: "var(--dim)", fontSize: 13 }}>{children}</div>
    </main>
  );
}

function Minimap({ x, z, players }: {
  x: number; z: number;
  players: { handle: string; roles: string[]; district: string | null; x: number; z: number }[];
}) {
  const S = 218;
  const scale = S / 1100;
  const px = S / 2 + x * scale;
  const pz = S / 2 + z * scale;
  return (
    <svg width={S} height={S} style={{ marginTop: 12, border: "1px solid var(--edge)", background: "#05060d" }}>
      {DISTRICTS.map((d) => (
        <circle key={d.id}
          cx={S / 2 + d.center[0] * scale} cy={S / 2 + d.center[1] * scale} r={d.radius * scale}
          fill={`#${d.palette[0].toString(16).padStart(6, "0")}14`}
          stroke={`#${d.palette[0].toString(16).padStart(6, "0")}`} strokeWidth={0.8} />
      ))}
      {players.map((p, i) => (
        <circle key={i} cx={S / 2 + p.x * scale} cy={S / 2 + p.z * scale} r={2.4}
          fill={p.roles.includes("ghost") ? "var(--violet)" : p.roles.includes("netrunner") ? "var(--green)" : p.roles.includes("fixer") ? "var(--amber)" : "#7fd8ff"} />
      ))}
      <circle cx={px} cy={pz} r={3} fill="var(--cyan)" />
      <circle cx={px} cy={pz} r={6} fill="none" stroke="var(--cyan)" strokeWidth={0.7} opacity={0.6} />
    </svg>
  );
}
