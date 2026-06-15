// Visual gallery probe: spawns every species in batches in front of the
// camera and screenshots them, so the procedural 3D models can be reviewed.
import { chromium } from "playwright-core";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const SHOTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../screenshots/gallery");
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
await page.locator(".startercard").nth(0).click();
await sleep(800);
await page.addStyleTag({ content: "#lockmsg,#tgt,.toastwrap{display:none!important}" });
await page.evaluate(() => { DEBUG.tp("safari"); });
await sleep(400);

// batches of species ids
const batches = [];
for (let start = 1; start <= 151; start += 20) {
  batches.push(Array.from({ length: Math.min(20, 152 - start) }, (_, i) => start + i));
}

for (let b = 0; b < batches.length; b++) {
  const ids = batches[b];
  await page.evaluate((ids) => {
    const g = DEBUG.game;
    DEBUG.time(0.35);
    DEBUG.weather("clear");
    // clear previous wilds
    for (const w of [...g.wilds]) { w.dispose(); }
    g.wilds.length = 0;
    if (g.follower) { g.follower.group.visible = false; }
    const dir = g.lookDir();
    const side = { x: -dir.z, y: 0, z: dir.x };
    ids.forEach((sp, i) => {
      const row = Math.floor(i / 7), col = i % 7;
      const w = DEBUG.spawn(sp, 20);
      const dist = 8 + row * 6;
      const lat = (col - 3) * 4.4;
      w.base.set(
        g.playerPos.x + dir.x * dist + side.x * lat,
        0,
        g.playerPos.z + dir.z * dist + side.z * lat
      );
      w.snapGround();
      w.engaged = true;        // hold still for the photo
      w.lookToward(g.playerPos);
      w.life = 9999;
    });
  }, ids);
  await sleep(2600); // let them settle/turn + animations run
  await page.screenshot({ path: `${SHOTS}/batch-${String(b + 1).padStart(2, "0")}-${ids[0]}-${ids[ids.length - 1]}.png` });
  console.log(`shot batch ${b + 1}: ${ids[0]}-${ids[ids.length - 1]}`);
}

await browser.close();
console.log("gallery done ->", SHOTS);
