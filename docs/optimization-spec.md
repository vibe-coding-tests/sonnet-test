# Performance and testing optimization

Status: draft / proposed. Nothing here is built yet.

This spec covers two tracks that pay off independently: making the game run
faster and smoother on more hardware, and making the test suite fast, reliable,
and broad enough to trust. Each item lists the file, the lines that matter
today, the problem, and the fix. They ship in any order unless noted.

## Where things stand

The game is a single-file-per-system Three.js app driven by one
`requestAnimationFrame` loop in `src/main.ts` (~261-355). That loop steps the
world, the active battle, the FX pool, audio, the camera rig, and renders, once
per vsync with a variable timestep capped at 50ms. The heavy systems are
`src/game.ts` (5037 lines: battle plus entity management), `src/world.ts` (2026
lines: terrain, towns, weather, wildlife), `src/monmodel.ts` (1810 lines:
procedural rigs), and `src/fx.ts` (1202 lines: particles and combat VFX).

Tests split into fast Vitest unit tests in `tests/unit` (stats, types, spawns,
traits, save helpers, ~44 cases in Node) and Playwright e2e in `tests/e2e`
(smoke, world, battle, save) that boot the real app under SwiftShader software
GL. A larger legacy runner, `tools/e2e-test.mjs`, still holds ~121 checks that
the Playwright suite has not absorbed yet.

The foundation is solid. World foliage already uses `InstancedMesh`, particles
already use a single pooled `Points` draw, and colliders already use a spatial
hash. The work below extends those good patterns into the places that still
allocate per frame or scan everything every frame.

---

# Part A: Performance

## A1. Cache the terrain height field (highest CPU win)

`World.height(wx, wz)` (world.ts ~362-466) runs the full terrain model on every
call: multi-octave value noise, four mountain massifs, a dozen `carve` corridor
passes, river and causeway segment loops, town plateau loops, and a building-pad
loop. There is no cache. It is called from player movement, every wild's ground
snap, every projectile substep, ball physics, and camera placement, many times
per frame.

Fix: bake a coarse height grid once at world build (for example a 256x256 or
512x512 float array spanning the playable bounds) and read it with bilinear
interpolation. Keep the full analytic `height()` for the rare exact query.
Sample once, reuse everywhere. This is the single largest CPU lever in the
codebase because so many systems lean on it each frame.

## A2. Quality tiers for the renderer, shadows, and terrain mesh

Defaults are tuned for a desktop showcase and stay expensive on weaker hardware:

- `src/main.ts` ~13-17: `antialias: true`, `PCFSoftShadowMap`, pixel ratio up to
  2.
- `src/world.ts` ~592-634: terrain is a single `PlaneGeometry(size, size, 400,
  400)`, roughly 320k triangles, with per-vertex color baked in a build loop.
- A 2048x2048 directional shadow map with a wide cast list (trees, rocks,
  buildings, props all `castShadow`).

Fix: add a `quality` setting (`high` / `medium` / `low`) read once at boot.
Medium drops the shadow map to 1024 and terrain segments to ~200; low disables
MSAA, pins pixel ratio to 1, switches to `BasicShadowMap` or no shadows, and
restricts `castShadow` to hero and NPC meshes. Bake static terrain and tree
shadows so the live shadow pass only covers movers. This is the largest GPU
lever and the main thing standing between the game and low-end machines.

## A3. Stop allocating inside the per-frame loops

Several hot paths allocate new objects every frame, which feeds the garbage
collector and causes periodic hitches. Each fix is small and local.

| Where | Lines | Allocation | Fix |
|---|---|---|---|
| `world.update` day/night | world.ts ~1950-1997 | rebuilds sky/fog/sun/hemi color arrays, `new THREE.Color` ~30x, sun-dir and grey-lerp vectors each frame | hoist gradient tables to module scope; reuse module-level scratch `Color`/`Vector3` |
| `MonEntity.pos()/feet()/eye()` | game.ts ~484-486 | every call clones a `Vector3` | add `posInto(out)` and expose `.base`; clone only when a caller stores the result |
| battle camera rig | main.ts ~296-308, 346 | `toEnemy.clone()`, side-offset `new Vector3`, look-offset `new Vector3`, lamp `getWorldDirection(new Vector3())` | reuse module scratch vectors next to the existing `battleCamPos`/`battleCamLook` |
| aim arc preview | game.ts ~4072-4081 | clones up to ~56 `Vector3` per frame while aiming | reuse a fixed `Vector3[64]` pool |
| UI overlay | ui.ts ~269-296 | `project()` clones, HP bars do `ent.pos().add(new Vector3(...))` per bar | reuse one projection scratch vector |

