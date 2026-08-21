/**
 * District interiors — the "other world" behind each gate.
 *
 * Clearing (or hacking) a district and stepping through its gate drops you into
 * a bespoke interior built for that district's tier. The legacy districts are
 * grittier venues — market stalls, braziers, a handful of wary regulars. The one
 * tidified district, the golden Vault Core, is the payoff the whole city dreams
 * about: a grand festival plaza with flying cars, fireworks, fountains, a
 * dancing crowd and the genesis-shard monument at its heart.
 *
 * Each interior is a self-contained bubble built at LOCAL origin. The engine
 * parks it far from the city (past the fog + far-clip) and translates the group,
 * colliders and interactables by an anchor, so the outside world never bleeds in.
 */
import * as THREE from "three";
import type { District } from "@/lib/districts";
import { makeBillboard } from "./city";

export interface InteriorCollider { x: number; z: number; hw: number; hd: number; }
export interface InteriorProp { kind: "exit" | "prop"; action: string; label: string; x: number; z: number; }

export interface Interior {
  group: THREE.Group;
  spawnX: number; spawnZ: number;
  colliders: InteriorCollider[];
  props: InteriorProp[];
  fog: number;
  fogDensity: number;
  animate: (t: number, dt: number) => void;
}

/** A cheap crowd figure — coat cylinder + head, in one small group. */
function person(coat: number, accent: number): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.7, 0.9, 3.4, 7),
    new THREE.MeshStandardMaterial({ color: coat, emissive: accent, emissiveIntensity: 0.25, roughness: 0.7 }),
  );
  body.position.y = 1.7;
  g.add(body);
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.6, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0x0c0e16, emissive: accent, emissiveIntensity: 0.5 }),
  );
  head.position.y = 3.9;
  g.add(head);
  return g;
}

function seeded(seed: number) {
  let h = seed >>> 0;
  return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 100000) / 100000; };
}

