/*
 * Nudge — the pointer. It is the mouse: in free air it is wherever the mouse
 * puts it, at once. Against things it is weak — it pushes with at most
 * 40 N and pulls a grabbed object with at most 60 N. Walls stop it, monsters
 * shove it, and a hard enough blow shatters it.
 */
(function (root) {
  'use strict';
  const Lab = root.Lab;
  const { Vec2, Bodies } = Lab;
  const Nudge = (Lab.Nudge = Lab.Nudge || {});

  const PT = {
    R: 0.13,
    MASS: 0.3,
    PUSH: 40,        // N — the most it can push with
    GRAB: 60,        // N — the most its line can pull with
    GRAB_K: 300,     // N/m — the line is a spring
    GRAB_REACH: 0.12,
    FREE: 4000,      // N — in free air it simply goes where the mouse is
    VMAX: 30,        // m/s
    BREAK: 60,       // N — an impact (Δp / 0.02 s) this hard shatters it
    TAU: 0.02,
    CRUSH: 90,       // N — squeezed this hard, it shatters
  };

  class Pointer {
    constructor(game, pos) {
      this.game = game;
      const b = (this.body = game.world.add(Bodies.circle(pos.x, pos.y, PT.R, {
        mass: PT.MASS, material: Nudge.MAT.pointer, gravityScale: 0, fixedRotation: true,
      })));
      b.role = 'pointer';
      b.noBuoyancy = true;
      this.aim = pos.clone();     // where the player wants it
      this.offset = new Vec2();   // where the world has shoved it, relative to the aim
      this.drift = new Vec2();    // velocity of the shove from fields (gravity wells …)
      this.mode = 'lock';
      this.stagger = 0;
      this.dead = 0;
      this.grip = null;
      this.touching = false;
      this.crush = 0;
      this.F = new Vec2();
      this.lineF = new Vec2();
      this.handVel = new Vec2();
      this.blocker = null;
      this.fresh = false;
      this.rests = [];            // normals of the rock it is resting against
    }
    get pos() { return this.body.pos; }
    get target() { return this.aim.add(this.offset); }

    /* ---------- input (once per frame) ---------- */
    /** Pointer lock: the mouse moved by `d` (world metres) over a frame of `dt` s. */
    moveBy(d, dt = 1 / 60) {
      // A frame that ran no physics step yet still owes its motion: add to it.
      const pending = this.fresh && this.mode === 'lock';
      this.mode = 'lock';
      this.aim = (pending ? this.aim : this.body.pos).add(d);
      this.offset = new Vec2();
      this.frame(pending ? (this.frameDt || 0) + dt : dt);
    }
    /** No pointer lock: the mouse is at `p` in the world. */
    moveTo(p, dt = 1 / 60) {
      if (this.mode !== 'abs') { this.offset = new Vec2(); this.mode = 'abs'; }
      this.aim = p.clone();
      this.frame(dt);
    }
    frame(dt) {
      this.fresh = true;
      this.frameDt = dt;
    }

    /**
     * Carry the pointer straight to the target, stopping at the first thing in
     * the way (and sliding along walls). Loose objects in the way are left to
     * the weak push of the drive.
     */
    sweep() {
      const b = this.body, from = b.pos.clone(), T = this.target;
      let to = T, blocker = null;
      for (let pass = 0; pass < 2; pass++) {
        const hit = this.cast(from, to);
        if (!hit) break;
        const d = to.sub(from), len = d.len();
        const travel = Math.max(0, hit.dist - 0.004);
        const stop = len > 1e-9 ? from.add(d.scale(travel / len)) : from.clone();
        blocker = hit.body;
        if (!hit.body.isStatic || pass === 1) { to = stop; break; }
        // Slide along the wall with what is left.
        const rest = to.sub(stop), n = hit.normal;
        const along = rest.sub(n.scale(rest.dot(n)));
        from.copy(stop);
        to = stop.add(along);
        if (along.len() < 1e-4) break;
      }
      const moved = to.sub(b.pos);
      this.handVel = moved.scale(1 / (this.frameDt || 1 / 60));
      b.setPosition(to);
      b.vel.set(0, 0);
      this.blocker = blocker;
    }
    /** How far a disc of radius R can travel from a toward b. */
    cast(a, b2) {
      const g = this.game, d = b2.sub(a), len = d.len();
      if (len < 1e-6) return null;
      const u = d.scale(1 / len), n = new Vec2(-u.y, u.x);
      const grabbed = this.grip && this.grip.body;
      const skip = (o) => o === this.body || o.isKnob || o === grabbed || o.shapes[0].category === 0 || o.role === 'shard';
      let best = null;
      for (const off of [0, PT.R * 0.92, -PT.R * 0.92]) {
        const s = a.add(n.scale(off)), e = s.add(u.scale(len + PT.R));
        const hit = g.world.raycast(s, e, (o) => !skip(o));
        if (!hit) continue;
        const reach = hit.t * (len + PT.R) - (off === 0 ? PT.R : Math.sqrt(Math.max(0, PT.R * PT.R - off * off)));
        if (reach < len && (!best || reach < best.dist)) best = { dist: Math.max(0, reach), body: hit.body, normal: hit.normal.len() > 0 ? hit.normal : u.neg() };
      }
      return best;
    }

    /* ---------- the line ---------- */
    grab() {
      if (this.dead || this.grip) return null;
      const g = this.game, p = this.body.pos;
      let best = null, bd = PT.R + PT.GRAB_REACH;
      for (const b of g.world.bodies) {
        if (!b.grab || !b.isDynamic) continue;
        if (b.containsPoint(p)) { best = { body: b, point: p.clone() }; break; }
        const q = closestOn(b, p);
        if (!q) continue;
        const d = q.dist(p);
        if (d < bd) { bd = d; best = { body: b, point: q }; }
      }
      if (!best) return null;
      this.grip = { body: best.body, local: best.body.localPoint(best.point) };
      g.emit({ type: 'grab', body: best.body, p: best.point });
      return best.body;
    }
    release() {
      if (!this.grip) return null;
      const b = this.grip.body;
      this.grip = null;
      this.lineF = new Vec2();
      this.game.emit({ type: 'release', body: b, v: b.vel.len() });
      return b;
    }

    /* ---------- physics (a force element, before the solver) ---------- */
    apply(dt) {
      const b = this.body;
      if (this.dead) { b.vel.set(0, 0); return; }
      // The shove of fields carries the aim along.
      this.offset = this.offset.addScaled(this.drift, dt);
      if (this.mode === 'abs' && this.stagger <= 0) this.offset = this.offset.scale(Math.exp(-dt / 1.2));
      if (this.fresh && this.stagger <= 0) { this.sweep(); this.fresh = false; }
      // Pressed against rock it simply stays; against loose things it pushes, weakly.
      const T = this.blocker && this.blocker.isStatic ? b.pos.clone() : this.target;
      let vd = T.sub(b.pos).scale(60);
      const s = vd.len();
      if (s > PT.VMAX) vd = vd.scale(PT.VMAX / s);
      vd = this.approach(vd);
      // Rock it rests on takes the part of the push that goes into it.
      for (const n of this.rests) {
        const d = vd.dot(n);
        if (d < 0) vd = vd.sub(n.scale(d));
      }
      let F = vd.sub(b.vel).scale(b.mass / dt);
      const cap = this.stagger > 0 ? 0 : this.touching ? PT.PUSH : PT.FREE;
      const f = F.len();
      if (f > cap) F = cap > 0 ? F.scale(cap / f) : new Vec2();
      b.applyForce(F);
      this.F = F;
      // The line pulls the grabbed object toward the pointer.
      if (this.grip) {
        const o = this.grip.body, q = o.worldPoint(this.grip.local);
        const d = b.pos.sub(q);
        if (d.len() > 1.4 || !o.world) { this.release(); return; }
        const c = 2 * 0.8 * Math.sqrt(PT.GRAB_K * o.mass);
        let L = d.scale(PT.GRAB_K).add((this.handVel || b.vel).sub(o.velocityAt(q)).scale(c));
        const l = L.len();
        if (l > PT.GRAB) L = L.scale(PT.GRAB / l);
        o.applyForce(L, q);
        o.torque -= o.I * 2 * o.angVel;
        this.lineF = L;
      }
    }

    /** Close in on loose objects gently: no ramming them with a flick. */
    approach(vd) {
      const p = this.body.pos, g = this.game;
      const grabbed = this.grip && this.grip.body;
      for (const o of g.world.bodies) {
        if (!o.isDynamic || o === this.body || o === grabbed || o.role === 'monster' || o.isKnob) continue;
        const bb = o.aabb;
        if (bb.minX > p.x + 0.6 || bb.maxX < p.x - 0.6 || bb.minY > p.y + 0.6 || bb.maxY < p.y - 0.6) continue;
        const q = closestOn(o, p);
        if (!q) continue;
        const d = q.dist(p), gap = d - PT.R;
        if (gap > 0.5 || d < 1e-6) continue;
        const n = q.sub(p).scale(1 / d);
        const allowed = 1.2 + Math.max(0, gap) * 14;
        const vn = vd.dot(n) - o.vel.dot(n);
        if (vn > allowed) vd = vd.sub(n.scale(vn - allowed));
      }
      return vd;
    }

    /** After the solver: how hard is it being squeezed, and what is it touching. */
    sense(dt) {
      const b = this.body, w = this.game.world;
      let touching = false, squeeze = 0;
      const grabbed = this.grip && this.grip.body;
      const rests = [];
      for (const arb of w.arbiters.values()) {
        if (arb.a !== b && arb.b !== b) continue;
        const o = arb.a === b ? arb.b : arb.a;
        if (o.isStatic) { rests.push(arb.b === b ? arb.normal : arb.normal.neg()); continue; }
        let P = 0;
        for (const c of arb.contacts) P += c.Pn;
        if (P <= 0) continue;
        if (o.isDynamic && o !== grabbed) { touching = true; squeeze += P / w.dt; }
      }
      this.rests = rests;
      this.touching = touching;
      this.crush = squeeze >= PT.CRUSH ? this.crush + dt : 0;
      if (this.stagger > 0) {
        this.stagger -= dt;
        if (this.stagger <= 0 && this.mode === 'abs') this.offset = b.pos.sub(this.aim);
      }
    }

    knock(J, time = 0.18) {
      this.body.applyImpulse(J);
      this.stagger = Math.max(this.stagger, time);
    }

    shatter() {
      this.release();
      this.dead = 1.1;
      this.stagger = 0;
      this.drift = new Vec2();
    }
    respawn(p) {
      const b = this.body;
      b.setPosition(p.clone());
      b.vel.set(0, 0);
      this.aim = p.clone();
      this.offset = new Vec2();
      this.drift = new Vec2();
      this.dead = 0;
      this.crush = 0;
      this.blocker = null;
      this.handVel = new Vec2();
    }
  }

  /** Closest point on a body's outline to p (null if p is inside it). */
  function closestOn(body, p) {
    let best = null, bd = Infinity;
    for (const s of body.shapes) {
      if (s.sensor) continue;
      if (s.type === 'circle') {
        const d = p.sub(s.wc), l = d.len();
        if (l <= s.radius) return null;
        const q = s.wc.add(d.scale(s.radius / l));
        const dd = q.dist(p);
        if (dd < bd) { bd = dd; best = q; }
      } else {
        if (Lab.Geom.pointInConvex(p, s.wv, s.wn)) return null;
        const v = s.wv;
        for (let i = 0; i < v.length; i++) {
          const q = Lab.Geom.closestPointOnSegment(p, v[i], v[(i + 1) % v.length]);
          const dd = q.dist(p);
          if (dd < bd) { bd = dd; best = q; }
        }
      }
    }
    return best;
  }

  Nudge.PT = PT;
  Nudge.Pointer = Pointer;
  Nudge.closestOn = closestOn;
})(typeof window !== 'undefined' ? window : globalThis);
