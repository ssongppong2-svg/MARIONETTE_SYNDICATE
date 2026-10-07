/*
 * Nudge — shared building blocks for every region: materials, solids,
 * bodies of a given mass, and the devices the world is made of
 * (breakable walls, pressure plates, release pins, gates, fragments,
 * checkpoints, hazards).
 */
(function (root) {
  'use strict';
  const Lab = root.Lab;
  const { Vec2, Bodies, Joints } = Lab;
  const Nudge = (Lab.Nudge = Lab.Nudge || {});

  /* Materials: μs, μk, e. Pairs take the smaller value (the smoother surface wins). */
  const MAT = {
    rock: { key: 'rock', mu: 0.6, muk: 0.5, e: 0.05 },
    smooth: { key: 'smooth', mu: 0.12, muk: 0.1, e: 0.05 },
    ice: { key: 'ice', mu: 0.03, muk: 0.02, e: 0.05 },
    sand: { key: 'sand', mu: 0.9, muk: 0.8, e: 0.02 },
    rubber: { key: 'rubber', mu: 1.0, muk: 0.9, e: 0.1 },
    sack: { key: 'sack', mu: 0.85, muk: 0.75, e: 0.02 },
    belt: { key: 'belt', mu: 0.9, muk: 0.85, e: 0.02 },
    stone: { key: 'stone', mu: 0.7, muk: 0.6, e: 0.08 },
    iron: { key: 'iron', mu: 0.5, muk: 0.4, e: 0.15 },
    wood: { key: 'wood', mu: 0.6, muk: 0.5, e: 0.2 },
    foam: { key: 'foam', mu: 0.8, muk: 0.7, e: 0.1 },
    runner: { key: 'runner', mu: 0.05, muk: 0.04, e: 0.05 },
    slick: { key: 'slick', mu: 0, muk: 0, e: 0 },
    soft: { key: 'soft', mu: 0.4, muk: 0.3, e: 0.15 },
    pointer: { key: 'pointer', mu: 0, muk: 0, e: 0 },          // it shoves straight along the contact, never drags
    monster: { key: 'monster', mu: 0.5, muk: 0.4, e: 0.2 },
  };

  const kit = {
    MAT,

    /** Static box from corners. */
    solid(game, x0, y0, x1, y1, mat = MAT.rock, opts = {}) {
      const b = Bodies.box((x0 + x1) / 2, (y0 + y1) / 2, x1 - x0, y1 - y0, Object.assign({ type: 'static', material: mat }, opts));
      b.surface = mat.key;
      return game.add(b);
    },
    /** Static convex polygon from world points (ramps, funnels). */
    wedge(game, pts, mat = MAT.rock, opts = {}) {
      const b = Bodies.polygon(pts.map((p) => new Vec2(p[0], p[1])), Object.assign({ type: 'static', material: mat }, opts));
      b.surface = mat.key;
      return game.add(b);
    },
    /** A block of given mass and density standing on y, w:h = aspect. */
    block(game, x, y, mass, density, mat, aspect = 1.3, opts = {}) {
      const area = mass / (density * Lab.DEPTH);
      const w = Math.sqrt(area * aspect), h = area / w;
      const b = game.add(Bodies.box(x, y + h / 2, w, h, Object.assign({ mass, material: mat }, opts)));
      b.size = [w, h];
      b.grab = true;
      return b;
    },
    /** A ball of given mass and density resting on y. */
    ball(game, x, y, mass, density, mat, opts = {}) {
      const r = Math.sqrt(mass / (density * Lab.DEPTH * Math.PI));
      const b = game.add(Bodies.circle(x, y + r, r, Object.assign({ mass, material: mat }, opts)));
      b.size = [2 * r, 2 * r];
      b.radius = r;
      b.grab = true;
      return b;
    },
  };

  /* ---------------------------------------------------------------- */
  /**
   * A wall that only gives way to a sustained push: the force pressing on it
   * (smoothed) must stay above `strength` for `endure` seconds.
   */
  class Wall {
    constructor(game, x0, y0, x1, y1, opts = {}) {
      this.game = game;
      this.box = [x0, y0, x1, y1];
      this.body = kit.solid(game, x0, y0, x1, y1, MAT.slick);
      this.body.role = 'wall';
      this.strength = opts.strength || 600;
      this.endure = opts.endure || 2;
      this.axis = opts.axis || new Vec2(1, 0);
      this.color = opts.color;
      this.force = 0;
      this.stress = 0;
      this.broken = false;
    }
    pressing() {
      const w = this.body, world = this.game.world;
      let F = 0;
      for (const arb of world.arbiters.values()) {
        if (arb.a !== w && arb.b !== w) continue;
        let P = 0;
        for (const c of arb.contacts) P += c.Pn;
        F += (P * Math.abs(arb.normal.dot(this.axis))) / world.dt;
      }
      return F;
    }
    update(dt) {
      if (this.broken) return;
      this.force += (this.pressing() - this.force) * Math.min(1, dt / 0.3);
      if (this.force >= this.strength) this.stress += dt / this.endure;
      else this.stress = Math.max(0, this.stress - dt * 0.5);
      if (this.stress >= 1) this.shatter();
    }
    shatter() {
      const g = this.game, [x0, y0, x1, y1] = this.box;
      this.broken = true;
      g.world.remove(this.body);
      const rng = Lab.Mathx.makeRng(Math.round(x0 * 31 + y0 * 7));
      this.shards = [];
      for (let y = y0 + 0.15; y < y1 - 0.1; y += 0.42) {
        for (let x = x0 + 0.1; x < x1; x += 0.25) {
          const piece = g.add(Bodies.box(x, y, 0.16 + rng() * 0.1, 0.18 + rng() * 0.18, { density: 300, material: MAT.soft, angle: (rng() - 0.5) * 0.6 }));
          piece.role = 'shard';
          piece.vel.set((rng() - 0.5) * 3, rng() * 1.5);
          piece.angVel = (rng() - 0.5) * 6;
          piece.life = 1.2 + rng() * 1.6;
          piece.born = g.time;
          piece.color = this.color;
          this.shards.push(piece);
        }
      }
      g.emit({ type: 'break', p: new Vec2((x0 + x1) / 2, (y0 + y1) / 2), wall: this });
    }
    /** Shards melt away after their time. */
    melt() {
      if (!this.shards) return;
      const g = this.game;
      this.shards = this.shards.filter((s) => {
        if (g.time - s.born < s.life) return true;
        g.world.remove(s);
        g.emit({ type: 'pop', p: s.pos.clone(), color: this.color });
        return false;
      });
    }
  }

  /** A pressure plate: remembers when something heavy last landed on it. */
  class Plate {
    constructor(game, x0, x1, y, opts = {}) {
      this.game = game;
      this.body = kit.solid(game, x0, y - 0.06, x1, y, MAT.rock);
      this.body.role = 'plate';
      this.minImpulse = opts.minImpulse || 2;
      this.lastHit = -Infinity;
      this.load = 0;
    }
    update() {
      const w = this.game.world;
      let load = 0;
      for (const arb of w.arbiters.values()) {
        if (arb.a !== this.body && arb.b !== this.body) continue;
        let P = 0;
        for (const c of arb.contacts) P += c.Pn;
        load += P / w.dt;
      }
      this.load = load;
    }
    impact(P) { if (P >= this.minImpulse) this.lastHit = this.game.time; }
  }

  /**
   * A release pin (from ΣF): a knob on a braked rail; once pulled `release`
   * metres it trips `onRelease`. Knobs never collide with anything.
   */
  class Pin {
    constructor(game, x, y, opts = {}) {
      this.game = game;
      const k = (this.body = game.add(Bodies.box(x, y, 0.08, opts.h || 0.36, { mass: 1, material: MAT.slick, gravityScale: 0, category: 0, mask: 0 })));
      k.role = 'knob';
      k.grab = true;
      k.isKnob = true;
      k.size = [0.08, opts.h || 0.36];
      this.dir = opts.dir || new Vec2(1, 0);
      this.origin = k.pos.clone();
      this.release = opts.release || 0.3;
      this.rail = game.addJoint(new Joints.SliderJoint(game.anchor, k, k.pos, this.dir, {
        lower: 0, upper: this.release + 0.08, motor: { enabled: true, speed: 0, maxForce: opts.friction || 25 },
      }));
      this.onRelease = opts.onRelease || null;
      this.tripped = false;
    }
    get travel() { return this.body.pos.sub(this.origin).dot(this.dir); }
    update() {
      if (!this.tripped && this.travel >= this.release) {
        this.tripped = true;
        if (this.onRelease) this.onRelease();
        this.game.emit({ type: 'pin', p: this.body.pos.clone() });
      }
    }
    /** Put the pin back (when its mechanism resets). */
    reset() {
      this.body.setPosition(this.origin.clone());
      this.body.vel.set(0, 0);
      this.tripped = false;
    }
  }

  /** A static gate that can be lifted out of the way. */
  class Gate {
    constructor(game, x0, y0, x1, y1, opts = {}) {
      this.game = game;
      this.box = [x0, y0, x1, y1];
      this.body = kit.solid(game, x0, y0, x1, y1, opts.mat || MAT.rock);
      this.body.role = 'gate';
      this.open = false;
      this.t = 0;          // 0 closed … 1 open (for drawing)
      this.kind = opts.kind || 'gate';
    }
    lift() {
      if (this.open) return;
      this.open = true;
      this.game.world.remove(this.body);
      this.game.emit({ type: 'gate', p: new Vec2((this.box[0] + this.box[2]) / 2, (this.box[1] + this.box[3]) / 2) });
    }
    update(dt) { this.t = Math.max(0, Math.min(1, this.t + (this.open ? dt : -dt) / 0.6)); }
  }

  /** Ground that breaks the pointer on touch (spikes, frost). */
  class Hazard {
    constructor(game, x0, y0, x1, y1, kind = 'spikes') {
      this.box = [x0, y0, x1, y1];
      this.kind = kind;
      game.hazards.push(this);
    }
    hits(p, r) {
      const [x0, y0, x1, y1] = this.box;
      return p.x + r > x0 && p.x - r < x1 && p.y + r > y0 && p.y - r < y1;
    }
  }

  Nudge.MAT = MAT;
  Nudge.kit = kit;
  Nudge.Wall = Wall;
  Nudge.Plate = Plate;
  Nudge.Pin = Pin;
  Nudge.Gate = Gate;
  Nudge.Hazard = Hazard;
})(typeof window !== 'undefined' ? window : globalThis);
