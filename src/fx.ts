// Procedural battle VFX: pooled GPU particles, transient meshes (beams, bolts,
// rings, shards, slashes...), per-move choreography driven by data.js fx
// descriptors, hit reactions per type, plus catch/evolution/level-up sequences.
import * as THREE from "three";
import type { AudioMan } from "./audio";

// Anything that stands in the world and can be animated (MonEntity & friends).
export interface Actor {
  pos(): THREE.Vector3;
  feet(): THREE.Vector3;
  off: THREE.Vector3;
  halfH: number;
  obj?: THREE.Object3D;
  knock?(dir: THREE.Vector3, amt: number): void;
  pulse?(a: number): void;
  tintFlash?(col: string, dur: number): void;
  shake?(amp: number, dur: number): void;
  setOpacity?(o: number): void;
  spriteTex?(): THREE.Texture;
  cast?(cat: string): void;     // play an attack/cast body pose on the 3D rig
  mat?: THREE.SpriteMaterial;
}

// which body gesture a move should play, from its damage class + visual kind
export function castCatFor(move: any, kind: string): string {
  if (move.cls === "status") return "focus";
  if (move.cls === "spec") return kind === "beam" || kind === "cone" || kind === "stream" ? "beam" : "shoot";
  if (kind === "slash" || kind === "whip") return "swipe";
  if (kind === "quake") return "stomp";
  if (kind === "lob" || kind === "bone") return "shoot";   // overhand throw
  return "strike";
}

interface Particle {
  on: boolean; p: THREE.Vector3; v: THREE.Vector3; life: number; t: number;
  s0: number; s1: number; g: number; drag: number; c: THREE.Color; a0: number;
}
interface Anim { t: number; dur: number; tick: ((k: number, dt: number, t: number) => void) | null; onDone?: (() => void) | null }
interface PooledLight { l: THREE.PointLight; t: number; dur: number; i0: number }

