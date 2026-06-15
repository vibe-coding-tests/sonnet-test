# Kanto Adventure

A first-person Pokémon adventure in the browser: roam a **full-scale Kanto
laid out like the real Gen 1 map** — all ten towns from Pallet to Cinnabar,
with real distance between them and a Bicycle (and eventually a truck) to
cross it — with your **Pokémon walking ahead of you in view**, catch all
151 Pokémon with **physical, aimable Poké Ball throws** (slow-mo aim mode,
critical catches), fight wild Pokémon and trainers in real time — or press
**T** and **become your Pokémon**: move it yourself, aim its attacks like
an FPS, and dodge for real by not being where the hit lands. Watch moves
**scorch, crater and frost the terrain**, fish the lakes, weather the
storms, foil **Team Rocket**, earn the **Bike Voucher** and ride the
Bicycle, earn all **eight gym badges** and climb Victory Road to the
**Champion fight at the Indigo Plateau**. Authentic Gen 1 underneath: real
stats, DVs, Stat Exp, moves, PP, catch rates, growth curves, the type
chart — and opponents who **start out dim and wise up as you collect
badges**.

The story opens the way it always has — a **title screen with three save
files**, then **Professor Oak's monologue**, naming yourself and his
grandson, choosing your starter, and getting jumped by your **rival in the
lab**. It's Pokémon through and through; *modern* means the way it looks
and plays — filmic lighting, glassy HUD, FPS controls — not the writing.
The modern world only peeks in around the edges: town squares are full of
**strolling townsfolk** trading route gossip (and one local per region who
never looks up from their PokéGear), your rival ambushes you at 2 and 5
badges along the counter-starter line and waits at the Indigo Plateau as
**Champion under the name you gave him**, and buried in the pause menu is
**PokéGram** — an infinite parody feed that occasionally begs you to go
touch the tall grass.

Every Pokémon in the world is a **custom procedural 3D model** — all 151
species are assembled at runtime from low-poly primitives (no model files,
fully offline) and **animated procedurally**: walk gaits, wing flaps,
slithering, hovering, squash-and-stretch hops, flickering tail flames,
breathing and blinks. The classic sprites now appear only in the 2D UI
(party, Pokédex, boxes).

Built with **Vite + TypeScript + Three.js**.

## Run it

```bash
npm install
npm run dev
```

`npm run dev` **opens the game in your browser automatically** (Vite's
`--open`); if nothing pops, it's at **http://localhost:5173**.

Setting up on a Windows PC from scratch? See
[README-WINDOWS.md](README-WINDOWS.md).

