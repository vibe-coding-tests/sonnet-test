import { describe, it, expect } from "vitest";
import {
  keyLabel,
  normalizeKeybinds,
  monSize,
  monTemper,
  monName,
  refreshPP,
  makeMon,
  DEFAULT_KEYBINDS,
  KEYBIND_ACTIONS,
  KEYBIND_GROUPS,
  MOVE_KEYS,
  MOVE_ACTIONS,
} from "../../src/game";
import { DEX } from "../../src/data.js";

const ALL_SPECIES = Array.from({ length: 151 }, (_, i) => i + 1);

describe("keyLabel", () => {
  it("formats named keys", () => {
    expect(keyLabel("Space")).toBe("Space");
    expect(keyLabel("Escape")).toBe("Esc");
    expect(keyLabel("Tab")).toBe("Tab");
    expect(keyLabel("ShiftLeft")).toBe("Shift");
    expect(keyLabel("ArrowUp")).toBe("Up");
  });

  it("strips the 'Key' prefix for letter keys", () => {
    expect(keyLabel("KeyW")).toBe("W");
    expect(keyLabel("KeyA")).toBe("A");
    expect(keyLabel("KeyG")).toBe("G");
  });

  it("strips the 'Digit' prefix for number keys", () => {
    expect(keyLabel("Digit1")).toBe("1");
    expect(keyLabel("Digit0")).toBe("0");
  });

  it("formats numpad keys", () => {
    expect(keyLabel("Numpad0")).toBe("Num 0");
    expect(keyLabel("Numpad5")).toBe("Num 5");
  });

  it("abbreviates the modifier keys", () => {
    expect(keyLabel("ShiftRight")).toBe("R Shift");
    expect(keyLabel("ControlLeft")).toBe("Ctrl");
    expect(keyLabel("MetaLeft")).toBe("Cmd");
  });

  it("space-separates camelCase codes it doesn't otherwise know", () => {
    expect(keyLabel("CapsLock")).toBe("Caps Lock");
  });

  it("returns 'Unbound' for empty or nullish input", () => {
    expect(keyLabel("")).toBe("Unbound");
  });
});

describe("keybind tables", () => {
  it("every grouped action has a matching default binding", () => {
    for (const a of KEYBIND_ACTIONS) {
      expect(DEFAULT_KEYBINDS, `default for ${a.id}`).toHaveProperty(a.id);
    }
  });

  it("KEYBIND_ACTIONS flattens every group with its group name", () => {
    const grouped = KEYBIND_GROUPS.flatMap((g) => g.actions.map(([id]) => id));
    expect(KEYBIND_ACTIONS.map((a) => a.id)).toEqual(grouped);
    for (const a of KEYBIND_ACTIONS) {
      expect(typeof a.label).toBe("string");
      expect(a.group.length).toBeGreaterThan(0);
    }
  });

  it("the four move slots line up between MOVE_KEYS and MOVE_ACTIONS", () => {
    expect(MOVE_KEYS).toHaveLength(4);
    expect(MOVE_ACTIONS).toHaveLength(4);
    for (const action of MOVE_ACTIONS) {
      expect(DEFAULT_KEYBINDS, `default for ${action}`).toHaveProperty(action);
    }
  });
});

describe("normalizeKeybinds", () => {
  it("returns defaults when called with no argument", () => {
    const kb = normalizeKeybinds();
    expect(kb.moveForward).toBe(DEFAULT_KEYBINDS.moveForward);
    expect(kb.throwBall).toBe(DEFAULT_KEYBINDS.throwBall);
    expect(kb.menu).toBe(DEFAULT_KEYBINDS.menu);
  });

  it("applies a custom binding over the default", () => {
    const kb = normalizeKeybinds({ moveForward: "ArrowUp" });
    expect(kb.moveForward).toBe("ArrowUp");
    expect(kb.moveBackward).toBe(DEFAULT_KEYBINDS.moveBackward);
  });

  it("ignores bindings with empty string values", () => {
    const kb = normalizeKeybinds({ moveForward: "" });
    expect(kb.moveForward).toBe(DEFAULT_KEYBINDS.moveForward);
  });

  it("produces an entry for every known action", () => {
    const kb = normalizeKeybinds();
    for (const action of KEYBIND_ACTIONS) {
      expect(kb, `missing action ${action.id}`).toHaveProperty(action.id);
    }
  });
});

describe("monName", () => {
  it("returns the correct name for known species", () => {
    expect(monName({ sp: 1 })).toBe(DEX[1].name);   // Bulbasaur
    expect(monName({ sp: 25 })).toBe(DEX[25].name);  // Pikachu
    expect(monName({ sp: 150 })).toBe(DEX[150].name); // Mewtwo
  });

  it("returns a non-empty string for every species", () => {
    for (const sp of ALL_SPECIES) {
      const name = monName({ sp });
      expect(typeof name).toBe("string");
      expect(name.length).toBeGreaterThan(0);
    }
  });
});

describe("monSize", () => {
  it("clamps to the [0.7, 4.6] range for all 151 species", () => {
    for (const sp of ALL_SPECIES) {
      const size = monSize(sp);
      expect(size, `${DEX[sp].name} size`).toBeGreaterThanOrEqual(0.7);
      expect(size, `${DEX[sp].name} size`).toBeLessThanOrEqual(4.6);
    }
  });

  it("large species are bigger than tiny ones", () => {
    const onix = monSize(95);     // Onix: height 8.8m
    const rattata = monSize(19);  // Rattata: height 0.3m
    expect(onix).toBeGreaterThan(rattata);
  });
});

describe("monTemper", () => {
  it("returns a non-empty string for every species", () => {
    const valid = new Set(["calm", "skittish", "aggressive"]);
    for (const sp of ALL_SPECIES) {
      const temper = monTemper(sp);
      expect(typeof temper).toBe("string");
      expect(valid.has(temper), `${DEX[sp].name} temper "${temper}"`).toBe(true);
    }
  });

  it("known aggressive species are aggressive", () => {
    // Spearow is flagged aggressive in the DEX
    expect(monTemper(21)).toBe("aggressive"); // Spearow
  });
});

describe("refreshPP", () => {
  it("resets all PP to their move maximums", () => {
    const mon = makeMon(4, 20); // Charmander at lv 20
    // Drain PP
    mon.pp = mon.pp.map(() => 0);
    refreshPP(mon);
    expect(mon.pp.length).toBe(mon.moves.length);
    for (const pp of mon.pp) {
      expect(pp).toBeGreaterThan(0);
    }
  });

  it("keeps pp array length in sync with moves array", () => {
    const mon = makeMon(1, 50);
    refreshPP(mon);
    expect(mon.pp.length).toBe(mon.moves.length);
  });
});