Pattern to adopt across the board: declare scratch `Vector3`/`Color` at module
scope, write into them with `.copy()` / `.set()`, and reserve `new` and
`.clone()` for values that outlive the frame.

## A4. Skip idle particle work and pool combat VFX

The particle update (fx.ts ~174-194) loops all 3000 slots every frame and sets
`needsUpdate = true` on all four attribute buffers even when nothing is active,
so an idle scene still uploads four full buffers per frame. `frustumCulled` is
off (line 153).

Fix: track the active-slot count (or a high-water index) and skip the loop and
the buffer uploads when it is zero. Upload only up to the active range.

Combat VFX still allocate per effect: `burst()` makes two `THREE.Color` per call
(~224-225), and `basic()` / `ringAt()` / `chunks()` / `beamBetween()` /
`boltBetween` each build fresh materials, meshes, or geometry per spawn (~261,
269-341), disposed later in `kill()`. During a busy fight this is a steady
allocate-and-dispose churn.

Fix: pool ring/beam/chunk meshes and key materials by color and type; parse hex
colors once into reusable module `Color`s; share one bolt geometry template.

## A5. Tier and broad-phase the entity updates

Several systems do a full scan or full simulation every frame even for things
far away or off screen.

- **Wild Pokémon** (game.ts ~755-912, 4875): up to ~27 wilds each run full AI,
  a `world.height` probe, rig animation, and shadow update every frame until
  they despawn at 95m. Fix: tier by distance (near updates every frame, mid
  every few frames, far freezes AI and animation), and share material templates
  per species palette instead of unique materials per mesh (monmodel.ts
  ~1782-1791).
- **Projectile duels** (game.ts ~1994-2035): `resolveDuels()` is O(n^2) over
  active shots every frame, and the hit test calls `tgt.pos()` which clones
  (~2056). Fix: use squared distance into a reused vector and cap pair checks;
  pool projectile sprites and materials rather than `new SpriteMaterial` per
  shot (fx.ts ~263-267).
- **Targeting raycast** (game.ts ~4898-4899, 3979-4004): builds a `new Raycaster`
  and `new Vector2` each tick and loops all wilds. Fix: reuse the raycaster and
  keep an in-frustum candidate list.
- **`treesNear`** (world.ts ~507-513) and **box `collide`** (world.ts
  ~1848-1867) scan their full arrays. Fix: extend the existing cylinder spatial
  hash (`cylGrid`, ~1868-1883) to trees and collider boxes.

## A6. Dispose what you remove

A few removal paths drop objects from the scene without freeing GPU resources,
which leaks memory over a long session.

- `MonEntity.setSpecies` (game.ts ~503-513) replaces `this.shadow.geometry`
  without disposing the old `CircleGeometry`.
- `TrainerNPC.dispose` (game.ts ~1045) removes the group but skips the
  geometries, materials, and text-sprite textures from `buildPerson`.

Fix: dispose before replacing, and traverse-and-dispose on teardown the way
`BattleArena.dispose` (~1313-1321) already does. A shared shadow geometry and
material (one instance, per-entity scale only) removes the per-entity shadow
allocation entirely.

### Performance build order

1. Terrain height cache (A1). Biggest CPU win, touches one method.
2. Per-frame allocation cleanup (A3) and idle particle skip (A4). Cheap, removes
   GC hitches.
3. Quality tiers (A2). Biggest GPU win, opens up low-end hardware.
4. Entity tiering and broad-phase (A5).
5. Disposal fixes (A6).

---

# Part B: Testing

## B1. Extract combat math into a pure module (highest testing win)

The entire battle system lives in a private, non-exported `Battle` class in
game.ts (~1325 onward). None of it is unit-tested. The only checks are Playwright
specs that boot WebGL and call methods on a live `Battle`, plus the legacy
runner. The math underneath is deterministic and has no reason to need a browser:

- Gen 1 damage with crit, STAB, type, and the 217-255 roll (game.ts ~2881-2901).
- Stat-stage multipliers (`STAGE_MULT`, ~84).
- Elemental reactions and aura lookup (`resolveReaction` / `auraFor`,
  ~2769-2809).
- Environment multiplier from terrain and weather (`envMult`, ~2712-2738).
- Catch probability (~4275-4276).
- Weighted spawn selection (~3941-3945).
- Move role and energy cost/gain classifiers (~1507-1521).