- `npm run build` / `npm run preview` — production build (outputs `dist/`)
- `npm run typecheck` — TypeScript check
- `npm test` — fast **unit** suite ([Vitest](https://vitest.dev), runs in Node in
  ~1s): pure game logic — stats/XP/evolution, type math, habitat/skill/speed
  traits, spawn-table integrity, save helpers. `npm run test:watch` to watch.
- `npm run test:e2e` — **browser** suite ([Playwright](https://playwright.dev)):
  parallel per-system specs (world, battle, save, smoke) that boot the live Vite
  app and jump straight to the state under test via the in-game `DEBUG` API. It
  auto-starts a dev server, so no manual setup. Needs Chrome installed.
- `npm run test:all` — both layers (unit, then e2e).
- `npm run test:legacy` — the original single-session smoke script
  (`tools/e2e-test.mjs`, ~100 checks; needs Chrome + a running dev server, point
  it elsewhere with `KANTO_URL=http://localhost:PORT`). Being migrated spec by
  spec into `tests/e2e/`.

The two layers form a test pyramid: most checks live in the fast Node unit layer
(`tests/unit/`), and the browser layer (`tests/e2e/`) covers rendering, input,
UI, and 3D that genuinely need a real browser. See `tests/` for the pattern when
adding more.

> **Fully offline.** The 3D Pokémon are generated procedurally (no model
> files at all), the classic sprites used by the 2D UI are bundled in
> `public/sprites/`, and Three.js comes from `node_modules` — once
> `npm install` has run, no internet connection is needed to play.

## Controls

One hand on **WASD**, the other on the **mouse** — every battle key sits
within reach of that home position. **Overworld:**

| Input | Action |
|---|---|
| **WASD** | move · **Mouse** look (click once to capture the pointer) |
| **Shift** | run · **Space** jump |
| **Tap click / G** | quick-throw the equipped Ball at your target |
| **Hold click** | **aim mode**: time slows, a trajectory arc appears; release to throw, right-click to cancel |
| **Mouse wheel** | cycle Poké / Great / Ultra Ball |
| **F** | start a battle with the targeted Pokémon |
| **E** | interact (trainers, Nurse Joy, PC, shop, berry bushes, fishing, petting your partner...) |
| **Z** | quick-heal your lead Pokémon |
| **V** | mount / dismount your ride (Bicycle, and later... a truck) |
| **L** | flashlight (caves get *dark*) |
| **Tab** | Pokédex · **P** party · **I** bag · **Esc** pause (PokéGram and cheats live here) |

**In battle** the same hands stay put — moves on the left, aim on the right:

| Input | Action |
|---|---|
| **Q / E / R / F** | your four moves — in real-time styles **all four run independent cooldowns** (no shared lockout); **plant your feet to fire true, and PP only burns on a clean hit** |
| **1–6** | **switch Pokémon instantly** — each key is a party slot (the HUD strip numbers them) |
| **Space** | **dodge** — as the trainer, a Speed-based sidestep when the enemy telegraphs; possessed, your species' **signature dodge** (Blink, Burrow, Swoop, Brace...) |
| **G** | throw the equipped **Poké Ball** (wild battles) |
| **Z** | **quick-heal**: the best-fit healing item in the bag |
| **X** | run from wild battles |
| **T** | **take over / step out** of your Pokémon *(First-Person style)* |
| **Tab** | switch via menu · **Esc** pause · **I** bag |
| **Click** | *(possessed)* repeat your last move |

## The region

The overworld follows the **original Red/Blue/Yellow town map** at full
adventure scale — a 1.2 km × 1.2 km Kanto where Routes earn their numbers,
walking is for routes and the Bike and truck are for crossing the map:

- **West column** — Pallet Town, north past Viridian City (Earth Gym) and
  Viridian Forest up to Pewter City (Boulder Gym).
- **Northern ridge** — Route 3/4 tunnels through **Mt. Moon** to Cerulean City
  (Cascade Gym); **Nugget Bridge** crosses the river to Bill's sea cottage;
  the sealed **Cerulean Cave** broods across the water.
- **Center** — Saffron City (Marsh Gym, Silph Co.) ringed by Routes 5/6/7/8,
  with Celadon City (Rainbow Gym, Department Store, Game Corner) to the west
  and Vermilion City (Thunder Gym, the S.S. Anne — and a certain truck) on
  the bay to the south.
- **East** — Lavender Town and its Pokémon Tower; **Rock Tunnel** above it,
  the **Power Plant** (Zapdos) across the river, and the Route 12/13 causeway
  running down the coast.
- **South** — **Cycling Road** drops from Celadon to Fuchsia City (Soul Gym)
  and the **Safari Zone**; sea Routes 19/20/21 link the **Seafoam Islands**
  (Articuno) and **Cinnabar Island** (Volcano Gym, the Mansion) back to
  Pallet.
- **Northwest** — Route 23 and **Victory Road** (Moltres) climb to the
  **Indigo Plateau**, where the Champion waits.

All 8 gyms gate like the real thing: wild levels rise with distance from
Pallet, Cerulean Cave needs every badge, and the corner minimap mirrors the
classic town-map silhouette.

## What's in the game

- **The faithful opening.** Boot to a **title screen** that orbits Pallet
  Town while you pick one of **three save files** (trainer name, badges,
  Pokédex count and playtime on each card — delete and start over
  RBY-style). New games run the real intro: Oak's *"Welcome to the world of
  POKÉMON!"* speech beside a showcase Nidorino, **you name yourself and
  your rival** (presets or free text), and after you take your starter and
  your Pokédex, your rival grabs the counter-pick and battles you **right
  outside the lab**.
- **A rival worth beating.** He ambushes you again at **two badges** and
  **five badges**, his team growing along the counter-starter line
  (Pidgeotto, Kadabra, his evolving starter...). At the Indigo Plateau he's
  **Champion — under the name you gave him** — and the Hall of Fame records
  the trainer name you chose. Every line of dialogue in Kanto knows both
  names.
- **Towns that live.** Every square has **strolling townsfolk** — they amble
  between spots, arms swinging, stop to watch you pass, and chat (E) proper
  route gossip: gym hints, berry spots, Lavender ghost stories. One local
  per region never looks up from their PokéGear — interrupt them (E) for
  rotating takes (*"TECHNOLOGY is incredible!"*) and watch their screen glow
  in the dark. Wild Pokémon left alone slip into **ambient routines**: they
  graze the meadows, lap at the shoreline, **call out across the fields**,
  and **nap under the moon** — sneak close at night and you'll startle them
  awake.
- **PokéGram (Esc → PokéGram).** A parody feed tucked into the pause menu:
  trainer posts, gym-leader takes, sponsored Silph Co. slop — pull for
  more, it never ends, except every ~13 posts the app develops a conscience
  and shows your **playtime** next to a suggestion to touch grass.
- **Wild Pokémon live where animals live.** Every species spawns into its
  natural element: **birds, bats and winged bugs circle overhead** (look up —
  their shadows track the ground below); **fish, tentacles and water-edge
  swimmers bob in lakes and seas** and dive when spooked; **larvae and
  cocoons perch up in the canopies**, fluttering tree-to-tree (Metapod just
  hardens and stays put); small grassland dwellers rustle around the **tall
  grass clusters**; the rest roam open ground. Skittish fliers climb out of
  reach; aggressive ones (Spearow, Zubat) **swoop down on you**. Start a
  battle and the wild dives to ground level — flee, and the bird beats its
  wings and takes off again. Balls arc true through all of it: you can pick
  a Pidgey clean **out of the sky** (it freezes mid-air, the Ball drops to
  the turf below), and lobs at swimmers skim the surface instead of
  plunking. Only the **legendaries and key Pokémon hold fixed ground**:
  Articuno still circles its Seafoam shrine, Mewtwo still waits in his cave.
  The Pokédex lists each species' habitat ("Lives: on the wing — look up").
- **Your partner walks with you — where you can see it.** It trots ahead-left
  of you in first person, gets sent out from your side when battles start,
  and can be petted (E) to build **happiness** — at max friendship it earns
  +10% XP. Fire/Electric/Ghost partners light up caves and night roads. Pick
  *any* party member ("Walk with me" in the party screen, P) or send it back
  to its Ball; the choice is saved.
- **Opponents learn as you do.** Early-route trainers and wild Pokémon pick
  moves on instinct; with every badge the opposition reads matchups better,
  until gym leaders and the Champion play optimally. Prefer it fixed? Set
  **Opponent AI** (Esc menu) to Novice / Trained / Ace.
- **Custom 3D Pokémon.** Every species is a hand-specced procedural model:
  21 body archetypes (quadruped, biped, bird, serpent, fish, blob, larva,
  cocoon, winged bug, crab, jellyfish, bivalve, golem, plant, magnet, ball,
  starfish, egg cluster, ghost, bat, mole-mound) dressed per species with
  Gen 1 palettes and signature parts — Charmander's tail flame, Squirtle's
  shell, Pikachu's zigzag tail and red cheeks, Arbok's hood, Onix's rock
  chain, Doduo's two heads, Voltorb's Poké Ball shells, Magneton's triple
  magnets, Snorlax's belly. **Evolutions are re-sculpted, not just
  rescaled** — the Bulbasaur line stages its bulb into a full bloom,
  Pidgey/Spearow grow crests and combs, Ninetales fans nine tails, Arcanine
  earns its ruff and stripes, the Nido line sprouts horns and spikes. Each
  rig animates procedurally: leg gaits that speed up with movement, wing
  flaps, slithering, hovering ghosts, flopping Magikarp, breathing, blinking,
  flickering flames, plus a per-move **attack pose** (strike, swipe, shoot,
  beam, stomp, focus) layered over the idle. They turn to face their opponent
  in battle, watch you as you walk by, and the walking partner looks back at
  you when you stop.
- **Battles mark the world.** Fire chars the grass, Ground and Rock crack
  craters, Ice frosts the field, Grass sprouts blooms, big hits rustle
  leaves out of nearby trees, cave ceilings shed debris under heavy quakes —
  and the marks linger before fading. Rain turns flames to steam, storms
  super-charge Electric moves with sky-bolts, and a target standing in water
  takes conducted Electric damage.
- **Earn your ride.** Survive the Vermilion Fan Club Chairman's Rapidash
  stories for a **Bike Voucher**, trade it at the Cerulean **Bike Shop**
  (sticker price: ₽1,000,000) and ride with **V** at double speed —
  handlebars, bell and all. After eight badges, the infamous S.S. Anne
  truck's engine finally turns over.
- **Catching, kept simple.** Balls are physical projectiles with gravity,
  bounces and splashes. Tap to quick-throw at your target; hold to **aim**:
  bullet-time and a trajectory arc, with a clean **aimed-throw bonus** on
  the catch roll and rare **critical catches** that scale with your Pokédex.
  No timing rings, no curveball wrist-work — line it up and let fly.
- **Three battle styles — pick yours in the pause menu (Esc).**
  - **Classic** is the originals: true turn-based rounds. You pick a move
    (or throw, switch, item, run — each spends your turn), priority and Speed
    decide who goes first, poison ticks between rounds, and the opponent
    politely waits while you think. No dodging, no cooldowns, pure RBY.
    A thrown Ball is your whole turn **even if it misses** — the wild gets
    its free swing and play comes straight back to you — and the bag and
    switch menus are sealed while a round is still resolving.
  - **Arena** (default) is the balanced middle: real-time with per-move cooldowns,
    watched from over your Pokémon's shoulder. Move with **WASD** — but
    **plant your feet to fire true; shooting on the run sprays wide** (the HUD
    calls your aim STEADY / WAVERING / WILD). Enemies telegraph attacks (red
    bar): hit **Space** to dodge — success depends on Speed, and a clean dodge
    opens a counter window. Duck behind trees and rocks for cover, shove foes
    into hazards, and **PP only burns on a clean hit**. Honest numbers.
  - **First-Person** is the high-skill mode: every battle starts
    INSIDE your Pokémon, and the damage swings both ways with how well you play.
- **First-Person style — BE your Pokémon.** The camera dives into your
  partner's eyes and the battle becomes a first-person action fight with a
  **higher ceiling and a lower floor**:
  - **You move it yourself** — WASD + mouse, with speed that comes from its
    real Speed stat and body plan. Pikachu zips, Snorlax lumbers, Magikarp
    flops helplessly on land but rules the water, and birds, ghosts and
    levitators glide straight over deep water.
  - **Aim is the accuracy — and the damage.** Ranged moves are real
    projectiles fired down your crosshair: a centered shot from a **planted
    stance** lands a **"Clean hit!"** bonus (up to ~1.35×), grazes land soft,
    misses land nothing — and **a miss costs no PP**; it only ever burns on a
    clean connect. Firing while you sprint throws the shot wide, so pick your
    moment: dodge, plant, fire. Cover is real — trees, rocks and walls block
    shots, and an enemy bolt a tree eats for you opens a counter window.
  - **Contact is timing.** Gap-closing strikes whiff if the target slips out
    of reach ("TOO FAR" warns you first, nothing is spent on a hopeless
    swing). Strike INTO a telegraphed wind-up and you **interrupt** the
    attack entirely for bonus damage — but a whiffed swing leaves you
    **Exposed**, and the enemy's next hit lands ~1.3× harder.
  - **Your footwork is your defense.** Incoming hits run hot (~1.2×) by
    default — standing still is how you lose. Keep moving for a discount,
    dash *through* an attack for a **graze** (less than half damage), or
    sidestep entirely and take zero while the counter bell rings. Sleep and
    paralysis still bite: a sleeping body won't answer the controls.
  - **Species fight like themselves.** Space triggers your species'
    **signature dodge**: ghosts **Blink** through space, Abra's line
    **Teleports**, moles and rock bodies **Burrow** under attacks, birds
    **Swoop**, sea creatures **Dive** beneath the surface, heavies like
    Snorlax don't dodge at all — they **Brace** and soak it — and darty
    little things like Pikachu get rapid-fire dashes. The enemy uses the
    same arsenal against you.
  - **Moves duel mid-air.** Opposing projectiles that meet resolve like
    types do: **Water Gun douses Ember**, beams and bolts punch through
    lesser shots, Gust and Surf shove attacks off course, and near-even
    trades detonate between you. Lobbed gunk (Sludge, Acid, Bubble) leaves
    **hazard pools** that slow and sting anyone standing in them, and
    **Earthquake** rolls out as a ground shockwave — time a dash (or be
    airborne, burrowed, levitating) and it passes right under you.
  - **The terrain fights too.** A Fire shot that misses into dry brush leaves
    a **burning patch**, Ice over water freezes a **slick**, and a heavy,
    super-effective or critical blow **knocks the target back** — ride a foe
    into a hazard or off into deep water and the ground collects the bonus.
  - **Experience is real.** A Lv50 veteran winds up faster, leads your
    movement when it shoots, groups its shots tighter, reacts to incoming
    fire sooner, picks smarter moves, and pushes in the moment you commit
    to an attack. Early-route hatchlings do none of this. The badge/IQ ramp
    (and the AI menu setting) stacks on top.
  - **Temperament shows.** The enemy nameplate carries a temper chip —
    *aggressive* species rush in close, *skittish* ones keep their distance
    and dodge more, *calm* ones hold their ground.
  - **No menu clunk.** Hold-click to aim a Ball and you flow back into the
    trainer's hands mid-motion; open the bag or switch and the same happens —
    then you dive straight back into your Pokémon after. T steps out
    deliberately whenever you'd rather call commands from the sidelines.
- **Terrain and weather still shape everything**: water boosts Water moves,
  rain weakens Fire and lets Thunder never miss, fog drops accuracy, caves
  empower Rock/Ground, electricity conducts through the pool your target is
  standing in...
- **Weather + caves.** Dynamic clear/rain/storm/fog with rain audio, thunder
  and lightning flashes. Caves are genuinely dark — stalactites, glowing
  mushrooms, dripping water, bats — bring the flashlight (L).
- **Fishing.** Face open water, cast the Old Rod (E), wait for the **"!"** and
  hook it for a water battle: Magikarp, Poliwag, Goldeen, Tentacool, Horsea,
  Slowpoke, Psyduck... zone-dependent.
- **Team Rocket.** Once you hold a badge, Jessie & James ambush you on the
  routes ("Prepare for trouble..."). Beat them and they blast off again —
  they always drop a **Nugget**.
- **The Champion.** With all eight badges, face the Champion — **your
  rival, wearing the name you gave him in Oak's lab** — at the Indigo
  Plateau. His team scales to yours and his ace counters your starter. Win
  for the fanfare, the confetti and your **Hall of Fame** entry (signed
  with your trainer name) — then the rematches scale up.
- **New items**: Oran Berries (pick them from roadside bushes), Repel, Lure,
  Escape Rope, Nugget.
- **All the Gen 1 core** from before: DVs + Stat Exp feeding the real stat
  formula, four growth curves, 165 moves with PP (spent only on a clean hit
  in real-time styles; Struggle when dry), Gen 1 crit rates, first-strike
  battle openings, authentic encounter tables per
  zone, roaming legendaries (Articuno, Zapdos, Moltres, Mewtwo, Mew), the
  Gen 1 catch and payout formulas, all eight gym badges, and Cerulean Cave
  sealed until you hold every one of them.

## Cheats

Open **Esc → Open Cheats…**: God Mode, One-Hit KO, 100% Catch, Infinite PP,
Speed Boost, +money/Balls/items, Rare Candies, instant badges, full Pokédex
"seen", day/night, **weather control**, **summon Team Rocket**, max happiness,
**teleport to any landmark**, and **spawn any Pokémon by name at any level**.
Everything is also scriptable from the console via `DEBUG.*` (e.g.
`DEBUG.weather("storm")`, `DEBUG.rocket()`, `DEBUG.spawn(150, 70)`).

## How to play

1. Pick a **save file**, sit through Oak's intro (worth it), name yourself
   and your rival, then pick **Bulbasaur, Charmander or Squirtle** — and
   beat your rival's counter-pick outside the lab. You start with 5 Poké
   Balls and ₽600 — and your starter at your heels.
2. Weaken wilds in battle (F) before throwing; or skip the fight and trust
   your aim — a held, aimed throw catches well above its weight. Skittish
   species flee, aggressive ones charge you. Feeling brave?
   Switch the **battle style** (Esc) to **First-Person** and fight as the
   Pokémon yourself — or to **Classic** for pure RBY turns.
3. Heal free at any **Pokémon Center** (sets your respawn), stock up at the
   **PokéMart**, pick berries on the routes, and pet your partner. Better
   Balls unlock as your Trainer Level rises.
4. Take the gyms in the classic order — **Brock, Misty, Lt. Surge, Erika,
   Koga, Sabrina, Blaine, Giovanni**. All eight badges unseal Cerulean Cave,
   and the **Champion** waits past Victory Road at the Indigo Plateau.

Progress auto-saves to `localStorage` every few seconds; old saves migrate
forward automatically (pre-story saves keep their progress and simply skip
the rival beats they've outgrown — slot 1 keeps the legacy storage key).

## Project layout

```
index.html        UI markup + styles (Vite entry)
src/main.ts       boot, first-person controller, input (aim/throw), game loop
src/world.ts      Kanto terrain, towns, caves, water, weather, day/night, berries, minimap
src/game.ts       stats/XP/PP, habitat spawning/AI (sky, water, trees, tall
                  grass), the three battle styles (classic turns / arena
                  real-time / first-person possession), spatial combat
                  (projectile duels, hazards, species skills, veteran AI),
                  catching 2.0, follower, fishing, Team Rocket, the story
                  (Oak intro, rival arc, save slots, civilians), Champion,
                  items, cheats, save

src/monmodel.ts   procedural 3D models + animators for all 151 species
src/fx.ts         particle engine, move animations, aim arc, celebrations
src/ui.ts         HUD, Pokédex, bag, party, PC, shop, dialogs, Hall of Fame, cheats
src/audio.ts      synthesized WebAudio SFX, species cries, rain/thunder, ambience
src/data.js       GENERATED Gen 1 data (151 Pokémon, 165 moves, PP, growth, types)
src/data.d.ts     hand-written types for the generated data
public/sprites/   all 302 official sprites — used by the 2D UI only
tools/generate_data.py   regenerates src/data.js (needs internet)
tests/unit/              Vitest unit specs for pure game logic (Node, fast)
tests/e2e/               Playwright browser specs (parallel, boot via DEBUG API)
tools/e2e-test.mjs       legacy single-session smoke test (~100 checks)
tools/offline-probe.mjs  proves the game runs with all external requests blocked
tools/gallery-shot.mjs   screenshots every 3D model in batches for review
tools/fidelity-shot.mjs  side-by-side evolution-line shots (checks each stage
                         reads as a distinct creature, not a rescale)
tools/possess-shot.mjs   possession-mode diagnostic (take over, move, fire, eject)
tools/story-shot.mjs     walks the real intro path (title → Oak → naming →
                         lab battle → townsfolk → PokéGram) with screenshots
tools/habitat-shot.mjs   habitat showcase (birds aloft, swimmers, canopy
                         perchers, the swoop-down battle, mid-air catches)
tools/battle-stress.mjs  battle-mechanics stress probe (all three styles:
                         missed-ball turns, menu gating, trainer fights,
                         forced switches — fails on any stuck state)
screenshots/      captured by the e2e test
```
