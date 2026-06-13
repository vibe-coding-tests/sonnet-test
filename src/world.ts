// Overworld: full-scale Kanto laid out like the real Gen 1 town map — all ten
// settlements (Pallet through Cinnabar plus the Indigo Plateau), eight gyms,
// Viridian Forest, Mt. Moon, Rock Tunnel, the Power Plant across the river,
// Cycling Road, Safari Zone, the Routes 12/13 causeway, Seafoam Islands and
// Victory Road. Day-night cycle, animated water, instanced vegetation,
// collision and the minimap image.
import * as THREE from "three";

// Full-scale Kanto: the layout below is authored in compact "design space"
// (the original mini-Kanto coordinates) and expanded by MAP_SCALE at build
// time. All World query functions (height/zoneAt/distToPath...) take WORLD
// coordinates; distToPath returns DESIGN-space distance so the path-width
// thresholds scale with the map.
export const MAP_SCALE = 2;
export const WORLD_R = 300 * MAP_SCALE;   // world half-size
const W = (v: number) => v * MAP_SCALE;   // design -> world
const WATER_Y = -0.8;

// ---------------------------------------------------------------- utilities
function hash2(ix, iz) {
  const s = Math.sin(ix * 127.1 + iz * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  return (a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz) * 2 - 1;
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
function distSeg(x, z, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
  const t = l2 ? clamp(((x - ax) * dx + (z - az) * dz) / l2, 0, 1) : 0;
  const px = ax + dx * t, pz = az + dz * t;
  return Math.hypot(x - px, z - pz);
}
function lerpStops(stops, t) { // stops: [[t, value|Color array]] sorted
  if (t <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const k = (t - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]);
      const a = stops[i - 1][1], b = stops[i][1];
      if (Array.isArray(a)) return a.map((v, j) => lerp(v, b[j], k));
      return lerp(a, b, k);
    }
  }
  return stops[stops.length - 1][1];
}
const C = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
const HEIGHT_CACHE_RES = 401; // Match the terrain mesh samples across the 1200m world.
const SKY_STOPS = [
  [0.0, C("#16213f")], [0.045, C("#7fa6d8")], [0.28, C("#87b9ea")], [0.5, C("#85a9da")],
  [0.555, C("#e98a52")], [0.60, C("#27224b")], [0.65, C("#0a1124")], [0.93, C("#0a1124")], [0.985, C("#101a33")], [1.0, C("#16213f")],
];
const FOG_STOPS = [
  [0.0, C("#1a2440")], [0.045, C("#9db8d8")], [0.28, C("#a8c4dd")], [0.5, C("#a0b4d4")],
  [0.555, C("#d89a6a")], [0.60, C("#23203f")], [0.65, C("#0c1322")], [0.93, C("#0c1322")], [1.0, C("#1a2440")],
];
const SUNI_STOPS = [[0, 0.25], [0.05, 1.6], [0.28, 2.3], [0.5, 1.7], [0.555, 0.9], [0.6, 0.28], [0.65, 0.22], [0.93, 0.22], [1, 0.25]];
const HEMI_STOPS = [[0, 0.25], [0.05, 0.75], [0.28, 0.95], [0.52, 0.75], [0.6, 0.22], [0.65, 0.16], [0.93, 0.16], [1, 0.25]];
function lerpColorStops(stops, t, out) {
  if (t <= stops[0][0]) {
    const c = stops[0][1];
    out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
    return out;
  }
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const k = (t - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]);
      const a = stops[i - 1][1], b = stops[i][1];
      out[0] = lerp(a[0], b[0], k);
      out[1] = lerp(a[1], b[1], k);
      out[2] = lerp(a[2], b[2], k);
      return out;
    }
  }
  const c = stops[stops.length - 1][1];
  out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
  return out;
}

export function makeTextSprite(text, { size = 26, color = "#fff", bg = "rgba(10,14,22,.65)", pad = 10 } = {}) {
  const cv = document.createElement("canvas");
  const ctx = cv.getContext("2d");
  ctx.font = `bold ${size}px Verdana,sans-serif`;
  const w = Math.ceil(ctx.measureText(text).width) + pad * 2;
  cv.width = w; cv.height = size + pad * 1.6;
  const c2 = cv.getContext("2d");
  if (bg) { c2.fillStyle = bg; c2.beginPath(); c2.roundRect(0, 0, cv.width, cv.height, 8); c2.fill(); }
  c2.font = `bold ${size}px Verdana,sans-serif`;
  c2.fillStyle = color; c2.textAlign = "center"; c2.textBaseline = "middle";
  c2.fillText(text, cv.width / 2, cv.height / 2 + 1);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sp.scale.set(cv.width / 64, cv.height / 64, 1);
  return sp;
}

// Simple low-poly humanoid for NPCs / trainers. Limbs pivot at the hip and
// shoulder and live in userData so the game can animate strolling townsfolk.
export function buildPerson({ shirt = "#3b6fe2", pants = "#39435e", skin = "#eebd93", hat = null, hair = "#5a4632", phone = false } = {} as any) {
  const g = new THREE.Group();
  const mat = (c) => new THREE.MeshLambertMaterial({ color: c });
  const legGeo = new THREE.BoxGeometry(0.18, 0.62, 0.24);
  legGeo.translate(0, -0.31, 0);                       // pivot at the hip
  const legL = new THREE.Mesh(legGeo, mat(pants));
  legL.position.set(-0.11, 0.62, 0);
  const legR = new THREE.Mesh(legGeo, mat(pants));
  legR.position.set(0.11, 0.62, 0);
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.62, 0.32), mat(shirt));
  body.position.y = 0.93;
  const armGeo = new THREE.BoxGeometry(0.14, 0.55, 0.2);
  armGeo.translate(0, -0.225, 0);                      // pivot at the shoulder
  const armL = new THREE.Mesh(armGeo, mat(shirt));
  armL.position.set(-0.36, 1.18, 0);
  const armR = new THREE.Mesh(armGeo, mat(shirt));
  armR.position.set(0.36, 1.18, 0);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), mat(skin));
  head.position.y = 1.5;
  const hairM = new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), mat(hair));
  hairM.position.y = 1.53;
  g.add(legL, legR, body, armL, armR, head, hairM);
  g.userData.legL = legL; g.userData.legR = legR;
  g.userData.armL = armL; g.userData.armR = armR; g.userData.head = head;
  if (hat) {
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.05, 12), mat(hat));
    brim.position.y = 1.66;
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.18, 12), mat(hat));
    top.position.y = 1.76;
    g.add(brim, top);
  }
  if (phone) {
    // a few city folks checking their PokéGear
    head.position.z = 0.07; head.rotation.x = 0.55;
    hairM.position.z = 0.06; hairM.rotation.x = 0.45;
    const ph = new THREE.Group();
    const slab = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.3, 0.025), mat("#16181f"));
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.13, 0.26),
      new THREE.MeshBasicMaterial({ color: "#9fd2ff" })
    );
    screen.position.z = 0.014;
    // soft screen-light halo that reads at night
    const glowTex = (() => {
      const c = document.createElement("canvas"); c.width = c.height = 64;
      const x = c.getContext("2d")!;
      const gr = x.createRadialGradient(32, 32, 2, 32, 32, 30);
      gr.addColorStop(0, "rgba(159,210,255,0.65)"); gr.addColorStop(1, "rgba(159,210,255,0)");
      x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(c);
    })();
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.scale.set(0.8, 0.8, 1);
    glow.position.z = 0.12;
    ph.add(slab, screen, glow);
    ph.position.set(0.12, 1.16, 0.34);
    ph.rotation.x = -0.85;
    // bring the scrolling arm up to the gear (pivot is at the shoulder now)
    armR.position.set(0.32, 1.22, 0.06);
    armR.rotation.x = -1.15;
    g.add(ph);
    g.userData.phone = ph;
    g.userData.glow = glow;
  }
  g.traverse((o) => { if ((o as any).isMesh) { o.castShadow = true; } });
  return g;
}

// ------------------------------------------------------------ Kanto layout
// Faithful to the Gen 1 town map: west column Pallet→Viridian→Pewter, the
// northern ridge Mt. Moon between Pewter and Cerulean, Saffron dead center
// ringed by Routes 5/6/7/8, Lavender east with Rock Tunnel above it, the
// Power Plant across the river, Celadon west, Cycling Road dropping south to
// Fuchsia + Safari Zone, the sea routes 12/13 down the east coast, 19/20/21
// across the south with Seafoam + Cinnabar, and Victory Road climbing to the
// Indigo Plateau in the far northwest. (All coordinates: design space.)
const TOWNS = [
  { id: "pallet",    x: -95, z: 130,  r: 22, g: 3.0 },
  { id: "viridian",  x: -95, z: 30,   r: 26, g: 3.2 },
  { id: "pewter",    x: -95, z: -135, r: 25, g: 4.2 },
  { id: "cerulean",  x: 75,  z: -160, r: 23, g: 3.6 },
  { id: "saffron",   x: 75,  z: -25,  r: 26, g: 3.4 },
  { id: "celadon",   x: -30, z: -25,  r: 24, g: 3.3 },
  { id: "lavender",  x: 205, z: -25,  r: 20, g: 3.8 },
  { id: "vermilion", x: 75,  z: 95,   r: 24, g: 3.0 },
  { id: "fuchsia",   x: -30, z: 175,  r: 24, g: 3.1 },
  { id: "cinnabar",  x: -95, z: 262,  r: 19, g: 2.8 },
];
const MTMOON   = { x: -15,  z: -175, r: 46, caveR: 21 };
const ROCKTUN  = { x: 195,  z: -125, r: 28, caveR: 13 };
const CCAVE    = { x: 40,   z: -200, r: 18, caveR: 12 };
const VICTORY  = { x: -200, z: -135, r: 65 };
const INDIGO   = { x: -215, z: -200 };           // plateau summit (zone circle r 26)
const FOREST   = { x: -100, z: -55, r: 31 };
const SAFARI   = { x: 5,    z: 130, r: 26 };     // attached to Fuchsia's north side
const SEAFOAM  = { x: -30,  z: 246 };
const PPLANT   = { x: 250,  z: -92 };
const DIGLETT  = { x: 140,  z: 70,  r: 13 };
// the northeastern river: under Nugget Bridge, around Rock Tunnel, past the
// Power Plant and out into the east sea (Routes 9/10 water).
const RIVER = [[10, -180], [45, -178], [70, -185], [95, -198], [130, -198], [165, -185], [200, -165], [220, -150], [228, -122], [231, -95], [233, -55], [236, -18], [238, 5]];

const PATHS = [
  [[-95, 152], [-95, 166]],                                                   // pallet beach
  [[-95, 108], [-95, 82], [-95, 58], [-95, 30], [-95, 4]],                    // route 1 + viridian main street
  [[-95, 4], [-97, -12], [-99, -24], [-108, -40], [-104, -58], [-96, -74], [-98, -88], [-95, -110]], // route 2 / forest
  [[-86, -142], [-70, -150], [-52, -163], [-37, -172], [-15, -175]],          // route 3 → Mt Moon
  [[-2, -173], [10, -171], [24, -167], [40, -163], [54, -160]],               // route 4 → Cerulean
  [[75, -183], [75, -205], [82, -215], [100, -225], [120, -235], [132, -242]],// routes 24/25 → Bill
  [[72, -207], [60, -204], [50, -201]],                                       // cerulean cave bank
  [[75, -137], [75, -100], [75, -51]],                                        // route 5
  [[75, 1], [75, 40], [75, 71]],                                              // route 6
  [[49, -25], [20, -25], [-6, -25]],                                          // route 7
  [[101, -25], [140, -25], [185, -25]],                                       // route 8
  [[98, -160], [130, -155], [160, -148], [184, -140], [195, -134]],           // route 9 → Rock Tunnel
  [[195, -114], [198, -90], [202, -65], [205, -48]],                          // route 10 → Lavender
  [[99, 95], [125, 100], [150, 103], [172, 103], [195, 98], [214, 95]],       // route 11 → coast junction
  [[205, -5], [212, 20], [216, 55], [214, 95], [205, 128], [185, 148], [162, 160]], // routes 12/13 causeway
  [[160, 162], [120, 178], [80, 185], [40, 182], [-6, 176]],                  // routes 14/15 → Fuchsia
  [[-30, 2], [-30, 50], [-30, 100], [-30, 146]],                              // cycling road (16/17/18)
  [[-30, 206], [-32, 224], [-34, 238]],                                       // route 19 sandbar → Seafoam
  [[-121, 25], [-150, 18], [-178, 8]],                                        // route 22
  [[-183, 2], [-192, -25], [-197, -50], [-198, -62]],                         // route 23
  [[-198, -62], [-202, -85], [-206, -110], [-210, -140], [-213, -170], [-215, -190]], // victory road ramp
];

export const ZONE_NAMES = {
  pallet: "Pallet Town", viridian: "Viridian City", pewter: "Pewter City",
  cerulean: "Cerulean City", saffron: "Saffron City", celadon: "Celadon City",
  lavender: "Lavender Town", vermilion: "Vermilion City", fuchsia: "Fuchsia City",
  cinnabar: "Cinnabar Island", indigo: "Indigo Plateau",
  "route-1": "Route 1", "route-2": "Route 2", "route-3": "Route 3", "route-4": "Route 4",
  "route-5": "Route 5", "route-6": "Route 6", "route-7": "Route 7", "route-8": "Route 8",
  "route-9": "Route 9", "route-10": "Route 10", "route-11": "Route 11",
  "route-12": "Routes 12-13", "route-15": "Routes 14-15", "route-21": "Route 21",
  "route-22": "Route 22", "route-23": "Route 23", "route-24": "Routes 24-25",
  "cycling-road": "Cycling Road", "viridian-forest": "Viridian Forest",
  "mt-moon": "Mt. Moon", "mtmoon-cave": "Mt. Moon Caverns", "rock-tunnel": "Rock Tunnel",
  "cerulean-cave": "Cerulean Cave", "power-plant": "Power Plant", safari: "Safari Zone",
  seafoam: "Seafoam Islands", "victory-road": "Victory Road", diglett: "Diglett's Cave",
  sea: "Open Sea", river: "Kanto River", grassland: "Kanto Wilds",
};
const ZONE_BIOME = {
  "mtmoon-cave": "cave", "cerulean-cave": "cave", "rock-tunnel": "cave",
  "viridian-forest": "forest",
  "victory-road": "mountain", "mt-moon": "mountain", indigo: "mountain", "route-23": "mountain",
  sea: "lake", river: "lake", seafoam: "lake",
  pallet: "town", viridian: "town", pewter: "town", cerulean: "town", saffron: "town",
  celadon: "town", lavender: "town", vermilion: "town", fuchsia: "town", cinnabar: "town",
};

// --------------------------------------------------------------- weather
export type WeatherId = "clear" | "rain" | "storm" | "fog";
export const WEATHER_META: Record<WeatherId, { label: string; icon: string }> = {
  clear: { label: "Clear", icon: "☀" },
  rain: { label: "Rain", icon: "🌧" },
  storm: { label: "Storm", icon: "⛈" },
  fog: { label: "Fog", icon: "🌫" },
};

interface AABB { min: THREE.Vector3; max: THREE.Vector3 }
export interface Interactable {
  id: string; pos: THREE.Vector3; r: number; label: string;
  [k: string]: any;
}
export interface BerryBush { pos: THREE.Vector3; ready: boolean; respawnT: number; idx: number }

