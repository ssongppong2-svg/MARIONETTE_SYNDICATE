/*
 * Force Chamber — synthesized sound
 * WebAudio only starts after a user gesture; until then every call is a no-op.
 */
(function (root) {
  'use strict';
  const Lab = (root.Lab = root.Lab || {});

  const Sound = {
    ctx: null,
    enabled: true,
    lastImpact: 0,
    unlock() {
      if (this.ctx || !root.AudioContext && !root.webkitAudioContext) return;
      try {
        this.ctx = new (root.AudioContext || root.webkitAudioContext)();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.5;
        this.master.connect(this.ctx.destination);
      } catch (e) { this.ctx = null; }
    },
    ready() {
      if (!this.enabled || !this.ctx) return false;
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return true;
    },
    tone(freq, dur, opts = {}) {
      if (!this.ready()) return;
      const c = this.ctx, t = c.currentTime + (opts.delay || 0);
      const o = c.createOscillator(), g = c.createGain();
      o.type = opts.type || 'sine';
      o.frequency.setValueAtTime(freq, t);
      if (opts.to) o.frequency.exponentialRampToValueAtTime(opts.to, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(opts.gain || 0.2, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.master);
      o.start(t); o.stop(t + dur + 0.02);
    },
    noise(dur, opts = {}) {
      if (!this.ready()) return;
      const c = this.ctx, t = c.currentTime;
      const len = Math.max(1, Math.floor(c.sampleRate * dur));
      const buf = c.createBuffer(1, len, c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
      const src = c.createBufferSource();
      src.buffer = buf;
      const f = c.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = opts.freq || 900;
      f.Q.value = opts.q || 1.2;
      const g = c.createGain();
      g.gain.value = opts.gain || 0.3;
      src.connect(f); f.connect(g); g.connect(this.master);
      src.start(t);
    },
    click() { this.tone(1800, 0.03, { type: 'square', gain: 0.04 }); },
    impact(impulse) {
      const now = performance.now();
      if (now - this.lastImpact < 45 || impulse < 0.15) return;
      this.lastImpact = now;
      const gain = Math.min(0.35, 0.04 + impulse * 0.03);
      this.noise(0.08, { freq: 500 + Math.min(1500, impulse * 120), gain });
    },
    unlockLock() {
      this.tone(660, 0.12, { type: 'triangle', gain: 0.18 });
      this.tone(990, 0.22, { type: 'triangle', gain: 0.16, delay: 0.1 });
    },
    wrong() { this.tone(180, 0.18, { type: 'sawtooth', gain: 0.07, to: 120 }); },
    door() {
      this.tone(110, 0.9, { type: 'sawtooth', gain: 0.05, to: 220 });
      this.tone(523, 0.3, { type: 'triangle', gain: 0.12, delay: 0.6 });
      this.tone(784, 0.5, { type: 'triangle', gain: 0.12, delay: 0.8 });
    },
    snap() { this.noise(0.12, { freq: 2400, q: 0.8, gain: 0.35 }); },
    release() { this.tone(240, 0.08, { type: 'square', gain: 0.05, to: 120 }); },
  };

  Lab.Sound = Sound;
})(typeof window !== 'undefined' ? window : globalThis);
