#!/usr/bin/env python3
"""
Generates src/data.js with authentic Gen 1 (Red/Blue) data:
  - 151 Pokemon: name, types, Gen 1 base stats (HP/Atk/Def/Speed/Special),
    catch rate, base exp, height, habitat, Red/Blue level-up learnset,
    evolution chain (trade/stone evolutions mapped to levels), rarity tier.
  - All 165 Gen 1 moves with their Gen 1 type / power / accuracy
    (reconstructed from the veekun move changelog), battle effects and
    per-move FX descriptors.
  - The authentic Gen 1 type chart (15 types, incl. Ghost->Psychic = 0,
    Bug<->Poison both 2x, Ice vs Fire neutral).

Sources fetched at generation time (NOT needed at runtime):
  - https://github.com/veekun/pokedex CSVs
  - Bulbapedia "List of Pokemon by base stats (Generation I)"
Run:  python3 tools/generate_data.py
"""
import csv, io, json, re, sys, urllib.request

VEEKUN = "https://raw.githubusercontent.com/veekun/pokedex/master/pokedex/data/csv/"

def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (pokemon-adventure data generator)"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode("utf-8")

def rows(name):
    print("fetching", name)
    return list(csv.DictReader(io.StringIO(fetch(VEEKUN + name))))

# ---------------------------------------------------------------- veekun data
pokemon      = {int(r["id"]): r for r in rows("pokemon.csv") if int(r["id"]) <= 151}
species      = {int(r["id"]): r for r in rows("pokemon_species.csv") if int(r["id"]) <= 151}
habitats     = {int(r["id"]): r["identifier"] for r in rows("pokemon_habitats.csv")}
types_csv    = {int(r["id"]): r["identifier"] for r in rows("types.csv")}
ptypes       = {}
for r in rows("pokemon_types.csv"):
    pid = int(r["pokemon_id"])
    if pid <= 151:
        ptypes.setdefault(pid, []).append((int(r["slot"]), types_csv[int(r["type_id"])]))
moves_csv    = [r for r in rows("moves.csv") if r["generation_id"] == "1"]
changelog    = rows("move_changelog.csv")
pevo         = rows("pokemon_evolution.csv")
print("fetching pokemon_moves.csv (large)...")
learn_raw    = {}
for r in csv.DictReader(io.StringIO(fetch(VEEKUN + "pokemon_moves.csv"))):
    if r["version_group_id"] == "1" and r["pokemon_move_method_id"] == "1":
        pid = int(r["pokemon_id"])
        if pid <= 151:
            learn_raw.setdefault(pid, []).append((int(r["level"]), int(r["move_id"]), int(r["order"] or 0)))

