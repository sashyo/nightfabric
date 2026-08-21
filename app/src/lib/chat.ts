/**
 * Street comms.
 *
 * Same rule as presence: the SENDER is taken from the verified doken, never
 * from the request body. You can say anything; you cannot say it as someone
 * else. In a game whose whole subject is unforgeable identity, a chat where you
 * type your own display name would be an odd thing to ship.
 *
 * Deliberately NOT end-to-end encrypted, and the UI says so. Every message here
 * is plaintext on the server, and that contrast is the teaching tool: the
 * datashards in your stash and the drops in the crew vault are the encrypted
 * things. Say something in chat, then hit the CORPO RAID CONSOLE — you will
 * find exactly what you typed, sitting next to ciphertext nobody can open.
 */

export interface ChatLine {
  /** Monotonic, so a client can ask for "everything after N" cheaply. */
  seq: number;
  vuid: string;
  handle: string;
  /** Clearance, for colouring. From the doken. */
  roles: string[];
  text: string;
  at: number;
}

const MAX = 120;
const MAX_LEN = 200;
/** Per-sender floor between messages. Crude, and enough for a small world. */
const COOLDOWN_MS = 400;

/**
 * The UI is terminal-styled, so a message must not be able to smuggle escape
 * sequences onto anyone else's screen. Built from escapes rather than written
 * literally, so the source stays free of actual control bytes.
 */
const CONTROL = new RegExp("[\\u0000-\\u001f\\u007f]", "g");

let seq = 0;
const LOG: ChatLine[] = [];
const lastSent = new Map<string, number>();

export function say(
  who: { vuid: string; handle: string; roles: string[] },
  raw: unknown,
): { ok: true; line: ChatLine } | { ok: false; error: string } {
  const now = Date.now();

  const prev = lastSent.get(who.vuid) ?? 0;
  if (now - prev < COOLDOWN_MS) return { ok: false, error: "Slow down." };

  if (typeof raw !== "string") return { ok: false, error: "text required" };
  const text = raw.replace(CONTROL, " ").trim().slice(0, MAX_LEN);
  if (!text) return { ok: false, error: "empty" };

  lastSent.set(who.vuid, now);
  const line: ChatLine = {
    seq: ++seq,
    vuid: who.vuid,
    handle: who.handle,
    roles: who.roles,
    text,
    at: now,
  };
  LOG.push(line);
  if (LOG.length > MAX) LOG.splice(0, LOG.length - MAX);
  return { ok: true, line };
}

/** Everything after `since`. A fresh client passes 0 and gets the recent log. */
export function since(n: unknown): ChatLine[] {
  const from = typeof n === "number" && Number.isFinite(n) ? n : 0;
  if (from <= 0) return LOG.slice(-30);
  return LOG.filter((l) => l.seq > from);
}

export function head(): number {
  return seq;
}
