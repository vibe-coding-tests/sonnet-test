// Procedural 3D models + animation for all 151 Gen 1 Pokémon.
//
// The game is fully offline, so there are no model files to load: every
// Pokémon is assembled at runtime from low-poly Three.js primitives by a
// set of body-plan builders ("archetypes" — quadruped, biped, bird, serpent,
// fish, blob, bug, ghost, golem, plant...), each driven by a hand-written
// per-species spec (palette, proportions, signature parts: Charmander's
// tail flame, Squirtle's shell, Pikachu's zigzag tail...). Every rig has a
// procedural animator: walk gaits, wing flaps, slithering, hovering,
// squash-and-stretch hops, breathing, blinking. The classic sprites remain
// in the UI (party strip, Pokédex, shop) only.

import * as THREE from "three";

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// ----------------------------------------------------------- geometry cache
// Geometry is immutable and shared between rigs; materials are per-rig so
// each Pokémon can be tinted (hit flashes) and faded independently.
const geoCache = new Map<string, THREE.BufferGeometry>();
function G(key: string, make: () => THREE.BufferGeometry) {
  let g = geoCache.get(key);
  if (!g) { g = make(); geoCache.set(key, g); }
  return g;
}
const sphereG = () => G("s", () => new THREE.SphereGeometry(1, 10, 8));
const hemiTopG = () => G("ht", () => new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2));
const hemiBotG = () => G("hb", () => new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2));
const coneG = () => G("c", () => new THREE.ConeGeometry(1, 1, 8));
const boxG = () => G("b", () => new THREE.BoxGeometry(1, 1, 1));
const capsG = () => G("p", () => new THREE.CapsuleGeometry(1, 1.6, 3, 8));
const cylG = () => G("y", () => new THREE.CylinderGeometry(1, 1, 1, 9));
const torusG = () => G("t", () => new THREE.TorusGeometry(1, 0.16, 7, 14));
const dodecaG = () => G("o", () => new THREE.DodecahedronGeometry(1, 0));
const octaG = () => G("O", () => new THREE.OctahedronGeometry(1, 0));
const discG = () => G("d", () => new THREE.CircleGeometry(1, 12));

export interface RigCtx { speed: number; water: boolean }
interface MatRec { m: THREE.MeshLambertMaterial; base: THREE.Color; baseOp: number }

export interface MonRig {
  group: THREE.Group;
  levitates: boolean;
  mats: MatRec[];
  anim: (dt: number, ctx: RigCtx) => void;
  cast: (cat: CastCat) => void;
  setOpacity: (o: number) => void;
  tint: (c: THREE.Color, k: number) => void;
  dispose: () => void;
}

// per-build collectors (reset by buildMonRig before each builder runs)
let MATS: MatRec[] = [];
let FLAMES: THREE.Object3D[] = [];
let EYES: THREE.Object3D[] = [];

function M(col: string | number, opts: any = {}) {
  const m = new THREE.MeshLambertMaterial({
    color: col as any,
    flatShading: opts.flat !== false,
    transparent: opts.op != null && opts.op < 1,
    opacity: opts.op ?? 1,
    side: opts.dbl ? THREE.DoubleSide : THREE.FrontSide,
    emissive: (opts.em ?? 0x000000) as any,
    emissiveIntensity: opts.emI ?? 1,
  });
  MATS.push({ m, base: new THREE.Color(col as any), baseOp: opts.op ?? 1 });
  return m;
}
function mesh(g: THREE.BufferGeometry, m: THREE.Material, sx = 1, sy = sx, sz = sx) {
  const me = new THREE.Mesh(g, m);
  me.scale.set(sx, sy, sz);
  return me;
}
function pivot(x = 0, y = 0, z = 0) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  return g;
}

// ------------------------------------------------------------- shared parts
// Models are built facing +Z.
function eyePair(head: THREE.Object3D, s: any, r: number, y: number, z: number, dx: number) {
  if (s.noEyes) return;
  const eyeC = s.eye || "#1c1c26";
  for (const side of [-1, 1]) {
    const e = pivot(side * dx, y, z);
    if (s.eyeStyle === "bead") {
      e.add(mesh(sphereG(), M(eyeC, { flat: false }), r * 0.8));
      const hl = mesh(sphereG(), M("#ffffff", { flat: false }), r * 0.25);
      hl.position.set(r * 0.25, r * 0.3, r * 0.6);
      e.add(hl);
    } else {
      e.add(mesh(sphereG(), M(s.sclera || "#f8f8f8", { flat: false }), r));
      const p = mesh(sphereG(), M(eyeC, { flat: false }), r * 0.55);
      p.position.z = r * 0.55;
      e.add(p);
    }
    head.add(e);
    EYES.push(e);
  }
}
function snout(head: THREE.Object3D, c: string, r: number, y: number, z: number, len: number) {
  const m = mesh(sphereG(), M(c), r, r * 0.7, len);
  m.position.set(0, y, z);
  head.add(m);
  return m;
}
function beak(head: THREE.Object3D, c: string, r: number, y: number, z: number, len: number) {
  const b = mesh(coneG(), M(c), r, len, r);
  b.rotation.x = Math.PI / 2;
  b.position.set(0, y, z + len * 0.35);
  head.add(b);
  return b;
}
function earCone(head: THREE.Object3D, s: any, len: number, r: number, dx: number, y: number, tilt = 0.45) {
  const out: THREE.Object3D[] = [];
  const c = s.earC || s.headC || s.body;
  for (const side of [-1, 1]) {
    const e = pivot(side * dx, y, 0);
    const cone = mesh(coneG(), M(c), r, len, r * 0.7);
    cone.position.y = len / 2;
    e.add(cone);
    if (s.earTip) {
      const tip = mesh(coneG(), M(s.earTip), r * 0.62, len * 0.4, r * 0.45);
      tip.position.y = len * 0.84;
      e.add(tip);
    }
    e.rotation.z = -side * tilt;
    head.add(e);
    out.push(e);
  }
  return out;
}
function hornCone(parent: THREE.Object3D, c: string, r: number, len: number, x: number, y: number, z: number, rx = -0.45) {
  const h = mesh(coneG(), M(c), r, len, r);
  h.position.set(x, y, z);
  h.rotation.x = rx;
  parent.add(h);
  return h;
}
function flameCone(parent: THREE.Object3D, r: number, h: number, x: number, y: number, z: number) {
  const f = pivot(x, y, z);
  const outer = mesh(coneG(), M("#ff7b29", { em: 0xff5500, emI: 0.65 }), r, h, r);
  outer.position.y = h / 2;
  const inner = mesh(coneG(), M("#ffd23d", { em: 0xffaa00, emI: 0.85 }), r * 0.55, h * 0.66, r * 0.55);
  inner.position.y = h * 0.4;
  f.add(outer, inner);
  parent.add(f);
  FLAMES.push(f);
  return f;
}
function tailPart(parent: THREE.Object3D, s: any, bodyR: number, hipY: number, zBack = -bodyR * 0.85): THREE.Object3D | null {
  const kind = s.tail;
  if (!kind) return null;
  const c = s.tailC || s.body;
  const piv = pivot(0, hipY, zBack);
  if (kind === "cone") {
    const t = mesh(coneG(), M(c), bodyR * (s.tailR || 0.3), bodyR * (s.tailLen || 1.25), bodyR * (s.tailR || 0.3));
    t.rotation.x = Math.PI / 2 + 0.55;
    t.position.set(0, bodyR * 0.12, -bodyR * 0.45);
    piv.add(t);
  } else if (kind === "fluff") {
    const t = mesh(sphereG(), M(c), bodyR * 0.48, bodyR * 0.42, bodyR * 0.8);
    t.position.set(0, bodyR * 0.18, -bodyR * 0.55);
    piv.add(t);
    if (s.tailTip) {
      const tip = mesh(sphereG(), M(s.tailTip), bodyR * 0.3, bodyR * 0.26, bodyR * 0.36);
      tip.position.set(0, bodyR * 0.24, -bodyR * 1.05);
      piv.add(tip);
    }
  } else if (kind === "zigzag") {
    const m = M(c);
    let px = 0, py = bodyR * 0.15, pz = -bodyR * 0.35, dir = 1;
    for (let i = 0; i < 3; i++) {
      const L = bodyR * (0.5 + i * 0.2);
      const seg = mesh(boxG(), m, bodyR * 0.16, L, bodyR * 0.09);
      seg.position.set(px + dir * bodyR * 0.14, py + L * 0.38, pz - bodyR * 0.12);
      seg.rotation.z = dir * 0.8;
      piv.add(seg);
      px = seg.position.x; py = seg.position.y + L * 0.3; pz = seg.position.z;
      dir = -dir;
    }
  } else if (kind === "multi") {
    // Vulpix / Ninetales: a fan of long curling tails sweeping up and back.
    const n = s.tailN || 6;
    const tm = M(c);
    const tipM = s.tailTip ? M(s.tailTip) : tm;
    for (let i = 0; i < n; i++) {
      const a = (i / Math.max(1, n - 1) - 0.5) * 2.1;       // wide horizontal fan
      const len = bodyR * (1.2 + (1 - Math.abs(a) / 1.1) * 0.5);
      const t = mesh(capsG(), tm, bodyR * 0.12, len * 0.5, bodyR * 0.12);
      t.position.set(Math.sin(a) * bodyR * 0.7, bodyR * (0.55 + Math.cos(a) * 0.2), -bodyR * 0.75);
      t.rotation.y = a;
      t.rotation.x = -0.95;                                  // sweep upward
      piv.add(t);
      const tip = mesh(sphereG(), tipM, bodyR * 0.2, bodyR * 0.2, bodyR * 0.3);
      tip.position.set(Math.sin(a) * bodyR * 1.05, bodyR * (1.05 + Math.cos(a) * 0.28), -bodyR * 1.15);
      piv.add(tip);
    }
  } else if (kind === "flame") {
    flameCone(piv, bodyR * 0.3, bodyR * 0.95, 0, bodyR * 0.1, -bodyR * 0.5);
  } else if (kind === "thick") {
    const t = mesh(capsG(), M(c), bodyR * 0.26, bodyR * 0.5, bodyR * 0.26);
    t.rotation.x = Math.PI / 2 + 0.7;
    t.position.set(0, bodyR * 0.05, -bodyR * 0.6);
    piv.add(t);
    if (s.tailTip) {
      const tip = mesh(sphereG(), M(s.tailTip), bodyR * 0.3);
      tip.position.set(0, bodyR * 0.45, -bodyR * 1.15);
      piv.add(tip);
    }
    if (s.tailFlame) flameCone(piv, bodyR * 0.26, bodyR * 0.85, 0, bodyR * 0.45, -bodyR * 1.1);
  } else if (kind === "thin") {
    const t = mesh(cylG(), M(c), bodyR * 0.08, bodyR * 1.5, bodyR * 0.08);
    t.rotation.x = Math.PI / 2 + 0.8;
    t.position.set(0, bodyR * 0.3, -bodyR * 0.8);
    piv.add(t);
    const tip = mesh(sphereG(), M(s.tailTip || c), bodyR * 0.14);
    tip.position.set(0, bodyR * 0.85, -bodyR * 1.4);
    piv.add(tip);
  } else if (kind === "bolt") {
    // Raichu: a long thin tail arcing up to a flat lightning-bolt tip.
    const stalk = mesh(cylG(), M(c), bodyR * 0.1, bodyR * 1.5, bodyR * 0.1);
    stalk.rotation.x = Math.PI / 2 + 1.05;
    stalk.position.set(0, bodyR * 0.55, -bodyR * 0.7);
    piv.add(stalk);
    const bolt = mesh(boltGeo(), M(s.tailTip || "#efd23f", { dbl: true }), bodyR * 0.85, bodyR * 0.95, bodyR * 0.12);
    bolt.position.set(0, bodyR * 1.45, -bodyR * 1.0);
    bolt.rotation.z = 0.2;
    piv.add(bolt);
  }
  parent.add(piv);
  return piv;
}
function shellBack(parent: THREE.Object3D, s: any, r: number, y: number, z = -r * 0.3) {
  const sh = mesh(sphereG(), M(s.shell), r, r * 0.8, r);
  sh.position.set(0, y, z);
  parent.add(sh);
  if (s.shellRim) {
    const rim = mesh(torusG(), M(s.shellRim), r * 0.9, r * 0.9, r * 0.9);
    rim.position.set(0, y, z);
    rim.rotation.x = Math.PI / 2 - 0.4;
    parent.add(rim);
  }
  return sh;
}
function backSpikes(parent: THREE.Object3D, c: string, n: number, size: number, bodyR: number, baseY: number) {
  const m = M(c);
  for (let i = 0; i < n; i++) {
    const k = n === 1 ? 0.5 : i / (n - 1);
    const sp = mesh(coneG(), m, size, size * 2.3, size);
    sp.position.set(0, baseY + bodyR * (0.55 - 0.25 * Math.abs(k - 0.5)), -bodyR * (0.1 + k * 0.7));
    sp.rotation.x = -0.7 - k * 0.7;
    parent.add(sp);
  }
}
function legSet(parent: THREE.Object3D, c: string, bodyR: number, legLen: number, stance: number, zF: number, zB: number) {
  const legs: THREE.Object3D[] = [];
  const m = M(c);
  for (const [sx, sz] of [[-1, zF], [1, zF], [-1, zB], [1, zB]] as [number, number][]) {
    const hip = pivot(sx * bodyR * stance, -bodyR * 0.4, sz);
    const leg = mesh(capsG(), m, bodyR * 0.15, legLen * 0.6, bodyR * 0.15);
    leg.position.y = -legLen * 0.42;
    hip.add(leg);
    parent.add(hip);
    legs.push(hip);
  }
  return legs;
}
function armPair(parent: THREE.Object3D, c: string, r: number, len: number, x: number, y: number, down = 0.9) {
  const arms: THREE.Object3D[] = [];
  const m = M(c);
  for (const side of [-1, 1]) {
    const sh = pivot(side * x, y, 0);
    const a = mesh(capsG(), m, r, len * 0.5, r);
    a.position.y = -len * 0.45;
    sh.add(a);
    sh.rotation.z = side * down;
    parent.add(sh);
    arms.push(sh);
  }
  return arms;
}
function leafBlade(c: string, len: number, w: number) {
  const l = mesh(sphereG(), M(c, { dbl: true }), w, len, w * 0.2);
  l.position.y = len * 0.75;
  return l;
}
// A low-poly scalloped membrane wing in the XY plane, root at origin,
// spreading toward +x (outward) and +y (up). Drives Charizard, Aerodactyl,
// Gyarados-kin, Dragonite, Golbat... a real wing silhouette, not a paddle.
// A tall, scalloped dragon/bat wing: leading edge sweeps up to a wrist, then
// three finger tips fan outward with webbed valleys between them. Plane is XY
// (normal ±z), root at origin, spreading toward +x and +y.
const WING_OUTLINE = [
  [0, 0], [0.30, 0.64], [1.04, 0.74], [0.76, 0.34],
  [0.88, 0.12], [0.55, 0.03], [0.63, -0.17], [0.30, -0.12], [0.05, -0.07],
];
function membraneWingGeo() {
  return G("wing", () => {
    const s = new THREE.Shape();
    s.moveTo(WING_OUTLINE[0][0], WING_OUTLINE[0][1]);
    for (let i = 1; i < WING_OUTLINE.length; i++) s.lineTo(WING_OUTLINE[i][0], WING_OUTLINE[i][1]);
    s.closePath();
    return new THREE.ShapeGeometry(s);
  });
}
function membraneWing(c: string, span: number, _scallops = 3, em?: number) {
  const opts: any = { dbl: true, flat: true };
  if (em != null) { opts.em = em; opts.emI = 0.25; }
  return mesh(membraneWingGeo(), M(c, opts), span, span, span);
}
// Flat lightning bolt (Raichu / Jolteon tail tips, Pikachu emblem).
function boltGeo() {
  return G("bolt", () => {
    const pts = [[0.35, 1.0], [-0.35, 0.12], [0.04, 0.12], [-0.4, -1.0], [0.32, -0.06], [-0.06, -0.06]];
    const s = new THREE.Shape();
    s.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
    s.closePath();
    return new THREE.ShapeGeometry(s);
  });
}
function clawSet(hand: THREE.Object3D, c: string, r: number, n = 3, reach = 1) {
  const m = M(c);
  for (let i = 0; i < n; i++) {
    const a = (i - (n - 1) / 2) * 0.5;
    const cl = mesh(coneG(), m, r * 0.42, r * 1.5 * reach, r * 0.42);
    cl.position.set(Math.sin(a) * r * 0.7, -r * 0.7, r * 0.6 + Math.cos(a) * r * 0.1);
    cl.rotation.x = 1.5;
    hand.add(cl);
  }
}
function fangRow(head: THREE.Object3D, c: string, r: number, y: number, z: number, dx: number, len = 1) {
  const m = M(c);
  for (const side of [-1, 1]) {
    const f = mesh(coneG(), m, r * 0.5, r * 1.2 * len, r * 0.5);
    f.position.set(side * dx, y, z);
    f.rotation.x = Math.PI;
    head.add(f);
  }
}

