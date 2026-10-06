/*
 * Force Chamber — core math
 * 2D vector algebra, rotations, seeded randomness and numeric helpers.
 * World units are SI: metres, kilograms, seconds. The y axis points up.
 */
(function (root) {
  'use strict';
  const Lab = (root.Lab = root.Lab || {});

  class Vec2 {
    constructor(x = 0, y = 0) {
      this.x = x;
      this.y = y;
    }
    set(x, y) { this.x = x; this.y = y; return this; }
    copy(v) { this.x = v.x; this.y = v.y; return this; }
    clone() { return new Vec2(this.x, this.y); }

    add(v) { return new Vec2(this.x + v.x, this.y + v.y); }
    sub(v) { return new Vec2(this.x - v.x, this.y - v.y); }
    scale(s) { return new Vec2(this.x * s, this.y * s); }
    addScaled(v, s) { return new Vec2(this.x + v.x * s, this.y + v.y * s); }
    neg() { return new Vec2(-this.x, -this.y); }

    iadd(v) { this.x += v.x; this.y += v.y; return this; }
    isub(v) { this.x -= v.x; this.y -= v.y; return this; }
    iscale(s) { this.x *= s; this.y *= s; return this; }
    iaddScaled(v, s) { this.x += v.x * s; this.y += v.y * s; return this; }

    dot(v) { return this.x * v.x + this.y * v.y; }
    /** z-component of the 3D cross product. */
    cross(v) { return this.x * v.y - this.y * v.x; }
    len() { return Math.hypot(this.x, this.y); }
    lenSq() { return this.x * this.x + this.y * this.y; }
    dist(v) { return Math.hypot(this.x - v.x, this.y - v.y); }
    distSq(v) { const dx = this.x - v.x, dy = this.y - v.y; return dx * dx + dy * dy; }
    norm() {
      const l = this.len();
      return l > 1e-12 ? new Vec2(this.x / l, this.y / l) : new Vec2(0, 0);
    }
    /** Left-hand perpendicular: rotate +90°. */
    perp() { return new Vec2(-this.y, this.x); }
    /** Right-hand perpendicular: rotate −90°. */
    rperp() { return new Vec2(this.y, -this.x); }
    angle() { return Math.atan2(this.y, this.x); }
    rotate(a) {
      const c = Math.cos(a), s = Math.sin(a);
      return new Vec2(c * this.x - s * this.y, s * this.x + c * this.y);
    }
    rotateCS(c, s) { return new Vec2(c * this.x - s * this.y, s * this.x + c * this.y); }
    rotateInvCS(c, s) { return new Vec2(c * this.x + s * this.y, -s * this.x + c * this.y); }
    equals(v, eps = 1e-9) { return Math.abs(this.x - v.x) < eps && Math.abs(this.y - v.y) < eps; }
    toString() { return `(${this.x.toFixed(3)}, ${this.y.toFixed(3)})`; }

    static fromAngle(a, l = 1) { return new Vec2(Math.cos(a) * l, Math.sin(a) * l); }
    /** s × v for scalar s (angular velocity) and vector v. */
    static crossSV(s, v) { return new Vec2(-s * v.y, s * v.x); }
    static crossVS(v, s) { return new Vec2(s * v.y, -s * v.x); }
    static lerp(a, b, t) { return new Vec2(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t); }
  }

  /** Rigid transform: rotation (c, s) followed by translation p. */
  class Transform {
    constructor(p = new Vec2(), angle = 0) {
      this.p = p.clone();
      this.angle = angle;
      this.c = Math.cos(angle);
      this.s = Math.sin(angle);
    }
    set(p, angle) {
      this.p.copy(p);
      if (angle !== this.angle) {
        this.angle = angle;
        this.c = Math.cos(angle);
        this.s = Math.sin(angle);
      }
      return this;
    }
    apply(v) {
      return new Vec2(this.c * v.x - this.s * v.y + this.p.x, this.s * v.x + this.c * v.y + this.p.y);
    }
    applyInv(v) {
      const dx = v.x - this.p.x, dy = v.y - this.p.y;
      return new Vec2(this.c * dx + this.s * dy, -this.s * dx + this.c * dy);
    }
    rot(v) { return new Vec2(this.c * v.x - this.s * v.y, this.s * v.x + this.c * v.y); }
    rotInv(v) { return new Vec2(this.c * v.x + this.s * v.y, -this.s * v.x + this.c * v.y); }
  }

  /** Mulberry32 — small, fast, deterministic PRNG. */
  function makeRng(seed) {
    let a = seed >>> 0;
    const rng = function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    rng.range = (lo, hi) => lo + (hi - lo) * rng();
    rng.int = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
    rng.pick = (arr) => arr[Math.floor(rng() * arr.length)];
    rng.step = (lo, hi, step) => {
      const n = Math.round((hi - lo) / step);
      return round(lo + step * rng.int(0, n), 10);
    };
    rng.shuffle = (arr) => {
      const out = arr.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    };
    return rng;
  }

  /** Stable 32-bit hash of a string, for deriving per-room seeds. */
  function hashString(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  const DEG = Math.PI / 180;
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smoothstep = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  function round(v, digits = 0) {
    const f = Math.pow(10, digits);
    return Math.round(v * f) / f;
  }
  function snap(v, step) { return Math.round(v / step) * step; }
  /** Fixed-decimal format that never prints "-0.00". */
  function fmt(v, digits = 2) {
    const s = Number(v).toFixed(digits);
    return /^-0(\.0+)?$/.test(s) ? s.slice(1) : s;
  }
  /** Wrap an angle to (−π, π]. */
  function wrapAngle(a) {
    a = (a + Math.PI) % (2 * Math.PI);
    if (a < 0) a += 2 * Math.PI;
    return a - Math.PI;
  }
  /** Solve a·x² + b·x + c = 0; returns sorted real roots. */
  function solveQuadratic(a, b, c) {
    if (Math.abs(a) < 1e-12) return Math.abs(b) < 1e-12 ? [] : [-c / b];
    const disc = b * b - 4 * a * c;
    if (disc < 0) return [];
    const sq = Math.sqrt(disc);
    const r1 = (-b - sq) / (2 * a), r2 = (-b + sq) / (2 * a);
    return r1 < r2 ? [r1, r2] : [r2, r1];
  }
  /** Bisection root finder on [lo, hi] for a continuous f with a sign change. */
  function bisect(f, lo, hi, iters = 80) {
    let flo = f(lo);
    for (let i = 0; i < iters; i++) {
      const mid = 0.5 * (lo + hi);
      const fm = f(mid);
      if ((fm < 0) === (flo < 0)) { lo = mid; flo = fm; } else { hi = mid; }
    }
    return 0.5 * (lo + hi);
  }

  Lab.Vec2 = Vec2;
  Lab.Transform = Transform;
  Lab.Mathx = {
    DEG, clamp, lerp, smoothstep, round, snap, fmt, wrapAngle,
    solveQuadratic, bisect, makeRng, hashString,
  };
})(typeof window !== 'undefined' ? window : globalThis);
