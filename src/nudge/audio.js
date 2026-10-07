/*
 * Nudge — soft synthesized sound. Silent until the first click or key.
 */
(function (root) {
  'use strict';
  const Lab = root.Lab;
  const Nudge = (Lab.Nudge = Lab.Nudge || {});

  const Audio = {
    ctx: null,
    muted: false,
    last: {},
    unlock() {
      if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return;
      try {
        const c = (this.ctx = new AC());
        this.out = c.createGain();
        this.out.gain.value = this.muted ? 0 : 0.5;
        this.out.connect(c.destination);
        const len = c.sampleRate * 2;
        const buf = c.createBuffer(1, len, c.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        this.noise = buf;
        // A wind bed for the frost plain, and a hum that rises as a wall strains.
        const src = c.createBufferSource();
        src.buffer = buf; src.loop = true;
        const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 500; f.Q.value = 0.5;
        this.wind = c.createGain(); this.wind.gain.value = 0;
        src.connect(f); f.connect(this.wind); this.wind.connect(this.out);
        src.start();
        this.hum = c.createOscillator();
        this.hum.type = 'sine';
        this.hum.frequency.value = 60;
        this.humGain = c.createGain(); this.humGain.gain.value = 0;
        this.hum.connect(this.humGain); this.humGain.connect(this.out);
        this.hum.start();
      } catch { this.ctx = null; }
    },
    setMuted(m) {
      this.muted = m;
      if (this.out) this.out.gain.setTargetAtTime(m ? 0 : 0.5, this.ctx.currentTime, 0.05);
    },
    tone(freq, dur, gain, delay = 0, to, type = 'sine') {
      if (!this.ctx) return;
      const c = this.ctx, t = c.currentTime + delay;
      const o = c.createOscillator(), g = c.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.out);
      o.start(t); o.stop(t + dur + 0.05);
    },
    hiss(dur, gain, freq, delay = 0) {
      if (!this.ctx) return;
      const c = this.ctx, t = c.currentTime + delay;
      const s = c.createBufferSource(); s.buffer = this.noise;
      const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 1.2;
      const g = c.createGain();
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(f); f.connect(g); g.connect(this.out);
      s.start(t, Math.random()); s.stop(t + dur + 0.05);
    },
    /** Rate-limit a kind of sound. */
    ok(kind, ms) {
      const now = performance.now();
      if (now - (this.last[kind] || 0) < ms) return false;
      this.last[kind] = now;
      return true;
    },
    ambience(wind, strain) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      this.wind.gain.setTargetAtTime(0.05 * wind, t, 0.6);
      this.humGain.gain.setTargetAtTime(strain > 0.6 ? 0.07 * (strain - 0.6) * 2.5 : 0, t, 0.15);
      this.hum.frequency.setTargetAtTime(55 + 60 * Math.min(1.3, strain), t, 0.2);
    },
    play(ev) {
      if (!this.ctx) return;
      switch (ev.type) {
        case 'impact': {
          if (!this.ok('impact', 70)) return;
          const f = 480 - Math.min(300, ev.P * 6);
          this.tone(f, 0.12, Math.min(0.12, 0.02 + ev.P * 0.004), 0, f * 0.7);
          break;
        }
        case 'hit':
          this.tone(150, 0.18, 0.18, 0, 80, 'triangle');
          this.hiss(0.12, 0.12, 1200);
          break;
        case 'shatter':
          [2093, 1760, 1397, 1175, 880].forEach((f, i) => this.tone(f, 0.25, 0.05, i * 0.035, f * 0.8, 'triangle'));
          this.hiss(0.35, 0.18, 3000);
          break;
        case 'respawn': this.tone(392, 0.18, 0.06, 0, 784); break;
        case 'checkpoint': this.tone(659, 0.25, 0.06); this.tone(988, 0.4, 0.05, 0.1); break;
        case 'fragment': [523.3, 659.3, 784, 1046.5].forEach((f, i) => this.tone(f, 0.9, 0.07, i * 0.09)); break;
        case 'socket': [392, 523.3, 659.3, 784, 1046.5, 1318.5].forEach((f, i) => this.tone(f, 2.4, 0.06, i * 0.12)); break;
        case 'break':
          [880, 1175, 1397, 1760].forEach((f, i) => this.tone(f, 1.2, 0.07, i * 0.05));
          this.tone(140, 0.9, 0.2, 0, 60);
          this.hiss(0.6, 0.15, 900);
          break;
        case 'pop': if (this.ok('pop', 40)) { const f = 900 + Math.random() * 500; this.tone(f, 0.09, 0.025, 0, f * 1.6); } break;
        case 'grab': this.tone(620, 0.08, 0.05, 0, 820); break;
        case 'release': this.tone(700, 0.08, 0.04, 0, 520); break;
        case 'gate': this.hiss(0.5, 0.1, 600); this.tone(330, 0.5, 0.05, 0, 660); break;
        case 'galileo':
          if (ev.ok) [784, 988, 1175].forEach((f, i) => this.tone(f, 0.7, 0.06, i * 0.08));
          else this.tone(220, 0.35, 0.08, 0, 180, 'square');
          break;
        case 'latch': case 'pin': this.tone(1400, 0.05, 0.05, 0, 900, 'square'); break;
        case 'drop': this.tone(1200, 0.9, 0.03, 0, 300); break;
        case 'icicle': if (this.ok('icicle', 120)) this.tone(2600 + Math.random() * 600, 0.15, 0.02, 0, 1800, 'triangle'); break;
        default: break;
      }
    },
  };

  Nudge.Audio = Audio;
})(typeof window !== 'undefined' ? window : globalThis);
