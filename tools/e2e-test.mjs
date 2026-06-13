// Kanto Adventure e2e smoke test — isolated headless Chrome via playwright-core
// NOTE: headless rAF is uncapped -> game-time runs ~5-15x faster than real time.
import { chromium } from "playwright-core";
import fs from "fs";

const SHOTS = "/Users/charmac/Documents/pokemon-adventure/screenshots";
fs.mkdirSync(SHOTS, { recursive: true });
const errors = [];
const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass: !!pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--mute-audio", "--window-size=1280,800"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => {
  if (m.type() === "error" && !m.text().includes("GL Driver Message")) errors.push("console: " + m.text());
});

const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png` });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const BASE = process.env.KANTO_URL || "http://localhost:5173";
await page.goto(BASE, { waitUntil: "load" });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "load" });
await page.waitForFunction(() => typeof window.DEBUG !== "undefined", null, { timeout: 15000 });
await sleep(2500);

await page.evaluate(async () => {
  const d = await import("/src/data.js");
  window.PD = d;
  window.PDEX = {};
  d.POKEDEX.forEach((p) => (window.PDEX[p.id] = p));
  // landmark coordinates below are authored in design space; the world is
  // expanded by MAP_SCALE (full-scale Kanto), so scale them on the way in
  window.WS = (await import("/src/world.ts")).MAP_SCALE;
});

// medium-slow XP curve (Charmander line) — mirror of the game formula
const msXp = (l) => Math.floor(1.2 * l ** 3 - 15 * l * l + 100 * l - 140);

// Headless GPU (swiftshader) renders slowly; dt is clamped to 50ms so the game
// clock can run several times slower than real time. Measure the factor and
// scale every wait accordingly. gwait polls a game-state predicate.
let factor = 1;
const measureClock = async () => {
  factor = await page.evaluate(async () => {
    const w = DEBUG.game.world;
    const a = w.uTime.value, t = performance.now();
    await new Promise((r) => setTimeout(r, 1200));
    return Math.max(0.02, (w.uTime.value - a) / ((performance.now() - t) / 1000));
  });
  console.log(`(game clock runs at ${factor.toFixed(2)}x real time)`);
};
const gwait = async (pred, gameSecBudget, polling = 250) => {
  const timeout = Math.max(6000, (gameSecBudget / factor) * 1000 + 4000);
  try { await page.waitForFunction(pred, null, { timeout, polling }); return true; }
  catch { return false; }
};

// ---------- 0. title screen / save files (v9) ----------
const title = await page.evaluate(() => ({
  visible: !document.getElementById("title").classList.contains("hidden"),
  slots: document.querySelectorAll("#slots .slotcard").length,
  empty: document.querySelectorAll("#slots .slotcard.empty").length,
  blocking: DEBUG.game.ui.blocking,
}));
ok("title screen boots with 3 empty save files", title.visible && title.slots === 3 && title.empty === 3 && title.blocking, JSON.stringify(title));
await shot("00-title");
// fast lane for tests: names chosen, straight to the starter table
await page.evaluate(() => DEBUG.newGame("Red", "Gary"));
const titleGone = await page.evaluate(() => document.getElementById("title").classList.contains("hidden"));
ok("New Game hands off to the starter choice", titleGone);

// ---------- 1. starter + Gen 1 stat structure ----------
const cards = await page.locator(".startercard").count();
ok("starter modal shows 3 choices", cards === 3, `cards=${cards}`);
await shot("01-starter");

await page.locator(".startercard").nth(1).click(); // Charmander
const starter = await page.evaluate(() => {
  const g = DEBUG.game; const m = g.state.party[0];
  return {
    name: PDEX[m.sp].name, lv: m.lv, maxhp: m.maxhp,
    moves: m.moves.map((i) => PD.MOVES[i].name), pp: m.pp,
    ivs: m.ivs, sexp: m.sexp, xp: m.xp, growth: PDEX[m.sp].growth,
    balls: g.state.items.pokeball, money: g.state.money,
  };
});
ok("starter = Charmander lv5 w/ Scratch+Growl", starter.name === "Charmander" && starter.lv === 5 && starter.moves.join() === "Scratch,Growl", JSON.stringify({ n: starter.name, mv: starter.moves }));
ok("DVs rolled (0-15 each, 5 stats)", starter.ivs && Object.keys(starter.ivs).length === 5 && Object.values(starter.ivs).every((v) => v >= 0 && v <= 15), JSON.stringify(starter.ivs));
ok("stat exp starts at 0", starter.sexp && Object.values(starter.sexp).every((v) => v === 0));
ok("PP from Gen 1 data (Scratch 35, Growl 40)", starter.pp?.[0] === 35 && starter.pp?.[1] === 40, JSON.stringify(starter.pp));
ok("medium-slow XP curve at lv5", starter.growth === "mediumslow" && starter.xp === msXp(5), `xp=${starter.xp} expect=${msXp(5)}`);
ok("Gen 1 HP formula plausible (lv5 Charmander 17-21)", starter.maxhp >= 17 && starter.maxhp <= 21, `maxhp=${starter.maxhp}`);
ok("starting kit: 5 balls + money", starter.balls === 5 && starter.money > 0, `balls=${starter.balls} money=${starter.money}`);

// ---------- 2. Kanto zones (true RBY layout) ----------
const zones = await page.evaluate(() => {
  const w = DEBUG.game.world;
  const z = (x, zz) => w.zoneAt(x * WS, zz * WS);   // design -> world coords
  return {
    pallet: z(-95, 130), forest: z(-100, -55), mtmoon: z(-15, -175), ceruleancave: z(40, -200),
    seafoam: z(-30, 245), powerplant: z(247, -90), victory: z(-200, -100), lavender: z(205, -25),
    saffron: z(75, -25), celadon: z(-30, -25), fuchsia: z(-30, 175), cinnabar: z(-95, 262),
    rocktunnel: z(195, -125), cycling: z(-30, 80), indigo: z(-212, -198), causeway: z(214, 50),
    trainers: DEBUG.game.trainers.length, gateClosed: !!w.caveGateBox,
    gyms: Object.keys(w.gymPos).length,
  };
});
ok("Kanto zones resolve at real landmarks",
  zones.pallet === "pallet" && zones.forest === "viridian-forest" && zones.mtmoon === "mtmoon-cave" &&
  zones.ceruleancave === "cerulean-cave" && zones.seafoam === "seafoam" && zones.powerplant === "power-plant" &&
  zones.victory === "victory-road" && zones.lavender === "lavender",
  JSON.stringify(zones));
ok("RBY layout: Saffron center, Celadon west, Fuchsia south, Cinnabar island",
  zones.saffron === "saffron" && zones.celadon === "celadon" && zones.fuchsia === "fuchsia" && zones.cinnabar === "cinnabar",
  JSON.stringify({ saffron: zones.saffron, celadon: zones.celadon, fuchsia: zones.fuchsia, cinnabar: zones.cinnabar }));
ok("RBY layout: Rock Tunnel, Cycling Road, Routes 12/13 causeway, Indigo Plateau",
  zones.rocktunnel === "rock-tunnel" && zones.cycling === "cycling-road" && zones.causeway === "route-12" && zones.indigo === "indigo",
  JSON.stringify({ rt: zones.rocktunnel, cyc: zones.cycling, cw: zones.causeway, ind: zones.indigo }));
ok("all 8 gyms placed", zones.gyms === 8, `gyms=${zones.gyms}`);
ok("trainer roster placed (incl. gyms)", zones.trainers >= 28, `trainers=${zones.trainers}`);
ok("Cerulean Cave gate starts sealed", zones.gateClosed === true);
await shot("02-pallet");

// movement with real (CDP) input
await measureClock();
const posA = await page.evaluate(() => DEBUG.game.playerPos.clone());
await page.locator("canvas#c").click().catch(() => {});
await page.keyboard.down("w");
await sleep(Math.min(8000, 1200 / factor));
await page.keyboard.up("w");
const posB = await page.evaluate(() => DEBUG.game.playerPos.clone());
const moved = Math.hypot(posB.x - posA.x, posB.z - posA.z);
ok("WASD moves the player", moved > 2, `moved=${moved.toFixed(1)}m`);

// ---------- 3. zone-authentic wild spawns ----------
// drive spawnTick directly (decoupled from the slow headless clock)
const spawnCheck = await page.evaluate(() => {
  const g = DEBUG.game;
  g.cheat("tp", "forest");
  g.wilds.forEach((w) => (w.life = 0));
  for (let i = 0; i < 120 && g.wilds.length < 26; i++) g.spawnTick();
  const FOREST_POOL = [10, 11, 13, 14, 25, 17, 16, 19, 29, 32, 122]; // forest + bordering route-2 table
  const inForest = g.wilds
    .map((w) => ({ sp: w.mon.sp, zone: g.world.zoneAt(w.pos().x, w.pos().z) }))
    .filter((w) => w.zone === "viridian-forest");
  return { total: g.wilds.length, inForest: inForest.length, species: inForest.map((w) => w.sp), legal: inForest.every((w) => FOREST_POOL.includes(w.sp)) };
});
ok("wilds spawn (120 ticks)", spawnCheck.total > 3, `wilds=${spawnCheck.total}`);
ok("forest spawns match Viridian Forest table", spawnCheck.inForest > 0 && spawnCheck.legal, JSON.stringify(spawnCheck));
await shot("03-forest");

// ---------- 4. battle: first strike, PP, Gen 1 XP ----------
const b0 = await page.evaluate(async () => {
  const g = DEBUG.game;
  // the forest teleport parked us in Bug Catcher Rico's line of sight; his
  // challenge dialog pauses the game clock. Suppress auto-engage for the rest
  // of the run and dispose of any pending engagement.
  g.trainers.forEach((t) => (t.engaging = true));
  if (g.ui.dialogActive) g.ui.endDialog(null);
  await new Promise((r) => setTimeout(r, 80)); // let the dialog continuation run
  if (g.battle) g.battle.end("fled");
  await new Promise((r) => setTimeout(r, 50));
  g.cheat("tp", "pallet"); // no trainers in Pallet Town
  g.playerYaw = 0;
  const wb = DEBUG.battle(1, 4); // bulbasaur: calm, won't flee
  wb.life = 99999;
  const b = g.battle;
  if (b) {
    b.enemy().hp = 1; // one scratch ends it
    window.__hits = 0;
    const orig = b.resolveHit.bind(b);
    // transparent pass-through — keep opts.idx so PP (now spent on a clean
    // connect inside resolveHit) still decrements.
    b.resolveHit = (...args) => { if (args[0] === "ally") window.__hits++; return orig(...args); };
  }
  return b ? {
    enemy: PDEX[b.enemy().sp].name, lockAlly: b.lock.ally, lockEnemy: b.lock.enemy,
    pp0: b.allyMon.pp[0], xpBefore: g.state.party[0].xp,
  } : null;
});
ok("wild battle starts", !!b0 && b0.enemy === "Bulbasaur", JSON.stringify(b0));
ok("player gets the first move (enemy locked longer)", b0 && b0.lockEnemy > b0.lockAlly + 0.5, `ally=${b0?.lockAlly}s enemy=${b0?.lockEnemy}s`);
await shot("04-battle");

// spam Q (move 1) until the battle ends (budget ~25 game-seconds)
const battleDeadline = Date.now() + Math.max(15000, (25 / factor) * 1000);
let battleInfo = null;
while (Date.now() < battleDeadline) {
  await page.keyboard.press("q");
  await sleep(200);
  battleInfo = await page.evaluate(() => {
    const g = DEBUG.game;
    return { inBattle: !!g.battle, hits: window.__hits, pp0: g.state.party[0].pp[0], xp: g.state.party[0].xp, sexpHp: g.state.party[0].sexp.hp };
  });
  if (!battleInfo.inBattle) break;
}
ok("ally moves resolve hits", battleInfo.hits > 0, `hits=${battleInfo.hits}`);
ok("PP consumed by attacking", battleInfo.pp0 < 35, `Scratch PP ${battleInfo.pp0}/35`);
ok("battle won: Gen 1 XP + stat exp gained", !battleInfo.inBattle && battleInfo.xp > b0.xpBefore && battleInfo.sexpHp === 45,
  `xp ${b0.xpBefore}->${battleInfo.xp}, sexp.hp=${battleInfo.sexpHp} (Bulbasaur base 45)`);

// ---------- 5. catching (with 100% catch cheat) ----------
const ballsBefore = await page.evaluate(() => {
  const g = DEBUG.game;
  if (g.battle) g.battle.end("fled");
  g.cheat("toggle", "catchall");
  g.playerYaw = 0;
  const w = DEBUG.spawn(10, 3); // caterpie
  w.life = 99999;
  const n = g.state.items.pokeball;
  g.throwBallAt(w);
  return n;
});
const caughtOk = await gwait(() => DEBUG.game.dexCaught.has(10), 15);
const cat = await page.evaluate(() => {
  const g = DEBUG.game;
  g.cheat("toggle", "catchall");
  return { ballsAfter: g.state.items.pokeball, caught: g.dexCaught.has(10), party: g.state.party.length };
});
ok("pokeball throw consumes ball", cat.ballsAfter === ballsBefore - 1, `balls ${ballsBefore}->${cat.ballsAfter}`);
ok("catchall cheat: caterpie caught first try", caughtOk && cat.caught && cat.party === 2, `party=${cat.party}`);

// ---------- 5b. follower Pokémon + petting ----------
const fol = await page.evaluate(() => {
  const g = DEBUG.game;
  g.syncFollower();
  const f = g.follower;
  if (!f) return { exists: false };
  const hapBefore = g.state.party[0].hap;
  g.petCd = 0;
  g.playerPos.copy(f.base); g.playerPos.x += 1;
  g.petFollower();
  return { exists: true, isLead: f.mon === g.activeMon(), visible: f.group.visible, hapBefore, hapAfter: g.state.party[0].hap };
});
ok("follower spawns and tracks the lead mon", fol.exists && fol.isLead && fol.visible, JSON.stringify(fol));
ok("petting raises happiness", fol.hapAfter > fol.hapBefore, `hap ${fol.hapBefore}->${fol.hapAfter}`);

// ---------- 5c. aim mode + physical throw ----------
const aim = await page.evaluate(async () => {
  const g = DEBUG.game;
  g.cheat("toggle", "catchall");
  g.playerYaw = 0;
  const w = DEBUG.spawn(16, 4); // pidgey — airborne now (sky habitat)
  w.life = 99999;
  // a real player calms the moment: don't let the bird spook off-screen
  // while the headless "hands" line up the shot
  w.species = Object.assign({}, w.species, { temper: "calm" });
  w.state = "idle"; w.fleeT = 0;
  // aim UP at the bird like a human would (pitch the camera at its center)
  const o = g.throwOrigin(), tp = w.pos();
  const dx = tp.x - o.x, dy = tp.y - o.y, dz = tp.z - o.z;
  DEBUG.look(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)) + 0.08);
  g.updateTarget();
  if (!g.target) g.target = w;  // headless camera can lag a frame
  const started = g.startAim();
  const slow = g.timeScale;
  await new Promise((r) => setTimeout(r, 600));     // charge advances over the hold
  const hadAim = !!g.aim && g.aim.charge > 0.35;
  g.aim.charge = 0.85;  // headless renders too few frames to charge naturally
  g.releaseAim();
  const flying = g.thrown.length > 0 && g.thrown[0].aimed;
  DEBUG.look(0, 0);
  return { started, hadAim, flying, slowmoEngaged: slow < 1 || g.timeScale < 1 };
});
ok("hold-to-aim engages (charge + slow-mo)", aim.started && aim.hadAim && aim.slowmoEngaged, JSON.stringify(aim));
ok("released ball flies physically", aim.flying);
const aimCatch = await gwait(() => DEBUG.game.dexCaught.has(16), 18);
const aimAfter = await page.evaluate(() => {
  const g = DEBUG.game;
  g.cheat("toggle", "catchall");
  return { caught: g.dexCaught.has(16), aimCleared: !g.aim, ts: g.timeScale };
});
ok("aimed throw captures (catchall)", aimCatch && aimAfter.caught, JSON.stringify(aimAfter));

// ---------- 5d. berry bushes yield oran berries ----------
const berry = await page.evaluate(() => {
  const g = DEBUG.game;
  const before = g.state.items.oranberry;
  const bush = g.world.berries?.find((b) => b.ready);
  if (bush) {
    g.playerPos.set(bush.pos.x + 1, g.world.height(bush.pos.x + 1, bush.pos.z), bush.pos.z);
    const it = g.nearestInteract();
    if (it && it.id === "berry") g.interact();
  }
  return { hadBush: !!bush, before, after: g.state.items.oranberry };
});
ok("berry bush yields oran berries", !berry.hadBush || berry.after > berry.before, JSON.stringify(berry));

// ---------- 5e. weather + rocket + fishing infrastructure ----------
const wfr = await page.evaluate(async () => {
  const g = DEBUG.game;
  DEBUG.weather("storm");
  const raining = g.world.isRaining();
  const wInfo = g.world.weatherInfo().id;
  DEBUG.weather("clear");
  const rocketSpawned = DEBUG.rocket();
  const rocket = g.trainers.find((t) => t.def.rocket);
  // dismiss their intro and remove them so later trainer tests aren't hijacked.
  // A modal shield makes the ambush continuation bail out of starting a battle.
  g.ui.show("m-pause");
  await new Promise((r) => setTimeout(r, 200));
  if (g.ui.dialogActive) g.ui.endDialog(null);
  await new Promise((r) => setTimeout(r, 300));
  if (g.ui.dialogActive) g.ui.endDialog(null);
  await new Promise((r) => setTimeout(r, 200));
  if (g.battle) { g.battle.end("fled"); await new Promise((r) => setTimeout(r, 150)); }
  g.ui.closeAll();
  if (rocket) {
    const i = g.trainers.indexOf(rocket);
    if (i >= 0) g.trainers.splice(i, 1);
    rocket.dispose();
  }
  return { raining, wInfo, rocketSpawned, rocketName: rocket?.def.name, party: rocket?.def.party };
});
ok("weather cheat: storm rains instantly", wfr.raining && wfr.wInfo === "storm", JSON.stringify({ raining: wfr.raining, w: wfr.wInfo }));
ok("Team Rocket ambush spawns Jessie & James", wfr.rocketSpawned && wfr.rocketName === "Jessie & James" && wfr.party?.includes(23), JSON.stringify({ name: wfr.rocketName }));

const fish = await page.evaluate(async () => {
  const g = DEBUG.game;
  if (g.battle) g.battle.end("fled");
  await new Promise((r) => setTimeout(r, 100));
  // walk the Pallet shoreline south until a cast spot appears
  const dir = g.lookDir().set(0, 0, 1); // face +z (toward the southern sea)
  let spot = null;
  for (let z = 150 * WS; z <= 280 * WS && !spot; z += 2) {
    const h = g.world.height(0, z);
    if (h < g.world.waterY) break; // don't wade in
    g.playerPos.set(0, h, z);
    spot = g.world.fishSpot(g.playerPos, dir);
  }
  if (!spot) return { spot: false };
  g.startFishing(spot);
  const hadBobber = !!g.fishing;
  g.fishing.phase = "bite"; g.fishing.t = 0.5;   // force the bite window
  g.hookFish();
  await new Promise((r) => setTimeout(r, 700));
  const hooked = g.wilds.some((w) => w.isWater && w.engaged) || !!g.battle;
  if (g.battle) g.battle.end("fled");
  return { spot: true, hadBobber, hooked };
});
ok("fishing: cast, bite, hook spawns a water battle", fish.spot && fish.hadBobber && fish.hooked, JSON.stringify(fish));

// ---------- 5f. dodge command exists in battle ----------
const dodge = await page.evaluate(async () => {
  const g = DEBUG.game;
  await new Promise((r) => setTimeout(r, 150));
  const w = DEBUG.spawn(1, 4);
  g.startWildBattle(w);
  await new Promise((r) => setTimeout(r, 200));
  const b = g.battle;
  if (!b) return { battle: false };
  b.incoming = { t: 0.4, max: 0.5 };   // telegraphed attack on the way
  g.state.party[0].spe = 999;          // guarantee the dodge roll
  b.tryDodge();
  const res = { battle: true, dodging: b.dodging, cd: b.dodgeCd };
  b.end("fled");
  return res;
});
ok("dodge command (Space) triggers a dodge attempt", dodge.battle && dodge.cd > 0, JSON.stringify(dodge));

// ---------- 5g. battle hotkeys: QERF moves, 1-6 switch, Z heal, X run ----------
const hotkeys = await page.evaluate(async () => {
  const g = DEBUG.game;
  const lead = g.state.party[0];                  // restore this order afterwards
  const w = DEBUG.spawn(1, 4);
  g.startWildBattle(w);
  await new Promise((r) => setTimeout(r, 700));   // outlast the opening ally lock
  const b = g.battle;
  if (!b) return { battle: false };
  // Q fires move 1 (cooldown starts ticking) — clear the opening lock first;
  // throttled headless RAF can leave it live long past wall-clock 700ms
  b.lock.ally = 0; b.cds.ally = [0, 0, 0, 0];
  g.onKey("q");
  const qUsed = b.cds.ally[0] > 0;
  // 2 switches straight to party slot 2 — no menu (the new battler becomes slot 1)
  const target = g.state.party[1];
  g.onKey("2");
  const switched = b.allyMon === target;
  // Z spends the best-fit heal item on the battler
  b.allyMon.hp = Math.max(1, Math.floor(b.allyMon.maxhp * 0.3));
  g.state.items.potion = (g.state.items.potion || 0) + 1;
  const healCount = () => ["oranberry", "potion", "superpotion"].reduce((n, k) => n + (g.state.items[k] || 0), 0);
  const healsBefore = healCount(), hpBefore = b.allyMon.hp;
  g.onKey("z");
  const healed = healCount() === healsBefore - 1 && b.allyMon.hp > hpBefore;
  // X runs from the wild battle
  b.runLock = 0; g.state.party.forEach((m) => (m.spe = 999));
  g.onKey("x");
  await new Promise((r) => setTimeout(r, 300));
  const fled = !g.battle;
  if (g.battle) g.battle.end("fled");
  g.setLead(g.state.party.indexOf(lead));         // charmander back in front
  return { battle: true, qUsed, switched, healed, fled, leadRestored: g.state.party[0] === lead };
});
ok("battle hotkeys: Q attacks, 2 switches, Z heals, X runs",
  hotkeys.battle && hotkeys.qUsed && hotkeys.switched && hotkeys.healed && hotkeys.fled && hotkeys.leadRestored, JSON.stringify(hotkeys));

// ---------- 6. evolution at authentic level (Charmander -> 16) ----------
await page.evaluate((target) => {
  const g = DEBUG.game;
  g.handleXp(g.state.party[0], target - g.state.party[0].xp);
}, msXp(16));
const evoOk = await gwait(() => DEBUG.game.state.party[0].sp === 5 && !DEBUG.game.cutscene, 30);
const evo = await page.evaluate(() => {
  const g = DEBUG.game; const m = g.state.party[0];
  return { spNow: m.sp, lv: m.lv, dexHasEvo: g.dexCaught.has(5), moves: m.moves.map((i) => PD.MOVES[i].name) };
});
ok("charmander evolves to charmeleon at lv16", evoOk && evo.spNow === 5 && evo.dexHasEvo && evo.lv === 16, JSON.stringify(evo));
ok("level-up moves learned (Ember@9, Leer@15)", evo.moves.includes("Ember") && evo.moves.includes("Leer"), evo.moves.join(","));
await shot("05-evolved");

// ---------- 7. shop ----------
const shop = await page.evaluate(async () => {
  const g = DEBUG.game;
  g.state.money = 1000;
  g.ui.openShop();
  await new Promise((r) => setTimeout(r, 250));
  const visible = !document.getElementById("m-shop").classList.contains("hidden");
  const before = { money: g.state.money, balls: g.state.items.pokeball };
  g.buyItem("pokeball", 2);
  return { visible, before, after: { money: g.state.money, balls: g.state.items.pokeball } };
});
ok("shop opens and sells", shop.visible && shop.after.balls === shop.before.balls + 2 && shop.after.money === shop.before.money - 400, JSON.stringify(shop));
await page.evaluate(() => DEBUG.game.ui.closeTop());
await sleep(300);

// ---------- 8. pokedex ----------
await page.evaluate(() => { const u = DEBUG.game.ui; u.closeAll(); if (u.dialogActive) u.endDialog(null); });
await sleep(200);
await page.keyboard.press("Tab");
await sleep(400);
const dex = await page.evaluate(() => {
  const open = !document.getElementById("m-dex").classList.contains("hidden");
  const cells = document.querySelectorAll(".dexcell").length;
  document.querySelector(".dexcell.caught")?.click();
  const detail = document.getElementById("dexdetail").textContent;
  return { open, cells, hasZones: detail.includes("Found:") };
});
ok("pokedex opens with 151 cells", dex.open && dex.cells === 151, JSON.stringify(dex));
ok("dex detail shows habitat zones", dex.hasZones);
await shot("06-pokedex");
await page.keyboard.press("Escape");
await sleep(300);

// ---------- 9. nurse heal sets respawn ----------
const heal = await page.evaluate(async () => {
  const g = DEBUG.game;
  g.state.party[0].hp = 3;
  const nurse = g.world.interactables.find((i) => i.id === "nurse");
  g.playerPos.set(nurse.pos.x, nurse.pos.y + 1, nurse.pos.z + 1.5);
  g.interact();
  await new Promise((r) => setTimeout(r, 500));
  document.getElementById("dialog").click();
  await new Promise((r) => setTimeout(r, 300));
  const btn = document.querySelector("#dlgbtns button");
  if (!btn) return { fail: "no choice buttons" };
  btn.click();
  await new Promise((r) => setTimeout(r, 2600));
  for (let i = 0; i < 3; i++) { document.getElementById("dialog").click(); await new Promise((r) => setTimeout(r, 250)); }
  return { hp: g.state.party[0].hp, max: g.state.party[0].maxhp, pp0: g.state.party[0].pp[0], lastCenter: g.state.lastCenter };
});
ok("nurse joy heals HP + PP and sets respawn", !heal.fail && heal.hp === heal.max && heal.pp0 === 35 && Array.isArray(heal.lastCenter), JSON.stringify(heal));

// ---------- 10. trainer battle + payout ----------
const tb = await page.evaluate(async () => {
  const g = DEBUG.game;
  const t = g.trainers.find((t) => t.def.id === "bug1");
  g.playerPos.set(t.def.pos[0] + 2, g.world.height(t.def.pos[0] + 2, t.def.pos[1] + 2) + 1, t.def.pos[1] + 2);
  g.startTrainerBattle(t);
  await new Promise((r) => setTimeout(r, 600));
  document.getElementById("dialog").click();
  await new Promise((r) => setTimeout(r, 1200));
  return { battle: !!g.battle, type: g.battle?.type, enemy: g.battle ? PDEX[g.battle.enemy().sp].name : null, lockE: g.battle?.lock.enemy };
});
ok("trainer battle starts after dialog", tb.battle && tb.type === "trainer", JSON.stringify(tb));

const noFlee = await page.evaluate(async () => {
  const g = DEBUG.game;
  if (g.battle) g.battle.tryRun();
  await new Promise((r) => setTimeout(r, 300));
  return !!g.battle;
});
ok("cannot flee trainer battle", noFlee);

let tbOver = null;
const moneyBefore = await page.evaluate(() => DEBUG.game.state.money);
const t1deadline = Date.now() + Math.max(25000, (45 / factor) * 1000);
while (Date.now() < t1deadline) {
  await page.evaluate(() => {
    const g = DEBUG.game;
    if (g.battle && g.battle.enemy()) g.battle.enemy().hp = Math.min(g.battle.enemy().hp, 1);
    if (g.battle) g.battle.allyMon.hp = g.battle.allyMon.maxhp;
    document.getElementById("dialog")?.click();
  });
  await page.keyboard.press("q");
  await sleep(220);
  tbOver = await page.evaluate(() => !DEBUG.game.battle);
  if (tbOver) break;
}
await sleep(800);
await page.evaluate(async () => { for (let i = 0; i < 3; i++) { document.getElementById("dialog")?.click(); await new Promise((r) => setTimeout(r, 200)); } });
const moneyAfter = await page.evaluate(() => DEBUG.game.state.money);
ok("trainer battle won, Gen 1 payout (base × level)", tbOver && moneyAfter - moneyBefore === 60, `money +${moneyAfter - moneyBefore} (expect 10×lv6=60)`);
await shot("07-after-trainer");

// ---------- 11. Brock: badge awarded ----------
const brock = await page.evaluate(async () => {
  const g = DEBUG.game;
  const t = g.trainers.find((t) => t.def.id === "brock");
  g.playerPos.copy(g.world.gymPos.boulder);
  g.playerPos.x += 2; g.playerPos.z += 2; g.playerPos.y += 1;
  g.startTrainerBattle(t);
  await new Promise((r) => setTimeout(r, 600));
  document.getElementById("dialog").click();
  await new Promise((r) => setTimeout(r, 1000));
  return { battle: !!g.battle, enemy: g.battle ? PDEX[g.battle.enemy().sp].name : null };
});
ok("Brock gym battle starts (Geodude first)", brock.battle && brock.enemy === "Geodude", JSON.stringify(brock));
const t2deadline = Date.now() + Math.max(25000, (45 / factor) * 1000);
let brockOver = false;
while (Date.now() < t2deadline) {
  await page.evaluate(() => {
    const g = DEBUG.game;
    if (g.battle && g.battle.enemy()) g.battle.enemy().hp = Math.min(g.battle.enemy().hp, 1);
    if (g.battle) g.battle.allyMon.hp = g.battle.allyMon.maxhp;
    document.getElementById("dialog")?.click();
  });
  await page.keyboard.press("q");
  await sleep(220);
  brockOver = await page.evaluate(() => !DEBUG.game.battle);
  if (brockOver) break;
}
await sleep(800);
await page.evaluate(async () => { for (let i = 0; i < 4; i++) { document.getElementById("dialog")?.click(); await new Promise((r) => setTimeout(r, 200)); } });
const badge = await page.evaluate(() => DEBUG.game.state.badges);
ok("Boulder Badge awarded", brockOver && badge.includes("boulder"), JSON.stringify(badge));

// ---------- 12. cheats ----------
const cheats = await page.evaluate(async () => {
  const g = DEBUG.game;
  const m0 = g.state.money;
  g.cheat("money");
  g.cheat("badges");
  const gateOpen = !g.world.caveGateBox;
  g.cheat("spawn", { name: "Pikachu", lv: 30 });
  const pika = g.wilds.find((w) => w.mon.sp === 25 && w.mon.lv === 30);
  g.cheat("tp", "powerplant");
  const zone = g.world.zoneAt(g.playerPos.x, g.playerPos.z);
  // god mode: enemy hit deals no damage
  g.cheat("toggle", "god");
  const w = DEBUG.spawn(6, 40); // charizard
  g.startWildBattle(w);
  await new Promise((r) => setTimeout(r, 400));
  let godOk = false;
  if (g.battle) {
    const hpBefore = g.battle.allyMon.hp;
    g.battle.resolveHit("enemy", PD.MOVES[g.battle.enemy().moves[0]]);
    godOk = g.battle.allyMon.hp === hpBefore;
    g.battle.end("fled");
  }
  g.cheat("toggle", "god");
  return { moneyGain: g.state.money - m0 >= 10000, gateOpen, pika: !!pika, zone, godOk };
});
ok("cheat: +money works", cheats.moneyGain);
ok("cheat: badges open Cerulean Cave gate", cheats.gateOpen);
ok("cheat: spawn Pikachu lv30 by name", cheats.pika);
ok("cheat: teleport to Power Plant", cheats.zone === "power-plant", cheats.zone);
ok("cheat: god mode blocks damage", cheats.godOk);
await shot("08-powerplant");

// ---------- 13. night + scenery ----------
await page.evaluate(() => DEBUG.cheat("night"));
await sleep(600);
const night = await page.evaluate(() => DEBUG.game.world.isNight());
ok("night cheat flips day/night", night === true, `isNight=${night}`);
await shot("09-night");

await page.evaluate(() => { DEBUG.cheat("day"); DEBUG.cheat("tp", "seafoam"); });
await sleep(1500);
await shot("10-seafoam");
await page.evaluate(() => DEBUG.cheat("tp", "mtmoon"));
await sleep(1500);
const caveBiome = await page.evaluate(() => DEBUG.game.world.biomeAt(DEBUG.game.playerPos.x, DEBUG.game.playerPos.z));
ok("Mt. Moon interior is cave biome", caveBiome === "cave", caveBiome);
await shot("11-mtmoon");
await page.evaluate(() => DEBUG.cheat("tp", "victory"));
await sleep(1500);
await shot("12-victory");

// ---------- 14. v5: AI ramp, environment, follower, vehicles, names ----------
const ai = await page.evaluate(async () => {
  const g = DEBUG.game;
  const w = DEBUG.spawn(16, 10);
  g.startWildBattle(w);
  await new Promise((r) => setTimeout(r, 300));
  const b = g.battle;
  if (!b) return { fail: "no battle" };
  const out = {};
  g.state.settings.ai = "novice"; out.novice = b.aiIQ();
  g.state.settings.ai = "ace"; out.ace = b.aiIQ();
  g.state.settings.ai = "adaptive";
  const saved = g.state.badges;
  g.state.badges = []; out.adaptEarly = b.aiIQ();
  g.state.badges = saved; out.adaptLate = b.aiIQ(); // 8 badges at this point
  // environment: a fire hit chars the ground (decal pool grows)
  const fire = Object.values(PD.MOVES).find((m) => m.type === "fire" && m.power > 0);
  const d0 = g.fx.decals.length;
  b.envImpact(fire, b.enemyEnt, true);
  out.decal = g.fx.decals.length > d0;
  out.trees = g.world.treeSpots.length > 100 && Array.isArray(g.world.treesNear(g.playerPos, 30, 2));
  b.end("fled");
  return out;
});
ok("AI setting scales intelligence (novice 0.12 → ace 1)", !ai.fail && ai.novice < 0.2 && ai.ace === 1, JSON.stringify(ai));
ok("adaptive AI ramps with badges (dumb early, sharp late)", !ai.fail && ai.adaptEarly < ai.adaptLate && ai.adaptEarly <= 0.15, `early=${ai.adaptEarly?.toFixed(2)} late=${ai.adaptLate?.toFixed(2)}`);
ok("moves scar the terrain (ground decal spawned)", ai.decal === true);
ok("world tree registry + rustle query work", ai.trees === true);

const fol2 = await page.evaluate(() => {
  const g = DEBUG.game;
  g.state.followerUid = null;
  g.playerYaw = 0; // facing -Z
  g.syncFollower();
  const f = g.follower;
  if (!f) return { fail: "no follower" };
  const ideal = f.idealPos();
  const ahead = ideal.z < g.playerPos.z - 0.5;
  const left = ideal.x < g.playerPos.x - 0.5;
  const second = g.state.party[1];
  g.setFollowerMon(second);
  const picked = g.followerMon() === second && g.follower?.mon === second;
  g.setFollowerMon(null);
  const recalled = g.follower === null;
  g.state.followerUid = null; g.syncFollower(); // restore default
  return { ahead, left, picked, recalled, visible: !!g.follower && g.follower.group.visible };
});
ok("follower walks ahead-left, in view", !fol2.fail && fol2.ahead && fol2.left && fol2.visible, JSON.stringify(fol2));
ok("party 'Walk with me' picks + recalls partner", !fol2.fail && fol2.picked && fol2.recalled, JSON.stringify(fol2));

const veh = await page.evaluate(async () => {
  const g = DEBUG.game;
  const npcs = ["chairman", "bikeclerk", "truck"].every((id) => g.world.interactables.some((i) => i.id === id));
  DEBUG.cheat("tp", "pallet");
  await new Promise((r) => setTimeout(r, 250));
  g.state.bike = true; g.state.truckKeys = true; g.state.vehicle = null;
  g.toggleVehicle(); const v1 = g.state.vehicle;
  g.toggleVehicle(); const v2 = g.state.vehicle;
  const w = DEBUG.spawn(16, 5);
  g.startWildBattle(w);
  await new Promise((r) => setTimeout(r, 250));
  const dismounted = g.state.vehicle === null;
  if (g.battle) g.battle.end("fled");
  return { npcs, v1, v2, dismounted };
});
ok("Fan Club chairman, Bike Shop owner, truck are interactable", veh.npcs === true);
ok("V cycles vehicles: bike → truck; battle dismounts you", veh.v1 === "bike" && veh.v2 === "truck" && veh.dismounted, JSON.stringify(veh));

const names = await page.evaluate(() => {
  const g = DEBUG.game;
  const tn = g.trainers.map((t) => t.def.name);
  const classes = ["Bug Catcher", "Lass", "Youngster", "Hiker", "Super Nerd", "Rocket", "Jr. Trainer♀", "Jr. Trainer♂", "Engineer", "Channeler", "Gambler", "Sailor", "Psychic", "Blackbelt", "Biker", "Cue Ball", "Fisherman", "Pokémaniac", "Cooltrainer♀", "Cooltrainer♂"];
  const hasClasses = classes.every((n) => tn.includes(n));
  const noInvented = !tn.some((n) => /(Rico|Janice|Marcos|Rodette|Ava)/.test(n));
  return { hasClasses, noInvented };
});
ok("trainer names are authentic RBY classes", names.hasClasses && names.noInvented, JSON.stringify(names));

// ---------- 15. procedural 3D models (v6) ----------
const rigs = await page.evaluate(async () => {
  const mm = await import("/src/monmodel.ts");
  let built = 0, withMats = 0, withSpec = 0, levitators = 0;
  for (let sp = 1; sp <= 151; sp++) {
    if (mm.MON3D_SPECS[sp]) withSpec++;
    const rig = mm.buildMonRig(sp, 1.2);
    let meshes = 0;
    rig.group.traverse((o) => { if (o.isMesh) meshes++; });
    if (meshes >= 3) built++;
    if (rig.mats.length >= 2) withMats++;
    if (rig.levitates) levitators++;
    rig.dispose();
  }
  return { built, withMats, withSpec, levitators };
});
ok("all 151 species build 3D rigs (≥3 meshes each)", rigs.built === 151, `built=${rigs.built}`);
ok("every species has a hand-written spec + own materials", rigs.withSpec === 151 && rigs.withMats === 151, JSON.stringify(rigs));
ok("ghosts/bugs/magnets levitate (10+ species)", rigs.levitators >= 10, `levitators=${rigs.levitators}`);

const world3d = await page.evaluate(() => {
  const g = DEBUG.game;
  const w = DEBUG.spawn(4, 10); // Charmander — has a flame to flicker
  w.engaged = true;
  const isRig = !!w.rig && !w.sprite && !!w.hitMesh;
  const sceneSprites = [];
  g.scene.traverse((o) => { if (o.isSprite && o.material?.map?.image?.src?.includes?.("/sprites/")) sceneSprites.push(o); });
  // snapshot rig pose; the procedural animator should move it within a second
  const hash = () => { let h = 0; w.rig.group.traverse((o) => { h += o.rotation.x + o.rotation.z + o.position.y + o.scale.y; }); return h; };
  window.__rigH0 = hash(); window.__rigHash = hash;
  window.__rigWild = w;
  return { isRig, noWorldSprites: sceneSprites.length === 0 };
});
ok("wilds are 3D rigs with hit proxies (no billboards)", world3d.isRig && world3d.noWorldSprites, JSON.stringify(world3d));
const animMoves = await gwait(() => Math.abs(window.__rigHash() - window.__rigH0) > 0.02, 4);
ok("procedural animation is alive (pose changes over time)", animMoves);
const faced = await page.evaluate(async () => {
  const g = DEBUG.game;
  const w = window.__rigWild;
  g.startWildBattle(w);
  await new Promise((r) => setTimeout(r, 200));
  return !!g.battle;
});
const facing = await gwait(() => {
  const b = DEBUG.game.battle;
  if (!b) return false;
  const a = b.allyEnt, e = b.enemyEnt;
  const want = Math.atan2(e.base.x - a.base.x, e.base.z - a.base.z);
  let d = a.faceYaw - want;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d) < 0.35;
}, 6);
ok("battlers square off face-to-face (3D facing)", faced && facing);
await page.evaluate(() => { DEBUG.game.battle?.end("fled"); });

// ---------- 16. possession: play AS your Pokémon (v7) ----------
const traits = await page.evaluate(async () => {
  const gm = await import("/src/game.ts");
  return {
    pika: gm.battleSpeedFor(25, 20, 90),
    snorlax: gm.battleSpeedFor(143, 20, 30),
    karpLand: gm.battleSpeedFor(129, 20, 80),
    karpWater: gm.battleSpeedFor(129, 20, 80, { water: true }),
    gastlyFloats: gm.floatsOverWater(92),
    pidgeyFloats: gm.floatsOverWater(16),
    rattataFloats: gm.floatsOverWater(19),
    skills: {
      gastly: gm.speciesSkill(92), abra: gm.speciesSkill(63), diglett: gm.speciesSkill(50),
      pidgey: gm.speciesSkill(16), snorlax: gm.speciesSkill(143), pikachu: gm.speciesSkill(25),
      goldeen: gm.speciesSkill(118),
    },
    expLow: gm.expFactorFor(5), expHigh: gm.expFactorFor(50),
  };
});
ok("battlefield speed comes from real stats & body plans (Pikachu ≫ Snorlax)",
  traits.pika > traits.snorlax + 1.5, `pika=${traits.pika.toFixed(1)} snorlax=${traits.snorlax.toFixed(1)}`);
ok("fish flop on land + rule the water; birds/ghosts glide over it",
  traits.karpLand < 2 && traits.karpWater > traits.karpLand * 2.5 && traits.gastlyFloats && traits.pidgeyFloats && !traits.rattataFloats,
  JSON.stringify({ land: +traits.karpLand.toFixed(1), water: +traits.karpWater.toFixed(1) }));
const sk = traits.skills;
ok("species fight with signature skills (ghost blinks, Abra teleports, mole burrows...)",
  sk.gastly === "blink" && sk.abra === "teleport" && sk.diglett === "burrow" &&
  sk.pidgey === "swoop" && sk.snorlax === "brace" && sk.pikachu === "zigzag" && sk.goldeen === "dive",
  JSON.stringify(sk));
ok("levels are experience: Lv50 veterans read the fight, Lv5 hatchlings don't",
  traits.expLow === 0 && traits.expHigh === 1, `lv5=${traits.expLow} lv50=${traits.expHigh}`);

const pos1 = await page.evaluate(async () => {
  const g = DEBUG.game;
  DEBUG.style("fp");                        // first-person battle style
  DEBUG.tp("safari");                       // flat, open ground for movement tests
  DEBUG.battle(1, 30);                      // calm, sturdy Bulbasaur — survives the whole section
  await new Promise((r) => setTimeout(r, 250));
  const b = g.battle;
  if (!b) return { fail: "no battle" };
  b.lock.enemy = 99;                        // statue mode until the AI checks
  window.__b = b;
  window.__ax0 = b.allyEnt.base.clone();
  return { style: b.style };
});
// fp style dives into your Pokémon by itself after the send-out
const autoPossessed = await gwait(() => window.__b.possessed, 8);
const pos1b = await page.evaluate(() => {
  const g = DEBUG.game, b = window.__b;
  return { forceYawSet: b.allyEnt.forceYaw != null, throwBlocked: !g.canThrowNow(false) };
});
const rigHidden = await gwait(() => !window.__b.allyEnt.rig.group.visible, 4);
ok("first-person style auto-possesses your Pokémon (facing + rig hidden + balls held)",
  pos1.style === "fp" && autoPossessed && pos1b.forceYawSet && pos1b.throwBlocked && rigHidden,
  JSON.stringify({ ...pos1, autoPossessed, ...pos1b }));

await page.evaluate(() => { window.__b.possessInput.x = 1; window.__b.possessInput.z = 0; });
const steered = await gwait(() => window.__b.allyEnt.base.distanceTo(window.__ax0) > 1.4, 5);
ok("WASD steers the possessed Pokémon through the arena", steered);
const dash = await page.evaluate(() => {
  const b = window.__b;
  b.possessInput.x = 0;
  const p0 = b.allyEnt.base.clone();
  b.possessDash();
  window.__dashP0 = p0;
  return { cd: b.dashCd > 0 };
});
const dashed = await gwait(() => window.__b.allyEnt.base.distanceTo(window.__dashP0) > 1.6, 4);
ok("Space dash: real burst movement on a Speed-based cooldown", dash.cd && dashed);

// spatial shot: aim true at the frozen target, fire Ember — must land without RNG.
// Step in to 4.5m first (short, prop-free flight) and allow a couple of
// attempts in case the headless camera lags a frame behind the aim.
await page.evaluate(() => {
  const b = window.__b;
  b.allyMon.moves[0] = 52; b.allyMon.pp[0] = 25;
  const dir = b.allyEnt.base.clone().sub(b.enemyEnt.base).setY(0).normalize();
  b.allyEnt.base.copy(b.enemyEnt.base).addScaledVector(dir, 4.5);
  b.allyEnt.snapGround();
  const to = b.enemyEnt.pos().clone().sub(b.allyEnt.eye());
  DEBUG.look(Math.atan2(-to.x, -to.z), Math.atan2(to.y, Math.hypot(to.x, to.z)));
  window.__ehp0 = b.enemy().hp;
});
await sleep(400 / Math.min(factor, 1));     // let the camera adopt the aim
let fired = false, emberLanded = false;
for (let attempt = 0; attempt < 3 && !emberLanded; attempt++) {
  fired = await page.evaluate(() => {
    const b = window.__b;
    const to = b.enemyEnt.pos().clone().sub(b.allyEnt.eye());
    DEBUG.look(Math.atan2(-to.x, -to.z), Math.atan2(to.y, Math.hypot(to.x, to.z)));
    b.cds.ally[0] = 0; b.lock.ally = 0;
    b.useMove("ally", 0);
    return b.projectiles.some((p) => p.move.name === "Ember");
  }) || fired;
  emberLanded = await gwait(() => window.__b.enemy().hp < window.__ehp0, 6);
}
ok("possessed shots are real aimed projectiles that land (no accuracy roll)", fired && emberLanded,
  `fired=${fired} landed=${emberLanded}`);

const gate = await page.evaluate(() => {
  const b = window.__b;
  b.allyMon.moves[1] = 10; b.allyMon.pp[1] = 30;   // Scratch
  b.cds.ally[1] = 0; b.lock.ally = 0;
  const dir = b.allyEnt.base.clone().sub(b.enemyEnt.base).setY(0).normalize();
  b.allyEnt.base.copy(b.enemyEnt.base).addScaledVector(dir, 12);
  b.allyEnt.snapGround();
  const pp0 = b.allyMon.pp[1], hp0 = b.enemy().hp;
  b.useMove("ally", 1);
  return { gated: b.allyMon.pp[1] === pp0 && b.enemy().hp === hp0, far: b.rangeState(1) === "far" };
});
ok("contact moves are range-gated (no PP wasted from afar, HUD shows TOO FAR)", gate.gated && gate.far, JSON.stringify(gate));

await page.evaluate(() => {
  const b = window.__b;
  const dir = b.allyEnt.base.clone().sub(b.enemyEnt.base).setY(0).normalize();
  b.allyEnt.base.copy(b.enemyEnt.base).addScaledVector(dir, 2.0);
  b.allyEnt.snapGround();
  b.cds.ally[1] = 0; b.lock.ally = 0;
  window.__ehp1 = b.enemy().hp;
  b.useMove("ally", 1);
});
const struck = await gwait(() => window.__b.enemy().hp < window.__ehp1, 6);
ok("gap-close strike connects when you're actually in range", struck);

// unfreeze: the enemy must fight back in space — move AND land spatial attacks
const brain0 = await page.evaluate(() => {
  const b = window.__b;
  b.allyMon.hp = 500;                       // test armor: no faint mid-section
  b.lock.enemy = 0; b.enemyThink = 0.1;
  window.__ex0 = b.enemyEnt.base.clone();
  window.__ahp0 = b.allyMon.hp;
  return true;
});
const enemyMoves = await gwait(() => window.__b.enemyEnt.base.distanceTo(window.__ex0) > 0.8, 10);
const enemyFights = await gwait(() => window.__b.allyMon.hp < window.__ahp0 || window.__b.projectiles.some((p) => p.side === "enemy"), 16);
ok("possessed enemy AI fights in space (repositions + attacks spatially)", brain0 && enemyMoves && enemyFights,
  `moves=${enemyMoves} fights=${enemyFights}`);
await page.evaluate(() => {
  const b = window.__b;
  b.lock.enemy = 99;                        // re-freeze for the HUD/eject checks
  b.allyMon.hp = Math.min(b.allyMon.hp, b.allyMon.maxhp);
});

const hud7 = await page.evaluate(() => ({
  temper: document.getElementById("etemper")?.textContent || "",
  possessbarShown: !document.getElementById("possessbar")?.classList.contains("hidden"),
}));
ok("battle HUD reads the opponent: temper chip + possession bar", hud7.temper === "calm" && hud7.possessbarShown, JSON.stringify(hud7));

const eject = await page.evaluate(() => {
  const b = window.__b;
  b.wantPossess = false;                    // a deliberate T-out: no auto-resume
  b.setPossessed(false);
  const g = DEBUG.game;
  return { possessed: b.possessed, canThrowBack: g.canThrowNow(false) === !!g.ballType() };
});
const rigBack = await gwait(() => window.__b.allyEnt.rig.group.visible, 4);
ok("T ejects back to the trainer (rig + throwing restored)", !eject.possessed && eject.canThrowBack && rigBack, JSON.stringify(eject));

// ---------- 16b. the fp skill economy: ceiling up, floor down ----------
const econ1 = await page.evaluate(() => {
  const b = window.__b;
  b.wantPossess = true; b.setPossessed(true);   // dive back in for the economy checks
  b.lock.enemy = 99; b.enemyThink = 99;
  // a wild swing from across the arena (direct call skips the range gate):
  // the lunge can't cover 12m — whiffing must open YOU up
  const dir = b.allyEnt.base.clone().sub(b.enemyEnt.base).setY(0).normalize();
  b.allyEnt.base.copy(b.enemyEnt.base).addScaledVector(dir, 12);
  b.allyEnt.snapGround();
  b.meleeStrike("ally", window.PD.MOVES[10]);   // Scratch
  return true;
});
const whiffOpened = await gwait(() => window.__b.enemyCounterT > 0, 5);
ok("whiffed melee leaves you EXPOSED (enemy's next hit lands harder)", econ1 && whiffOpened);

const graze = await page.evaluate(() => {
  const b = window.__b;
  b.allyMon.hp = b.allyMon.maxhp = 400;     // armor so the section can't faint us
  const mr = Math.random;
  Math.random = () => 0.5;                  // pin crits & damage rolls: pure mechanics
  const hp0 = b.allyMon.hp;
  b.enemyCounterT = 0;
  b.dashT = 0.3;                            // we're mid-dash as the hit lands
  b.resolveHit("enemy", window.PD.MOVES[33], { direct: true });   // Tackle
  const grazeDmg = hp0 - b.allyMon.hp;
  b.dashT = 0; b.possessInput.x = b.possessInput.z = 0;
  const hp1 = b.allyMon.hp;
  b.resolveHit("enemy", window.PD.MOVES[33], { direct: true });
  const flatDmg = hp1 - b.allyMon.hp;
  Math.random = mr;
  return { grazeDmg, flatDmg };
});
ok("dash i-frames turn hits into grazes; flat-footed hits cost extra",
  graze.grazeDmg > 0 && graze.flatDmg > graze.grazeDmg * 1.5, JSON.stringify(graze));

const interrupted = await page.evaluate(() => {
  const b = window.__b;
  // the enemy is mid-wind-up; we strike INTO it from close range
  b.incoming = { t: 5, max: 5 };
  const dir = b.allyEnt.base.clone().sub(b.enemyEnt.base).setY(0).normalize();
  b.allyEnt.base.copy(b.enemyEnt.base).addScaledVector(dir, 2.0);
  b.allyEnt.snapGround();
  b.meleeStrike("ally", window.PD.MOVES[10]);
  return true;
});
const staggered = await gwait(() => window.__b.enemyStaggerT > 0, 5);
ok("striking into a wind-up INTERRUPTS the attack (timing = the skill ceiling)", interrupted && staggered);

// ---------- 16c. moves interact with moves: duels, hazards, quakes ----------
const duel = await page.evaluate(() => {
  const b = window.__b;
  for (let i = b.projectiles.length - 1; i >= 0; i--) b.killProj(i, true);
  b.incoming = null;
  // stage a head-on meeting: Water Gun (enemy) vs Ember (ally)
  const to = b.enemyEnt.pos().clone().sub(b.allyEnt.eye());
  DEBUG.look(Math.atan2(-to.x, -to.z), Math.atan2(to.y, Math.hypot(to.x, to.z)));
  b.fireProjectile("ally", window.PD.MOVES[52]);    // Ember
  b.fireProjectile("enemy", window.PD.MOVES[55]);   // Water Gun
  const ember = b.projectiles.find((p) => p.side === "ally");
  const water = b.projectiles.find((p) => p.side === "enemy");
  if (!ember || !water) return { fail: "projectiles missing" };
  // place them adjacent mid-arena and resolve the meeting right now
  const mid = b.allyEnt.pos().clone().lerp(b.enemyEnt.pos(), 0.5);
  ember.p.copy(mid); ember.mesh.position.copy(mid);
  water.p.copy(mid).add(new ember.p.constructor(0.3, 0, 0)); water.mesh.position.copy(water.p);
  b.resolveDuels();
  const emberDied = !b.projectiles.some((p) => p.side === "ally");
  const waterWeakened = b.projectiles.some((p) => p.side === "enemy" && p.dmgMul < 1);
  for (let i = b.projectiles.length - 1; i >= 0; i--) b.killProj(i, true);
  return { emberDied, waterWeakened };
});
ok("mid-air duel: Water Gun douses Ember and powers through (type beats type)",
  duel.emberDied && duel.waterWeakened, JSON.stringify(duel));

const hazard = await page.evaluate(() => {
  const b = window.__b;
  for (let i = b.projectiles.length - 1; i >= 0; i--) b.killProj(i, true);
  const clean = b.battlerSpeed("ally");
  b.spawnHazard(b.allyEnt.feet().clone(), "poison", "enemy");   // standing right in it
  const slowed = b.battlerSpeed("ally");
  window.__hzHp0 = b.allyMon.hp;
  return { spawned: b.hazards.length > 0, clean, slowed };
});
const hazardTicked = await gwait(() => window.__b.allyMon.hp < window.__hzHp0, 6);
ok("lobbed gunk leaves a hazard pool that slows and stings",
  hazard.spawned && hazard.slowed < hazard.clean * 0.75 && hazardTicked,
  JSON.stringify({ clean: +hazard.clean.toFixed(1), slowed: +hazard.slowed.toFixed(1), ticked: hazardTicked }));

const quake = await page.evaluate(() => {
  const b = window.__b;
  b.hazards.length = 0;
  // phased = airborne/underground: the shockwave must roll under us
  b.allyEnt.phasedT = 9;
  window.__qkHp0 = b.allyMon.hp;
  b.counterT = 0;
  b.quakeWave("enemy", window.PD.MOVES[89]);    // Earthquake
  return true;
});
const quakeDodged = await gwait(() => window.__b.counterT > 0, 5);
const quakeNoDmg = await page.evaluate(() => {
  const b = window.__b;
  const safe = b.allyMon.hp === window.__qkHp0;
  b.allyEnt.phasedT = 0; b.allyEnt.setOpacity(1);
  window.__qkHp1 = b.allyMon.hp;
  b.quakeWave("enemy", window.PD.MOVES[89]);    // grounded this time — it must hurt
  return safe;
});
const quakeHit = await gwait(() => window.__b.allyMon.hp < window.__qkHp1, 5);
ok("Earthquake is a ground wave: airborne dodges it, grounded eats it",
  quakeDodged && quakeNoDmg && quakeHit, `dodged=${quakeDodged} safe=${quakeNoDmg} hit=${quakeHit}`);

// ---------- 16d. no more clunk: throws/menus auto-eject, then auto-resume ----------
const flow = await page.evaluate(() => {
  const g = DEBUG.game, b = window.__b;
  DEBUG.give("pokeball", 5);
  b.allyMon.hp = Math.min(b.allyMon.hp, b.allyMon.maxhp);
  b.wantPossess = true;
  if (!b.possessed) b.setPossessed(true);
  const wasPossessed = b.possessed;
  const aimed = g.startAim();              // hold-to-aim: hands you back to the trainer mid-motion
  const ejected = !b.possessed && b.wantPossess;
  g.cancelAim();                           // changed your mind...
  return { wasPossessed, aimed, ejected };
});
ok("holding to aim a Ball auto-ejects you to the trainer (no T dance)", flow.wasPossessed && flow.aimed && flow.ejected, JSON.stringify(flow));
const resumed = await gwait(() => window.__b.possessed, 8);
ok("...and you flow right back into your Pokémon after", resumed);
await page.evaluate(() => { window.__b.wantPossess = false; window.__b.setPossessed(false); DEBUG.game.battle?.end("fled"); window.__b = null; });

// ---------- 16e. classic style: real RBY turns ----------
const cl1 = await page.evaluate(async () => {
  DEBUG.style("classic");
  DEBUG.battle(1, 30);
  await new Promise((r) => setTimeout(r, 250));
  const b = DEBUG.game.battle;
  if (!b) return { fail: "no battle" };
  window.__b = b;
  window.__clHp0 = b.allyMon.hp;
  return { style: b.style, phase: b.turnPhase, noDodge: (b.tryDodge(), !b.dodging), possessBlocked: (b.togglePossess(), !b.possessed) };
});
// the enemy must WAIT for us — no real-time attacks while we think
await sleep(2600 / Math.min(factor, 1));
const waited = await page.evaluate(() => window.__b.lastEnemyMove === null && window.__b.allyMon.hp === window.__clHp0);
ok("classic style: turn-based — no dodging, no possession, enemy waits for your move",
  cl1.style === "classic" && cl1.phase === "player" && cl1.noDodge && cl1.possessBlocked && waited,
  JSON.stringify({ ...cl1, waited }));

const cl2 = await page.evaluate(() => {
  const b = window.__b;
  b.allyMon.moves[1] = 45; b.allyMon.pp[1] = 40;   // Growl: a turn that can't KO
  b.useMove("ally", 1);
  return { phase: b.turnPhase };
});
const enemyReplied = await gwait(() => window.__b.lastEnemyMove !== null, 12);
const backToPlayer = await gwait(() => window.__b.turnPhase === "player", 12);
ok("classic round resolves: you act, the enemy answers, your turn again",
  cl2.phase === "busy" && enemyReplied && backToPlayer,
  JSON.stringify({ busy: cl2.phase === "busy", enemyReplied, backToPlayer }));
await page.evaluate(() => { DEBUG.game.battle?.end("fled"); window.__b = null; });

// ---------- 16f. arena style: the balanced middle ----------
const ar1 = await page.evaluate(async () => {
  DEBUG.style("arena");
  DEBUG.battle(19, 8);
  await new Promise((r) => setTimeout(r, 250));
  const b = DEBUG.game.battle;
  if (!b) return { fail: "no battle" };
  const possessBlocked = (b.togglePossess(), !b.possessed);
  b.incoming = { t: 1, max: 1 };
  b.tryDodge();
  const canDodge = b.dodging && b.dodgeCd > 0;
  b.end("fled");
  return { style: b.style, possessBlocked, canDodge };
});
ok("arena style: real-time dodge commands work, possession is menu-gated",
  ar1.style === "arena" && ar1.possessBlocked && ar1.canDodge, JSON.stringify(ar1));

// ---------- 16g. habitats: they're all animals, after all (v10) ----------
const habs = await page.evaluate(() => ({
  pidgey: DEBUG.hab(16), zubat: DEBUG.hab(41), butterfree: DEBUG.hab(12),
  magikarp: DEBUG.hab(129), tentacool: DEBUG.hab(72), squirtle: DEBUG.hab(7),
  caterpie: DEBUG.hab(10), metapod: DEBUG.hab(11),
  rattata: DEBUG.hab(19), pikachu: DEBUG.hab(25), oddish: DEBUG.hab(43),
  geodude: DEBUG.hab(74), snorlax: DEBUG.hab(143), doduo: DEBUG.hab(84),
}));
ok("habitats classify by biology: birds sky, fish water, larvae tree, small things grass",
  habs.pidgey === "sky" && habs.zubat === "sky" && habs.butterfree === "sky" &&
  habs.magikarp === "water" && habs.tentacool === "water" && habs.squirtle === "water" &&
  habs.caterpie === "tree" && habs.metapod === "tree" &&
  habs.rattata === "grass" && habs.pikachu === "grass" && habs.oddish === "grass" &&
  habs.geodude === "ground" && habs.snorlax === "ground" && habs.doduo === "ground",
  JSON.stringify(habs));

// a bird spawns ON THE WING — airborne, shadow pinned to the ground below
const sky = await page.evaluate(() => {
  const g = DEBUG.game;
  g.playerPos.set(-100 * WS, g.world.height(-100 * WS, 60 * WS) + 1.7, 60 * WS);   // open Route 1
  const w = DEBUG.spawn(16, 5);
  window.__sky = w;
  const ground = Math.max(g.world.height(w.base.x, w.base.z), g.world.waterY);
  return { air: w.air, lift: +(w.base.y - ground).toFixed(2), habitat: w.habitat };
});
ok("Pidgey spawns airborne (look up!)", sky.air && sky.lift > 1.5, JSON.stringify(sky));

// a fish spawns IN the water even when the spawn roll lands ashore
const aqua = await page.evaluate(() => {
  const g = DEBUG.game;
  // stand on Pallet's south shore, near the sea
  let sx = 0, sz = 0, found = false;
  outer: for (let x = -130 * WS; x <= -60 * WS; x += 4) {
    for (let z = 150 * WS; z <= 230 * WS; z += 4) {
      if (g.world.height(x, z) < g.world.waterY - 0.7) { sx = x; sz = z; found = true; break outer; }
    }
  }
  if (!found) return { found };
  g.playerPos.set(sx + 6, g.world.height(sx + 6, sz) + 1.7, sz);
  const w = DEBUG.spawn(129, 8);
  const depth = g.world.height(w.base.x, w.base.z);
  return { found, habitat: w.habitat, isWater: w.isWater, inWater: depth < g.world.waterY - 0.45, y: +w.base.y.toFixed(2) };
});
ok("Magikarp slips into the nearest water and swims", aqua.found && aqua.isWater && aqua.inWater, JSON.stringify(aqua));

// a larva spawns PERCHED in a canopy when a tree is close
const arbo = await page.evaluate(() => {
  const g = DEBUG.game;
  const t = g.world.treeSpots[0];
  g.playerPos.set(t.x + 4, g.world.height(t.x + 4, t.z) + 1.7, t.z);
  const w = DEBUG.spawn(10, 4);
  const ground = g.world.height(w.base.x, w.base.z);
  return { habitat: w.habitat, perched: w.perched, lift: +(w.base.y - ground).toFixed(2) };
});
ok("Caterpie perches up in the trees", arbo.perched && arbo.lift > 1.0, JSON.stringify(arbo));

// grass dwellers cluster around the tall grass
const grassy = await page.evaluate(() => {
  const g = DEBUG.game;
  const c = g.world.grassClusters[0];
  g.playerPos.set(c.x + 5, g.world.height(c.x + 5, c.z) + 1.7, c.z);
  const w = DEBUG.spawn(19, 4);
  const d = Math.hypot(w.base.x - c.x, w.base.z - c.z);
  return { habitat: w.habitat, anchored: !!w.home, distToGrass: +d.toFixed(1) };
});
ok("Rattata rustles around the tall grass", grassy.habitat === "grass" && grassy.anchored && grassy.distToGrass < 12, JSON.stringify(grassy));

// battle transition: the bird swoops DOWN to fight, and flies off if you flee
const swoop = await page.evaluate(() => {
  const g = DEBUG.game;
  let w = window.__sky;
  // the full-scale map means the earlier habitat hops may have distance-culled
  // the original bird — spawn a fresh one where we stand now
  if (!w || w.dead || !g.wilds.includes(w)) w = window.__sky = DEBUG.spawn(16, 6);
  w.life = 99999;
  g.playerPos.set(w.base.x + 6, g.world.height(w.base.x + 6, w.base.z) + 1.7, w.base.z);
  g.startWildBattle(w);
  return { battle: !!g.battle };
});
const landed = await gwait(() => {
  const w = window.__sky, g = DEBUG.game;
  return !w.air && Math.abs(w.base.y - g.world.height(w.base.x, w.base.z)) < 0.6;
}, 6);
ok("the wild bird swoops down to ground level for the fight", swoop.battle && landed);
await page.evaluate(() => DEBUG.game.battle?.end("fled"));
const flewOff = await gwait(() => window.__sky.air === true, 6);
ok("...and takes wing again when you run", flewOff);
await page.evaluate(() => { window.__sky = null; });

// the Pokédex tells you where to look
const dexHab = await page.evaluate(() => {
  const ui = DEBUG.game.ui;
  ui.openDex();
  ui.dexDetail(PDEX[16], true);
  const txt = document.getElementById("dexdetail").textContent;
  ui.closeAll();
  return txt;
});
ok("Pokédex lists the habitat", dexHab.includes("Lives:"), dexHab.slice(0, 60));

// ---------- 16h. battle-mechanics regressions (v10) ----------
// a MISSED ball in classic must hand the enemy a free swing, then return the
// turn — it used to leave the battle stuck on "busy" forever
const miss1 = await page.evaluate(async () => {
  DEBUG.style("classic");
  DEBUG.give("pokeball", 10);
  DEBUG.battle(19, 3);
  await new Promise((r) => setTimeout(r, 250));
  const b = DEBUG.game.battle;
  if (!b) return { fail: "no battle" };
  window.__b = b;
  const v = DEBUG.game.launchVelocity().multiplyScalar(0); v.set(-6, 9, -6);
  DEBUG.game.launchBall(v, false, null);        // deliberate miss
  return { phase: b.turnPhase, thrown: DEBUG.game.thrown.length };
});
ok("classic: a thrown ball spends your turn", miss1.phase === "busy" && miss1.thrown === 1, JSON.stringify(miss1));
const ballGone = await gwait(() => DEBUG.game.thrown.length === 0, 10);
const turnBack = await gwait(() => window.__b.turnPhase === "player", 10);
ok("classic: a MISSED ball still resolves the round (no soft-lock)", ballGone && turnBack, JSON.stringify({ ballGone, turnBack }));

// bag and switch are sealed while the round resolves
const turnGate = await page.evaluate(() => {
  const g = DEBUG.game, b = window.__b;
  DEBUG.give("potion", 3);
  b.allyMon.pp = b.allyMon.moves.map((id) => PD.MOVES[id].pp);   // fresh PP after a long suite
  b.allyMon.hp = Math.max(1, Math.floor(b.allyMon.maxhp / 2));
  b.classicMove(0);                              // round starts resolving
  const n0 = g.state.items.potion;
  const denied = g.useItem("potion", 0, true) === false && g.state.items.potion === n0;
  b.doSwitch(1);                                 // silently refused
  return { denied, busy: b.turnPhase === "busy" };
});
ok("classic: bag + switch wait for your turn (no free-turn stacking)", turnGate.denied && turnGate.busy, JSON.stringify(turnGate));
const turnBack2 = await gwait(() => window.__b.turnPhase === "player" || !DEBUG.game.battle, 12);
ok("classic: the gated round still hands the turn back", turnBack2);
await page.evaluate(() => { DEBUG.game.battle?.end("fled"); window.__b = null; });

// a burrowed/phased dodge can't be caught mid-vanish
const phased = await page.evaluate(() => {
  const g = DEBUG.game;
  const w = DEBUG.spawn(50, 8);                  // Diglett
  w.phasedT = 2;
  const before = g.thrown.length;
  g.quickThrowAt(w);
  return { habitat: w.habitat, thrown: g.thrown.length > before };
});
ok("phased (burrowed) wilds exist and balls can still be thrown at the spot", phased.thrown, JSON.stringify(phased));
await page.evaluate(() => { DEBUG.game.thrown.length = 0; DEBUG.game.wilds.forEach((w) => w.phasedT > 0 && w.fadeOut()); });

// ---------- 17. story & modern Kanto (v9) ----------
const story = await page.evaluate(() => {
  const g = DEBUG.game;
  return {
    name: g.state.name, rival: g.state.rival,
    champName: g.trainers.find((t) => t.def.champion)?.def.name,
    civs: g.civs.length,
    civPhones: g.civs.filter((c) => c.group.userData.phone).length,
    hudName: document.getElementById("tlevel").textContent,
    base: g.rivalBaseId(),
    r1: g.rivalDefFor(1).party, r2: g.rivalDefFor(2).party,
    playT: g.state.playT,
  };
});
ok("player + rival names live in the save", story.name === "Red" && story.rival === "Gary", JSON.stringify({ n: story.name, r: story.rival }));
ok("the Champion IS your named rival", story.champName === "Champion Gary", story.champName);
ok("HUD title carries your name", story.hudName.includes("Red"), story.hudName);
ok("townsfolk staff every town (a few doomscroll)", story.civs >= 18 && story.civPhones > 0 && story.civPhones < story.civs, `civs=${story.civs} phones=${story.civPhones}`);
ok("playtime clock is ticking", story.playT > 0, `playT=${story.playT?.toFixed(1)}s`);
// rival runs the counter-starter line (we picked Charmander -> his Squirtle line)
ok("rival's team grows along the counter-starter line",
  story.base === 7 && story.r1.includes(8) && story.r2.includes(9),
  JSON.stringify({ base: story.base, r1: story.r1, r2: story.r2 }));
// every dialog box knows the cast
const tok = await page.evaluate(() => {
  const ui = DEBUG.game.ui;
  ui.dialog("{rival}", ["Hey {player}! Watch this!"]);
  const got = { name: document.getElementById("dlgname").textContent, text: document.getElementById("dlgtext").textContent };
  ui.endDialog(null);
  return got;
});
ok("dialogs replace {player}/{rival} tokens", tok.name === "Gary" && tok.text === "Hey Red! Watch this!", JSON.stringify(tok));
// PokéGram: posts render, and the bottom is a lie
const gram = await page.evaluate(() => {
  const ui = DEBUG.game.ui;
  ui.openGram();
  const feed = document.getElementById("gramfeed");
  return { before: feed.childElementCount, open: !document.getElementById("m-gram").classList.contains("hidden") };
});
// scroll-event dispatch can lag far behind on a loaded headless main thread —
// keep nudging the scroll position and poll for the refill instead of one-shotting
let gramRefilled = false;
try {
  await page.waitForFunction((n) => {
    const feed = document.getElementById("gramfeed");
    feed.scrollTop = feed.scrollHeight;
    return feed.childElementCount > n;
  }, gram.before, { timeout: 10000, polling: 250 });
  gramRefilled = true;
} catch { /* stayed at the "bottom" */ }
const gramAfter = await page.evaluate(() => {
  const n = document.getElementById("gramfeed").childElementCount;
  DEBUG.game.ui.closeAll();
  return n;
});
ok("PokéGram opens with a feed of posts", gram.open && gram.before >= 8, JSON.stringify(gram));
ok("doomscrolling never ends (feed refills at the bottom)", gramRefilled, `${gram.before} -> ${gramAfter}`);
await shot("17-pokegram");

// ---------- 18. save/load ----------
const sav = await page.evaluate(() => { DEBUG.game.save(); return JSON.parse(localStorage.getItem("kanto_adventure_save_v1")); });
ok("save persists (v5, party, all 8 badges, happiness)", !!sav && sav.v === 5 && sav.party.length >= 2 && sav.badges.length === 8 && sav.party.every((m) => typeof m.hap === "number"),
  `v=${sav?.v} party=${sav?.party?.length} badges=${sav?.badges?.length}`);
ok("save carries the story (names + playtime)", sav.name === "Red" && sav.rival === "Gary" && sav.playT > 0, `name=${sav?.name} rival=${sav?.rival}`);
await page.reload({ waitUntil: "load" });
await page.waitForFunction(() => typeof window.DEBUG !== "undefined", null, { timeout: 15000 });
await sleep(1500);
// the reload lands on the title screen; File 1 should advertise the run
const cont = await page.evaluate(() => {
  const shown = !document.getElementById("title").classList.contains("hidden");
  const card = document.querySelector("#slots .slotcard")?.textContent || "";
  DEBUG.enter();
  return { shown, card, hidden: document.getElementById("title").classList.contains("hidden") };
});
ok("reload lands on the title; File 1 shows the trainer; Continue resumes",
  cont.shown && cont.card.includes("Red") && cont.card.includes("8") && cont.hidden, cont.card.slice(0, 80));
const reloaded = await page.evaluate(() => {
  const g = DEBUG.game;
  return { started: g.state.started, party: g.state.party.length, sp: g.state.party[0].sp, ivs: !!g.state.party[0].ivs, gateOpen: !g.world.caveGateBox, name: g.state.name };
});
ok("reload restores save (evolved mon, DVs, open gate)", reloaded.started && reloaded.party >= 2 && reloaded.sp === 5 && reloaded.ivs && reloaded.gateOpen && reloaded.name === "Red", JSON.stringify(reloaded));

ok("no console/page errors during run", errors.length === 0, errors.slice(0, 5).join(" | ") || "clean");

console.log("\n===== SUMMARY =====");
const fails = results.filter((r) => !r.pass);
console.log(`${results.length - fails.length}/${results.length} passed`);
if (fails.length) { console.log("FAILURES:"); fails.forEach((f) => console.log(" -", f.name, "—", f.detail)); }

await browser.close();
process.exit(fails.length ? 1 : 0);
