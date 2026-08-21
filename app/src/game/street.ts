/**
 * Street furniture — the stuff that has nothing to do with the security demo
 * and everything to do with the place feeling lived-in. Noodle stalls, arcade
 * cabinets, holo-koi, dumpster fires, a claw machine, benches, vending walls.
 *
 * None of it is networked and none of it is authorization-relevant. It exists
 * so that between the ICE panels and the council relay there is a city.
 */
import * as THREE from "three";
import { makeBillboard } from "./city";

function rng(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 100000) / 100000; };
}

export interface Prop {
  group: THREE.Group;
  /** Optional per-frame animation. */
  tick?: (dt: number, t: number) => void;
  /** If interactable: world pos + label + what E does. */
  hot?: { pos: THREE.Vector3; label: string; action: string };
}

/* --------------------------------------------------------- noodle stall */

function noodleStall(color: number): Prop {
  const g = new THREE.Group();
  const counter = new THREE.Mesh(
    new THREE.BoxGeometry(6, 2.2, 3),
    new THREE.MeshStandardMaterial({ color: 0x1a1410, roughness: 0.7, metalness: 0.3 }),
  );
  counter.position.y = 1.1;
  g.add(counter);
  // Canopy.
  const canopy = new THREE.Mesh(
    new THREE.BoxGeometry(7, 0.3, 4),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.4, roughness: 0.6 }),
  );
  canopy.position.y = 4.4;
  g.add(canopy);
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 4.3, 5),
      new THREE.MeshStandardMaterial({ color: 0x2a2a30 }),
    );
    post.position.set(sx * 3, 2.15, -1.6);
    g.add(post);
  }
  // Lantern sign.
  const sign = makeBillboard("拉麺", "24hr", color);
  sign.scale.setScalar(0.14);
  sign.position.set(0, 3.5, 1.6);
  g.add(sign);
  // Steam.
  const steamGeo = new THREE.BufferGeometry();
  const N = 40;
  const sp = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { sp[i*3] = (Math.random()-0.5)*3; sp[i*3+1] = Math.random()*3; sp[i*3+2] = (Math.random()-0.5)*1.5; }
  steamGeo.setAttribute("position", new THREE.BufferAttribute(sp, 3));
  const steam = new THREE.Points(steamGeo, new THREE.PointsMaterial({
    color: 0xcfd8e0, size: 0.5, transparent: true, opacity: 0.3, depthWrite: false,
  }));
  steam.position.y = 2.4;
  g.add(steam);
  return {
    group: g,
    tick: (dt) => {
      const a = steamGeo.getAttribute("position") as THREE.BufferAttribute;
      const arr = a.array as Float32Array;
      for (let i = 0; i < N; i++) {
        arr[i*3+1] += dt * 1.4;
        if (arr[i*3+1] > 3) arr[i*3+1] = 0;
      }
      a.needsUpdate = true;
    },
  };
}

/* -------------------------------------------------------- arcade cabinet */

function arcade(color: number, label: string): Prop {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 3.4, 1.4),
    new THREE.MeshStandardMaterial({ color: 0x14141c, roughness: 0.5, metalness: 0.6 }),
  );
  body.position.y = 1.7;
  g.add(body);
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(1.2, 1.0),
    new THREE.MeshBasicMaterial({ color, toneMapped: false }),
  );
  screen.position.set(0, 2.5, 0.71);
  g.add(screen);
  const marquee = makeBillboard(label, "1 CR", color);
  marquee.scale.setScalar(0.09);
  marquee.position.set(0, 3.5, 0.72);
  g.add(marquee);
  return {
    group: g,
    tick: (_dt, t) => {
      const m = screen.material as THREE.MeshBasicMaterial;
      m.color.setHSL((t * 0.15 + label.length * 0.1) % 1, 0.8, 0.6);
    },
  };
}

/* ----------------------------------------------------------- dumpster fire */

function dumpsterFire(): Prop {
  const g = new THREE.Group();
  const bin = new THREE.Mesh(
    new THREE.CylinderGeometry(0.9, 0.7, 1.4, 8),
    new THREE.MeshStandardMaterial({ color: 0x2a2620, roughness: 0.9, metalness: 0.4 }),
  );
  bin.position.y = 0.7;
  g.add(bin);
  const light = new THREE.PointLight(0xff6a1f, 2.2, 22, 2);
  light.position.y = 2;
  g.add(light);
  const flameGeo = new THREE.BufferGeometry();
  const N = 30;
  const fp = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { fp[i*3] = (Math.random()-0.5)*1.1; fp[i*3+1] = Math.random()*1.8; fp[i*3+2] = (Math.random()-0.5)*1.1; }
  flameGeo.setAttribute("position", new THREE.BufferAttribute(fp, 3));
  const flame = new THREE.Points(flameGeo, new THREE.PointsMaterial({
    color: 0xff9a3c, size: 0.7, transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false,
    blending: THREE.AdditiveBlending,
  }));
  flame.position.y = 1.4;
  g.add(flame);
  return {
    group: g,
    tick: (dt, t) => {
      const a = flameGeo.getAttribute("position") as THREE.BufferAttribute;
      const arr = a.array as Float32Array;
      for (let i = 0; i < N; i++) {
        arr[i*3+1] += dt * (2 + (i % 3));
        if (arr[i*3+1] > 2.2) arr[i*3+1] = 0;
      }
      a.needsUpdate = true;
      light.intensity = 1.8 + Math.sin(t * 12 + 1) * 0.6;
    },
  };
}

/* --------------------------------------------------------- holo koi pond */

