// Gameplay: wild spawning + AI, real-time battle system (Gen 1 damage model),
// catching (physical Ball throws with a clean aim mode), follower Pokémon,
// trainers, Team Rocket, the Champion fight, fishing, leveling/evolution,
// economy, interactions, save/load.
import * as THREE from "three";
import { POKEDEX, MOVES, DEX, TYPE_COLORS, typeMult } from "./data.js";
import type { Move } from "./data.js";
import { buildPerson, makeTextSprite, World, MAP_SCALE, WORLD_R } from "./world.js";
import { buildMonRig, MON3D_SPECS } from "./monmodel.js";
import type { MonRig } from "./monmodel.js";
import type { FX } from "./fx";
import type { AudioMan } from "./audio";

const SAVE_KEY = "kanto_adventure_save_v1";
const SLOT_KEY = "kanto_adventure_slot";
const SAVE_VERSION = 5;   // v5: mini-Kanto grew into full-scale Kanto

// ------------------------------------------------------- save slots (v9)
// Three save files, RBY-style "CONTINUE / NEW GAME" on a title screen.
// Slot 1 keeps the legacy storage key so old saves just keep working.
export function currentSlot() {
  const n = parseInt(localStorage.getItem(SLOT_KEY) || "1", 10);
  return n >= 1 && n <= 3 ? n : 1;
}
export function setSlot(n: number) { try { localStorage.setItem(SLOT_KEY, String(n)); } catch (e) { /* private mode */ } }
export function slotStorageKey(n: number) { return n <= 1 ? SAVE_KEY : `${SAVE_KEY}_s${n}`; }
export function slotMeta(n: number) {
  try {
    const raw = localStorage.getItem(slotStorageKey(n));
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || !s.started || !Array.isArray(s.party)) return null;
    return {
      name: s.name || "Trainer",
      badges: (s.badges || []).length,
      dex: (s.caught || []).length,
      playT: s.playT || 0,
      lead: s.party[0]?.sp || null,
      leadLv: s.party[0]?.lv || null,
      tl: s.tl || 1,
    };
  } catch (e) { return null; }
}
export function fmtPlaytime(sec: number) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}
// Battle move hotkeys — QWER-style, bent around WASD so a hand never leaves
// the movement keys. Kept for old debug scripts; live input uses keybind actions.
export const MOVE_KEYS = ["q", "e", "r", "f"];
export const MOVE_ACTIONS = ["move1", "move2", "move3", "move4"];

export const DEFAULT_KEYBINDS = {
  moveForward: "KeyW",
  moveBackward: "KeyS",
  moveLeft: "KeyA",
  moveRight: "KeyD",
  run: "ShiftLeft",
  jumpDodge: "Space",
  interact: "KeyE",
  battle: "KeyF",
  throwBall: "KeyG",
  quickHeal: "KeyZ",
  vehicle: "KeyV",
  flashlight: "KeyL",
  dex: "Tab",
  party: "KeyP",
  bag: "KeyI",
  menu: "Escape",
  move1: "KeyQ",
  move2: "KeyE",
  move3: "KeyR",
  move4: "KeyF",
  switchMenu: "Tab",
  possess: "KeyT",
  battleStyle: "KeyY",
  flee: "KeyX",
} as Record<string, string>;

export const KEYBIND_GROUPS = [
  { name: "Movement", actions: [
    ["moveForward", "Move forward"], ["moveBackward", "Move back"], ["moveLeft", "Strafe left"], ["moveRight", "Strafe right"], ["run", "Run"], ["jumpDodge", "Jump / dodge"],
  ] },
  { name: "Explore", actions: [
    ["interact", "Interact"], ["battle", "Start battle"], ["throwBall", "Throw Ball"], ["quickHeal", "Quick heal"], ["vehicle", "Ride / dismount"], ["flashlight", "Flashlight"],
  ] },
  { name: "Combat", actions: [
    ["move1", "Move 1"], ["move2", "Move 2"], ["move3", "Move 3"], ["move4", "Move 4"], ["switchMenu", "Switch Pokémon"], ["possess", "Take over"], ["battleStyle", "Battle style"], ["flee", "Run"],
  ] },
  { name: "Menus", actions: [
    ["dex", "Pokédex"], ["party", "Party"], ["bag", "Bag"], ["menu", "Pause menu"],
  ] },
];

export const KEYBIND_ACTIONS = KEYBIND_GROUPS.flatMap((g: any) => g.actions.map(([id, label]) => ({ id, label, group: g.name })));

export function normalizeKeybinds(bindings: Record<string, string> = {}) {
  const out = { ...DEFAULT_KEYBINDS };
  for (const a of KEYBIND_ACTIONS) {
    const code = bindings?.[a.id];
    if (typeof code === "string" && code) out[a.id] = code;
  }
  return out;
}

export function keyLabel(code: string) {
  if (!code) return "Unbound";
  const named = {
    Space: "Space", Escape: "Esc", Tab: "Tab", Enter: "Enter", Backspace: "Backspace",
    ShiftLeft: "Shift", ShiftRight: "R Shift", ControlLeft: "Ctrl", ControlRight: "R Ctrl",
    AltLeft: "Alt", AltRight: "R Alt", MetaLeft: "Cmd", MetaRight: "R Cmd",
    ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right",
  } as Record<string, string>;
  if (named[code]) return named[code];
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) return `Num ${code.slice(6)}`;
  return code.replace(/([a-z])([A-Z])/g, "$1 $2");
}

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rnd = (a = 1, b = 0) => b + Math.random() * (a - b);
const irnd = (a, b) => Math.floor(rnd(b, a + 0.999));
const choice = (arr) => arr[Math.floor(Math.random() * arr.length)];

export interface Mon {
  sp: number; lv: number; xp: number;
  ivs: { hp: number; atk: number; def: number; spe: number; spc: number };
  sexp: { hp: number; atk: number; def: number; spe: number; spc: number };
  hp: number; maxhp: number; atk: number; def: number; spe: number; spc: number;
  moves: number[]; pp: number[]; status: string | null;
  hap: number;            // happiness 0..255 (petting, wins, levels)
  uid: string;            // stable identity (e.g. for the walking partner)
}

export const ITEMS = {
  pokeball:    { name: "Poké Ball",    price: 200,  ball: 1,   desc: "A device for catching wild Pokémon." },
  greatball:   { name: "Great Ball",   price: 600,  ball: 1.5, unlock: 3, desc: "A good Ball with a higher catch rate." },
  ultraball:   { name: "Ultra Ball",   price: 1200, ball: 2,   unlock: 7, desc: "An ultra-high performance Ball." },
  potion:      { name: "Potion",       price: 300,  heal: 20,  desc: "Restores 20 HP of one Pokémon." },
  superpotion: { name: "Super Potion", price: 700,  heal: 50,  desc: "Restores 50 HP of one Pokémon." },
  revive:      { name: "Revive",       price: 1500, revive: 0.5, desc: "Revives a fainted Pokémon with half HP." },
  oranberry:   { name: "Oran Berry",   price: 80,   heal: 20,  desc: "A juicy berry. Restores 20 HP. Grows on bushes along the routes." },
  repel:       { name: "Repel",        price: 350,  use: "repel", desc: "Wild Pokémon won't charge at you for 3 minutes." },
  escaperope:  { name: "Escape Rope",  price: 250,  use: "rope", desc: "Whisks you back to the last Pokémon Center." },
  lure:        { name: "Lure",         price: 400,  use: "lure", desc: "Wild Pokémon appear far more often for 3 minutes." },
  nugget:      { name: "Nugget",       price: 0,    use: "nugget", noshop: true, desc: "A lump of pure gold. Use it to sell for ₽5,000." },
} as Record<string, any>;
const BALL_ORDER = ["pokeball", "greatball", "ultraball"];
const LEGEND_SPOTS = { articuno: 144, zapdos: 145, moltres: 146, mewtwo: 150, mew: 151 };
const LEGEND_LV = { 144: 50, 145: 50, 146: 50, 150: 70, 151: 50 };
const STAGE_MULT = (s) => (s >= 0 ? (2 + s) / 2 : 2 / (2 - s));
const STRUGGLE_ID = 165;
export const BADGE_META = {
  boulder: { name: "Boulder Badge", color: "#a8a090", from: "Brock in Pewter City" },
  cascade: { name: "Cascade Badge", color: "#5ab0e8", from: "Misty in Cerulean City" },
  thunder: { name: "Thunder Badge", color: "#f5c542", from: "Lt. Surge in Vermilion City" },
  rainbow: { name: "Rainbow Badge", color: "#7ecf6a", from: "Erika in Celadon City" },
  soul: { name: "Soul Badge", color: "#e87dc9", from: "Koga in Fuchsia City" },
  marsh: { name: "Marsh Badge", color: "#d4af37", from: "Sabrina in Saffron City" },
  volcano: { name: "Volcano Badge", color: "#e8604c", from: "Blaine on Cinnabar Island" },
  earth: { name: "Earth Badge", color: "#7aa35c", from: "Giovanni in Viridian City" },
};

// Authentic Red/Blue trainers along the routes, with their real teams/levels.
const TRAINERS = [
  { id: "bug1", name: "Bug Catcher", look: { shirt: "#aed581", pants: "#6b8e23", hat: "#dce775" }, pos: [-108, -48], party: [10, 13], lvs: [6, 6], pay: 10, dlg: ["Hey! You're in MY bug-catching spot!", "Sw-swarm, retreat!", "My new bugs are extra crunchy!"] },
  { id: "bug2", name: "Bug Catcher", look: { shirt: "#9ccc65", pants: "#33691e", hat: "#c5e1a5" }, pos: [-92, -70], party: [13, 14, 10], lvs: [7, 7, 9], pay: 10, dlg: ["My bugs are itching for a fight!", "My Weedle...!", "The forest made us stronger!"] },
  { id: "lass1", name: "Lass", look: { shirt: "#f48fb1", pants: "#ffffff", hair: "#8d5524" }, pos: [-98, -16], party: [16, 29], lvs: [9, 9], pay: 15, dlg: ["Are you staring at my Pokémon? How rude!", "Aww, my cuties did their best...", "Ready for round two?"] },
  { id: "yng1", name: "Youngster", look: { shirt: "#4fc3f7", pants: "#39435e", hat: "#3b6fe2" }, pos: [-145, 20], party: [19, 21], lvs: [8, 10], pay: 15, dlg: ["I like shorts! They're comfy and easy to wear!", "Aw man, my Rattata...", "I trained harder this time!"] },
  { id: "lass2", name: "Lass", look: { shirt: "#ce93d8", pants: "#ffffff", hair: "#4e342e" }, pos: [-76, -148], party: [19, 32], lvs: [10, 11], pay: 15, dlg: ["Route 3 is my turf!", "No fair!", "I've been practicing on Mt. Moon hikers!"] },
  { id: "yng2", name: "Youngster", look: { shirt: "#ffcc80", pants: "#5d4037", hat: "#ef6c00" }, pos: [-54, -166], party: [19, 23], lvs: [11, 11], pay: 15, dlg: ["My Ekans bites harder than it hisses!", "Sssso close...", "Rematch! My Ekans molted!"] },
  { id: "hiker1", name: "Hiker", look: { shirt: "#a1887f", pants: "#4e342e", hat: "#6d4c41" }, pos: [-36, -169], party: [74, 66], lvs: [11, 12], pay: 35, dlg: ["These rocks and I are unbreakable!", "Crumbled like shale!", "The mountain rebuilt me!"] },
  { id: "nerd", name: "Super Nerd", look: { shirt: "#90a4ae", pants: "#37474f", hair: "#212121" }, pos: [-10, -178], party: [81, 100], lvs: [11, 11], pay: 25, dlg: ["I'm studying the Moon Stone! Don't interrupt!", "My research...!", "New hypothesis: I win this time!"] },
  { id: "rocket1", name: "Rocket", look: { shirt: "#212121", pants: "#212121", hat: "#37474f" }, pos: [14, -170], party: [19, 41], lvs: [13, 13], pay: 30, dlg: ["Team Rocket runs this cave! Hand over your fossils!", "Tch! Remember Team Rocket!", "Team Rocket never forgets a grudge!"] },
  { id: "brock", gym: "boulder", name: "Brock", look: { shirt: "#c97b4a", pants: "#5d4037", hair: "#3e2723" }, pos: null, party: [74, 95], lvs: [12, 14], pay: 99, payMul: 1, dlg: ["I'm Brock! My rock-hard willpower is evident even in my Pokémon!", "I took you for granted... Take the BOULDER BADGE!", "My boulders are reassembled. Care to test them again?"] },
  { id: "swim1", name: "Swimmer", look: { shirt: "#4dd0e1", pants: "#00838f", hair: "#006064" }, pos: [86, -204], party: [116, 90], lvs: [16, 16], pay: 5, dlg: ["The currents under Nugget Bridge taught me to fight!", "Glub glub...", "The tide turns! Rematch!"] },
  { id: "picnic", name: "Jr. Trainer♀", look: { shirt: "#ffb74d", pants: "#8d6e63", hair: "#6d4c41" }, pos: [103, -223], party: [16, 43], lvs: [16, 16], pay: 20, dlg: ["A battle before my picnic? Sure!", "My sandwiches AND my pride, gone...", "Rematch over dessert?"] },
  { id: "camper", name: "Jr. Trainer♂", look: { shirt: "#81c784", pants: "#5d4037", hat: "#33691e" }, pos: [124, -233], party: [21, 27], lvs: [17, 17], pay: 20, dlg: ["Camping rule #1: always be battling!", "My campfire's out...", "I sharpened my skills on flint!"] },
  { id: "misty", gym: "cascade", needBadge: "boulder", name: "Misty", look: { shirt: "#f5c95e", pants: "#e8533a", hair: "#e8533a" }, pos: null, party: [120, 121], lvs: [18, 21], pay: 99, payMul: 1, dlg: ["I'm Misty, the world-famous beauty! My policy is an all-out offensive with Water-types!", "Wow! You're too much! Take the CASCADE BADGE!", "My Starmie is polished and ready. Again?"] },
  { id: "surge", gym: "thunder", needBadge: "cascade", name: "Lt. Surge", look: { shirt: "#a5d6a7", pants: "#33691e", hair: "#fdd835" }, pos: null, party: [100, 25, 26], lvs: [21, 18, 24], pay: 99, payMul: 1, dlg: ["Hey kid! I'm the Lightning American! In war, electric Pokémon saved my hide!", "WHOA! You're the real deal! Take the THUNDER BADGE, soldier!", "My Raichu is recharged. Ten-hut! Round two?"] },
  { id: "erika", gym: "rainbow", needBadge: "thunder", name: "Erika", look: { shirt: "#f8bbd0", pants: "#c2185b", hair: "#263238" }, pos: null, party: [71, 114, 45], lvs: [29, 24, 29], pay: 99, payMul: 1, dlg: ["Hello... I'm Erika, the Nature-Loving Princess. I may doze off mid-battle...", "Oh my... you are remarkable. The RAINBOW BADGE is yours.", "My garden has grown back. Shall we have another graceful bout?"] },
  { id: "koga", gym: "soul", needBadge: "rainbow", name: "Koga", look: { shirt: "#7e57c2", pants: "#311b92", hair: "#1a1a2e" }, pos: null, party: [109, 89, 110], lvs: [37, 39, 43], pay: 99, payMul: 1, dlg: ["Fwahaha! I am Koga, the Poisonous Ninja Master! Despair to the creeping poison!", "You have proven your worth! Here — the SOUL BADGE!", "My toxins have matured. Care to test your antidotes again?"] },
  { id: "sabrina", gym: "marsh", needBadge: "soul", name: "Sabrina", look: { shirt: "#b39ddb", pants: "#4527a0", hair: "#1a1a2e" }, pos: null, party: [64, 122, 65], lvs: [38, 37, 43], pay: 99, payMul: 1, dlg: ["I knew you would come. Three years ago I bent a spoon with my mind. Now I bend battles.", "...I foresaw this loss, yet it still stings. The MARSH BADGE is yours.", "The spoons whisper of a rematch. I have already seen the outcome..."] },
  { id: "blaine", gym: "volcano", needBadge: "marsh", name: "Blaine", look: { shirt: "#ffccbc", pants: "#bf360c", hair: "#eceff1" }, pos: null, party: [58, 78, 59], lvs: [42, 40, 47], pay: 99, payMul: 1, dlg: ["Hah! I am Blaine, the Hot-Headed Quiz Master! Quiz: are you ready to get burned?!", "I have burned down to embers... Take the VOLCANO BADGE!", "My fire is stoked again! Pop quiz: rematch?!"] },
  { id: "giovanni", gym: "earth", needBadge: "volcano", name: "Giovanni", look: { shirt: "#37474f", pants: "#212121", hair: "#1a1a1a" }, pos: null, party: [111, 51, 112], lvs: [45, 42, 50], pay: 99, payMul: 1.5, dlg: ["So. You've come this far. I am Giovanni — and this Gym is mine. The earth itself will bury you!", "...! I am defeated. The EARTH BADGE — and Team Rocket — are finished. Go. The League awaits.", "I train alone now. Show me that strength once more."] },
  { id: "engineer", name: "Engineer", look: { shirt: "#ffd54f", pants: "#616161", hat: "#fbc02d" }, pos: [206, -84], party: [81, 100, 82], lvs: [20, 20, 24], pay: 50, dlg: ["The Power Plant across the river is off-limits! These Magnemite agree!", "Short circuit...", "I've rewired my strategy!"] },
  { id: "channeler", name: "Channeler", look: { shirt: "#9575cd", pants: "#4527a0", hair: "#311b92" }, pos: [196, -12], party: [92, 92, 93], lvs: [22, 23, 24], pay: 30, dlg: ["The spirits of the Tower whisper... battle!", "The spirits have abandoned me!", "The spirits demand a rematch!"] },
  { id: "gambler", name: "Gambler", look: { shirt: "#7986cb", pants: "#283593", hat: "#1a237e" }, pos: [140, -22], party: [58, 37], lvs: [24, 24], pay: 70, dlg: ["I'll bet big on this battle!", "The house... lost.", "Double or nothing!"] },
  { id: "sailor", name: "Sailor", look: { shirt: "#eceff1", pants: "#263238", hat: "#eceff1" }, pos: [78, 116], party: [66, 90], lvs: [21, 21], pay: 30, dlg: ["Matey! A sailor never refuses a battle!", "Blown off course...", "The S.S. Anne sails on a rematch!"] },
  { id: "psychic", name: "Psychic", look: { shirt: "#b39ddb", pants: "#4527a0", hair: "#26155e" }, pos: [135, 98], party: [96, 63, 96], lvs: [18, 18, 20], pay: 25, dlg: ["I foresaw this battle in a dream...", "The future is cloudy...", "The spoons bend toward a rematch!"] },
  { id: "rocket2", name: "Rocket", look: { shirt: "#212121", pants: "#212121", hat: "#37474f" }, pos: [70, -19], party: [41, 109], lvs: [22, 24], pay: 40, dlg: ["SILPH CO. is under Team Rocket's... protection. Scram, kid!", "The boss won't like this...", "Team Rocket never forgets a grudge!"] },
  { id: "karate", name: "Blackbelt", look: { shirt: "#eceff1", pants: "#37474f", hair: "#1a1a1a" }, pos: [54, -3], party: [56, 57], lvs: [37, 39], pay: 25, dlg: ["HIYAH! The Fighting Dojo accepts all challengers!", "A worthy blow! The dojo bows to you.", "My training is complete. Rematch, HIYAH!"] },
  { id: "biker1", name: "Biker", look: { shirt: "#263238", pants: "#1a1a1a", hair: "#4e342e" }, pos: [-30, 58], party: [109, 109, 88], lvs: [26, 26, 28], pay: 20, dlg: ["Born to ride the Cycling Road — and to brawl!", "Wipeout...", "Engines hot! Rematch!"] },
  { id: "biker2", name: "Cue Ball", look: { shirt: "#455a64", pants: "#1a1a1a" }, pos: [-30, 108], party: [23, 24], lvs: [26, 28], pay: 20, dlg: ["No brakes on this slope, kid!", "Skidded out...", "Round two, full throttle!"] },
  { id: "fisher", name: "Fisherman", look: { shirt: "#90caf9", pants: "#37474f", hat: "#5d4037" }, pos: [214, 52], party: [118, 118, 119], lvs: [23, 23, 25], pay: 35, dlg: ["The fish are biting on Route 12! So am I!", "Snapped my line...", "I've got fresh bait. Rematch!"] },
  { id: "ranger", name: "Pokémaniac", look: { shirt: "#bcaaa4", pants: "#4e342e", hair: "#3e2723" }, pos: [80, 182], party: [104, 111], lvs: [29, 29], pay: 50, dlg: ["My rare Pokémon collection battles too!", "My collection!", "I dug up something new. Battle me!"] },
  { id: "cool1", name: "Cooltrainer♀", look: { shirt: "#e53935", pants: "#212121", hair: "#212121" }, pos: [-196, -90], party: [53, 77, 111], lvs: [32, 32, 34], pay: 35, dlg: ["Only the elite climb Victory Road. Show me your best!", "Impressive. Truly.", "I've refined my strategy since we last met!"] },
  { id: "cool2", name: "Cooltrainer♂", look: { shirt: "#3949ab", pants: "#212121", hair: "#37474f" }, pos: [-211, -152], party: [64, 67, 22], lvs: [34, 34, 36], pay: 35, dlg: ["The plateau is mine to guard!", "You... are champion material.", "The summit calls for a rematch!"] },
  // The endgame: your rival waits at the Indigo Plateau with a full team.
  // His final slot counters your starter, exactly like the old days.
  { id: "blue", champion: true, name: "Champion Blue", look: { shirt: "#5e35b1", pants: "#3e2723", hair: "#8d6e63" }, pos: [-212, -196], party: [18, 65, 112, 59, 130, 9], lvs: [40, 41, 41, 42, 43, 45], pay: 99, payMul: 2.5, dlg: [
    "{player}! Welcome to the INDIGO PLATEAU. Fastest Champion out of Pallet Town, EVER — and I'm not handing that over. Time to defend the title!",
    "WHAT?! I picked the wrong Pokémon... You did it, {player}. You're the Champion. ...Gramps would be proud of you.",
    "I've been training nonstop since you beat me. No phone, no feed, just Pokémon. The plateau rematch is ON!",
  ] },
] as any[];
// TRAINERS positions are authored in design space (the compact Kanto sketch);
// expand them to world space once, the moment the module loads
for (const t of TRAINERS) if (t.pos) t.pos = [t.pos[0] * MAP_SCALE, t.pos[1] * MAP_SCALE];
// your rival picked the starter strong against yours
const COUNTER_STARTER = { 1: 6, 4: 9, 7: 3 };

// --------------------------------------------------------- townsfolk (v9)
// Kanto's towns are alive again: most folks stroll their square and trade
// proper route gossip; a couple never did look up from PokéGram. (Their loss.)
const CIV_LINES = [
  ["Welcome! This town is small, but we like it that way.", "The routes get wilder the further you walk. Pack Potions!"],
  ["My Pokémon and I take this walk every single day.", "Rain or shine. Mostly shine lately — lovely, isn't it?"],
  ["The Gym Leaders train harder than anyone I know.", "Mind the type matchup and you might just keep up."],
  ["Tall grass means wild Pokémon. Everybody knows that.", "What they DON'T tell you: berries grow thickest off the path."],
  ["I saw a trainer ride past on a BICYCLE!", "And someone's been roaring around in a TRUCK. A truck! In Kanto!"],
  ["My Growlithe sleeps by the door, rain or shine.", "Best doorbell in Kanto. Loyal, too."],
  ["They say a ghost wanders the tower in Lavender...", "I say it's just a mother watching over her child. Sad, really."],
  ["Old folks say the Moon Stone fell from the sky.", "Clefairy dance around it on clear nights. I've seen it. Once."],
  ["A Snorlax once napped on the route for a MONTH.", "Slept through three festivals. Magnificent beast."],
  ["The League waits past Victory Road, up northwest.", "Eight badges or they won't even open the door."],
  ["TECHNOLOGY is incredible!", "You can post on PokéGram from anywhere now. Even Mt. Moon has signal!"],
  ["Shh — I'm watching a Gym battle at 2x speed.", "Watching counts as training! ...Okay, it's mostly memes."],
  ["My Rattata video hit 10 MILLION views.", "It's in the top percentage of Rattata content."],
  ["My phone says 9 hours of screen time today.", "{player}, you walk around CATCHING things. Touch grass legend."],
] as [string, string][];
// looks 0-3 stroll about their square; the last is welded to their feed
const CIV_LOOKS: { shirt: string; pants: string; hair: string; hat?: string; phone?: boolean }[] = [
  { shirt: "#ff8a65", pants: "#5d4037", hair: "#6d4c41" },
  { shirt: "#4db6ac", pants: "#263238", hair: "#3e2723" },
  { shirt: "#f06292", pants: "#4a148c", hair: "#8d5524", hat: "#f8bbd0" },
  { shirt: "#aed581", pants: "#33691e", hair: "#5a4632" },
  { shirt: "#607d8b", pants: "#37474f", hair: "#212121", phone: true },
];
const CIV_NAMES = ["Gentleman", "Lass", "Picnicker", "Old Timer", "Doomscroller"];
// two townsfolk per town square, offset from the town center (design space,
// expanded to world space at module load like TRAINERS)
const CIV_SPOTS = [
  { town: "pallet", x: -88, z: 124 }, { town: "pallet", x: -101, z: 138 },
  { town: "viridian", x: -88, z: 24 }, { town: "viridian", x: -103, z: 36 },
  { town: "pewter", x: -88, z: -129 }, { town: "pewter", x: -103, z: -141 },
  { town: "cerulean", x: 82, z: -154 }, { town: "cerulean", x: 68, z: -166 },
  { town: "saffron", x: 82, z: -19 }, { town: "saffron", x: 67, z: -31 },
  { town: "celadon", x: -23, z: -19 }, { town: "celadon", x: -37, z: -31 },
  { town: "lavender", x: 211, z: -19 }, { town: "lavender", x: 199, z: -31 },
  { town: "vermilion", x: 82, z: 101 }, { town: "vermilion", x: 68, z: 89 },
  { town: "fuchsia", x: -23, z: 181 }, { town: "fuchsia", x: -37, z: 169 },
  { town: "cinnabar", x: -89, z: 257 }, { town: "cinnabar", x: -101, z: 267 },
];
for (const c of CIV_SPOTS) { c.x *= MAP_SCALE; c.z *= MAP_SCALE; }

// ---------------------------------------------- Gen 1 stats / growth / XP
// Gen 1 DVs: 0-15 per stat, HP DV derived from the parity bits of the others.
function rollDVs() {
  const atk = irnd(0, 15), def = irnd(0, 15), spe = irnd(0, 15), spc = irnd(0, 15);
  return { atk, def, spe, spc, hp: ((atk & 1) << 3) | ((def & 1) << 2) | ((spe & 1) << 1) | (spc & 1) };
}
const ZERO_SEXP = () => ({ hp: 0, atk: 0, def: 0, spe: 0, spc: 0 });
// Gen 1 stat formula incl. Stat Experience: floor(((base+DV)*2 + sqrt(statExp)/4) * L / 100) + 5 (HP: +L+10)
export function calcStats(sp, lv, dvs, sexp = null) {
  const b = DEX[sp].base;
  const ev = (k) => Math.floor(Math.ceil(Math.sqrt(sexp?.[k] || 0)) / 4);
  const core = (base, dv, k) => Math.floor(((base + dv) * 2 + ev(k)) * lv / 100);
  return {
    maxhp: core(b.hp, dvs.hp, "hp") + lv + 10,
    atk: core(b.atk, dvs.atk, "atk") + 5, def: core(b.def, dvs.def, "def") + 5,
    spe: core(b.spe, dvs.spe, "spe") + 5, spc: core(b.spc, dvs.spc, "spc") + 5,
  };
}
export function movesAtLevel(sp, lv) {
  const ls = DEX[sp].learnset.filter(([l]) => l <= lv).map(([, m]) => m);
  const uniq = [...new Set(ls)];
  return uniq.slice(-4);
}
// The four authentic Gen 1 experience groups.
const GROWTH = {
  fast: (n) => Math.floor((4 * n * n * n) / 5),
  mediumfast: (n) => n * n * n,
  mediumslow: (n) => Math.max(0, Math.floor((6 / 5) * n * n * n) - 15 * n * n + 100 * n - 140),
  slow: (n) => Math.floor((5 * n * n * n) / 4),
};
export function xpForLevel(sp, l) {
  return (GROWTH[DEX[sp].growth] || GROWTH.mediumfast)(Math.max(1, l));
}
export function makeMon(sp, lv): Mon {
  const ivs = rollDVs();
  const sexp = ZERO_SEXP();
  const stats = calcStats(sp, lv, ivs, sexp);
  const moves = movesAtLevel(sp, lv);
  return {
    sp, lv, xp: xpForLevel(sp, lv), ivs, sexp, hp: stats.maxhp, ...stats,
    moves, pp: moves.map((id) => MOVES[id].pp), status: null, hap: 70,
    uid: Math.random().toString(36).slice(2, 10),
  };
}
export function monName(mon) { return DEX[mon.sp].name; }
// add xp, returns events [{type:'level',lv}|{type:'learn',move}|{type:'evolve',to}]
export function addXp(mon, amount) {
  const ev = [];
  mon.xp += Math.floor(amount);
  while (mon.lv < 100 && mon.xp >= xpForLevel(mon.sp, mon.lv + 1)) {
    mon.lv++;
    const old = calcStats(mon.sp, mon.lv - 1, mon.ivs, mon.sexp), now = calcStats(mon.sp, mon.lv, mon.ivs, mon.sexp);
    Object.assign(mon, now);
    mon.hp = clamp(mon.hp + (now.maxhp - old.maxhp), 1, now.maxhp);
    ev.push({ type: "level", lv: mon.lv });
    for (const [l, m] of DEX[mon.sp].learnset) if (l === mon.lv && !mon.moves.includes(m)) ev.push({ type: "learn", move: m });
    const evo = (DEX[mon.sp].evos || []).filter((e) => mon.lv >= e.level);
    if (evo.length) ev.push({ type: "evolve", to: evo[0].random ? choice(evo).to : evo[0].to });
  }
  return ev;
}
export function evolveMon(mon, to) {
  const oldMax = mon.maxhp;
  mon.sp = to;
  Object.assign(mon, calcStats(to, mon.lv, mon.ivs, mon.sexp));
  mon.hp = clamp(mon.hp + (mon.maxhp - oldMax), 1, mon.maxhp);
}
export function refreshPP(mon) { mon.pp = mon.moves.map((id) => MOVES[id].pp); }

