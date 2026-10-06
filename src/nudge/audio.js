/*
 * Nudge — soft synthesized sound: bloops, pouring water, a straining wall.
 * Silent until the first click or key.
 */
(function (root) {
  'use strict';
  const Lab = root.Lab;
  const Nudge = (Lab.Nudge = Lab.Nudge || {});

  const Audio = {
    ctx: null,
    last: 0,
    unlock() {
      if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return;
      try {
        const c = (this.ctx = new AC());
        this.out = c.createGain();
        this.out.gain.value = 0.5;
        this.out.connect(c.destination);
        // Looping noise beds for pouring and draining water.
        const len = c.sampleRate * 2;
        const buf = c.createBuffer(1, len, c.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        const bed = (freq, type) => {
          const src = c.createBufferSource();
          src.buffer = buf; src.loop = true;
          const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = 0.7;
          const g = c.createGain(); g.gain.value = 0;
          src.connect(f); f.connect(g); g.connect(this.out);
          src.start();
          return g;
        };
        this.pour = bed(1200, 'bandpass');
        this.gurgle = bed(260, 'lowpass');
        // A low hum that rises as the wall strains.
        this.hum = c.createOscillator();
        this.hum.type = 'sine';
        this.hum.frequency.value = 70;
        this.humGain = c.createGain(); this.humGain.gain.value = 0;
        this.hum.connect(this.humGain); this.humGain.connect(this.out);
        this.hum.start();
      } catch { this.ctx = null; }
    },
    tone(freq, dur, gain, delay = 0, to) {
      if (!this.ctx) return;
      const c = this.ctx, t = c.currentTime + delay;
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(freq, t);
      if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.out);
      o.start(t); o.stop(t + dur + 0.05);
    },
    ambience(inflow, drain, strain) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      this.pour.gain.setTargetAtTime(0.12 * inflow, t, 0.2);
      this.gurgle.gain.setTargetAtTime(0.25 * drain, t, 0.2);
      this.humGain.gain.setTargetAtTime(strain > 0.55 ? 0.06 * (strain - 0.55) * 2 : 0, t, 0.15);
      this.hum.frequency.setTargetAtTime(60 + 50 * strain, t, 0.2);
    },
    play(ev) {
      if (!this.ctx) return;
      const now = performance.now();
      if (ev.type === 'impact') {
        if (now - this.last < 60) return;
        this.last = now;
        const f = 520 - Math.min(300, ev.P * 20);
        this.tone(f, 0.12, Math.min(0.12, 0.02 + ev.P * 0.01), 0, f * 0.7);
      } else if (ev.type === 'break') {
        [880, 1175, 1397, 1760].forEach((f, i) => this.tone(f, 1.2, 0.08, i * 0.05));
        this.tone(140, 0.9, 0.2, 0, 60);
      } else if (ev.type === 'pop') {
        if (now - this.last < 40) return;
        this.last = now;
        const f = 900 + Math.random() * 500;
        this.tone(f, 0.09, 0.03, 0, f * 1.6);
      } else if (ev.type === 'goal') {
        [523.3, 659.3, 784, 1046.5, 1318.5].forEach((f, i) => this.tone(f, 3, 0.07, i * 0.14));
      }
    },
  };

  Nudge.Audio = Audio;
})(typeof window !== 'undefined' ? window : globalThis);
