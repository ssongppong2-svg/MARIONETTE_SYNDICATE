/*
 * Fragment — loop. Opens straight into the dark; no title, no text.
 */
(function (root) {
  'use strict';
  const Lab = root.Lab;
  const Frag = Lab.Fragment;
  const DT = 1 / 240;

  const App = {
    init() {
      this.canvas = document.getElementById('world');
      this.view = new Frag.View(this.canvas);
      this.input = new Frag.Input(this.canvas, this);
      this.view.resize();
      this.build(2.4);
      let last = performance.now();
      const frame = (now) => {
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        this.tick(dt);
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
      root.addEventListener('resize', () => this.view.resize());
    },

    build(fadeIn = 1.4) {
      this.lv = Frag.build();
      this.rules = new Frag.Rules(this.lv);
      this.view.prepare(this.lv);
      this.view.follow(this.lv, 0, true);
      this.state = { lv: this.lv, rules: this.rules, fade: 1, fadeIn, dotLight: Frag.DOT_LIGHT, pointer: this.input.pointer, holdReset: 0 };
      this.acc = 0;
      this.resetting = false;
      this.input.sync();
    },

    restart() {
      if (this.resetting) return;
      this.resetting = true;
      this.rules.hand.release();
    },

    wake() { Frag.Audio.unlock(); },

    tick(dt) {
      const st = this.state;
      this.view.time += dt;
      if (this.resetting) {
        st.fade = Math.min(1, st.fade + dt / 0.8);
        if (st.fade >= 1) this.build();
      } else if (st.fade > 0) {
        st.fade = Math.max(0, st.fade - dt / st.fadeIn);
      }

      this.acc += dt;
      let n = 0;
      while (this.acc >= DT && n < 30) {
        this.rules.step(DT);
        this.acc -= DT;
        n++;
      }
      if (n === 30) this.acc = 0;
      for (const ev of this.rules.drainEvents()) Frag.Audio.play(ev);
      if (this.rules.wantsReset) this.restart();

      // After the fragment is taken, the dot's light floods the world once.
      if (this.rules.collected) {
        const t = this.rules.time - this.rules.collectedAt;
        const base = Frag.DOT_LIGHT, peak = 34;
        const ease = (x) => x * x * (3 - 2 * x);
        if (t < 3) st.dotLight = base + (peak - base) * ease(t / 3);
        else if (t < 5) st.dotLight = peak;
        else if (t < 8) st.dotLight = peak - (peak - base * 1.15) * ease((t - 5) / 3);
        else st.dotLight = base * 1.15;
      }

      st.holdReset = this.input.holdProgress();
      this.view.resize();
      this.view.follow(this.lv, dt);
      this.view.draw(st);
    },
  };

  Frag.App = App;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => App.init());
  else App.init();
})(window);
