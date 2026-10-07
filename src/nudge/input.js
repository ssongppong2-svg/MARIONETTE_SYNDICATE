/*
 * Nudge — input. With pointer lock the mouse's own motion moves the pointer,
 * one for one, and the view follows. Without it (or on touch) the pointer
 * goes where the mouse is, and the view pans when it nears the edge.
 */
(function (root) {
  'use strict';
  const Lab = root.Lab;
  const Nudge = (Lab.Nudge = Lab.Nudge || {});

  const TOUCH_LIFT = 44;   // px: a finger would hide the pointer, so it aims above the fingertip

  class Input {
    constructor(canvas, app) {
      this.canvas = canvas;
      this.app = app;
      this.mode = 'abs';
      this.dx = 0;
      this.dy = 0;
      this.screen = null;
      // A coarse pointer (a finger) gets the touch controls from the start.
      this.touch = !!(root.matchMedia && root.matchMedia('(pointer: coarse)').matches);
      this.lockFailed = false;
      this.rArmed = 0;
      const doc = root.document;
      doc.addEventListener('pointerlockchange', () => {
        const locked = doc.pointerLockElement === canvas;
        this.mode = locked ? 'lock' : 'abs';
        this.dx = this.dy = 0;
        app.onLock(locked);
      });
      doc.addEventListener('pointerlockerror', () => { this.lockFailed = true; this.mode = 'abs'; });
      doc.addEventListener('mousemove', (e) => {
        if (this.mode === 'lock') { this.dx += e.movementX || 0; this.dy += e.movementY || 0; }
      });
      canvas.addEventListener('pointermove', (e) => {
        if (this.mode === 'lock') return;
        if (e.pointerType === 'touch') this.becomeTouch();
        this.locate(e);
      });
      canvas.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'touch') { this.becomeTouch(); this.locate(e); app.wake(); if (app.state === 'intro') app.press(); return; }
        if (this.mode !== 'lock') this.locate(e);
        if (e.button === 0) app.press();
      });
      doc.addEventListener('pointerup', (e) => { if (e.pointerType !== 'touch' && e.button === 0) app.unpress(); });
      canvas.addEventListener('contextmenu', (e) => e.preventDefault());
      root.addEventListener('keydown', (e) => this.key(e));
      root.addEventListener('blur', () => app.unpress());
    }
    becomeTouch() {
      if (this.touch) return;
      this.touch = true;
      this.app.onTouch();
    }
    locate(e) {
      const r = this.canvas.getBoundingClientRect();
      const lift = e.pointerType === 'touch' ? TOUCH_LIFT : 0;
      this.screen = { x: e.clientX - r.left, y: e.clientY - r.top - lift };
    }
    key(e) {
      const app = this.app;
      app.wake();
      if (e.repeat) return;
      const k = e.key;
      if (k === ' ' || k === 'Enter') { if (app.state === 'intro') { e.preventDefault(); app.cut.skip(); } return; }
      if (k === 'Escape') { if (app.state === 'play') app.pause(); else if (app.state === 'paused') app.resume(); return; }
      if (k === 'm' || k === 'M') { app.toggleMute(); return; }
      if ((k === 'r' || k === 'R') && app.state === 'play') {
        const now = performance.now();
        if (now - this.rArmed < 2000) { this.rArmed = 0; app.resetHere(); } else { this.rArmed = now; app.askReset(); }
      }
    }
    requestLock() {
      if (this.touch || this.lockFailed || !this.canvas.requestPointerLock) return;
      try {
        const p = this.canvas.requestPointerLock();
        if (p && p.catch) p.catch(() => { this.lockFailed = true; });
      } catch { this.lockFailed = true; }
    }
    exitLock() {
      try { if (root.document.pointerLockElement) root.document.exitPointerLock(); } catch { /* already out */ }
    }
    /** What the mouse did since last frame. */
    take() {
      const d = { dx: this.dx, dy: this.dy };
      this.dx = this.dy = 0;
      return d;
    }
  }

  Nudge.Input = Input;
})(typeof window !== 'undefined' ? window : globalThis);
