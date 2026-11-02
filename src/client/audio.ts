/**
 * 소리. 효과음과 배경음은 모두 Web Audio로 합성합니다.
 * assets/manifest.json에 파일이 있으면 그 파일을 대신 재생합니다.
 */
import { manifest, type SoundName } from './assets';
import { onSettings, settings } from './settings';

const D_DORIAN = [146.83, 164.81, 174.61, 196.0, 220.0, 246.94, 261.63, 293.66, 329.63, 349.23, 392.0, 440.0];

class Audio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private reverb!: ConvolverNode;
  private wet!: GainNode;
  private buffers = new Map<string, AudioBuffer | null>();
  private musicOn = false;
  private musicTimer: number | null = null;
  private musicFile: AudioBufferSourceNode | null = null;
  private nextNote = 0;
  private droneNodes: AudioNode[] = [];
  private lastPlay = new Map<SoundName, number>();

  constructor() {
    onSettings((s) => {
      if (!this.ctx) return;
      this.sfxBus.gain.setTargetAtTime(s.sfx, this.ctx.currentTime, 0.05);
      this.musicBus.gain.setTargetAtTime(s.music * 0.55, this.ctx.currentTime, 0.2);
    });
  }

  /** 사용자가 처음 누를 때 깨운다 (브라우저 정책) */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 3;
    this.master.connect(comp).connect(ctx.destination);
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = settings.sfx;
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = settings.music * 0.55;
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(3.2, 2.6);
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.32;
    this.sfxBus.connect(this.master);
    this.musicBus.connect(this.master);
    this.sfxBus.connect(this.wet);
    this.musicBus.connect(this.wet);
    this.wet.connect(this.reverb).connect(this.master);
    void this.preload();
  }

  private impulse(seconds: number, decay: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** decay;
    }
    return buf;
  }

  private async preload() {
    const entries = Object.entries(manifest.audio).filter(([, v]) => v) as [string, string][];
    await Promise.all(entries.map(async ([name, url]) => {
      try {
        const res = await fetch(url);
        const arr = await res.arrayBuffer();
        this.buffers.set(name, await this.ctx!.decodeAudioData(arr));
      } catch { this.buffers.set(name, null); }
    }));
    if (this.musicOn) this.startMusic(true);
  }

  private noise(dur: number): AudioBufferSourceNode {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * dur)), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    return src;
  }

  private env(g: GainNode, t: number, peak: number, attack: number, decay: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  private tone(freq: number, t: number, opts: { type?: OscillatorType; peak?: number; attack?: number; decay?: number; detune?: number; to?: number; bus?: AudioNode } = {}) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = opts.type ?? 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (opts.to) o.frequency.exponentialRampToValueAtTime(opts.to, t + (opts.attack ?? 0.01) + (opts.decay ?? 0.3));
    if (opts.detune) o.detune.value = opts.detune;
    this.env(g, t, opts.peak ?? 0.3, opts.attack ?? 0.005, opts.decay ?? 0.3);
    o.connect(g).connect(opts.bus ?? this.sfxBus);
    o.start(t);
    o.stop(t + (opts.attack ?? 0.005) + (opts.decay ?? 0.3) + 0.05);
  }

  private hiss(t: number, dur: number, opts: { type?: BiquadFilterType; f0: number; f1?: number; q?: number; peak?: number; attack?: number }) {
    const ctx = this.ctx!;
    const src = this.noise(dur + 0.05);
    const f = ctx.createBiquadFilter();
    f.type = opts.type ?? 'bandpass';
    f.Q.value = opts.q ?? 1;
    f.frequency.setValueAtTime(opts.f0, t);
    if (opts.f1) f.frequency.exponentialRampToValueAtTime(opts.f1, t + dur);
    const g = ctx.createGain();
    this.env(g, t, opts.peak ?? 0.3, opts.attack ?? 0.005, dur);
    src.connect(f).connect(g).connect(this.sfxBus);
    src.start(t);
    src.stop(t + dur + 0.1);
  }

  private bell(freq: number, t: number, peak = 0.18, decay = 2.4) {
    for (const [ratio, amp] of [[1, 1], [2.76, 0.5], [5.4, 0.25], [8.93, 0.12], [0.5, 0.35]] as const) {
      this.tone(freq * ratio, t, { peak: peak * amp, attack: 0.004, decay: decay / Math.sqrt(ratio) });
    }
  }

  private pluck(freq: number, t: number, peak = 0.12, bus?: AudioNode) {
    this.tone(freq, t, { type: 'triangle', peak, attack: 0.004, decay: 1.1, bus });
    this.tone(freq * 2, t, { type: 'sine', peak: peak * 0.35, attack: 0.003, decay: 0.5, bus });
    this.tone(freq * 3.01, t, { type: 'sine', peak: peak * 0.12, attack: 0.002, decay: 0.25, bus });
  }

  play(name: SoundName) {
    const ctx = this.ctx;
    if (!ctx || settings.sfx <= 0) return;
    const nowMs = performance.now();
    if ((this.lastPlay.get(name) ?? 0) > nowMs - 40) return;
    this.lastPlay.set(name, nowMs);
    const file = this.buffers.get(name);
    const t = ctx.currentTime + 0.005;
    if (file) {
      const src = ctx.createBufferSource();
      src.buffer = file;
      src.connect(this.sfxBus);
      src.start(t);
      return;
    }
    switch (name) {
      case 'hover':
        this.tone(1800, t, { peak: 0.025, decay: 0.03 });
        break;
      case 'click':
        this.tone(320, t, { type: 'triangle', peak: 0.16, decay: 0.07, to: 180 });
        this.hiss(t, 0.03, { f0: 3500, q: 2, peak: 0.08 });
        break;
      case 'select':
        this.tone(440, t, { type: 'triangle', peak: 0.12, decay: 0.12, to: 330 });
        this.tone(880, t, { peak: 0.04, decay: 0.08 });
        break;
      case 'move':
        this.hiss(t, 0.18, { f0: 900, f1: 400, q: 1.5, peak: 0.12, attack: 0.04 });
        this.tone(160, t + 0.16, { type: 'triangle', peak: 0.22, decay: 0.12, to: 110 });
        break;
      case 'execute':
        this.hiss(t, 0.22, { f0: 6000, f1: 700, q: 3, peak: 0.22, attack: 0.02 });
        for (const r of [1, 2.3, 3.7, 5.1]) this.tone(560 * r, t + 0.16, { type: 'square', peak: 0.03 / r, decay: 0.5 / r });
        this.tone(90, t + 0.18, { peak: 0.5, decay: 0.45, to: 45 });
        break;
      case 'death':
        this.tone(70, t, { peak: 0.45, decay: 0.9, to: 38 });
        this.hiss(t, 0.5, { type: 'lowpass', f0: 600, f1: 120, peak: 0.12 });
        break;
      case 'blocked':
        this.bell(660, t, 0.1, 1.4);
        this.tone(1320, t, { peak: 0.06, attack: 0.2, decay: 1.2 });
        break;
      case 'bribe':
        for (let i = 0; i < 7; i++) {
          const tt = t + i * 0.055 + Math.random() * 0.03;
          this.tone(2200 + Math.random() * 1600, tt, { peak: 0.07, decay: 0.18 });
          this.tone(4100 + Math.random() * 900, tt, { peak: 0.025, decay: 0.08 });
        }
        break;
      case 'bribeFail':
        for (let i = 0; i < 3; i++) this.tone(2600 + Math.random() * 600, t + i * 0.07, { peak: 0.06, decay: 0.12 });
        this.tone(110, t + 0.25, { type: 'triangle', peak: 0.25, decay: 0.3, to: 80 });
        break;
      case 'card':
        this.hiss(t, 0.12, { type: 'highpass', f0: 2500, f1: 5000, peak: 0.12, attack: 0.02 });
        break;
      case 'seal':
        this.tone(120, t, { peak: 0.35, decay: 0.2, to: 70 });
        this.hiss(t + 0.03, 0.25, { f0: 2400, q: 0.7, peak: 0.06 });
        break;
      case 'news':
        this.bell(392, t, 0.16, 2.8);
        this.bell(293.66, t + 0.42, 0.12, 2.6);
        break;
      case 'turnMine':
        [0, 2, 4, 7].forEach((k, i) => this.pluck(D_DORIAN[k + 2], t + i * 0.09, 0.1));
        break;
      case 'turnTheirs':
        this.pluck(D_DORIAN[0], t, 0.12);
        this.pluck(D_DORIAN[2], t + 0.14, 0.07);
        break;
      case 'royal':
        [0, 4, 7, 12].forEach((s, i) => {
          const f = 146.83 * 2 ** (s / 12);
          this.tone(f, t + i * 0.08, { type: 'sawtooth', peak: 0.06, attack: 0.03, decay: 0.7 });
        });
        break;
      case 'bless':
        for (const f of [587.33, 739.99, 880, 1174.66]) this.tone(f, t, { peak: 0.045, attack: 0.35, decay: 1.6 });
        break;
      case 'poison':
        for (let i = 0; i < 6; i++) this.tone(500 - i * 50 + Math.random() * 60, t + i * 0.08, { peak: 0.06, decay: 0.1, to: 220 });
        break;
      case 'tick':
        this.tone(1400, t, { type: 'square', peak: 0.04, decay: 0.03 });
        break;
      case 'exposed':
        for (const f of [73.42, 77.78, 110, 116.54]) this.tone(f, t, { type: 'sawtooth', peak: 0.07, attack: 0.05, decay: 1.8 });
        this.bell(220, t, 0.08, 2);
        break;
      case 'victory':
        [[146.83, 0], [220, 0.05], [293.66, 0.1], [369.99, 0.15], [440, 0.2], [587.33, 0.5]].forEach(([f, d]) =>
          this.tone(f, t + d, { type: 'triangle', peak: 0.08, attack: 0.08, decay: 2.4 }));
        this.bell(587.33, t + 0.5, 0.1, 3);
        break;
      case 'defeat':
        [[73.42, 0], [87.31, 0.2], [110, 0.4], [103.83, 0.9]].forEach(([f, d]) =>
          this.tone(f, t + d, { type: 'sawtooth', peak: 0.06, attack: 0.1, decay: 2.2 }));
        break;
      case 'roundStart':
        this.tone(55, t, { peak: 0.5, decay: 0.6, to: 40 });
        this.bell(293.66, t + 0.25, 0.12, 2.6);
        break;
      case 'match':
        this.bell(293.66, t, 0.14, 2.6);
        this.bell(440, t + 0.3, 0.1, 2.4);
        break;
      case 'error':
        this.tone(180, t, { type: 'square', peak: 0.06, decay: 0.12, to: 140 });
        break;
    }
  }

  /* ── 배경음 ───────────────────────────────────── */
  startMusic(force = false) {
    if (!this.ctx || (this.musicOn && !force)) return;
    this.musicOn = true;
    this.stopMusicNodes();
    const file = this.buffers.get('music');
    const ctx = this.ctx;
    if (file) {
      const src = ctx.createBufferSource();
      src.buffer = file;
      src.loop = true;
      src.connect(this.musicBus);
      src.start();
      this.musicFile = src;
      return;
    }
    // 낮은 오르간 드론: D2 + A2, 천천히 숨 쉬는 필터
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 520;
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.045;
    lfoGain.gain.value = 260;
    lfo.connect(lfoGain).connect(lp.frequency);
    const dg = ctx.createGain();
    dg.gain.setValueAtTime(0.0001, ctx.currentTime);
    dg.gain.exponentialRampToValueAtTime(0.11, ctx.currentTime + 4);
    for (const [f, type] of [[73.42, 'sawtooth'], [110, 'sawtooth'], [146.83, 'triangle'], [73.6, 'sine']] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.connect(lp);
      o.start();
      this.droneNodes.push(o);
    }
    lp.connect(dg).connect(this.musicBus);
    lfo.start();
    this.droneNodes.push(lfo, lp, dg);
    this.nextNote = ctx.currentTime + 1.5;
    this.musicTimer = window.setInterval(() => this.scheduleNotes(), 400);
  }

  private scheduleNotes() {
    if (!this.ctx || !this.musicOn) return;
    const ctx = this.ctx;
    while (this.nextNote < ctx.currentTime + 2) {
      const r = Math.random();
      if (r < 0.62) {
        const idx = Math.floor(Math.random() * 8) + (Math.random() < 0.3 ? 4 : 0);
        this.pluck(D_DORIAN[Math.min(idx, D_DORIAN.length - 1)], this.nextNote, 0.05, this.musicBus);
      } else if (r < 0.7) {
        this.bell(146.83, this.nextNote, 0.035, 4);
      }
      this.nextNote += [0.9, 1.35, 1.8, 2.7, 3.6][Math.floor(Math.random() * 5)];
    }
  }

  private stopMusicNodes() {
    if (this.musicTimer) clearInterval(this.musicTimer);
    this.musicTimer = null;
    for (const n of this.droneNodes) {
      try { (n as OscillatorNode).stop?.(); } catch { /* 이미 멈춤 */ }
      try { n.disconnect(); } catch { /* 무시 */ }
    }
    this.droneNodes = [];
    if (this.musicFile) { try { this.musicFile.stop(); } catch { /* 무시 */ } this.musicFile = null; }
  }

  stopMusic() {
    this.musicOn = false;
    this.stopMusicNodes();
  }
}

export const audio = new Audio();