const TYPE_FX = {
  normal: ["#efe7cf", "#c9bfa2"], fighting: ["#ffa45e", "#ffd9b0"], flying: ["#d6ecff", "#ffffff"],
  poison: ["#c45ae0", "#7a2f96"], ground: ["#d8ab57", "#8a6b3a"], rock: ["#b3a385", "#6e6354"],
  bug: ["#bbdf3e", "#e2f2a0"], ghost: ["#8a63e0", "#41246e"], fire: ["#ff7a29", "#ffd23d"],
  water: ["#3f93ff", "#bfe6ff"], grass: ["#5fd35a", "#bdf2a0"], electric: ["#ffe14d", "#fff7c2"],
  psychic: ["#d06bff", "#ffb3f2"], ice: ["#aee9ff", "#e8fbff"], dragon: ["#8a6cff", "#4d3fd1"],
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rnd = (a = 1, b = 0) => b + Math.random() * (a - b);
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

function canvasTex(draw, size = 64) {
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  draw(cv.getContext("2d"), size);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class FX {
  scene: THREE.Scene;
  camera: THREE.Camera;
  audio: AudioMan;
  anims: Anim[];
  shakeAmt: number;
  shakeOffset: THREE.Vector3;
  texSoft: THREE.CanvasTexture;
  texStar: THREE.CanvasTexture;
  texSlash: THREE.CanvasTexture;
  texZ: THREE.CanvasTexture;
  texHeart!: THREE.CanvasTexture;
  gSphere: THREE.SphereGeometry;
  gTetra: THREE.TetrahedronGeometry;
  gRock: THREE.DodecahedronGeometry;
  gRing: THREE.RingGeometry;
  gCyl: THREE.CylinderGeometry;
  gPlane: THREE.PlaneGeometry;
  N: number;
  parts: Particle[];
  pHead: number;
  points: THREE.Points;
  lights: PooledLight[];
  aimLine: THREE.Line | null = null;
  // battle scars on the land: scorch marks, craters, frost, puddles
  decals: { mesh: THREE.Mesh; t: number; life: number; a0: number }[] = [];
  gDecal!: THREE.CircleGeometry;

  constructor(scene: THREE.Scene, camera: THREE.Camera, audio: AudioMan) {
    this.scene = scene; this.camera = camera; this.audio = audio;
    this.anims = [];
    this.shakeAmt = 0;
    this.shakeOffset = V3();

    // shared textures
    this.texSoft = canvasTex((x, s) => {
      const g = x.createRadialGradient(s / 2, s / 2, 1, s / 2, s / 2, s / 2);
      g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.4, "rgba(255,255,255,.55)"); g.addColorStop(1, "rgba(255,255,255,0)");
      x.fillStyle = g; x.fillRect(0, 0, s, s);
    });
    this.texStar = canvasTex((x, s) => {
      x.translate(s / 2, s / 2); x.fillStyle = "#fff";
      x.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? s * 0.18 : s * 0.46, a = (i / 10) * Math.PI * 2 - Math.PI / 2;
        x[i ? "lineTo" : "moveTo"](Math.cos(a) * r, Math.sin(a) * r);
      }
      x.closePath(); x.fill();
    });
    this.texSlash = canvasTex((x, s) => {
      const g = x.createLinearGradient(0, s, s, 0);
      g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(0.45, "rgba(255,255,255,.9)"); g.addColorStop(0.5, "#fff"); g.addColorStop(0.55, "rgba(255,255,255,.9)"); g.addColorStop(1, "rgba(255,255,255,0)");
      x.strokeStyle = g; x.lineWidth = s * 0.07; x.lineCap = "round";
      x.beginPath(); x.moveTo(s * 0.1, s * 0.9); x.quadraticCurveTo(s * 0.5, s * 0.4, s * 0.9, s * 0.1); x.stroke();
    }, 128);
    this.texZ = canvasTex((x, s) => {
      x.fillStyle = "#fff"; x.font = `bold ${s * 0.8}px Verdana`; x.textAlign = "center"; x.textBaseline = "middle";
      x.fillText("Z", s / 2, s / 2);
    });
    this.texHeart = canvasTex((x, s) => {
      x.fillStyle = "#fff";
      x.beginPath();
      const w = s * 0.5, cx = s / 2, cy = s * 0.42;
      x.moveTo(cx, cy + w * 0.62);
      x.bezierCurveTo(cx - w, cy - w * 0.18, cx - w * 0.52, cy - w * 0.85, cx, cy - w * 0.28);
      x.bezierCurveTo(cx + w * 0.52, cy - w * 0.85, cx + w, cy - w * 0.18, cx, cy + w * 0.62);
      x.fill();
    });

    // shared geometries
    this.gSphere = new THREE.SphereGeometry(1, 10, 8);
    this.gTetra = new THREE.TetrahedronGeometry(1, 0);
    this.gRock = new THREE.DodecahedronGeometry(1, 0);
    this.gRing = new THREE.RingGeometry(0.82, 1, 40);
    this.gCyl = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true);
    this.gPlane = new THREE.PlaneGeometry(1, 1);
    this.gDecal = new THREE.CircleGeometry(1, 18);
    this.gDecal.rotateX(-Math.PI / 2); // face up

    // ---------------- particle pool ----------------
    const N = this.N = 3000;
    this.parts = [];
    const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), size = new Float32Array(N), alpha = new Float32Array(N);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("aCol", new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
    geo.boundingSphere = new THREE.Sphere(V3(), 1e6);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTex: { value: this.texSoft } },
      vertexShader: `attribute vec3 aCol; attribute float aSize; attribute float aAlpha;
        varying vec3 vC; varying float vA;
        void main(){ vC=aCol; vA=aAlpha;
          vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = aSize * (240.0 / max(1.0,-mv.z));
          gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D uTex; varying vec3 vC; varying float vA;
        void main(){ vec4 t = texture2D(uTex, gl_PointCoord);
          gl_FragColor = vec4(vC, vA) * t; }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
    for (let i = 0; i < N; i++) this.parts.push({ on: false, p: V3(), v: V3(), life: 1, t: 0, s0: 1, s1: 0, g: 0, drag: 0, c: new THREE.Color(), a0: 1 });
    this.pHead = 0;

    // light pool
    this.lights = [];
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 18, 1.7);
      scene.add(l);
      this.lights.push({ l, t: 9, dur: 1, i0: 0 });
    }
  }

  // ------------------------------------------------------------- animation
  anim(dur: number, tick?: Anim["tick"], onDone?: (() => void) | null) {
    this.anims.push({ t: 0, dur, tick: tick || null, onDone });
  }
  after(delay, fn) { this.anim(delay, null, fn); }

  update(dt) {
    // particles
    const pos = this.points.geometry.attributes.position;
    const colA = this.points.geometry.attributes.aCol;
    const sizeA = this.points.geometry.attributes.aSize;
    const alphaA = this.points.geometry.attributes.aAlpha;
    for (let i = 0; i < this.N; i++) {
      const p = this.parts[i];
      if (!p.on) continue;
      p.t += dt;
      if (p.t >= p.life) { p.on = false; sizeA.array[i] = 0; alphaA.array[i] = 0; continue; }
      p.v.y -= p.g * dt;
      if (p.drag) p.v.multiplyScalar(Math.max(0, 1 - p.drag * dt));
      p.p.addScaledVector(p.v, dt);
      const k = p.t / p.life;
      pos.array[i * 3] = p.p.x; pos.array[i * 3 + 1] = p.p.y; pos.array[i * 3 + 2] = p.p.z;
      sizeA.array[i] = p.s0 + (p.s1 - p.s0) * k;
      alphaA.array[i] = p.a0 * (1 - k) * Math.min(1, p.t * 12);
      colA.array[i * 3] = p.c.r; colA.array[i * 3 + 1] = p.c.g; colA.array[i * 3 + 2] = p.c.b;
    }
    pos.needsUpdate = colA.needsUpdate = sizeA.needsUpdate = alphaA.needsUpdate = true;
    // anims
    for (let i = this.anims.length - 1; i >= 0; i--) {
      const a = this.anims[i];
      a.t += dt;
      if (a.tick) a.tick(Math.min(1, a.t / a.dur), dt, a.t);
      if (a.t >= a.dur) {
        this.anims.splice(i, 1);
        if (a.onDone) a.onDone();
      }
    }
    // lights
    for (const e of this.lights) {
      e.t += dt;
      e.l.intensity = e.t < e.dur ? e.i0 * (1 - e.t / e.dur) : 0;
    }
    // camera shake
    this.shakeAmt *= Math.exp(-6 * dt);
    this.shakeOffset.set((Math.random() - 0.5) * this.shakeAmt, (Math.random() - 0.5) * this.shakeAmt * 0.6, (Math.random() - 0.5) * this.shakeAmt);
    // ground decals fade out and vanish
    for (let i = this.decals.length - 1; i >= 0; i--) {
      const d = this.decals[i];
      d.t += dt;
      const k = d.t / d.life;
      if (k >= 1) { this.kill(d.mesh); this.decals.splice(i, 1); continue; }
      (d.mesh.material as THREE.MeshBasicMaterial).opacity = d.a0 * (1 - k * k);
    }
  }

  // ------------------------------------------------------------ primitives
  burst(at, { count = 14, col = "#fff", col2 = null, speed = 4, size = 0.3, life = 0.5, g = 3, up = 1.6, drag = 0, sizeEnd = 0.05, tex = null } = {}) {
    const c1 = new THREE.Color(col), c2 = new THREE.Color(col2 || col);
    for (let n = 0; n < count; n++) {
      const i = this.pHead = (this.pHead + 1) % this.N;
      const p = this.parts[i];
      p.on = true; p.t = 0; p.life = life * rnd(1.25, 0.7);
      p.p.copy(at);
      p.v.set(rnd(1, -1), rnd(1, -1) + up / speed, rnd(1, -1)).normalize().multiplyScalar(speed * rnd(1.3, 0.45));
      p.g = g; p.drag = drag;
      p.s0 = size * rnd(1.3, 0.7); p.s1 = sizeEnd;
      p.c.lerpColors(c1, c2, Math.random());
      p.a0 = 1;
    }
  }
  emit(dur, rate, fn) { // sustained emitter: fn(spawn) called `rate`/sec
    let acc = 0;
    this.anim(dur, (k, dt) => {
      acc += dt * rate;
      while (acc >= 1) { acc -= 1; fn(); }
    });
  }
  flashLight(at, col = "#fff", intensity = 3, dur = 0.25, range = 16) {
    const e = this.lights.sort((a, b) => b.t / b.dur - a.t / a.dur)[0];
    e.l.position.copy(at); e.l.color.set(col); e.l.distance = range;
    e.t = 0; e.dur = dur; e.i0 = intensity;
  }
  mesh(geoOrMesh, mat?) {
    const m = geoOrMesh.isObject3D ? geoOrMesh : new THREE.Mesh(geoOrMesh, mat);
    this.scene.add(m);
    return m;
  }
  kill(m) {
    this.scene.remove(m);
    m.traverse?.((o) => { if (o.material && !o.material._shared) o.material.dispose(); });
    if (m.material && !m.material._shared) m.material.dispose();
  }
  basic(col, opacity = 1, blend = true) {
    return new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity, depthWrite: false, blending: blend ? THREE.AdditiveBlending : THREE.NormalBlending, side: THREE.DoubleSide });
  }
  spriteOf(tex, col, scale = 1, rotation = 0) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: col, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, rotation }));
    s.scale.set(scale, scale, 1);
    this.scene.add(s);
    return s;
  }
  ringAt(at, { col = "#fff", r0 = 0.2, r1 = 3, dur = 0.4, axis = "y", op = 0.9, width = 1 } = {}) {
    const m = this.mesh(this.gRing, this.basic(col, op));
    m.geometry = this.gRing; m.material._shared = false;
    if (axis === "y") m.rotation.x = -Math.PI / 2;
    else if (axis === "cam") m.quaternion.copy(this.camera.quaternion);
    m.position.copy(at);
    m.scale.setScalar(r0);
    this.anim(dur, (k) => {
      const r = r0 + (r1 - r0) * k;
      m.scale.set(r, r, r * width);
      m.material.opacity = op * (1 - k);
    }, () => this.kill(m));
  }
  beamBetween(a, b, { col = "#fff", width = 0.15, dur = 0.3, col2 = null } = {}) {
    const dir = b.clone().sub(a), len = dir.length();
    const m = this.mesh(this.gCyl, this.basic(col, 0.85));
    m.scale.set(width, len, width);
    m.position.copy(a).addScaledVector(dir, 0.5);
    m.quaternion.setFromUnitVectors(V3(0, 1, 0), dir.normalize());
    const glow = this.mesh(this.gCyl, this.basic(col2 || col, 0.3));
    glow.scale.set(width * 2.6, len, width * 2.6);
    glow.position.copy(m.position); glow.quaternion.copy(m.quaternion);
    this.anim(dur, (k) => {
      const o = k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85;
      m.material.opacity = 0.9 * o; glow.material.opacity = 0.3 * o;
    }, () => { this.kill(m); this.kill(glow); });
  }
  boltBetween(a, b, { col = "#ffe14d", width = 0.08, dur = 0.3, segs = 9 } = {}) {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array((segs + 1) * 3);
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const lm = new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false });
    const line = new THREE.Line(geo, lm);
    this.scene.add(line);
    const jitter = () => {
      const dir = b.clone().sub(a);
      const perp1 = V3(-dir.z, 0, dir.x).normalize(), perp2 = V3(0, 1, 0);
      for (let i = 0; i <= segs; i++) {
        const t = i / segs;
        const p = a.clone().addScaledVector(dir, t);
        if (i > 0 && i < segs) {
          const w = Math.sin(t * Math.PI) * dir.length() * 0.14;
          p.addScaledVector(perp1, rnd(w, -w)).addScaledVector(perp2, rnd(w, -w));
        }
        positions[i * 3] = p.x; positions[i * 3 + 1] = p.y; positions[i * 3 + 2] = p.z;
        if (Math.random() < 0.45) this.burst(p, { count: 1, col, speed: 0.6, size: width * 4 + 0.12, life: 0.18, g: 0 });
      }
      geo.attributes.position.needsUpdate = true;
    };
    jitter();
    let jt = 0;
    this.anim(dur, (k, dt) => {
      jt += dt;
      if (jt > 0.055) { jt = 0; jitter(); }
      lm.opacity = 1 - k * k;
    }, () => { this.scene.remove(line); geo.dispose(); lm.dispose(); });
  }
  chunks(at, { count = 7, col = "#b3a385", size = 0.22, speed = 5, geo = null, life = 0.7, up = 4 } = {}) {
    for (let i = 0; i < count; i++) {
      const m = this.mesh(geo || this.gRock, new THREE.MeshLambertMaterial({ color: col }));
      const s = size * rnd(1.5, 0.6);
      m.scale.setScalar(s);
      m.position.copy(at);
      const v = V3(rnd(1, -1), 0, rnd(1, -1)).normalize().multiplyScalar(speed * rnd(1.2, 0.5));
      v.y = up * rnd(1.2, 0.6);
      const rot = V3(rnd(9, -9), rnd(9, -9), rnd(9, -9));
      this.anim(life * rnd(1.2, 0.8), (k, dt) => {
        v.y -= 14 * dt;
        m.position.addScaledVector(v, dt);
        m.rotation.x += rot.x * dt; m.rotation.y += rot.y * dt;
        if (k > 0.7) m.scale.setScalar(s * (1 - (k - 0.7) / 0.3));
      }, () => this.kill(m));
    }
  }
  // ------------------------------------- the world remembers the battle (v5)
  // A fading mark on the terrain, tilted to the local slope.
  groundDecal(at, world, { col = "#222", size = 1.2, life = 14, op = 0.5 } = {}) {
    const y = world.height(at.x, at.z);
    if (y < world.waterY - 0.2) return null;            // no decals underwater
    const m = new THREE.Mesh(this.gDecal, new THREE.MeshBasicMaterial({
      color: col, transparent: true, opacity: op, depthWrite: false,
    }));
    // tilt to terrain normal so marks hug slopes
    const e = 0.6;
    const nx = world.height(at.x - e, at.z) - world.height(at.x + e, at.z);
    const nz = world.height(at.x, at.z - e) - world.height(at.x, at.z + e);
    const normal = V3(nx, 2 * e, nz).normalize();
    m.quaternion.setFromUnitVectors(V3(0, 1, 0), normal);
    m.scale.setScalar(size);
    m.position.set(at.x, y + 0.04, at.z);
    m.renderOrder = 1;
    this.scene.add(m);
    this.decals.push({ mesh: m, t: 0, life, a0: op });
    while (this.decals.length > 22) { const d = this.decals.shift(); this.kill(d.mesh); }
    return m;
  }
  // type-flavored aftermath where a move lands: scorch, crater, frost, sprouts...
  groundFX(type, at, { big = false, world, inWater = false } = {} as any) {
    const sz = (big ? 1.6 : 1.05) * rnd(1.15, 0.85);
    if (inWater) {
      this.burst(at.clone().setY(world.waterY + 0.1), { count: big ? 16 : 9, col: "#bfe6ff", col2: "#7db8e8", speed: 2.8, size: 0.3, life: 0.5 });
      return;
    }
    switch (type) {
      case "fire":
        this.groundDecal(at, world, { col: "#1f1410", size: sz, life: 16, op: 0.55 });
        this.burst(at, { count: big ? 12 : 6, col: "#ff9a3d", col2: "#ffd166", speed: 2.2, size: 0.24, life: 0.5, g: -1.2 });
        this.burst(at.clone().add(V3(0, 0.4, 0)), { count: 5, col: "#5a5a5a", speed: 0.7, size: 0.5, life: 1.2, g: -0.9, drag: 1.2 });
        break;
      case "electric":
        this.groundDecal(at, world, { col: "#2e2a16", size: sz * 0.9, life: 12, op: 0.5 });
        this.burst(at, { count: big ? 12 : 7, col: "#ffe14d", col2: "#fff7b0", speed: 3.4, size: 0.2, life: 0.35, g: 0 });
        break;
      case "water":
        this.groundDecal(at, world, { col: "#33506e", size: sz * 1.15, life: 6, op: 0.42 });
        this.burst(at, { count: big ? 14 : 8, col: "#9fd0ff", col2: "#e3f2ff", speed: 2.6, size: 0.26, life: 0.45 });
        break;
      case "ice":
        this.groundDecal(at, world, { col: "#cfeaf8", size: sz, life: 10, op: 0.45 });
        this.burst(at, { count: big ? 10 : 6, col: "#eaf6ff", speed: 1.8, size: 0.22, life: 0.5, tex: this.texStar });
        break;
      case "grass": case "bug":
        this.groundDecal(at, world, { col: "#2c5226", size: sz, life: 12, op: 0.4 });
        this.burst(at, { count: big ? 12 : 7, col: "#69b552", col2: "#a4e08a", speed: 2.0, size: 0.22, life: 0.6, g: 2 });
        if (big) this.burst(at, { count: 5, col: "#ff9ad5", col2: "#ffd1e8", speed: 1.2, size: 0.18, life: 0.8, g: 1.4 });
        break;
      case "ground": case "rock": case "fighting":
        this.groundDecal(at, world, { col: "#4a3b28", size: sz * 1.1, life: 18, op: 0.5 });
        this.chunks(at, { count: big ? 9 : 5, col: "#8a7257", size: 0.2, speed: 3.6, life: 0.6 });
        this.ringAt(at.clone().add(V3(0, 0.12, 0)), { col: "#c4a877", r0: 0.3, r1: big ? 3.2 : 2, dur: 0.5, op: 0.5 });
        break;
      case "poison":
        this.groundDecal(at, world, { col: "#3a2a44", size: sz, life: 12, op: 0.48 });
        this.burst(at, { count: big ? 10 : 6, col: "#b06ad8", col2: "#7a3fa8", speed: 1.4, size: 0.3, life: 0.8, g: -0.6 });
        break;
      case "psychic": case "ghost": case "dragon":
        this.ringAt(at.clone().add(V3(0, 0.15, 0)), { col: type === "psychic" ? "#e87dc9" : "#b08aff", r0: 0.2, r1: big ? 3 : 1.8, dur: 0.55 });
        break;
      default: // normal, flying...: a puff of biome dust, no lasting mark
        this.burst(at, { count: big ? 9 : 5, col: "#cbb89a", col2: "#e8dcc0", speed: 2.2, size: 0.3, life: 0.4 });
    }
  }
  // heavy impacts in caves rattle debris loose from the ceiling
  caveDebris(at, world) {
    for (let i = 0; i < 5; i++) {
      const x = at.x + rnd(3.4, -3.4), z = at.z + rnd(3.4, -3.4);
      const floor = world.height(x, z);
      const m = this.mesh(this.gRock, new THREE.MeshLambertMaterial({ color: 0x6e6258 }));
      const s = rnd(0.3, 0.12);
      m.scale.setScalar(s);
      m.position.set(x, floor + rnd(7, 5), z);
      const spin = rnd(8, -8);
      let vy = 0;
      this.anim(1.6, (k, dt) => {
        vy -= 22 * dt;
        m.position.y += vy * dt;
        m.rotation.x += spin * dt;
        if (m.position.y <= floor + s * 0.4) {
          m.position.y = floor + s * 0.4;
          if (vy < -4) {
            this.burst(m.position, { count: 4, col: "#9a8d7d", speed: 1.4, size: 0.2, life: 0.35 });
            this.audio.play("balldrop");
          }
          vy = 0;
        }
      }, () => this.kill(m));
    }
  }
  slashAt(at, { col = "#fff", n = 1, size = 1.6, stagger = 0.1 } = {}) {
    for (let i = 0; i < n; i++) {
      this.after(i * stagger, () => {
        const s = this.spriteOf(this.texSlash, col, size, rnd(0.6, -0.6) + (i % 2 ? Math.PI / 2 : 0));
        s.position.copy(at).add(V3(rnd(0.3, -0.3), rnd(0.3, -0.3), rnd(0.3, -0.3)));
        this.anim(0.26, (k) => {
          s.material.opacity = 1 - k;
          s.scale.setScalar(size * (0.6 + k * 0.9));
        }, () => this.kill(s));
      });
    }
  }
  projectileTo(a, b, { col = "#fff", col2 = null, size = 0.3, speed = 14, arc = 0, spin = 0, tex = null, mesh = null, trail = true, quad = false } = {}) {
    return new Promise<void>((res) => {
      const dist = a.distanceTo(b);
      const dur = clamp(dist / speed, 0.12, 1.4);
      let m;
      if (mesh) m = this.mesh(mesh);
      else if (quad) {
        m = this.mesh(this.gPlane, this.basic(col, 1, false));
        m.scale.setScalar(size * 2);
      } else {
        m = this.spriteOf(tex || this.texSoft, col, size * 3.2);
      }
      const c2 = col2 || col;
      this.anim(dur, (k, dt) => {
        const p = a.clone().lerp(b, k);
        p.y += Math.sin(k * Math.PI) * arc;
        m.position.copy(p);
        if (spin) { m.rotation.z += spin * dt; m.rotation.x += spin * 0.6 * dt; }
        if (m.material?.rotation !== undefined) m.material.rotation += spin * dt;
        if (trail && Math.random() < 0.7) this.burst(p, { count: 1, col: c2, speed: 0.4, size: size * 1.1, life: 0.3, g: 0 });
      }, () => { this.kill(m); res(); });
    });
  }

  // ------------------------------------------------------- move FX runner
  descFor(move) {
    const [col, col2] = TYPE_FX[move.type] || TYPE_FX.normal;
    const h = (salt) => (((move.id * 2654435761 + salt * 97) >>> 0) % 1000) / 1000;
    const d = Object.assign(
      { col, col2, kind: move.cls === "status" ? "auto" : move.cls === "phys" ? "dash" : "proj",
        size: 0.2 + (move.power || 40) / 320, speed: 12 + h(1) * 8, count: 1 + Math.floor(h(2) * 2.4),
        arc: h(3) * 1.6, n: 1 },
      move.fx || {}
    );
    d.sizeMul = 0.85 + h(4) * 0.4;
    d.big = d.big || (move.power >= 110 ? 1 : 0);
    return d;
  }

  // attacker/defender: actors {pos(), feet(), off, halfH, knock(), pulse(), tintFlash()}
  playMove(move, atk, def, onImpact) {
    const d = this.descFor(move);
    const A = () => atk.pos(), B = () => def.pos();
    const a0 = A().clone(), b0 = B().clone();
    const impact = () => { if (onImpact) { onImpact(); onImpact = null; } };
    const charge = d.charge ? d.charge : (move.tags?.charge ? 0.55 : 0);
    const start = () => {
      this.audio.cast(move.type, { kind: d.kind, big: !!d.big });
      atk.cast?.(castCatFor(move, d.kind));     // the rig rears back, swings, opens up
      this.runKind(d, move, atk, def, a0, b0, impact);
    };
    // attacker animation
    if (move.cls === "phys" && d.kind !== "dash" && d.kind !== "fly" && d.kind !== "toss" && d.kind !== "dig") this.lunge(atk, b0, 0.7);
    else if (move.cls === "spec") this.recoilHop(atk, b0, -0.35);
    else if (move.cls === "status") this.recoilHop(atk, b0, 0.001, 0.18);
    if (charge) {
      this.audio.play("charge");
      this.chargeGlow(atk, d.col, charge);
      atk.cast?.("focus");                       // gather/brace during the wind-up
      this.after(charge, start);
    } else start();
    return charge + 0.9; // rough total
  }

  lunge(actor, toward, dist = 1.1, dur = 0.24) {
    const dir = toward.clone().sub(actor.pos()).setY(0).normalize().multiplyScalar(dist);
    this.anim(dur, (k) => {
      const w = Math.sin(k * Math.PI);
      actor.off.x = dir.x * w; actor.off.z = dir.z * w;
      actor.off.y = Math.sin(k * Math.PI) * 0.25;
    }, () => { actor.off.x = actor.off.z = actor.off.y = 0; });
  }
  recoilHop(actor, toward, dist = -0.4, dur = 0.22) {
    const dir = toward.clone().sub(actor.pos()).setY(0).normalize().multiplyScalar(dist);
    this.anim(dur, (k) => {
      const w = Math.sin(k * Math.PI);
      actor.off.x = dir.x * w; actor.off.z = dir.z * w;
      actor.off.y = Math.abs(Math.sin(k * Math.PI * 2)) * 0.18;
    }, () => { actor.off.x = actor.off.z = actor.off.y = 0; });
  }
  chargeGlow(actor, col, dur) {
    this.emit(dur, 40, () => {
      const c = actor.pos();
      const a = rnd(Math.PI * 2), r = rnd(1.6, 0.7);
      const p = c.clone().add(V3(Math.cos(a) * r, rnd(0.8, -0.8), Math.sin(a) * r));
      const i = this.pHead = (this.pHead + 1) % this.N;
      const pt = this.parts[i];
      pt.on = true; pt.t = 0; pt.life = 0.3;
      pt.p.copy(p); pt.v.copy(c.clone().sub(p).multiplyScalar(3.2));
      pt.g = 0; pt.drag = 0; pt.s0 = 0.22; pt.s1 = 0.05; pt.c.set(col); pt.a0 = 1;
    });
    this.flashLight(actor.pos(), col, 1.2, dur, 8);
  }

  runKind(d, move, atk, def, a0, b0, impact) {
    const big = d.big, col = d.col, col2 = d.col2;
    const groundY = def.feet().y;
    const impactBurst = (sc = 1) => {
      this.burst(def.pos(), { count: big ? 26 : 14, col, col2, speed: (big ? 6 : 4) * sc, size: (big ? 0.42 : 0.3) * d.sizeMul, life: 0.45 });
      this.flashLight(def.pos(), col, big ? 3.4 : 2, 0.25, big ? 18 : 11);
    };
    switch (d.kind) {
      case "dash": {
        this.lunge(atk, b0, Math.min(4.5, a0.distanceTo(b0) * 0.65), 0.3);
        if (d.blur) this.emit(0.3, 60, () => this.burst(atk.pos(), { count: 1, col: "#fff", speed: 0.2, size: 0.5, life: 0.18, g: 0 }));
        this.after(0.21, () => {
          impactBurst(d.bone ? 1.2 : 1);
          if (d.burst) this.burst(def.pos(), { count: 16, col: TYPE_FX[d.burst][0], col2: TYPE_FX[d.burst][1], speed: 4.5, size: 0.3, life: 0.5 });
          this.burst(def.feet(), { count: 8, col: "#cbb37e", speed: 2.5, size: 0.5, life: 0.5, up: 2.2, sizeEnd: 0.7 });
          impact();
        });
        break;
      }
      case "proj": {
        const count = d.count || 1;
        for (let i = 0; i < count; i++) {
          this.after(i * 0.07, () => {
            const from = atk.pos().clone().add(V3(rnd(0.4, -0.4), rnd(0.4, -0.2), rnd(0.4, -0.4)));
            const to = def.pos().clone().add(V3(rnd(0.5, -0.5), rnd(0.4, -0.4), rnd(0.5, -0.5)));
            const tex = d.star ? this.texStar : null;
            this.projectileTo(from, to, { col, col2, size: (d.size || 0.3) * d.sizeMul * (big ? 1.5 : 1), speed: d.speed, arc: d.arc * 0.5, spin: d.spin ? 9 : 2, tex, quad: d.quad })
              .then(() => {
                this.burst(to, { count: 8, col, col2, speed: 3, size: 0.24, life: 0.35 });
                if (i === 0) { impactBurst(); impact(); }
              });
          });
        }
        break;
      }
      case "stream": {
        const total = d.count || 10;
        for (let i = 0; i < total; i++) {
          this.after(i * 0.035, () => {
            const from = atk.pos().clone().add(V3(rnd(0.25, -0.25), rnd(0.3, -0.1), rnd(0.25, -0.25)));
            const to = def.pos().clone().add(V3(rnd(0.6, -0.6), rnd(0.5, -0.5), rnd(0.6, -0.6)));
            this.projectileTo(from, to, { col, col2, size: (d.size || 0.14) * (big ? 1.6 : 1), speed: d.speed || 24, trail: false })
              .then(() => this.burst(to, { count: 3, col: col2, speed: 2.4, size: 0.18, life: 0.3 }));
          });
        }
        this.after(0.2, () => { impactBurst(big ? 1.4 : 0.9); impact(); });
        break;
      }
      case "lob": {
        const count = d.count || 1;
        for (let i = 0; i < count; i++) {
          this.after(i * 0.1, () => {
            const mesh = d.rock ? new THREE.Mesh(this.gRock, new THREE.MeshLambertMaterial({ color: col })) : null;
            if (mesh) mesh.scale.setScalar(d.size * 2);
            this.projectileTo(atk.pos(), def.pos().clone(), { col, col2, size: d.size, speed: d.speed || 9, arc: 2.6, spin: 5, mesh })
              .then(() => {
                if (i === 0) { impactBurst(); impact(); }
                this.burst(def.feet(), { count: 7, col: col2, speed: 3, size: 0.3, life: 0.4 });
              });
          });
        }
        break;
      }
      case "beam": {
        const show = () => {
          const cols = d.rainbow ? ["#ff6b6b", "#ffd93d", "#6bcB77", "#4d96ff", "#c780fa"] : [col];
          cols.forEach((c, i) => {
            const off = V3(0, (i - (cols.length - 1) / 2) * 0.12, 0);
            this.beamBetween(atk.pos().clone().add(off), def.pos().clone().add(off), { col: c, col2, width: (d.width || 0.2) * (d.rainbow ? 0.5 : 1), dur: d.wavy ? 0.45 : 0.4 });
          });
          if (d.wavy) this.emit(0.35, 60, () => {
            const k = Math.random();
            const p = atk.pos().clone().lerp(def.pos(), k);
            p.y += Math.sin(k * 14 + performance.now() * 0.02) * 0.3;
            this.burst(p, { count: 1, col, speed: 0.3, size: 0.2, life: 0.2, g: 0 });
          });
          this.flashLight(atk.pos(), col, 1.6, 0.3, 9);
          this.after(0.08, () => { impactBurst(1.2); impact(); if (big) this.shakeAmt = Math.max(this.shakeAmt, 0.16); });
        };
        show();
        break;
      }
      case "bolt": {
        const n = d.n || 1;
        for (let i = 0; i < n; i++) {
          this.after(i * 0.12, () => {
            const from = d.sky ? def.pos().clone().add(V3(rnd(2, -2), 9 + rnd(2), rnd(2, -2))) : atk.pos().clone();
            this.boltBetween(from, def.pos(), { col, width: d.width || 0.08, dur: 0.28 });
            this.flashLight(def.pos(), col, big ? 4 : 2.6, 0.22, 16);
            if (d.sky) this.ringAt(def.feet().clone().add(V3(0, 0.1, 0)), { col, r0: 0.3, r1: 2.6, dur: 0.4 });
            if (i === 0) { impact(); }
          });
        }
        if (big) this.after(0.05, () => (this.shakeAmt = Math.max(this.shakeAmt, 0.2)));
        break;
      }
      case "cone": {
        const dur = d.sustain || 0.55;
        this.emit(dur, d.shards ? 70 : 110, () => {
          const from = atk.pos().clone().add(V3(0, 0.1, 0));
          const dir = def.pos().clone().sub(from).normalize();
          const side = V3(-dir.z, 0, dir.x);
          const v = dir.clone().multiplyScalar(rnd(15, 9)).addScaledVector(side, rnd(d.wide ? 3.4 : 1.7, d.wide ? -3.4 : -1.7)).add(V3(0, rnd(1.4, -1), 0));
          const i = this.pHead = (this.pHead + 1) % this.N;
          const pt = this.parts[i];
          pt.on = true; pt.t = 0; pt.life = rnd(0.5, 0.3);
          pt.p.copy(from); pt.v.copy(v);
          pt.g = -1; pt.drag = 1.6;
          pt.s0 = rnd(0.5, 0.25) * (big ? 1.5 : 1); pt.s1 = 0.06;
          pt.c.set(Math.random() < 0.5 ? col : col2); pt.a0 = 0.95;
        });
        if (d.shards) this.emit(dur, 26, () => this.chunks(atk.pos(), { count: 1, col: "#cfeffd", size: 0.16, speed: 12, geo: this.gTetra, life: 0.5, up: 1 }));
        this.emit(dur, 18, () => this.flashLight(atk.pos().clone().lerp(def.pos(), 0.4), col, 1.6, 0.12, 10));
        this.after(0.24, () => { impactBurst(); impact(); });
        break;
      }
      case "wave": {
        const m = this.mesh(this.gPlane, this.basic(col, 0.55));
        m.scale.set(5, 1.4, 1);
        const dir = b0.clone().sub(a0).setY(0).normalize();
        m.quaternion.setFromUnitVectors(V3(0, 0, 1), dir);
        this.anim(0.45, (k) => {
          const p = a0.clone().lerp(b0, k);
          m.position.copy(p).setY(groundY + 0.8 + k * 0.6);
          m.scale.set(5 + k * 3, 1.4 + k * 1.6, 1);
          m.material.opacity = 0.55 * (1 - k * 0.5);
          if (Math.random() < 0.8) this.burst(m.position, { count: 2, col: col2, speed: 2, size: 0.3, life: 0.3 });
        }, () => {
          this.kill(m);
          impactBurst(1.5);
          this.burst(def.feet(), { count: 22, col, col2, speed: 5, size: 0.35, life: 0.55 });
          impact();
        });
        break;
      }
      case "ring": {
        const from = d.forward ? a0.clone() : def.pos().clone();
        if (d.forward) {
          const m = this.mesh(this.gRing, this.basic(col, 0.9));
          m.quaternion.setFromUnitVectors(V3(0, 0, 1), b0.clone().sub(a0).normalize());
          this.anim(0.3, (k) => {
            m.position.copy(a0.clone().lerp(b0, k));
            m.scale.setScalar(0.4 + k * 1.6);
            m.material.opacity = 0.9 * (1 - k * 0.4);
          }, () => { this.kill(m); impactBurst(); impact(); });
        } else {
          for (let i = 0; i < (d.n || 2); i++) this.after(i * 0.12, () => this.ringAt(from, { col, r0: 0.3, r1: d.fast ? 2.2 : 1.6, dur: d.fast ? 0.25 : 0.5, axis: "cam" }));
          this.after(0.25, impact);
          if (d.jag) this.shakeAmt = Math.max(this.shakeAmt, 0.1);
        }
        break;
      }
      case "ringorbit": {
        const dur = d.sustain || 0.6;
        const rings = [];
        for (let i = 0; i < 3; i++) {
          const m = this.mesh(this.gRing, this.basic(col, 0.8));
          m.rotation.x = -Math.PI / 2;
          rings.push(m);
        }
        this.anim(dur, (k, dt, t) => {
          rings.forEach((m, i) => {
            const c = def.pos();
            m.position.set(c.x, def.feet().y + 0.4 + i * def.halfH * 0.7 + Math.sin(t * 6 + i) * 0.1, c.z);
            const r = (1.6 - k * 0.7) * (1 + i * 0.14);
            m.scale.setScalar(Math.max(0.2, r));
            m.rotation.z += dt * (3 + i);
            m.material.opacity = 0.8 * (1 - k * 0.7);
          });
        }, () => rings.forEach((m) => this.kill(m)));
        this.emit(dur, 30, () => this.burst(def.pos().clone().add(V3(rnd(1, -1), rnd(1, -1), rnd(1, -1))), { count: 1, col, speed: 0.5, size: 0.2, life: 0.25, g: 0 }));
        this.after(0.22, impact);
        break;
      }
      case "pulse": {
        const n = d.n || 2;
        for (let i = 0; i < n; i++) this.after(i * (d.slow ? 0.22 : 0.13), () => {
          this.ringAt(def.pos(), { col, r0: big ? 2.6 : 1.7, r1: 0.25, dur: d.slow ? 0.45 : 0.3, axis: "cam" });
          this.flashLight(def.pos(), col, 1.6, 0.2, 10);
        });
        if (d.orb) {
          const s = this.spriteOf(this.texSoft, col, 1.1);
          this.anim(0.6, (k, dt, t) => {
            const c = def.pos();
            s.position.set(c.x + Math.cos(t * 9) * 1.2, c.y + Math.sin(t * 13) * 0.5, c.z + Math.sin(t * 9) * 1.2);
          }, () => this.kill(s));
        }
        def.pulse?.(0.5);
        this.after(0.28, impact);
        break;
      }
      case "tornado": {
        const rings = [];
        for (let i = 0; i < 4; i++) {
          const m = this.mesh(this.gRing, this.basic(col, 0.75));
          m.rotation.x = -Math.PI / 2;
          rings.push(m);
        }
        this.anim(0.5, (k, dt, t) => {
          const p = a0.clone().lerp(b0, k);
          rings.forEach((m, i) => {
            m.position.set(p.x + Math.cos(t * 12 + i * 2) * 0.2, groundY + 0.3 + i * 0.55, p.z + Math.sin(t * 12 + i * 2) * 0.2);
            m.scale.setScalar(0.5 + i * 0.3);
            m.rotation.z += dt * 11;
          });
        }, () => { rings.forEach((m) => this.kill(m)); impactBurst(); impact(); });
        break;
      }
      case "slash": {
        this.after(0.1, () => {
          this.slashAt(def.pos(), { col: col2 || "#fff", n: d.n || 1, size: big ? 2.4 : 1.7 });
          this.after(0.08, impact);
        });
        break;
      }
      case "whip": {
        const mid = a0.clone().lerp(b0, 0.5).add(V3(0, 2.2, 0));
        const curve = new THREE.QuadraticBezierCurve3(a0, mid, b0);
        const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 14, 0.09, 6), this.basic(col, 0.95));
        this.scene.add(tube);
        this.anim(0.3, (k) => { tube.material.opacity = 0.95 * (1 - k); },
          () => { this.scene.remove(tube); tube.geometry.dispose(); tube.material.dispose(); });
        this.after(0.12, () => { impactBurst(); impact(); });
        break;
      }
      case "drain": {
        this.after(0.1, () => { impactBurst(0.8); impact(); });
        for (let i = 0; i < 5; i++) {
          this.after(0.18 + i * 0.07, () => {
            this.projectileTo(def.pos().clone().add(V3(rnd(0.5, -0.5), rnd(0.5, -0.5), rnd(0.5, -0.5))), atk.pos(), { col: d.dark ? "#b04cff" : col, size: 0.26, speed: 10, arc: 0.8 });
          });
        }
        break;
      }
      case "cloud": {
        const at = d.self ? atk : def;
        this.emit(0.55, 60, () => {
          const c = at.pos().clone().add(V3(rnd(1, -1), rnd(1.2, -0.4), rnd(1, -1)));
          const i = this.pHead = (this.pHead + 1) % this.N;
          const pt = this.parts[i];
          pt.on = true; pt.t = 0; pt.life = rnd(0.9, 0.5);
          pt.p.copy(c); pt.v.set(rnd(0.4, -0.4), rnd(0.5, 0.1), rnd(0.4, -0.4));
          pt.g = -0.2; pt.drag = 0.4; pt.s0 = rnd(0.8, 0.5); pt.s1 = 1.1;
          pt.c.set(Math.random() < 0.6 ? col : col2); pt.a0 = 0.5;
        });
        this.after(0.35, impact);
        break;
      }
      case "quake": {
        this.shakeAmt = Math.max(this.shakeAmt, 0.34);
        for (let i = 0; i < 3; i++) this.after(i * 0.1, () => this.ringAt(atk.feet().clone().add(V3(0, 0.15, 0)), { col: "#cbb37e", r0: 1, r1: 9 + i * 3, dur: 0.5, op: 0.6 }));
        this.after(0.2, () => {
          this.chunks(def.feet(), { count: 9, col: "#9a8a6a", size: 0.3, speed: 4, up: 6 });
          this.burst(def.feet(), { count: 24, col: "#cbb37e", col2: "#8a6b3a", speed: 4, size: 0.5, life: 0.6, sizeEnd: 0.8 });
          if (d.crack) this.beamBetween(atk.feet().clone().add(V3(0, 0.1, 0)), def.feet().clone().add(V3(0, 0.1, 0)), { col: "#3a2f22", width: 0.4, dur: 0.5 });
          impact();
        });
        break;
      }
      case "dig": {
        this.burst(atk.feet(), { count: 16, col: "#cbb37e", speed: 3, size: 0.45, life: 0.5, sizeEnd: 0.7 });
        this.anim(0.22, (k) => { atk.off.y = -k * (atk.halfH * 2); });
        this.after(0.5, () => {
          this.anim(0.18, (k) => { atk.off.y = -(atk.halfH * 2) * (1 - k); }, () => (atk.off.y = 0));
          this.chunks(def.feet(), { count: 8, col: "#9a8a6a", size: 0.26, speed: 4, up: 7 });
          this.burst(def.pos(), { count: 18, col: "#cbb37e", col2: "#8a6b3a", speed: 5, size: 0.4, life: 0.5 });
          impact();
        });
        break;
      }
      case "fly": {
        const up = d.short ? 2.6 : 5;
        this.anim(0.26, (k) => { atk.off.y = k * up; });
        this.after(0.34, () => {
          const dir = b0.clone().sub(a0);
          this.anim(0.16, (k) => {
            atk.off.y = up * (1 - k);
            atk.off.x = dir.x * 0.7 * k; atk.off.z = dir.z * 0.7 * k;
          }, () => { atk.off.set(0, 0, 0); });
          this.after(0.15, () => { impactBurst(1.2); this.burst(def.feet(), { count: 10, col: "#fff", speed: 4, size: 0.3, life: 0.4 }); impact(); });
        });
        break;
      }
      case "toss": {
        this.lunge(atk, b0, Math.min(4, a0.distanceTo(b0) * 0.6), 0.26);
        this.after(0.2, () => {
          this.anim(0.3, (k) => { def.off.y = Math.sin(k * Math.PI * 0.5) * 2.4; });
          this.after(0.32, () => {
            this.anim(0.12, (k) => { def.off.y = 2.4 * (1 - k); }, () => (def.off.y = 0));
            this.after(0.12, () => {
              this.shakeAmt = Math.max(this.shakeAmt, 0.22);
              this.burst(def.feet(), { count: 20, col: "#cbb37e", speed: 5, size: 0.45, life: 0.55 });
              impact();
            });
          });
        });
        break;
      }
      case "bone": {
        const bone = new THREE.Group();
        const bm = new THREE.MeshLambertMaterial({ color: 0xf2ecd8 });
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.7, 6), bm);
        shaft.rotation.z = Math.PI / 2;
        bone.add(shaft);
        for (const e of [-0.35, 0.35]) {
          const s1 = new THREE.Mesh(this.gSphere, bm); s1.scale.setScalar(0.12); s1.position.set(e, 0.07, 0);
          const s2 = s1.clone(); s2.position.y = -0.07;
          bone.add(s1, s2);
        }
        this.projectileTo(a0, b0, { mesh: bone, speed: 13, spin: 14, arc: 0.7 }).then(() => {
          impactBurst(); impact();
          const bone2 = bone.clone();
          this.projectileTo(b0, atk.pos(), { mesh: bone2, speed: 13, spin: 14, arc: 0.7 });
        });
        break;
      }
      case "sky": {
        for (let i = 0; i < (d.count || 4); i++) {
          this.after(i * 0.09, () => {
            const from = def.pos().clone().add(V3(rnd(2.2, -2.2), 8, rnd(2.2, -2.2)));
            const to = def.pos().clone().add(V3(rnd(1.4, -1.4), 0, rnd(1.4, -1.4)));
            const mesh = new THREE.Mesh(this.gRock, new THREE.MeshLambertMaterial({ color: 0x8d8579 }));
            mesh.scale.setScalar(rnd(0.5, 0.25));
            this.projectileTo(from, to, { mesh, speed: 22, spin: 6, trail: false }).then(() => {
              this.burst(to, { count: 6, col: "#b3a385", speed: 3, size: 0.3, life: 0.4 });
              if (i === 0) { this.shakeAmt = Math.max(this.shakeAmt, 0.14); impact(); }
            });
          });
        }
        break;
      }
      case "explode": {
        this.after(0.15, () => {
          const c = atk.pos();
          this.flashLight(c, "#fff", 6, 0.5, 26);
          this.shakeAmt = Math.max(this.shakeAmt, 0.5);
          for (let i = 0; i < 3; i++) this.after(i * 0.07, () => this.ringAt(c, { col: i ? "#ffae5a" : "#fff", r0: 0.5, r1: 7 + i * 2, dur: 0.5, axis: "cam" }));
          this.burst(c, { count: 60, col: "#fff", col2: "#ffae5a", speed: 9, size: 0.6, life: 0.7 });
          this.chunks(atk.feet(), { count: 8, col: "#6a6a6a", size: 0.25, speed: 6, up: 6 });
          impact();
        });
        break;
      }
      case "shield": {
        const m = this.mesh(this.gPlane, this.basic(col, 0.45));
        m.scale.set(2.4, 2, 1);
        this.anim(0.7, (k) => {
          const c = atk.pos();
          m.position.copy(c).add(V3(0, 0, 0));
          m.quaternion.copy(this.camera.quaternion);
          m.material.opacity = 0.45 * (1 - k);
        }, () => this.kill(m));
        this.statusFX(atk, true);
        this.after(0.2, impact);
        break;
      }
      case "hop": {
        this.anim(0.5, (k) => { atk.off.y = Math.abs(Math.sin(k * Math.PI * 2)) * 0.6; }, () => (atk.off.y = 0));
        this.after(0.3, impact);
        break;
      }
      case "self": {
        if (d.images) {
          for (const dx of [-1.1, 1.1]) {
            const ghost = this.spriteOf(atk.spriteTex ? atk.spriteTex() : this.texSoft, "#9fc6ff", atk.halfH * 2);
            this.anim(0.6, (k) => {
              ghost.position.copy(atk.pos()).add(V3(dx * (0.4 + k), 0, 0));
              ghost.material.opacity = 0.5 * (1 - k);
            }, () => this.kill(ghost));
          }
        }
        if (d.shrink) this.anim(0.4, (k) => atk.pulse?.(1 - k * 0.3));
        this.statusFX(atk, true);
        this.after(0.25, impact);
        break;
      }
      case "blink": {
        this.burst(atk.pos(), { count: 18, col: "#cfe0ff", speed: 2.5, size: 0.3, life: 0.4, g: 0 });
        this.after(0.2, impact);
        break;
      }
      case "auto":
      default: {
        // status moves: direction from effect target
        const eff = move.effect || {};
        const debuff = eff.t === "enemy";
        const target = debuff ? def : atk;
        if (eff.k === "sleep" || eff.k === "conf") {
          for (let i = 0; i < 3; i++) this.after(i * 0.16, () => this.ringAt(def.pos(), { col, r0: 2, r1: 0.3, dur: 0.42, axis: "cam", op: 0.7 }));
        }
        this.statusFX(target, !debuff);
        this.after(0.3, impact);
        break;
      }
    }
  }

  // rising gold glow (buff) or falling red shimmer (debuff)
  statusFX(actor, isBuff) {
    const col = isBuff ? "#ffd23d" : "#ff4d4d";
    this.emit(0.5, 50, () => {
      const c = actor.pos();
      const i = this.pHead = (this.pHead + 1) % this.N;
      const p = this.parts[i];
      p.on = true; p.t = 0; p.life = 0.55;
      p.p.set(c.x + rnd(0.8, -0.8), c.y + (isBuff ? -actor.halfH : actor.halfH), c.z + rnd(0.8, -0.8));
      p.v.set(0, isBuff ? 2.4 : -2.4, 0);
      p.g = 0; p.drag = 0; p.s0 = 0.22; p.s1 = 0.05;
      p.c.set(col); p.a0 = 0.9;
    });
    actor.tintFlash?.(col, 0.4);
  }

  conditionTick(actor, kind) {
    const c = actor.pos();
    if (kind === "brn") this.burst(c, { count: 5, col: "#ff7a29", col2: "#ffd23d", speed: 1.4, size: 0.2, life: 0.5, g: -2 });
    else if (kind === "psn" || kind === "tox") this.burst(c, { count: 4, col: "#c45ae0", speed: 1, size: 0.26, life: 0.6, g: -1.4 });
    else if (kind === "para") { this.burst(c, { count: 6, col: "#ffe14d", speed: 2.6, size: 0.16, life: 0.22, g: 0 }); actor.tintFlash?.("#ffe14d", 0.2); }
    else if (kind === "frz") this.burst(c, { count: 5, col: "#aee9ff", speed: 0.8, size: 0.22, life: 0.5, g: 0 });
    else if (kind === "slp") {
      const s = this.spriteOf(this.texZ, "#cfe0ff", 0.5);
      s.position.copy(c).add(V3(0.4, actor.halfH * 0.7, 0));
      this.anim(0.9, (k) => { s.position.y += 0.012; s.material.opacity = 1 - k; }, () => this.kill(s));
    } else if (kind === "conf") {
      this.ringAt(c.clone().add(V3(0, actor.halfH + 0.3, 0)), { col: "#ffd9a0", r0: 0.3, r1: 0.9, dur: 0.5, op: 0.7 });
    } else if (kind === "seed") this.burst(c, { count: 3, col: "#7ed321", speed: 1, size: 0.2, life: 0.5 });
  }

  // ---------------------------------------------------------- hit reaction
  playHit(move, actor, { eff = 1, crit = false, fromPos = null, big = false } = {}) {
    const [col, col2] = TYPE_FX[move.type] || TYPE_FX.normal;
    actor.tintFlash?.("#ffffff", 0.1);
    this.after(0.1, () => actor.tintFlash?.(col, 0.3));
    actor.shake?.(crit ? 0.34 : 0.2, 0.3);
    if (crit) { this.flashLight(actor.pos(), "#fff", 3, 0.2, 12); this.shakeAmt = Math.max(this.shakeAmt, 0.12); }
    const t = move.type;
    const c = actor.pos();
    if (t === "fire") this.emit(0.5, 28, () => this.burst(actor.pos(), { count: 1, col: "#ff7a29", col2: "#ffd23d", speed: 1.3, size: 0.22, life: 0.5, g: -2.5 }));
    else if (t === "electric") {
      let n = 0;
      this.anim(0.4, (k, dt, tt) => { actor.off.x = Math.sin(tt * 60) * 0.08 * (1 - k); }, () => (actor.off.x = 0));
      this.emit(0.35, 24, () => this.burst(actor.pos(), { count: 1, col: "#ffe14d", speed: 3, size: 0.14, life: 0.18, g: 0 }));
    } else if (t === "water") this.burst(c, { count: 14, col: "#3f93ff", col2: "#bfe6ff", speed: 3, size: 0.22, life: 0.5, g: 7 });
    else if (t === "ice") { actor.tintFlash?.("#aee9ff", 0.9); this.emit(0.6, 16, () => this.burst(actor.pos(), { count: 1, col: "#e8fbff", speed: 0.5, size: 0.18, life: 0.4, g: 0 })); }
    else if (t === "psychic" || t === "ghost") { actor.pulse?.(0.65); this.ringAt(c, { col, r0: 1.4, r1: 0.2, dur: 0.3, axis: "cam" }); }
    else if (t === "grass" || t === "bug") this.burst(c, { count: 10, col, col2, speed: 3.4, size: 0.18, life: 0.45, g: 4 });
    else if (t === "poison") this.burst(c, { count: 8, col: "#c45ae0", speed: 1.2, size: 0.3, life: 0.6, g: -1 });
    else if (t === "ground" || t === "rock") { this.burst(actor.feet(), { count: 12, col: "#cbb37e", speed: 3, size: 0.4, life: 0.5, sizeEnd: 0.6 }); this.chunks(actor.feet(), { count: 3, col: "#9a8a6a", size: 0.16, speed: 3, up: 4 }); }
    else this.burst(c, { count: 10, col: "#fff", col2: "#ffe9b0", speed: 3.4, size: 0.22, life: 0.3 });
    // knockback for physical hits
    if (fromPos && (move.cls === "phys") && actor.knock) {
      const dir = c.clone().sub(fromPos).setY(0).normalize();
      actor.knock(dir, big || crit ? 1.4 : 0.8);
    }
    if (eff >= 2) this.burst(c, { count: 8, col: "#ffb347", speed: 4, size: 0.3, life: 0.4, tex: this.texStar });
  }

  faint(actor) {
    this.burst(actor.pos(), { count: 18, col: "#cfd6e4", speed: 2, size: 0.3, life: 0.6, g: -1 });
    this.anim(0.55, (k) => { actor.off.y = -k * actor.halfH * 1.7; actor.setOpacity?.(1 - k); });
  }

  // ----------------------------------------------------------- sequences
  levelUp(actor) {
    this.ringAt(actor.feet().clone().add(V3(0, 0.2, 0)), { col: "#ffd23d", r0: 0.3, r1: 2.2, dur: 0.5 });
    this.emit(0.7, 40, () => {
      const c = actor.pos();
      this.burst(V3(c.x + rnd(0.9, -0.9), actor.feet().y, c.z + rnd(0.9, -0.9)), { count: 1, col: "#ffd23d", col2: "#fff7c2", speed: 0.3, size: 0.24, life: 0.7, g: -4 });
    });
    this.flashLight(actor.pos(), "#ffd23d", 2, 0.5, 10);
  }
  healGlow(actor) {
    this.emit(0.8, 30, () => {
      const c = actor.pos();
      this.burst(V3(c.x + rnd(0.8, -0.8), actor.feet().y, c.z + rnd(0.8, -0.8)), { count: 1, col: "#7bf2a8", col2: "#e0ffe9", speed: 0.2, size: 0.2, life: 0.8, g: -3 });
    });
  }
  evolve(actor, swapCb) {
    return new Promise<void>((res) => {
      const dur = 2.8;
      // converging swirl
      this.emit(1.4, 80, () => {
        const c = actor.pos();
        const a = rnd(Math.PI * 2), r = rnd(2.6, 1.2);
        const i = this.pHead = (this.pHead + 1) % this.N;
        const p = this.parts[i];
        p.on = true; p.t = 0; p.life = 0.4;
        p.p.set(c.x + Math.cos(a) * r, c.y + rnd(1.4, -1.4), c.z + Math.sin(a) * r);
        p.v.copy(c.clone().sub(p.p).multiplyScalar(2.6));
        p.g = 0; p.drag = 0; p.s0 = 0.3; p.s1 = 0.08; p.c.set("#ffffff"); p.a0 = 1;
      });
      // white silhouette glow
      const glow = this.spriteOf(actor.spriteTex ? actor.spriteTex() : this.texSoft, "#ffffff", actor.halfH * 2.15);
      glow.material.blending = THREE.AdditiveBlending;
      this.anim(dur, (k) => {
        glow.position.copy(actor.pos());
        glow.scale.setScalar(actor.halfH * 2.15 * (1 + Math.sin(k * Math.PI * 5) * 0.05));
        glow.material.opacity = k < 0.45 ? k / 0.45 : k < 0.75 ? 1 : (1 - k) / 0.25;
        if (Math.abs(k - 0.55) < 0.01 && swapCb) { swapCb(); swapCb = null; glow.material.map = actor.spriteTex ? actor.spriteTex() : glow.material.map; }
      }, () => { this.kill(glow); res(); });
      this.after(dur * 0.55, () => {
        this.flashLight(actor.pos(), "#fff", 5, 0.6, 20);
        for (let i = 0; i < 3; i++) this.after(i * 0.1, () => this.ringAt(actor.pos(), { col: "#fff7c2", r0: 0.4, r1: 4 + i, dur: 0.6, axis: "cam" }));
        this.burst(actor.pos(), { count: 40, col: "#fff", col2: "#ffd23d", speed: 6, size: 0.4, life: 0.8 });
      });
    });
  }

  // ------------------------------------------------------------- pokeball
  makeBall(type = "pokeball") {
    const g = new THREE.Group();
    const tops = { pokeball: 0xe23b3b, greatball: 0x3b6fe2, ultraball: 0x2b2b33 };
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshLambertMaterial({ color: tops[type] || 0xe23b3b }));
    const bot = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0xf2f2f2 }));
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.158, 0.022, 6, 18), new THREE.MeshLambertMaterial({ color: 0x222222 }));
    band.rotation.x = Math.PI / 2;
    const btn = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x888888 }));
    btn.position.z = 0.155;
    btn.rotation.x = Math.PI / 2;
    g.add(top, bot, band, btn);
    if (type === "ultraball") {
      const st = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.02, 6, 14, Math.PI), new THREE.MeshLambertMaterial({ color: 0xffd23d }));
      st.position.y = 0.06; st.rotation.x = Math.PI / 2;
      g.add(st);
    }
    return g;
  }
  throwBall(from, to, type) {
    return new Promise<any>((res) => {
      const ball = this.makeBall(type);
      this.scene.add(ball);
      this.audio.play("throw");
      const dur = clamp(from.distanceTo(to) / 16, 0.32, 0.85);
      this.anim(dur, (k) => {
        ball.position.copy(from.clone().lerp(to, k));
        ball.position.y += Math.sin(k * Math.PI) * 2.2;
        ball.rotation.x -= 0.32; ball.rotation.z += 0.1;
      }, () => res(ball));
    });
  }
  ballShake(ball) {
    return new Promise<void>((res) => {
      this.audio.play("shake");
      this.anim(0.42, (k) => { ball.rotation.z = Math.sin(k * Math.PI * 3) * 0.5; }, () => { ball.rotation.z = 0; res(); });
    });
  }
  ballCatch(ball) {
    this.audio.play("catch");
    this.burst(ball.position, { count: 16, col: "#ffd23d", col2: "#fff", speed: 2.6, size: 0.24, life: 0.7, tex: this.texStar });
    this.flashLight(ball.position, "#ffd23d", 2, 0.6, 8);
  }
  ballBreak(ball) {
    this.audio.play("break");
    this.burst(ball.position, { count: 20, col: "#fff", speed: 4, size: 0.3, life: 0.4 });
    this.kill(ball);
  }
  suckIn(actor, ballPos) {
    const fromScale = actor.obj.scale.clone();
    const c0 = actor.pos().clone();
    this.burst(c0, { count: 14, col: "#ff6b6b", col2: "#fff", speed: 2, size: 0.3, life: 0.4, g: 0 });
    this.anim(0.3, (k) => {
      actor.obj.scale.copy(fromScale).multiplyScalar(1 - k * 0.97);
      actor.off.copy(ballPos.clone().sub(c0).multiplyScalar(k));
    });
    return () => { // restore (escape)
      actor.obj.scale.copy(fromScale);
      actor.off.set(0, 0, 0);
      this.burst(actor.pos(), { count: 14, col: "#fff", speed: 3, size: 0.3, life: 0.4 });
    };
  }

  // -------------------------------------------------- aiming (Catching 2.0)
  // Dotted trajectory preview while holding to aim.
  updateAimArc(points: THREE.Vector3[] | null, col = "#ffd23d") {
    if (!points || points.length < 2) {
      if (this.aimLine) { this.aimLine.visible = false; }
      return;
    }
    if (!this.aimLine) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(64 * 3), 3).setUsage(THREE.DynamicDrawUsage));
      const mat = new THREE.LineDashedMaterial({ color: col, transparent: true, opacity: 0.9, dashSize: 0.35, gapSize: 0.22, depthWrite: false });
      this.aimLine = new THREE.Line(geo, mat);
      this.aimLine.frustumCulled = false;
      this.aimLine.renderOrder = 6;
      this.scene.add(this.aimLine);
    }
    const geo = this.aimLine.geometry as THREE.BufferGeometry;
    const arr = (geo.attributes.position as THREE.BufferAttribute).array as Float32Array;
    const n = Math.min(points.length, 64);
    for (let i = 0; i < 64; i++) {
      const p = points[Math.min(i, n - 1)];
      arr[i * 3] = p.x; arr[i * 3 + 1] = p.y; arr[i * 3 + 2] = p.z;
    }
    geo.attributes.position.needsUpdate = true;
    geo.setDrawRange(0, n);
    this.aimLine.computeLineDistances();
    (this.aimLine.material as THREE.LineDashedMaterial).color.set(col);
    this.aimLine.visible = true;
  }
  // ------------------------------------------------------- new celebrations
  confetti(at: THREE.Vector3, big = false) {
    const cols = ["#ff6b6b", "#ffd93d", "#6bcB77", "#4d96ff", "#c780fa"];
    for (let i = 0; i < (big ? 5 : 3); i++) {
      this.after(i * 0.12, () => {
        for (const col of cols) this.burst(at.clone().add(V3(rnd(1, -1), rnd(1.4, 0.4), rnd(1, -1))), { count: big ? 8 : 4, col, speed: 4.2, size: 0.22, life: 1.1, g: 5, drag: 0.6 });
      });
    }
    this.flashLight(at, "#ffd23d", big ? 3 : 2, 0.6, 14);
  }
  critCatchFX(at: THREE.Vector3) {
    this.flashLight(at, "#ffd23d", 5, 0.7, 20);
    for (let i = 0; i < 3; i++) this.after(i * 0.09, () => this.ringAt(at, { col: "#ffd23d", r0: 0.2, r1: 2.6 + i, dur: 0.5, axis: "cam" }));
    this.burst(at, { count: 30, col: "#ffd23d", col2: "#fff7c2", speed: 5, size: 0.3, life: 0.8 });
  }
  hearts(at: THREE.Vector3, count = 5) {
    for (let i = 0; i < count; i++) {
      this.after(i * 0.09, () => {
        const s = this.spriteOf(this.texHeart, "#ff7aa2", 0.34);
        s.position.copy(at).add(V3(rnd(0.5, -0.5), rnd(0.3, -0.1), rnd(0.5, -0.5)));
        const drift = rnd(0.3, -0.3);
        this.anim(0.9, (k) => {
          s.position.y += 0.016;
          s.position.x += drift * 0.008;
          s.material.opacity = 1 - k * k;
          s.scale.setScalar(0.34 * (1 + k * 0.5));
        }, () => this.kill(s));
      });
    }
  }
  // quick sidestep with fading afterimages (the anime dodge)
  dodgeHop(actor: Actor, side: THREE.Vector3) {
    const dir = side.clone().setY(0).normalize().multiplyScalar(1.7);
    for (let i = 0; i < 3; i++) {
      this.after(i * 0.05, () => {
        if (!actor.spriteTex) return;
        const ghost = this.spriteOf(actor.spriteTex(), "#9fc6ff", actor.halfH * 2);
        ghost.position.copy(actor.pos());
        this.anim(0.3, (k) => { ghost.material.opacity = 0.4 * (1 - k); }, () => this.kill(ghost));
      });
    }
    this.anim(0.34, (k) => {
      const w = Math.sin(k * Math.PI);
      actor.off.x = dir.x * w; actor.off.z = dir.z * w;
      actor.off.y = Math.sin(k * Math.PI) * 0.55;
    }, () => { actor.off.x = actor.off.z = actor.off.y = 0; });
  }
  // Team Rocket launched skyward, ending in a twinkle.
  blastOff(group: THREE.Object3D, onDone?: () => void) {
    const start = group.position.clone();
    this.audio.play("blastoff");
    this.anim(1.1, (k) => {
      group.position.set(start.x + k * 6, start.y + k * k * 46, start.z - k * 4);
      group.rotation.z = k * 7;
      group.scale.setScalar(Math.max(0.05, 1 - k * 0.9));
      if (Math.random() < 0.5) this.burst(group.position, { count: 2, col: "#ffae5a", speed: 1.4, size: 0.3, life: 0.3, g: 0 });
    }, () => {
      const p = group.position.clone();
      this.burst(p, { count: 14, col: "#fff", col2: "#ffd23d", speed: 2.4, size: 0.34, life: 0.5, g: 0 });
      this.flashLight(p, "#fff", 2, 0.3, 14);
      this.scene.remove(group);
      if (onDone) onDone();
    });
  }
}
