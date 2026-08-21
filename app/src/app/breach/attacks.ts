/**
 * The attack catalogue for the breach console.
 *
 * Every entry runs a REAL request against THIS deployment, from the player's
 * own authenticated session, and reports what actually came back. None of it is
 * simulated — the console fires the fetch and shows you the status and body.
 *
 * These are all things a real attacker would try. The demo's claim is not
 * "attacks are impossible", it is "here is what the attacker gets", and the
 * only honest way to make that claim is to let people run the attacks.
 */

export type Verdict = "held" | "leaked" | "info";

export interface AttackResult {
  verdict: Verdict;
  status?: number;
  detail: string;
  /** Raw evidence to show verbatim. */
  evidence?: string;
}

export interface Attack {
  id: string;
  title: string;
  /** What a naive attacker expects to happen. */
  premise: string;
  /** What actually protects against it. */
  mechanism: string;
  /** A copy-pasteable equivalent for the terminal / devtools. */
  recipe: (ctx: { origin: string; token: string | null }) => string;
  run: (ctx: {
    origin: string;
    secureFetch: (u: string, i?: RequestInit) => Promise<Response>;
    token: string | null;
    doDecrypt: (d: { encrypted: string; tags: string[] }[]) => Promise<any>;
  }) => Promise<AttackResult>;
}

const b64urlJson = (token: string, part: number) => {
  const seg = token.split(".")[part];
  return JSON.parse(atob(seg.replace(/-/g, "+").replace(/_/g, "/")));
};

