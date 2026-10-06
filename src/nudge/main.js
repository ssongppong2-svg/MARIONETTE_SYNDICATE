/*
 * Nudge — loop. Opens straight into the room.
 */
(function (root) {
  'use strict';
  const Lab = root.Lab;
  const Nudge = Lab.Nudge;
  const DT = 1 / 240;

  const App = {
    init() {
      this.canvas = document.getElementById('room');
      this.view = new Nudge.View(this.canvas);
      this.input = new Nudge.Input(this.canvas, this);
      this.view.resize();
      this.build(1.4);
      let last = performance.now();
      const frame = (now) => {
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        this.tick(dt);
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    },
    build(fadeIn = 1.0) {
      this.lv = Nudge.build();
      this.rules = new Nudge.Rules(this.lv);
      this.view.prepare(this.lv);
      this.state = { lv: this.lv, rules: this.rules, fade: 1, fadeIn, bloom: 0, holdReset: 0, mouse: null };
      this.acc = 0;
      this.resetting = false;
    },
    restart() { this.resetting = true; },
    wake() { Nudge.Audio.unlock(); },
    tick(dt) {
      const st = this.state;
      this.view.resize();
      this.view.fit(this.lv.L.VIEW);
      if (this.resetting) {
        st.fade = Math.min(1, st.fade + dt / 0.6);
        if (st.fade >= 1) this.build();
      } else if (st.fade > 0) st.fade = Math.max(0, st.fade - dt / st.fadeIn);

      const m = this.input.world;
      if (m) {
        const v = this.lv.L.VIEW;
        m.x = Math.max(v[0], Math.min(v[2], m.x));
        m.y = Math.max(v[1], Math.min(v[3], m.y));
        this.rules.setTarget(m);
      }
      st.mouse = m;
      this.acc += dt;
      let n = 0;
      while (this.acc >= DT && n < 30) { this.rules.step(DT); this.acc -= DT; n++; }
      if (n === 30) this.acc = 0;

      for (const ev of this.rules.drainEvents()) {
        Nudge.Audio.play(ev);
        if (ev.type === 'break') this.view.puff(ev.p, 'rgba(247, 168, 195, 0.9)', 40, 3);
        if (ev.type === 'pop') this.view.puff(ev.p, 'rgba(247, 168, 195, 0.75)', 7, 0.9);
        if (ev.type === 'goal') this.view.puff(ev.p, 'rgba(255, 255, 255, 0.95)', 50, 2.5);
        if (ev.type === 'impact') for (const s of this.lv.stones) if (s.pos.dist(ev.p) < 0.3) s.squish = Math.min(0.08, ev.P * 0.004);
      }
      const r = this.rules;
      Nudge.Audio.ambience(this.lv.inflowOpen(), this.lv.level > this.lv.L.WELL.floor + 0.05 ? this.lv.drainOpen() : 0, Math.min(1.2, r.force / this.lv.L.STRENGTH));
      if (r.done) st.bloom = Math.min(0.92, (r.time - r.doneAt) / 2.5);
      st.holdReset = this.input.holdProgress();
      this.view.draw(st, dt);
    },
  };

  Nudge.App = App;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => App.init());
  else App.init();
})(window);