function holoKoi(): Prop {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(3, 0.2, 8, 32),
    new THREE.MeshBasicMaterial({ color: 0x2bd6ff, toneMapped: false, transparent: true, opacity: 0.5 }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.1;
  g.add(ring);
  const koi: THREE.Mesh[] = [];
  for (let i = 0; i < 5; i++) {
    const k = new THREE.Mesh(
      new THREE.ConeGeometry(0.3, 1.1, 5),
      new THREE.MeshBasicMaterial({ color: i % 2 ? 0xff5ea8 : 0xffc247, toneMapped: false, transparent: true, opacity: 0.7 }),
    );
    k.rotation.z = Math.PI / 2;
    g.add(k);
    koi.push(k);
  }
  return {
    group: g,
    tick: (_dt, t) => {
      koi.forEach((k, i) => {
        const a = t * (0.4 + i * 0.12) + i * 1.3;
        const r = 1.4 + (i % 2) * 0.8;
        k.position.set(Math.cos(a) * r, 0.5 + Math.sin(t * 2 + i) * 0.2, Math.sin(a) * r);
        k.rotation.y = -a;
      });
    },
  };
}

/* ------------------------------------------------------ interactable props */

function clawMachine(): Prop {
  const g = new THREE.Group();
  const cab = new THREE.Mesh(
    new THREE.BoxGeometry(2, 3.2, 2),
    new THREE.MeshStandardMaterial({ color: 0xff2d95, emissive: 0xff2d95, emissiveIntensity: 0.25, roughness: 0.4, transparent: true, opacity: 0.85 }),
  );
  cab.position.y = 1.6;
  g.add(cab);
  const prizes = new THREE.Group();
  for (let i = 0; i < 8; i++) {
    const p = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.28, 0),
      new THREE.MeshBasicMaterial({ color: [0x00e5ff, 0x39ff88, 0xffc247][i % 3], toneMapped: false }),
    );
    p.position.set((Math.random()-0.5)*1.4, 0.6 + Math.random()*0.3, (Math.random()-0.5)*1.4);
    prizes.add(p);
  }
  g.add(prizes);
  const sign = makeBillboard("LUCKY CLAW", "hold E", 0xff2d95);
  sign.scale.setScalar(0.11);
  sign.position.y = 4;
  g.add(sign);
  return {
    group: g,
    tick: (_dt, t) => { prizes.rotation.y = t * 0.3; },
    hot: { pos: new THREE.Vector3(), label: "LUCKY CLAW — try your luck", action: "claw" },
  };
}

function graffitiWall(): Prop {
  const g = new THREE.Group();
  const wall = new THREE.Mesh(
    new THREE.BoxGeometry(10, 6, 0.6),
    new THREE.MeshStandardMaterial({ color: 0x1b1b22, roughness: 0.95 }),
  );
  wall.position.y = 3;
  g.add(wall);
  const sign = makeBillboard("TAG WALL", "hold E to spray", 0x39ff88);
  sign.scale.setScalar(0.12);
  sign.position.set(0, 6.8, 0.4);
  g.add(sign);
  return {
    group: g,
    hot: { pos: new THREE.Vector3(), label: "TAG WALL — leave your mark", action: "graffiti" },
  };
}

function jukebox(): Prop {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.8, 2.6, 1),
    new THREE.MeshStandardMaterial({ color: 0x2a1840, emissive: 0xb46cff, emissiveIntensity: 0.3, roughness: 0.4, metalness: 0.5 }),
  );
  body.position.y = 1.3;
  g.add(body);
  const bars = new THREE.Group();
  const barMeshes: THREE.Mesh[] = [];
  for (let i = 0; i < 7; i++) {
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 1, 0.05),
      new THREE.MeshBasicMaterial({ color: 0xb46cff, toneMapped: false }),
    );
    bar.position.set((i - 3) * 0.22, 2, 0.52);
    bars.add(bar);
    barMeshes.push(bar);
  }
  g.add(bars);
  const sign = makeBillboard("SYNTH JUKE", "hold E", 0xb46cff);
  sign.scale.setScalar(0.1);
  sign.position.y = 3.2;
  g.add(sign);
  return {
    group: g,
    tick: (_dt, t) => {
      barMeshes.forEach((b, i) => { b.scale.y = 0.3 + Math.abs(Math.sin(t * 4 + i)) * 1.4; });
    },
    hot: { pos: new THREE.Vector3(), label: "SYNTH JUKE — drop a track", action: "juke" },
  };
}

/* --------------------------------------------------------------- assembly */

export interface StreetProp extends Prop {}

/** Scatter street furniture. Returns props (with any interactables tagged). */
export function makeStreet(placements: { kind: string; x: number; z: number; color?: number; label?: string }[]): {
  group: THREE.Group;
  props: Prop[];
} {
  const group = new THREE.Group();
  const props: Prop[] = [];
  for (const pl of placements) {
    let p: Prop;
    switch (pl.kind) {
      case "noodle": p = noodleStall(pl.color ?? 0xff2d95); break;
      case "arcade": p = arcade(pl.color ?? 0x00e5ff, pl.label ?? "NEON RUN"); break;
      case "fire": p = dumpsterFire(); break;
      case "koi": p = holoKoi(); break;
      case "claw": p = clawMachine(); break;
      case "graffiti": p = graffitiWall(); break;
      case "juke": p = jukebox(); break;
      default: continue;
    }
    p.group.position.set(pl.x, 0, pl.z);
    if (p.hot) p.hot.pos.set(pl.x, 0, pl.z);
    group.add(p.group);
    props.push(p);
  }
  return { group, props };
}
