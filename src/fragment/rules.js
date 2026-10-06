/*
 * Fragment — world rules (DOM-free).
 * Steps the simulation, notices the fragment's release and capture, and asks
 * for a quiet reset when the well has been overloaded beyond recovery.
 */
(function (root) {
  'use strict';
  const Lab = root.Lab;
  const Frag = (Lab.Fragment = Lab.Fragment || {});

  const OVERLOAD_TRAVEL = 0.72;
  const OVERLOAD_WAIT = 7; // s of a sealed, overloaded gate before the world resets

  class Rules {
    constructor(lv) {
      this.lv = lv;
      this.hand = new Frag.Hand(lv);
      this.player = new Frag.Dot(lv);
      lv.world.addForce(this.player);
      lv.world.addForce(this.hand);
      this.time = 0;
      this.released = false;
      this.collected = false;
      this.collectedAt = null;
      this.overload = 0;
      this.wantsReset = false;
      this.events = [];
      this.wet = new Map();
      lv.world.onImpact = (arb, P) => {
        if (P > 0.4) this.events.push({ type: 'impact', P, p: arb.contacts[0].p });
      };
    }

    touching(a, b) {
      for (const arb of this.lv.world.arbiters.values()) {
        if ((arb.a === a && arb.b === b) || (arb.a === b && arb.b === a)) return arb.contacts.length > 0;
      }
      return false;
    }

    step(dt) {
      const lv = this.lv;
      lv.world.step(dt);
      this.time += dt;

      for (const b of lv.world.bodies) {
        if (!b.isDynamic || b === lv.pad) continue;
        const was = this.wet.get(b) || 0, now = b.wet || 0;
        if (was < 0.02 && now >= 0.02 && b.vel.y < -0.8) this.events.push({ type: 'splash', p: b.pos.clone(), v: -b.vel.y, m: b.mass });
        this.wet.set(b, now);
      }

      if (!this.released && lv.shardFree()) {
        this.released = true;
        this.events.push({ type: 'release', p: lv.shard.pos.clone() });
      }
      if (!this.collected && lv.shard.world && (this.touching(lv.dot, lv.shard) || lv.dot.pos.dist(lv.shard.pos) < 0.24)) {
        this.collected = true;
        this.collectedAt = this.time;
        this.hand.release();
        lv.world.remove(lv.shard);
        this.events.push({ type: 'collect', p: lv.dot.pos.clone() });
      }
      if (!this.released && lv.travel() > OVERLOAD_TRAVEL) this.overload += dt;
      else this.overload = 0;
      if (this.overload > OVERLOAD_WAIT) this.wantsReset = true;
    }

    drainEvents() {
      const e = this.events;
      this.events = [];
      return e;
    }
  }

  Frag.Rules = Rules;
})(typeof window !== 'undefined' ? window : globalThis);
