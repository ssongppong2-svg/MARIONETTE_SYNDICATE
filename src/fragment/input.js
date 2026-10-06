/*
 * Fragment — input. Nothing on screen explains it; it should feel obvious.
 *   keys:     ← → / A D move · ↑ / W / Space jump · ↓ / S push down · R start over
 *   pointer:  press an object in the light to pull it; press empty space to
 *             walk there; tap above the dot to jump; hold the dot to start over.
 */
(function (root) {
  'use strict';
  const Lab = root.Lab;
  const Frag = (Lab.Fragment = Lab.Fragment || {});

  const HOLD_RESET = 1.4; // s

  class Input {
    constructor(canvas, app) {
      this.canvas = canvas;
      this.app = app;
      this.pointer = { sx: 0, sy: 0, inside: false, touch: false };
      this.mode = null;
      this.keys = new Set();
      this.holdStart = 0;
      canvas.addEventListener('pointerdown', (e) => this.down(e));
      canvas.addEventListener('pointermove', (e) => this.move(e));
      canvas.addEventListener('pointerup', (e) => this.up(e));
      canvas.addEventListener('pointercancel', (e) => this.up(e));
      canvas.addEventListener('pointerleave', () => { this.pointer.inside = false; });
      canvas.addEventListener('contextmenu', (e) => e.preventDefault());
      root.addEventListener('keydown', (e) => this.key(e, true));
      root.addEventListener('keyup', (e) => this.key(e, false));
      root.addEventListener('blur', () => { this.keys.clear(); this.sync(); });
    }

    key(e, on) {
      const k = e.key.toLowerCase();
      const map = { arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right', arrowup: 'jump', w: 'jump', ' ': 'jump', arrowdown: 'down', s: 'down' };
      if (map[k]) {
        e.preventDefault();
        if (on) this.keys.add(map[k]); else this.keys.delete(map[k]);
        this.sync();
      }
      if (on && k === 'r' && !e.repeat) this.app.restart();
      if (on) this.app.wake();
    }

    sync() {
      const inp = this.app.rules.player.input;
      inp.left = this.keys.has('left');
      inp.right = this.keys.has('right');
      inp.down = this.keys.has('down');
      inp.jump = this.keys.has('jump') || !!this.tapJump;
    }

    world(e) {
      const r = this.canvas.getBoundingClientRect();
      this.pointer.sx = e.clientX - r.left;
      this.pointer.sy = e.clientY - r.top;
      this.pointer.inside = true;
      this.pointer.touch = e.pointerType === 'touch';
      return this.app.view.toWorld(this.pointer.sx, this.pointer.sy);
    }

    /** A loose object under p that the dot can reach and see. */
    reachable(p) {
      const { lv, state } = this.app;
      if (lv.dot.pos.dist(p) > Frag.REACH) return null;
      if (state.dotVis && !Frag.pointInPolygon(p, state.dotVis)) return null;
      for (const b of lv.world.bodies) {
        if (b.grabbable && b.containsPoint(p)) return b;
      }
      return null;
    }

    down(e) {
      this.app.wake();
      const p = this.world(e);
      this.canvas.setPointerCapture(e.pointerId);
      const rules = this.app.rules, lv = this.app.lv;
      const b = this.reachable(p);
      this.downAt = performance.now();
      this.downP = p;
      if (b) {
        rules.hand.grab(b, p);
        this.mode = 'hand';
      } else if (p.dist(lv.dot.pos) < 0.45) {
        this.mode = 'hold';
        this.holdStart = performance.now();
      } else {
        this.mode = 'walk';
        rules.player.input.walkTo = p.x;
      }
    }

    move(e) {
      const p = this.world(e);
      const { rules, lv } = this.app;
      if (this.mode === 'hand') rules.hand.target = p;
      else if (this.mode === 'walk') rules.player.input.walkTo = p.x;
      else if (this.mode === 'hold' && p.dist(lv.dot.pos) > 0.6) this.mode = null;
      lv.hover = this.mode ? null : this.reachable(p);
    }

    up(e) {
      const { rules, lv } = this.app;
      if (this.mode === 'hand') rules.hand.release();
      if (this.mode === 'walk') {
        rules.player.input.walkTo = null;
        const quick = performance.now() - this.downAt < 260;
        if (quick && this.downP && this.downP.y > lv.dot.pos.y + 0.6) {
          this.tapJump = true;
          this.sync();
          setTimeout(() => { this.tapJump = false; this.sync(); }, 120);
        }
      }
      this.mode = null;
      this.holdStart = 0;
      try { this.canvas.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
    }

    /** 0..1 progress of a press-and-hold on the dot. */
    holdProgress() {
      if (this.mode !== 'hold' || !this.holdStart) return 0;
      const t = (performance.now() - this.holdStart) / 1000;
      if (t >= HOLD_RESET) {
        this.mode = null;
        this.holdStart = 0;
        this.app.restart();
        return 0;
      }
      return t / HOLD_RESET;
    }
  }

  Frag.Input = Input;
})(typeof window !== 'undefined' ? window : globalThis);
