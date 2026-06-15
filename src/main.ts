// Boot + first-person controller + input routing + main loop.
import * as THREE from "three";
import { World } from "./world";
import { FX } from "./fx";
import { AudioMan } from "./audio";
import { UI } from "./ui";
import { Game } from "./game";

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

// ----------------------------------------------------------------- renderer
const canvas = document.getElementById("c") as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(74, innerWidth / innerHeight, 0.1, 1500);
// filmic look: ACES tonemapping + correct sRGB output
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;

const audio = new AudioMan();
const world = new World(scene);
const fx = new FX(scene, camera, audio);
const ui = new UI(audio);
const game = new Game({ scene, camera, world, fx, audio, ui });
ui.attach(game, world, camera);
ui.updateParty();
ui.updateHUD();

// ------------------------------------------------------------------ player
const EYE = 1.62;
const player = {
  pos: game.playerPos,            // shared reference with game
  vel: new THREE.Vector3(),
  yaw: game.playerYaw, pitch: 0,
  grounded: true,
  bobT: 0,
  stepT: 0,
};
player.pos.y = world.height(player.pos.x, player.pos.z);
if ((window as any).DEBUG) (window as any).DEBUG.look = (yaw, pitch = 0) => { player.yaw = yaw; player.pitch = pitch; };

// headlamp for caves and night treks (L to toggle)
const lamp = new THREE.SpotLight(0xfff2cf, 0, 34, 0.62, 0.45, 1.1);
const lampTarget = new THREE.Object3D();
scene.add(lamp, lampTarget);
lamp.target = lampTarget;
let lampHintShown = false;

// --------------------------------------------------------- vehicle props
// First-person bits you see while riding: bike handlebars / truck dashboard.
scene.add(camera);
const bikeProp = new THREE.Group();
{
  const metal = new THREE.MeshLambertMaterial({ color: 0xc94838 });
  const grip = new THREE.MeshLambertMaterial({ color: 0x2a2a30 });
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.6, 8), metal);
  bar.rotation.z = Math.PI / 2;
  bar.position.set(0, -0.32, -0.52);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.2, 8), metal);
  stem.position.set(0, -0.42, -0.52);
  const gl = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.12, 8), grip);
  gl.rotation.z = Math.PI / 2; gl.position.set(-0.3, -0.32, -0.52);
  const gr = gl.clone(); gr.position.x = 0.3;
  const bell = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), new THREE.MeshLambertMaterial({ color: 0xd8d8e0 }));
  bell.position.set(-0.18, -0.3, -0.52);
  bikeProp.add(bar, stem, gl, gr, bell);
}
const truckProp = new THREE.Group();
{
  const dash = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.16, 0.3), new THREE.MeshLambertMaterial({ color: 0x5a4a3a }));
  dash.position.set(0, -0.42, -0.72);
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.022, 8, 20), new THREE.MeshLambertMaterial({ color: 0x222228 }));
  wheel.rotation.x = -1.1;
  wheel.position.set(-0.3, -0.3, -0.58);
  const hood = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.1, 0.55), new THREE.MeshLambertMaterial({ color: 0xc94838 }));
  hood.position.set(0, -0.52, -1.05);
  truckProp.add(dash, wheel, hood);
}
bikeProp.visible = truckProp.visible = false;
camera.add(bikeProp, truckProp);

const keys = new Set<string>();
let locked = false;

function sens() { return 0.0022 * ((game.state.settings.sens || 100) / 100); }

document.addEventListener("pointerlockchange", () => {
  const was = locked;
  locked = document.pointerLockElement === canvas;
  updateLockMsg();
  if (!locked) game.cancelAim();
  // Esc while playing -> pause menu
  if (was && !locked && game.state.started && !ui.blocking) ui.openPause();
});
function updateLockMsg() {
  const show = game.state.started && !locked && !ui.blocking;
  document.getElementById("lockmsg").classList.toggle("hidden", !show);
}
setInterval(updateLockMsg, 400);