// --------------------------------------------- Red/Blue encounter tables
// Per-zone spawn pools: [species, weight, minLv, maxLv, flag]
// flag: "N" night only, "D" day only, "n" boosted at night.
const Z = (pool, water = null) => ({ pool, water });
export const SPAWNS = {
  pallet: Z([[16, 35, 2, 4], [19, 35, 2, 4], [1, 1.2, 5, 5], [114, 5, 22, 26]]),
  "route-1": Z([[16, 45, 2, 5], [19, 45, 2, 4], [21, 10, 3, 5]]),
  "route-21": Z(
    [[114, 22, 22, 30], [16, 22, 5, 12], [19, 18, 5, 10], [21, 10, 8, 14], [43, 8, 8, 14, "n"]],
    [[72, 35, 5, 25], [129, 22, 5, 15], [116, 10, 12, 24], [90, 8, 16, 26], [120, 8, 14, 24]]
  ),
  "route-22": Z([[19, 25, 2, 5], [21, 20, 3, 5], [32, 20, 3, 5], [29, 20, 3, 5], [56, 12, 3, 6]]),
  viridian: Z([[16, 40, 4, 7], [19, 30, 4, 6], [21, 12, 5, 7]]),
  "route-2": Z([[16, 25, 3, 6], [19, 25, 3, 6], [10, 16, 3, 5], [13, 16, 3, 5], [29, 6, 4, 7], [32, 6, 4, 7], [122, 0.6, 12, 12]]),
  "viridian-forest": Z([[10, 30, 3, 6], [13, 30, 3, 6], [11, 9, 5, 7], [14, 9, 5, 7], [25, 5, 3, 6], [17, 1.6, 9, 11]]),
  pewter: Z([[16, 35, 6, 10], [21, 25, 7, 10], [39, 7, 5, 9], [56, 8, 7, 10]]),
  "route-3": Z([[21, 30, 6, 9], [16, 20, 6, 9], [39, 12, 6, 9], [56, 12, 7, 10], [27, 14, 7, 10], [19, 12, 6, 8]]),
  "mt-moon": Z([[21, 25, 8, 12], [74, 30, 8, 12], [27, 18, 8, 12], [41, 14, 8, 12, "n"], [46, 7, 8, 10]]),
  "mtmoon-cave": Z([[41, 40, 7, 11], [74, 25, 8, 12], [46, 12, 8, 10], [35, 8, 9, 12, "n"], [95, 4, 10, 13], [138, 1, 10, 12], [140, 1, 10, 12], [142, 0.5, 15, 15]]),
  "route-4": Z([[21, 25, 8, 12], [23, 18, 8, 12], [27, 18, 8, 12], [19, 15, 8, 11], [56, 10, 9, 12], [22, 4, 16, 20]]),
  cerulean: Z([[63, 10, 8, 12], [16, 30, 8, 12], [19, 20, 8, 11], [39, 6, 8, 11]]),
  "route-24": Z([[10, 8, 7, 12], [13, 8, 7, 12], [16, 15, 9, 13], [17, 5, 12, 16], [43, 18, 9, 14, "n"], [69, 18, 9, 14], [63, 10, 8, 12], [48, 8, 11, 14, "N"], [133, 0.7, 12, 12]]),
  "cerulean-cave": Z([[42, 20, 46, 55], [64, 12, 49, 58], [112, 8, 52, 58], [105, 8, 49, 55], [28, 10, 50, 56], [24, 8, 48, 54], [47, 8, 48, 54], [26, 5, 50, 56], [113, 3, 50, 56], [132, 8, 48, 58], [40, 5, 48, 54], [49, 6, 48, 55], [85, 6, 50, 56]]),
  "power-plant": Z([[100, 30, 20, 25], [81, 30, 20, 25], [25, 10, 20, 24], [82, 5, 28, 32], [125, 6, 30, 35], [88, 8, 20, 26], [109, 6, 20, 26], [89, 1, 32, 36], [110, 0.8, 32, 36], [101, 3, 33, 40], [26, 2, 28, 32], [137, 1.2, 22, 26]]),
  lavender: Z([[92, 35, 18, 22, "n"], [104, 12, 17, 20], [93, 5, 22, 26, "n"], [19, 14, 16, 20], [96, 7, 17, 21]]),
  "route-5": Z([[16, 30, 13, 16], [43, 24, 13, 16], [52, 18, 12, 15], [56, 14, 13, 16], [63, 5, 15, 18]]),
  "route-6": Z(
    [[16, 30, 13, 17], [43, 24, 13, 16], [52, 18, 13, 16], [56, 14, 14, 17], [63, 5, 15, 18]],
    [[54, 25, 15, 20], [60, 22, 14, 20], [129, 18, 6, 14], [118, 12, 12, 18]]
  ),
  "route-7": Z([[16, 24, 17, 20], [43, 18, 18, 22], [52, 18, 17, 20], [58, 12, 18, 22], [63, 10, 17, 20], [23, 8, 17, 19]]),
  "route-8": Z([[16, 12, 16, 20], [17, 6, 18, 22], [19, 12, 15, 18], [20, 8, 18, 22], [58, 10, 16, 21], [37, 10, 16, 21], [52, 12, 17, 21, "n"], [96, 8, 15, 19], [63, 5, 15, 18], [83, 3, 18, 22], [53, 2, 22, 26], [143, 0.4, 30, 30]]),
  "route-9": Z([[21, 28, 14, 18], [23, 18, 14, 17], [27, 18, 14, 17], [19, 14, 14, 16], [56, 12, 15, 18], [74, 8, 15, 18]]),
  "route-10": Z(
    [[21, 24, 14, 18], [100, 22, 14, 18], [23, 14, 14, 17], [27, 14, 14, 17], [81, 10, 15, 18], [66, 8, 15, 18]],
    [[60, 25, 12, 18], [54, 12, 14, 20], [118, 20, 12, 18], [129, 16, 5, 12], [55, 2, 25, 30]]
  ),
  "rock-tunnel": Z([[41, 35, 15, 18], [74, 30, 15, 18], [66, 14, 15, 17], [95, 9, 15, 18], [35, 7, 15, 17, "n"], [46, 4, 15, 17]]),
  "route-11": Z([[96, 30, 9, 15], [23, 15, 12, 15], [21, 15, 12, 15], [19, 12, 11, 14], [97, 1, 26, 30]]),
  "route-12": Z(
    [[16, 16, 23, 27], [17, 7, 25, 29], [43, 20, 22, 26], [44, 8, 26, 30], [48, 14, 24, 28], [83, 7, 24, 28], [143, 0.5, 30, 30, "D"]],
    [[72, 28, 5, 25], [118, 20, 10, 20], [60, 14, 15, 22], [129, 14, 5, 15], [54, 8, 15, 22], [80, 1.2, 30, 34]]
  ),
  "route-15": Z([[16, 16, 23, 27], [43, 20, 22, 26], [44, 10, 26, 30], [48, 14, 24, 28], [49, 4, 28, 32], [132, 3, 23, 27], [63, 6, 22, 26]]),
  "cycling-road": Z([[21, 30, 20, 26], [84, 20, 22, 28], [20, 14, 23, 29], [22, 7, 26, 32], [19, 10, 20, 24], [143, 0.4, 32, 32, "D"]]),
  "route-23": Z([[19, 14, 32, 38], [21, 14, 30, 36], [22, 8, 34, 40], [56, 14, 32, 38], [57, 5, 38, 42], [24, 10, 32, 38], [28, 6, 36, 40], [74, 12, 32, 38]]),
  diglett: Z([[50, 85, 17, 22], [51, 6, 29, 31]]),
  vermilion: Z([[16, 25, 16, 20], [52, 12, 16, 20], [66, 8, 17, 21], [81, 8, 16, 20], [7, 1.2, 16, 16]]),
  saffron: Z([[16, 25, 17, 22], [52, 18, 17, 22], [63, 14, 17, 24], [96, 12, 17, 22], [122, 1.5, 24, 26]]),
  celadon: Z(
    [[16, 22, 17, 22], [43, 16, 17, 23], [69, 14, 17, 23], [52, 10, 17, 22], [88, 7, 19, 25], [109, 4, 20, 26], [114, 5, 22, 26]],
    [[54, 25, 18, 24], [60, 20, 16, 22], [129, 20, 8, 14], [88, 6, 22, 28]]
  ),
  fuchsia: Z([[16, 22, 20, 26], [48, 14, 22, 28], [102, 12, 22, 28], [84, 10, 24, 28], [123, 3, 25, 30], [113, 3, 24, 27]]),
  cinnabar: Z(
    [[58, 18, 30, 36], [37, 16, 28, 34], [77, 14, 30, 36], [88, 12, 30, 36], [109, 10, 30, 36], [20, 10, 30, 36], [126, 1.6, 34, 38], [132, 2.5, 30, 34]],
    [[72, 35, 25, 35], [116, 12, 25, 33], [90, 10, 26, 34], [120, 10, 25, 33], [80, 1.5, 30, 36]]
  ),
  indigo: Z([[66, 20, 38, 44], [74, 20, 38, 44], [95, 10, 40, 45], [64, 6, 40, 45], [42, 10, 38, 44, "n"], [126, 1.5, 40, 44], [125, 1.5, 40, 44], [113, 3, 40, 44]]),
  safari: Z(
    [[32, 12, 22, 30], [29, 12, 22, 30], [33, 6, 28, 32], [30, 6, 28, 32], [102, 12, 24, 28], [111, 8, 25, 30], [47, 4, 27, 30], [48, 8, 22, 26], [49, 3, 30, 33], [104, 8, 24, 28], [105, 2, 28, 32], [108, 4, 25, 28], [113, 2, 23, 26], [115, 4, 25, 28], [123, 3, 25, 28], [127, 3, 25, 28], [128, 5, 26, 30], [84, 6, 24, 28], [44, 5, 25, 29], [70, 4, 25, 29]],
    [[54, 20, 22, 28], [79, 20, 22, 28], [60, 15, 20, 26], [147, 10, 15, 25], [148, 2, 25, 30], [129, 15, 8, 14], [118, 10, 18, 24]]
  ),
  seafoam: Z(
    [[86, 30, 26, 34], [87, 5, 32, 38], [124, 5, 28, 32], [98, 8, 24, 30], [90, 8, 26, 32]],
    [[90, 15, 26, 32], [72, 15, 24, 30], [120, 8, 26, 32], [116, 8, 24, 30], [91, 2, 32, 36], [131, 2, 24, 30], [129, 10, 8, 14]]
  ),
  "victory-road": Z([[66, 22, 24, 34], [74, 22, 26, 34], [95, 12, 30, 40], [41, 12, 24, 32, "n"], [42, 6, 32, 38], [67, 5, 38, 42], [75, 5, 36, 41], [105, 4, 37, 40], [57, 4, 34, 40], [77, 8, 28, 35], [106, 0.7, 30, 30], [107, 0.7, 30, 30], [126, 1.2, 32, 36], [4, 0.7, 18, 18]]),
  sea: Z(null, [[72, 45, 5, 25], [129, 20, 5, 15], [116, 10, 10, 20], [90, 8, 12, 22], [120, 8, 12, 25], [73, 2, 25, 32], [80, 1.5, 28, 34], [99, 3, 25, 30], [117, 2, 28, 32], [131, 0.8, 18, 28], [55, 1, 30, 35]]),
  river: Z(null, [[60, 30, 10, 20], [118, 25, 10, 20], [54, 12, 15, 22], [129, 18, 5, 12], [98, 8, 12, 18], [61, 3, 20, 26], [119, 3, 20, 26], [55, 1, 28, 32], [130, 0.6, 22, 28]]),
  grassland: Z([[16, 30, 4, 10], [19, 25, 4, 10], [21, 12, 5, 10], [43, 8, 6, 10, "n"], [39, 3, 6, 10]]),
};
// reverse index: species -> zones where it can be found (for the Pokédex)
export const SPECIES_ZONES = (() => {
  const out = {};
  const add = (sp, zone) => { (out[sp] = out[sp] || new Set()).add(zone); };
  for (const [zone, def] of Object.entries(SPAWNS)) {
    for (const e of def.pool || []) add(e[0], zone);
    for (const e of def.water || []) add(e[0], zone);
  }
  add(144, "seafoam"); add(145, "power-plant"); add(146, "victory-road");
  add(150, "cerulean-cave"); add(151, "vermilion");
  return out;
})();

export function monSize(sp) { return clamp(0.55 + DEX[sp].height * 0.075, 0.7, 4.6); }

// ----------------------------------------------- species movement traits
// How fast a Pokémon moves on the battlefield. Driven by its actual Speed
// stat and its body plan: fish rule the water and flop on land, birds and
// levitators glide anywhere, big heavy bodies lumber.
export function battleSpeedFor(sp: number, lv: number, spe: number, opts: { water?: boolean } = {}) {
  const arch = MON3D_SPECS[sp]?.arch;
  const flier = MON3D_SPECS[sp]?.levitate || ["bird", "bat", "wingbug", "ghost", "floaty", "star"].includes(arch) || DEX[sp].types.includes("flying");
  const aquatic = DEX[sp].types.includes("water") || arch === "fish" || arch === "tentacle";
  let v = 2.2 + Math.min(spe, 200) * 0.038;            // spe 30 → 3.3, 110 → 6.4
  v *= clamp(1.25 - DEX[sp].height * 0.04, 0.72, 1.1);  // big bodies lumber
  if (opts.water) {
    if (aquatic) v *= 1.5;            // in their element
    else if (flier) v *= 1.0;         // glides right over
    else v *= 0.45;                   // wading through
  } else {
    if (arch === "fish") v *= 0.35;   // a fish out of water...
    if (flier) v *= 1.08;
  }
  return clamp(v, 0.9, 9.5);
}
export function monTemper(sp: number) { return DEX[sp].temper || "calm"; }
// does this species drift over deep water instead of sinking in?
export function floatsOverWater(sp: number) {
  const arch = MON3D_SPECS[sp]?.arch;
  return !!MON3D_SPECS[sp]?.levitate || ["bird", "bat", "wingbug", "ghost", "floaty", "star"].includes(arch) || DEX[sp].types.includes("flying");
}

// Where does this species actually LIVE? They're animals, after all: birds own
// the sky, fish own the water, bug larvae cling to the trees, and the small
// grassland crowd rustles around the tall grass. Everyone else walks the land.
// (Legendaries ignore all of this — they appear at their fixed shrines.)
export type Habitat = "sky" | "tree" | "water" | "grass" | "ground";
const HAB_OVERRIDE: Record<number, Habitat> = {
  84: "ground", 85: "ground",     // Doduo/Dodrio: birds that famously can't fly
  41: "sky", 42: "sky",           // Zubat line hunts on the wing
};
export function habitatFor(sp: number): Habitat {
  const o = HAB_OVERRIDE[sp];
  if (o) return o;
  const d = DEX[sp], spec = MON3D_SPECS[sp] || ({} as any), arch = spec.arch;
  if (arch === "fish" || arch === "tentacle" || d.habitat === "sea") return "water";
  if (d.types.includes("water") && d.habitat === "waters-edge") return "water";
  if (arch === "bird" || arch === "bat" || arch === "wingbug") return "sky";
  if (arch === "larva" || arch === "cocoon") return "tree";
  if (d.types.includes("bug") && d.habitat === "forest") return "tree";
  if ((d.habitat === "grassland" || d.habitat === "forest") && d.height <= 14 && !d.types.includes("rock") && !d.types.includes("ground")) return "grass";
  return "ground";
}

// Every species fights with its own signature maneuver — the thing it does
// when it needs to NOT be where an attack is about to land. Drives both the
// enemy brain and the flavor of YOUR dash when you're possessing it.
//   teleport  Abra line & co: vanish, reappear somewhere else entirely
//   blink     ghosts: phase out for a beat, slide sideways through space
//   burrow    moles & rock bodies: duck under the ground (attacks pass over)
//   swoop     birds: take to the air in an arc, then dive back in
//   dive      sea creatures: slip under the surface when in deep water
//   brace     the big heavies: don't dodge at all — plant and TAKE it
//   zigzag    small fast things: erratic darting, short dash cooldown
const TELEPORTERS = new Set([63, 64, 65, 96, 97, 122, 150, 151]);
const BURROWERS = new Set([27, 28, 50, 51, 74, 75, 76, 95, 104, 105, 111, 112]);
const BRACERS = new Set([143, 131, 80, 89, 34, 31]);
export function speciesSkill(sp: number): "teleport" | "blink" | "burrow" | "swoop" | "dive" | "brace" | "zigzag" | "none" {
  const d = DEX[sp], spec = MON3D_SPECS[sp] || ({} as any);
  if (TELEPORTERS.has(sp)) return "teleport";
  if (d.types.includes("ghost")) return "blink";
  if (BURROWERS.has(sp) || (d.types.includes("ground") && !d.types.includes("flying"))) return "burrow";
  if (spec.arch === "bird" || d.types.includes("flying")) return "swoop";
  if (spec.arch === "fish" || spec.arch === "tentacle" || (d.types.includes("water") && d.habitat === "sea")) return "dive";
  if (BRACERS.has(sp) || d.height >= 17) return "brace";
  if (d.base.spe >= 90 && d.height <= 10) return "zigzag";
  return "none";
}
export const SKILL_LABEL = { teleport: "Teleport", blink: "Blink", burrow: "Burrow", swoop: "Swoop", dive: "Dive", brace: "Brace", zigzag: "Dart", none: "Dash" };
// Battle experience: a Lv50 veteran reads the fight better than a Lv5 hatchling
// — quicker reactions, better aim leads, tighter move timing.
export function expFactorFor(lv: number) { return clamp((lv - 5) / 45, 0, 1); }

// ----------------------------------------------------------- world entity
// Every Pokémon in the world is a procedural 3D rig (see monmodel.ts) with
// its own animator. The classic sprites only appear in the 2D UI.
const hitProxyMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
const hitProxyGeo = new THREE.BoxGeometry(1, 1, 1);
class MonEntity {
  game: Game;
  mon: Mon;
  size: number;
  halfH: number;
  base: THREE.Vector3;
  off: THREE.Vector3;
  group: THREE.Group;
  obj: THREE.Group;
  rig: MonRig;
  hitMesh: THREE.Mesh;
  shadow: THREE.Mesh;
  tintT: number; tintDur: number; tintC: THREE.Color;
  shakeT: number; shakeAmp: number;
  pulseT: number; pulseA: number;
  dead: boolean;
  isWater: boolean;
  faceYaw: number;
  faceTo: THREE.Vector3 | null = null;
  forceYaw: number | null = null;   // possession: face exactly where the player looks
  floats: boolean;                  // birds/ghosts/levitators glide over deep water
  phasedT = 0;                      // burrowed/submerged/blinked: attacks pass through
  velX = 0; velZ = 0;               // smoothed world velocity (AI lead-targeting)
  private prevX: number; private prevZ: number;
  private opacity = 1;

  constructor(game, mon, pos, _opts = {}) {
    this.game = game;
    this.mon = mon;
    this.size = monSize(mon.sp);
    this.halfH = this.size / 2;
    this.base = pos.clone();
    this.off = V3();
    this.group = new THREE.Group();
    this.obj = this.group;
    this.rig = buildMonRig(mon.sp, this.size);
    this.hitMesh = new THREE.Mesh(hitProxyGeo, hitProxyMat);
    this.hitMesh.scale.set(this.size * 0.78, this.size, this.size * 0.78);
    this.hitMesh.position.y = this.halfH;
    const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false });
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(this.size * 0.32, 16), shadowMat);
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.05;
    this.group.add(this.rig.group, this.hitMesh, this.shadow);
    this.group.position.copy(pos);
    game.scene.add(this.group);
    this.tintT = 0; this.tintDur = 1; this.tintC = new THREE.Color(1, 1, 1);
    this.shakeT = 0; this.shakeAmp = 0;
    this.pulseT = 0; this.pulseA = 1;
    this.dead = false;
    this.isWater = DEX[mon.sp].types.includes("water") && (DEX[mon.sp].habitat === "sea" || DEX[mon.sp].habitat === "waters-edge");
    this.floats = floatsOverWater(mon.sp);
    this.faceYaw = rnd(Math.PI * 2);
    this.prevX = pos.x; this.prevZ = pos.z;
  }
  pos() { return this.group.position.clone().add(V3(0, this.halfH, 0)); }
  feet() { return this.group.position.clone(); }
  eye() { return this.group.position.clone().add(V3(0, this.halfH * 1.72, 0)); }
  // possession camera anchor: tiny species keep their flavor but you still
  // get a vantage you can actually fight from (no grass-blade cam)
  povEye() {
    const e = this.eye();
    e.y = Math.max(e.y, this.group.position.y + 1.0);
    return e;
  }
  tintFlash(col, dur) { this.tintC.set(col); this.tintT = this.tintDur = dur; }
  shake(amp, dur) { this.shakeAmp = amp; this.shakeT = dur; }
  pulse(a) { this.pulseT = 0.45; this.pulseA = a; }
  setOpacity(o) {
    this.opacity = o;
    this.rig.setOpacity(o);
    (this.shadow.material as THREE.Material).opacity = 0.3 * o;
  }
  // rebuild the rig in place (evolution, Transform)
  setSpecies(sp: number) {
    this.group.remove(this.rig.group);
    this.rig.dispose();
    this.size = monSize(sp);
    this.halfH = this.size / 2;
    this.rig = buildMonRig(sp, this.size);
    this.rig.setOpacity(this.opacity);
    this.group.add(this.rig.group);
    this.hitMesh.scale.set(this.size * 0.78, this.size, this.size * 0.78);
    this.hitMesh.position.y = this.halfH;
    this.shadow.geometry = new THREE.CircleGeometry(this.size * 0.32, 16);
  }
  lookToward(p: THREE.Vector3) {
    this.faceTo = (this.faceTo || V3()).copy(p);
  }
  // flush base -> group immediately; pos() must be truthful the same frame
  // (habitat placement moves base in the constructor, and a throw can target
  // the mon before its first update tick)
  syncNow() {
    this.group.position.copy(this.base);
    this.prevX = this.group.position.x;
    this.prevZ = this.group.position.z;
  }
  knock(dir, amt) {
    this.base.addScaledVector(dir, amt);
    this.game.world.collide(this.base, 0.5);
    this.snapGround();
  }
  snapGround() {
    const w = this.game.world;
    const h = w.height(this.base.x, this.base.z);
    if (h < w.waterY - 0.4) {
      this.base.y = this.isWater ? w.waterY - 0.15 : this.floats ? w.waterY + 0.12 : Math.max(h, w.waterY - 0.85);
    } else this.base.y = h;
  }
  updateVisual(dt) {
    // squash & stretch pulse (capture feedback, petting, hops)
    let sq = 0;
    if (this.pulseT > 0) {
      this.pulseT -= dt;
      sq = Math.sin((0.45 - this.pulseT) / 0.45 * Math.PI) * (1 - this.pulseA) * 0.6;
    }
    this.rig.group.scale.set(1 + sq, 1 - sq, 1 + sq);
    // phased (burrowed / dived / blinked): translucent and untouchable
    if (this.phasedT > 0 && !this.dead) {
      this.phasedT -= dt;
      this.setOpacity(this.phasedT > 0 ? 0.3 : 1);
    }
    let shx = 0, shz = 0;
    if (this.shakeT > 0) { this.shakeT -= dt; shx = (Math.random() - 0.5) * this.shakeAmp; shz = (Math.random() - 0.5) * this.shakeAmp; }
    if (this.tintT > 0) {
      this.tintT -= dt;
      this.rig.tint(this.tintC, Math.max(0, this.tintT / this.tintDur));
    } else this.rig.tint(this.tintC, 0);
    this.group.position.set(this.base.x + this.off.x + shx, this.base.y + Math.max(-this.base.y, this.off.y), this.base.z + this.off.z + shz);
    // facing: turn toward movement, or a look target when standing still
    const mvx = this.group.position.x - this.prevX, mvz = this.group.position.z - this.prevZ;
    const sp = dt > 0 ? Math.hypot(mvx, mvz) / dt : 0;
    if (dt > 0) {
      const k = Math.min(1, dt * 8);
      this.velX += (mvx / dt - this.velX) * k;
      this.velZ += (mvz / dt - this.velZ) * k;
    }
    let want = this.faceYaw;
    if (this.forceYaw != null) want = this.forceYaw;            // possessed: camera is boss
    else if (sp > 0.45) want = Math.atan2(mvx, mvz);
    else if (this.faceTo) want = Math.atan2(this.faceTo.x - this.base.x, this.faceTo.z - this.base.z);
    let diff = want - this.faceYaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.faceYaw += clamp(diff, -dt * (this.forceYaw != null ? 16 : 7), dt * (this.forceYaw != null ? 16 : 7));
    this.rig.group.rotation.y = this.faceYaw;
    this.prevX = this.group.position.x; this.prevZ = this.group.position.z;
    // drive the procedural animator
    const w = this.game.world;
    const inWater = this.base.y < w.waterY - 0.05 && w.height(this.base.x, this.base.z) < w.waterY - 0.4;
    this.rig.anim(dt, { speed: sp, water: inWater });
  }
  dispose() {
    this.dead = true;
    this.game.scene.remove(this.group);
    this.rig.dispose();
    (this.shadow.material as THREE.Material).dispose();
  }
  fadeOut(cb?) {
    const fx = this.game.fx;
    fx.anim(0.5, (k) => this.setOpacity(1 - k), () => { this.dispose(); cb && cb(); });
  }
}

class WildMon extends MonEntity {
  species: any;
  state: string;
  thinkT: number;
  target: THREE.Vector3;
  life: number;
  engaged: boolean;
  captureLock: boolean;
  ballCooldown: number;
  aggroT: number;
  legend: boolean;
  fleeT = 0;
  ringSeed = Math.random() * 9;
  // ---- habitat (v10): birds fly, fish swim, larvae perch, legends hold court
  habitat: Habitat;
  air = false;             // currently airborne
  alt = 0;                 // current hover height above ground/water
  altT = 0;                // hover height it's drifting toward
  perched = false;         // sitting on a tree branch
  perchY = 0;
  home: THREE.Vector3 | null = null;   // grass cluster / shrine it sticks near
  bobP = rnd(9);
  hopping = false;         // mid tree-hop animation
  sessile = false;         // cocoons: hardened on, going nowhere
  // ---- ambient life (v11): left alone, wilds graze, nap and drink
  ambient: "" | "graze" | "nap" | "drink" = "";
  ambientT = 0;            // time left in the current bit
  ambientFxT = 0;          // throttles nibble pulses / Zzz / ripples
  cryT = rnd(30, 8);       // seconds until this one calls out across the field

  constructor(game, mon, pos, opts: any = {}) {
    super(game, mon, pos);
    this.species = DEX[mon.sp];
    if (opts.water) this.isWater = true;
    this.state = "idle";
    this.thinkT = rnd(2);
    this.target = pos.clone();
    this.life = 120 + rnd(60);
    this.engaged = false;
    this.captureLock = false;
    this.ballCooldown = 0;
    this.aggroT = 0;
    this.legend = this.species.rarity === "legendary";
    this.habitat = habitatFor(mon.sp);
    this.sessile = MON3D_SPECS[mon.sp]?.arch === "cocoon";   // Metapod hardens, Metapod stays
    this.placeForHabitat(opts);
    this.snapGround();
    this.syncNow();   // habitat placement moved base; pos() must agree this frame
  }
  // nudge the spawn point into this species' element: water mons into the
  // nearest pool, perchers into a canopy, grass dwellers toward tall grass,
  // fliers up into the air. Legends keep their shrine as a fixed anchor.
  placeForHabitat(opts: any) {
    const w = this.game.world;
    if (this.legend) {
      this.home = this.base.clone();
      if (this.habitat === "sky") { this.air = true; this.altT = 4 + this.size * 0.5; this.alt = this.altT; }
      else this.habitat = "ground";
      return;
    }
    if (this.habitat === "water") {
      // even species pre-flagged isWater can roll a spawn point on dry land —
      // what matters is whether the water HERE is deep enough to swim in
      if (w.height(this.base.x, this.base.z) >= w.waterY - 0.55) {
        // find swimmable water near the spawn point
        let best: THREE.Vector3 | null = null;
        for (let r = 4; r <= 22 && !best; r += 4.5) {
          for (let a = 0; a < 10; a++) {
            const ang = (a / 10) * Math.PI * 2 + r;
            const x = this.base.x + Math.cos(ang) * r, z = this.base.z + Math.sin(ang) * r;
            if (w.height(x, z) < w.waterY - 0.55) { best = V3(x, 0, z); break; }
          }
        }
        if (best) { this.base.x = best.x; this.base.z = best.z; this.isWater = true; }
        else { this.habitat = "ground"; this.isWater = false; }   // a fish out of water settles for the shore
      } else this.isWater = true;
      this.home = this.base.clone();
    } else if (this.habitat === "sky") {
      this.air = true;
      this.altT = 3.2 + this.size * 0.6 + rnd(2.8);
      this.alt = this.altT * rnd(1, 0.6);
    } else if (this.habitat === "tree") {
      const t = w.treesNear(this.base, 17, 1)[0];
      if (t) {
        const a = rnd(Math.PI * 2);
        this.base.x = t.x + Math.cos(a) * 1.55 * t.s;
        this.base.z = t.z + Math.sin(a) * 1.55 * t.s;
        this.perched = true;
        this.perchY = t.h + 2.05 * t.s;
      } else this.habitat = "grass";    // no trees around: hide in the grass instead
    }
    if (this.habitat === "grass") {
      let best: THREE.Vector3 | null = null, bd = 30;
      for (const c of w.grassClusters) {
        const d = Math.hypot(c.x - this.base.x, c.z - this.base.z);
        if (d < bd) { bd = d; best = c; }
      }
      if (best) {
        const a = rnd(Math.PI * 2), r = rnd(5);
        this.base.x = best.x + Math.cos(a) * r;
        this.base.z = best.z + Math.sin(a) * r;
        this.home = best.clone();
      }
    }
  }
  // ground rules differ by element: fliers ride their hover height,
  // perchers sit at branch height, swimmers bob on the surface
  snapGround() {
    const w = this.game.world;
    if (this.air) {
      const s = Math.max(w.height(this.base.x, this.base.z), w.waterY);
      this.base.y = s + Math.max(0.35, this.alt);
      return;
    }
    if (this.perched) { this.base.y = this.perchY; return; }
    super.snapGround();
    if (this.isWater && !this.captureLock && this.base.y <= w.waterY) {
      this.base.y += Math.sin(this.bobP * 1.6) * 0.05;
    }
  }
  // swoop/drop to the ground — battles are fought at ground level
  land() {
    if (this.perched) this.pulse(0.8);    // a little landing squash
    this.perched = false;
    this.hopping = false;
    if (this.air) {
      const a0 = this.alt;
      this.game.fx.anim(0.55, (k) => {
        this.alt = a0 * (1 - k);
        if (!this.dead) this.snapGround();
      }, () => { this.air = false; this.alt = 0; if (!this.dead) this.snapGround(); });
    } else if (!this.dead) this.snapGround();
  }
  takeOff() {
    if (this.habitat !== "sky" || this.air || this.dead) return;
    this.air = true;
    this.alt = 0.4;
    this.altT = 3.2 + this.size * 0.6 + rnd(2.8);
  }
  // perchers occasionally flutter/crawl over to a neighboring canopy
  hopTree() {
    const w = this.game.world;
    const opts = w.treesNear(this.base, 20, 4).filter((t) => Math.hypot(t.x - this.base.x, t.z - this.base.z) > 2.5);
    if (!opts.length) return;
    const t = choice(opts);
    const a = rnd(Math.PI * 2);
    const from = this.base.clone();
    const to = V3(t.x + Math.cos(a) * 1.55 * t.s, t.h + 2.05 * t.s, t.z + Math.sin(a) * 1.55 * t.s);
    this.hopping = true;
    this.perched = false;
    this.game.fx.anim(0.85, (k) => {
      if (this.dead || this.captureLock) return;
      this.base.copy(from).lerp(to, k);
      this.base.y += Math.sin(k * Math.PI) * 1.6;   // arcing flutter
    }, () => {
      if (this.dead || this.captureLock) return;
      this.hopping = false;
      this.perched = true;
      this.perchY = to.y;
      this.base.copy(to);
    });
  }
  update(dt) {
    this.updateVisual(dt);
    // the shadow stays pinned to the ground below, even when the mon is
    // riding a thermal or sitting in a canopy — that's how you spot them
    const wld = this.game.world;
    const gy = Math.max(wld.height(this.base.x, this.base.z), wld.waterY);
    const lift = this.base.y - gy;
    this.shadow.position.y = -lift + 0.06;
    const sh = clamp(1 - lift * 0.07, 0.45, 1);
    this.shadow.scale.set(sh, sh, 1);
    if (this.captureLock || this.dead) return;
    this.bobP += dt;
    this.ballCooldown -= dt;
    if (this.air) this.alt += (this.altT - this.alt) * Math.min(1, dt * 1.1);
    const g = this.game, p = g.playerPos;
    const d = Math.hypot(p.x - this.base.x, p.z - this.base.z);
    if (this.engaged) { this.thinkT = 1; this.ambient = ""; return; }
    if (this.hopping) return;                            // mid-flutter: let the arc play
    this.life -= dt;
    // out-of-battle regen
    this.mon.hp = Math.min(this.mon.maxhp, this.mon.hp + this.mon.maxhp * dt * 0.005);
    // ambient idle cries — the fields sound alive; closer carries louder,
    // sleepers stay quiet, and nobody calls out mid-flee
    this.cryT -= dt;
    if (this.cryT <= 0) {
      this.cryT = rnd(46, 22);
      if (d < 42 && this.ambient !== "nap" && this.state !== "flee" && !g.battle) {
        g.audio.cry(this.mon.sp, this.species.height, clamp(1 - d / 48, 0.12, 0.5));
        this.pulse(1.06);                                // a visible little call
      }
    }
    // ---- ambient bits: play out until they finish or you get too close
    if (this.ambient) {
      this.ambientT -= dt;
      const tooClose = d < (this.ambient === "nap" ? 6.5 : 9);
      if (this.ambientT <= 0 || tooClose) {
        if (tooClose && this.ambient === "nap") {
          this.pulse(1.18);                              // startled awake!
          this.game.ui.floatAt(this.pos(), "!", "status");
        }
        this.ambient = "";
        this.thinkT = rnd(1.2, 0.5);
      } else {
        this.ambientFxT -= dt;
        if (this.ambientFxT <= 0) {
          const fx = this.game.fx;
          if (this.ambient === "graze") {
            this.ambientFxT = rnd(1.6, 1.0);
            this.pulse(0.9);                             // head-down nibble
            fx.burst(this.base.clone(), { count: 3, col: "#7ed321", speed: 0.8, size: 0.12, life: 0.4, g: -1 });
          } else if (this.ambient === "nap") {
            this.ambientFxT = 1.7;
            fx.conditionTick(this, "slp");               // drifting Zzz
          } else {
            this.ambientFxT = rnd(1.6, 1.1);
            this.pulse(0.93);                            // lowered muzzle, lapping
            fx.burst(this.pos(), { count: 4, col: "#9fd2ff", speed: 0.9, size: 0.12, life: 0.4, g: -2 });
          }
        }
        return;                                          // busy: no wandering, no watching
      }
    }
    const temper = this.species.temper;
    if (temper === "skittish" && d < 9 && this.state !== "flee" && !this.sessile) {
      this.state = "flee"; this.fleeT = 2.4;
      if (this.perched) this.land();                       // startled out of the tree
      if (this.air) this.altT = Math.min(9.5, this.altT + 3.2);  // climb out of reach
    }
    // a cocoon's entire strategy: clench and wait for wings
    if (this.sessile && d < 6 && Math.random() < dt * 0.5) this.pulse(0.88);
    if (temper === "aggressive" && d < 13 && !g.battle && g.activeMon() && !(g.state.repelT > 0)) {
      if (this.state !== "aggro" && this.perched) this.land();
      this.state = "aggro";
    }
    this.thinkT -= dt;
    if (this.thinkT <= 0 && this.state !== "flee" && this.state !== "aggro") {
      this.thinkT = rnd(3.4, 1.2);
      if (this.sessile) {
        this.state = "idle";
      } else if (this.perched) {
        // branch life: mostly stillness, sometimes a flutter to the next tree
        if (Math.random() < 0.22) this.hopTree();
        this.state = "idle";
      } else if (!this.air && !this.legend && d > 13 && Math.random() < 0.34) {
        // far from prying eyes, wilds settle into little routines:
        // nap under the moon, lap at the shoreline, graze the meadow
        let nearWater = false;
        if (!this.isWater) {
          for (let a = 0; a < 8 && !nearWater; a++) {
            const ang = (a / 8) * Math.PI * 2;
            if (g.world.height(this.base.x + Math.cos(ang) * 3.4, this.base.z + Math.sin(ang) * 3.4) < g.world.waterY - 0.25) nearWater = true;
          }
        }
        if (!this.isWater && g.world.isNight() && Math.random() < 0.55) { this.ambient = "nap"; this.ambientT = rnd(14, 8); }
        else if (nearWater && Math.random() < 0.6) { this.ambient = "drink"; this.ambientT = rnd(7, 4); }
        else if (!this.isWater) { this.ambient = "graze"; this.ambientT = rnd(7, 4); }
        this.ambientFxT = 0.4;
        this.state = "idle";
      } else if (Math.random() < (this.air ? 0.8 : 0.55)) {
        const wanderR = this.legend ? 7 : this.air ? 15 : 9;
        const a = rnd(Math.PI * 2), dist = rnd(wanderR, 2);
        const anchor = this.home && Math.random() < 0.65 ? this.home : this.base;
        const t = V3(anchor.x + Math.cos(a) * dist, 0, anchor.z + Math.sin(a) * dist);
        const h = g.world.height(t.x, t.z);
        let ok: boolean;
        if (this.air) {
          ok = true;                                       // the sky has no fences
          this.altT = clamp(this.altT + rnd(2.4, -2.4), 2.2, 8.5);
        } else if (this.isWater) {
          ok = h < g.world.waterY - 0.45;                  // stay in the swimmable deep
        } else {
          const biomeOK = g.world.biomeAt(t.x, t.z) === g.world.biomeAt(this.base.x, this.base.z);
          ok = biomeOK && h > g.world.waterY - 0.2;
        }
        if (ok) { this.target = t; this.state = "wander"; }
        else this.state = "idle";
      } else this.state = "idle";
    }
    let speed = 0, dir = null;
    if (this.state === "wander") {
      dir = this.target.clone().sub(this.base).setY(0);
      if (dir.length() < 0.6) this.state = "idle";
      else speed = this.air ? 2.6 : this.isWater ? 1.9 : 1.5;
    } else if (this.state === "flee") {
      this.fleeT -= dt;
      dir = this.base.clone().sub(p).setY(0);
      speed = this.air ? 7.5 : this.isWater ? 6 : 5;
      // a fish chased onto the shore flops more than it flees
      if (this.habitat === "water" && g.world.height(this.base.x, this.base.z) > g.world.waterY - 0.3) speed *= 0.35;
      if (this.fleeT <= 0) this.state = "idle";
      if (d > 26) this.state = "idle";
    } else if (this.state === "aggro") {
      dir = p.clone().sub(this.base).setY(0);
      speed = this.air ? 5 : 3.4;
      if (this.air) this.altT = 1.0;                       // swoop down on the prey
      if (d > 17 || g.battle) {
        this.state = "idle";
        if (this.air) this.altT = 3.2 + this.size * 0.6 + rnd(2.8);
      }
      if (d < 1.9 && !g.battle && g.activeMon()) {
        g.startWildBattle(this, true);
        return;
      }
    }
    if (dir && speed) {
      dir.normalize();
      this.base.addScaledVector(dir, speed * dt);
      this.game.world.collide(this.base, 0.45);
      this.snapGround();
    }
    // curious idlers turn to watch you go by
    if (this.state === "idle" && d < 11) this.lookToward(p);
    else if (this.state === "wander") this.faceTo = null;
    if ((this.life <= 0 && d > 40) || d > 95) {
      const idx = g.wilds.indexOf(this);
      if (idx >= 0) g.wilds.splice(idx, 1);
      this.fadeOut();
    }
  }
}

// --------------------------------------------------- follower Pokémon (v3)
// Your lead Pokémon walks beside you, anime style. Fire/Electric types light
// up caves and the night; pet it (E) to build happiness.
class FollowerEnt extends MonEntity {
  light: THREE.PointLight | null = null;
  stepT = 0;
  spLast = 0;              // species when created (recreate after evolution)

