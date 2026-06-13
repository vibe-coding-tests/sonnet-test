// Synthesized WebAudio sound effects + ambient scheduler. No audio assets needed.

interface ToneOpts {
  f?: number; f2?: number | null; t?: number; dur?: number;
  type?: OscillatorType; g?: number; a?: number; slideType?: "exp" | "lin";
}
interface NoiseOpts {
  t?: number; dur?: number; g?: number; fLo?: number; fHi?: number;
  fEnd?: number | null; type?: BiquadFilterType; q?: number;
}

export class AudioMan {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  volume = 0.7;
  ambT = 0;
  rainGain: GainNode | null = null;
  rainSrc: AudioBufferSourceNode | null = null;
  rainLevel = 0;

  ensure() {
    if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return; }
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume * this.volume;
    this.master.connect(this.ctx.destination);
  }
  setVolume(v: number) { this.volume = v; if (this.master) this.master.gain.value = v * v; }
  now() { return this.ctx ? this.ctx.currentTime : 0; }

  // --- primitives -----------------------------------------------------
  tone({ f = 440, f2 = null, t = 0, dur = 0.15, type = "sine", g = 0.2, a = 0.005, slideType = "exp" }: ToneOpts) {
    if (!this.ctx) return;
    const c = this.ctx, t0 = c.currentTime + t;
    const o = c.createOscillator(), gn = c.createGain();
    o.type = type; o.frequency.setValueAtTime(Math.max(20, f), t0);
    if (f2) {
      if (slideType === "exp") o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t0 + dur);
      else o.frequency.linearRampToValueAtTime(Math.max(20, f2), t0 + dur);
    }
    gn.gain.setValueAtTime(0, t0);
    gn.gain.linearRampToValueAtTime(g, t0 + a);
    gn.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    o.connect(gn); gn.connect(this.master!);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }
  noise({ t = 0, dur = 0.2, g = 0.2, fLo = 200, fHi = 4000, fEnd = null, type = "bandpass", q = 1 }: NoiseOpts) {
    if (!this.ctx) return;
    const c = this.ctx, t0 = c.currentTime + t;
    const len = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource(); src.buffer = buf;
    const flt = c.createBiquadFilter(); flt.type = type; flt.Q.value = q;
    const fc = Math.sqrt(fLo * fHi);
    flt.frequency.setValueAtTime(fc, t0);
    if (fEnd) flt.frequency.exponentialRampToValueAtTime(Math.max(40, fEnd), t0 + dur);
    const gn = c.createGain();
    gn.gain.setValueAtTime(g, t0);
    gn.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    src.connect(flt); flt.connect(gn); gn.connect(this.master!);
    src.start(t0); src.stop(t0 + dur + 0.05);
  }
  seq(notes: number[], { type = "square", g = 0.14, step = 0.09, durMul = 1.05 }: { type?: OscillatorType; g?: number; step?: number; durMul?: number } = {}) {
    notes.forEach((n, i) => { if (n) this.tone({ f: n, t: i * step, dur: step * durMul, type, g }); });
  }

  // --- species cry: a unique two-segment chirp derived from the dex id ---
  // vol < 1 gives the soft, distant call of ambient wildlife
  cry(spId: number, height = 10, vol = 1) {
    this.ensure(); if (!this.ctx) return;
    const h = (salt: number) => (((spId * 2654435761 + salt * 1013904223) >>> 0) % 1000) / 1000;
    // bigger Pokémon growl lower and longer
    const sizeK = Math.min(1, height / 22);
    const base = 900 - sizeK * 620 + h(1) * 240;
    const wob = 1 + h(2) * 0.8;
    const types: OscillatorType[] = ["square", "sawtooth", "triangle"];
    const wave = types[Math.floor(h(3) * 3)];
    const dur = 0.16 + sizeK * 0.22 + h(4) * 0.1;
    this.tone({ f: base * wob, f2: base * (0.55 + h(5) * 0.3), dur, type: wave, g: 0.13 * vol });
    this.tone({ f: base * 1.5, f2: base * (h(6) < 0.5 ? 2.1 : 0.8), t: dur * 0.55, dur: dur * 0.8, type: wave, g: 0.09 * vol });
    if (h(7) > 0.6) this.noise({ t: dur * 0.3, dur: 0.08, g: 0.04 * vol, fLo: base * 2, fHi: base * 5 });
  }

  // --- named SFX -------------------------------------------------------
  play(name: string) {
    this.ensure(); if (!this.ctx) return;
    const S = this;
    (({
      ui: () => S.tone({ f: 660, dur: 0.05, type: "square", g: 0.06 }),
      select: () => S.seq([520, 780], { g: 0.08, step: 0.06 }),
      deny: () => S.seq([220, 165], { g: 0.1, step: 0.1, type: "sawtooth" }),
      throw: () => S.noise({ dur: 0.3, g: 0.12, fLo: 700, fHi: 2600, fEnd: 300 }),
      ballhit: () => { S.tone({ f: 980, dur: 0.06, type: "triangle", g: 0.18 }); S.noise({ dur: 0.05, g: 0.1, fLo: 2000, fHi: 6000 }); },
      balldrop: () => { S.tone({ f: 420, f2: 200, dur: 0.1, type: "triangle", g: 0.1 }); S.noise({ dur: 0.06, g: 0.06, fLo: 300, fHi: 900 }); },
      shake: () => S.tone({ f: 460, f2: 320, dur: 0.1, type: "square", g: 0.12 }),
      catch: () => { S.seq([523, 659, 784, 1047], { g: 0.13, step: 0.1 }); S.tone({ f: 1568, t: 0.42, dur: 0.4, type: "triangle", g: 0.1 }); },
      critcatch: () => { S.seq([784, 1047, 1319, 1568, 2093], { g: 0.13, step: 0.07, type: "triangle" }); S.tone({ f: 2637, t: 0.4, dur: 0.5, type: "sine", g: 0.08 }); },
      break: () => { S.noise({ dur: 0.18, g: 0.2, fLo: 300, fHi: 1400 }); S.seq([392, 311, 233], { g: 0.1, step: 0.09 }); },
      flee: () => S.noise({ dur: 0.25, g: 0.1, fLo: 900, fHi: 3000, fEnd: 4500 }),
      faint: () => S.seq([392, 311, 233, 156], { type: "square", g: 0.12, step: 0.11 }),
      levelup: () => S.seq([523, 659, 784, 1047, 0, 1047, 1319], { g: 0.12, step: 0.08 }),
      evolve: () => { for (let i = 0; i < 14; i++) S.tone({ f: 300 + i * 90, t: i * 0.1, dur: 0.22, type: "triangle", g: 0.07 }); S.seq([784, 988, 1175, 1568], { g: 0.13, step: 0.12 }); },
      evolveDone: () => S.seq([659, 784, 988, 1319, 1568], { g: 0.13, step: 0.09 }),
      heal: () => S.seq([784, 988, 784, 988, 1175, 1568], { g: 0.1, step: 0.11, type: "triangle" }),
      buy: () => { S.tone({ f: 1175, dur: 0.07, type: "square", g: 0.1 }); S.tone({ f: 1568, t: 0.08, dur: 0.12, type: "square", g: 0.1 }); },
      learn: () => S.seq([659, 880, 1109], { g: 0.1, step: 0.08 }),
      alert: () => S.seq([880, 880], { type: "square", g: 0.15, step: 0.13, durMul: 0.7 }),
      badge: () => S.seq([523, 659, 784, 659, 784, 1047, 1319], { g: 0.13, step: 0.12 }),
      whiteout: () => S.seq([330, 262, 220, 165, 131], { type: "sine", g: 0.14, step: 0.18 }),
      pc: () => S.seq([700, 1000, 1300], { type: "square", g: 0.06, step: 0.05 }),
      hop: () => S.tone({ f: 300, f2: 600, dur: 0.1, g: 0.05, type: "triangle" }),
      switch: () => S.noise({ dur: 0.2, g: 0.12, fLo: 500, fHi: 2400, fEnd: 3600 }),
      charge: () => S.tone({ f: 200, f2: 900, dur: 0.5, type: "sawtooth", g: 0.06 }),
      lowhp: () => S.tone({ f: 880, dur: 0.07, type: "square", g: 0.05 }),
      // --- new in v3 ---
      slowmo: () => S.tone({ f: 700, f2: 140, dur: 0.5, type: "sine", g: 0.08 }),
      slowmoEnd: () => S.tone({ f: 180, f2: 720, dur: 0.25, type: "sine", g: 0.06 }),
      aimtick: () => S.tone({ f: 1200, dur: 0.03, type: "square", g: 0.03 }),
      ringNice: () => S.seq([880, 1109], { g: 0.09, step: 0.06, type: "triangle" }),
      dodge: () => S.noise({ dur: 0.16, g: 0.12, fLo: 800, fHi: 3400, fEnd: 5000 }),
      shoot: () => S.noise({ dur: 0.22, g: 0.1, fLo: 900, fHi: 3000, fEnd: 600 }),
      counter: () => S.seq([660, 990], { g: 0.1, step: 0.05, type: "square" }),
      thunder: () => { S.noise({ dur: 1.6, g: 0.22, fLo: 50, fHi: 320, type: "lowpass" }); S.noise({ t: 0.05, dur: 0.4, g: 0.1, fLo: 800, fHi: 3000, fEnd: 150 }); },
      drip: () => S.tone({ f: 1700 + Math.random() * 900, f2: 600, dur: 0.09, type: "sine", g: 0.04 }),
      bats: () => { for (let i = 0; i < 5; i++) S.tone({ f: 2800 + Math.random() * 800, t: i * 0.06, dur: 0.05, type: "triangle", g: 0.025 }); },
      splash: () => { S.noise({ dur: 0.3, g: 0.14, fLo: 600, fHi: 2800, fEnd: 350 }); S.tone({ f: 320, f2: 140, dur: 0.18, type: "sine", g: 0.1 }); },
      bite: () => { S.tone({ f: 1400, dur: 0.05, type: "square", g: 0.12 }); S.tone({ f: 1400, t: 0.09, dur: 0.05, type: "square", g: 0.12 }); },
      reel: () => { for (let i = 0; i < 6; i++) S.tone({ f: 900 + i * 60, t: i * 0.04, dur: 0.03, type: "square", g: 0.04 }); },
      pickup: () => S.seq([988, 1319], { g: 0.09, step: 0.05, type: "triangle" }),
      pet: () => S.seq([784, 1047, 1319], { g: 0.07, step: 0.07, type: "sine" }),
      rocket: () => { S.seq([466, 415, 466, 415, 554], { g: 0.1, step: 0.13, type: "sawtooth" }); S.tone({ f: 233, dur: 0.6, type: "square", g: 0.05 }); },
      blastoff: () => { S.tone({ f: 300, f2: 1800, dur: 0.7, type: "sawtooth", g: 0.1 }); S.tone({ f: 2400, t: 0.7, dur: 0.25, type: "sine", g: 0.06 }); },
      fanfare: () => { S.seq([523, 523, 523, 659, 784, 0, 784, 1047], { g: 0.13, step: 0.11, type: "square" }); S.seq([262, 262, 262, 330, 392, 0, 392, 523], { g: 0.07, step: 0.11, type: "triangle" }); },
      repel: () => S.seq([1175, 988, 1175], { g: 0.08, step: 0.06, type: "square" }),
      lure: () => S.seq([659, 784, 988, 784], { g: 0.07, step: 0.09, type: "sine" }),
      rope: () => S.tone({ f: 500, f2: 1500, dur: 0.4, type: "triangle", g: 0.09 }),
      // --- v5: vehicles ---
      bikebell: () => { S.tone({ f: 1760, dur: 0.12, type: "triangle", g: 0.12 }); S.tone({ f: 2093, t: 0.12, dur: 0.18, type: "triangle", g: 0.1 }); },
      biketick: () => S.tone({ f: 2400 + Math.random() * 300, dur: 0.02, type: "square", g: 0.022 }),
      engine: () => { S.tone({ f: 55, f2: 130, dur: 0.8, type: "sawtooth", g: 0.14 }); S.noise({ dur: 0.5, g: 0.06, fLo: 60, fHi: 240, type: "lowpass" }); },
      engineputt: () => { S.tone({ f: 70 + Math.random() * 18, dur: 0.07, type: "sawtooth", g: 0.05 }); S.noise({ dur: 0.05, g: 0.02, fLo: 80, fHi: 300, type: "lowpass" }); },
    } as Record<string, () => void>)[name] || (() => {}))();
  }
  step(biome: string) {
    this.ensure(); if (!this.ctx) return;
    const f = biome === "mountain" || biome === "cave" || biome === "town" ? 900 : 420;
    this.noise({ dur: 0.06, g: 0.025, fLo: f, fHi: f * 3.2 });
  }
  // Impact SFX. Beyond the elemental "voice", the blow's weight, the type
  // matchup and a crit all bend the sound — so what you hear matches the
  // damage number and the floaters on screen.
  hit(type: string, opts: boolean | { big?: boolean; eff?: number; crit?: boolean } = {}) {
    this.ensure(); if (!this.ctx) return;
    const o = typeof opts === "boolean" ? { big: opts } : opts;
    const big = !!o.big, eff = o.eff ?? 1, crit = !!o.crit;
    // resisted hits land soft and dull; super-effective and crits land heavy
    const effK = eff >= 2 ? 1.4 : eff > 1 ? 1.2 : eff > 0 && eff < 1 ? 0.72 : eff === 0 ? 0.5 : 1;
    const S = this, G = (big ? 1.5 : 1) * effK * (crit ? 1.2 : 1);
    (({
      fire: () => { for (let i = 0; i < 3; i++) S.noise({ t: i * 0.05, dur: 0.09, g: 0.1 * G, fLo: 800, fHi: 3500 }); },
      water: () => { S.tone({ f: 600, f2: 180, dur: 0.18, type: "sine", g: 0.16 * G }); S.noise({ t: 0.04, dur: 0.18, g: 0.08 * G, fLo: 1000, fHi: 5000, fEnd: 500 }); },
      electric: () => { for (let i = 0; i < 4; i++) S.tone({ f: 1700 - i * 250 + Math.random() * 300, t: i * 0.04, dur: 0.05, type: "square", g: 0.08 * G }); },
      grass: () => S.noise({ dur: 0.16, g: 0.12 * G, fLo: 1800, fHi: 6000, fEnd: 900 }),
      ice: () => { S.tone({ f: 2200, dur: 0.1, type: "triangle", g: 0.12 * G }); S.tone({ f: 2960, t: 0.05, dur: 0.12, type: "triangle", g: 0.09 * G }); },
      psychic: () => { S.tone({ f: 700, f2: 1200, dur: 0.3, type: "sine", g: 0.08 * G }); S.tone({ f: 703, f2: 1207, dur: 0.3, type: "sine", g: 0.08 * G }); },
      ghost: () => S.tone({ f: 800, f2: 220, dur: 0.4, type: "sine", g: 0.12 * G, slideType: "exp" }),
      poison: () => { S.tone({ f: 250, f2: 120, dur: 0.2, type: "sine", g: 0.14 * G }); S.noise({ dur: 0.15, g: 0.05 * G, fLo: 200, fHi: 800 }); },
      ground: () => S.noise({ dur: 0.25, g: 0.2 * G, fLo: 60, fHi: 400, type: "lowpass" }),
      rock: () => { S.noise({ dur: 0.2, g: 0.2 * G, fLo: 100, fHi: 700, type: "lowpass" }); S.tone({ f: 130, dur: 0.12, type: "square", g: 0.1 * G }); },
      fighting: () => { S.noise({ dur: 0.1, g: 0.2 * G, fLo: 150, fHi: 900 }); S.tone({ f: 180, f2: 90, dur: 0.12, type: "square", g: 0.12 * G }); },
      flying: () => S.noise({ dur: 0.2, g: 0.12 * G, fLo: 600, fHi: 2400, fEnd: 3800 }),
      bug: () => { for (let i = 0; i < 3; i++) S.tone({ f: 1300 + i * 200, t: i * 0.04, dur: 0.04, type: "square", g: 0.07 * G }); },
      dragon: () => S.tone({ f: 320, f2: 110, dur: 0.35, type: "sawtooth", g: 0.13 * G }),
      normal: () => { S.noise({ dur: 0.09, g: 0.16 * G, fLo: 250, fHi: 1300 }); S.tone({ f: 200, f2: 110, dur: 0.1, type: "triangle", g: 0.12 * G }); },
    } as Record<string, () => void>)[type] || (() => {}))();
    // effectiveness accents that mirror the on-screen feedback
    if (eff > 1) {
      // super-effective: a bright rising sparkle, echoing the star burst
      S.tone({ f: crit ? 1568 : 1318, f2: crit ? 2637 : 1976, dur: 0.16, type: "triangle", g: 0.07 });
      S.tone({ f: 1976, t: 0.05, dur: 0.12, type: "sine", g: 0.045 });
    } else if (eff > 0 && eff < 1) {
      // not very effective: a short, low "clunk" that just thuds out
      S.tone({ f: 150, f2: 90, dur: 0.12, type: "sine", g: 0.06 });
    } else if (eff === 0) {
      // no effect: a flat, hollow tap
      S.tone({ f: 120, dur: 0.08, type: "sine", g: 0.05 });
    }
    if (crit) {
      // critical: a sharp crack and a downward zip over the base hit
      S.noise({ dur: 0.06, g: 0.16, fLo: 2000, fHi: 7000 });
      S.tone({ f: 2200, f2: 360, dur: 0.18, type: "square", g: 0.05 });
    }
  }

  // Launch SFX — the attack's "voice" as it fires, tinted by element and made
  // punchier for big moves / physical contact. Pairs with hit() so every move
  // reads as wind-up → impact.
  cast(type: string, opts: { big?: boolean; melee?: boolean; kind?: string } = {}) {
    this.ensure(); if (!this.ctx) return;
    const S = this;
    const big = !!opts.big;
    const melee = !!opts.melee || ["dash", "slash", "whip", "bone", "toss", "fly", "dig", "quake"].includes(opts.kind || "");
    const G = big ? 1.35 : 1;
    const whoosh = () => S.noise({ dur: 0.16, g: 0.05 * G, fLo: 400, fHi: 1800, fEnd: 2600 });
    // a physical wind-up gets an air-cutting swing under the elemental tint
    if (melee) S.noise({ dur: 0.16, g: 0.07 * G, fLo: 320, fHi: 1600, fEnd: 2600 });
    (({
      fire: () => S.noise({ dur: 0.26, g: 0.06 * G, fLo: 500, fHi: 2400, fEnd: 3200 }),
      water: () => { S.tone({ f: 300, f2: 720, dur: 0.2, type: "sine", g: 0.06 * G }); S.noise({ t: 0.02, dur: 0.18, g: 0.04 * G, fLo: 700, fHi: 2600, fEnd: 3400 }); },
      electric: () => { for (let i = 0; i < 3; i++) S.tone({ f: 700 + i * 380, t: i * 0.03, dur: 0.05, type: "square", g: 0.05 * G }); },
      grass: () => S.noise({ dur: 0.2, g: 0.06 * G, fLo: 1400, fHi: 5200, fEnd: 2000 }),
      ice: () => { S.tone({ f: 1600, f2: 2600, dur: 0.18, type: "triangle", g: 0.05 * G }); S.tone({ f: 2100, f2: 3200, t: 0.04, dur: 0.16, type: "triangle", g: 0.035 * G }); },
      psychic: () => { S.tone({ f: 480, f2: 1100, dur: 0.26, type: "sine", g: 0.05 * G }); S.tone({ f: 484, f2: 1107, dur: 0.26, type: "sine", g: 0.05 * G }); },
      ghost: () => S.tone({ f: 900, f2: 300, dur: 0.3, type: "sine", g: 0.06 * G }),
      poison: () => { S.tone({ f: 200, f2: 380, dur: 0.22, type: "sine", g: 0.06 * G }); S.noise({ dur: 0.2, g: 0.03 * G, fLo: 200, fHi: 900 }); },
      ground: () => S.tone({ f: 90, f2: 220, dur: 0.26, type: "sawtooth", g: 0.08 * G }),
      rock: () => S.tone({ f: 120, f2: 260, dur: 0.22, type: "square", g: 0.07 * G }),
      fighting: () => S.tone({ f: 180, f2: 320, dur: 0.12, type: "square", g: 0.07 * G }),
      flying: () => S.noise({ dur: 0.24, g: 0.06 * G, fLo: 500, fHi: 2200, fEnd: 3600 }),
      bug: () => { for (let i = 0; i < 4; i++) S.tone({ f: 1500 + i * 120, t: i * 0.03, dur: 0.03, type: "square", g: 0.035 * G }); },
      dragon: () => S.tone({ f: 160, f2: 520, dur: 0.3, type: "sawtooth", g: 0.07 * G }),
      normal: () => { if (!melee) whoosh(); },
    } as Record<string, () => void>)[type] || (() => { if (!melee) whoosh(); }))();
  }

  // --- continuous rain loop (level 0..1), call every frame --------------
  rain(level: number, dt: number) {
    if (!this.ctx || !this.master) { this.rainLevel = level; return; }
    this.rainLevel += (level - this.rainLevel) * Math.min(1, dt * 1.5);
    if (this.rainLevel > 0.02 && !this.rainSrc) {
      const c = this.ctx;
      const len = Math.floor(c.sampleRate * 2);
      const buf = c.createBuffer(1, len, c.sampleRate);
      const d = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.04 * w) / 1.04; d[i] = last * 4; }
      const src = c.createBufferSource(); src.buffer = buf; src.loop = true;
      const flt = c.createBiquadFilter(); flt.type = "bandpass"; flt.frequency.value = 1300; flt.Q.value = 0.4;
      const gn = c.createGain(); gn.gain.value = 0;
      src.connect(flt); flt.connect(gn); gn.connect(this.master);
      src.start();
      this.rainSrc = src; this.rainGain = gn;
    }
    if (this.rainGain) this.rainGain.gain.value = this.rainLevel * 0.16;
    if (this.rainLevel <= 0.02 && this.rainSrc) {
      this.rainSrc.stop(); this.rainSrc.disconnect();
      this.rainSrc = null; this.rainGain = null;
    }
  }

  // ambient scheduler, call every frame
  ambient(dt: number, biome: string, night: boolean, inBattle: boolean, inCave = false) {
    if (!this.ctx || inBattle) return;
    this.ambT -= dt;
    if (this.ambT > 0) return;
    this.ambT = 2.5 + Math.random() * 5;
    const r = Math.random;
    if (inCave || biome === "cave") {
      this.play("drip");
      if (r() < 0.25) this.play("bats");
      this.tone({ f: 660, t: 0.12, dur: 0.5, type: "sine", g: 0.012 });
    } else if (night) { // crickets
      for (let i = 0; i < 5; i++) this.tone({ f: 2300 + r() * 180, t: i * 0.07, dur: 0.045, type: "triangle", g: 0.012 });
    } else if (biome === "forest" || biome === "grass" || biome === "town") { // birds
      const base = 1800 + r() * 1100;
      this.tone({ f: base, f2: base * 1.4, dur: 0.09, type: "sine", g: 0.02 });
      this.tone({ f: base * 1.2, f2: base * 0.9, t: 0.13, dur: 0.1, type: "sine", g: 0.016 });
    } else if (biome === "lake") {
      this.noise({ dur: 1.4, g: 0.012, fLo: 300, fHi: 900, fEnd: 250 });
    } else if (biome === "mountain") {
      this.noise({ dur: 1.8, g: 0.01, fLo: 500, fHi: 1600, fEnd: 700 });
    }
  }
}
