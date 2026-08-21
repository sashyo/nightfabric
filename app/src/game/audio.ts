/**
 * Procedural SFX + an ambient pad, synthesised in WebAudio.
 *
 * No asset files: everything is oscillators and noise bursts, so it is
 * CSP-safe, works offline, and adds nothing to the bundle. The city was silent
 * and silence made it feel like a screenshot; a few blips make it a place.
 *
 * Browsers block audio until a user gesture, so nothing sounds until the first
 * click (which is also when the player enters pointer-lock). Muteable.
 */

type Wave = OscillatorType;

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private pad: GainNode | null = null;
  private muted = false;

  private music: GainNode | null = null;
  private musicTimer: number | null = null;
  private step16 = 0;
  private nextNote = 0;
  private mood: "city" | "festival" = "city";
  /** The MUSIC bus (pad + techno). Separate from SFX so M toggles only the
   *  soundtrack. Off by default — interactions still make sound. */
  private musicBus: GainNode | null = null;
  private musicOn = false;

  /** Call from a user gesture (the canvas click) so the context is allowed. */
  resume() {
    if (!this.ctx) {
      const AC = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;               // SFX are always audible
      this.master.connect(this.ctx.destination);
      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = this.musicOn ? 0.85 : 0;   // music OFF by default
      this.musicBus.connect(this.master);
      this.startPad();
      this.startMusic();
    }
    if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
  }

  /** Toggle just the soundtrack (M). SFX are unaffected. */
  setMusic(on: boolean) {
    this.musicOn = on;
    if (this.musicBus && this.ctx) this.musicBus.gain.setTargetAtTime(on ? 0.85 : 0, this.ctx.currentTime, 0.05);
  }
  toggleMusic(): boolean { this.setMusic(!this.musicOn); return this.musicOn; }
  get musicPlaying() { return this.musicOn; }

  /** Shift the techno soundtrack's mood — brighter and busier in the golden Core. */
  setMood(m: "city" | "festival") { this.mood = m; }

  /* ------------------------------- hard Berlin techno engine (Brutalismus) */
  private static BPM = 145;                 // driving four-on-the-floor
  private drive: WaveShaperNode | null = null;
  private makeCurve(amount: number): Float32Array {
    const n = 1024, c = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i / n) * 2 - 1; c[i] = ((1 + amount) * x) / (1 + amount * Math.abs(x)); }
    return c;
  }
  private startMusic() {
    if (!this.ctx || !this.musicBus) return;
    // music -> saturation (dirt) -> MUSIC bus (so M can mute just this)
    this.drive = this.ctx.createWaveShaper();
    (this.drive as any).curve = this.makeCurve(2.9);
    this.drive.oversample = "2x";
    const post = this.ctx.createBiquadFilter(); post.type = "lowpass"; post.frequency.value = 5200;
    this.drive.connect(post); post.connect(this.musicBus);
    this.music = this.ctx.createGain();
    this.music.gain.value = 0.62;
    this.music.connect(this.drive);
    this.startCrackle();
    this.nextNote = this.ctx.currentTime + 0.1;
    this.step16 = 0;
    const spb = 60 / Sfx.BPM;
    const step = spb / 4; // 16th
    const tick = () => {
      if (!this.ctx || !this.music) return;
      while (this.nextNote < this.ctx.currentTime + 0.12) {
        this.scheduleStep(this.step16, this.nextNote);
        this.nextNote += step;
        this.step16 = (this.step16 + 1) % 32; // two-bar loop
      }
      this.musicTimer = window.setTimeout(tick, 25);
    };
    tick();
  }

  private mKick(t: number) {
    if (!this.ctx || !this.music) return;
    // hard techno kick: sharp click transient + a punchy body that snaps shut,
    // hammered by the saturation bus. Short, so it pounds rather than booms.
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(200, t);
    o.frequency.exponentialRampToValueAtTime(46, t + 0.06);
    g.gain.setValueAtTime(1.25, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
    o.connect(g).connect(this.music);
    o.start(t); o.stop(t + 0.26);
    const n = this.noiseBurst(t, 0.008, 0.7, 2200); if (n) n.connect(this.music);
  }
  /** The rolling Berlin rumble: a low distorted tone that DUCKS on each kick and
   *  swells back between hits — the pumping engine under everything. */
  private mRumble(root: number, t: number, dur: number) {
    if (!this.ctx || !this.music) return;
    const o = this.ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = root;
    const o2 = this.ctx.createOscillator(); o2.type = "sine"; o2.frequency.value = root / 2;
    const lp = this.ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = this.mood === "festival" ? 420 : 300; lp.Q.value = 3;
    const g = this.ctx.createGain();
    // ducked: silent at the kick, swells up, so the beat "breathes"
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.34, t + dur * 0.55);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(lp); o2.connect(lp); lp.connect(g).connect(this.music);
    o.start(t); o.stop(t + dur + 0.02); o2.start(t); o2.stop(t + dur + 0.02);
  }
  /** Cracked, distorted 808 cowbell — the phonk signature. Two squares at a
   *  ~1:1.48 ratio through a resonant bandpass, then the saturation bus. */
  private mCowbell(root: number, t: number, dur: number, vol: number) {
    if (!this.ctx || !this.music) return;
    const bp = this.ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = root * 1.5; bp.Q.value = 3.5;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    for (const f of [root, root * 1.48]) {
      const o = this.ctx.createOscillator(); o.type = "square"; o.frequency.value = f;
      o.connect(bp); o.start(t); o.stop(t + dur + 0.02);
    }
    bp.connect(g).connect(this.music);
  }
  /** Continuous vinyl crackle + hiss under everything for the lo-fi grit. */
  private startCrackle() {
    if (!this.ctx || !this.music) return;
    const secs = 4, len = this.ctx.sampleRate * secs;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() < 0.004 ? (Math.random() * 2 - 1) : 0);
    const s = this.ctx.createBufferSource(); s.buffer = buf; s.loop = true;
    const f = this.ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 3200; f.Q.value = 0.6;
    const g = this.ctx.createGain(); g.gain.value = 0.04;
    s.connect(f).connect(g).connect(this.music); s.start();
  }
  private mHat(t: number, open: boolean) {
    if (!this.ctx || !this.music) return;
    // crisp, tight hats — short and high-passed so they tick, not hiss
    const src = this.noiseBurst(t, open ? 0.06 : 0.018, open ? 0.1 : 0.07, 10500);
    if (src) src.connect(this.music);
  }
  private noiseBurst(t: number, dur: number, vol: number, hp: number): AudioNode | null {
    if (!this.ctx) return null;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
    const s = this.ctx.createBufferSource(); s.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = "highpass"; f.frequency.value = hp;
    const g = this.ctx.createGain(); g.gain.value = vol;
    s.connect(f).connect(g); s.start(t);
    return g;
  }
  /** 303-ish acid bass: saw → resonant lowpass with a filter envelope. */
  private mBass(freq: number, t: number, dur: number, accent: boolean) {
    if (!this.ctx || !this.music) return;
    // 808 sub bass: a sine with a quick pitch glide, fattened by a low saw. The
    // saturation bus turns it into the distorted phonk sub.
    const o = this.ctx.createOscillator(); o.type = "sine";
    o.frequency.setValueAtTime(freq * 1.6, t);
    o.frequency.exponentialRampToValueAtTime(freq, t + 0.05);
    const saw = this.ctx.createOscillator(); saw.type = "sawtooth"; saw.frequency.value = freq;
    const lp = this.ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = this.mood === "festival" ? 900 : 620; lp.Q.value = 2;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(accent ? 0.5 : 0.36, t + 0.014);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); saw.connect(lp).connect(g); g.connect(this.music);
    o.start(t); o.stop(t + dur + 0.02); saw.start(t); saw.stop(t + dur + 0.02);
  }
  private mClap(t: number) {
    if (!this.ctx || !this.music) return;
    for (const off of [0, 0.007, 0.014]) { const src = this.noiseBurst(t + off, 0.05, 0.2, 1400); if (src) src.connect(this.music); }
  }
  private mStab(freqs: number[], t: number, dur: number, vol: number) {
    if (!this.ctx || !this.music) return;
    for (const fr of freqs) {
      const o = this.ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = fr;
      const f = this.ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = this.mood === "festival" ? 3200 : 1800; f.Q.value = 4;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(f).connect(g).connect(this.music); o.start(t); o.stop(t + dur + 0.02);
    }
  }

  /** A 303-style resonant acid stab — screams once it hits the saturation bus. */
  private mAcid(freq: number, t: number, dur: number, accent: boolean) {
    if (!this.ctx || !this.music) return;
    const o = this.ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = freq;
    const f = this.ctx.createBiquadFilter(); f.type = "lowpass"; f.Q.value = accent ? 15 : 11;
    const base = this.mood === "festival" ? 700 : 440;
    f.frequency.setValueAtTime(base * (accent ? 7 : 3.5), t);
    f.frequency.exponentialRampToValueAtTime(base, t + dur * 0.9);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(accent ? 0.16 : 0.11, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f).connect(g).connect(this.music);
    o.start(t); o.stop(t + dur + 0.02);
  }
  /** A bright, plucky lead for the catchy top-line hook (two detuned squares). */
  private mLead(freq: number, t: number, dur: number, vol: number) {
    if (!this.ctx || !this.music) return;
    const f = this.ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = this.mood === "festival" ? 5200 : 3600; f.Q.value = 1;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    for (const df of [1, 1.006]) {
      const o = this.ctx.createOscillator(); o.type = "square"; o.frequency.value = freq * df;
      o.connect(f); o.start(t); o.stop(t + dur + 0.02);
    }
    f.connect(g).connect(this.music);
  }

  private scheduleStep(s: number, t: number) {
    const spb = 60 / Sfx.BPM, step = spb / 4;
    const bar = Math.floor(s / 16), b = s % 16;
    // Dark, hypnotic 2-bar loop: A minor, dropping to G. Minimal and pounding.
    const root = bar === 0 ? 55.0 : 48.99; // A1 / G1
    // KICK — relentless four-on-the-floor
    if (b % 4 === 0) this.mKick(t);
    // RUMBLE — ducked, one swell per beat: the rolling Berlin engine
    if (b % 4 === 0) this.mRumble(root, t, spb * 0.98);
    // CLAP — backbeat snap
    if (b === 4 || b === 12) this.mClap(t);
    // OPEN HAT — the driving offbeat "tss"
    if (b % 4 === 2) this.mHat(t, true);
    // CLOSED HATS — tight 16th ticks on the in-betweens
    if (b % 4 === 1 || b % 4 === 3) this.mHat(t, false);
    // RAVE STAB — a hypnotic minor chord, syncopated. This is the hook.
    const stabPat = [1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0];
    if (stabPat[b]) {
      const third = root * 4 * Math.pow(2, 3 / 12), fifth = root * 4 * Math.pow(2, 7 / 12);
      this.mStab([root * 4, third, fifth], t, step * 1.3, this.mood === "festival" ? 0.12 : 0.08);
    }
    // ACID LINE — a relentless resonant riff on the 8ths, accents on the beat
    const acid = [0, null, 12, null, 3, null, 12, null, 0, null, 7, null, 3, null, 10, null];
    if (acid[b] !== null) this.mAcid(root * 4 * Math.pow(2, (acid[b] as number) / 12), t, step * 1.6, b % 4 === 0);
    // LEAD HOOK — the catchy top line: a simple singable arch (A A C D E D C A),
    // two octaves up, on the 8ths. Repeats each bar; the Am->G root shift varies it.
    const lead = [0, null, 0, null, 3, null, 5, null, 7, null, 5, null, 3, null, 0, null];
    if (lead[b] !== null) this.mLead(root * 8 * Math.pow(2, (lead[b] as number) / 12), t, step * 1.5, this.mood === "festival" ? 0.14 : 0.1);
    // FESTIVAL: an octave-up sparkle over the lead
    if (this.mood === "festival" && lead[b] !== null) this.blipAt(root * 16 * Math.pow(2, (lead[b] as number) / 12), t, step * 0.6, "square", 0.045);
  }
  private blipAt(freq: number, t: number, dur: number, wave: Wave, vol: number) {
    if (!this.ctx || !this.music) return;
    const o = this.ctx.createOscillator(); o.type = wave; o.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.music); o.start(t); o.stop(t + dur + 0.02);
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  }
  get isMuted() {
    return this.muted;
  }

  /** A low rain/synth pad — part of the soundtrack, so it rides the music bus. */
  private startPad() {
    if (!this.ctx || !this.musicBus) return;
    this.pad = this.ctx.createGain();
    this.pad.gain.value = 0.05;
    this.pad.connect(this.musicBus);
    for (const [freq, detune] of [[55, 0], [82.4, 6], [110, -5]] as [number, number][]) {
      const o = this.ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = freq;
      o.detune.value = detune;
      const lp = this.ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 320;
      const g = this.ctx.createGain();
      g.gain.value = 0.5;
      o.connect(lp).connect(g).connect(this.pad);
      o.start();
      // Slow filter drift so the pad breathes.
      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = 0.05 + Math.random() * 0.08;
      const lfoG = this.ctx.createGain();
      lfoG.gain.value = 120;
      lfo.connect(lfoG).connect(lp.frequency);
      lfo.start();
    }
  }

  private blip(freq: number, dur: number, wave: Wave = "square", vol = 0.3, slideTo?: number) {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = wave;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(dur: number, vol = 0.3, hp = 800) {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = hp;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
  }

  /** Named cues — one per game event. */
  play(kind: string) {
    switch (kind) {
      case "jack": this.blip(660, 0.12, "square", 0.28, 1320); break;
      case "seal": this.blip(880, 0.16, "triangle", 0.26, 440); this.blip(1320, 0.1, "sine", 0.14); break;
      case "decrypt": this.blip(440, 0.2, "sine", 0.24, 1760); break;
      case "deny": this.blip(220, 0.18, "sawtooth", 0.3, 90); this.noise(0.12, 0.15, 400); break;
      case "gate": this.blip(520, 0.08, "square", 0.2); break;
      case "open": this.blip(587, 0.14, "triangle", 0.24, 1174); break;
      case "chat": this.blip(1046, 0.05, "sine", 0.12); break;
      case "hack": this.blip(330, 0.09, "sawtooth", 0.22); this.blip(495, 0.09, "sawtooth", 0.16); break;
      case "ice-held": this.blip(784, 0.12, "square", 0.24, 1568); break;
      case "sign": this.blip(659, 0.1, "triangle", 0.22); this.blip(988, 0.12, "triangle", 0.2); break;
      case "commit": this.blip(523, 0.1, "square", 0.24); this.blip(659, 0.1, "square", 0.24); this.blip(784, 0.16, "square", 0.26); break;
      case "claw": this.blip(300, 0.3, "square", 0.2, 900); break;
      case "juke": this.blip(440, 0.5, "sawtooth", 0.18, 660); break;
      case "boom": this.noise(0.9, 0.5, 60); this.blip(80, 0.9, "sawtooth", 0.4, 30); break;
      case "join": this.blip(392, 0.08, "sine", 0.16); this.blip(587, 0.1, "sine", 0.16); break;
      case "emote": this.blip(1318, 0.06, "sine", 0.14); break;
      default: break;
    }
  }
}
