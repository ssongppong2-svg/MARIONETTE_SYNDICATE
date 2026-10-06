/*
 * Force Chamber — contact constraints
 *
 * Sequential impulses with accumulated clamping and warm starting.
 * Penetration is removed with split impulses (pseudo velocities), so position
 * correction never feeds energy back into the real velocities — sliding and
 * bouncing stay faithful to Coulomb friction and the restitution coefficient.
 */
(function (root) {
  'use strict';
  const Lab = (root.Lab = root.Lab || {});
  const { Vec2 } = Lab;
  const { LINEAR_SLOP } = Lab.Collide;

  const BAUMGARTE = 0.3;
  const RESTITUTION_THRESHOLD = 0.12; // m/s
  const STICK_SPEED = 0.01; // m/s — below this, static friction applies

  class Arbiter {
    /** mix: 'sqrt' (geometric mean, default) or 'min' (the smoother surface wins). */
    constructor(sa, sb, mix = 'sqrt') {
      this.sa = sa;
      this.sb = sb;
      this.a = sa.body;
      this.b = sb.body;
      this.contacts = [];
      this.normal = new Vec2(0, 1);
      const ma = sa.material, mb = sb.material;
      const kA = ma.muk != null ? ma.muk : ma.mu, kB = mb.muk != null ? mb.muk : mb.mu;
      if (mix === 'min') {
        this.mus = Math.min(ma.mu, mb.mu);
        this.muk = Math.min(kA, kB);
      } else {
        this.mus = Math.sqrt(ma.mu * mb.mu);
        this.muk = Math.sqrt(kA * kB);
      }
      this.e = Math.min(ma.e, mb.e);
      this.surfaceSpeed = sb.surfaceSpeed - sa.surfaceSpeed;
      this.stamp = 0;
      this.fresh = true;
    }

    /** Merge a new manifold, carrying accumulated impulses across by feature id. */
    update(m) {
      const old = this.contacts;
      const next = [];
      for (const p of m.points) {
        const c = {
          p: p.p, sep: p.sep, id: p.id,
          Pn: 0, Pt: 0, Pnb: 0,
          r1: null, r2: null, massN: 0, massT: 0, bias: 0, velBias: 0, sticking: true,
        };
        let match = null;
        for (const o of old) if (o.id === c.id && !o.taken) { match = o; break; }
        if (!match) {
          // Feature ids can change when clipped vertices coincide; fall back to proximity.
          let best = 0.02 * 0.02;
          for (const o of old) {
            if (o.taken) continue;
            const d2 = o.p.distSq(c.p);
            if (d2 < best) { best = d2; match = o; }
          }
        }
        if (match) {
          match.taken = true;
          c.Pn = match.Pn; c.Pt = match.Pt;
          c.sticking = match.sticking;
        }
        next.push(c);
      }
      this.contacts = next;
      this.normal = m.normal;
    }

    /**
     * Decide static vs kinetic friction from the slip speed at the end of the
     * previous step (before this step's forces are integrated).
     */
    classify() {
      const a = this.a, b = this.b, n = this.normal;
      const tx = n.y, ty = -n.x;
      for (const c of this.contacts) {
        const r1x = c.p.x - a.pos.x, r1y = c.p.y - a.pos.y;
        const r2x = c.p.x - b.pos.x, r2y = c.p.y - b.pos.y;
        const dvx = b.vel.x - b.angVel * r2y - a.vel.x + a.angVel * r1y;
        const dvy = b.vel.y + b.angVel * r2x - a.vel.y - a.angVel * r1x;
        const vt = dvx * tx + dvy * ty - this.surfaceSpeed;
        c.sticking = Math.abs(vt) < STICK_SPEED;
        // The body kept accelerating while it sank to depth −sep; recover the
        // approach speed at first touch: v² = v₀² − 2·a·δ.
        let vn0 = dvx * n.x + dvy * n.y;
        const g = a.world ? a.world.gravity : null;
        if (g && vn0 < 0 && c.sep < 0) {
          const ga = a.isDynamic ? a.gravityScale : 0, gb = b.isDynamic ? b.gravityScale : 0;
          const an = (g.x * n.x + g.y * n.y) * (gb - ga);
          if (an < 0) vn0 = -Math.sqrt(Math.max(0, vn0 * vn0 + 2 * an * -c.sep));
        }
        c.vn0 = vn0;
      }
    }

    preStep(invDt) {
      const a = this.a, b = this.b, n = this.normal;
      const t = new Vec2(n.y, -n.x);
      for (const c of this.contacts) {
        c.r1 = c.p.sub(a.pos);
        c.r2 = c.p.sub(b.pos);
        const rn1 = c.r1.cross(n), rn2 = c.r2.cross(n);
        const kN = a.invMass + b.invMass + a.invI * rn1 * rn1 + b.invI * rn2 * rn2;
        c.massN = kN > 0 ? 1 / kN : 0;
        const rt1 = c.r1.cross(t), rt2 = c.r2.cross(t);
        const kT = a.invMass + b.invMass + a.invI * rt1 * rt1 + b.invI * rt2 * rt2;
        c.massT = kT > 0 ? 1 / kT : 0;

        c.bias = BAUMGARTE * invDt * Math.max(0, -c.sep - LINEAR_SLOP);

        // Relative velocity before warm starting drives restitution and friction regime.
        const dvx = b.vel.x - b.angVel * c.r2.y - a.vel.x + a.angVel * c.r1.y;
        const dvy = b.vel.y + b.angVel * c.r2.x - a.vel.y - a.angVel * c.r1.x;
        const vn = dvx * n.x + dvy * n.y;
        // Restitution acts on the approach speed at the moment of impact.
        const vImpact = c.vn0 != null ? Math.min(c.vn0, vn) : vn;
        c.velBias = c.vn0 != null && c.vn0 < -RESTITUTION_THRESHOLD ? -this.e * c.vn0 : 0;
        if (vImpact >= -RESTITUTION_THRESHOLD) c.velBias = 0;
        c.Pnb = 0;

        // Warm start.
        const Px = c.Pn * n.x + c.Pt * t.x;
        const Py = c.Pn * n.y + c.Pt * t.y;
        if (Px !== 0 || Py !== 0) {
          a.vel.x -= a.invMass * Px; a.vel.y -= a.invMass * Py;
          a.angVel -= a.invI * (c.r1.x * Py - c.r1.y * Px);
          b.vel.x += b.invMass * Px; b.vel.y += b.invMass * Py;
          b.angVel += b.invI * (c.r2.x * Py - c.r2.y * Px);
        }
      }
    }

    applyImpulse() {
      const a = this.a, b = this.b, n = this.normal;
      const tx = n.y, ty = -n.x;
      for (const c of this.contacts) {
        const r1 = c.r1, r2 = c.r2;
        // Friction first, bounded by the current normal impulse.
        let dvx = b.vel.x - b.angVel * r2.y - a.vel.x + a.angVel * r1.y;
        let dvy = b.vel.y + b.angVel * r2.x - a.vel.y - a.angVel * r1.x;
        const vt = dvx * tx + dvy * ty - this.surfaceSpeed;
        const mu = c.sticking ? this.mus : this.muk;
        const maxPt = mu * c.Pn;
        let dPt = -c.massT * vt;
        const Pt0 = c.Pt;
        c.Pt = Math.max(-maxPt, Math.min(Pt0 + dPt, maxPt));
        dPt = c.Pt - Pt0;
        let Px = dPt * tx, Py = dPt * ty;
        a.vel.x -= a.invMass * Px; a.vel.y -= a.invMass * Py;
        a.angVel -= a.invI * (r1.x * Py - r1.y * Px);
        b.vel.x += b.invMass * Px; b.vel.y += b.invMass * Py;
        b.angVel += b.invI * (r2.x * Py - r2.y * Px);

        // Normal impulse.
        dvx = b.vel.x - b.angVel * r2.y - a.vel.x + a.angVel * r1.y;
        dvy = b.vel.y + b.angVel * r2.x - a.vel.y - a.angVel * r1.x;
        const vn = dvx * n.x + dvy * n.y;
        let dPn = c.massN * (-vn + c.velBias);
        const Pn0 = c.Pn;
        c.Pn = Math.max(Pn0 + dPn, 0);
        dPn = c.Pn - Pn0;
        Px = dPn * n.x; Py = dPn * n.y;
        a.vel.x -= a.invMass * Px; a.vel.y -= a.invMass * Py;
        a.angVel -= a.invI * (r1.x * Py - r1.y * Px);
        b.vel.x += b.invMass * Px; b.vel.y += b.invMass * Py;
        b.angVel += b.invI * (r2.x * Py - r2.y * Px);
      }
    }

    /** Split-impulse position correction on pseudo velocities. */
    applyBias() {
      const a = this.a, b = this.b, n = this.normal;
      for (const c of this.contacts) {
        if (c.bias <= 0 && c.Pnb === 0) continue;
        const r1 = c.r1, r2 = c.r2;
        const dvx = b.bv.x - b.bw * r2.y - a.bv.x + a.bw * r1.y;
        const dvy = b.bv.y + b.bw * r2.x - a.bv.y - a.bw * r1.x;
        const vn = dvx * n.x + dvy * n.y;
        let dP = c.massN * (-vn + c.bias);
        const P0 = c.Pnb;
        c.Pnb = Math.max(P0 + dP, 0);
        dP = c.Pnb - P0;
        const Px = dP * n.x, Py = dP * n.y;
        a.bv.x -= a.invMass * Px; a.bv.y -= a.invMass * Py;
        a.bw -= a.invI * (r1.x * Py - r1.y * Px);
        b.bv.x += b.invMass * Px; b.bv.y += b.invMass * Py;
        b.bw += b.invI * (r2.x * Py - r2.y * Px);
      }
    }

    /** Total contact force on body b (newtons), given the step length. */
    forceOnB(dt) {
      const n = this.normal, t = new Vec2(n.y, -n.x);
      let fx = 0, fy = 0;
      for (const c of this.contacts) {
        fx += (c.Pn * n.x + c.Pt * t.x) / dt;
        fy += (c.Pn * n.y + c.Pt * t.y) / dt;
      }
      return new Vec2(fx, fy);
    }

    normalImpulse() {
      let s = 0;
      for (const c of this.contacts) s += c.Pn;
      return s;
    }
  }

  Lab.Arbiter = Arbiter;
  Lab.ContactConst = { BAUMGARTE, RESTITUTION_THRESHOLD, STICK_SPEED };
})(typeof window !== 'undefined' ? window : globalThis);
