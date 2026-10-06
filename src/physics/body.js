/*
 * Force Chamber — rigid bodies, shapes and materials
 *
 * 2D bodies are treated as slabs DEPTH metres thick, so densities are real
 * volumetric densities (kg/m³) and buoyancy works with real fluid densities.
 */
(function (root) {
  'use strict';
  const Lab = (root.Lab = root.Lab || {});
  const { Vec2, Transform, Geom } = Lab;

  const DEPTH = 0.1; // slab thickness in metres

  /**
   * Surface materials. mu = static friction, muk = kinetic friction,
   * e = restitution. Pair values: μ = √(μa·μb), e = min(ea, eb).
   */
  const Materials = {
    default: { name: '기본', mu: 0.6, muk: 0.5, e: 0.1 },
    concrete: { name: '콘크리트', mu: 0.9, muk: 0.8, e: 0.05 },
    wood: { name: '목재', mu: 0.55, muk: 0.45, e: 0.15 },
    steel: { name: '강철', mu: 0.45, muk: 0.35, e: 0.25 },
    rubber: { name: '고무', mu: 1.0, muk: 0.9, e: 0.6 },
    ice: { name: '얼음', mu: 0.06, muk: 0.04, e: 0.05 },
    felt: { name: '펠트', mu: 0.7, muk: 0.6, e: 0.0 },
    glass: { name: '유리', mu: 0.35, muk: 0.3, e: 0.4 },
    frictionless: { name: '무마찰', mu: 0, muk: 0, e: 0 },
    puck: { name: '퍽', mu: 0, muk: 0, e: 1 },
    rope: { name: '로프', mu: 0.6, muk: 0.5, e: 0 },
  };

  for (const k of Object.keys(Materials)) Materials[k].key = k;
  Materials.brass = { key: 'brass', name: '황동', mu: 0.5, muk: 0.4, e: 0.2 };
  Materials.foam = { key: 'foam', name: '폼', mu: 0.8, muk: 0.7, e: 0.05 };
  Materials.lead = { key: 'lead', name: '납', mu: 0.6, muk: 0.5, e: 0.02 };

  function material(base, overrides) {
    const m = Object.assign({}, typeof base === 'string' ? Materials[base] : base || Materials.default);
    if (!m.key) m.key = 'default';
    return overrides ? Object.assign(m, overrides) : m;
  }

  let shapeIds = 0;

  class Shape {
    constructor(opts = {}) {
      this.id = ++shapeIds;
      this.body = null;
      this.index = 0;
      this.material = material(opts.material || 'default', opts.materialOverrides);
      this.density = opts.density != null ? opts.density : 1000;
      this.sensor = !!opts.sensor;
      this.category = opts.category != null ? opts.category : 1;
      this.mask = opts.mask != null ? opts.mask : 0xffff;
      this.surfaceSpeed = opts.surfaceSpeed || 0; // conveyor belts
      this.style = opts.style || null;
      this.aabb = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    }
  }

  class CircleShape extends Shape {
    constructor(radius, center = new Vec2(), opts) {
      super(opts);
      this.type = 'circle';
      this.radius = radius;
      this.center = center.clone(); // local
      this.wc = new Vec2();
    }
    massData() {
      const area = Math.PI * this.radius * this.radius;
      const mass = this.density * area * DEPTH;
      return { area, mass, center: this.center.clone(), I: 0.5 * mass * this.radius * this.radius };
    }
    shift(d) { this.center.isub(d); }
    updateWorld(xf) {
      const c = xf.apply(this.center);
      this.wc.copy(c);
      const r = this.radius;
      this.aabb.minX = c.x - r; this.aabb.maxX = c.x + r;
      this.aabb.minY = c.y - r; this.aabb.maxY = c.y + r;
    }
    containsPoint(p) { return p.distSq(this.wc) <= this.radius * this.radius; }
    raycast(p, q) { return Geom.rayCircle(p, q, this.wc, this.radius); }
    /** Extent [min, max] of the shape projected onto axis n. */
    project(n) {
      const c = n.x * this.wc.x + n.y * this.wc.y;
      return [c - this.radius, c + this.radius];
    }
  }

  class PolygonShape extends Shape {
    constructor(verts, opts) {
      super(opts);
      this.type = 'polygon';
      this.setVerts(verts);
    }
    setVerts(verts) {
      this.verts = Geom.ensureCCW(verts).map((v) => v.clone());
      this.computeNormals();
      this.wv = this.verts.map(() => new Vec2());
      this.wn = this.verts.map(() => new Vec2());
    }
    computeNormals() {
      const n = this.verts.length;
      this.normals = [];
      for (let i = 0; i < n; i++) {
        const a = this.verts[i], b = this.verts[(i + 1) % n];
        this.normals.push(b.sub(a).rperp().norm());
      }
    }
    massData() {
      const m = Geom.polygonMass(this.verts);
      const mass = this.density * m.area * DEPTH;
      // I about the centroid, then expressed about the local origin.
      const Ic = this.density * m.I * DEPTH;
      return { area: m.area, mass, center: m.centroid, I: Ic + mass * m.centroid.lenSq() };
    }
    shift(d) {
      for (const v of this.verts) v.isub(d);
    }
    updateWorld(xf) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let i = 0; i < this.verts.length; i++) {
        const v = this.verts[i], n = this.normals[i];
        const wx = xf.c * v.x - xf.s * v.y + xf.p.x;
        const wy = xf.s * v.x + xf.c * v.y + xf.p.y;
        this.wv[i].set(wx, wy);
        this.wn[i].set(xf.c * n.x - xf.s * n.y, xf.s * n.x + xf.c * n.y);
        if (wx < minX) minX = wx; if (wx > maxX) maxX = wx;
        if (wy < minY) minY = wy; if (wy > maxY) maxY = wy;
      }
      this.aabb.minX = minX; this.aabb.minY = minY; this.aabb.maxX = maxX; this.aabb.maxY = maxY;
    }
    containsPoint(p) { return Geom.pointInConvex(p, this.wv, this.wn); }
    raycast(p, q) { return Geom.rayPolygon(p, q, this.wv, this.wn); }
    project(n) {
      let lo = Infinity, hi = -Infinity;
      for (const v of this.wv) {
        const d = n.x * v.x + n.y * v.y;
        if (d < lo) lo = d;
        if (d > hi) hi = d;
      }
      return [lo, hi];
    }
  }

  let bodyIds = 0;

  class Body {
    /**
     * opts: type ('dynamic' | 'static' | 'kinematic'), position, angle,
     * velocity, angularVelocity, mass (overrides density), inertiaFactor
     * (I = β·m·r² for round bodies), gravityScale, linearDamping,
     * angularDamping, fixedRotation, label, style, data.
     */
    constructor(shapes, opts = {}) {
      this.id = ++bodyIds;
      this.type = opts.type || 'dynamic';
      this.label = opts.label || '';
      this.style = opts.style || {};
      this.data = opts.data || {};
      this.pos = (opts.position || new Vec2()).clone();
      this.angle = opts.angle || 0;
      this.vel = (opts.velocity || new Vec2()).clone();
      this.angVel = opts.angularVelocity || 0;
      this.force = new Vec2();
      this.torque = 0;
      this.bv = new Vec2(); // split-impulse pseudo velocity
      this.bw = 0;
      this.gravityScale = opts.gravityScale != null ? opts.gravityScale : 1;
      this.linearDamping = opts.linearDamping || 0;
      this.angularDamping = opts.angularDamping || 0;
      this.fixedRotation = !!opts.fixedRotation;
      this.xf = new Transform(this.pos, this.angle);
      this.prevPos = this.pos.clone();
      this.prevAngle = this.angle;
      this.extForce = false; // set when non-gravity forces act during a step
      this.constrained = 0; // number of active constraints this step
      this.world = null;
      this.aabb = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
      this.shapes = [];
      for (const s of shapes) this.addShape(s, false);
      this.updateMass(opts);
      this.updateTransform();
      this.prevPos.copy(this.pos);
      this.prevAngle = this.angle;
    }

    addShape(shape, update = true) {
      shape.body = this;
      shape.index = this.shapes.length;
      this.shapes.push(shape);
      if (update) { this.updateMass({}); this.updateTransform(); }
      return shape;
    }

    /**
     * Compute mass properties and move the body origin onto the centre of mass,
     * keeping the shapes fixed in the world.
     */
    updateMass(opts = {}) {
      this.mass = 0; this.invMass = 0; this.I = 0; this.invI = 0;
      if (this.type !== 'dynamic') {
        return;
      }
      let mass = 0, I = 0, area = 0;
      const center = new Vec2();
      for (const s of this.shapes) {
        if (s.sensor) continue;
        const md = s.massData();
        mass += md.mass;
        area += md.area;
        center.iaddScaled(md.center, md.mass);
        I += md.I;
      }
      if (mass <= 0) { mass = 1; I = 1; }
      center.iscale(1 / mass);
      // Shift shapes so the local origin is the centre of mass.
      for (const s of this.shapes) s.shift(center);
      I -= mass * center.lenSq();
      const worldShift = new Transform(new Vec2(), this.angle).rot(center);
      this.pos.iadd(worldShift);
      this.area = area;

      const targetMass = opts.mass != null ? opts.mass : this.massOverride;
      if (targetMass != null) {
        const k = targetMass / mass;
        mass = targetMass; I *= k;
        this.massOverride = targetMass;
      }
      if (opts.inertiaFactor != null || this.inertiaFactor != null) {
        const beta = opts.inertiaFactor != null ? opts.inertiaFactor : this.inertiaFactor;
        this.inertiaFactor = beta;
        const r = this.boundingRadius();
        I = beta * mass * r * r;
      }
      this.mass = mass;
      this.invMass = 1 / mass;
      this.I = this.fixedRotation ? 0 : I;
      this.invI = this.fixedRotation || I <= 0 ? 0 : 1 / I;
    }

    boundingRadius() {
      let r = 0;
      for (const s of this.shapes) {
        if (s.type === 'circle') r = Math.max(r, s.center.len() + s.radius);
        else for (const v of s.verts) r = Math.max(r, v.len());
      }
      return r;
    }

    /** Density of the body averaged over its solid shapes (kg/m³). */
    get density() {
      return this.area > 0 ? this.mass / (this.area * DEPTH) : 0;
    }

    setMass(m) {
      this.massOverride = m;
      this.updateMassKeepPose();
    }

    updateMassKeepPose() {
      // Mass overrides scale the existing values without moving the centre.
      if (this.type !== 'dynamic') return;
      let mass = 0, I = 0;
      for (const s of this.shapes) {
        if (s.sensor) continue;
        const md = s.massData();
        mass += md.mass; I += md.I;
      }
      if (this.massOverride != null) { I *= this.massOverride / mass; mass = this.massOverride; }
      if (this.inertiaFactor != null) { const r = this.boundingRadius(); I = this.inertiaFactor * mass * r * r; }
      this.mass = mass; this.invMass = 1 / mass;
      this.I = this.fixedRotation ? 0 : I;
      this.invI = this.fixedRotation || I <= 0 ? 0 : 1 / I;
    }

    setType(type) {
      if (type === this.type) return;
      this.type = type;
      if (type === 'dynamic') {
        this.updateMassKeepPose();
      } else {
        this.mass = 0; this.invMass = 0; this.I = 0; this.invI = 0;
        if (type === 'static') { this.vel.set(0, 0); this.angVel = 0; }
      }
    }

    updateTransform() {
      this.xf.set(this.pos, this.angle);
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const s of this.shapes) {
        s.updateWorld(this.xf);
        const a = s.aabb;
        if (a.minX < minX) minX = a.minX; if (a.minY < minY) minY = a.minY;
        if (a.maxX > maxX) maxX = a.maxX; if (a.maxY > maxY) maxY = a.maxY;
      }
      this.aabb.minX = minX; this.aabb.minY = minY; this.aabb.maxX = maxX; this.aabb.maxY = maxY;
    }

    setPosition(p, angle = this.angle) {
      this.pos.copy(p);
      this.angle = angle;
      this.prevPos.copy(p);
      this.prevAngle = angle;
      this.updateTransform();
      if (this.world) this.world.wakeArbiters(this);
    }

    applyForce(f, point) {
      this.force.iadd(f);
      if (point) this.torque += point.sub(this.pos).cross(f);
      this.extForce = true;
    }
    applyImpulse(P, point) {
      if (this.type !== 'dynamic') return;
      this.vel.iaddScaled(P, this.invMass);
      if (point) this.angVel += this.invI * point.sub(this.pos).cross(P);
    }

    worldPoint(local) { return this.xf.apply(local); }
    localPoint(world) { return this.xf.applyInv(world); }
    /** Velocity of a material point given in world coordinates. */
    velocityAt(p) {
      const r = p.sub(this.pos);
      return new Vec2(this.vel.x - this.angVel * r.y, this.vel.y + this.angVel * r.x);
    }
    containsPoint(p) {
      for (const s of this.shapes) if (!s.sensor && s.containsPoint(p)) return true;
      return false;
    }
    kineticEnergy() {
      return 0.5 * this.mass * this.vel.lenSq() + 0.5 * this.I * this.angVel * this.angVel;
    }
    get isStatic() { return this.type === 'static'; }
    get isDynamic() { return this.type === 'dynamic'; }
  }

  /* ---------- factories (all coordinates in world space) ---------- */

  function shapeOpts(opts) {
    return {
      material: opts.material,
      materialOverrides: opts.materialOverrides,
      density: opts.density,
      sensor: opts.sensor,
      category: opts.category,
      mask: opts.mask,
      surfaceSpeed: opts.surfaceSpeed,
      style: opts.shapeStyle,
    };
  }

  const Bodies = {
    box(x, y, w, h, opts = {}) {
      const s = new PolygonShape(Geom.boxVerts(w, h), shapeOpts(opts));
      return new Body([s], Object.assign({}, opts, { position: new Vec2(x, y) }));
    },
    circle(x, y, r, opts = {}) {
      const s = new CircleShape(r, new Vec2(), shapeOpts(opts));
      return new Body([s], Object.assign({}, opts, { position: new Vec2(x, y) }));
    },
    /** Convex polygon from world-space vertices. */
    polygon(worldVerts, opts = {}) {
      const c = Geom.polygonMass(Geom.ensureCCW(worldVerts)).centroid;
      const local = worldVerts.map((v) => v.sub(c));
      const s = new PolygonShape(local, shapeOpts(opts));
      return new Body([s], Object.assign({}, opts, { position: c }));
    },
    /** Right-triangle ramp: base from (x0, y0) to (x0 + w, y0), apex height h at the left or right. */
    wedge(x0, y0, w, h, side = 'left', opts = {}) {
      const verts = side === 'left'
        ? [new Vec2(x0, y0), new Vec2(x0 + w, y0), new Vec2(x0, y0 + h)]
        : [new Vec2(x0, y0), new Vec2(x0 + w, y0), new Vec2(x0 + w, y0 + h)];
      return Bodies.polygon(verts, opts);
    },
    /** A thick segment (oriented box) from a to b. */
    segment(a, b, thickness, opts = {}) {
      const d = b.sub(a);
      const len = d.len();
      const mid = Vec2.lerp(a, b, 0.5);
      const s = new PolygonShape(Geom.boxVerts(len, thickness), shapeOpts(opts));
      return new Body([s], Object.assign({}, opts, { position: mid, angle: Math.atan2(d.y, d.x) }));
    },
    /**
     * Compound body. parts: [{ kind: 'box', x, y, w, h, angle?, ...shapeOpts }
     * | { kind: 'circle', x, y, r } | { kind: 'poly', verts }] in world space.
     */
    compound(parts, opts = {}) {
      return Bodies.local(parts, Object.assign({}, opts, { position: new Vec2(0, 0), angle: 0 }));
    },
    /**
     * Body from parts given in its local frame, placed at opts.position/angle.
     * Static and kinematic bodies keep that origin (useful for hinges);
     * dynamic bodies are re-centred on their centre of mass.
     */
    local(parts, opts = {}) {
      const shapes = parts.map((p) => {
        const so = shapeOpts(Object.assign({}, opts, p));
        if (p.kind === 'circle') return new CircleShape(p.r, new Vec2(p.x, p.y), so);
        if (p.kind === 'box') {
          const verts = Geom.boxVerts(p.w, p.h).map((v) => v.rotate(p.angle || 0).add(new Vec2(p.x, p.y)));
          return new PolygonShape(verts, so);
        }
        return new PolygonShape(p.verts, so);
      });
      return new Body(shapes, opts);
    },
  };

  Lab.DEPTH = DEPTH;
  Lab.Materials = Materials;
  Lab.material = material;
  Lab.Shape = Shape;
  Lab.CircleShape = CircleShape;
  Lab.PolygonShape = PolygonShape;
  Lab.Body = Body;
  Lab.Bodies = Bodies;
})(typeof window !== 'undefined' ? window : globalThis);