// ------------------------------------------------------- animation helpers
const blinkScale = (t: number, seed: number) => ((t + seed) % (3.2 + (seed % 2.8))) < 0.09 ? 0.15 : 1;

type Animator = (dt: number, ctx: RigCtx, t: number) => void;
interface Built { root: THREE.Group; animator?: Animator; levitate?: boolean; parts?: RigParts }

// ----------------------------------------------------- cast / attack poses
// Locomotion lives in each archetype's animator; this is the overlay that
// makes a rig actually ACT when it uses a move — rear back, swing, open up,
// thrust, stomp. Every builder hands back whatever articulated parts it has
// (body, head(s), arms, wings, legs, tail) and one shared pose function drives
// them, so all 151 Pokémon animate every attack without per-species poses.
// Models face +Z, so "forward" (toward the target the rig is turned to) is +Z:
// rotation.x > 0 pitches the front down/forward (thrust), < 0 rears it up/back.
export type CastCat = "strike" | "swipe" | "shoot" | "beam" | "stomp" | "focus";
export interface RigParts {
  body?: THREE.Object3D;          // primary trunk that leans/lunges
  head?: THREE.Object3D;          // head pivot (omit when the body IS the head)
  heads?: THREE.Object3D[];       // multi-headed / segmented / swarm rigs
  arms?: THREE.Object3D[];        // shoulders, claws, hands, tentacles, leaves
  wings?: THREE.Object3D[];
  legs?: THREE.Object3D[];
  tail?: THREE.Object3D | null;
}

const CAST_DUR: Record<CastCat, number> = {
  strike: 0.42, swipe: 0.42, shoot: 0.5, beam: 0.64, stomp: 0.58, focus: 0.66,
};

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

// a = anticipation (wind-up / pull-back), b = action (thrust / release / open)
function castEnv(cat: CastCat, u: number): { a: number; b: number } {
  u = clamp01(u);
  if (cat === "focus") return { a: Math.sin(u * Math.PI), b: 0 };       // tense & hold
  if (cat === "beam") {                                                 // rear, then sustain
    const ramp = u < 0.16 ? u / 0.16 : u > 0.82 ? Math.max(0, (1 - u) / 0.18) : 1;
    return { a: ramp * 0.5, b: ramp };
  }
  const wu = 0.34;                                                      // wind-up fraction
  const a = u < wu ? u / wu : Math.max(0, 1 - (u - wu) / (1 - wu));
  const tt = u < wu ? 0 : (u - wu) / (1 - wu);
  return { a, b: Math.sin(clamp01(tt) * Math.PI) };
}

function poseCast(parts: RigParts, cat: CastCat, u: number) {
  const { a, b } = castEnv(cat, u);
  const heads = parts.heads && parts.heads.length ? parts.heads : parts.head ? [parts.head] : [];
  const hasHead = heads.length > 0;
  // when the body doubles as the head, it carries the whole gesture
  if (parts.body) {
    const f = hasHead ? 1 : 1.8;   // headless rigs lean with the whole body
    let x: number;
    if (cat === "stomp") x = -a * 0.5 + b * 0.7;
    else if (cat === "beam") x = (-a * 0.08 - b * 0.16) * f;
    else if (cat === "focus") x = a * 0.16 * f;
    else x = (-a * 0.12 + b * 0.2) * f;
    parts.body.rotation.x = x;
  }
  for (const h of heads) {
    let x: number;
    if (cat === "beam") x = -a * 0.1 - b * 0.24;        // tilt up & open toward target
    else if (cat === "shoot") x = -a * 0.45 + b * 0.5;
    else if (cat === "focus") x = -a * 0.25;            // gaze up, gathering
    else if (cat === "stomp") x = -a * 0.5 + b * 0.8;
    else x = -a * 0.5 + b * 0.95;                       // strike / swipe headbutt
    h.rotation.x = x;
  }
  if (parts.arms) for (const arm of parts.arms) {
    if (cat === "swipe" || cat === "strike") arm.rotation.x = -a * 0.8 + b * 1.6;
    else if (cat === "stomp") arm.rotation.x = -a * 1.2 + b * 1.5;
    else if (cat === "focus") arm.rotation.x = a * 0.7;
    else arm.rotation.x = (a + b) * 0.55;               // shoot / beam: brace forward
  }
  if (parts.wings) for (let i = 0; i < parts.wings.length; i++) {
    const flare = 0.15 + (cat === "focus" ? a : a * 0.4 + b) * 0.95;
    parts.wings[i].rotation.z = (i % 2 ? -1 : 1) * flare;
  }
  if (parts.tail) parts.tail.rotation.y = b * (cat === "swipe" || cat === "strike" ? 1.2 : 0.4);
  if (parts.legs) for (const l of parts.legs) l.rotation.x = a * 0.28 - b * 0.15;
}

// ================================================================ archetypes
// Each builder returns a root normalized to height ≈ 1 with feet at y = 0.

function bQuad(s: any): Built {
  const root = new THREE.Group();
  const legLen = 0.24 * (s.legLen || 1);
  const bodyR = 0.27 * (s.fat || 1);
  const bodyY = legLen + bodyR * 0.72;
  const torso = pivot(0, bodyY, 0);
  root.add(torso);
  torso.add(mesh(sphereG(), M(s.body), bodyR * 1.04, bodyR * 0.9, bodyR * 1.5));
  if (s.belly) {
    const b = mesh(sphereG(), M(s.belly), bodyR * 0.78, bodyR * 0.6, bodyR * 1.16);
    b.position.y = -bodyR * 0.32;
    torso.add(b);
  }
  const headR = bodyR * (s.headR || 0.75);
  const neckLen = bodyR * (s.neck || 0);
  // the head must clear the front of the elongated body (depth 1.5 R)
  const head = pivot(0, bodyR * 0.55 + neckLen, bodyR * 1.35 + headR * 0.45 + neckLen * 0.35);
  if (neckLen > 0.01) {
    const n = mesh(capsG(), M(s.body), bodyR * 0.3, neckLen * 0.4, bodyR * 0.3);
    n.position.set(0, -neckLen * 0.45, -neckLen * 0.18);
    n.rotation.x = 0.5;
    head.add(n);
  }
  head.add(mesh(sphereG(), M(s.headC || s.body), headR));
  eyePair(head, s, headR * 0.27, headR * 0.3, headR * 0.76, headR * 0.48);
  if (s.snout !== false) snout(head, s.snoutC || s.belly || s.body, headR * 0.42, -headR * 0.16, headR * 0.78, headR * 0.5);
  if (s.teeth) for (const side of [-1, 1]) {            // Rattata/Raticate incisors
    const t = mesh(boxG(), M("#fbfbf4"), headR * 0.15, headR * 0.3, headR * 0.1);
    t.position.set(side * headR * 0.13, -headR * 0.46, headR * 0.95);
    head.add(t);
  }
  if (s.whiskers) for (const side of [-1, 1]) {
    const wk = mesh(cylG(), M(s.whiskerC || "#e6dcc8"), headR * 0.03, headR * 0.9, headR * 0.03);
    wk.position.set(side * headR * 0.4, -headR * 0.2, headR * 0.7);
    wk.rotation.z = side * 1.0; wk.rotation.y = side * 0.3;
    head.add(wk);
  }
  if (s.ears) earCone(head, s, headR * (s.earLen || 0.9), headR * 0.32, headR * 0.6, headR * 0.7, s.earTilt ?? 0.45);
  if (s.horn) hornCone(head, s.hornC || "#ece4d4", headR * 0.2, headR * (s.hornLen || 0.85), 0, headR * 0.6, headR * 0.35);
  if (s.mane === "flame") {
    const f1 = flameCone(head, headR * 0.45, headR * 1.5, 0, headR * 0.55, -headR * 0.25); f1.rotation.x = -0.75;
    const f2 = flameCone(torso, bodyR * 0.4, bodyR * 1.2, 0, bodyR * 0.62, -bodyR * 0.35); f2.rotation.x = -0.95;
  } else if (s.mane) {
    const m = mesh(sphereG(), M(s.maneC || "#f2e8d4"), headR * 1.02, headR * 0.92, headR * 0.78);
    m.position.set(0, -headR * 0.05, -headR * 0.5);
    head.add(m);
    if (s.ruff) {                                     // Arcanine's billowing chest ruff
      const r1 = mesh(sphereG(), M(s.maneC || "#f2e8d4"), bodyR * 0.95, bodyR * 0.85, bodyR * 0.7);
      r1.position.set(0, bodyR * 0.5, bodyR * 1.15);
      torso.add(r1);
    }
  }
  torso.add(head);
  const legs = legSet(torso, s.legC || s.body, bodyR, legLen, 0.55, bodyR * 0.8, -bodyR * 0.8);
  const tail = tailPart(torso, s, bodyR, -bodyR * 0.05, -bodyR * 1.3);
  if (s.stripes2) for (let i = 0; i < s.stripes2; i++) {   // Arcanine's dark bands over the back
    const band = mesh(boxG(), M(s.stripeC || "#3a2a22"), bodyR * 2.0, bodyR * 0.12, bodyR * 0.22);
    band.position.set(0, bodyR * 0.78, bodyR * (0.7 - i * 0.55));
    band.rotation.x = 0.1;
    torso.add(band);
  }
  if (s.spikes) backSpikes(torso, s.spikeC || "#ece4d4", s.spikes, bodyR * 0.16, bodyR, bodyR * 0.1);
  if (s.shell) shellBack(torso, s, bodyR * 0.95, bodyR * 0.3);
  if (s.bulb) {
    const bR = bodyR * (s.bulbR || 0.66);
    const bZ = -bodyR * 0.24;
    const bY = bodyR * 0.6 + bR * 0.42;
    const b = mesh(sphereG(), M(s.bulb, { flat: false }), bR, bR * 1.06, bR);
    b.position.set(0, bY, bZ);
    torso.add(b);
    if (s.bulbSpots) for (let i = 0; i < 5; i++) {     // Bulbasaur's darker dappling
      const a = (i / 5) * Math.PI * 2 + 0.4;
      const sp = mesh(sphereG(), M(s.bulbSpots), bR * 0.22, bR * 0.1, bR * 0.22);
      sp.position.set(bZ * 0 + Math.cos(a) * bR * 0.7, bY + bR * 0.6, bZ + Math.sin(a) * bR * 0.55);
      torso.add(sp);
    }
    if (s.bulbLeaves) for (let i = 0; i < s.bulbLeaves; i++) {
      const a = (i / s.bulbLeaves) * Math.PI * 2;
      const l = leafBlade(s.leafC || "#3f9e54", bR * 1.15, bR * 0.46);
      l.position.set(Math.cos(a) * bR * 0.5, bY + bR * 0.5, bZ + Math.sin(a) * bR * 0.5);
      l.rotation.z = Math.cos(a) * 0.95; l.rotation.x = Math.sin(a) * 0.95;
      torso.add(l);
    }
    if (s.flower) {
      // Venusaur's bloom — raised and tipped up-and-forward so it reads head-on.
      const fl = pivot(0, bY + bR * 0.62, bZ + bodyR * 0.1);
      fl.rotation.x = -0.36;
      fl.add(mesh(sphereG(), M("#f6cf3d", { flat: false }), bodyR * 0.4));
      const pm = M(s.flowerC || "#e85a78", { dbl: true });
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const petal = mesh(sphereG(), pm, bodyR * 0.42, bodyR * 0.14, bodyR * 0.6);
        petal.position.set(Math.cos(a) * bodyR * 0.62, bodyR * 0.06, Math.sin(a) * bodyR * 0.62);
        petal.rotation.y = -a;
        petal.rotation.x = 0.5;
        fl.add(petal);
      }
      torso.add(fl);
    }
  }
  if (s.gem) {
    const g = mesh(sphereG(), M(s.gem, { em: s.gem, emI: 0.35, flat: false }), headR * 0.22);
    g.position.set(0, headR * 0.65, headR * 0.45);
    head.add(g);
  }
  const H = bodyY + bodyR * 0.55 + headR * 1.5 + neckLen;
  root.scale.setScalar(1 / H);
  const seed = Math.random() * 9;
  return {
    root,
    parts: { body: torso, head, legs, tail },
    animator: (dt, ctx, t) => {
      const ph = t * (3.6 + Math.min(ctx.speed, 8) * 2.0);
      const amp = Math.min(0.6, ctx.speed * 0.3);
      legs.forEach((l, i) => (l.rotation.x = Math.sin(ph + (i === 0 || i === 3 ? 0 : Math.PI)) * amp));
      torso.position.y = bodyY + Math.abs(Math.sin(ph)) * amp * 0.045 + Math.sin(t * 2.1 + seed) * 0.008;
      if (tail) { tail.rotation.y = Math.sin(t * 3 + seed) * 0.35; tail.rotation.x = Math.sin(t * 1.6) * 0.12; }
      head.rotation.x = Math.sin(t * 1.2 + seed) * 0.05;
      head.rotation.y = Math.sin(t * 0.7 + seed) * 0.08;
    },
  };
}