  constructor(game, mon, pos) {
    super(game, mon, pos);
    const types = DEX[mon.sp].types;
    const glow = types.includes("fire") ? 0xffb066 : types.includes("electric") ? 0xfff2a0 : types.includes("ghost") ? 0xb08aff : 0;
    if (glow) {
      this.light = new THREE.PointLight(glow, 0, 11, 1.5);
      this.light.position.y = this.halfH + 0.4;
      this.group.add(this.light);
    }
    this.snapGround();
  }
  // ideal spot: ahead-left of the player, in view — it walks WITH you, anime
  // style, not in your blind spot behind the camera
  idealPos() {
    const g = this.game;
    const yaw = g.playerYaw;
    const fwd = V3(-Math.sin(yaw), 0, -Math.cos(yaw));   // camera forward
    const left = V3(-fwd.z, 0, fwd.x).multiplyScalar(-1); // screen-left
    return g.playerPos.clone().addScaledVector(fwd, 2.1).addScaledVector(left, 1.5);
  }
  update(dt) {
    this.updateVisual(dt);
    const g = this.game;
    const tgt = this.idealPos();
    const d = Math.hypot(tgt.x - this.base.x, tgt.z - this.base.z);
    const pd = Math.hypot(g.playerPos.x - this.base.x, g.playerPos.z - this.base.z);
    if (pd > 17) { // left behind: pop back in with a poof
      this.base.copy(tgt);
      g.fx.burst(this.pos(), { count: 8, col: "#fff", speed: 2, size: 0.24, life: 0.35 });
    } else if (d > 0.9) {
      const dir = tgt.clone().sub(this.base).setY(0).normalize();
      const speed = clamp(d * 2.6, 2.4, g.state.vehicle ? 17 : 11);
      this.base.addScaledVector(dir, speed * dt);
      g.world.collide(this.base, 0.4);
      this.stepT -= dt;
      if (this.stepT <= 0) { this.stepT = 0.34; this.off.y = 0.09; setTimeout(() => (this.off.y = 0), 90); }
    }
    this.snapGround();
    this.lookToward(g.playerPos); // when not walking, it turns to look at you
    // glow types light the way in caves and at night
    if (this.light) {
      const want = g.world.caveDim > 0.25 ? 1.5 : g.world.isNight() ? 0.9 : 0;
      this.light.intensity += (want - this.light.intensity) * Math.min(1, dt * 3);
    }
  }
}

// ----------------------------------------------------------- trainer NPCs
class TrainerNPC {
  game: Game;
  def: any;
  pos: THREE.Vector3;
  group: THREE.Group;
  face: number;
  label: THREE.Sprite;
  alertT: number;
  engaging: boolean;
  despawnT: number | null = null;  // dynamic NPCs (Team Rocket) vanish after a while

  constructor(game, def) {
    this.game = game; this.def = def;
    const pos = def.gym ? game.world.gymPos[def.gym].clone() : V3(def.pos[0], 0, def.pos[1]);
    if (!def.gym) pos.y = game.world.height(pos.x, pos.z);
    this.pos = pos;
    this.group = buildPerson(def.look);
    this.group.position.copy(pos);
    this.face = def.gym ? Math.PI : rnd(Math.PI * 2);
    this.group.rotation.y = this.face;
    this.label = makeTextSprite(def.name, { size: 24 });
    this.label.position.y = 2.35;
    this.group.add(this.label);
    game.scene.add(this.group);
    this.alertT = 0;
    this.engaging = false;
  }
  beaten() {
    const b = this.game.state.beaten[this.def.id];
    if (!b) return false;
    return Date.now() - b.ts < 8 * 60 * 1000; // rematch after 8 min
  }
  everBeaten() { return !!this.game.state.beaten[this.def.id]; }
  rematches() { return this.game.state.beaten[this.def.id]?.n || 0; }
  // authentic team levels; rematches raise them
  levelFor(i = 0) {
    const base = this.def.lvs[Math.min(i, this.def.lvs.length - 1)];
    return clamp(base + this.rematches() * 4, base, 62);
  }
  update(dt) {
    const g = this.game, p = g.playerPos;
    const dx = p.x - this.pos.x, dz = p.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    this.label.visible = d > 3.4; // up close the name towers over the camera
    if (d < 14) {
      const want = Math.atan2(dx, dz);
      let diff = want - this.group.rotation.y;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.group.rotation.y += clamp(diff, -dt * 2.2, dt * 2.2);
    } else this.group.rotation.y = this.face;
    // line-of-sight auto-engage (not for gym leaders/the champion, not through walls)
    if (!this.def.gym && !this.def.champion && !this.engaging && !g.battle && !g.ui.modalOpen && !this.everBeaten() && d < 10 && Math.abs(p.y - this.pos.y) < 4 && g.activeMon()
        && g.world.insideBuilding(p) === g.world.insideBuilding(this.pos)) {
      this.engaging = true;
      this.alert();
      setTimeout(() => { if (!g.battle && !g.ui.modalOpen) g.startTrainerBattle(this); else this.engaging = false; }, 900);
    }
  }
  alert() {
    const g = this.game;
    g.audio.play("alert");
    const ex = makeTextSprite("!", { size: 44, color: "#ffcc33", bg: "rgba(10,14,22,.85)" });
    ex.position.copy(this.pos).add(V3(0, 2.9, 0));
    g.scene.add(ex);
    g.fx.anim(0.8, (k) => { ex.position.y = this.pos.y + 2.9 + Math.sin(k * Math.PI) * 0.3; }, () => g.scene.remove(ex));
  }
  setLabel(text: string) {
    this.group.remove(this.label);
    this.label = makeTextSprite(text, { size: 24 });
    this.label.position.y = 2.35;
    this.group.add(this.label);
  }
  dispose() { this.game.scene.remove(this.group); }
}

// ------------------------------------------------------- townsfolk ambient
// Most folks stroll their town square — picking a spot, ambling over with
// swinging arms, pausing to watch you pass. The odd Doomscroller stands
// rooted, thumb going, screen glowing. Chat with E either way.
class CivilianNPC {
  game: Game;
  pos: THREE.Vector3;
  home: THREE.Vector3;
  group: THREE.Group;
  name: string;
  lines: [string, string];
  phone: boolean;
  t: number;
  // strolling brain
  tgt: THREE.Vector3 | null = null;
  pauseT = rnd(6, 1);
  walkP = 0;            // limb-swing phase, advances only while walking
  swing = 0;            // limb-swing amplitude envelope (eases in/out)
  chatT = 0;            // freeze briefly after being talked to
  private poolStart: number;
  private poolLen: number;
  private poolIdx: number;
  constructor(game, spot, i: number) {
    this.game = game;
    // town squares are crowded — slide out of any building we spawned inside
    let p = V3(spot.x, 0, spot.z);
    for (let k = 0; k < 10 && game.world.insideBuilding(p); k++) {
      const a = (k / 10) * Math.PI * 2 + i;
      p = V3(spot.x + Math.cos(a) * (4 + k * 1.5), 0, spot.z + Math.sin(a) * (4 + k * 1.5));
    }
    p.y = game.world.height(p.x, p.z);
    this.pos = p;
    this.home = p.clone();
    const look = CIV_LOOKS[i % CIV_LOOKS.length];
    this.phone = !!look.phone;
    this.group = buildPerson(look);
    this.group.position.copy(this.pos);
    this.group.rotation.y = rnd(Math.PI * 2);
    this.name = CIV_NAMES[i % CIV_NAMES.length];
    // strollers gossip about routes and gym leaders; scrollers post about it
    this.poolStart = this.phone ? 10 : 0;
    this.poolLen = this.phone ? CIV_LINES.length - 10 : 10;
    this.poolIdx = i % this.poolLen;
    this.lines = CIV_LINES[this.poolStart + this.poolIdx];
    this.t = rnd(9);
    game.scene.add(this.group);
  }
  update(dt) {
    this.t += dt;
    this.chatT -= dt;
    if (this.phone) return this.updateScroller(dt);
    this.updateStroller(dt);
  }
  // rooted in place, thumb flicking — never looking up
  updateScroller(dt) {
    const ph = this.group.userData.phone as THREE.Group | undefined;
    if (ph) {
      ph.position.y = 1.16 + Math.sin(this.t * 1.7) * 0.012;
      ph.rotation.z = Math.sin(this.t * 5.1) * 0.05;          // thumb flicks
      const glow = this.group.userData.glow as THREE.Sprite;
      // the screen reads brighter at night — classic face-in-the-void look
      const night = this.game.world.isNight() ? 1 : 0.35;
      (glow.material as THREE.SpriteMaterial).opacity = night * (0.75 + Math.sin(this.t * 5.1) * 0.15);
    }
    this.group.position.y = this.pos.y + Math.abs(Math.sin(this.t * 0.9)) * 0.012; // restless feet
  }
  // amble between spots near home, arms swinging; pause and face passers-by
  updateStroller(dt) {
    const w = this.game.world;
    const pd = this.game.playerPos.distanceTo(this.pos);
    const legL = this.group.userData.legL as THREE.Mesh;
    const legR = this.group.userData.legR as THREE.Mesh;
    const armL = this.group.userData.armL as THREE.Mesh;
    const armR = this.group.userData.armR as THREE.Mesh;
    let walking = false;
    if (!this.tgt) {
      this.pauseT -= dt;
      // idle: settle limbs, breathe, and turn to watch a passing trainer
      if (pd < 6 && this.chatT <= 0) {
        const want = Math.atan2(this.game.playerPos.x - this.pos.x, this.game.playerPos.z - this.pos.z);
        this.turnToward(want, dt * 5);
      }
      if (this.pauseT <= 0 && this.chatT <= 0) {
        // pick a new spot in the square: walkable, dry, not inside a wall
        for (let k = 0; k < 8; k++) {
          const a = rnd(Math.PI * 2), r = rnd(11, 3);
          const c = V3(this.home.x + Math.cos(a) * r, 0, this.home.z + Math.sin(a) * r);
          const h = w.height(c.x, c.z);
          if (h < w.waterY + 0.1 || w.insideBuilding(c)) continue;
          c.y = h;
          this.tgt = c;
          break;
        }
        this.pauseT = rnd(8, 3);
      }
    } else {
      const dir = this.tgt.clone().sub(this.pos).setY(0);
      const d = dir.length();
      if (d < 0.35) this.tgt = null;
      else {
        dir.normalize();
        const speed = 1.25;
        this.pos.addScaledVector(dir, speed * dt);
        w.collide(this.pos, 0.4);
        this.pos.y = w.height(this.pos.x, this.pos.z);
        this.turnToward(Math.atan2(dir.x, dir.z), dt * 6);
        this.walkP += dt * 7;
        walking = true;
      }
    }
    // limb swing eases in as they set off and out as they stop
    this.swing += ((walking ? 1 : 0) - this.swing) * Math.min(1, dt * 6);
    const sw = Math.sin(this.walkP) * 0.55 * this.swing;
    legL.rotation.x = sw;
    legR.rotation.x = -sw;
    armL.rotation.x = -sw * 0.8;
    armR.rotation.x = sw * 0.8;
    this.group.position.copy(this.pos);
    this.group.position.y += Math.abs(Math.sin(this.walkP)) * 0.045 * this.swing;
  }
  turnToward(want: number, k: number) {
    let dy = want - this.group.rotation.y;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.group.rotation.y += dy * Math.min(1, k);
  }
  nextLines() {
    // every chat rotates them to a fresh take from their own pool
    const cur = this.lines;
    this.poolIdx = (this.poolIdx + 1 + Math.floor(rnd(2))) % this.poolLen;
    this.lines = CIV_LINES[this.poolStart + this.poolIdx];
    this.chatT = 6;            // stand with their guest a moment
    return cur;
  }
  dispose() { this.game.scene.remove(this.group); }
}

// ----------------------------------------------------------------- battle
// v7 possession: a live projectile in spatial combat
interface BattleProj {
  p: THREE.Vector3; v: THREE.Vector3;
  side: string; move: Move;
  mesh: THREE.Sprite;
  life: number; trailT: number;
  minD: number;       // closest approach to the target (near-miss = dodge!)
  grav: number;
  dmgMul: number;     // weakened by mid-air duels / wind deflection
  idx?: number;       // which move slot fired it (so PP only spends on a hit)
  steady?: number;    // 0..1 aim steadiness at launch — fed into hit quality
}
// a lingering pool left by a lobbed move (Sludge, Acid, Bubble...)
interface Hazard {
  p: THREE.Vector3; r: number; t: number;
  type: string; side: string; tickT: number; fxT: number;
}
// All real-time combat feel knobs live here. Classic battle uses its turn path
// and only reads the pieces it already owned before this table existed.
const BALANCE = {
  enemyDmg: 0.68,
  enemyPace: 0.6,   // extra hesitation (seconds-ish) between enemy actions
  energy: { max: 100, basicGain: 14, skillGain: 22, onHitTaken: 6, burstCost: 100 },
  stamina: { max: 100, dodgeCost: 34, sprintDrain: 18, regen: 26, regenDelay: 0.6 },
  accuracy: { grazeMult: 0.5 },
  status: { dotTick: 1.5, sleep: [1.6, 2.4], freeze: 1.8, reapplyLockout: 4 },
  reactions: { conduct: 1.8, melt: 1.6, steam: 0.0, bloom: 1.4 },
  xp: { realtime: 1.35 },
};
// visual move kinds that fly across the arena instead of needing contact
const RANGED_KINDS = new Set(["proj", "stream", "lob", "beam", "bolt", "ring", "pulse", "tornado", "wave", "sky", "toss", "cone"]);
// beams & bolts punch straight through lesser projectiles
const PIERCE_KINDS = new Set(["beam", "bolt"]);
// gusts & tides shove other projectiles off course instead of trading
const DEFLECT_KINDS = new Set(["tornado", "wave"]);
// lingering ground hazards left by attacks that scar the terrain. Some bite
// (poison/grass/fire); the slick ones (water/frost) just bog you down.
const HAZARD_COL: Record<string, string> = { poison: "#b05fd0", water: "#6fb9e8", grass: "#7ec850", fire: "#ff8a3c", frost: "#bfe6ff" };
const HAZARD_HURTS = new Set(["poison", "grass", "fire"]);
const STYLE_LABEL = { classic: "Classic (turn-based)", arena: "Arena (real-time)", fp: "First-Person" };
const BATTLE_ARENA_R = 22;

class BattleArena {
  game: Game;
  center: THREE.Vector3;
  radius: number;
  group: THREE.Group;
  biome: string;
  zone: string;

  constructor(game: Game, center: THREE.Vector3, radius = BATTLE_ARENA_R) {
    this.game = game;
    this.radius = radius;
    this.center = center.clone();
    this.center.y = Math.max(game.world.height(center.x, center.z), game.world.waterY) + 0.04;
    this.biome = game.world.biomeAt(this.center.x, this.center.z);
    this.zone = game.world.zoneAt(this.center.x, this.center.z);
    this.group = new THREE.Group();
    this.group.name = "BattleArena";
    this.build();
    game.scene.add(this.group);
  }

  private palette() {
    if (this.biome === "forest") return { floor: "#284b2d", ring: "#82d66f", prop: "#4f8f3f" };
    if (this.biome === "cave" || this.biome === "mountain") return { floor: "#3f3c45", ring: "#b8b0d0", prop: "#777083" };
    if (this.biome === "lake" || this.zone === "seafoam") return { floor: "#174a60", ring: "#8fdfff", prop: "#6bb6d8" };
    if (this.biome === "town") return { floor: "#4b4a43", ring: "#f0d58a", prop: "#b99c5f" };
    return { floor: "#37562d", ring: "#d7efa8", prop: "#77a94a" };
  }

  private seed(i: number, salt = 0) {
    const s = Math.sin((this.center.x + salt) * 12.9898 + (this.center.z - salt) * 78.233 + i * 37.719) * 43758.5453;
    return s - Math.floor(s);
  }

  private build() {
    const pal = this.palette();
    const y = this.center.y;
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(this.radius, 80),
      new THREE.MeshBasicMaterial({ color: pal.floor, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(this.center.x, y, this.center.z);
    this.group.add(floor);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(this.radius - 0.35, this.radius, 96),
      new THREE.MeshBasicMaterial({ color: pal.ring, transparent: true, opacity: 0.48, depthWrite: false, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(this.center.x, y + 0.025, this.center.z);
    this.group.add(ring);

    this.buildEchoProps(pal.prop);
  }

  private buildEchoProps(col: string) {
    const count = this.biome === "forest" ? 18 : this.biome === "cave" || this.biome === "mountain" ? 12 : 14;
    const trunkMat = new THREE.MeshLambertMaterial({ color: this.biome === "cave" || this.biome === "mountain" ? "#665f68" : "#6a4a2a" });
    const leafMat = new THREE.MeshLambertMaterial({ color: col });
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + this.seed(i, 3) * 0.28;
      const r = this.radius + 1.8 + this.seed(i, 7) * 4.2;
      const x = this.center.x + Math.cos(a) * r;
      const z = this.center.z + Math.sin(a) * r;
      const y = this.game.world.height(x, z);
      const s = 0.65 + this.seed(i, 11) * 0.75;
      const prop = new THREE.Group();
      if (this.biome === "cave" || this.biome === "mountain") {
        const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.8 * s, 0), leafMat);
        rock.scale.set(1.4, 0.75, 1);
        rock.position.y = 0.45 * s;
        prop.add(rock);
      } else {
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12 * s, 0.17 * s, 1.7 * s, 7), trunkMat);
        trunk.position.y = 0.85 * s;
        const canopy = new THREE.Mesh(new THREE.ConeGeometry(0.95 * s, 2.1 * s, 8), leafMat);
        canopy.position.y = 2.25 * s;
        prop.add(trunk, canopy);
      }
      prop.position.set(x, y, z);
      prop.rotation.y = this.seed(i, 17) * Math.PI * 2;
      this.group.add(prop);
    }
  }

  dispose() {
    this.game.scene.remove(this.group);
    this.group.traverse((o: any) => {
      if (o.geometry) o.geometry.dispose?.();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose?.());
        else o.material.dispose?.();
      }
    });
  }
}

class Battle {
  game: Game;
  type: "trainer" | "wild";
  trainer: TrainerNPC | null;
  trainerPartyIdx: number;
  over: boolean;
  lock: { ally: number; enemy: number };
  stages: { ally: any; enemy: any };
  conds: { ally: any; enemy: any };
  dotT: { ally: number; enemy: number };
  energy: { ally: number; enemy: number };
  stamina: { ally: number; enemy: number };
  staminaRegenCd: { ally: number; enemy: number };
  condFxT: number;
  lastEnemyMove: number | null;
  switchLock: number;
  runLock: number;
  bideDmg: { ally: number; enemy: number };
  enemyEnt: any;
  enemyAnchor: THREE.Vector3;
  allyMon: Mon;
  allyEnt: MonEntity;
  cds: { ally: number[]; enemy: number[] };
  enemyThink: number;
  midPoint: THREE.Vector3;
  arena: BattleArena | null = null;
  convType?: string;
  // v3: dodge command + counter window + incoming-attack telegraph
  incoming: { t: number; max: number; dir?: THREE.Vector3 } | null = null;
  dodging = false;
  dodgeCd = 0;
  counterT = 0;
  // v7: possession — play AS your Pokémon. Combat goes fully spatial:
  // aimed projectiles, range-gated melee, dodging by actually moving.
  possessed = false;
  possessInput = { x: 0, z: 0, sprint: false };        // world-space move intent from main.ts
  dashCd = 0;
  dashT = 0;
  lastMoveIdx = 0;
  projectiles: BattleProj[] = [];
  hintT = 0;                            // throttle "too far" style nags
  // input buffer: a move pressed just before it's ready fires the moment it
  // is — mashing feels responsive instead of eating the press
  buffered: { idx: number; t: number } | null = null;
  private brain = { strafe: 1, strafeT: 0, dodgeReact: 0, pauseT: 0, skillCd: 0 };
  // v8: battle styles. classic = true turn-based RBY; arena = real-time
  // cooldowns (the balanced middle); fp = first-person possession, where
  // skill swings the damage both ways.
  style: "classic" | "arena" | "fp";
  turnPhase: "player" | "busy" = "player";   // classic only
  freeTurnPending = false;              // classic: one free swing at a time
  wantPossess = false;                  // fp: auto-return to the mon after interruptions
  resumeT = 0;
  hazards: Hazard[] = [];
  braceT = 0;                           // heavy mons: post-dash damage shield
  enemyBraceT = 0;
  enemyStaggerT = 0;                    // interrupted mid-windup by a well-timed strike
  enemyCounterT = 0;                    // you whiffed — the enemy's next hit lands harder
  punishT = 0;                          // veterans push in when you commit to an attack

  constructor(game, opts) {
    this.game = game;
    this.type = opts.trainer ? "trainer" : "wild";
    this.trainer = opts.trainer || null;
    this.trainerPartyIdx = 0;
    this.over = false;
    this.style = game.battleStyle();
    // The player always gets the first window to act.
    this.lock = { ally: 0.45, enemy: opts.ambush ? 1.5 : 2.3 };
    this.stages = { ally: this.zeroStages(), enemy: this.zeroStages() };
    this.conds = { ally: {}, enemy: {} };
    this.dotT = { ally: 0, enemy: 0 };
    this.energy = { ally: 0, enemy: 0 };
    this.stamina = { ally: BALANCE.stamina.max, enemy: BALANCE.stamina.max };
    this.staminaRegenCd = { ally: 0, enemy: 0 };
    this.condFxT = 0;
    this.lastEnemyMove = null;
    this.switchLock = 0;
    this.runLock = 0;
    this.bideDmg = { ally: 0, enemy: 0 };

    if (opts.wild) {
      this.enemyEnt = opts.wild;
      this.enemyEnt.engaged = true;
      this.enemyEnt.state = "engaged";
      // birds swoop down, perchers drop from the canopy: battles happen at
      // ground level where the arena brain and melee ranges live
      opts.wild.land?.();
    } else {
      const mon = makeMon(this.trainer.def.party[0], this.trainer.levelFor(0));
      const pos = this.trainer.pos.clone().add(this.dirFromTrainer().multiplyScalar(3));
      pos.y = Math.max(game.world.height(pos.x, pos.z), this.trainer.pos.y);
      this.enemyEnt = new MonEntity(game, mon, pos);
      game.markSeen(mon.sp);
    }
    this.enemyAnchor = this.enemyEnt.base.clone();
    this.enemyAnchor.y = game.world.height(this.enemyAnchor.x, this.enemyAnchor.z);   // it may still be descending
    const toEnemy = this.enemyAnchor.clone().sub(game.playerPos).setY(0);
    const L = Math.max(toEnemy.length(), 0.001);
    if (L > 0.001) toEnemy.normalize();
    else toEnemy.set(-Math.sin(game.playerYaw || 0), 0, -Math.cos(game.playerYaw || 0));
    const side = V3(-toEnemy.z, 0, toEnemy.x);
    const naturalMid = this.enemyAnchor.clone().lerp(game.playerPos, 0.5);
    naturalMid.y = game.world.height(naturalMid.x, naturalMid.z);
    if (this.style !== "classic") this.arena = new BattleArena(game, naturalMid);
    const arenaCenter = this.arena?.center || naturalMid;

    // Real-time battles unfold in a contained playground carved from the local
    // biome; classic battles keep the old in-place trainer view.
    let allyPos: THREE.Vector3;
    if (this.arena) {
      allyPos = arenaCenter.clone().addScaledVector(toEnemy, -5.6).addScaledVector(side, 1.4);
      this.enemyAnchor.copy(arenaCenter).addScaledVector(toEnemy, 5.6);
      this.enemyAnchor.y = game.world.height(this.enemyAnchor.x, this.enemyAnchor.z);
      this.enemyEnt.base.copy(this.enemyAnchor);
      this.enemyEnt.snapGround();
      this.enemyEnt.syncNow?.();
    } else {
      allyPos = game.playerPos.clone()
        .addScaledVector(toEnemy, clamp(L * 0.42, 2.6, 4.2))
        .addScaledVector(side, 1.5);
    }
    allyPos.y = game.world.height(allyPos.x, allyPos.z);
    this.allyMon = game.activeMon();
    // anime send-out: if your walking partner IS the battler, it charges from
    // your side into position; otherwise it materializes on the spot
    const fromPos = game.follower && !game.follower.dead && game.follower.mon === this.allyMon
      ? game.follower.base.clone() : allyPos.clone();
    this.allyEnt = new MonEntity(game, this.allyMon, fromPos);
    if (game.follower) game.follower.group.visible = false;
    const startBase = fromPos.clone();
    game.fx.anim(0.45, (k) => {
      this.allyEnt.base.copy(startBase).lerp(allyPos, k);
      this.allyEnt.snapGround();
    }, () => {
      this.allyEnt.base.copy(allyPos);
      this.allyEnt.snapGround();
      game.fx.burst(this.allyEnt.pos(), { count: 18, col: "#fff", col2: "#9fc6ff", speed: 3, size: 0.3, life: 0.45 });
      game.audio.cry(this.allyMon.sp, DEX[this.allyMon.sp].height);
    });
    game.audio.play("switch");
    game.audio.cry(this.enemy().sp, DEX[this.enemy().sp].height);
    this.cds = { ally: [0, 0, 0, 0], enemy: [0, 0, 0, 0] };
    this.enemyThink = opts.ambush ? 1.6 : 2.4;
    this.midPoint = this.arena ? this.arena.center.clone() : this.enemyAnchor.clone().lerp(allyPos, 0.5);
    game.ui.setBattle(this);
    game.ui.toast(this.type === "wild" ? `A wild ${monName(this.enemy())} appeared! (Lv ${this.enemy().lv})` : `${this.trainer.def.name} wants to battle!`, "bad");
    if (this.style === "classic") {
      game.ui.toast("Your move — pick an attack!", "good");
    } else {
      game.ui.toast("You have the first move — strike!", "good");
      if (!game.skillTipShown) {
        game.skillTipShown = true;
        game.ui.toast("Plant your feet to aim true — moving sprays your shots. Duck behind trees & rocks for cover, and shove foes into hazards. PP only burns on a clean hit.", "");
      }
    }
    if (this.style === "fp") {
      // first-person style: you ARE the Pokémon. Dive in after the send-out.
      this.wantPossess = true;
      this.resumeT = 0.9;
      if (!game.possessTipShown) {
        game.possessTipShown = true;
        game.ui.toast(`First-Person style: aim with the mouse, dodge with ${game.keyLabel("jumpDodge")} — your skill is the battle!`, "good");
      }
    }
  }
  zeroStages() { return { atk: 0, def: 0, spe: 0, spc: 0, acc: 0, eva: 0 }; }
  dirFromTrainer() {
    const d = this.game.playerPos.clone().sub(this.trainer.pos).setY(0).normalize();
    return d.lengthSq() ? d : V3(0, 0, 1);
  }
  enemy() { return this.enemyEnt.mon; }
  ent(side) { return side === "ally" ? this.allyEnt : this.enemyEnt; }
  monOf(side) { return side === "ally" ? this.allyMon : this.enemy(); }
  other(side) { return side === "ally" ? "enemy" : "ally"; }

  effSpe(side) {
    const m = this.monOf(side);
    let v = m.spe * STAGE_MULT(this.stages[side].spe);
    if (this.conds[side].par) v *= 0.5;
    return v;
  }
  moveRole(move: Move): "basic" | "skill" | "burst" {
    if (move.role) return move.role;
    if (move.tags?.recharge || move.tags?.ohko || move.tags?.selfko || move.power >= 120) return "burst";
    if (move.cls !== "status" && move.power <= 40) return "basic";
    return "skill";
  }
  energyCostFor(move: Move) {
    return move.energyCost ?? (this.moveRole(move) === "burst" ? BALANCE.energy.burstCost : 0);
  }
  energyGainFor(move: Move) {
    if (move.energyGain != null) return move.energyGain;
    const role = this.moveRole(move);
    if (role === "basic") return BALANCE.energy.basicGain;
    if (role === "skill") return BALANCE.energy.skillGain;
    return 0;
  }
  addEnergy(side: string, n: number) {
    if (this.style === "classic" || n <= 0) return;
    this.energy[side] = clamp(this.energy[side] + n, 0, BALANCE.energy.max);
  }
  spendStamina(side: string, n = BALANCE.stamina.dodgeCost) {
    if (this.style === "classic") return true;
    if (this.stamina[side] < n) return false;
    this.stamina[side] = Math.max(0, this.stamina[side] - n);
    this.staminaRegenCd[side] = BALANCE.stamina.regenDelay;
    return true;
  }
  cdFor(side, move) {
    const role = this.moveRole(move);
    let base = move.cd ?? (role === "basic"
      ? clamp(0.55 + (move.power || 25) / 120, 0.6, 1.0)
      : role === "burst"
        ? 0.8
        : clamp(move.cls === "status" ? 4.2 : 3.5 + (move.power || 55) / 40, 4, 8));
    if (role !== "burst") {
      if (move.tags?.charge) base += 0.45;
      if (move.tags?.multi) base += 0.35;
      if (move.pri > 0) base *= 0.72;           // Quick Attack-style priority
      if (move.pri < 0) base *= 1.2;
    }
    const spd = 0.85 + this.effSpe(side) / 280;
    return clamp(base / spd, role === "basic" ? 0.45 : 0.75, 9);
  }

  // Space — command your Pokémon to dodge the incoming attack (anime rules:
  // works best on fast Pokémon, needs to be timed during the wind-up).
  tryDodge() {
    if (this.style === "classic") return;                  // RBY rules: no dodge command
    if (this.hasDirectAllyControl()) { this.possessDash(); return; }   // real-time control: Space IS the dash
    if (this.over || this.dodgeCd > 0 || this.allyEnt.dead) return;
    if (!this.spendStamina("ally")) {
      this.game.ui.floatAt(this.allyEnt.pos(), "Too tired!", "miss");
      return;
    }
    const toEnemy = this.enemyEnt.pos().clone().sub(this.allyEnt.pos());
    const side = V3(-toEnemy.z, 0, toEnemy.x).normalize().multiplyScalar(Math.random() < 0.5 ? 1 : -1);
    this.game.fx.dodgeHop(this.allyEnt, side);
    this.game.audio.play("dodge");
    if (this.incoming && this.incoming.t > 0) {
      this.dodging = true;
      this.dodgeCd = 3.2;
      this.game.ui.floatAt(this.allyEnt.pos(), `${monName(this.allyMon)}, dodge it!`, "eff");
    } else {
      this.dodgeCd = 1.2; // wasted hop
    }
  }

  // ============================================================= possession
  // T — stop commanding and BECOME your Pokémon. The camera drops into its
  // eyes, WASD moves it with its real Speed stat, moves are aimed for real,
  // and dodging means actually not being where the attack lands.
  togglePossess() {
    if (this.over) return;
    if (this.style !== "fp") {
      this.game.ui.toast(`Battle Style is ${STYLE_LABEL[this.style]} — switch to First-Person in the pause menu (Esc) to take over.`, "");
      return;
    }
    if (!this.possessed && (this.allyEnt.dead || this.allyMon.hp <= 0)) return;
    this.wantPossess = !this.possessed;   // a manual choice sticks until you change it
    this.setPossessed(!this.possessed);
  }
  allyIsPlayerDriven() {
    return this.style === "arena" || this.possessed;
  }
  hasDirectAllyControl() {
    return !!(this.allyIsPlayerDriven() && !this.over && this.allyEnt && !this.allyEnt.dead &&
      !this.game.aim && this.game.thrown.length === 0 && !this.game.ui.modalOpen && !this.game.cutscene);
  }
  ensureArena() {
    if (this.arena) return;
    const c = this.midPoint?.clone?.() || this.enemyEnt.base.clone().lerp(this.allyEnt.base, 0.5);
    this.arena = new BattleArena(this.game, c);
    this.midPoint = this.arena.center.clone();
  }
  disposeArena() {
    this.arena?.dispose();
    this.arena = null;
  }
  // Eject for an interruption (throwing a ball, opening the bag, switching).
  // wantPossess stays true, so you dive back in the moment the moment passes.
  autoEject() {
    if (!this.possessed) return;
    this.setPossessed(false);
    this.resumeT = 0.6;
  }
  setPossessed(on: boolean) {
    if (on === this.possessed) return;
    this.possessed = on;
    const g = this.game;
    this.possessInput.x = this.possessInput.z = 0;
    this.possessInput.sprint = false;
    if (on) {
      g.audio.play("counter");
      this.allyEnt.forceYaw = g.playerYaw + Math.PI;   // face the camera's way from frame one
      g.ui.toast(`You ARE ${monName(this.allyMon)} now! Move with ${g.keyLabel("moveForward")}/${g.keyLabel("moveBackward")}/${g.keyLabel("moveLeft")}/${g.keyLabel("moveRight")} · ${g.keyLabel("jumpDodge")} dash · click or ${MOVE_ACTIONS.map((a) => g.keyLabel(a)).join("/")} attack · ${g.keyLabel("possess")} back`, "good");
      g.fx.ringAt(this.allyEnt.feet().add(V3(0, 0.15, 0)), { col: "#9fe8ff", r0: 0.4, r1: 2.6, dur: 0.5 });
    } else {
      g.audio.play("ui");
      this.allyEnt.forceYaw = null;
      if (!this.allyEnt.dead) this.allyEnt.rig.group.visible = true;
    }
  }
  // Live battle-mode switch: flip between real-time (arena/fp) and turn-based
  // (classic) mid-fight. HP/PP/status/stat-stages all live on the mon and the
  // battle object, so they carry over untouched — only the transient real-time
  // bits (cooldowns, projectiles, possession, telegraphs) get reset cleanly.
  cycleStyle() {
    const order: Array<"arena" | "fp" | "classic"> = ["arena", "fp", "classic"];
    this.setStyle(order[(order.indexOf(this.style) + 1) % order.length]);
  }
  setStyle(s: "classic" | "arena" | "fp") {
    if (this.over || s === this.style) return;
    if (this.possessed) this.setPossessed(false);
    this.wantPossess = false;
    // wipe in-flight real-time state so the new mode starts clean
    for (let i = this.projectiles.length - 1; i >= 0; i--) this.killProj(i, true);
    this.hazards = [];
    this.incoming = null; this.dodging = false; this.buffered = null;
    this.cds = { ally: [0, 0, 0, 0], enemy: [0, 0, 0, 0] };
    this.lock = { ally: 0.2, enemy: 0.6 };
    this.dashCd = 0; this.dashT = 0;
    this.stamina = { ally: BALANCE.stamina.max, enemy: BALANCE.stamina.max };
    this.staminaRegenCd = { ally: 0, enemy: 0 };
    this.enemyThink = 0.9;
    this.style = s;
    if (s === "classic") {
      this.turnPhase = "player";
      this.freeTurnPending = false;
    } else if (s === "fp") {
      this.ensureArena();
      this.wantPossess = true;
      this.resumeT = 0.5;
    } else {
      this.ensureArena();
    }
    if (s === "classic") this.disposeArena();
    // remember the choice so future battles use it too
    if (this.game.state.settings) this.game.state.settings.style = s;
    this.game.save();
    this.game.ui.setBattle(this);     // rebuild the move buttons / HUD layout
    this.game.ui.applySettings();     // keep the pause-menu dropdown in sync
    this.game.ui.toast(`Battle mode: ${STYLE_LABEL[s]}`, "good");
  }
  // movement speed of a battler right now — real stats, real terrain, hazards
  battlerSpeed(side: string) {
    const m = this.monOf(side), ent = this.ent(side);
    const w = this.game.world;
    const inWater = w.height(ent.base.x, ent.base.z) < w.waterY - 0.4 && !ent.floats;
    let v = battleSpeedFor(m.sp, m.lv, this.effSpe(side), { water: inWater });
    if (this.inHazard(side)) v *= 0.62;     // wading through someone's sludge
    return v;
  }
  // How settled a battler is right now: 1 = planted (true aim), 0 = sprinting
  // or mid-dash (shots spray wide). Movement is the price of accuracy — dodge
  // OR fire, but don't expect a clean hit while doing both. This is the knob
  // that turns "mash the move keys" into "pick your moment and plant the shot."
  aimSteadiness(side: string) {
    if (side === "ally" && this.allyIsPlayerDriven()) {
      if (this.dashT > 0) return 0;                          // mid-dash: no aim at all
      return clamp(1 - Math.hypot(this.possessInput.x, this.possessInput.z), 0, 1);
    }
    const ent = this.ent(side);
    const ref = Math.max(2.5, this.battlerSpeed(side));
    return clamp(1 - Math.hypot(ent.velX, ent.velZ) / ref, 0, 1);
  }
  inHazard(side: string): Hazard | null {
    const feet = this.ent(side).feet();
    for (const h of this.hazards) {
      if (h.side !== side && Math.hypot(feet.x - h.p.x, feet.z - h.p.z) < h.r) return h;
    }
    return null;
  }
  clampArena(ent) {
    const center = this.arena?.center || this.midPoint;
    const d = ent.base.clone().sub(center); d.y = 0;
    const R = this.arena?.radius || 15;
    if (d.lengthSq() > R * R) {
      d.setLength(R);
      ent.base.x = center.x + d.x;
      ent.base.z = center.z + d.z;
    }
  }
  updateDirectControl(dt) {
    const e = this.allyEnt;
    this.dashCd -= dt; this.dashT -= dt;
    if (e.dead) { this.setPossessed(false); return; }
    e.forceYaw = this.possessed ? this.game.playerYaw + Math.PI : null;   // possession: the rig faces where you look
    const c = this.conds.ally;
    if (c.slp > 0 || c.frz > 0) return;           // asleep/frozen: the body won't answer
    const ix = this.possessInput.x, iz = this.possessInput.z;
    if ((ix || iz) && this.dashT <= 0) {
      const sprinting = this.possessInput.sprint && this.stamina.ally > 0;
      const sp = this.battlerSpeed("ally") * (sprinting ? 1.22 : 1);
      e.base.x += ix * sp * dt;
      e.base.z += iz * sp * dt;
      if (sprinting) this.spendStamina("ally", BALANCE.stamina.sprintDrain * dt);
      this.game.world.collide(e.base, e.size * 0.4);
      this.clampArena(e);
      e.snapGround();
    }
  }
  // Space — a real dodge: a burst of movement, distance from the Speed stat,
  // flavored by what this species IS (ghosts blink, moles burrow, birds glide).
  possessDash() {
    const e = this.allyEnt;
    if (this.over || this.dashCd > 0 || e.dead) return;
    const c = this.conds.ally;
    if (c.slp > 0 || c.frz > 0) return;
    if (!this.spendStamina("ally")) {
      this.game.ui.floatAt(e.pos(), "Too tired!", "miss");
      return;
    }
    const m = this.allyMon;
    const skill = speciesSkill(m.sp);
    let dir = V3(this.possessInput.x, 0, this.possessInput.z);
    if (dir.lengthSq() < 0.01) dir = e.base.clone().sub(this.enemyEnt.base).setY(0); // default: spring back
    dir.normalize();
    let dist = clamp(2.4 + m.spe * 0.016, 2.4, 5.4);
    let cd = clamp(1.8 - m.spe * 0.005, 0.85, 1.8);
    const fx = this.game.fx, w = this.game.world;
    const deepWater = w.height(e.base.x, e.base.z) < w.waterY - 0.4;
    if (skill === "teleport" || skill === "blink") {
      // vanish here, BE there — no travel time at all
      dist *= skill === "teleport" ? 1.25 : 1;
      const col = skill === "teleport" ? "#e8b0ff" : "#b08fd8";
      fx.burst(e.pos(), { count: 14, col, col2: "#ffffff", speed: 2.4, size: 0.2, life: 0.3 });
      e.base.addScaledVector(dir, dist);
      w.collide(e.base, e.size * 0.4);
      this.clampArena(e);
      e.snapGround();
      e.phasedT = 0.18;
      fx.burst(e.pos(), { count: 14, col, col2: "#ffffff", speed: 2.4, size: 0.2, life: 0.3 });
      this.game.audio.play("counter");
      this.dashCd = cd * (skill === "teleport" ? 1.15 : 1) * (c.par ? 1.6 : 1);
      this.dashT = 0.2;
      return;
    }
    if (skill === "zigzag") cd *= 0.72;                     // darting little body
    if (skill === "swoop") dist *= 1.25;                    // wings carry the dodge
    if (skill === "brace") { dist *= 0.7; this.braceT = 0.8; this.game.ui.floatAt(e.pos(), "Braced!", "status"); }
    if (skill === "burrow" || (skill === "dive" && deepWater)) e.phasedT = 0.4;  // duck clean under it
    this.dashCd = cd * (c.par ? 1.6 : 1);
    this.dashT = 0.2;
    const start = e.base.clone();
    this.game.audio.play("dodge");
    if (skill === "burrow") fx.burst(e.feet().add(V3(0, 0.2, 0)), { count: 12, col: "#b89a6a", col2: "#8a7048", speed: 2.6, size: 0.22, life: 0.4, g: 3 });
    else fx.burst(e.feet().add(V3(0, 0.25, 0)), { count: 8, col: "#dfe9ee", col2: "#aab8c0", speed: 2.2, size: 0.18, life: 0.35, g: 1.5 });
    const hop = skill === "swoop" ? e.size * 0.7 : 0;
    this.game.fx.anim(0.18, (k) => {
      const eased = 1 - (1 - k) * (1 - k);
      e.base.copy(start).addScaledVector(dir, dist * eased);
      if (hop) e.off.y = Math.sin(k * Math.PI) * hop;
      this.game.world.collide(e.base, e.size * 0.4);
      this.clampArena(e);
      e.snapGround();
    }, () => { e.off.y = 0; });
  }

