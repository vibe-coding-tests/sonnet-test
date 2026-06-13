# Real-time combat identity for Arena + First-Person

Status: draft / proposed. Nothing here is built yet.

This spec adds a real-time combat layer to the two custom battle styles so a
fight becomes "manage a short rotation, spend resources well, and trigger
reactions" instead of "fire whichever move is off cooldown and most
super-effective." It keeps the existing projectile duels, species dodges,
terrain hazards, and knockback game intact.

## Scope guardrails

These hold for every item below.

- All new logic gates behind `this.style !== "classic"` (the existing `rt`
  flag in `Battle.update`). Classic keeps its turn cadence, its per-turn DoT,
  and its untouched Gen 1 damage path.
- The party stays 1v1. Switching (`1-6`) keeps today's behavior. Team-swap
  combat is out of scope, and the design avoids choices that would block
  adding it later.

## Where the system stands today

Two real-time styles share one `Battle` class in `src/game.ts`:

- **Arena** — over-the-shoulder. WASD drives your Pokémon, the camera locks to
  the axis between you and the foe, shots auto-aim with lead. Skill shows up as
  aim steadiness: plant to fire true, move and shots spray.
- **First-Person** — possession. The camera dives into your Pokémon's eyes. You
  aim down a crosshair, dodge by physically moving, and time melee into enemy
  wind-ups for interrupts.

Both share: four moves on `Q/E/R/F` with independent cooldowns, PP that burns
only on a clean connect, projectile-vs-projectile duels mid-air, lingering
hazards, species-flavored dodges (Blink, Burrow, Swoop), knockback into
terrain, and a veteran-scaling enemy brain. That foundation stays. Everything
below builds on it.

## Problems this spec addresses

1. **Cooldowns derive from power, so every move plays the same.** `cdFor`
   (game.ts ~1494-1505) computes cooldown straight from `move.power`. A 40-power
   and a 120-power move sit ~1.5s apart, and the action lock between any two
   moves is 0.15s. Four near-interchangeable normals, no rotation.
