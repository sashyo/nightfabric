/**
 * Procedural Sanctum-9.
 *
 * Everything here is decoration and it is important to be clear about that: the
 * barriers this file draws do not keep anyone out. They are a rendering of a
 * decision the server already made. See src/app/api/district/[id]/route.ts for
 * the part that actually enforces anything.
 */
import * as THREE from "three";
import { DISTRICTS, type District } from "@/lib/districts";
import { NPCS } from "@/lib/npcs";

/**
 * Places a building may not stand.
 *
 * Now that buildings are solid, a block spawning on top of a terminal or an NPC
 * does not just look wrong — it makes them unreachable, and the failure is
 * invisible until someone walks over and finds a wall. Reserving the ground is
 * more robust than nudging props out of the way afterwards.
 *
 * The exclusion is applied AFTER every rand() for that building has been
 * consumed, so the random stream — and therefore the rest of the city — is
 * identical with or without it.
 */
const RESERVED: { x: number; z: number; r: number }[] = [
  { x: 0, z: 120, r: 14 },    // spawn
  { x: 360, z: 0, r: 14 },    // crew vault terminal
  { x: 46, z: 62, r: 14 },    // council relay
  { x: -46, z: 62, r: 14 },   // corpo raid console
  { x: 0, z: 96, r: 16 },     // Blackwall detonator
  { x: -70, z: 40, r: 14 },   // breach terminal
  { x: 30, z: 70, r: 12 },    // datapad
  { x: 84, z: 96, r: 10 },     // ICE: spoof id
  { x: -112, z: -8, r: 10 },   // ICE: forge doken
  { x: 118, z: -66, r: 10 },   // ICE: replay token
  { x: -96, z: 116, r: 10 },   // ICE: enum stash
  { x: 100, z: 108, r: 10 },   // ICE: admin proxy
  { x: -132, z: 60, r: 10 },   // ICE: cors the idp
  { x: 140, z: 20, r: 10 },    // ICE: strip dpop
  { x: -70, z: -70, r: 10 },   // ICE: traverse
  { x: 130, z: -30, r: 10 },   // ICE: map grid
  // street furniture (fun props)
  { x: -40, z: 108, r: 9 },    // noodle
  { x: 300, z: -20, r: 9 },    // noodle
  { x: 70, z: 118, r: 16 },    // arcade row (3 cabinets)
  { x: -104, z: 96, r: 6 },    // dumpster fire
  { x: 128, z: 40, r: 6 },     // dumpster fire
  { x: -60, z: -90, r: 6 },    // dumpster fire
  { x: 0, z: 150, r: 8 },      // koi pond
  { x: -150, z: 0, r: 8 },     // koi pond
  { x: 40, z: 130, r: 8 },     // claw
  { x: -130, z: 20, r: 12 },   // tag wall
  { x: 24, z: 100, r: 8 },     // jukebox
  ...NPCS.map((n) => ({ x: n.pos[0], z: n.pos[1], r: 12 })),
  // Gate approaches: you must be able to walk up to a refusal.
  ...DISTRICTS.filter((d) => d.id !== "sprawl").map((d) => ({
    x: d.gate[0], z: d.gate[1], r: 26,
  })),
];

function reserved(x: number, z: number, hw: number, hd: number): boolean {
  for (const p of RESERVED) {
    // Circle vs AABB: clamp the centre to the box, then measure.
    const cx = Math.max(x - hw, Math.min(p.x, x + hw));
    const cz = Math.max(z - hd, Math.min(p.z, z + hd));
    if (Math.hypot(p.x - cx, p.z - cz) < p.r) return true;
  }
  return false;
}

const rng = (seed: string) => {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h ^= h << 13; h ^= h >>> 17; h ^= h << 5;
    return ((h >>> 0) % 100000) / 100000;
  };
};

/* ------------------------------------------------------------------ sky */

