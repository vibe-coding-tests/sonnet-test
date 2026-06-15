import { describe, it, expect } from "vitest";
import { DEX, MOVES, typeMult } from "../../src/data.js";

const ALL_SPECIES = Array.from({ length: 151 }, (_, i) => i + 1);
const VALID_TYPES = new Set([
  "normal", "fire", "water", "grass", "electric", "ice",
  "fighting", "poison", "ground", "flying", "psychic", "bug",
  "rock", "ghost", "dragon", "fairy", "steel",
]);
const VALID_GROWTH = new Set(["fast", "mediumfast", "mediumslow", "slow"]);
const VALID_TEMPERS = new Set(["calm", "skittish", "aggressive"]);
const VALID_CLASSES = new Set(["phys", "spec", "status"]);

describe("DEX integrity — all 151 species", () => {
  it("has exactly 151 entries", () => {
    expect(Object.keys(DEX).length).toBe(151);
  });

  it("every species has required fields with valid types", () => {
    for (const sp of ALL_SPECIES) {
      const e = DEX[sp];
      expect(e, `species ${sp} missing`).toBeTruthy();
      expect(typeof e.name, `${sp}.name`).toBe("string");
      expect(e.name.length, `${sp}.name empty`).toBeGreaterThan(0);
      expect(Array.isArray(e.types), `${sp}.types`).toBe(true);
      expect(e.types.length, `${sp} has no types`).toBeGreaterThanOrEqual(1);
      expect(e.types.length, `${sp} too many types`).toBeLessThanOrEqual(2);
    }
  });

  it("all type references are valid Gen 1 types", () => {
    for (const sp of ALL_SPECIES) {
      for (const t of DEX[sp].types) {
        expect(VALID_TYPES.has(t), `${DEX[sp].name}: unknown type "${t}"`).toBe(true);
      }
    }
  });

  it("base stats are positive integers for all species", () => {
    const stats = ["hp", "atk", "def", "spe", "spc"] as const;
    for (const sp of ALL_SPECIES) {
      const base = DEX[sp].base;
      for (const stat of stats) {
        expect(base[stat], `${DEX[sp].name}.base.${stat}`).toBeGreaterThan(0);
        expect(Number.isInteger(base[stat]), `${DEX[sp].name}.base.${stat} not integer`).toBe(true);
      }
    }
  });

  it("catch rates are in 1..255", () => {
    for (const sp of ALL_SPECIES) {
      expect(DEX[sp].catch, `${DEX[sp].name}.catch`).toBeGreaterThanOrEqual(1);
      expect(DEX[sp].catch, `${DEX[sp].name}.catch`).toBeLessThanOrEqual(255);
    }
  });

  it("growth curves are one of the four valid groups", () => {
    for (const sp of ALL_SPECIES) {
      expect(VALID_GROWTH.has(DEX[sp].growth), `${DEX[sp].name}.growth "${DEX[sp].growth}"`).toBe(true);
    }
  });

  it("learnset entries are [level, move_id] pairs with valid references", () => {
    for (const sp of ALL_SPECIES) {
      for (const [lv, id] of DEX[sp].learnset) {
        expect(lv, `${DEX[sp].name} learnset level`).toBeGreaterThanOrEqual(1);
        expect(lv, `${DEX[sp].name} learnset level`).toBeLessThanOrEqual(100);
        expect(MOVES[id], `${DEX[sp].name} learnset move ${id}`).toBeTruthy();
      }
    }
  });

  it("temper field is a recognized value when present", () => {
    for (const sp of ALL_SPECIES) {
      if (DEX[sp].temper != null) {
        expect(VALID_TEMPERS.has(DEX[sp].temper), `${DEX[sp].name}.temper "${DEX[sp].temper}"`).toBe(true);
      }
    }
  });
});

describe("MOVES table integrity — 165 moves", () => {
  it("has at least 165 entries", () => {
    expect(Object.keys(MOVES).length).toBeGreaterThanOrEqual(165);
  });

  it("every move has a non-empty name, valid type, and positive PP", () => {
    for (const [idStr, move] of Object.entries(MOVES) as [string, any][]) {
      const label = `MOVES[${idStr}]`;
      expect(typeof move.name, `${label}.name`).toBe("string");
      expect(move.name.length, `${label}.name empty`).toBeGreaterThan(0);
      expect(VALID_TYPES.has(move.type), `${label}.type "${move.type}"`).toBe(true);
      expect(move.pp, `${label}.pp`).toBeGreaterThan(0);
      expect(Number.isInteger(move.pp), `${label}.pp not integer`).toBe(true);
    }
  });

  it("move classes are phys, spec, or status", () => {
    for (const [idStr, move] of Object.entries(MOVES) as [string, any][]) {
      expect(VALID_CLASSES.has(move.cls), `MOVES[${idStr}].cls "${move.cls}"`).toBe(true);
    }
  });

  it("damage moves have non-negative power; status moves have power 0", () => {
    for (const [idStr, move] of Object.entries(MOVES) as [string, any][]) {
      expect(move.power, `MOVES[${idStr}].power`).toBeGreaterThanOrEqual(0);
      if (move.cls === "status") {
        expect(move.power, `MOVES[${idStr}] status power`).toBe(0);
      }
    }
  });

  it("accuracy is 0 (never-miss) or between 30 and 100", () => {
    for (const [idStr, move] of Object.entries(MOVES) as [string, any][]) {
      if (move.acc !== 0) {
        expect(move.acc, `MOVES[${idStr}].acc`).toBeGreaterThanOrEqual(30);
        expect(move.acc, `MOVES[${idStr}].acc`).toBeLessThanOrEqual(100);
      }
    }
  });

  it("well-known moves have expected values", () => {
    // Scratch
    expect(MOVES[10].name).toBe("Scratch");
    expect(MOVES[10].type).toBe("normal");
    expect(MOVES[10].power).toBe(40);
    expect(MOVES[10].pp).toBe(35);
    // Tackle
    expect(MOVES[33].name).toBe("Tackle");
    expect(MOVES[33].type).toBe("normal");
    // Thunderbolt
    const tbolt = Object.values(MOVES as Record<string, any>).find((m) => m.name === "Thunderbolt");
    expect(tbolt).toBeTruthy();
    expect(tbolt.type).toBe("electric");
    expect(tbolt.power).toBeGreaterThanOrEqual(90);
  });
});

describe("typeMult — additional Gen 1 matchups", () => {
  it("psychic hits poison for 2x", () => {
    expect(typeMult("psychic", ["poison"])).toBe(2);
  });

  it("bug hits psychic for 2x", () => {
    expect(typeMult("bug", ["psychic"])).toBe(2);
  });

  it("dragon vs dragon is 2x", () => {
    expect(typeMult("dragon", ["dragon"])).toBe(2);
  });

  it("water vs rock is 2x", () => {
    expect(typeMult("water", ["rock"])).toBe(2);
  });

  it("fire vs fire is 0.5x", () => {
    expect(typeMult("fire", ["fire"])).toBe(0.5);
  });
});