  // ------------------------------------------------- spatial move execution
  kindOf(move: Move) { return (move as any).fx?.kind || (move.cls === "status" ? "auto" : move.cls === "phys" ? "dash" : "proj"); }
  isRanged(move: Move) { return RANGED_KINDS.has(this.kindOf(move)); }
  meleeReach() { return this.allyEnt.size * 0.55 + this.enemyEnt.size * 0.55 + 1.6; }
  distBetween() { return this.allyEnt.base.distanceTo(this.enemyEnt.base); }
  // HUD helper: can this move connect from here while possessed?
  rangeState(idx: number): "ok" | "far" {
    const m = MOVES[this.allyMon.moves[idx]];
    if (!m || !this.allyIsPlayerDriven() || !(m.power > 0) || this.isRanged(m) || this.kindOf(m) === "quake") return "ok";
    return this.distBetween() <= this.meleeReach() + 3.6 ? "ok" : "far";
  }
  expFactor(side: string) { return expFactorFor(this.monOf(side).lv); }
  execSpatial(side, move, idx?: number) {
    const atkEnt = this.ent(side);
    const d = this.game.fx.descFor(move);
    const charge = move.tags?.charge ? 0.55 : 0;
    // the wind-up IS the dodge window: sharper AND more experienced enemies
    // wind up faster — a Lv50 veteran barely telegraphs
    const windup = side === "enemy"
      ? charge + clamp(0.74 - this.aiIQ() * 0.28 - this.expFactor("enemy") * 0.2, 0.16, 0.8)
      : charge;
    if (side === "enemy" && move.power > 0) {
      const dir = this.allyEnt.base.clone().sub(this.enemyEnt.base).setY(0);
      if (dir.lengthSq() > 0.001) dir.normalize();
      this.incoming = { t: windup, max: windup, dir };
    }
    if (windup > 0) {
      this.game.audio.play("charge");
      this.game.fx.chargeGlow(atkEnt, d.col, windup);
    }
    const go = () => {
      if (this.over || atkEnt.dead || this.monOf(side).hp <= 0) return;
      // a clean counter-strike during the wind-up knocks the attack right
      // out of them — the skill-ceiling reward for aggressive timing
      if (side === "enemy" && this.enemyStaggerT > 0) {
        this.incoming = null;
        this.game.ui.floatAt(atkEnt.pos(), "Attack interrupted!", "eff");
        return;
      }
      if (this.kindOf(move) === "quake") this.quakeWave(side, move, idx);
      else if (this.isRanged(move)) this.fireProjectile(side, move, idx);
      else this.meleeStrike(side, move, idx);
    };
    windup > 0 ? this.game.fx.after(windup, go) : go();
  }
  // Earthquake/Fissure: a shockwave rolls outward along the ground. You don't
  // sidestep a quake — you time a dash (airborne feet) or get off the floor.
  quakeWave(side, move, idx?: number) {
    const atkEnt = this.ent(side), defEnt = this.ent(this.other(side));
    const fx = this.game.fx;
    const from = atkEnt.feet().clone();
    const R = 11, dur = 0.55;
    fx.ringAt(from.clone().add(V3(0, 0.12, 0)), { col: "#caa472", r0: 0.5, r1: R, dur });
    fx.burst(from, { count: 16, col: "#b89a6a", col2: "#8a7048", speed: 4, size: 0.3, life: 0.5, g: 4 });
    this.game.audio.hit("ground", true);
    this.envImpact(move, { feet: () => from.clone() }, true);
    let hitDone = false;
    const distTo = defEnt.base.clone().setY(0).distanceTo(from.clone().setY(0));
    fx.anim(dur, (k) => {
      if (hitDone || this.over || defEnt.dead) return;
      const wave = k * R;
      if (wave >= distTo) {
        hitDone = true;
        // airborne (mid-dash hop, swoop, levitation) or phased = it rolls under you
        const airborne = defEnt.off.y > 0.25 || defEnt.phasedT > 0 ||
          (this.possessed && this.other(side) === "ally" && this.dashT > 0);
        if (airborne) {
          this.game.ui.floatAt(defEnt.pos(), "Leapt over it!", "eff");
          // the quake rolled harmlessly under them — no contact, no PP
          if (this.other(side) === "ally") { this.counterT = 4; this.game.audio.play("counter"); }
        } else {
          // closer to the epicenter = harder shake
          this.resolveHit(side, move, { direct: true, skill: clamp(1.3 - distTo * 0.05, 0.75, 1.3), idx });
        }
      }
    });
  }
  projSpeed(move: Move) {
    const k = this.kindOf(move);
    return k === "beam" || k === "bolt" ? 30 : k === "stream" ? 24 : k === "lob" ? 13 : k === "cone" ? 14 : 18;
  }
  fireProjectile(side, move, idx?: number) {
    const fx = this.game.fx, d = fx.descFor(move);
    const atkEnt = this.ent(side), defEnt = this.ent(this.other(side));
    let from: THREE.Vector3;
    let dir: THREE.Vector3;
    if (side === "ally" && this.possessed) {
      // your aim is the accuracy now — launch from the camera's anchor so
      // shots fly true to the crosshair even on tiny species
      dir = this.game.camera.getWorldDirection(V3()).normalize();
      from = atkEnt.povEye();
      // gentle aim assist: a shot already ON the target (within ~8°) bends
      // toward where it's strafing to — forgiveness, not an aimbot
      const lead = defEnt.pos();
      const t = lead.distanceTo(from) / this.projSpeed(move);
      lead.x += defEnt.velX * t * 0.85;
      lead.z += defEnt.velZ * t * 0.85;
      const want = lead.sub(from).normalize();
      const cos = dir.dot(want);
      if (cos > 0.99 && !defEnt.dead && defEnt.phasedT <= 0) {
        dir.lerp(want, clamp((cos - 0.99) / 0.01, 0, 1) * 0.6).normalize();
      }
      this.punishT = 1.1;       // committing to a shot is an opening a veteran will take
    } else {
      from = atkEnt.pos();
      // AI leads the target by its velocity — IQ plus lived experience
      const lead = side === "enemy" ? clamp(this.aiIQ() * 0.55 + this.expFactor("enemy") * 0.45, 0, 1) : 0.7;
      const tgt = defEnt.pos();
      const t = tgt.distanceTo(from) / this.projSpeed(move);
      tgt.x += defEnt.velX * t * lead * 0.95;
      tgt.z += defEnt.velZ * t * lead * 0.95;
      dir = tgt.sub(from).normalize();
    }
    // low-accuracy moves wobble; green fighters spray, veterans group tight
    const sloppy = side === "enemy" ? (1 - clamp(this.aiIQ() * 0.6 + this.expFactor("enemy") * 0.4, 0, 1)) * 0.02 : 0;
    // firing on the run throws the shot off — planted aim is true aim
    const steady = this.aimSteadiness(side);
    const motionSpread = (1 - steady) * 0.06;
    const spread = (100 - (move.acc || 100)) * 0.0022 + sloppy + motionSpread;
    if (spread > 0) {
      dir.x += rnd(spread, -spread); dir.y += rnd(spread * 0.5, -spread * 0.5); dir.z += rnd(spread, -spread);
      dir.normalize();
    }
    from.addScaledVector(dir, side === "ally" && this.possessed ? 0.45 : atkEnt.size * 0.5);
    const kind = this.kindOf(move);
    const mesh = fx.spriteOf(fx.texSoft, d.col, clamp(0.55 + (move.power || 40) / 120, 0.55, 1.7));
    mesh.position.copy(from);
    const v = dir.multiplyScalar(this.projSpeed(move));
    if (kind === "lob") v.y += 3.6;
    this.projectiles.push({ p: from, v, side, move, mesh, life: kind === "cone" ? 0.6 : 2.4, trailT: 0, minD: 99, grav: kind === "lob" ? 9 : 0, dmgMul: 1, idx, steady });
    this.game.audio.play("shoot");
    fx.recoilHop(atkEnt, defEnt.pos(), -0.3);
    fx.flashLight(from, d.col, 1.6, 0.15, 6);
  }
  killProj(i: number, hit: boolean) {
    const pr = this.projectiles[i];
    this.projectiles.splice(i, 1);
    pr.mesh.material.dispose();
    this.game.scene.remove(pr.mesh);
    // a clean evade of an enemy shot is a dodge — and an opening
    if (!hit && pr.side === "enemy" && pr.minD < 2.1 && !this.allyEnt.dead) {
      this.game.ui.floatAt(this.allyEnt.pos(), "Dodged it!", "eff");
      this.game.audio.play("counter");
      this.counterT = 4;
    }
  }
  projImpactWorld(pr: BattleProj) {
    const fx = this.game.fx, d = fx.descFor(pr.move), w = this.game.world;
    fx.burst(pr.p, { count: 10, col: d.col, col2: d.col2, speed: 2.6, size: 0.22, life: 0.4, g: 2 });
    // moves scar the land where they actually land — cover matters
    this.envImpact(pr.move, { feet: () => pr.p.clone() }, (pr.move.power || 0) >= 80);
    this.game.audio.hit(pr.move.type, false);
    // an enemy shot a tree or rock swallows right next to you was YOUR good
    // footwork — break line of sight and the hit is on the scenery, not you
    if (pr.side === "enemy" && !this.allyEnt.dead && pr.p.distanceTo(this.allyEnt.pos()) < 3.4) {
      this.game.ui.floatAt(this.allyEnt.pos().add(V3(0, 1.1, 0)), "Blocked by cover!", "eff");
      this.counterT = Math.max(this.counterT, 2.5);
    }
    // the land catches what misses: lobbed gunk pools, fire scorches dry brush
    // into a burning patch, ice glazes water into a slick — each lingers and
    // bites whoever wanders in (capped so the arena never drowns in hazards)
    const T = pr.move.type, P = pr.move.power || 0, p = pr.p.clone();
    const onWater = w.height(p.x, p.z) < w.waterY - 0.25;
    const biome = w.biomeAt(p.x, p.z);
    if (this.hazards.length < 5 && P > 0) {
      if (this.kindOf(pr.move) === "lob" && ["poison", "water", "grass"].includes(T)) this.spawnHazard(p, T, pr.side);
      else if (T === "fire" && !onWater && (biome === "forest" || biome === "grass")) this.spawnHazard(p, "fire", pr.side);
      else if (T === "ice" && onWater) this.spawnHazard(p, "frost", pr.side);
    }
  }
  spawnHazard(p: THREE.Vector3, type: string, side: string) {
    p.y = this.game.world.height(p.x, p.z) + 0.05;
    this.hazards.push({ p, r: 1.7, t: type === "fire" ? 5 : 6, type, side, tickT: 0.4, fxT: 0 });
    const col = HAZARD_COL[type] || "#7ec850";
    this.game.fx.ringAt(p.clone().add(V3(0, 0.08, 0)), { col, r0: 0.3, r1: 1.7, dur: 0.5 });
  }
  updateHazards(dt) {
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i];
      h.t -= dt; h.fxT -= dt;
      if (h.t <= 0) { this.hazards.splice(i, 1); continue; }
      const col = HAZARD_COL[h.type] || "#7ec850";
      if (h.fxT <= 0) {
        h.fxT = 0.7;
        this.game.fx.burst(h.p.clone().add(V3(rnd(0.8, -0.8), 0.1, rnd(0.8, -0.8))), { count: 2, col, speed: 0.5, size: 0.16, life: 0.6, g: -0.4 });
      }
      // standing in someone else's puddle stings (and slows, see battlerSpeed)
      const victim = h.side === "ally" ? "enemy" : "ally";
      const ent = this.ent(victim), m = this.monOf(victim);
      if (ent.dead || m.hp <= 0 || ent.phasedT > 0) continue;
      const feet = ent.feet();
      if (Math.hypot(feet.x - h.p.x, feet.z - h.p.z) < h.r) {
        h.tickT -= dt;
        if (h.tickT <= 0 && HAZARD_HURTS.has(h.type)) {
          h.tickT = 1.0;
          if (!(victim === "ally" && this.game.state.cheats?.god)) {
            const dmg = Math.max(1, Math.floor(m.maxhp / 26));
            m.hp = Math.max(0, m.hp - dmg);
            this.game.ui.floatAt(ent.pos(), `-${dmg}`, "dmg");
            if (m.hp <= 0) { this.faint(victim); return; }
          }
        }
      }
    }
  }
  // Mid-air duels: opposing moves MEET. Water douses fire, beams cut through,
  // gusts shove things off course, near-equal trades detonate on the spot.
  resolveDuels() {
    const fx = this.game.fx;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const a = this.projectiles[i];
      if (!a) continue;
      for (let j = i - 1; j >= 0; j--) {
        const b = this.projectiles[j];
        if (!b || a.side === b.side) continue;
        if (a.p.distanceToSquared(b.p) > 0.85 * 0.85) continue;
        const kA = this.kindOf(a.move), kB = this.kindOf(b.move);
        const mid = a.p.clone().lerp(b.p, 0.5);
        // wind walls deflect rather than trade
        const deflect = (wind: BattleProj, other: BattleProj) => {
          const lat = V3(-other.v.z, 0, other.v.x).normalize().multiplyScalar(other.v.length() * 0.9);
          other.v.lerp(lat, 0.7);
          other.dmgMul *= 0.7;
          fx.burst(mid, { count: 8, col: "#dfeaf2", col2: "#bcd2de", speed: 3, size: 0.2, life: 0.35 });
          this.game.ui.floatAt(mid, `${wind.move.name} deflected it!`, "eff");
        };
        if (DEFLECT_KINDS.has(kA) && !DEFLECT_KINDS.has(kB)) { deflect(a, b); continue; }
        if (DEFLECT_KINDS.has(kB) && !DEFLECT_KINDS.has(kA)) { deflect(b, a); continue; }
        // type matters mid-air exactly like it does on a body:
        // Water Gun eats Ember for breakfast
        const sA = (a.move.power || 40) * typeMult(a.move.type, [b.move.type]) * (PIERCE_KINDS.has(kA) ? 1.7 : 1);
        const sB = (b.move.power || 40) * typeMult(b.move.type, [a.move.type]) * (PIERCE_KINDS.has(kB) ? 1.7 : 1);
        const dA = fx.descFor(a.move), dB = fx.descFor(b.move);
        fx.burst(mid, { count: 14, col: dA.col, col2: dB.col, speed: 3.4, size: 0.24, life: 0.45, g: 1 });
        this.game.audio.hit(sA >= sB ? a.move.type : b.move.type, false);
        if (Math.abs(sA - sB) <= Math.max(sA, sB) * 0.18) {
          // dead even — both detonate mid-air
          this.game.ui.floatAt(mid, `${a.move.name} and ${b.move.name} collided!`, "eff");
          this.killProjByRef(a); this.killProjByRef(b);
        } else if (sA > sB) {
          this.game.ui.floatAt(mid, `${a.move.name} broke through ${b.move.name}!`, "eff");
          a.dmgMul *= 0.75;
          this.killProjByRef(b);
        } else {
          this.game.ui.floatAt(mid, `${b.move.name} broke through ${a.move.name}!`, "eff");
          b.dmgMul *= 0.75;
          this.killProjByRef(a);
        }
        break;   // this projectile's frame is decided
      }
    }
  }
  killProjByRef(pr: BattleProj) {
    const i = this.projectiles.indexOf(pr);
    if (i >= 0) this.killProj(i, true);   // hit=true: a duel isn't a dodge
  }
  updateProjectiles(dt) {
    const w = this.game.world, fx = this.game.fx;
    this.resolveDuels();
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      pr.life -= dt;
      if (pr.grav) pr.v.y -= pr.grav * dt;
      const tgt = this.ent(this.other(pr.side));
      let done = false;
      // Substep so a slow frame can't tunnel the projectile through the
      // target: aim for ~0.25m of travel per collision check.
      const steps = clamp(Math.ceil((pr.v.length() * dt) / 0.25), 2, 14);
      for (let s = 0; s < steps && !done; s++) {
        pr.p.addScaledVector(pr.v, dt / steps);
        const hitR = 0.45 + tgt.size * 0.55;
        const dEnt = pr.p.distanceTo(tgt.pos());
        pr.minD = Math.min(pr.minD, dEnt);
        if (!tgt.dead && tgt.phasedT <= 0 && dEnt < hitR) {
          // how true was the shot? a centered hit fired from a planted stance is
          // a marksman's shot; a grazing, run-and-gun clip only chips
          const center = clamp(1 - dEnt / hitR, 0, 1);
          const aimQ = clamp(center * 0.6 + (pr.steady ?? 1) * 0.4, 0, 1);
          let skill = pr.dmgMul;
          if (pr.side === "ally") {
            skill *= this.possessed ? 0.8 + aimQ * 0.55 : this.style === "arena" ? 0.92 + aimQ * 0.26 : 1;
            if (aimQ > 0.74) this.game.ui.floatAt(tgt.pos(), "Clean hit!", "crit");
          }
          this.killProj(i, true);
          this.resolveHit(pr.side, pr.move, { direct: true, skill, idx: pr.idx });
          done = true; break;
        }
        if (pr.p.y < w.height(pr.p.x, pr.p.z) + 0.05 || pr.p.y < w.waterY - 0.3) {
          this.projImpactWorld(pr); this.killProj(i, false); done = true; break;
        }
        const probe = pr.p.clone();
        w.collide(probe, 0.28);
        if (probe.distanceToSquared(pr.p) > 0.0009) {  // smacked a tree, rock or wall
          this.projImpactWorld(pr); this.killProj(i, false); done = true; break;
        }
      }
      if (done) continue;
      pr.mesh.position.copy(pr.p);
      pr.trailT -= dt;
      if (pr.trailT <= 0) {
        pr.trailT = 0.05;
        const d = fx.descFor(pr.move);
        fx.burst(pr.p, { count: 1, col: d.col2, speed: 0.4, size: 0.14, life: 0.3, g: 0 });
      }
      if (pr.life <= 0) this.killProj(i, false);
    }
  }
  meleeStrike(side, move, idx?: number) {
    const atkEnt = this.ent(side), defEnt = this.ent(this.other(side));
    const fx = this.game.fx;
    const start = atkEnt.base.clone();
    const reach = this.meleeReach();
    this.game.audio.play("dodge");
    // the defender can read the lunge and pull its signature escape —
    // veterans react far more often than hatchlings
    if (side === "ally" && !this.enemyEnt.dead && this.brain.skillCd <= 0 && this.lock.enemy <= 0.4) {
      const ch = clamp(0.08 + this.aiIQ() * 0.28 + this.expFactor("enemy") * 0.3, 0, 0.62);
      if (Math.random() < ch) this.brainManeuver("melee");
    }
    // striking INTO a wind-up is the highest-skill play: bonus damage and the
    // attack gets knocked clean out of them
    const intercept = side === "ally" && this.possessed && this.incoming && this.incoming.t > 0;
    fx.anim(0.2, (k) => {
      // the lunge homes on where the target IS each frame, not a stale
      // snapshot — strafing foes stay catchable and contact feels modern
      const dirv = defEnt.base.clone().sub(start).setY(0);
      const lungeD = clamp(dirv.length() - reach * 0.45, 0, 4.6);
      dirv.normalize();
      atkEnt.base.copy(start).addScaledVector(dirv, lungeD * k);
      this.game.world.collide(atkEnt.base, atkEnt.size * 0.4);
      atkEnt.snapGround();
    }, () => {
      if (this.over || defEnt.dead) return;
      if (defEnt.phasedT <= 0 && atkEnt.base.distanceTo(defEnt.base) <= reach + 0.4) {
        let skill = 1;
        if (this.possessed && side === "ally") {
          skill = 1.05;                                  // landed contact: earned
          if (intercept) {
            skill = 1.35;
            this.enemyStaggerT = 1.0;                    // their wind-up fizzles (see execSpatial)
            this.game.ui.floatAt(defEnt.pos(), "Interrupted!", "crit");
          }
        }
        this.resolveHit(side, move, { direct: true, skill, idx });
      } else {
        this.game.ui.floatAt(atkEnt.pos(), `${move.name} missed!`, "miss");
        // swung at empty air — no PP spent (it only burns on contact)
        if (side === "enemy") this.counterT = Math.max(this.counterT, 2.5); // a whiff is an opening
        else if (this.possessed) {
          // YOUR whiff is an opening too — the floor drops for sloppy swings
          this.enemyCounterT = 3;
          this.punishT = 1.2;
          this.game.ui.floatAt(atkEnt.pos(), "Exposed!", "status");
        }
      }
    });
  }

  // -------------------------------------------- spatial brain (the opponent)
  // The enemy is a creature in space now: it keeps the range its moveset
  // likes, orbits, plants to attack, evades with its species' signature
  // maneuver and reads terrain. Experience (level) sharpens everything.
  // A sudden, species-true escape: ghosts blink, moles burrow, birds swoop...
  brainManeuver(reason: "proj" | "melee") {
    const e = this.enemyEnt, m = this.enemy();
    const b = this.brain, fx = this.game.fx, w = this.game.world;
    const skill = speciesSkill(m.sp);
    b.skillCd = clamp(3.4 - this.expFactor("enemy") * 1.6, 1.6, 3.4);
    const away = e.base.clone().sub(this.allyEnt.base).setY(0).normalize();
    const lat = V3(-away.z, 0, away.x).multiplyScalar(Math.random() < 0.5 ? 1 : -1);
    const deepWater = w.height(e.base.x, e.base.z) < w.waterY - 0.4;
    if (skill === "teleport" || skill === "blink") {
      const col = skill === "teleport" ? "#e8b0ff" : "#b08fd8";
      fx.burst(e.pos(), { count: 14, col, col2: "#fff", speed: 2.4, size: 0.2, life: 0.3 });
      const jump = lat.multiplyScalar(skill === "teleport" ? 5 : 3.6).addScaledVector(away, skill === "teleport" ? 2.2 : 0.8);
      e.base.add(jump);
      w.collide(e.base, e.size * 0.4); this.clampArena(e); e.snapGround();
      e.phasedT = 0.22;
      fx.burst(e.pos(), { count: 14, col, col2: "#fff", speed: 2.4, size: 0.2, life: 0.3 });
      this.game.ui.floatAt(e.pos(), skill === "teleport" ? "Teleported!" : "Phased away!", "eff");
      return;
    }
    if (skill === "burrow" || (skill === "dive" && deepWater)) {
      e.phasedT = 0.7;
      fx.burst(e.feet().add(V3(0, 0.2, 0)), {
        count: 14, col: skill === "burrow" ? "#b89a6a" : "#9fd4f0",
        col2: skill === "burrow" ? "#8a7048" : "#e8f6ff", speed: 2.8, size: 0.24, life: 0.45, g: 3,
      });
      this.game.ui.floatAt(e.pos(), skill === "burrow" ? "Burrowed under!" : "Dived under!", "eff");
      return;
    }
    if (skill === "brace") {
      this.enemyBraceT = 0.9;
      e.pulse(0.85);
      this.game.ui.floatAt(e.pos(), "Braced for it!", "status");
      return;
    }
    // swoop / zigzag / none: a sharp physical evade
    const d = skill === "swoop" ? 4.2 : skill === "zigzag" ? 4.0 : 3.4;
    const hop = skill === "swoop" ? e.size * 0.8 : 0;
    const start = e.base.clone();
    const dir = reason === "melee" ? lat.addScaledVector(away, 0.6).normalize() : lat.normalize();
    fx.anim(0.2, (k) => {
      e.base.copy(start).addScaledVector(dir, d * k);
      if (hop) e.off.y = Math.sin(k * Math.PI) * hop;
      w.collide(e.base, e.size * 0.4); this.clampArena(e); e.snapGround();
    }, () => { e.off.y = 0; });
    if (skill === "swoop") this.punishT = Math.max(this.punishT, 0.9);   // dives right back in
  }
  updateBrainMove(dt) {
    const e = this.enemyEnt;
    if (this.over || e.dead || e.captureLock) return;
    if (this.lock.enemy > 0.9) return;                       // committed to an attack
    if (this.incoming && this.incoming.t > 0) return;        // planted for the wind-up
    const b = this.brain;
    b.skillCd -= dt;
    b.strafeT -= dt;
    const exp = this.expFactor("enemy");
    if (b.strafeT <= 0) {
      const skill = speciesSkill(this.enemy().sp);
      b.strafeT = skill === "zigzag" ? rnd(1.1, 0.4) : rnd(2.6, 1);   // darty things flip constantly
      if (Math.random() < 0.55) b.strafe *= -1;
      // a beat of animal hesitation — veterans don't freeze up
      b.pauseT = Math.random() < 0.3 * (1 - exp * 0.7) ? rnd(0.8, 0.25) : 0;
    }
    if (b.pauseT > 0) { b.pauseT -= dt; return; }
    const m = this.enemy();
    const temper = DEX[m.sp].temper;
    const iq = this.aiIQ();
    // engagement range from the moveset: brawlers crowd you, casters kite
    const dmgMoves = m.moves.map((id) => MOVES[id]).filter((mv) => mv && mv.power > 0);
    const meleeBias = dmgMoves.length ? dmgMoves.filter((mv) => !this.isRanged(mv)).length / dmgMoves.length : 0.5;
    let pref = 2.4 + (1 - meleeBias) * 6.8;
    if (temper === "aggressive") pref *= 0.6;
    if (temper === "skittish") pref *= 1.5;
    if (m.hp < m.maxhp * 0.25 && temper !== "aggressive") pref += 2.5; // hurt animals keep distance
    const ally = this.allyEnt;
    const to = ally.base.clone().sub(e.base); to.y = 0;
    const dist = Math.max(to.length(), 0.001);
    to.normalize();
    let mx = 0, mz = 0;
    if (dist > pref + 0.9) { mx += to.x; mz += to.z; }
    else if (dist < pref - 0.9) { mx -= to.x; mz -= to.z; }
    // you committed to an attack — a veteran closes the gap while you recover
    if (this.punishT > 0) {
      this.punishT -= dt;
      const sharp = iq * 0.45 + exp * 0.55;
      if (sharp > 0.42) { mx += to.x * 1.3; mz += to.z * 1.3; }
    }
    const orbitW = temper === "aggressive" ? 0.45 : temper === "skittish" ? 1.1 : 0.8;
    mx += -to.z * b.strafe * orbitW;
    mz += to.x * b.strafe * orbitW;
    // evade incoming player shots — reaction speed comes with experience
    if (b.dodgeReact > 0) b.dodgeReact -= dt;
    for (const pr of this.projectiles) {
      if (pr.side !== "ally" || b.dodgeReact > 0) continue;
      const toMe = e.pos().sub(pr.p);
      const tc = toMe.dot(pr.v) / Math.max(pr.v.lengthSq(), 0.001);
      if (tc > 0 && tc < 0.4 + exp * 0.3) {                  // vets see it coming sooner
        b.dodgeReact = clamp(0.75 - exp * 0.35, 0.3, 0.75);
        const chance = clamp(0.1 + iq * 0.4 + exp * 0.32 + m.spe / 700, 0, 0.92);
        if (Math.random() < chance) {
          if (b.skillCd <= 0) { this.brainManeuver("proj"); }
          else {
            const lat = V3(-pr.v.z, 0, pr.v.x).normalize().multiplyScalar(Math.random() < 0.5 ? 3.4 : -3.4);
            mx += lat.x; mz += lat.z;
          }
        }
      }
    }
    // don't loiter in a player-made hazard pool
    const hz = this.inHazard("enemy");
    if (hz && iq + exp > 0.4) {
      const out = e.base.clone().sub(hz.p).setY(0).normalize();
      mx += out.x * 1.6; mz += out.z * 1.6;
    }
    // terrain sense for sharp minds
    if (iq > 0.5) {
      const w = this.game.world;
      const inWater = w.height(e.base.x, e.base.z) < w.waterY - 0.25;
      const aquatic = DEX[m.sp].types.includes("water");
      const elecDanger = typeMult("electric", DEX[m.sp].types) > 1 &&
        this.allyMon.moves.some((id) => MOVES[id]?.type === "electric");
      if (inWater && elecDanger) {
        // scramble for dry land before you light the water up
        let bx = 0, bz = 0, bh = -99;
        for (let a = 0; a < 6; a++) {
          const ang = (a / 6) * Math.PI * 2;
          const h = w.height(e.base.x + Math.cos(ang) * 5, e.base.z + Math.sin(ang) * 5);
          if (h > bh) { bh = h; bx = Math.cos(ang); bz = Math.sin(ang); }
        }
        mx += bx * 2.2; mz += bz * 2.2;
      } else if (!inWater && aquatic) {
        // water types drift toward their element (boosted moves, fast swimming)
        for (let a = 0; a < 6; a++) {
          const ang = (a / 6) * Math.PI * 2;
          if (w.height(e.base.x + Math.cos(ang) * 5, e.base.z + Math.sin(ang) * 5) < w.waterY - 0.3) {
            mx += Math.cos(ang) * 0.7; mz += Math.sin(ang) * 0.7;
            break;
          }
        }
      }
    }
    const L = Math.hypot(mx, mz);
    if (L < 0.05) return;
    const sp = this.battlerSpeed("enemy") * 0.85;
    e.base.x += (mx / L) * sp * dt;
    e.base.z += (mz / L) * sp * dt;
    this.game.world.collide(e.base, e.size * 0.4);
    this.clampArena(e);
    e.snapGround();
  }

  update(dt) {
    if (this.over) return;
    const rt = this.style !== "classic";   // classic: no clocks, turns ARE the time
    this.lock.ally -= dt; this.lock.enemy -= dt;
    this.switchLock -= dt; this.runLock -= dt;
    this.dodgeCd -= dt; this.counterT -= dt;
    this.braceT -= dt; this.enemyBraceT -= dt;
    this.enemyStaggerT -= dt; this.enemyCounterT -= dt;
    if (this.incoming) {
      this.incoming.t -= dt;
      if (this.incoming.t <= 0) { this.incoming = null; this.dodging = false; }
    }
    for (const s of ["ally", "enemy"]) {
      for (let i = 0; i < 4; i++) this.cds[s][i] -= dt;
      const c = this.conds[s];
      if (rt) {
        for (const k of ["slp", "frz", "conf", "disable", "sleepLock", "freezeLock"]) { if (c[k] > 0) c[k] -= dt; }
        if (c.aura) {
          c.aura.t -= dt;
          if (c.aura.t <= 0) delete c.aura;
        }
        this.staminaRegenCd[s] -= dt;
        if (this.staminaRegenCd[s] <= 0 && this.stamina[s] < BALANCE.stamina.max) {
          const fast = clamp(this.monOf(s).spe / 120, 0.55, 1.35);
          this.stamina[s] = Math.min(BALANCE.stamina.max, this.stamina[s] + BALANCE.stamina.regen * fast * dt);
        }
      }
      if (c.screenPhys > 0 && rt) c.screenPhys -= dt;
      if (c.screenSpec > 0 && rt) c.screenSpec -= dt;
      // damage over time (classic applies it per turn instead, RBY style)
      if (!rt) continue;
      this.dotT[s] -= dt;
      if (this.dotT[s] <= 0) {
        this.dotT[s] = BALANCE.status.dotTick;
        this.applyDot(s);
      }
    }
    // condition particles
    this.condFxT -= dt;
    if (this.condFxT <= 0) {
      this.condFxT = 1.4;
      for (const s of ["ally", "enemy"]) {
        const c = this.conds[s];
        for (const k of ["brn", "psn", "tox", "para", "frz", "slp", "conf", "seed"]) {
          if (k === "slp" || k === "frz" || k === "conf" ? c[k] > 0 : c[k]) this.game.fx.conditionTick(this.ent(s), k === "tox" ? "psn" : k);
        }
      }
    }
    if (this.over) return;
    // banked press from the input buffer fires the instant it's legal
    if (this.buffered) {
      this.buffered.t -= dt;
      if (this.buffered.t <= 0) this.buffered = null;
      else if (this.lock.ally <= 0 && this.cds.ally[this.buffered.idx] <= 0 && !this.allyEnt.dead) {
        const idx = this.buffered.idx;
        this.buffered = null;
        this.useMove("ally", idx);
      }
    }
    if (this.style !== "classic") {
      // enemy AI — slower thinkers hesitate between actions; veterans punish
      // your recovery windows by thinking double-time
      this.enemyThink -= dt;
      if (this.punishT > 0 && this.enemyThink > 0.3 && this.aiIQ() * 0.5 + this.expFactor("enemy") * 0.5 > 0.45) this.enemyThink -= dt;
      if (this.enemyThink <= 0 && this.lock.enemy <= 0 && !this.enemyEnt.captureLock) {
        this.enemyThink = BALANCE.enemyPace + rnd(1.1, 0.45) + (1 - this.aiIQ()) * rnd(0.9, 0.3) - this.expFactor("enemy") * 0.25;
        this.enemyAct();
      }
      // v7: live projectiles + the spatial brain + possessed movement
      this.hintT -= dt;
      this.updateProjectiles(dt);
      this.updateHazards(dt);
      this.updateBrainMove(dt);
      if (this.hasDirectAllyControl()) this.updateDirectControl(dt);
      // fp style: after a throw/menu/switch interruption, dive back into the mon
      if (this.style === "fp" && this.wantPossess && !this.possessed &&
          !this.allyEnt.dead && this.allyMon.hp > 0) {
        const g = this.game;
        const busy = g.ui.modalOpen || g.aim || g.thrown.length > 0 || this.enemyEnt.captureLock || g.cutscene;
        if (busy) this.resumeT = Math.max(this.resumeT, 0.5);
        else {
          this.resumeT -= dt;
          if (this.resumeT <= 0) this.setPossessed(true);
        }
      }
    }
    // the combatants square off, tracking each other as they move
    if (!this.allyEnt.dead && !this.enemyEnt.dead) {
      if (!this.possessed) this.allyEnt.lookToward(this.enemyEnt.base);
      this.enemyEnt.lookToward(this.allyEnt.base);
    }
    if (!this.allyEnt.dead) this.allyEnt.updateVisual(dt);
    if (this.type === "trainer" && !this.enemyEnt.dead) this.enemyEnt.updateVisual(dt);
    // leash player (their body stays put while they're possessing)
    if (!this.possessed) {
      const pd = this.game.playerPos.distanceTo(this.midPoint);
      if (pd > 30) {
        if (this.type === "wild") { this.game.ui.toast("You left the battle!", "bad"); this.end("fled"); }
        else {
          const dir = this.game.playerPos.clone().sub(this.midPoint).normalize();
          this.game.playerPos.copy(this.midPoint).addScaledVector(dir, 29.5);
          this.game.ui.toast("Can't run from a trainer battle!", "bad");
        }
      }
    }
  }

  // one pulse of burn/poison/seed damage (real-time: every 2.5s; classic: per turn)
  applyDot(s: string) {
    const c = this.conds[s];
    const m = this.monOf(s);
    if (s === "ally" && this.game.state.cheats?.god) return;
    let dot = 0;
    if (c.brn) dot += m.maxhp / 16;
    if (c.psn) dot += m.maxhp / 16;
    if (c.tox) { c.toxN = (c.toxN || 0) + 1; dot += (m.maxhp / 16) * c.toxN; }
    if (c.seed) {
      dot += m.maxhp / 16;
      const o = this.monOf(this.other(s));
      o.hp = Math.min(o.maxhp, o.hp + m.maxhp / 16);
    }
    if (dot > 0 && m.hp > 0) {
      m.hp = Math.max(0, m.hp - Math.floor(dot));
      this.game.ui.floatAt(this.ent(s).pos(), `-${Math.floor(dot)}`, "dmg");
      if (m.hp <= 0) this.faint(s);
    }
  }

  // ====================================================== classic (RBY turns)
  // True turn-based play: you pick, the order is decided by priority then
  // Speed, both moves resolve, end-of-turn damage ticks, back to you.
  classicMove(idx: number) {
    if (this.style !== "classic" || this.turnPhase !== "player" || this.over) return;
    const mon = this.allyMon;
    const mv = MOVES[mon.moves[idx]];
    if (!mv) return;
    // pre-validate so a dead click doesn't burn the turn
    if (mon.pp && (mon.pp[idx] ?? 0) <= 0 && mon.moves.some((_, i) => (mon.pp[i] ?? 0) > 0)) {
      this.game.ui.floatAt(this.allyEnt.pos(), "No PP left!", "miss");
      return;
    }
    const c = this.conds.ally;
    if (c.disable > 0 && c.disabledIdx === idx) {
      this.game.ui.floatAt(this.allyEnt.pos(), "Disabled!", "miss");
      return;
    }
    this.runClassicRound(idx);
  }
  runClassicRound(allyIdx: number) {
    this.turnPhase = "busy";
    const fx = this.game.fx;
    const eIdx = this.chooseEnemyMoveIdx();
    const aMove = MOVES[this.allyMon.moves[allyIdx]];
    const eMove = eIdx != null ? MOVES[this.enemy().moves[eIdx]] : null;
    // RBY order: priority bracket first, then effective Speed, ties random
    const aPri = aMove?.pri || 0, ePri = eMove?.pri || 0;
    const mySpe = this.effSpe("ally"), foeSpe = this.effSpe("enemy");
    const allyFirst = aPri !== ePri ? aPri > ePri
      : mySpe === foeSpe ? Math.random() < 0.5 : mySpe > foeSpe;
    const steps: Array<[number, () => void]> = [];
    const moveStep = (side: string, idx: number) => () => {
      if (this.over || this.monOf(side).hp <= 0 || this.ent(side).dead) return;
      this.useMove(side, idx, { classic: true });
    };
    const first = allyFirst ? moveStep("ally", allyIdx) : (eIdx != null ? moveStep("enemy", eIdx) : () => {});
    const second = allyFirst ? (eIdx != null ? moveStep("enemy", eIdx) : () => {}) : moveStep("ally", allyIdx);
    steps.push([0.05, first], [1.7, second], [3.1, () => this.classicEndTurn()]);
    for (const [t, fn] of steps) fx.after(t, () => { if (!this.over) fn(); });
  }
  // the enemy's reply when your turn was spent on something other than a move
  // (a thrown ball, an item, a switch, a failed run)
  enemyFreeTurn(delay = 0.9) {
    if (this.style !== "classic" || this.over || this.freeTurnPending) return;
    this.freeTurnPending = true;
    this.turnPhase = "busy";
    const fx = this.game.fx;
    fx.after(delay, () => {
      if (this.over) return;
      const eIdx = this.chooseEnemyMoveIdx();
      if (eIdx != null && this.enemy().hp > 0) this.useMove("enemy", eIdx, { classic: true });
      fx.after(1.5, () => { if (!this.over) this.classicEndTurn(); });
    });
  }
  classicEndTurn() {
    this.freeTurnPending = false;
    if (this.over) return;
    this.applyDot("ally");
    if (!this.over) this.applyDot("enemy");
    // statuses and screens run on turns here, not seconds
    for (const s of ["ally", "enemy"]) {
      const c = this.conds[s];
      for (const k of ["slp", "frz", "conf", "disable"]) if (c[k] > 0) c[k] -= 2.2;
      if (c.screenPhys > 0) c.screenPhys -= 4;
      if (c.screenSpec > 0) c.screenSpec -= 4;
    }
    this.turnPhase = "player";
  }
  // a ball left your hand in a classic wild battle — that was your turn
  onBallThrown() {
    if (this.style === "classic" && !this.over) this.turnPhase = "busy";
  }
  // the wild broke free: in classic it gets a free swing at you
  onCatchFail() {
    if (this.style === "classic" && !this.over) this.enemyFreeTurn(0.7);
  }
  // the ball never connected (rolled away, sank, sailed off) — the throw was
  // still your whole turn, so the enemy answers and play returns to you.
  // Without this, a missed throw left turnPhase stuck on "busy" forever.
  onBallMissed() {
    if (this.style === "classic" && !this.over && this.turnPhase === "busy" && !this.freeTurnPending) {
      this.enemyFreeTurn(0.5);
    }
  }

  // How sharp is the opponent right now? 0 = picks moves on a whim,
  // 1 = always the optimal call. "Adaptive" ramps up with your badge count —
  // early-route Rattata don't run damage calcs.
  aiIQ(): number {
    const setting = this.game.state.settings?.ai || "adaptive";
    if (setting === "novice") return 0.12;
    if (setting === "trained") return 0.55;
    if (setting === "ace") return 1;
    const badges = this.game.state.badges.length;
    let iq = 0.15 + badges * 0.1;                       // 0.15 → 0.95 over the journey
    if (this.type === "wild") {
      iq *= 0.55;                                       // instinct, not strategy
      iq += clamp((this.enemy().lv - 25) / 100, 0, 0.25); // veterans fight smarter
    } else {
      const t = this.trainer.def;
      if (t.champion) return 1;                          // Blue never throws a turn
      if (t.gym) iq = Math.max(iq, 0.55 + badges * 0.05);
      iq = Math.max(iq, 0.25);
    }
    return clamp(iq, 0.05, 1);
  }
  enemyAct() {
    const m = this.enemy();
    if (this.conds.enemy.slp > 0 || this.conds.enemy.frz > 0) return;
    // skittish wilds may flee at low HP (real-time styles only — RBY wilds stand and fight)
    if (this.type === "wild" && DEX[m.sp].temper === "skittish" && m.hp < m.maxhp * 0.2 && Math.random() < 0.3) {
      this.game.ui.toast(`The wild ${monName(m)} fled!`, "bad");
      this.end("enemyFled");
      return;
    }
    const idx = this.chooseEnemyMoveIdx();
    if (idx != null) this.useMove("enemy", idx);
  }
  // Move selection brain, shared by every style. IQ decides whether it
  // reasons about matchups at all; experience tightens the judgement noise.
  chooseEnemyMoveIdx(): number | null {
    const m = this.enemy();
    const noPP = m.pp && m.moves.every((_, i) => (m.pp[i] ?? 0) <= 0);
    const ready = m.moves.map((id, i) => ({ id, i }))
      .filter((x) => {
        const mv = MOVES[x.id];
        if (!mv) return false;
        if (!noPP && m.pp && (m.pp[x.i] ?? 0) <= 0) return false;
        if (this.style === "classic") return true;
        if (this.cds.enemy[x.i] > 0) return false;
        return this.moveRole(mv) !== "burst" || this.energy.enemy >= this.energyCostFor(mv);
      });
    if (!ready.length) return null;
    if (noPP) return ready[0].i;   // Struggle
    const iq = this.aiIQ();
    const exp = this.expFactor("enemy");
    // a lapse in judgement: low-IQ opponents just use whatever comes to mind
    if (Math.random() > iq) {
      const pick = ready[irnd(0, ready.length - 1)];
      this.conds.enemy["used_" + pick.id] = true;
      return pick.i;
    }
    const myTypes = DEX[m.sp].types, foe = this.allyMon;
    let best = null, bestScore = -1;
    for (const r of ready) {
      const mv = MOVES[r.id];
      const role = this.moveRole(mv);
      let score;
      if (mv.cls === "status") {
        const k = mv.effect?.k;
        const used = this.conds.enemy["used_" + r.id];
        score = used ? 2 : 26;
        if (k === "heal" && m.hp < m.maxhp * 0.45) score = 70;
        if ((k === "sleep" || k === "para") && !this.allyHasStatus()) score = 45;
      } else {
        const eff = typeMult(mv.type, DEX[foe.sp].types);
        const stab = myTypes.includes(mv.type) ? 1.5 : 1;
        score = (mv.power || 30) * eff * stab * (mv.acc ? mv.acc / 100 : 1) * 0.5;
        // in spatial styles a veteran weighs whether it can actually DELIVER
        // the move from here: contact moves score lower from across the arena
        if (this.style !== "classic" && !this.isRanged(mv) && exp > 0.3) {
          const gap = this.distBetween() - this.meleeReach();
          if (gap > 4) score *= 0.55;
        }
      }
      if (this.style !== "classic") {
        if (this.reactionWouldTrigger("ally", mv.type)) score += 38 + 24 * iq;
        else if (mv.power > 0 && this.auraFor(mv.type) && !this.conds.ally.aura && !this.conds.enemy["used_" + r.id]) score += 14 + 18 * iq;
        if (role === "burst") score *= this.punishT > 0 ? 1.9 : (iq > 0.35 ? 0.25 : 0.75);
      }
      // sloppy thinkers misjudge matchups; veterans barely waver
      score += rnd(8 + (1 - iq) * 50 * (1 - exp * 0.5));
      if (score > bestScore) { bestScore = score; best = r; }
    }
    if (!best) return null;
    this.conds.enemy["used_" + best.id] = true;
    return best.i;
  }
  allyHasStatus() { const c = this.conds.ally; return c.slp > 0 || c.par || c.brn || c.psn || c.frz > 0; }

  // PP burns only on a clean connect — never on a miss, a dodge, a blocked
  // shot, an out-of-range swing or a no-effect hit. There's no up-front debit
  // and no refund dance: the counter ticks down the instant a move LANDS, so
  // what you see is exactly what you spent. (Struggle and infpp aside.)
  spendPP(side: string, idx?: number) {
    if (idx == null) return;
    if (side === "ally" && this.game.state.cheats?.infpp) return;
    const m = this.monOf(side);
    if (m.pp && m.pp[idx] != null) m.pp[idx] = Math.max(0, m.pp[idx] - 1);
  }
  useMove(side, idx, o: { classic?: boolean } = {}) {
    if (this.over) return;
    // classic style: an ally keypress is a TURN, not a real-time action
    if (this.style === "classic" && !o.classic) {
      if (side === "ally") this.classicMove(idx);
      return;
    }
    const mon = this.monOf(side);
    if (!MOVES[mon.moves[idx]]) return;
    // PP: out-of-PP moves can't be used; when EVERY move is empty, Struggle!
    let moveId = mon.moves[idx], struggle = false;
    if (mon.pp && (mon.pp[idx] ?? 0) <= 0) {
      const anyLeft = mon.moves.some((_, i) => (mon.pp[i] ?? 0) > 0);
      if (anyLeft) {
        if (side === "ally") this.game.ui.floatAt(this.ent(side).pos(), "No PP left!", "miss");
        return;
      }
      moveId = STRUGGLE_ID; struggle = true;
    }
    const move = MOVES[moveId];
    const c = this.conds[side];
    const role = this.moveRole(move);
    if (!o.classic && (this.lock[side] > 0 || this.cds[side][idx] > 0)) {
      // almost ready? bank the press instead of dropping it
      const wait = Math.max(this.lock[side], this.cds[side][idx]);
      if (side === "ally" && wait <= 0.5) this.buffered = { idx, t: wait + 0.25 };
      return;
    }
    if (!o.classic && role === "burst") {
      const cost = this.energyCostFor(move);
      if (this.energy[side] < cost) {
        if (side === "ally") this.game.ui.floatAt(this.ent(side).pos(), "Not enough energy!", "miss");
        return;
      }
    }
    if (side === "ally" && this.buffered?.idx === idx) this.buffered = null;
    if (c.slp > 0) { this.game.ui.floatAt(this.ent(side).pos(), "Fast asleep!", "status"); return; }
    if (c.frz > 0) { this.game.ui.floatAt(this.ent(side).pos(), "Frozen!", "status"); return; }
    if (c.disable > 0 && c.disabledIdx === idx) { this.game.ui.floatAt(this.ent(side).pos(), "Disabled!", "status"); return; }
    if (this.ent(side).captureLock) return;
    // confusion self-hit
    if (c.conf > 0 && Math.random() < 0.33) {
      const god = side === "ally" && this.game.state.cheats?.god;
      const dmg = god ? 0 : Math.max(1, Math.floor(mon.maxhp * 0.06));
      mon.hp = Math.max(0, mon.hp - dmg);
      this.game.ui.floatAt(this.ent(side).pos(), `Hurt itself! -${dmg}`, "status");
      this.ent(side).shake(0.3, 0.3);
      this.lock[side] = 0.8;
      if (mon.hp <= 0) this.faint(side);
      return;
    }
    // possessed spatial combat: contact moves need you actually in range —
    // checked BEFORE anything is spent, so a hopeless swing costs nothing
    const spatial = !o.classic && move.power > 0 && (side === "enemy" || (side === "ally" && this.allyIsPlayerDriven()));
    if (spatial && side === "ally" && !this.isRanged(move) && this.kindOf(move) !== "quake" && this.distBetween() > this.meleeReach() + 3.6) {
      this.game.ui.floatAt(this.allyEnt.pos(), "Too far!", "miss");
      if (this.hintT <= 0) { this.hintT = 6; this.game.ui.toast("Contact moves need you close — move in or dash!", ""); }
      return;
    }
    // no debit here — PP is charged only when the move actually lands (spendPP)
    if (struggle && side === "ally") this.game.ui.floatAt(this.ent(side).pos(), "Struggle!", "status");
    if (!o.classic) {
      if (role === "burst") {
        this.energy[side] = Math.max(0, this.energy[side] - this.energyCostFor(move));
        this.cds[side][idx] = 0;
      } else this.cds[side][idx] = this.cdFor(side, move);
      // your four moves run independent clocks — weave Q/E/R/F freely; only
      // real commitments (charge-ups, Hyper Beam recharge) lock the body. The
      // enemy keeps a half-second action pace so its AI reads as deliberate.
      this.lock[side] = (role === "burst" ? (side === "ally" ? 0.45 : 1.0) : (side === "ally" ? 0.15 : 0.7)) + (move.tags?.charge ? 0.55 : 0);
      if (move.tags?.recharge) this.lock[side] += role === "burst" ? 0.55 : 1.2;
    }
    const atkEnt = this.ent(side), defEnt = this.ent(this.other(side));
    if (side === "ally") this.lastMoveIdx = idx;
    // trainer callout, like the anime — unless you ARE the Pokémon
    if (side === "ally" && !struggle && !this.possessed) this.game.ui.floatAt(atkEnt.pos().add(V3(0, 0.8, 0)), `${monName(mon)}, ${move.name}!`, "call");
    // possessed: damaging moves go fully spatial — aimed shots and gap-close strikes
    if (spatial) {
      this.execSpatial(side, move, idx);
      if (side === "enemy") this.lastEnemyMove = move.id;
      return;
    }
    // telegraph the enemy's attack so the player can call a dodge (Space) —
    // classic has no dodge command, the turns speak for themselves
    if (side === "enemy" && move.power > 0 && !o.classic) {
      const windup = (move.tags?.charge ? 0.55 : 0) + 0.5;
      const dir = this.allyEnt.base.clone().sub(this.enemyEnt.base).setY(0);
      if (dir.lengthSq() > 0.001) dir.normalize();
      this.incoming = { t: windup, max: windup, dir };
    }
    this.game.fx.playMove(move, atkEnt, defEnt, () => this.resolveHit(side, move, { idx }));
    if (side === "enemy") this.lastEnemyMove = move.id;
  }

  // v3 environment: terrain + weather shape the damage, like the anime.
  envMult(side: string, move: Move): { m: number; why: string | null } {
    const g = this.game;
    const at = this.ent(side).feet();
    const zone = g.world.zoneAt(at.x, at.z);
    const biome = g.world.biomeAt(at.x, at.z);
    let m = 1, why: string | null = null;
    const T = move.type;
    if ((T === "water" && (biome === "lake" || zone === "seafoam")) ||
        ((T === "rock" || T === "ground") && (biome === "cave" || biome === "mountain")) ||
        ((T === "grass" || T === "bug") && (biome === "forest" || zone === "grassland" || zone === "safari")) ||
        (T === "electric" && zone === "power-plant") ||
        ((T === "ghost" || T === "psychic") && zone === "lavender" && g.world.isNight()) ||
        (T === "ice" && zone === "seafoam")) {
      m *= 1.2; why = "Terrain boost!";
    }
    const w = g.world.weather;
    if (w === "rain" || w === "storm") {
      if (T === "water") { m *= 1.25; why = "Rain boost!"; }
      if (T === "fire") { m *= 0.7; why = "Doused by rain..."; }
      if (T === "electric" && w === "storm") { m *= 1.25; why = "Storm charged!"; }
    }
    // anime rules: electricity conducts through the water the target stands in
    const defFeet = this.ent(this.other(side)).feet();
    if (T === "electric" && g.world.height(defFeet.x, defFeet.z) < g.world.waterY - 0.2) {
      m *= 1.3; why = "Conducted by water!";
    }
    return { m, why };
  }

  // v5: the world reacts to the fight — scorched earth, craters, frost rings,
  // rustled trees, steam in the rain, debris from cave ceilings.
  envImpact(move, defEnt, big: boolean) {
    const g = this.game, fx = g.fx, w = g.world;
    const at = defEnt.feet();
    const T = move.type;
    const inWater = w.height(at.x, at.z) < w.waterY - 0.25;
    fx.groundFX(T, at, { big, world: w, inWater });
    // nearby trees rustle and shed leaves
    for (const t of w.treesNear(at, big ? 9 : 6, big ? 4 : 2)) {
      fx.burst(V3(t.x, t.h + 3.6 * t.s, t.z), { count: big ? 9 : 5, col: "#3f7d36", col2: "#7ec850", speed: 2.0, size: 0.22, life: 0.9, g: 2.2, up: 0.4 });
    }
    // weather talks back
    const weather = w.weather;
    if (T === "fire" && (weather === "rain" || weather === "storm")) {
      fx.burst(at.clone().add(V3(0, 0.5, 0)), { count: 14, col: "#e8eef2", col2: "#cfd8dc", speed: 1.1, size: 0.5, life: 1.1, g: -0.8, drag: 1.5 });
    }
    if (T === "electric" && weather === "storm" && big) {
      const sky = at.clone().add(V3(rnd(2, -1), 26, rnd(2, -1)));
      fx.boltBetween(sky, at, { col: "#fff7b0", width: 0.12, dur: 0.4, segs: 12 });
      fx.flashLight(at, "#fff2a0", 5, 0.3, 40);
    }
    // heavy quakes in caves knock debris off the ceiling
    if ((T === "ground" || T === "rock") && big && w.caveDim > 0.25) fx.caveDebris(at, w);
    // fighting on the water sends out rings
    if (inWater) fx.ringAt(at.clone().setY(w.waterY + 0.06), { col: "#bfe6ff", r0: 0.4, r1: big ? 4 : 2.4, dur: 0.7 });
  }

  auraFor(type: string): string | null {
    if (type === "fire") return "burning";
    if (type === "water") return "wet";
    if (type === "electric") return "charged";
    if (type === "ice") return "chill";
    return null;
  }
  applyAura(targetSide: string, move: Move) {
    if (this.style === "classic" || move.cls === "status") return;
    const aura = this.auraFor(move.type);
    if (aura) this.conds[targetSide].aura = { type: aura, t: 4, moveType: move.type };
  }
  reactionWouldTrigger(targetSide: string, type: string) {
    const c = this.conds[targetSide], aura = c.aura?.type;
    return (aura === "wet" && type === "electric") ||
      ((aura === "chill" || c.frz > 0) && type === "fire") ||
      (aura === "burning" && type === "water") ||
      (c.seed && type === "fire");
  }
  resolveReaction(targetSide: string, move: Move): { name: string; mult: number; chip?: number } | null {
    if (this.style === "classic" || move.cls === "status") return null;
    const c = this.conds[targetSide];
    const aura = c.aura?.type;
    let r: { name: string; mult: number; chip?: number } | null = null;
    if (aura === "wet" && move.type === "electric") r = { name: "Conduct!", mult: BALANCE.reactions.conduct };
    else if ((aura === "chill" || c.frz > 0) && move.type === "fire") {
      c.frz = 0;
      r = { name: "Melt!", mult: BALANCE.reactions.melt };
    } else if (aura === "burning" && move.type === "water") {
      c.brn = false;
      r = { name: "Steam!", mult: 1 + BALANCE.reactions.steam, chip: Math.max(1, Math.floor(this.monOf(targetSide).maxhp * 0.04)) };
    } else if (c.seed && move.type === "fire") {
      c.brn = true;
      r = { name: "Bloom!", mult: BALANCE.reactions.bloom };
    }
    if (!r) return null;
    delete c.aura;
    const ent = this.ent(targetSide);
    this.game.ui.floatAt(ent.pos().add(V3(0, 1.25, 0)), r.name, "crit");
    this.game.fx.burst(ent.pos().add(V3(0, 0.6, 0)), { count: 14, col: TYPE_COLORS[move.type] || "#fff", col2: "#ffffff", speed: 2.1, size: 0.22, life: 0.55 });
    return r;
  }

  resolveHit(side, move, opts: { direct?: boolean; skill?: number; idx?: number } = {}) {
    if (this.over) return;
    const other = this.other(side);
    const atk = this.monOf(side), def = this.monOf(other);
    const atkEnt = this.ent(side), defEnt = this.ent(other);
    if (def.hp <= 0 || atk.hp <= 0) return;
    const ui = this.game.ui, fx = this.game.fx;
    // a called dodge can void the enemy's hit entirely (success scales with Speed)
    if (side === "enemy" && this.dodging && move.power > 0 && !opts.direct) {
      this.dodging = false;
      this.incoming = null;
      const ch = clamp(0.42 + this.allyMon.spe / 380, 0, 0.88);
      if (Math.random() < ch) {
        ui.floatAt(this.allyEnt.pos(), "Dodged it!", "eff");
        this.game.audio.play("counter");
        this.counterT = 4; // the opening: next hit lands harder
        return;
      }
      ui.floatAt(this.allyEnt.pos(), "Too slow!", "miss");
    }
    // Accuracy matters in real-time too: spatial hits that fail the roll graze
    // instead of whiffing, so the contact still counts but loses its payoff.
    let grazed = false;
    if (move.acc > 0) {
      let accMult = STAGE_MULT(this.stages[side].acc) / STAGE_MULT(this.stages[other].eva);
      const w = this.game.world.weather;
      if (w === "fog") accMult *= 0.85;
      const noMiss = move.key === "thunder" && (w === "rain" || w === "storm");
      if (opts.direct) accMult *= 0.72 + (this.aimSteadiness(side) * 0.5);
      if (!noMiss && Math.random() > (move.acc / 100) * accMult) {
        if (opts.direct && move.cls !== "status") {
          grazed = true;
        } else {
        ui.floatAt(defEnt.pos(), "MISS", "miss");
        return;
        }
      }
    }
    if (opts.direct) this.incoming = null;
    if (move.tags?.reqSleep && !(this.conds[other].slp > 0)) {
      ui.floatAt(defEnt.pos(), "It failed!", "miss");
      return;
    }
    // status moves — the move resolved, so it's earned its PP
    if (move.cls === "status") {
      this.spendPP(side, opts.idx);
      this.applyEffect(side, move, move.effect || { k: "splash" });
      return;
    }
    // damage
    const eff = typeMult(move.type, DEX[def.sp].types);
    if (eff === 0) {
      ui.floatAt(defEnt.pos(), `Doesn't affect ${monName(def)}...`, "weak");
      return;
    }
    const reaction = !grazed ? this.resolveReaction(other, move) : null;
    let dmg, crit = false;
    if (side === "ally" && this.game.state.cheats?.ohko && move.power > 0) {
      dmg = def.hp;
      ui.floatAt(defEnt.pos(), "One-hit KO! (cheat)", "crit");
    } else if (move.tags?.ohko) {
      dmg = atk.lv >= def.lv ? def.hp : 0;
      if (!dmg) { ui.floatAt(defEnt.pos(), "It failed!", "miss"); return; }
      ui.floatAt(defEnt.pos(), "One-hit KO!", "crit");
    } else if (move.tags?.fixed !== undefined) {
      const f = move.tags.fixed;
      dmg = f === "level" ? atk.lv : f === "half" ? Math.floor(def.hp / 2) : f === "rand" ? Math.floor(atk.lv * rnd(1.5, 0.5)) : f;
      dmg = Math.max(1, dmg);
    } else {
      const phys = move.cls === "phys";
      // Gen 1 crit rate: baseSpeed/512 (x8 for high-crit moves, x4 after Focus Energy*)
      const critRate = clamp((DEX[atk.sp].base.spe / 512) * (move.tags?.highcrit ? 8 : 1) * (this.conds[side].focus ? 4 : 1), 0, 255 / 256);
      crit = Math.random() < critRate;
      let A, D;
      if (crit) {
        // Gen 1 crits ignore stat stages, screens and burn
        A = phys ? atk.atk : atk.spc;
        D = phys ? def.def : def.spc;
      } else {
        A = phys ? atk.atk * STAGE_MULT(this.stages[side].atk) : atk.spc * STAGE_MULT(this.stages[side].spc);
        D = phys ? def.def * STAGE_MULT(this.stages[other].def) : def.spc * STAGE_MULT(this.stages[other].spc);
        if (this.conds[side].brn && phys) A *= 0.5;
        if (phys && this.conds[other].screenPhys > 0) D *= 2;
        if (!phys && this.conds[other].screenSpec > 0) D *= 2;
      }
      // Gen 1 damage formula; a crit doubles the level term (not a flat x2)
      const lvTerm = crit ? atk.lv * 2 : atk.lv;
      let base = Math.floor(Math.floor((Math.floor((2 * lvTerm) / 5 + 2) * move.power * A) / Math.max(1, D)) / 50) + 2;
      const stab = DEX[atk.sp].types.includes(move.type) ? 1.5 : 1;
      dmg = Math.max(1, Math.floor(base * stab * eff * (rnd(255, 217) / 255)));
      // v3: terrain + weather shape the damage
      const env = this.envMult(side, move);
      if (env.m !== 1) {
        dmg = Math.max(1, Math.floor(dmg * env.m));
        if (env.why) ui.floatAt(atkEnt.pos().add(V3(0, 1.4, 0)), env.why, env.m > 1 ? "eff" : "weak");
      }
      // counter window opened by a successful dodge
      if (side === "ally" && this.counterT > 0) {
        dmg = Math.floor(dmg * 1.3);
        this.counterT = 0;
        ui.floatAt(defEnt.pos().add(V3(0, 1.2, 0)), "Counter strike!", "crit");
      }
      // ---- first-person skill economy: the ceiling and the floor ----
      // earned multipliers from aim quality, melee timing, quake spacing
      if (opts.skill && opts.skill !== 1) dmg = Math.max(1, Math.floor(dmg * opts.skill));
      if (reaction) dmg = Math.max(1, Math.floor(dmg * reaction.mult) + (reaction.chip || 0));
      // you whiffed and left yourself open — the enemy collects
      if (side === "enemy" && this.enemyCounterT > 0) {
        dmg = Math.floor(dmg * 1.3);
        this.enemyCounterT = 0;
        ui.floatAt(defEnt.pos().add(V3(0, 1.2, 0)), "Caught you open!", "crit");
      }
      // a braced heavy shrugs off part of anything that still connects
      if (other === "enemy" && this.enemyBraceT > 0) {
        dmg = Math.max(1, Math.floor(dmg * 0.6));
        ui.floatAt(defEnt.pos().add(V3(0, 1.0, 0)), "Braced through it!", "status");
      }
      // possessed: attacks hit HARDER by default — your footwork is the defense.
      // Mid-dash = graze, brace shield = soak, plain standing there = full price.
      if (this.allyIsPlayerDriven() && other === "ally" && move.power > 0) {
        let inc = 1.2;
        if (this.dashT > 0) { inc *= 0.45; ui.floatAt(defEnt.pos().add(V3(0, 1.0, 0)), "Grazed!", "eff"); }
        else if (this.braceT > 0) { inc *= 0.5; ui.floatAt(defEnt.pos().add(V3(0, 1.0, 0)), "Braced through it!", "status"); }
        else if (Math.abs(this.possessInput.x) + Math.abs(this.possessInput.z) > 0.1) inc *= 0.85;
        dmg = Math.max(1, Math.floor(dmg * inc));
      }
      let hits = 1;
      if (move.tags?.multi) {
        const [lo, hi] = move.tags.multi;
        hits = lo === hi ? lo : (Math.random() < 0.75 ? irnd(2, 3) : irnd(4, 5));
        dmg *= hits;
        ui.floatAt(defEnt.pos(), `Hit ${hits} times!`, "eff");
      }
    }
    if (move.tags?.bide) dmg = Math.max(20, this.bideDmg[side] * 2);
    if (other === "ally" && this.game.state.cheats?.god) {
      ui.floatAt(defEnt.pos(), "Protected!", "heal");
      return;
    }
    // gentler difficulty (for now): the enemy hits you a little softer so the
    // interactive footwork has room to breathe
    if (side === "enemy" && move.power > 0) dmg = Math.max(1, Math.floor(dmg * BALANCE.enemyDmg));
    if (grazed) {
      dmg = Math.max(1, Math.floor(dmg * BALANCE.accuracy.grazeMult));
      ui.floatAt(defEnt.pos().add(V3(0, 1.1, 0)), "Grazed!", "eff");
    }
    // the blow connects — charge the PP now, never on the swing
    this.spendPP(side, opts.idx);
    if (!grazed && move.cls !== "status") {
      this.addEnergy(side, this.energyGainFor(move));
      this.addEnergy(other, BALANCE.energy.onHitTaken);
    }
    def.hp = Math.max(0, def.hp - dmg);
    this.bideDmg[other] += dmg;
    setTimeout(() => (this.bideDmg[other] = Math.max(0, this.bideDmg[other] - dmg)), 3000);
    // first-person feedback: a crosshair hitmarker for landing yours, a red
    // edge flash + camera kick for eating one
    if (this.possessed) {
      if (side === "ally") ui.hitmarker(crit || eff > 1);
      else if (other === "ally") { ui.hurtFlash(); fx.shakeAmt = Math.max(fx.shakeAmt, 0.1); }
    }
    ui.floatAt(defEnt.pos(), `-${dmg}`, crit ? "crit" : "dmg");
    if (crit) ui.floatAt(defEnt.pos().add(V3(0, 0.6, 0)), "Critical hit!", "crit");
    if (eff > 1) ui.floatAt(defEnt.pos().add(V3(0, 0.9, 0)), "It's super effective!", "eff");
    else if (eff < 1) ui.floatAt(defEnt.pos().add(V3(0, 0.9, 0)), "Not very effective...", "weak");
    this.game.audio.hit(move.type, move.power >= 90);
    fx.playHit(move, defEnt, { eff, crit, fromPos: atkEnt.pos(), big: move.power >= 100 });
    this.envImpact(move, defEnt, move.power >= 80);
    // ---- environment as a weapon: a solid blow shoves them around the arena.
    // Super-effective, critical or heavy hits knock the defender back; ride a
    // foe into their own hazard pool or off into deep water and the terrain
    // collects the bonus. Real-time only — classic keeps its fixed stage.
    if (this.style !== "classic" && move.power > 0 && def.hp > 0 && !defEnt.dead && defEnt.phasedT <= 0) {
      const heavy = eff > 1 || crit || dmg >= Math.max(8, def.maxhp * 0.16);
      const dir = defEnt.base.clone().sub(atkEnt.base).setY(0);
      if (heavy && dir.lengthSq() > 1e-4) {
        dir.normalize();
        const amt = clamp(0.8 + (move.power || 0) / 130, 0.8, 2.2) * (other === "ally" && this.possessed ? 0.6 : 1);
        defEnt.knock(dir, amt);
        this.clampArena(defEnt);
        const f = defEnt.feet();
        if (this.inHazard(other)) {
          ui.floatAt(defEnt.pos().add(V3(0, 1.1, 0)), "Driven into the hazard!", "eff");
          fx.ringAt(f.clone().add(V3(0, 0.08, 0)), { col: "#c98bff", r0: 0.3, r1: 1.6, dur: 0.4 });
        } else if (this.game.world.height(f.x, f.z) < this.game.world.waterY - 0.3) {
          ui.floatAt(defEnt.pos().add(V3(0, 1.1, 0)), "Knocked into the water!", "eff");
          fx.ringAt(V3(f.x, this.game.world.waterY + 0.05, f.z), { col: "#bfe6ff", r0: 0.3, r1: 2.2, dur: 0.5 });
        }
      }
    }
    // drains & recoil
    if (move.tags?.drain) {
      const h = Math.max(1, Math.floor(dmg * move.tags.drain));
      atk.hp = Math.min(atk.maxhp, atk.hp + h);
      ui.floatAt(atkEnt.pos(), `+${h}`, "heal");
    }
    if (move.tags?.recoil && !(side === "ally" && this.game.state.cheats?.god)) {
      const r = Math.max(1, Math.floor(dmg * move.tags.recoil));
      atk.hp = Math.max(0, atk.hp - r);
      ui.floatAt(atkEnt.pos(), `Recoil -${r}`, "dmg");
    }
    if (move.tags?.selfko) atk.hp = 0;
    // secondary effect
    if (!grazed) this.applyAura(other, move);
    if (!grazed && move.sec && def.hp > 0 && Math.random() < (move.sec.p || 0.1)) this.applyEffect(side, move, move.sec, true);
    if (def.hp <= 0) this.faint(other);
    if (atk.hp <= 0) this.faint(side);
  }

  applyEffect(side, move, eff, isSecondary = false) {
    const other = this.other(side);
    const targetSide = eff.t === "self" || eff.k === "heal" || eff.k === "rest" ? side : other;
    const tEnt = this.ent(targetSide), tMon = this.monOf(targetSide), c = this.conds[targetSide];
    const ui = this.game.ui, fx = this.game.fx;
    const label = { atk: "Attack", def: "Defense", spe: "Speed", spc: "Special", acc: "Accuracy", eva: "Evasion" };
    switch (eff.k) {
      case "stage": {
        if (targetSide !== side && this.conds[targetSide].mist) { ui.floatAt(tEnt.pos(), "Protected by Mist!", "status"); return; }
        const st = this.stages[targetSide];
        st[eff.stat] = clamp(st[eff.stat] + eff.d, -6, 6);
        ui.floatAt(tEnt.pos(), `${label[eff.stat]} ${eff.d > 0 ? (eff.d > 1 ? "rose sharply!" : "rose!") : (eff.d < -1 ? "fell sharply!" : "fell!")}`, eff.d > 0 ? "heal" : "status");
        if (!isSecondary) fx.statusFX(tEnt, eff.d > 0);
        break;
      }
      case "sleep": {
        if (this.style !== "classic" && c.sleepLock > 0) { ui.floatAt(tEnt.pos(), "Resisted sleep!", "miss"); break; }
        c.slp = this.style === "classic" ? rnd(4.5, 2.5) : rnd(BALANCE.status.sleep[1], BALANCE.status.sleep[0]);
        if (this.style !== "classic") c.sleepLock = BALANCE.status.reapplyLockout;
        ui.floatAt(tEnt.pos(), "Fell asleep!", "status");
        break;
      }
      case "para": if (!c.para) { c.para = true; ui.floatAt(tEnt.pos(), "Paralyzed!", "status"); } break;
      case "brn": if (!c.brn) { c.brn = true; ui.floatAt(tEnt.pos(), "Burned!", "status"); } break;
      case "psn": if (!c.psn && !c.tox) { c.psn = true; ui.floatAt(tEnt.pos(), "Poisoned!", "status"); } break;
      case "tox": if (!c.tox) { c.tox = true; c.toxN = 0; c.psn = false; ui.floatAt(tEnt.pos(), "Badly poisoned!", "status"); } break;
      case "frz": {
        if (this.style !== "classic" && c.freezeLock > 0) { ui.floatAt(tEnt.pos(), "Resisted freeze!", "miss"); break; }
        if (!(c.frz > 0)) {
          c.frz = this.style === "classic" ? 3 : BALANCE.status.freeze;
          if (this.style !== "classic") c.freezeLock = BALANCE.status.reapplyLockout;
          ui.floatAt(tEnt.pos(), "Frozen solid!", "status");
        }
        break;
      }
      case "conf": c.conf = rnd(5, 2.5); ui.floatAt(tEnt.pos(), "Confused!", "status"); break;
      case "flinch": this.lock[targetSide] = Math.max(this.lock[targetSide], 1.1); ui.floatAt(tEnt.pos(), "Flinched!", "status"); break;
      case "heal": {
        const h = Math.floor(tMon.maxhp * (eff.f || 0.5));
        tMon.hp = Math.min(tMon.maxhp, tMon.hp + h);
        ui.floatAt(tEnt.pos(), `+${h}`, "heal");
        fx.healGlow(tEnt);
        break;
      }
      case "rest": tMon.hp = tMon.maxhp; this.conds[side].slp = this.style === "classic" ? 2.2 : BALANCE.status.sleep[1]; ui.floatAt(tEnt.pos(), "Slept and healed!", "heal"); fx.healGlow(tEnt); break;
      case "screen": { this.conds[side][eff.s === "phys" ? "screenPhys" : "screenSpec"] = 20; ui.floatAt(this.ent(side).pos(), eff.s === "phys" ? "Reflect raised Defense!" : "Light Screen raised Special!", "heal"); break; }
      case "haze": this.stages.ally = this.zeroStages(); this.stages.enemy = this.zeroStages(); ui.floatAt(tEnt.pos(), "All stat changes erased!", "status"); break;
      case "focus": this.conds[side].focus = true; ui.floatAt(this.ent(side).pos(), "Getting pumped!", "heal"); break;
      case "mist": this.conds[side].mist = true; ui.floatAt(this.ent(side).pos(), "Shrouded in Mist!", "heal"); break;
      case "seed": if (!DEX[tMon.sp].types.includes("grass")) { c.seed = true; ui.floatAt(tEnt.pos(), "Seeded!", "status"); } else ui.floatAt(tEnt.pos(), "It failed!", "miss"); break;
      case "disable": { c.disable = 6; c.disabledIdx = irnd(0, tMon.moves.length - 1); ui.floatAt(tEnt.pos(), `${MOVES[tMon.moves[c.disabledIdx]].name} was disabled!`, "status"); break; }
      case "flee": {
        if (this.type === "wild") {
          if (eff.t === "enemy" && side === "ally") { ui.toast(`The wild ${monName(this.enemy())} was blown away!`, "good"); this.end("enemyFled"); }
          else if (side === "enemy") { ui.toast(`The wild ${monName(this.enemy())} fled!`, "bad"); this.end("enemyFled"); }
          else { ui.toast("You teleported away!", "good"); this.end("fled"); }
        } else ui.floatAt(tEnt.pos(), "It failed!", "miss");
        break;
      }
      case "metronome": {
        const dmgMoves = Object.values(MOVES).filter((m) => m.power > 0);
        const pick = choice(dmgMoves);
        ui.floatAt(this.ent(side).pos(), `Metronome → ${pick.name}!`, "eff");
        this.game.fx.playMove(pick, this.ent(side), this.ent(other), () => this.resolveHit(side, pick));
        break;
      }
      case "mirror": {
        const last = side === "ally" ? this.lastEnemyMove : null;
        if (last) {
          const mv = MOVES[last];
          ui.floatAt(this.ent(side).pos(), `Mirrored ${mv.name}!`, "eff");
          this.game.fx.playMove(mv, this.ent(side), this.ent(other), () => this.resolveHit(side, mv));
        } else ui.floatAt(this.ent(side).pos(), "It failed!", "miss");
        break;
      }
      case "transform": {
        const foe = this.monOf(other), me = this.monOf(side);
        me.moves = [...foe.moves];
        me.pp = me.moves.map(() => 5);   // Gen 1: Transform grants 5 PP per move
        me.atk = foe.atk; me.def = foe.def; me.spe = foe.spe; me.spc = foe.spc;
        this.ent(side).setSpecies(foe.sp);
        ui.floatAt(this.ent(side).pos(), `Transformed into ${monName(foe)}!`, "eff");
        break;
      }
      case "conversion": ui.floatAt(tEnt.pos(), "Converted type!", "status"); DEX[this.monOf(side).sp].types && (this.convType = DEX[this.monOf(other).sp].types[0]); break;
      case "mimic": {
        const foe = this.monOf(other), me = this.monOf(side);
        const idx = me.moves.findIndex((m) => MOVES[m].key === "mimic");
        if (idx >= 0) {
          me.moves[idx] = choice(foe.moves);
          if (me.pp) me.pp[idx] = MOVES[me.moves[idx]].pp;
          ui.floatAt(this.ent(side).pos(), `Mimicked ${MOVES[me.moves[idx]].name}!`, "eff");
        }
        break;
      }
      case "sub": {
        const m = this.monOf(side);
        if (m.hp > m.maxhp / 4) { m.hp -= Math.floor(m.maxhp / 4); this.conds[side].sub = Math.floor(m.maxhp / 4); ui.floatAt(this.ent(side).pos(), "Made a substitute!", "status"); }
        else ui.floatAt(this.ent(side).pos(), "Too weak!", "miss");
        break;
      }
      case "bide": ui.floatAt(this.ent(side).pos(), "Storing energy...", "status"); break;
      case "splash": ui.floatAt(this.ent(side).pos(), "Nothing happened!", "miss"); break;
      default: break;
    }
  }

  faint(side) {
    if (this.over) return;
    if (side === "ally" && this.possessed) this.setPossessed(false);  // ejected back to your own eyes
    const mon = this.monOf(side), ent = this.ent(side);
    this.game.audio.play("faint");
    this.game.fx.faint(ent);
    this.game.ui.floatAt(ent.pos(), `${monName(mon)} fainted!`, "crit");
    if (side === "enemy") {
      // award xp (Gen 1: baseExp * level / 7, x1.5 for trainer battles)
      let xp = Math.floor((DEX[mon.sp].exp * mon.lv) / 7 * (this.type === "trainer" ? 1.5 : 1));
      const am = this.allyMon;
      if (am && am.hp > 0) {
        // Gen 1 Stat Experience: gain the defeated species' base stats
        am.sexp = am.sexp || ZERO_SEXP();
        const sb = DEX[mon.sp].base;
        for (const k of ["hp", "atk", "def", "spe", "spc"]) am.sexp[k] = Math.min(65535, am.sexp[k] + sb[k]);
        // happy Pokémon fight harder (anime rules)
        if ((am.hap || 0) >= 200) { xp = Math.floor(xp * 1.1); this.game.ui.floatAt(ent.pos(), "Happiness bonus!", "heal"); }
        if (this.style !== "classic") {
          xp = Math.floor(xp * BALANCE.xp.realtime);
          this.game.ui.floatAt(ent.pos().add(V3(0, 0.75, 0)), this.style === "fp" ? "First-Person bonus!" : "Arena bonus!", "heal");
        }
        am.hap = clamp((am.hap || 70) + 3, 0, 255);
        this.game.ui.toast(`${monName(am)} gained ${xp} XP!`, "good");
        this.game.handleXp(am, xp);
      }
      // Exp. Share: the rest of the party splits a portion of the spoils, so a
      // benched team still grows. (Can be turned off in the pause menu.)
      if (this.game.state.settings?.expShare !== false) {
        const share = Math.max(1, Math.floor(xp * 0.5));
        for (const pm of this.game.state.party) {
          if (pm === am || pm.hp <= 0) continue;
          this.game.handleXp(pm, share);
        }
      }
      this.game.addTrainerXp(this.type === "trainer" ? 18 : 12);
      if (this.type === "wild") {
        const drop = 8 + mon.lv * 2;
        this.game.state.money += drop;
        this.game.ui.toast(`Found ₽${drop} on the ground!`, "good");
        this.end("won");
      } else {
        this.trainerPartyIdx++;
        if (this.trainerPartyIdx >= this.trainer.def.party.length) this.end("wonTrainer");
        else {
          const old = this.enemyEnt;
          setTimeout(() => { if (!this.over) old.fadeOut(); }, 600);
          setTimeout(() => { if (!this.over) this.nextTrainerMon(); }, 1500);
        }
      }
    } else {
      mon.hap = clamp((mon.hap || 70) - 5, 0, 255);
      setTimeout(async () => {
        if (this.over) return;
        const aliveIdx = this.game.state.party.findIndex((m) => m.hp > 0);
        if (aliveIdx < 0) { this.end("lost"); return; }
        const pick = await this.game.ui.openSwitch(true);
        if (this.over) return;
        this.doSwitch(pick != null ? pick : aliveIdx, true);
      }, 700);
    }
    this.game.ui.updateParty();
  }
  nextTrainerMon() {
    const mon = makeMon(this.trainer.def.party[this.trainerPartyIdx], this.trainer.levelFor(this.trainerPartyIdx));
    const pos = this.enemyAnchor.clone();
    this.enemyEnt = new MonEntity(this.game, mon, pos);
    this.game.markSeen(mon.sp);
    this.game.fx.burst(this.enemyEnt.pos(), { count: 18, col: "#fff", col2: "#ff9d9d", speed: 3, size: 0.3, life: 0.45 });
    this.game.audio.play("switch");
    this.game.audio.cry(mon.sp, DEX[mon.sp].height);
    this.game.ui.toast(`${this.trainer.def.name} sent out ${monName(mon)}!`, "bad");
    this.cds.enemy = [0, 0, 0, 0];
    this.stages.enemy = this.zeroStages();
    this.conds.enemy = {};
    this.energy.enemy = 0;
    this.stamina.enemy = BALANCE.stamina.max;
    this.staminaRegenCd.enemy = 0;
    this.lock.enemy = 1.8;   // the player gets the first strike on each new foe
    this.game.ui.setBattle(this);
  }
  doSwitch(partyIdx, forced = false) {
    const mon = this.game.state.party[partyIdx];
    if (!mon || mon.hp <= 0 || (mon === this.allyMon && !forced)) return;
    if (!forced && this.switchLock > 0) return;
    // classic: you can't recall a Pokémon while the round is still resolving —
    // that would stack extra free turns onto the same round
    if (!forced && this.style === "classic" && this.turnPhase !== "player") {
      this.game.ui.toast("Wait for your turn!", "bad");
      return;
    }
    this.switchLock = 2;
    this.buffered = null;               // stale presses don't carry to the new mon
    const oldEnt = this.allyEnt;
    if (!oldEnt.dead) oldEnt.fadeOut();
    this.game.setLead(partyIdx);
    this.allyMon = mon;
    const pos = oldEnt.base.clone();
    this.allyEnt = new MonEntity(this.game, mon, pos);
    this.game.fx.burst(this.allyEnt.pos(), { count: 18, col: "#fff", col2: "#9fc6ff", speed: 3, size: 0.3, life: 0.45 });
    this.game.audio.play("switch");
    this.game.audio.cry(mon.sp, DEX[mon.sp].height);
    this.cds.ally = [0, 0, 0, 0];
    this.stages.ally = this.zeroStages();
    this.conds.ally = {};
    this.energy.ally = 0;
    this.stamina.ally = BALANCE.stamina.max;
    this.staminaRegenCd.ally = 0;
    this.lock.ally = 1.2;
    this.game.ui.toast(`Go, ${monName(mon)}!`, "good");
    this.game.ui.setBattle(this);
    this.game.ui.updateParty();
    // classic: a voluntary switch hands the opponent a free swing (RBY rules);
    // a forced one (after a faint) just resets the turn
    if (this.style === "classic") {
      if (forced) this.turnPhase = "player";
      else this.enemyFreeTurn(1.3);
    }
  }
  tryRun() {
    if (this.type === "trainer") { this.game.ui.toast("Can't run from a trainer battle!", "bad"); return; }
    if (this.runLock > 0) return;
    if (this.style === "classic" && this.turnPhase !== "player") return;
    this.runLock = 1.4;
    const meSpe = this.effSpe("ally"), foeSpe = this.effSpe("enemy");
    if (meSpe >= foeSpe || Math.random() < 0.7) {
      this.game.audio.play("flee");
      this.game.ui.toast("Got away safely!", "good");
      this.end("fled");
    } else {
      this.game.ui.toast("Can't escape!", "bad");
      if (this.style === "classic") this.enemyFreeTurn(0.7);   // a failed run is a spent turn
    }
  }
  end(result) {
    if (this.over) return;
    this.wantPossess = false;
    if (this.possessed) this.setPossessed(false);
    while (this.projectiles.length) this.killProj(0, true);   // hit=true: no phantom dodge credit
    this.hazards.length = 0;
    this.over = true;
    const g = this.game;
    if (!this.allyEnt.dead) this.allyEnt.fadeOut();
    if (this.type === "wild") {
      const w = this.enemyEnt;
      w.engaged = false;
      if (result === "won" || result === "enemyFled" || result === "caught") {
        const idx = g.wilds.indexOf(w);
        if (idx >= 0) g.wilds.splice(idx, 1);
        if (result !== "caught" && !w.dead) w.fadeOut();
      } else if (!w.dead) {
        w.state = "flee"; w.fleeT = 3;
        w.mon.hp = Math.max(w.mon.hp, 1);
        w.takeOff?.();   // sky dwellers beat their wings and climb away
      }
    } else if (!this.enemyEnt.dead) this.enemyEnt.fadeOut();
    if (result === "wonTrainer") {
      const t = this.trainer;
      // Gen 1 prize money: trainer-class base payout x the last Pokemon's level
      const lastIdx = t.def.party.length - 1;
      const pay = Math.floor(t.levelFor(lastIdx) * (t.def.pay || 20) * (t.def.payMul || 1));
      g.state.money += pay;
      const prev = g.state.beaten[t.def.id];
      g.state.beaten[t.def.id] = { ts: Date.now(), n: prev ? prev.n + 1 : 1 };
      g.addTrainerXp(t.def.gym ? 250 : t.def.champion ? 400 : 60);
      if (t.def.champion) {
        // ----- HALL OF FAME -----
        g.state.hof = g.state.hof || [];
        g.state.hof.push({ ts: Date.now(), name: g.state.name || "Trainer", team: g.state.party.map((m) => ({ sp: m.sp, lv: m.lv })) });
        g.audio.play("fanfare");
        g.fx.confetti(g.playerPos.clone().add(V3(0, 2, 0)), true);
        g.ui.toast("You defeated the Champion!", "good");
        (async () => {
          await g.ui.dialog(t.def.name, [t.def.dlg[1], `You got ₽${pay} for winning!`]);
          g.ui.openFame();
        })();
      } else {
        g.ui.dialog(t.def.name, [t.def.dlg[1], `You got ₽${pay} for winning!`]);
      }
      if (t.def.rocket) {
        // they always have a nugget on them, and they always blast off
        g.state.items.nugget = (g.state.items.nugget || 0) + 1;
        g.ui.toast("They dropped a NUGGET as they flew!", "good");
      }
      if (t.def.gym && !g.state.badges.includes(t.def.gym)) {
        g.state.badges.push(t.def.gym);
        g.audio.play("badge");
        g.ui.toast(`You received the ${BADGE_META[t.def.gym].name.toUpperCase()}!`, "good");
        g.ui.toast("Word of your win is spreading across Kanto.", "");
        if (g.state.badges.length >= 8) {
          g.world.openCaveGate();
          g.ui.toast("The barrier sealing Cerulean Cave has been lifted...", "");
        }
        // story beats: the rival tracks your badge count from his feed
        const n = g.state.badges.length, st = g.state.story;
        if (n >= 2 && !st.rival2 && st.rivalDue == null) st.rivalDue = 1;
        if (n >= 5 && !st.rival3 && st.rivalDue == null) st.rivalDue = 2;
      }
    }
    if (this.trainer) this.trainer.engaging = false;
    // Team Rocket blasts off again (win or flee — comedy law)
    if (this.trainer?.def.rocket) {
      const npc = this.trainer;
      g.ui.toast("Looks like Team Rocket's blasting off again!", "good");
      g.fx.blastOff(npc.group, () => {});
      const i = g.trainers.indexOf(npc);
      if (i >= 0) g.trainers.splice(i, 1);
    }
    this.disposeArena();
    g.ui.setBattle(null);
    g.battle = null;
    g.syncFollower();
    if (result === "lost") g.whiteout();
    else g.processEvoQueue();
    g.save();
  }
}

