// Visual probe for the v9 story flow: title screen -> Oak intro -> naming ->
// starter -> Pokédex handoff -> rival lab battle. Walks the REAL human path
// (no DEBUG.newGame fast lane) and screenshots each beat.
import { chromium } from "playwright-core";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const SHOTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../screenshots");
fs.mkdirSync(SHOTS, { recursive: true });
const URL = process.env.KANTO_URL || "http://localhost:5178";

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--mute-audio", "--window-size=1280,800"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("pageerror", (e) => console.log("PAGE ERROR:", e.message));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png` });

await page.goto(URL, { waitUntil: "load" });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "load" });
await page.waitForFunction(() => typeof window.DEBUG !== "undefined", null, { timeout: 15000 });
await sleep(3500);   // let the attract orbit settle + world load

console.log("title:", await page.evaluate(() => ({
  shown: !document.getElementById("title").classList.contains("hidden"),
  slots: document.querySelectorAll("#slots .slotcard").length,
})));
await shot("story-1-title");

// New Game on File 1 -> Oak's monologue over the showcase orbit
await page.locator("#slots .slotcard button").first().click();
await sleep(1200);
console.log("intro:", await page.evaluate(() => ({
  dlg: document.getElementById("dlgtext").textContent,
  orbiting: !!DEBUG.game.introCam,
  showcase: !!DEBUG.game.showcase,
})));
await shot("story-2-oak");

// advance Oak until the name modal appears
const advanceUntil = async (selVisible, max = 14) => {
  for (let i = 0; i < max; i++) {
    const done = await page.evaluate((sel) => !document.getElementById(sel).classList.contains("hidden"), selVisible);
    if (done) return true;
    await page.evaluate(() => DEBUG.game.ui.dialogAdvance());
    await sleep(220);
  }
  return false;
};
console.log("name modal reached:", await advanceUntil("m-name"));
await shot("story-3-name");
await page.fill("#nameinput", "ASH");
await page.click("#nameok");
await sleep(400);

// rival naming: use a preset chip
console.log("rival modal reached:", await advanceUntil("m-name"));
await page.locator("#namepresets button").first().click();   // BLUE
await sleep(400);

// remaining Oak lines -> starter table
console.log("starter reached:", await advanceUntil("m-starter"));
console.log("names:", await page.evaluate(() => ({ n: DEBUG.game.state.name, r: DEBUG.game.state.rival })));
await page.locator(".startercard").nth(1).click();   // Charmander
await sleep(900);

// Pokédex handoff dialog -> rival bursts in -> lab battle
for (let i = 0; i < 10; i++) { await page.evaluate(() => DEBUG.game.ui.dialogAdvance()); await sleep(250); }
await sleep(1500);
for (let i = 0; i < 6; i++) { await page.evaluate(() => DEBUG.game.ui.dialogAdvance()); await sleep(250); }
await sleep(2500);
const lab = await page.evaluate(() => ({
  battle: !!DEBUG.game.battle,
  vs: DEBUG.game.battle?.trainer?.def?.name || null,
  enemy: DEBUG.game.battle?.enemyMon?.sp ?? null,
  rival1: DEBUG.game.state.story.rival1,
}));
console.log("lab battle:", lab);
await shot("story-4-labbattle");

// civilians: warp to a town square and meet the locals (one's on their phone)
await page.evaluate(() => { DEBUG.game.battle?.end("fled"); });
await sleep(600);
await page.evaluate(() => {
  const g = DEBUG.game;
  const c = g.civs.find((x) => x.phone) || g.civs[2];
  g.playerPos.set(c.pos.x + 1.5, c.pos.y, c.pos.z + 1.5);
  DEBUG.look(Math.atan2(c.pos.x - g.playerPos.x, c.pos.z - g.playerPos.z) + Math.PI, -0.05);
  g.world.timeOfDay = 0.7;                   // night: the one glowing screen stands out
});
await sleep(800);
console.log("civ interact:", await page.evaluate(() => DEBUG.game.nearestInteract()?.label || null));
await shot("story-5-townsfolk");

// PokéGram feed
await page.evaluate(() => DEBUG.game.ui.openGram());
await sleep(700);
await shot("story-6-pokegram");

await browser.close();
console.log("story probe done");
