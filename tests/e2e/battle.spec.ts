import { test, expect, startNewGame } from "./fixtures";

// Ported from section 4 ("battle: first strike, PP, Gen 1 XP") of
// tools/e2e-test.mjs. We jump straight into a wild battle via DEBUG.battle in
// Pallet Town (no trainers there) instead of walking into one.
test.describe("wild battle", () => {
  test("first strike, PP cost, and Gen 1 XP + stat-exp on a win", async ({ bootedPage: page }) => {
    await startNewGame(page);

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

    const info = await page.evaluate(() => {
      const g = window.DEBUG.game;
      const b = g.battle;
      b.resolveHit("ally", window.PD.MOVES[b.allyMon.moves[0]], { idx: 0 });
      return {
        inBattle: !!g.battle,
        hits: window.__hits,
        pp0: g.state.party[0].pp[0],
        xp: g.state.party[0].xp,
        sexpHp: g.state.party[0].sexp.hp,
      };
    });

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
      window.DEBUG.style("arena");
      g.trainers.forEach((t: any) => (t.engaging = true));
      g.cheat("tp", "pallet");
      const wb = window.DEBUG.battle(1, 4);
      wb.life = 99999;
    });
    const dodge = await page.evaluate(() => {
      const g = window.DEBUG.game;
      const b = g.battle;
      b.incoming = { t: 0.4, max: 0.5 };   // telegraphed attack on the way
      g.state.party[0].spe = 999;          // guarantee the dodge roll
      window.DEBUG.stamina("ally", 100);
      const staminaBefore = b.stamina.ally;
      b.tryDodge();
      const res = { cooldown: Math.max(b.dodgeCd, b.dashCd), staminaBefore, staminaAfter: b.stamina.ally };
      b.end("fled");
      return res;
    });
    expect(dodge.cooldown).toBeGreaterThan(0);
    expect(dodge.staminaAfter).toBeLessThan(dodge.staminaBefore);
  });

  test("arena combat grants bonus Pokemon XP over classic", async ({ bootedPage: page }) => {
    await startNewGame(page);
    const gains = await page.evaluate(() => {
      const g = window.DEBUG.game;
      g.trainers.forEach((t: any) => (t.engaging = true));
      g.cheat("tp", "pallet");
      const oldRand = Math.random;
      Math.random = () => 0.5;
      const defeat = (style: "classic" | "arena") => {
        window.DEBUG.style(style);
        const before = g.state.party[0].xp;
        const wb = window.DEBUG.battle(1, 4);
        wb.life = 99999;
        const b = g.battle;
        b.enemy().hp = 1;
        b.resolveHit("ally", window.PD.MOVES[b.allyMon.moves[0]], { idx: 0 });
        return g.state.party[0].xp - before;
      };
      const classic = defeat("classic");
      g.healParty();
      const arena = defeat("arena");
      Math.random = oldRand;
      return { classic, arena };
    });
    expect(gains.classic).toBeGreaterThan(0);
    expect(gains.arena).toBeGreaterThan(gains.classic);
  });

  test("real-time hits build energy for both sides", async ({ bootedPage: page }) => {
    await startNewGame(page);
    const energy = await page.evaluate(() => {
      const g = window.DEBUG.game;
      window.DEBUG.style("arena");
      g.trainers.forEach((t: any) => (t.engaging = true));
      g.cheat("tp", "pallet");
      const wb = window.DEBUG.battle(1, 8);
      wb.life = 99999;
      const b = g.battle;
      window.DEBUG.energy("ally", 0);
      window.DEBUG.energy("enemy", 0);
      b.resolveHit("ally", window.PD.MOVES[10], { idx: 0 }); // Scratch
      const res = { ally: b.energy.ally, enemy: b.energy.enemy };
      b.end("fled");
      return res;
    });
    expect(energy.ally).toBeGreaterThan(0);
    expect(energy.enemy).toBeGreaterThan(0);
  });

  test("wet aura detonates with electric damage", async ({ bootedPage: page }) => {
    await startNewGame(page);
    const dmg = await page.evaluate(() => {
      const g = window.DEBUG.game;
      window.DEBUG.style("arena");
      g.trainers.forEach((t: any) => (t.engaging = true));
      g.cheat("tp", "pallet");
      const wb = window.DEBUG.battle(7, 18); // Squirtle: electric is readable
      wb.life = 99999;
      const b = g.battle;
      const move = window.PD.MOVES[84]; // Thunder Shock
      const oldRand = Math.random;
      Math.random = () => 0.5;
      const start = b.enemy().maxhp;
      b.enemy().hp = start;
      b.resolveHit("ally", move);
      const base = start - b.enemy().hp;
      b.enemy().hp = start;
      b.conds.enemy.aura = { type: "wet", t: 4, moveType: "water" };
      b.resolveHit("ally", move);
      const reacted = start - b.enemy().hp;
      Math.random = oldRand;
      b.end("fled");
      return { base, reacted };
    });
    expect(dmg.reacted).toBeGreaterThan(dmg.base);
  });

  test("direct low-accuracy hits graze instead of applying aura payoff", async ({ bootedPage: page }) => {
    await startNewGame(page);
    const graze = await page.evaluate(() => {
      const g = window.DEBUG.game;
      window.DEBUG.style("arena");
      g.trainers.forEach((t: any) => (t.engaging = true));
      g.cheat("tp", "pallet");
      const wb = window.DEBUG.battle(1, 12);
      wb.life = 99999;
      const b = g.battle;
      const move = window.PD.MOVES[126]; // Fire Blast
      b.possessInput.x = 1; // moving hard: poor aim quality
      const oldRand = Math.random;
      Math.random = () => 0.99;
      const start = b.enemy().hp;
      b.resolveHit("ally", move, { direct: true });
      const res = { damaged: b.enemy().hp < start, aura: b.conds.enemy.aura || null };
      Math.random = oldRand;
      b.end("fled");
      return res;
    });
    expect(graze.damaged).toBe(true);
    expect(graze.aura).toBeNull();
  });
});
