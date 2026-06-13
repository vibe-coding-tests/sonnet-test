import { test as base, expect, type Page } from "@playwright/test";

// Shared e2e plumbing. The old tools/e2e-test.mjs played the whole game in one
// long session; here every spec boots a fresh game and then uses window.DEBUG
// to jump straight to the state under test, so specs stay small and parallel.

declare global {
  interface Window {
    DEBUG: any;
    PD: any;          // src/data.js module
    PDEX: Record<number, any>; // species id -> pokedex entry
    WS: number;       // world MAP_SCALE
    __hits?: number;
  }
}

// Boot to the DEBUG-ready title screen with a cleared save and the data module
// stashed on window (PD/PDEX/WS), mirroring the old harness bootstrap.
// Clearing happens in an init script so it runs before any app code, avoiding a
// flaky second page load. The sessionStorage guard means it only fires on the
// first navigation of the context, so a spec that reloads (e.g. save.spec) keeps
// the save it just wrote.
async function boot(page: Page) {
  await page.addInitScript(() => {
    try {
      if (!sessionStorage.getItem("__e2e_cleared")) {
        localStorage.clear();
        sessionStorage.setItem("__e2e_cleared", "1");
      }
    } catch { /* private mode */ }
  });
  await page.goto("/", { waitUntil: "load" });
  await page.waitForFunction(() => typeof window.DEBUG !== "undefined", null, { timeout: 30000 });
  await page.evaluate(async () => {
    const d = await import("/src/data.js");
    window.PD = d;
    window.PDEX = {};
    d.POKEDEX.forEach((p: any) => (window.PDEX[p.id] = p));
    window.WS = (await import("/src/world.ts")).MAP_SCALE;
  });
}

// Fast lane past the title + starter modal into the live world.
export async function startNewGame(
  page: Page,
  opts: { name?: string; rival?: string; starter?: number } = {},
) {
  const { name = "Red", rival = "Gary", starter = 4 } = opts; // Charmander
  const started = await page.evaluate(({ name, rival, starter }) => {
    window.DEBUG.newGame(name, rival);
    // close the starter modal the way the card click does, otherwise
    // ui.modalOpen stays true and later actions (e.g. startWildBattle) bail out
    window.DEBUG.game.ui.hide("m-starter");
    window.DEBUG.game.chooseStarter(starter);
    return window.DEBUG.game.state.started === true;
  }, { name, rival, starter });
  if (!started) throw new Error("startNewGame: game did not start");
}

// Headless SwiftShader renders slowly and clamps dt, so the in-game clock can
// run several times slower than wall time. Measure the ratio so timed waits can
// be scaled. Returns a factor (game-seconds elapsed per real second).
export async function measureClock(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const w = window.DEBUG.game.world;
    const a = w.uTime.value, t = performance.now();
    await new Promise((r) => setTimeout(r, 1000));
    return Math.max(0.02, (w.uTime.value - a) / ((performance.now() - t) / 1000));
  });
}

// Poll a browser-side predicate with a timeout scaled to the game clock.
export async function gwait(
  page: Page,
  pred: () => boolean,
  gameSecBudget: number,
  factor: number,
): Promise<boolean> {
  const timeout = Math.max(6000, (gameSecBudget / factor) * 1000 + 4000);
  try {
    await page.waitForFunction(pred, null, { timeout, polling: 200 });
    return true;
  } catch {
    return false;
  }
}

// Every spec gets a freshly-booted page via this fixture.
export const test = base.extend<{ bootedPage: Page }>({
  bootedPage: async ({ page }, use) => {
    await boot(page);
    await use(page);
  },
});

export { expect };