function bBiped(s: any): Built {
  const root = new THREE.Group();
  const legLen = 0.2 * (s.legLen || 1);
  const bodyR = 0.24 * (s.fat || 1);
  const bodyY = legLen + bodyR * 0.85;
  const torso = pivot(0, bodyY, 0);
  root.add(torso);
  torso.add(mesh(sphereG(), M(s.body), bodyR, bodyR * 1.12, bodyR * 0.9));
  if (s.belly) {
    const b = mesh(sphereG(), M(s.belly), bodyR * 0.78, bodyR * 0.9, bodyR * 0.66);
    b.position.set(0, -bodyR * 0.08, bodyR * 0.28);
    torso.add(b);
  }
  const headR = bodyR * (s.headR || 0.82);
  const neckLen = bodyR * (s.neck || 0);
  const head = pivot(0, bodyR * 1.05 + headR * 0.55 + neckLen, bodyR * 0.05 + neckLen * 0.1);
  if (neckLen > 0.01) {
    const nk = mesh(capsG(), M(s.neckC || s.body), bodyR * 0.32, neckLen * 0.5, bodyR * 0.32);
    nk.position.set(0, bodyR * 1.0 + neckLen * 0.45, bodyR * 0.05 + neckLen * 0.05);
    torso.add(nk);
  }
  head.add(mesh(sphereG(), M(s.headC || s.body), headR));
  eyePair(head, s, headR * 0.26, headR * 0.22, headR * 0.76, headR * 0.45);
  if (s.snout) snout(head, s.snoutC || s.body, headR * 0.4, -headR * 0.2, headR * 0.8, headR * (s.snoutLen || 0.45));
  if (s.beak) beak(head, s.beakC || "#e8b84a", headR * 0.34, -headR * 0.1, headR * 0.7, headR * 0.8);
  if (s.ears) earCone(head, s, headR * (s.earLen || 1), headR * 0.3, headR * 0.58, headR * 0.68, s.earTilt ?? 0.5);
  if (s.horn) hornCone(head, s.hornC || "#ece4d4", headR * (s.hornR || 0.18), headR * (s.hornLen || 0.7), 0, headR * 0.72, headR * 0.2);
  if (s.hornBack) for (const side of [-1, 1]) {
    const h = mesh(coneG(), M(s.hornC || "#efe6d4"), headR * 0.15, headR * (s.hornLen || 0.95), headR * 0.15);
    h.position.set(side * headR * 0.36, headR * 0.66, -headR * 0.42);
    h.rotation.x = 0.95; h.rotation.z = side * 0.22;
    head.add(h);
  }
  if (s.fangs) fangRow(head, "#fbfbf4", headR * 0.5, -headR * 0.46, headR * 0.74, headR * 0.3, s.fangLen || 1);
  if (s.headFlame) flameCone(head, headR * 0.4, headR * 1.1, 0, headR * 0.75, 0);
  if (s.hair) {
    const h = mesh(sphereG(), M(s.hair), headR * 0.95, headR * 0.6, headR * 0.95);
    h.position.y = headR * 0.55;
    head.add(h);
  }
  if (s.cheeks) for (const side of [-1, 1]) {
    const c = mesh(sphereG(), M(s.cheeks, { flat: false }), headR * 0.2, headR * 0.2, headR * 0.08);
    c.position.set(side * headR * 0.62, -headR * 0.12, headR * 0.72);
    head.add(c);
  }
  if (s.curl) {                                   // Clefairy/Clefable forehead curl
    const cu = mesh(sphereG(), M(s.headC || s.body), headR * 0.17, headR * 0.36, headR * 0.16);
    cu.position.set(0, headR * 0.96, headR * 0.42);
    cu.rotation.x = -0.7;
    head.add(cu);
  }
  if (s.coin) {
    const c = mesh(cylG(), M("#f6cf3d", { em: 0xaa8800, emI: 0.25 }), headR * 0.24, headR * 0.07, headR * 0.24);
    c.position.y = headR * 0.95;
    head.add(c);
  }
  if (s.skull) {
    const sk = mesh(sphereG(), M("#f2ead8"), headR * 1.06, headR * 0.95, headR * 1.02);
    sk.position.set(0, headR * 0.12, -headR * 0.06);
    head.add(sk);
  }
  if (s.antennae) for (const side of [-1, 1]) {
    const a = mesh(cylG(), M(s.body), headR * 0.06, headR * 0.6, headR * 0.06);
    a.position.set(side * headR * 0.3, headR * 0.95, 0);
    a.rotation.z = -side * 0.4;
    head.add(a);
  }
  if (s.tongue) {
    const tg = mesh(sphereG(), M("#e87898", { flat: false }), headR * 0.24, headR * 0.14, headR * 0.7);
    tg.position.set(0, -headR * 0.35, headR * 0.95);
    head.add(tg);
  }
  if (s.dress) {
    const d = mesh(coneG(), M(s.dress), bodyR * 1.25, bodyR * 1.7, bodyR * 1.25);
    d.position.y = -bodyR * 0.35;
    torso.add(d);
  }
  torso.add(head);
  // legs
  const legs: THREE.Object3D[] = [];
  const lm = M(s.legC || s.body);
  for (const side of [-1, 1]) {
    const hip = pivot(side * bodyR * 0.45, -bodyR * 0.8, 0);
    const leg = mesh(capsG(), lm, bodyR * (s.legR || 0.17), legLen * 0.62, bodyR * (s.legR || 0.17));
    leg.position.y = -legLen * 0.4;
    hip.add(leg);
    const foot = mesh(sphereG(), M(s.footC || s.legC || s.body), bodyR * 0.22, bodyR * 0.13, bodyR * 0.34);
    foot.position.set(0, -legLen * 0.82, bodyR * 0.12);
    hip.add(foot);
    torso.add(hip);
    legs.push(hip);
  }
  // arms
  const armN = s.arms4 ? 2 : 1;
  const arms: THREE.Object3D[] = [];
  for (let row = 0; row < armN; row++) {
    const pair = armPair(torso, s.armC || s.body, bodyR * (s.armR || 0.13), bodyR * (s.armLen || 0.95),
      bodyR * 0.88, bodyR * (0.42 - row * 0.45), s.armDown ?? 0.85);
    arms.push(...pair);
  }
  if (s.scythes) for (const a of arms) {
    const sc = mesh(sphereG(), M(s.scytheC || "#e8e4da"), bodyR * 0.12, bodyR * 0.95, bodyR * 0.3);
    sc.position.set(0, -bodyR * 1.3, bodyR * 0.2);
    sc.rotation.x = 0.9;
    a.add(sc);
  }
  if (s.gloves) for (const a of arms) {
    const g = mesh(sphereG(), M(s.gloves), bodyR * 0.26);
    g.position.y = -bodyR * 1.0;
    a.add(g);
  }
  if (s.pads) for (const a of arms) {
    const g = mesh(sphereG(), M(s.padsC || "#f8f8f8"), bodyR * 0.22);
    g.position.y = -bodyR * 1.0;
    a.add(g);
  }
  if (s.claws) for (const a of arms) {
    const hand = pivot(0, -bodyR * (s.armLen || 0.95) * 0.92, 0);
    clawSet(hand, s.clawC || "#f2ecdc", bodyR * 0.34, s.clawN || 3, s.clawLen || 1);
    a.add(hand);
  }
  if (s.spoons) for (const a of arms) {
    const handY = -bodyR * (s.armLen || 0.95) * 0.92;
    const handle = mesh(cylG(), M("#e2e6ec", { flat: false }), bodyR * 0.05, bodyR * 0.9, bodyR * 0.05);
    handle.position.y = handY - bodyR * 0.45;
    const bowl = mesh(sphereG(), M("#e2e6ec", { flat: false }), bodyR * 0.16, bodyR * 0.1, bodyR * 0.22);
    bowl.position.set(0, handY - bodyR * 0.95, 0);
    a.add(handle, bowl);
  }
  if (s.bone && arms.length) {
    const grp = pivot(0, -bodyR * (s.armLen || 0.95) * 0.95, bodyR * 0.25);
    grp.rotation.x = 0.6;
    grp.add(mesh(cylG(), M(s.boneC || "#efe7d2"), bodyR * 0.08, bodyR * 0.95, bodyR * 0.08));
    for (const e of [-1, 1]) {
      for (const o of [-1, 1]) {
        const k = mesh(sphereG(), M(s.boneC || "#efe7d2"), bodyR * 0.13);
        k.position.set(o * bodyR * 0.13, e * bodyR * 0.48, 0);
        grp.add(k);
      }
    }
    arms[0].add(grp);
  }
  // wings
  const wings: THREE.Object3D[] = [];
  if (s.wings) {
    for (const side of [-1, 1]) {
      const w = pivot(side * bodyR * 0.5, bodyR * 0.6, -bodyR * 0.48);
      const span = bodyR * (s.wingSpan || 1.5);
      if (s.wings === "insect") {
        const wing = mesh(sphereG(), M(s.wingC || "#e8f0ff", { op: 0.5, dbl: true, flat: false }), span, span * 0.4, bodyR * 0.04);
        wing.position.x = side * span * 0.85;
        wing.rotation.z = side * 0.18;
        w.add(wing);
      } else if (s.wings === "round") {
        // small vestigial leathery wings — Clefable, Dragonite
        const wing = mesh(sphereG(), M(s.wingC || "#f0e0e8", { dbl: true }), span, span * 0.72, bodyR * 0.06);
        wing.position.x = side * span * 0.78;
        wing.rotation.z = side * 0.28;
        w.add(wing);
      } else {
        const wing = membraneWing(s.wingC || "#7ab8d8", span, s.wingScallops || 3);
        wing.scale.x *= side;
        w.add(wing);
        w.rotation.y = side * (s.wingRake ?? 0.45);   // splay outward + face front
      }
      torso.add(w);
      wings.push(w);
    }
  }
  const tail = tailPart(torso, s, bodyR * 1.15, -bodyR * 0.35);
  if (s.shell) {
    shellBack(torso, s, bodyR * 0.92, bodyR * 0.05, -bodyR * 0.55);
    if (s.cannons) for (const side of [-1, 1]) {
      // Blastoise's signature: chunky water cannons emerging from the shell
      // over each shoulder, barrels jutting up-and-FORWARD so they read head-on.
      const grp = pivot(side * bodyR * 0.5, bodyR * 0.46, -bodyR * 0.38);
      grp.rotation.x = 0.74;          // mostly up, leaning forward
      grp.rotation.z = side * 0.22;   // splay outward
      const barrel = mesh(cylG(), M(s.cannonC || "#8a96a4"), bodyR * 0.27, bodyR * 1.5, bodyR * 0.27);
      barrel.position.y = bodyR * 0.66;
      grp.add(barrel);
      const collar = mesh(cylG(), M("#6a7480"), bodyR * 0.32, bodyR * 0.2, bodyR * 0.32);
      collar.position.y = bodyR * 0.24;
      grp.add(collar);
      const muzzle = mesh(cylG(), M("#3a424c"), bodyR * 0.3, bodyR * 0.34, bodyR * 0.3);
      muzzle.position.y = bodyR * 1.4;
      grp.add(muzzle);
      torso.add(grp);
    }
  }
  if (s.spikes) backSpikes(torso, s.spikeC || s.body, s.spikes, bodyR * (s.spikeSize || 0.14), bodyR, bodyR * 0.3);
  if (s.pouch) {
    const p = mesh(sphereG(), M(s.pouchC || s.belly || s.body), bodyR * 0.55, bodyR * 0.5, bodyR * 0.4);
    p.position.set(0, -bodyR * 0.25, bodyR * 0.42);
    torso.add(p);
    if (s.egg) {
      const e = mesh(sphereG(), M("#fdfdf2", { flat: false }), bodyR * 0.3, bodyR * 0.38, bodyR * 0.3);
      e.position.set(0, -bodyR * 0.12, bodyR * 0.62);
      torso.add(e);
    }
  }
  if (s.pinsirHorns) for (const side of [-1, 1]) {
    const h = mesh(coneG(), M("#ece4d4"), headR * 0.22, headR * 1.2, headR * 0.22);
    h.position.set(side * headR * 0.4, headR * 1.1, headR * 0.15);
    h.rotation.z = -side * 0.55;
    head.add(h);
  }
  if (s.leek) {
    const lk = mesh(cylG(), M("#cfe8b0"), bodyR * 0.07, bodyR * 1.5, bodyR * 0.07);
    lk.position.set(bodyR * 0.95, -bodyR * 0.2, bodyR * 0.3);
    lk.rotation.z = 0.5;
    torso.add(lk);
  }
  const H = bodyY + bodyR * 1.05 + headR * 1.6 + neckLen + (s.horn ? headR * 0.4 : 0);
  root.scale.setScalar(1 / H);
  const seed = Math.random() * 9;
  return {
    root,
    parts: { body: torso, head, arms, wings, legs, tail },
    animator: (dt, ctx, t) => {
      const ph = t * (4 + Math.min(ctx.speed, 8) * 2.2);
      const amp = Math.min(0.7, ctx.speed * 0.34);
      legs.forEach((l, i) => (l.rotation.x = Math.sin(ph + (i ? Math.PI : 0)) * amp));
      arms.forEach((a, i) => {
        a.rotation.x = Math.sin(ph + (i % 2 ? 0 : Math.PI)) * amp * 0.7;
        a.rotation.z = (i % 2 ? 1 : -1) * (s.armDown ?? 0.85) + Math.sin(t * 1.9 + i) * 0.06;
      });
      wings.forEach((w, i) => {
        const flap = ctx.speed > 0.4 ? Math.sin(t * 16) * 0.5 : Math.sin(t * 2.2) * 0.12;
        w.rotation.z = (i ? -1 : 1) * flap;
      });
      torso.position.y = bodyY + Math.abs(Math.sin(ph)) * amp * 0.05 + Math.sin(t * 2.2 + seed) * 0.008;
      if (tail) tail.rotation.y = Math.sin(t * 2.7 + seed) * 0.3;
      head.rotation.y = Math.sin(t * 0.8 + seed) * 0.09;
    },
  };
}

function bBird(s: any): Built {
  const root = new THREE.Group();
  const legLen = 0.16 * (s.legLen || 1);
  const bodyR = 0.24 * (s.fat || 1);
  const bodyY = legLen + bodyR * 0.8;
  const torso = pivot(0, bodyY, 0);
  root.add(torso);
  torso.add(mesh(sphereG(), M(s.body), bodyR * 0.95, bodyR, bodyR * 1.2));
  if (s.belly) {
    const b = mesh(sphereG(), M(s.belly), bodyR * 0.72, bodyR * 0.8, bodyR * 0.9);
    b.position.set(0, -bodyR * 0.12, bodyR * 0.22);
    torso.add(b);
  }
  const heads: THREE.Object3D[] = [];
  const headN = s.heads || 1;
  const headR = bodyR * (s.headR || 0.62);
  const neckLen = bodyR * (s.neck || 0.45);
  for (let i = 0; i < headN; i++) {
    const off = headN === 1 ? 0 : (i / (headN - 1) - 0.5) * bodyR * 1.0;
    const neckP = pivot(off, bodyR * 0.55, bodyR * 0.3);
    if (neckLen > bodyR * 0.3) {
      const n = mesh(cylG(), M(s.body), bodyR * 0.14, neckLen, bodyR * 0.14);
      n.position.y = neckLen / 2;
      neckP.add(n);
    }
    const h = pivot(0, neckLen, bodyR * 0.12);
    h.add(mesh(sphereG(), M(s.headC || s.body), headR));
    eyePair(h, s, headR * 0.26, headR * 0.2, headR * 0.7, headR * 0.45);
    beak(h, s.beakC || "#e8b84a", headR * 0.3, -headR * 0.05, headR * 0.75, headR * (s.beakLen || 0.8));
    if (s.crest) {
      // a swept-back plume: each feather longer and angled further back,
      // so Pidgey's tuft grows into Pidgeot's flowing crest.
      const cm = M(s.crestC || "#e85a4a", { dbl: true });
      const cn = s.crestN || 1;
      for (let c = 0; c < cn; c++) {
        const fan = cn > 1 ? (c / (cn - 1) - 0.5) : 0;       // spread side to side
        const len = headR * (0.62 + c * 0.34) * (s.crestLen || 1);
        const cr = mesh(sphereG(), cm, headR * 0.13, len, headR * 0.34);
        cr.position.set(fan * headR * 0.42, headR * (0.7 + c * 0.12), -headR * (0.1 + c * 0.18));
        cr.rotation.x = -0.7 - c * 0.32;
        cr.rotation.z = fan * 0.5;
        h.add(cr);
      }
    }
    if (s.comb) {                                            // Fearow's red nape crest + brow
      const cm2 = M(s.combC || "#d83a3a", { dbl: true });
      const brow = mesh(coneG(), cm2, headR * 0.16, headR * 1.0, headR * 0.16);
      brow.position.set(0, headR * 0.62, headR * 0.5);
      brow.rotation.x = 0.5;
      h.add(brow);
      const nape = mesh(coneG(), cm2, headR * 0.16, headR * 0.85, headR * 0.16);
      nape.position.set(0, headR * 0.5, -headR * 0.45);
      nape.rotation.x = -0.7;
      h.add(nape);
    }
    neckP.add(h);
    torso.add(neckP);
    heads.push(neckP);
  }
  // wings
  const wings: THREE.Object3D[] = [];
  if (s.wings !== false) {
    for (const side of [-1, 1]) {
      const w = pivot(side * bodyR * 0.6, bodyR * 0.25, 0);
      const span = bodyR * (s.wingSpan || 1.35);
      if (s.wingFlame) {
        const f = flameCone(w, span * 0.4, span * 1.3, side * span * 0.6, 0, -span * 0.1);
        f.rotation.z = side * 1.8;
      } else {
        const wing = mesh(sphereG(), M(s.wingC || s.body, { dbl: true }), span, span * 0.42, bodyR * 0.55);
        wing.position.x = side * span * 0.8;
        wing.rotation.y = side * 0.25;
        w.add(wing);
      }
      torso.add(w);
      wings.push(w);
    }
  }
  // tail feathers — a fanned spray; longer/wider species get a fuller plume
  if (s.tailFeathers !== false) {
    const tm = M(s.tailC || s.body, { dbl: true });
    const tn = s.tailN || 1;
    const tlen = s.tailLen || 0.9;
    for (let i = -tn; i <= tn; i++) {
      const f = tn > 0 ? i / tn : 0;
      const tf = mesh(sphereG(), tm, bodyR * 0.15, bodyR * 0.1, bodyR * tlen * (1 - Math.abs(f) * 0.18));
      tf.position.set(f * bodyR * 0.5, bodyR * 0.1, -bodyR * 1.0);
      tf.rotation.y = f * 0.55;
      tf.rotation.x = 0.35;
      torso.add(tf);
    }
  }
  const legs = legSet(torso, s.legC || "#e8b84a", bodyR, legLen, 0.32, bodyR * 0.15, bodyR * 0.12).slice(0, 2);
  const H = bodyY + bodyR * 0.55 + neckLen + headR * 1.6;
  root.scale.setScalar(1 / H);
  const seed = Math.random() * 9;
  return {
    root,
    parts: { body: torso, heads, wings, legs },
    animator: (dt, ctx, t) => {
      const ph = t * (5 + Math.min(ctx.speed, 8) * 2.4);
      const amp = Math.min(0.7, ctx.speed * 0.4);
      legs.forEach((l, i) => (l.rotation.x = Math.sin(ph + (i ? Math.PI : 0)) * amp));
      wings.forEach((w, i) => {
        const flap = ctx.speed > 0.4 ? Math.sin(t * 14) * 0.7 : Math.sin(t * 2 + seed) * 0.08;
        w.rotation.z = (i ? -1 : 1) * flap * 0.6;
      });
      heads.forEach((h, i) => {
        h.rotation.x = Math.sin(t * (1.4 + i * 0.6) + seed + i * 2) * 0.1 + (ctx.speed > 0.3 ? Math.sin(ph) * 0.08 : 0);
        h.rotation.y = Math.sin(t * 0.9 + i * 2.6) * 0.14;
      });
      torso.position.y = bodyY + Math.abs(Math.sin(ph)) * amp * 0.04 + Math.sin(t * 2.4) * 0.007;
    },
  };
}