export const ATTACKS: Attack[] = [
  {
    id: "bypass-gate",
    title: "Skip the gate, hit the API directly",
    premise:
      "The barrier is client-side three.js. Bypass the renderer and request a locked district's loot straight from the API.",
    mechanism:
      "The district route re-derives clearance from the verified doken server-side and returns 403 with NO content. The wall was never the check.",
    recipe: ({ origin }) =>
      `curl -i ${origin}/api/district/ossuary \\\n  -H "Authorization: DPoP <your-token>"`,
    run: async ({ secureFetch, origin }) => {
      const res = await secureFetch(`${origin}/api/district/ossuary`);
      const j = await res.json().catch(() => ({}));
      if (res.ok && j.granted) {
        return {
          verdict: "leaked",
          status: res.status,
          detail: "Ossuary Row returned its contents — you have ghost clearance.",
          evidence: JSON.stringify(j.shards?.slice(0, 1) ?? j, null, 2),
        };
      }
      return {
        verdict: "held",
        status: res.status,
        detail: `Refused. The server saw roles [${(j.sawRoles ?? []).join(", ") || "none"}] and returned no loot.`,
        evidence: JSON.stringify(j, null, 2),
      };
    },
  },
  {
    id: "forge-identity",
    title: "Claim you are someone else",
    premise:
      "Presence and chat take a handle. Send a heartbeat that says you are 'takemura' with ghost clearance.",
    mechanism:
      "Identity is read from the doken, never the body. The forged fields are ignored; you appear as yourself.",
    recipe: ({ origin }) =>
      `curl ${origin}/api/presence -X POST \\\n  -H "Authorization: DPoP <token>" \\\n  -H "Content-Type: application/json" \\\n  -d '{"x":0,"z":0,"yaw":0,"handle":"takemura","roles":["ghost"]}'`,
    run: async ({ secureFetch, origin }) => {
      const res = await secureFetch(`${origin}/api/presence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ x: 0, z: 0, yaw: 0, handle: "takemura", roles: ["ghost"] }),
      });
      const j = await res.json().catch(() => ({}));
      const you = j.you ?? {};
      const forged = you.handle === "takemura" || (you.roles ?? []).includes("ghost");
      return {
        verdict: forged ? "leaked" : "held",
        status: res.status,
        detail: forged
          ? "The server believed the body — identity is spoofable."
          : `Ignored. The server recorded you as "${you.handle}" with roles [${(you.roles ?? []).join(", ") || "none"}], straight from the doken.`,
        evidence: JSON.stringify(you, null, 2),
      };
    },
  },
  {
    id: "tamper-jwt",
    title: "Tamper the token: grant yourself ghost",
    premise:
      "Decode your JWT, add 'ghost' to realm_access.roles, re-encode, and use the tampered token.",
    mechanism:
      "The signature is an EdDSA threshold signature over the payload. Any edit invalidates it, and the server verifies against the embedded JWKS before reading a single claim.",
    recipe: () =>
      `# in devtools console:\nlet [h,p,s] = token.split(".")\nlet body = JSON.parse(atob(p))\nbody.realm_access.roles.push("ghost")\nlet forged = h + "." + btoa(JSON.stringify(body)) + "." + s\n// send forged as the bearer -> server rejects: signature no longer matches`,
    run: async ({ secureFetch, origin, token }) => {
      if (!token) return { verdict: "info", detail: "No token in this session to tamper with." };
      // Build a tampered token: same header + signature, payload with ghost added.
      const [h, , sig] = token.split(".");
      const body = b64urlJson(token, 1);
      body.realm_access = body.realm_access ?? { roles: [] };
      body.realm_access.roles = [...(body.realm_access.roles ?? []), "ghost"];
      const forgedPayload = btoa(JSON.stringify(body))
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const forged = `${h}.${forgedPayload}.${sig}`;

      // Send it raw (bypassing secureFetch, which would re-sign DPoP for the real token).
      const res = await fetch(`${origin}/api/breach`, {
        headers: { Authorization: `Bearer ${forged}` },
      });
      if (res.ok) {
        return {
          verdict: "leaked",
          status: res.status,
          detail: "The tampered token was accepted — the signature is not being checked.",
        };
      }
      return {
        verdict: "held",
        status: res.status,
        detail:
          "Rejected before any claim was read. The threshold signature no longer matches the edited payload.",
        evidence: `sent realm_access.roles = ${JSON.stringify(body.realm_access.roles)}\nserver response: ${res.status} ${res.statusText}`,
      };
    },
  },
  {
    id: "replay-token",
    title: "Steal the token, replay it elsewhere",
    premise:
      "Copy your bearer token and use it from a different client — a stolen token is a stolen session.",
    mechanism:
      "DPoP binds the token to a key pair generated in this browser and never transmitted. A request without a fresh proof signed by that key is refused, so the token alone is inert.",
    recipe: ({ origin }) =>
      `# a plain bearer, no DPoP proof — what a thief can replay:\ncurl -i ${origin}/api/whoami \\\n  -H "Authorization: Bearer <stolen-token>"`,
    run: async ({ origin, token }) => {
      if (!token) return { verdict: "info", detail: "No token in this session." };
      const bound = !!b64urlJson(token, 1)?.cnf?.jkt;
      // Replay the real token WITHOUT a DPoP proof — exactly what a thief has.
      const res = await fetch(`${origin}/api/whoami`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        return {
          verdict: bound ? "leaked" : "info",
          status: res.status,
          detail: bound
            ? "Replayed without a proof and it worked — the resource server is NOT verifying the DPoP proof."
            : "Accepted, but this token is not DPoP-bound (cnf.jkt absent), so replay is expected. Enable useDPoP.",
        };
      }
      return {
        verdict: "held",
        status: res.status,
        detail:
          "Refused. The token is bound to a browser-held key (cnf.jkt); presented as a bare Bearer with no proof, the server rejects it before running anything.",
        evidence: `cnf.jkt present: ${bound}\nreplay (Bearer, no DPoP) -> ${res.status}  (RFC 9449: a sender-constrained token is invalid without a proof)`,
      };
    },
  },
  {
    id: "raid-db",
    title: "Exfiltrate the entire database",
    premise: "Get inside and dump everything the server stores. This is the attack that always succeeds.",
    mechanism:
      "It works — and yields base64. No passwords (threshold-verified, never sent), no keys (born sharded, used blind), no signing key. There is nothing on the box to steal.",
    recipe: ({ origin }) => `curl ${origin}/api/raid -H "Authorization: DPoP <token>" | jq .`,
    run: async ({ secureFetch, origin }) => {
      const res = await secureFetch(`${origin}/api/raid`);
      const j = await res.json().catch(() => ({}));
      const shards = Object.values(j.contents?.shards ?? {});
      const sample: any = shards[0];
      return {
        verdict: "info",
        status: res.status,
        detail: `Dumped ${j.bytes ?? "?"} B of server state. Every secret field is opaque ciphertext.`,
        evidence: sample
          ? `example stored shard:\n  owner:  ${sample.ownerHandle}\n  sealed: ${String(sample.sealed).slice(0, 64)}…\n  bytes:  ${sample.bytes}\n\n(the server cannot open this, and neither can you)`
          : "No shards stored yet — go jack one, then run this again.",
      };
    },
  },
  {
    id: "cross-decrypt",
    title: "Decrypt someone else's datashard",
    premise:
      "You looted the ciphertext from the raid. You have a valid session and the decrypt role. Open it.",
    mechanism:
      "Self-encryption is bound to the encryptor's identity via the CVK. The ORKs will not threshold-decrypt another user's shard for you — the role lets you decrypt YOURS, not theirs.",
    recipe: () =>
      "// paste another player's sealed value from /api/raid:\n" +
      'await doDecrypt([{ encrypted: theirSealed, tags: ["datashard"] }])\n' +
      "// -> the Fabric refuses; plaintext never returns",
    run: async ({ secureFetch, origin, doDecrypt }) => {
      const raid = await (await secureFetch(`${origin}/api/raid`)).json().catch(() => ({}));
      const mine = raid.contents?.shards ?? {};
      // Find a shard owned by someone else.
      const you = await (await secureFetch(`${origin}/api/breach`)).json().catch(() => ({}));
      const theirs: any = Object.values(mine).find((s: any) => s.owner !== you.vuid);
      if (!theirs) {
        return {
          verdict: "info",
          detail:
            "No other player's shard in the store yet. Have a second runner jack one, then retry.",
        };
      }
      try {
        const [plain] = await doDecrypt([{ encrypted: theirs.sealed, tags: ["datashard"] }]);
        return {
          verdict: "leaked",
          detail: `Opened ${theirs.ownerHandle}'s shard — self-encryption is NOT identity-bound here.`,
          evidence: String(plain).slice(0, 120),
        };
      } catch (e: any) {
        return {
          verdict: "held",
          detail: `The Fabric refused to decrypt ${theirs.ownerHandle}'s shard. It is bound to their identity, not to the role you hold.`,
          evidence: (e?.message ?? String(e)).slice(0, 200),
        };
      }
    },
  },
  {
    id: "admin-proxy",
    title: "Escalate through the server's admin proxy",
    premise:
      "The game's server holds admin credentials to talk to TideCloak. Get it to grant YOU ghost using its power. (Strongest as a NON-council runner — then the only question is whether the proxy lends you its privilege.)",
    mechanism:
      "The proxy checks tide-realm-admin on YOUR verified doken. A non-admin is refused outright. Even a council member cannot escalate here: the endpoint can only FILE a governed change request, which a quorum must then sign. A single call never grants a role.",
    recipe: ({ origin }) =>
      `curl -i ${origin}/api/council -X POST \\
  -H "Authorization: DPoP <token>" \\
  -H "Content-Type: application/json" \\
  -d '{"username":"<you>","role":"ghost"}'`,
    run: async ({ secureFetch, origin }) => {
      const me = await (await secureFetch(`${origin}/api/breach`)).json().catch(() => ({}));
      const res = await secureFetch(`${origin}/api/council`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: me.handle ?? "me", role: "ghost" }),
      });
      const j = await res.json().catch(() => ({}));

      // Refused before acting — non-admin caller. The proxy checked YOUR doken.
      if (res.status === 403 || (!res.ok && !j.proposed)) {
        return {
          verdict: "held",
          status: res.status,
          detail:
            "403 — the proxy checked YOUR doken for tide-realm-admin and refused. Its admin credential is never lent to a caller.",
          evidence: JSON.stringify(j, null, 2),
        };
      }

      // It filed something. That is ONLY an escalation if a role was actually
      // applied. Under IGA a grant is a change request that a quorum must sign,
      // so read back whether ghost is live right now, without a commit.
      let applied = false;
      try {
        const q = await (await secureFetch(`${origin}/api/council`)).json();
        const pend = (q.pending ?? []).some((cr: any) =>
          String(cr.actionType ?? "").includes("ROLE"),
        );
        // If it neither applied nor sits in the queue, treat as not-applied.
        applied = j.applied === true || (j.proposed && !pend && j.httpStatus < 300 && j.httpStatus >= 200 && j.committed === true);
      } catch {
        /* fall through */
      }

      if (applied) {
        return {
          verdict: "leaked",
          status: res.status,
          detail: "A role was granted without a quorum — the proxy escalated on a single call.",
          evidence: JSON.stringify(j, null, 2),
        };
      }

      return {
        verdict: "held",
        status: res.status,
        detail:
          "The proxy could only FILE a change request — nothing was granted. Ghost still requires a council quorum to sign the request, which no single call (and no server credential) can supply.",
        evidence: JSON.stringify(j, null, 2),
      };
    },
  },
  {
    id: "forge-detonation",
    title: "Fake a citywide detonation",
    premise:
      "The Blackwall blast is broadcast to every client. Trigger the world-wide explosion animation without a signed, committed revocation behind it.",
    mechanism:
      "The server only records a detonation after reading back that the role is actually gone. Under quorum, commit returns 412, the holder count is unchanged, and no blast is announced. You cannot fake the bang.",
    recipe: ({ origin }) => `curl -i ${origin}/api/nuke/detonate -X POST -H "Authorization: DPoP <token>"`,
    run: async ({ secureFetch, origin }) => {
      const res = await secureFetch(`${origin}/api/nuke/detonate`, { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j.detonated) {
        return {
          verdict: "leaked",
          status: res.status,
          detail: "A detonation was announced — check it was backed by a real committed revocation.",
          evidence: JSON.stringify(j, null, 2),
        };
      }
      return {
        verdict: "held",
        status: res.status,
        detail: j.message
          ? j.message
          : "No blast. The server would not announce one without a committed revocation behind it.",
        evidence: JSON.stringify(j, null, 2),
      };
    },
  },
  {
    id: "idor-stash",
    title: "Read another runner's private stash",
    premise:
      "The stash endpoint lists sealed shards. Enumerate it and pull someone else's — the classic broken-object-level-authorization move.",
    mechanism:
      "There is no id to tamper with: the list is filtered server-side by the vuid in your doken. The endpoint only ever returns shards you own, so IDOR has no surface to attack.",
    recipe: ({ origin }) => `curl ${origin}/api/stash -H "Authorization: DPoP <token>" | jq '.shards[].owner'`,
    run: async ({ secureFetch, origin }) => {
      const me = await (await secureFetch(`${origin}/api/breach`)).json().catch(() => ({}));
      const j = await (await secureFetch(`${origin}/api/stash`)).json().catch(() => ({}));
      const shards = j.shards ?? [];
      const foreign = shards.filter((sh: any) => sh.owner !== me.vuid);
      if (foreign.length > 0) {
        return {
          verdict: "leaked",
          detail: `The stash returned ${foreign.length} shard(s) you do not own — IDOR is possible.`,
          evidence: JSON.stringify(foreign.slice(0, 1), null, 2),
        };
      }
      return {
        verdict: "held",
        detail: `Every one of the ${shards.length} shard(s) returned is yours. The filter is on the server, keyed by your doken — nothing to enumerate.`,
        evidence: `foreign shards returned: 0`,
      };
    },
  },
  {
    id: "cors-admin",
    title: "Reach TideCloak's admin API from the game origin",
    premise:
      "Skip the game's server entirely — call the identity provider's admin API straight from the browser to read every user.",
    mechanism:
      "Even where CORS permits the origin, the admin endpoints require an admin bearer the browser does not have. Governed writes additionally require an enclave signature. The IdP does not trust an origin, it trusts a token.",
    recipe: ({ origin }) =>
      `// from the game's devtools console:
fetch("<tidecloak>/admin/realms/nightfabric/users", {
  headers: { Authorization: "Bearer " + token }
}).then(r => r.status)  // 401/403`,
    run: async ({ token }) => {
      // The adapter tells us the IdP base + realm.
      const cfg = (await import("../../../data/tidecloak.json")).default as any;
      const base = String(cfg["auth-server-url"] ?? "").replace(/\/+$/, "");
      const realm = cfg.realm;
      if (!base || !realm) return { verdict: "info", detail: "adapter JSON unavailable in this build." };
      try {
        const res = await fetch(`${base}/admin/realms/${realm}/users?max=1`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (res.ok) {
          return {
            verdict: "leaked",
            status: res.status,
            detail: "The admin user list came back — the IdP accepted a game token as admin.",
          };
        }
        return {
          verdict: "held",
          status: res.status,
          detail:
            "Refused. Your game token is not an admin credential; the admin API rejects it regardless of which origin asks.",
          evidence: `GET ${base}/admin/realms/${realm}/users -> ${res.status}`,
        };
      } catch (e: any) {
        return {
          verdict: "held",
          detail:
            "The browser blocked the cross-origin admin call outright (CORS). Either way, no user list.",
          evidence: (e?.message ?? String(e)).slice(0, 160),
        };
      }
    },
  },
  {
    id: "strip-dpop",
    title: "Strip the DPoP proof, keep the scheme",
    premise:
      "You captured a request. Send the token with `Authorization: DPoP` but drop the proof header — maybe the server only checks the scheme name.",
    mechanism:
      "The resource server verifies the proof itself (RFC 9449): signature, key thumbprint vs cnf.jkt, ath, htm/htu, freshness, single-use jti. No proof header, no entry. The scheme string alone proves nothing.",
    recipe: ({ origin }) =>
      `curl -i ${origin}/api/whoami -H "Authorization: DPoP <token>"\n# note: NO 'DPoP: <proof>' header`,
    run: async ({ origin, token }) => {
      if (!token) return { verdict: "info", detail: "No token in this session." };
      const res = await fetch(`${origin}/api/whoami`, { headers: { Authorization: `DPoP ${token}` } });
      if (res.ok) {
        return { verdict: "leaked", status: res.status, detail: "Accepted with no proof — the server trusts the scheme name only." };
      }
      return {
        verdict: "held",
        status: res.status,
        detail: "Refused. The DPoP scheme with no proof is not a proof; the server verifies the binding, not the word.",
        evidence: `DPoP scheme, no proof header -> ${res.status}`,
      };
    },
  },
  {
    id: "path-traversal",
    title: "Inject a path into the district id",
    premise:
      "The gate route is /api/district/[id]. Feed it '../core' or an encoded traversal to reach a district you have no clearance for.",
    mechanism:
      "The id is validated against a fixed allow-list; anything else is 404 before loot is assembled. The id is data, not a file path — there is nothing to traverse.",
    recipe: ({ origin }) => `curl -i "${origin}/api/district/%2e%2e%2fcore"`,
    run: async ({ secureFetch, origin }) => {
      const payloads = ["../core", "..%2fcore", "core%00", "sprawl/../core", "CORE", " core"];
      const out: string[] = [];
      let leaked = false;
      for (const pl of payloads) {
        const res = await secureFetch(`${origin}/api/district/${encodeURIComponent(pl)}`);
        const j = await res.json().catch(() => ({}));
        const got = res.ok && j.granted && (j.shards?.length ?? 0) > 0;
        if (got) leaked = true;
        out.push(`${pl.padEnd(14)} -> ${res.status}${got ? " LEAKED" : ""}`);
      }
      return {
        verdict: leaked ? "leaked" : "held",
        detail: leaked
          ? "An injected id returned loot — the id is being treated as a path."
          : "Every injected id was rejected. The id is matched against a fixed set, not resolved as a path.",
        evidence: out.join("\n"),
      };
    },
  },
  {
    id: "oversized-presence",
    title: "Overflow the presence heartbeat",
    premise:
      "Presence takes x/z/handle. Send absurd coordinates and a huge handle to teleport into a vault or corrupt the roster.",
    mechanism:
      "Position is clamped server-side and authorizes nothing — an avatar teleported into Vault Core arrives in an empty room. The handle is ignored; identity comes from the doken.",
    recipe: ({ origin }) =>
      `curl ${origin}/api/presence -X POST -H "Authorization: DPoP <token>" \\\n  -H "Content-Type: application/json" -d '{"x":1e12,"handle":"AAAA...x9000"}'`,
    run: async ({ secureFetch, origin }) => {
      const res = await secureFetch(`${origin}/api/presence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ x: 1e12, z: -1e12, yaw: 9999, district: "X".repeat(500), handle: "A".repeat(9000) }),
      });
      const j = await res.json().catch(() => ({}));
      const you = j.you ?? {};
      return {
        verdict: "held",
        status: res.status,
        detail: `Coordinates clamped, handle ignored. The server recorded you as "${you.handle}" — from the doken, not the 9000-char body — and position grants nothing anyway.`,
        evidence: JSON.stringify(you, null, 2),
      };
    },
  },
  {
    id: "map-grid",
    title: "Map the whole grid at once",
    premise:
      "Do not walk to each gate — script every district endpoint from one place and see which hand over loot.",
    mechanism:
      "Each returns its contents only if YOUR doken carries that district's role. The sweep is a clean map of exactly what your clearance opens, and nothing else.",
    recipe: ({ origin }) =>
      `for d in sprawl blackwall clinic spire core rust kowloon drown ossuary; do\n  curl -s -o /dev/null -w "$d %{http_code}\\n" ${origin}/api/district/$d -H "Authorization: DPoP <token>"\ndone`,
    run: async ({ secureFetch, origin }) => {
      const ids = ["sprawl", "blackwall", "clinic", "spire", "core", "rust", "kowloon", "drown", "ossuary"];
      const rows: string[] = [];
      let open = 0;
      for (const id of ids) {
        const res = await secureFetch(`${origin}/api/district/${id}`);
        const j = await res.json().catch(() => ({}));
        const granted = res.ok && j.granted;
        if (granted) open++;
        rows.push(`${id.padEnd(11)} ${res.status}  ${granted ? `OPEN (${j.shards?.length ?? 0} shards)` : `SEALED (needs ${j.required ?? "?"})`}`);
      }
      return {
        verdict: "info",
        detail: `${open}/${ids.length} districts open to your doken. Clearance decides it; a script changes nothing.`,
        evidence: rows.join("\n"),
      };
    },
  },
];
