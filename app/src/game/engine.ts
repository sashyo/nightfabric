/**
 * NIGHTFABRIC renderer + player controller.
 *
 * The engine knows nothing about authorization. It is told what is permitted
 * (`setClearance`) and what exists (`setShards`) by the React layer, which
 * learns both from the server. If you patch this file to open every gate, you
 * will walk into five empty districts — the contents were never in the bundle.
 */
import * as THREE from "three";
import { DISTRICTS, DISTRICT_BY_ID, districtAt, type DistrictId } from "@/lib/districts";
import {
  makeSky, makeGround, makeDistrictBlocks, makeBillboard,
  makeGate, makeFabric, makeShardMesh, makeRain, makeTraffic,
  type Gate, type FabricNode, type Footprint,
} from "./city";
import { makeNpcs, makeCrowd, type NpcObj } from "./npc";
import { Players, type RemoteState } from "./players";
import { makeStreet, type Prop } from "./street";
import { Sfx } from "./audio";
import { buildInterior, type Interior, type InteriorProp } from "./interior";

export type Focus =
  | { kind: "shard"; id: string; label: string }
  | { kind: "npc"; id: string; label: string }
  | { kind: "vault"; label: string }
  | { kind: "council"; label: string }
  | { kind: "raid"; label: string }
  | { kind: "nuke"; label: string }
  | { kind: "breach"; label: string }
  | { kind: "fabric"; label: string }
  | { kind: "codex"; label: string }
  | { kind: "ice"; attack: string; label: string }
  | { kind: "fun"; action: string; label: string }
  | { kind: "device"; device: string; dtype: string; label: string }
  | { kind: "gate"; district: DistrictId; label: string }
  | { kind: "exit"; label: string }
  | { kind: "prop"; action: string; label: string };

export type GameEvent =
  | { type: "focus"; focus: Focus | null }
  | { type: "gateApproach"; district: DistrictId }
  | { type: "enterDistrict"; district: DistrictId }
  | { type: "interior"; district: DistrictId | null }
  | { type: "tick"; x: number; z: number; district: DistrictId | null; fps: number };

const KEY = { w: false, a: false, s: false, d: false, shift: false };
const EYE = 5.2;
const WALK = 46;
const SPRINT = 96;

interface ShardObj {
  id: string;
  group: THREE.Group;
  district: DistrictId;
}

export class Nightfabric {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private clock = new THREE.Clock();
  private raf = 0;
  private disposed = false;

  private yaw = Math.PI; // face the golden Vault Core at spawn — the prize is the first thing you see
  private pitch = 0;
  private pos = new THREE.Vector3(0, EYE, 120);

  private gates: Gate[] = [];
  private fabricNodes: FabricNode[] = [];
  private shards = new Map<string, ShardObj>();
  private shardLayer = new THREE.Group();
  private beams: { line: THREE.Line; born: number; life: number }[] = [];
  private beamLayer = new THREE.Group();
  private rain!: { points: THREE.Points; step: (dt: number) => void };

  private terminals: { kind: "vault" | "council" | "raid" | "nuke" | "breach" | "fabric" | "codex"; pos: THREE.Vector3; mesh: THREE.Group }[] = [];
  private npcs: NpcObj[] = [];
  private crowd!: { group: THREE.Group; step: (dt: number) => void };
  private players = new Players();

  /* --- Blackwall Protocol --------------------------------------------- */
  private neon: THREE.MeshBasicMaterial[] = [];
  private ambient!: THREE.AmbientLight;
  private keyLight!: THREE.DirectionalLight;
  private rimLight!: THREE.DirectionalLight;
  private shock: THREE.Mesh | null = null;
  /** Seconds since detonation; null when the city is intact. */
  private blastT: number | null = null;
  private blastFx: any = null;
  private shakeSeed = 0;
  private darkened = false;
  private lastNow = 0;
  private inputEnabled = true;
  private hemi!: THREE.HemisphereLight;
  private lamp!: THREE.SpotLight;
  private lampOn = false;

  /* --- collision ------------------------------------------------------ */
  /** Building footprints, bucketed into a coarse grid so a step only tests the
   *  handful of boxes near the player instead of all ~900 in the city. */
  private buildings: Footprint[] = [];
  private grid = new Map<string, number[]>();
  /** Shader materials that need a uTime tick each frame. */
  private animated: THREE.ShaderMaterial[] = [];
  private traffic!: { points: THREE.Points; step: (dt: number) => void };
  private streetProps: Prop[] = [];
  readonly sfx = new Sfx();
  private iceNodes: { attack: string; label: string; pos: THREE.Vector3; mesh: THREE.Group; cracked: boolean }[] = [];
  private devices: { device: string; dtype: string; label: string; pos: THREE.Vector3; mesh: THREE.Group }[] = [];
  /** District building groups + their holo preview, keyed by id. Locked
   *  districts stay hidden; only the hologram at the gate shows until unlocked. */
  private districtView = new Map<string, { group: THREE.Group; holo: THREE.Group | null; shield: THREE.Group | null }>();
  private shields: THREE.Group[] = [];
  /** District interiors — built lazily, parked far from the city, one per id. */
  private interiors = new Map<string, { interior: Interior; anchor: { x: number; z: number } }>();
  private inside: {
    id: DistrictId; interior: Interior; anchor: { x: number; z: number };
    props: (InteriorProp & { wx: number; wz: number })[];
    returnX: number; returnZ: number; returnYaw: number;
  } | null = null;
  private t = 0;
  private monuments: { rings: THREE.Mesh[]; prize: THREE.Mesh; group: THREE.Group }[] = [];
  /** Animated bits of the grand Vault Core — spire, festival, cars, fireworks. */
  private grand: any = null;

  private clearance = new Map<DistrictId, boolean | null>();
  private lastFocus: string | null = null;
  private lastDistrict: DistrictId | null = null;
  private gateAsked = new Set<DistrictId>();
  private frames = 0;
  private fpsAcc = 0;
  private fps = 60;

  constructor(
    private canvas: HTMLCanvasElement,
    private emit: (e: GameEvent) => void,
    private orkCount = 5,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.85;

    this.camera = new THREE.PerspectiveCamera(72, 1, 0.5, 4000);
    this.scene.fog = new THREE.FogExp2(0x241a48, 0.00105);

    this.build();
    this.bind();
    this.resize();
  }

  /* --------------------------------------------------------------- build */

