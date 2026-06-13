import { test, expect, startNewGame, measureClock } from "./fixtures";

// Ported from section 4 ("battle: first strike, PP, Gen 1 XP") of
// tools/e2e-test.mjs. We jump straight into a wild battle via DEBUG.battle in
// Pallet Town (no trainers there) instead of walking into one.
test.describe("wild battle", () => {
  test("first strike, PP cost, and Gen 1 XP + stat-exp on a win", async ({ bootedPage: page }) => {
    await startNewGame(page);
    const factor = await measureClock(page);

    await page.evaluate(() => {
      const g = window.DEBUG.game;
      g.trainers.forEach((t: any) => (t.engaging = true)); // no trainer hijacks
      g.cheat("tp", "pallet");
      g.playerYaw = 0;
      const wb = window.DEBUG.battle(1, 4); // Bulbasaur: calm, won't flee
      wb.life = 99999;
    });
    await page.waitForFunction(() => !!window.DEBUG.game.battle, null, { timeout: 10000 });

    const b0 = await page.evaluate(() => {
      const g = window.DEBUG.game;
      const b = g.battle;
      b.enemy().hp = 1; // one Scratch ends it
      window.__hits = 0;
      const orig = b.resolveHit.bind(b);
      // transparent pass-through — forward ALL args (incl. opts.idx). PP is now
      // charged on a clean connect inside resolveHit, so dropping opts here
      // would silently stop PP from being spent.
      b.resolveHit = (...args: any[]) => { if (args[0] === "ally") window.__hits!++; return orig(...args); };
      return {
        enemy: window.PDEX[b.enemy().sp].name,
        lockAlly: b.lock.ally,
        lockEnemy: b.lock.enemy,
        pp0: b.allyMon.pp[0],
        xpBefore: g.state.party[0].xp,
      };
    });

    expect(b0.enemy).toBe("Bulbasaur");
    // player gets the first move: the enemy is locked out longer
    expect(b0.lockEnemy).toBeGreaterThan(b0.lockAlly + 0.5);

    // spam Q (move slot 1) until the battle resolves. Cap the budget so a stalled
    // headless render loop fails fast instead of hanging the whole test slot.
    const deadline = Date.now() + Math.min(45000, Math.max(15000, (25 / factor) * 1000));
    let info: any = null;
    while (Date.now() < deadline) {
      await page.keyboard.press("q");
      await page.waitForTimeout(200);
      info = await page.evaluate(() => {
        const g = window.DEBUG.game;
        return {
          inBattle: !!g.battle,
          hits: window.__hits,
          pp0: g.state.party[0].pp[0],
          xp: g.state.party[0].xp,
          sexpHp: g.state.party[0].sexp.hp,
        };
      });
      if (!info.inBattle) break;
    }

    expect(info.hits, "ally moves resolved hits").toBeGreaterThan(0);
    expect(info.pp0, "Scratch PP consumed").toBeLessThan(35);
    expect(info.inBattle, "battle ended").toBe(false);
    expect(info.xp, "XP gained").toBeGreaterThan(b0.xpBefore);
    expect(info.sexpHp, "stat-exp from Bulbasaur (base HP 45)").toBe(45);
  });

  test("dodge command triggers a dodge attempt against a telegraphed hit", async ({ bootedPage: page }) => {
    await startNewGame(page);
    await page.evaluate(() => {
      const g = window.DEBUG.game;
      g.trainers.forEach((t: any) => (t.engaging = true));
      g.cheat("tp", "pallet");
      const wb = window.DEBUG.battle(1, 4);
      wb.life = 99999;
    });
    await page.waitForFunction(() => !!window.DEBUG.game.battle, null, { timeout: 10000 });
    const dodge = await page.evaluate(() => {
      const g = window.DEBUG.game;
      const b = g.battle;
      b.incoming = { t: 0.4, max: 0.5 };   // telegraphed attack on the way
      g.state.party[0].spe = 999;          // guarantee the dodge roll
      b.tryDodge();
      const res = { dodging: b.dodging, cd: b.dodgeCd };
      b.end("fled");
      return res;
    });
    expect(dodge.cd).toBeGreaterThan(0);
  });
});
