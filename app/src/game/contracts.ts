/**
 * Starter contracts — a light objective chain that teaches the game by doing.
 *
 * Each contract watches for a real event the player triggers (jacking a shard,
 * hitting the raid console, running an ICE panel, signing a change request) and
 * completes when it happens. No server state: this is a client-side coach that
 * turns "what do I even do here" into a checklist, and quietly walks a new
 * player past every Tide mechanic in the build.
 */

export interface Contract {
  id: string;
  title: string;
  hint: string;
  /** Eddies awarded on completion — flavour currency, no authority. */
  reward: number;
  /** Event key that completes it (see the emit() calls in the play screen). */
  on: string;
  done: boolean;
}

export const STARTER_CONTRACTS: Contract[] = [
  { id: "jack", title: "Jack a datashard", hint: "Find a glowing shard in any district you can enter, press E.", reward: 50, on: "seal", done: false },
  { id: "decrypt", title: "Open your stash", hint: "Press TAB, then DECRYPT a shard — watch the Fabric reassemble the key.", reward: 50, on: "decrypt", done: false },
  { id: "raid", title: "Raid the server", hint: "Hit the CORPO RAID CONSOLE in The Sprawl. See what an intruder actually gets.", reward: 75, on: "raid", done: false },
  { id: "gate", title: "Get refused", hint: "Walk up to a locked district gate. The 403 is the point.", reward: 40, on: "gate-deny", done: false },
  { id: "hack", title: "Break some ICE", hint: "Find a red ICE panel and run a real attack against the live server.", reward: 60, on: "ice", done: false },
  { id: "breach", title: "Read the breach console", hint: "Open the BREACH TERMINAL — ten real attacks, each with a curl you can run yourself.", reward: 60, on: "breach", done: false },
  { id: "tag", title: "Tag the wall", hint: "Spray your handle. Notice it is the one thing that is NOT encrypted.", reward: 30, on: "graffiti", done: false },
  { id: "social", title: "Say something", hint: "Press T and talk. Every runner in the city can read it.", reward: 30, on: "chat-sent", done: false },
  { id: "codex", title: "Read the datapad", hint: "Find the DATAPAD near spawn — it explains every district's clearance and the lore behind it.", reward: 40, on: "codex", done: false },
  { id: "petition", title: "Petition for clearance", hint: "Clearance can't be self-granted. Visit the COUNCIL RELAY to see how the quorum ratifies a promotion.", reward: 60, on: "council-open", done: false },
];
