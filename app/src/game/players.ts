/**
 * Other runners, drawn from the authenticated presence roster.
 *
 * Their nameplates are not decoration: the handle came out of a threshold-
 * signed doken on the server, so it is the one thing in this scene that cannot
 * be forged by a modified client. Their POSITION, by contrast, is whatever
 * their client claimed — cosmetic, and treated as such.
 */
import * as THREE from "three";
import { makeBillboard, makeBubble } from "./city";

export interface RemoteState {
  vuid: string;
  handle: string;
  roles: string[];
  x: number;
  z: number;
  yaw: number;
  pitch?: number;
  district: string | null;
}

/** Clearance decides the silhouette's colour, so the street is readable. */
function tint(roles: string[]): number {
  if (roles.includes("ghost")) return 0xb46cff;
  if (roles.includes("netrunner")) return 0x39ff88;
  if (roles.includes("ripperdoc")) return 0xff3355;
  if (roles.includes("fixer")) return 0xffc247;
  return 0x00e5ff;
}

interface Remote {
  group: THREE.Group;
  /** Head + visor, pivoted so it can tilt up/down independently of the body. */
  head: THREE.Group;
  plate: THREE.Mesh;
  tpitch: number;
  /** Transient speech bubble; disposed and replaced on each new line. */
  bubble: THREE.Mesh | null;
  bubbleUntil: number;
  /** Interpolation targets — the network runs at 8Hz, the renderer at 60. */
  tx: number;
  tz: number;
  tyaw: number;
  color: number;
  handle: string;
  rolesKey: string;
}

const BODY = new THREE.CapsuleGeometry(0.62, 1.5, 4, 8);
const HEAD = new THREE.SphereGeometry(0.42, 10, 8);
const VISOR = new THREE.BoxGeometry(0.66, 0.16, 0.06);

function avatar(color: number): { group: THREE.Group; head: THREE.Group } {
  const g = new THREE.Group();

  const body = new THREE.Mesh(
    BODY,
    new THREE.MeshStandardMaterial({ color: 0x161a26, roughness: 0.8, metalness: 0.2 }),
  );
  body.position.y = 1.32;
  g.add(body);

  // Head pivot at the neck, so a pitch tilts the head (and its visor) up/down.
  const headPivot = new THREE.Group();
  headPivot.position.y = 2.5;
  g.add(headPivot);

  const head = new THREE.Mesh(HEAD, new THREE.MeshStandardMaterial({ color: 0x11131c, roughness: 0.7 }));
  headPivot.add(head);

  const visor = new THREE.Mesh(VISOR, new THREE.MeshBasicMaterial({ color, toneMapped: false }));
  visor.position.set(0, 0.02, 0.34);
  headPivot.add(visor);

  // Rim so other runners are findable in the fog and rain.
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(1.5, 2.1, 26),
    new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.35, toneMapped: false,
      side: THREE.DoubleSide, depthWrite: false,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.08;
  g.add(ring);

  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.16, 26, 6, 1, true),
    new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.09, toneMapped: false,
      side: THREE.DoubleSide, depthWrite: false,
    }),
  );
  beam.position.y = 13;
  g.add(beam);

  return { group: g, head: headPivot };
}

export class Players {
  private map = new Map<string, Remote>();
  readonly group = new THREE.Group();

  /** Replace the roster wholesale — the server sends the full set each beat. */
  sync(list: RemoteState[]) {
    const seen = new Set<string>();

    for (const p of list) {
      seen.add(p.vuid);
      const color = tint(p.roles);
      const rolesKey = p.roles.slice().sort().join(",");
      let r = this.map.get(p.vuid);

      if (!r) {
        const { group, head } = avatar(color);
        const plate = makeBillboard(p.handle.toUpperCase(), rolesKey || "runner", color);
        plate.scale.setScalar(0.15);
        plate.position.y = 4.2;
        group.add(plate);
        group.position.set(p.x, 0, p.z);
        this.group.add(group);
        r = { group, head, plate, bubble: null, bubbleUntil: 0,
              tx: p.x, tz: p.z, tyaw: p.yaw, tpitch: p.pitch ?? 0, color, handle: p.handle, rolesKey };
        this.map.set(p.vuid, r);
      } else if (r.rolesKey !== rolesKey || r.handle !== p.handle) {
        // Their doken changed — a promotion landed. Re-label and re-tint, which
        // is the visible moment a council quorum finished its work.
        r.group.remove(r.plate);
        r.plate.geometry.dispose();
        (r.plate.material as THREE.Material).dispose();
        const plate = makeBillboard(p.handle.toUpperCase(), rolesKey || "runner", color);
        plate.scale.setScalar(0.15);
        plate.position.y = 4.2;
        r.group.add(plate);
        r.plate = plate;
        r.handle = p.handle;
        r.rolesKey = rolesKey;
        r.color = color;
        r.group.traverse((o) => {
          const m = (o as THREE.Mesh).material as any;
          if (m && m.color && o !== plate) m.color.setHex(color);
        });
      }

      r.tx = p.x;
      r.tz = p.z;
      r.tyaw = p.yaw;
      r.tpitch = p.pitch ?? 0;
    }

    for (const [vuid, r] of this.map) {
      if (seen.has(vuid)) continue;
      this.clearBubble(r);
      this.group.remove(r.group);
      r.group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry && m.geometry !== BODY && m.geometry !== HEAD && m.geometry !== VISOR) {
          m.geometry.dispose();
        }
      });
      this.map.delete(vuid);
    }
  }

  /** Show what someone just said, floating over their head for a few seconds. */
  say(vuid: string, text: string, now: number) {
    const r = this.map.get(vuid);
    if (!r) return;
    this.clearBubble(r);
    const b = makeBubble(text.slice(0, 120), r.color);
    b.position.y = 6.2;
    r.group.add(b);
    r.bubble = b;
    r.bubbleUntil = now + 7000;
  }

  private clearBubble(r: Remote) {
    if (!r.bubble) return;
    r.group.remove(r.bubble);
    r.bubble.geometry.dispose();
    const m = r.bubble.material as THREE.MeshBasicMaterial;
    // Each bubble owns a CanvasTexture; leaving them to the GC leaks GPU memory.
    m.map?.dispose();
    m.dispose();
    r.bubble = null;
  }

  /** Smooth 8Hz network updates into 60fps motion. */
  step(dt: number, lookAt: THREE.Vector3, now = 0) {
    const k = 1 - Math.pow(0.0015, dt);
    for (const r of this.map.values()) {
      if (r.bubble) {
        if (now > r.bubbleUntil) this.clearBubble(r);
        else r.bubble.lookAt(lookAt.x, r.group.position.y + r.bubble.position.y, lookAt.z);
      }
      r.group.position.x += (r.tx - r.group.position.x) * k;
      r.group.position.z += (r.tz - r.group.position.z) * k;

      let d = r.tyaw - r.group.rotation.y;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      r.group.rotation.y += d * k;

      // Head tilts to where they are looking; clamp so it stays anatomical.
      const targetPitch = Math.max(-0.9, Math.min(0.9, r.tpitch));
      r.head.rotation.x += (targetPitch - r.head.rotation.x) * k;

      r.plate.lookAt(lookAt.x, r.group.position.y + r.plate.position.y, lookAt.z);
    }
  }

  get count() {
    return this.map.size;
  }
}
