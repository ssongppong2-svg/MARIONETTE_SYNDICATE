/*
 * Force Chamber — joints and force elements
 *
 * Velocity constraints use the same split-impulse scheme as contacts:
 * the velocity pass is exact (no Baumgarte energy), drift is removed on
 * pseudo velocities. Ropes are inequality constraints that go slack.
 */
(function (root) {
  'use strict';
  const Lab = (root.Lab = root.Lab || {});
  const { Vec2, Geom } = Lab;

  const BETA = 0.25;
  const SLOP = 0.0015;
  const TENSION_TAU = 0.04; // s — smoothing of tension readouts and break checks

  function applyLin(body, Px, Py, rx, ry, sign) {
    body.vel.x += sign * body.invMass * Px;
    body.vel.y += sign * body.invMass * Py;
    body.angVel += sign * body.invI * (rx * Py - ry * Px);
  }
  function applyBiasLin(body, Px, Py, rx, ry, sign) {
    body.bv.x += sign * body.invMass * Px;
    body.bv.y += sign * body.invMass * Py;
    body.bw += sign * body.invI * (rx * Py - ry * Px);
  }

  class Joint {
    constructor(a, b, opts = {}) {
      this.a = a;
      this.b = b;
      this.collideConnected = !!opts.collideConnected;
      this.breakForce = opts.breakForce || Infinity;
      this.broken = false;
      this.style = opts.style || {};
      this.label = opts.label || '';
      this.tension = 0; // smoothed force magnitude carried by the joint (N)
      this.world = null;
    }
    bodies() { return [this.a, this.b]; }
    smoothTension(raw, dt) {
      const k = 1 - Math.exp(-dt / (this.tensionTau || TENSION_TAU));
      this.tension += (raw - this.tension) * k;
      this.rawTension = raw;
    }
    postStep(dt) {
      if (this.tension > this.breakForce) this.broken = true;
    }
  }

  /* ------------------------------------------------------------------ */
  /** Pin joint with optional motor and angle limits. */
  class RevoluteJoint extends Joint {
    constructor(a, b, anchor, opts = {}) {
      super(a, b, opts);
      this.localA = a.localPoint(anchor);
      this.localB = b.localPoint(anchor);
      this.refAngle = b.angle - a.angle;
      this.P = new Vec2();
      this.motor = Object.assign({ enabled: false, speed: 0, maxTorque: 0 }, opts.motor || {});
      this.limit = Object.assign({ enabled: false, lower: 0, upper: 0 }, opts.limit || {});
      this.motorImpulse = 0;
      this.lowerImpulse = 0;
      this.upperImpulse = 0;
    }
    get jointAngle() { return this.b.angle - this.a.angle - this.refAngle; }
    get anchor() { return this.a.worldPoint(this.localA); }

    preStep(dt) {
      const a = this.a, b = this.b;
      this.dt = dt;
      this.r1 = a.xf.rot(this.localA);
      this.r2 = b.xf.rot(this.localB);
      const r1 = this.r1, r2 = this.r2;
      const mA = a.invMass, mB = b.invMass, iA = a.invI, iB = b.invI;
      const k11 = mA + mB + iA * r1.y * r1.y + iB * r2.y * r2.y;
      const k12 = -iA * r1.x * r1.y - iB * r2.x * r2.y;
      const k22 = mA + mB + iA * r1.x * r1.x + iB * r2.x * r2.x;
      let det = k11 * k22 - k12 * k12;
      det = det !== 0 ? 1 / det : 0;
      this.M = [det * k22, -det * k12, det * k11];
      const C = b.pos.add(r2).sub(a.pos).sub(r1);
      this.biasV = C.scale(-BETA / dt);
      this.axialMass = iA + iB > 0 ? 1 / (iA + iB) : 0;
      if (!this.motor.enabled) this.motorImpulse = 0;
      if (!this.limit.enabled) { this.lowerImpulse = 0; this.upperImpulse = 0; }
      // Warm start.
      applyLin(a, this.P.x, this.P.y, r1.x, r1.y, -1);
      applyLin(b, this.P.x, this.P.y, r2.x, r2.y, 1);
      const L = this.motorImpulse + this.lowerImpulse - this.upperImpulse;
      a.angVel -= iA * L;
      b.angVel += iB * L;
      this.lowerBias = 0; this.upperBias = 0;
    }

    solveVelocity() {
      const a = this.a, b = this.b, r1 = this.r1, r2 = this.r2, dt = this.dt;
      const iA = a.invI, iB = b.invI;
      if (this.motor.enabled && this.axialMass > 0) {
        const Cdot = b.angVel - a.angVel - this.motor.speed;
        let imp = -this.axialMass * Cdot;
        const old = this.motorImpulse, max = this.motor.maxTorque * dt;
        this.motorImpulse = Math.max(-max, Math.min(old + imp, max));
        imp = this.motorImpulse - old;
        a.angVel -= iA * imp; b.angVel += iB * imp;
      }
      if (this.limit.enabled && this.axialMass > 0) {
        const angle = this.jointAngle;
        { // lower
          const C = angle - this.limit.lower;
          const Cdot = b.angVel - a.angVel;
          let imp = -this.axialMass * (Cdot + Math.max(C, 0) / dt);
          const old = this.lowerImpulse;
          this.lowerImpulse = Math.max(old + imp, 0);
          imp = this.lowerImpulse - old;
          a.angVel -= iA * imp; b.angVel += iB * imp;
        }
        { // upper
          const C = this.limit.upper - angle;
          const Cdot = a.angVel - b.angVel;
          let imp = -this.axialMass * (Cdot + Math.max(C, 0) / dt);
          const old = this.upperImpulse;
          this.upperImpulse = Math.max(old + imp, 0);
          imp = this.upperImpulse - old;
          a.angVel += iA * imp; b.angVel -= iB * imp;
        }
      }
      const dvx = b.vel.x - b.angVel * r2.y - a.vel.x + a.angVel * r1.y;
      const dvy = b.vel.y + b.angVel * r2.x - a.vel.y - a.angVel * r1.x;
      const M = this.M;
      const Px = -(M[0] * dvx + M[1] * dvy);
      const Py = -(M[1] * dvx + M[2] * dvy);
      this.P.x += Px; this.P.y += Py;
      applyLin(a, Px, Py, r1.x, r1.y, -1);
      applyLin(b, Px, Py, r2.x, r2.y, 1);
    }

    solveBias() {
      const a = this.a, b = this.b, r1 = this.r1, r2 = this.r2;
      if (this.limit.enabled && this.axialMass > 0) {
        const angle = this.jointAngle;
        const Cl = angle - this.limit.lower;
        if (Cl < -0.002 || this.lowerBias > 0) {
          let imp = -this.axialMass * (b.bw - a.bw + BETA * Math.min(Cl + 0.002, 0) / this.dt);
          const old = this.lowerBias;
          this.lowerBias = Math.max(old + imp, 0);
          imp = this.lowerBias - old;
          a.bw -= a.invI * imp; b.bw += b.invI * imp;
        }
        const Cu = this.limit.upper - angle;
        if (Cu < -0.002 || this.upperBias > 0) {
          let imp = -this.axialMass * (a.bw - b.bw + BETA * Math.min(Cu + 0.002, 0) / this.dt);
          const old = this.upperBias;
          this.upperBias = Math.max(old + imp, 0);
          imp = this.upperBias - old;
          a.bw += a.invI * imp; b.bw -= b.invI * imp;
        }
      }
      const dvx = b.bv.x - b.bw * r2.y - a.bv.x + a.bw * r1.y - this.biasV.x;
      const dvy = b.bv.y + b.bw * r2.x - a.bv.y - a.bw * r1.x - this.biasV.y;
      const M = this.M;
      const Px = -(M[0] * dvx + M[1] * dvy);
      const Py = -(M[1] * dvx + M[2] * dvy);
      applyBiasLin(a, Px, Py, r1.x, r1.y, -1);
      applyBiasLin(b, Px, Py, r2.x, r2.y, 1);
    }

    postStep(dt) {
      this.smoothTension(this.P.len() / dt, dt);
      super.postStep(dt);
    }
    reactionForce(dt) { return this.P.scale(1 / dt); }
  }

  /* ------------------------------------------------------------------ */
  /** Rigid rod (rope: false) or inextensible rope that can go slack (rope: true). */
  class DistanceJoint extends Joint {
    constructor(a, b, worldA, worldB, opts = {}) {
      super(a, b, opts);
      this.localA = a.localPoint(worldA);
      this.localB = b.localPoint(worldB);
      this.length = opts.length != null ? opts.length : worldA.dist(worldB);
      this.rope = opts.rope !== false;
      this.impulse = 0;
      this.biasImpulse = 0;
    }
    get anchorA() { return this.a.worldPoint(this.localA); }
    get anchorB() { return this.b.worldPoint(this.localB); }
    get currentLength() { return this.anchorA.dist(this.anchorB); }

    preStep(dt) {
      const a = this.a, b = this.b;
      this.dt = dt;
      this.r1 = a.xf.rot(this.localA);
      this.r2 = b.xf.rot(this.localB);
      const d = b.pos.add(this.r2).sub(a.pos).sub(this.r1);
      const len = d.len();
      this.u = len > 1e-9 ? d.scale(1 / len) : new Vec2(0, 1);
      this.C = len - this.length;
      const crA = this.r1.cross(this.u), crB = this.r2.cross(this.u);
      const K = a.invMass + b.invMass + a.invI * crA * crA + b.invI * crB * crB;
      this.mass = K > 0 ? 1 / K : 0;
      if (this.rope && this.C < -0.05) this.impulse = 0;
      const Px = this.impulse * this.u.x, Py = this.impulse * this.u.y;
      applyLin(a, Px, Py, this.r1.x, this.r1.y, -1);
      applyLin(b, Px, Py, this.r2.x, this.r2.y, 1);
      this.biasImpulse = 0;
    }

    solveVelocity() {
      const a = this.a, b = this.b, r1 = this.r1, r2 = this.r2, u = this.u;
      const dvx = b.vel.x - b.angVel * r2.y - a.vel.x + a.angVel * r1.y;
      const dvy = b.vel.y + b.angVel * r2.x - a.vel.y - a.angVel * r1.x;
      const Cdot = dvx * u.x + dvy * u.y;
      let imp;
      if (this.rope) {
        imp = -this.mass * (Cdot + Math.min(this.C, 0) / this.dt);
        const old = this.impulse;
        this.impulse = Math.min(old + imp, 0);
        imp = this.impulse - old;
      } else {
        imp = -this.mass * Cdot;
        this.impulse += imp;
      }
      const Px = imp * u.x, Py = imp * u.y;
      applyLin(a, Px, Py, r1.x, r1.y, -1);
      applyLin(b, Px, Py, r2.x, r2.y, 1);
    }

    solveBias() {
      if (this.rope && this.C <= SLOP) return;
      const a = this.a, b = this.b, r1 = this.r1, r2 = this.r2, u = this.u;
      const dvx = b.bv.x - b.bw * r2.y - a.bv.x + a.bw * r1.y;
      const dvy = b.bv.y + b.bw * r2.x - a.bv.y - a.bw * r1.x;
      const Cdot = dvx * u.x + dvy * u.y;
      const C = this.rope ? this.C - SLOP : this.C;
      let imp = -this.mass * (Cdot + (BETA * C) / this.dt);
      if (this.rope) {
        const old = this.biasImpulse;
        this.biasImpulse = Math.min(old + imp, 0);
        imp = this.biasImpulse - old;
      }
      const Px = imp * u.x, Py = imp * u.y;
      applyBiasLin(a, Px, Py, r1.x, r1.y, -1);
      applyBiasLin(b, Px, Py, r2.x, r2.y, 1);
    }

    postStep(dt) {
      this.smoothTension(-this.impulse / dt, dt);
      super.postStep(dt);
    }
    get taut() { return this.impulse < 0; }
  }

  /* ------------------------------------------------------------------ */
  /**
   * A massless rope threaded through massless, frictionless pulley wheels.
   * nodes: [{ body, point (world), radius }] — radius is signed: + wraps the
   * rope clockwise, − counter-clockwise, 0 for the rope's end anchors.
   * Constraint: tangent lengths + wrapped arcs ≤ length.
   */
  class RopePath extends Joint {
    constructor(nodes, opts = {}) {
      super(nodes[0].body, nodes[nodes.length - 1].body, opts);
      this.nodes = nodes.map((n) => ({
        body: n.body,
        local: n.body.localPoint(n.point),
        radius: n.radius || 0,
        world: n.point.clone(),
        feed: 0,
        spin: 0,
      }));
      this.segments = [];
      this.impulse = 0;
      this.biasImpulse = 0;
      this.compute();
      this.length = opts.length != null ? opts.length : this.total;
      for (const n of this.nodes) n.feed0 = n.feed;
    }
    bodies() {
      const set = new Set(this.nodes.map((n) => n.body));
      return [...set];
    }

    /** Tangent segments, wrap arcs and total rope length for the current pose. */
    compute() {
      const nodes = this.nodes;
      for (const n of nodes) n.world = n.body.worldPoint(n.local);
      const segs = [];
      for (let i = 0; i < nodes.length - 1; i++) {
        const t = Geom.beltTangent(nodes[i].world, nodes[i].radius, nodes[i + 1].world, nodes[i + 1].radius);
        segs.push(t || { a: nodes[i].world.clone(), b: nodes[i + 1].world.clone(), dir: new Vec2(0, 1), length: 0 });
      }
      let total = 0, run = 0;
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        if (i > 0 && i < nodes.length - 1 && n.radius !== 0) {
          const arrive = segs[i - 1].b, depart = segs[i].a;
          const aIn = Math.atan2(arrive.y - n.world.y, arrive.x - n.world.x);
          const aOut = Math.atan2(depart.y - n.world.y, depart.x - n.world.x);
          let sweep = n.radius > 0 ? aIn - aOut : aOut - aIn;
          sweep = ((sweep % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
          n.sweep = sweep;
          n.aIn = aIn; n.aOut = aOut;
          n.feed = run; // rope length from the first anchor to this wheel
          const arc = Math.abs(n.radius) * sweep;
          total += arc; run += arc;
        }
        if (i < segs.length) { total += segs[i].length; run += segs[i].length; }
      }
      this.segments = segs;
      this.total = total;
      return total;
    }

    preStep(dt) {
      this.dt = dt;
      this.compute();
      this.C = this.total - this.length;
      // Accumulate the Jacobian per body.
      const map = new Map();
      const nodes = this.nodes, segs = this.segments;
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        let gx = 0, gy = 0;
        if (i > 0) { gx += segs[i - 1].dir.x; gy += segs[i - 1].dir.y; }
        if (i < segs.length) { gx -= segs[i].dir.x; gy -= segs[i].dir.y; }
        let e = map.get(n.body);
        if (!e) { e = { body: n.body, jx: 0, jy: 0, ja: 0 }; map.set(n.body, e); }
        e.jx += gx; e.jy += gy;
        const rx = n.world.x - n.body.pos.x, ry = n.world.y - n.body.pos.y;
        e.ja += rx * gy - ry * gx;
      }
      this.J = [...map.values()];
      let K = 0;
      for (const e of this.J) K += e.body.invMass * (e.jx * e.jx + e.jy * e.jy) + e.body.invI * e.ja * e.ja;
      this.mass = K > 0 ? 1 / K : 0;
      if (this.C < -0.05) this.impulse = 0;
      this.applyImp(this.impulse, false);
      this.biasImpulse = 0;
    }
    applyImp(imp, bias) {
      for (const e of this.J) {
        const b = e.body;
        if (bias) {
          b.bv.x += b.invMass * e.jx * imp; b.bv.y += b.invMass * e.jy * imp;
          b.bw += b.invI * e.ja * imp;
        } else {
          b.vel.x += b.invMass * e.jx * imp; b.vel.y += b.invMass * e.jy * imp;
          b.angVel += b.invI * e.ja * imp;
        }
      }
    }
    cdot(bias) {
      let s = 0;
      for (const e of this.J) {
        const b = e.body;
        s += bias
          ? e.jx * b.bv.x + e.jy * b.bv.y + e.ja * b.bw
          : e.jx * b.vel.x + e.jy * b.vel.y + e.ja * b.angVel;
      }
      return s;
    }
    solveVelocity() {
      let imp = -this.mass * (this.cdot(false) + Math.min(this.C, 0) / this.dt);
      const old = this.impulse;
      this.impulse = Math.min(old + imp, 0);
      imp = this.impulse - old;
      this.applyImp(imp, false);
    }
    solveBias() {
      if (this.C <= SLOP) return;
      let imp = -this.mass * (this.cdot(true) + (BETA * (this.C - SLOP)) / this.dt);
      const old = this.biasImpulse;
      this.biasImpulse = Math.min(old + imp, 0);
      imp = this.biasImpulse - old;
      this.applyImp(imp, true);
    }
    postStep(dt) {
      this.smoothTension(-this.impulse / dt, dt);
      // Wheel spin for rendering: rope feed over each wheel.
      this.compute();
      for (const n of this.nodes) if (n.radius) n.spin = -(n.feed - n.feed0) / n.radius;
      super.postStep(dt);
    }
    get taut() { return this.impulse < 0; }
  }

  /* ------------------------------------------------------------------ */
  /**
   * Constrain a body's centre of mass to a straight track through `origin`
   * along `axis`, optionally locking rotation, with travel limits and a motor.
   */
  class SliderJoint extends Joint {
    constructor(ground, body, origin, axis, opts = {}) {
      super(ground, body, opts);
      this.origin = origin.clone();
      this.axis = axis.norm();
      this.n = this.axis.perp();
      this.lockRotation = opts.lockRotation !== false;
      this.angle0 = body.angle;
      this.lower = opts.lower != null ? opts.lower : -Infinity;
      this.upper = opts.upper != null ? opts.upper : Infinity;
      this.motor = Object.assign({ enabled: false, speed: 0, maxForce: 0 }, opts.motor || {});
      this.Pn = 0; this.Pa = 0; this.Pl = 0; this.Pu = 0; this.Pm = 0;
    }
    get translation() { return this.b.pos.sub(this.origin).dot(this.axis); }
    preStep(dt) {
      const b = this.b;
      this.dt = dt;
      this.m = b.invMass > 0 ? 1 / b.invMass : 0;
      this.i = b.invI > 0 ? 1 / b.invI : 0;
      const d = b.pos.sub(this.origin);
      this.Cn = d.dot(this.n);
      this.s = d.dot(this.axis);
      this.Ca = b.angle - this.angle0;
      if (!this.motor.enabled) this.Pm = 0;
      const P = this.n.scale(this.Pn).add(this.axis.scale(this.Pl - this.Pu + this.Pm));
      b.vel.iaddScaled(P, b.invMass);
      if (this.lockRotation) b.angVel += b.invI * this.Pa;
    }
    solveVelocity() {
      const b = this.b, dt = this.dt;
      if (this.motor.enabled) {
        const vs = b.vel.dot(this.axis) - this.motor.speed;
        let imp = -this.m * vs;
        const old = this.Pm, max = this.motor.maxForce * dt;
        this.Pm = Math.max(-max, Math.min(old + imp, max));
        imp = this.Pm - old;
        b.vel.iaddScaled(this.axis, imp * b.invMass);
      }
      if (this.lower > -Infinity) {
        const C = this.s - this.lower;
        const vs = b.vel.dot(this.axis);
        let imp = -this.m * (vs + Math.max(C, 0) / dt);
        const old = this.Pl;
        this.Pl = Math.max(old + imp, 0);
        imp = this.Pl - old;
        b.vel.iaddScaled(this.axis, imp * b.invMass);
      }
      if (this.upper < Infinity) {
        const C = this.upper - this.s;
        const vs = -b.vel.dot(this.axis);
        let imp = -this.m * (vs + Math.max(C, 0) / dt);
        const old = this.Pu;
        this.Pu = Math.max(old + imp, 0);
        imp = this.Pu - old;
        b.vel.iaddScaled(this.axis, -imp * b.invMass);
      }
      const vn = b.vel.dot(this.n);
      const imp = -this.m * vn;
      this.Pn += imp;
      b.vel.iaddScaled(this.n, imp * b.invMass);
      if (this.lockRotation) {
        const ia = -this.i * b.angVel;
        this.Pa += ia;
        b.angVel += b.invI * ia;
      }
    }
    solveBias() {
      const b = this.b, dt = this.dt;
      const vn = b.bv.dot(this.n);
      b.bv.iaddScaled(this.n, -vn - (BETA * this.Cn) / dt);
      if (this.lockRotation) b.bw = -(BETA * this.Ca) / dt;
      if (this.lower > -Infinity && this.s < this.lower - SLOP) {
        const vs = b.bv.dot(this.axis);
        const target = (BETA * (this.lower - this.s)) / dt;
        if (vs < target) b.bv.iaddScaled(this.axis, target - vs);
      }
      if (this.upper < Infinity && this.s > this.upper + SLOP) {
        const vs = b.bv.dot(this.axis);
        const target = -(BETA * (this.s - this.upper)) / dt;
        if (vs > target) b.bv.iaddScaled(this.axis, target - vs);
      }
    }
    postStep(dt) {
      this.smoothTension(Math.abs(this.Pn) / dt, dt);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Force elements: applied before velocity integration. */

  /** Hookean spring with viscous damping between two anchor points. */
  class Spring {
    constructor(a, b, worldA, worldB, opts = {}) {
      this.a = a;
      this.b = b;
      this.localA = a.localPoint(worldA);
      this.localB = b.localPoint(worldB);
      this.k = opts.k != null ? opts.k : 100;
      this.restLength = opts.restLength != null ? opts.restLength : worldA.dist(worldB);
      this.damping = opts.damping || 0;
      this.mode = opts.mode || 'both'; // 'both' | 'tension' | 'compression'
      this.coils = opts.coils || 12;
      this.width = opts.width || 0.08;
      this.style = opts.style || {};
      this.label = opts.label || '';
      this.force = 0; // + tension, − compression
      this.smoothed = 0;
      this.enabled = true;
    }
    get anchorA() { return this.a.worldPoint(this.localA); }
    get anchorB() { return this.b.worldPoint(this.localB); }
    apply(dt) {
      if (!this.enabled) { this.force = 0; return; }
      const pA = this.anchorA, pB = this.anchorB;
      const d = pB.sub(pA);
      const len = d.len();
      if (len < 1e-9) return;
      const u = d.scale(1 / len);
      const x = len - this.restLength;
      const vrel = this.b.velocityAt(pB).sub(this.a.velocityAt(pA)).dot(u);
      let F = this.k * x + this.damping * vrel;
      if (this.mode === 'tension' && x < 0) F = 0;
      if (this.mode === 'compression' && x > 0) F = 0;
      this.force = F;
      const k = 1 - Math.exp(-dt / TENSION_TAU);
      this.smoothed += (F - this.smoothed) * k;
      if (F === 0) return;
      if (this.a.isDynamic) this.a.applyForce(u.scale(F), pA);
      if (this.b.isDynamic) this.b.applyForce(u.scale(-F), pB);
    }
    bodies() { return [this.a, this.b]; }
  }

  /** Critically damped grab handle used for dragging bodies with the pointer. */
  class DragForce {
    constructor(body, worldPoint, opts = {}) {
      this.body = body;
      this.local = body.localPoint(worldPoint);
      this.target = worldPoint.clone();
      this.freq = opts.freq || 4;
      this.zeta = opts.zeta || 1;
      this.maxAccel = opts.maxAccel || 60;
    }
    apply(dt, world) {
      const b = this.body;
      if (!b.isDynamic) return;
      const p = b.worldPoint(this.local);
      const v = b.velocityAt(p);
      const w = 2 * Math.PI * this.freq;
      const ax = w * w * (this.target.x - p.x) - 2 * this.zeta * w * v.x - world.gravity.x * b.gravityScale;
      const ay = w * w * (this.target.y - p.y) - 2 * this.zeta * w * v.y - world.gravity.y * b.gravityScale;
      let F = new Vec2(ax * b.mass, ay * b.mass);
      const maxF = this.maxAccel * b.mass;
      const f = F.len();
      if (f > maxF) F = F.scale(maxF / f);
      b.applyForce(F, p);
      b.torque -= b.I * 2 * w * 0.35 * b.angVel;
    }
  }

  Lab.Joints = { Joint, RevoluteJoint, DistanceJoint, RopePath, SliderJoint, Spring, DragForce };
})(typeof window !== 'undefined' ? window : globalThis);
