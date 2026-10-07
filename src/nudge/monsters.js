/*
 * Nudge — monsters and live hazards. Every attack is a force with a point of
 * application; the game draws it as an arrow with its size in newtons.
 *
 *   Dropper   — floats over the pointer and lets a 20 kg stone fall on it.
 *   Orb       — a gravity well: a = K / r² toward it, on stones and pointer alike.
 *   Pendulum  — a heavy blade swinging across a corridor.
 *   Skater    — pushes off the ground to ram; it can only push as hard as
 *               friction lets it (μ·N), so on ice it glides helplessly.
 *   Icicles   — hang from a ceiling and fall when shaken loose.
 */
(function (root) {
  'use strict';
  const Lab = root.Lab;
  const { Vec2, Bodies, Joints } = Lab;
  const Nudge = (Lab.Nudge = Lab.Nudge || {});

  /* ---------------------------------------------------------------- */
  class Dropper {
    constructor(game, opts) {
      this.game = game;
      this.home = opts.home;                 // [x0, x1] it patrols
      this.alt = opts.alt;                   // hover height
      this.rockMass = opts.rockMass || 20;
      this.reload = opts.reload || 5;
      const b = (this.body = game.add(Bodies.circle((this.home[0] + this.home[1]) / 2, this.alt, 0.42, {
        mass: 6, material: Nudge.MAT.monster, gravityScale: 0, fixedRotation: true, category: 2, mask: 0xffff & ~2,
      })));
      b.role = 'monster';
      b.kind = 'dropper';
      b.noBuoyancy = true;
      this.rock = null;
      this.cool = 0.8;
      this.aimT = 0;
      this.dropped = [];
      this.tell = 0;
    }
    think(dt) {
      const g = this.game, b = this.body, p = g.pointer.pos;
      // Hover above the pointer's x (within its patch), at its altitude.
      const tx = Math.max(this.home[0], Math.min(this.home[1], p.x));
      const want = new Vec2(Math.max(-2.6, Math.min(2.6, (tx - b.pos.x) * 3)), (this.alt + 0.15 * Math.sin(g.time * 2) - b.pos.y) * 4);
      b.applyForce(want.sub(b.vel).scale(b.mass * 6));
      // Carry the stone just under it until it lets go.
      if (!this.rock && this.cool <= 0) this.arm();
      if (this.rock) {
        const r = this.rock;
        r.setPosition(b.pos.add(new Vec2(0, -0.42 - r.radius - 0.02)));
        r.vel.set(b.vel.x, b.vel.y);
        // It lets go only when it hangs steady right over the pointer.
        const under = !g.pointer.dead && p.y < b.pos.y - 1 && Math.abs(p.x - b.pos.x) < 0.15 && Math.abs(b.vel.x) < 0.3;
        this.aimT = under ? this.aimT + dt : Math.max(0, this.aimT - dt * 2);
        this.tell = this.aimT / 0.45;
        if (this.aimT > 0.45) this.drop();
      } else this.cool -= dt;
    }
    arm() {
      const g = this.game, b = this.body;
      const r = Nudge.kit.ball(g, b.pos.x, b.pos.y - 1.2, this.rockMass, 2600, Nudge.MAT.stone, { angularDamping: 0.8 });
      r.role = 'rock';
      r.gravityScale = 0;
      this.rock = r;
      g.emit({ type: 'arm', p: r.pos.clone() });
    }
    drop() {
      const r = this.rock;
      this.rock = null;
      r.gravityScale = 1;
      r.vel.set(this.body.vel.x * 0.3, 0);
      this.cool = this.reload;
      this.aimT = 0;
      this.dropped.push(r);
      this.game.emit({ type: 'drop', p: r.pos.clone(), body: r });
    }
    after() {}
  }

  /* ---------------------------------------------------------------- */
  /** A gravity well: a = K / r² toward the centre within `range`, capped. */
  class Orb {
    constructor(game, x, y, opts = {}) {
      this.game = game;
      this.c = new Vec2(x, y);
      this.r = opts.r || 0.35;
      this.K = opts.K || 14;
      this.range = opts.range || 7;
      this.cap = opts.cap || 30;
      this.body = game.add(Bodies.circle(x, y, this.r, { type: 'static', material: Nudge.MAT.rock }));
      this.body.role = 'orb';
      game.field(this);
      game.hazards.push({ kind: 'orb', hits: (p, rr) => p.dist(this.c) < this.r + rr + 0.02 });
    }
    accel(p) {
      const d = this.c.sub(p), r = d.len();
      if (r > this.range || r < this.r) return null;
      const a = Math.min(this.cap, this.K / (r * r));
      return d.scale(a / r);
    }
    update() {}
  }

  /* ---------------------------------------------------------------- */
  /** A rigid blade on a pivot, kept swinging to its amplitude. */
  class Pendulum {
    constructor(game, px, py, len, opts = {}) {
      this.game = game;
      this.pivot = new Vec2(px, py);
      this.len = len;
      this.amp = opts.amp || 0.9;
      const w = opts.width || 0.16;
      const b = (this.body = game.add(Bodies.box(px, py - len / 2, w, len, { mass: opts.mass || 30, material: Nudge.MAT.iron })));
      b.role = 'blade';
      b.size = [w, len];
      game.addJoint(new Joints.RevoluteJoint(game.anchor, b, this.pivot));
      // Start at the top of a swing.
      const a = this.amp;
      b.setPosition(this.pivot.add(new Vec2(Math.sin(a) * len / 2, -Math.cos(a) * len / 2)), a);
    }
    get angle() { return this.body.angle; }
    update() {
      // Give back the energy the solver bleeds off, so the swing keeps its amplitude:
      // ½·I_p·ω² + m·g·h = m·g·h_max.
      const b = this.body, L = this.len, g = 9.8;
      const Ip = b.I + b.mass * (L / 2) ** 2;
      const spare = b.mass * g * (L / 2) * (Math.cos(b.angle) - Math.cos(this.amp));
      const w = Math.sqrt(Math.max(0, (2 * spare) / Ip));
      if (Math.abs(b.angVel) > 1e-3) {
        // Spin and centre velocity together, so the hinge has nothing to undo.
        const om = Math.sign(b.angVel) * w, r = b.pos.sub(this.pivot);
        b.angVel = om;
        b.vel.set(-om * r.y, om * r.x);
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /**
   * A skater: it can only shove itself along as hard as the ground's grip
   * allows (μs·N) — mighty on sand, helpless on ice.
   */
  class Skater {
    constructor(game, x, y, opts = {}) {
      this.game = game;
      this.home = opts.home || [x - 6, x + 6];
      const b = (this.body = game.add(Bodies.box(x, y + 0.35, 0.6, 0.7, { mass: 40, material: Nudge.MAT.runner, fixedRotation: true })));
      b.role = 'monster';
      b.kind = 'skater';
      b.size = [0.6, 0.7];
      b.noBuoyancy = false;
      this.push = new Vec2();
      this.grip = 0;
      this.dazed = 0;
    }
    /** The ground under it and how hard it presses (from last step's contacts). */
    ground() {
      const w = this.game.world, b = this.body;
      let N = 0, mu = 0;
      for (const arb of w.arbiters.values()) {
        if (arb.a !== b && arb.b !== b) continue;
        const o = arb.a === b ? arb.b : arb.a;
        const n = arb.a === b ? arb.normal.neg() : arb.normal;    // into the skater
        if (n.y < 0.6 || !o.isStatic) continue;
        let P = 0;
        for (const c of arb.contacts) P += c.Pn;
        N += P / w.dt;
        // Its spiked boots bite as hard as the ground allows.
        mu = Math.max(mu, o.shapes[0].material.mu);
      }
      return { N, mu };
    }
    think(dt) {
      const g = this.game, b = this.body, p = g.pointer.pos;
      if (this.dazed > 0) { this.dazed -= dt; this.push = new Vec2(); return; }
      const { N, mu } = this.ground();
      this.grip = mu * N;
      const tx = Math.max(this.home[0], Math.min(this.home[1], p.x));
      const want = Math.sign(tx - b.pos.x) * Math.min(4.5, Math.abs(tx - b.pos.x) * 2);
      const F = Math.max(-this.grip, Math.min(this.grip, (want - b.vel.x) * b.mass * 4));
      this.push = new Vec2(F, 0);
      b.applyForce(this.push);
    }
    after() {}
  }

  /* ---------------------------------------------------------------- */
  /** Icicles along a ceiling: each shivers, then drops, then grows back. */
  class Icicles {
    constructor(game, xs, y, opts = {}) {
      this.game = game;
      this.slots = xs.map((x, i) => ({ x, y, t: (opts.phase || 0) + i * (opts.stagger || 0.9), body: null }));
      this.period = opts.period || 3.2;
      this.grow = opts.grow || 1.2;
    }
    update(dt) {
      const g = this.game;
      for (const s of this.slots) {
        s.t += dt;
        const ph = s.t % this.period;
        if (!s.body && ph > this.period - 0.05) {
          const b = g.add(Bodies.polygon([new Vec2(s.x - 0.12, s.y), new Vec2(s.x + 0.12, s.y), new Vec2(s.x, s.y - 0.6)], { density: 900, material: Nudge.MAT.ice }));
          b.role = 'icicle';
          b.born = g.time;
          s.body = b;
          g.emit({ type: 'icicle', p: new Vec2(s.x, s.y) });
        }
        if (s.body && (g.time - s.body.born > 2.5)) { g.world.remove(s.body); s.body = null; }
        s.shiver = ph > this.period - this.grow ? (ph - (this.period - this.grow)) / this.grow : 0;
      }
    }
  }

  Nudge.Dropper = Dropper;
  Nudge.Orb = Orb;
  Nudge.Pendulum = Pendulum;
  Nudge.Skater = Skater;
  Nudge.Icicles = Icicles;
})(typeof window !== 'undefined' ? window : globalThis);
