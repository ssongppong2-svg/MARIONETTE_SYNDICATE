/*
 * Nudge — the world and its rules (DOM-free).
 *
 * One physics world holds every region. Regions are built by functions in
 * Nudge.regions and can be rebuilt on their own. The game steps the pointer,
 * monsters and fields, the solver, then the devices, hazards, checkpoints and
 * fragments, and keeps a small save (fragments found, last checkpoint).
 */
(function (root) {
  'use strict';
  const Lab = root.Lab;
  const { Vec2, Bodies, World } = Lab;
  const Nudge = (Lab.Nudge = Lab.Nudge || {});
  Nudge.regions = Nudge.regions || {};

  const G = 9.8;
  /** The six fragments of the key, in the door's order. */
  const FRAGMENTS = [
    { id: 'gravity', name: '중력', glyph: 'W' },
    { id: 'friction', name: '마찰력', glyph: 'f' },
    { id: 'buoyancy', name: '부력', glyph: 'B' },
    { id: 'elastic', name: '탄성력', glyph: 'F' },
    { id: 'under', name: '지하세계', glyph: '∇' },
    { id: 'brother', name: '빅 브라더', glyph: '◉' },
  ];
  const ORDER = ['hub', 'gravity', 'friction'];

  class Game {
    constructor(opts = {}) {
      this.world = new World({ gravity: new Vec2(0, -G), frictionMix: 'min', velocityIterations: 12, positionIterations: 5 });
      this.anchor = this.world.add(Bodies.box(0, -500, 0.1, 0.1, { type: 'static', category: 0, mask: 0 }));
      this.time = 0;
      this.events = [];
      this.hazards = [];
      this.fields = [];
      this.regions = [];
      this.byId = {};
      this.save = Object.assign({ fragments: {}, delivered: {}, checkpoint: 'hub:start', cleared: {} }, opts.save || {});
      this.building = null;
      for (const id of opts.regions || ORDER) this.buildRegion(id);
      const cp = this.checkpoint(this.save.checkpoint) || this.checkpoint('hub:start');
      this.pointer = new Nudge.Pointer(this, cp.pos);
      this.world.addForce(this.pointer);
      this.world.addForce({ apply: (dt) => this.applyFields(dt) });
      this.world.onImpact = (arb, P) => this.impact(arb, P);
      this.current = this.regionAt(this.pointer.pos);
    }

    /* ---------------- construction ---------------- */
    buildRegion(id) {
      const make = Nudge.regions[id];
      if (!make) return null;
      const R = { id, bodies: [], joints: [], devices: [], monsters: [], walls: [], checkpoints: [], fragment: null, hazards: [], fields: [], gates: [] };
      this.building = R;
      const hz = this.hazards.length, fl = this.fields.length;
      make(this, R);
      R.hazards = this.hazards.slice(hz);
      R.fields = this.fields.slice(fl);
      this.building = null;
      const old = this.byId[id];
      if (old) this.regions[this.regions.indexOf(old)] = R; else this.regions.push(R);
      this.byId[id] = R;
      return R;
    }
    /** Tear a region down and build it fresh (its fragment, once found, stays found). */
    resetRegion(id) {
      const R = this.byId[id];
      if (!R) return;
      if (this.pointer.grip && this.pointer.grip.body.regionId === id) this.pointer.release();
      for (const b of R.bodies) if (b.world) this.world.remove(b);
      for (const j of R.joints) this.world.removeJoint(j);
      this.hazards = this.hazards.filter((h) => !R.hazards.includes(h));
      this.fields = this.fields.filter((f) => !R.fields.includes(f));
      this.buildRegion(id);
      this.emit({ type: 'regionReset', id });
    }
    add(body) {
      this.world.add(body);
      if (this.building) { this.building.bodies.push(body); body.regionId = this.building.id; }
      return body;
    }
    addJoint(j) {
      this.world.addJoint(j);
      if (this.building) this.building.joints.push(j);
      return j;
    }
    device(d) { this.building.devices.push(d); return d; }
    monster(m) { this.building.monsters.push(m); return m; }
    wall(w) { this.building.walls.push(w); this.building.devices.push(w); return w; }
    gate(g) { this.building.gates.push(g); this.building.devices.push(g); return g; }
    checkpointAt(id, x, y, name) {
      const cp = { id: `${this.building.id}:${id}`, pos: new Vec2(x, y), name, region: this.building.id };
      this.building.checkpoints.push(cp);
      return cp;
    }
    fragmentAt(id, x, y) {
      const f = { id, pos: new Vec2(x, y), taken: !!this.save.fragments[id] };
      this.building.fragment = f;
      return f;
    }
    field(f) { this.fields.push(f); return f; }
    checkpoint(id) {
      for (const R of this.regions) for (const c of R.checkpoints) if (c.id === id) return c;
      return null;
    }
    regionAt(p) {
      for (const R of this.regions) {
        const b = R.bounds;
        if (b && p.x >= b[0] && p.x <= b[2] && p.y >= b[1] && p.y <= b[3]) return R;
      }
      return null;
    }

    /* ---------------- step ---------------- */
    step(dt) {
      const ptr = this.pointer;
      for (const R of this.regions) for (const m of R.monsters) if (!m.gone) m.think(dt);
      this.world.step(dt);
      this.time += dt;
      ptr.sense(dt);
      for (const R of this.regions) {
        for (const d of R.devices) d.update(dt);
        for (const w of R.walls) w.melt();
        for (const m of R.monsters) if (!m.gone) m.after(dt);
        if (R.update) R.update(dt);
      }
      this.pointerRules(dt);
    }

    /** Fields push on every loose body (and carry the pointer's aim along). */
    applyFields(dt) {
      const ptr = this.pointer;
      ptr.drift = ptr.drift.scale(Math.exp(-dt / 0.5));
      for (const f of this.fields) {
        for (const b of this.world.bodies) {
          if (!b.isDynamic || b.isKnob || b.role === 'monster' || b === ptr.body) continue;
          const a = f.accel(b.pos);
          if (a) { b.applyForce(a.scale(b.mass)); b.fieldA = a; }
        }
        if (!ptr.dead) {
          // The pointer is barely matter: fields tug it at a third of their strength.
          const a = f.accel(ptr.pos);
          if (a) ptr.drift = ptr.drift.addScaled(a, dt * 0.35);
        }
      }
    }

    pointerRules(dt) {
      const ptr = this.pointer, p = ptr.pos;
      if (ptr.dead) {
        ptr.dead -= dt;
        if (ptr.dead <= 0) {
          const cp = this.checkpoint(this.save.checkpoint) || this.checkpoint('hub:start');
          ptr.respawn(cp.pos);
          this.emit({ type: 'respawn', p: cp.pos.clone() });
        }
        return;
      }
      if (ptr.crush > 0.06) return this.shatter('crush');
      for (const h of this.hazards) if (h.hits(p, Nudge.PT.R * 0.8)) return this.shatter(h.kind);
      // Checkpoints and fragments.
      for (const R of this.regions) {
        for (const c of R.checkpoints) {
          if (this.save.checkpoint !== c.id && p.dist(c.pos) < 0.7) {
            this.save.checkpoint = c.id;
            this.emit({ type: 'checkpoint', id: c.id, p: c.pos.clone(), name: c.name });
          }
        }
        const f = R.fragment;
        if (f && !f.taken && p.dist(f.pos) < 0.45) {
          f.taken = true;
          this.save.fragments[f.id] = true;
          this.save.cleared[R.id] = true;
          this.emit({ type: 'fragment', id: f.id, p: f.pos.clone() });
        }
      }
      // Fragments carried home fly into the door.
      const here = this.regionAt(p);
      if (here && here.id === 'hub') {
        for (const F of FRAGMENTS) {
          if (this.save.fragments[F.id] && !this.save.delivered[F.id]) {
            this.save.delivered[F.id] = true;
            this.emit({ type: 'socket', id: F.id });
          }
        }
      }
      if (here !== this.current) {
        this.current = here;
        if (here) this.emit({ type: 'region', id: here.id, name: here.name });
      }
    }

    shatter(cause) {
      if (this.pointer.dead) return;
      const p = this.pointer.pos.clone();
      this.pointer.shatter();
      this.emit({ type: 'shatter', p, cause });
    }

    /** A blow on the pointer: an arrow at its point of application, and maybe the end of it. */
    hitPointer(F, at, dir, source) {
      const ptr = this.pointer;
      if (ptr.dead) return;
      this.emit({ type: 'hit', F, p: at.clone(), dir: dir.norm(), source });
      if (F >= Nudge.PT.BREAK) return this.shatter(source || 'impact');
      ptr.knock(dir.norm().scale((F * Nudge.PT.TAU) * 1.2));
    }

    impact(arb, P) {
      const a = arb.a, b = arb.b, ptr = this.pointer.body;
      for (const R of this.regions) for (const d of R.devices) if (d.body && (d.body === a || d.body === b) && d.impact) d.impact(P, a === d.body ? b : a);
      if (a === ptr || b === ptr) {
        const other = a === ptr ? b : a;
        const held = this.pointer.grip && this.pointer.grip.body;
        if (!other.isDynamic || other === held) return;
        const n = a === ptr ? arb.normal : arb.normal.neg();          // pointer → other
        const vIn = -other.velocityAt(arb.contacts[0].p).dot(n);       // other coming at the pointer
        if (vIn <= 0.3) return;
        const F = (Nudge.PT.MASS * vIn * 1.5) / Nudge.PT.TAU;
        if (F >= 12) this.hitPointer(F, arb.contacts[0].p, n.neg(), other.role || 'impact');
        return;
      }
      if (P > 4 && (a.isDynamic || b.isDynamic)) this.emit({ type: 'impact', P, p: arb.contacts[0].p });
    }

    emit(ev) { this.events.push(ev); }
    drainEvents() { const e = this.events; this.events = []; return e; }
    get fragments() { return FRAGMENTS; }
  }

  Nudge.Game = Game;
  Nudge.G = G;
  Nudge.FRAGMENTS = FRAGMENTS;
})(typeof window !== 'undefined' ? window : globalThis);
