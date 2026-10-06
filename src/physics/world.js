/*
 * Force Chamber — physics world
 * Fixed-step pipeline: collide → classify friction → forces → warm start →
 * velocity iterations → split-impulse iterations → integrate.
 */
(function (root) {
  'use strict';
  const Lab = (root.Lab = root.Lab || {});
  const { Vec2, Geom, Arbiter, Collide } = Lab;

  class Fluid {
    /** Rectangular body of liquid: x0..x1, from floor y0 up to the surface. */
    constructor(opts) {
      this.x0 = opts.x0; this.x1 = opts.x1;
      this.y0 = opts.y0; this.surface = opts.surface;
      this.density = opts.density != null ? opts.density : 1000;
      this.linearDrag = opts.linearDrag != null ? opts.linearDrag : 2.5;
      this.angularDrag = opts.angularDrag != null ? opts.angularDrag : 1.5;
      this.label = opts.label || '';
      this.style = opts.style || {};
    }
    /** Submerged area and centroid of one shape. */
    submerged(shape) {
      if (shape.type === 'circle') {
        const r = shape.radius;
        if (shape.wc.x + r < this.x0 || shape.wc.x - r > this.x1) return null;
        const s = Geom.circleBelowLine(shape.wc, r, this.surface);
        return s.area > 1e-12 ? s : null;
      }
      let poly = shape.wv.map((v) => v.clone());
      poly = Geom.clipPolygonHalfPlane(poly, new Vec2(0, 1), this.surface);
      if (poly.length < 3) return null;
      poly = Geom.clipPolygonHalfPlane(poly, new Vec2(1, 0), this.x1);
      if (poly.length < 3) return null;
      poly = Geom.clipPolygonHalfPlane(poly, new Vec2(-1, 0), -this.x0);
      if (poly.length < 3) return null;
      const m = Geom.polygonMass(poly);
      return m.area > 1e-12 ? { area: m.area, centroid: m.centroid } : null;
    }
    apply(world) {
      const g = world.gravity;
      for (const b of world.bodies) {
        if (!b.isDynamic) continue;
        const bb = b.aabb;
        if (bb.minY > this.surface || bb.maxX < this.x0 || bb.minX > this.x1) continue;
        let total = 0;
        const totalArea = b.area || 1;
        for (const s of b.shapes) {
          if (s.sensor) continue;
          const sub = this.submerged(s);
          if (!sub) continue;
          total += sub.area;
          const k = this.density * sub.area * Lab.DEPTH;
          // Archimedes: weight of displaced fluid, opposite to gravity, at the centre of buoyancy.
          const Fb = new Vec2(-g.x * k, -g.y * k);
          b.applyForce(Fb, sub.centroid);
          (b.buoyancy = b.buoyancy || []).push({ F: Fb, p: sub.centroid });
          // Linear drag proportional to the wetted fraction.
          const v = b.velocityAt(sub.centroid);
          const c = this.linearDrag * b.mass * (sub.area / totalArea);
          b.applyForce(v.scale(-c), sub.centroid);
        }
        if (total > 0) {
          b.torque -= this.angularDrag * b.I * b.angVel * (total / totalArea);
          b.wet = total / totalArea;
        }
      }
    }
  }

  class World {
    constructor(opts = {}) {
      this.gravity = (opts.gravity || new Vec2(0, -9.81)).clone();
      this.bodies = [];
      this.joints = [];
      this.forces = []; // springs, drag handles, custom force callbacks
      this.fluids = [];
      this.arbiters = new Map();
      this.velocityIterations = opts.velocityIterations || 12;
      this.positionIterations = opts.positionIterations || 6;
      this.time = 0;
      this.stepCount = 0;
      this.dt = 1 / 240;
      this.onBreak = null;
      this.onImpact = null;
    }

    add(body) {
      body.world = this;
      this.bodies.push(body);
      body.updateTransform();
      return body;
    }
    remove(body) {
      const i = this.bodies.indexOf(body);
      if (i >= 0) this.bodies.splice(i, 1);
      for (const [k, arb] of this.arbiters) if (arb.a === body || arb.b === body) this.arbiters.delete(k);
      this.joints = this.joints.filter((j) => !j.bodies().includes(body));
      this.forces = this.forces.filter((f) => !(f.bodies && f.bodies().includes(body)) && f.body !== body);
      body.world = null;
    }
    addJoint(j) { j.world = this; this.joints.push(j); return j; }
    removeJoint(j) { this.joints = this.joints.filter((x) => x !== j); }
    addForce(f) { this.forces.push(f); return f; }
    removeForce(f) { this.forces = this.forces.filter((x) => x !== f); }
    addFluid(f) { this.fluids.push(f); return f; }
    wakeArbiters(body) {
      for (const [k, arb] of this.arbiters) if (arb.a === body || arb.b === body) this.arbiters.delete(k);
    }

    jointConnected(a, b) {
      for (const j of this.joints) {
        if (j.collideConnected) continue;
        const bs = j.bodies();
        if (bs.includes(a) && bs.includes(b)) return true;
      }
      return false;
    }

    /* ---------------- collision ---------------- */
    collide() {
      const stamp = ++this.stepCount;
      const bodies = this.bodies.slice().sort((p, q) => p.aabb.minX - q.aabb.minX);
      const n = bodies.length;
      this.sensorHits = [];
      for (let i = 0; i < n; i++) {
        const A = bodies[i];
        for (let j = i + 1; j < n; j++) {
          const B = bodies[j];
          if (B.aabb.minX > A.aabb.maxX) break;
          if (B.aabb.minY > A.aabb.maxY || B.aabb.maxY < A.aabb.minY) continue;
          if (!A.isDynamic && !B.isDynamic) continue;
          let connectedChecked = false, connected = false;
          for (const sa of A.shapes) {
            for (const sb of B.shapes) {
              if (!(sa.category & sb.mask) || !(sb.category & sa.mask)) continue;
              const aa = sa.aabb, ab = sb.aabb;
              if (aa.minX > ab.maxX || ab.minX > aa.maxX || aa.minY > ab.maxY || ab.minY > aa.maxY) continue;
              if (sa.sensor || sb.sensor) {
                if (Collide.overlaps(sa, sb)) this.sensorHits.push([sa, sb]);
                continue;
              }
              if (!connectedChecked) { connected = this.jointConnected(A, B); connectedChecked = true; }
              if (connected) continue;
              // Order so that ids are stable.
              const [s1, s2] = sa.id < sb.id ? [sa, sb] : [sb, sa];
              const m = Collide.collide(s1, s2);
              if (!m) continue;
              const key = s1.id + ':' + s2.id;
              let arb = this.arbiters.get(key);
              if (!arb) {
                arb = new Arbiter(s1, s2);
                this.arbiters.set(key, arb);
              } else {
                arb.fresh = false;
              }
              arb.update(m);
              arb.stamp = stamp;
            }
          }
        }
      }
      for (const [k, arb] of this.arbiters) if (arb.stamp !== stamp) this.arbiters.delete(k);
    }

    /* ---------------- stepping ---------------- */
    step(dt) {
      this.dt = dt;
      const invDt = 1 / dt;
      const bodies = this.bodies;
      for (const b of bodies) {
        b.prevPos.copy(b.pos);
        b.prevAngle = b.angle;
        b.constrained = 0;
        b.buoyancy = null;
      }

      this.collide();
      for (const arb of this.arbiters.values()) {
        arb.classify();
        arb.a.constrained++;
        arb.b.constrained++;
      }
      for (const j of this.joints) for (const b of j.bodies()) b.constrained++;

      // External forces.
      for (const f of this.forces) f.apply(dt, this);
      for (const fl of this.fluids) fl.apply(this);

      const g = this.gravity;
      for (const b of bodies) {
        if (!b.isDynamic) continue;
        b.ax = g.x * b.gravityScale + b.force.x * b.invMass;
        b.ay = g.y * b.gravityScale + b.force.y * b.invMass;
        b.vel.x += dt * b.ax;
        b.vel.y += dt * b.ay;
        b.angVel += dt * b.invI * b.torque;
        if (b.linearDamping) b.vel.iscale(1 / (1 + dt * b.linearDamping));
        if (b.angularDamping) b.angVel /= 1 + dt * b.angularDamping;
      }

      const arbs = [...this.arbiters.values()];
      for (const arb of arbs) arb.preStep(invDt);
      for (const j of this.joints) j.preStep(dt);

      for (let i = 0; i < this.velocityIterations; i++) {
        for (const j of this.joints) j.solveVelocity();
        for (const arb of arbs) arb.applyImpulse();
      }
      for (let i = 0; i < this.positionIterations; i++) {
        for (const j of this.joints) j.solveBias();
        for (const arb of arbs) arb.applyBias();
      }

      for (const b of bodies) {
        if (b.isStatic) continue;
        let px = dt * (b.vel.x + b.bv.x);
        let py = dt * (b.vel.y + b.bv.y);
        // Unconstrained bodies under uniform gravity follow the exact parabola.
        if (b.isDynamic && b.constrained === 0 && !b.extForce) {
          px -= 0.5 * dt * dt * b.ax;
          py -= 0.5 * dt * dt * b.ay;
        }
        b.pos.x += px;
        b.pos.y += py;
        b.angle += dt * (b.angVel + b.bw);
        b.bv.set(0, 0);
        b.bw = 0;
        b.force.set(0, 0);
        b.torque = 0;
        b.extForce = false;
        b.wet = 0;
        b.updateTransform();
      }

      for (const j of this.joints) j.postStep(dt);
      const broken = this.joints.filter((j) => j.broken);
      if (broken.length) {
        this.joints = this.joints.filter((j) => !j.broken);
        if (this.onBreak) for (const j of broken) this.onBreak(j);
      }
      if (this.onImpact) {
        for (const arb of arbs) {
          if (!arb.fresh) continue;
          let P = 0;
          for (const c of arb.contacts) P += c.Pn;
          if (P > 0) this.onImpact(arb, P);
          arb.fresh = false;
        }
      }
      this.time += dt;
    }

    /* ---------------- queries ---------------- */
    bodiesAt(p, filter) {
      const out = [];
      for (let i = this.bodies.length - 1; i >= 0; i--) {
        const b = this.bodies[i];
        if (filter && !filter(b)) continue;
        if (p.x < b.aabb.minX || p.x > b.aabb.maxX || p.y < b.aabb.minY || p.y > b.aabb.maxY) continue;
        if (b.containsPoint(p)) out.push(b);
      }
      return out;
    }

    /** First hit of the segment p→q. */
    raycast(p, q, filter) {
      let best = null;
      const minX = Math.min(p.x, q.x), maxX = Math.max(p.x, q.x);
      const minY = Math.min(p.y, q.y), maxY = Math.max(p.y, q.y);
      for (const b of this.bodies) {
        if (filter && !filter(b)) continue;
        const bb = b.aabb;
        if (bb.maxX < minX || bb.minX > maxX || bb.maxY < minY || bb.minY > maxY) continue;
        for (const s of b.shapes) {
          if (s.sensor) continue;
          const hit = s.raycast(p, q);
          if (hit && (!best || hit.t < best.t)) best = { t: hit.t, normal: hit.normal, body: b, shape: s };
        }
      }
      if (best) best.point = Vec2.lerp(p, q, best.t);
      return best;
    }

    /** Arbiters touching a body. */
    contactsOf(body) {
      const out = [];
      for (const arb of this.arbiters.values()) if (arb.a === body || arb.b === body) out.push(arb);
      return out;
    }

    /** Net contact force exerted on `body` by everything touching it (N). */
    contactForceOn(body) {
      const F = new Vec2();
      for (const arb of this.arbiters.values()) {
        if (arb.b === body) F.iadd(arb.forceOnB(this.dt));
        else if (arb.a === body) F.isub(arb.forceOnB(this.dt));
      }
      return F;
    }

    /** True if a shape placed in this pose would overlap any solid. */
    shapeOverlapsAny(shape, ignore) {
      for (const b of this.bodies) {
        if (ignore && ignore(b)) continue;
        for (const s of b.shapes) {
          if (s.sensor) continue;
          const a = s.aabb, c = shape.aabb;
          if (a.minX > c.maxX || c.minX > a.maxX || a.minY > c.maxY || c.minY > a.maxY) continue;
          if (Collide.overlaps(shape, s, 0.002)) return b;
        }
      }
      return null;
    }
  }

  Lab.Fluid = Fluid;
  Lab.World = World;
})(typeof window !== 'undefined' ? window : globalThis);
