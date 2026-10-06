/*
 * Fragment — sound. Low thuds, water, one bell when the gate gives way.
 * Starts silent; the first key or touch unlocks audio.
 */
(function (root) {
  'use strict';
  const Lab = root.Lab;
  const Frag = (Lab.Fragment = Lab.Fragment || {});

  const Audio = {
    ctx: null,
    last: 0,
    unlock() {
      if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return;
      try {
        this.ctx = new AC();
        this.out = this.ctx.createGain();
        this.out.gain.value = 0.55;
        this.out.connect(this.ctx.destination);
      } catch (e) { this.ctx = null; }
    },
    noise(dur, freq, gain, type = 'lowpass') {
      if (!this.ctx) return;
      const c = this.ctx, n = Math.floor(c.sampleRate * dur);
      const buf = c.createBuffer(1, n, c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.5);
      const src = c.createBufferSource();
      src.buffer = buf;
      const f = c.createBiquadFilter();
      f.type = type; f.frequency.value = freq;
      const g = c.createGain();
      g.gain.value = gain;
      src.connect(f); f.connect(g); g.connect(this.out);
      src.start();
    },
    tone(freq, dur, gain, delay = 0) {
      if (!this.ctx) return;
      const c = this.ctx, t = c.currentTime + delay;
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.out);
      o.start(t); o.stop(t + dur + 0.05);
    },
    play(ev) {
      if (!this.ctx) return;
      const now = performance.now();
      if (ev.type === 'impact') {
        if (now - this.last < 50) return;
        this.last = now;
        this.noise(0.12, 180 + Math.min(500, ev.P * 6), Math.min(0.5, 0.05 + ev.P * 0.012));
      } else if (ev.type === 'splash') {
        this.noise(0.35, 1400, Math.min(0.35, 0.06 + ev.m * 0.004), 'bandpass');
      } else if (ev.type === 'release') {
        this.tone(659.3, 2.4, 0.12);
        this.tone(987.8, 2.8, 0.08, 0.15);
      } else if (ev.type === 'collect') {
        [523.3, 659.3, 784, 1046.5].forEach((f, i) => this.tone(f, 3.2, 0.09, i * 0.12));
      }
    },
  };

  Frag.Audio = Audio;
})(typeof window !== 'undefined' ? window : globalThis);
