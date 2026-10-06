/*
 * ΣF — loop. Fixed 240 Hz physics under a 60 Hz screen.
 */
(function (root) {
  'use strict';
  const Lab = root.Lab;
  const Sigma = Lab.Sigma;
  const DT = 1 / 240;

  const App = {
    init() {
      this.canvas = document.getElementById('room');
      this.view = new Sigma.View(this.canvas);
      this.input = new Sigma.Input(this.canvas, this);
      this.view.resize();
      this.build(1.2);
      // Rebuild the static layer once the web fonts arrive.
      if (document.fonts && document.fonts.load) {
        Promise.all([
          document.fonts.load('600 12px "IBM Plex Sans KR"'),
          document.fonts.load('400 10px "JetBrains Mono"'),
          document.fonts.load('700 20px "Chakra Petch"'),
        ]).then(() => { this.view.layerKey = null; }).catch(() => {});
      }
      let last = performance.now();
      const frame = (now) => {
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        this.tick(dt);
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    },
    build(fadeIn = 0.8) {
      this.lv = Sigma.build();
      this.rules = new Sigma.Rules(this.lv);
      this.view.layout(this.lv.L);
      this.view.prepare(this.lv);
      this.state = { lv: this.lv, rules: this.rules, fade: 1, fadeIn, mouse: null, hover: null, ending: 0, final: null, fps: 60, info: !!this.info };
      this.acc = 0;
      this.resetting = false;
    },
    restart() { this.resetting = true; },
    toggleInfo() { this.info = !this.info; this.state.info = this.info; },
    wake() { Sigma.Audio.unlock(); },
    grab(p) {
      if (!p || this.rules.done) return null;
      const b = this.rules.grab(p);
      if (!b) Sigma.Audio.play({ type: 'warn' });
      return b;
    },
    letGo() { this.rules.release(); },

    tick(dt) {
      const st = this.state, r = this.rules, v = this.view;
      if (v.resize()) v.layerKey = null;
      v.layout(this.lv.L);
      if (this.resetting) {
        st.fade = Math.min(1, st.fade + dt / 0.35);
        if (st.fade >= 1) { this.build(0.5); return; }
      } else if (st.fade > 0) st.fade = Math.max(0, st.fade - dt / st.fadeIn);
      st.fps += (1 / Math.max(dt, 1e-3) - st.fps) * 0.05;

      const m = this.input.world;
      if (m) {
        const V = this.lv.L.VIEW;
        m.x = Math.max(V[0], Math.min(V[2], m.x));
        m.y = Math.max(V[1], Math.min(V[3], m.y));
        r.moveCursor(m, Math.max(dt, 1 / 240));
      }
      st.mouse = m;

      if (!r.lockout || r.time - r.lockAt < 2) {
        this.acc += dt;
        let n = 0;
        while (this.acc >= DT && n < 40) { r.step(DT); this.acc -= DT; n++; }
        if (n === 40) this.acc = 0;
      }

      // What the cursor is over (for the free-body readout).
      st.hover = null;
      if (m && !r.tether.body && !r.sealed(m)) {
        const hit = r.pick(m);
        if (hit && r.lineClear(m, hit.point, hit.body)) st.hover = hit.body;
      }

      for (const ev of r.drainEvents()) {
        Sigma.Audio.play(ev);
        if (ev.type === 'glassHit' && !ev.ok) v.crack(ev.p, Math.min(1.4, 0.4 + ev.F / this.lv.L.GLASS.threshold));
        if (ev.type === 'glass') { v.burst(ev.p, 60, '#bff0ff', 4, 'shard'); v.flash = 1; v.glitch = 0.8; st.glassF = r.lastImpact && r.lastImpact.F; }
        if (ev.type === 'impact' && ev.F > 300) v.burst(ev.p, Math.min(14, Math.round(ev.F / 120)), 'rgba(255,178,62,0.9)', 1.6);
        if (ev.type === 'hatch') v.burst(new Lab.Vec2(12.8, this.lv.L.DECK), 20, 'rgba(255,178,62,0.8)', 1.2, 'dust');
        if (ev.type === 'snap') v.glitch = 0.3;
        if (ev.type === 'lockout') { v.glitch = 1.2; v.flash = 0.6; }
        if (ev.type === 'cradle') v.glitch = 0.25;
        if (ev.type === 'done') st.final = { glass: st.glassF, Wcw: r.bucketWeight() };
      }
      Sigma.Audio.ambience(st);
      if (r.done) st.ending = Math.min(1, (r.time - r.doneAt - 0.8) / 1.6);
      st.holdReset = this.input.holdProgress();
      v.draw(st, dt);
    },
  };

  Sigma.App = App;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => App.init());
  else App.init();
})(window);