// --- mouse: tap = quick throw / engage; hold = aim mode with a clean arc
let mouseDownT = 0;
let aimTimer: ReturnType<typeof setTimeout> | null = null;

canvas.addEventListener("mousedown", (e) => {
  audio.ensure();
  if (e.button !== 0) return;
  if (ui.blocking || !game.state.started) return;
  if (!locked) return;
  mouseDownT = performance.now();
  // holding for a beat enters aim mode (only when a throw is possible —
  // including from inside your Pokémon, which auto-returns you to the trainer)
  if (game.canThrowNow(false) || game.canAimWhilePossessed()) {
    aimTimer = setTimeout(() => { if (locked && !ui.blocking) game.startAim(); }, 220);
  }
});
canvas.addEventListener("mouseup", (e) => {
  if (e.button !== 0) return;
  if (aimTimer) { clearTimeout(aimTimer); aimTimer = null; }
  if (ui.blocking || !game.state.started || !locked) return;
  if (game.aim) game.releaseAim();
  else if (performance.now() - mouseDownT < 300) game.onClick();
});
canvas.addEventListener("click", () => {
  audio.ensure();
  if (ui.blocking || !game.state.started) return;
  if (!locked) { try { (canvas.requestPointerLock as any)?.call(canvas)?.catch?.(() => {}); } catch (e) { /* denied */ } }
});
document.addEventListener("mousemove", (e) => {
  if (!locked) return;
  // while aiming, look speed eases down so fine-tuning the arc feels deliberate
  if (game.aim) {
    player.yaw -= e.movementX * sens() * 0.25;
    player.pitch = clamp(player.pitch - e.movementY * sens() * 0.6, -1.45, 1.45);
    return;
  }
  player.yaw -= e.movementX * sens();
  player.pitch = clamp(player.pitch - e.movementY * sens(), -1.45, 1.45);
});
addEventListener("wheel", (e) => {
  if (!locked || ui.blocking) return;
  game.cycleBall(e.deltaY > 0 ? 1 : -1);
}, { passive: true });
canvas.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  if (game.aim) game.cancelAim();   // right click bails out of a throw
});

addEventListener("keydown", (e) => {
  audio.ensure();
  if (e.code === "F9") {
    e.preventDefault();
    if (!e.repeat) ui.onKey([], "", e.code);
    return;
  }
  const actions = game.actionsForCode(e.code);
  if (e.repeat) { if (actions.length || ["Tab", "Space"].includes(e.code)) e.preventDefault(); return; }
  const k = e.key === " " ? " " : e.key.toLowerCase();
  if (actions.length || ["tab", " "].includes(k) || e.code === "Space") e.preventDefault();
  keys.add(e.code);
  if (ui.onKey(actions, k, e.code)) return;
  if (actions.includes("flashlight")) { toggleLamp(); return; }
  game.onKey(actions, k);
});
addEventListener("keyup", (e) => keys.delete(e.code));
addEventListener("blur", () => keys.clear());
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
addEventListener("beforeunload", () => game.save());

function toggleLamp() {
  if (!game.state.started) return;
  game.flashlightOn = !game.flashlightOn;
  audio.play("ui");
  ui.toast(game.flashlightOn ? "Flashlight ON" : "Flashlight off", "");
}