export function makeSky(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(2600, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(0x16183f) },
      mid: { value: new THREE.Color(0x3a2470) },
      low: { value: new THREE.Color(0x9a3a86) },
    },
    vertexShader: `
      varying float vH;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vH = normalize(wp.xyz).y;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `
      uniform vec3 top; uniform vec3 mid; uniform vec3 low;
      varying float vH;
      void main() {
        float h = clamp(vH * 0.5 + 0.5, 0.0, 1.0);
        vec3 c = h < 0.5 ? mix(low, mid, h * 2.0) : mix(mid, top, (h - 0.5) * 2.0);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = -1;
  return m;
}

/* --------------------------------------------------------------- ground */

export function makeGround(): THREE.Group {
  const g = new THREE.Group();

  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(4000, 4000),
    // Wet asphalt still reads as dark, but it has to CATCH light. At 0x07070d
    // the ground returned almost nothing and the city looked like floating neon
    // with a void underneath.
    new THREE.MeshStandardMaterial({
      color: 0x1e2434,
      roughness: 0.28,
      metalness: 0.78,
    }),
  );
  plane.rotation.x = -Math.PI / 2;
  plane.receiveShadow = false;
  g.add(plane);

  // Street grid, drawn as emissive lines so it reads as wet neon reflection
  // without the cost of an actual reflection pass.
  const pts: number[] = [];
  const STEP = 40;
  for (let i = -1200; i <= 1200; i += STEP) {
    pts.push(-1200, 0.05, i, 1200, 0.05, i);
    pts.push(i, 0.05, -1200, i, 0.05, 1200);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  const lines = new THREE.LineSegments(
    geo,
    new THREE.LineBasicMaterial({ color: 0x5ba8e0, transparent: true, opacity: 0.85 }),
  );
  g.add(lines);
  return g;
}

/* ------------------------------------------------------------ buildings */

/**
 * Facade shader: a procedural grid of lit windows.
 *
 * Doing this with real geometry would mean tens of thousands of extra quads.
 * Instead each building is still one box instance, and the fragment shader
 * derives a window grid from the face UV, sized by that instance's own scale so
 * a squat block and a tower get windows of the same real-world size rather than
 * the same *count*.
 *
 * Per-window state comes from a hash of (cell, instance seed): most are lit,
 * some are dark, a few flicker on their own phase. That is what stops a city
 * this size reading as a field of identical boxes.
 */
const FACADE_VERT = `
  attribute float aSeed;
  varying vec2 vUv;
  varying float vSeed;
  varying vec3 vScale;
  varying vec3 vNrm;
  varying vec3 vWorld;
  void main() {
    vUv = uv;
    vSeed = aSeed;
    // Recover the instance's world size from the matrix columns.
    vScale = vec3(
      length(instanceMatrix[0].xyz),
      length(instanceMatrix[1].xyz),
      length(instanceMatrix[2].xyz)
    );
    vNrm = normal;
    vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const FACADE_FRAG = `
  uniform float uTime;
  uniform vec3 uBase;
  uniform vec3 uWarm;
  uniform vec3 uCool;
  uniform float uLit;
  varying vec2 vUv;
  varying float vSeed;
  varying vec3 vScale;
  varying vec3 vNrm;
  varying vec3 vWorld;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  void main() {
    // Roofs and floors get no windows.
    if (abs(vNrm.y) > 0.5) {
      gl_FragColor = vec4(uBase * 0.8, 1.0);
      return;
    }

    // Face dimensions depend on which wall we are on.
    float faceW = abs(vNrm.x) > 0.5 ? vScale.z : vScale.x;
    float faceH = vScale.y;

    float cols = max(2.0, floor(faceW / 2.6));
    float rows = max(2.0, floor(faceH / 3.4));

    vec2 grid = vUv * vec2(cols, rows);
    vec2 cell = floor(grid);
    vec2 f = fract(grid);

    // Window pane inside its cell, leaving a mullion.
    float pane = step(0.16, f.x) * step(f.x, 0.84) * step(0.20, f.y) * step(f.y, 0.80);

    float h1 = hash(cell + vSeed * 37.0);
    float h2 = hash(cell.yx + vSeed * 11.0);

    float lit = step(1.0 - uLit, h1);
    // A minority flicker, each on its own phase and rate.
    float flick = 1.0;
    if (h2 > 0.88) {
      flick = 0.35 + 0.65 * step(0.5, fract(uTime * (0.6 + h1 * 2.4) + h2 * 10.0));
    } else if (h2 > 0.72) {
      flick = 0.7 + 0.3 * sin(uTime * (0.5 + h1) + h2 * 20.0);
    }

    vec3 tint = mix(uWarm, uCool, h2);
    vec3 col = uBase + tint * pane * lit * flick;

    gl_FragColor = vec4(col, 1.0);
  }