// ------------------------------------------------------------------- Game
interface ThrownBall {
  mesh: THREE.Group;
  p: THREE.Vector3;
  v: THREE.Vector3;
  type: string;           // ball item key
  t: number;
  bounced: boolean;
  resting: number;
  aimed: boolean;         // thrown from aim mode (steadier arm, small catch bonus)
  assist?: WildMon | null; // quick-tap lobs steer toward their target
  dead?: boolean;
}
interface FishingState {
  phase: "wait" | "bite";
  t: number;
  spot: THREE.Vector3;
  bobber: THREE.Group;
  castFrom: THREE.Vector3;
}

export class Game {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  world: World;
  fx: FX;
  audio: AudioMan;
  ui: any;
  playerPos: THREE.Vector3;
  playerYaw: number;
  wilds: WildMon[];
  trainers: TrainerNPC[];
  battle: Battle | null;
  target: any;
  spawnT: number;
  targetT: number;
  saveT: number;
  throwLock: number;
  evoQueue: any[];
  learnQueue: any[];
  processingQueues: boolean;
  cutscene: boolean;
  spotCheckT: number;
  ballIdx: number;
  legendAlive: Record<string, any>;
  state: any;
  dexSeen: Set<number>;
  dexCaught: Set<number>;
  resetting?: boolean;
  // ---- v3 systems
  follower: FollowerEnt | null = null;
  timeScale = 1;                       // bullet time while aiming
  aim: { charge: number; t: number } | null = null;
  thrown: ThrownBall[] = [];
  petCd = 0;
  fishing: FishingState | null = null;
  rocketT = 200;                        // seconds until Team Rocket tries an ambush
  flashlightOn = false;
  possessTipShown = false;             // one "press T" nudge per session
  skillTipShown = false;               // one "plant your shots / use cover" nudge per session
  // ---- v9 story systems
  civs: CivilianNPC[] = [];            // phone-zombie townsfolk
  introCam: { x: number; z: number; r: number; h: number; look: number } | null = null;
  showcase: { rig: MonRig; t: number } | null = null;   // Oak's intro Pokémon
  skipIntro = false;                   // DEBUG.newGame fast path for tests