function movePlayer(dt) {
  const held = (action: string, extras: string[] = []) => keys.has(game.keyCode(action)) || extras.some((code) => keys.has(code));
  const run = held("run", ["ShiftRight"]);
  const veh = game.state.vehicle;
  let fwd = 0, str = 0;
  if (held("moveForward", ["ArrowUp"])) fwd += 1;
  if (held("moveBackward", ["ArrowDown"])) fwd -= 1;
  if (held("moveLeft", ["ArrowLeft"])) str -= 1;
  if (held("moveRight", ["ArrowRight"])) str += 1;
  // real-time battle control: WASD drives your POKÉMON — the trainer's body stays planted
  const pb = game.battle;
  if (pb && pb.hasDirectAllyControl()) {
    let moveYaw = player.yaw;
    if (pb.style === "arena" && pb.allyEnt && pb.enemyEnt) {
      const toEnemy = pb.enemyEnt.base.clone().sub(pb.allyEnt.base).setY(0);
      if (toEnemy.lengthSq() > 0.001) moveYaw = Math.atan2(-toEnemy.x, -toEnemy.z);
    }
    let vx = -Math.sin(moveYaw) * fwd + Math.cos(moveYaw) * str;
    let vz = -Math.cos(moveYaw) * fwd - Math.sin(moveYaw) * str;
    const len = Math.hypot(vx, vz);
    if (len > 0) { vx /= len; vz /= len; }
    pb.possessInput.x = vx;
    pb.possessInput.z = vz;
    pb.possessInput.sprint = run;
    player.bobT *= 0.9;
    game.playerYaw = moveYaw;
    return;
  }
  const ground = world.height(player.pos.x, player.pos.z);
  const inWater = ground < world.waterY - 0.55;
  if (veh && inWater) { game.dismountVehicle(false); audio.play("splash"); }
  // full-Kanto pacing: brisker on foot, the bike roughly doubles your walk,
  // the truck is a champion's joyride
  let speed = (veh === "truck" ? 21 : veh === "bike" ? 14 : run ? 10.5 : 6.2)
    * (inWater ? 0.52 : 1) * (game.state.cheats?.speed ? 1.9 : 1);
  // camera looks down -Z at yaw 0; right is +X
  let vx = -Math.sin(player.yaw) * fwd + Math.cos(player.yaw) * str;
  let vz = -Math.cos(player.yaw) * fwd - Math.sin(player.yaw) * str;
  const len = Math.hypot(vx, vz);
  if (len > 0) { vx = (vx / len) * speed; vz = (vz / len) * speed; }
  player.pos.x += vx * dt;
  player.pos.z += vz * dt;
  world.collide(player.pos, 0.55);
  // vertical
  const floor = Math.max(world.height(player.pos.x, player.pos.z), inWater ? world.waterY - 1.05 : -99);
  if (player.grounded && held("jumpDodge") && !inWater && veh !== "truck") {
    player.vel.y = 7.4;
    player.grounded = false;
  }
  player.vel.y -= 22 * dt;
  player.pos.y += player.vel.y * dt;
  if (player.pos.y <= floor) {
    if (!player.grounded && player.vel.y < -9) audio.step(world.biomeAt(player.pos.x, player.pos.z));
    player.pos.y = floor;
    player.vel.y = 0;
    player.grounded = true;
  } else if (player.pos.y > floor + 0.05) player.grounded = false;
  // head bob + footsteps (wheels hum instead of feet)
  const moving = len > 0 && player.grounded;
  if (moving) {
    player.bobT += dt * (veh === "truck" ? 16 : veh === "bike" ? 13 : run ? 11 : 8);
    player.stepT -= dt;
    if (player.stepT <= 0) {
      if (veh === "bike") { player.stepT = 0.5; audio.play("biketick"); }
      else if (veh === "truck") { player.stepT = 0.34; audio.play("engineputt"); }
      else { player.stepT = run ? 0.3 : 0.44; audio.step(world.biomeAt(player.pos.x, player.pos.z)); }
    }
  } else player.bobT *= 0.9;
  game.playerYaw = player.yaw;
}

