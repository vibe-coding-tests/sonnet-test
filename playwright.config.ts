import { defineConfig, devices } from "@playwright/test";

// The game renders with WebGL via Three.js, so the e2e specs need a real GPU
// path. We use the system Chrome channel with SwiftShader (software GL) and the
// same flags the old tools/e2e-test.mjs relied on. Each spec boots the app and
// jumps straight to the state under test via window.DEBUG, so they parallelize
// cleanly across workers instead of replaying the whole game in one session.
// Dedicated port for the e2e suite. We deliberately avoid Vite's default 5173
// (which a manual `npm run dev` — or another project entirely — may occupy with
// a different app) so the suite always boots and tests THIS game.
const PORT = Number(process.env.KANTO_PORT || 5319);
const BASE_URL = process.env.KANTO_URL || `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // SwiftShader software-GL is CPU-heavy and each spec runs a full render loop;
  // too many parallel browsers starve the game clock and time out real-time
  // waits. Cap at 3 locally (2 on CI) for a stable speed/parallelism balance.
  workers: process.env.CI ? 2 : 3,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chrome",
      use: {
        ...devices["Desktop Chrome"],
        channel: "chrome",
        viewport: { width: 1280, height: 800 },
        launchOptions: {
          args: [
            "--use-angle=swiftshader",
            "--enable-unsafe-swiftshader",
            "--mute-audio",
          ],
        },
      },
    },
  ],
  // Auto-start (and reuse) the Vite dev server. Single process (no shell chain)
  // so Playwright can tear it down cleanly. Vite scans index.html on startup and
  // pre-bundles Three.js before serving, so specs don't trigger a mid-session
  // reload. No --open: stays headless.
  // Run Vite's binary directly (not via `npx`) so Playwright's teardown signal
  // reaches the actual server process — an `npx` wrapper would survive and hang
  // the run on exit.
  webServer: {
    command: `node node_modules/vite/bin/vite.js --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { KANTO_E2E: "1" },
  },
});
