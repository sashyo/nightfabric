/**
 * The Sanctum-9 server-side store.
 *
 * This file is deliberately dumb. It is a flat JSON file that holds *sealed
 * bytes and nothing else*: no keys, no key material, no plaintext, no password
 * hashes. That is the point of the demo — `/api/raid` dumps this file verbatim
 * so a player can look at everything the operator of this game has, and find
 * that it is base64 and metadata.
 *
 * Swap it for a real database and the security story does not change, because
 * the security never depended on the database.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";

export interface Shard {
  id: string;
  /** Tide vuid of the owner. Self-encryption is identity-bound to this. */
  owner: string;
  ownerHandle: string;
  district: string;
  /** TideMemory envelope, base64. The server cannot open this. */
  sealed: string;
  /** Bytes of ciphertext, for the raid readout. */
  bytes: number;
  /** Tag the shard was sealed under (drives which _tide_ role is required). */
  tag: string;
  at: number;
}

export interface VaultEntry {
  id: string;
  authorHandle: string;
  author: string;
  /** Policy-governed VVK ciphertext. Any doken satisfying the Forseti contract opens it. */
  sealed: string;
  bytes: number;
  note: string;
  /** Tags the drop was sealed under. The Forseti contract reads these — a
   *  DecryptTimeLock tag here is what the ORKs enforce on every open. */
  tags: string[];
  at: number;
}

export interface ScoreRow {
  vuid: string;
  handle: string;
  points: number;
  /** Legacy CTF flags captured, and tidified districts cleared — deduped. */
  flags: string[];
  districts: string[];
  /** Used the hack map — reveals all target locations, but −10 per hack after. */
  usedMap?: boolean;
  at: number;
}

export interface Store {
  /** Personal, self-encrypted loot. Identity-bound: only the owner can open it. */
  shards: Record<string, Shard>;
  /** Shared crew vault, policy-governed. */
  vault: VaultEntry[];
  /** Signed Forseti policy bytes (base64) for the crew vault, set by an admin in-game. */
  vaultPolicy: string | null;
  /** Which shard ids each player has already looted, so the world does not respawn them. */
  looted: Record<string, string[]>;
  /** Per-player handle cache, for the council roster. */
  handles: Record<string, string>;
  /** The leaderboard. Tide-secured: only a verified doken can add to it. */
  scores: Record<string, ScoreRow>;
}

const FILE = join(process.cwd(), "data", "world.json");

const EMPTY: Store = {
  shards: {},
  vault: [],
  vaultPolicy: null,
  looted: {},
  handles: {},
  scores: {},
};

function read(): Store {
  if (!existsSync(FILE)) return structuredClone(EMPTY);
  try {
    return { ...structuredClone(EMPTY), ...JSON.parse(readFileSync(FILE, "utf-8")) };
  } catch {
    return structuredClone(EMPTY);
  }
}

function write(s: Store) {
  mkdirSync(dirname(FILE), { recursive: true });
  writeFileSync(FILE, JSON.stringify(s, null, 2));
}

/** Read-modify-write under a single tick. Fine for a local demo; not a database. */
export function mutate<T>(fn: (s: Store) => T): T {
  const s = read();
  const out = fn(s);
  write(s);
  return out;
}

export function snapshot(): Store {
  return read();
}

export function rawFile(): string {
  return existsSync(FILE) ? readFileSync(FILE, "utf-8") : "{}";
}

export function storePath(): string {
  return FILE;
}
