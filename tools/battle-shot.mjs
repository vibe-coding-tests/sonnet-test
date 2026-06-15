// Probe: 3D rigs in battle (facing), follower walking, capture shrink.
import { chromium } from "playwright-core";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const SHOTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../screenshots");
fs.mkdirSync(SHOTS, { recursive: true });
const BASE = process.env.KANTO_URL || "http://localhost:5176";

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--mute-audio", "--window-size=1280,800"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await page.goto(BASE, { waitUntil: "load" });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "load" });
await page.waitForFunction(() => typeof window.DEBUG !== "undefined", null, { timeout: 15000 });
await sleep(2000);
await page.evaluate(() => window.DEBUG.newGame("Red", "Blue"));   // past the title screen
await page.locator(".startercard").nth(1).click(); // Charmander
await sleep(800);
await page.addStyleTag({ content: "#lockmsg{display:none!important}" });

// 1) follower walking shot
await page.evaluate(() => {
  DEBUG.tp("safari");
  DEBUG.time(0.35);
  DEBUG.weather("clear");
});
await sleep(2500);
await page.screenshot({ path: `${SHOTS}/3d-follower.png` });
console.log("follower shot");

// 2) battle: charmander vs spawned squirtle-line wild
await page.evaluate(() => { DEBUG.battle(7, 8); });
await sleep(3000);
await page.screenshot({ path: `${SHOTS}/3d-battle.png` });
const facing = await page.evaluate(() => {
  const b = DEBUG.game.battle;
  if (!b) return { ok: false };
  const a = b.allyEnt, e = b.enemyEnt;
  const wantA = Math.atan2(e.base.x - a.base.x, e.base.z - a.base.z);
  const dA = Math.abs(((a.faceYaw - wantA + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
  return { ok: true, allyFaceErr: +dA.toFixed(2), levA: a.rig.levitates, matsA: a.rig.mats.length, matsE: e.rig.mats.length };
});
console.log("battle facing:", JSON.stringify(facing));

// 3) fire move env effect + hit flash
await page.evaluate(() => {
  const b = DEBUG.game.battle;
  if (b) b.useMove("ally", 0);
});
await sleep(1200);
await page.screenshot({ path: `${SHOTS}/3d-battle-move.png` });
console.log("move shot");

await browser.close();
console.log("done");
