import { describe, it, expect } from "vitest";
import { ITEMS, BADGE_META, freshSaveState } from "../../src/game";

// The shop, bag, and catch code all read ITEMS by key; the badge case UI and
// the gym gate read BADGE_META. Both are hand-authored tables, so these guard
// against typos and missing fields rather than testing behavior.

describe("ITEMS table integrity", () => {
  it("every entry has a non-empty name and description", () => {
    for (const [key, item] of Object.entries(ITEMS)) {
      expect(typeof item.name, `${key}.name`).toBe("string");
      expect(item.name.length, `${key}.name empty`).toBeGreaterThan(0);
      expect(typeof item.desc, `${key}.desc`).toBe("string");
      expect(item.desc.length, `${key}.desc empty`).toBeGreaterThan(0);
    }
  });

  it("prices are non-negative integers", () => {
    for (const [key, item] of Object.entries(ITEMS)) {
      expect(Number.isInteger(item.price), `${key}.price not integer`).toBe(true);
      expect(item.price, `${key}.price`).toBeGreaterThanOrEqual(0);
    }
  });

  it("the three Balls escalate in catch multiplier", () => {
    expect(ITEMS.pokeball.ball).toBe(1);
    expect(ITEMS.greatball.ball).toBeGreaterThan(ITEMS.pokeball.ball);
    expect(ITEMS.ultraball.ball).toBeGreaterThan(ITEMS.greatball.ball);
  });

  it("better Balls gate behind a Trainer-Level unlock", () => {
    expect(ITEMS.pokeball.unlock).toBeUndefined();
    expect(ITEMS.greatball.unlock).toBeGreaterThan(0);
    expect(ITEMS.ultraball.unlock).toBeGreaterThan(ITEMS.greatball.unlock);
  });

  it("healing items restore a positive amount", () => {
    for (const key of ["potion", "superpotion", "oranberry"] as const) {
      expect(ITEMS[key].heal, `${key}.heal`).toBeGreaterThan(0);
    }
    expect(ITEMS.superpotion.heal).toBeGreaterThan(ITEMS.potion.heal);
  });

  it("shop-only items are not flagged noshop, and Rare Candy/Nugget are", () => {
    expect(ITEMS.pokeball.noshop).toBeFalsy();
    expect(ITEMS.rarecandy.noshop).toBe(true);
    expect(ITEMS.nugget.noshop).toBe(true);
  });
});

describe("BADGE_META table integrity", () => {
  const EXPECTED = [
    "boulder", "cascade", "thunder", "rainbow",
    "soul", "marsh", "volcano", "earth",
  ];

  it("has exactly the eight Kanto gym badges in order", () => {
    expect(Object.keys(BADGE_META)).toEqual(EXPECTED);
  });

  it("every badge has a name, a hex color, and a source leader", () => {
    for (const [key, b] of Object.entries(BADGE_META)) {
      expect(b.name, `${key}.name`).toMatch(/Badge$/);
      expect(b.color, `${key}.color`).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(typeof b.from, `${key}.from`).toBe("string");
      expect(b.from.length, `${key}.from empty`).toBeGreaterThan(0);
    }
  });

  it("names the canonical leaders", () => {
    expect(BADGE_META.boulder.from).toContain("Brock");
    expect(BADGE_META.cascade.from).toContain("Misty");
    expect(BADGE_META.earth.from).toContain("Giovanni");
  });
});

describe("freshSaveState", () => {
  it("starts an unplayed file: not started, empty party, starter Balls", () => {
    const s = freshSaveState();
    expect(s.started).toBe(false);
    expect(s.party).toEqual([]);
    expect(s.boxes).toEqual([]);
    expect(s.badges).toEqual([]);
    expect(s.items.pokeball).toBeGreaterThan(0);
    expect(s.money).toBeGreaterThan(0);
  });

  it("seeds defaulted settings including normalized keybinds", () => {
    const s = freshSaveState();
    expect(s.settings.style).toBe("arena");
    expect(s.settings.followers).toBe(true);
    expect(s.settings.keybinds.moveForward).toBe("KeyW");
    expect(s.settings.keybinds.menu).toBe("Escape");
  });

  it("returns a fresh object each call (no shared mutable state)", () => {
    const a = freshSaveState();
    const b = freshSaveState();
    a.items.pokeball = 999;
    a.party.push({} as any);
    expect(b.items.pokeball).not.toBe(999);
    expect(b.party).toEqual([]);
  });
});