// ------------------------------------------------------------------- loop
const clock = new THREE.Clock();
// possession camera: 0 = trainer's eyes, 1 = inside your Pokémon
let possessBlend = 0;
let battleCamBlend = 0;
const monEye = new THREE.Vector3();
const battleCamPos = new THREE.Vector3();
const battleCamLook = new THREE.Vector3();
const battleToEnemy = new THREE.Vector3();
const battleBack = new THREE.Vector3();
const battleSide = new THREE.Vector3();
const battleAllyLook = new THREE.Vector3();
const battleLookOffset = new THREE.Vector3(0, 0.65, 0);
const lampDir = new THREE.Vector3();
// the title screen drifts over Pallet Town while you pick a save file
const TITLE_ORBIT = { x: -190, z: 260, r: 52, h: 16, look: 2.5 };
function loop() {
  requestAnimationFrame(loop);
  const rawDt = Math.min(clock.getDelta(), 0.05);
  const dt = rawDt * game.timeScale;       // bullet time while aiming a throw
  // the trainer keeps most of their speed in slow-mo: that's the whole point
  if (!ui.blocking && game.state.started) movePlayer(rawDt * (0.55 + 0.45 * game.timeScale));
  world.battleView = !!game.battle;
  world.update(dt, player.pos);
  if (!ui.blocking) game.update(rawDt);
  game.updateAmbient(rawDt);   // townsfolk + intro showcase animate even on the title screen
  fx.update(dt);
  const biome = world.biomeAt(player.pos.x, player.pos.z);
  audio.ambient(dt, biome, world.isNight(), !!game.battle, world.caveDim > 0.5);
  // camera: attract-mode orbit on the title screen / during Oak's intro,
  // otherwise the usual first-person rig
  const orbit = ui.titleActive ? TITLE_ORBIT : game.introCam;
  const pb = game.battle;
  const veh = game.state.vehicle;
  if (orbit) {
    const t = performance.now() / 1000;
    const a = t * (ui.titleActive ? 0.05 : 0.12);
    const gy = world.height(orbit.x, orbit.z);
    camera.position.set(orbit.x + Math.cos(a) * orbit.r, gy + orbit.h, orbit.z + Math.sin(a) * orbit.r);
    camera.lookAt(orbit.x, gy + orbit.look, orbit.z);
  } else {
    const bob = Math.sin(player.bobT) * (veh === "truck" ? 0.018 : veh === "bike" ? 0.03 : 0.045);
    camera.position.set(
      player.pos.x + fx.shakeOffset.x,
      player.pos.y + EYE + (veh === "truck" ? 0.25 : 0) + bob + fx.shakeOffset.y,
      player.pos.z + fx.shakeOffset.z
    );
    let battleCamLooked = false;
    const wantBattleCam = pb && pb.style === "arena" && pb.arena && !pb.possessed && pb.allyEnt && pb.enemyEnt ? 1 : 0;
    battleCamBlend += (wantBattleCam - battleCamBlend) * Math.min(1, rawDt * 4);
    if (Math.abs(battleCamBlend - wantBattleCam) < 0.012) battleCamBlend = wantBattleCam;
    if (battleCamBlend > 0.001 && pb?.arena && pb.allyEnt && pb.enemyEnt) {
      const toEnemy = battleToEnemy.copy(pb.enemyEnt.base).sub(pb.allyEnt.base).setY(0);
      if (toEnemy.lengthSq() < 0.001) toEnemy.set(0, 0, -1);
      toEnemy.normalize();
      battleBack.copy(toEnemy).multiplyScalar(-1);
      battleSide.set(-toEnemy.z, 0, toEnemy.x).multiplyScalar(2.2);
      const gap = pb.allyEnt.base.distanceTo(pb.enemyEnt.base);
      const dist = clamp(8 + gap * 0.35, 8.5, 14);
      battleCamPos.copy(pb.allyEnt.base)
        .addScaledVector(battleBack, dist)
        .add(battleSide)
        .add(fx.shakeOffset);
      battleCamPos.y = Math.max(world.height(battleCamPos.x, battleCamPos.z) + 4.0, pb.allyEnt.base.y + 4.5);
      battleCamLook.copy(pb.enemyEnt.group.position);
      battleCamLook.y += pb.enemyEnt.halfH;
      battleAllyLook.copy(pb.allyEnt.group.position);
      battleAllyLook.y += pb.allyEnt.halfH;
      battleCamLook.lerp(battleAllyLook, 0.38).add(battleLookOffset);
      const s = battleCamBlend * battleCamBlend * (3 - 2 * battleCamBlend);
      camera.position.lerp(battleCamPos, s);
      camera.lookAt(battleCamLook);
      battleCamLooked = true;
    }
    // possession: the camera dives from the trainer's eyes into the Pokémon's
    const wantPossess = pb && pb.possessed && pb.allyEnt && !pb.allyEnt.dead ? 1 : 0;
    possessBlend += (wantPossess - possessBlend) * Math.min(1, rawDt * 5);
    if (Math.abs(possessBlend - wantPossess) < 0.012) possessBlend = wantPossess;
    if (wantPossess) monEye.copy(pb.allyEnt.povEye());
    if (possessBlend > 0.001) {
      const s = possessBlend * possessBlend * (3 - 2 * possessBlend);
      camera.position.lerp(monEye, s);
      camera.position.y += fx.shakeOffset.y * s;   // keep hit-shake while possessed
      battleCamLooked = false;
    }
    if (!battleCamLooked) {
      camera.rotation.order = "YXZ";
      camera.rotation.y = player.yaw;
      camera.rotation.x = player.pitch;
    }
  }
  // hide your own rig only once the camera is basically inside it
  if (pb && pb.allyEnt && !pb.allyEnt.dead) pb.allyEnt.rig.group.visible = !(pb.possessed && possessBlend > 0.7);
  // riding: show the handlebars / dashboard, widen the view a touch
  bikeProp.visible = veh === "bike" && possessBlend < 0.5 && battleCamBlend < 0.5;
  truckProp.visible = veh === "truck" && possessBlend < 0.5 && battleCamBlend < 0.5;
  const wantFov = possessBlend > 0.5 ? 79 : battleCamBlend > 0.5 ? 68 : veh === "truck" ? 80 : veh === "bike" ? 77 : 74;
  if (Math.abs(camera.fov - wantFov) > 0.05) {
    camera.fov += (wantFov - camera.fov) * Math.min(1, rawDt * 5);
    camera.updateProjectionMatrix();
  }
  // headlamp follows the view
  const wantLamp = game.flashlightOn ? (world.caveDim > 0.1 ? 2.6 : world.isNight() ? 1.9 : 0.9) : 0;
  lamp.intensity += (wantLamp - lamp.intensity) * Math.min(1, dt * 8);
  if (lamp.intensity > 0.01) {
    lamp.position.copy(camera.position);
    lampTarget.position.copy(camera.position).add(camera.getWorldDirection(lampDir).multiplyScalar(10));
  }
  if (!lampHintShown && world.caveDim > 0.5 && !game.flashlightOn && game.state.started) {
    lampHintShown = true;
    ui.toast("It's pitch black in here... press L for your flashlight!", "");
  }
  document.getElementById("underwater").style.opacity = camera.position.y < world.waterY + 0.05 ? "1" : "0";
  ui.updateFrame(dt);
  renderer.render(scene, camera);
}
loop();

// ----------------------------------------------------------------- boot (v9)
// Title screen with three save files. Switching files reloads the page with a
// "go straight in" flag so the freshly-booted Game lands on the right save.
let proceed: string | null = null;
try {
  proceed = sessionStorage.getItem("kanto_proceed");
  sessionStorage.removeItem("kanto_proceed");
} catch (e) { /* private mode */ }

// Pre-compile all shaders during the loading screen so the first rendered
// frame doesn't spike. This runs after the synchronous world build and before
// the loading overlay fades, hiding any GPU stutter completely.
renderer.compile(scene, camera);

function hideLoading(cb?: () => void) {
  const el = document.getElementById("loading");
  if (!el) { cb?.(); return; }
  el.classList.add("fade");
  setTimeout(() => { el.remove(); cb?.(); }, 580);
}

if (proceed) {
  hideLoading(() => {
    if (game.state.started) game.enterWorld();
    else game.newGameFlow();
  });
} else {
  hideLoading(() => ui.showTitle());
}