  constructor({ scene, camera, world, fx, audio, ui }) {
    this.scene = scene; this.camera = camera; this.world = world;
    this.fx = fx; this.audio = audio; this.ui = ui;
    this.playerPos = V3(0, 0, 16);
    this.playerYaw = 0;
    this.wilds = [];
    this.trainers = TRAINERS.map((t) => new TrainerNPC(this, t));
    this.civs = CIV_SPOTS.map((spot, i) => new CivilianNPC(this, spot, i));
    this.battle = null;
    this.target = null;
    this.spawnT = 1;
    this.targetT = 0;
    this.saveT = 10;
    this.throwLock = 0;
    this.evoQueue = [];
    this.learnQueue = [];
    this.processingQueues = false;
    this.cutscene = false;
    this.spotCheckT = 2;
    this.ballIdx = 0;
    this.legendAlive = {};

    this.state = this.load() || {
      v: SAVE_VERSION, started: false, party: [], boxes: [], money: 600,
      items: { pokeball: 5, greatball: 0, ultraball: 0, potion: 0, superpotion: 0, revive: 0, oranberry: 2, repel: 0, escaperope: 1, lure: 0, nugget: 0 },
      seen: [], caught: [], tl: 1, txp: 0, beaten: {}, badges: [],
      settings: { vol: 70, sens: 100, ai: "adaptive", style: "fp", followers: true, expShare: true, keybinds: normalizeKeybinds() }, time: 0.18, spotsFound: [],
      cheats: { god: false, ohko: false, catchall: false, infpp: false, speed: false },
      lastCenter: null, starter: null, hof: [], repelT: 0, lureT: 0,
      followerUid: null, voucher: false, bike: false, truckKeys: false, vehicle: null,
      name: "", rival: "", playT: 0, story: {},
    };
    this.applyRivalName();
    this.dexSeen = new Set(this.state.seen);
    this.dexCaught = new Set(this.state.caught);
    world.timeOfDay = this.state.time ?? 0.18;
    if (this.state.pos) this.playerPos.set(this.state.pos[0], this.state.pos[1], this.state.pos[2]);
    else this.playerPos.copy(world.townSpawn);
    if (this.state.yaw != null) this.playerYaw = this.state.yaw;
    if (this.state.badges.length >= 8) world.openCaveGate();
    // weather audio/FX wiring
    world.onThunder = (at) => {
      this.audio.play("thunder");
      this.fx.flashLight(at, "#cfe0ff", 7, 0.5, 80);
    };
    this.syncFollower();
    (window as any).DEBUG = this.makeDebug();
  }

