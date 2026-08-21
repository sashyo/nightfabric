/**
 * Bodies for Sanctum-9 — named NPCs and the ambient crowd.
 *
 * Cheap on purpose: a capsule, a head, an emissive visor. The crowd is one
 * shared geometry across many groups with per-instance colour, walking seeded
 * loops so the city looks the same every session.
 */
import * as THREE from "three";
import { NPCS, CROWD_SIZE, type Npc } from "@/lib/npcs";
import { DISTRICTS, districtAt } from "@/lib/districts";
import { makeBillboard } from "./city";

const BODY = new THREE.CapsuleGeometry(0.62, 1.5, 4, 8);
const HEAD = new THREE.SphereGeometry(0.42, 10, 8);
const VISOR = new THREE.BoxGeometry(0.66, 0.16, 0.06);
const UMBRELLA = new THREE.ConeGeometry(1.15, 0.42, 10, 1, true);

function figure(coat: number, accent: number, umbrella: boolean): THREE.Group {
  const g = new THREE.Group();

  const body = new THREE.Mesh(
    BODY,
    new THREE.MeshStandardMaterial({ color: coat, roughness: 0.85, metalness: 0.1 }),
  );
  body.position.y = 1.32;
  g.add(body);

  const head = new THREE.Mesh(
    HEAD,
    new THREE.MeshStandardMaterial({ color: 0x14161f, roughness: 0.7 }),
  );
  head.position.y = 2.5;
  g.add(head);

  const visor = new THREE.Mesh(
    VISOR,
    new THREE.MeshBasicMaterial({ color: accent, toneMapped: false }),
  );
  visor.position.set(0, 2.52, 0.34);
  g.add(visor);

  if (umbrella) {
    const u = new THREE.Mesh(
      UMBRELLA,
      new THREE.MeshStandardMaterial({
        color: 0x0e1018,
        roughness: 0.9,
        side: THREE.DoubleSide,
        emissive: accent,
        emissiveIntensity: 0.12,
      }),
    );
    u.position.y = 3.15;
    g.add(u);
  }
  return g;
}

/* ------------------------------------------------------------ named NPCs */

export interface NpcObj {
  npc: Npc;
  group: THREE.Group;
  label: THREE.Mesh;
  pos: THREE.Vector3;
}

export function makeNpcs(): { group: THREE.Group; objs: NpcObj[] } {
  const group = new THREE.Group();
  const objs: NpcObj[] = [];

  for (const npc of NPCS) {
    const g = figure(0x1a1d2a, npc.color, false);

    // A soft pool of light so they read as a destination at distance.
    const glow = new THREE.Mesh(
      new THREE.CircleGeometry(3.2, 24),
      new THREE.MeshBasicMaterial({
        color: npc.color,
        transparent: true,
        opacity: 0.13,
        toneMapped: false,
        depthWrite: false,
      }),
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.06;
    g.add(glow);

    const label = makeBillboard(npc.name, npc.tag, npc.color);
    label.scale.setScalar(0.17);
    label.position.y = 4.4;
    g.add(label);

    g.position.set(npc.pos[0], 0, npc.pos[1]);
    group.add(g);
    objs.push({ npc, group: g, label, pos: g.position.clone() });
  }
  return { group, objs };
}

/* ---------------------------------------------------------------- crowd */

interface Walker {
  group: THREE.Group;
  /** Loop centre and radius in world space. */
  cx: number;
  cz: number;
  r: number;
  /** Radians/sec, signed. */
  speed: number;
  phase: number;
  bob: number;
}

const COATS = [0x141721, 0x1b1526, 0x101a22, 0x21161c, 0x0f1d1b];
const ACCENTS = [0x00e5ff, 0xff2d95, 0x39ff88, 0xffc247, 0xb46cff];

function seeded(i: number) {
  let h = Math.imul(i + 1, 2654435761) >>> 0;
  return () => {
    h ^= h << 13; h >>>= 0;
    h ^= h >>> 17;
    h ^= h << 5; h >>>= 0;
    return (h % 100000) / 100000;
  };
}

export function makeCrowd(): { group: THREE.Group; step: (dt: number) => void } {
  const group = new THREE.Group();
  const walkers: Walker[] = [];

  for (let i = 0; i < CROWD_SIZE; i++) {
    const rnd = seeded(i);
    // Weight the crowd toward The Sprawl; the locked districts stay sparse.
    const d = rnd() < 0.62 ? DISTRICTS[0] : DISTRICTS[1 + Math.floor(rnd() * (DISTRICTS.length - 1))];
    const a = rnd() * Math.PI * 2;
    const rr = 24 + rnd() * (d.radius - 40);
    const cx = d.center[0] + Math.cos(a) * rr * 0.5;
    const cz = d.center[1] + Math.sin(a) * rr * 0.5;

    const g = figure(
      COATS[Math.floor(rnd() * COATS.length)],
      ACCENTS[Math.floor(rnd() * ACCENTS.length)],
      rnd() < 0.55,
    );
    group.add(g);
    walkers.push({
      group: g,
      cx,
      cz,
      r: 6 + rnd() * 18,
      speed: (rnd() < 0.5 ? -1 : 1) * (0.09 + rnd() * 0.22),
      phase: rnd() * Math.PI * 2,
      bob: rnd() * Math.PI * 2,
    });
  }

  let t = 0;
  const step = (dt: number) => {
    t += dt;
    for (const w of walkers) {
      const a = w.phase + t * w.speed;
      const x = w.cx + Math.cos(a) * w.r;
      const z = w.cz + Math.sin(a) * w.r;
      w.group.position.set(x, Math.sin(t * 6 + w.bob) * 0.05, z);
      // Face along the tangent of the loop.
      w.group.rotation.y = -a + (w.speed > 0 ? Math.PI / 2 : -Math.PI / 2);
    }
  };

  return { group, step };
}

export { districtAt };
