/*
 * ΣF — input. Press on an object to hook the tow line to it, drag to pull,
 * let go to release (a moving object flies on). R or the reset box restarts;
 * holding the button still on empty space for 1.6 s does the same. I toggles
 * between full device cards and one-line readings.
 */
(function (root) {
  'use strict';
  const Lab = root.Lab;
  const Sigma = (Lab.Sigma = Lab.Sigma || {});

  const HOLD_RESET = 1.6; // s

  class Input {
    constructor(canvas, app) {
      this.canvas = canvas;
      this.app = app;
      this.screen = null;
      this.down = false;
      this.holdStart = 0;
      this.holdAt = null;
      canvas.addEventListener('pointerdown', (e) => this.press(e));
      canvas.addEventListener('pointermove', (e) => this.move(e));
      canvas.addEventListener('pointerup', (e) => this.lift(e));
      canvas.addEventListener('pointercancel', (e) => this.lift(e));
      canvas.addEventListener('pointerleave', () => { if (!this.down) this.screen = null; });
      canvas.addEventListener('contextmenu', (e) => e.preventDefault());
      root.addEventListener('keydown', (e) => {
        this.app.wake();
        if (e.key === 'r' || e.key === 'R') this.app.restart();
        if (e.key === 'i' || e.key === 'I') this.app.toggleInfo();
      });
    }
    locate(e) {
      const r = this.canvas.getBoundingClientRect();
      this.screen = { x: e.clientX - r.left, y: e.clientY - r.top };
    }
    get world() { return this.screen ? this.app.view.toWorld(this.screen.x, this.screen.y) : null; }
    press(e) {
      if (e.button != null && e.button !== 0) return;
      this.app.wake();
      this.locate(e);
      const st = this.app.state, inBox = (b) => b && this.screen.x >= b.x && this.screen.x <= b.x + b.w && this.screen.y >= b.y && this.screen.y <= b.y + b.h;
      if (inBox(st && st.resetBox)) { this.app.restart(); return; }
      if (inBox(st && st.infoBox)) { this.app.toggleInfo(); return; }
      try { this.canvas.setPointerCapture(e.pointerId); } catch { /* no capture on this device */ }
      this.down = true;
      const grabbed = this.app.grab(this.world);
      this.holdStart = grabbed ? 0 : performance.now();
      this.holdAt = { x: this.screen.x, y: this.screen.y };
    }
    move(e) {
      this.locate(e);
      if (this.holdAt && Math.hypot(this.screen.x - this.holdAt.x, this.screen.y - this.holdAt.y) > 12) this.holdStart = 0;
    }
    lift(e) {
      if (e && e.pointerType === 'touch') this.locate(e);
      this.down = false;
      this.holdStart = 0;
      this.holdAt = null;
      this.app.letGo();
    }
    holdProgress() {
      if (!this.holdStart) return 0;
      const t = (performance.now() - this.holdStart) / 1000;
      if (t >= HOLD_RESET) { this.holdStart = 0; this.app.restart(); return 0; }
      return Math.max(0, (t - 0.3) / (HOLD_RESET - 0.3));
    }
  }

  Sigma.Input = Input;
})(typeof window !== 'undefined' ? window : globalThis);