function bSerpent(s: any): Built {
  const root = new THREE.Group();
  const n = s.segs || 6;
  const r0 = 0.16 * (s.fat || 1);
  const segs: THREE.Object3D[] = [];
  const lift = s.lift ?? 0.55; // how upright the front body is
  const bm = s.rock ? null : M(s.body);
  // segment 0 (the head end) rears up at the front; the body arcs down and
  // back until the tail rests on the ground
  const rear = Math.min(2.4, Math.max(0.9, lift * n * 0.42)) * r0;
  const topY = r0 * 0.9 + rear;
  let z = 0;
  for (let i = 0; i < n; i++) {
    const k = n === 1 ? 1 : i / (n - 1);
    const r = r0 * (1 - k * 0.45);
    const y = Math.max(r * 0.85, r * 0.85 + rear * Math.pow(1 - k, 1.6));
    const seg = pivot(0, y, z);
    const ball = s.rock
      ? mesh(dodecaG(), M(s.body), r * 1.15)
      : mesh(sphereG(), bm!, r, r, r * 1.25);
    seg.add(ball);
    if (s.belly && !s.rock && i < n - 1) {
      const b = mesh(sphereG(), M(s.belly), r * 0.8, r * 0.62, r);
      b.position.set(0, -r * 0.25, r * 0.32);
      seg.add(b);
    }
    root.add(seg);
    segs.push(seg);
    z -= r * 1.7;
  }
  // head on the first (highest) segment
  const headR = r0 * (s.headR || 1.15);
  const head = pivot(0, headR * 0.8, r0 * 0.4);
  head.add(mesh(sphereG(), M(s.headC || s.body), headR));
  eyePair(head, s, headR * 0.26, headR * 0.25, headR * 0.72, headR * 0.45);
  if (s.snout) snout(head, s.snoutC || s.body, headR * 0.4, -headR * 0.1, headR * 0.78, headR * 0.5);
  if (s.hood) {
    const hd = mesh(sphereG(), M(s.hoodC || s.body), headR * 1.45, headR * 1.25, headR * 0.28);
    hd.position.set(0, headR * 0.15, -headR * 0.85);
    head.add(hd);
  }
  if (s.horn) hornCone(head, s.hornC || "#ece4d4", headR * 0.18, headR * 0.8, 0, headR * 0.75, 0);
  if (s.fangs) fangRow(head, "#fbfbf4", headR * 0.45, -headR * 0.34, headR * 0.72, headR * 0.3, s.fangLen || 1.1);
  if (s.earFins) earCone(head, { ...s, earC: s.finC || s.body }, headR * 0.6, headR * 0.25, headR * 0.6, headR * 0.4, 1.1);
  if (s.barbels) for (const side of [-1, 1]) {
    const b = mesh(cylG(), M(s.barbelC || "#f0e8d8"), headR * 0.06, headR * 1.1, headR * 0.06);
    b.position.set(side * headR * 0.55, -headR * 0.35, headR * 0.3);
    b.rotation.z = side * 0.5;
    head.add(b);
  }
  if (s.backFins) for (let i = 1; i < n; i += 2) {
    const f = mesh(sphereG(), M(s.finC || s.belly || s.body, { dbl: true }), r0 * 0.12, r0 * 0.6, r0 * 0.3);
    f.position.y = r0 * 0.8;
    segs[i].add(f);
  }
  segs[0].add(head);
  if (s.orbs) {                                  // Dragonair's serene blue orbs
    const om = M(s.orbC || "#7ab8f0", { em: s.orbC || "#5a98d8", emI: 0.3, flat: false });
    const neckOrb = mesh(sphereG(), om, headR * 0.4);
    neckOrb.position.set(0, -headR * 0.12, -headR * 0.5);
    head.add(neckOrb);
    const last = segs[segs.length - 1];
    const to = mesh(sphereG(), om, r0 * 0.42);
    to.position.set(0, r0 * 0.55, -r0 * 0.3);
    last.add(to);
  }
  const totalH = topY + headR * 2;
  root.scale.setScalar(1 / Math.max(totalH, 0.8));
  const seed = Math.random() * 9;
  const baseX = segs.map((s2) => s2.position.x);
  return {
    root,
    parts: { body: segs[0], head },
    animator: (dt, ctx, t) => {
      const sp = 2.2 + Math.min(ctx.speed, 6) * 1.6;
      segs.forEach((seg, i) => {
        seg.position.x = baseX[i] + Math.sin(t * sp + i * 0.85 + seed) * r0 * 0.5 * (i / n + 0.25);
        seg.rotation.y = Math.cos(t * sp + i * 0.85) * 0.18;
      });
      head.rotation.y = Math.sin(t * 1.4 + seed) * 0.16;
      head.rotation.x = Math.sin(t * 1.1) * 0.08;
    },
  };
}

function bFish(s: any): Built {
  const root = new THREE.Group();
  const bodyR = 0.3 * (s.fat || 1);
  const torso = pivot(0, bodyR * 0.95, 0);
  root.add(torso);
  torso.add(mesh(sphereG(), M(s.body), bodyR * 0.62, bodyR * 0.95, bodyR * 1.15));
  if (s.belly) {
    const b = mesh(sphereG(), M(s.belly), bodyR * 0.5, bodyR * 0.7, bodyR * 0.9);
    b.position.set(0, -bodyR * 0.18, bodyR * 0.06);
    torso.add(b);
  }
  eyePair(torso, s, bodyR * 0.16, bodyR * 0.28, bodyR * 0.9, bodyR * 0.4);
  // tail fin
  const tail = pivot(0, 0, -bodyR * 1.05);
  const tf = mesh(sphereG(), M(s.finC || s.body, { dbl: true }), bodyR * 0.1, bodyR * 0.62, bodyR * 0.5);
  tf.position.z = -bodyR * 0.4;
  tail.add(tf);
  torso.add(tail);
  // crown/back + side fins
  const fm = M(s.finC || "#f0e8e0", { dbl: true });
  const top = mesh(sphereG(), fm, bodyR * 0.1, bodyR * 0.55, bodyR * 0.45);
  top.position.set(0, bodyR * 0.95, 0);
  torso.add(top);
  const sides: THREE.Object3D[] = [];
  for (const side of [-1, 1]) {
    const p = pivot(side * bodyR * 0.55, -bodyR * 0.1, bodyR * 0.3);
    const f = mesh(sphereG(), fm, bodyR * 0.4, bodyR * 0.1, bodyR * 0.3);
    f.position.x = side * bodyR * 0.3;
    p.add(f);
    torso.add(p);
    sides.push(p);
  }
  if (s.horn) hornCone(torso, "#f2ead8", bodyR * 0.12, bodyR * 0.6, 0, bodyR * 0.45, bodyR * 0.85, 0.9);
  if (s.whiskers) for (const side of [-1, 1]) {
    const w = mesh(cylG(), M("#f6e8c8"), bodyR * 0.04, bodyR * 0.7, bodyR * 0.04);
    w.position.set(side * bodyR * 0.3, -bodyR * 0.3, bodyR * 0.85);
    w.rotation.z = side * 1.0;
    torso.add(w);
  }
  root.scale.setScalar(1 / (bodyR * 2.1));
  const seed = Math.random() * 9;
  return {
    root,
    parts: { body: torso, tail },
    animator: (dt, ctx, t) => {
      if (ctx.water) {
        tail.rotation.y = Math.sin(t * 7 + seed) * 0.6;
        sides.forEach((p, i) => (p.rotation.z = Math.sin(t * 4 + i * 2) * 0.3));
        torso.rotation.z = Math.sin(t * 2.2) * 0.06;
        torso.rotation.x = 0;
        torso.position.y = bodyR * 0.95 + Math.sin(t * 1.7) * 0.04;
      } else {
        // a fish out of water flops, of course
        torso.rotation.z = Math.sin(t * 9 + seed) * 0.55;
        torso.position.y = bodyR * 0.95 + Math.abs(Math.sin(t * 9 + seed)) * 0.12;
        tail.rotation.y = Math.sin(t * 11) * 0.7;
      }
    },
  };
}

function bBlob(s: any): Built {
  const root = new THREE.Group();
  const r = 0.42 * (s.fat || 1);
  const body = pivot(0, r * 0.92, 0);
  root.add(body);
  body.add(mesh(sphereG(), M(s.body), r, r * (s.squat || 0.95), r));
  if (s.belly) {
    const b = mesh(sphereG(), M(s.belly), r * 0.78, r * 0.7, r * 0.62);
    b.position.set(0, -r * 0.12, r * 0.4);
    body.add(b);
  }
  eyePair(body, s, r * (s.eyeR || 0.16), r * 0.3, r * 0.82, r * 0.38);
  if (s.ears) earCone(body, s, r * (s.earLen || 0.6), r * 0.22, r * 0.5, r * 0.78, s.earTilt ?? 0.55);
  if (s.drip) { // ooze drips for Grimer/Muk
    const dm = M(s.body);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.4;
      const d = mesh(sphereG(), dm, r * 0.22, r * 0.34, r * 0.22);
      d.position.set(Math.cos(a) * r * 0.8, -r * 0.6, Math.sin(a) * r * 0.8);
      body.add(d);
    }
  }
  if (s.fuzz) {
    const fm = M(s.fuzzC || s.body);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const f = mesh(coneG(), fm, r * 0.1, r * 0.3, r * 0.1);
      f.position.set(Math.cos(a) * r * 0.92, Math.sin(a * 2) * r * 0.3, Math.sin(a) * r * 0.92 - 0.1);
      f.rotation.z = -a - Math.PI / 2;
      body.add(f);
    }
  }
  const arms = s.armsOff ? [] : armPair(body, s.armC || s.body, r * 0.1, r * 0.55, r * 0.85, r * 0.05, 1.0);
  let legs: THREE.Object3D[] = [];
  if (!s.legsOff) {
    const lm = M(s.legC || s.body);
    for (const side of [-1, 1]) {
      const hip = pivot(side * r * 0.4, -r * 0.85, 0);
      const foot = mesh(sphereG(), lm, r * 0.24, r * 0.14, r * 0.36);
      hip.add(foot);
      body.add(hip);
      legs.push(hip);
    }
  }
  if (s.egg) {
    const e = mesh(sphereG(), M("#fdfdf2", { flat: false }), r * 0.26, r * 0.34, r * 0.26);
    e.position.set(0, -r * 0.2, r * 0.62);
    body.add(e);
  }
  if (s.curl) {
    const c = mesh(sphereG(), M(s.curlC || s.body), r * 0.16, r * 0.3, r * 0.16);
    c.position.set(0, r * 0.95, r * 0.25);
    c.rotation.x = 0.8;
    body.add(c);
  }
  root.scale.setScalar(1 / (r * 2));
  const seed = Math.random() * 9;
  return {
    root,
    parts: { body, arms, legs },
    animator: (dt, ctx, t) => {
      // squash & stretch — blobs hop to move
      const hop = ctx.speed > 0.3 ? Math.abs(Math.sin(t * 7 + seed)) : 0;
      const sq = ctx.speed > 0.3 ? Math.sin(t * 7 + seed) * 0.12 : Math.sin(t * 2.1 + seed) * 0.04;
      body.scale.set(1 - sq * 0.5, 1 + sq, 1 - sq * 0.5);
      body.position.y = r * 0.92 + hop * 0.12;
      arms.forEach((a, i) => (a.rotation.z = (i ? 1 : -1) * 1.0 + Math.sin(t * 2.4 + i * 2) * 0.18));
      legs.forEach((l, i) => (l.rotation.x = ctx.speed > 0.3 ? Math.sin(t * 7 + (i ? Math.PI : 0)) * 0.4 : 0));
    },
  };
}

function bLarva(s: any): Built {
  const root = new THREE.Group();
  const r = 0.2 * (s.fat || 1);
  const n = 4;
  const segs: THREE.Object3D[] = [];
  const bm = M(s.body);
  for (let i = 0; i < n; i++) {
    const seg = pivot(0, r * 0.85, r * 1.1 * (1 - i));
    const k = i === 0 ? 1.25 : 1 - i * 0.08;
    seg.add(mesh(sphereG(), i === 0 ? M(s.headC || s.body) : bm, r * k));
    if (s.belly && i > 0) {
      const b = mesh(sphereG(), M(s.belly), r * k * 0.8, r * k * 0.6, r * k * 0.8);
      b.position.y = -r * 0.3;
      seg.add(b);
    }
    root.add(seg);
    segs.push(seg);
  }
  const head = segs[0];
  eyePair(head, s, r * 0.3, r * 0.3, r * 0.95, r * 0.55);
  if (s.antenna) {
    const a = mesh(sphereG(), M(s.antennaC || "#e85a4a"), r * 0.18, r * 0.55, r * 0.18);
    a.position.set(0, r * 1.25, r * 0.15);
    head.add(a);
  }
  if (s.horn) hornCone(head, s.hornC || "#ece4d4", r * 0.2, r * 0.8, 0, r * 1.1, 0, 0);
  root.scale.setScalar(1 / (r * 2.6));
  const seed = Math.random() * 9;
  const baseZ = segs.map((sg) => sg.position.z);
  return {
    root,
    parts: { body: segs[0] },
    animator: (dt, ctx, t) => {
      // inchworm wave
      const sp = 3 + Math.min(ctx.speed, 4) * 3;
      segs.forEach((seg, i) => {
        seg.position.y = r * 0.85 + Math.max(0, Math.sin(t * sp - i * 1.1 + seed)) * r * 0.3 * (ctx.speed > 0.2 ? 1 : 0.18);
        seg.position.z = baseZ[i] + Math.sin(t * sp - i * 1.1) * r * 0.06;
      });
      head.rotation.y = Math.sin(t * 1.3 + seed) * 0.18;
    },
  };
}

function bCocoon(s: any): Built {
  const root = new THREE.Group();
  const r = 0.3;
  const body = pivot(0, r * 1.05, 0);
  body.add(mesh(sphereG(), M(s.body), r * (s.fat || 0.72), r * 1.15, r * 0.62));
  eyePair(body, s, r * 0.16, r * 0.35, r * 0.55, r * 0.3);
  root.add(body);
  root.scale.setScalar(1 / (r * 2.4));
  const seed = Math.random() * 9;
  return {
    root,
    parts: { body },
    animator: (dt, ctx, t) => {
      body.rotation.z = Math.sin(t * 1.1 + seed) * 0.1 + (ctx.speed > 0.2 ? Math.sin(t * 8) * 0.18 : 0);
      body.position.y = r * 1.05 + (ctx.speed > 0.2 ? Math.abs(Math.sin(t * 8)) * 0.08 : 0);
    },
  };
}

