/*
 * Nudge — input. The mouse (or finger) is where the pointer wants to be.
 * Hold still with the button down to start over; R does the same.
 */
(function (root) {
  'use strict';
  const Lab = root.Lab;
  const Nudge = (Lab.Nudge = Lab.Nudge || {});

  const HOLD_RESET = 1.6; // s
  const TOUCH_LIFT = 36;  // px

  class Input {
    constructor(canvas, app) {
      this.canvas = canvas;
      this.app = app;
      this.screen = null;
      this.holdStart = 0;
      this.holdAt = null;
      canvas.addEventListener('pointerdown', (e) => this.down(e));
      canvas.addEventListener('pointermove', (e) => this.move(e));
      canvas.addEventListener('pointerup', () => this.up());
      canvas.addEventListener('pointercancel', () => this.up());
      canvas.addEventListener('contextmenu', (e) => e.preventDefault());
      root.addEventListener('keydown', (e) => {
        this.app.wake();
        if (e.key === 'r' || e.key === 'R') this.app.restart();
      });
    }
    locate(e) {
      const r = this.canvas.getBoundingClientRect();
      // A finger would hide the pointer: on touch, it aims a little above the fingertip.
      const lift = e.pointerType === 'touch' ? TOUCH_LIFT : 0;
      this.screen = { x: e.clientX - r.left, y: e.clientY - r.top - lift };
    }
    /** World position of the mouse, re-projected every frame so resizing never jumps. */
    get world() {
      return this.screen ? this.app.view.toWorld(this.screen.x, this.screen.y) : null;
    }
    down(e) {
      this.app.wake();
      this.locate(e);
      try { this.canvas.setPointerCapture(e.pointerId); } catch { /* no capture on this device */ }
      this.holdStart = performance.now();
      this.holdAt = { x: this.screen.x, y: this.screen.y };
    }
    move(e) {
      this.locate(e);
      if (this.holdAt && Math.hypot(this.screen.x - this.holdAt.x, this.screen.y - this.holdAt.y) > 12) this.holdStart = 0;
    }
    up() { this.holdStart = 0; this.holdAt = null; }
    holdProgress() {
      if (!this.holdStart) return 0;
      const t = (performance.now() - this.holdStart) / 1000;
      if (t >= HOLD_RESET) { this.holdStart = 0; this.app.restart(); return 0; }
      return Math.max(0, (t - 0.3) / (HOLD_RESET - 0.3));
    }
  }

  Nudge.Input = Input;
})(typeof window !== 'undefined' ? window : globalThis);
