/*
 * Nudge — rules (DOM-free).
 * The pointer chases the mouse with a capped force; water flows by volume;
 * the wall measures the force pressing on it and fails only under a
 * sustained overload; the light behind it ends the room.
 */
(function (root) {
  'use strict';
  const Lab = root.Lab;
  const { Vec2, Bodies } = Lab;
  const Nudge = (Lab.Nudge = Lab.Nudge || {});

  const Q_IN = 2.4;   // m²/s through a fully open gate
  const Q_OUT = 1.6;  // m²/s through a fully open drain

  /** The pointer: a soft body that follows the mouse but pushes with at most POINTER_FORCE. */
  class PointerDrive {
    constructor(lv) {
      this.lv = lv;
      this.body = lv.pointer;
      this.target = lv.pointer.pos.clone();
      this.F = new Vec2();
      this.strained = false;
    }
    apply(dt) {
      const b = this.body, L = this.lv.L;
      const d = this.target.sub(b.pos);
      let vDes = d.scale(9);
      const sp = vDes.len();
      if (sp > L.POINTER_SPEED) vDes = vDes.scale(L.POINTER_SPEED / sp);
      // Velocity servo with a fixed gain: pressing the mouse deeper past a contact pushes
      // harder, saturating at POINTER_FORCE about 15 cm in.
      let F = vDes.sub(b.vel).scale(30);
      const f = F.len();
      this.strained = f > L.POINTER_FORCE * 0.98 && d.len() > 0.2;
      if (f > L.POINTER_FORCE) F = F.scale(L.POINTER_FORCE / f);
      b.applyForce(F);
      this.F = F;
      // Water thickens around the pointer.
      if (this.lv.underwater(b.pos)) b.applyForce(b.vel.scale(-1.2));
    }
  }

  class Rules {
    constructor(lv) {
      this.lv = lv;
      this.drive = new PointerDrive(lv);
      lv.world.addForce(this.drive);
      this.time = 0;
      this.force = 0;         // smoothed force on the wall (N)
      this.stress = 0;        // 0..1 accumulated overload
      this.broken = false;
      this.done = false;
      this.events = [];
      this.shards = [];
      lv.underwater = (p) => {
        const T = lv.L.TUNNEL, W = lv.L.WELL;
        if (p.y > lv.level) return false;
        if (p.x >= W.x0 && p.x <= W.x1 && p.y >= W.floor) return true;
        return p.x >= T.x0 && p.x <= T.x1 && p.y >= T.floor && p.y <= T.roof;
      };
      lv.world.onImpact = (arb, P) => {
        if (P > 0.25) this.events.push({ type: 'impact', P, p: arb.contacts[0].p });
      };
    }

    setTarget(p) { this.drive.target = p.clone(); }

    /** Net force the ram (or anything else) presses into the wall this step. */
    wallForce() {
      const w = this.lv.wall, dt = this.lv.world.dt;
      let fx = 0;
      for (const arb of this.lv.world.arbiters.values()) {
        if (arb.a !== w && arb.b !== w) continue;
        let P = 0;
        for (const c of arb.contacts) P += c.Pn;
        // Normal from a to b; the wall's share points into the wall.
        const n = arb.a === w ? arb.normal.neg() : arb.normal;
        fx += (P * Math.abs(n.x)) / dt;
      }
      return fx;
    }

    step(dt) {
      const lv = this.lv, L = lv.L;
      // Water: volume bookkeeping, then the level follows the basin's shape.
      this.qIn = Q_IN * lv.inflowOpen();
      this.qOut = lv.volume > 1e-6 ? Q_OUT * lv.drainOpen() : 0;
      const vMax = lv.volumeAt(L.MAX_LEVEL);
      lv.volume = Math.max(0, Math.min(vMax, lv.volume + (this.qIn - this.qOut) * dt));
      lv.setLevel(lv.levelAt(lv.volume));

      lv.world.step(dt);
      this.time += dt;

      if (!this.broken) {
        const raw = this.wallForce();
        const k = 1 - Math.exp(-dt / 0.3);
        this.force += (raw - this.force) * k;
        if (this.force >= L.STRENGTH) this.stress += dt / L.ENDURE;
        else this.stress = Math.max(0, this.stress - dt * 0.5);
        if (this.stress >= 1) this.breakWall();
      }
      if (this.broken) this.dissolveShards();
      if (this.broken && !this.done && lv.pointer.pos.dist(L.GOAL) < 0.38) {
        this.done = true;
        this.doneAt = this.time;
        this.events.push({ type: 'goal', p: L.GOAL.clone() });
      }
    }

    breakWall() {
      const lv = this.lv, W = lv.L.WALL;
      this.broken = true;
      this.brokenAt = this.time;
      lv.world.remove(lv.wall);
      // Shatter into soft pieces that tumble away from the ram.
      const rng = Lab.Mathx.makeRng(7);
      for (let y = W.y0 + 0.15; y < W.y1 - 0.1; y += 0.42) {
        for (let x = W.x0 + 0.12; x < W.x1; x += 0.25) {
          const w = 0.16 + rng() * 0.12, h = 0.2 + rng() * 0.2;
          const piece = Bodies.box(x, y, w, h, { density: 300, material: lv.MAT.soft, angle: (rng() - 0.5) * 0.6 });
          piece.role = 'shard';
          piece.vel.set(1.5 + rng() * 2.5, (rng() - 0.3) * 1.5);
          piece.angVel = (rng() - 0.5) * 6;
          piece.life = 1.4 + rng() * 1.8; // s until it melts away, clearing the way to the light
          lv.world.add(piece);
          this.shards.push(piece);
        }
      }
      this.events.push({ type: 'break', p: new Vec2(W.x0, lv.L.GROUND + 0.5) });
    }

    /** Pieces of the wall melt away one by one once their time is up. */
    dissolveShards() {
      const age = this.time - this.brokenAt;
      this.shards = this.shards.filter((sh) => {
        if (age < sh.life) return true;
        this.lv.world.remove(sh);
        this.events.push({ type: 'pop', p: sh.pos.clone() });
        return false;
      });
    }

    drainEvents() {
      const e = this.events;
      this.events = [];
      return e;
    }
  }

  Nudge.Rules = Rules;
  Nudge.Q_IN = Q_IN;
  Nudge.Q_OUT = Q_OUT;
})(typeof window !== 'undefined' ? window : globalThis);
