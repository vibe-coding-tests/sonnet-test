import { defineConfig } from "vite";

// The e2e suite (tests/e2e) sets KANTO_E2E=1 so we can turn HMR off: an HMR
// full-reload mid-test would recreate the Game instance and wipe state, flaking
// the run. Pre-bundling Three.js up front avoids the related "new dependencies
// optimized" reload as well. Normal `npm run dev` keeps HMR on.
const E2E = !!process.env.KANTO_E2E;

export default defineConfig({
  base: "./",
  // prefers 5173 but hops to the next free port (other dev servers welcome)
  server: { port: 5173, strictPort: false, hmr: E2E ? false : undefined },
  preview: { port: 4173, strictPort: false },
  build: { outDir: "dist", chunkSizeWarningLimit: 1500 },
  optimizeDeps: { include: ["three"] },
});