2. **No resource economy.** No energy, stamina, or burst charge anywhere. PP is
   the only resource and dodges are gated by a flat cooldown. The two tense
   action-combat decisions ("can I afford to dodge again?", "spend my burst
   now or wait?") don't exist.
3. **Accuracy barely matters.** Spatial hits resolve as `direct`, which skips
   the accuracy roll (game.ts ~2693). Fire Blast (85 acc) feels as reliable as
   a 100-acc move.
4. **No elemental reactions.** Types interact only mid-air (`resolveDuels`) and
   in the environment (electric through water). Nothing happens on the target.
5. **Status runs on a flat wall clock.** DoT ticks every 2.5s; sleep/freeze run
   2.5-4.5s of raw seconds with no diminishing returns. Brutal in a 10-15s
   fight.
6. **Enemy can't sequence.** `chooseEnemyMoveIdx` scores each move greedily and
   fires the best one. No setup-then-payoff, no burst timing.
7. **Balance is scattered magic numbers** with "kept gentle for now" comments.

---

## 1. One tuning table (build first)

Add a single `BALANCE` constant beside the existing knobs (game.ts ~1203-1206)
and route every magic number through it.

```ts
const BALANCE = {
  enemyDmg: 0.68, enemyPace: 0.6,
  energy: { max: 100, basicGain: 14, skillGain: 22, onHitTaken: 6, burstCost: 100 },
  stamina: { max: 100, dodgeCost: 34, sprintDrain: 18, regen: 26, regenDelay: 0.6 },
  accuracy: { grazeMult: 0.5 },        // a "missed" real-time hit grazes, not whiffs
  status: { dotTick: 1.5, sleep: [1.6, 2.4], freeze: 1.8, reapplyLockout: 4 },
  reactions: { conduct: 1.8, melt: 1.6, steam: 0.0, bloom: 1.4 },
};
```

Payoff: tuning feel becomes editing one block.

## 2. Move tiers and authored cooldowns

Give the four slots distinct roles. Add data fields plus a fallback classifier
so unauthored moves still work.

- **Data** (`src/data.d.ts` `Move` + per-move overrides in
  `tools/generate_data.py` near the `fx.kind` table ~line 188): add
  `role?: "basic" | "skill" | "burst"`, optional authored `cd`, and
  `energyGain` / `energyCost`.
- **Fallback classifier** in `cdFor` (replacing the power formula): basic if
  `power <= 40` and not status, burst if `power >= 120` or `tags.recharge`,
  else skill. Authored values win.
- **Cooldown shape:** basic ~0.6-1.0s, skill ~4-8s. Burst has no flat
  cooldown; energy gates it (section 3).

Highest-leverage change. A rotation emerges on its own: weave basics, land the
skill on cooldown, hold the burst for a window.

## 3. Energy meter and bursts

Add `this.energy = { ally: 0, enemy: 0 }`, capped at `BALANCE.energy.max`.

- Basic/skill hits add energy in `resolveHit` (near the PP spend ~line 2806).
  Taking a hit adds a little too, so a losing fight still builds toward a
  turnaround.
- A burst move checks `energy >= burstCost` in `useMove` (the cooldown/lock
  gate ~2553-2592). If short, show a "Not enough energy" floater like the
  existing "No PP left." On use it spends the meter and takes its own action
  lock instead of a flat cooldown.
- Energy lives on the battler side, so a forced switch resets it cleanly (same
  place stages/cooldowns reset in `doSwitch` ~3051-3054).

## 4. Stamina for dodge and dash

Add `this.stamina = { ally: 100, enemy: 100 }` and replace the flat dodge gate.

- `possessDash` (~1677) and the arena branch of `tryDodge` (~1509) spend
  `dodgeCost` and require enough stamina instead of only checking the cooldown.
- Regenerates in `update` after `regenDelay`; sprint in `updateDirectControl`
  (~1658) drains it.
- Fast species regen faster (scale by `m.spe`). `brace`-type heavies lean on
  soak, so stamina pressure pushes them toward their identity.

Keep all species dodge flavor (Blink, Burrow, Swoop). Only the gate changes
from "cooldown" to "cooldown + stamina."

## 5. Elemental reactions (the core hook)

Layer a thin reaction system on top of the `conds` already tracked.

**Auras.** On a damaging hit, the move's type applies a short-lived aura to the
target (`c.aura = { type, t }`, ~4s). Fire writes Burning, Water writes Wet,
Electric writes Charged, Ice writes Chill. Reuse existing condition particles.

**Reactions.** When a new element lands on an aura, resolve one reaction in
`resolveHit` before damage, clear the aura, and show a floater. Starter set of
four, each reusing systems already present:

| Aura | + Element | Reaction | Effect | Reuses |
|---|---|---|---|---|
| Wet | Electric | Conduct | bonus burst | water conduction in `envMult` ~2636-2639, bolt FX |
| Chill / Freeze | Fire | Melt | bonus damage + immediate thaw | freeze status |
| Burning | Water | Steam | cancels fire, small chip, douse FX | rain-steam burst in `envImpact` ~2657 |
| Grass-seed | Fire | Bloom | flare of bonus DoT | existing `seed` condition |

Multipliers come from `BALANCE.reactions`. Four reactions keeps the grammar
learnable. This makes element choice and move order matter on a single target.

## 6. Accuracy that matters (graze band)

Let direct spatial hits roll accuracy (the block ~2693 currently skips them),
but soften the failure: a "miss" downgrades to a **graze**, not a whiff.

- Graze deals `grazeMult` damage, applies no secondary effect, no status, and
  triggers no reaction. It still spends PP because it connected.
- Feed the existing aim quality into the roll: a planted, centered shot with a
  low-accuracy move mostly lands; run-and-gun spraying with Fire Blast grazes
  often. Fog and the Thunder-in-rain rule route through the same path.

Accuracy becomes real without the bad feel of a hard mid-action whiff.

## 7. Status re-tuned for real-time

Pull durations and cadence from `BALANCE.status` to fit a 10-15s fight: shorter
hard disables (sleep 1.6-2.4s, freeze ~1.8s with a thaw chance), DoT cadence at
1.5s, and a `reapplyLockout` so a second sleep/freeze inside the window is
resisted. The per-tick DoT and `conds` countdown already live in `update`
(~2249-2262) and `applyDot` (~2334); only the constants and the lockout check
change. Classic's per-turn path (`classicEndTurn` ~2409-2422) is untouched.

## 8. Enemy that sequences

Extend `chooseEnemyMoveIdx` (~2475) from "best single move" to a small plan,
all gated by `aiIQ` / `expFactor` so wild hatchlings still flail:

- Open with a status or aura-setter when you're unafflicted.
- **Hold the burst:** fire it only when energy is full and a window is open
  (`punishT` already tracks "player committed to an attack").
- **Detonate reactions:** if you carry an aura the enemy can react to, bias its
  scoring toward the reacting type.

## 9. HUD for the new systems

In `ui.ts updateFrame` (battle block ~297-401):

- Numeric cooldown seconds on the four move buttons (only dodge shows a number
  today, ~333).
- An energy ring and a stamina bar on the active mon.
- A reaction floater (reuse `floatAt`: "Conduct!", "Melt!").
- A directional tick on the incoming telegraph (~392) so you know which way to
  dodge, computed from the enemy's aim direction.

The AIM STEADY/WAVERING/WILD tag and cooldown fill stay.

---

## Build order

Each phase ships and tests on its own.

1. Tuning table (1).
2. Move tiers + authored cooldowns (2) and HUD cooldown numbers (9). Biggest
   feel change, lowest risk.
3. Energy + bursts (3), then stamina (4).
4. Reactions (5) with the four-reaction starter set, plus reaction feedback (9).
5. Accuracy graze (6) and status re-tune (7).
6. AI sequencing (8).

## Testing

Extend `tests/e2e/battle.spec.ts` (it drives battles via `DEBUG.battle` and
spams `Q`):

- energy gain on hits,
- stamina drain on dodge,
- a forced reaction (apply Wet, fire Electric, assert the bonus),
- a graze on a low-accuracy run-and-gun shot.

Add `DEBUG` setters for `energy` / `stamina` so specs can pin state the way they
already pin `enemy().hp`.

## Out of scope (clean future extensions)

Team-swap combat (swap cooldown, on-swap first-hit bonus, cross-mon reaction
detonation) is the natural next step toward a full team loop. The aura/energy
design lives on the battler side, so adding it later won't rework these systems.