function bWingbug(s: any): Built {
  const root = new THREE.Group();
  const bodyR = 0.22 * (s.fat || 1);
  const body = pivot(0, 0.52, 0);
  root.add(body);
  body.add(mesh(sphereG(), M(s.body), bodyR, bodyR * 1.15, bodyR * 0.95));
  const headR = bodyR * 0.78;
  const head = pivot(0, bodyR * 1.15, bodyR * 0.15);
  head.add(mesh(sphereG(), M(s.headC || s.body), headR));
  eyePair(head, { ...s, eye: s.eye || "#d04848", sclera: s.sclera || "#f4f4f4" }, headR * 0.34, headR * 0.18, headR * 0.6, headR * 0.5);
  if (s.antennae !== false) for (const side of [-1, 1]) {
    const a = mesh(cylG(), M(s.antC || "#3a3a44"), headR * 0.05, headR * 0.8, headR * 0.05);
    a.position.set(side * headR * 0.25, headR * 0.85, headR * 0.15);
    a.rotation.z = -side * 0.45;
    head.add(a);
  }
  body.add(head);
  if (s.stinger) {
    const st = mesh(coneG(), M("#ece4d4"), bodyR * 0.2, bodyR * 0.8, bodyR * 0.2);
    st.position.set(0, -bodyR * 0.95, -bodyR * 0.1);
    st.rotation.x = Math.PI;
    body.add(st);
  }
  const arms = s.needles
    ? [-1, 1].map((side) => {
        const p = pivot(side * bodyR * 0.7, bodyR * 0.15, bodyR * 0.3);
        const n2 = mesh(coneG(), M("#ece4d4"), bodyR * 0.14, bodyR * 0.9, bodyR * 0.14);
        n2.rotation.x = Math.PI / 2;
        n2.position.z = bodyR * 0.45;
        p.add(n2);
        body.add(p);
        return p;
      })
    : [];
  const wings: THREE.Object3D[] = [];
  const wc = M(s.wingC || "#f4f4ff", { op: 0.55, dbl: true, flat: false });
  for (const side of [-1, 1]) for (let w = 0; w < (s.wingPairs || 2); w++) {
    const piv = pivot(side * bodyR * 0.5, bodyR * 0.6 - w * bodyR * 0.32, -bodyR * 0.2);
    const span = bodyR * (s.wingSpan || 1.7);
    const wing = mesh(sphereG(), wc, span, span * 0.4, bodyR * 0.05);
    wing.position.x = side * span * 0.8;
    wing.rotation.y = side * (0.12 + w * 0.3);
    piv.add(wing);
    body.add(piv);
    wings.push(piv);
  }
  root.scale.setScalar(1 / 1.05);
  const seed = Math.random() * 9;
  return {
    root,
    parts: { body, head, wings, arms },
    levitate: true,
    animator: (dt, ctx, t) => {
      wings.forEach((w, i) => (w.rotation.z = (i % 2 ? -1 : 1) * Math.sin(t * 22 + seed) * 0.45));
      body.position.y = 0.52 + Math.sin(t * 2.6 + seed) * 0.05;
      arms.forEach((a, i) => (a.rotation.x = Math.sin(t * 2 + i * 2) * 0.15));
    },
  };
}

function bCrab(s: any): Built {
  const root = new THREE.Group();
  const bodyR = 0.3 * (s.fat || 1);
  const body = pivot(0, 0.34, 0);
  root.add(body);
  body.add(mesh(sphereG(), M(s.body), bodyR * 1.1, bodyR * 0.72, bodyR * 0.92));
  eyePair(body, s, bodyR * 0.16, bodyR * 0.42, bodyR * 0.62, bodyR * 0.4);
  const legs: THREE.Object3D[] = [];
  const lm = M(s.legC || s.body);
  for (const side of [-1, 1]) for (let i = 0; i < 2; i++) {
    const hip = pivot(side * bodyR * 0.8, -bodyR * 0.15, (i - 0.5) * bodyR * 0.7);
    const leg = mesh(capsG(), lm, bodyR * 0.09, bodyR * 0.32, bodyR * 0.09);
    leg.position.y = -bodyR * 0.3;
    leg.rotation.z = side * 0.5;
    hip.add(leg);
    body.add(hip);
    legs.push(hip);
  }
  const claws: THREE.Object3D[] = [];
  if (s.claws !== false) {
    for (const side of [-1, 1]) {
      const big = s.bigClaw ? side === -1 : true;
      const p = pivot(side * bodyR * 0.85, bodyR * 0.15, bodyR * 0.55);
      const k = big ? (s.bigClaw ? 1.5 : 1) : 0.6;
      const claw = mesh(sphereG(), M(s.clawC || s.body), bodyR * 0.34 * k, bodyR * 0.3 * k, bodyR * 0.42 * k);
      claw.position.set(side * bodyR * 0.18, 0, bodyR * 0.22);
      p.add(claw);
      body.add(p);
      claws.push(p);
    }
  }
  if (s.mush) {
    const n = s.mush;
    for (let i = 0; i < n; i++) {
      const x = n === 1 ? 0 : (i - 0.5) * bodyR * 0.7;
      const stem = mesh(cylG(), M("#f2ead8"), bodyR * 0.14, bodyR * 0.3, bodyR * 0.14);
      stem.position.set(x, bodyR * 0.62, -bodyR * 0.15);
      const cap = mesh(sphereG(), M(s.mushC || "#d8485a"), bodyR * (n === 1 ? 0.72 : 0.4), bodyR * 0.3, bodyR * (n === 1 ? 0.72 : 0.4));
      cap.position.set(x, bodyR * 0.85, -bodyR * 0.15);
      body.add(stem, cap);
    }
  }
  root.scale.setScalar(1 / (bodyR * 2.4));
  const seed = Math.random() * 9;
  return {
    root,
    parts: { body, arms: claws, legs },
    animator: (dt, ctx, t) => {
      const ph = t * (5 + Math.min(ctx.speed, 6) * 3);
      legs.forEach((l, i) => (l.rotation.x = Math.sin(ph + i * 1.6) * Math.min(0.5, ctx.speed * 0.4 + 0.04)));
      claws.forEach((c, i) => (c.rotation.x = Math.sin(t * 1.7 + i * 2.4 + seed) * 0.16));
      body.position.y = 0.34 + Math.sin(t * 2.3 + seed) * 0.01;
    },
  };
}

function bTentacle(s: any): Built {
  const root = new THREE.Group();
  const r = 0.3 * (s.fat || 1);
  const bell = pivot(0, 0.68, 0);
  root.add(bell);
  bell.add(mesh(sphereG(), M(s.body, { op: s.op ?? 1 }), r, r * 0.88, r));
  eyePair(bell, s, r * 0.16, 0, r * 0.85, r * 0.42);
  if (s.gems) {
    const gm = M("#d84848", { em: 0xaa2222, emI: 0.4, flat: false });
    const g1 = mesh(sphereG(), gm, r * 0.22);
    g1.position.set(0, r * 0.5, r * 0.7);
    bell.add(g1);
    for (const side of [-1, 1]) {
      const g2 = mesh(sphereG(), gm, r * 0.16);
      g2.position.set(side * r * 0.5, r * 0.45, r * 0.45);
      bell.add(g2);
    }
  }
  if (s.spiralShell) {
    const sh = mesh(sphereG(), M(s.shellC || "#cfc0a4"), r * 1.05, r * 0.95, r * 0.9);
    sh.position.set(0, r * 0.55, -r * 0.25);
    bell.add(sh);
    const swirl = mesh(torusG(), M(s.shellC2 || "#a89878"), r * 0.55, r * 0.55, r * 0.55);
    swirl.position.set(0, r * 0.55, r * 0.55);
    bell.add(swirl);
    if (s.spikes) backSpikes(bell, "#ece4d4", s.spikes, r * 0.14, r, r * 0.45);
  }
  const tents: THREE.Object3D[] = [];
  const tn = s.tents || 4;
  const tm = M(s.tentC || s.body);
  for (let i = 0; i < tn; i++) {
    const a = (i / tn) * Math.PI * 2 + 0.3;
    const p = pivot(Math.cos(a) * r * 0.5, -r * 0.5, Math.sin(a) * r * 0.5);
    const tt = mesh(capsG(), tm, r * 0.1, r * 0.5, r * 0.1);
    tt.position.y = -r * 0.42;
    p.add(tt);
    bell.add(p);
    tents.push(p);
  }
  root.scale.setScalar(1 / 1.1);
  const seed = Math.random() * 9;
  return {
    root,
    parts: { body: bell, arms: tents },
    levitate: !!s.levitate,
    animator: (dt, ctx, t) => {
      bell.scale.setScalar(1 + Math.sin(t * 2.4 + seed) * 0.045);
      bell.position.y = 0.68 + Math.sin(t * 1.9 + seed) * 0.05;
      tents.forEach((p, i) => {
        p.rotation.x = Math.sin(t * 2.6 + i * 1.4) * 0.3;
        p.rotation.z = Math.cos(t * 2.1 + i) * 0.22;
      });
    },
  };
}

function bBivalve(s: any): Built {
  const root = new THREE.Group();
  const r = 0.34;
  const base = pivot(0, r * 0.7, 0);
  root.add(base);
  const half = (top: boolean) => {
    const h = pivot(0, 0, -r * 0.2);
    const sh = mesh(sphereG(), M(s.body), r, r * 0.55, r);
    sh.scale.y *= top ? 1 : 0.8;
    sh.position.y = top ? r * 0.12 : -r * 0.1;
    h.add(sh);
    return h;
  };
  const topHalf = half(true), botHalf = half(false);
  base.add(topHalf, botHalf);
  // face peeks out between the halves
  const face = pivot(0, 0, r * 0.35);
  face.add(mesh(sphereG(), M(s.faceC || "#2a2a36", { flat: false }), r * 0.45, r * 0.4, r * 0.35));
  eyePair(face, s, r * 0.12, r * 0.1, r * 0.32, r * 0.2);
  if (s.tongue) {
    const tg = mesh(sphereG(), M("#e87898", { flat: false }), r * 0.16, r * 0.12, r * 0.4);
    tg.position.set(0, -r * 0.12, r * 0.45);
    face.add(tg);
  }
  base.add(face);
  if (s.spikes) {
    const sm = M(s.spikeC || s.body);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const sp = mesh(coneG(), sm, r * 0.12, r * 0.5, r * 0.12);
      sp.position.set(Math.cos(a) * r * 0.95, r * 0.18, Math.sin(a) * r * 0.85);
      sp.rotation.z = -Math.cos(a) * 1.3;
      sp.rotation.x = Math.sin(a) * 1.3;
      base.add(sp);
    }
  }
  if (s.legs) { // kabuto: dome with little legs
    const lm = M(s.legC || "#e8d8b0");
    for (const side of [-1, 1]) for (let i = 0; i < 2; i++) {
      const leg = mesh(capsG(), lm, r * 0.07, r * 0.2, r * 0.07);
      leg.position.set(side * r * 0.55, -r * 0.42, (i - 0.5) * r * 0.6);
      base.add(leg);
    }
  }
  root.scale.setScalar(1 / (r * 2.1));
  const seed = Math.random() * 9;
  return {
    root,
    parts: { body: base, head: face },
    animator: (dt, ctx, t) => {
      const open = 0.1 + Math.max(0, Math.sin(t * 1.4 + seed)) * 0.12 + (ctx.speed > 0.2 ? 0.1 : 0);
      topHalf.rotation.x = -open;
      botHalf.rotation.x = open * 0.4;
      base.position.y = r * 0.7 + (ctx.speed > 0.2 ? Math.abs(Math.sin(t * 6)) * 0.07 : 0);
    },
  };
}

function bGolem(s: any): Built {
  const root = new THREE.Group();
  const r = 0.34 * (s.fat || 1);
  const body = pivot(0, r * (s.legs ? 1.15 : 0.95), 0);
  root.add(body);
  body.add(mesh(dodecaG(), M(s.body), r));
  eyePair(body, s, r * 0.15, r * 0.18, r * 0.78, r * 0.35);
  const arms: THREE.Object3D[] = [];
  const am = M(s.armC || s.body);
  const rows = s.arms4 ? 2 : 1;
  for (let row = 0; row < rows; row++) for (const side of [-1, 1]) {
    const p = pivot(side * r * 0.85, r * (0.25 - row * 0.5), 0);
    const a = mesh(capsG(), am, r * 0.16, r * 0.45, r * 0.16);
    a.position.y = -r * 0.4;
    p.add(a);
    const fist = mesh(dodecaG(), am, r * 0.22);
    fist.position.y = -r * 0.78;
    p.add(fist);
    p.rotation.z = side * 0.7;
    body.add(p);
    arms.push(p);
  }
  let legs: THREE.Object3D[] = [];
  if (s.legs) {
    const lm = M(s.legC || s.body);
    for (const side of [-1, 1]) {
      const hip = pivot(side * r * 0.45, -r * 0.85, 0);
      const leg = mesh(capsG(), lm, r * 0.16, r * 0.3, r * 0.16);
      leg.position.y = -r * 0.25;
      hip.add(leg);
      body.add(hip);
      legs.push(hip);
    }
  }
  if (s.headBump) {
    const h = mesh(sphereG(), M(s.headC || s.body), r * 0.45);
    h.position.set(0, r * 0.85, r * 0.25);
    body.add(h);
  }
  root.scale.setScalar(1 / (r * (s.legs ? 2.6 : 2.1)));
  const seed = Math.random() * 9;
  return {
    root,
    parts: { body, arms, legs },
    levitate: !s.legs,
    animator: (dt, ctx, t) => {
      const ph = t * (4 + Math.min(ctx.speed, 6) * 2);
      arms.forEach((a, i) => {
        a.rotation.x = Math.sin(ph + (i % 2 ? Math.PI : 0)) * Math.min(0.5, ctx.speed * 0.3 + 0.05);
        a.rotation.z = (i % 2 ? 1 : -1) * 0.7 + Math.sin(t * 1.8 + i) * 0.1;
      });
      legs.forEach((l, i) => (l.rotation.x = Math.sin(ph + (i ? Math.PI : 0)) * Math.min(0.55, ctx.speed * 0.3)));
      body.rotation.z = Math.sin(t * 1.6 + seed) * 0.04;
    },
  };
}