# ------------------------------------------------------- Gen 1 base stats
def gen1_stats_bulbapedia():
    html = fetch("https://bulbapedia.bulbagarden.net/wiki/List_of_Pok%C3%A9mon_by_base_stats_(Generation_I)")
    out = {}
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", html, re.S):
        cells = [re.sub(r"<[^>]+>", "", c).replace("&#39;", "'").strip()
                 for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", tr, re.S)]
        nums = [c for c in cells if re.fullmatch(r"\d+", c)]
        if not cells or not re.fullmatch(r"\d{3,4}", cells[0]):
            continue
        pid = int(cells[0])
        if not (1 <= pid <= 151) or pid in out or len(nums) < 6:
            continue
        # cells: # | (sprite) | Name | HP | Attack | Defense | Speed | Special | Total | Average
        stat_nums = [int(n) for n in nums[1:7]]
        hp, atk, dfn, spe, spc = stat_nums[0], stat_nums[1], stat_nums[2], stat_nums[3], stat_nums[4]
        out[pid] = {"hp": hp, "atk": atk, "def": dfn, "spe": spe, "spc": spc}
    return out

def gen1_stats_pokeapi():
    print("WARNING: falling back to PokeAPI modern stats (Special = Sp.Atk)")
    out = {}
    for pid in range(1, 152):
        d = json.loads(fetch(f"https://pokeapi.co/api/v2/pokemon/{pid}"))
        s = {x["stat"]["name"]: x["base_stat"] for x in d["stats"]}
        out[pid] = {"hp": s["hp"], "atk": s["attack"], "def": s["defense"],
                    "spe": s["speed"], "spc": s["special-attack"]}
    return out

try:
    print("fetching Bulbapedia Gen 1 stat table...")
    g1stats = gen1_stats_bulbapedia()
    checks = {150: ("spc", 154), 113: ("spc", 105), 6: ("spc", 85), 65: ("spc", 135),
              94: ("spc", 130), 101: ("spe", 140), 143: ("hp", 160), 1: ("hp", 45)}
    assert len(g1stats) == 151, f"got {len(g1stats)} stat rows"
    for pid, (k, v) in checks.items():
        assert g1stats[pid][k] == v, f"spot check failed #{pid} {k}={g1stats[pid][k]} expected {v}"
    print("Bulbapedia Gen 1 stats OK (151 rows, spot checks passed)")
except Exception as e:
    print("Bulbapedia parse failed:", e)
    g1stats = gen1_stats_pokeapi()

# ------------------------------------------------------- Gen 1 move values
# move_changelog rows record the value a move had BEFORE changed_in_version_group.
# Gen 1 = version groups 1 (R/B) and 2 (Yellow): for each field take the earliest
# changelog row with version_group >= 3 that has a non-null value, else current.
chg = {}
for r in changelog:
    mid = int(r["move_id"]); vg = int(r["changed_in_version_group_id"])
    if vg >= 3:
        chg.setdefault(mid, []).append((vg, r))
for mid in chg:
    chg[mid].sort(key=lambda x: x[0])

def gen1_field(mid, field, current):
    for vg, r in chg.get(mid, []):
        if r[field] not in ("", None):
            return r[field]
    return current

NAME_FIX = {"nidoran-f": "Nidoran F", "nidoran-m": "Nidoran M", "mr-mime": "Mr. Mime",
            "farfetchd": "Farfetch'd"}
def pretty(ident):
    if ident in NAME_FIX: return NAME_FIX[ident]
    return " ".join(w.capitalize() for w in ident.split("-"))

# ----- hand tables: battle effects for every Gen 1 status move -------------
ST = lambda stat, d, t: {"k": "stage", "stat": stat, "d": d, "t": t}
EFFECTS = {
 "swords-dance": ST("atk", 2, "self"), "whirlwind": {"k": "flee", "t": "enemy"},
 "sand-attack": ST("acc", -1, "enemy"), "tail-whip": ST("def", -1, "enemy"),
 "leer": ST("def", -1, "enemy"), "growl": ST("atk", -1, "enemy"),
 "roar": {"k": "flee", "t": "enemy"}, "sing": {"k": "sleep", "t": "enemy"},
 "supersonic": {"k": "conf", "t": "enemy"}, "disable": {"k": "disable", "t": "enemy"},
 "mist": {"k": "mist", "t": "self"}, "leech-seed": {"k": "seed", "t": "enemy"},
 "growth": ST("spc", 1, "self"), "poison-powder": {"k": "psn", "t": "enemy"},
 "stun-spore": {"k": "para", "t": "enemy"}, "sleep-powder": {"k": "sleep", "t": "enemy"},
 "string-shot": ST("spe", -1, "enemy"), "thunder-wave": {"k": "para", "t": "enemy"},
 "toxic": {"k": "tox", "t": "enemy"}, "agility": ST("spe", 2, "self"),
 "teleport": {"k": "flee", "t": "self"}, "screech": ST("def", -2, "enemy"),
 "double-team": ST("eva", 1, "self"), "recover": {"k": "heal", "f": 0.5},
 "harden": ST("def", 1, "self"), "minimize": ST("eva", 1, "self"),
 "smokescreen": ST("acc", -1, "enemy"), "confuse-ray": {"k": "conf", "t": "enemy"},
 "withdraw": ST("def", 1, "self"), "defense-curl": ST("def", 1, "self"),
 "barrier": ST("def", 2, "self"), "light-screen": {"k": "screen", "s": "spec"},
 "haze": {"k": "haze"}, "reflect": {"k": "screen", "s": "phys"},
 "focus-energy": {"k": "focus"}, "metronome": {"k": "metronome"},
 "mirror-move": {"k": "mirror"}, "kinesis": ST("acc", -1, "enemy"),
 "soft-boiled": {"k": "heal", "f": 0.5}, "glare": {"k": "para", "t": "enemy"},
 "poison-gas": {"k": "psn", "t": "enemy"}, "lovely-kiss": {"k": "sleep", "t": "enemy"},
 "transform": {"k": "transform"}, "spore": {"k": "sleep", "t": "enemy"},
 "splash": {"k": "splash"}, "rest": {"k": "rest"}, "sharpen": ST("atk", 1, "self"),
 "conversion": {"k": "conversion"}, "substitute": {"k": "sub"},
 "meditate": ST("atk", 1, "self"), "amnesia": ST("spc", 2, "self"),
 "hypnosis": {"k": "sleep", "t": "enemy"}, "mimic": {"k": "mimic"},
 "flash": ST("acc", -1, "enemy"), "rage": ST("atk", 1, "self"),
 "bide": {"k": "bide"},
}
# secondary effects on damaging moves (Gen 1-flavoured chances)
SEC = {
 "psychic": {"k": "stage", "stat": "spc", "d": -1, "t": "enemy", "p": 0.3},
 "acid": {"k": "stage", "stat": "def", "d": -1, "t": "enemy", "p": 0.3},
 "aurora-beam": {"k": "stage", "stat": "atk", "d": -1, "t": "enemy", "p": 0.3},
 "bubble-beam": {"k": "stage", "stat": "spe", "d": -1, "t": "enemy", "p": 0.3},
 "bubble": {"k": "stage", "stat": "spe", "d": -1, "t": "enemy", "p": 0.3},
 "constrict": {"k": "stage", "stat": "spe", "d": -1, "t": "enemy", "p": 0.1},
 "ember": {"k": "brn", "p": 0.1}, "flamethrower": {"k": "brn", "p": 0.1},
 "fire-punch": {"k": "brn", "p": 0.1}, "fire-blast": {"k": "brn", "p": 0.3},
 "ice-beam": {"k": "frz", "p": 0.1}, "ice-punch": {"k": "frz", "p": 0.1},
 "blizzard": {"k": "frz", "p": 0.1},
 "thunder-shock": {"k": "para", "p": 0.1}, "thunderbolt": {"k": "para", "p": 0.1},
 "thunder-punch": {"k": "para", "p": 0.1}, "thunder": {"k": "para", "p": 0.1},
 "body-slam": {"k": "para", "p": 0.3}, "lick": {"k": "para", "p": 0.3},
 "stomp": {"k": "flinch", "p": 0.3}, "headbutt": {"k": "flinch", "p": 0.3},
 "rolling-kick": {"k": "flinch", "p": 0.3}, "low-kick": {"k": "flinch", "p": 0.3},
 "bite": {"k": "flinch", "p": 0.1}, "hyper-fang": {"k": "flinch", "p": 0.1},
 "bone-club": {"k": "flinch", "p": 0.1},
 "psybeam": {"k": "conf", "p": 0.1}, "confusion": {"k": "conf", "p": 0.1},
 "poison-sting": {"k": "psn", "p": 0.2}, "twineedle": {"k": "psn", "p": 0.2},
 "smog": {"k": "psn", "p": 0.4}, "sludge": {"k": "psn", "p": 0.3},
}
MULTI  = {"double-slap": [2,5], "comet-punch": [2,5], "fury-attack": [2,5],
          "fury-swipes": [2,5], "pin-missile": [2,5], "spike-cannon": [2,5],
          "barrage": [2,5], "double-kick": [2,2], "bonemerang": [2,2], "twineedle": [2,2]}
RECOIL = {"take-down": 0.25, "double-edge": 0.25, "submission": 0.25, "struggle": 0.25}
DRAIN  = {"absorb": 0.5, "mega-drain": 0.5, "leech-life": 0.5, "dream-eater": 0.5}
CHARGE = ["razor-wind", "sky-attack", "skull-bash", "solar-beam", "fly", "dig"]
RECHARGE = ["hyper-beam"]
OHKO   = ["guillotine", "horn-drill", "fissure"]
FIXED  = {"sonic-boom": 20, "dragon-rage": 40, "seismic-toss": "level",
          "night-shade": "level", "super-fang": "half", "psywave": "rand"}
HIGHCRIT = ["karate-chop", "razor-leaf", "crabhammer", "slash"]
SELFKO = ["explosion", "self-destruct"]
REQ_SLEEP = ["dream-eater"]
SURE_HIT  = ["swift"]

# Real-time combat authoring. The Battle fallback classifier covers everything
# else; these overrides give famous rotation pieces their intended feel.
RT_OVERRIDES = {
 "tackle": {"role": "basic", "cd": 0.85}, "scratch": {"role": "basic", "cd": 0.75},
 "pound": {"role": "basic", "cd": 0.8}, "quick-attack": {"role": "basic", "cd": 0.6},
 "ember": {"role": "basic", "cd": 0.95}, "water-gun": {"role": "basic", "cd": 0.95},
 "thunder-shock": {"role": "basic", "cd": 0.95}, "vine-whip": {"role": "basic", "cd": 0.9},
 "bubble": {"role": "basic", "cd": 0.9}, "absorb": {"role": "basic", "cd": 0.9},
 "gust": {"role": "basic", "cd": 0.9}, "peck": {"role": "basic", "cd": 0.75},
 "flamethrower": {"role": "skill", "cd": 5.6}, "fire-punch": {"role": "skill", "cd": 4.6},
 "thunderbolt": {"role": "skill", "cd": 5.8}, "thunder-punch": {"role": "skill", "cd": 4.6},
 "ice-beam": {"role": "skill", "cd": 5.8}, "ice-punch": {"role": "skill", "cd": 4.6},
 "surf": {"role": "skill", "cd": 6.4}, "razor-leaf": {"role": "skill", "cd": 4.6},
 "psychic": {"role": "skill", "cd": 6.2}, "earthquake": {"role": "skill", "cd": 6.8},
 "body-slam": {"role": "skill", "cd": 5.4}, "rock-slide": {"role": "skill", "cd": 5.8},
 "hydro-pump": {"role": "burst", "energyCost": 100}, "blizzard": {"role": "burst", "energyCost": 100},
 "thunder": {"role": "burst", "energyCost": 100}, "fire-blast": {"role": "burst", "energyCost": 100},
 "solar-beam": {"role": "burst", "energyCost": 100}, "hyper-beam": {"role": "burst", "energyCost": 100},
 "sky-attack": {"role": "burst", "energyCost": 100}, "mega-kick": {"role": "burst", "energyCost": 100},
 "self-destruct": {"role": "burst", "energyCost": 100}, "explosion": {"role": "burst", "energyCost": 100},
}

# ----- per-move FX overrides (kind + params; fx.js fills type defaults) -----
FXO = {
 "ember": {"kind":"proj","count":3,"size":0.13,"speed":17},
 "flamethrower": {"kind":"cone","sustain":0.65},
 "fire-blast": {"kind":"proj","star":1,"size":0.95,"speed":8.5},
 "fire-spin": {"kind":"ringorbit","sustain":0.8},
 "fire-punch": {"kind":"dash","burst":"fire"},
 "water-gun": {"kind":"stream","count":10,"speed":26,"size":0.1},
 "hydro-pump": {"kind":"stream","count":26,"speed":30,"size":0.17,"big":1},
 "surf": {"kind":"wave"},
 "bubble": {"kind":"lob","count":5,"size":0.16,"speed":6},
 "bubble-beam": {"kind":"stream","count":12,"size":0.15,"speed":13},
 "crabhammer": {"kind":"dash","burst":"water","big":1},
 "waterfall": {"kind":"dash","burst":"water"},
 "clamp": {"kind":"ringorbit","sustain":0.5},
 "thunder-shock": {"kind":"bolt","sky":0,"n":1,"width":0.05},
 "thunderbolt": {"kind":"bolt","sky":1,"n":1,"width":0.1},
 "thunder": {"kind":"bolt","sky":1,"n":3,"width":0.14,"big":1},
 "thunder-punch": {"kind":"dash","burst":"electric"},
 "thunder-wave": {"kind":"ring","slow":1},
 "razor-leaf": {"kind":"proj","count":6,"size":0.18,"speed":20,"spin":1,"quad":1},
 "vine-whip": {"kind":"whip"},
 "absorb": {"kind":"drain"}, "mega-drain": {"kind":"drain","big":1},
 "leech-life": {"kind":"drain"}, "dream-eater": {"kind":"drain","dark":1,"big":1},
 "leech-seed": {"kind":"lob","count":3,"size":0.1,"speed":7},
 "solar-beam": {"kind":"beam","charge":0.6,"width":0.3},
 "petal-dance": {"kind":"proj","count":10,"size":0.14,"speed":12,"spin":1,"quad":1},
 "stun-spore": {"kind":"cloud"}, "poison-powder": {"kind":"cloud"},
 "sleep-powder": {"kind":"cloud"}, "spore": {"kind":"cloud"},
 "string-shot": {"kind":"cone","sustain":0.4},
 "ice-beam": {"kind":"beam","width":0.16},
 "blizzard": {"kind":"cone","sustain":0.7,"wide":1,"shards":1},
 "aurora-beam": {"kind":"beam","rainbow":1,"width":0.14},
 "ice-punch": {"kind":"dash","burst":"ice"},
 "haze": {"kind":"cloud","area":1}, "mist": {"kind":"cloud","self":1},
 "psychic": {"kind":"pulse","n":3,"big":1}, "confusion": {"kind":"pulse","n":1},
 "psybeam": {"kind":"beam","wavy":1,"width":0.14},
 "hypnosis": {"kind":"pulse","n":2,"slow":1},
 "barrier": {"kind":"shield"}, "reflect": {"kind":"shield"}, "light-screen": {"kind":"shield"},
 "earthquake": {"kind":"quake","big":1}, "fissure": {"kind":"quake","big":1,"crack":1},
 "dig": {"kind":"dig"}, "sand-attack": {"kind":"cone","sustain":0.3,"short":1},
 "bone-club": {"kind":"dash","bone":1}, "bonemerang": {"kind":"bone"},
 "rock-throw": {"kind":"lob","rock":1,"count":1,"size":0.3,"speed":10},
 "rock-slide": {"kind":"sky","rock":1,"count":5},
 "gust": {"kind":"tornado"}, "razor-wind": {"kind":"slash","n":2,"wide":1,"charge":0.5},
 "wing-attack": {"kind":"slash","n":2},
 "fly": {"kind":"fly"}, "sky-attack": {"kind":"fly","charge":0.6,"big":1},
 "drill-peck": {"kind":"dash","spin":1}, "peck": {"kind":"proj","count":1,"size":0.1,"speed":24},
 "karate-chop": {"kind":"slash","n":1},
 "jump-kick": {"kind":"fly","short":1}, "high-jump-kick": {"kind":"fly","short":1,"big":1},
 "seismic-toss": {"kind":"toss"}, "submission": {"kind":"toss","messy":1},
 "counter": {"kind":"dash","big":1},
 "pin-missile": {"kind":"stream","count":5,"size":0.09,"speed":22},
 "twineedle": {"kind":"stream","count":2,"size":0.1,"speed":22},
 "night-shade": {"kind":"beam","dark":1,"wavy":1},
 "lick": {"kind":"slash","n":1,"slow":1},
 "acid": {"kind":"lob","count":2,"size":0.2,"speed":9},
 "sludge": {"kind":"lob","count":2,"size":0.3,"speed":8,"big":1},
 "smog": {"kind":"cloud"}, "hyper-beam": {"kind":"beam","big":1,"width":0.42},
 "tri-attack": {"kind":"proj","count":3,"size":0.22,"speed":13,"tri":1},
 "swift": {"kind":"proj","count":5,"size":0.18,"speed":18,"star":1},
 "quick-attack": {"kind":"dash","blur":1},
 "slash": {"kind":"slash","n":2,"big":1}, "cut": {"kind":"slash","n":1},
 "fury-swipes": {"kind":"slash","n":3}, "scratch": {"kind":"slash","n":1},
 "bind": {"kind":"ringorbit","sustain":0.5}, "wrap": {"kind":"ringorbit","sustain":0.5},
 "body-slam": {"kind":"dash","big":1}, "double-edge": {"kind":"dash","big":1,"blur":1},
 "explosion": {"kind":"explode"}, "self-destruct": {"kind":"explode"},
 "metronome": {"kind":"self"}, "transform": {"kind":"self"},
 "splash": {"kind":"hop"}, "rest": {"kind":"self"},
 "egg-bomb": {"kind":"lob","count":1,"size":0.34,"speed":9,"big":1},
 "sonic-boom": {"kind":"ring","forward":1},
 "dragon-rage": {"kind":"proj","count":1,"size":0.4,"speed":11,"swirl":1},
 "psywave": {"kind":"beam","wavy":1,"width":0.1},
 "pay-day": {"kind":"proj","count":5,"size":0.12,"speed":16,"coin":1},
 "skull-bash": {"kind":"dash","big":1,"charge":0.5},
 "hyper-fang": {"kind":"slash","n":1,"big":1}, "super-fang": {"kind":"slash","n":1,"big":1},
 "low-kick": {"kind":"dash"}, "rolling-kick": {"kind":"dash","spin":1},
 "smokescreen": {"kind":"cloud"}, "double-team": {"kind":"self","images":1},
 "minimize": {"kind":"self","shrink":1}, "guillotine": {"kind":"slash","n":2,"big":1,"charge":0.4},
 "horn-drill": {"kind":"dash","spin":1,"charge":0.4,"big":1},
 "stomp": {"kind":"dash","big":1}, "strength": {"kind":"dash","big":1},
 "mega-punch": {"kind":"dash","big":1}, "mega-kick": {"kind":"dash","big":1},
 "thrash": {"kind":"dash","big":1}, "confuse-ray": {"kind":"pulse","n":1,"orb":1},
 "disable": {"kind":"pulse","n":1,"slow":1}, "glare": {"kind":"ring","fast":1},
 "sing": {"kind":"pulse","n":2,"slow":1}, "lovely-kiss": {"kind":"pulse","n":1,"slow":1},
 "supersonic": {"kind":"pulse","n":3,"fast":1}, "screech": {"kind":"ring","fast":1,"jag":1},
 "bide": {"kind":"self","charge":1}, "waterfall2": {},
}

# Gen 1: damage category is determined by TYPE, not move
PHYS_TYPES = ["normal","fighting","flying","ground","rock","bug","ghost","poison"]

moves_out = {}
for r in moves_csv:
    mid = int(r["id"]); ident = r["identifier"]
    t = types_csv[int(gen1_field(mid, "type_id", r["type_id"]))]
    power = gen1_field(mid, "power", r["power"]) or 0
    acc = gen1_field(mid, "accuracy", r["accuracy"]) or 0
    power = int(power); acc = int(acc)
    if ident in SURE_HIT: acc = 0          # 0 = never misses
    status = (r["damage_class_id"] == "1")
    cls = "status" if status else ("phys" if t in PHYS_TYPES else "spec")
    pp = int(gen1_field(mid, "pp", r["pp"]) or 10)
    m = {"id": mid, "name": pretty(ident), "key": ident, "type": t,
         "power": 0 if status else power, "acc": acc, "cls": cls,
         "pri": int(r["priority"]), "pp": pp}
    if ident in EFFECTS: m["effect"] = EFFECTS[ident]
    if ident in SEC: m["sec"] = SEC[ident]
    tags = {}
    if ident in MULTI: tags["multi"] = MULTI[ident]
    if ident in RECOIL: tags["recoil"] = RECOIL[ident]
    if ident in DRAIN: tags["drain"] = DRAIN[ident]
    if ident in CHARGE: tags["charge"] = 1
    if ident in RECHARGE: tags["recharge"] = 1
    if ident in OHKO: tags["ohko"] = 1
    if ident in FIXED: tags["fixed"] = FIXED[ident]
    if ident in HIGHCRIT: tags["highcrit"] = 1
    if ident in SELFKO: tags["selfko"] = 1
    if ident in REQ_SLEEP: tags["reqSleep"] = 1
    if tags: m["tags"] = tags
    if ident in FXO: m["fx"] = FXO[ident]
    if ident in RT_OVERRIDES: m.update(RT_OVERRIDES[ident])
    moves_out[mid] = m

assert len(moves_out) == 165, f"expected 165 moves, got {len(moves_out)}"
mv_by_key = {m["key"]: m for m in moves_out.values()}
assert mv_by_key["blizzard"]["acc"] == 90, "blizzard gen1 acc should be 90"
assert mv_by_key["bite"]["type"] == "normal", "bite gen1 type should be normal"
assert mv_by_key["rock-throw"]["acc"] == 65, "rock throw gen1 acc should be 65"
assert mv_by_key["dig"]["power"] == 100, "dig gen1 power should be 100"
assert mv_by_key["gust"]["type"] == "normal", "gust gen1 type should be normal"
assert mv_by_key["karate-chop"]["type"] == "normal", "karate chop gen1 type normal"
assert mv_by_key["psychic"]["power"] == 90
assert mv_by_key["tackle"]["pp"] == 35, f"tackle pp {mv_by_key['tackle']['pp']}"
assert mv_by_key["hyper-beam"]["pp"] == 5
print("struggle pp:", mv_by_key["struggle"]["pp"], "| swords-dance pp:", mv_by_key["swords-dance"]["pp"])
print("move spot checks passed")

# -------------------------------------------------------------- evolutions
evos = {}
stage = {}
def get_stage(pid):
    if pid in stage: return stage[pid]
    prev = species[pid]["evolves_from_species_id"]
    s = 1 if not prev or int(prev) > 151 else get_stage(int(prev)) + 1
    stage[pid] = s
    return s
for pid in range(1, 152): get_stage(pid)

TRADE_LEVEL = 36
for r in pevo:
    to = int(r["evolved_species_id"])
    if to > 151: continue
    frm = int(species[to]["evolves_from_species_id"])
    if frm > 151: continue
    trig = int(r["evolution_trigger_id"])
    if trig == 1 and r["minimum_level"]:
        lvl = int(r["minimum_level"])
    elif trig == 2:
        lvl = TRADE_LEVEL
    elif trig == 3:                       # stone
        lvl = 25 if frm == 133 else (36 if get_stage(frm) >= 2 else 28)
    else:
        continue
    e = {"to": to, "level": lvl}
    if frm == 133: e["random"] = 1        # Eevee: random of the three
    evos.setdefault(frm, []).append(e)
for k in evos: evos[k].sort(key=lambda e: e["to"])
assert any(e["to"] == 5 and e["level"] == 16 for e in evos[4]), "charmander 16"
assert any(e["to"] == 6 and e["level"] == 36 for e in evos[5]), "charmeleon 36"
assert any(e["to"] == 65 for e in evos[64]), "kadabra->alakazam"
assert len(evos[133]) == 3, "eevee 3 evos"
assert any(e["to"] == 149 and e["level"] == 55 for e in evos[148]), "dragonair 55"
print("evolution spot checks passed")

# ------------------------------------------------------------ species table
LEGEND = {144, 145, 146, 150, 151}
NIGHT  = {35, 36, 41, 42, 43, 44, 45, 52, 53, 92, 93, 94, 88, 89}
AGGR   = {21,22,23,24,33,34,56,57,66,67,68,85,111,112,115,123,127,128,130,142,150}
SKIT   = {10,13,16,19,25,37,39,43,48,58,60,63,77,84,96,102,109,113,118,129,133,147}

dex = []
for pid in range(1, 152):
    sp = species[pid]; pk = pokemon[pid]
    tlist = [t for _, t in sorted(ptypes[pid])]
    catch = int(sp["capture_rate"])
    hab = habitats.get(int(sp["habitat_id"]), "grassland") if sp["habitat_id"] else "grassland"
    ls = sorted(set((l if l > 0 else 1, m) for l, m, _ in learn_raw.get(pid, [])))
    st = get_stage(pid)
    final = pid not in evos
    if pid in LEGEND: rarity = "legendary"
    elif catch <= 60 or st >= 3 or (final and st >= 2 and catch <= 75): rarity = "rare"
    elif catch <= 130: rarity = "uncommon"
    else: rarity = "common"
    if pid in AGGR: temper = "aggressive"
    elif pid in SKIT: temper = "skittish"
    else:
        b = g1stats[pid]
        temper = ("aggressive" if b["atk"] >= 95 and catch <= 90 else
                  "skittish" if b["spe"] >= 90 and catch >= 150 else "calm")
    growth = {1: "slow", 2: "mediumfast", 3: "fast", 4: "mediumslow"}.get(
        int(sp["growth_rate_id"]), "mediumfast")
    d = {"id": pid, "name": pretty(sp["identifier"]), "types": tlist,
         "base": g1stats[pid], "catch": catch, "exp": int(pk["base_experience"] or 60),
         "height": int(pk["height"]), "habitat": hab, "stage": st,
         "rarity": rarity, "temper": temper, "growth": growth,
         "learnset": [[l, m] for l, m in ls]}
    if pid in evos: d["evos"] = evos[pid]
    if pid in NIGHT: d["night"] = 1
    dex.append(d)

assert len(dex) == 151
assert dex[150]["name"] == "Mew" and dex[24]["name"] == "Pikachu"
abra_moves = [m for l, m in dex[62]["learnset"]]
assert abra_moves == [100], f"abra should only know teleport, got {abra_moves}"
assert dex[0]["growth"] == "mediumslow", "bulbasaur medium-slow"
assert dex[149]["growth"] == "slow", "mewtwo slow"
assert dex[112]["growth"] == "fast", "chansey fast"
assert dex[9]["growth"] == "mediumfast", "caterpie medium-fast"
print("species spot checks passed")

# ----------------------------------------------------- Gen 1 type chart
CHART = {
 "normal":  {"rock": .5, "ghost": 0},
 "fighting":{"normal": 2, "rock": 2, "ice": 2, "flying": .5, "poison": .5, "bug": .5, "psychic": .5, "ghost": 0},
 "flying":  {"fighting": 2, "bug": 2, "grass": 2, "rock": .5, "electric": .5},
 "poison":  {"grass": 2, "bug": 2, "poison": .5, "ground": .5, "rock": .5, "ghost": .5},
 "ground":  {"poison": 2, "rock": 2, "fire": 2, "electric": 2, "grass": .5, "bug": .5, "flying": 0},
 "rock":    {"flying": 2, "bug": 2, "fire": 2, "ice": 2, "fighting": .5, "ground": .5},
 "bug":     {"grass": 2, "psychic": 2, "poison": 2, "fighting": .5, "flying": .5, "ghost": .5, "fire": .5},
 "ghost":   {"ghost": 2, "psychic": 0, "normal": 0},
 "fire":    {"grass": 2, "ice": 2, "bug": 2, "fire": .5, "water": .5, "rock": .5, "dragon": .5},
 "water":   {"fire": 2, "ground": 2, "rock": 2, "water": .5, "grass": .5, "dragon": .5},
 "grass":   {"water": 2, "ground": 2, "rock": 2, "fire": .5, "grass": .5, "poison": .5, "flying": .5, "bug": .5, "dragon": .5},
 "electric":{"water": 2, "flying": 2, "grass": .5, "electric": .5, "dragon": .5, "ground": 0},
 "psychic": {"fighting": 2, "poison": 2, "psychic": .5},
 "ice":     {"grass": 2, "ground": 2, "flying": 2, "dragon": 2, "water": .5, "ice": .5},
 "dragon":  {"dragon": 2},
}
TYPE_COLORS = {
 "normal": "#A8A878", "fighting": "#C03028", "flying": "#A890F0", "poison": "#A040A0",
 "ground": "#E0C068", "rock": "#B8A038", "bug": "#A8B820", "ghost": "#705898",
 "fire": "#F08030", "water": "#6890F0", "grass": "#78C850", "electric": "#F8D030",
 "psychic": "#F85888", "ice": "#98D8D8", "dragon": "#7038F8",
}

# ------------------------------------------------------------------ output
def js(obj): return json.dumps(obj, separators=(",", ":"), ensure_ascii=False)
out = f"""// GENERATED by tools/generate_data.py -- do not edit by hand.
// Authentic Gen 1 (Red/Blue) data from veekun/pokedex CSVs + Bulbapedia Gen 1 stat table.
export const POKEDEX={js(dex)};
export const MOVES={js(moves_out)};
export const TYPE_CHART={js(CHART)};
export const TYPE_COLORS={js(TYPE_COLORS)};
export const PHYS_TYPES={js(PHYS_TYPES)};
export const DEX={{}};for(const p of POKEDEX)DEX[p.id]=p;
export function typeMult(atk,defTypes){{let m=1;for(const d of defTypes){{const r=TYPE_CHART[atk];if(r&&r[d]!==undefined)m*=r[d];}}return m;}}
export function spriteURL(id,back){{return `sprites/${{back?"back/":""}}${{id}}.png`;}}
"""
with open("src/data.js", "w") as f:
    f.write(out)
print(f"wrote src/data.js ({len(out)//1024} KB)")
