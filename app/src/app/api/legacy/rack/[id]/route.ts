import { mintVaultFlag } from "@/lib/legacy";

/**
 * Hackable server racks INSIDE the district interiors. Each runs the old stack
 * and falls to a REAL exploit you have to actually perform (path traversal,
 * command injection, IDOR, a debug backdoor, or a default remote login). GET
 * hands you the challenge; POST is where you run it and, on success, get the
 * loot plus a unique signed flag worth points.
 *
 * The golden Vault Core has none of these: there is nothing there to take.
 */
const LOOT: Record<string, string[]> = {
  blackwall: ["cold-storage index the corps swore they zeroed", "a substation master schedule, 04:00 sweeps", "3,100 fragments with no keys attached"],
  clinic: ["a plaintext patient queue this drone should never have kept", "the maintenance login, cached", "billing records for procedures the clinic can't itself read"],
  spire: ["board minutes with names redacted by policy, not ink", "the concierge's session log", "a cargo manifest for the golden gate loading bay"],
  rust: ["salvage tags from four folded corps", "the gate controller's factory firmware", "an admin's forgotten backup, unencrypted"],
  kowloon: ["forty floors of resident records, no landlord", "the 2008 registry's raw query log", "a stack of unpaid utility tokens"],
  drown: ["dive logs from the flooded server farm", "rack humidity telemetry (they still run)", "a corp's drowned, unreadable-to-them archive"],
  ossuary: ["retirement certificates for identities the city let go", "the seal relay's fetch history", "a list of who tried to open the dead, and failed"],
};

type Kind = "traversal" | "cmdi" | "idor" | "backdoor" | "creds";
const KINDS: Kind[] = ["traversal", "cmdi", "idor", "backdoor", "creds"];
function kindFor(id: string): Kind {
  let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return KINDS[h % KINDS.length];
}
const CH: Record<Kind, { vuln: string; hint: string; field: { name: string; label: string; ph: string } }> = {
  traversal: { vuln: "PATH TRAVERSAL — the rack's file API joins your path onto a base dir with no sanitization", hint: "It expects a filename under logs/. Climb out with ../ and grab something sensitive: passwd, shadow, an id_rsa, a .env, a .key.", field: { name: "path", label: "file path", ph: "logs/today.txt" } },
  cmdi: { vuln: "COMMAND INJECTION — your input is passed straight to a shell for a 'diagnostic'", hint: "It runs `ping <input>`. Chain your own command with ; or | (e.g. `x; cat /flag`).", field: { name: "cmd", label: "diagnostic host", ph: "10.0.0.1" } },
  idor: { vuln: "IDOR — records are fetched by id with no ownership check", hint: "Your session id is 1041. Ask for a record that isn't yours (any other number).", field: { name: "userId", label: "record id", ph: "1041" } },
  backdoor: { vuln: "DEBUG BACKDOOR — a dev left a switch in the query params", hint: "Flip the hidden debug flag. Common ones: debug=true, admin=1, god=1.", field: { name: "query", label: "query string", ph: "view=summary" } },
  creds: { vuln: "DEFAULT REMOTE LOGIN — the management port still has its factory credentials", hint: "It's a well-known root default. Try user:pass.", field: { name: "creds", label: "user:pass", ph: "user:pass" } },
};

function ran(kind: Kind, b: any): boolean {
  switch (kind) {
    case "traversal": { const p = String(b.path || ""); return /\.\.[\/\\]/.test(p) && /(passwd|shadow|id_rsa|\.env|\.key|secret|flag)/i.test(p); }
    case "cmdi": { const p = String(b.cmd || ""); return /[;|&`\n]\s*(cat|ls|id|whoami|curl|wget|nc|sh|bash|cat)\b/i.test(p); }
    case "idor": { const p = String(b.userId || "").trim(); return /^\d{1,10}$/.test(p) && p !== "1041"; }
    case "backdoor": { const p = String(b.query || "").toLowerCase(); return /(debug=true|debug=1|admin=1|admin=true|god=1|god=true)/.test(p); }
    case "creds": { const [u, pw] = String(b.creds || "").split(":"); return (u === "root" && pw === "toor") || (u === "admin" && pw === "admin"); }
  }
}

function meta(req: Request) {
  const id = decodeURIComponent(new URL(req.url).pathname.split("/").pop() || "");
  const dist = id.split("-")[0];
  return { id, dist, kind: kindFor(id) };
}

export const GET = async (req: Request) => {
  const { id, dist, kind } = meta(req);
  const c = CH[kind];
  return Response.json({
    name: `${(dist || "unknown").toUpperCase()} SERVER RACK ${id.split("-")[1] || ""}`.trim(),
    kind, vuln: c.vuln, hint: c.hint, field: c.field, points: 45,
    submit: `POST /api/legacy/rack/${id} with { "${c.field.name}": "<payload>" }`,
  });
};

export const POST = async (req: Request) => {
  const { id, dist, kind } = meta(req);
  const b = (await req.json().catch(() => ({}))) as any;
  if (!ran(kind, b)) {
    return Response.json({ ok: false, hint: CH[kind].hint }, { status: 403 });
  }
  const loot = LOOT[dist] ?? ["an unlabeled data crate", "a corp's forgotten backup", "cache of expired tokens"];
  return Response.json({
    ok: true,
    name: `${(dist || "unknown").toUpperCase()} SERVER RACK ${id.split("-")[1] || ""}`.trim(),
    loot,
    flag: mintVaultFlag(`VAULT-RACK-${id}`, 45),
    points: 45,
    note: "the rack ran the old stack. one real exploit and it handed you everything.",
  });
};
