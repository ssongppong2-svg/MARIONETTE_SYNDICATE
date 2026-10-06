/*
 * Force Chamber — chamber runtime
 *
 * A chamber definition supplies: params (seeded unknowns), setup (controls and
 * locks, once per visit), build (physics scene, on every reset), step (per
 * physics step), draw hooks and pointer hooks. The Room object owns the world,
 * instruments, locks, timers and the measurement log.
 */
(function (root) {
  'use strict';
  const Lab = (root.Lab = root.Lab || {});
  const { Vec2, Bodies, World, Mathx, Devices } = Lab;

  const Chambers = [];
  function defineChamber(def) {
    Chambers.push(def);
    Chambers.sort((a, b) => a.no - b.no);
    return def;
  }

  const WALL = 0.3;

  class Room {
    constructor(game, def) {
      this.game = game;
      this.def = def;
      this.id = def.id;
      this.lab = game.lab;
      this.g = game.lab.g;
      this.save = game.saveRoom(def.id);
      this.rng = Mathx.makeRng(Mathx.hashString(String(game.lab.seed) + ':' + def.id));
      this.p = def.params ? def.params(this.rng, this.lab, this) : {};
      this.W = def.size ? def.size[0] : 12;
      this.H = def.size ? def.size[1] : 6.75;
      this.locks = [];
      this.controls = [];
      this.state = Object.assign({}, def.defaults || {}, this.save.state || {});
      this.logLines = [];
      this.editing = false;
      this.listeners = {};
      this.time = 0;
      this.cleared = !!this.save.cleared;
      this.doorOpen = this.cleared ? 1 : 0;
      this.forceScale = def.forceScale || null;
      this.strobeFilter = null;
      if (def.setup) def.setup(this);
      for (const l of this.locks) if (this.save.locks[l.id]) l.open = true;
      this.reset();
    }

    /* ---------------- lifecycle ---------------- */
    reset() {
      const g = this.def.gravity ? this.def.gravity(this) : new Vec2(0, -this.g);
      this.world = new World({ gravity: g });
      this.world.onImpact = (arb, P) => this.emit('impact', arb, P);
      this.world.onBreak = (j) => { this.emit('break', j); if (this.def.onBreak) this.def.onBreak(this, j); };
      this.devices = [];
      this.zones = [];
      this.timers = [];
      this.labels = [];
      this.o = {}; // named scene objects for the chamber script
      this.time = 0;
      this.clockStart = null;
      this.trails = new Map();
      if (this.def.frame !== false) this.buildFrame();
      this.def.build(this, this.world);
      this.emit('reset');
    }

    buildFrame() {
      const W = this.W, H = this.H, w = this.world;
      const opts = { type: 'static', material: 'concrete', style: { frame: true } };
      this.o.floor = w.add(Bodies.box(W / 2, -WALL / 2, W + 2 * WALL, WALL, opts));
      this.o.ceiling = w.add(Bodies.box(W / 2, H + WALL / 2, W + 2 * WALL, WALL, opts));
      this.o.wallL = w.add(Bodies.box(-WALL / 2, H / 2, WALL, H, opts));
      this.o.wallR = w.add(Bodies.box(W + WALL / 2, H / 2, WALL, H, opts));
    }

    get door() {
      const d = this.def.door || {};
      return { x: d.x != null ? d.x : this.W, y: d.y != null ? d.y : 0, h: d.h || 2.1, w: 0.9, side: d.side || 'right' };
    }

    /** One fixed physics step. */
    step(dt) {
      if (this.editing) return;
      if (this.def.preStep) this.def.preStep(this, dt);
      this.world.step(dt);
      this.time += dt;
      const clock = () => this.time;
      for (const d of this.devices) if (d.update) d.update(this.world, dt, clock);
      for (const z of this.zones) z.update(this.world.sensorHits || [], this.time);
      if (this.timers.length) {
        const due = this.timers.filter((t) => t.at <= this.time);
        this.timers = this.timers.filter((t) => t.at > this.time);
        for (const t of due) t.fn();
      }
      if (this.def.step) this.def.step(this, dt);
      this.recordTrails();
    }

    after(seconds, fn) { this.timers.push({ at: this.time + seconds, fn }); }
    startClock() { this.clockStart = this.time; for (const d of this.devices) if (d.reset) d.reset(); }
    get clock() { return this.clockStart == null ? 0 : this.time - this.clockStart; }

    /* ---------------- scene helpers ---------------- */
    add(body, name) {
      this.world.add(body);
      if (name) this.o[name] = body;
      return body;
    }
    solid(x0, y0, x1, y1, opts = {}) {
      return this.add(Bodies.box((x0 + x1) / 2, (y0 + y1) / 2, Math.abs(x1 - x0), Math.abs(y1 - y0),
        Object.assign({ type: 'static', material: 'concrete' }, opts)));
    }
    solidPoly(verts, opts = {}) {
      return this.add(Bodies.polygon(verts, Object.assign({ type: 'static', material: 'concrete' }, opts)));
    }
    joint(j) { return this.world.addJoint(j); }
    device(d) { this.devices.push(d); return d; }
    photogate(opts) { return this.device(new Devices.Photogate(this, opts)); }
    zone(opts) { const z = new Devices.Zone(this, opts); this.zones.push(z); return z; }
    label(p, text, opts = {}) { this.labels.push(Object.assign({ p, text }, opts)); }

    /* ---------------- locks ---------------- */
    /**
     * kind 'code': the player types a number; correct when |v − answer| ≤ tol
     * (or relative tolerance rtol). kind 'task': opened by the chamber script.
     */
    lock(id, opts) {
      const l = Object.assign({ id, kind: 'task', open: false, wrong: 0, cooldownUntil: 0 }, opts);
      this.locks.push(l);
      return l;
    }
    getLock(id) { return this.locks.find((l) => l.id === id); }
    isOpen(id) { const l = this.getLock(id); return !!(l && l.open); }
    get allOpen() { return this.locks.length > 0 && this.locks.every((l) => l.open); }

    submitCode(id, raw) {
      const l = this.getLock(id);
      if (!l || l.open) return { ok: l && l.open };
      if (l.requires && !this.isOpen(l.requires)) return { ok: false, blocked: true };
      const now = performance.now() / 1000;
      if (now < l.cooldownUntil) {
        return { ok: false, cooldown: Math.ceil(l.cooldownUntil - now) };
      }
      const v = parseFloat(String(raw).replace(',', '.').replace(/[^0-9.+\-eE]/g, ''));
      if (!isFinite(v)) return { ok: false, invalid: true };
      const answer = typeof l.answer === 'function' ? l.answer(this) : l.answer;
      const tol = l.rtol != null ? Math.abs(answer) * l.rtol : l.tol;
      this.save.attempts = (this.save.attempts || 0) + 1;
      if (Math.abs(v - answer) <= tol + 1e-9) {
        this.openLock(id, v);
        return { ok: true };
      }
      l.wrong++;
      let cooldown = 0;
      if (l.wrong % 3 === 0) {
        cooldown = 20;
        l.cooldownUntil = now + cooldown;
      }
      this.emit('wrong', l);
      this.game.persist();
      return { ok: false, cooldown };
    }

    openLock(id, value) {
      const l = this.getLock(id);
      if (!l || l.open) return;
      l.open = true;
      this.save.locks[id] = true;
      if (l.notebook) {
        const entry = typeof l.notebook === 'function' ? l.notebook(this, value) : l.notebook;
        if (entry) this.game.note(Object.assign({ room: this.def.no }, entry));
      }
      this.emit('unlock', l);
      if (this.def.onUnlock) this.def.onUnlock(this, l);
      if (this.allOpen) this.complete();
      this.game.persist();
    }

    complete() {
      if (this.cleared) return;
      this.cleared = true;
      this.emit('clear');
      this.game.onRoomCleared(this);
    }

    /* ---------------- controls ---------------- */
    control(type, id, opts) {
      const c = Object.assign({ type, id }, opts);
      if (c.value !== undefined && this.state[id] === undefined) this.state[id] = c.value;
      this.controls.push(c);
      return c;
    }
    section(title, opts) { return this.control('section', 'sec' + this.controls.length, Object.assign({ title }, opts)); }
    slider(id, opts) { return this.control('slider', id, opts); }
    button(id, opts) { return this.control('button', id, opts); }
    choice(id, opts) { return this.control('choice', id, opts); }
    readout(id, opts) { return this.control('readout', id, opts); }
    note(text, opts) { return this.control('note', 'note' + this.controls.length, Object.assign({ text }, opts)); }
    setValue(id, v) {
      this.state[id] = v;
      this.save.state[id] = v;
      const c = this.controls.find((x) => x.id === id);
      if (c && c.onChange) c.onChange(v, this);
      this.emit('controls');
    }
    value(id) { return this.state[id]; }

    /* ---------------- feedback ---------------- */
    say(text, tone = 'info') { this.emit('say', text, tone); }
    record(text) {
      this.logLines.unshift({ t: this.time, text });
      if (this.logLines.length > 60) this.logLines.pop();
      this.emit('log');
    }

    on(evt, fn) { (this.listeners[evt] = this.listeners[evt] || []).push(fn); }
    emit(evt, ...args) {
      for (const fn of this.listeners[evt] || []) fn(...args);
      if (this.game && this.game.onRoomEvent) this.game.onRoomEvent(this, evt, ...args);
    }

    /* ---------------- strobe trails ---------------- */
    recordTrails() {
      if (!this.game.strobe && !this.strobeFilter) return;
      const every = 1 / 20;
      for (const b of this.world.bodies) {
        if (!b.isDynamic || b.style.hidden || b.style.noTrail) continue;
        if (!this.game.strobe && !(this.strobeFilter && this.strobeFilter(b))) continue;
        let tr = this.trails.get(b);
        if (!tr) { tr = { last: -1, pts: [] }; this.trails.set(b, tr); }
        if (this.time - tr.last >= every - 1e-9) {
          if (b.vel.len() > 0.05 || Math.abs(b.angVel) > 0.3) {
            tr.pts.push({ x: b.pos.x, y: b.pos.y, a: b.angle, t: this.time });
            if (tr.pts.length > 90) tr.pts.shift();
          }
          tr.last = this.time;
        }
      }
    }
    clearTrails() { this.trails = new Map(); }

    /* ---------------- persistence ---------------- */
    persistState() {
      this.save.state = Object.assign({}, this.save.state, this.state);
      this.game.persist();
    }
  }

  Lab.WALL = WALL;
  Lab.Room = Room;
  Lab.Chambers = Chambers;
  Lab.defineChamber = defineChamber;
})(typeof window !== 'undefined' ? window : globalThis);
