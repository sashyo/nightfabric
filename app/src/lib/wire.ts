/**
 * THE WIRE — a live feed of what is actually happening in Sanctum-9.
 *
 * Every entry is written by the SERVER at the moment it makes a decision, from
 * the caller's verified doken. Clients cannot post to it. That is what makes it
 * worth watching: it is not chat, it is not telemetry the client volunteered,
 * it is the authorization log with a neon frame around it.
 *
 * It is also the honest counterpart to the encryption demo. The wire records
 * that vex sealed a datashard in Blackwall — it cannot record WHAT. Metadata
 * leaks even when content does not, and a security demo that hid that would be
 * making the opposite of its own point.
 */

export type WireKind =
  | "gate-pass"
  | "gate-deny"
  | "seal"
  | "open"
  | "drop"
  | "propose"
  | "sign"
  | "commit"
  | "arm"
  | "boom"
  | "join";

export interface WireEvent {
  seq: number;
  kind: WireKind;
  /** Who, from the doken. Never from a request body. */
  handle: string;
  text: string;
  at: number;
}

const MAX = 100;
let seq = 0;
const LOG: WireEvent[] = [];

export function emit(kind: WireKind, handle: string, text: string): WireEvent {
  const e: WireEvent = { seq: ++seq, kind, handle, text, at: Date.now() };
  LOG.push(e);
  if (LOG.length > MAX) LOG.splice(0, LOG.length - MAX);
  return e;
}

/** Everything after `since`; a fresh client passes 0 and gets recent history. */
export function wireSince(n: unknown): WireEvent[] {
  const from = typeof n === "number" && Number.isFinite(n) ? n : 0;
  if (from <= 0) return LOG.slice(-25);
  return LOG.filter((e) => e.seq > from);
}
