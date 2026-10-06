/*
 * ΣF — sound. The tow line hums higher as its tension climbs; water hisses
 * in proportion to the flow; impacts thud by their force; alarms are alarms.
 * Silent until the first click or key.
 */
(function (root) {
  'use strict';
  const Lab = root.Lab;
  const Sigma = (Lab.Sigma = Lab.Sigma || {});

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
        this.out.gain.value = 0.45;
        this.out.connect(c.destination);
        const len = c.sampleRate * 2;
        this.noise = c.createBuffer(1, len, c.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        const bed = (freq, type, q = 0.7) => {
          const src = c.createBufferSource();
          src.buffer = this.noise; src.loop = true;
          const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
          const g = c.createGain(); g.gain.value = 0;
          src.connect(f); f.connect(g); g.connect(this.out);
          src.start();
          return g;
        };
        this.pour = bed(900, 'bandpass');
        this.trickle = bed(2600, 'bandpass', 2);
        this.spill = bed(300, 'lowpass');
        // The line: a filtered saw whose pitch follows the tension.
        this.line = c.createOscillator();
        this.line.type = 'sawtooth';
        this.lineFilter = c.createBiquadFilter();
        this.lineFilter.type = 'lowpass';
        this.lineFilter.frequency.value = 900;
        this.lineGain = c.createGain(); this.lineGain.gain.value = 0;
        this.line.connect(this.lineFilter); this.lineFilter.connect(this.lineGain); this.lineGain.connect(this.out);
        this.line.start();
        // The door motor.
        this.motor = c.createOscillator();
        this.motor.type = 'triangle';
        this.motor.frequency.value = 55;
        this.motorGain = c.createGain(); this.motorGain.gain.value = 0;
        this.motor.connect(this.motorGain); this.motorGain.connect(this.out);
        this.motor.start();
      } catch { this.ctx = null; }
    },
    tone(freq, dur, gain, delay = 0, to, type = 'sine') {
      if (!this.ctx) return;
      const c = this.ctx, t = c.currentTime + delay;
      const o = c.createOscillator(), g = c.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.out);
      o.start(t); o.stop(t + dur + 0.05);
    },
    hiss(dur, gain, freq, type = 'highpass') {
      if (!this.ctx) return;
      const c = this.ctx, t = c.currentTime;
      const src = c.createBufferSource(); src.buffer = this.noise;
      const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq;
      const g = c.createGain();
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f); f.connect(g); g.connect(this.out);
      src.start(t); src.stop(t + dur + 0.05);
    },
    ambience(st) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime, r = st.rules, L = st.lv.L;
      this.pour.gain.setTargetAtTime(0.14 * Math.min(1, r.flows.main / L.MAIN_Q), t, 0.15);
      this.trickle.gain.setTargetAtTime(0.06 * Math.min(1, r.flows.needle / L.NEEDLE_Q), t, 0.15);
      this.spill.gain.setTargetAtTime(Math.min(0.25, r.flows.over / 60), t, 0.15);
      const held = r.tether.body ? Math.min(1, r.tether.F.len() / r.tether.fMax) : 0;
      this.line.frequency.setTargetAtTime(70 + 520 * held, t, 0.03);
      this.lineFilter.frequency.setTargetAtTime(500 + 2400 * held, t, 0.05);
      this.lineGain.gain.setTargetAtTime(r.tether.body ? 0.015 + 0.05 * held : 0, t, 0.05);
      this.motorGain.gain.setTargetAtTime(Math.min(0.12, Math.max(0, r.doorV) * 0.25), t, 0.1);
    },
    play(ev) {
      if (!this.ctx) return;
      const now = performance.now();
      switch (ev.type) {
        case 'grab': this.tone(1400, 0.05, 0.05, 0, 900, 'square'); break;
        case 'release': this.tone(700, 0.05, 0.03, 0, 500, 'square'); break;
        case 'snap': this.tone(1800, 0.25, 0.08, 0, 120, 'sawtooth'); break;
        case 'impact': {
          if (now - this.last < 50) return;
          this.last = now;
          const k = Math.min(1, ev.F / 1500);
          this.tone(140 - 60 * k, 0.18, 0.04 + 0.12 * k, 0, 50);
          this.hiss(0.08, 0.03 + 0.06 * k, 600, 'lowpass');
          break;
        }
        case 'glassHit': this.tone(2400, 0.12, 0.05, 0, 1900); break;
        case 'glass':
          this.hiss(0.9, 0.35, 2500);
          [2637, 3136, 3951, 4699].forEach((f, i) => this.tone(f, 0.6, 0.04, i * 0.04));
          break;
        case 'hatch': this.tone(90, 0.4, 0.2, 0, 45); this.hiss(0.2, 0.08, 400, 'lowpass'); break;
        case 'hatchClose': this.tone(160, 0.12, 0.08, 0, 120); break;
        case 'cradle': this.tone(320, 0.5, 0.1, 0, 240, 'triangle'); this.tone(80, 0.6, 0.15, 0.05, 40); break;
        case 'weighed': [880, 1320].forEach((f, i) => this.tone(f, 0.12, 0.05, i * 0.08, null, 'square')); break;
        case 'lockout':
          for (let i = 0; i < 6; i++) this.tone(i % 2 ? 660 : 880, 0.22, 0.08, i * 0.25, null, 'square');
          this.tone(60, 1.2, 0.25, 0, 30);
          break;
        case 'open': [392, 523.3, 659.3].forEach((f, i) => this.tone(f, 0.8, 0.06, i * 0.1, null, 'triangle')); break;
        case 'done': [523.3, 659.3, 784, 1046.5, 1318.5].forEach((f, i) => this.tone(f, 2.5, 0.06, i * 0.12)); break;
        case 'warn': this.tone(220, 0.15, 0.06, 0, null, 'square'); break;
        default: break;
      }
    },
  };

  Sigma.Audio = Audio;
})(typeof window !== 'undefined' ? window : globalThis);
