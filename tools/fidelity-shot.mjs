// Close-up model review probe. Two modes:
//   IDS="7 8 9" node tools/fidelity-shot.mjs        -> one tight row, big
//   node tools/fidelity-shot.mjs                    -> baseline grid, 12/shot
// Output: screenshots/fidelity/*.png
import { chromium } from "playwright-core";
import fs from "fs";

const SHOTS = "/Users/charmac/Documents/pokemon-adventure/screenshots/fidelity";
fs.mkdirSync(SHOTS, { recursive: true });
const BASE = process.env.KANTO_URL || "http://localhost:5190";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--mute-audio", "--window-size=1400,900"],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForFunction(() => typeof window.DEBUG !== "undefined", null, { timeout: 45000 });
await sleep(1800);
await page.evaluate(() => window.DEBUG.newGame("Red", "Blue"));
await page.locator(".startercard").nth(0).click();
await sleep(900);
await page.addStyleTag({ content: "#lockmsg,#tgt,.toastwrap,#hud,#minimap,#crosshair,#compass,.hudbar,#ballbtn{display:none!important}" });
await page.evaluate(() => { DEBUG.tp("safari"); DEBUG.time(0.42); DEBUG.weather("clear"); });
await sleep(400);
// look slightly down so standing mons sit centered in frame
await page.evaluate(() => { const g = DEBUG.game; DEBUG.look(g.playerYaw, -0.14); });
await sleep(200);

const single = process.env.IDS;
let rows;
if (single) {
  rows = [single.trim().split(/[\s,]+/).map(Number)];
} else {
  rows = [];
  for (let start = 1; start <= 151; start += 12) {
    rows.push(Array.from({ length: Math.min(12, 152 - start) }, (_, i) => start + i));
  }
}

const lv = Number(process.env.LV || 35);

for (let b = 0; b < rows.length; b++) {
  const ids = rows[b];
  await page.evaluate(({ ids, lv, single }) => {
    const g = DEBUG.game;
    for (const w of [...g.wilds]) w.dispose();
    g.wilds.length = 0;
    if (g.follower) g.follower.group.visible = false;
    const dir = g.lookDir();
    const side = { x: -dir.z, y: 0, z: dir.x };
    const perRow = single ? ids.length : 6;
    const baseDist = single ? (ids.length <= 1 ? 4.2 : 5.4) : 6.5;
    const spacing = single ? 3.4 : 3.7;
    ids.forEach((sp, i) => {
      const row = Math.floor(i / perRow), col = i % perRow;
      const n = Math.min(perRow, ids.length - row * perRow);
      const w = DEBUG.spawn(sp, lv);
      const dist = baseDist + row * 5.2;
      const lat = (col - (n - 1) / 2) * spacing;
      w.base.set(
        g.playerPos.x + dir.x * dist + side.x * lat,
        0,
        g.playerPos.z + dir.z * dist + side.z * lat
      );
      w.snapGround();
      w.engaged = true;
      w.lookToward(g.playerPos);
      w.life = 9999;
    });
  }, { ids, lv, single: !!single });
  await sleep(2400);
  const tag = single ? `row-${ids.join("-")}` : `batch-${String(b + 1).padStart(2, "0")}-${ids[0]}-${ids[ids.length - 1]}`;
  await page.screenshot({ path: `${SHOTS}/${tag}.png` });
  console.log(`shot ${tag}`);
}

await browser.close();
console.log("fidelity done ->", SHOTS);
