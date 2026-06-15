import { describe, it, expect, beforeEach } from "vitest";
import {
  AUTOSAVE_INTERVAL_SECONDS,
  fmtPlaytime,
  slotStorageKey,
  slotMeta,
  currentSlot,
  setSlot,
  normalizeSaveState,
} from "../../src/game";

beforeEach(() => localStorage.clear());

describe("autosave interval", () => {
  it("runs the timed autosave every two minutes", () => {
    expect(AUTOSAVE_INTERVAL_SECONDS).toBe(120);
  });
});

describe("fmtPlaytime", () => {
  it("formats minutes-only durations", () => {
    expect(fmtPlaytime(0)).toBe("0m");
    expect(fmtPlaytime(60)).toBe("1m");
    expect(fmtPlaytime(59)).toBe("0m");
  });

  it("formats hours with zero-padded minutes", () => {
    expect(fmtPlaytime(3600)).toBe("1h 00m");
    expect(fmtPlaytime(3725)).toBe("1h 02m"); // 1h 2m 5s
    expect(fmtPlaytime(7800)).toBe("2h 10m");
  });
});

describe("slotStorageKey", () => {
  it("keeps the legacy key for slot 1 and suffixes the rest", () => {
    expect(slotStorageKey(1)).toBe("kanto_adventure_save_v1");
    expect(slotStorageKey(2)).toBe("kanto_adventure_save_v1_s2");
    expect(slotStorageKey(3)).toBe("kanto_adventure_save_v1_s3");
  });
});

describe("currentSlot / setSlot", () => {
  it("defaults to slot 1 and round-trips a valid selection", () => {
    expect(currentSlot()).toBe(1);
    setSlot(2);
    expect(currentSlot()).toBe(2);
  });

  it("falls back to slot 1 for out-of-range values", () => {
    setSlot(9);
    expect(currentSlot()).toBe(1);
  });
});

describe("slotMeta", () => {
  it("returns null for an empty or unstarted slot", () => {
    expect(slotMeta(1)).toBeNull();
    localStorage.setItem(slotStorageKey(1), JSON.stringify({ started: false }));
    expect(slotMeta(1)).toBeNull();
  });

  it("returns null for corrupt JSON", () => {
    localStorage.setItem(slotStorageKey(2), "{not json");
    expect(slotMeta(2)).toBeNull();
  });

  it("summarizes a valid save", () => {
    const save = {
      started: true,
      name: "Red",
      party: [{ sp: 6, lv: 36 }],
      badges: ["boulder", "cascade"],
      caught: [1, 4, 7],
      playT: 3725,
      tl: 5,
    };
    localStorage.setItem(slotStorageKey(1), JSON.stringify(save));
    const meta = slotMeta(1);
    expect(meta).toMatchObject({
      name: "Red",
      badges: 2,
      dex: 3,
      playT: 3725,
      lead: 6,
      leadLv: 36,
      tl: 5,
    });
  });
});

describe("normalizeSaveState", () => {
  it("fills branch-added defaults on a main-era save", () => {
    const migrated = normalizeSaveState({
      v: 5,
      started: true,
      party: [],
      items: { pokeball: 2 },
      settings: { vol: 25 },
      badges: ["boulder"],
      caught: [1],
      futureField: "keep me",
    });

    expect(migrated.items).toMatchObject({ pokeball: 2, oranberry: 2, escaperope: 1 });
    expect(migrated.settings).toMatchObject({ vol: 25, followers: true, expShare: true });
    expect(migrated.settings.keybinds.moveForward).toBe("KeyW");
    expect(migrated.story.rival1).toBe(true);
    expect(migrated.futureField).toBe("keep me");
  });

  it("does not downgrade newer save versions", () => {
    const migrated = normalizeSaveState({
      v: 99,
      started: true,
      party: [],
      settings: {},
    });

    expect(migrated.v).toBe(99);
    expect(migrated.settings.keybinds.menu).toBe("Escape");
  });

  it("normalizes sparse local JSON without crashing later reads", () => {
    const migrated = normalizeSaveState({ started: true });

    expect(migrated.party).toEqual([]);
    expect(migrated.boxes).toEqual([]);
    expect(migrated.badges).toEqual([]);
    expect(migrated.beaten).toEqual({});
    expect(migrated.settings.keybinds.throwBall).toBe("KeyG");
  });
});