  // ------------------------------------------------------------- save/load
  save() {
    if (!this.state.started || this.resetting) return;
    this.state.seen = [...this.dexSeen];
    this.state.caught = [...this.dexCaught];
    this.state.time = this.world.timeOfDay;
    this.state.pos = [this.playerPos.x, this.playerPos.y, this.playerPos.z];
    this.state.yaw = this.playerYaw;
    try { localStorage.setItem(slotStorageKey(currentSlot()), JSON.stringify(this.state)); } catch (e) { /* storage full */ }
  }
  load() {
    try {
      const raw = localStorage.getItem(slotStorageKey(currentSlot()));
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s || !Array.isArray(s.party)) return null;
      return this.migrate(s);
    } catch (e) { return null; }
  }
  // upgrade old saves to the Gen-1-stats + Kanto-map version
  migrate(s) {
    const old = (s.v || 1) < SAVE_VERSION;
    for (const m of [...s.party, ...(s.boxes || [])]) {
      if (!m.ivs) m.ivs = rollDVs();
      if (m.ivs.hp === undefined) m.ivs.hp = ((m.ivs.atk & 1) << 3) | ((m.ivs.def & 1) << 2) | ((m.ivs.spe & 1) << 1) | (m.ivs.spc & 1);
      if (!m.sexp) m.sexp = ZERO_SEXP();
      if (!Array.isArray(m.pp) || m.pp.length !== m.moves.length) m.pp = m.moves.map((id) => MOVES[id].pp);
      if (old) {
        m.xp = xpForLevel(m.sp, m.lv);
        Object.assign(m, calcStats(m.sp, m.lv, m.ivs, m.sexp));
        m.hp = Math.min(m.hp, m.maxhp);
      }
    }
    if (old) {
      if ((s.v || 1) < 2) {
        s.pos = null;                     // the world map changed entirely in v2
        s.beaten = {};
        s.spotsFound = [];
        s.lastCenter = null;
        s.badges = (s.badges || []).includes("terra") ? ["boulder"] : [];
      }
      if ((s.v || 1) < 4) {
        // v4 rebuilt Kanto to match the real RBY town map — old positions are
        // likely inside a mountain or the sea now.
        s.pos = null;
        s.lastCenter = null;
        s.spotsFound = [];
      }
      if ((s.v || 1) < 5) {
        // v5 doubled the map: every stored position scales with it
        if (Array.isArray(s.pos)) { s.pos = [s.pos[0] * MAP_SCALE, s.pos[1], s.pos[2] * MAP_SCALE]; }
        if (Array.isArray(s.lastCenter)) { s.lastCenter = [s.lastCenter[0] * MAP_SCALE, s.lastCenter[1] * MAP_SCALE]; }
      }
      s.v = SAVE_VERSION;
    }
    // v3 additions
    for (const m of [...s.party, ...(s.boxes || [])]) if (m.hap === undefined) m.hap = 70;
    s.items = Object.assign({ oranberry: 0, repel: 0, escaperope: 0, lure: 0, nugget: 0 }, s.items);
    // razz berries retired with the catching rework — swap any held for orans
    if (s.items.razzberry) s.items.oranberry += s.items.razzberry;
    delete s.items.razzberry;
    if (s.starter === undefined) s.starter = null;
    if (!Array.isArray(s.hof)) s.hof = [];
    if (s.repelT === undefined) s.repelT = 0;
    if (s.lureT === undefined) s.lureT = 0;
    s.cheats = Object.assign({ god: false, ohko: false, catchall: false, infpp: false, speed: false }, s.cheats);
    // v5 additions: AI setting, chosen walking partner, vehicles
    // v8: battle style (classic turns / arena real-time / first-person)
    s.settings = Object.assign({ vol: 70, sens: 100, ai: "adaptive", style: "arena", followers: true, expShare: true }, s.settings);
    s.settings.keybinds = normalizeKeybinds(s.settings.keybinds);
    for (const m of [...s.party, ...(s.boxes || [])]) if (!m.uid) m.uid = Math.random().toString(36).slice(2, 10);
    if (s.followerUid === undefined) s.followerUid = null;
    if (s.voucher === undefined) s.voucher = false;
    if (s.bike === undefined) s.bike = false;
    if (s.truckKeys === undefined) s.truckKeys = false;
    if (s.vehicle === undefined || (s.vehicle === "bike" && !s.bike) || (s.vehicle === "truck" && !s.truckKeys)) s.vehicle = null;
    // v9 story additions: trainer/rival names, playtime, story beats
    if (typeof s.name !== "string") s.name = "";
    if (typeof s.rival !== "string") s.rival = "";
    if (typeof s.playT !== "number") s.playT = 0;
    if (!s.story || typeof s.story !== "object") s.story = {};
    // pre-v9 saves predate the lab battle — don't ambush them retroactively
    if (s.started && s.story.rival1 === undefined) s.story.rival1 = true;
    if (s.started && s.badges.length >= 2 && s.story.rival2 === undefined) s.story.rival2 = true;
    if (s.started && s.badges.length >= 5 && s.story.rival3 === undefined) s.story.rival3 = true;
    return s;
  }
  resetSave() { this.resetting = true; localStorage.removeItem(slotStorageKey(currentSlot())); location.reload(); }

  // ----------------------------------------------------------- party utils
  activeMon() { return this.state.party.find((m) => m.hp > 0) || null; }
  setLead(idx) {
    const p = this.state.party;
    if (idx <= 0 || idx >= p.length) return;
    const [m] = p.splice(idx, 1);
    p.unshift(m);
  }
  giveMon(mon) {
    if (this.state.party.length < 6) { this.state.party.push(mon); return "party"; }
    this.state.boxes.push(mon); return "box";
  }
  // ----------------------------------------------------- move management
  // Every move this species can know at its current level that it hasn't
  // learned yet — lets the player teach/relearn moves from the party screen.
  learnableMoves(mon): number[] {
    const known = new Set(mon.moves);
    const ids = (DEX[mon.sp].learnset || [])
      .filter(([l]) => l <= mon.lv)
      .map(([, id]) => id)
      .filter((id) => !known.has(id) && MOVES[id]);
    return [...new Set(ids)];
  }
  // Teach a move, replacing the slot if given (and the party is already full).
  teachMove(mon, moveId, slot: number | null = null) {
    if (!MOVES[moveId] || mon.moves.includes(moveId)) return false;
    mon.pp = mon.pp || mon.moves.map((id) => MOVES[id].pp);
    if (mon.moves.length < 4 && slot == null) {
      mon.moves.push(moveId);
      mon.pp.push(MOVES[moveId].pp);
    } else {
      const s = slot != null ? slot : mon.moves.length - 1;
      mon.moves[s] = moveId;
      mon.pp[s] = MOVES[moveId].pp;
    }
    this.audio.play("learn");
    this.ui.toast(`${monName(mon)} learned ${MOVES[moveId].name}!`, "good");
    this.ui.updateParty();
    this.save();
    return true;
  }
  forgetMove(mon, idx: number) {
    if (mon.moves.length <= 1) { this.ui.toast("A Pokémon can't forget its last move!", "bad"); return false; }
    const name = MOVES[mon.moves[idx]]?.name || "move";
    mon.moves.splice(idx, 1);
    if (mon.pp) mon.pp.splice(idx, 1);
    this.audio.play("ui");
    this.ui.toast(`${monName(mon)} forgot ${name}.`, "");
    this.ui.updateParty();
    this.save();
    return true;
  }
  markSeen(sp) {
    if (!this.dexSeen.has(sp)) { this.dexSeen.add(sp); }
  }
  markCaught(sp) {
    this.markSeen(sp);
    if (!this.dexCaught.has(sp)) {
      this.dexCaught.add(sp);
      this.addTrainerXp(15);
    }
  }
  addTrainerXp(n) {
    const s = this.state;
    s.txp += n;
    let need = 70 + (s.tl - 1) * 45;
    while (s.txp >= need) {
      s.txp -= need; s.tl++;
      need = 70 + (s.tl - 1) * 45;
      this.audio.play("levelup");
      this.ui.toast(`Trainer Level ${s.tl}!`, "good");
      if (s.tl === ITEMS.greatball.unlock) this.ui.toast("Great Balls now in stock at the PokéMart!", "good");
      if (s.tl === ITEMS.ultraball.unlock) this.ui.toast("Ultra Balls now in stock at the PokéMart!", "good");
    }
    this.ui.updateHUD();
  }
  ballType() {
    const owned = BALL_ORDER.filter((b) => this.state.items[b] > 0);
    if (!owned.length) return null;
    this.ballIdx = clamp(this.ballIdx, 0, owned.length - 1);
    return owned[this.ballIdx];
  }
  cycleBall(dir) {
    const owned = BALL_ORDER.filter((b) => this.state.items[b] > 0);
    if (owned.length < 2) return;
    this.ballIdx = (this.ballIdx + dir + owned.length) % owned.length;
    this.audio.play("ui");
    this.ui.updateHUD();
  }

  // ------------------------------------------------------------- starters
  chooseStarter(sp) {
    const mon = makeMon(sp, 5);
    mon.hap = 100; // starters trust you from day one
    this.state.party = [mon];
    this.state.started = true;
    this.state.starter = sp;
    this.markCaught(sp);
    this.ui.toast(`You chose ${DEX[sp].name}! Your adventure begins!`, "good");
    this.audio.play("catch");
    this.audio.cry(sp, DEX[sp].height);
    this.syncFollower();
    this.save();
    this.ui.updateParty(); this.ui.updateHUD();
    if (this.skipIntro) this.state.story.rival1 = true;   // tests skip the lab scene
    else this.postStarter();
  }

  // --------------------------------------------------- story: the intro (v9)
  // Faithful RBY opening — Oak's monologue, your name, his grandson's name —
  // with the modern world Kanto actually lives in now leaking through.
  async newGameFlow() {
    const ui = this.ui;
    this.cutscene = true;
    // a Pokémon materializes for the monologue, RBY style (Nidorino, of course)
    // — on the open spawn plaza, where the orbiting camera has clear sightlines
    const c = { x: this.world.townSpawn.x, z: this.world.townSpawn.z };
    this.introCam = { x: c.x, z: c.z, r: 4.2, h: 1.6, look: 0.8 };
    const rig = buildMonRig(33, monSize(33));
    rig.group.position.set(c.x, this.world.height(c.x, c.z), c.z);
    this.scene.add(rig.group);
    this.showcase = { rig, t: 0 };
    await ui.dialog("Prof. Oak", [
      "Hello there! Welcome to the world of POKÉMON!",
      "My name is OAK! People call me the POKÉMON PROF!",
      "This world is inhabited far and wide by creatures called POKÉMON!",
    ]);
    this.audio.cry(33, DEX[33].height);
    this.fx.ringAt(rig.group.position.clone().add(V3(0, 0.2, 0)), { col: "#9fe8ff", r0: 0.4, r1: 2.2, dur: 0.5 });
    await ui.dialog("Prof. Oak", [
      "For some people, POKÉMON are pets. Others use them for fights. Myself... I study POKÉMON as a profession — face to face, as friends and partners!",
      "Plenty of folks these days only ever meet them through a screen. A shame! Kanto is best seen in person.",
      "But first, tell me a little about yourself. What is your name?",
    ]);
    const name = await ui.askName("What is your name?", ["RED", "ASH", "LEAF", "SATOSHI"]);
    this.state.name = name;
    await ui.dialog("Prof. Oak", [
      `Right! So your name is ${name}!`,
      "This is my grandson. He's been your rival since you were both babies.",
      "...Erm, what was his name again? My memory isn't what it used to be...",
    ]);
    const rival = await ui.askName("What was his name again?", ["BLUE", "GARY", "SHIGERU"]);
    this.state.rival = rival;
    this.applyRivalName();
    await ui.dialog("Prof. Oak", [
      `That's right! I remember now! His name is ${rival}!`,
      `${name}! Your very own POKÉMON legend is about to unfold!`,
      "A world of dreams and adventures with POKÉMON awaits! Let's go!",
    ]);
    this.clearShowcase();
    this.introCam = null;
    this.cutscene = false;
    ui.showStarter();
  }
  clearShowcase() {
    if (!this.showcase) return;
    this.showcase.rig.dispose();
    this.scene.remove(this.showcase.rig.group);
    this.showcase = null;
  }
  // Oak hands over the Pokédex; the rival grabs his counter-pick and jumps you
  // right there — the faithful first battle.
  async postStarter() {
    this.cutscene = true;
    const sp = this.state.starter;
    await this.ui.dialog("Prof. Oak", [
      `${DEX[sp].name}, eh? A fine choice, {player}!`,
      "Take this too — your very own POKÉDEX! It records data on every Pokémon you meet. A complete guide to all 151!",
      "To make it complete, you must meet each Pokémon face to face. That part, no gadget can do for you!",
    ]);
    this.cutscene = false;
    // the rival bursts in for the lab battle
    const npc = this.spawnRival(0);
    await this.ui.dialog(`Rival ${this.state.rival || "Blue"}`, [
      "Hold on, {player}! Gramps gave ME a POKÉMON too — the one that beats yours, obviously.",
      "Let's check out our new partners... right here, right now!",
    ]);
    if (!this.battle && !this.ui.modalOpen) this.startTrainerBattle(npc);
    else npc.engaging = false;
    this.state.story.rival1 = true;
    this.save();
  }

  // ------------------------------------------------- story: the rival (v9)
  // He shows up at milestones with the counter-starter line, like the old
  // days. He DOES have a channel — he just brings it up less than he used to.
  rivalBaseId() { return (COUNTER_STARTER[this.state.starter] || 9) - 2; }
  rivalDefFor(stage: number) {
    const base = this.rivalBaseId();
    const r = this.state.rival || "Blue";
    const look = { shirt: "#5e35b1", pants: "#3e2723", hair: "#8d6e63" };
    if (stage === 0) return {
      id: "rival0", rival: true, name: `Rival ${r}`, look, party: [base], lvs: [5], pay: 30, payMul: 1.2,
      dlg: [
        "Come on! I'll take it easy on you... maybe!",
        "WHAT? Are you serious? I picked the strong one! ...Don't get used to it, {player}.",
        "I've studied every frame of that loss. Rematch!",
      ],
    };
    if (stage === 1) return {
      id: "rival2", rival: true, name: `Rival ${r}`, look, party: [17, 63, base + 1], lvs: [17, 16, 18], pay: 40, payMul: 1.5,
      dlg: [
        "Yo {player}! Two badges already? Hah — I've got two AND a fan club. Watch and learn!",
        "Tch... how are you still ahead of me?!",
        "I've been itching for a rematch, {player}!",
      ],
    };
    return {
      id: "rival5", rival: true, name: `Rival ${r}`, look, party: [18, 64, 58, base + 2], lvs: [33, 34, 35, 37], pay: 60, payMul: 1.8,
      dlg: [
        "{player}. Five badges each. Everyone keeps asking if you're better than me. Time to settle it!",
        "...You're the real deal, {player}. Fine. FINE. Back to training.",
        "No distractions anymore. Just Pokémon. Show me what the grind looks like, {player}!",
      ],
    };
  }
  spawnRival(stage: number) {
    const def = this.rivalDefFor(stage) as any;
    const dir = this.lookDir();
    def.pos = [this.playerPos.x + dir.x * 7, this.playerPos.z + dir.z * 7];
    const npc = new TrainerNPC(this, def);
    npc.engaging = true;            // scripted intro — no auto-aggro
    npc.despawnT = 180;
    this.trainers.push(npc);
    this.audio.play("alert");
    this.fx.burst(npc.pos.clone().add(V3(0, 1.4, 0)), { count: 18, col: "#fff", col2: "#5e35b1", speed: 3, size: 0.26, life: 0.5 });
    return npc;
  }
  // milestone ambush — fires once per story beat when the coast is clear
  rivalAmbush() {
    const s = this.state.story;
    const stage = s.rivalDue;
    if (stage == null || this.battle || this.cutscene || this.ui.blocking || !this.activeMon()) return;
    if (this.world.insideBuilding(this.playerPos)) return;
    s.rivalDue = null;
    s[stage === 1 ? "rival2" : "rival3"] = true;
    const npc = this.spawnRival(stage);
    (async () => {
      await this.ui.dialog(npc.def.name, [npc.def.dlg[0]]);
      if (!this.battle && !this.ui.modalOpen) this.startTrainerBattle(npc);
      else npc.engaging = false;
    })();
  }
  // champion + dialog tokens pick up the chosen rival name
  applyRivalName() {
    const r = this.state?.rival;
    if (!r) return;
    const blue = TRAINERS.find((t) => t.champion);
    blue.name = `Champion ${r}`;
    const npc = this.trainers?.find((t) => t.def.champion);
    if (npc) npc.setLabel(blue.name);
  }
  enterWorld() {
    this.ui.hideTitle();
    this.ui.toast(`Welcome back, ${this.state.name || "trainer"}! Your adventure continues.`, "good");
    this.ui.updateHUD(); this.ui.updateParty();
  }

  // ------------------------------------------------------- follower (v3)
  // Keep the follower entity in sync with your chosen walking partner.
  // Default: the lead Pokémon. Pick any party member (or recall it) from the
  // party screen.
  followerMon() {
    // global opt-out: keep your Pokémon in their Balls on the overworld
    if (this.state.settings?.followers === false) return null;
    const uid = this.state.followerUid;
    if (uid === "none") return null;
    const chosen = uid ? this.state.party.find((m) => m.uid === uid && m.hp > 0) : null;
    return chosen || this.activeMon();
  }
  setFollowerMon(mon: any | null) {
    this.state.followerUid = mon ? mon.uid : "none";
    this.syncFollower();
    if (mon) {
      this.audio.cry(mon.sp, DEX[mon.sp].height);
      this.ui.toast(`${monName(mon)} is walking with you!`, "good");
    } else {
      this.ui.toast("Your partner returned to its Ball.", "");
    }
    this.save();
  }
  syncFollower() {
    const lead = this.followerMon();
    if (this.battle) { if (this.follower) this.follower.group.visible = false; return; }
    if (!lead) {
      if (this.follower) { this.follower.dispose(); this.follower = null; }
      return;
    }
    if (this.follower && this.follower.mon === lead && this.follower.mon.sp === this.follower.spLast) {
      this.follower.group.visible = true;
      return;
    }
    if (this.follower) { this.follower.dispose(); this.follower = null; }
    const yaw = this.playerYaw;
    const pos = this.idealFollowerSpawn(yaw);
    this.follower = new FollowerEnt(this, lead, pos);
    this.follower.spLast = lead.sp;
    this.fx.burst(this.follower.pos(), { count: 12, col: "#fff", col2: "#9fc6ff", speed: 2.4, size: 0.26, life: 0.4 });
  }
  // materialize where the player can SEE it: ahead-left of the camera
  idealFollowerSpawn(yaw: number) {
    const fwd = V3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const left = V3(fwd.z, 0, -fwd.x);
    const pos = this.playerPos.clone().addScaledVector(fwd, 2.1).addScaledVector(left, 1.5);
    pos.y = this.world.height(pos.x, pos.z);
    return pos;
  }
  petFollower() {
    const f = this.follower;
    if (!f || f.dead || this.petCd > 0) return;
    this.petCd = 30;
    const m = f.mon;
    m.hap = clamp((m.hap || 70) + 2, 0, 255);
    this.audio.play("pet");
    this.audio.cry(m.sp, DEX[m.sp].height);
    this.fx.hearts(f.pos());
    f.pulse(0.7);
    const lines = [
      `${monName(m)} nuzzles your hand happily!`,
      `${monName(m)} looks delighted!`,
      `${monName(m)} cries out with joy!`,
      m.hap >= 200 ? `${monName(m)} adores you! (+10% XP)` : `${monName(m)} is warming up to you.`,
    ];
    this.ui.toast(choice(lines), "good");
    this.ui.updateParty();
  }

  // ------------------------------------------------------- vehicles (v5)
  // V cycles what you own: on foot → Bicycle → the old truck → on foot.
  // The Bicycle comes from the classic chain: Fan Club chairman's Bike
  // Voucher → Cerulean Bike Shop. The truck wakes up for Champions only.
  ownedVehicles(): string[] {
    const v: string[] = [];
    if (this.state.bike) v.push("bike");
    if (this.state.truckKeys) v.push("truck");
    return v;
  }
  toggleVehicle() {
    if (!this.state.started || this.ui.blocking || this.battle || this.fishing || this.aim || this.cutscene) return;
    const owned = this.ownedVehicles();
    if (!owned.length) { this.ui.toast("You don't have a ride yet. The Pokémon Fan Club in Vermilion loves visitors...", ""); this.audio.play("deny"); return; }
    const order = [null, ...owned];
    const cur = order.indexOf(this.state.vehicle);
    const next = order[(cur + 1) % order.length];
    const ground = this.world.height(this.playerPos.x, this.playerPos.z);
    if (next && ground < this.world.waterY - 0.55) { this.ui.toast("Not in the water!", "bad"); this.audio.play("deny"); return; }
    this.state.vehicle = next;
    if (next === "bike") { this.audio.play("bikebell"); this.ui.toast("You hopped on the Bicycle! (V to dismount)", "good"); }
    else if (next === "truck") { this.audio.play("engine"); this.ui.toast("The old truck rumbles to life! (V to park)", "good"); }
    else { this.audio.play("ui"); this.ui.toast(`You ${this.ownedVehicles().includes("truck") && cur === order.length - 1 ? "parked the truck" : "hopped off"}.`, ""); }
    this.ui.updateHUD();
  }
  dismountVehicle(quiet = true) {
    if (!this.state.vehicle) return;
    this.state.vehicle = null;
    if (!quiet) this.ui.toast("You hopped off.", "");
    this.ui.updateHUD();
  }

  // ----------------------------------------------- zone-based wild spawns
  // Every zone uses its authentic Red/Blue encounter table (see SPAWNS).
  wildDensityTarget(zone = this.world.zoneAt(this.playerPos.x, this.playerPos.z)) {
    let target = 12;
    if (["viridian-forest", "safari", "mtmoon-cave", "rock-tunnel", "cerulean-cave", "seafoam", "victory-road", "power-plant", "diglett"].includes(zone)) target = 17;
    else if (this.world.biomeAt(this.playerPos.x, this.playerPos.z) === "town" || this.world.distToPath(this.playerPos.x, this.playerPos.z) < 4) target = 8;
    if (this.state.lureT > 0) target += 6;
    if (this.state.repelT > 0) target = Math.min(target, 3);
    return target;
  }
  localWildCount(r = 70) {
    let n = 0;
    for (const w of this.wilds) {
      if (w.dead || w.captureLock || w.legend) continue;
      if (Math.hypot(w.base.x - this.playerPos.x, w.base.z - this.playerPos.z) <= r) n++;
    }
    return n;
  }
  spawnTick() {
    if (!this.state.started || this.state.repelT > 0) return;
    const zoneHere = this.world.zoneAt(this.playerPos.x, this.playerPos.z);
    const target = this.wildDensityTarget(zoneHere);
    if (this.localWildCount() >= target) return;
    if (this.wilds.filter((w) => !w.dead && !w.captureLock && !w.legend).length >= target + 4) return;
    const a = rnd(Math.PI * 2), d = rnd(90, 44);
    const x = this.playerPos.x + Math.cos(a) * d, z = this.playerPos.z + Math.sin(a) * d;
    if (Math.abs(x) > WORLD_R - 16 || Math.abs(z) > WORLD_R - 16) return;
    const zone = this.world.zoneAt(x, z);
    const zdef = SPAWNS[zone];
    if (!zdef) return;
    const h = this.world.height(x, z);
    const inWater = h < this.world.waterY - 0.25;
    const pool = inWater ? zdef.water : zdef.pool;
    if (!pool || !pool.length) return;
    const night = this.world.isNight();
    const entries = pool.filter((e) => !(e[4] === "N" && !night) && !(e[4] === "D" && night));
    if (!entries.length) return;
    let total = 0;
    const wOf = (e) => e[1] * (e[4] === "n" && night ? 2.2 : 1);
    for (const e of entries) total += wOf(e);
    let r = Math.random() * total, pick = entries[0];
    for (const e of entries) { r -= wOf(e); if (r <= 0) { pick = e; break; } }
    if (!inWater && this.world.insideBuilding(V3(x, h + 1, z))) return;
    const lv = irnd(pick[2], pick[3]);
    const pos = V3(x, inWater ? this.world.waterY - 0.15 : h, z);
    const wm = new WildMon(this, makeMon(pick[0], lv), pos, { water: inWater });
    this.wilds.push(wm);
  }
  legendTick() {
    if (!this.state.started) return;
    for (const [spot, sp] of Object.entries(LEGEND_SPOTS)) {
      if (this.dexCaught.has(sp) || this.legendAlive[sp]) continue;
      // the birds wake once you hold three badges; Mewtwo and Mew need all eight
      const badgesNeed = sp === 150 || sp === 151 ? 8 : 3;
      if (this.state.badges.length < badgesNeed) continue;
      if (sp === 151 && !this.world.isNight()) continue;
      const p = this.world.spots[spot];
      const d = Math.hypot(this.playerPos.x - p.x, this.playerPos.z - p.z);
      if (d > 65 * MAP_SCALE || d < 12) continue;
      if (Math.random() < (sp === 151 ? 0.05 : 0.12)) {
        const wm = new WildMon(this, makeMon(sp, LEGEND_LV[sp]), p.clone());
        this.wilds.push(wm);
        this.legendAlive[sp] = wm;
        this.ui.toast("A powerful presence stirs nearby...", "bad");
      }
    }
    for (const k of Object.keys(this.legendAlive)) if (this.legendAlive[k].dead) delete this.legendAlive[k];
  }
  zonesFor(sp) {
    const zones = SPECIES_ZONES[sp];
    if (!zones) return null;
    return [...zones].map((z) => this.world.zoneName(z));
  }

  // ------------------------------------------------------------ targeting
  updateTarget() {
    // aim mode latches the lock — the slow-mo target shouldn't flicker off
    // because the mon hopped or the sprite turned edge-on
    if (this.aim && this.target instanceof WildMon && !this.target.dead && !this.target.captureLock) return;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    ray.far = 24;
    let best = null, bestD = 1e9;
    for (const w of this.wilds) {
      if (w.dead || w.captureLock) continue;
      const hit = ray.intersectObject(w.hitMesh, false);
      if (hit.length && hit[0].distance < bestD) { bestD = hit[0].distance; best = w; }
    }
    // also accept a small crosshair cone so the lock stays dependable when
    // the model is partly occluded or mid-hop
    if (!best) {
      const fwd = this.camera.getWorldDirection(V3());
      let bestCos = 0.992; // ~7 degrees
      for (const w of this.wilds) {
        if (w.dead || w.captureLock) continue;
        const to = w.pos().sub(this.camera.position);
        const d = to.length();
        if (d > 24 || d < 0.6) continue;
        const cos = to.normalize().dot(fwd);
        if (cos > bestCos) { bestCos = cos; best = w; }
      }
    }
    // battle: always allow targeting the engaged enemy
    if (!best && this.battle && this.battle.type === "wild" && !this.battle.enemyEnt.dead) {
      const d = this.camera.position.distanceTo(this.battle.enemyEnt.pos());
      if (d < 26) best = this.battle.enemyEnt;
    }
    this.target = best;
    if (best) this.markSeen(best.mon.sp);
  }

  // ----------------------------------------------------- catching: throws
  // Quick tap = assisted lob at your target. Hold = aim mode: time dilates
  // and a trajectory arc appears; release to throw. Aimed throws land a
  // steadier hit and a small catch bonus. That's it — no timing minigames.
  battleStyle(): "classic" | "arena" | "fp" {
    const s = this.state.settings?.style;
    return s === "classic" || s === "fp" ? s : "arena";
  }
  canThrowNow(verbose = true) {
    if (this.ui.modalOpen || this.cutscene) return false;
    if (this.battle?.possessed) {
      if (verbose) this.ui.toast("You're the Pokémon right now! Hold to aim — you'll snap back to your own hands.", "");
      return false;
    }
    if (this.battle && this.battle.type === "trainer") {
      if (verbose) this.ui.toast("The Trainer blocked the Ball! Don't be a thief!", "bad");
      return false;
    }
    if (this.battle?.style === "classic" && this.battle.turnPhase !== "player") return false;
    if (this.throwLock > 0) return false;
    if (!this.ballType()) {
      if (verbose) { this.ui.toast("Out of Poké Balls! Buy more at the PokéMart.", "bad"); this.audio.play("deny"); }
      return false;
    }
    return true;
  }
  // can a held click become an aim, once the auto-eject fires?
  canAimWhilePossessed() {
    return !!(this.battle?.possessed && this.battle.type === "wild" && this.ballType());
  }
  startAim() {
    if (this.aim) return false;
    // possessed in a wild fight: holding to aim hands you back to the trainer
    // mid-motion — eject, then the throw flows like normal
    if (this.canAimWhilePossessed()) this.battle.autoEject();
    if (!this.canThrowNow()) return false;
    this.aim = { charge: 0.35, t: 0 };
    this.audio.play("slowmo");
    return true;
  }
  cancelAim() {
    if (!this.aim) return;
    this.aim = null;
    this.fx.updateAimArc(null);
    this.audio.play("slowmoEnd");
  }
  // simulate the launch the same way updateThrow integrates it
  launchVelocity() {
    const dir = this.camera.getWorldDirection(V3());
    const speed = 9 + (this.aim ? this.aim.charge : 0.5) * 17;
    return dir.multiplyScalar(speed).add(V3(0, 2.2, 0));
  }
  throwOrigin() {
    return this.camera.position.clone()
      .add(this.camera.getWorldDirection(V3()).multiplyScalar(0.55))
      .add(V3(0, -0.22, 0));
  }
  predictArc(): THREE.Vector3[] {
    const pts: THREE.Vector3[] = [];
    const p = this.throwOrigin(), v = this.launchVelocity();
    for (let i = 0; i < 56; i++) {
      pts.push(p.clone());
      v.y -= 20 * (1 / 30);
      p.addScaledVector(v, 1 / 30);
      if (p.y < this.world.height(p.x, p.z) + 0.1) { pts.push(p.clone()); break; }
    }
    return pts;
  }
  releaseAim() {
    if (!this.aim) return;
    const v = this.launchVelocity();
    // a soft magnet toward your locked target — aiming is the skill, the last
    // half-meter is the trainer's arm
    const assist = this.target instanceof WildMon ? this.target : null;
    this.launchBall(v, true, assist);
    this.cancelAim();
  }
  quickThrowAt(wild) {
    if (!wild || wild.dead || wild.captureLock || wild.ballCooldown > 0) return;
    if (this.battle && this.battle.enemyEnt !== wild) return;
    if (!this.canThrowNow()) return;
    // assisted ballistic lob straight to the target
    const from = this.throwOrigin();
    const to = wild.pos();
    const T = clamp(from.distanceTo(to) / 15, 0.32, 0.95);
    const v = to.clone().sub(from).divideScalar(T);
    v.y = (to.y - from.y) / T + 0.5 * 20 * T;
    this.launchBall(v, false, wild);
  }
  onClick() {
    if (this.ui.modalOpen) return;
    // possessed: a click swings your last-used move, action-game style
    if (this.battle?.possessed) { this.battle.useMove("ally", this.battle.lastMoveIdx); return; }
    this.quickThrowAt(this.target);
  }
  // kept for the debug console / tests
  throwBallAt(wild) { this.quickThrowAt(wild); }
  launchBall(v: THREE.Vector3, aimed: boolean, assist: WildMon | null = null) {
    const ballKey = this.ballType();
    if (!ballKey) return;
    this.battle?.onBallThrown();    // classic: the throw IS your turn
    this.throwLock = 0.55;
    this.state.items[ballKey]--;
    this.ui.updateHUD();
    this.audio.play("throw");
    const mesh = this.fx.makeBall(ballKey);
    mesh.position.copy(this.throwOrigin());
    this.scene.add(mesh);
    this.thrown.push({ mesh, p: mesh.position.clone(), v: v.clone(), type: ballKey, t: 0, bounced: false, resting: 0, aimed, assist });
  }
  updateThrow(dt: number, rawDt: number) {
    // aim mode: arc preview + charge
    if (this.aim) {
      this.aim.t += rawDt;
      this.aim.charge = clamp(this.aim.charge + rawDt * 0.55, 0.35, 1);
      this.fx.updateAimArc(this.predictArc(), `hsl(${48 + this.aim.charge * 30},100%,${55 + this.aim.charge * 12}%)`);
      if (!this.ui.modalOpen) this.ui.updateAimHUD?.(this.aim.charge);
    }
    // physical balls in flight (substepped so fast balls can't tunnel through
    // a small Caterpie between frames)
    for (let i = this.thrown.length - 1; i >= 0; i--) {
      const b = this.thrown[i];
      b.t += dt;
      let hit: WildMon | null = null;
      let sank = false;
      const steps = b.resting > 0 ? 1 : clamp(Math.ceil((b.v.length() * dt) / 0.2), 1, 10);
      const sdt = dt / steps;
      for (let s = 0; s < steps && !hit && !sank; s++) {
        if (b.resting <= 0) {
          b.v.y -= 20 * sdt;
          // assisted lobs home in gently — the trainer's good arm, not an aimbot
          if (b.assist && !b.assist.dead && !b.assist.captureLock) {
            const to = b.assist.pos().sub(b.p);
            const d = to.length();
            if (d < 7 && d > 0.01) {
              const pull = b.aimed ? 11 : 13;
              b.v.addScaledVector(to.clone().normalize(), sdt * pull);
              // steer the horizontal velocity toward the mon so drift can't
              // push a well-aimed ball wide in the final meters
              const hs = Math.hypot(b.v.x, b.v.z), hd = Math.hypot(to.x, to.z);
              if (hs > 1 && hd > 0.05) {
                const cur = Math.atan2(b.v.z, b.v.x), want = Math.atan2(to.z, to.x);
                let dA = want - cur;
                while (dA > Math.PI) dA -= Math.PI * 2;
                while (dA < -Math.PI) dA += Math.PI * 2;
                const turn = clamp(dA, -(b.aimed ? 1.5 : 1.0) * sdt, (b.aimed ? 1.5 : 1.0) * sdt);
                b.v.x = Math.cos(cur + turn) * hs;
                b.v.z = Math.sin(cur + turn) * hs;
              }
            }
          }
          b.p.addScaledVector(b.v, sdt);
        }
        // hit a wild Pokémon?
        for (const w of this.wilds) {
          if (w.dead || w.captureLock || w.ballCooldown > 0) continue;
          if (w.phasedT > 0) continue;   // burrowed/blinked mid-dodge: nothing to hit
          if (this.battle && this.battle.type === "wild" && this.battle.enemyEnt !== w) continue;
          const r = w.halfH * 0.95 + (b.assist === w ? (b.aimed ? 0.45 : 0.6) : 0.26);
          if (b.p.distanceTo(w.pos()) < r) { hit = w; break; }
        }
        if (hit) break;
        // water check inside the substep too — balls lobbed at a swimmer get to
        // skim the surface for the last stretch instead of instantly sinking
        const hh = this.world.height(b.p.x, b.p.z);
        const skim = b.assist && !b.assist.dead && b.assist.isWater &&
          Math.hypot(b.p.x - b.assist.base.x, b.p.z - b.assist.base.z) < 4;
        const sinkY = this.world.waterY + (skim ? -0.45 : 0.05);
        if (hh < this.world.waterY - 0.3 && b.p.y < sinkY) { sank = true; break; }
      }
      if (b.resting <= 0) {
        b.mesh.rotation.x -= dt * 14;
        if (Math.random() < dt * 30) this.fx.burst(b.p, { count: 1, col: "#fff", speed: 0.3, size: 0.16, life: 0.22, g: 0 });
      }
      b.mesh.position.copy(b.p);
      if (hit) {
        this.thrown.splice(i, 1);
        this.beginCapture(hit, b);
        continue;
      }
      if (sank) {
        this.audio.play("splash");
        this.fx.burst(V3(b.p.x, this.world.waterY + 0.1, b.p.z), { count: 12, col: "#bfe6ff", speed: 2.4, size: 0.26, life: 0.4 });
        this.fx.kill(b.mesh);
        this.thrown.splice(i, 1);
        this.ui.toast("Plunk... the Ball sank.", "bad");
        this.battle?.onBallMissed();
        continue;
      }
      // terrain (<=: once clamped exactly onto the ground the ball must keep
      // counting as "down", or it freezes at the threshold and never retires)
      const h = this.world.height(b.p.x, b.p.z);
      if (b.p.y <= h + 0.15) {
        // a near-miss that drops at the locked mon's feet still counts — the
        // ball rolls true off the trainer's arm
        const a = b.assist;
        if (a && !a.dead && !a.captureLock && a.ballCooldown <= 0 && a.phasedT <= 0 && !b.bounced &&
            !(this.battle && this.battle.type === "wild" && this.battle.enemyEnt !== a)) {
          const tp = a.pos();
          // ...but a ball in the dirt can't catch a bird riding a thermal:
          // the forgiveness only applies near the mon's actual height
          if (Math.hypot(b.p.x - tp.x, b.p.z - tp.z) < a.halfH + (b.aimed ? 1.4 : 0.9) &&
              Math.abs(b.p.y - tp.y) < a.halfH + 2.2) {
            this.thrown.splice(i, 1);
            this.beginCapture(a, b);
            continue;
          }
        }
        b.p.y = h + 0.15;
        const sp = b.v.length();
        if (!b.bounced && sp > 5) {
          b.bounced = true;
          b.v.y = Math.abs(b.v.y) * 0.34;
          b.v.x *= 0.45; b.v.z *= 0.45;
          this.audio.play("balldrop");
          this.fx.burst(b.p, { count: 5, col: "#cbb37e", speed: 1.6, size: 0.22, life: 0.3 });
        } else {
          b.resting += dt;
          if (b.resting > 0.8) {
            this.thrown.splice(i, 1);
            this.fx.anim(0.4, (k) => b.mesh.scale.setScalar(1 - k), () => this.fx.kill(b.mesh));
            this.ui.toast("The Ball rolled away empty...", "bad");
            this.battle?.onBallMissed();
            continue;
          }
        }
      }
      if (b.t > 6) {
        this.thrown.splice(i, 1);
        this.fx.kill(b.mesh);
        this.battle?.onBallMissed();
      }
    }
  }
  async beginCapture(wild: WildMon, b: ThrownBall) {
    const ball = b.mesh;
    if (wild.dead) { this.fx.kill(ball); return; }
    // one skill bonus: a deliberate, aimed throw lands truer
    let mult = 1;
    if (b.aimed) {
      mult = 1.2;
      this.ui.floatAt(wild.pos().add(V3(0, 0.8, 0)), "Nice throw!", "eff");
      this.audio.play("ringNice");
      this.addTrainerXp(4);
    }
    this.cancelAim();
    this.audio.play("ballhit");
    wild.captureLock = true;
    wild.engaged = true;
    const restore = this.fx.suckIn(wild, ball.position.clone());
    // ball drops to the ground (or bobs on the surface) even if the catch
    // happened in mid-air or out over the water
    const ground = Math.max(this.world.height(ball.position.x, ball.position.z), this.world.waterY) + 0.16;
    this.fx.anim(0.45, (k) => { ball.position.y = ball.position.y + (ground - ball.position.y) * k; });
    await new Promise((r) => setTimeout(r, 600));
    // Gen-1-spirit catch formula, multiplied by throw skill
    const m = wild.mon, spec = DEX[m.sp];
    const ballBonus = ITEMS[b.type].ball;
    const c = this.battle ? this.battle.conds.enemy : {};
    const statusBonus = (c.slp > 0 || c.frz > 0) ? 2 : (c.para || c.brn || c.psn || c.tox) ? 1.5 : 1;
    const a = ((3 * m.maxhp - 2 * m.hp) * spec.catch * ballBonus * statusBonus * mult) / (3 * m.maxhp);
    const p = this.state.cheats?.catchall ? 1 : clamp(a / 255, 0.01, 1);
    // critical catch: rare, scales with your Pokédex progress and throw skill
    const critP = Math.min(0.16, this.dexCaught.size / 650 + (mult > 1 ? 0.05 : 0.015));
    const crit = !this.state.cheats?.catchall && Math.random() < critP && Math.random() < Math.max(p, 0.25);
    const caught = crit || Math.random() < p;
    if (crit) {
      this.audio.play("critcatch");
      this.fx.critCatchFX(ball.position.clone());
      this.ui.floatAt(ball.position.clone().add(V3(0, 0.7, 0)), "Critical catch!", "crit");
      await this.fx.ballShake(ball);
    } else {
      const shakes = caught ? 3 : Math.min(2, Math.floor(4 * Math.pow(p, 0.6) * rnd(1.1, 0.6)));
      for (let i = 0; i < shakes; i++) {
        await this.fx.ballShake(ball);
        await new Promise((r) => setTimeout(r, 260));
      }
    }
    if (caught) {
      this.fx.ballCatch(ball);
      this.fx.confetti(ball.position.clone().add(V3(0, 0.4, 0)));
      this.audio.cry(m.sp, DEX[m.sp].height);
      this.ui.catchBanner?.(`Gotcha! ${monName(m)} was caught!`);
      this.ui.toast(`Gotcha! ${monName(m)} was caught!`, "good");
      this.markCaught(m.sp);
      this.addTrainerXp(25);
      m.hp = Math.max(1, Math.floor(m.hp));
      const where = this.giveMon(m);
      if (where === "box") this.ui.toast(`${monName(m)} was sent to the PC Box.`, "");
      const idx = this.wilds.indexOf(wild);
      if (idx >= 0) this.wilds.splice(idx, 1);
      setTimeout(() => { this.fx.kill(ball); }, 900);
      wild.dispose();
      delete this.legendAlive[m.sp];
      if (this.battle && this.battle.enemyEnt === wild) this.battle.end("caught");
      this.syncFollower();
      this.ui.updateParty();
      this.save();
    } else {
      this.fx.ballBreak(ball);
      restore();
      wild.captureLock = false;
      wild.ballCooldown = 1.5;
      this.ui.toast(`Oh no! ${monName(m)} broke free!`, "bad");
      this.battle?.onCatchFail();   // classic: it gets a free swing at you
      if (!this.battle) {
        if (spec.temper === "skittish") { wild.state = "flee"; wild.fleeT = 3; wild.engaged = false; }
        else if (spec.temper === "aggressive") wild.state = "aggro";
        else wild.engaged = false;
      }
    }
  }
  // ---------------------------------------------------------- fishing (v3)
  startFishing(spot: THREE.Vector3) {
    this.dismountVehicle();
    if (this.fishing || this.battle || this.cutscene) return;
    const bobber = new THREE.Group();
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0xe23b3b }));
    const bot = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0xf2f2f2 }));
    bobber.add(top, bot);
    bobber.position.copy(spot).setY(this.world.waterY + 0.04);
    this.scene.add(bobber);
    this.audio.play("splash");
    this.fx.ringAt(bobber.position.clone().setY(this.world.waterY + 0.06), { col: "#bfe6ff", r0: 0.2, r1: 1.2, dur: 0.6 });
    this.fishing = { phase: "wait", t: rnd(6, 2.2), spot: spot.clone(), bobber, castFrom: this.playerPos.clone() };
    this.ui.toast("You cast the Old Rod... wait for it...", "");
  }
  stopFishing(silent = false) {
    if (!this.fishing) return;
    this.scene.remove(this.fishing.bobber);
    this.fishing = null;
    if (!silent) this.ui.toast("You reeled the line back in.", "");
  }
  fishingUpdate(dt: number) {
    const f = this.fishing;
    if (!f) return;
    // walked away? line snaps
    if (this.playerPos.distanceTo(f.castFrom) > 2.6 || this.battle) { this.stopFishing(); return; }
    f.bobber.position.y = this.world.waterY + 0.04 + Math.sin(this.world.uTime.value * 2.4) * 0.03;
    f.t -= dt;
    if (f.phase === "wait" && f.t <= 0) {
      f.phase = "bite";
      f.t = 0.9; // the reaction window
      this.audio.play("bite");
      this.ui.floatAt(f.bobber.position.clone().add(V3(0, 0.7, 0)), "!", "crit");
      f.bobber.position.y -= 0.1;
      this.fx.burst(f.bobber.position, { count: 8, col: "#bfe6ff", speed: 1.8, size: 0.2, life: 0.35 });
    } else if (f.phase === "bite" && f.t <= 0) {
      this.stopFishing(true);
      this.ui.toast("It got away...", "bad");
    }
  }
  hookFish() {
    const f = this.fishing;
    if (!f) return;
    if (f.phase !== "bite") { this.stopFishing(); return; }
    this.audio.play("reel");
    const zone = this.world.zoneAt(f.spot.x, f.spot.z);
    const pool = SPAWNS[zone]?.water?.length ? SPAWNS[zone].water : [[129, 70, 5, 15], [118, 20, 10, 18], [60, 10, 8, 16]];
    let total = 0;
    for (const e of pool) total += e[1];
    let r = Math.random() * total, pick = pool[0];
    for (const e of pool) { r -= e[1]; if (r <= 0) { pick = e; break; } }
    const mon = makeMon(pick[0], irnd(pick[2], pick[3]));
    const wild = new WildMon(this, mon, f.spot.clone().setY(this.world.waterY - 0.15), { water: true });
    this.wilds.push(wild);
    this.stopFishing(true);
    // the catch leaps out of the water at you
    this.fx.burst(wild.pos(), { count: 16, col: "#bfe6ff", col2: "#fff", speed: 3.4, size: 0.3, life: 0.5 });
    this.audio.play("splash");
    this.audio.cry(mon.sp, DEX[mon.sp].height);
    this.ui.toast(`A ${monName(mon)} is hooked! (Lv ${mon.lv})`, "good");
    wild.engaged = true;
    setTimeout(() => { if (!wild.dead) this.startWildBattle(wild); }, 450);
  }

  // ------------------------------------------------- Team Rocket events (v3)
  rocketAmbush(force = false) {
    if (this.battle || this.cutscene || this.ui.modalOpen || !this.state.started) return false;
    if (this.trainers.some((t) => t.def.rocket)) return false;
    const zone = this.world.zoneAt(this.playerPos.x, this.playerPos.z);
    if (!force && (this.world.biomeAt(this.playerPos.x, this.playerPos.z) === "town" || zone.includes("cave"))) return false;
    const lead = this.activeMon();
    if (!lead) return false;
    const n = this.state.beaten["rocketduo"]?.n || 0;
    const lv = clamp(lead.lv - 1 + n * 2, 5, 60);
    const party = lead.lv >= 18 ? [23, 109, 52] : [23, 109]; // Ekans, Koffing (+Meowth later)
    const def = {
      id: "rocketduo", rocket: true, name: "Jessie & James", look: { shirt: "#f5f5f5", pants: "#3e2723", hair: "#c2185b" },
      pos: [0, 0], party, lvs: party.map(() => lv), pay: 35, payMul: 1.6,
      dlg: [
        "Prepare for trouble — and make it double! To protect the world from devastation... hand over your rare Pokémon, twerp!",
        "This can't be! Team Rocket's blasting off agaaain!",
        "We're back! And twice as motivated!",
      ],
    };
    const dir = this.lookDir();
    const px = this.playerPos.x + dir.x * 9, pz = this.playerPos.z + dir.z * 9;
    def.pos = [px, pz];
    const npc = new TrainerNPC(this, def);
    npc.engaging = true;          // we run the scripted intro ourselves
    npc.despawnT = 120;
    this.trainers.push(npc);
    this.audio.play("rocket");
    this.fx.burst(npc.pos.clone().add(V3(0, 1.4, 0)), { count: 22, col: "#fff", col2: "#c2185b", speed: 3, size: 0.3, life: 0.5 });
    (async () => {
      await this.ui.dialog("???", [def.dlg[0]]);
      if (!this.battle && !this.ui.modalOpen) this.startTrainerBattle(npc);
      else npc.engaging = false;
    })();
    return true;
  }

  startWildBattle(wild, ambush = false) {
    if (this.battle || !this.activeMon() || wild.dead || this.cutscene) return;
    if (this.ui.modalOpen) return;
    this.cancelAim();
    this.stopFishing(true);
    this.dismountVehicle();
    this.battle = new Battle(this, { wild, ambush });
    if (ambush) this.ui.toast("It charged at you!", "bad");
  }
  async startTrainerBattle(npc) {
    if (this.battle || this.ui.modalOpen || this.cutscene) return;
    if (!this.activeMon()) { this.ui.toast("Your Pokémon need to be healed first!", "bad"); npc.engaging = false; return; }
    npc.engaging = true;
    this.cancelAim();
    this.stopFishing(true);
    this.dismountVehicle();
    // the Champion's last slot counters your starter, and his team scales to yours
    if (npc.def.champion) {
      const counter = COUNTER_STARTER[this.state.starter] || 9;
      npc.def.party[npc.def.party.length - 1] = counter;
      const lead = this.activeMon();
      const bump = Math.max(0, (lead?.lv || 40) - 43);
      npc.def.lvs = [40, 41, 41, 42, 43, 45].map((b) => Math.min(70, b + bump));
    }
    await this.ui.dialog(npc.def.name, [npc.def.dlg[0]]);
    if (this.battle) return;
    this.battle = new Battle(this, { trainer: npc });
  }
  engageTarget() {
    if (this.battle || !this.target || !(this.target instanceof WildMon)) return;
    if (!this.activeMon()) { this.ui.toast("All your Pokémon have fainted!", "bad"); return; }
    this.startWildBattle(this.target);
  }
  healParty() {
    for (const m of this.state.party) { m.hp = m.maxhp; m.status = null; refreshPP(m); }
    this.ui.updateParty();
  }
  whiteout() {
    this.audio.play("whiteout");
    const lost = Math.floor(this.state.money / 2);   // Gen 1: you lose half your money
    this.ui.fadeOut("You blacked out!").then(() => {
      const c = this.state.lastCenter;
      if (c) this.playerPos.set(c[0], this.world.height(c[0], c[1]), c[1]);
      else this.playerPos.copy(this.world.townSpawn);
      this.state.money -= lost;
      this.healParty();
      this.syncFollower();
      this.ui.toast(lost > 0 ? `You panicked and dropped ₽${lost.toLocaleString()}...` : "You scurried back to safety...", "bad");
      this.ui.toast("Your Pokémon were rushed back to health.", "");
      this.ui.updateHUD();
      this.save();
    });
  }

  // ----------------------------------------------------------- XP / evos
  handleXp(mon, xp) {
    const evs = addXp(mon, xp);
    for (const e of evs) {
      if (e.type === "level") {
        this.audio.play("levelup");
        this.ui.toast(`${monName(mon)} grew to Lv ${e.lv}!`, "good");
        const ent = this.entityFor(mon);
        if (ent) this.fx.levelUp(ent);
      } else if (e.type === "learn") {
        this.learnQueue.push({ mon, move: e.move });
      } else if (e.type === "evolve") {
        if (!this.evoQueue.some((q) => q.mon === mon)) this.evoQueue.push({ mon, to: e.to });
      }
    }
    this.ui.updateParty();
    if (!this.battle) this.processEvoQueue();
  }
  entityFor(mon) {
    if (this.battle && this.battle.allyMon === mon && !this.battle.allyEnt.dead) return this.battle.allyEnt;
    if (this.follower && this.follower.mon === mon && !this.follower.dead && this.follower.group.visible) return this.follower;
    return null;
  }
  async processEvoQueue() {
    if (this.processingQueues) return;
    this.processingQueues = true;
    this.cutscene = true;
    // move learning prompts
    while (this.learnQueue.length) {
      const { mon, move } = this.learnQueue.shift();
      if (mon.moves.includes(move)) continue;
      if (mon.moves.length < 4) {
        mon.moves.push(move);
        mon.pp = mon.pp || [];
        mon.pp.push(MOVES[move].pp);          // keep PP array aligned with the new slot
        this.audio.play("learn");
        this.ui.toast(`${monName(mon)} learned ${MOVES[move].name}!`, "good");
      } else {
        const slot = await this.ui.learnPrompt(mon, move);
        if (slot != null && slot >= 0) {
          const old = MOVES[mon.moves[slot]].name;
          mon.moves[slot] = move;
          if (mon.pp) mon.pp[slot] = MOVES[move].pp;   // fresh PP for the freshly learned move
          this.audio.play("learn");
          this.ui.toast(`Forgot ${old} and learned ${MOVES[move].name}!`, "good");
        } else this.ui.toast(`${monName(mon)} did not learn ${MOVES[move].name}.`, "");
      }
    }
    // evolutions (cinematic)
    while (this.evoQueue.length) {
      const { mon, to } = this.evoQueue.shift();
      if (!this.state.party.includes(mon) && !this.state.boxes.includes(mon)) continue;
      const pos = this.playerPos.clone().add(this.lookDir().multiplyScalar(4.5));
      pos.y = this.world.height(pos.x, pos.z);
      const ent = new MonEntity(this, mon, pos);
      this.audio.play("evolve");
      this.ui.toast(`What? ${monName(mon)} is evolving!`, "good");
      const fromName = monName(mon);
      ent.lookToward(this.playerPos);
      await this.fx.evolve(ent, () => {
        evolveMon(mon, to);
        ent.setSpecies(to);
      });
      this.markCaught(to);
      this.addTrainerXp(20);
      this.audio.play("evolveDone");
      this.ui.toast(`${fromName} evolved into ${monName(mon)}!`, "good");
      // pick up new level-1 moves of evolved form? (gen 1: keeps moves) — keep moves
      await new Promise<void>((r) => setTimeout(r, 900));
      ent.fadeOut();
      this.ui.updateParty();
      this.save();
    }
    this.processingQueues = false;
    this.cutscene = false;
    this.syncFollower();
  }
  lookDir() { return this.camera.getWorldDirection(V3()).setY(0).normalize(); }

  // ----------------------------------------------------------- interact/E
  nearestInteract() {
    const cands = [];
    for (const it of this.world.interactables) {
      if (it.id === "berry" && !it.bush.ready) continue;
      const d = this.playerPos.distanceTo(it.pos);
      if (d < it.r) cands.push({ d, it });
    }
    for (const t of this.trainers) {
      const d = this.playerPos.distanceTo(t.pos);
      if (d < 3.4) cands.push({ d, it: { id: "trainer", npc: t, label: t.everBeaten() ? (t.beaten() ? `talk to ${t.def.name}` : `rematch ${t.def.name}`) : `battle ${t.def.name}` } });
    }
    for (const c of this.civs) {
      const d = this.playerPos.distanceTo(c.pos);
      if (d < 2.6) cands.push({ d, it: { id: "civ", civ: c, label: c.phone ? `interrupt the ${c.name}` : `chat with the ${c.name}` } });
    }
    // pet your follower — only when nothing else competes for the E key
    // (it follows you everywhere; it must never shadow a nurse or a shop counter)
    if (!cands.length && this.follower && !this.follower.dead && this.follower.group.visible && this.petCd <= 0) {
      const d = this.playerPos.distanceTo(this.follower.base);
      if (d < 2.3) cands.push({ d, it: { id: "pet", pos: this.follower.base, r: 2.3, label: `pet ${monName(this.follower.mon)}` } });
    }
    // fishing: lowest priority, only when nothing else is near
    if (!cands.length && !this.fishing && !this.battle && this.state.started) {
      const spot = this.world.fishSpot(this.playerPos, this.lookDir());
      if (spot) cands.push({ d: 9, it: { id: "fish", pos: spot, r: 9, label: "cast the Old Rod", spot } });
    }
    if (this.fishing) cands.unshift({ d: 0, it: { id: "fishing", pos: this.fishing.spot, r: 9, label: this.fishing.phase === "bite" ? "HOOK IT!" : "reel in" } });
    cands.sort((a, b) => a.d - b.d);
    return cands[0]?.it || null;
  }
  async interact() {
    if (this.battle || this.ui.modalOpen) return;
    const it = this.nearestInteract();
    if (!it) return;
    if (it.id === "pet") {
      this.petFollower();
    } else if (it.id === "civ") {
      // strollers stop for a proper chat; scrollers answer without looking up
      this.audio.play("ui");
      await this.ui.dialog(it.civ.name, it.civ.nextLines());
    } else if (it.id === "berry") {
      if (this.world.pickBerry(it.bush)) {
        const n1 = irnd(2, 3);
        this.state.items.oranberry += n1;
        this.audio.play("pickup");
        this.fx.burst(it.pos.clone().add(V3(0, 0.8, 0)), { count: 10, col: "#ff6b6b", col2: "#4d96ff", speed: 2, size: 0.2, life: 0.45 });
        this.ui.toast(`Picked ${n1}× Oran Berry!`, "good");
        this.ui.updateHUD();
        this.save();
      }
    } else if (it.id === "fish") {
      this.startFishing(it.spot);
    } else if (it.id === "fishing") {
      this.hookFish();
    } else if (it.id === "nurse") {
      const yes = await this.ui.dialog("Nurse Joy", ["Welcome to the Pokémon Center!", "Shall I restore your Pokémon to full health?"], ["Yes please!", "No thanks"]);
      if (yes === 0) {
        await this.ui.fadeOut(null, 0.45);
        this.audio.play("heal");
        this.healParty();
        if (it.spawn) this.state.lastCenter = [it.spawn.x, it.spawn.z];
        await this.ui.dialog("Nurse Joy", ["Your Pokémon are fighting fit!", "We hope to see you again!"]);
        this.save();
      }
    } else if (it.id === "pc") {
      this.audio.play("pc");
      this.ui.openStorage();
    } else if (it.id === "clerk") {
      this.ui.openShop();
    } else if (it.id === "sign") {
      this.ui.dialog("Sign", it.text || ["..."]);
    } else if (it.id === "mom") {
      const yes = await this.ui.dialog("Mom", ["Welcome home, dear!", "You look tired... shall I tuck your Pokémon in for a rest?"], ["Yes please!", "Not now"]);
      if (yes === 0) {
        await this.ui.fadeOut(null, 0.45);
        this.audio.play("heal");
        this.healParty();
        if (it.spawn) this.state.lastCenter = [it.spawn.x, it.spawn.z];
        await this.ui.dialog("Mom", ["All better! Don't push them too hard, okay?"]);
        this.save();
      }
    } else if (it.id === "oak") {
      const caught = this.dexCaught.size, seen = this.dexSeen.size;
      this.ui.dialog("Professor Oak", [
        "How is my old Pokédex holding up?",
        `You've seen ${seen} Pokémon and caught ${caught} of 151. ${caught >= 151 ? "INCREDIBLE! You've completed the Pokédex!" : caught >= 75 ? "Half way there — keep at it!" : "Every species matters to science!"}`,
        "Each species lives where it always has: bugs in Viridian Forest, Zubat in Mt. Moon... study their habitats!",
      ]);
    } else if (it.id === "bill") {
      this.ui.dialog("Bill", [
        "Hey! I'm Bill, the Pokémaniac! Not a Pokémon, this time.",
        "My PC storage system works from any Pokémon Center. Neat, right?",
        "Oh — and dockworkers in Vermilion swear something PINK naps near that old truck by the S.S. Anne on dark nights. It only shows itself to truly proven trainers...",
      ]);
    } else if (it.id === "warden") {
      this.ui.dialog("Safari Warden", [
        "Welcome to the SAFARI ZONE, pride of Fuchsia City!",
        "Rare Pokémon from all over Kanto roam free here: Scyther, Pinsir, Tauros, Kangaskhan, Chansey...",
        "Dratini swim in the pond. Tread quietly and good luck!",
      ]);
    } else if (it.id === "chairman") {
      if (!this.state.voucher && !this.state.bike) {
        await this.ui.dialog("Fan Club Chairman", [
          "Welcome to the POKéMON FAN CLUB! I'm the Chairman!",
          "My favorite RAPIDASH... it's so beautiful. Mane of fire, proud like a stallion... I could talk about it for hours. Hours!",
          "...oh my, you listened to the whole thing? You're a good kid!",
          "Take this BIKE VOUCHER! Trade it for a Bicycle at the Bike Shop in Cerulean City!",
        ]);
        this.state.voucher = true;
        this.audio.play("pickup");
        this.ui.toast("Received the BIKE VOUCHER!", "good");
        this.save();
      } else {
        this.ui.dialog("Fan Club Chairman", ["Did I mention my RAPIDASH's tail? Like a comet!", this.state.bike ? "Riding that Bicycle everywhere, I hope!" : "The Bike Shop is in Cerulean City, north past Mt. Moon!"]);
      }
    } else if (it.id === "bikeclerk") {
      if (this.state.bike) {
        this.ui.dialog("Bike Shop Owner", ["How's the Bicycle treating you?", "Press V any time to hop on. No refunds!"]);
      } else if (this.state.voucher) {
        await this.ui.dialog("Bike Shop Owner", ["Welcome, welcome! Our Bicycles are ₽1,000,000 — top of the line!", "...wait, is that a BIKE VOUCHER from the Fan Club Chairman?!", "Well then! It's all yours. Ride safe!"]);
        this.state.voucher = false;
        this.state.bike = true;
        this.audio.play("badge");
        this.ui.toast("Got the BICYCLE! Press V to ride it!", "good");
        this.save();
      } else {
        this.ui.dialog("Bike Shop Owner", ["Welcome! Our Bicycles are ₽1,000,000.", "...That's not a typo. Nobody's ever bought one.", "Although — the POKéMON FAN CLUB Chairman in Vermilion hands out vouchers to anyone who survives his Rapidash stories..."]);
      }
    } else if (it.id === "truck") {
      if (this.state.truckKeys) {
        this.ui.dialog("The Old Truck", ["Your trusty truck. Press V to drive it.", "It still smells faintly of... something pink?"]);
      } else if (this.state.badges.length >= 8) {
        await this.ui.dialog("The Old Truck", ["The legendary truck by the S.S. Anne...", "The keys are tucked above the sun visor. After eight badges, who's going to stop the Champion of Kanto?", "VROOM. The engine turns over!"]);
        this.state.truckKeys = true;
        this.audio.play("engine");
        this.ui.toast("You can drive the TRUCK now! Press V!", "good");
        this.save();
      } else {
        this.ui.dialog("The Old Truck", ["An old truck sits by the pier. The engine is cold.", "Something about it feels... legendary. Maybe a true Champion could get it moving."]);
      }
    } else if (it.id === "guard") {
      if (this.state.badges.length >= 8) {
        this.world.openCaveGate();
        this.ui.dialog("Guard", ["All eight Gym Badges... you're league material.", "Very well. The barrier is lifted. But beware — the Pokémon inside are on another level entirely."]);
      } else {
        this.ui.dialog("Guard", ["Halt! Cerulean Cave is sealed.", "An immensely powerful Pokémon dwells within. Only trainers holding ALL EIGHT Gym Badges may enter."]);
      }
    } else if (it.id === "trainer") {
      const t = it.npc;
      if (t.def.needBadge && !this.state.badges.includes(t.def.needBadge) && !t.everBeaten()) {
        const meta = BADGE_META[t.def.needBadge];
        this.ui.dialog(t.def.name, [`Hold on — challengers need the ${meta.name} first.`, `Go beat ${meta.from}, then come back!`]);
        return;
      }
      if (t.def.champion && this.state.badges.length < 8 && !t.everBeaten()) {
        this.ui.dialog(t.def.name, ["Whoa whoa — you think you can challenge ME without proving yourself?", `You only have ${this.state.badges.length} of the 8 Gym Badges. Come back when you've swept every gym in Kanto!`]);
        return;
      }
      if (!t.everBeaten()) this.startTrainerBattle(t);
      else if (!t.beaten()) {
        const yes = await this.ui.dialog(t.def.name, [t.def.dlg[2] || "Rematch?"], ["Bring it on!", "Not now"]);
        if (yes === 0) this.battle = new Battle(this, { trainer: t });
      } else this.ui.dialog(t.def.name, [t.def.dlg[1]]);
    }
  }

  // ---------------------------------------------------------------- items
  useItem(key, partyIdx, inBattle = false) {
    const item = ITEMS[key];
    const s = this.state;
    if (!item || s.items[key] <= 0) return false;
    // classic battles: the bag only opens on YOUR turn (no free-turn stacking)
    if (inBattle && this.battle?.style === "classic" && this.battle.turnPhase !== "player") {
      this.ui.toast("Wait for your turn!", "bad");
      return false;
    }
    const mon = s.party[partyIdx];
    if (item.heal) {
      if (!mon || mon.hp <= 0 || mon.hp >= mon.maxhp) { this.ui.toast("It won't have any effect.", "bad"); return false; }
      mon.hp = Math.min(mon.maxhp, mon.hp + item.heal);
      s.items[key]--;
      this.audio.play("heal");
      this.ui.toast(`${monName(mon)} recovered ${item.heal} HP!`, "good");
      const ent = this.entityFor(mon);
      if (ent) this.fx.healGlow(ent);
    } else if (item.revive) {
      if (!mon || mon.hp > 0) { this.ui.toast("It won't have any effect.", "bad"); return false; }
      mon.hp = Math.floor(mon.maxhp * item.revive);
      s.items[key]--;
      this.audio.play("heal");
      this.ui.toast(`${monName(mon)} was revived!`, "good");
    } else if (item.ball) {
      this.ui.toast("Throw Balls by clicking at a wild Pokémon!", "");
      return false;
    } else if (key === "repel") {
      if (s.repelT > 0) { this.ui.toast("A Repel is already active.", ""); return false; }
      s.items[key]--;
      s.repelT = 150;
      this.audio.play("repel");
      this.ui.toast("Repel applied — weak wild Pokémon will keep their distance.", "good");
    } else if (key === "lure") {
      if (s.lureT > 0) { this.ui.toast("A Lure is already active.", ""); return false; }
      s.items[key]--;
      s.lureT = 120;
      this.audio.play("lure");
      this.ui.toast("Sweet honey scent drifts out... wild Pokémon are coming!", "good");
    } else if (key === "escaperope") {
      if (inBattle) { this.ui.toast("Not during a battle!", "bad"); return false; }
      s.items[key]--;
      this.audio.play("rope");
      const c = s.lastCenter;
      this.ui.fadeOut("You whooshed away!").then(() => {
        if (c) this.playerPos.set(c[0], this.world.height(c[0], c[1]), c[1]);
        else this.playerPos.copy(this.world.townSpawn);
        this.ui.toast("Whisked back to the last Pokémon Center!", "good");
      });
    } else if (key === "nugget") {
      s.items[key]--;
      s.money += 5000;
      this.audio.play("buy");
      this.ui.toast("Sold the Nugget for ₽5,000!", "good");
    }
    this.ui.updateParty(); this.ui.updateHUD();
    // classic battles: rummaging in the bag was your whole turn
    if (inBattle && this.battle?.style === "classic") this.battle.enemyFreeTurn(1.0);
    return true;
  }
  buyItem(key, qty = 1) {
    const item = ITEMS[key];
    const cost = item.price * qty;
    if (item.unlock && this.state.tl < item.unlock) { this.ui.toast(`Reach Trainer Lv ${item.unlock} to buy this.`, "bad"); this.audio.play("deny"); return; }
    if (this.state.money < cost) { this.ui.toast("Not enough money!", "bad"); this.audio.play("deny"); return; }
    this.state.money -= cost;
    this.state.items[key] += qty;
    this.audio.play("buy");
    this.ui.toast(`Bought ${qty}× ${item.name}!`, "good");
    this.ui.updateHUD();
    this.save();
  }

  // ----------------------------------------------------------------- input
  keybinds() {
    if (!this.state.settings) this.state.settings = {};
    this.state.settings.keybinds = normalizeKeybinds(this.state.settings.keybinds);
    return this.state.settings.keybinds;
  }
  keyCode(action: string) { return this.keybinds()[action] || DEFAULT_KEYBINDS[action]; }
  keyLabel(action: string) { return keyLabel(this.keyCode(action)); }
  actionsForCode(code: string) {
    const binds = this.keybinds();
    return KEYBIND_ACTIONS.filter((a) => binds[a.id] === code).map((a) => a.id);
  }
  setKeybind(action: string, code: string) {
    if (!DEFAULT_KEYBINDS[action]) return false;
    this.keybinds()[action] = code;
    this.save();
    return true;
  }
  resetKeybinds() {
    if (!this.state.settings) this.state.settings = {};
    this.state.settings.keybinds = normalizeKeybinds();
    this.save();
  }

  // One hand on movement, the other on the mouse. Physical keys are translated
  // into saved action names before gameplay sees them, so HUD and input agree.
  onKey(actions, k = "") {
    const has = (id) => actions?.includes?.(id);
    if (this.battle && !this.ui.modalOpen) {
      const b = this.battle;
      const mi = MOVE_ACTIONS.findIndex((id) => has(id));
      if (mi >= 0) b.useMove("ally", mi);
      else if (k >= "1" && k <= "6") {
        const idx = +k - 1, mon = this.state.party[idx];
        if (!mon) return;
        if (mon === b.allyMon) return;
        if (mon.hp <= 0) { this.ui.toast(`${monName(mon)} has no energy left!`, "bad"); return; }
        b.doSwitch(idx);
      }
      else if (has("switchMenu")) this.ui.openSwitch(false).then((idx) => { if (idx != null && this.battle) this.battle.doSwitch(idx); });
      else if (has("throwBall")) this.quickBall();
      else if (has("quickHeal")) this.quickHeal();
      else if (has("flee")) b.tryRun();
      else if (has("jumpDodge")) b.tryDodge();
      else if (has("possess")) b.togglePossess();
      else if (has("battleStyle")) b.cycleStyle();
      return;
    }
    if (has("interact")) this.interact();
    if (has("battle")) this.engageTarget();
    if (has("vehicle")) this.toggleVehicle();
    if (has("throwBall")) this.quickThrowAt(this.target);    // same lob as a click
    if (has("quickHeal")) this.quickHeal();                  // patch up the lead mon anywhere
  }
  // G — the dedicated Ball key. Works from possession too: you hop back into
  // your own hands for the throw, then dive right back in.
  quickBall() {
    const b = this.battle;
    if (!b) return;
    if (b.type === "trainer") { this.ui.toast("The Trainer blocked the Ball! Don't be a thief!", "bad"); return; }
    if (b.possessed && this.ballType()) b.autoEject();
    this.quickThrowAt(b.enemyEnt);
  }
  // Z — the dedicated item key: feeds the best healing item to your battler.
  quickHeal() {
    const mon = this.battle ? this.battle.allyMon : this.activeMon();
    if (!mon) return;
    const idx = this.state.party.indexOf(mon);
    if (mon.hp >= mon.maxhp || mon.hp <= 0) { this.ui.toast(mon.hp <= 0 ? "It fainted — use a Revive from the bag (I)." : `${monName(mon)} is at full HP.`, ""); return; }
    const missing = mon.maxhp - mon.hp;
    const owned = ["oranberry", "potion", "superpotion"].filter((key) => this.state.items[key] > 0);
    if (!owned.length) { this.ui.toast("No healing items! Stock up at a PokéMart.", "bad"); this.audio.play("deny"); return; }
    // smallest item that covers the missing HP; otherwise the biggest we have
    owned.sort((a, b2) => ITEMS[a].heal - ITEMS[b2].heal);
    const key = owned.find((o) => ITEMS[o].heal >= missing) || owned[owned.length - 1];
    this.useItem(key, idx, !!this.battle);
  }

  // ---------------------------------------------------------------- update
  update(dt) {
    if (!this.state.started) return;
    this.state.playT = (this.state.playT || 0) + Math.min(dt, 0.1);   // the save slot's playtime clock
    // slow-mo while aiming a throw
    const rawDt = dt;
    const tsTarget = this.aim ? 0.3 : 1;
    this.timeScale += (tsTarget - this.timeScale) * Math.min(1, dt * 10);
    if (Math.abs(this.timeScale - tsTarget) < 0.02) this.timeScale = tsTarget;
    dt *= this.timeScale;

    this.throwLock -= dt;
    this.petCd -= dt;
    const s = this.state;
    if (s.repelT > 0) { s.repelT -= dt; if (s.repelT <= 0) this.ui.toast("The Repel wore off.", ""); }
    if (s.lureT > 0) { s.lureT -= dt; if (s.lureT <= 0) this.ui.toast("The Lure's scent faded.", ""); }
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      const crowded = this.localWildCount() >= this.wildDensityTarget() * 0.75;
      this.spawnT = s.lureT > 0 ? 0.75 : crowded ? 2.2 : 1.55;
      this.spawnTick();
      this.legendTick();
    }
    for (let i = this.wilds.length - 1; i >= 0; i--) this.wilds[i].update(dt);
    for (let i = this.trainers.length - 1; i >= 0; i--) {
      const t = this.trainers[i];
      t.update(dt);
      if (t.despawnT != null && (!this.battle || this.battle.trainer !== t) && !t.engaging) {
        t.despawnT -= dt;
        if (t.despawnT <= 0) { t.dispose(); this.trainers.splice(i, 1); }
      }
    }
    if (this.follower) this.follower.update(dt);
    if (this.battle) this.battle.update(dt);
    this.updateThrow(dt, rawDt);
    this.fishingUpdate(dt);
    // ambient weather audio follows the world's rain level
    this.audio.rain(this.world.isRaining() ? this.world.weatherW * (this.world.weather === "storm" ? 1 : 0.6) : 0, dt);
    // random Team Rocket ambushes once you've got a badge
    this.rocketT -= dt;
    if (this.rocketT <= 0) {
      this.rocketT = rnd(200, 140);
      if (this.state.badges.length >= 1 && Math.random() < 0.6) this.rocketAmbush();
    }
    // pending rival milestone? he finds you the moment you're battle-ready
    if (this.state.story?.rivalDue != null) this.rivalAmbush();
    this.targetT -= dt;
    if (this.targetT <= 0) { this.targetT = 0.12; this.updateTarget(); }
    this.spotCheckT -= dt;
    if (this.spotCheckT <= 0) {
      this.spotCheckT = 1.5;
      for (const [name, p] of Object.entries(this.world.spots)) {
        if (!this.state.spotsFound.includes(name) && this.playerPos.distanceTo(p) < 26) {
          this.state.spotsFound.push(name);
          this.ui.toast("You sense a powerful presence around here...", "");
        }
      }
    }
    this.saveT -= dt;
    if (this.saveT <= 0) { this.saveT = 10; this.save(); }
  }
  // ambient actors keep moving even on the title screen / during the intro —
  // called from the main loop outside the usual "game started" gate
  updateAmbient(dt) {
    for (const c of this.civs) c.update(dt);
    if (this.showcase) {
      this.showcase.t += dt;
      this.showcase.rig.anim(dt, { speed: 0, water: false });
      this.showcase.rig.group.rotation.y += dt * 0.45;   // lazy turntable
    }
  }

  // ---------------------------------------------------------------- cheats
  // Teleport destinations for the cheat menu (design space × MAP_SCALE).
  static CHEAT_TPS = Object.fromEntries(Object.entries({
    pallet: [-95, 134], viridian: [-95, 30], pewter: [-95, -135], cerulean: [75, -160],
    saffron: [75, -25], celadon: [-30, -25], lavender: [205, -25], vermilion: [75, 95],
    fuchsia: [-30, 175], cinnabar: [-95, 258], indigo: [-212, -193],
    forest: [-100, -55], mtmoon: [-15, -175], rocktunnel: [195, -125], powerplant: [247, -84],
    safari: [5, 130], seafoam: [-30, 244], cycling: [-30, 75], victory: [-200, -80],
    ceruleancave: [56, -200], bill: [135, -242],
  }).map(([k, [x, z]]) => [k, [x * MAP_SCALE, z * MAP_SCALE]]));
  cheat(action, arg?) {
    const s = this.state;
    switch (action) {
      case "money": s.money += 10000; this.ui.toast("Cheat: +₽10,000", "good"); break;
      case "balls": for (const b of BALL_ORDER) s.items[b] += 10; this.ui.toast("Cheat: +10 of every Ball", "good"); break;
      case "items": s.items.potion += 10; s.items.superpotion += 10; s.items.revive += 5; this.ui.toast("Cheat: healing items stocked", "good"); break;
      case "heal": this.healParty(); this.audio.play("heal"); this.ui.toast("Cheat: party fully healed", "good"); break;
      case "candy": {
        const m = this.activeMon();
        if (!m) { this.ui.toast("No healthy Pokémon!", "bad"); return; }
        const target = Math.min(100, m.lv + 5);
        this.handleXp(m, xpForLevel(m.sp, target) - m.xp);
        this.ui.toast(`Cheat: Rare Candy x5 → ${monName(m)}`, "good");
        break;
      }
      case "tl": s.tl += 5; s.txp = 0; this.ui.toast(`Cheat: Trainer Level → ${s.tl}`, "good"); break;
      case "badges": {
        for (const b of Object.keys(BADGE_META)) if (!s.badges.includes(b)) s.badges.push(b);
        this.world.openCaveGate();
        this.ui.toast("Cheat: all 8 badges granted", "good");
        break;
      }
      case "day": this.world.timeOfDay = 0.25; this.ui.toast("Cheat: time set to noon", "good"); break;
      case "night": this.world.timeOfDay = 0.7; this.ui.toast("Cheat: time set to midnight", "good"); break;
      case "dexall": for (const p of POKEDEX) this.markSeen(p.id); this.ui.toast("Cheat: Pokédex — all 151 marked seen", "good"); break;
      case "tp": {
        const c = Game.CHEAT_TPS[arg];
        if (!c) return;
        this.playerPos.set(c[0], this.world.height(c[0], c[1]) + 0.5, c[1]);
        this.ui.toast(`Warped to ${this.world.zoneName(this.world.zoneAt(c[0], c[1]))}!`, "good");
        break;
      }
      case "spawn": {
        const name = String(arg.name || "").trim().toLowerCase();
        const spec = POKEDEX.find((p) => p.name.toLowerCase() === name) || POKEDEX.find((p) => p.name.toLowerCase().startsWith(name));
        if (!spec) { this.ui.toast(`No Pokémon called "${arg.name}"...`, "bad"); return; }
        const lv = clamp(Math.round(arg.lv || 10), 2, 100);
        const dir = this.lookDir();
        const pos = this.playerPos.clone().addScaledVector(dir, 8);
        pos.y = this.world.height(pos.x, pos.z);
        this.wilds.push(new WildMon(this, makeMon(spec.id, lv), pos));
        this.ui.toast(`A wild ${spec.name} (Lv ${lv}) appeared!`, "good");
        break;
      }
      case "toggle": {
        s.cheats[arg] = !s.cheats[arg];
        const names = { god: "God Mode", ohko: "One-Hit KO", catchall: "100% Catch", infpp: "Infinite PP", speed: "Speed Boost" };
        this.ui.toast(`Cheat: ${names[arg]} ${s.cheats[arg] ? "ON" : "OFF"}`, s.cheats[arg] ? "good" : "");
        break;
      }
      case "weather": {
        this.world.setWeather(arg, true);
        this.ui.toast(`Cheat: weather → ${arg}`, "good");
        break;
      }
      case "rocket": {
        if (this.rocketAmbush(true)) this.ui.toast("Cheat: Team Rocket incoming!", "good");
        else this.ui.toast("They couldn't find you here...", "bad");
        break;
      }
      case "happy": {
        for (const m of s.party) m.hap = 255;
        this.ui.toast("Cheat: party maxed on happiness", "good");
        break;
      }
      default: return;
    }
    this.audio.play("ui");
    this.ui.updateHUD(); this.ui.updateParty();
    this.save();
  }

  // ----------------------------------------------------------------- debug
  makeDebug() {
    const g = this;
    return {
      game: g,
      give(k, n = 5) { g.state.items[k] = (g.state.items[k] || 0) + n; g.ui.updateHUD(); },
      money(n = 5000) { g.state.money += n; g.ui.updateHUD(); },
      tl(n) { g.state.tl = n; g.ui.updateHUD(); },
      time(t) { g.world.timeOfDay = t; },
      cheat(action, arg) { g.cheat(action, arg); },
      badges() { g.cheat("badges"); },
      tp(name) {
        const c = Game.CHEAT_TPS[name];
        const p = g.world.spots[name] || (c && V3(c[0], 0, c[1]));
        if (p) { g.playerPos.set(p.x, g.world.height(p.x, p.z) + 1, p.z); }
      },
      zone() { return g.world.zoneAt(g.playerPos.x, g.playerPos.z); },
      hab(sp) { return habitatFor(sp); },
      spawn(sp, lv = 10) {
        const dir = g.lookDir();
        const pos = g.playerPos.clone().addScaledVector(dir, 8);
        pos.y = g.world.height(pos.x, pos.z);
        const w = new WildMon(g, makeMon(sp, lv), pos);
        g.wilds.push(w);
        return w;
      },
      battle(sp, lv = 10) { const w = this.spawn(sp, lv); g.startWildBattle(w); return w; },
      style(s) { g.state.settings.style = s; g.save(); },
      energy(side = "ally", n = 100) { if (g.battle) g.battle.energy[side] = clamp(n, 0, BALANCE.energy.max); },
      stamina(side = "ally", n = 100) { if (g.battle) g.battle.stamina[side] = clamp(n, 0, BALANCE.stamina.max); },
      addmon(sp, lv = 20) { const m = makeMon(sp, lv); g.markCaught(sp); g.giveMon(m); g.ui.updateParty(); return m; },
      xp(n = 1000) { const m = g.activeMon(); if (m) g.handleXp(m, n); },
      heal() { g.healParty(); },
      weather(w) { g.world.setWeather(w, true); },
      rocket() { return g.rocketAmbush(true); },
      fish() { const s = g.world.fishSpot(g.playerPos, g.lookDir()); if (s) g.startFishing(s); return !!s; },
      happy(n = 255) { for (const m of g.state.party) m.hap = n; },
      // ---- story/boot helpers (and the e2e fast lane past the title screen)
      newGame(name = "Red", rival = "Blue") {
        g.state.name = name; g.state.rival = rival;
        g.applyRivalName();
        g.skipIntro = true;
        g.ui.hideTitle();
        g.ui.showStarter();
      },
      enter() { g.enterWorld(); },
      intro() { g.ui.hideTitle(); g.newGameFlow(); },
      rival(stage = 1) { g.state.story.rivalDue = stage; g.rivalAmbush(); },
      gram() { g.ui.openGram(); },
    };
  }
}