`;

/** Footprint of one building, for collision. Height is irrelevant — the player
 *  never leaves the ground, so a 2D box is the whole story. */
export interface Footprint {
  x: number;
  z: number;
  hw: number;
  hd: number;
}

export interface DistrictBlocks {
  group: THREE.Group;
  boxes: Footprint[];
  /** Shader materials needing a uTime tick. */
  animated: THREE.ShaderMaterial[];
}

export function makeDistrictBlocks(d: District): DistrictBlocks {
  const group = new THREE.Group();
  const boxes: Footprint[] = [];
  const animated: THREE.ShaderMaterial[] = [];
  const rand = rng(`blocks:${d.id}`);

  const bodies: THREE.Matrix4[] = [];
  const seeds: number[] = [];
  const neon: THREE.Matrix4[] = [];
  const neonColors: THREE.Color[] = [];
  const beacons: THREE.Matrix4[] = [];
  const c1 = new THREE.Color(d.palette[0]);
  const c2 = new THREE.Color(d.palette[1]);

  const STEP = 26;
  for (let x = -d.radius; x <= d.radius; x += STEP) {
    for (let z = -d.radius; z <= d.radius; z += STEP) {
      if (Math.hypot(x, z) > d.radius - 12) continue;
      if (rand() > d.density) continue;
      if (Math.hypot(x, z) < 26) continue;

      const px = d.center[0] + x + (rand() - 0.5) * 9;
      const pz = d.center[1] + z + (rand() - 0.5) * 9;
      const w = 9 + rand() * 11;
      const dp = 9 + rand() * 11;
      const h = 14 + Math.pow(rand(), 2.1) * d.maxHeight;

      const bandY = h * (0.35 + rand() * 0.5);
      const bandColor = rand() > 0.45 ? c1 : c2;
      const seed = rand();

      if (reserved(px, pz, w / 2, dp / 2)) continue;

      const m = new THREE.Matrix4();
      m.compose(
        new THREE.Vector3(px, h / 2, pz),
        new THREE.Quaternion(),
        new THREE.Vector3(w, h, dp),
      );
      bodies.push(m);
      seeds.push(seed);
      boxes.push({ x: px, z: pz, hw: w / 2, hd: dp / 2 });

      const nm = new THREE.Matrix4();
      nm.compose(
        new THREE.Vector3(px, bandY, pz),
        new THREE.Quaternion(),
        new THREE.Vector3(w + 0.4, 1.1, dp + 0.4),
      );
      neon.push(nm);
      neonColors.push(bandColor);

      // Anything tall enough to be an aviation hazard gets a strobe.
      if (h > d.maxHeight * 0.55) {
        const bm = new THREE.Matrix4();
        bm.compose(
          new THREE.Vector3(px, h + 1.4, pz),
          new THREE.Quaternion(),
          new THREE.Vector3(1, 1, 1),
        );
        beacons.push(bm);
      }
    }
  }

  if (bodies.length) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const facade = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uBase: { value: new THREE.Color(0x2b3145) },
        uWarm: { value: new THREE.Color(0xffd9a0) },
        uCool: { value: c1.clone().lerp(new THREE.Color(0xffffff), 0.35) },
        uLit: { value: 0.62 },
      },
      vertexShader: FACADE_VERT,
      fragmentShader: FACADE_FRAG,
    });
    animated.push(facade);

    const body = new THREE.InstancedMesh(geo, facade, bodies.length);
    bodies.forEach((m, i) => body.setMatrixAt(i, m));
    body.instanceMatrix.needsUpdate = true;
    geo.setAttribute(
      "aSeed",
      new THREE.InstancedBufferAttribute(new Float32Array(seeds), 1),
    );
    group.add(body);

    const bands = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ toneMapped: false }),
      neon.length,
    );
    neon.forEach((m, i) => {
      bands.setMatrixAt(i, m);
      bands.setColorAt(i, neonColors[i]);
    });
    bands.instanceMatrix.needsUpdate = true;
    if (bands.instanceColor) bands.instanceColor.needsUpdate = true;
    group.add(bands);

    if (beacons.length) {
      const beaconMat = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 } },
        transparent: true,
        depthWrite: false,
        vertexShader: `
          attribute float aPhase;
          varying float vPhase;
          void main() {
            vPhase = aPhase;
            vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * viewMatrix * wp;
          }`,
        fragmentShader: `
          uniform float uTime;
          varying float vPhase;
          void main() {
            float b = step(0.72, fract(uTime * 0.55 + vPhase));
            gl_FragColor = vec4(1.0, 0.18, 0.24, b * 0.95);
          }`,
      });
      animated.push(beaconMat);
      const bgeo = new THREE.SphereGeometry(1.05, 6, 5);
      const bm = new THREE.InstancedMesh(bgeo, beaconMat, beacons.length);
      beacons.forEach((m, i) => bm.setMatrixAt(i, m));
      bm.instanceMatrix.needsUpdate = true;
      bgeo.setAttribute(
        "aPhase",
        new THREE.InstancedBufferAttribute(
          new Float32Array(beacons.map((_, i) => (i * 0.37) % 1)),
          1,
        ),
      );
      group.add(bm);
    }
  }

  return { group, boxes, animated };
}

/* -------------------------------------------------------------- signage */

/** A lit sign. The copy is the point — this city advertises its own threat model. */
export function makeBillboard(text: string, sub: string, color: number): THREE.Mesh {
  const cv = document.createElement("canvas");
  cv.width = 1024;
  cv.height = 256;
  const ctx = cv.getContext("2d")!;
  ctx.fillStyle = "#05030c";
  ctx.fillRect(0, 0, 1024, 256);

  const hex = "#" + color.toString(16).padStart(6, "0");
  ctx.strokeStyle = hex;
  ctx.lineWidth = 6;
  ctx.strokeRect(12, 12, 1000, 232);

  ctx.fillStyle = hex;
  ctx.font = "bold 76px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.fillText(text, 512, 118);

  ctx.fillStyle = "#9fb6cc";
  ctx.font = "30px ui-monospace, monospace";
  ctx.fillText(sub, 512, 178);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(46, 11.5),
    new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, side: THREE.DoubleSide }),
  );
  return mesh;
}

/** A proper chat speech bubble — rounded, tailed, word-wrapped — that floats
 *  over a speaker's head. Sized to its text so short lines don't get a billboard. */
export function makeBubble(text: string, color: number): THREE.Mesh {
  const W = 512, H = 256;
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d")!;
  const hex = "#" + color.toString(16).padStart(6, "0");

  // word-wrap into up to 3 lines
  ctx.font = "bold 34px ui-monospace, monospace";
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? cur + " " + w : w;
    if (ctx.measureText(t).width > W - 80 && cur) { lines.push(cur); cur = w; }
    else cur = t;
    if (lines.length >= 3) break;
  }
  if (cur && lines.length < 3) lines.push(cur);
  const widest = Math.max(60, ...lines.map((l) => ctx.measureText(l).width));
  const bw = Math.min(W - 20, widest + 60), bh = 44 + lines.length * 42;
  const bx = (W - bw) / 2, by = (H - bh - 22) / 2;

  // rounded bubble
  const r = 22;
  ctx.beginPath();
  ctx.moveTo(bx + r, by);
  ctx.arcTo(bx + bw, by, bx + bw, by + bh, r);
  ctx.arcTo(bx + bw, by + bh, bx, by + bh, r);
  ctx.arcTo(bx, by + bh, bx, by, r);
  ctx.arcTo(bx, by, bx + bw, by, r);
  ctx.closePath();
  ctx.fillStyle = "rgba(6,8,15,0.92)";
  ctx.fill();
  ctx.lineWidth = 4; ctx.strokeStyle = hex; ctx.stroke();
  // tail
  ctx.beginPath();
  ctx.moveTo(W / 2 - 14, by + bh - 2);
  ctx.lineTo(W / 2, by + bh + 22);
  ctx.lineTo(W / 2 + 14, by + bh - 2);
  ctx.closePath();
  ctx.fillStyle = "rgba(6,8,15,0.92)"; ctx.fill();
  ctx.strokeStyle = hex; ctx.stroke();

  ctx.fillStyle = "#eaf2ff";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  lines.forEach((l, i) => ctx.fillText(l, W / 2, by + 34 + i * 42));

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(24, 12),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, side: THREE.DoubleSide, depthTest: false }),
  );
  mesh.renderOrder = 999;
  return mesh;
}

/* ---------------------------------------------------------------- gates */

export interface Gate {
  district: District;
  group: THREE.Group;
  panel: THREE.Mesh;
  frame: THREE.Mesh;
  label: THREE.Mesh;
  /** null = the server has not been asked yet. */
  granted: boolean | null;
}

export function makeGate(d: District): Gate {
  const group = new THREE.Group();
  group.position.set(d.gate[0], 0, d.gate[1]);
  group.rotation.y = d.gateAngle;

  const W = 26;
  const H = 22;

  const panel = new THREE.Mesh(
    new THREE.PlaneGeometry(W, H),
    new THREE.MeshBasicMaterial({
      color: 0x8899aa,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
      toneMapped: false,
      depthWrite: false,
    }),
  );
  panel.position.y = H / 2;
  group.add(panel);

  const frameGeo = new THREE.BoxGeometry(W + 2, 1.2, 1.2);
  const frameMat = new THREE.MeshBasicMaterial({ color: 0x8899aa, toneMapped: false });
  const top = new THREE.Mesh(frameGeo, frameMat);
  top.position.y = H;
  group.add(top);
  const postGeo = new THREE.BoxGeometry(1.2, H, 1.2);
  for (const s of [-1, 1]) {
    const p = new THREE.Mesh(postGeo, frameMat);
    p.position.set((s * (W + 2)) / 2, H / 2, 0);
    group.add(p);
  }

  // The gate's own subtitle tells you at a glance what protects it: the one
  // tidified district carries the Tide watermark; every other gate advertises
  // that it runs the old, forgeable stack.
  const sub = d.grand
    ? "◈ SECURED BY TIDE ◈"
    : d.legacy
      ? "LEGACY STACK · FORGEABLE · HACKABLE"
      : "OPEN";
  const label = makeBillboard(d.name.toUpperCase(), sub, d.palette[0]);
  label.scale.setScalar(0.62);
  label.position.set(0, H + 7, 0);
  group.add(label);

  return { district: d, group, panel, frame: top, label, granted: null };
}

/* ---------------------------------------------------------- ORK network */

export interface FabricNode {
  mesh: THREE.Mesh;
  core: THREE.Mesh;
  position: THREE.Vector3;
}

/**
 * The Fabric, drawn on the horizon. Five towers because the local TideCloak
 * dev image ships a 5-ORK test network at threshold 3; mainnet is 20 at 14.
 * The count is deployment-variable and the game reads it from config rather
 * than asserting it.
 */
export function makeFabric(count: number): { group: THREE.Group; nodes: FabricNode[] } {
  const group = new THREE.Group();
  const nodes: FabricNode[] = [];
  const R = 1050;

  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + Math.PI / 7;
    const x = Math.cos(a) * R;
    const z = Math.sin(a) * R;
    const h = 300 + (i % 3) * 60;

    const tower = new THREE.Mesh(
      new THREE.CylinderGeometry(9, 22, h, 6),
      new THREE.MeshStandardMaterial({
        color: 0x0a0f1c,
        emissive: 0x0b2740,
        emissiveIntensity: 0.6,
        roughness: 0.7,
      }),
    );
    tower.position.set(x, h / 2, z);
    group.add(tower);

    const core = new THREE.Mesh(
      new THREE.OctahedronGeometry(16, 0),
      new THREE.MeshBasicMaterial({ color: 0x2ad4ff, toneMapped: false, transparent: true, opacity: 0.55 }),
    );
    core.position.set(x, h + 18, z);
    group.add(core);

    nodes.push({ mesh: tower, core, position: new THREE.Vector3(x, h + 18, z) });
  }
  return { group, nodes };
}

/* --------------------------------------------------------------- shards */

export function makeShardMesh(color: number): THREE.Group {
  const g = new THREE.Group();
  const core = new THREE.Mesh(
    new THREE.OctahedronGeometry(1.15, 0),
    new THREE.MeshBasicMaterial({ color, toneMapped: false }),
  );
  g.add(core);
  const halo = new THREE.Mesh(
    new THREE.OctahedronGeometry(2.1, 0),
    new THREE.MeshBasicMaterial({
      color,
      toneMapped: false,
      transparent: true,
      opacity: 0.16,
      side: THREE.BackSide,
    }),
  );
  g.add(halo);
  g.position.y = 2.4;
  return g;
}

/* ----------------------------------------------------------------- rain */

export function makeRain(count = 7000): { points: THREE.Points; step: (dt: number) => void } {
  const pos = new Float32Array(count * 3);
  const vel = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 900;
    pos[i * 3 + 1] = Math.random() * 260;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 900;
    vel[i] = 90 + Math.random() * 110;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const points = new THREE.Points(
    geo,
    new THREE.PointsMaterial({
      color: 0x6fa8c8,
      size: 0.5,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    }),
  );
  points.frustumCulled = false;

  const step = (dt: number) => {
    const p = geo.getAttribute("position") as THREE.BufferAttribute;
    const arr = p.array as Float32Array;
    for (let i = 0; i < count; i++) {
      arr[i * 3 + 1] -= vel[i] * dt;
      if (arr[i * 3 + 1] < 0) arr[i * 3 + 1] = 240 + Math.random() * 40;
    }
    p.needsUpdate = true;
  };
  return { points, step };
}

export { DISTRICTS };

/* ------------------------------------------------------------- traffic */

/**
 * Air traffic. Lanes of lights sliding across the skyline at a few altitudes.
 *
 * Nothing here is interactive and nothing is collidable — it exists because a
 * static skyline reads as a diorama, and two hundred moving lights make the
 * same geometry read as a working city.
 */
export function makeTraffic(count = 140): {
  points: THREE.Points;
  step: (dt: number) => void;
} {
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const vel = new Float32Array(count);
  const axis = new Uint8Array(count);

  const WARM = new THREE.Color(0xffb066);
  const COOL = new THREE.Color(0x66e0ff);

  for (let i = 0; i < count; i++) {
    const alt = 55 + Math.random() * 190;
    const along = (Math.random() - 0.5) * 2200;
    const lane = Math.round((Math.random() - 0.5) * 8) * 130;
    const horiz = Math.random() < 0.5;
    axis[i] = horiz ? 1 : 0;

    pos[i * 3] = horiz ? along : lane;
    pos[i * 3 + 1] = alt;
    pos[i * 3 + 2] = horiz ? lane : along;

    vel[i] = (Math.random() < 0.5 ? -1 : 1) * (26 + Math.random() * 46);

    const c = Math.random() < 0.5 ? WARM : COOL;
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));

  const points = new THREE.Points(
    geo,
    new THREE.PointsMaterial({
      size: 2.6,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      toneMapped: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  points.frustumCulled = false;

  const step = (dt: number) => {
    const p = geo.getAttribute("position") as THREE.BufferAttribute;
    const arr = p.array as Float32Array;
    for (let i = 0; i < count; i++) {
      const idx = axis[i] === 1 ? i * 3 : i * 3 + 2;
      arr[idx] += vel[i] * dt;
      if (arr[idx] > 1200) arr[idx] = -1200;
      else if (arr[idx] < -1200) arr[idx] = 1200;
    }
    p.needsUpdate = true;
  };

  return { points, step };
}