Fix: move these into `src/combat.ts` as side-effect-free functions that take
plain inputs and an injected RNG, then have `Battle` call them. Unit-test them
with table cases in Vitest, which run in Node in milliseconds. `Battle` stays as
orchestration: it wires entities, FX, audio, and UI, and those stay in e2e. This
shrinks the slow SwiftShader battle runs down to the things that genuinely need a
browser (possession, projectiles, the AI brain, rendering).

## B2. Add a seedable RNG hook

Combat randomness runs through module-level helpers in game.ts (~54-56):

```ts
const rnd = (a = 1, b = 0) => b + Math.random() * (a - b);
const irnd = (a, b) => Math.floor(rnd(b, a + 0.999));
const choice = (arr) => arr[Math.floor(Math.random() * arr.length)];
```

There is no way to seed these, so the Playwright battle specs save and restore
`Math.random` by hand (battle.spec.ts ~121-131, 150-155) and the legacy runner
does the same (~912-923). That is fragile and easy to leak between tests.

Fix: route `rnd` / `irnd` / `choice` through one swappable source and expose
`DEBUG.seed(n)` (and a matching `setRng(fn)` export for unit tests). World layout
already uses local LCG seeds, so the pattern exists; this gives combat the same
reproducibility. Once combat math lives in `src/combat.ts` (B1), the unit tests
pass the RNG in directly and never touch globals.

## B3. Speed up and stabilize the e2e suite

The cost of the Playwright suite is browser boot under SwiftShader, not battle
animation: the new battle specs already call `resolveHit` synchronously inside
`page.evaluate()` rather than waiting on real-time loops. Each spec runs the
full `bootedPage` fixture (fixtures.ts ~89-94), so the bill is roughly one full
WebGL boot per spec.

- **Share a context for evaluate-only specs.** Battle specs that only call game
  methods synchronously can run under one `describe.serial` with a shared page,
  cutting repeated boots.
- **Lower the timeout for synchronous specs.** The global 90s ceiling
  (playwright.config.ts ~24) lets a hung evaluate-only test block for 90s. A 30s
  override fits those.
- **Add a clean start seam.** Tests manually hide `m-starter` (fixtures.ts
  ~51-54) or actions bail. A one-shot `DEBUG.startGame(starter)` removes that
  coupling and the associated race.
- **Delete the dead fixture helpers.** `measureClock` and `gwait` (fixtures.ts
  ~63-86) are copied from the legacy runner and unused by any Playwright spec.
  Remove them so nobody maintains dead code, or wire them into the specs that
  actually need real-time waits.

## B4. Retire the legacy runner once parity is reached

`tools/e2e-test.mjs` is a single monolithic browser session with ~121 checks and
the project's only coverage of catching, fishing, shops, gyms, possession
combat, rigs, and vehicles. It is also the flakiest path: it leans on `gwait`
clock-scaled polling 25+ times and inline `sleep` calls, and headless game time
can run 5-15x off wall time under SwiftShader.

Fix: port the unmigrated checks into focused Playwright specs (or unit tests
where the logic is pure, for example traits are already covered faster in
`tests/unit/traits.test.ts`), then drop `tools/e2e-test.mjs` and the
`playwright-core` dependency it relies on. Track the remaining gap as a
migration checklist so it is clear when legacy can go.

## B5. Add coverage reporting and a CI workflow

There is no coverage reporter and no CI config in the repo, so coverage gaps are
invisible and the suite may not run automatically.

Fix: add `@vitest/coverage-v8` with a threshold on the new `src/combat.ts`, and a
GitHub Action that runs `npm run test:all` on push and PR. Add `--shard` to the
Playwright command so CI can split the e2e run across jobs.

### Testing build order

1. Extract `src/combat.ts` (B1) and seed the RNG (B2). This unlocks fast,
   deterministic tests for the largest untested surface.
2. E2e speed and stability passes (B3).
3. Coverage and CI (B5).
4. Legacy migration and retirement (B4), tracked as a running checklist.

---

## Out of scope

- A full rewrite of the render pipeline (deferred rendering, post-processing
  stack). The quality-tier approach (A2) reaches more hardware with far less
  risk.
- A Web Worker for game logic. The single-loop design is fine once the per-frame
  allocations and full scans are gone; revisit only if a profile still shows main
  thread saturation.
- Visual regression / screenshot testing. Worth considering after the combat
  logic is unit-tested and the e2e suite is lean.