// ------------------------------------------------------------------- World
export class World {
  scene: THREE.Scene;
  timeOfDay: number;
  cycleLen: number;
  waterY: number;
  uTime: { value: number };
  colliderBoxes: AABB[];
  cylGrid: Map<string, { x: number; z: number; r: number }[]>;
  interactables: Interactable[];
  treeSpots: { x: number; z: number; h: number; s: number }[] = [];
  lamps: { light: THREE.PointLight; mat: any }[];
  windows: any[];
  interiors: AABB[];
  buildingPads: { minX: number; maxX: number; minZ: number; maxZ: number; g: number; fall: number }[];
  heightCache: Float32Array | null = null;
  heightCacheN = 0;
  heightCacheStep = 0;
  heightCacheMin = -WORLD_R;
  heightCacheMax = WORLD_R;
  caveDim: number;
  _v: THREE.Vector3;
  spots: Record<string, THREE.Vector3>;
  gymPos: Record<string, THREE.Vector3>;
  centers: { id: string; pos: THREE.Vector3 }[];
  townSpawn!: THREE.Vector3;
  minimapCanvas!: HTMLCanvasElement;
  hemi!: THREE.HemisphereLight;
  sun!: THREE.DirectionalLight;
  sunSprite!: THREE.Sprite;
  moonSprite!: THREE.Sprite;
  stars!: THREE.Points;
  clouds!: THREE.Sprite[];
  terrain!: THREE.Mesh;
  waterMat!: THREE.ShaderMaterial;
  grassClusters!: THREE.Vector3[];
  caveGateGroup: THREE.Group | null = null;
  caveGateBox: AABB | null = null;
  caves: { x: number; z: number; r: number }[] = [];
  caveDrips: THREE.Vector3[] = [];
  // weather
  weather: WeatherId = "clear";
  weatherW = 0;                       // 0..1 intensity of the current weather
  weatherT = 70;                      // seconds until the weather rolls again
  lightningT = 6;
  flash = 0;
  onThunder: ((at: THREE.Vector3) => void) | null = null;
  rainLines!: THREE.LineSegments;
  rainOff!: Float32Array;
  rainN = 520;
  // berries
  berries: BerryBush[] = [];
  berryBushI!: THREE.InstancedMesh;
  berryDotI!: THREE.InstancedMesh;
  _berryM4 = new THREE.Matrix4();
  // ambient wildlife (pure dressing — separate from wild Pokémon AI)
  flocks: { cx: number; cz: number; r: number; h: number; spd: number; ph: number; birds: THREE.Mesh[]; drift: number }[] = [];
  butterflies: { home: THREE.Vector3; mesh: THREE.Group; ph: number; r: number }[] = [];
  fireflies!: THREE.Points;
  fireflyHomes: THREE.Vector3[] = [];
  _skyRgb = [0, 0, 0];
  _fogRgb = [0, 0, 0];
  _skyGrey = new THREE.Color(0x6a7587);
  _fogGrey = new THREE.Color(0x76808f);
  _sunDir = new THREE.Vector3();
  _spriteDir = new THREE.Vector3();
  _thunderAt = new THREE.Vector3();

  constructor(scene) {
    this.scene = scene;
    this.timeOfDay = 0.18;            // 0..1, day until .58
    this.cycleLen = 600;              // seconds per full day
    this.waterY = WATER_Y;
    this.uTime = { value: 0 };
    this.colliderBoxes = [];
    this.cylGrid = new Map();         // spatial hash for cylinder colliders
    this.interactables = [];
    this.lamps = [];
    this.windows = [];
    this.interiors = [];
    this.buildingPads = [];           // terrain is flattened to each building's floor + doorstep
    this.caveDim = 0;
    this._v = new THREE.Vector3();

    // legendary landmarks (the real Gen 1 locations)
    this.spots = {
      articuno: new THREE.Vector3(W(-36), 0, W(242)),   // Seafoam Islands
      zapdos: new THREE.Vector3(W(250), 0, W(-108)),    // Power Plant yard
      moltres: new THREE.Vector3(W(-196), 0, W(-148)),  // Victory Road slope
      mewtwo: new THREE.Vector3(W(40), 0, W(-200)),     // Cerulean Cave
      mew: new THREE.Vector3(W(57), 0, W(124)),         // the truck by the S.S. Anne dock
    };
    // gym door positions: design gym centers, world space, 6.2m inside the door
    const gp = (x, z, y) => new THREE.Vector3(W(x), y, W(z) - 6.2);
    this.gymPos = {
      boulder: gp(-88, -142, 4.2),   // Pewter
      cascade: gp(84, -146, 3.6),    // Cerulean
      thunder: gp(58, 106, 3.0),     // Vermilion
      rainbow: gp(-44, -12, 3.3),    // Celadon
      soul: gp(-44, 188, 3.1),       // Fuchsia
      marsh: gp(92, -12, 3.4),       // Saffron
      volcano: gp(-95, 268, 2.8),    // Cinnabar
      earth: gp(-110, 42, 3.2),      // Viridian
    };
    this.centers = [];                // [{id, pos}] Pokemon Center respawn points

    this.buildSky();
    this.buildWater();
    this.buildKanto();      // registers building pads (flattened footprints)
    this.buildHeightCache();
    this.buildTerrain();    // bake the ground AFTER pads exist, so it sits flush
    this.buildProps();
    this.buildBerries();
    this.buildRain();
    this.buildWildlife();
    for (const k in this.spots) this.spots[k].y = this.height(this.spots[k].x, this.spots[k].z);
    this.townSpawn = new THREE.Vector3(W(-95), this.height(W(-95), W(134)), W(134)); // Pallet Town
    this.buildMinimap();
  }