function bPlant(s: any): Built {
  const root = new THREE.Group();
  const r = 0.26 * (s.fat || 1);
  const body = pivot(0, r * 1.0, 0);
  root.add(body);
  if (s.pitcher) {
    // Bellsprout line: a pitcher head on a stem
    const stem = mesh(cylG(), M(s.stemC || "#7ac84f"), r * 0.12, r * 1.2, r * 0.12);
    stem.position.y = -r * 0.3;
    body.add(stem);
    const headP = pivot(0, r * 0.55, 0);
    headP.add(mesh(sphereG(), M(s.body), r * 0.72, r * (s.pitcherTall || 0.95), r * 0.72));
    if (s.lip) {
      const lip = mesh(torusG(), M(s.lipC || s.body), r * 0.45, r * 0.45, r * 0.45);
      lip.position.y = r * (s.pitcherTall || 0.95) * 0.82;
      lip.rotation.x = Math.PI / 2 - 0.25;
      headP.add(lip);
    }
    eyePair(headP, s, r * 0.14, r * 0.15, r * 0.62, r * 0.3);
    body.add(headP);
    const leaves: THREE.Object3D[] = [];
    for (const side of [-1, 1]) {
      const p = pivot(side * r * 0.2, -r * 0.1, 0);
      const l = leafBlade(s.leafC || "#3f9e54", r * 0.8, r * 0.3);
      l.rotation.z = side * 1.25;
      p.add(l);
      body.add(p);
      leaves.push(p);
    }
    root.scale.setScalar(1 / (r * 2.6));
    const seed = Math.random() * 9;
    return {
      root,
      parts: { body, head: headP, arms: leaves },
      animator: (dt, ctx, t) => {
        headP.rotation.z = Math.sin(t * 1.7 + seed) * 0.14;
        headP.rotation.x = Math.sin(t * 1.2) * 0.1;
        leaves.forEach((l, i) => (l.rotation.y = Math.sin(t * 2 + i * 2.4) * 0.3));
        body.position.y = r + (ctx.speed > 0.2 ? Math.abs(Math.sin(t * 7)) * 0.07 : 0);
      },
    };
  }
  // Oddish line / Exeggutor: round body + leaf crown (+ optional trunk/heads)
  const trunkH = s.trunk ? r * 2.1 : 0;
  if (s.trunk) {
    const tr = mesh(cylG(), M(s.trunkC || "#cfa86a"), r * 0.4, trunkH, r * 0.4);
    tr.position.y = -r * 0.1 + trunkH * 0.0;
    body.add(tr);
  }
  const headN = s.heads || 1;
  const heads: THREE.Object3D[] = [];
  for (let i = 0; i < headN; i++) {
    const a = headN === 1 ? 0 : (i / headN) * Math.PI * 2;
    const hp = pivot(Math.cos(a) * (headN > 1 ? r * 0.45 : 0), trunkH * 0.6 + (headN > 1 ? Math.sin(i * 2.4) * r * 0.15 : 0), headN > 1 ? Math.sin(a) * r * 0.45 : 0);
    hp.add(mesh(sphereG(), M(s.body), r * (headN > 1 ? 0.5 : 1)));
    eyePair(hp, s, r * (headN > 1 ? 0.1 : 0.16), r * 0.18, r * (headN > 1 ? 0.42 : 0.85), r * (headN > 1 ? 0.2 : 0.4));
    body.add(hp);
    heads.push(hp);
  }
  const leaves: THREE.Object3D[] = [];
  const ln = s.leaves ?? 5;
  for (let i = 0; i < ln; i++) {
    const a = (i / ln) * Math.PI * 2;
    const p = pivot(Math.cos(a) * r * 0.3, trunkH * 0.6 + r * (s.heads ? 0.6 : 0.8), Math.sin(a) * r * 0.3);
    const l = leafBlade(s.leafC || "#3f9e54", r * (s.leafLen || 0.85), r * 0.32);
    l.rotation.z = Math.cos(a) * (s.droop ? 1.5 : 0.75);
    l.rotation.x = Math.sin(a) * (s.droop ? 1.5 : 0.75);
    p.add(l);
    body.add(p);
    leaves.push(p);
  }
  if (s.flower) {
    const fl = pivot(0, r * 1.0, 0);
    fl.add(mesh(sphereG(), M("#f6cf3d"), r * 0.3));
    const pm = M(s.flowerC || "#d8485a", { dbl: true });
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const petal = mesh(sphereG(), pm, r * 0.62, r * 0.12, r * 0.45);
      petal.position.set(Math.cos(a) * r * 0.6, 0, Math.sin(a) * r * 0.6);
      petal.rotation.y = -a;
      fl.add(petal);
    }
    body.add(fl);
  }
  // little feet
  const legs: THREE.Object3D[] = [];
  const lm = M(s.legC || "#e8d8a8");
  for (const side of [-1, 1]) {
    const hip = pivot(side * r * 0.35, -r * 0.85, 0);
    const foot = mesh(sphereG(), lm, r * 0.2, r * 0.12, r * 0.3);
    hip.add(foot);
    body.add(hip);
    legs.push(hip);
  }
  root.scale.setScalar(1 / (r * 2 + trunkH * 0.7 + (s.flower ? r * 0.7 : r * 0.5)));
  const seed = Math.random() * 9;
  return {
    root,
    parts: { body, heads, arms: leaves, legs },
    animator: (dt, ctx, t) => {
      leaves.forEach((l, i) => { l.rotation.y = Math.sin(t * 1.8 + i * 1.7 + seed) * 0.22; });
      heads.forEach((h, i) => (h.rotation.z = Math.sin(t * 1.4 + i * 2.1) * 0.07));
      const hop = ctx.speed > 0.25 ? Math.abs(Math.sin(t * 8 + seed)) * 0.08 : 0;
      body.position.y = r + hop;
      legs.forEach((l, i) => (l.rotation.x = ctx.speed > 0.25 ? Math.sin(t * 8 + (i ? Math.PI : 0)) * 0.5 : 0));
    },
  };
}

function bFloaty(s: any): Built {
  // Magnemite line / Porygon — hovering geometric creatures
  const root = new THREE.Group();
  const n = s.units || 1;
  const r = 0.26 / Math.sqrt(n);
  const units: THREE.Object3D[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.PI / 6;
    const u = pivot(n === 1 ? 0 : Math.cos(a) * r * 1.5, 0.62 + (n === 1 ? 0 : Math.sin(a) * r * 1.2), 0);
    if (s.poly) {
      const bodyM = mesh(octaG(), M(s.body), r * 1.15, r * 0.95, r * 1.3);
      u.add(bodyM);
      const headM = mesh(tetraGSafe(), M(s.headC || s.sec || s.body), r * 0.62);
      headM.position.set(0, r * 0.75, r * 0.55);
      headM.rotation.set(0.4, 0.8, 0);
      u.add(headM);
      const beakM = mesh(coneG(), M(s.beakC || "#7ab8d8"), r * 0.3, r * 0.6, r * 0.3);
      beakM.rotation.x = Math.PI / 2;
      beakM.position.set(0, r * 0.7, r * 1.0);
      u.add(beakM);
      eyePair(u, s, r * 0.14, r * 0.85, r * 0.75, r * 0.3);
    } else {
      u.add(mesh(sphereG(), M(s.body, { flat: false }), r));
      // single big eye
      const e = pivot(0, 0, r * 0.8);
      e.add(mesh(sphereG(), M("#f8f8f8", { flat: false }), r * 0.42));
      const p = mesh(sphereG(), M("#1c1c26", { flat: false }), r * 0.2);
      p.position.z = r * 0.3;
      e.add(p);
      u.add(e);
      EYES.push(e);
      // horseshoe magnets
      const mm = M("#aeb6c2");
      for (const side of [-1, 1]) {
        const bar = mesh(boxG(), mm, r * 0.55, r * 0.18, r * 0.18);
        bar.position.set(side * r * 1.15, 0, 0);
        u.add(bar);
        const tipM = M(side < 0 ? "#d84848" : "#4868d8");
        for (const dz of [-1, 1]) {
          const tip = mesh(boxG(), tipM, r * 0.18, r * 0.18, r * 0.3);
          tip.position.set(side * r * 1.45, 0, dz * r * 0.2);
          u.add(tip);
        }
      }
      // screws
      const sm = M("#8a929e");
      const sc = mesh(coneG(), sm, r * 0.14, r * 0.3, r * 0.14);
      sc.position.y = r * 1.15;
      u.add(sc);
    }
    root.add(u);
    units.push(u);
  }
  root.scale.setScalar(1 / 1.15);
  const seed = Math.random() * 9;
  return {
    root,
    parts: { heads: units },
    levitate: true,
    animator: (dt, ctx, t) => {
      units.forEach((u, i) => {
        u.position.y = 0.62 + (units.length === 1 ? 0 : Math.sin((i / units.length) * Math.PI * 2 + Math.PI / 6) * r * 1.2) + Math.sin(t * 2.2 + i * 2.1 + seed) * 0.05;
        u.rotation.z = Math.sin(t * 1.6 + i * 1.4) * 0.12;
        u.rotation.y = s.poly ? Math.sin(t * 0.8) * 0.3 : 0;
      });
    },
  };
}
function tetraGSafe() { return G("T", () => new THREE.TetrahedronGeometry(1, 0)); }

function bBall(s: any): Built {
  // Voltorb / Electrode / Koffing / Weezing
  const root = new THREE.Group();
  const n = s.units || 1;
  const r = 0.4 / Math.sqrt(n);
  const units: THREE.Object3D[] = [];
  for (let i = 0; i < n; i++) {
    const u = pivot(n === 1 ? 0 : (i - 0.5) * r * 1.7, r * (s.levitate ? 1.6 : 0.95) + (n > 1 ? (i ? r * 0.45 : -r * 0.1) : 0), 0);
    const ur = r * (i ? 0.72 : 1);
    if (s.topC) {
      // Poké Ball colours: a true top hemisphere + bottom hemisphere
      u.add(mesh(hemiTopG(), M(s.topC, { flat: false }), ur));
      u.add(mesh(hemiBotG(), M(s.body, { flat: false }), ur));
    } else {
      u.add(mesh(sphereG(), M(s.body), ur));
    }
    if (s.craters) {
      const cm = M(s.craterC || "#9a7ab8");
      for (let c = 0; c < 5; c++) {
        const a = (c / 5) * Math.PI * 2 + i;
        const cr = mesh(sphereG(), cm, r * 0.16);
        cr.position.set(Math.cos(a) * r * 0.85, Math.sin(a * 1.7) * r * 0.55, Math.sin(a) * r * 0.78);
        u.add(cr);
      }
    }
    eyePair(u, { ...s, eyeStyle: s.eyeStyle || "sclera" }, r * 0.17, r * 0.25, r * (i ? 0.62 : 0.86), r * 0.35);
    root.add(u);
    units.push(u);
  }
  root.scale.setScalar(1 / (r * (s.levitate ? 3 : 2)));
  const seed = Math.random() * 9;
  return {
    root,
    parts: { heads: units },
    levitate: !!s.levitate,
    animator: (dt, ctx, t) => {
      units.forEach((u, i) => {
        const roll = ctx.speed > 0.3 && !s.levitate ? Math.sin(t * 9 + seed) * 0.2 : 0;
        u.rotation.x = roll + Math.sin(t * 1.8 + i * 2) * 0.06;
        u.position.y += Math.sin(t * 2.2 + i * 2 + seed) * 0.0015;
      });
    },
  };
}

function bStar(s: any): Built {
  const root = new THREE.Group();
  const r = 0.4;
  const core = pivot(0, 0.62, 0);
  root.add(core);
  const layers = s.layers || 1;
  for (let l = 0; l < layers; l++) {
    const am = M(l === 0 ? s.body : s.sec || s.body);
    const n = 5;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + (l ? Math.PI / n : 0) - Math.PI / 2;
      const arm = mesh(coneG(), am, r * 0.18, r * (l ? 0.7 : 0.95), r * 0.1);
      arm.position.set(Math.cos(a) * r * (l ? 0.42 : 0.52), Math.sin(a) * r * (l ? 0.42 : 0.52), l * -r * 0.12);
      arm.rotation.z = a + Math.PI / 2;
      core.add(arm);
    }
  }
  const gem = mesh(sphereG(), M(s.gemC || "#d84848", { em: s.gemC || "#d84848", emI: 0.5, flat: false }), r * 0.26);
  gem.position.z = r * 0.14;
  core.add(gem);
  root.scale.setScalar(1 / 1.25);
  const seed = Math.random() * 9;
  return {
    root,
    parts: { body: core },
    levitate: true,
    animator: (dt, ctx, t) => {
      core.rotation.z = Math.sin(t * 0.9 + seed) * 0.45 + (ctx.speed > 0.3 ? t * 1.8 : 0);
      core.position.y = 0.62 + Math.sin(t * 2.1 + seed) * 0.05;
      gem.scale.setScalar(1 + Math.sin(t * 3.2) * 0.12);
    },
  };
}

function bEggs(s: any): Built {
  const root = new THREE.Group();
  const r = 0.17;
  const eggs: THREE.Object3D[] = [];
  const em = M(s.body, { flat: false });
  const positions = [[0, 0], [0.32, 0.1], [-0.32, 0.08], [0.16, -0.28], [-0.18, -0.26], [0, 0.34]];
  positions.slice(0, s.count || 6).forEach(([x, z], i) => {
    const e = pivot(x, r * 0.95 + (i % 2) * 0.02, z);
    e.add(mesh(sphereG(), em, r, r * 1.2, r));
    eyePair(e, s, r * 0.18, r * 0.15, r * 0.78, r * 0.32);
    root.add(e);
    eggs.push(e);
  });
  root.scale.setScalar(1 / (r * 3));
  const seed = Math.random() * 9;
  return {
    root,
    parts: { heads: eggs },
    animator: (dt, ctx, t) => {
      eggs.forEach((e, i) => {
        e.rotation.z = Math.sin(t * 2.2 + i * 1.9 + seed) * 0.12;
        e.position.y = r * 0.95 + (ctx.speed > 0.25 ? Math.abs(Math.sin(t * 7 + i)) * 0.06 : Math.sin(t * 1.8 + i) * 0.012);
      });
    },
  };
}

function bGhost(s: any): Built {
  const root = new THREE.Group();
  const r = 0.3 * (s.fat || 1);
  const core = pivot(0, 0.62, 0);
  root.add(core);
  core.add(mesh(sphereG(), M(s.body), r));
  eyePair(core, { ...s, sclera: s.sclera || "#f0f0ff" }, r * 0.2, r * 0.15, r * 0.78, r * 0.4);
  if (s.aura) {
    const a = mesh(sphereG(), M(s.auraC || "#9a6ae8", { op: 0.22, flat: false }), r * 1.5);
    core.add(a);
  }
  if (s.spiky) {
    const sm = M(s.body);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.2;
      const sp = mesh(coneG(), sm, r * 0.14, r * 0.45, r * 0.14);
      sp.position.set(Math.cos(a) * r * 0.85, Math.abs(Math.sin(a)) * r * 0.6 + r * 0.2, Math.sin(a) * r * 0.55 - r * 0.3);
      sp.rotation.z = -Math.cos(a) * 1.1;
      core.add(sp);
    }
  }
  const hands: THREE.Object3D[] = [];
  if (s.hands) {
    const hm = M(s.body);
    for (const side of [-1, 1]) {
      const h = pivot(side * r * 1.5, -r * 0.15, r * 0.25);
      h.add(mesh(sphereG(), hm, r * 0.3, r * 0.24, r * 0.34));
      core.add(h);
      hands.push(h);
    }
  }
  root.scale.setScalar(1 / 1.15);
  const seed = Math.random() * 9;
  return {
    root,
    parts: { body: core, arms: hands },
    levitate: true,
    animator: (dt, ctx, t) => {
      core.position.y = 0.62 + Math.sin(t * 1.7 + seed) * 0.07;
      core.rotation.z = Math.sin(t * 1.2 + seed) * 0.08;
      hands.forEach((h, i) => {
        h.position.y = -r * 0.15 + Math.sin(t * 2.3 + i * 2.6) * r * 0.22;
        h.rotation.z = Math.sin(t * 2 + i) * 0.25;
      });
    },
  };
}

function bBat(s: any): Built {
  const root = new THREE.Group();
  const r = 0.22 * (s.fat || 1);
  const body = pivot(0, 0.58, 0);
  root.add(body);
  body.add(mesh(sphereG(), M(s.body), r, r * 1.05, r * 0.9));
  eyePair(body, s, r * 0.2, r * 0.18, r * 0.75, r * 0.4);
  // open mouth wedge
  if (s.mouth) {
    const m = mesh(coneG(), M(s.mouthC || "#5a2a4a"), r * 0.3, r * 0.4, r * 0.2);
    m.rotation.x = Math.PI / 2;
    m.position.set(0, -r * 0.2, r * 0.8);
    body.add(m);
  }
  earCone(body, s, r * 0.7, r * 0.26, r * 0.45, r * 0.85, 0.35);
  const wings: THREE.Object3D[] = [];
  const wm = M(s.wingC || s.body, { dbl: true });
  const im = s.wingIn ? M(s.wingIn, { dbl: true }) : null;
  for (const side of [-1, 1]) {
    const w = pivot(side * r * 0.7, r * 0.15, 0);
    const span = r * (s.wingSpan || 2.2);
    const wing = mesh(sphereG(), wm, span, span * 0.5, r * 0.07);
    wing.position.x = side * span * 0.8;
    w.add(wing);
    if (im) {
      const inner = mesh(sphereG(), im, span * 0.6, span * 0.32, r * 0.05);
      inner.position.set(side * span * 0.55, -span * 0.05, r * 0.02);
      w.add(inner);
    }
    body.add(w);
    wings.push(w);
  }
  if (s.tailWisps) for (const side of [-1, 1]) {
    const t2 = mesh(coneG(), wm, r * 0.12, r * 0.6, r * 0.12);
    t2.position.set(side * r * 0.3, -r * 0.85, -r * 0.1);
    t2.rotation.x = Math.PI;
    body.add(t2);
  }
  root.scale.setScalar(1 / 1.1);
  const seed = Math.random() * 9;
  return {
    root,
    parts: { body, wings },
    levitate: true,
    animator: (dt, ctx, t) => {
      wings.forEach((w, i) => (w.rotation.z = (i ? -1 : 1) * Math.sin(t * 11 + seed) * 0.55));
      body.position.y = 0.58 + Math.sin(t * 3.1 + seed) * 0.07;
      body.rotation.z = Math.sin(t * 1.9) * 0.08;
    },
  };
}

