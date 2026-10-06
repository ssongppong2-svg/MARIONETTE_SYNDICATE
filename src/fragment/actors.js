/*
 * Fragment — the dot (the player's body) and the hand (the player's reach).
 *
 * The hand is a force with a hard limit: a stiff spring-damper from the grab
 * point toward the pointer, capped at HAND_MAX newtons. Whatever needs more
 * than that — lifting the stones on land, dragging the ingot straight across
 * rough ground — simply does not happen.
 */
(function (root) {
  'use strict';
  const Lab = root.Lab;
  const { Vec2 } = Lab;
  const Frag = (Lab.Fragment = Lab.Fragment || {});

  const HAND_MAX = 300;   // N
  const REACH = 3.4;      // m from the dot
  const WALK = 3.0;       // m/s
  const JUMP_V = 4.6;     // m/s  (≈ 1.08 m)

  class Hand {
    constructor(lv) {
      this.lv = lv;
      this.body = null;
      this.local = null;
      this.target = null;
      this.F = new Vec2();
      this.point = null;
      this.saturated = false;
    }
    grab(body, p) {
      this.body = body;
      this.local = body.localPoint(p);
      this.target = p.clone();
      this.point = p.clone();
      this.F = new Vec2();
    }
    release() { this.body = null; this.point = null; this.F = new Vec2(); this.saturated = false; }
    get active() { return !!this.body; }
    apply(dt) {
      const b = this.body;
      if (!b) return;
      const p = b.worldPoint(this.local);
      if (p.dist(this.lv.dot.pos) > REACH + 0.35) { this.release(); return; }
      const v = b.velocityAt(p);
      const w = 9;
      const m = b.mass;
      let F = this.target.sub(p).scale(m * w * w).sub(v.scale(2 * m * w));
      const f = F.len();
      this.saturated = f > HAND_MAX;
      if (this.saturated) F = F.scale(HAND_MAX / f);
      b.applyForce(F, p);
      b.torque -= b.I * 6 * b.angVel; // steady the grip
      this.F = F;
      this.point = p;
    }
  }

  class Dot {
    constructor(lv) {
      this.lv = lv;
      this.body = lv.dot;
      this.input = { left: false, right: false, down: false, jump: false, walkTo: null };
      this.jumpLatch = false;
      this.grounded = false;
    }
    groundCheck() {
      const b = this.body;
      for (const arb of this.lv.world.arbiters.values()) {
        if (arb.a !== b && arb.b !== b) continue;
        if (!arb.contacts.length) continue;
        const ny = arb.b === b ? arb.normal.y : -arb.normal.y;
        if (ny > 0.55) return true;
      }
      return false;
    }
    apply(dt) {
      const b = this.body, inp = this.input;
      this.grounded = this.groundCheck();
      const wet = b.wetPrev || 0;
      const floating = wet > 0.05 && wet < 0.95;
      let dir = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
      if (!dir && inp.walkTo != null) {
        const dx = inp.walkTo - b.pos.x;
        dir = Math.abs(dx) > 0.12 ? Math.sign(dx) : 0;
      }
      const target = dir * (wet > 0.05 ? WALK * 0.6 : WALK);
      const amax = this.grounded ? 32 : wet > 0.05 ? 9 : 10;
      const ax = Math.max(-amax, Math.min(amax, (target - b.vel.x) * 14));
      b.applyForce(new Vec2(ax * b.mass, 0));
      if (inp.jump && !this.jumpLatch && (this.grounded || floating)) {
        b.vel.y = Math.max(b.vel.y, JUMP_V);
        this.jumpLatch = true;
        this.jumped = true;
      }
      if (!inp.jump) this.jumpLatch = false;
      // Diving is attempted, never achieved: the push is weaker than the dot's net buoyancy.
      if (inp.down && wet > 0.05) b.applyForce(new Vec2(0, -b.mass * 7));
    }
  }

  Frag.Hand = Hand;
  Frag.Dot = Dot;
  Frag.HAND_MAX = HAND_MAX;
  Frag.REACH = REACH;
})(typeof window !== 'undefined' ? window : globalThis);
