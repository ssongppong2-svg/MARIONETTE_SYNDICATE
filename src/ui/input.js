/*
 * Force Chamber — pointer and keyboard input
 * Hand tool: chamber-specific handles first, then grabbable bodies.
 * Ruler tool: snapping measurement between two points.
 */
(function (root) {
  'use strict';
  const Lab = (root.Lab = root.Lab || {});
  const { Vec2, Mathx, Joints } = Lab;

  const Input = {
    tool: 'hand',
    rulers: [],
    drag: null,
    hover: null,
    snapPoint: null,
    pointerWorld: null,

    init(game, renderer, canvas) {
      this.game = game;
      this.r = renderer;
      this.canvas = canvas;
      canvas.addEventListener('pointerdown', (e) => this.down(e));
      canvas.addEventListener('pointermove', (e) => this.move(e));
      canvas.addEventListener('pointerup', (e) => this.up(e));
      canvas.addEventListener('pointercancel', (e) => this.up(e));
      canvas.addEventListener('pointerleave', () => { this.pointerWorld = null; this.hover = null; this.snapPoint = null; });
      canvas.addEventListener('wheel', (e) => {
        const room = game.room;
        if (room && room.def.wheel && room.def.wheel(room, this.world(e), e.deltaY)) e.preventDefault();
      }, { passive: false });
      document.addEventListener('keydown', (e) => this.key(e));
      game.on('enter', () => { this.rulers = []; this.cancelDrag(); });
      game.on('reset', () => { this.cancelDrag(); });
    },

    world(e) {
      const rect = this.canvas.getBoundingClientRect();
      return this.r.toWorld(e.clientX - rect.left, e.clientY - rect.top);
    },

    setTool(t) {
      this.tool = t;
      this.cancelDrag();
      this.canvas.classList.toggle('tool-ruler', t === 'ruler');
      Lab.UI.syncToolbar();
    },

    /* ---------------- snapping ---------------- */
    snap(p, force) {
      const room = this.game.room;
      const rad = this.r.m(11);
      let best = null, bd = rad * rad;
      const consider = (q, kind) => {
        const d = q.distSq(p);
        if (d < bd) { bd = d; best = { p: q.clone(), kind }; }
      };
      if (room) {
        for (const b of room.world.bodies) {
          if (b.style.hidden) continue;
          const bb = b.aabb;
          if (p.x < bb.minX - rad || p.x > bb.maxX + rad || p.y < bb.minY - rad || p.y > bb.maxY + rad) continue;
          for (const s of b.shapes) {
            if (s.sensor) continue;
            if (s.type === 'circle') {
              consider(s.wc, 'centre');
              const d = p.sub(s.wc);
              if (d.len() > 1e-6) consider(s.wc.add(d.norm().scale(s.radius)), 'edge');
            } else {
              for (const v of s.wv) consider(v, 'vertex');
            }
          }
          if (b.isDynamic) consider(b.pos, 'centre');
        }
        for (const j of room.world.joints) {
          if (j.anchorA) consider(j.anchorA, 'anchor');
          if (j.anchorB) consider(j.anchorB, 'anchor');
          if (j.nodes) for (const n of j.nodes) consider(n.world, 'anchor');
        }
        for (const d of room.devices) {
          if (d.a && d.b) { consider(d.a, 'gate'); consider(d.b, 'gate'); }
        }
        if (room.def.snapPoints) for (const q of room.def.snapPoints(room)) consider(q, 'mark');
      }
      if (!best && force) {
        const g = 0.05;
        best = { p: new Vec2(Mathx.snap(p.x, g), Mathx.snap(p.y, g)), kind: 'grid' };
      }
      return best;
    },

    /* ---------------- pointer ---------------- */
    down(e) {
      const room = this.game.room;
      if (!room) return;
      Lab.Sound.unlock();
      const p = this.world(e);
      this.canvas.setPointerCapture(e.pointerId);
      if (this.tool === 'ruler') {
        const s = this.snap(p, e.shiftKey);
        const a = s ? s.p : p;
        this.drag = { kind: 'ruler', a, b: a.clone() };
        return;
      }
      if (room.def.pointerDown) {
        const handled = room.def.pointerDown(room, p, e);
        if (handled) {
          this.drag = { kind: 'room', handle: handled };
          this.canvas.classList.add('grabbing');
          return;
        }
      }
      if (room.editing) return;
      const grabbable = room.world.bodiesAt(p, (b) => b.isDynamic && (b.style.grab || (room.def.canGrab && room.def.canGrab(room, b))));
      if (grabbable.length) {
        const b = grabbable[0];
        const f = new Joints.DragForce(b, p, { freq: 3.5, maxAccel: room.def.grabAccel || 40 });
        room.world.addForce(f);
        this.drag = { kind: 'body', force: f, body: b };
        this.canvas.classList.add('grabbing');
        if (room.def.onGrab) room.def.onGrab(room, b);
      }
    },
    move(e) {
      const room = this.game.room;
      if (!room) return;
      const p = this.world(e);
      this.pointerWorld = p;
      if (this.tool === 'ruler') {
        const s = this.snap(p, e.shiftKey);
        this.snapPoint = s;
        if (this.drag && this.drag.kind === 'ruler') this.drag.b = s ? s.p : p;
        return;
      }
      this.snapPoint = null;
      if (this.drag) {
        if (this.drag.kind === 'body') this.drag.force.target = p;
        else if (this.drag.kind === 'room' && room.def.pointerMove) room.def.pointerMove(room, p, e, this.drag.handle);
        return;
      }
      let cursor = '';
      this.hover = null;
      if (room.def.hover) {
        const hv = room.def.hover(room, p);
        if (hv) { this.hover = hv; cursor = hv.cursor || 'pointer'; }
      }
      if (!cursor && !room.editing) {
        const g = room.world.bodiesAt(p, (b) => b.isDynamic && (b.style.grab || (room.def.canGrab && room.def.canGrab(room, b))));
        if (g.length) cursor = 'grab';
      }
      this.canvas.style.cursor = cursor;
    },
    up(e) {
      const room = this.game.room;
      if (this.drag && room) {
        if (this.drag.kind === 'ruler') {
          if (this.drag.a.dist(this.drag.b) > 0.01) {
            this.rulers.push({ a: this.drag.a, b: this.drag.b });
            if (this.rulers.length > 3) this.rulers.shift();
          }
        } else if (this.drag.kind === 'body') {
          room.world.removeForce(this.drag.force);
          if (room.def.onRelease) room.def.onRelease(room, this.drag.body);
        } else if (this.drag.kind === 'room' && room.def.pointerUp) {
          room.def.pointerUp(room, this.world(e), e, this.drag.handle);
        }
      }
      this.drag = null;
      this.canvas.classList.remove('grabbing');
      try { this.canvas.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
    },
    cancelDrag() {
      const room = this.game && this.game.room;
      if (this.drag && this.drag.kind === 'body' && room) room.world.removeForce(this.drag.force);
      this.drag = null;
      if (this.canvas) this.canvas.classList.remove('grabbing');
    },

    key(e) {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.isContentEditable)) return;
      if (this.game.modalOpen || !this.game.room) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const UI = Lab.UI;
      const k = e.key.toLowerCase();
      if (k === ' ') { e.preventDefault(); UI.togglePause(); }
      else if (k === 'h') this.setTool('hand');
      else if (k === 'm') this.setTool(this.tool === 'ruler' ? 'hand' : 'ruler');
      else if (k === 'f') UI.toggleForces();
      else if (k === 't') UI.toggleStrobe();
      else if (k === 'r') UI.resetRoom();
      else if (k === '.') UI.stepOnce();
      else if (k === 'escape') { this.rulers = []; this.cancelDrag(); }
      else if (this.game.room.def.key) this.game.room.def.key(this.game.room, e);
    },

    /* ---------------- overlay ---------------- */
    drawOverlay(r) {
      const th = r.theme;
      const all = this.rulers.slice();
      if (this.drag && this.drag.kind === 'ruler') all.push(this.drag);
      for (const ru of all) this.drawRuler(r, ru.a, ru.b);
      if (this.tool === 'ruler' && this.snapPoint) {
        const p = this.snapPoint.p;
        r.circle(p, r.m(6), { stroke: th.accent, width: 1.6 });
        r.line(p.add(new Vec2(-r.m(10), 0)), p.add(new Vec2(r.m(10), 0)), { color: th.accent, width: 1 });
        r.line(p.add(new Vec2(0, -r.m(10))), p.add(new Vec2(0, r.m(10))), { color: th.accent, width: 1 });
      } else if (this.tool === 'ruler' && this.pointerWorld) {
        const p = this.pointerWorld;
        r.text(p, `(${Mathx.fmt(p.x, 3)}, ${Mathx.fmt(p.y, 3)})`, { size: 9.5, color: th.ink2, dx: 12, dy: -12, bg: th.paper });
      }
      if (this.hover && this.hover.tip && this.pointerWorld) {
        r.text(this.pointerWorld, this.hover.tip, { size: 10, color: th.ink, dx: 14, dy: 16, bg: th.paper, font: 'sans' });
      }
    },
    drawRuler(r, a, b) {
      const th = r.theme;
      const d = b.sub(a), L = d.len();
      if (L < 1e-4) return;
      const u = d.scale(1 / L), n = u.perp();
      r.line(a, b, { color: th.accent, width: 1.6 });
      const tick = r.m(4);
      for (let s = 0; s <= L + 1e-9; s += 0.1) {
        const major = Math.abs(s - Math.round(s * 2) / 2) < 1e-6;
        const p = a.addScaled(u, s);
        r.line(p, p.addScaled(n, major ? tick * 2 : tick), { color: th.accent, width: 1 });
      }
      r.dot(a, 3, th.accent);
      r.dot(b, 3, th.accent);
      const ang = Math.atan2(d.y, d.x) / Mathx.DEG;
      const mid = Vec2.lerp(a, b, 0.5).addScaled(n, -r.m(16));
      r.lcd(mid, [`L ${Mathx.fmt(L, 3)} m`, `Δx ${Mathx.fmt(d.x, 3)}  Δy ${Mathx.fmt(d.y, 3)}`, `θ ${Mathx.fmt(ang, 2)}°`], { align: 'center', size: 10 });
    },
  };

  Lab.Input = Input;
})(typeof window !== 'undefined' ? window : globalThis);