  // ---------------------------------------------------------- height/zones
  carve(h, x, z, pts, w) {            // pts: [x, z, targetHeight][] (design space)
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az, ah] = pts[i], [bx, bz, bh] = pts[i + 1];
      const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
      const t = l2 ? clamp(((x - ax) * dx + (z - az) * dz) / l2, 0, 1) : 0;
      const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
      const k = smooth(w, w * 0.45, d);
      if (k > 0) h = lerp(h, lerp(ah, bh, t), k * 0.96);
    }
    return h;
  }
  // South coast: pushes far south around Fuchsia's peninsula, recedes at the
  // Pallet and Lavender ends (Routes 21 and 12/13 water).
  coastZ(x) { return 170 + 62 * Math.exp(-(((x - 55) / 115) ** 2)) - 9 * Math.sin((x + 95) / 80); }
  heightExact(wx, wz) {
    // world -> design space; all the math below is authored in design space
    const x = wx / MAP_SCALE, z = wz / MAP_SCALE;
    let h = 2 + vnoise(x * 0.02, z * 0.02) * 2.2 + vnoise(x * 0.055 + 9, z * 0.055) * 0.9;
    // Victory Road massif (northwest)
    const dv = Math.hypot(x - VICTORY.x, z - VICTORY.z);
    const mv = smooth(VICTORY.r, 22, dv);
    if (mv > 0) h += mv * (7 + Math.max(0, vnoise(x * 0.03 + 2, z * 0.03)) * 16 + vnoise(x * 0.09, z * 0.09 + 3) * 2.5);
    // Mt. Moon massif (north, between Pewter and Cerulean)
    const dm = Math.hypot(x - MTMOON.x, z - MTMOON.z);
    const mm = smooth(MTMOON.r, 16, dm);
    if (mm > 0) h += mm * (6 + Math.max(0, vnoise(x * 0.033 + 7, z * 0.033)) * 14 + vnoise(x * 0.1, z * 0.1 + 5) * 2.2);
    // Rock Tunnel ridge (between Route 9 and Lavender)
    const dt2 = Math.hypot(x - ROCKTUN.x, z - ROCKTUN.z);
    const mt = smooth(ROCKTUN.r, 11, dt2);
    if (mt > 0) h += mt * (5 + Math.max(0, vnoise(x * 0.04 + 4, z * 0.04)) * 11 + vnoise(x * 0.1, z * 0.1 + 8) * 1.8);
    // Cerulean Cave knoll (across the water NW of Cerulean)
    const dk = Math.hypot(x - CCAVE.x, z - CCAVE.z);
    const mk = smooth(CCAVE.r, 8, dk);
    if (mk > 0) h += mk * 9;
    // route corridors through the mountains
    h = this.carve(h, x, z, [[-86, -142, 4.6], [-70, -150, 5], [-52, -163, 5], [-37, -172, 5], [-20, -175, 5]], 8); // route 3
    h = this.carve(h, x, z, [[-2, -173, 5], [10, -171, 5], [24, -167, 4.8], [40, -163, 4.4], [54, -160, 3.8]], 8);  // route 4
    h = this.carve(h, x, z, [[184, -140, 4.4], [190, -138, 4.6], [195, -133, 4.6]], 7);                             // rock tunnel north
    h = this.carve(h, x, z, [[195, -117, 4.6], [196, -104, 4.4], [199, -88, 4.2], [203, -65, 4], [205, -48, 3.9]], 7); // rock tunnel south
    h = this.carve(h, x, z, [[-198, -62, 5], [-202, -85, 9.5], [-206, -110, 14], [-210, -140, 18.5], [-213, -170, 22.5], [-215, -190, 26]], 7); // victory ramp
    h = this.carve(h, x, z, [[-30, 0, 6], [-30, 48, 5.2], [-30, 96, 4.3], [-30, 146, 3.3]], 6.5); // cycling road downhill
    // Indigo Plateau summit
    const ds = Math.hypot(x + 217, z + 203);
    const ts = smooth(26, 14, ds);
    if (ts > 0) h = lerp(h, 26, ts);
    // cave chambers
    const tc = smooth(MTMOON.caveR + 2, MTMOON.caveR - 4, dm);
    if (tc > 0) h = lerp(h, 5, tc);
    const trt = smooth(ROCKTUN.caveR + 2, ROCKTUN.caveR - 4, dt2);
    if (trt > 0) h = lerp(h, 4.6, trt);
    const tkc = smooth(CCAVE.caveR + 2, CCAVE.caveR - 4, dk);
    if (tkc > 0) h = lerp(h, 4.2, tkc);
    h = this.carve(h, x, z, [[58, -200, 4.2], [50, -200, 4.2]], 5); // cerulean cave mouth
    // southern ocean
    const to = smooth(0, 24, z - this.coastZ(x));
    if (to > 0) h = lerp(h, -6, to);
    // east sea (beyond the Routes 12/13 causeway)
    const te = smooth(0, 20, x - (233 + 4 * Math.sin(z * 0.05 + 1))) * smooth(-16, -4, z);
    if (te > 0) h = lerp(h, -6, te);
    // Vermilion bay (enclosed harbor south of town)
    const dvb = ((x - 85) / 52) ** 2 + ((z - 150) / 26) ** 2;
    if (dvb < 1) h = lerp(h, -5, smooth(1, 0.55, dvb));
    // Route 12 lagoon (calm water west of the causeway)
    const dlg = ((x - 178) / 30) ** 2 + ((z - 65) / 55) ** 2;
    if (dlg < 1) h = lerp(h, -4.5, smooth(1, 0.5, dlg));
    // river
    let dr = 1e9;
    for (let i = 0; i < RIVER.length - 1; i++) dr = Math.min(dr, distSeg(x, z, RIVER[i][0], RIVER[i][1], RIVER[i + 1][0], RIVER[i + 1][1]));
    if (dr < 10) {
      const depth = Math.abs(z + 95) < 8 ? -1.25 : -2.4; // wadeable ford by the Power Plant
      h = lerp(h, depth, smooth(10, 6, dr));
    }
    // Cinnabar Island
    const dci = Math.hypot(x + 95, z - 262);
    if (dci < 26) h = Math.max(h, lerp(3.2, -2.5, smooth(8, 26, dci)));
    // Seafoam islets
    const di1 = Math.hypot(x + 36, z - 242), di2 = Math.hypot(x + 20, z - 252);
    if (di1 < 11) h = Math.max(h, lerp(2.6, -1, di1 / 11));
    if (di2 < 8) h = Math.max(h, lerp(1.9, -1, di2 / 8));
    // Route 21 islets (Tangela country)
    const di3 = Math.hypot(x + 90, z - 205), di4 = Math.hypot(x + 103, z - 222);
    if (di3 < 8) h = Math.max(h, lerp(2.2, -1, di3 / 8));
    if (di4 < 6) h = Math.max(h, lerp(1.8, -1, di4 / 6));
    // wadeable sandbar Fuchsia → Seafoam (Route 19)
    const dsb = distSeg(x, z, -29, 206, -34, 238);
    if (dsb < 6) h = Math.max(h, -1.45 + vnoise(x * 0.3, z * 0.3) * 0.15);
    // Nugget Bridge causeway over the river (Route 24)
    const dnb = distSeg(x, z, 75, -204, 75, -180);
    if (dnb < 3.4) h = Math.max(h, 2.55);
    // Routes 12/13 causeway over the lagoon edge
    let dcw = 1e9;
    const CW = [[205, -5], [212, 20], [216, 55], [214, 95], [205, 128], [185, 148], [162, 160]];
    for (let i = 0; i < CW.length - 1; i++) dcw = Math.min(dcw, distSeg(x, z, CW[i][0], CW[i][1], CW[i + 1][0], CW[i + 1][1]));
    if (dcw < 5.5) h = Math.max(h, 2.9 - smooth(3, 5.5, dcw) * 1.2);
    // town plateaus (after the water so coastal towns stay dry)
    for (const t of TOWNS) {
      const d = Math.hypot(x - t.x, z - t.z);
      const tt = smooth(t.r + 9, t.r - 7, d);
      if (tt > 0) h = lerp(h, t.g, tt);
    }
    // safari pond
    const dp = Math.hypot((x - 10) / 13, (z - 124) / 10);
    if (dp < 1) h = lerp(h, -2.4, smooth(1, 0.55, dp));
    // building pads: level the ground to each building's floor + doorstep so
    // they're enterable on slopes (pads are in WORLD space, hence wx/wz here)
    if (this.buildingPads.length) {
      for (const pad of this.buildingPads) {
        const ox = Math.max(pad.minX - wx, 0, wx - pad.maxX);
        const oz = Math.max(pad.minZ - wz, 0, wz - pad.maxZ);
        if (ox >= pad.fall || oz >= pad.fall) continue;
        const dout = Math.hypot(ox, oz);
        if (dout < pad.fall) h = lerp(h, pad.g, 1 - smooth(0, pad.fall, dout));
      }
    }
    // world border mountains
    const b = smooth(252, 295, Math.max(Math.abs(x), Math.abs(z)));
    if (b > 0) h += b * (20 + vnoise(x * 0.05, z * 0.05) * 4);
    return h;
  }
  buildHeightCache() {
    const n = HEIGHT_CACHE_RES;
    const min = -WORLD_R;
    const max = WORLD_R;
    const step = (max - min) / (n - 1);
    const data = new Float32Array(n * n);
    for (let iz = 0; iz < n; iz++) {
      const z = min + iz * step;
      for (let ix = 0; ix < n; ix++) {
        const x = min + ix * step;
        data[iz * n + ix] = this.heightExact(x, z);
      }
    }
    this.heightCache = data;
    this.heightCacheN = n;
    this.heightCacheStep = step;
    this.heightCacheMin = min;
    this.heightCacheMax = max;
  }
  height(wx, wz) {
    const data = this.heightCache;
    if (!data || wx < this.heightCacheMin || wx > this.heightCacheMax || wz < this.heightCacheMin || wz > this.heightCacheMax) {
      return this.heightExact(wx, wz);
    }
    const n = this.heightCacheN;
    const gx = (wx - this.heightCacheMin) / this.heightCacheStep;
    const gz = (wz - this.heightCacheMin) / this.heightCacheStep;
    const ix = Math.min(n - 2, Math.max(0, Math.floor(gx)));
    const iz = Math.min(n - 2, Math.max(0, Math.floor(gz)));
    const tx = gx - ix;
    const tz = gz - iz;
    const i = iz * n + ix;
    const h00 = data[i], h10 = data[i + 1], h01 = data[i + n], h11 = data[i + n + 1];
    return lerp(lerp(h00, h10, tx), lerp(h01, h11, tx), tz);
  }
  zoneAt(wx, wz) {
    const x = wx / MAP_SCALE, z = wz / MAP_SCALE;
    if (Math.hypot(x - MTMOON.x, z - MTMOON.z) < MTMOON.caveR) return "mtmoon-cave";
    if (Math.hypot(x - CCAVE.x, z - CCAVE.z) < CCAVE.caveR) return "cerulean-cave";
    if (Math.hypot(x - ROCKTUN.x, z - ROCKTUN.z) < ROCKTUN.caveR) return "rock-tunnel";
    if (Math.hypot(x - PPLANT.x, z - PPLANT.z) < 22) return "power-plant";
    if (Math.hypot(x - SAFARI.x, z - SAFARI.z) < SAFARI.r) return "safari";
    if (Math.hypot(x - SEAFOAM.x, z - SEAFOAM.z) < 26) return "seafoam";
    if (Math.hypot(x - INDIGO.x, z - INDIGO.z) < 26) return "indigo";
    for (const t of TOWNS) if (Math.hypot(x - t.x, z - t.z) < t.r) return t.id;
    if (Math.hypot(x - VICTORY.x, z - VICTORY.z) < VICTORY.r + 2) return "victory-road";
    if (Math.hypot(x - MTMOON.x, z - MTMOON.z) < MTMOON.r + 1) return "mt-moon";
    if (Math.hypot(x - FOREST.x, z - FOREST.z) < FOREST.r) return "viridian-forest";
    if (Math.hypot(x - DIGLETT.x, z - DIGLETT.z) < DIGLETT.r) return "diglett";
    if (this.height(wx, wz) < WATER_Y - 0.25) {
      if (z > 168 || x > 226 || (x > 33 && x < 137 && z > 120)) return "sea";
      return "river";
    }
    if (x > -115 && x < -75 && z > 54 && z < 110) return "route-1";
    if (x > -125 && x < -62 && z > 150 && z < 238) return "route-21";
    if (x > -192 && x < -121 && z > -8 && z < 52) return "route-22";
    if (x > -238 && x < -155 && z > -68 && z < -6) return "route-23";
    if (x > -122 && x < -68 && z > -112 && z < 6) return "route-2";
    if (x > -78 && x < -44 && z > -180 && z < -128) return "route-3";
    if (x > 26 && x < 54 && z > -188 && z < -138) return "route-4";
    if (x > 52 && x < 162 && z > -252 && z < -181) return "route-24";
    if (x > 52 && x < 98 && z > -139 && z < -49) return "route-5";
    if (x > 52 && x < 98 && z > -1 && z < 73) return "route-6";
    if (x > -8 && x < 51 && z > -48 && z < -2) return "route-7";
    if (x > 99 && x < 187 && z > -48 && z < -2) return "route-8";
    if (x > 96 && x < 170 && z > -178 && z < -128) return "route-9";
    if (x > 168 && x < 240 && z > -165 && z < -42) return "route-10";
    if (x > 98 && x < 178 && z > 72 && z < 126) return "route-11";
    if (x > 176 && x < 240 && z > -8 && z < 152) return "route-12";
    if (x > -8 && x < 176 && z > 152 && z < 210) return "route-15";
    if (x > -44 && x < -16 && z > -2 && z < 152) return "cycling-road";
    return "grassland";
  }
  zoneName(zone) { return ZONE_NAMES[zone] || "Kanto"; }
  // nearest trees to a battle impact (for canopy rustle / falling leaves)
  treesNear(p, r, max = 3) {
    const out: { x: number; z: number; h: number; s: number; d: number }[] = [];
    for (const t of this.treeSpots) {
      const d = Math.hypot(t.x - p.x, t.z - p.z);
      if (d < r) out.push({ ...t, d });
    }
    return out.sort((a, b) => a.d - b.d).slice(0, max);
  }
  biomeAt(x, z) { return ZONE_BIOME[this.zoneAt(x, z)] || "grass"; }
  // NOTE: takes world coords, returns DESIGN-space distance (paths get wider
  // with the map; thresholds tuned in design units keep working).
  distToPath(wx, wz) {
    const x = wx / MAP_SCALE, z = wz / MAP_SCALE;
    let d = 1e9;
    for (const p of PATHS)
      for (let i = 0; i < p.length - 1; i++)
        d = Math.min(d, distSeg(x, z, p[i][0], p[i][1], p[i + 1][0], p[i + 1][1]));
    return d;
  }
  insideCave(p) {
    return this.caves.some((c) => Math.hypot(p.x - c.x, p.z - c.z) < c.r + 1);
  }
  insideBuilding(p) {
    for (const b of this.interiors)
      if (p.x > b.min.x && p.x < b.max.x && p.z > b.min.z && p.z < b.max.z && p.y < b.max.y) return b;
    return null;
  }

  // ------------------------------------------------------------------- sky
  buildSky() {
    this.scene.background = new THREE.Color(0x87b9ea);
    this.scene.fog = new THREE.Fog(0x9db8d8, 110, 460);
    this.hemi = new THREE.HemisphereLight(0xbcd4f5, 0x59734f, 0.9);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff2dc, 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.near = 10; sc.far = 480;
    sc.left = -85; sc.right = 85; sc.top = 85; sc.bottom = -85;
    this.sun.shadow.bias = -0.0004;
    this.scene.add(this.sun, this.sun.target);

    const glow = (inner, outer) => {
      const cv = document.createElement("canvas"); cv.width = cv.height = 128;
      const x = cv.getContext("2d");
      const g = x.createRadialGradient(64, 64, 8, 64, 64, 62);
      g.addColorStop(0, inner); g.addColorStop(0.55, outer); g.addColorStop(1, "rgba(0,0,0,0)");
      x.fillStyle = g; x.fillRect(0, 0, 128, 128);
      const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
    };
    this.sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow("rgba(255,250,225,1)", "rgba(255,190,90,.55)"), transparent: true, depthWrite: false, fog: false }));
    this.sunSprite.scale.set(110, 110, 1);
    this.moonSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow("rgba(235,240,255,.95)", "rgba(160,180,230,.35)"), transparent: true, depthWrite: false, fog: false }));
    this.moonSprite.scale.set(64, 64, 1);
    this.scene.add(this.sunSprite, this.moonSprite);

    // stars
    const n = 900, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * Math.PI * 0.48 + 0.05, r = 470;
      pos[i * 3] = Math.cos(a) * Math.cos(e) * r;
      pos[i * 3 + 1] = Math.sin(e) * r;
      pos[i * 3 + 2] = Math.sin(a) * Math.cos(e) * r;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xcfdcff, size: 1.7, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false }));
    this.scene.add(this.stars);

    // clouds: two soft layers drifting across the whole map
    this.clouds = [];
    const ct = glow("rgba(255,255,255,.9)", "rgba(255,255,255,.45)");
    for (let i = 0; i < 26; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: ct, transparent: true, opacity: 0.4, depthWrite: false }));
      const high = i % 3 === 0;
      s.position.set((Math.random() - 0.5) * 1400, (high ? 150 : 105) + Math.random() * 55, (Math.random() - 0.5) * 1400);
      const sc2 = (high ? 60 : 45) + Math.random() * 60;
      s.scale.set(sc2 * (1.3 + Math.random()), sc2 * 0.42, 1);
      this.scene.add(s); this.clouds.push(s);
    }
  }

  // --------------------------------------------------------------- terrain
  buildTerrain() {
    const seg = 400, size = WORLD_R * 2;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const col = new THREE.Color(), tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = this.height(x, z);
      pos.setY(i, h);
      const zone = this.zoneAt(x, z);
      const biome = ZONE_BIOME[zone] || "grass";
      const n = vnoise(x * 0.11, z * 0.11) * 0.5 + 0.5;
      const n2 = vnoise(x * 0.027 + 31, z * 0.027) * 0.5 + 0.5;   // large-scale meadow variation
      if (biome === "cave") col.set(0x4a443e);
      else if (h < WATER_Y + 0.5) col.set(0x8a7f55).lerp(tmp.set(0x4f6258), smooth(WATER_Y + 0.5, WATER_Y - 2.5, h));
      else if (h < WATER_Y + 1.6) col.set(0xd5c489);
      else if (biome === "mountain" || h > 13) {
        col.set(0x8d8579).lerp(tmp.set(0x6f6a63), n * 0.7);
        if (h > 21) col.lerp(tmp.set(0xe8eef5), smooth(21, 26, h));
      } else if (biome === "forest") col.set(0x4d8043).lerp(tmp.set(0x3c6b36), n);
      else if (biome === "town") col.set(0x7fb368).lerp(tmp.set(0x91bd78), n);
      else if (zone === "safari") col.set(0x7cb14e).lerp(tmp.set(0x96c468), n);
      else if (zone === "power-plant") col.set(0x9aa06a).lerp(tmp.set(0x8a905e), n);
      else if (zone === "diglett") col.set(0xa98f62).lerp(tmp.set(0x97804f), n);
      else col.set(0x6cab55).lerp(tmp.set(0x83bd66), n).lerp(tmp.set(0x7db35e), n2 * 0.5);
      // steep slopes read as exposed rock
      if (biome !== "cave" && h > WATER_Y + 1.6) {
        const slope = Math.abs(this.height(x + 2.2, z) - h) + Math.abs(this.height(x, z + 2.2) - h);
        if (slope > 1.5) col.lerp(tmp.set(0x84796a), Math.min(0.55, (slope - 1.5) * 0.35));
      }
      const dp = this.distToPath(x, z);
      if (dp < 3.4 && h > WATER_Y + 0.4 && biome !== "cave") col.lerp(tmp.set(0xcdb98c), smooth(3.4, 1.6, dp) * 0.9);
      for (const t of TOWNS) {
        const dt = Math.hypot(x - W(t.x), z - W(t.z));
        if (dt < W(t.r) * 0.6) col.lerp(tmp.set(0xcdb98c), smooth(W(t.r) * 0.55, W(t.r) * 0.2, dt) * 0.55);
      }
      colors[i * 3] = col.r; colors[i * 3 + 1] = col.g; colors[i * 3 + 2] = col.b;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.terrain = new THREE.Mesh(geo, mat);
    this.terrain.receiveShadow = true;
    this.scene.add(this.terrain);
  }

  buildWater() {
    const geo = new THREE.PlaneGeometry(WORLD_R * 2, WORLD_R * 2, 96, 96);
    geo.rotateX(-Math.PI / 2);
    this.waterMat = new THREE.ShaderMaterial({
      transparent: true,
      uniforms: {
        uTime: this.uTime,
        uDeep: { value: new THREE.Color(0x16486f) },
        uShallow: { value: new THREE.Color(0x3f93c9) },
        uNight: { value: 0 },
        uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3) },
      },
      vertexShader: `uniform float uTime; varying vec3 vW;
        void main(){ vec3 p = position;
          float w1 = sin(p.x*0.085 + uTime*1.15) * cos(p.z*0.07 + uTime*0.85);
          float w2 = sin(p.x*0.021 - uTime*0.5) * cos(p.z*0.026 + uTime*0.4);
          p.y += w1*0.11 + w2*0.2;
          vec4 w = modelMatrix * vec4(p,1.0); vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `uniform float uTime; uniform vec3 uDeep; uniform vec3 uShallow; uniform float uNight; uniform vec3 uSunDir;
        varying vec3 vW;
        void main(){
          float n  = sin(vW.x*0.30 + uTime*1.3)  * cos(vW.z*0.33 - uTime*1.0);
          float n2 = sin(vW.x*0.90 - uTime*2.0)  * cos(vW.z*1.05 + uTime*1.6);
          float n3 = sin(vW.x*2.30 + uTime*2.6)  * cos(vW.z*2.10 - uTime*2.2);
          vec3 vd = normalize(cameraPosition - vW);
          float fres = pow(1.0 - max(vd.y, 0.0), 2.2);
          vec3 col = mix(uDeep, uShallow, clamp(0.32 + 0.22*n + 0.5*fres, 0.0, 1.0));
          // procedural wave normal -> sun glint
          vec3 nrm = normalize(vec3(n2*0.22 + n3*0.10, 1.0, n*0.22 - n3*0.08));
          vec3 hv = normalize(vd + normalize(uSunDir));
          float spec = pow(max(dot(nrm, hv), 0.0), 240.0) * 0.85;
          float sparkle = smoothstep(0.86, 1.0, n2 * n) * 0.38;
          float foam = smoothstep(0.80, 0.98, n3 * n2) * 0.18;
          col += vec3(spec) * (1.0 - uNight*0.85) + vec3(sparkle + foam);
          col = mix(col, col * vec3(0.24,0.3,0.5), uNight);
          gl_FragColor = vec4(col, 0.86);
        }`,
    });
    const w = new THREE.Mesh(geo, this.waterMat);
    w.position.y = WATER_Y;
    this.scene.add(w);
  }

  // -------------------------------------------------------------- colliders
  addCyl(x, z, r) {
    const key = `${Math.floor(x / 14)},${Math.floor(z / 14)}`;
    if (!this.cylGrid.has(key)) this.cylGrid.set(key, []);
    this.cylGrid.get(key).push({ x, z, r });
  }
  addBox(min, max) { const b = { min, max }; this.colliderBoxes.push(b); return b; }

  // -------------------------------------------------------------- buildings
  // x/z in DESIGN space; building dimensions are physical meters.
  makeBuilding({ x, z, w, d, h, wall, roof, name = null, gapW = 2.6, light = true, ground = 2, doorBlocked = false }) {
    x = W(x); z = W(z);
    const g = new THREE.Group();
    const mat = (c) => new THREE.MeshLambertMaterial({ color: c });
    const wallM = mat(wall);
    const t = 0.35;
    const seg = (sx, sy, sz, px, py, pz) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), wallM);
      m.position.set(px, py, pz);
      m.castShadow = m.receiveShadow = true;
      g.add(m);
      this.addBox(new THREE.Vector3(x + px - sx / 2, ground + py - sy / 2, z + pz - sz / 2),
                  new THREE.Vector3(x + px + sx / 2, ground + py + sy / 2, z + pz + sz / 2));
    };
    // back, left, right walls
    seg(w, h, t, 0, h / 2, -d / 2);
    seg(t, h, d, -w / 2, h / 2, 0);
    seg(t, h, d, w / 2, h / 2, 0);
    // front wall with doorway
    const sideW = (w - gapW) / 2;
    seg(sideW, h, t, -(gapW / 2 + sideW / 2), h / 2, d / 2);
    seg(sideW, h, t, gapW / 2 + sideW / 2, h / 2, d / 2);
    seg(gapW, h - 2.6, t, 0, 2.6 + (h - 2.6) / 2, d / 2);
    // floor + ceiling
    const floor = new THREE.Mesh(new THREE.BoxGeometry(w, 0.12, d), mat(0xb9a87e));
    floor.position.y = 0.06; floor.receiveShadow = true; g.add(floor);
    const ceil = new THREE.Mesh(new THREE.BoxGeometry(w, 0.14, d), mat(0xd8d2c4));
    ceil.position.y = h; g.add(ceil);
    // pyramid roof
    const rad = Math.hypot(w / 2 + 0.8, d / 2 + 0.8);
    const roofM = new THREE.Mesh(new THREE.ConeGeometry(rad, h * 0.62, 4), mat(roof));
    roofM.rotation.y = Math.PI / 4;
    roofM.scale.set(w / (rad * 1.18), 1, d / (rad * 1.18));
    roofM.position.y = h + h * 0.31;
    roofM.castShadow = true;
    g.add(roofM);
    // windows (emissive at night)
    for (const wx of [-w / 4 - gapW / 4, w / 4 + gapW / 4]) {
      const win = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1), new THREE.MeshLambertMaterial({ color: 0x9fc6e8, emissive: 0xffd98a, emissiveIntensity: 0.05 }));
      win.position.set(wx, 1.9, d / 2 + t / 2 + 0.02);
      g.add(win); this.windows.push(win.material);
    }
    // door frame
    const frame = new THREE.Mesh(new THREE.PlaneGeometry(gapW + 0.5, 2.8), mat(0x55483a));
    frame.position.set(0, 1.4, d / 2 + t / 2 + 0.01);
    const hole = new THREE.Mesh(new THREE.PlaneGeometry(gapW, 2.6), new THREE.MeshBasicMaterial({ color: 0x14100c }));
    hole.position.set(0, 1.3, d / 2 + t / 2 + 0.015);
    g.add(frame, hole);
    if (doorBlocked) {
      const plank = new THREE.Mesh(new THREE.BoxGeometry(gapW + 0.3, 2.5, 0.18), mat(0x7a6243));
      plank.position.set(0, 1.3, d / 2 + 0.1);
      g.add(plank);
      this.addBox(new THREE.Vector3(x - gapW / 2 - 0.2, ground, z + d / 2 - 0.2),
                  new THREE.Vector3(x + gapW / 2 + 0.2, ground + 2.6, z + d / 2 + 0.3));
    }
    if (name) {
      const label = makeTextSprite(name, { size: 30, color: "#fff" });
      label.position.set(0, h + h * 0.62 + 0.6, 0);
      g.add(label);
    }
    if (light) {
      const pl = new THREE.PointLight(0xffe6bd, 0.85, Math.max(w, d) * 1.3, 1.6);
      pl.position.set(0, h - 0.8, 0);
      g.add(pl);
    }
    g.position.set(x, ground, z);
    this.scene.add(g);
    this.interiors.push({ min: new THREE.Vector3(x - w / 2, ground, z - d / 2), max: new THREE.Vector3(x + w / 2, ground + h, z + d / 2) });
    // Flatten the terrain to the building's floor across its footprint plus a
    // doorstep apron out the front (+z) — so it sits flush on any slope and the
    // doorway is always level enough to walk through.
    this.buildingPads.push({
      minX: x - w / 2 - 1.4, maxX: x + w / 2 + 1.4,
      minZ: z - d / 2 - 1.4, maxZ: z + d / 2 + 5.5,
      g: ground, fall: 4.5,
    });
    return g;
  }

  makeCenter(x, z, ground, townId) {
    const mat = (c) => new THREE.MeshLambertMaterial({ color: c });
    const pc = this.makeBuilding({ x, z, w: 11, d: 9, h: 3.6, wall: 0xf3eee2, roof: 0xe04848, name: "POKéMON CENTER", ground });
    const wx = W(x), wz = W(z);
    const counter = new THREE.Mesh(new THREE.BoxGeometry(5.4, 1.05, 1.1), mat(0xc9543f));
    counter.position.set(0, 0.55, -2.4); counter.castShadow = true;
    pc.add(counter);
    this.addBox(new THREE.Vector3(wx - 2.7, ground, wz - 2.95), new THREE.Vector3(wx + 2.7, ground + 1.2, wz - 1.85));
    const nurse = buildPerson({ shirt: "#f8cdd8", pants: "#fff", hair: "#f06292" });
    nurse.position.set(0, 0.34, -3.35); pc.add(nurse); // raised so she shows over the counter
    const healer = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.9, 1), new THREE.MeshLambertMaterial({ color: 0xdcdce8, emissive: 0x66ccff, emissiveIntensity: 0.35 }));
    healer.position.set(-3.6, 0.45, -3.2); pc.add(healer);
    const pcBox = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.7, 0.8), new THREE.MeshLambertMaterial({ color: 0x8893a8 }));
    pcBox.position.set(4.2, 0.85, -3.4); pc.add(pcBox);
    const pcScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 0.6), new THREE.MeshLambertMaterial({ color: 0x222222, emissive: 0x55ff99, emissiveIntensity: 0.8 }));
    pcScreen.position.set(4.2, 1.25, -2.98); pcScreen.rotation.x = -0.18; pc.add(pcScreen);
    this.addBox(new THREE.Vector3(wx + 3.6, ground, wz - 3.8), new THREE.Vector3(wx + 4.8, ground + 1.7, wz - 3.0));
    const spawn = new THREE.Vector3(wx, ground, wz + 6.6);
    this.interactables.push({ id: "nurse", pos: new THREE.Vector3(wx, ground, wz - 1.4), r: 2.6, label: "talk to Nurse Joy", spawn, town: townId });
    this.interactables.push({ id: "pc", pos: new THREE.Vector3(wx + 4.2, ground, wz - 3.0), r: 2.2, label: "use the PC storage" });
    this.centers.push({ id: townId, pos: spawn });
    return pc;
  }
  makeMart(x, z, ground) {
    const mat = (c) => new THREE.MeshLambertMaterial({ color: c });
    const mart = this.makeBuilding({ x, z, w: 10, d: 8.4, h: 3.4, wall: 0xe7f0fa, roof: 0x3b6fe2, name: "POKé MART", ground });
    const wx = W(x), wz = W(z);
    const mcounter = new THREE.Mesh(new THREE.BoxGeometry(4.6, 1.05, 1.1), mat(0x4f74c9));
    mcounter.position.set(-1, 0.55, -2.2); mcounter.castShadow = true; mart.add(mcounter);
    this.addBox(new THREE.Vector3(wx - 3.3, ground, wz - 2.75), new THREE.Vector3(wx + 1.3, ground + 1.2, wz - 1.65));
    const clerk = buildPerson({ shirt: "#3b6fe2", pants: "#39435e", hat: "#3b6fe2" });
    clerk.position.set(-1, 0, -3.2); mart.add(clerk);
    for (const sz of [-1.4, 1.2]) {
      const shelf = new THREE.Mesh(new THREE.BoxGeometry(1, 1.5, 2.2), mat(0xc7cedd));
      shelf.position.set(2.8, 0.75, sz); shelf.castShadow = true; mart.add(shelf);
      this.addBox(new THREE.Vector3(wx + 2.3, ground, wz + sz - 1.1), new THREE.Vector3(wx + 3.3, ground + 1.5, wz + sz + 1.1));
    }
    this.interactables.push({ id: "clerk", pos: new THREE.Vector3(wx - 1, ground, wz - 1.2), r: 2.6, label: "shop at the PokéMart" });
    return mart;
  }
  makeGym(x, z, ground, { name, wall, roof, floorA, floorB, water = false }) {
    const gym = this.makeBuilding({ x, z, w: 15, d: 17, h: 4.6, wall, roof, name, gapW: 3.2, ground });
    const lines = document.createElement("canvas"); lines.width = lines.height = 256;
    const lx = lines.getContext("2d");
    lx.fillStyle = floorA; lx.fillRect(0, 0, 256, 256);
    lx.strokeStyle = floorB; lx.lineWidth = 6;
    lx.strokeRect(28, 28, 200, 200);
    lx.beginPath(); lx.arc(128, 128, 40, 0, 7); lx.stroke();
    const ltex = new THREE.CanvasTexture(lines); ltex.colorSpace = THREE.SRGBColorSpace;
    const arena = new THREE.Mesh(new THREE.PlaneGeometry(12.6, 14.6), new THREE.MeshLambertMaterial({ map: ltex }));
    arena.rotation.x = -Math.PI / 2; arena.position.y = 0.14; gym.add(arena);
    if (water) {
      const pool = new THREE.Mesh(new THREE.CircleGeometry(3.6, 24), new THREE.MeshLambertMaterial({ color: 0x2c7fc9, emissive: 0x114477, emissiveIntensity: 0.35 }));
      pool.rotation.x = -Math.PI / 2; pool.position.set(0, 0.16, -1.5); gym.add(pool);
    } else {
      for (const tx of [-5.5, 5.5]) {
        const brazier = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.55, 1.2, 8), new THREE.MeshLambertMaterial({ color: 0x6d5a35, emissive: 0xff8830, emissiveIntensity: 0.7 }));
        brazier.position.set(tx, 0.6, -6.5); gym.add(brazier);
      }
    }
    return gym;
  }
  makeLamp(x, z, ground) {
    const wx = W(x), wz = W(z);
    const mat = (c) => new THREE.MeshLambertMaterial({ color: c });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 3.4, 6), mat(0x3a4150));
    pole.position.set(wx, ground + 1.7, wz); pole.castShadow = true;
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 8), new THREE.MeshLambertMaterial({ color: 0xfff3c9, emissive: 0xffd98a, emissiveIntensity: 0.1 }));
    bulb.position.set(wx, ground + 3.5, wz);
    const light = new THREE.PointLight(0xffd9a0, 0, 16, 1.8);
    light.position.set(wx, ground + 3.4, wz);
    this.scene.add(pole, bulb, light);
    this.lamps.push({ light, mat: bulb.material });
    this.addCyl(wx, wz, 0.25);
  }
  makeSign(x, z, ground, text, rot = -0.4) {
    const wx = W(x), wz = W(z);
    const mat = (c) => new THREE.MeshLambertMaterial({ color: c });
    const sign = new THREE.Group();
    const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 1.3, 6), mat(0x7a5c39));
    sp.position.y = 0.65;
    const board = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.8, 0.12), mat(0x9a7748));
    board.position.y = 1.45;
    sign.add(sp, board);
    sign.position.set(wx, ground, wz);
    sign.rotation.y = rot;
    this.scene.add(sign);
    this.addCyl(wx, wz, 0.3);
    this.interactables.push({ id: "sign", pos: new THREE.Vector3(wx, ground, wz), r: 2.2, label: "read the sign", text });
  }
  // NOTE: world-space coordinates (callers position relative to scaled spots)
  makePerson(look, x, y, z, rotY = 0) {
    const p = buildPerson(look);
    p.position.set(x, y, z);
    p.rotation.y = rotY;
    this.scene.add(p);
    return p;
  }

  // Stone pillars + lintel marking a tunnel mouth (used where route corridors
  // pierce a cave dome on the far side from its main gap). Design coords.
  cavePortal(x, z, dirX, dirZ) {
    const wx = W(x), wz = W(z);
    const rockM = new THREE.MeshLambertMaterial({ color: 0x4c443c });
    const gl = Math.hypot(dirX, dirZ) || 1;
    const gx = dirX / gl, gz = dirZ / gl;
    for (const s of [-1, 1]) {
      const px = wx - gz * 10 * s, pz = wz + gx * 10 * s;
      const p = new THREE.Mesh(new THREE.DodecahedronGeometry(3.0, 0), rockM);
      p.position.set(px, this.height(px, pz) + 1.6, pz);
      p.scale.y = 2.0; p.castShadow = true;
      this.scene.add(p);
      this.addCyl(px, pz, 2.5);
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(24, 3.0, 4.2), rockM);
    lintel.position.set(wx, this.height(wx, wz) + 7.2, wz);
    lintel.rotation.y = Math.atan2(gx, gz);
    lintel.castShadow = true;
    this.scene.add(lintel);
  }

  // cx/cz/r in DESIGN space; the dome and dressing scale with the map.
  caveDecor(cx, cz, r, gapDirX, gapDirZ, cryCols, floorH) {
    cx = W(cx); cz = W(cz); r = W(r);
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(r, 36, 18, Math.PI * 0.12, Math.PI * 1.76, 0, Math.PI * 0.52),
      new THREE.MeshLambertMaterial({ color: 0x2e2a26, side: THREE.DoubleSide })
    );
    const baseRot = Math.PI / 2 + Math.PI * 0.12 + (Math.PI * 1.76) / 2 - Math.PI; // gap faces +z
    dome.rotation.y = baseRot + Math.atan2(gapDirX, gapDirZ);
    dome.position.set(cx, floorH - 2, cz);
    dome.scale.y = 0.8;
    dome.castShadow = true; dome.receiveShadow = true;
    this.scene.add(dome);
    const rockM = new THREE.MeshLambertMaterial({ color: 0x4c443c });
    // entrance pillars + lintel just outside the gap
    const gl = Math.hypot(gapDirX, gapDirZ) || 1;
    const gx = gapDirX / gl, gz = gapDirZ / gl;
    const mx = cx + gx * (r - 3), mz = cz + gz * (r - 3);
    const poff = Math.max(8, r * 0.26);
    for (const s of [-1, 1]) {
      const px = mx - gz * poff * s, pz = mz + gx * poff * s;
      const p = new THREE.Mesh(new THREE.DodecahedronGeometry(3.2, 0), rockM);
      p.position.set(px, this.height(px, pz) + 1.6, pz);
      p.scale.y = 2.0; p.castShadow = true;
      this.scene.add(p);
      this.addCyl(px, pz, 2.7);
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(Math.max(20, r * 0.55), 3.2, 4.5), rockM);
    lintel.position.set(mx, this.height(mx, mz) + 7.4, mz);
    lintel.rotation.y = Math.atan2(gx, gz);
    lintel.castShadow = true;
    this.scene.add(lintel);
    // stalagmites
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * Math.PI * 2, d = r * 0.3 + Math.random() * r * 0.55;
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d * 0.9;
      const s = 0.5 + Math.random() * 1.7;
      const st = new THREE.Mesh(new THREE.ConeGeometry(0.55 * s, 2.4 * s, 6), rockM);
      st.position.set(x, this.height(x, z) + 1.2 * s, z);
      this.scene.add(st);
      if (s > 1) this.addCyl(x, z, 0.5 * s);
    }
    // glowing crystals + dim lights
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2, d = r * 0.42 + (i % 3) * r * 0.16;
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d * 0.85;
      const cm = new THREE.Mesh(new THREE.OctahedronGeometry(0.45 + (i % 3) * 0.22, 0),
        new THREE.MeshLambertMaterial({ color: 0x222a33, emissive: cryCols[i % cryCols.length], emissiveIntensity: 1.4 }));
      cm.position.set(x, this.height(x, z) + 0.5, z);
      cm.rotation.set(i, i * 2, 0);
      this.scene.add(cm);
    }
    const l1 = new THREE.PointLight(cryCols[0], 1.1, r + 6, 1.5); l1.position.set(cx - r * 0.35, floorH + 3, cz - r * 0.2);
    const l2 = new THREE.PointLight(cryCols[1 % cryCols.length], 1.0, r + 6, 1.5); l2.position.set(cx + r * 0.4, floorH + 3, cz + r * 0.25);
    this.scene.add(l1, l2);

    // ---- cave dressing: stalactites, glow mushrooms, drip spots
    this.caves.push({ x: cx, z: cz, r });
    const domeYAt = (d: number) => floorH - 2 + Math.cos((d / r) * Math.PI * 0.5) * r * 0.8; // approx dome inner height
    for (let i = 0; i < 24; i++) {
      const a = Math.random() * Math.PI * 2, d = Math.random() * r * 0.7;
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d * 0.9;
      const s = 0.4 + Math.random() * 1.2;
      const st = new THREE.Mesh(new THREE.ConeGeometry(0.4 * s, 2.2 * s, 5), rockM);
      st.rotation.x = Math.PI; // hang from the ceiling
      st.position.set(x, domeYAt(d) - 1.1 * s - 0.4, z);
      this.scene.add(st);
      if (Math.random() < 0.5) this.caveDrips.push(new THREE.Vector3(x, st.position.y - 1.1 * s, z));
    }
    const mushM = new THREE.MeshLambertMaterial({ color: 0x1c3328, emissive: 0x4dffa6, emissiveIntensity: 1.3 });
    const mushM2 = new THREE.MeshLambertMaterial({ color: 0x2a2433, emissive: 0x6ab8ff, emissiveIntensity: 1.2 });
    for (let i = 0; i < 20; i++) {
      const a = Math.random() * Math.PI * 2, d = r * 0.25 + Math.random() * r * 0.6;
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d * 0.88;
      const s = 0.14 + Math.random() * 0.2;
      const cap = new THREE.Mesh(new THREE.ConeGeometry(s * 1.6, s * 1.7, 7), i % 3 ? mushM : mushM2);
      cap.position.set(x, this.height(x, z) + s * 1.2, z);
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.4, s * 0.55, s * 1.2, 5), rockM);
      stem.position.set(x, this.height(x, z) + s * 0.5, z);
      this.scene.add(cap, stem);
    }
  }

  // -------------------------------------------------------------- berries
  buildBerries() {
    const rng = (() => { let s = 777; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
    const ZONES = new Set([
      "route-1", "route-2", "route-5", "route-6", "route-7", "route-8", "route-9", "route-10",
      "route-11", "route-12", "route-15", "route-22", "route-24", "cycling-road",
      "grassland", "safari", "viridian-forest",
    ]);
    const spots: THREE.Vector3[] = [];
    let guard = 0;
    while (spots.length < 76 && guard++ < 30000) {
      const x = (rng() - 0.5) * W(540), z = (rng() - 0.5) * W(540);
      if (!ZONES.has(this.zoneAt(x, z))) continue;
      const h = this.height(x, z);
      if (h < WATER_Y + 1 || this.distToPath(x, z) < 2.2 || this.distToPath(x, z) > 14) continue;
      if (spots.some((s) => Math.hypot(s.x - x, s.z - z) < 32)) continue;
      spots.push(new THREE.Vector3(x, h, z));
    }
    const bushG = new THREE.SphereGeometry(0.62, 8, 6);
    bushG.scale(1, 0.78, 1);
    const bushM = new THREE.MeshLambertMaterial({ color: 0x2f6b35 });
    const dotG = new THREE.SphereGeometry(0.09, 6, 5);
    const dotM = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.berryBushI = new THREE.InstancedMesh(bushG, bushM, spots.length);
    this.berryDotI = new THREE.InstancedMesh(dotG, dotM, spots.length * 4);
    this.berryBushI.castShadow = true;
    const q = new THREE.Quaternion(), cc = new THREE.Color();
    spots.forEach((p, i) => {
      this._berryM4.compose(new THREE.Vector3(p.x, p.y + 0.45, p.z), q, new THREE.Vector3(1, 1, 1));
      this.berryBushI.setMatrixAt(i, this._berryM4);
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + i;
        this._berryM4.compose(new THREE.Vector3(p.x + Math.cos(a) * 0.42, p.y + 0.62 + (k % 2) * 0.16, p.z + Math.sin(a) * 0.42), q, new THREE.Vector3(1, 1, 1));
        this.berryDotI.setMatrixAt(i * 4 + k, this._berryM4);
        this.berryDotI.setColorAt(i * 4 + k, cc.set(k % 2 ? 0xe2474b : 0x4d96ff));
      }
      this.berries.push({ pos: p, ready: true, respawnT: 0, idx: i });
      this.addCyl(p.x, p.z, 0.55);
      this.interactables.push({ id: "berry", pos: p, r: 2.3, label: "pick berries", bush: this.berries[this.berries.length - 1] });
    });
    this.scene.add(this.berryBushI, this.berryDotI);
  }
  setBerryVisible(bush: BerryBush, on: boolean) {
    const q = new THREE.Quaternion(), p = bush.pos;
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + bush.idx;
      const s = on ? 1 : 0.001;
      this._berryM4.compose(new THREE.Vector3(p.x + Math.cos(a) * 0.42, p.y + 0.62 + (k % 2) * 0.16, p.z + Math.sin(a) * 0.42), q, new THREE.Vector3(s, s, s));
      this.berryDotI.setMatrixAt(bush.idx * 4 + k, this._berryM4);
    }
    this.berryDotI.instanceMatrix.needsUpdate = true;
  }
  pickBerry(bush: BerryBush) {
    if (!bush.ready) return false;
    bush.ready = false;
    bush.respawnT = 240; // game seconds
    this.setBerryVisible(bush, false);
    return true;
  }

  // ------------------------------------------------------------- weather
  buildRain() {
    const pos = new Float32Array(this.rainN * 6);
    this.rainOff = new Float32Array(this.rainN * 3);
    for (let i = 0; i < this.rainN; i++) {
      this.rainOff[i * 3] = (Math.random() - 0.5) * 56;
      this.rainOff[i * 3 + 1] = Math.random() * 26;
      this.rainOff[i * 3 + 2] = (Math.random() - 0.5) * 56;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const mat = new THREE.LineBasicMaterial({ color: 0xaac8e8, transparent: true, opacity: 0, depthWrite: false });
    this.rainLines = new THREE.LineSegments(geo, mat);
    this.rainLines.frustumCulled = false;
    this.rainLines.visible = false;
    this.scene.add(this.rainLines);
  }
  setWeather(w: WeatherId, instant = false) {
    this.weather = w;
    this.weatherT = 90 + Math.random() * 110;
    if (instant) this.weatherW = w === "clear" ? 0 : 1;
  }
  rollWeather() {
    const r = Math.random();
    const next: WeatherId = r < 0.5 ? "clear" : r < 0.72 ? "rain" : r < 0.84 ? "storm" : "fog";
    this.setWeather(next === this.weather ? "clear" : next);
  }
  weatherInfo() {
    return { id: this.weather, ...WEATHER_META[this.weather], w: this.weatherW };
  }
  isRaining() { return (this.weather === "rain" || this.weather === "storm") && this.weatherW > 0.4; }

  // --------------------------------------------------------------- fishing
  // Returns a casting spot if the player faces fishable water, else null.
  fishSpot(pos: THREE.Vector3, dir: THREE.Vector3) {
    if (this.height(pos.x, pos.z) < WATER_Y) return null; // already swimming
    for (const d of [2.4, 3.6, 4.8, 6.2]) {
      const x = pos.x + dir.x * d, z = pos.z + dir.z * d;
      if (this.height(x, z) < WATER_Y - 0.55) return new THREE.Vector3(x, WATER_Y, z);
    }
    return null;
  }

  // ----------------------------------------------------------- Kanto towns
  buildKanto() {
    const mat = (c) => new THREE.MeshLambertMaterial({ color: c });

    // ============================ PALLET TOWN
    {
      const g = 3.0;
      const lab = this.makeBuilding({ x: -103, z: 122, w: 12, d: 9, h: 3.8, wall: 0xeae6da, roof: 0x8a9aa8, name: "OAK'S LAB", ground: g });
      const table = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.9, 1.4), mat(0x8a6f4d));
      table.position.set(0, 0.45, -2.2); table.castShadow = true; lab.add(table);
      this.addBox(new THREE.Vector3(W(-103) - 2.6, g, W(122) - 2.9), new THREE.Vector3(W(-103) + 2.6, g + 1.1, W(122) - 1.5));
      for (const [i, bx] of [-1.6, 0, 1.6].entries()) {
        const ball = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), new THREE.MeshLambertMaterial({ color: [0x78c850, 0xf08030, 0x6890f0][i] }));
        ball.position.set(bx, 1.12, -2.2); lab.add(ball);
      }
      const oak = buildPerson({ shirt: "#e8e4dc", pants: "#8d6e63", hair: "#cfcfcf" });
      oak.position.set(0, 0, -3.3); lab.add(oak);
      this.interactables.push({ id: "oak", pos: new THREE.Vector3(W(-103), g, W(122) - 1.2), r: 2.8, label: "talk to Professor Oak" });

      const home = this.makeBuilding({ x: -86, z: 126, w: 7.5, d: 6.5, h: 3, wall: 0xe8dcc8, roof: 0xc97b4a, name: "YOUR HOUSE", gapW: 1.8, ground: g, light: false });
      const bed = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.5, 2.6), mat(0xb04a4a));
      bed.position.set(-2.4, 0.25, -1.4); home.add(bed);
      const mom = buildPerson({ shirt: "#f3c0a0", pants: "#9c5a3a", hair: "#7a4a2e" });
      mom.position.set(1.4, 0, -1.8); home.add(mom);
      this.interactables.push({ id: "mom", pos: new THREE.Vector3(W(-86) + 1.4, g, W(126) - 1.8), r: 2.4, label: "talk to Mom", spawn: new THREE.Vector3(W(-86), g, W(126) + 5.5) });
      this.makeSign(-91, 141, g, ["PALLET TOWN — Shades of your journey await!", "North: Route 1 → Viridian City.", "South: Route 21 across the sea → Cinnabar Island."]);
      this.makeLamp(-97, 132, g);
    }

    // ============================ VIRIDIAN CITY (Earth Badge)
    {
      const g = 3.2;
      this.makeCenter(-107, 22, g, "viridian");
      this.makeMart(-83, 22, g);
      this.makeBuilding({ x: -79, z: 44, w: 7.5, d: 6.5, h: 3, wall: 0xe0d2d2, roof: 0xa86a6a, gapW: 1.8, ground: g, light: false });
      this.makeGym(-110, 42, g, { name: "VIRIDIAN GYM", wall: 0xd9c9a3, roof: 0x4a7a52, floorA: "#5a5a42", floorB: "#cdb98c" });
      this.makeSign(-93, 12, g, ["VIRIDIAN CITY — The Eternally Green Paradise.", "North: Route 2 & Viridian Forest → Pewter City. West: Route 22 → Victory Road.", "The GYM LEADER only accepts challengers holding seven badges."]);
      this.makeLamp(-101, 16, g); this.makeLamp(-89, 16, g);
    }

    // ============================ PEWTER CITY (Boulder Badge)
    {
      const g = 4.2;
      this.makeCenter(-107, -128, g, "pewter");
      this.makeGym(-88, -142, g, { name: "PEWTER GYM", wall: 0xcfc4ae, roof: 0x8d8579, floorA: "#7a6a4a", floorB: "#e8d9a8" });
      this.makeBuilding({ x: -104, z: -150, w: 10, d: 8, h: 3.6, wall: 0xd8d8d0, roof: 0x6f6a63, name: "MUSEUM", gapW: 2.2, ground: g, light: false });
      this.makeBuilding({ x: -80, z: -122, w: 7.5, d: 6.5, h: 3, wall: 0xd8d8d0, roof: 0x6f6a63, gapW: 1.8, ground: g, light: false });
      this.makeSign(-93, -117, g, ["PEWTER CITY — A Stone Gray City.", "Gym Leader: BROCK — The Rock-Solid Pokémon Trainer.", "East: Route 3 → Mt. Moon → Cerulean City."]);
      this.makeLamp(-100, -122, g);
    }

    // ============================ CERULEAN CITY (Cascade Badge)
    {
      const g = 3.6;
      this.makeCenter(63, -167, g, "cerulean");
      this.makeMart(87, -167, g);
      this.makeGym(84, -146, g, { name: "CERULEAN GYM", wall: 0xdef0f8, roof: 0x49a8d8, floorA: "#2c6f9c", floorB: "#bfe6f8", water: true });
      this.makeBuilding({ x: 58, z: -148, w: 8, d: 7, h: 3.2, wall: 0xe8e2d2, roof: 0x4a6a9a, name: "BIKE SHOP", gapW: 2, ground: g, light: false });
      // the shop owner mans the doorway — bring a Bike Voucher
      const bikeOwner = buildPerson({ shirt: "#4a6a9a", pants: "#39435e", hat: "#e8e2d2" });
      bikeOwner.position.set(W(58), g, W(-148) + 4.4);
      this.scene.add(bikeOwner);
      this.interactables.push({ id: "bikeclerk", pos: new THREE.Vector3(W(58), g, W(-148) + 4.4), r: 2.8, label: "talk to the Bike Shop owner" });
      this.makeSign(73, -178, g, ["CERULEAN CITY — A Mysterious Blue Aura Surrounds It.", "Gym Leader: MISTY — The Tomboyish Mermaid.", "North: Nugget Bridge → Routes 24/25. A sealed cave lies across the water..."]);
      this.makeLamp(68, -173, g);
    }

    // ============================ SAFFRON CITY (Marsh Badge, Silph Co.)
    {
      const g = 3.4;
      this.makeCenter(58, -40, g, "saffron");
      this.makeMart(90, -40, g);
      // Silph Co. tower: three stacked tiers
      const silph = this.makeBuilding({ x: 75, z: -30, w: 14, d: 12, h: 6, wall: 0xc8d2dc, roof: 0x8a98a8, name: "SILPH CO.", gapW: 3, ground: g });
      const tier2 = new THREE.Mesh(new THREE.BoxGeometry(10, 4, 8), mat(0xbecbd8));
      tier2.position.y = 6 + 2 + 1.1; tier2.castShadow = true; silph.add(tier2);
      const tier3 = new THREE.Mesh(new THREE.BoxGeometry(6, 3.2, 5), mat(0xb2c2d2));
      tier3.position.y = 6 + 4 + 1.6 + 1.6; tier3.castShadow = true; silph.add(tier3);
      const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 3, 6), mat(0x55606c));
      ant.position.y = 6 + 4 + 3.2 + 1.5 + 1.2; silph.add(ant);
      const blink = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), new THREE.MeshLambertMaterial({ color: 0x331111, emissive: 0xff4444, emissiveIntensity: 1.4 }));
      blink.position.y = ant.position.y + 1.6; silph.add(blink);
      this.makeBuilding({ x: 54, z: -12, w: 9, d: 8, h: 3.8, wall: 0xd8cfc0, roof: 0x8d6e63, name: "FIGHTING DOJO", gapW: 2.2, ground: g, light: false });
      this.makeGym(92, -12, g, { name: "SAFFRON GYM", wall: 0xd9c8e8, roof: 0x8a5ab8, floorA: "#4a3a5c", floorB: "#d8b8f8" });
      this.makeSign(75, -6, g, ["SAFFRON CITY — Shining, Golden Land of Commerce.", "Home of SILPH CO. and the FIGHTING DOJO.", "Gym Leader: SABRINA — The Master of Psychic Pokémon."]);
      this.makeLamp(66, -12, g); this.makeLamp(84, -22, g);
    }

    // ============================ CELADON CITY (Rainbow Badge, Dept. Store)
    {
      const g = 3.3;
      this.makeCenter(-14, -12, g, "celadon");
      // Department store: tall, wide, with a clerk inside
      const dept = this.makeBuilding({ x: -40, z: -34, w: 16, d: 10, h: 7, wall: 0xe7f0fa, roof: 0x3b6fe2, name: "CELADON DEPT. STORE", gapW: 3.2, ground: g });
      const dcounter = new THREE.Mesh(new THREE.BoxGeometry(5, 1.05, 1.1), mat(0x4f74c9));
      dcounter.position.set(-2, 0.55, -2.8); dcounter.castShadow = true; dept.add(dcounter);
      this.addBox(new THREE.Vector3(W(-40) - 4.5, g, W(-34) - 3.35), new THREE.Vector3(W(-40) + 0.5, g + 1.2, W(-34) - 2.25));
      const dclerk = buildPerson({ shirt: "#3b6fe2", pants: "#39435e", hat: "#3b6fe2" });
      dclerk.position.set(-2, 0, -3.8); dept.add(dclerk);
      this.interactables.push({ id: "clerk", pos: new THREE.Vector3(W(-40) - 2, g, W(-34) - 1.8), r: 2.6, label: "shop at the Dept. Store" });
      // Game corner with neon glow
      const corner = this.makeBuilding({ x: -16, z: -34, w: 9, d: 7, h: 3.4, wall: 0xe8d8e8, roof: 0xc94888, name: "GAME CORNER", gapW: 2.2, ground: g });
      const neon = new THREE.PointLight(0xff4dd2, 1.1, 13, 1.7);
      neon.position.set(0, 2.6, 4.2); corner.add(neon);
      this.makeGym(-44, -12, g, { name: "CELADON GYM", wall: 0xd8ecd0, roof: 0x4a9a52, floorA: "#3f6b3a", floorB: "#c8e8a8" });
      this.makeSign(-28, -3, g, ["CELADON CITY — The City of Rainbow Dreams.", "The DEPT. STORE stocks everything a trainer needs.", "Gym Leader: ERIKA — The Nature-Loving Princess."]);
      this.makeLamp(-22, -8, g);
    }

    // ============================ LAVENDER TOWN
    {
      const g = 3.8;
      this.makeCenter(213, -33, g, "lavender");
      const tower = this.makeBuilding({ x: 196, z: -30, w: 11, d: 11, h: 13, wall: 0xb9aed0, roof: 0x6b5a92, name: "POKéMON TOWER", gapW: 2.8, ground: g });
      const pl = new THREE.PointLight(0xb09ae8, 0.9, 14, 1.7);
      pl.position.set(0, 4, 0); tower.add(pl);
      for (let i = 0; i < 6; i++) {
        const grave = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.1, 0.25), mat(0x9a9aa8));
        grave.position.set(-3.5 + (i % 3) * 3.5, 0.55, -3.4 + Math.floor(i / 3) * 2.6);
        tower.add(grave);
      }
      // graveyard outside
      for (let i = 0; i < 8; i++) {
        const gx = W(196) + ((i % 4) - 1.5) * 3.2, gz = W(-16) + Math.floor(i / 4) * 3;
        const grave = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.0, 0.22), mat(0x8d8d9c));
        grave.position.set(gx, this.height(gx, gz) + 0.5, gz);
        grave.castShadow = true;
        this.scene.add(grave);
        this.addCyl(gx, gz, 0.3);
      }
      this.makeSign(206, -13, g, ["LAVENDER TOWN — The Noble Purple Town.", "Pokémon Tower: where the spirits of Pokémon rest.", "West: Route 8 → Saffron. North: Route 10 & Rock Tunnel. South: Routes 12/13."]);
      this.makeLamp(210, -18, g);
    }

    // ============================ VERMILION CITY (Thunder Badge, S.S. Anne)
    {
      const g = 3.0;
      this.makeCenter(62, 88, g, "vermilion");
      this.makeMart(88, 86, g);
      this.makeGym(58, 106, g, { name: "VERMILION GYM", wall: 0xf5e8c0, roof: 0xe8a830, floorA: "#6b5a2a", floorB: "#ffe14d" });
      // pier + S.S. Anne (the bay doubled with the map — so did the pier)
      const pier = new THREE.Mesh(new THREE.BoxGeometry(3, 0.5, 52), mat(0x9a7748));
      pier.position.set(W(75), 1.1, W(130));
      pier.castShadow = pier.receiveShadow = true;
      this.scene.add(pier);
      this.addBox(new THREE.Vector3(W(75) - 1.5, -1, W(130) - 26), new THREE.Vector3(W(75) + 1.5, 1.35, W(130) + 26)); // walkable deck
      const hull = new THREE.Mesh(new THREE.BoxGeometry(7, 3.2, 16), mat(0xf4f4f0));
      hull.position.set(W(83), WATER_Y + 1.2, W(138)); hull.castShadow = true;
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(4.5, 1.6, 8), mat(0xe04848));
      cabin.position.set(W(83), WATER_Y + 3.4, W(138));
      const funnel = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.7, 2, 10), mat(0x39435e));
      funnel.position.set(W(83), WATER_Y + 5, W(138) - 2);
      this.scene.add(hull, cabin, funnel);
      this.addBox(new THREE.Vector3(W(83) - 3.5, 0, W(138) - 8), new THREE.Vector3(W(83) + 3.5, 4, W(138) + 8));
      const anne = makeTextSprite("S.S. ANNE", { size: 26 });
      anne.position.set(W(83), WATER_Y + 7, W(138));
      this.scene.add(anne);
      // the infamous truck (Mew myth)
      const ty = this.height(W(60), W(127));
      const cab = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.4, 1.6), mat(0xc94838));
      cab.position.set(W(60), ty + 0.95, W(127) + 1.6);
      const cargo = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.9, 3.1), mat(0x9aa8b4));
      cargo.position.set(W(60), ty + 1.2, W(127) - 0.8);
      cab.castShadow = cargo.castShadow = true;
      this.scene.add(cab, cargo);
      this.addBox(new THREE.Vector3(W(60) - 1, ty - 0.5, W(127) - 2.6), new THREE.Vector3(W(60) + 1, ty + 2.2, W(127) + 2.6));
      this.interactables.push({ id: "truck", pos: new THREE.Vector3(W(60), ty, W(127) + 0.4), r: 3, label: "inspect the old truck" });
      // POKéMON FAN CLUB — the Chairman's Rapidash stories earn you a Bike Voucher
      const club = this.makeBuilding({ x: 94, z: 108, w: 9, d: 7.5, h: 3.4, wall: 0xf6e7ea, roof: 0xc94888, name: "POKéMON FAN CLUB", gapW: 2.2, ground: g, light: false });
      const chair = buildPerson({ shirt: "#8d5524", pants: "#39435e", hair: "#cfcfcf" });
      chair.position.set(0, 0, -2.4);
      club.add(chair);
      this.interactables.push({ id: "chairman", pos: new THREE.Vector3(W(94), g, W(108) - 2.4), r: 2.8, label: "talk to the Fan Club Chairman" });
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const x = this.spots.mew.x + Math.cos(a) * 3.4, z = this.spots.mew.z + Math.sin(a) * 3.4;
        const f = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), new THREE.MeshBasicMaterial({ color: 0xff9ad5, side: THREE.DoubleSide }));
        f.rotation.x = -Math.PI / 2;
        f.position.set(x, this.height(x, z) + 0.08, z);
        this.scene.add(f);
      }
      this.makeSign(84, 108, g, ["VERMILION CITY — The Port of Exquisite Sunsets.", "Gym Leader: LT. SURGE — The Lightning American.", "Dockhands whisper about an old truck by the pier..."]);
      this.makeLamp(70, 104, g);
    }

    // ============================ FUCHSIA CITY (Soul Badge)
    {
      const g = 3.1;
      this.makeCenter(-42, 166, g, "fuchsia");
      this.makeMart(-16, 166, g);
      this.makeGym(-44, 188, g, { name: "FUCHSIA GYM", wall: 0xf0d8e8, roof: 0xb83a98, floorA: "#4a2a44", floorB: "#f0a8d8" });
      this.makeBuilding({ x: -14, z: 186, w: 7.5, d: 6.5, h: 3, wall: 0xe0d8c0, roof: 0x8a6f43, name: "WARDEN'S HOME", gapW: 1.8, ground: g, light: false });
      this.makeSign(-28, 158, g, ["FUCHSIA CITY — Behold! It's Passion Pink!", "Gym Leader: KOGA — The Poisonous Ninja Master.", "NE: SAFARI ZONE gate. South: Route 19 sandbar → Seafoam Islands."]);
      this.makeLamp(-35, 162, g);
    }

    // ============================ CINNABAR ISLAND (Volcano Badge, Mansion)
    {
      const g = 2.8;
      this.makeCenter(-103, 254, g, "cinnabar");
      this.makeMart(-87, 254, g);
      this.makeGym(-95, 268, g, { name: "CINNABAR GYM", wall: 0xe8c8b0, roof: 0xd84830, floorA: "#5c2a1a", floorB: "#ff9a4d" });
      this.makeBuilding({ x: -108, z: 262, w: 10, d: 8, h: 4.2, wall: 0x9a8f86, roof: 0x6a5a52, name: "POKéMON MANSION", gapW: 2.4, ground: g, doorBlocked: true, light: false });
      this.makeSign(-88, 248, g, ["CINNABAR ISLAND — The Fiery Town of Burning Desire.", "Gym Leader: BLAINE — The Hot-Headed Quiz Master.", "The burned-out MANSION crawls with feral Pokémon."], 0.7);
      this.makeLamp(-95, 250, g);
    }

    // ============================ INDIGO PLATEAU (Pokémon League)
    {
      const g = 26;
      const hall = this.makeBuilding({ x: -219, z: -207, w: 15, d: 11, h: 5.5, wall: 0xe8e6f0, roof: 0x6a5acd, name: "POKéMON LEAGUE", gapW: 3, ground: g });
      const crest = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 10), new THREE.MeshLambertMaterial({ color: 0x333344, emissive: 0xffd700, emissiveIntensity: 0.9 }));
      crest.position.y = 5.5 + 5.5 * 0.62 + 1.4; hall.add(crest);
      for (const s of [-1, 1]) {
        const bx = W(-212) + s * 5, bz = W(-198);
        const brazier = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.65, 1.5, 8), new THREE.MeshLambertMaterial({ color: 0x6d5a35, emissive: 0xff8830, emissiveIntensity: 0.9 }));
        brazier.position.set(bx, this.height(bx, bz) + 0.75, bz);
        this.scene.add(brazier);
        this.addCyl(bx, bz, 0.6);
        const fl = new THREE.PointLight(0xff9a40, 0.9, 12, 1.7);
        fl.position.set(bx, this.height(bx, bz) + 2.2, bz);
        this.scene.add(fl);
      }
      this.makeSign(-207, -193, g, ["INDIGO PLATEAU — the summit of Victory Road.", "Only trainers holding ALL EIGHT BADGES may challenge the league.", "The CHAMPION awaits."], 0.6);
    }

    // ============================ POWER PLANT (across the river)
    {
      const hpp = this.height(W(PPLANT.x), W(PPLANT.z));
      const plant = this.makeBuilding({ x: PPLANT.x, z: PPLANT.z, w: 16, d: 11, h: 5, wall: 0xc9c489, roof: 0x8a8a55, name: "POWER PLANT", gapW: 3, ground: hpp });
      for (const gx of [-4.5, 0, 4.5]) {
        const gen = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.3, 2.2, 10), new THREE.MeshLambertMaterial({ color: 0x6a6a4a, emissive: 0xffe14d, emissiveIntensity: 0.5 }));
        gen.position.set(gx, 1.1, -2.6); plant.add(gen);
        this.addBox(new THREE.Vector3(W(PPLANT.x) + gx - 1.2, hpp, W(PPLANT.z) - 3.8), new THREE.Vector3(W(PPLANT.x) + gx + 1.2, hpp + 2.4, W(PPLANT.z) - 1.4));
      }
      // ruined pylons + zapdos orb
      const py = mat(0x7c8794);
      for (const [dx, dz, ph] of [[-8, -5, 7], [6, -4, 5]]) {
        const x = this.spots.zapdos.x + dx, z = this.spots.zapdos.z + dz;
        const p = new THREE.Mesh(new THREE.BoxGeometry(1.4, ph, 1.4), py);
        p.position.set(x, this.height(x, z) + ph / 2, z);
        p.castShadow = true; this.scene.add(p); this.addCyl(x, z, 1.1);
      }
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), new THREE.MeshLambertMaterial({ color: 0x333333, emissive: 0xffe14d, emissiveIntensity: 1.5 }));
      orb.position.set(this.spots.zapdos.x, this.height(this.spots.zapdos.x, this.spots.zapdos.z) + 7.6, this.spots.zapdos.z);
      this.scene.add(orb);
      this.makeSign(218, -88, this.height(W(218), W(-88)), ["POWER PLANT — KEEP OUT!", "Wade the shallow ford to cross the river.", "They say a legendary bird roosts here when storms gather..."], 0.8);
    }

    // ============================ SAFARI ZONE (Fuchsia's north side)
    {
      const cx = W(SAFARI.x), cz = W(SAFARI.z), r = W(SAFARI.r);
      const postM = mat(0x8a6f43);
      const gateA = Math.atan2(175 - SAFARI.z, -30 - SAFARI.x); // gate faces Fuchsia
      const POSTS = 52;
      for (let i = 0; i < POSTS; i++) {
        const a = (i / POSTS) * Math.PI * 2;
        if (Math.abs(((a - gateA + Math.PI * 3) % (Math.PI * 2)) - Math.PI) > Math.PI - 0.16) continue; // leave gate gap
        const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
        const h = this.height(x, z);
        if (h < WATER_Y) continue;
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.6, 0.3), postM);
        post.position.set(x, h + 0.8, z);
        post.castShadow = true;
        this.scene.add(post);
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, r * 0.123), postM);
        rail.position.set(cx + Math.cos(a + 0.06) * r, h + 1.2, cz + Math.sin(a + 0.06) * r);
        rail.rotation.y = -a - 0.06 + Math.PI / 2;
        this.scene.add(rail);
        this.addCyl(x, z, 0.3);
      }
      const gx = cx + Math.cos(gateA) * r, gz = cz + Math.sin(gateA) * r;
      const arch = new THREE.Mesh(new THREE.BoxGeometry(9, 0.8, 0.5), postM);
      arch.position.set(gx, this.height(gx, gz) + 3, gz);
      arch.rotation.y = -gateA + Math.PI / 2;
      this.scene.add(arch);
      const gsign = makeTextSprite("SAFARI ZONE", { size: 30, color: "#ffe9b0" });
      gsign.position.set(gx, this.height(gx, gz) + 4, gz);
      this.scene.add(gsign);
      const warden = this.makePerson({ shirt: "#c9b458", pants: "#6b5a35", hat: "#8a6f43" }, gx + 2, this.height(gx + 2, gz + 2), gz + 2, gateA + Math.PI);
      this.interactables.push({ id: "warden", pos: warden.position.clone(), r: 3, label: "talk to the Warden" });
    }

    // ============================ BILL'S SEA COTTAGE (Route 25 cape)
    {
      const h = this.height(W(135), W(-245));
      const cot = this.makeBuilding({ x: 135, z: -245, w: 6.5, d: 5.5, h: 3, wall: 0xdce8dc, roof: 0x5a8a6a, name: "SEA COTTAGE", gapW: 1.8, ground: h, light: false });
      const bill = buildPerson({ shirt: "#7ac06a", pants: "#39435e", hair: "#8d5524" });
      bill.position.set(1.2, 0, -1.4); cot.add(bill);
      this.interactables.push({ id: "bill", pos: new THREE.Vector3(W(135) + 1.2, h, W(-245) - 1.4), r: 2.6, label: "talk to Bill" });
    }

    // ============================ NUGGET BRIDGE (Route 24)
    {
      const postM = mat(0x9a7748);
      for (let zb = -404; zb <= -364; zb += 8) {
        for (const s of [-1, 1]) {
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.28, 1.1, 0.28), postM);
          post.position.set(W(75) + s * 6, this.height(W(75) + s * 6, zb) + 0.55, zb);
          this.scene.add(post);
        }
      }
      for (const s of [-1, 1]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 44), postM);
        rail.position.set(W(75) + s * 6, this.height(W(75) + s * 6, W(-192)) + 1.05, W(-192));
        this.scene.add(rail);
        this.addBox(new THREE.Vector3(W(75) + s * 6 - 0.3, 0, -407), new THREE.Vector3(W(75) + s * 6 + 0.3, 6, -361));
      }
      const bsign = makeTextSprite("NUGGET BRIDGE", { size: 24, color: "#ffe9b0" });
      bsign.position.set(W(75), this.height(W(75), W(-181)) + 4.4, W(-181));
      this.scene.add(bsign);
    }

    // ============================ VICTORY ROAD gate + Moltres scorch ring
    {
      const h = this.height(W(-198), W(-62));
      const rockM = mat(0x5c554c);
      for (const s of [-1, 1]) {
        const p = new THREE.Mesh(new THREE.BoxGeometry(1.6, 6, 1.6), rockM);
        p.position.set(W(-198) + s * 9, h + 3, W(-62) + s * 2.4);
        p.castShadow = true;
        this.scene.add(p);
        this.addCyl(W(-198) + s * 9, W(-62) + s * 2.4, 1.2);
      }
      this.makeSign(-194, -57, h, ["VICTORY ROAD — the path of champions.", "The ramp climbs to the INDIGO PLATEAU.", "Legend tells of a bird of flame nesting on the slopes..."], 0.9);
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        const x = this.spots.moltres.x + Math.cos(a) * 7, z = this.spots.moltres.z + Math.sin(a) * 7;
        const r = new THREE.Mesh(new THREE.DodecahedronGeometry(0.9, 0), new THREE.MeshLambertMaterial({ color: 0x4c3328, emissive: 0xff5a1f, emissiveIntensity: 0.55 }));
        r.position.set(x, this.height(x, z) + 0.4, z);
        this.scene.add(r);
      }
    }

    // ============================ CYCLING ROAD fences (Routes 16/17/18)
    {
      const postM = mat(0x8a8f9a);
      for (let zf = 16; zf <= 288; zf += 6.8) {
        for (const s of [-1, 1]) {
          const x = W(-30) + s * 9.2;
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.24, 1.2, 0.24), postM);
          post.position.set(x, this.height(x, zf) + 0.6, zf);
          this.scene.add(post);
          this.addCyl(x, zf, 0.25);
        }
      }
      for (const s of [-1, 1]) {
        const x = W(-30) + s * 9.2;
        for (let zf = 16; zf < 288; zf += 13.6) {
          const rail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 13.6), postM);
          rail.position.set(x, this.height(x, zf + 6.8) + 1.05, zf + 6.8);
          this.scene.add(rail);
        }
      }
      const rsign = makeTextSprite("CYCLING ROAD", { size: 26, color: "#cfe8ff" });
      rsign.position.set(W(-30), this.height(W(-30), W(4)) + 4.6, W(4));
      this.scene.add(rsign);
      this.makeSign(-25, 8, this.height(W(-25), W(8)), ["CYCLING ROAD — all downhill from Celadon to Fuchsia!", "Bikers love to pick fights along the fences.", "No stopping on the slope!"], 0.6);
    }

    // ============================ SEAFOAM (Articuno islet)
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.5;
      const x = this.spots.articuno.x + Math.cos(a) * 4, z = this.spots.articuno.z + Math.sin(a) * 4;
      const r = new THREE.Mesh(new THREE.OctahedronGeometry(0.8, 0), new THREE.MeshLambertMaterial({ color: 0xdef3ff, emissive: 0x9fd9ff, emissiveIntensity: 0.45 }));
      r.position.set(x, this.height(x, z) + 0.5, z);
      this.scene.add(r);
    }

    // ============================ MT. MOON cave
    {
      this.caveDecor(MTMOON.x, MTMOON.z, MTMOON.caveR, 8, 1, [0x9fd9ff, 0xfff0b8, 0xc7c7ff], 5);
      this.cavePortal(-36, -174, -8, 1); // west mouth where Route 3 tunnels in
      // giant moon stone
      const moon = new THREE.Mesh(new THREE.OctahedronGeometry(1.5, 1), new THREE.MeshLambertMaterial({ color: 0x3a3a44, emissive: 0xf2f0ff, emissiveIntensity: 0.9 }));
      moon.position.set(W(MTMOON.x) + 12, this.height(W(MTMOON.x) + 12, W(MTMOON.z) - 10) + 1.4, W(MTMOON.z) - 10);
      this.scene.add(moon);
      this.addCyl(W(MTMOON.x) + 12, W(MTMOON.z) - 10, 1.4);
      // fossil rocks
      for (const [fx, fz] of [[W(MTMOON.x) - 14, W(MTMOON.z) + 8], [W(MTMOON.x) - 8, W(MTMOON.z) - 16]]) {
        const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(1.1, 0), mat(0x5c5248));
        rock.position.set(fx, this.height(fx, fz) + 0.7, fz);
        const spiral = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.14, 6, 12, Math.PI * 1.6), mat(0xd8d2c0));
        spiral.position.set(fx, this.height(fx, fz) + 1.1, fz + 0.8);
        this.scene.add(rock, spiral);
        this.addCyl(fx, fz, 1.0);
      }
    }

    // ============================ ROCK TUNNEL (Route 10)
    {
      this.caveDecor(ROCKTUN.x, ROCKTUN.z, ROCKTUN.caveR, 0, 9, [0x8a92a0, 0xd8b86a], 4.6);
      this.cavePortal(195, -138, 0, -9); // north mouth where Route 9 tunnels in
      this.makeSign(189, -141, this.height(W(189), W(-141)), ["ROCK TUNNEL — pitch black inside!", "Smart trainers carry a flashlight (L).", "South exit: Route 10 → Lavender Town."], 0.5);
    }

    // ============================ CERULEAN CAVE + gate
    {
      this.caveDecor(CCAVE.x, CCAVE.z, CCAVE.caveR, 9, 0, [0xc77dff, 0x8a7dff], 4.2);
      const mc = new THREE.Mesh(new THREE.OctahedronGeometry(1.4, 0), new THREE.MeshLambertMaterial({ color: 0x2a2233, emissive: 0xb05cff, emissiveIntensity: 1.1 }));
      mc.position.set(this.spots.mewtwo.x, this.height(this.spots.mewtwo.x, this.spots.mewtwo.z) + 1.4, this.spots.mewtwo.z);
      mc.scale.y = 1.8;
      this.scene.add(mc);
      // gate bars across the mouth (removed once the player has all eight badges)
      const barM = mat(0x4a5568);
      const gy = this.height(W(52.5), W(-200));
      this.caveGateGroup = new THREE.Group();
      for (let i = 0; i < 7; i++) {
        const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 4.4, 6), barM);
        bar.position.set(W(52.5) - i * 0.06, gy + 2.2, W(-202.8) + i * 2.0);
        this.caveGateGroup.add(bar);
      }
      const cross = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.3, 15), barM);
      cross.position.set(W(52.4), gy + 3.3, W(-200));
      this.caveGateGroup.add(cross);
      this.caveGateGroup.traverse((o) => { if ((o as any).isMesh) o.castShadow = true; });
      this.scene.add(this.caveGateGroup);
      this.caveGateBox = this.addBox(new THREE.Vector3(W(51.2), gy - 1, W(-204.2)), new THREE.Vector3(W(53.8), gy + 4, W(-195.8)));
      const guard = this.makePerson({ shirt: "#39435e", pants: "#21262e", hat: "#39435e" }, W(56.5), this.height(W(56.5), W(-197)), W(-197), 1.4);
      this.interactables.push({ id: "guard", pos: guard.position.clone(), r: 3.2, label: "talk to the Guard" });
    }
  }
  openCaveGate() {
    if (!this.caveGateBox) return;
    const i = this.colliderBoxes.indexOf(this.caveGateBox);
    if (i >= 0) this.colliderBoxes.splice(i, 1);
    this.caveGateBox = null;
    if (this.caveGateGroup) { this.scene.remove(this.caveGateGroup); this.caveGateGroup = null; }
  }

  // ----------------------------------------------------------------- props
  buildProps() {
    const rng = (() => { let s = 1234; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
    const nearBuilding = (x, z, m = 2.5) => {
      for (const b of this.interiors)
        if (x > b.min.x - m && x < b.max.x + m && z > b.min.z - m && z < b.max.z + m) return true;
      return false;
    };
    const TREE_DENSITY = {
      "viridian-forest": 0.95, "route-2": 0.34, "route-24": 0.22, "route-8": 0.15,
      safari: 0.24, "route-21": 0.2, "route-22": 0.16, "route-23": 0.08, lavender: 0.1,
      grassland: 0.13, "route-1": 0.12, "route-11": 0.12, "route-3": 0.07, "route-4": 0.07,
      "route-5": 0.18, "route-6": 0.18, "route-7": 0.2, "route-9": 0.1, "route-10": 0.08,
      "route-12": 0.08, "route-15": 0.16, "cycling-road": 0.04, celadon: 0.12, fuchsia: 0.1,
      "mt-moon": 0.05, "victory-road": 0.04, saffron: 0.04,
    };
    // ---- trees (canopies sway in the wind via a tiny instanced wind shader)
    const trunkG = new THREE.CylinderGeometry(0.28, 0.42, 2.6, 6);
    const canG = new THREE.ConeGeometry(2.1, 5.2, 7);
    const trunkM = new THREE.MeshLambertMaterial({ color: 0x6b4a2e });
    const canM = new THREE.MeshLambertMaterial({ color: 0xffffff });
    canM.onBeforeCompile = (s) => {
      s.uniforms.uTime = this.uTime;
      s.vertexShader = "uniform float uTime;\n" + s.vertexShader.replace(
        "#include <begin_vertex>",
        `vec3 transformed = vec3(position);
         float wph = instanceMatrix[3][0]*0.37 + instanceMatrix[3][2]*0.29;
         float wk = clamp(position.y/5.2 + 0.5, 0.0, 1.0);
         transformed.x += sin(uTime*1.15 + wph) * 0.14 * wk;
         transformed.z += cos(uTime*0.95 + wph*1.3) * 0.11 * wk;`);
    };
    const trees = [];
    let guard = 0;
    while (trees.length < 2000 && guard++ < 70000) {
      const x = (rng() - 0.5) * W(560), z = (rng() - 0.5) * W(560);
      const zone = this.zoneAt(x, z);
      const dens = TREE_DENSITY[zone] || 0;
      if (rng() > dens) continue;
      if (this.distToPath(x, z) < 4.5 || nearBuilding(x, z)) continue;
      if (Math.hypot(x - this.spots.mew.x, z - this.spots.mew.z) < 9) continue;
      const h = this.height(x, z);
      if (h < WATER_Y + 1.2 || h > 16) continue;
      trees.push({ x, z, h, s: 0.8 + rng() * 0.9, hue: rng() });
    }
    this.treeSpots = trees; // battles query these to rustle nearby canopies
    const trunkI = new THREE.InstancedMesh(trunkG, trunkM, trees.length);
    const canI = new THREE.InstancedMesh(canG, canM, trees.length);
    trunkI.castShadow = canI.castShadow = true;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), eu = new THREE.Euler(), vs = new THREE.Vector3();
    const cc = new THREE.Color();
    trees.forEach((t, i) => {
      eu.set(0, t.hue * 6.28, 0); q.setFromEuler(eu);
      m4.compose(vs.set(t.x, t.h + 1.3 * t.s, t.z).clone(), q, new THREE.Vector3(t.s, t.s, t.s));
      trunkI.setMatrixAt(i, m4);
      m4.compose(new THREE.Vector3(t.x, t.h + (2.6 + 2.0) * t.s, t.z), q, new THREE.Vector3(t.s, t.s, t.s));
      canI.setMatrixAt(i, m4);
      const lav = this.zoneAt(t.x, t.z) === "lavender";
      canI.setColorAt(i, lav ? cc.setHSL(0.78, 0.18, 0.34) : cc.setHSL(0.32 + t.hue * 0.06, 0.45, 0.3 + t.hue * 0.14));
      this.addCyl(t.x, t.z, 0.5 * t.s);
    });
    this.scene.add(trunkI, canI);

    // ---- rocks
    const rockG = new THREE.DodecahedronGeometry(1, 0);
    const rockM = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const ROCK_DENSITY = {
      "mt-moon": 0.75, "victory-road": 0.75, "mtmoon-cave": 0.4, "cerulean-cave": 0.4,
      "rock-tunnel": 0.4, "route-9": 0.25, "route-10": 0.25, "route-23": 0.3, indigo: 0.35,
      "route-3": 0.3, "route-4": 0.3, seafoam: 0.35, diglett: 0.4,
    };
    const rocks = [];
    guard = 0;
    while (rocks.length < 950 && guard++ < 50000) {
      const x = (rng() - 0.5) * W(580), z = (rng() - 0.5) * W(580);
      const zone = this.zoneAt(x, z);
      const dens = ROCK_DENSITY[zone] ?? 0.08;
      if (ZONE_BIOME[zone] === "town" || rng() > dens) continue;
      if (this.distToPath(x, z) < 4 || nearBuilding(x, z)) continue;
      const h = this.height(x, z);
      if (h < WATER_Y + 0.8) continue;
      rocks.push({ x, z, h, s: 0.35 + rng() * rng() * 2.4, r: rng() * 6.28, icy: zone === "seafoam" });
    }
    const rockI = new THREE.InstancedMesh(rockG, rockM, rocks.length);
    rockI.castShadow = true; rockI.receiveShadow = true;
    rocks.forEach((r, i) => {
      eu.set(r.r, r.r * 2, r.r * 0.7); q.setFromEuler(eu);
      m4.compose(new THREE.Vector3(r.x, r.h + r.s * 0.35, r.z), q, new THREE.Vector3(r.s, r.s * 0.8, r.s));
      rockI.setMatrixAt(i, m4);
      rockI.setColorAt(i, r.icy ? cc.setHSL(0.55, 0.25, 0.72) : cc.setHSL(0.08, 0.05 + (i % 5) * 0.01, 0.36 + (i % 7) * 0.022));
      if (r.s > 1.1) this.addCyl(r.x, r.z, r.s * 0.85);
    });
    this.scene.add(rockI);

    // ---- tall grass tufts (sway in wind)
    this.grassClusters = [];
    const tuftG = new THREE.PlaneGeometry(1.15, 1.0);
    tuftG.translate(0, 0.5, 0);
    const tuftM = new THREE.MeshLambertMaterial({ color: 0x3f9143, side: THREE.DoubleSide, alphaTest: 0.1 });
    tuftM.onBeforeCompile = (s) => {
      s.uniforms.uTime = this.uTime;
      s.vertexShader = "uniform float uTime;\n" + s.vertexShader.replace(
        "#include <begin_vertex>",
        `vec3 transformed = vec3(position);
         float ph = instanceMatrix[3][0]*0.61 + instanceMatrix[3][2]*0.53;
         transformed.x += sin(uTime*1.9 + ph) * 0.17 * position.y;
         transformed.z += cos(uTime*1.6 + ph) * 0.13 * position.y;`);
    };
    const GRASSY = new Set([
      "route-1", "route-2", "route-3", "route-4", "route-5", "route-6", "route-7", "route-8",
      "route-9", "route-10", "route-11", "route-12", "route-15", "route-21", "route-22",
      "route-23", "route-24", "cycling-road", "grassland", "safari", "viridian-forest", "pallet", "fuchsia",
    ]);
    const tufts = [];
    guard = 0;
    while (this.grassClusters.length < 170 && guard++ < 26000) {
      const x = (rng() - 0.5) * W(540), z = (rng() - 0.5) * W(540);
      if (!GRASSY.has(this.zoneAt(x, z)) || this.distToPath(x, z) < 5 || nearBuilding(x, z)) continue;
      this.grassClusters.push(new THREE.Vector3(x, this.height(x, z), z));
      for (let i = 0; i < 16; i++) {
        const a = rng() * 6.28, d = rng() * 8;
        const tx = x + Math.cos(a) * d, tz = z + Math.sin(a) * d;
        const th = this.height(tx, tz);
        if (th > WATER_Y + 1) tufts.push({ x: tx, z: tz, h: th, r: rng() * 3.14, s: 0.8 + rng() * 0.7 });
      }
    }
    const tuftI = new THREE.InstancedMesh(tuftG, tuftM, tufts.length * 2);
    tufts.forEach((t, i) => {
      for (let k = 0; k < 2; k++) {
        eu.set(0, t.r + k * Math.PI / 2, 0); q.setFromEuler(eu);
        m4.compose(new THREE.Vector3(t.x, t.h - 0.05, t.z), q, new THREE.Vector3(t.s, t.s, t.s));
        tuftI.setMatrixAt(i * 2 + k, m4);
      }
    });
    this.scene.add(tuftI);

    // ---- flowers
    const flG = new THREE.PlaneGeometry(0.3, 0.3); flG.rotateX(-Math.PI / 2);
    const flM = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    const FLOWERY = new Set(["pallet", "viridian", "pewter", "cerulean", "saffron", "celadon", "lavender", "vermilion", "fuchsia", "cinnabar", "route-21", "route-24", "route-1"]);
    const fls = [];
    guard = 0;
    while (fls.length < 1100 && guard++ < 34000) {
      const x = (rng() - 0.5) * W(520), z = (rng() - 0.5) * W(520);
      if (!FLOWERY.has(this.zoneAt(x, z))) continue;
      const h = this.height(x, z);
      if (h < WATER_Y + 1 || this.distToPath(x, z) < 2.5 || nearBuilding(x, z, 1)) continue;
      fls.push({ x, z, h });
    }
    const flI = new THREE.InstancedMesh(flG, flM, fls.length);
    const flCols = [0xfff4ad, 0xffb3c7, 0xff8a8a, 0xcfe8ff, 0xffd166];
    fls.forEach((f, i) => {
      m4.compose(new THREE.Vector3(f.x, f.h + 0.06, f.z), q.identity(), new THREE.Vector3(1, 1, 1));
      flI.setMatrixAt(i, m4);
      flI.setColorAt(i, cc.set(flCols[i % flCols.length]));
    });
    this.scene.add(flI);
  }

  // -------------------------------------------------------------- wildlife
  // Decorative fauna, separate from the wild-Pokémon AI: bird flocks tracing
  // lazy circles over the routes by day, butterflies working the flower beds,
  // fireflies rising from the grass at night.
  buildWildlife() {
    const rng = (() => { let s = 4242; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
    // ---- bird flocks: a dark wedge of 5-7, each flapping out of phase
    const birdG = new THREE.BufferGeometry();
    // two triangles meeting at the body — a classic distant-bird silhouette
    birdG.setAttribute("position", new THREE.BufferAttribute(new Float32Array([
      0, 0, 0.16, -0.42, 0.06, -0.1, 0, 0, -0.06,   // left wing
      0, 0, 0.16, 0, 0, -0.06, 0.42, 0.06, -0.1,    // right wing
    ]), 3));
    const birdM = new THREE.MeshBasicMaterial({ color: 0x2b3240, side: THREE.DoubleSide });
    const FLOCK_SPOTS = [   // design space, over open routes and water
      [-95, 80], [40, -90], [150, -60], [-150, -40], [0, 200], [120, 60], [-60, 240], [200, -160],
    ];
    for (const [dx, dz] of FLOCK_SPOTS) {
      const n = 5 + Math.floor(rng() * 3);
      const birds: THREE.Mesh[] = [];
      for (let i = 0; i < n; i++) {
        const b = new THREE.Mesh(birdG, birdM);
        b.scale.setScalar(1.6 + rng() * 0.9);
        this.scene.add(b);
        birds.push(b);
      }
      this.flocks.push({
        cx: W(dx), cz: W(dz), r: 26 + rng() * 30, h: 24 + rng() * 14,
        spd: (0.06 + rng() * 0.05) * (rng() < 0.5 ? 1 : -1), ph: rng() * 9, birds, drift: rng() * 9,
      });
    }
    // ---- butterflies: paired wing planes fluttering around a flower bed
    const wingG = new THREE.PlaneGeometry(0.16, 0.22);
    const wingCols = [0xffd166, 0xff8fab, 0x9fd2ff, 0xf4f1bb];
    const TOWNS_BF = ["pallet", "viridian", "pewter", "cerulean", "celadon", "fuchsia", "lavender", "vermilion"];
    let made = 0, guard = 0;
    while (made < 26 && guard++ < 4000) {
      const x = (rng() - 0.5) * W(520), z = (rng() - 0.5) * W(520);
      const zone = this.zoneAt(x, z);
      if (!TOWNS_BF.includes(zone) && zone !== "grassland" && zone !== "route-24" && zone !== "viridian-forest") continue;
      const h = this.height(x, z);
      if (h < WATER_Y + 1) continue;
      const g = new THREE.Group();
      const m = new THREE.MeshBasicMaterial({ color: wingCols[made % wingCols.length], side: THREE.DoubleSide, transparent: true, opacity: 0.92 });
      const wl = new THREE.Mesh(wingG, m); wl.position.x = -0.08; wl.rotation.y = 0.5;
      const wr = new THREE.Mesh(wingG, m); wr.position.x = 0.08; wr.rotation.y = -0.5;
      g.add(wl, wr);
      g.userData.wl = wl; g.userData.wr = wr;
      this.scene.add(g);
      this.butterflies.push({ home: new THREE.Vector3(x, h, z), mesh: g, ph: rng() * 9, r: 2.5 + rng() * 3 });
      made++;
    }
    // ---- fireflies: a soft points cloud that only shows at night
    const FN = 90;
    const fpos = new Float32Array(FN * 3);
    guard = 0;
    while (this.fireflyHomes.length < FN && guard++ < 6000) {
      const x = (rng() - 0.5) * W(480), z = (rng() - 0.5) * W(480);
      const zone = this.zoneAt(x, z);
      if (!["grassland", "viridian-forest", "route-24", "safari", "lavender"].includes(zone)) continue;
      const h = this.height(x, z);
      if (h < WATER_Y + 0.5) continue;
      this.fireflyHomes.push(new THREE.Vector3(x, h + 0.8, z));
    }
    this.fireflyHomes.forEach((p, i) => { fpos[i * 3] = p.x; fpos[i * 3 + 1] = p.y; fpos[i * 3 + 2] = p.z; });
    const fg = new THREE.BufferGeometry();
    fg.setAttribute("position", new THREE.BufferAttribute(fpos, 3));
    this.fireflies = new THREE.Points(fg, new THREE.PointsMaterial({
      color: 0xc9f29b, size: 0.16, transparent: true, opacity: 0, sizeAttenuation: true, depthWrite: false,
    }));
    this.scene.add(this.fireflies);
  }
  updateWildlife(dt, playerPos) {
    const t = this.uTime.value;
    const night = this.isNight();
    const wet = this.weather === "rain" || this.weather === "storm";
    // birds circle their roost; they sit out rain and night
    const birdVis = !night && !wet;
    for (const f of this.flocks) {
      // only animate flocks near enough to ever be seen
      const near = Math.hypot(f.cx - playerPos.x, f.cz - playerPos.z) < 320;
      for (let i = 0; i < f.birds.length; i++) {
        const b = f.birds[i];
        b.visible = birdVis && near;
        if (!b.visible) continue;
        const a = t * f.spd * Math.PI * 2 + f.ph + i * 0.42;
        const r = f.r + Math.sin(t * 0.21 + i) * 3.5;
        const x = f.cx + Math.cos(a) * r + Math.sin(t * 0.07 + f.drift) * 9;
        const z = f.cz + Math.sin(a) * r + Math.cos(t * 0.06 + f.drift) * 9;
        const y = Math.max(this.height(x, z), WATER_Y) + f.h + Math.sin(t * 0.5 + i * 1.7) * 1.6;
        b.position.set(x, y, z);
        b.rotation.y = -a - (f.spd > 0 ? 0 : Math.PI);     // beak into the turn
        const flap = Math.sin(t * 7 + i * 2.3);
        b.rotation.z = flap * 0.55;                         // wing beat
        b.position.y += Math.abs(flap) * 0.12;
      }
    }
    // butterflies work the flowers by day and tuck in at night/rain
    for (const bf of this.butterflies) {
      const m = bf.mesh;
      const near = Math.hypot(bf.home.x - playerPos.x, bf.home.z - playerPos.z) < 120;
      m.visible = !night && !wet && near;
      if (!m.visible) continue;
      const a = t * 0.5 + bf.ph;
      const x = bf.home.x + Math.cos(a) * bf.r * (0.6 + 0.4 * Math.sin(t * 0.3 + bf.ph));
      const z = bf.home.z + Math.sin(a * 1.31 + 1) * bf.r;
      const y = Math.max(this.height(x, z), bf.home.y - 0.4) + 0.7 + Math.sin(t * 2.1 + bf.ph) * 0.35;
      m.position.set(x, y, z);
      m.rotation.y = Math.atan2(Math.cos(a), -Math.sin(a));
      const flap = Math.sin(t * 11 + bf.ph) * 0.9;
      (m.userData.wl as THREE.Mesh).rotation.y = 0.45 + flap;
      (m.userData.wr as THREE.Mesh).rotation.y = -0.45 - flap;
    }
    // fireflies fade up after dusk, drift in slow bobs
    const fMat = this.fireflies.material as THREE.PointsMaterial;
    const want = night && !wet ? 0.85 : 0;
    fMat.opacity += (want - fMat.opacity) * Math.min(1, dt * 1.5);
    if (fMat.opacity > 0.02) {
      const arr = (this.fireflies.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;
      for (let i = 0; i < this.fireflyHomes.length; i++) {
        const p = this.fireflyHomes[i];
        arr[i * 3] = p.x + Math.sin(t * 0.5 + i * 2.1) * 1.4;
        arr[i * 3 + 1] = p.y + Math.sin(t * 0.8 + i) * 0.5;
        arr[i * 3 + 2] = p.z + Math.cos(t * 0.45 + i * 1.3) * 1.4;
      }
      this.fireflies.geometry.attributes.position.needsUpdate = true;
    }
    this.fireflies.visible = fMat.opacity > 0.02;
  }

  // --------------------------------------------------------------- minimap
  buildMinimap() {
    const N = 280;
    const cv = document.createElement("canvas");
    cv.width = cv.height = N;
    const ctx = cv.getContext("2d");
    const img = ctx.createImageData(N, N);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const x = (i / N) * 2 * WORLD_R - WORLD_R, z = (j / N) * 2 * WORLD_R - WORLD_R;
        const zone = this.zoneAt(x, z), h = this.height(x, z);
        const b = ZONE_BIOME[zone] || "grass";
        let c;
        if (h < WATER_Y) c = [38, 92, 138];
        else if (b === "cave") c = [52, 47, 43];
        else if (b === "town") c = [203, 183, 140];
        else if (b === "mountain") c = h > 21 ? [222, 228, 235] : [128, 122, 112];
        else if (b === "forest") c = [56, 102, 50];
        else if (zone === "safari") c = [110, 168, 84];
        else if (zone === "power-plant") c = [168, 168, 104];
        else if (zone === "diglett") c = [169, 143, 98];
        else if (h < WATER_Y + 1.6) c = [205, 190, 138];
        else c = [96, 158, 80];
        const sh = clamp(0.72 + h / 38, 0.6, 1.25);
        const k = (j * N + i) * 4;
        img.data[k] = c[0] * sh; img.data[k + 1] = c[1] * sh; img.data[k + 2] = c[2] * sh; img.data[k + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    // path overlay
    ctx.strokeStyle = "rgba(225,200,150,.8)"; ctx.lineWidth = 1.2;
    const w2m = (x, z) => [(x + WORLD_R) / (2 * WORLD_R) * N, (z + WORLD_R) / (2 * WORLD_R) * N];
    for (const p of PATHS) {
      ctx.beginPath();
      p.forEach(([x, z], idx) => { const [u, v] = w2m(W(x), W(z)); idx ? ctx.lineTo(u, v) : ctx.moveTo(u, v); });
      ctx.stroke();
    }
    const dot = (x, z, col, r = 2.4) => { const [u, v] = w2m(x, z); ctx.fillStyle = col; ctx.beginPath(); ctx.arc(u, v, r, 0, 7); ctx.fill(); };
    for (const c of this.centers) dot(c.pos.x, c.pos.z, "#ff5a5a", 2.2);            // Pokemon Centers
    for (const k in this.gymPos) dot(this.gymPos[k].x, this.gymPos[k].z, "#ffcc33", 2.6); // all 8 gyms
    dot(W(196), W(-30), "#b08ae8", 2.6);                                            // Pokemon Tower
    dot(W(PPLANT.x), W(PPLANT.z), "#ffe14d", 2.6);                                  // power plant
    dot(W(-103), W(122), "#ffffff", 2.2);                                           // Oak's lab
    dot(W(135), W(-245), "#7adfd0", 2.2);                                           // Bill
    dot(W(-219), W(-207), "#b8a8ff", 2.8);                                          // Pokemon League
    this.minimapCanvas = cv;
  }
  worldToMap(x, z, N) { return [(x + WORLD_R) / (2 * WORLD_R) * N, (z + WORLD_R) / (2 * WORLD_R) * N]; }

  // --------------------------------------------------------------- collide
  collide(p, radius = 0.55) {
    // boxes
    for (const b of this.colliderBoxes) {
      if (p.y > b.max.y + 0.2 || p.y + 1.6 < b.min.y) continue;
      const cx = clamp(p.x, b.min.x, b.max.x), cz = clamp(p.z, b.min.z, b.max.z);
      const dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz;
      if (d2 < radius * radius) {
        if (d2 > 1e-7) {
          const d = Math.sqrt(d2);
          p.x = cx + (dx / d) * radius; p.z = cz + (dz / d) * radius;
        } else {
          // inside the box: push along smallest penetration axis
          const pen = [
            [p.x - b.min.x + radius, -1, 0], [b.max.x - p.x + radius, 1, 0],
            [p.z - b.min.z + radius, 0, -1], [b.max.z - p.z + radius, 0, 1],
          ].sort((a, c) => a[0] - c[0])[0];
          p.x += pen[1] * pen[0]; p.z += pen[2] * pen[0];
        }
      }
    }
    // cylinders via grid
    const gi = Math.floor(p.x / 14), gj = Math.floor(p.z / 14);
    for (let a = gi - 1; a <= gi + 1; a++) {
      for (let b2 = gj - 1; b2 <= gj + 1; b2++) {
        const cell = this.cylGrid.get(`${a},${b2}`);
        if (!cell) continue;
        for (const c of cell) {
          const dx = p.x - c.x, dz = p.z - c.z, rr = c.r + radius;
          const d2 = dx * dx + dz * dz;
          if (d2 < rr * rr && d2 > 1e-7) {
            const d = Math.sqrt(d2);
            p.x = c.x + (dx / d) * rr; p.z = c.z + (dz / d) * rr;
          }
        }
      }
    }
    // world bounds
    p.x = clamp(p.x, -WORLD_R + 24, WORLD_R - 24);
    p.z = clamp(p.z, -WORLD_R + 24, WORLD_R - 24);
  }

  // ------------------------------------------------------------- day/night
  isNight() { return this.timeOfDay > 0.58 || this.timeOfDay < 0.013; }
  phaseName() {
    const t = this.timeOfDay;
    if (t < 0.05) return "Dawn";
    if (t < 0.5) return "Day";
    if (t < 0.6) return "Dusk";
    return "Night";
  }
  update(dt, playerPos) {
    this.uTime.value += dt;
    this.timeOfDay = (this.timeOfDay + dt / this.cycleLen) % 1;
    const t = this.timeOfDay;

    // ---- weather state machine
    this.weatherT -= dt;
    if (this.weatherT <= 0) this.rollWeather();
    const wTarget = this.weather === "clear" ? 0 : 1;
    this.weatherW += (wTarget - this.weatherW) * Math.min(1, dt * 0.5);
    if (this.weather !== "clear" && this.weatherW < 0.05) this.weatherW = Math.min(1, this.weatherW + dt * 0.2);
    const wet = (this.weather === "rain" || this.weather === "storm") ? this.weatherW : 0;
    const foggy = this.weather === "fog" ? this.weatherW : 0;
    // rain streaks fall around the player
    if (wet > 0.02) {
      this.rainLines.visible = true;
      (this.rainLines.material as THREE.LineBasicMaterial).opacity = 0.42 * wet;
      const arr = (this.rainLines.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;
      const fall = (this.weather === "storm" ? 34 : 26) * dt;
      for (let i = 0; i < this.rainN; i++) {
        this.rainOff[i * 3 + 1] -= fall;
        if (this.rainOff[i * 3 + 1] < 0) {
          this.rainOff[i * 3] = (Math.random() - 0.5) * 56;
          this.rainOff[i * 3 + 1] = 22 + Math.random() * 6;
          this.rainOff[i * 3 + 2] = (Math.random() - 0.5) * 56;
        }
        const x = playerPos.x + this.rainOff[i * 3], y = playerPos.y + this.rainOff[i * 3 + 1] - 8, z = playerPos.z + this.rainOff[i * 3 + 2];
        arr[i * 6] = x; arr[i * 6 + 1] = y; arr[i * 6 + 2] = z;
        arr[i * 6 + 3] = x + 0.06; arr[i * 6 + 4] = y - 0.85; arr[i * 6 + 5] = z;
      }
      this.rainLines.geometry.attributes.position.needsUpdate = true;
    } else this.rainLines.visible = false;
    // storm lightning
    if (this.weather === "storm" && this.weatherW > 0.6) {
      this.lightningT -= dt;
      if (this.lightningT <= 0) {
        this.lightningT = 4 + Math.random() * 9;
        this.flash = 1;
        if (this.onThunder) {
          this._thunderAt.set(
            playerPos.x + (Math.random() - 0.5) * 60,
            playerPos.y + 24,
            playerPos.z + (Math.random() - 0.5) * 60
          );
          this.onThunder(this._thunderAt);
        }
      }
    }
    this.flash = Math.max(0, this.flash - dt * 2.6);
    // berry respawn
    for (const b of this.berries) {
      if (!b.ready) {
        b.respawnT -= dt;
        if (b.respawnT <= 0) { b.ready = true; this.setBerryVisible(b, true); }
      }
    }
    const sky = lerpColorStops(SKY_STOPS, t, this._skyRgb);
    const fog = lerpColorStops(FOG_STOPS, t, this._fogRgb);
    const wet2 = (this.weather === "rain" || this.weather === "storm") ? this.weatherW : 0;
    const foggy2 = this.weather === "fog" ? this.weatherW : 0;
    const greyK = wet2 * (this.weather === "storm" ? 0.62 : 0.42) + foggy2 * 0.5;
    (this.scene.background as THREE.Color).setRGB(sky[0], sky[1], sky[2]);
    if (greyK > 0) (this.scene.background as THREE.Color).lerp(this._skyGrey, greyK);
    this.scene.fog.color.setRGB(fog[0], fog[1], fog[2]);
    if (greyK > 0) this.scene.fog.color.lerp(this._fogGrey, greyK);
    // fog distance closes in for fog/storm weather
    const fogNear = 110 - foggy2 * 88 - wet2 * 40;
    const fogFar = 460 - foggy2 * 350 - wet2 * 170;
    (this.scene.fog as THREE.Fog).near += (fogNear - (this.scene.fog as THREE.Fog).near) * Math.min(1, dt * 1.2);
    (this.scene.fog as THREE.Fog).far += (fogFar - (this.scene.fog as THREE.Fog).far) * Math.min(1, dt * 1.2);

    const night = this.isNight();
    const dayAng = clamp(t / 0.58, 0, 1) * Math.PI;          // sun arc
    const nightAng = clamp((t - 0.58) / 0.42, 0, 1) * Math.PI; // moon arc
    const ang = night ? nightAng : dayAng;
    const dir = this._sunDir.set(Math.cos(ang) * 120, Math.sin(ang) * 110 + 8, 42);
    this.sun.position.copy(playerPos).add(dir);
    this.sun.target.position.copy(playerPos);
    this.sun.color.set(night ? 0x8899cc : (t > 0.5 || t < 0.05 ? 0xffc188 : 0xfff2dc));
    this.sun.intensity = night ? 0.3 : lerpStops(SUNI_STOPS, t);
    this.hemi.intensity = lerpStops(HEMI_STOPS, t);
    // weather dims the sun; lightning flash floods everything for a beat
    const dim = 1 - greyK * 0.55;
    this.sun.intensity *= dim;
    this.hemi.intensity *= dim;
    if (this.flash > 0) {
      this.hemi.intensity += this.flash * 1.8;
      this.sun.intensity += this.flash * 0.8;
    }
    // the water tracks the light source for its sun glint
    this.waterMat.uniforms.uSunDir.value.copy(dir).normalize();

    this.sunSprite.position.copy(playerPos).add(this._spriteDir.copy(dir).multiplyScalar(3.4));
    this.sunSprite.material.opacity = night ? 0 : 0.95;
    this.moonSprite.position.copy(playerPos).add(this._spriteDir.copy(dir).multiplyScalar(3.6));
    this.moonSprite.material.opacity = night ? 0.9 : 0;
    const starF = night ? smooth(0, 0.06, nightAng / Math.PI) * smooth(1, 0.94, nightAng / Math.PI) : 0;
    (this.stars.material as THREE.PointsMaterial).opacity = clamp(starF * 1.2, 0, 0.95);
    this.stars.rotation.y += dt * 0.004;

    for (const c of this.clouds) {
      c.position.x += dt * (1.9 + wet2 * 3.6);
      if (c.position.x > WORLD_R + 160) c.position.x = -WORLD_R - 160;
      c.material.opacity = (night ? 0.1 : 0.4) + greyK * 0.3;
      c.material.color.setScalar(1 - greyK * 0.5);
    }
    // lamps & windows
    const lampI = night ? 1.4 : 0;
    for (const l of this.lamps) {
      l.light.intensity += (lampI - l.light.intensity) * Math.min(1, dt * 2);
      l.mat.emissiveIntensity = night ? 1.1 : 0.08;
    }
    for (const w of this.windows) w.emissiveIntensity = night ? 1.0 : 0.05;
    // cave darkness blend
    const target = this.insideCave(playerPos) ? 1 : 0;
    this.caveDim += (target - this.caveDim) * Math.min(1, dt * 2.5);
    if (this.caveDim > 0.01) {
      this.hemi.intensity *= 1 - this.caveDim * 0.82;
      this.sun.intensity *= 1 - this.caveDim * 0.85;
    }
    this.waterMat.uniforms.uNight.value = night ? 1 : 0;
    this.updateWildlife(dt, playerPos);
  }
}
