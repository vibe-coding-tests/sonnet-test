// Visual probe for habitats: birds on the wing, fish in the water, larvae in
// the trees, and the swoop-down battle transition.
//   KANTO_URL=http://localhost:5178 node tools/habitat-shot.mjs
import { chromium } from "playwright-core";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const SHOTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../screenshots");
fs.mkdirSync(SHOTS, { recursive: true });
const URL = process.env.KANTO_URL || "http://localhost:5173";

const browser = await chromium.launch({
  channel: "chrome", headless: true,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--mute-audio", "--window-size=1280,800"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.goto(URL, { waitUntil: "load" });
await page.waitForFunction(() => window.DEBUG, null, { timeout: 30000 });
await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
await page.reload({ waitUntil: "load" });
await page.waitForFunction(() => window.DEBUG, null, { timeout: 30000 });
await page.evaluate(() => window.DEBUG.newGame("Red", "Blue"));
await page.waitForSelector(".startercard", { timeout: 10000 });
await page.click(".startercard");
await page.waitForFunction(() => window.DEBUG.game.state.party.length > 0);
await page.evaluate(() => { window.DEBUG.time(0.32); window.DEBUG.weather("clear"); });

// aim the first-person camera at a world point
const lookAt = (txExpr) => page.evaluate((expr) => {
  const g = window.DEBUG.game;
  const t = eval(expr);
  const dx = t.x - g.playerPos.x, dy = t.y - (g.playerPos.y + 0.0), dz = t.z - g.playerPos.z;
  const yaw = Math.atan2(-dx, -dz);
  const pitch = Math.atan2(dy, Math.hypot(dx, dz));
  window.DEBUG.look(yaw, pitch);
}, txExpr);

const settle = (ms = 1400) => page.waitForTimeout(ms);

// ---- 1. birds on the wing over Route 1
console.log("1) sky: a flock over Route 1");
await page.evaluate(() => {
  const g = window.DEBUG.game;
  g.playerPos.set(-100, g.world.height(-100, 60) + 1.7, 60);
  for (const [sp, lv, ox, oz] of [[16, 4, 7, -4], [16, 5, 11, 3], [21, 5, 9, 9]]) {
    const w = window.DEBUG.spawn(sp, lv);
    w.base.x = g.playerPos.x + ox; w.base.z = g.playerPos.z + oz;
    w.snapGround();
  }
  window.__birds = g.wilds.slice(-3);
});
await settle(1800);
await lookAt("window.__birds[0].base");
await settle(400);
await page.screenshot({ path: `${SHOTS}/hab-1-sky.png` });

// ---- 2. swimmers in Pallet's sea
console.log("2) water: swimmers off the shore");
await page.evaluate(() => {
  const g = window.DEBUG.game;
  let sx = 0, sz = 0;
  outer: for (let x = -130; x <= -60; x += 3) {
    for (let z = 150; z <= 240; z += 3) {
      if (g.world.height(x, z) < g.world.waterY - 0.8) { sx = x; sz = z; break outer; }
    }
  }
  g.playerPos.set(sx + 7, g.world.height(sx + 7, sz) + 1.7, sz);
  const a = window.DEBUG.spawn(129, 7);
  a.base.set(sx - 2, 0, sz); a.placeForHabitat({}); a.snapGround();
  const b = window.DEBUG.spawn(54, 9);
  b.base.set(sx - 5, 0, sz + 4); b.placeForHabitat({}); b.snapGround();
  window.__fish = a;
});
await settle(1500);
await lookAt("window.__fish.base");
await settle(400);
await page.screenshot({ path: `${SHOTS}/hab-2-water.png` });

// ---- 3. bugs perched in the trees
console.log("3) tree: larvae in the canopy");
await page.evaluate(() => {
  const g = window.DEBUG.game;
  // a tree with neighbors, for the hop show
  const t = g.world.treeSpots.find((a) => g.world.treesNear(a, 18, 3).length >= 2) || g.world.treeSpots[0];
  g.playerPos.set(t.x + 6, g.world.height(t.x + 6, t.z) + 1.7, t.z + 2);
  const w = window.DEBUG.spawn(10, 4);
  const m = window.DEBUG.spawn(11, 5);
  window.__bug = w; window.__pod = m;
  window.__tree = t;
});
await settle(1500);
await lookAt("({x: window.__tree.x, y: window.__bug.base.y, z: window.__tree.z})");
await settle(400);
await page.screenshot({ path: `${SHOTS}/hab-3-tree.png` });
const treeState = await page.evaluate(() => ({
  bug: { perched: window.__bug.perched, y: +window.__bug.base.y.toFixed(2) },
  pod: { perched: window.__pod.perched, y: +window.__pod.base.y.toFixed(2) },
}));
console.log("   perch state:", JSON.stringify(treeState));

// ---- 4. the swoop: engage a bird, it dives to the arena
console.log("4) battle: bird swoops down to fight");
await page.evaluate(() => {
  const g = window.DEBUG.game;
  const b = window.__birds.find((w) => !w.dead && g.wilds.includes(w)) || window.DEBUG.spawn(16, 5);
  g.playerPos.set(b.base.x + 6, g.world.height(b.base.x + 6, b.base.z) + 1.7, b.base.z);
  window.__fighter = b;
  g.startWildBattle(b);
});
await page.waitForFunction(() => {
  const w = window.__fighter, g = window.DEBUG.game;
  return !!g.battle && !w.air && Math.abs(w.base.y - g.world.height(w.base.x, w.base.z)) < 0.7;
}, null, { timeout: 45000 });
await lookAt("window.__fighter.base");
await settle(600);
await page.screenshot({ path: `${SHOTS}/hab-4-swoop.png` });

// ---- 5. catch one right out of the air
console.log("5) catching: ball vs a flying target");
await page.evaluate(() => window.DEBUG.game.battle?.end("fled"));
await page.waitForFunction(() => window.__fighter.air === true, null, { timeout: 30000 });
// let the panic pass — you don't catch a bird mid-flee
await page.waitForFunction(() => window.__fighter.state !== "flee", null, { timeout: 60000 }).catch(() => {});
await page.evaluate(() => {
  const g = window.DEBUG.game;
  window.DEBUG.give("ultraball", 10);
  window.DEBUG.cheat("toggle", "catchall");          // 100% catch for the photo
  const w = window.__fighter;
  g.playerPos.set(w.base.x + 7, g.world.height(w.base.x + 7, w.base.z) + 1.7, w.base.z);
  g.target = w;
  g.quickThrowAt(w);
});
await page.waitForFunction(() => window.__fighter.captureLock === true, null, { timeout: 30000 }).catch(() => {});
await lookAt("window.__fighter.base");
await page.screenshot({ path: `${SHOTS}/hab-5-aircatch.png` });
const caught = await page.evaluate(async () => {
  await new Promise((r) => setTimeout(r, 4000));
  return { caught: !window.DEBUG.game.wilds.includes(window.__fighter), party: window.DEBUG.game.state.party.length, boxes: window.DEBUG.game.state.boxes.length };
});
console.log("   air catch:", JSON.stringify(caught));

console.log("done — screenshots in screenshots/hab-*.png");
await browser.close();