function bMound(s: any): Built {
  const root = new THREE.Group();
  const n = s.units || 1;
  const heads: THREE.Object3D[] = [];
  const r = 0.26 / Math.sqrt(n);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = n === 1 ? 0 : Math.cos(a) * r * 1.15, z = n === 1 ? 0 : Math.sin(a) * r * 1.15;
    // dirt mound
    const mound = mesh(coneG(), M("#8a7050"), r * 1.5, r * 0.9, r * 1.5);
    mound.position.set(x, r * 0.45, z);
    root.add(mound);
    const h = pivot(x, r * 0.8, z);
    h.add(mesh(capsG(), M(s.body), r * 0.62, r * 0.5, r * 0.62));
    eyePair(h, s, r * 0.14, r * 0.5, r * 0.5, r * 0.28);
    const nose = mesh(sphereG(), M(s.noseC || "#e88498", { flat: false }), r * 0.2);
    nose.position.set(0, r * 0.32, r * 0.6);
    h.add(nose);
    root.add(h);
    heads.push(h);
  }
  root.scale.setScalar(1 / (r * 3.2));
  const seed = Math.random() * 9;
  return {
    root,
    parts: { heads },
    animator: (dt, ctx, t) => {
      heads.forEach((h, i) => {
        h.position.y = 0.26 / Math.sqrt(n) * 0.8 + Math.max(0, Math.sin(t * (2.4 + i * 0.7) + seed + i * 2.2)) * 0.06;
        h.rotation.y = Math.sin(t * 1.5 + i * 2.1) * 0.35;
        h.rotation.z = Math.sin(t * 3.3 + i) * 0.06;
      });
    },
  };
}

// ============================================================ species table
// One line per Pokémon: archetype + palette + signature parts.
// Colors approximate the classic Gen 1 palette.
const S: Record<number, any> = {
  1:  { arch: "quad", body: "#5fbf9b", belly: "#a6e3c4", headR: 0.98, legLen: 0.66, fat: 1.05, bulb: "#5a9e6a", bulbR: 0.92, bulbSpots: "#3c7a52", bulbLeaves: 3, leafC: "#56a85e", ears: true, earLen: 0.34, earTilt: 0.74 },
  2:  { arch: "quad", body: "#54b096", belly: "#a6e3c4", fat: 1.2, legLen: 0.7, bulb: "#e07a96", bulbR: 0.8, bulbLeaves: 5, leafC: "#43955a", ears: true, earLen: 0.36, earTilt: 0.72 },
  3:  { arch: "quad", body: "#46a085", belly: "#9adcc0", fat: 1.5, legLen: 0.84, bulb: "#3f8e5e", bulbR: 0.96, flower: true, flowerC: "#e8556f", bulbLeaves: 6, leafC: "#3f9e54", ears: true, earLen: 0.3, earTilt: 0.72 },
  4:  { arch: "biped", body: "#f59b54", belly: "#fbe6b4", tail: "thick", tailC: "#f59b54", tailFlame: true, snout: true, snoutC: "#f59b54", snoutLen: 0.3 },
  5:  { arch: "biped", body: "#e8694a", belly: "#fbe0b0", fat: 1.1, neck: 0.28, tail: "thick", tailC: "#e8694a", tailFlame: true, horn: true, claws: true, snout: true, snoutC: "#e8694a", snoutLen: 0.4 },
  6:  { arch: "biped", body: "#f0883c", belly: "#f7d49a", fat: 1.2, neck: 0.8, neckC: "#f7d49a", wings: "membrane", wingC: "#2f6f8f", wingSpan: 2.5, wingRake: 0.5, tail: "thick", tailC: "#f0883c", tailFlame: true, hornBack: true, hornLen: 1.1, claws: true, clawN: 3, snout: true, snoutC: "#f0883c", snoutLen: 0.55 },
  7:  { arch: "biped", body: "#73bce4", belly: "#f3e3b3", shell: "#b27a44", shellRim: "#efe6c6", tail: "fluff", tailC: "#73bce4" },
  8:  { arch: "biped", body: "#8aa8d8", belly: "#f3e3b3", fat: 1.1, shell: "#a8764a", shellRim: "#e8dcc0", ears: true, earLen: 0.5, tail: "fluff", tailC: "#c8d8f0", tailTip: "#f0f4ff" },
  9:  { arch: "biped", body: "#6f93c6", belly: "#eadcb4", fat: 1.32, shell: "#7d5f3e", shellRim: "#d8ccae", cannons: true, cannonC: "#8d99a7", tail: "fluff" },
  10: { arch: "larva", body: "#8ed35f", belly: "#d8f0a8", headC: "#7ac84f", antenna: true, eye: "#1c1c26" },
  11: { arch: "cocoon", body: "#9ed05f" },
  12: { arch: "wingbug", body: "#7a6ab8", headC: "#8a7ac8", wingC: "#f8f8ff", eye: "#d04848", wingSpan: 2.0 },
  13: { arch: "larva", body: "#e8b84a", belly: "#f8e0a0", horn: true },
  14: { arch: "cocoon", body: "#e8c84a", fat: 0.62 },
  15: { arch: "wingbug", body: "#f0d04a", headC: "#f0d04a", wingC: "#f0f0f8", needles: true, stinger: true, wingSpan: 1.8 },
  16: { arch: "bird", body: "#c9a06a", belly: "#f0dcb8", wingC: "#b58a52", crest: true, crestN: 1, crestC: "#9a6a3a", crestLen: 0.8 },
  17: { arch: "bird", body: "#c98a5a", belly: "#f0dcb8", fat: 1.15, crest: true, crestN: 2, crestC: "#e85a4a", crestLen: 1.2, tailN: 1, tailC: "#d8546a", tailLen: 1.1 },
  18: { arch: "bird", body: "#d09a62", belly: "#f6e4c0", fat: 1.32, crest: true, crestN: 3, crestC: "#f6c84a", crestLen: 1.7, neck: 0.7, tailN: 2, tailLen: 1.7, tailC: "#e85a6a", wingSpan: 1.6 },
  19: { arch: "quad", body: "#a878c8", belly: "#f0e4d8", ears: true, earLen: 1.0, tail: "thin", tailC: "#d8b8e8", snout: true, teeth: true, whiskers: true },
  20: { arch: "quad", body: "#c9874f", belly: "#f0e0c8", fat: 1.22, legLen: 1.05, ears: true, earLen: 0.7, tail: "thin", tailC: "#e8c8a0", snout: true, teeth: true, whiskers: true },
  21: { arch: "bird", body: "#a98a6a", belly: "#e8dcc4", wingC: "#7a5a44", comb: true, combC: "#c43838", beakLen: 1.05, beakC: "#e8c060", tailN: 1, tailC: "#7a5a44" },
  22: { arch: "bird", body: "#b08864", belly: "#f0e2c8", fat: 1.22, neck: 1.6, beakLen: 1.7, beakC: "#e8c060", comb: true, combC: "#d23030", wingC: "#8a6a4a", tailN: 1, tailLen: 1.2, tailC: "#8a6a4a" },
  23: { arch: "serpent", body: "#c97fd0", belly: "#f0d8a0", segs: 6 },
  24: { arch: "serpent", body: "#8a5ab8", belly: "#d0b8e8", segs: 7, fat: 1.3, hood: true, hoodC: "#7a4aa8", fangs: true, headR: 1.3 },
  25: { arch: "biped", body: "#ffd23d", belly: "#ffe9a0", cheeks: "#e8483a", ears: true, earLen: 1.5, earTip: "#1c1c26", earTilt: 0.35, tail: "zigzag", tailC: "#c8932a" },
  26: { arch: "biped", body: "#ef9a2e", belly: "#f4d98a", fat: 1.12, cheeks: "#f4d84a", ears: true, earLen: 0.78, earC: "#7a4a1a", earTilt: 0.7, tail: "bolt", tailC: "#9a6a2a", tailTip: "#9a6a2a" },
  27: { arch: "quad", body: "#e8d088", belly: "#f8f0d8", fat: 1.05, ears: true, earLen: 0.6, snout: true },
  28: { arch: "quad", body: "#d8b868", belly: "#f0e4c0", fat: 1.15, spikes: 5, spikeC: "#8a6a3a", ears: true, earLen: 0.55 },
  29: { arch: "quad", body: "#9fc4e8", ears: true, earLen: 1.0, horn: true, hornLen: 0.5, snout: true },
  30: { arch: "quad", body: "#7aa8d8", fat: 1.2, ears: true, horn: true, hornLen: 0.6, spikes: 2 },
  31: { arch: "biped", body: "#5f8cc4", belly: "#dcdcc0", fat: 1.4, ears: true, earLen: 0.7, horn: true, hornR: 0.22, hornLen: 0.85, spikes: 5, spikeSize: 0.2, spikeC: "#cfe0ee", tail: "thick", tailC: "#5f8cc4", snout: true },
  32: { arch: "quad", body: "#d089c8", belly: "#f0e0ee", ears: true, earLen: 1.0, horn: true, hornLen: 0.8, spikes: 2, spikeC: "#e8d4e8", snout: true },
  33: { arch: "quad", body: "#c070b8", belly: "#ecd8ea", fat: 1.22, ears: true, horn: true, hornLen: 1.0, spikes: 3, spikeC: "#e8d0e6", snout: true },
  34: { arch: "biped", body: "#b260aa", belly: "#e8d8e0", fat: 1.4, ears: true, earLen: 0.7, horn: true, hornR: 0.26, hornLen: 1.35, hornC: "#efe6d4", spikes: 5, spikeSize: 0.22, spikeC: "#e8d4e8", tail: "thick", tailC: "#b260aa", snout: true },
  35: { arch: "biped", body: "#f8c8d8", belly: "#fce4ee", fat: 1.1, ears: true, earLen: 0.8, earC: "#d8a0b8", tail: "fluff", curl: true },
  36: { arch: "biped", body: "#f0b8cc", belly: "#fce4ee", fat: 1.22, ears: true, earLen: 1.0, earC: "#d89ab0", curl: true, tail: "fluff", tailC: "#f0b8cc", wings: "round", wingC: "#f6d0de", wingSpan: 0.85 },
  37: { arch: "quad", body: "#c97444", belly: "#e8b07a", mane: true, maneC: "#e8a060", tail: "multi", tailN: 6, tailC: "#d88a52", tailTip: "#e8a868", ears: true, earLen: 0.9 },
  38: { arch: "quad", body: "#f3e6c2", belly: "#fbf4e0", fat: 1.05, legLen: 1.1, mane: true, maneC: "#fbf2dc", tail: "multi", tailN: 9, tailC: "#f0e4c0", tailTip: "#e8d8b0", ears: true, earLen: 1.1, eye: "#c0392b" },
  39: { arch: "blob", body: "#f8c0d8", eye: "#58b8e8", eyeR: 0.2, ears: true, earLen: 0.55, curl: true },
  40: { arch: "blob", body: "#f0a8c8", fat: 1.15, eye: "#58b8e8", ears: true, earLen: 0.9, squat: 1.15 },
  41: { arch: "bat", body: "#6a7ae0", wingIn: "#b87ad0", noEyes: true, mouth: true, tailWisps: true },
  42: { arch: "bat", body: "#5a6ad0", wingIn: "#c88ae0", fat: 1.35, mouth: true, mouthC: "#7a3a5a" },
  43: { arch: "plant", body: "#4a6ad0", leaves: 5, leafC: "#4aa848" },
  44: { arch: "plant", body: "#b87aa0", leaves: 4, leafC: "#c87838", droop: true },
  45: { arch: "plant", body: "#b06a90", fat: 1.2, leaves: 3, leafC: "#4aa848", flower: true, flowerC: "#e8485a" },
  46: { arch: "crab", body: "#e8744a", legC: "#f0d8a8", claws: false, mush: 2, mushC: "#d8485a" },
  47: { arch: "crab", body: "#e8744a", fat: 1.3, legC: "#f0d8a8", claws: false, mush: 1, mushC: "#d8485a" },
  48: { arch: "blob", body: "#b06ad0", fuzz: true, fuzzC: "#9a5ac0", eye: "#d84848", eyeR: 0.24, armsOff: true },
  49: { arch: "wingbug", body: "#c9a7e8", headC: "#b897d8", wingC: "#e8e0f4", wingSpan: 2.1, eye: "#3a3a44" },
  50: { arch: "mound", body: "#b5764a" },
  51: { arch: "mound", body: "#b5764a", units: 3 },
  52: { arch: "biped", body: "#f6e0b8", belly: "#fcf0d8", coin: true, ears: true, earLen: 0.7, tail: "cone", tailC: "#d8b878" },
  53: { arch: "quad", body: "#f0e0c0", fat: 1.05, legLen: 1.25, ears: true, earLen: 0.7, gem: "#d84848", tail: "cone", tailLen: 1.7, snout: true },
  54: { arch: "biped", body: "#ffd866", belly: "#ffe9a8", beak: true, beakC: "#e8d0a0", headR: 1.0 },
  55: { arch: "biped", body: "#4a9ad0", belly: "#7ab8e0", fat: 0.95, legLen: 1.15, beak: true, beakC: "#e8e4d8", gem: "#d84848", tail: "cone" },
  56: { arch: "blob", body: "#f0e8e0", ears: true, earC: "#d8c8b8", squat: 1.0, eyeR: 0.15 },
  57: { arch: "blob", body: "#e8dcd0", fat: 1.25, ears: true, squat: 1.0 },
  58: { arch: "quad", body: "#f0884a", belly: "#f8d8a8", mane: true, maneC: "#f6e8c8", ruff: true, stripes2: 2, stripeC: "#5a3a26", tail: "fluff", tailC: "#f6e8c8", ears: true },
  59: { arch: "quad", body: "#ef7a36", belly: "#f6e0b8", fat: 1.32, legLen: 1.25, mane: true, maneC: "#f4ead2", ruff: true, stripes2: 3, stripeC: "#33241c", tail: "fluff", tailC: "#f4ead2", ears: true, earLen: 0.7 },
  60: { arch: "biped", body: "#5a7ad0", belly: "#f8f8f0", fat: 1.05, headR: 1.05, tail: "fin", tailC: "#f8f8f0", legR: 0.14 },
  61: { arch: "biped", body: "#4a6ac0", belly: "#f0f0e8", fat: 1.2, gloves: "#f0f0e8" },
  62: { arch: "biped", body: "#3f5ab0", belly: "#e8e8e0", fat: 1.35, gloves: "#e8e8e0" },
  63: { arch: "biped", body: "#e8c84a", belly: "#c89838", tail: "cone", tailC: "#c89838", snout: true, snoutLen: 0.6 },
  64: { arch: "biped", body: "#e8c84a", belly: "#b8884a", fat: 1.05, tail: "cone", tailLen: 1.6, snout: true, antennae: true },
  65: { arch: "biped", body: "#e8c84a", belly: "#a87838", snout: true, antennae: true, armC: "#c8a838", spoons: true },
  66: { arch: "biped", body: "#9fb8c8", belly: "#b8ccd8", tail: "cone", tailR: 0.2 },
  67: { arch: "biped", body: "#8aa8bc", belly: "#d8c8b0", fat: 1.2, armLen: 1.1 },
  68: { arch: "biped", body: "#7a98ac", belly: "#d0c0a8", fat: 1.3, arms4: true, armLen: 1.1 },
  69: { arch: "plant", body: "#f0e060", pitcher: true, stemC: "#7ac84f", leafC: "#3f9e54" },
  70: { arch: "plant", body: "#f0d850", pitcher: true, pitcherTall: 1.2, fat: 1.25, lip: true, lipC: "#e89848", stemC: "#7ac84f" },
  71: { arch: "plant", body: "#e8cc40", pitcher: true, pitcherTall: 1.5, fat: 1.6, lip: true, lipC: "#d88838", stemC: "#6ab83f" },
  72: { arch: "tentacle", body: "#6a9ad8", op: 0.92, gems: true, tents: 4, levitate: false },
  73: { arch: "tentacle", body: "#5a8ad0", fat: 1.3, gems: true, tents: 8, levitate: false },
  74: { arch: "golem", body: "#9a8a7a" },
  75: { arch: "golem", body: "#8a7a6a", fat: 1.3, arms4: true },
  76: { arch: "golem", body: "#7a929e", fat: 1.45, legs: true, headBump: true, headC: "#8aa2ae", armC: "#9a8a7a" },
  77: { arch: "quad", body: "#f0e0c8", mane: "flame", tail: "flame", ears: true, legLen: 1.3 },
  78: { arch: "quad", body: "#f6ecd8", fat: 1.05, mane: "flame", tail: "flame", ears: true, legLen: 1.45, horn: true },
  79: { arch: "quad", body: "#f0a0b8", belly: "#f8d8c8", fat: 1.15, headR: 0.9, snout: true, snoutC: "#f8e0d0", tail: "cone", tailC: "#f0a0b8", earLen: 0.4, ears: true },
  80: { arch: "biped", body: "#f0a0b8", belly: "#f8e0d0", fat: 1.25, snout: true, tail: "thick", tailC: "#b8b8c8", tailTip: "#9a9ab0" },
  81: { arch: "floaty", body: "#c8d0e0" },
  82: { arch: "floaty", body: "#c0c8d8", units: 3 },
  83: { arch: "bird", body: "#c9a06a", belly: "#e8d0a8", wingC: "#b08a5a", leek: true, crest: true, crestC: "#8a6a3a" },
  84: { arch: "bird", body: "#c9844a", heads: 2, neck: 1.5, wings: false, tailFeathers: false, legLen: 1.6, beakC: "#e8c87a" },
  85: { arch: "bird", body: "#b8744a", heads: 3, neck: 1.8, wings: false, tailFeathers: false, legLen: 1.8, fat: 1.1, crest: true },
  86: { arch: "quad", body: "#f0f0f8", belly: "#f8f8fc", fat: 1.2, legLen: 0.5, horn: true, hornLen: 0.45, snout: true, snoutC: "#e8e8f0" },
  87: { arch: "serpent", body: "#f4f4fc", segs: 5, fat: 1.5, lift: 0.4, horn: true, snout: true, backFins: true, finC: "#e0e0ec" },
  88: { arch: "blob", body: "#b87ad0", drip: true, squat: 0.8, armC: "#a86ac0" },
  89: { arch: "blob", body: "#a86ac8", fat: 1.4, drip: true, squat: 0.7 },
  90: { arch: "bivalve", body: "#b87ad0", tongue: true },
  91: { arch: "bivalve", body: "#8a8ad0", spikes: true, spikeC: "#7a7ac0", faceC: "#3a3a52" },
  92: { arch: "ghost", body: "#3a3a4a", aura: true, auraC: "#9a6ae8", eye: "#f8f8f8", sclera: "#5a5a6a" },
  93: { arch: "ghost", body: "#5a4a8a", spiky: true, hands: true, eye: "#f8f8f8" },
  94: { arch: "biped", body: "#6a5a9a", belly: "#7a6aaa", fat: 1.25, ears: true, earLen: 0.6, spikes: 4, spikeC: "#5a4a8a", eye: "#d84848" },
  95: { arch: "serpent", body: "#9a9aa8", segs: 7, fat: 1.6, rock: true, lift: 0.7, horn: true, eyeStyle: "bead" },
  96: { arch: "biped", body: "#f0d060", belly: "#b8884a", snout: true, snoutLen: 0.8, snoutC: "#f0d060" },
  97: { arch: "biped", body: "#f0e088", belly: "#f6ecb0", fat: 1.1, snout: true, snoutLen: 0.9, mane: true },
  98: { arch: "crab", body: "#e8744a", clawC: "#f08858", legC: "#f0d8a8" },
  99: { arch: "crab", body: "#d8643f", fat: 1.25, bigClaw: true, clawC: "#e87848", legC: "#e8c898" },
  100: { arch: "ball", body: "#f0f0f0", topC: "#e8483a", eyeStyle: "sclera", eye: "#1c1c26" },
  101: { arch: "ball", body: "#e8483a", topC: "#f0f0f0", eye: "#1c1c26" },
  102: { arch: "eggs", body: "#f8d8d0", eye: "#1c1c26" },
  103: { arch: "plant", body: "#f0d8a0", trunk: true, trunkC: "#cfa86a", heads: 3, leaves: 6, leafC: "#3f9e54", legC: "#cfa86a" },
  104: { arch: "biped", body: "#c9a06a", belly: "#e8d0a8", skull: true, eye: "#1c1c26" },
  105: { arch: "biped", body: "#b8905a", belly: "#e0c898", fat: 1.1, skull: true, bone: true },
  106: { arch: "biped", body: "#c9a06a", belly: "#d8b888", legLen: 2.2, legR: 0.13, armLen: 1.3 },
  107: { arch: "biped", body: "#b88ad0", belly: "#c8a0d8", gloves: "#d84848" },
  108: { arch: "biped", body: "#f0a0b8", belly: "#f8d8c0", fat: 1.2, tongue: true, tail: "thick" },
  109: { arch: "ball", body: "#b87ad0", craters: true, levitate: true, eye: "#f0f0f0", sclera: "#7a5a9a" },
  110: { arch: "ball", body: "#a86ac8", craters: true, levitate: true, units: 2, eye: "#f0f0f0", sclera: "#7a5a9a" },
  111: { arch: "quad", body: "#9aa8b4", belly: "#c8d2da", fat: 1.3, horn: true, hornLen: 0.5, spikes: 3, eyeStyle: "bead" },
  112: { arch: "biped", body: "#8a98a8", belly: "#d8c8b0", fat: 1.3, horn: true, spikes: 3, tail: "thick" },
  113: { arch: "blob", body: "#f8c8d8", egg: true, squat: 1.05, ears: true, earLen: 0.4 },
  114: { arch: "blob", body: "#3f6ac8", fuzz: true, fuzzC: "#4a7ad8", legC: "#e85a5a", armsOff: true, eyeR: 0.18 },
  115: { arch: "biped", body: "#b88a5a", belly: "#e8d0a8", fat: 1.3, pouch: true, pouchC: "#e8d0a8", ears: true, tail: "thick" },
  116: { arch: "serpent", body: "#7ab8e8", segs: 4, lift: 1.2, fat: 0.8, snout: true, snoutLen: 1.0, snoutC: "#7ab8e8", earFins: true, finC: "#a8d0f0" },
  117: { arch: "serpent", body: "#6aa8d8", segs: 4, lift: 1.25, fat: 0.9, snout: true, snoutLen: 1.1, earFins: true, backFins: true, finC: "#cfe4f4" },
  118: { arch: "fish", body: "#f8f4f0", belly: "#fcf8f4", finC: "#f0d8e0", horn: true, whiskers: true },
  119: { arch: "fish", body: "#f4ece4", fat: 1.3, finC: "#e8c8d0", horn: true, whiskers: true },
  120: { arch: "star", body: "#c9844a", gemC: "#e8483a" },
  121: { arch: "star", body: "#8a5ab8", sec: "#7a4aa8", layers: 2, gemC: "#e8485a" },
  122: { arch: "biped", body: "#f8c8d8", belly: "#f8f0f4", pads: true, hair: "#5a8ad0", legR: 0.12, armDown: 0.5 },
  123: { arch: "biped", body: "#9fd05f", belly: "#cfe8a0", scythes: true, wings: "insect", wingC: "#e8f0d8", wingSpan: 1.3, fat: 0.95, legLen: 1.3 },
  124: { arch: "biped", body: "#d05a7a", dress: "#d05a7a", hair: "#f0d860", belly: "#e8a0b0", fat: 1.1, padsC: "#f8f8f8", pads: true },
  125: { arch: "biped", body: "#f0c030", belly: "#f6d860", fat: 1.05, antennae: true, tail: "cone", tailC: "#1c1c26", tailR: 0.16 },
  126: { arch: "biped", body: "#e87444", belly: "#f0c060", fat: 1.1, headFlame: true, tail: "flame" },
  127: { arch: "biped", body: "#b8a890", belly: "#c8b8a0", fat: 1.2, pinsirHorns: true },
  128: { arch: "quad", body: "#b8844a", belly: "#d8a868", fat: 1.25, horn: true, hornC: "#e8e0d0", hornLen: 0.7, mane: true, maneC: "#8a5a2a", tail: "multi", tailN: 3, tailC: "#a87444" },
  129: { arch: "fish", body: "#e8744a", belly: "#f8e8d8", finC: "#f0e8e0", whiskers: true, fat: 1.15 },
  130: { arch: "serpent", body: "#5a8ad0", belly: "#f0e0c0", segs: 8, fat: 1.7, lift: 0.85, hood: false, horn: false, snout: true, snoutC: "#cfe0f0", barbels: true, backFins: true, finC: "#cfe0f0", eye: "#d84848", fangs: true, fangLen: 1.4 },
  131: { arch: "quad", body: "#5a8ad0", belly: "#f0e4c8", fat: 1.4, neck: 1.2, legLen: 0.45, shell: "#7a6a8a", shellRim: "#9a8aa8", snout: true, horn: true, hornLen: 0.35, ears: true, earLen: 0.45 },
  132: { arch: "blob", body: "#d08ad0", squat: 0.82, eyeStyle: "bead", armsOff: true, legsOff: true },
  133: { arch: "quad", body: "#c9844a", belly: "#e8c898", mane: true, maneC: "#f0e0c8", tail: "fluff", tailC: "#c9844a", tailTip: "#f0e0c8", ears: true, earLen: 1.1 },
  134: { arch: "quad", body: "#7ab8e8", belly: "#a8d4f0", ears: true, earC: "#5a98c8", earLen: 1.0, tail: "fin", tailC: "#5a98c8", mane: true, maneC: "#f8f8fc" },
  135: { arch: "quad", body: "#f0d030", belly: "#f8ec90", spikes: 4, spikeC: "#f8ec90", ears: true, earLen: 1.2, tail: "fin", tailC: "#f8ec90" },
  136: { arch: "quad", body: "#e8744a", belly: "#f8d8a8", mane: true, maneC: "#f0e0a0", tail: "fluff", tailC: "#f0e0a0", ears: true, earLen: 1.0 },
  137: { arch: "floaty", body: "#e87a9a", sec: "#7ab8d8", poly: true },
  138: { arch: "tentacle", body: "#7ab8e8", spiralShell: true, shellC: "#cfc0a4", tents: 6 },
  139: { arch: "tentacle", body: "#6aa8d8", fat: 1.25, spiralShell: true, shellC: "#bfb094", spikes: 3, tents: 8 },
  140: { arch: "bivalve", body: "#b8844a", legs: true, faceC: "#2a2a36", eye: "#e8c84a", spikes: false },
  141: { arch: "biped", body: "#b8844a", belly: "#d8a868", scythes: true, scytheC: "#e8e0d0", fat: 1.05, legLen: 1.2 },
  142: { arch: "bat", body: "#b8a8c8", wingC: "#a898b8", wingIn: "#c8b8d8", fat: 1.3, wingSpan: 2.6, mouth: true, mouthC: "#5a4a6a" },
  143: { arch: "blob", body: "#3f6a8a", belly: "#f0e0c0", fat: 1.5, squat: 1.0, ears: true, earLen: 0.35, eyeStyle: "bead" },
  144: { arch: "bird", body: "#7ab8e8", belly: "#cfe4f4", wingC: "#5a98d8", fat: 1.15, crest: true, crestN: 3, crestC: "#5a98d8", tailLen: 1.8, neck: 0.6 },
  145: { arch: "bird", body: "#f0d030", belly: "#f8ec90", wingC: "#e8c020", fat: 1.15, crest: true, crestN: 3, crestC: "#e8c020", beakLen: 1.0 },
  146: { arch: "bird", body: "#e8a030", belly: "#f0c060", wingFlame: true, fat: 1.15, crest: true, crestC: "#ff7b29", neck: 0.5 },
  147: { arch: "serpent", body: "#7ab8e8", belly: "#f0f0f8", segs: 5, fat: 0.85, earFins: true, finC: "#f8f8fc" },
  148: { arch: "serpent", body: "#5a9ad8", belly: "#e8f0f8", segs: 6, fat: 1.0, lift: 0.8, horn: true, earFins: true, finC: "#f8f8fc", orbs: true, orbC: "#e2ecf6" },
  149: { arch: "biped", body: "#f3ad5c", belly: "#f8e6bc", fat: 1.28, wings: "round", wingC: "#8fc8dc", wingSpan: 1.0, antennae: true, tail: "thick", tailC: "#f3ad5c", horn: false },
  150: { arch: "biped", body: "#d8d0e0", belly: "#b8a8d0", fat: 0.92, legLen: 1.4, tail: "thick", tailC: "#8a6ab8", ears: true, earLen: 0.7, earTilt: 0.2 },
  151: { arch: "biped", body: "#f8c8d8", belly: "#fce4ee", headR: 1.05, legLen: 0.9, tail: "thin", tailC: "#f0b0c8", tailTip: "#f0b0c8", ears: true, earLen: 0.8, eye: "#5878c8" },
};