  private build() {
    this.scene.add(makeSky());
    this.scene.add(makeGround());

    this.ambient = new THREE.AmbientLight(0x7f9ad0, 2.4);
    this.scene.add(this.ambient);
    // Sky/ground bounce. Cheap, and it is what stops vertical faces reading as
    // flat black between the neon bands.
    this.hemi = new THREE.HemisphereLight(0x6f97d8, 0x4a3168, 1.5);
    this.scene.add(this.hemi);
    this.keyLight = new THREE.DirectionalLight(0xb9d2ff, 1.05);
    this.keyLight.position.set(120, 300, -180);
    this.scene.add(this.keyLight);
    this.rimLight = new THREE.DirectionalLight(0xff74b0, 0.8);
    this.rimLight.position.set(-200, 90, 220);
    this.scene.add(this.rimLight);

    // Headlamp. Off by default so the city keeps its look, on with F when you
    // are trying to find a shard in an alley.
    this.lamp = new THREE.SpotLight(0xdCeaff, 0, 190, Math.PI / 5.5, 0.45, 1.1);
    this.lamp.position.set(0, 0, 0);
    this.scene.add(this.lamp);
    this.scene.add(this.lamp.target);

    for (const d of DISTRICTS) {
      const { group: g, boxes, animated } = makeDistrictBlocks(d);
      for (const b of boxes) this.addBuilding(b);
      this.animated.push(...animated);
      // Keep hold of every emissive surface so the Blackwall Protocol has
      // something to switch off.
      g.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | undefined;
        if (m instanceof THREE.MeshBasicMaterial) this.neon.push(m);
      });
      this.scene.add(g);
    }

    for (const d of DISTRICTS) {
      if (d.id === "sprawl") continue;
      const g = makeGate(d);
      this.gates.push(g);
      this.scene.add(g.group);
      this.clearance.set(d.id, null);
    }
    this.clearance.set("sprawl", true);

    // Every district gets a BEACON that towers over the skyline — taller and
    // brighter the more it is worth, so the city reads its own value from afar.
    // The golden Vault Core gets the full festival: spire, fireworks, flying cars,
    // searchlights, party lights. While a district is locked it also wears a
    // containment shield. The beacon is ALWAYS visible — it is the thing that
    // makes you want to get in.
    for (const d of DISTRICTS) {
      if (d.id === "sprawl") continue;
      let beacon: THREE.Group;
      if (d.grand) {
        beacon = this.makeGrandCore(d);
      } else {
        const scale = d.clearance === "ghost" ? 1.15 : (d as any).legacy ? 0.72 : 0.95;
        const m = this.makeMonument(d, scale);
        this.monuments.push(m);
        beacon = m.group;
      }
      beacon.position.set(d.center[0], 0, d.center[1]);
      this.scene.add(beacon);

      const shield = this.makeShield(d);      // positions itself at the district center
      this.scene.add(shield);

      this.districtView.set(d.id, { group: beacon, holo: null, shield });
    }

    const fab = makeFabric(this.orkCount);
    this.fabricNodes = fab.nodes;
    this.scene.add(fab.group);

    // The city's own advertising. Every line is literally true of this build.
    const signs: [string, string, number, THREE.Vector3, number][] = [
      ["OWNERSHIP", "your account belongs to you — and to no one else, not even the admins", 0x00e5ff, new THREE.Vector3(-96, 46, -60), 0.5],
      ["SECURITY", "nothing to steal here: no password, no key, no plaintext, ever assembled", 0xff2d95, new THREE.Vector3(104, 40, -30), -0.8],
      ["PRIVACY", "the operator holds your data and cannot read it", 0x39ff88, new THREE.Vector3(20, 52, -140), 3.0],
      ["GOVERNANCE", "no single admin. no single machine. quorum or nothing.", 0xb46cff, new THREE.Vector3(-120, 44, 90), 1.1],
      ["SOVEREIGNTY", "this realm can leave Tide and keep running. no lock-in.", 0xffc247, new THREE.Vector3(150, 44, 120), -1.6],
      ["AUTHORITY: REMOVED", "when no one holds the keys, ownership is guaranteed — not promised", 0x6cf5ff, new THREE.Vector3(-150, 50, -110), 0.7],
      ["STOP CHASING THREATS", "there is no monopoly to seize, so there is no breach to fear", 0xff2d95, new THREE.Vector3(0, 56, 160), Math.PI],
    ];
    for (const [t, s, c, p, ry] of signs) {
      const b = makeBillboard(t, s, c);
      b.position.copy(p);
      b.rotation.y = ry;
      this.scene.add(b);
    }

    this.scene.add(this.shardLayer);
    this.scene.add(this.beamLayer);

    this.rain = makeRain();
    this.scene.add(this.rain.points);

    this.traffic = makeTraffic();
    this.scene.add(this.traffic.points);

    // Street life. Positions hand-placed to sit in the open, near the action.
    const street = makeStreet([
      { kind: "noodle", x: -40, z: 108, color: 0xff2d95 },
      { kind: "noodle", x: 300, z: -20, color: 0xffc247 },
      { kind: "arcade", x: 58, z: 118, color: 0x00e5ff, label: "NEON RUN" },
      { kind: "arcade", x: 70, z: 118, color: 0x39ff88, label: "ICE DIVER" },
      { kind: "arcade", x: 82, z: 118, color: 0xff2d95, label: "VVK BLITZ" },
      { kind: "fire", x: -104, z: 96 },
      { kind: "fire", x: 128, z: 40 },
      { kind: "fire", x: -60, z: -90 },
      { kind: "koi", x: 0, z: 150 },
      { kind: "koi", x: -150, z: 0 },
      { kind: "claw", x: 40, z: 130 },
      { kind: "graffiti", x: -130, z: 20 },
      { kind: "juke", x: 24, z: 100 },
    ]);
    this.streetProps = street.props;
    this.scene.add(street.group);

    const people = makeNpcs();
    this.npcs = people.objs;
    this.scene.add(people.group);

    this.crowd = makeCrowd();
    this.scene.add(this.crowd.group);

    this.scene.add(this.players.group);

    this.addTerminal("vault", new THREE.Vector3(360, 0, 0), 0xffc247, "CREW VAULT");
    this.addTerminal("council", new THREE.Vector3(46, 0, 62), 0xb46cff, "COUNCIL RELAY");
    this.addTerminal("raid", new THREE.Vector3(-46, 0, 62), 0xff3355, "CORPO RAID CONSOLE");
    // Deliberately out in the open, in the district everyone can reach. It is
    // safe to leave lying around precisely because pressing it does nothing.
    this.addTerminal("nuke", new THREE.Vector3(0, 0, 96), 0xff2b46, "BLACKWALL PROTOCOL");
    this.addTerminal("breach", new THREE.Vector3(-70, 0, 40), 0xffc247, "BREACH TERMINAL");
    this.addTerminal("fabric", new THREE.Vector3(-40, 0, 40), 0x00e5ff, "FABRIC TERMINAL");
    this.addTerminal("codex", new THREE.Vector3(30, 0, 70), 0x6cf5ff, "DATAPAD — LORE + CLEARANCE");

    // ICE panels — physical hack points, each running one real attack against
    // the live API from your session. Scattered so the whole Sprawl is a range.
    const ice: [string, string, number, number][] = [
      ["forge-identity",   "SPOOF ID",       84, 96],
      ["tamper-jwt",       "FORGE DOKEN",    -112, -8],
      ["replay-token",     "REPLAY TOKEN",   118, -66],
      ["idor-stash",       "ENUM STASH",     -96, 116],
      ["admin-proxy",      "ADMIN PROXY",     100, 108],
      ["cors-admin",       "CORS THE IDP",   -132, 60],
      ["strip-dpop",       "STRIP DPoP",      140, 20],
      ["path-traversal",   "TRAVERSE",       -70, -70],
      ["map-grid",         "MAP THE GRID",   130, -30],
    ];
    for (const [attack, label, x, z] of ice) this.addIceNode(attack, label, x, z);

    // Hackable street devices — each a different classic flaw.
    const devs: [string, string, string, number, number, number][] = [
      ["vend-01", "vending", "VENDING MACHINE", -18, 130, 0xff2d95],
      ["cam-01", "cctv", "CCTV CAMERA", 110, 78, 0x39ff88],
      ["door-01", "keypad", "SERVICE DOOR", -120, 108, 0xffc247],
      ["ad-01", "billboard", "AD BILLBOARD", 60, -50, 0x00e5ff],
    ];
    for (const [device, dtype, label, x, z, color] of devs) this.addDevice(device, dtype, label, x, z, color);
  }

  /* ------------------------------------------------------------ collision */

  private static readonly CELL = 48;
  /** Player capsule radius. Generous — clipping a corner feels worse than a
   *  slightly wide body. */
  private static readonly RADIUS = 1.6;

  private cellKey(x: number, z: number) {
    return `${Math.floor(x / Nightfabric.CELL)},${Math.floor(z / Nightfabric.CELL)}`;
  }

  private addBuilding(b: Footprint) {
    const i = this.buildings.push(b) - 1;
    // A building can straddle cells, so register it in every cell it touches.
    const x0 = Math.floor((b.x - b.hw) / Nightfabric.CELL);
    const x1 = Math.floor((b.x + b.hw) / Nightfabric.CELL);
    const z0 = Math.floor((b.z - b.hd) / Nightfabric.CELL);
    const z1 = Math.floor((b.z + b.hd) / Nightfabric.CELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const k = `${cx},${cz}`;
        const list = this.grid.get(k);
        if (list) list.push(i);
        else this.grid.set(k, [i]);
      }
    }
  }

  /** Is a player-sized circle at (x, z) inside any building? */
  private blocked(x: number, z: number): boolean {
    const R = Nightfabric.RADIUS;
    // Check the player's cell and its neighbours — a box can overlap us from
    // the next cell over.
    const cx = Math.floor(x / Nightfabric.CELL);
    const cz = Math.floor(z / Nightfabric.CELL);
    for (let ix = cx - 1; ix <= cx + 1; ix++) {
      for (let iz = cz - 1; iz <= cz + 1; iz++) {
        const list = this.grid.get(`${ix},${iz}`);
        if (!list) continue;
        for (const i of list) {
          const b = this.buildings[i];
          if (Math.abs(x - b.x) < b.hw + R && Math.abs(z - b.z) < b.hd + R) return true;
        }
      }
    }
    return false;
  }

  private addTerminal(kind: "vault" | "council" | "raid" | "nuke" | "breach" | "fabric" | "codex", p: THREE.Vector3, color: number, label: string) {
    const g = new THREE.Group();
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(3.2, 4.2, 1.2, 8),
      new THREE.MeshStandardMaterial({ color: 0x11141f, roughness: 0.6, metalness: 0.7 }),
    );
    base.position.y = 0.6;
    g.add(base);
    const stalk = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, 6.5, 1.4),
      new THREE.MeshStandardMaterial({ color: 0x0d1018, roughness: 0.5, metalness: 0.8 }),
    );
    stalk.position.y = 4.2;
    g.add(stalk);
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(3.4, 2.4),
      new THREE.MeshBasicMaterial({ color, toneMapped: false, transparent: true, opacity: 0.85 }),
    );
    screen.position.set(0, 5.6, 0.76);
    g.add(screen);
    const sign = makeBillboard(label, "hold E", color);
    sign.scale.setScalar(0.24);
    sign.position.y = 11;
    g.add(sign);
    g.position.copy(p);
    this.scene.add(g);
    this.terminals.push({ kind, pos: p.clone(), mesh: g });
  }

  /* --------------------------------------------------------------- input */

  /** Is the typed character going somewhere that wants text? */
  private static typingInto(t: EventTarget | null): boolean {
    const el = t as HTMLElement | null;
    if (!el || !el.tagName) return false;
    const tag = el.tagName.toLowerCase();
    return tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable;
  }

  /** A holographic mini-skyline projected at a locked district's gate. */
  /** The Vault Core showpiece: a golden spire, orbiting rings, a light column,
   *  a floating prize, and sparkle. Built to make a player WANT to get in. */
  private makeGrandCore(d: (typeof DISTRICTS)[number]): THREE.Group {
    const g = new THREE.Group();
    const gold = new THREE.Color(0xffd23f);
    // central spire
    const spire = new THREE.Mesh(
      new THREE.CylinderGeometry(3, 26, 460, 8),
      new THREE.MeshStandardMaterial({ color: 0x1c1608, emissive: gold, emissiveIntensity: 0.6, metalness: 0.95, roughness: 0.2 }),
    );
    spire.position.y = 230;
    g.add(spire);
    // a crown of vertical blades near the summit
    const crown = new THREE.Group();
    for (let i = 0; i < 12; i++) {
      const blade = new THREE.Mesh(
        new THREE.BoxGeometry(1.4, 34, 0.5),
        new THREE.MeshStandardMaterial({ color: 0x2a2008, emissive: gold, emissiveIntensity: 0.7, metalness: 0.9, roughness: 0.3 }),
      );
      const a = (i / 12) * Math.PI * 2;
      blade.position.set(Math.cos(a) * 18, 410, Math.sin(a) * 18);
      blade.lookAt(0, 410, 0);
      crown.add(blade);
    }
    g.add(crown);
    // a broad plinth
    const plinth = new THREE.Mesh(
      new THREE.CylinderGeometry(26, 34, 6, 16),
      new THREE.MeshStandardMaterial({ color: 0x2a2208, emissive: gold, emissiveIntensity: 0.18, metalness: 0.8, roughness: 0.4 }),
    );
    plinth.position.y = 3;
    g.add(plinth);
    // orbiting rings
    const rings: THREE.Mesh[] = [];
    for (let i = 0; i < 5; i++) {
      const r = new THREE.Mesh(
        new THREE.TorusGeometry(24 + i * 9, 0.8, 8, 64),
        new THREE.MeshBasicMaterial({ color: gold, toneMapped: false, transparent: true, opacity: 0.75 }),
      );
      r.position.y = 50 + i * 52;
      r.rotation.x = Math.PI / 2 + (i - 2) * 0.32;
      g.add(r);
      rings.push(r);
    }
    // colossal halo ring in the sky — visible from across the map
    const skyHalo = new THREE.Mesh(
      new THREE.TorusGeometry(90, 2, 10, 96),
      new THREE.MeshBasicMaterial({ color: gold, transparent: true, opacity: 0.5, toneMapped: false }),
    );
    skyHalo.rotation.x = Math.PI / 2; skyHalo.position.y = 300;
    g.add(skyHalo);
    // ground halo disc
    const halo2 = new THREE.Mesh(
      new THREE.RingGeometry(28, 60, 64),
      new THREE.MeshBasicMaterial({ color: gold, transparent: true, opacity: 0.14, side: THREE.DoubleSide, toneMapped: false, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    halo2.rotation.x = -Math.PI / 2; halo2.position.y = 0.5;
    g.add(halo2);
    // light column
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(16, 4, 460, 20, 1, true),
      new THREE.MeshBasicMaterial({ color: gold, transparent: true, opacity: 0.09, side: THREE.DoubleSide, toneMapped: false, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    beam.position.y = 230;
    g.add(beam);
    // floating prize at the summit
    const prize = new THREE.Mesh(
      new THREE.OctahedronGeometry(9, 0),
      new THREE.MeshBasicMaterial({ color: 0xfff3c0, toneMapped: false }),
    );
    prize.position.y = 356;
    g.add(prize);
    const halo = new THREE.Mesh(
      new THREE.OctahedronGeometry(15, 0),
      new THREE.MeshBasicMaterial({ color: gold, toneMapped: false, transparent: true, opacity: 0.2, side: THREE.BackSide }),
    );
    halo.position.y = 356;
    g.add(halo);
    // golden uplight
    const light = new THREE.PointLight(0xffd23f, 6, 700, 2);
    light.position.y = 180;
    g.add(light);
    // sparkle
    const N = 420, pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const a = Math.random() * Math.PI * 2, rr = 6 + Math.random() * 110, y = Math.random() * 360;
      pos[i * 3] = Math.cos(a) * rr; pos[i * 3 + 1] = y; pos[i * 3 + 2] = Math.sin(a) * rr;
    }
    const sg = new THREE.BufferGeometry(); sg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const sparkle = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xfff3c0, size: 1.4, transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }));
    g.add(sparkle);
    // ---- FLYING CARS: dense light traffic circling the spire ----
    const CARS = 140;
    const carPos = new Float32Array(CARS * 3), carCol = new Float32Array(CARS * 3);
    const carA: number[] = [], carR: number[] = [], carY: number[] = [], carS: number[] = [];
    const warm = new THREE.Color(0xffb066), cool = new THREE.Color(0x66e0ff);
    for (let i = 0; i < CARS; i++) {
      carA.push(Math.random() * Math.PI * 2);
      carR.push(40 + Math.random() * 120);
      carY.push(20 + Math.random() * 200);
      carS.push((Math.random() < 0.5 ? -1 : 1) * (0.2 + Math.random() * 0.5));
      const c = Math.random() < 0.5 ? warm : cool;
      carCol[i*3] = c.r; carCol[i*3+1] = c.g; carCol[i*3+2] = c.b;
    }
    const carGeo = new THREE.BufferGeometry();
    carGeo.setAttribute("position", new THREE.BufferAttribute(carPos, 3));
    carGeo.setAttribute("color", new THREE.BufferAttribute(carCol, 3));
    const cars = new THREE.Points(carGeo, new THREE.PointsMaterial({ size: 3.4, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }));
    cars.frustumCulled = false;
    g.add(cars);

    // ---- FIREWORKS: periodic bursts overhead ----
    const FW = 900;
    const fwPos = new Float32Array(FW * 3).fill(-9999);
    const fwCol = new Float32Array(FW * 3);
    const fwVel = new Float32Array(FW * 3);
    const fwLife = new Float32Array(FW);
    const fwGeo = new THREE.BufferGeometry();
    fwGeo.setAttribute("position", new THREE.BufferAttribute(fwPos, 3));
    fwGeo.setAttribute("color", new THREE.BufferAttribute(fwCol, 3));
    const fireworks = new THREE.Points(fwGeo, new THREE.PointsMaterial({ size: 2.6, vertexColors: true, transparent: true, opacity: 1, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }));
    fireworks.frustumCulled = false;
    g.add(fireworks);

    // ---- PARTY LIGHTS: sweeping coloured beams ----
    const partyGroup = new THREE.Group();
    const partyCols = [0xff2d95, 0x35e0ff, 0x39ff9c, 0xffd23f, 0xb46cff];
    const partyLights: THREE.SpotLight[] = [];
    for (let i = 0; i < 5; i++) {
      const sl = new THREE.SpotLight(partyCols[i], 3, 320, Math.PI / 9, 0.4, 1);
      const a = (i / 5) * Math.PI * 2;
      sl.position.set(Math.cos(a) * 40, 6, Math.sin(a) * 40);
      sl.target.position.set(Math.cos(a) * 120, 180, Math.sin(a) * 120);
      partyGroup.add(sl); partyGroup.add(sl.target);
      partyLights.push(sl);
    }
    g.add(partyGroup);

    // sweeping searchlights — the "premiere" beams
    const searchGroup = new THREE.Group();
    const searchBeams: THREE.Mesh[] = [];
    for (let i = 0; i < 4; i++) {
      const sb = new THREE.Mesh(
        new THREE.CylinderGeometry(1.5, 22, 500, 12, 1, true),
        new THREE.MeshBasicMaterial({ color: gold, transparent: true, opacity: 0.05, side: THREE.DoubleSide, toneMapped: false, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      const a = (i / 4) * Math.PI * 2;
      sb.position.set(Math.cos(a) * 30, 250, Math.sin(a) * 30);
      sb.rotation.z = 0.5; sb.rotation.y = a;
      searchGroup.add(sb); searchBeams.push(sb);
    }
    g.add(searchGroup);

    this.grand = {
      rings, prize, sparkle, cars, carGeo, carA, carR, carY, carS,
      fwGeo, fwPos, fwCol, fwVel, fwLife, fwTimer: 0,
      partyGroup, partyLights, searchGroup, searchBeams,
    };
    return g;
  }

  /** A containment dome that visibly seals a locked district. It reads as
   *  "you cannot get in", and behind it the server hands out nothing anyway —
   *  clip past the shield and the district is empty until you are cleared. */
  private makeShield(d: (typeof DISTRICTS)[number]): THREE.Group {
    const g = new THREE.Group();
    const col = new THREE.Color(d.palette[0]);
    const R = d.radius + 4;
    // faint solid fill
    const fill = new THREE.Mesh(
      new THREE.SphereGeometry(R, 32, 20, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.06, side: THREE.DoubleSide, toneMapped: false, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    g.add(fill);
    // hex/wire grid shell — the "forcefield" read
    const wire = new THREE.Mesh(
      new THREE.SphereGeometry(R, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: col, wireframe: true, transparent: true, opacity: 0.14, toneMapped: false, depthWrite: false }),
    );
    g.add(wire);
    // bright base ring on the ground so the boundary is unmistakable
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(R, 0.8, 8, 96),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.6, toneMapped: false }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.4;
    g.add(ring);
    g.position.set(d.center[0], 0, d.center[1]);
    (g as any)._wire = wire;
    (g as any)._fill = fill;
    return g;
  }

  /** A scaled beacon monument for a non-golden district. Taller & brighter the
   *  more the district is worth, so the skyline reads its own value. */
  private makeMonument(d: (typeof DISTRICTS)[number], scale: number): { rings: THREE.Mesh[]; prize: THREE.Mesh; group: THREE.Group } {
    const g = new THREE.Group();
    const col = new THREE.Color(d.palette[0]);
    const H = 340 * scale;
    const spire = new THREE.Mesh(
      new THREE.CylinderGeometry(2 * scale, 16 * scale, H, 8),
      new THREE.MeshStandardMaterial({ color: 0x14141c, emissive: col, emissiveIntensity: 0.5, metalness: 0.9, roughness: 0.3 }),
    );
    spire.position.y = H / 2;
    g.add(spire);
    const plinth = new THREE.Mesh(
      new THREE.CylinderGeometry(22 * scale, 30 * scale, 5 * scale, 14),
      new THREE.MeshStandardMaterial({ color: 0x1a1a22, emissive: col, emissiveIntensity: 0.16, metalness: 0.8, roughness: 0.4 }),
    );
    plinth.position.y = 2.5 * scale;
    g.add(plinth);
    const rings: THREE.Mesh[] = [];
    const nRings = d.clearance === "ghost" ? 4 : 3;
    for (let i = 0; i < nRings; i++) {
      const r = new THREE.Mesh(
        new THREE.TorusGeometry((20 + i * 8) * scale, 0.7 * scale, 8, 56),
        new THREE.MeshBasicMaterial({ color: col, toneMapped: false, transparent: true, opacity: 0.7 }),
      );
      r.position.y = (55 + i * 50) * scale;
      r.rotation.x = Math.PI / 2 + (i - 1) * 0.35;
      g.add(r); rings.push(r);
    }
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(12 * scale, 3 * scale, H * 1.3, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.07, side: THREE.DoubleSide, toneMapped: false, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    beam.position.y = H * 0.65;
    g.add(beam);
    const prize = new THREE.Mesh(
      new THREE.OctahedronGeometry(6 * scale, 0),
      new THREE.MeshBasicMaterial({ color: d.palette[1], toneMapped: false }),
    );
    prize.position.y = H + 6 * scale;
    g.add(prize);
    const light = new THREE.PointLight(d.palette[0], 2.5 * scale, 300 * scale, 2);
    light.position.y = H * 0.6;
    g.add(light);
    // ghost districts get a little sparkle
    if (d.clearance === "ghost") {
      const N = 140, pos = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) { const a = Math.random() * Math.PI * 2, rr = 8 + Math.random() * 70 * scale, y = Math.random() * H; pos[i*3] = Math.cos(a) * rr; pos[i*3+1] = y; pos[i*3+2] = Math.sin(a) * rr; }
      const sg = new THREE.BufferGeometry(); sg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      g.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: d.palette[1], size: 1.3, transparent: true, opacity: 0.7, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending })));
    }
    return { rings, prize, group: g };
  }

  private makeHoloPreview(d: (typeof DISTRICTS)[number]): THREE.Group {
    const g = new THREE.Group();
    // projector base on the corridor, just inside the gate
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(3, 3.6, 0.6, 12),
      new THREE.MeshStandardMaterial({ color: 0x0c1018, roughness: 0.5, metalness: 0.8 }),
    );
    base.position.y = 0.3;
    g.add(base);
    // rotating cluster of translucent wireframe towers in the district palette
    const cluster = new THREE.Group();
    const c1 = new THREE.Color(d.palette[0]);
    const rand = ((seed) => { let h = seed; return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 1000) / 1000; }; })(d.id.length * 2654435761);
    const n = 7;
    for (let i = 0; i < n; i++) {
      const h = 2 + rand() * 6;
      const tower = new THREE.Mesh(
        new THREE.BoxGeometry(0.7 + rand() * 0.6, h, 0.7 + rand() * 0.6),
        new THREE.MeshBasicMaterial({ color: c1, wireframe: true, transparent: true, opacity: 0.5, toneMapped: false }),
      );
      const a = (i / n) * Math.PI * 2;
      tower.position.set(Math.cos(a) * (1.4 + rand() * 1.6), 3 + h / 2, Math.sin(a) * (1.4 + rand() * 1.6));
      cluster.add(tower);
    }
    cluster.position.y = 0.5;
    g.add(cluster);
    // beam glow
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(3.2, 0.4, 9, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: c1, transparent: true, opacity: 0.06, side: THREE.DoubleSide, toneMapped: false, depthWrite: false }),
    );
    beam.position.y = 5;
    g.add(beam);
    const label = makeBillboard(d.name.toUpperCase(), `LOCKED · ${d.clearance ?? "open"}`, d.palette[0]);
    label.scale.setScalar(d.grand ? 0.5 : 0.34);
    label.position.y = d.grand ? 15 : 12;
    g.add(label);
    if (d.grand) { cluster.scale.setScalar(2.2); beam.scale.set(2.0, 2.2, 2.0); base.scale.set(1.6, 1.6, 1.6);
      const crown = new THREE.Mesh(new THREE.OctahedronGeometry(3, 0), new THREE.MeshBasicMaterial({ color: 0xfff3c0, toneMapped: false }));
      crown.position.y = 18; g.add(crown); (g as any)._cluster2 = crown; }
    // sit it just on the sprawl side of the gate so you meet it walking up
    const inward = new THREE.Vector3(d.center[0] - d.gate[0], 0, d.center[1] - d.gate[1]).normalize();
    g.position.set(d.gate[0] - inward.x * 8, 0, d.gate[1] - inward.z * 8);
    (g as any)._cluster = cluster;
    (g as any)._label = label;
    return g;
  }

  private addDevice(device: string, dtype: string, label: string, x: number, z: number, color: number) {
    const g = new THREE.Group();
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(2.4, dtype === "billboard" ? 6 : 4, 1.6),
      new THREE.MeshStandardMaterial({ color: 0x11141f, roughness: 0.5, metalness: 0.7 }),
    );
    box.position.y = dtype === "billboard" ? 5 : 2.4;
    g.add(box);
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(dtype === "billboard" ? 5 : 1.8, dtype === "billboard" ? 3 : 2),
      new THREE.MeshBasicMaterial({ color, toneMapped: false, transparent: true, opacity: 0.8 }),
    );
    screen.position.set(0, dtype === "billboard" ? 6 : 3, 0.82);
    g.add(screen);
    const sign = makeBillboard(label, "hold E to hack", color);
    sign.scale.setScalar(0.13);
    sign.position.y = dtype === "billboard" ? 9.5 : 6;
    g.add(sign);
    g.position.set(x, 0, z);
    this.scene.add(g);
    this.devices.push({ device, dtype, label, pos: new THREE.Vector3(x, 0, z), mesh: g });
  }

  private addIceNode(attack: string, label: string, x: number, z: number) {
    const g = new THREE.Group();
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.7, 5, 6),
      new THREE.MeshStandardMaterial({ color: 0x0c1420, roughness: 0.5, metalness: 0.8 }),
    );
    post.position.y = 2.5;
    g.add(post);
    // A rotating red ICE shard: cracked green once you have run its attack.
    const shard = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.4, 0),
      new THREE.MeshBasicMaterial({ color: 0xff2b46, toneMapped: false, wireframe: true }),
    );
    shard.position.y = 6;
    g.add(shard);
    const glow = new THREE.Mesh(
      new THREE.IcosahedronGeometry(2.0, 0),
      new THREE.MeshBasicMaterial({ color: 0xff2b46, toneMapped: false, transparent: true, opacity: 0.14, side: THREE.BackSide }),
    );
    glow.position.y = 6;
    g.add(glow);
    const sign = makeBillboard(label, "hold E to hack", 0xff2b46);
    sign.scale.setScalar(0.16);
    sign.position.y = 9;
    g.add(sign);
    g.position.set(x, 0, z);
    this.scene.add(g);
    this.iceNodes.push({ attack, label, pos: new THREE.Vector3(x, 0, z), mesh: g, cracked: false });
  }

  /**
   * Mark an ICE panel after an attack ran. A blocked attack must NOT read as a
   * won hack: held -> the shard locks solid cyan (shielded, you got nothing);
   * a real breach -> alarm red. Green is never used, because green reads as
   * "hack succeeded".
   */
  crackIce(attack: string, held: boolean) {
    const n = this.iceNodes.find((i) => i.attack === attack);
    if (!n) return;
    n.cracked = true;
    const c = held ? 0x2ad4ff : 0xff2b46;
    n.mesh.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const m = mesh.material as THREE.MeshBasicMaterial | undefined;
      if (m && m.color && mesh.geometry?.type?.includes("Icosahedron")) {
        m.color.setHex(c);
        // Held = the shell solidifies (shielded); wireframe stays only if breached.
        if (held && "wireframe" in m) (m as any).wireframe = false;
      }
    });
  }

  private onKey = (e: KeyboardEvent, down: boolean) => {
    // WASD are letters before they are movement. This listener is on `window`,
    // so without these two guards every text field in the game silently drops
    // half the alphabet and the player walks off while you type.
    if (!this.inputEnabled) return;
    if (Nightfabric.typingInto(e.target)) return;

    const k = e.key.toLowerCase();
    if (k === "w" || k === "arrowup") KEY.w = down;
    else if (k === "a" || k === "arrowleft") KEY.a = down;
    else if (k === "s" || k === "arrowdown") KEY.s = down;
    else if (k === "d" || k === "arrowright") KEY.d = down;
    else if (k === "shift") KEY.shift = down;
    else if (k === "f") {
      if (down) this.toggleLamp();
    } else return;
    e.preventDefault();
  };
  private kd = (e: KeyboardEvent) => this.onKey(e, true);
  private ku = (e: KeyboardEvent) => this.onKey(e, false);

  private onMove = (e: MouseEvent) => {
    if (!this.inputEnabled) return;
    if (document.pointerLockElement !== this.canvas) return;
    this.yaw -= e.movementX * 0.0022;
    this.pitch -= e.movementY * 0.0022;
    this.pitch = Math.max(-1.35, Math.min(1.35, this.pitch));
  };
  private onClick = () => {
    if (!this.inputEnabled) return;
    this.sfx.resume();
    if (document.pointerLockElement !== this.canvas) this.canvas.requestPointerLock();
  };
  private onResize = () => this.resize();

  private bind() {
    addEventListener("keydown", this.kd);
    addEventListener("keyup", this.ku);
    addEventListener("mousemove", this.onMove);
    addEventListener("resize", this.onResize);
    this.canvas.addEventListener("click", this.onClick);
  }

  private resize() {
    const w = this.canvas.clientWidth || innerWidth;
    const h = this.canvas.clientHeight || innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /* ----------------------------------------------------------- public API */

  start() {
    this.clock.start();
    const loop = () => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(loop);
      this.frame();
    };
    loop();
  }

  /** Tell the world what the SERVER said. `null` = not asked yet. */
  setClearance(id: DistrictId, granted: boolean | null) {
    this.clearance.set(id, granted);
    // The district itself renders only once unlocked; until then, just the holo.
    const view = this.districtView.get(id);
    if (view) {
      const open = granted === true;
      // The beacon (spire / grand festival) is ALWAYS visible — it is the landmark
      // that makes you want to get in. Only the containment shield and the holo
      // preview react to being unlocked.
      if (view.holo) view.holo.visible = !open;
      if (view.shield) view.shield.visible = !open;
    }
    const gate = this.gates.find((g) => g.district.id === id);
    if (!gate) return;
    gate.granted = granted;
    const mat = gate.panel.material as THREE.MeshBasicMaterial;
    const frameMat = gate.frame.material as THREE.MeshBasicMaterial;
    if (granted === true) {
      mat.color.setHex(0x39ff88);
      mat.opacity = 0.06;
      frameMat.color.setHex(0x39ff88);
    } else if (granted === false) {
      mat.color.setHex(0xff2b46);
      mat.opacity = 0.4;
      frameMat.color.setHex(0xff2b46);
    } else {
      mat.color.setHex(0x8899aa);
      mat.opacity = 0.22;
      frameMat.color.setHex(0x8899aa);
    }
  }

  /** Step into a district's interior world. Built lazily and parked far from the
   *  city (past the fog + far clip) so the outside never bleeds in; the player is
   *  teleported inside and the fog re-tinted to the interior's own sky. */
  enterInterior(id: DistrictId) {
    const d = DISTRICT_BY_ID[id];
    if (!d || id === "sprawl" || this.inside) return;
    let entry = this.interiors.get(id);
    if (!entry) {
      const idx = DISTRICTS.findIndex((x) => x.id === id);
      const anchor = { x: 100000 + idx * 4000, z: 0 };
      const interior = buildInterior(d);
      interior.group.position.set(anchor.x, 0, anchor.z);
      this.scene.add(interior.group);
      for (const c of interior.colliders) this.addBuilding({ x: anchor.x + c.x, z: anchor.z + c.z, hw: c.hw, hd: c.hd });
      entry = { interior, anchor };
      this.interiors.set(id, entry);
    }
    const { interior, anchor } = entry;
    interior.group.visible = true;
    this.inside = {
      id, interior, anchor,
      props: interior.props.map((p) => ({ ...p, wx: anchor.x + p.x, wz: anchor.z + p.z })),
      returnX: d.gate[0], returnZ: d.gate[1] - 8, returnYaw: this.yaw,
    };
    (this.scene.fog as THREE.FogExp2).color.setHex(interior.fog);
    (this.scene.fog as THREE.FogExp2).density = interior.fogDensity;
    this.pos.set(anchor.x + interior.spawnX, EYE, anchor.z + interior.spawnZ);
    // face the plaza centre: forward is (-sin yaw, -cos yaw)
    this.yaw = Math.atan2(-(anchor.x - this.pos.x), -(anchor.z - this.pos.z));
    this.pitch = 0;
    this.sfx.setMood(d.grand ? "festival" : "city");
    this.emit({ type: "interior", district: id });
    this.sfx.play("gate");
  }

  /** Leave the interior and drop back at the city gate. */
  exitInterior() {
    if (!this.inside) return;
    this.inside.interior.group.visible = false;
    (this.scene.fog as THREE.FogExp2).color.setHex(0x241a48);
    (this.scene.fog as THREE.FogExp2).density = 0.00105;
    this.pos.set(this.inside.returnX, EYE, this.inside.returnZ);
    this.inside = null;
    this.sfx.setMood("city");
    this.emit({ type: "interior", district: null });
  }

  isInside(): DistrictId | null { return this.inside?.id ?? null; }

  /** Populate a district with the shards the server actually handed over. */
  setShards(district: DistrictId, list: { id: string; offset: [number, number] }[]) {
    for (const [id, s] of this.shards) {
      if (s.district === district) {
        this.shardLayer.remove(s.group);
        this.shards.delete(id);
      }
    }
    const d = DISTRICT_BY_ID[district];
    for (const s of list) {
      const g = makeShardMesh(d.palette[0]);
      g.position.set(d.center[0] + s.offset[0], 2.4, d.center[1] + s.offset[1]);
      this.shardLayer.add(g);
      this.shards.set(s.id, { id: s.id, group: g, district });
    }
  }

  removeShard(id: string) {
    const s = this.shards.get(id);
    if (!s) return;
    this.shardLayer.remove(s.group);
    this.shards.delete(id);
  }

  /**
   * Draw a threshold operation: beams from the player to `t` of the `n` towers.
   * Cosmetic, but the shape is honest — t partial results, combined locally,
   * and no single tower could have produced the result alone.
   */
  pulseFabric(t: number, color = 0x2ad4ff) {
    const n = this.fabricNodes.length;
    const picks = [...Array(n).keys()].sort(() => Math.random() - 0.5).slice(0, Math.min(t, n));
    const from = this.pos.clone();
    for (const i of picks) {
      const geo = new THREE.BufferGeometry().setFromPoints([from, this.fabricNodes[i].position]);
      const line = new THREE.Line(
        geo,
        new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85 }),
      );
      this.beamLayer.add(line);
      this.beams.push({ line, born: performance.now(), life: 1400 });
    }
  }

  /**
   * Hand control to a panel, or take it back.
   *
   * Disabling also CLEARS the held keys: a panel that opens while you are
   * walking forward would otherwise leave `w` stuck down, and you would drift
   * across the city the whole time you were typing.
   */
  /**
   * Viewer-side brightness. Monitors vary enormously and a night scene that
   * reads fine on one is unnavigable on another — cheaper to expose the knob
   * than to keep guessing.
   */
  setExposure(v: number) {
    this.renderer.toneMappingExposure = Math.max(0.6, Math.min(3, v));
  }

  get exposure() {
    return this.renderer.toneMappingExposure;
  }

  toggleLamp() {
    this.lampOn = !this.lampOn;
    this.lamp.intensity = this.lampOn ? 2.6 : 0;
  }

  get lampIsOn() {
    return this.lampOn;
  }

  setInputEnabled(on: boolean) {
    this.inputEnabled = on;
    if (!on) {
      KEY.w = KEY.a = KEY.s = KEY.d = KEY.shift = false;
      if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    }
  }

  /** Float a chat line over the speaker's head. */
  saySomething(vuid: string, text: string) {
    this.players.say(vuid, text, performance.now());
  }

  /** Feed the authenticated presence roster into the world. */
  setPlayers(list: RemoteState[]) {
    this.players.sync(list);
  }

  /** Pose to report to the server. Position is cosmetic; identity is not sent. */
  get pose() {
    return { x: this.pos.x, z: this.pos.z, yaw: this.yaw, pitch: this.pitch };
  }

  /**
   * Fire the Blackwall Protocol. Purely presentational — the access change
   * already happened server-side, and this is the city noticing.
   *
   * Idempotent-ish: a second call while the first is still running restarts the
   * timeline rather than stacking two.
   */
  detonate() {
    this.blastT = 0;
    this.shakeSeed = Math.random() * 1000;

    if (this.shock) {
      this.beamLayer.remove(this.shock);
      this.shock.geometry.dispose();
    }
    // A ground-hugging ring rather than a fireball: what died here is access,
    // and it spreads outward through the grid.
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1, 1.06, 96),
      new THREE.MeshBasicMaterial({
        color: 0xff2b46,
        transparent: true,
        opacity: 1,
        side: THREE.DoubleSide,
        toneMapped: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(0, 1.2, 96);
    this.beamLayer.add(ring);
    this.shock = ring;

    // THE BIG ONE: a blinding flash, a fireball, a rising mushroom cloud, and
    // debris thrown skyward. Centred on the Blackwall detonator.
    const CZ = 96;
    const fx = new THREE.Group();
    const bmat = (c: number, o = 1) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, toneMapped: false, blending: THREE.AdditiveBlending, depthWrite: false });
    const flash = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 16), bmat(0xffffff));
    flash.position.set(0, 55, CZ); fx.add(flash);
    const fireball = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 22), bmat(0xffd257));
    fireball.position.set(0, 55, CZ); fx.add(fireball);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(16, 32, 1, 20, 1, true), bmat(0xff5a2a, 0.8));
    (stem.material as THREE.Material).side = THREE.DoubleSide;
    stem.position.set(0, 0.5, CZ); fx.add(stem);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(1, 22, 16), bmat(0xff7a3a, 0.9));
    cap.position.set(0, 60, CZ); fx.add(cap);
    const light = new THREE.PointLight(0xffb060, 0, 3000, 2); light.position.set(0, 90, CZ); fx.add(light);
    const N = 280, dp = new Float32Array(N * 3), dv: number[] = [];
    for (let i = 0; i < N; i++) {
      dp[i * 3] = 0; dp[i * 3 + 1] = 30; dp[i * 3 + 2] = CZ;
      const a = Math.random() * Math.PI * 2, ph = Math.random() * 1.1, sp = 90 + Math.random() * 240;
      dv.push(Math.cos(a) * Math.sin(ph) * sp, Math.abs(Math.cos(ph)) * sp * 1.6 + 100, Math.sin(a) * Math.sin(ph) * sp);
    }
    const dgeo = new THREE.BufferGeometry(); dgeo.setAttribute("position", new THREE.BufferAttribute(dp, 3));
    const debris = new THREE.Points(dgeo, new THREE.PointsMaterial({ color: 0xffb060, size: 5, transparent: true, opacity: 1, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }));
    debris.frustumCulled = false; fx.add(debris);
    this.scene.add(fx);
    this.blastFx = { group: fx, flash, fireball, stem, cap, light, debris, dgeo, dv };
    this.sfx.play("boom");
  }

  /** Put the lights back on — for a fresh session or a re-grant. */
  restoreCity() {
    this.blastT = null;
    this.darkened = false;
    for (const m of this.neon) {
      m.opacity = 1;
      m.transparent = false;
    }
    this.ambient.intensity = 2.4;
    this.ambient.color.setHex(0x7f9ad0);
    this.hemi.intensity = 1.5;
    this.keyLight.intensity = 1.05;
    this.rimLight.intensity = 0.8;
    (this.scene.fog as THREE.FogExp2).density = 0.00105;
    for (const m of this.animated) {
      if (m.uniforms.uLit) m.uniforms.uLit.value = 0.62;
    }
    if (this.shock) {
      this.beamLayer.remove(this.shock);
      this.shock.geometry.dispose();
      this.shock = null;
    }
    if (this.blastFx) { this.scene.remove(this.blastFx.group); this.blastFx = null; }
  }

  get cityIsDark() {
    return this.darkened;
  }

  teleport(x: number, z: number) {
    this.pos.set(x, EYE, z);
  }

  get position() {
    return { x: this.pos.x, z: this.pos.z };
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    removeEventListener("keydown", this.kd);
    removeEventListener("keyup", this.ku);
    removeEventListener("mousemove", this.onMove);
    removeEventListener("resize", this.onResize);
    this.canvas.removeEventListener("click", this.onClick);
    this.renderer.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
  }

  /* ---------------------------------------------------------------- frame */

  private frame() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const now = performance.now();

    this.fpsAcc += dt;
    this.frames++;
    if (this.fpsAcc > 0.5) {
      this.fps = Math.round(this.frames / this.fpsAcc);
      this.frames = 0;
      this.fpsAcc = 0;
    }

    this.move(dt);
    this.animate(dt, now);
    this.proximity();
    this.lastNow = now;

    if (this.lampOn) {
      this.lamp.position.copy(this.pos);
      const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      this.lamp.target.position.copy(this.pos).addScaledVector(fwd, 60);
      this.lamp.target.position.y = this.pos.y - 8;
      this.lamp.target.updateMatrixWorld();
    }

    this.camera.position.copy(this.pos);
    if (this.blastT !== null && this.blastT < 3.5) {
      // A real gut-punch: big at the flash, decaying over a few seconds.
      const amp = 3.4 * Math.pow(1 - this.blastT / 3.5, 2.0);
      const s = this.shakeSeed + this.lastNow * 0.05;
      this.camera.position.x += Math.sin(s * 1.7) * amp;
      this.camera.position.y += Math.sin(s * 2.3) * amp * 0.8;
      this.camera.position.z += Math.cos(s * 1.9) * amp;
    }
    this.camera.rotation.set(this.pitch, this.yaw, 0, "YXZ");
    this.renderer.render(this.scene, this.camera);
  }

  private move(dt: number) {
    const speed = (KEY.shift ? SPRINT : WALK) * dt;
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const next = this.pos.clone();
    if (KEY.w) next.addScaledVector(fwd, speed);
    if (KEY.s) next.addScaledVector(fwd, -speed);
    if (KEY.d) next.addScaledVector(right, speed);
    if (KEY.a) next.addScaledVector(right, -speed);

    if (this.inside) {
      // Inside an interior bubble: none of the city's rules apply. Keep the
      // player within a generous radius of the interior anchor.
      const a = this.inside.anchor;
      next.x = a.x + Math.max(-600, Math.min(600, next.x - a.x));
      next.z = a.z + Math.max(-600, Math.min(600, next.z - a.z));
    } else {
      // The one thing the renderer DOES enforce, and only because a refused
      // player standing inside an empty district is a worse demo than a refused
      // player standing at a shut door. The server refuses either way.
      const target = districtAt(next.x, next.z);
      if (target && target.id !== "sprawl" && this.clearance.get(target.id) !== true) {
        const cx = target.center[0];
        const cz = target.center[1];
        const dx = next.x - cx;
        const dz = next.z - cz;
        const len = Math.hypot(dx, dz) || 1;
        const push = target.radius + 1.5;
        next.x = cx + (dx / len) * push;
        next.z = cz + (dz / len) * push;
      }

      next.x = Math.max(-1150, Math.min(1150, next.x));
      next.z = Math.max(-1150, Math.min(1150, next.z));
    }

    // Resolve the two axes separately. Testing the combined move and rejecting
    // it wholesale makes you stick to walls; doing X and Z independently lets
    // you slide along a face, which is what a player expects.
    let fx = next.x;
    let fz = next.z;
    if (this.blocked(fx, this.pos.z)) fx = this.pos.x;
    if (this.blocked(fx, fz)) fz = this.pos.z;
    // If we started inside geometry (a spawn or teleport into a block), do not
    // freeze — let the move through rather than trapping the player forever.
    if (this.blocked(fx, fz) && this.blocked(this.pos.x, this.pos.z)) {
      fx = next.x;
      fz = next.z;
    }

    this.pos.set(fx, EYE, fz);
  }

  private animate(dt: number, now: number) {
    this.rain.step(dt);
    this.rain.points.position.set(this.pos.x, 0, this.pos.z);
    this.traffic.step(dt);

    const t = now / 1000;
    this.t = t;
    if (this.inside) this.inside.interior.animate(t, dt);
    for (const m of this.animated) m.uniforms.uTime.value = t;
    for (const s of this.shards.values()) {
      s.group.rotation.y += dt * 1.4;
      s.group.position.y = 2.4 + Math.sin(t * 2 + s.group.position.x) * 0.45;
    }
    for (const n of this.fabricNodes) {
      n.core.rotation.y += dt * 0.5;
      n.core.rotation.x += dt * 0.22;
    }
    for (const n of this.iceNodes) {
      n.mesh.children[1].rotation.y += dt * 1.6;
      n.mesh.children[1].rotation.x += dt * 0.7;
      n.mesh.children[3].lookAt(this.pos.x, n.mesh.position.y + 9, this.pos.z);
    }
    for (const dv of this.devices) dv.mesh.children[2].lookAt(this.pos.x, dv.mesh.position.y + (dv.dtype === "billboard" ? 9.5 : 6), this.pos.z);
    for (const m of this.monuments) {
      for (let i = 0; i < m.rings.length; i++) m.rings[i].rotation.z += dt * (0.25 + i * 0.12);
      m.prize.rotation.y += dt * 0.7;
    }
    if (this.grand) {
      const gr = this.grand;
      for (let i = 0; i < gr.rings.length; i++) gr.rings[i].rotation.z += dt * (0.3 + i * 0.15);
      gr.prize.rotation.y += dt * 0.8; gr.prize.rotation.x += dt * 0.3;
      gr.prize.position.y = 356 + Math.sin(t * 1.2) * 6;
      gr.sparkle.rotation.y += dt * 0.12;

      // flying cars orbit
      const cp = gr.carGeo.getAttribute("position") as THREE.BufferAttribute;
      const ca = cp.array as Float32Array;
      for (let i = 0; i < gr.carA.length; i++) {
        gr.carA[i] += dt * gr.carS[i] * 0.4;
        ca[i*3] = Math.cos(gr.carA[i]) * gr.carR[i];
        ca[i*3+1] = gr.carY[i] + Math.sin(t + i) * 2;
        ca[i*3+2] = Math.sin(gr.carA[i]) * gr.carR[i];
      }
      cp.needsUpdate = true;

      // fireworks: advance live particles, launch a new burst on a timer
      const fp = gr.fwPos as Float32Array, fv = gr.fwVel as Float32Array, fl = gr.fwLife as Float32Array, fc = gr.fwCol as Float32Array;
      for (let i = 0; i < fl.length; i++) {
        if (fl[i] > 0) {
          fl[i] -= dt;
          fp[i*3]   += fv[i*3]   * dt;
          fp[i*3+1] += fv[i*3+1] * dt - 12 * dt * dt;
          fp[i*3+2] += fv[i*3+2] * dt;
          fv[i*3+1] -= 24 * dt;
          if (fl[i] <= 0) { fp[i*3] = -9999; fp[i*3+1] = -9999; fp[i*3+2] = -9999; }
        }
      }
      gr.fwTimer -= dt;
      if (gr.fwTimer <= 0) {
        gr.fwTimer = 0.28 + (Math.sin(t * 3.1) * 0.5 + 0.5) * 0.35;
        const cx = (Math.sin(t * 5.3) * 0.5) * 120, cz = (Math.cos(t * 4.1) * 0.5) * 120, cy = 200 + (Math.sin(t) * 0.5 + 0.5) * 120;
        const hue = (t * 0.17) % 1;
        const col = new THREE.Color().setHSL(hue, 0.9, 0.6);
        let placed = 0;
        for (let i = 0; i < fl.length && placed < 90; i++) {
          if (fl[i] > 0) continue;
          const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1), sp = 20 + Math.random() * 34;
          fv[i*3]   = Math.sin(ph) * Math.cos(th) * sp;
          fv[i*3+1] = Math.cos(ph) * sp;
          fv[i*3+2] = Math.sin(ph) * Math.sin(th) * sp;
          fp[i*3] = cx; fp[i*3+1] = cy; fp[i*3+2] = cz;
          fc[i*3] = col.r; fc[i*3+1] = col.g; fc[i*3+2] = col.b;
          fl[i] = 1.4 + Math.random() * 0.7; placed++;
        }
        (gr.fwGeo.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;
      }
      (gr.fwGeo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;

      // searchlights + party lights sweep
      if (gr.searchGroup) gr.searchGroup.rotation.y += dt * 0.35;
      if (gr.searchBeams) for (let i = 0; i < gr.searchBeams.length; i++) gr.searchBeams[i].rotation.z = 0.4 + Math.sin(t * 0.7 + i) * 0.35;
      gr.partyGroup.rotation.y += dt * 0.5;
      for (let i = 0; i < gr.partyLights.length; i++) gr.partyLights[i].intensity = 2 + Math.abs(Math.sin(t * 3 + i)) * 3;
    }
    for (const sh of this.shields) {
      if (!sh.visible) continue;
      const w = (sh as any)._wire as THREE.Mesh; if (w) w.rotation.y += dt * 0.06;
      const f = (sh as any)._fill as THREE.Mesh; if (f) (f.material as THREE.MeshBasicMaterial).opacity = 0.05 + Math.abs(Math.sin(t * 0.8)) * 0.05;
    }
    for (const term of this.terminals) {
      term.mesh.children[3].lookAt(this.pos);
    }
    this.crowd.step(dt);
    for (const p of this.streetProps) p.tick?.(dt, t);
    this.players.step(dt, this.pos, now);
    for (const n of this.npcs) {
      n.label.lookAt(this.pos.x, n.group.position.y + n.label.position.y, this.pos.z);
      // Turn to face whoever walks up, but only once they are close enough to
      // talk to — a whole street pivoting at you from 200m reads as hostile.
      const d = Math.hypot(n.pos.x - this.pos.x, n.pos.z - this.pos.z);
      if (d < 22) {
        n.group.rotation.y = Math.atan2(this.pos.x - n.pos.x, this.pos.z - n.pos.z);
      }
    }
    for (const g of this.gates) g.label.lookAt(this.pos.x, g.label.position.y + g.group.position.y, this.pos.z);

    if (this.blastT !== null) {
      this.blastT += dt;
      const t = this.blastT;

      // Shockwave: 0 -> 1400 units over 4s, thinning as it goes.
      if (this.shock) {
        const r = Math.pow(t / 4, 0.62) * 1400;
        this.shock.scale.setScalar(Math.max(0.01, r));
        const mat = this.shock.material as THREE.MeshBasicMaterial;
        mat.opacity = Math.max(0, 1 - t / 4);
        if (t > 4) {
          this.beamLayer.remove(this.shock);
          this.shock.geometry.dispose();
          this.shock = null;
        }
      }

      // Fireball / mushroom cloud / debris.
      if (this.blastFx) {
        const b = this.blastFx;
        const M = (m: THREE.Object3D) => (m as THREE.Mesh).material as THREE.MeshBasicMaterial;
        b.flash.scale.setScalar(6 + Math.min(1, t / 0.04) * 300);
        M(b.flash).opacity = Math.max(0, 1 - t / 0.5);
        const fbs = Math.min(1, t / 1.4);
        b.fireball.scale.setScalar(8 + fbs * 160);
        M(b.fireball).opacity = Math.max(0, 1 - t / 2.6);
        M(b.fireball).color.setRGB(1, 0.82 - fbs * 0.55, 0.34 - fbs * 0.28);
        const h = Math.min(1, t / 3) * 280;
        b.stem.scale.set(1, Math.max(0.01, h), 1);
        b.stem.position.y = h / 2 + 0.5;
        M(b.stem).opacity = Math.max(0, 0.7 - t / 6);
        const cs = 20 + Math.min(1, t / 3) * 80;
        b.cap.scale.set(cs, cs * 0.55, cs);
        b.cap.position.y = h + 24;
        M(b.cap).opacity = Math.max(0, 0.85 - t / 6);
        M(b.cap).color.setRGB(1, 0.5 - Math.min(1, t / 6) * 0.34, 0.28);
        (b.light as THREE.PointLight).intensity = Math.max(0, 22 * (1 - t / 1.7));
        const pos = b.dgeo.getAttribute("position") as THREE.BufferAttribute;
        const cnt = b.dv.length / 3;
        for (let i = 0; i < cnt; i++) {
          b.dv[i * 3 + 1] -= 150 * dt;
          pos.setXYZ(i, pos.getX(i) + b.dv[i * 3] * dt, Math.max(0, pos.getY(i) + b.dv[i * 3 + 1] * dt), pos.getZ(i) + b.dv[i * 3 + 2] * dt);
        }
        pos.needsUpdate = true;
        (b.debris.material as THREE.PointsMaterial).opacity = Math.max(0, 1 - t / 4.5);
        if (t > 7) { this.scene.remove(b.group); this.blastFx = null; }
      }

      // The grid dies as the wave passes: 0.25s of overload, then out.
      if (!this.darkened && t > 0.25) {
        const k = Math.min(1, (t - 0.25) / 1.1);
        for (const m of this.neon) {
          m.transparent = true;
          m.opacity = 1 - k;
        }
        this.ambient.intensity = 2.4 - 2.0 * k;
        this.hemi.intensity = 1.5 - 1.32 * k;
        this.keyLight.intensity = 1.05 - 0.93 * k;
        this.rimLight.intensity = 0.8 - 0.72 * k;
        (this.scene.fog as THREE.FogExp2).density = 0.00105 + 0.0021 * k;
        // The windows go out too, or a "blackout" leaves a fully lit skyline.
        for (const m of this.animated) {
          if (m.uniforms.uLit) m.uniforms.uLit.value = 0.62 * (1 - k);
        }
        if (k >= 1) {
          this.darkened = true;
          // Emergency lighting. The city is still standing; nobody can open
          // anything.
          this.ambient.color.setHex(0x5c1a24);
          this.ambient.intensity = 0.5;
          this.hemi.intensity = 0.2;
        }
      }
    }

    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      const age = (now - b.born) / b.life;
      if (age >= 1) {
        this.beamLayer.remove(b.line);
        b.line.geometry.dispose();
        this.beams.splice(i, 1);
      } else {
        (b.line.material as THREE.LineBasicMaterial).opacity = 0.9 * (1 - age) * (0.6 + 0.4 * Math.sin(age * 30));
      }
    }
  }

  private proximity() {
    // Inside an interior, only its own props are interactable.
    if (this.inside) {
      let iFocus: Focus | null = null; let iBest = Infinity;
      for (const p of this.inside.props) {
        const dd = Math.hypot(p.wx - this.pos.x, p.wz - this.pos.z);
        if (dd < 8 && dd < iBest) {
          iBest = dd;
          iFocus = p.kind === "exit" ? { kind: "exit", label: p.label } : { kind: "prop", action: p.action, label: p.label };
        }
      }
      const ikey = iFocus ? JSON.stringify(iFocus) : null;
      if (ikey !== this.lastFocus) { this.lastFocus = ikey; this.emit({ type: "focus", focus: iFocus }); }
      this.emit({ type: "tick", x: this.pos.x - this.inside.anchor.x, z: this.pos.z - this.inside.anchor.z, district: null, fps: this.fps });
      return;
    }

    let focus: Focus | null = null;
    let best = Infinity;

    for (const s of this.shards.values()) {
      const d = Math.hypot(s.group.position.x - this.pos.x, s.group.position.z - this.pos.z);
      if (d < 7 && d < best) {
        best = d;
        focus = { kind: "shard", id: s.id, label: "JACK DATASHARD" };
      }
    }
    for (const n of this.npcs) {
      const d = Math.hypot(n.pos.x - this.pos.x, n.pos.z - this.pos.z);
      if (d < 7.5 && d < best) {
        best = d;
        focus = { kind: "npc", id: n.npc.id, label: `TALK TO ${n.npc.name}` };
      }
    }
    for (const n of this.iceNodes) {
      const d = Math.hypot(n.pos.x - this.pos.x, n.pos.z - this.pos.z);
      if (d < 6.5 && d < best) {
        best = d;
        focus = { kind: "ice", attack: n.attack, label: `HACK: ${n.label}` };
      }
    }
    for (const dv of this.devices) {
      const d = Math.hypot(dv.pos.x - this.pos.x, dv.pos.z - this.pos.z);
      if (d < 6.5 && d < best) {
        best = d;
        focus = { kind: "device", device: dv.device, dtype: dv.dtype, label: `HACK: ${dv.label}` };
      }
    }
    for (const p of this.streetProps) {
      if (!p.hot) continue;
      const d = Math.hypot(p.hot.pos.x - this.pos.x, p.hot.pos.z - this.pos.z);
      if (d < 6.5 && d < best) {
        best = d;
        focus = { kind: "fun", action: p.hot.action, label: p.hot.label };
      }
    }
    for (const term of this.terminals) {
      const d = Math.hypot(term.pos.x - this.pos.x, term.pos.z - this.pos.z);
      if (d < 9 && d < best) {
        best = d;
        focus =
          term.kind === "vault"
            ? { kind: "vault", label: "CREW VAULT TERMINAL" }
            : term.kind === "council"
              ? { kind: "council", label: "COUNCIL RELAY" }
              : term.kind === "nuke"
                ? { kind: "nuke", label: "BLACKWALL PROTOCOL — DETONATOR" }
                : term.kind === "breach"
                  ? { kind: "breach", label: "BREACH TERMINAL — Old Town CTF (break it for points)" }
                  : term.kind === "fabric"
                    ? { kind: "fabric", label: "FABRIC TERMINAL — attack Tide itself (it holds)" }
                  : term.kind === "codex"
                    ? { kind: "codex", label: "DATAPAD — read the codex" }
                    : { kind: "raid", label: "CORPO RAID CONSOLE" };
      }
    }
    for (const g of this.gates) {
      const d = Math.hypot(g.group.position.x - this.pos.x, g.group.position.z - this.pos.z);
      if (d < 34) {
        if (!this.gateAsked.has(g.district.id)) {
          this.gateAsked.add(g.district.id);
          this.emit({ type: "gateApproach", district: g.district.id });
        }
        if (d < 18 && d < best) {
          best = d;
          focus = g.granted === true
            ? { kind: "gate", district: g.district.id, label: `ENTER ${g.district.name}` }
            : { kind: "gate", district: g.district.id, label: `GATE: ${g.district.name}` };
        }
      } else {
        this.gateAsked.delete(g.district.id);
      }
    }

    const key = focus ? JSON.stringify(focus) : null;
    if (key !== this.lastFocus) {
      this.lastFocus = key;
      this.emit({ type: "focus", focus });
    }

    const here = districtAt(this.pos.x, this.pos.z);
    const id = here?.id ?? null;
    if (id !== this.lastDistrict) {
      this.lastDistrict = id;
      if (id) this.emit({ type: "enterDistrict", district: id });
    }
    this.emit({ type: "tick", x: this.pos.x, z: this.pos.z, district: id, fps: this.fps });
  }
}
