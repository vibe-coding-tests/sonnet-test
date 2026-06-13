// All DOM UI: HUD, toasts, world-anchored floaters/HP bars, minimap, dialogs,
// and the modal screens (starter, Pokedex, bag, party, PC storage, shop,
// battle switch, move learning, pause/settings).
import * as THREE from "three";
import { DEX, MOVES, TYPE_COLORS, TYPE_CHART, spriteURL, POKEDEX } from "./data.js";
import { ITEMS, monName, xpForLevel, BADGE_META, Game, speciesSkill, SKILL_LABEL, habitatFor, currentSlot, setSlot, slotStorageKey, slotMeta, fmtPlaytime, MOVE_ACTIONS, KEYBIND_GROUPS, KEYBIND_ACTIONS, keyLabel } from "./game.js";

const $ = (id): any => document.getElementById(id);
const el = (tag, cls?, html?): any => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const chip = (t) => `<span class="tchip" style="background:${TYPE_COLORS[t]}">${t}</span>`;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class UI {
  audio: any;
  game: any;
  world: any;
  camera: any;
  floaters: any[];
  wbars: any[];
  modalStack: string[];
  dialogActive: any;
  battle: any;
  promptT: number;
  minimapT: number;
  switchForced: boolean;
  _dlgResolve: any;
  _switchResolve: any = null;
  _learnResolve: any = null;
  _confirmResolve: any = null;
  bannerT: any = null;
  // v9: title screen + name entry + PokéGram
  titleActive = false;
  _nameResolve: any = null;
  gramCount = 0;          // posts generated this phone session
  gramScrolled = 0;       // lifetime scrolled posts (the shame counter)
  rebinding: string | null = null;

  constructor(audio) {
    this.audio = audio;
    this.floaters = [];
    this.wbars = [];
    this.modalStack = [];
    this.dialogActive = null;
    this.battle = null;
    this.promptT = 0;
    this.minimapT = 0;
    this._dlgResolve = null;
    this.switchForced = false;
    document.querySelectorAll(".modal [data-close]").forEach((b) =>
      b.addEventListener("click", () => this.closeTop()));
    $("btnResume").addEventListener("click", () => this.closeTop());
    $("btnReset").addEventListener("click", async () => {
      if (await this.confirm("Delete ALL save data and restart from scratch?")) this.game.resetSave();
    });
    $("btnTitle").addEventListener("click", async () => {
      if (!(await this.confirm("Return to the main menu? Your progress is saved."))) return;
      this.game.save();                 // persist before we leave
      this.game.resetting = true;       // skip the beforeunload re-save
      // no "proceed" flag → the freshly-booted game lands on the title screen
      try { sessionStorage.removeItem("kanto_proceed"); } catch (e) { /* fine */ }
      location.reload();
    });
    $("setVol").addEventListener("input", (e: any) => {
      this.game.state.settings.vol = +e.target.value;
      this.audio.setVolume(+e.target.value / 100);
    });
    $("setSens").addEventListener("input", (e: any) => {
      this.game.state.settings.sens = +e.target.value;
    });
    $("setAI").addEventListener("change", (e: any) => {
      this.game.state.settings.ai = e.target.value;
      this.game.save();
      this.toast(`Opponent AI: ${e.target.options[e.target.selectedIndex].text.split("—")[0].trim()}`, "");
    });
    $("setStyle").addEventListener("change", (e: any) => {
      this.game.state.settings.style = e.target.value;
      this.game.save();
      const label = e.target.options[e.target.selectedIndex].text.split("—")[0].trim();
      this.toast(this.game.battle ? `Battle style: ${label} — starts with your next battle.` : `Battle style: ${label}`, "good");
    });
    $("setFollowers").addEventListener("change", (e: any) => {
      this.game.state.settings.followers = e.target.value === "on";
      this.game.syncFollower();
      this.game.save();
      this.toast(this.game.state.settings.followers ? "Your partner will walk with you." : "Your Pokémon will stay in their Balls.", "");
    });
    $("setExpShare").addEventListener("change", (e: any) => {
      this.game.state.settings.expShare = e.target.value === "on";
      this.game.save();
      this.toast(this.game.state.settings.expShare ? "Exp. Share on — the whole party grows." : "Exp. Share off — only the battler earns XP.", "");
    });
    $("btnSwitch").addEventListener("click", () => this.game.onKey(["switchMenu"]));
    $("btnRun").addEventListener("click", () => this.game.onKey(["flee"]));
    $("btnDodge")?.addEventListener("click", () => this.game.battle?.tryDodge());
    $("btnPossess")?.addEventListener("click", () => this.game.battle?.togglePossess());
    $("btnMode")?.addEventListener("click", () => this.game.battle?.cycleStyle());
    $("btnBall")?.addEventListener("click", () => this.game.quickBall());
    $("btnHeal")?.addEventListener("click", () => this.game.quickHeal());
    $("btnGram").addEventListener("click", () => { this.hide("m-pause"); this.openGram(); });
    $("btnCheats").addEventListener("click", () => this.openCheats());
    $("btnKeysReset")?.addEventListener("click", () => {
      this.game.resetKeybinds();
      this.rebinding = null;
      this.applySettings();
      this.toast("Keybinds reset to defaults.", "good");
    });
    // name entry: OK button / Enter key confirm
    $("nameok").addEventListener("click", () => this.confirmName());
    $("nameinput").addEventListener("keydown", (e: any) => { if (e.key === "Enter") this.confirmName(); e.stopPropagation(); });
    // the feed refills itself as you approach the bottom. of course it does.
    $("gramfeed").addEventListener("scroll", () => {
      const f = $("gramfeed");
      if (f.scrollTop + f.clientHeight > f.scrollHeight - 220) this.gramMore(4);
      this.gramScrolled++;
    });
    $("cheattpgo").addEventListener("click", () => { this.game.cheat("tp", $("cheattp").value); this.closeAll(); });
    $("cheatspgo").addEventListener("click", () => {
      this.game.cheat("spawn", { name: $("cheatspname").value, lv: +$("cheatsplv").value });
      this.closeAll();
    });
    $("dialog").addEventListener("click", () => this.dialogAdvance());
  }
  attach(game, world, camera) {
    this.game = game; this.world = world; this.camera = camera;
    this.applySettings();
  }
  applySettings() {
    const s = this.game.state.settings;
    $("setVol").value = s.vol;
    $("setSens").value = s.sens;
    $("setAI").value = s.ai || "adaptive";
    $("setStyle").value = s.style || "fp";
    $("setFollowers").value = s.followers === false ? "off" : "on";
    $("setExpShare").value = s.expShare === false ? "off" : "on";
    this.audio.setVolume(s.vol / 100);
    this.renderKeybinds();
    this.updateKeyLabels();
  }
  get modalOpen() { return this.modalStack.length > 0; }
  get blocking() { return this.modalOpen || !!this.dialogActive || this.titleActive; }

  keyText(action: string) { return this.game?.keyLabel?.(action) || keyLabel(""); }
  kbd(action: string) { return `<span class="kbd">${esc(this.keyText(action))}</span>`; }
  moveKeyList() { return MOVE_ACTIONS.map((a) => this.keyText(a)).join(" / "); }
  updateKeyLabels() {
    if (!this.game) return;
    const moveKeys = ["moveForward", "moveBackward", "moveLeft", "moveRight"].map((a) => this.keyText(a)).join(" / ");
    $("hint").innerHTML = `
      ${this.kbd("moveForward")}${this.kbd("moveBackward")}${this.kbd("moveLeft")}${this.kbd("moveRight")} move &nbsp;${this.kbd("run")} run &nbsp;${this.kbd("jumpDodge")} jump<br>
      Click/${this.kbd("throwBall")} throw &nbsp;<b>Hold</b> aim &nbsp;${this.kbd("battle")} battle &nbsp;${this.kbd("interact")} interact<br>
      ${this.kbd("vehicle")} ride &nbsp;${this.kbd("flashlight")} light &nbsp;${this.kbd("dex")} dex ${this.kbd("party")} party ${this.kbd("bag")} bag ${this.kbd("menu")} menu`;
    $("dlgnext").textContent = `${this.keyText("interact")} / click to continue`;
    $("titlefoot").innerHTML = `progress auto-saves to your browser · three save files, RBY rules<br>${esc(moveKeys)} to walk · ${esc(this.keyText("run"))} to run · hold click to aim a Ball`;
  }
  renderKeybinds() {
    const wrap = $("keybindsList");
    if (!wrap || !this.game) return;
    wrap.innerHTML = "";
    const binds = this.game.keybinds();
    for (const group of KEYBIND_GROUPS as any[]) {
      const box = el("div", "keygroup", `<b>${esc(group.name)}</b>`);
      for (const [id, label] of group.actions) {
        const row = el("div", `keyrow${this.rebinding === id ? " listening" : ""}`, `
          <span>${esc(label)}</span>
          <button data-bind="${esc(id)}">${this.rebinding === id ? "Press a key..." : esc(keyLabel(binds[id]))}</button>`);
        row.querySelector("button").addEventListener("click", () => {
          this.rebinding = this.rebinding === id ? null : id;
          this.renderKeybinds();
        });
        box.appendChild(row);
      }
      wrap.appendChild(box);
    }
  }
  captureKeybind(code: string, key = "") {
    if (!this.rebinding) return false;
    const action = this.rebinding;
    const group = (KEYBIND_GROUPS as any[]).find((g) => g.actions.some(([id]) => id === action));
    const sharedDefaults = [["interact", "move2"], ["battle", "move4"], ["dex", "switchMenu"]];
    const canShare = (a, b) => sharedDefaults.some(([x, y]) => (a === x && b === y) || (a === y && b === x));
    const conflict = (KEYBIND_ACTIONS as any[]).find((a) => a.id !== action && this.game.keyCode(a.id) === code && !canShare(a.id, action));
    if (conflict) {
      this.toast(`${keyLabel(code)} is already used for ${conflict.label}.`, "bad");
      return true;
    }
    this.game.setKeybind(action, code);
    this.rebinding = null;
    this.renderKeybinds();
    this.updateKeyLabels();
    if (this.battle) this.setBattle(this.battle);
    this.toast(`${group?.actions.find(([id]) => id === action)?.[1] || "Keybind"} set to ${keyLabel(code)}.`, "good");
    return true;
  }

  // ------------------------------------------------------------- modals
  show(id) {
    // any menu is trainer business — slide out of the Pokémon first
    if (this.game?.battle?.possessed) this.game.battle.autoEject();
    $(id).classList.remove("hidden");
    if (!this.modalStack.includes(id)) this.modalStack.push(id);
    document.exitPointerLock?.();
    this.audio.play("ui");
  }
  hide(id) {
    $(id).classList.add("hidden");
    this.modalStack = this.modalStack.filter((m) => m !== id);
  }
  closeTop() {
    const top = this.modalStack[this.modalStack.length - 1];
    if (!top) return false;
    if (top === "m-starter") return true;                      // must choose a starter
    if (top === "m-name") return true;                         // a hero needs a name
    if (top === "m-switch" && this.switchForced) return true;  // must choose
    if (top === "m-switch" && this._switchResolve) { this._switchResolve(null); this._switchResolve = null; }
    if (top === "m-learn" && this._learnResolve) { this._learnResolve(-1); this._learnResolve = null; }
    if (top === "m-confirm" && this._confirmResolve) { this._confirmResolve(false); this._confirmResolve = null; }
    this.hide(top);
    return true;
  }
  closeAll() { while (this.modalStack.length) this.hide(this.modalStack[this.modalStack.length - 1]); }

  onKey(actions, k = "", code = "") {
    const has = (id) => actions?.includes?.(id);
    if (this.titleActive) return true;                         // title screen is mouse-only
    if (this.dialogActive) {
      if (has("interact") || has("jumpDodge") || k === "enter") { this.dialogAdvance(); return true; }
      if (has("menu") || k === "escape") return true;
      return true;
    }
    if (this.modalOpen) {
      const top = this.modalStack[this.modalStack.length - 1];
      if (this.rebinding && top === "m-pause") return this.captureKeybind(code, k);
      if (has("menu") || k === "escape" || (has("dex") && top === "m-dex") || (has("bag") && top === "m-bag") || (has("party") && top === "m-party")) {
        this.closeTop();
        return true;
      }
      return true; // swallow keys while modal open
    }
    if (!this.game.state.started) return true;
    // mid-battle the menu keys hand over to the battle controls: Tab switches
    // your Pokémon, I still opens the full bag, the rest waits for the overworld
    if (this.game.battle) {
      if (has("bag")) { this.openBag(); return true; }
      if (has("menu")) { this.openPause(); return true; }
      return false;
    }
    if (has("dex")) { this.openDex(); return true; }
    if (has("bag")) { this.openBag(); return true; }
    if (has("party")) { this.openParty(); return true; }
    if (has("menu")) { this.openPause(); return true; }
    return false;
  }

  // ------------------------------------------------------------- toasts
  toast(msg, cls = "") {
    const t = el("div", `toast ${cls}`, esc(msg));
    $("toasts").appendChild(t);
    while ($("toasts").children.length > 5) $("toasts").firstChild.remove();
    setTimeout(() => { t.style.opacity = "0"; t.style.transition = "opacity .4s"; }, 3200);
    setTimeout(() => t.remove(), 3700);
  }
  floatAt(pos3, text, cls = "dmg") {
    const e = el("div", `floater ${cls}`, esc(text));
    $("floaters").appendChild(e);
    this.floaters.push({ pos: pos3.clone(), e, t: 0, drift: Math.random() * 40 - 20 });
    setTimeout(() => e.remove(), 950);
  }
  project(v3) {
    const v = v3.clone().project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight, vis: v.z < 1 && Math.abs(v.x) < 1.3 && Math.abs(v.y) < 1.3 };
  }

  // --------------------------------------------------------------- HUD
  updateHUD() {
    const s = this.game.state;
    $("money").textContent = `₽${s.money.toLocaleString()}`;
    $("tlevel").textContent = `${s.name ? s.name + " · " : ""}Trainer Lv ${s.tl}`;
    const need = 70 + (s.tl - 1) * 45;
    $("tlxp").style.width = `${clamp((s.txp / need) * 100, 0, 100)}%`;
    const bt = this.game.ballType();
    if (bt) {
      $("ballicon").className = `ballicon ${bt.replace("ball", "")}`;
      $("ballname").textContent = `${ITEMS[bt].name} ×${s.items[bt]}`;
    } else $("ballname").textContent = "No Balls!";
    const bd = $("badges");
    if (s.badges.length) {
      bd.innerHTML = s.badges.map((b) => {
        const meta = BADGE_META[b] || { name: b, color: "#ffcc33" };
        return `<span class="badge" title="${esc(meta.name)}" style="background:radial-gradient(circle at 35% 35%, #fff8, ${meta.color})"></span>`;
      }).join("");
    } else bd.innerHTML = `<span class="small">none yet</span>`;
    // active field effects
    const fx = [];
    if (s.vehicle === "bike") fx.push("On the Bicycle (V)");
    if (s.vehicle === "truck") fx.push("Driving the truck (V)");
    if (s.repelT > 0) fx.push(`Repel ${Math.ceil(s.repelT)}s`);
    if (s.lureT > 0) fx.push(`Lure ${Math.ceil(s.lureT)}s`);
    const fxEl = $("fieldfx");
    if (fxEl) { fxEl.textContent = fx.join(" · "); fxEl.classList.toggle("hidden", !fx.length); }
  }
  xpFrac(m) {
    if (m.lv >= 100) return 1;
    const lo = xpForLevel(m.sp, m.lv), hi = xpForLevel(m.sp, m.lv + 1);
    return clamp((m.xp - lo) / Math.max(1, hi - lo), 0, 1);
  }
  hpClass(m) { const f = m.hp / m.maxhp; return f < 0.25 ? "low" : f < 0.55 ? "mid" : ""; }
  updateParty() {
    const s = this.game.state;
    const wrap = $("partyStrip");
    wrap.innerHTML = "";
    s.party.forEach((m, i) => {
      const lead = this.game.activeMon() === m;
      const d = el("div", `pslot${lead ? " active" : ""}${m.hp <= 0 ? " fainted" : ""}`, `
        <span class="slotkey">${i + 1}</span>
        <img class="px" src="${spriteURL(m.sp)}" alt="">
        <div class="bars">
          <div class="nm"><span>${esc(monName(m))}</span><span>Lv ${m.lv}</span></div>
          <div class="hpbar"><div class="${this.hpClass(m)}" style="width:${(m.hp / m.maxhp) * 100}%"></div></div>
          <div class="xpbar"><div style="width:${this.xpFrac(m) * 100}%"></div></div>
        </div>`);
      wrap.appendChild(d);
    });
    this.updateHUD();
  }

  // ------------------------------------------------------- frame update
  updateFrame(dt) {
    // cinematic shots (title orbit / Oak's intro) get a clean frame — no HUD
    const cinematic = this.titleActive || !!this.game?.introCam;
    const hud = $("hud");
    if (hud.style.visibility !== (cinematic ? "hidden" : "")) hud.style.visibility = cinematic ? "hidden" : "";
    // the overworld key legend yields the corner once a battle owns the keys
    $("hint").classList.toggle("hidden", !!this.battle);
    // floaters
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.t += dt;
      if (f.t > 0.95) { this.floaters.splice(i, 1); continue; }
      const p = this.project(f.pos);
      f.e.style.left = `${p.x + f.drift * f.t}px`;
      f.e.style.top = `${p.y}px`;
      f.e.style.display = p.vis ? "" : "none";
    }
    // world hp bars
    for (const b of this.wbars) {
      if (!b.ent || b.ent.dead) { b.e.style.display = "none"; continue; }
      const p = this.project(b.ent.pos().add(new THREE.Vector3(0, b.ent.halfH + 0.5, 0)));
      b.e.style.display = p.vis ? "" : "none";
      b.e.style.left = `${p.x}px`; b.e.style.top = `${p.y}px`;
      const m = b.ent.mon;
      b.hp.style.width = `${(m.hp / m.maxhp) * 100}%`;
      b.hp.className = this.hpClass(m);
      b.lv.textContent = `Lv ${m.lv}`;
    }
    // battle cooldowns
    if (this.battle && !this.battle.over) {
      const b = this.battle;
      const classic = b.style === "classic";
      const btns = $("movebtns").children;
      for (let i = 0; i < btns.length; i++) {
        const cd = Math.max(0, b.cds.ally[i]);
        const mv = MOVES[b.allyMon.moves[i]];
        if (!mv) continue;
        const max = b.cdFor("ally", mv);
        const role = b.moveRole?.(mv) || "skill";
        const energyShort = !classic && role === "burst" && b.energy.ally < b.energyCostFor(mv);
        const pp = b.allyMon.pp?.[i] ?? mv.pp;
        const ppEl = btns[i].querySelector(".pp");
        if (ppEl) {
          ppEl.textContent = `PP ${pp}`;
          ppEl.style.color = pp <= 0 ? "var(--red)" : pp <= 5 ? "#ffc23d" : "";
        }
        btns[i].classList.toggle("disabled", pp <= 0 || energyShort);
        btns[i].classList.toggle("far", b.rangeState(i) === "far");   // possessed: contact moves out of reach
        btns[i].querySelector(".cd").style.height = classic || role === "burst" ? "0%" : `${clamp((cd / max) * 100, 0, 100)}%`;
        const cdText = btns[i].querySelector(".cdtext");
        if (cdText) cdText.textContent = classic ? "" : cd > 0 ? `${cd.toFixed(1)}s` : energyShort ? `ENE ${Math.ceil(b.energy.ally)}%` : role === "burst" ? "BURST" : "";
        btns[i].classList.toggle("ready", classic ? (b.turnPhase === "player" && pp > 0) : (cd <= 0 && b.lock.ally <= 0 && pp > 0 && !energyShort));
      }
      const em = b.enemy();
      $("ename").textContent = monName(em);
      $("elv").textContent = `Lv ${em.lv}`;
      $("ehp").style.width = `${(em.hp / em.maxhp) * 100}%`;
      $("ehp").className = this.hpClass(em);
      // dodge button: lit while an attack is incoming and the command is ready.
      // possessed, it becomes your dash gauge. Classic has no dodge at all.
      const dBtn = $("btnDodge");
      if (dBtn) {
        dBtn.style.display = classic ? "none" : "";
        if (b.possessed) {
          const cdLeft = Math.max(0, b.dashCd);
          const tired = b.stamina.ally < 34;
          const verb = SKILL_LABEL[speciesSkill(b.allyMon.sp)];
          dBtn.classList.toggle("hot", cdLeft <= 0 && !tired && b.incoming && b.incoming.t > 0);
          dBtn.classList.toggle("disabled", cdLeft > 0 || tired);
          dBtn.innerHTML = cdLeft > 0 ? `${verb} <small>${cdLeft.toFixed(1)}s</small> ${this.kbd("jumpDodge")}` : tired ? `${verb} <small>tired</small> ${this.kbd("jumpDodge")}` : `${verb} ${this.kbd("jumpDodge")}`;
        } else {
          const tired = b.stamina.ally < 34;
          const hot = b.incoming && b.incoming.t > 0 && b.dodgeCd <= 0 && !tired;
          dBtn.classList.toggle("hot", !!hot);
          dBtn.classList.toggle("disabled", b.dodgeCd > 0 || tired);
          dBtn.innerHTML = b.dodgeCd > 0 ? `Dodge <small>${Math.ceil(b.dodgeCd)}s</small> ${this.kbd("jumpDodge")}` : tired ? `Dodge <small>tired</small> ${this.kbd("jumpDodge")}` : `Dodge ${this.kbd("jumpDodge")}`;
        }
      }
      // mode toggle: show the current battle mode so the player knows what Y does
      const mBtn = $("btnMode");
      if (mBtn) {
        const short = b.style === "classic" ? "Turn-based" : b.style === "fp" ? "First-Person" : "Real-time";
        mBtn.innerHTML = `${short} ${this.kbd("battleStyle")}`;
      }
      // status line: possession controls in fp, turn prompts in classic
      const posBar = $("possessbar");
      if (posBar) {
        // live aim readout — moving sprays your shots, planting lands them true
        const meterTag = (cls, label, val) => `<span class="rtmeter ${cls}">${label} <span class="bar"><i style="width:${clamp(val, 0, 100)}%"></i></span><b>${Math.round(val)}</b></span>`;
        const meters = classic ? "" : `${meterTag("energy", "ENE", b.energy.ally)} ${meterTag("stamina", "STA", b.stamina.ally)}`;
        const aimTag = () => {
          const s = b.aimSteadiness("ally");
          return s > 0.82 ? `<b style="color:#6bf78f">AIM&nbsp;STEADY</b>`
            : s > 0.38 ? `<b style="color:#ffc23d">AIM&nbsp;WAVERING</b>`
            : `<b style="color:#ff6b6b">AIM&nbsp;WILD</b>`;
        };
        if (classic) {
          posBar.classList.remove("hidden");
          posBar.innerHTML = b.turnPhase === "player" ? `<b>Your move</b> — pick an attack (${esc(this.moveKeyList())}), throw, switch or run` : `…`;
        } else if (b.style === "fp") {
          posBar.classList.remove("hidden");
          if (b.possessed) {
            posBar.innerHTML = `Playing as <b>${esc(monName(b.allyMon))}</b> · ${meters} · ${aimTag()} — plant to fire true · ${this.kbd("jumpDodge")} dash · ${this.kbd("possess")} trainer`;
          } else {
            posBar.innerHTML = `${meters} · ${this.kbd("possess")} take control of ${esc(monName(b.allyMon))}`;
          }
        } else if (b.style === "arena") {
          posBar.classList.remove("hidden");
          posBar.innerHTML = `${meters} · ${this.kbd("moveForward")}${this.kbd("moveBackward")}${this.kbd("moveLeft")}${this.kbd("moveRight")} move · ${this.kbd("jumpDodge")} dodge · <b>${esc(this.moveKeyList())}</b> attack · ${aimTag()} — stand still to fire true, use cover`;
        } else posBar.classList.add("hidden");
      }
      const pBtn = $("btnPossess");
      if (pBtn) {
        pBtn.style.display = b.style === "fp" ? "" : "none";
        pBtn.innerHTML = b.possessed ? `Trainer ${this.kbd("possess")}` : `Take Over ${this.kbd("possess")}`;
      }
      // quick-slot buttons mirror what G and Z will actually do right now
      const ballBtn = $("btnBall");
      if (ballBtn) {
        const bt = this.game.ballType();
        const blocked = b.type === "trainer" || !bt;
        ballBtn.classList.toggle("disabled", blocked);
        ballBtn.innerHTML = `${bt ? `${esc(ITEMS[bt].name)} ×${this.game.state.items[bt]}` : "No Balls"} ${this.kbd("throwBall")}`;
      }
      const healBtn = $("btnHeal");
      if (healBtn) {
        const heals = ["oranberry", "potion", "superpotion"].reduce((n, k) => n + (this.game.state.items[k] || 0), 0);
        healBtn.classList.toggle("disabled", heals <= 0);
        healBtn.innerHTML = `Heal ×${heals} ${this.kbd("quickHeal")}`;
      }
      // incoming attack telegraph
      const tele = $("telegraph");
      if (tele) {
        if (b.incoming && b.incoming.t > 0) {
          tele.classList.remove("hidden");
          tele.querySelector("div").style.width = `${clamp((b.incoming.t / b.incoming.max) * 100, 0, 100)}%`;
          if (b.incoming.dir) {
            const x = b.incoming.dir.x, z = b.incoming.dir.z;
            const dir = Math.abs(x) > Math.abs(z) ? (x > 0 ? "right" : "left") : (z > 0 ? "back" : "front");
            tele.title = `Incoming from ${dir}`;
            tele.dataset.dir = dir;
          }
        } else { tele.classList.add("hidden"); tele.dataset.dir = ""; }
      }
      if (b.counterT > 0) $("counterhint")?.classList.remove("hidden");
      else $("counterhint")?.classList.add("hidden");
    }
    // aim charge meter
    const am = $("aimmeter");
    if (am) {
      if (this.game.aim) {
        am.classList.remove("hidden");
        $("aimhint").classList.remove("hidden");
        am.querySelector("div").style.width = `${this.game.aim.charge * 100}%`;
      } else { am.classList.add("hidden"); $("aimhint").classList.add("hidden"); }
    }
    // prompt + nameplate (throttled)
    this.promptT -= dt;
    if (this.promptT <= 0) {
      this.promptT = 0.2;
      const g = this.game;
      if (!g.state.started || this.blocking) { $("prompt").classList.add("hidden"); }
      else if (!g.battle) {
        const it = g.nearestInteract();
        if (it) {
          $("prompt").innerHTML = `Press ${this.kbd("interact")} to ${esc(it.label)}`;
          $("prompt").classList.remove("hidden");
        } else $("prompt").classList.add("hidden");
      } else $("prompt").classList.add("hidden");
      const t = g.target;
      if (t && !t.dead && !g.aim) {
        const m = t.mon, spec = DEX[m.sp];
        $("nameplate").innerHTML = `<b>${esc(spec.name)}</b> Lv ${m.lv} &nbsp;<span class="small">${Math.ceil(m.hp)}/${m.maxhp} HP · ${esc(spec.rarity)}</span><br>
          <span class="small">tap/${esc(this.keyText("throwBall"))}: throw ${esc(ITEMS[this.game.ballType() || "pokeball"].name)} · hold: aim · ${esc(this.keyText("battle"))}: battle</span>`;
        $("nameplate").classList.remove("hidden");
        $("crosshair").classList.add("active");
      } else {
        $("nameplate").classList.add("hidden");
        $("crosshair").classList.toggle("active", !!(t && !t.dead));
      }
    }
    // minimap
    this.minimapT -= dt;
    if (this.minimapT <= 0) { this.minimapT = 0.15; this.drawMinimap(); }
  }
  drawMinimap() {
    const cv = $("minimap"), ctx = cv.getContext("2d");
    const N = cv.width;
    ctx.clearRect(0, 0, N, N);
    ctx.drawImage(this.world.minimapCanvas, 0, 0, N, N);
    const g = this.game;
    // legendary spots discovered
    ctx.fillStyle = "#ffd23d";
    ctx.font = "bold 10px Verdana";
    for (const name of g.state.spotsFound) {
      const p = this.world.spots[name];
      const [u, v] = this.world.worldToMap(p.x, p.z, N);
      ctx.fillText("?", u - 3, v + 3);
    }
    // player arrow
    const [px, py] = this.world.worldToMap(g.playerPos.x, g.playerPos.z, N);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(-g.playerYaw);
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = "#000";
    ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(4.5, 5); ctx.lineTo(-4.5, 5); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
    ctx.fillStyle = "#fff"; ctx.font = "bold 11px Verdana";
    ctx.fillText("N", N / 2 - 4, 12);
    $("zonetxt").textContent = this.world.zoneName(this.world.zoneAt(g.playerPos.x, g.playerPos.z));
    $("clocktxt").textContent = this.world.phaseName();
    $("clockicon").style.background = this.world.isNight() ? "#9db4e8" : "#ffcc33";
    const w = $("weathertxt");
    if (w) {
      const info = this.world.weatherInfo();
      w.textContent = `${info.icon} ${info.label}`;
    }
  }
  // big center banner for catch moments ("Gotcha!")
  catchBanner(text) {
    const b = $("catchbanner");
    if (!b) return;
    b.textContent = text;
    b.classList.remove("hidden");
    b.classList.remove("pop");
    void b.offsetWidth;     // restart the CSS animation
    b.classList.add("pop");
    clearTimeout(this.bannerT);
    this.bannerT = setTimeout(() => b.classList.add("hidden"), 1700);
  }
  // crosshair hitmarker — your possessed shot/strike connected
  hitmarker(strong = false) {
    const h = $("hitmark");
    if (!h) return;
    h.classList.toggle("strong", strong);
    h.classList.remove("pop");
    void h.offsetWidth;
    h.classList.add("pop");
  }
  // red edge flash — your possessed Pokémon just ate a hit
  hurtFlash() {
    const f = $("hurtflash");
    if (!f) return;
    f.classList.remove("pop");
    void f.offsetWidth;
    f.classList.add("pop");
  }

  // -------------------------------------------------------------- dialog
  dialog(name, lines, buttons = null) {
    return new Promise((res) => {
      this.dialogActive = { name, lines: [...lines], buttons, idx: 0 };
      this._dlgResolve = res;
      $("dialog").classList.remove("hidden");
      document.exitPointerLock?.();
      this.renderDialog();
    });
  }
  // dialog lines may carry {player}/{rival} tokens — every speaker knows you
  storyFmt(t: string) {
    const s = this.game?.state;
    return String(t)
      .replace(/\{player\}/g, s?.name || "kid")
      .replace(/\{rival\}/g, s?.rival || "your rival");
  }
  renderDialog() {
    const d = this.dialogActive;
    $("dlgname").textContent = this.storyFmt(d.name);
    $("dlgtext").textContent = this.storyFmt(d.lines[d.idx]);
    const last = d.idx === d.lines.length - 1;
    const btns = $("dlgbtns");
    if (last && d.buttons) {
      btns.classList.remove("hidden");
      $("dlgnext").classList.add("hidden");
      btns.innerHTML = "";
      d.buttons.forEach((b, i) => {
        const bt = el("button", i === 0 ? "primary" : "", esc(b));
        bt.addEventListener("click", (ev) => { ev.stopPropagation(); this.endDialog(i); });
        btns.appendChild(bt);
      });
    } else {
      btns.classList.add("hidden");
      $("dlgnext").classList.remove("hidden");
    }
    this.audio.play("ui");
  }
  dialogAdvance() {
    const d = this.dialogActive;
    if (!d) return;
    const last = d.idx === d.lines.length - 1;
    if (last) {
      if (!d.buttons) this.endDialog(null);
      return; // buttons: must click
    }
    d.idx++;
    this.renderDialog();
  }
  endDialog(result) {
    $("dialog").classList.add("hidden");
    this.dialogActive = null;
    const r = this._dlgResolve; this._dlgResolve = null;
    if (r) r(result);
  }
  confirm(text) {
    return new Promise((res) => {
      $("confirmtext").textContent = text;
      this._confirmResolve = res;
      this.show("m-confirm");
      $("confirmyes").onclick = () => { this._confirmResolve = null; this.hide("m-confirm"); res(true); };
      $("confirmno").onclick = () => { this._confirmResolve = null; this.hide("m-confirm"); res(false); };
    });
  }
  fadeOut(text = null, dur = 0.8) {
    return new Promise<void>((res) => {
      const f = $("fade");
      f.style.transition = `opacity ${dur}s`;
      f.style.opacity = "1";
      if (text) {
        f.style.display = "flex"; f.style.alignItems = "center"; f.style.justifyContent = "center";
        f.style.color = "#fff"; f.style.fontSize = "22px"; f.textContent = text;
      }
      setTimeout(() => {
        res();
        setTimeout(() => { f.style.opacity = "0"; f.textContent = ""; }, 500);
      }, dur * 1000 + 150);
    });
  }

  // ------------------------------------------------------------- starter
  showStarter() {
    const row = $("starterRow");
    row.innerHTML = "";
    for (const sp of [1, 4, 7]) {
      const d = DEX[sp];
      const c = el("div", "startercard", `
        <img class="px" src="${spriteURL(sp)}" alt="${esc(d.name)}">
        <b>${esc(d.name)}</b>
        <div>${d.types.map(chip).join("")}</div>
        <small>${d.types[0] === "grass" ? "calm & reliable" : d.types[0] === "fire" ? "bold & fiery" : "steady & cool"}</small>`);
      c.addEventListener("click", () => {
        this.audio.ensure();
        this.hide("m-starter");
        this.game.chooseStarter(sp);
      });
      row.appendChild(c);
    }
    this.show("m-starter");
  }

  // ------------------------------------------------------------- pokedex
  openDex() {
    const g = this.game;
    const grid = $("dexgrid");
    grid.innerHTML = "";
    let caught = 0;
    for (const p of POKEDEX) {
      const isC = g.dexCaught.has(p.id), isS = g.dexSeen.has(p.id);
      if (isC) caught++;
      const cell = el("div", `dexcell ${isC ? "caught" : isS ? "seen" : "unknown"}`);
      cell.innerHTML = isC || isS ? `<img class="px" src="${spriteURL(p.id)}" loading="lazy"><span class="no">${p.id}</span>` : `???<span class="no">${p.id}</span>`;
      if (isC || isS) cell.addEventListener("click", () => this.dexDetail(p, isC));
      grid.appendChild(cell);
    }
    $("dexpct").textContent = `${caught} / ${POKEDEX.length} caught (${Math.round((caught / POKEDEX.length) * 100)}%) · ${g.dexSeen.size} seen`;
    $("dexdetail").innerHTML = `<p class="small">Select an entry.</p>`;
    this.show("m-dex");
  }
  dexDetail(p, isCaught) {
    const statBar = (label, v) => `
      <div class="statrow"><span>${label}</span><div class="sb"><div style="width:${clamp((v / 160) * 100, 2, 100)}%"></div></div><b style="width:30px;text-align:right">${isCaught ? v : "?"}</b></div>`;
    const evoTxt = (p.evos || []).map((e) => `→ ${DEX[e.to].name} @ Lv ${e.level}`).join("<br>") || "Final form";
    const zones = this.game.zonesFor(p.id);
    const whereTxt = zones && zones.length
      ? `Found: ${zones.slice(0, 4).map(esc).join(", ")}${zones.length > 4 ? "…" : ""}`
      : "Found: very special circumstances...";
    const habTxt = {
      sky: "Lives: on the wing — look up", tree: "Lives: clinging to the trees",
      water: "Lives: in lakes and seas", grass: "Lives: rustling the tall grass",
      ground: "Lives: roaming open ground",
    }[habitatFor(p.id)];
    $("dexdetail").innerHTML = `
      <div style="text-align:center"><img class="px" src="${spriteURL(p.id)}" style="width:110px;height:110px;${isCaught ? "" : "filter:brightness(0)"}"></div>
      <h2 style="margin:4px 0">#${p.id} ${isCaught ? esc(p.name) : "???"}</h2>
      <div>${p.types.map(chip).join("")} <span class="small">${esc(p.rarity)}</span></div>
      <div style="margin-top:8px">
        ${statBar("HP", p.base.hp)}${statBar("Attack", p.base.atk)}${statBar("Defense", p.base.def)}
        ${statBar("Speed", p.base.spe)}${statBar("Special", p.base.spc)}
      </div>
      <div class="small" style="margin-top:8px">Catch rate: ${p.catch} · Height: ${(p.height / 10).toFixed(1)} m<br>${habTxt}<br>${whereTxt}<br>${evoTxt}</div>`;
  }

  // ----------------------------------------------------------------- bag
  openBag() {
    const g = this.game;
    const list = $("baglist");
    $("bagmoney").textContent = `₽${g.state.money.toLocaleString()}`;
    list.innerHTML = "";
    let any = false;
    for (const [key, item] of Object.entries(ITEMS)) {
      const n = g.state.items[key] || 0;
      if (!n) continue;
      any = true;
      const icon = item.ball ? `<span class="ballicon ${key.replace("ball", "")}"></span>` : `<span class="itemicon ${key}"></span>`;
      const row = el("div", "itemrow", `
        <span class="ic">${icon}</span>
        <span class="inf"><b>${esc(item.name)}</b><small>${esc(item.desc)}</small></span>
        <span class="qty">×${n}</span>`);
      const direct = ["repel", "lure", "escaperope", "nugget"].includes(key);
      const btn = el("button", "", item.ball ? "Equip" : "Use");
      btn.addEventListener("click", async () => {
        if (item.ball) {
          const owned = ["pokeball", "greatball", "ultraball"].filter((b) => g.state.items[b] > 0);
          g.ballIdx = Math.max(0, owned.indexOf(key));
          this.toast(`${item.name} equipped for throwing.`, "good");
          this.updateHUD();
        } else if (direct) {
          if (g.useItem(key, -1, !!g.battle)) this.openBag();
        } else {
          const idx = await this.pickParty(item.revive ? "Revive which Pokémon?" : "Heal which Pokémon?", (m) => (item.revive ? m.hp <= 0 : m.hp > 0 && m.hp < m.maxhp));
          if (idx != null) { g.useItem(key, idx, !!g.battle); this.openBag(); }
        }
      });
      row.appendChild(btn);
      list.appendChild(row);
    }
    if (!any) list.innerHTML = `<p class="small">Your bag is empty. Visit the PokéMart!</p>`;
    this.show("m-bag");
  }

  // ---------------------------------------------------------------- shop
  openShop() {
    const g = this.game;
    $("shopmoney").textContent = `₽${g.state.money.toLocaleString()}`;
    const list = $("shoplist");
    list.innerHTML = "";
    for (const [key, item] of Object.entries(ITEMS)) {
      const locked = item.unlock && g.state.tl < item.unlock;
      const icon = item.ball ? `<span class="ballicon ${key.replace("ball", "")}"></span>` : `<span class="itemicon ${key}"></span>`;
      const row = el("div", "itemrow", `
        <span class="ic" style="${locked ? "opacity:.3" : ""}">${icon}</span>
        <span class="inf" style="${locked ? "opacity:.45" : ""}"><b>${esc(item.name)} — ₽${item.price}</b>
        <small>${locked ? `Unlocks at Trainer Lv ${item.unlock}` : esc(item.desc)} · owned ×${g.state.items[key] || 0}</small></span>`);
      if (!locked) {
        const b1 = el("button", "", "Buy 1");
        const b5 = el("button", "", "Buy 5");
        b1.addEventListener("click", () => { g.buyItem(key, 1); this.openShop(); });
        b5.addEventListener("click", () => { g.buyItem(key, 5); this.openShop(); });
        row.append(b1, b5);
      }
      list.appendChild(row);
    }
    this.show("m-shop");
  }

  // --------------------------------------------------------------- party
  monCard(m, extra = "") {
    return `
      <img class="px" src="${spriteURL(m.sp)}">
      <div class="bars">
        <div class="nm"><span>${esc(monName(m))} ${m.hp <= 0 ? "(fainted)" : ""}</span><span>Lv ${m.lv}</span></div>
        <div class="hpbar"><div class="${this.hpClass(m)}" style="width:${(m.hp / m.maxhp) * 100}%"></div></div>
        <small>${Math.ceil(m.hp)}/${m.maxhp} HP ${extra}</small>
      </div>`;
  }
  openParty() {
    const g = this.game;
    const list = $("partylist");
    list.innerHTML = "";
    const walking = g.followerMon();
    g.state.party.forEach((m, i) => {
      const tags = [g.activeMon() === m ? "· LEAD" : "", walking === m ? "· WALKING" : ""].join(" ").trim();
      const card = el("div", "moncard", this.monCard(m, tags));
      card.addEventListener("click", () => this.partyDetail(i));
      list.appendChild(card);
    });
    $("partydetail").innerHTML = `<p class="small">Select a Pokémon.</p>`;
    this.show("m-party");
  }
  partyDetail(i) {
    const g = this.game;
    const m = g.state.party[i];
    if (!m) return;
    const d = DEX[m.sp];
    const toNext = m.lv >= 100 ? 0 : Math.max(0, xpForLevel(m.sp, m.lv + 1) - m.xp);
    const moveRows = m.moves.map((id, mi) => {
      const mv = MOVES[id];
      const pp = m.pp?.[mi] ?? mv.pp;
      return `<div class="itemrow" style="padding:4px 6px">${chip(mv.type)}<span class="inf"><b>${esc(mv.name)}</b></span><small>${mv.power ? "PWR " + mv.power : "status"} · ${mv.acc ? "ACC " + mv.acc : "sure hit"} · PP ${pp}/${mv.pp}</small>${m.moves.length > 1 ? `<button class="forgetmv" data-mi="${mi}" title="Forget this move">✕</button>` : ""}</div>`;
    }).join("");
    const learnable = g.learnableMoves(m);
    const learnRows = learnable.length ? learnable.map((id) => {
      const mv = MOVES[id];
      return `<div class="itemrow" style="padding:4px 6px;opacity:.92">${chip(mv.type)}<span class="inf"><b>${esc(mv.name)}</b></span><small>${mv.power ? "PWR " + mv.power : "status"} · ${mv.acc ? "ACC " + mv.acc : "sure hit"}</small><button class="learnmv primary" data-mv="${id}">Learn</button></div>`;
    }).join("") : `<p class="small" style="opacity:.6">No new moves to learn right now.</p>`;
    const hap = m.hap ?? 70;
    const hapTxt = hap >= 220 ? "adores you ♥" : hap >= 150 ? "is very happy" : hap >= 90 ? "is warming up to you" : hap >= 40 ? "is wary of you" : "doesn't trust you yet";
    $("partydetail").innerHTML = `
      <div style="text-align:center"><img class="px" src="${spriteURL(m.sp)}" style="width:96px;height:96px"></div>
      <h2 style="margin:2px 0">${esc(monName(m))} <small>Lv ${m.lv}</small></h2>
      <div>${d.types.map(chip).join("")}</div>
      <div class="small" style="margin:6px 0">HP ${Math.ceil(m.hp)}/${m.maxhp} · ATK ${m.atk} · DEF ${m.def}<br>SPE ${m.spe} · SPC ${m.spc} · ${esc(d.growth || "medium")} growth</div>
      <div class="small" style="margin:2px 0">It ${hapTxt} <span style="opacity:.6">(friendship ${hap}/255 — pet your lead, win battles${hap >= 200 ? " · +10% XP!" : ""})</span></div>
      <div class="xpbar" style="margin:4px 0"><div style="width:${this.xpFrac(m) * 100}%"></div></div>
      <div class="small">XP ${m.xp.toLocaleString()} · next level in ${toNext.toLocaleString()}</div>
      <div class="small" style="margin-top:8px;opacity:.7">MOVES <span style="opacity:.6">(✕ to forget)</span></div>
      <div style="margin-top:2px">${moveRows}</div>
      <div class="small" style="margin-top:8px;opacity:.7">CAN LEARN</div>
      <div style="margin-top:2px">${learnRows}</div>
      <div class="right" style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
        <button id="walkWithMe">${g.followerMon() === m ? "Send back to Ball" : "Walk with me"}</button>
        <button id="makeLead" class="primary">Make Lead</button>
      </div>`;
    $("makeLead").addEventListener("click", () => {
      g.setLead(i);
      this.toast(`${monName(m)} is now in the lead!`, "good");
      this.updateParty();
      this.openParty();
    });
    $("walkWithMe").addEventListener("click", () => {
      g.setFollowerMon(g.followerMon() === m ? null : m);
      this.openParty();
      this.partyDetail(i);
    });
    $("partydetail").querySelectorAll(".forgetmv").forEach((btn: any) => {
      btn.addEventListener("click", (e: any) => {
        e.stopPropagation();
        g.forgetMove(m, +btn.dataset.mi);
        this.partyDetail(i);
      });
    });
    $("partydetail").querySelectorAll(".learnmv").forEach((btn: any) => {
      btn.addEventListener("click", async (e: any) => {
        e.stopPropagation();
        const moveId = +btn.dataset.mv;
        if (m.moves.length >= 4) {
          const slot = (await this.learnPrompt(m, moveId)) as number;
          if (slot != null && slot >= 0) g.teachMove(m, moveId, slot);
        } else {
          g.teachMove(m, moveId);
        }
        this.partyDetail(i);
      });
    });
  }

  // ------------------------------------------------------------- storage
  openStorage() {
    const g = this.game;
    const sp = $("stparty"), sb = $("stbox");
    sp.innerHTML = ""; sb.innerHTML = "";
    $("stcount").textContent = g.state.boxes.length;
    g.state.party.forEach((m, i) => {
      const card = el("div", "moncard", this.monCard(m));
      card.title = "Send to Box";
      card.addEventListener("click", () => {
        if (g.state.party.length <= 1) { this.toast("You need at least one Pokémon with you!", "bad"); return; }
        g.state.boxes.push(g.state.party.splice(i, 1)[0]);
        this.audio.play("pc");
        g.save(); this.updateParty(); this.openStorage();
      });
      sp.appendChild(card);
    });
    g.state.boxes.forEach((m, i) => {
      const cell = el("div", "boxcell", `<img class="px" src="${spriteURL(m.sp)}" loading="lazy"><span class="lv">${m.lv}</span>`);
      cell.title = `${monName(m)} Lv ${m.lv} — withdraw`;
      cell.addEventListener("click", () => {
        if (g.state.party.length >= 6) { this.toast("Your party is full (max 6).", "bad"); return; }
        g.state.party.push(g.state.boxes.splice(i, 1)[0]);
        this.audio.play("pc");
        g.save(); this.updateParty(); this.openStorage();
      });
      sb.appendChild(cell);
    });
    if (!g.state.boxes.length) sb.innerHTML = `<p class="small">Box is empty.</p>`;
    this.show("m-storage");
  }

  // --------------------------------------------------- switch / pick mon
  pickParty(title, filter) {
    return new Promise((res) => {
      const g = this.game;
      $("switchtitle").textContent = title;
      const list = $("switchlist");
      list.innerHTML = "";
      let any = false;
      g.state.party.forEach((m, i) => {
        const ok = filter(m);
        if (!ok) return;
        any = true;
        const card = el("div", "moncard", this.monCard(m));
        card.addEventListener("click", () => {
          this._switchResolve = null;
          this.hide("m-switch");
          res(i);
        });
        list.appendChild(card);
      });
      if (!any) { list.innerHTML = `<p class="small">No valid Pokémon.</p>`; }
      this._switchResolve = res;
      this.switchForced = false;
      this.show("m-switch");
    });
  }
  openSwitch(forced) {
    const g = this.game;
    const active = g.battle ? g.battle.allyMon : g.activeMon();
    const p = this.pickParty(forced ? "Choose your next Pokémon!" : "Switch to which Pokémon?", (m) => m.hp > 0 && m !== active);
    this.switchForced = forced;
    return p;
  }

  // ---------------------------------------------------------- learn move
  learnPrompt(mon, moveId) {
    return new Promise((res) => {
      const mv = MOVES[moveId];
      $("learninfo").innerHTML = `<b>${esc(monName(mon))}</b> wants to learn ${chip(mv.type)} <b>${esc(mv.name)}</b>
        <small>(${mv.power ? "PWR " + mv.power : "status"} · ${mv.acc ? "ACC " + mv.acc : "sure hit"})</small><br>
        <small>But it already knows 4 moves. Replace one?</small>`;
      const list = $("learnlist");
      list.innerHTML = "";
      mon.moves.forEach((id, i) => {
        const om = MOVES[id];
        const row = el("div", "itemrow", `${chip(om.type)}<span class="inf"><b>${esc(om.name)}</b></span><small>${om.power ? "PWR " + om.power : "status"}</small>`);
        const b = el("button", "", "Replace");
        b.addEventListener("click", () => { this._learnResolve = null; this.hide("m-learn"); res(i); });
        row.appendChild(b);
        list.appendChild(row);
      });
      $("learnskip").onclick = () => { this._learnResolve = null; this.hide("m-learn"); res(-1); };
      this._learnResolve = res;
      this.show("m-learn");
    });
  }

  // ---------------------------------------------------------------- pause
  openPause() {
    this.updateHUD();
    this.rebinding = null;
    this.renderKeybinds();
    this.show("m-pause");
  }

  // --------------------------------------------------------------- cheats
  openCheats() {
    const g = this.game;
    const togWrap = $("cheattoggles");
    togWrap.innerHTML = "";
    const TOGGLES = [
      ["god", "God Mode", "your Pokémon take no damage"],
      ["ohko", "One-Hit KO", "every hit you land is fatal"],
      ["catchall", "100% Catch", "every ball always works"],
      ["infpp", "Infinite PP", "moves never run dry"],
      ["speed", "Speed Boost", "walk & run ~2× faster"],
    ];
    for (const [key, name, desc] of TOGGLES) {
      const b = el("button", `togbtn${g.state.cheats[key] ? " on" : ""}`,
        `<b>${name}</b> · ${g.state.cheats[key] ? "ON" : "OFF"}<br><small>${desc}</small>`);
      b.addEventListener("click", () => { g.cheat("toggle", key); this.openCheats(); });
      togWrap.appendChild(b);
    }
    const actWrap = $("cheatactions");
    actWrap.innerHTML = "";
    const ACTIONS = [
      ["money", "+₽10,000", "pad the wallet"],
      ["balls", "+10 all Balls", "Poké, Great & Ultra"],
      ["items", "Stock healing items", "potions & revives"],
      ["heal", "Full heal party", "HP, status and PP"],
      ["candy", "Rare Candy ×5", "lead Pokémon +5 levels"],
      ["tl", "Trainer Level +5", "unlock better balls"],
      ["badges", "Grant all 8 badges", "opens Cerulean Cave + League"],
      ["dexall", "Pokédex: see all", "marks all 151 as seen"],
      ["day", "Set time: noon", "sunshine on demand"],
      ["night", "Set time: midnight", "for night spawns"],
      ["happy", "Max happiness", "party adores you"],
      ["rocket", "Summon Team Rocket", "prepare for trouble"],
    ];
    for (const [key, name, desc] of ACTIONS) {
      const b = el("button", "", `<b>${name}</b><br><small>${desc}</small>`);
      b.addEventListener("click", () => { g.cheat(key); this.openCheats(); });
      actWrap.appendChild(b);
    }
    const WEATHERS = [["clear", "☀ Clear"], ["rain", "🌧 Rain"], ["storm", "⛈ Storm"], ["fog", "🌫 Fog"]];
    for (const [id, name] of WEATHERS) {
      const b = el("button", "", `<b>${name}</b><br><small>set the weather</small>`);
      b.addEventListener("click", () => { g.cheat("weather", id); });
      actWrap.appendChild(b);
    }
    const sel = $("cheattp");
    if (!sel.options.length) {
      const LABELS = {
        pallet: "Pallet Town", viridian: "Viridian City", pewter: "Pewter City",
        cerulean: "Cerulean City", saffron: "Saffron City", celadon: "Celadon City",
        lavender: "Lavender Town", vermilion: "Vermilion City", fuchsia: "Fuchsia City",
        cinnabar: "Cinnabar Island", indigo: "Indigo Plateau",
        forest: "Viridian Forest", mtmoon: "Mt. Moon", rocktunnel: "Rock Tunnel",
        powerplant: "Power Plant", safari: "Safari Zone", seafoam: "Seafoam Islands",
        cycling: "Cycling Road", victory: "Victory Road",
        ceruleancave: "Cerulean Cave", bill: "Bill's Cottage",
      };
      for (const id of Object.keys(Game.CHEAT_TPS)) {
        const o = document.createElement("option");
        o.value = id;
        o.textContent = LABELS[id] || id;
        sel.appendChild(o);
      }
    }
    this.show("m-cheats");
  }

  // -------------------------------------------------------- hall of fame
  openFame() {
    const g = this.game;
    const wrap = $("famelist");
    wrap.innerHTML = "";
    const entry = g.state.hof[g.state.hof.length - 1];
    for (const t of entry.team) {
      wrap.appendChild(el("div", "famecell",
        `<img class="px" src="${spriteURL(t.sp)}"><div><b>${esc(DEX[t.sp].name)}</b><br><small>Lv ${t.lv}</small></div>`));
    }
    $("famesub").textContent = `Champion ${entry.name || g.state.name || "Trainer"} · run #${g.state.hof.length} · ${new Date(entry.ts).toLocaleDateString()}`;
    this.show("m-fame");
  }

  // ----------------------------------------------- v9: title / save slots
  showTitle() {
    this.titleActive = true;
    this.renderSlots();
    $("title").classList.remove("hidden");
    document.exitPointerLock?.();
  }
  hideTitle() {
    this.titleActive = false;
    $("title").classList.add("hidden");
  }
  renderSlots() {
    const wrap = $("slots");
    wrap.innerHTML = "";
    const cur = currentSlot();
    for (let n = 1; n <= 3; n++) {
      const meta = slotMeta(n);
      const card = el("div", `slotcard${meta ? "" : " empty"}`);
      const head = `<div class="sn">File ${n}${n === cur ? " · last played" : ""}</div>`;
      if (meta) {
        card.innerHTML = head + `
          <div class="who">${esc(meta.name)}</div>
          <div class="meta"><b>${meta.badges}</b> badges · <b>${meta.dex}</b> caught<br>
          Trainer Lv ${meta.tl} · ${fmtPlaytime(meta.playT)} played</div>
          ${meta.lead ? `<img class="px" src="${spriteURL(meta.lead)}" title="Lv ${meta.leadLv}">` : ""}`;
        const row = el("div", "row");
        const go = el("button", "primary", "Continue");
        go.addEventListener("click", () => { this.audio.ensure(); this.pickSlot(n, false); });
        const del = el("button", "red", "Delete");
        del.addEventListener("click", async (ev) => {
          ev.stopPropagation();
          if (await this.confirm(`Delete File ${n} (${meta.name}, ${fmtPlaytime(meta.playT)})? This cannot be undone.`)) {
            localStorage.removeItem(slotStorageKey(n));
            if (n === currentSlot()) { this.game.resetting = true; location.reload(); }
            else this.renderSlots();
          }
        });
        row.append(go, del);
        card.appendChild(row);
      } else {
        card.innerHTML = head + `<div class="who">— empty —</div>
          <div class="meta">A brand-new journey from<br>Pallet Town. Oak is waiting.</div>`;
        const row = el("div", "row");
        const go = el("button", "primary", "New Game");
        go.addEventListener("click", () => { this.audio.ensure(); this.pickSlot(n, true); });
        row.append(go);
        card.appendChild(row);
      }
      wrap.appendChild(card);
    }
  }
  // continuing/creating on the loaded slot is instant; any other slot does a
  // clean reload with a "go straight in" flag so the Game re-boots on its save
  pickSlot(n: number, fresh: boolean) {
    if (n === currentSlot()) {
      if (!fresh && this.game.state.started) { this.hideTitle(); this.game.enterWorld(); }
      else { this.hideTitle(); this.game.newGameFlow(); }
      return;
    }
    setSlot(n);
    this.game.resetting = true;            // don't let beforeunload save cross-slot
    try { sessionStorage.setItem("kanto_proceed", "1"); } catch (e) { /* fine */ }
    location.reload();
  }

  // ------------------------------------------------- v9: name entry modal
  askName(title: string, presets: string[]) {
    return new Promise<string>((res) => {
      this._nameResolve = res;
      $("nametitle").textContent = title;
      $("nameinput").value = "";
      const wrap = $("namepresets");
      wrap.innerHTML = "";
      for (const p of presets) {
        const b = el("button", "", esc(p));
        b.addEventListener("click", () => { $("nameinput").value = p; this.confirmName(); });
        wrap.appendChild(b);
      }
      this.show("m-name");
      setTimeout(() => $("nameinput").focus(), 50);
    });
  }
  confirmName() {
    const v = String($("nameinput").value || "").trim().slice(0, 12);
    if (!v) { this.toast("Even Youngster Joey has a name. Type one!", "bad"); return; }
    const r = this._nameResolve;
    this._nameResolve = null;
    this.hide("m-name");
    if (r) r(v);
  }

  // ------------------------------------------- v9: PokéGram (doomscrolling)
  openGram() {
    const feed = $("gramfeed");
    feed.innerHTML = "";
    this.gramCount = 0;
    this.gramMore(8);
    $("gramtime").textContent = `screen time today: ${fmtPlaytime(this.game.state.playT || 0)}`;
    this.show("m-gram");
    // top up until the feed actually overflows — a feed you can't scroll
    // would be the only way OUT of doomscrolling, and we can't have that
    for (let i = 0; i < 8 && feed.scrollHeight <= feed.clientHeight + 240; i++) this.gramMore(4);
    feed.scrollTop = 0;
  }
  gramMore(n: number) {
    const feed = $("gramfeed");
    if (!feed || feed.childElementCount > 240) return;   // even doom has a budget
    for (let i = 0; i < n; i++) {
      this.gramCount++;
      // every ~13 posts the app briefly develops a conscience
      if (this.gramCount % 13 === 0) {
        const mins = Math.max(1, Math.floor((this.game.state.playT || 0) / 60));
        const post = el("div", "gpost shame", `
          <div class="gbody">You've scrolled ${this.gramCount} posts. Professor Oak suggests touching grass.<br>
          <small>(Wild Pokémon live there. ${mins} minutes of adventure so far — make them count.)</small></div>`);
        feed.appendChild(post);
        continue;
      }
      feed.appendChild(this.gramPost());
    }
  }
  gramPost() {
    const g = this.game;
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const sp = Math.floor(Math.random() * 151) + 1;
    const name = DEX[sp].name;
    const seen = g.dexSeen.has(sp) || g.dexCaught.has(sp);
    const n1 = Math.floor(Math.random() * 90) + 3;
    const rival = g.state.rival || "Blue";
    const sponsored = Math.random() < 0.14;
    const authors = ["Lass Heather", "Bug Catcher Sam", "PKMN Ranger Lex", "Hiker Bruno", "Nurse Joy (parody)", "Officer Jenny", "Prof. Oak", `${rival} ✓`, "Brock", "Misty", "Lt. Surge", "Erika", "Sabrina", "Mt. Moon 5G Updates", "Magikarp Daily"];
    const posts = [
      `Day ${n1} of asking my ${name} to do the trend. It used REST instead.`,
      `My ${name} learned a new move and the first thing it hit was my router. ${n1}k likes don't pay for a new one, but here we are.`,
      `POV: you're a ${name} and your trainer films EVERYTHING.`,
      `Rare ${name} spotted near ${pick(["Viridian", "Pewter", "Cerulean", "Lavender", "Fuchsia"])}! (photo taken from very, very far away)`,
      `Hot take: ${name} is mid and you're all in a parasocial relationship with it. Anyway here's mine doing a flip.`,
      `Gym leader tier list (part ${n1}). Putting Sabrina at S makes you a coward, not wrong.`,
      `unboxing my new Poké Balls!! the top one is my favorite (they are identical)`,
      `Caught in 4K: Snorlax blocking Route 12 AGAIN. ${n1}k people in the replies, zero people with a Poké Flute.`,
      `Team Rocket says their new app is "totally not a scam." Downloading it to be polite.`,
      `My grandson beat ${n1} trainers today. His screen time? Don't ask. — a proud, worried grandfather`,
      `Therapist: the ${name} in the walls isn't real. The walls: *GROWL intensifies*`,
      `Nobody: ... Absolutely nobody: ... My ${name} at 3 AM: ${pick(["SCREECH", "HYPER VOICE", "ROAR", "SING"])}`,
      `Tried the "let your ${name} walk behind you" update. 10/10, crying, it waited for me at the door.`,
      `BREAKING: local trainer ${g.state.name || "RED"} just took the ${pick(["Boulder", "Cascade", "Thunder", "Rainbow"])} Badge. The grind is REAL.`,
      `${rival} ✓ posted: "Fastest badge run in Pallet history. Clip it. #blessed #grindset"`,
    ];
    const sponsoredPosts = [
      `Tired of walking? The new SilphScope X folds, streams, AND detects ghosts. Pre-order now.`,
      `PokéMart PLUS: free Potion with every 10th doomscroll. Terms apply. Grass not included.`,
      `Cycling Road insurance. Because gravity is undefeated. Get a quote in 2 minutes.`,
      `HM05 BrightCase — the phone case that uses FLASH. Never read in the dark again.`,
    ];
    const text = sponsored ? pick(sponsoredPosts) : pick(posts);
    const who = sponsored ? pick(["Silph Co.", "PokéMart", "Indigo Insurance", "Devon... wait, wrong region"]) : pick(authors);
    const when = `${Math.floor(Math.random() * 55) + 2}m`;
    const likes = (Math.random() * 9.9 + 0.1).toFixed(1);
    const ava = seen && !sponsored && Math.random() < 0.6
      ? `<img class="px" src="${spriteURL(sp)}">`
      : `<span style="font-size:15px">${sponsored ? "🛍" : pick(["🧢", "🌿", "⚡", "🌊", "🔥", "👾", "🎣", "🚴"])}</span>`;
    return el("div", `gpost${sponsored ? " sponsored" : ""}`, `
      <div class="ghead"><span class="gava">${ava}</span><span class="gwho">${esc(who)}</span><span class="gwhen">${when}</span></div>
      <div class="gbody">${esc(text)}</div>
      <div class="gstats"><span>❤ ${likes}k</span><span>↻ ${Math.floor(Math.random() * 900) + 12}</span><span>💬 ${Math.floor(Math.random() * 400) + 5}</span></div>`);
  }

  // --------------------------------------------------------------- battle
  setBattle(battle) {
    this.battle = battle;
    // clear old bars
    for (const b of this.wbars) b.e.remove();
    this.wbars = [];
    if (!battle) {
      $("battlebar").classList.add("hidden");
      $("enemyplate").classList.add("hidden");
      $("telegraph")?.classList.add("hidden");
      $("counterhint")?.classList.add("hidden");
      $("possessbar")?.classList.add("hidden");
      return;
    }
    $("battlebar").classList.remove("hidden");
    $("enemyplate").classList.remove("hidden");
    // temperament chip — read your opponent before you read its HP bar
    const temperEl = $("etemper");
    if (temperEl) {
      const temper = DEX[battle.enemy().sp].temper || "calm";
      temperEl.textContent = temper;
      temperEl.className = temper;
    }
    const wrap = $("movebtns");
    wrap.innerHTML = "";
    const foeTypes = DEX[battle.enemy().sp].types;
    battle.allyMon.moves.forEach((id, i) => {
      const mv = MOVES[id];
      const pp = battle.allyMon.pp?.[i] ?? mv.pp;
      // effectiveness preview against the current foe (anime-style coaching)
      let effTag = "";
      if (mv.power) {
        let eff = 1;
        for (const dt of foeTypes) eff *= TYPE_CHART[mv.type]?.[dt] ?? 1;
        effTag = eff >= 2 ? `<span class="efftag good">▲ super</span>` : eff === 0 ? `<span class="efftag zero">✕ none</span>` : eff < 1 ? `<span class="efftag bad">▼ weak</span>` : "";
      }
      const b = el("button", "movebtn", `
        <div class="cd"></div>
        <span class="cdtext"></span>
        <span class="key">${esc(this.keyText(MOVE_ACTIONS[i]))}</span>
        <div class="mname">${esc(mv.name)} ${effTag}</div>
        ${chip(mv.type)}
        <div class="minfo"><span>${mv.power ? "PWR " + mv.power : "status"}</span><span>${mv.acc ? mv.acc + "%" : "∞"}</span><span class="pp">PP ${pp}</span></div>`);
      b.style.setProperty("--move-color", TYPE_COLORS[mv.type]);
      b.addEventListener("click", () => battle.useMove("ally", i));
      wrap.appendChild(b);
    });
    // floating world bars
    for (const [ent, label] of [[battle.allyEnt, "ally"], [battle.enemyEnt, "enemy"]]) {
      const e = el("div", "wbar", `<div class="nm"><span>${esc(monName(ent.mon))}</span><span class="lv"></span></div><div class="hpbar"><div style="width:100%"></div></div>`);
      $("floaters").appendChild(e);
      this.wbars.push({ ent, e, hp: e.querySelector(".hpbar div"), lv: e.querySelector(".lv") });
    }
  }
}
