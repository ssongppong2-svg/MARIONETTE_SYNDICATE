/*
 * Force Chamber — laboratory instruments
 * Photogates time beam interruptions with sub-step interpolation, zones
 * report bodies entering a region, plates read the contact force on them.
 */
(function (root) {
  'use strict';
  const Lab = (root.Lab = root.Lab || {});
  const { Vec2, Transform, Mathx } = Lab;

  /** Projection extent of a body's solid shapes onto axis n for a given pose. */
  function extentAt(body, pos, angle, n) {
    const xf = new Transform(pos, angle);
    let lo = Infinity, hi = -Infinity;
    for (const s of body.shapes) {
      if (s.sensor) continue;
      if (s.type === 'circle') {
        const c = xf.apply(s.center);
        const d = c.dot(n);
        lo = Math.min(lo, d - s.radius); hi = Math.max(hi, d + s.radius);
      } else {
        for (const v of s.verts) {
          const d = xf.apply(v).dot(n);
          if (d < lo) lo = d;
          if (d > hi) hi = d;
        }
      }
    }
    return [lo, hi];
  }

  /**
   * Light gate. The beam runs from a to b. Records the time the beam is first
   * blocked and how long it stays blocked, interpolated inside the step.
   */
  class Photogate {
    constructor(room, opts) {
      this.room = room;
      this.a = opts.a.clone();
      this.b = opts.b.clone();
      this.label = opts.label || 'PG';
      this.filter = opts.filter || ((b) => b.isDynamic);
      this.readout = opts.readout || 'both'; // 'time' | 'duration' | 'both' | 'none'
      this.readoutPos = opts.readoutPos || null;
      this.readoutAlign = opts.readoutAlign || 'left';
      this.labelAt = opts.labelAt || 'a';
      this.n = this.b.sub(this.a).perp().norm();
      this.offset = this.a.dot(this.n);
      this.blocker = null;
      this.tBlock = null;
      this.duration = null;
      this.events = [];
      this.onBlock = opts.onBlock || null;
      this.onClear = opts.onClear || null;
      this.flash = 0;
    }
    get blocked() { return !!this.blocker; }
    /** Move the beam (for gates mounted on moving fixtures). */
    setBeam(a, b) {
      this.a = a.clone();
      this.b = b.clone();
      this.n = this.b.sub(this.a).perp().norm();
      this.offset = this.a.dot(this.n);
    }
    reset() {
      this.blocker = null; this.tBlock = null; this.duration = null; this.events = [];
    }
    beamHits(body) {
      for (const s of body.shapes) {
        if (s.sensor) continue;
        if (s.raycast(this.a, this.b) || s.raycast(this.b, this.a)) return true;
      }
      return false;
    }
    update(world, dt, clock) {
      const now = clock();
      if (this.blocker) {
        const b = this.blocker;
        if (!b.world || !this.beamHits(b)) {
          const [lo0, hi0] = extentAt(b, b.prevPos, b.prevAngle, this.n).map((v) => v - this.offset);
          const [lo1, hi1] = extentAt(b, b.pos, b.angle, this.n).map((v) => v - this.offset);
          let frac = 1;
          if (hi0 > 0 && hi1 <= 0) frac = hi0 / (hi0 - hi1);
          else if (lo0 < 0 && lo1 >= 0) frac = -lo0 / (lo1 - lo0);
          const tClear = now - dt + Mathx.clamp(frac, 0, 1) * dt;
          this.duration = tClear - this.tBlockRaw;
          const ev = this.events[this.events.length - 1];
          if (ev) ev.duration = this.duration;
          this.blocker = null;
          if (this.onClear) this.onClear(this.duration, b);
        }
        return;
      }
      for (const b of world.bodies) {
        if (!this.filter(b)) continue;
        const bb = b.aabb;
        const minX = Math.min(this.a.x, this.b.x), maxX = Math.max(this.a.x, this.b.x);
        const minY = Math.min(this.a.y, this.b.y), maxY = Math.max(this.a.y, this.b.y);
        if (bb.maxX < minX || bb.minX > maxX || bb.maxY < minY || bb.minY > maxY) continue;
        if (!this.beamHits(b)) continue;
        const [lo0, hi0] = extentAt(b, b.prevPos, b.prevAngle, this.n).map((v) => v - this.offset);
        const [lo1, hi1] = extentAt(b, b.pos, b.angle, this.n).map((v) => v - this.offset);
        let frac = 1;
        if (lo0 > 0 && lo1 <= 0) frac = lo0 / (lo0 - lo1);
        else if (hi0 < 0 && hi1 >= 0) frac = -hi0 / (hi1 - hi0);
        this.tBlockRaw = now - dt + Mathx.clamp(frac, 0, 1) * dt;
        this.tBlock = this.room.clockStart != null ? this.tBlockRaw - this.room.clockStart : null;
        this.duration = null;
        this.blocker = b;
        this.flash = 1;
        this.events.push({ t: this.tBlock, raw: this.tBlockRaw, duration: null, body: b });
        if (this.onBlock) this.onBlock(this.tBlock, b);
        break;
      }
    }
    draw(r) {
      const th = r.theme;
      const blocked = this.blocked;
      const d = this.b.sub(this.a).norm();
      const post = 0.05;
      // Emitter and receiver housings.
      for (const [p, s] of [[this.a, -1], [this.b, 1]]) {
        const c = p.addScaled(d, s * post);
        r.rect(c.x - 0.045, c.y - 0.045, c.x + 0.045, c.y + 0.045, { fill: th.instrument, stroke: th.ink, width: 1.2 });
      }
      r.line(this.a, this.b, {
        color: blocked ? th.beamHot : th.beam,
        width: blocked ? 2.4 : 1.4,
        dash: blocked ? null : [4, 3],
      });
      const lp = this.labelAt === 'b' ? this.b.addScaled(d, 0.1).add(this.n.scale(-0.16)) : this.a.addScaled(d, -post).add(this.n.scale(0.13));
      r.text(lp, this.label, { size: 10, font: 'mono', color: th.ink2, align: 'center' });
      if (this.readout === 'none') return;
      const lines = [];
      if (this.readout !== 'duration') lines.push(this.tBlock == null ? 't  —' : `t  ${Mathx.fmt(this.tBlock, 4)} s`);
      if (this.readout !== 'time') lines.push(this.duration == null ? 'Δt —' : `Δt ${Mathx.fmt(this.duration * 1000, 2)} ms`);
      const at = this.readoutPos || this.b.addScaled(d, 0.22);
      r.lcd(at, lines, { align: this.readoutAlign, hot: this.flash > 0.01 });
      this.flash *= 0.9;
    }
  }

  /** Region sensor (static sensor body). Calls onEnter/onExit with bodies. */
  class Zone {
    constructor(room, opts) {
      this.room = room;
      this.filter = opts.filter || ((b) => b.isDynamic);
      this.onEnter = opts.onEnter || null;
      this.onExit = opts.onExit || null;
      this.inside = new Set();
      this.enteredAt = new Map();
      this.style = opts.style || null;
      this.label = opts.label || '';
      const verts = opts.verts || [
        new Vec2(opts.x0, opts.y0), new Vec2(opts.x1, opts.y0),
        new Vec2(opts.x1, opts.y1), new Vec2(opts.x0, opts.y1),
      ];
      this.verts = verts;
      this.body = Lab.Bodies.polygon(verts, { type: 'static', sensor: true, style: { hidden: true } });
      this.body.zone = this;
      room.world.add(this.body);
    }
    update(hits, now) {
      const current = new Set();
      for (const [sa, sb] of hits) {
        let other = null;
        if (sa.body === this.body) other = sb.body;
        else if (sb.body === this.body) other = sa.body;
        if (other && this.filter(other)) current.add(other);
      }
      for (const b of current) {
        if (!this.inside.has(b)) {
          this.enteredAt.set(b, now);
          if (this.onEnter) this.onEnter(b);
        }
      }
      for (const b of this.inside) {
        if (!current.has(b)) {
          this.enteredAt.delete(b);
          if (this.onExit) this.onExit(b);
        }
      }
      this.inside = current;
    }
    /** Seconds the body has continuously been inside, or 0. */
    dwell(body, now) {
      return this.enteredAt.has(body) ? now - this.enteredAt.get(body) : 0;
    }
    has(body) { return this.inside.has(body); }
    draw(r) {
      if (!this.style) return;
      r.poly(this.verts, this.style);
    }
  }

  Lab.Devices = { Photogate, Zone, extentAt };
})(typeof window !== 'undefined' ? window : globalThis);