const BUILDERS: Record<string, (s: any) => Built> = {
  quad: bQuad, biped: bBiped, bird: bBird, serpent: bSerpent, fish: bFish,
  blob: bBlob, larva: bLarva, cocoon: bCocoon, wingbug: bWingbug, crab: bCrab,
  tentacle: bTentacle, bivalve: bBivalve, golem: bGolem, plant: bPlant,
  floaty: bFloaty, ball: bBall, star: bStar, eggs: bEggs, ghost: bGhost,
  bat: bBat, mound: bMound,
};

export const MON3D_SPECS = S;

// ================================================================== facade
export function buildMonRig(sp: number, height: number): MonRig {
  MATS = []; FLAMES = []; EYES = [];
  const spec = S[sp] || { arch: "blob", body: "#b8a8c8" };
  const built = (BUILDERS[spec.arch] || bBlob)(spec);
  const mats = MATS, flames = FLAMES, eyes = EYES;
  MATS = []; FLAMES = []; EYES = [];

  const group = new THREE.Group();
  built.root.scale.multiplyScalar(height);
  group.add(built.root);
  const levitates = !!(built.levitate || spec.levitate);
  const parts = built.parts || {};
  const seed = Math.random() * 9;
  let t = seed;
  let castCat: CastCat | null = null;
  let castT = 0, castDur = 0;

  return {
    group,
    levitates,
    mats,
    cast(cat: CastCat) { castCat = cat; castT = 0; castDur = CAST_DUR[cat] || 0.45; },
    anim(dt: number, ctx: RigCtx) {
      t += dt;
      built.animator?.(dt, ctx, t);
      const bl = blinkScale(t, seed);
      for (const e of eyes) e.scale.y = bl;
      for (const f of flames) {
        const k = 1 + Math.sin(t * 13 + f.position.x * 7 + seed) * 0.16;
        f.scale.set(1, k, 1);
      }
      if (levitates) built.root.position.y = Math.sin(t * 1.8 + seed) * 0.05 * height;
      // attack/cast overlay runs after locomotion so it wins the contested joints
      if (castCat) {
        castT += dt;
        const u = castT / castDur;
        poseCast(parts, castCat, u >= 1 ? 1 : u);
        if (u >= 1) castCat = null;
      }
    },
    setOpacity(o: number) {
      for (const r of mats) {
        const target = o * r.baseOp;
        r.m.transparent = target < 1;
        r.m.opacity = target;
      }
    },
    tint(c: THREE.Color, k: number) {
      for (const r of mats) {
        if (k <= 0) r.m.color.copy(r.base);
        else r.m.color.copy(r.base).lerp(c, Math.min(1, k * 0.85));
      }
    },
    dispose() {
      for (const r of mats) r.m.dispose();
    },
  };
}