export function buildInterior(d: District): Interior {
  const group = new THREE.Group();
  const rand = seeded(d.id.length * 2654435761 + 7);
  const c0 = new THREE.Color(d.palette[0]);
  const c1 = new THREE.Color(d.palette[1] ?? d.palette[0]);
  const golden = !!d.grand;
  const tier: "golden" | "legacy" | "open" = golden ? "golden" : d.legacy ? "legacy" : "open";

  const R = golden ? 220 : tier === "legacy" ? 130 : 110;          // plaza radius
  const colliders: InteriorCollider[] = [];
  const props: InteriorProp[] = [];
  const tickers: ((t: number, dt: number) => void)[] = [];

  /* ---- floor: a glowing disc with concentric rings in the district palette */
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(R, 64),
    new THREE.MeshStandardMaterial({ color: 0x07070d, roughness: 0.5, metalness: 0.6, emissive: c0, emissiveIntensity: golden ? 0.1 : 0.05 }),
  );
  floor.rotation.x = -Math.PI / 2;
  group.add(floor);
  for (let i = 1; i <= (golden ? 6 : 4); i++) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(R * (i / (golden ? 6.5 : 4.5)) - 0.5, R * (i / (golden ? 6.5 : 4.5)), 80),
      new THREE.MeshBasicMaterial({ color: golden ? 0xffd23f : d.palette[0], transparent: true, opacity: golden ? 0.5 : 0.28, side: THREE.DoubleSide, toneMapped: false }),
    );
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05;
    group.add(ring);
  }

  /* ---- dome: the interior's own sky, so the city outside never shows */
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(R * 2.4, 40, 24),
    new THREE.MeshBasicMaterial({ color: golden ? 0x1a1330 : 0x0a0a16, side: THREE.BackSide, fog: false }),
  );
  dome.position.y = 10;
  group.add(dome);
  // a scatter of "stars"/lights on the dome
  {
    const N = golden ? 400 : 160, pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const a = rand() * Math.PI * 2, ph = Math.acos(2 * rand() - 1) * 0.5, rr = R * 2.2;
      pos[i * 3] = Math.cos(a) * Math.sin(ph) * rr;
      pos[i * 3 + 1] = Math.abs(Math.cos(ph)) * rr * 0.9 + 6;
      pos[i * 3 + 2] = Math.sin(a) * Math.sin(ph) * rr;
    }
    const sg = new THREE.BufferGeometry(); sg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    group.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: golden ? 0xfff3c0 : 0x8fb8ff, size: golden ? 1.6 : 1.1, transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false })));
  }

  /* ---- lighting */
  group.add(new THREE.AmbientLight(golden ? 0x4a3a1a : 0x14182a, golden ? 0.7 : 0.5));
  const key = new THREE.PointLight(golden ? 0xffd23f : d.palette[0], golden ? 3 : 1.8, R * 3, 2);
  key.position.set(0, golden ? 120 : 60, 0);
  group.add(key);
  const hemi = new THREE.HemisphereLight(golden ? 0xffe08a : d.palette[0], 0x05050a, golden ? 0.5 : 0.3);
  group.add(hemi);

  /* ---- perimeter: a ring of pillars that also fence the player in */
  const gapAngle = Math.PI;                 // leave a gap at the "south" for the exit
  const pillars = golden ? 28 : 18;
  for (let i = 0; i < pillars; i++) {
    const a = (i / pillars) * Math.PI * 2;
    if (Math.abs(((a - gapAngle + Math.PI) % (Math.PI * 2)) - Math.PI) < 0.32) continue; // exit gap
    const px = Math.cos(a) * R, pz = Math.sin(a) * R;
    const h = golden ? 60 + rand() * 40 : 22 + rand() * 14;
    const pil = new THREE.Mesh(
      new THREE.BoxGeometry(6, h, 6),
      new THREE.MeshStandardMaterial({ color: 0x0d0d16, emissive: golden ? c1 : c0, emissiveIntensity: golden ? 0.4 : 0.25, metalness: 0.8, roughness: 0.3 }),
    );
    pil.position.set(px, h / 2, pz);
    group.add(pil);
    colliders.push({ x: px, z: pz, hw: 3.4, hd: 3.4 });
    // crown light
    const cap = new THREE.Mesh(new THREE.SphereGeometry(golden ? 3 : 1.6, 10, 8), new THREE.MeshBasicMaterial({ color: golden ? 0xfff3c0 : d.palette[1], toneMapped: false }));
    cap.position.set(px, h + 1, pz); group.add(cap);
  }

  /* ---- EXIT portal at the south gap */
  {
    const ex = Math.cos(gapAngle) * (R - 6), ez = Math.sin(gapAngle) * (R - 6);
    const arch = new THREE.Mesh(
      new THREE.TorusGeometry(7, 0.7, 10, 40, Math.PI),
      new THREE.MeshBasicMaterial({ color: 0xff2d95, toneMapped: false }),
    );
    arch.position.set(ex, 0.2, ez); arch.rotation.x = -Math.PI / 2; arch.rotation.z = -gapAngle + Math.PI / 2;
    group.add(arch);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(13, 15), new THREE.MeshBasicMaterial({ color: 0xff2d95, transparent: true, opacity: 0.12, side: THREE.DoubleSide, toneMapped: false, depthWrite: false }));
    glow.position.set(ex, 8, ez); glow.lookAt(0, 8, 0); group.add(glow);
    const lbl = makeBillboard("EXIT", "back to the streets", 0xff2d95); lbl.scale.setScalar(0.3); lbl.position.set(ex, 15, ez); group.add(lbl);
    props.push({ kind: "exit", action: "exit", label: "LEAVE — back to the streets", x: ex, z: ez });
    tickers.push((t) => { (arch.material as THREE.MeshBasicMaterial).opacity = 0.7 + Math.sin(t * 3) * 0.3; });
  }

  /* ---- crowd: people who hang out here (dense + dancing in the Core) */
  const crowdN = golden ? 64 : tier === "legacy" ? 14 : 8;
  const crowd: { g: THREE.Group; bx: number; bz: number; ph: number; dance: boolean }[] = [];
  for (let i = 0; i < crowdN; i++) {
    const a = rand() * Math.PI * 2, rr = 12 + rand() * (R - 30);
    const coat = golden ? [0x2a2036, 0x35291a, 0x1a2436][Math.floor(rand() * 3)] : 0x161824;
    const accent = golden ? [0xffd23f, 0xff2d95, 0x6cf5ff, 0x39ff88][Math.floor(rand() * 4)] : d.palette[0];
    const g = person(coat, accent);
    const bx = Math.cos(a) * rr, bz = Math.sin(a) * rr;
    g.position.set(bx, 0, bz);
    group.add(g);
    crowd.push({ g, bx, bz, ph: rand() * Math.PI * 2, dance: golden ? rand() < 0.7 : rand() < 0.3 });
  }
  tickers.push((t) => {
    for (const p of crowd) {
      if (p.dance) {
        p.g.position.y = Math.abs(Math.sin(t * 3 + p.ph)) * 1.4;
        p.g.rotation.y = Math.sin(t * 1.5 + p.ph) * 0.6;
      } else {
        // gentle milling
        p.g.position.x = p.bx + Math.sin(t * 0.4 + p.ph) * 3;
        p.g.position.z = p.bz + Math.cos(t * 0.33 + p.ph) * 3;
        p.g.rotation.y = t * 0.2 + p.ph;
      }
    }
  });

  /* ================================================================ GOLDEN */
  if (golden) {
    // central grand stage
    const stage = new THREE.Mesh(
      new THREE.CylinderGeometry(34, 40, 6, 40),
      new THREE.MeshStandardMaterial({ color: 0x1a1206, emissive: 0xffd23f, emissiveIntensity: 0.25, metalness: 0.9, roughness: 0.25 }),
    );
    stage.position.y = 3; group.add(stage);
    colliders.push({ x: 0, z: 0, hw: 34, hd: 34 });

    // the genesis-shard monument: a big octahedron with 20 orbiting shards
    const core = new THREE.Mesh(
      new THREE.OctahedronGeometry(11, 0),
      new THREE.MeshBasicMaterial({ color: 0xfff3c0, toneMapped: false }),
    );
    core.position.y = 34; group.add(core);
    const halo = new THREE.PointLight(0xffd23f, 4, 260, 2); halo.position.y = 34; group.add(halo);
    const shardGrp = new THREE.Group(); shardGrp.position.y = 34; group.add(shardGrp);
    const shards: THREE.Mesh[] = [];
    for (let i = 0; i < 20; i++) {
      const s = new THREE.Mesh(new THREE.TetrahedronGeometry(2.2, 0), new THREE.MeshBasicMaterial({ color: 0xffd23f, toneMapped: false }));
      const a = (i / 20) * Math.PI * 2;
      s.position.set(Math.cos(a) * 22, Math.sin(a * 2) * 8, Math.sin(a) * 22);
      shardGrp.add(s); shards.push(s);
    }
    const banner = makeBillboard("VAULT CORE", "◈ twenty shards · threshold fourteen · no whole key", 0xffd23f);
    banner.scale.setScalar(0.62); banner.position.y = 62; group.add(banner);
    tickers.push((t, dt) => {
      core.rotation.y += dt * 0.5; core.rotation.x += dt * 0.2;
      core.position.y = 34 + Math.sin(t * 1.1) * 2;
      shardGrp.rotation.y -= dt * 0.35;
      for (let i = 0; i < shards.length; i++) shards[i].rotation.y += dt * 2;
      halo.intensity = 3.4 + Math.sin(t * 2) * 1.2;
    });

    // fountains around the stage
    const fountains: THREE.Points[] = [];
    for (let f = 0; f < 4; f++) {
      const fa = (f / 4) * Math.PI * 2 + Math.PI / 4;
      const fx = Math.cos(fa) * 80, fz = Math.sin(fa) * 80;
      const basin = new THREE.Mesh(new THREE.CylinderGeometry(10, 11, 2, 20), new THREE.MeshStandardMaterial({ color: 0x0e1420, emissive: 0x2a6cff, emissiveIntensity: 0.3, metalness: 0.7, roughness: 0.3 }));
      basin.position.set(fx, 1, fz); group.add(basin); colliders.push({ x: fx, z: fz, hw: 10, hd: 10 });
      const N = 90, pos = new Float32Array(N * 3), vel: number[] = [], life: number[] = [];
      for (let i = 0; i < N; i++) { pos[i*3]=fx; pos[i*3+1]=2; pos[i*3+2]=fz; vel.push((rand()-0.5)*4, 14 + rand()*10, (rand()-0.5)*4); life.push(rand()); }
      const pg = new THREE.BufferGeometry(); pg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      const pts = new THREE.Points(pg, new THREE.PointsMaterial({ color: 0x7fd0ff, size: 1.4, transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }));
      group.add(pts); fountains.push(pts);
      tickers.push((t, dt) => {
        const p = pg.getAttribute("position") as THREE.BufferAttribute;
        for (let i = 0; i < N; i++) {
          life[i] += dt * 0.6;
          if (life[i] > 1) { life[i] = 0; p.setXYZ(i, fx, 2, fz); vel[i*3]=(rand()-0.5)*4; vel[i*3+1]=14+rand()*10; vel[i*3+2]=(rand()-0.5)*4; continue; }
          p.setXYZ(i, p.getX(i)+vel[i*3]*dt, p.getY(i)+vel[i*3+1]*dt - 9*life[i]*dt*2, p.getZ(i)+vel[i*3+2]*dt);
        }
        p.needsUpdate = true;
      });
    }

    // flying cars circling the dome
    const cars: { m: THREE.Mesh; a: number; r: number; y: number; s: number }[] = [];
    for (let i = 0; i < 16; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(5, 1.3, 2.2), new THREE.MeshBasicMaterial({ color: [0xff2d95, 0x6cf5ff, 0xffd23f, 0x39ff88][i % 4], toneMapped: false }));
      cars.push({ m, a: rand() * Math.PI * 2, r: R * 0.7 + rand() * R * 0.5, y: 80 + rand() * 90, s: (rand() < 0.5 ? 1 : -1) * (0.15 + rand() * 0.2) });
      group.add(m);
    }
    tickers.push((t, dt) => {
      for (const c of cars) { c.a += c.s * dt; c.m.position.set(Math.cos(c.a) * c.r, c.y, Math.sin(c.a) * c.r); c.m.rotation.y = -c.a; }
    });

    // sweeping searchlights + laser fans
    const beams: THREE.Mesh[] = [];
    for (let i = 0; i < 8; i++) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 10, 300, 10, 1, true),
        new THREE.MeshBasicMaterial({ color: [0xffd23f, 0xff2d95, 0x6cf5ff][i % 3], transparent: true, opacity: 0.08, side: THREE.DoubleSide, toneMapped: false, depthWrite: false, blending: THREE.AdditiveBlending }));
      const a = (i / 8) * Math.PI * 2; b.position.set(Math.cos(a) * 60, 150, Math.sin(a) * 60); group.add(b); beams.push(b);
    }
    tickers.push((t) => { for (let i = 0; i < beams.length; i++) { beams[i].rotation.z = 0.5 + Math.sin(t * 0.8 + i) * 0.4; beams[i].rotation.y = t * 0.3 + i; } });

    // fireworks overhead, on a rolling timer
    const FN = 260, fpos = new Float32Array(FN * 3), fcol = new Float32Array(FN * 3), fvel = new Float32Array(FN * 3), flife = new Float32Array(FN).fill(0);
    const fg = new THREE.BufferGeometry(); fg.setAttribute("position", new THREE.BufferAttribute(fpos, 3)); fg.setAttribute("color", new THREE.BufferAttribute(fcol, 3));
    const fw = new THREE.Points(fg, new THREE.PointsMaterial({ size: 3, vertexColors: true, transparent: true, opacity: 1, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }));
    fw.frustumCulled = false; group.add(fw);
    let ftimer = 0, fcursor = 0;
    const palette = [[1,0.82,0.25],[1,0.18,0.58],[0.42,0.96,1],[0.22,1,0.53],[1,0.95,0.75]];
    const launch = () => {
      const cx = (rand() - 0.5) * R * 1.4, cy = 120 + rand() * 80, cz = (rand() - 0.5) * R * 1.4;
      const col = palette[Math.floor(rand() * palette.length)];
      for (let k = 0; k < 40; k++) {
        const i = fcursor % FN; fcursor++;
        const a = rand() * Math.PI * 2, ph = Math.acos(2 * rand() - 1), sp = 14 + rand() * 16;
        fpos[i*3]=cx; fpos[i*3+1]=cy; fpos[i*3+2]=cz;
        fvel[i*3]=Math.cos(a)*Math.sin(ph)*sp; fvel[i*3+1]=Math.cos(ph)*sp; fvel[i*3+2]=Math.sin(a)*Math.sin(ph)*sp;
        fcol[i*3]=col[0]; fcol[i*3+1]=col[1]; fcol[i*3+2]=col[2]; flife[i]=1;
      }
    };
    tickers.push((t, dt) => {
      ftimer -= dt; if (ftimer <= 0) { launch(); ftimer = 0.7 + rand() * 0.8; }
      const p = fg.getAttribute("position") as THREE.BufferAttribute, c = fg.getAttribute("color") as THREE.BufferAttribute;
      for (let i = 0; i < FN; i++) {
        if (flife[i] <= 0) { c.setXYZ(i, 0, 0, 0); continue; }
        flife[i] -= dt * 0.55;
        fpos[i*3]+=fvel[i*3]*dt; fpos[i*3+1]+=fvel[i*3+1]*dt - 9*dt; fpos[i*3+2]+=fvel[i*3+2]*dt;
        fvel[i*3]*=0.98; fvel[i*3+1]*=0.98; fvel[i*3+2]*=0.98;
        p.setXYZ(i, fpos[i*3], fpos[i*3+1], fpos[i*3+2]);
        const l = Math.max(0, flife[i]); c.setXYZ(i, fcol[i*3]*l, fcol[i*3+1]*l, fcol[i*3+2]*l);
      }
      p.needsUpdate = true; c.needsUpdate = true;
    });

    // a pulsing dance floor of coloured tiles just south of the stage
    const tiles: THREE.Mesh[] = [];
    const tileCols = [0xffd23f, 0xff2d95, 0x6cf5ff, 0x39ff88];
    for (let gx = -3; gx <= 3; gx++) for (let gz = 2; gz <= 8; gz++) {
      const tl = new THREE.Mesh(
        new THREE.PlaneGeometry(11, 11),
        new THREE.MeshBasicMaterial({ color: tileCols[(gx + gz + 40) % 4], transparent: true, opacity: 0.5, toneMapped: false, side: THREE.DoubleSide }),
      );
      tl.rotation.x = -Math.PI / 2; tl.position.set(gx * 12, 0.12, gz * 12); group.add(tl); tiles.push(tl);
    }
    tickers.push((t) => { for (let i = 0; i < tiles.length; i++) (tiles[i].material as THREE.MeshBasicMaterial).opacity = 0.25 + Math.abs(Math.sin(t * 3 + i * 0.7)) * 0.5; });

    // confetti raining forever over the plaza
    const CN = 260, cpos = new Float32Array(CN * 3), ccol = new Float32Array(CN * 3), cspin: number[] = [];
    for (let i = 0; i < CN; i++) {
      cpos[i*3] = (rand() - 0.5) * R * 1.6; cpos[i*3+1] = rand() * 180; cpos[i*3+2] = (rand() - 0.5) * R * 1.6;
      const col = [[1,0.82,0.25],[1,0.18,0.58],[0.42,0.96,1],[0.22,1,0.53]][Math.floor(rand()*4)];
      ccol[i*3]=col[0]; ccol[i*3+1]=col[1]; ccol[i*3+2]=col[2]; cspin.push(6 + rand() * 10);
    }
    const cg = new THREE.BufferGeometry(); cg.setAttribute("position", new THREE.BufferAttribute(cpos, 3)); cg.setAttribute("color", new THREE.BufferAttribute(ccol, 3));
    const confetti = new THREE.Points(cg, new THREE.PointsMaterial({ size: 2.2, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false }));
    confetti.frustumCulled = false; group.add(confetti);
    tickers.push((t, dt) => {
      const p = cg.getAttribute("position") as THREE.BufferAttribute;
      for (let i = 0; i < CN; i++) {
        let y = p.getY(i) - cspin[i] * dt;
        if (y < 0) y = 160 + rand() * 40;
        p.setX(i, p.getX(i) + Math.sin(t * 2 + i) * 0.1);
        p.setY(i, y);
      }
      p.needsUpdate = true;
    });

    // balloons bobbing on strings
    const balloons: { m: THREE.Group; ph: number; bx: number; bz: number }[] = [];
    for (let i = 0; i < 14; i++) {
      const bg = new THREE.Group();
      const col = [0xffd23f, 0xff2d95, 0x6cf5ff, 0x39ff88, 0xffffff][Math.floor(rand() * 5)];
      const balloon = new THREE.Mesh(new THREE.SphereGeometry(2.4, 12, 10), new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.4, roughness: 0.4 }));
      balloon.scale.y = 1.25; bg.add(balloon);
      const string = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 12, 4), new THREE.MeshBasicMaterial({ color: 0x556 }));
      string.position.y = -7; bg.add(string);
      const a = rand() * Math.PI * 2, rr = 40 + rand() * (R - 60);
      const bx = Math.cos(a) * rr, bz = Math.sin(a) * rr;
      bg.position.set(bx, 26 + rand() * 20, bz); group.add(bg);
      balloons.push({ m: bg, ph: rand() * Math.PI * 2, bx, bz });
    }
    tickers.push((t) => { for (const b of balloons) { b.m.position.x = b.bx + Math.sin(t * 0.5 + b.ph) * 4; b.m.position.z = b.bz + Math.cos(t * 0.4 + b.ph) * 4; b.m.rotation.z = Math.sin(t + b.ph) * 0.15; } });

    // interactive props — several of them make the city's legends literally true
    props.push({ kind: "prop", action: "dance", label: "JOIN THE FESTIVAL — dance", x: 0, z: 60 });
    props.push({ kind: "prop", action: "toast", label: "DRINK FROM THE FOUNTAIN", x: 80, z: 0 });
    props.push({ kind: "prop", action: "genesis", label: "TOUCH THE GENESIS SHARD", x: 0, z: 40 });
    props.push({ kind: "prop", action: "bag", label: "SET DOWN YOUR LOOT — and walk away", x: -80, z: 0 });
    props.push({ kind: "prop", action: "face", label: "THE MIRROR — try to wear another face", x: 0, z: -80 });
    props.push({ kind: "prop", action: "fireworks", label: "LAUNCH THE FIREWORKS", x: 80, z: 80 });

    // a little mirror monolith for the "no one steals your face" legend
    const mirror = new THREE.Mesh(new THREE.BoxGeometry(10, 20, 1), new THREE.MeshStandardMaterial({ color: 0x0a0e18, emissive: 0x6cf5ff, emissiveIntensity: 0.3, metalness: 1, roughness: 0.05 }));
    mirror.position.set(0, 10, -80); group.add(mirror); colliders.push({ x: 0, z: -80, hw: 5, hd: 1 });

    // a little wishing shrine — a floating ring of candles
    const shrine = new THREE.Group();
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; const c = new THREE.Mesh(new THREE.SphereGeometry(0.7, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd23f, toneMapped: false })); c.position.set(Math.cos(a) * 5, 3 + Math.sin(a * 2), Math.sin(a) * 5); shrine.add(c); }
    shrine.position.set(-80, 0, 80); group.add(shrine); colliders.push({ x: -80, z: 80, hw: 6, hd: 6 });
    tickers.push((t, dt) => { shrine.rotation.y += dt * 0.5; });
    props.push({ kind: "prop", action: "wish", label: "MAKE A WISH at the shrine", x: -80, z: 80 });
    props.push({ kind: "prop", action: "ride", label: "HAIL A FLYING CAR — joyride", x: -60, z: -60 });

    // ---- more interactables, each a myth or legend of the golden city ----
    // The Oracle: a floating orb that speaks the city's legends.
    const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(3.4, 1), new THREE.MeshBasicMaterial({ color: 0x6cf5ff, wireframe: true, toneMapped: false }));
    const orbCore = new THREE.Mesh(new THREE.SphereGeometry(2.2, 16, 12), new THREE.MeshBasicMaterial({ color: 0xbff6ff, transparent: true, opacity: 0.5, toneMapped: false }));
    const orbG = new THREE.Group(); orbG.add(orb); orbG.add(orbCore); orbG.position.set(60, 12, 60); group.add(orbG); colliders.push({ x: 60, z: 60, hw: 4, hd: 4 });
    tickers.push((t, dt) => { orbG.rotation.y += dt * 0.8; orb.rotation.x += dt * 0.5; orbG.position.y = 12 + Math.sin(t * 1.3) * 2; });
    props.push({ kind: "prop", action: "oracle", label: "ASK THE ORACLE for a legend", x: 60, z: 60 });

    // The Architect's statue — she built the Fabric and left no throne.
    const statue = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(3, 4.5, 22, 10), new THREE.MeshStandardMaterial({ color: 0x1a1206, emissive: 0xffd23f, emissiveIntensity: 0.22, metalness: 0.95, roughness: 0.25 }));
    body.position.y = 11; statue.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(2.6, 14, 12), new THREE.MeshStandardMaterial({ color: 0x1a1206, emissive: 0xfff3c0, emissiveIntensity: 0.35, metalness: 0.9, roughness: 0.2 }));
    head.position.y = 25; statue.add(head);
    const plaque = makeBillboard("THE ARCHITECT", "she burned the key and walked away", 0xffd23f); plaque.scale.setScalar(0.24); plaque.position.set(0, 32, 0); statue.add(plaque);
    statue.position.set(-60, 0, 60); group.add(statue); colliders.push({ x: -60, z: 60, hw: 4.5, hd: 4.5 });
    props.push({ kind: "prop", action: "statue", label: "READ THE ARCHITECT'S PLAQUE", x: -60, z: 60 });

    // The Eternal Flame — a myth that it has never once gone out.
    const brazier2 = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 4.5, 5, 12), new THREE.MeshStandardMaterial({ color: 0x14100a, emissive: 0xffd23f, emissiveIntensity: 0.4, metalness: 0.8, roughness: 0.3 }));
    brazier2.position.set(60, 2.5, -40); group.add(brazier2); colliders.push({ x: 60, z: -40, hw: 4, hd: 4 });
    const FN2 = 70, fp2 = new Float32Array(FN2 * 3), fl2: number[] = [];
    for (let i = 0; i < FN2; i++) { fp2[i*3]=60+(rand()-0.5)*3; fp2[i*3+1]=6; fp2[i*3+2]=-40+(rand()-0.5)*3; fl2.push(rand()); }
    const fg2 = new THREE.BufferGeometry(); fg2.setAttribute("position", new THREE.BufferAttribute(fp2, 3));
    const flame2 = new THREE.Points(fg2, new THREE.PointsMaterial({ color: 0xffd23f, size: 2.4, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }));
    group.add(flame2);
    tickers.push((t, dt) => { const p = fg2.getAttribute("position") as THREE.BufferAttribute; for (let i = 0; i < FN2; i++) { fl2[i]+=dt*0.7; if (fl2[i]>1){fl2[i]=0;p.setXYZ(i,60+(rand()-0.5)*3,6,-40+(rand()-0.5)*3);continue;} p.setXYZ(i,p.getX(i)+(rand()-0.5)*0.3,p.getY(i)+9*dt,p.getZ(i)+(rand()-0.5)*0.3);} p.needsUpdate = true; });
    props.push({ kind: "prop", action: "flame", label: "THE ETERNAL FLAME — sit a while", x: 60, z: -40 });

    // The Genesis Record — an obelisk holding the city's founding.
    const obelisk = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 3, 34, 4), new THREE.MeshStandardMaterial({ color: 0x0d0f18, emissive: 0x6cf5ff, emissiveIntensity: 0.3, metalness: 0.9, roughness: 0.2 }));
    obelisk.position.set(-40, 17, 40); obelisk.rotation.y = Math.PI / 4; group.add(obelisk); colliders.push({ x: -40, z: 40, hw: 3, hd: 3 });
    props.push({ kind: "prop", action: "record", label: "READ THE GENESIS RECORD", x: -40, z: 40 });
  } else {
    /* ============================================================ NON-GOLD */
    // a brazier at the centre (particle fire)
    const brazier = new THREE.Mesh(new THREE.CylinderGeometry(4, 5, 4, 12), new THREE.MeshStandardMaterial({ color: 0x120e0a, emissive: 0xff6a1f, emissiveIntensity: 0.5, roughness: 0.7 }));
    brazier.position.y = 2; group.add(brazier); colliders.push({ x: 0, z: 0, hw: 4, hd: 4 });
    const FN = 60, fpos = new Float32Array(FN * 3), flife: number[] = [];
    for (let i = 0; i < FN; i++) { fpos[i*3]=(rand()-0.5)*3; fpos[i*3+1]=4; fpos[i*3+2]=(rand()-0.5)*3; flife.push(rand()); }
    const fg = new THREE.BufferGeometry(); fg.setAttribute("position", new THREE.BufferAttribute(fpos, 3));
    const fire = new THREE.Points(fg, new THREE.PointsMaterial({ color: 0xff8a2a, size: 2.2, transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }));
    group.add(fire);
    tickers.push((t, dt) => {
      const p = fg.getAttribute("position") as THREE.BufferAttribute;
      for (let i = 0; i < FN; i++) { flife[i]+=dt*0.8; if (flife[i]>1){flife[i]=0;p.setXYZ(i,(rand()-0.5)*3,4,(rand()-0.5)*3);continue;} p.setXYZ(i,p.getX(i)+(rand()-0.5)*0.3,p.getY(i)+7*dt,p.getZ(i)+(rand()-0.5)*0.3); }
      p.needsUpdate = true;
    });

    // market stalls around the ring (kiosks with signs)
    const stallNames = ["NOODLES", "CHROME", "AMMO", "DECKS", "SALVAGE", "SYNTH-TEA", "PARTS", "ICE"];
    const stalls = tier === "legacy" ? 8 : 5;
    for (let i = 0; i < stalls; i++) {
      const a = (i / stalls) * Math.PI * 2 + 0.3;
      const sx = Math.cos(a) * (R * 0.6), sz = Math.sin(a) * (R * 0.6);
      const kiosk = new THREE.Mesh(new THREE.BoxGeometry(10, 7, 8), new THREE.MeshStandardMaterial({ color: 0x10121c, emissive: c0, emissiveIntensity: 0.18, roughness: 0.6 }));
      kiosk.position.set(sx, 3.5, sz); kiosk.rotation.y = -a; group.add(kiosk); colliders.push({ x: sx, z: sz, hw: 5.5, hd: 4.5 });
      const sign = makeBillboard(stallNames[i % stallNames.length], "open all night", d.palette[1] ?? d.palette[0]);
      sign.scale.setScalar(0.2); sign.position.set(sx, 10, sz); group.add(sign);
      // awning light
      const gl = new THREE.PointLight(d.palette[0], 0.8, 40, 2); gl.position.set(sx, 8, sz); group.add(gl);
    }

    // a couple of neon signs that flicker
    const flick: THREE.Mesh[] = [];
    for (let i = 0; i < 3; i++) {
      const a = rand() * Math.PI * 2;
      const s = makeBillboard(["OLD TOWN", "NO FABRIC HERE", "WATCH YOUR JACK"][i], "legacy stack", d.palette[0]);
      s.scale.setScalar(0.26); s.position.set(Math.cos(a) * (R - 20), 16 + rand() * 10, Math.sin(a) * (R - 20)); group.add(s); flick.push(s);
    }
    tickers.push((t) => { for (let i = 0; i < flick.length; i++) { (flick[i].material as THREE.Material).opacity = Math.sin(t * 9 + i * 2) > -0.6 ? 1 : 0.2; (flick[i].material as any).transparent = true; } });

    // a busker figure by the brazier
    const busker = person(0x1a1420, d.palette[0]);
    busker.position.set(18, 0, 20); group.add(busker);
    tickers.push((t) => { busker.rotation.y = Math.sin(t * 2) * 0.3; busker.position.y = Math.abs(Math.sin(t * 3)) * 0.6; });

    props.push({ kind: "prop", action: "warm", label: "WARM UP at the brazier", x: 0, z: 14 });
    props.push({ kind: "prop", action: "haggle", label: "HAGGLE at the stall", x: Math.cos(0.3) * (R * 0.6) - 6, z: Math.sin(0.3) * (R * 0.6) });
    props.push({ kind: "prop", action: "busker", label: "TIP THE BUSKER", x: 18, z: 20 });
    props.push({ kind: "prop", action: "rumor", label: "BUY A RUMOUR about the golden city", x: -18, z: 20 });
  }

  const animate = (t: number, dt: number) => { for (const fn of tickers) fn(t, dt); };
  // spawn at the exit gap, facing in
  const sx = Math.cos(gapAngle) * (R - 18), sz = Math.sin(gapAngle) * (R - 18);
  return { group, spawnX: sx, spawnZ: sz, colliders, props, fog: golden ? 0x1a1330 : 0x0a0a14, fogDensity: golden ? 0.0016 : 0.0026, animate };
}
