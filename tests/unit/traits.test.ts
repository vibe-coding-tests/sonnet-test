import { describe, it, expect } from "vitest";
import {
  habitatFor,
  speciesSkill,
  floatsOverWater,
  battleSpeedFor,
  expFactorFor,
  SKILL_LABEL,
} from "../../src/game";
import { DEX } from "../../src/data.js";

const ALL = Array.from({ length: 151 }, (_, i) => i + 1);
const baseSpe = (sp: number): number => DEX[sp].base.spe;

describe("habitatFor", () => {
  it("honors the hand-picked overrides", () => {
    // Doduo / Dodrio: famous flightless birds -> walk the ground
    expect(habitatFor(84)).toBe("ground");
    expect(habitatFor(85)).toBe("ground");
    // Zubat / Golbat: hunt on the wing
    expect(habitatFor(41)).toBe("sky");
    expect(habitatFor(42)).toBe("sky");
  });

  it("puts sea-dwellers and fish in the water", () => {
    expect(habitatFor(72)).toBe("water");  // Tentacool (habitat: sea)
    expect(habitatFor(129)).toBe("water"); // Magikarp
  });

  it("returns a valid habitat for every species", () => {
    const valid = new Set(["sky", "tree", "water", "grass", "ground"]);
    for (const sp of ALL) expect(valid.has(habitatFor(sp))).toBe(true);
  });
});

describe("speciesSkill", () => {
  it("classifies signature evasion maneuvers", () => {
    expect(speciesSkill(63)).toBe("teleport");  // Abra
    expect(speciesSkill(150)).toBe("teleport");  // Mewtwo
    expect(speciesSkill(92)).toBe("blink");      // Gastly (ghost)
    expect(speciesSkill(50)).toBe("burrow");     // Diglett
    expect(speciesSkill(143)).toBe("brace");     // Snorlax (heavy)
  });

  it("only returns labels present in SKILL_LABEL", () => {
    for (const sp of ALL) {
      const skill = speciesSkill(sp);
      expect(SKILL_LABEL).toHaveProperty(skill);
    }
  });
});

describe("floatsOverWater", () => {
  it("is true for fliers and false for grounded types", () => {
    expect(floatsOverWater(16)).toBe(true);  // Pidgey (flying)
    expect(floatsOverWater(4)).toBe(false);  // Charmander
  });
});

describe("battleSpeedFor", () => {
  it("clamps the result into the [0.9, 9.5] range", () => {
    for (const sp of ALL) {
      for (const lv of [5, 50, 100]) {
        const v = battleSpeedFor(sp, lv, baseSpe(sp));
        expect(v).toBeGreaterThanOrEqual(0.9);
        expect(v).toBeLessThanOrEqual(9.5);
      }
    }
  });

  it("speeds up an aquatic species when it is in the water", () => {
    // Squirtle (water type, low speed -> well clear of the clamp ceiling)
    const land = battleSpeedFor(7, 20, 50, {});
    const water = battleSpeedFor(7, 20, 50, { water: true });
    expect(water).toBeGreaterThan(land);
  });

  it("a fish flops slowly on land and rules the water", () => {
    // Magikarp (129): pure fish archetype
    const land = battleSpeedFor(129, 20, baseSpe(129), {});
    const water = battleSpeedFor(129, 20, baseSpe(129), { water: true });
    expect(water).toBeGreaterThan(land);
  });

  it("a flier glides over water instead of wading", () => {
    // Non-aquatic flier crossing water keeps its pace; a grounded land-walker
    // does not (it wades at 0.45x), so the flier ends up faster on the water.
    const flier = battleSpeedFor(16, 20, baseSpe(16), { water: true }); // Pidgey
    const walker = battleSpeedFor(4, 20, baseSpe(4), { water: true });  // Charmander
    expect(flier).toBeGreaterThan(walker);
  });
});

describe("expFactorFor", () => {
  it("ramps a Lv5 rookie at 0 and saturates at 1 by Lv50", () => {
    expect(expFactorFor(5)).toBe(0);
    expect(expFactorFor(50)).toBe(1);
    expect(expFactorFor(100)).toBe(1);
    expect(expFactorFor(27)).toBeCloseTo((27 - 5) / 45, 5);
  });
});
