/*
 * Force Chamber — computational geometry
 * Polygon mass properties, half-plane clipping, circle segments,
 * ray casts, circle intersections and belt tangents for pulleys.
 */
(function (root) {
  'use strict';
  const Lab = (root.Lab = root.Lab || {});
  const { Vec2 } = Lab;

  /** Signed area (positive when counter-clockwise). */
  function signedArea(pts) {
    let a = 0;
    for (let i = 0, n = pts.length; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % n];
      a += p.x * q.y - q.x * p.y;
    }
    return 0.5 * a;
  }

  /**
   * Area, centroid and polar second moment of area (about the centroid)
   * of a simple polygon, by triangle fan decomposition.
   */
  function polygonMass(pts) {
    const n = pts.length;
    // Use the first vertex as a local origin for numerical stability.
    const o = pts[0];
    let area = 0, cx = 0, cy = 0, I = 0;
    for (let i = 1; i < n - 1; i++) {
      const e1x = pts[i].x - o.x, e1y = pts[i].y - o.y;
      const e2x = pts[i + 1].x - o.x, e2y = pts[i + 1].y - o.y;
      const d = e1x * e2y - e1y * e2x;
      const triArea = 0.5 * d;
      area += triArea;
      cx += triArea * (e1x + e2x) / 3;
      cy += triArea * (e1y + e2y) / 3;
      const intx2 = e1x * e1x + e2x * e1x + e2x * e2x;
      const inty2 = e1y * e1y + e2y * e1y + e2y * e2y;
      I += (0.25 / 3) * d * (intx2 + inty2);
    }
    if (Math.abs(area) < 1e-14) return { area: 0, centroid: o.clone(), I: 0 };
    cx /= area; cy /= area;
    // I is about the local origin; shift to the centroid (parallel axis theorem).
    const Ic = I - area * (cx * cx + cy * cy);
    return { area: Math.abs(area), centroid: new Vec2(cx + o.x, cy + o.y), I: Math.abs(Ic) };
  }

  function ensureCCW(pts) {
    return signedArea(pts) < 0 ? pts.slice().reverse() : pts.slice();
  }

  /** Sutherland–Hodgman: keep the part of a polygon where n·p ≤ d. */
  function clipPolygonHalfPlane(pts, n, d) {
    const out = [];
    const len = pts.length;
    for (let i = 0; i < len; i++) {
      const a = pts[i], b = pts[(i + 1) % len];
      const da = n.x * a.x + n.y * a.y - d;
      const db = n.x * b.x + n.y * b.y - d;
      if (da <= 0) out.push(a);
      if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
        const t = da / (da - db);
        out.push(new Vec2(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t));
      }
    }
    return out;
  }

  /**
   * Part of a circle (centre c, radius r) lying below the horizontal line y = level.
   * Returns { area, centroid }.
   */
  function circleBelowLine(c, r, level) {
    const d = level - c.y; // line height relative to the centre
    if (d >= r) return { area: Math.PI * r * r, centroid: c.clone() };
    if (d <= -r) return { area: 0, centroid: c.clone() };
    const s = Math.sqrt(r * r - d * d);
    const area = r * r * (Math.PI - Math.acos(d / r)) + d * s;
    const yBar = -(2 / 3) * Math.pow(r * r - d * d, 1.5) / area;
    return { area, centroid: new Vec2(c.x, c.y + yBar) };
  }

  function pointInConvex(p, verts, normals) {
    for (let i = 0; i < verts.length; i++) {
      if (normals[i].x * (p.x - verts[i].x) + normals[i].y * (p.y - verts[i].y) > 0) return false;
    }
    return true;
  }

  function closestPointOnSegment(p, a, b) {
    const abx = b.x - a.x, aby = b.y - a.y;
    const l2 = abx * abx + aby * aby;
    let t = l2 > 0 ? ((p.x - a.x) * abx + (p.y - a.y) * aby) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return new Vec2(a.x + abx * t, a.y + aby * t);
  }

  /** Segment p→q against circle; returns fraction t∈[0,1] of first hit or null. */
  function rayCircle(p, q, c, r) {
    const dx = q.x - p.x, dy = q.y - p.y;
    const fx = p.x - c.x, fy = p.y - c.y;
    const a = dx * dx + dy * dy;
    const b = 2 * (fx * dx + fy * dy);
    const cc = fx * fx + fy * fy - r * r;
    if (cc <= 0) return { t: 0, normal: new Vec2(fx, fy).norm() };
    const disc = b * b - 4 * a * cc;
    if (disc < 0 || a < 1e-14) return null;
    const t = (-b - Math.sqrt(disc)) / (2 * a);
    if (t < 0 || t > 1) return null;
    const hx = p.x + dx * t - c.x, hy = p.y + dy * t - c.y;
    return { t, normal: new Vec2(hx, hy).norm() };
  }

  /** Segment p→q against a convex CCW polygon (Cyrus–Beck). */
  function rayPolygon(p, q, verts, normals) {
    let lower = 0, upper = 1, index = -1;
    const dx = q.x - p.x, dy = q.y - p.y;
    for (let i = 0; i < verts.length; i++) {
      const n = normals[i];
      const numerator = n.x * (verts[i].x - p.x) + n.y * (verts[i].y - p.y);
      const denominator = n.x * dx + n.y * dy;
      if (denominator === 0) {
        if (numerator < 0) return null;
      } else if (denominator < 0 && numerator < lower * denominator) {
        lower = numerator / denominator;
        index = i;
      } else if (denominator > 0 && numerator < upper * denominator) {
        upper = numerator / denominator;
      }
      if (upper < lower) return null;
    }
    if (index < 0) return lower === 0 ? { t: 0, normal: new Vec2(0, 0) } : null;
    return { t: lower, normal: normals[index].clone() };
  }

  /** Intersection points of two circles (may be 0, 1 or 2 points). */
  function circleCircle(c1, r1, c2, r2) {
    const d = c1.dist(c2);
    if (d > r1 + r2 + 1e-12 || d < Math.abs(r1 - r2) - 1e-12 || d < 1e-12) return [];
    const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, r1 * r1 - a * a));
    const ex = (c2.x - c1.x) / d, ey = (c2.y - c1.y) / d;
    const mx = c1.x + ex * a, my = c1.y + ey * a;
    if (h < 1e-12) return [new Vec2(mx, my)];
    return [new Vec2(mx - ey * h, my + ex * h), new Vec2(mx + ey * h, my - ex * h)];
  }

  /**
   * Belt tangent between two circles with signed radii.
   * A positive radius means the belt passes the circle keeping it on its right
   * (the belt wraps clockwise); negative keeps it on the left; zero is a point.
   * Returns { a, b, dir, length } — tangent points on circle 1 and circle 2.
   */
  function beltTangent(c1, rho1, c2, rho2) {
    const dx = c2.x - c1.x, dy = c2.y - c1.y;
    const D = Math.hypot(dx, dy);
    if (D < 1e-9) return null;
    const ratio = (rho1 - rho2) / D;
    if (Math.abs(ratio) > 1) return null;
    const phi = Math.atan2(dy, dx);
    const beta = phi + Math.acos(ratio);
    const nx = Math.cos(beta), ny = Math.sin(beta); // left normal of the travel direction
    const a = new Vec2(c1.x + rho1 * nx, c1.y + rho1 * ny);
    const b = new Vec2(c2.x + rho2 * nx, c2.y + rho2 * ny);
    const dir = new Vec2(ny, -nx);
    return { a, b, dir, length: a.dist(b) };
  }

  /** Regular n-gon (CCW) around the origin. */
  function regularPolygon(n, r, rot = 0) {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = rot + (i / n) * Math.PI * 2;
      pts.push(new Vec2(Math.cos(a) * r, Math.sin(a) * r));
    }
    return pts;
  }

  function boxVerts(w, h) {
    const hw = w / 2, hh = h / 2;
    return [new Vec2(-hw, -hh), new Vec2(hw, -hh), new Vec2(hw, hh), new Vec2(-hw, hh)];
  }

  /** Andrew's monotone chain convex hull (CCW). */
  function convexHull(points) {
    const pts = points.slice().sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
    if (pts.length < 3) return pts;
    const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const lower = [];
    for (const p of pts) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 1e-12) lower.pop();
      lower.push(p);
    }
    const upper = [];
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 1e-12) upper.pop();
      upper.push(p);
    }
    upper.pop(); lower.pop();
    return lower.concat(upper);
  }

  Lab.Geom = {
    signedArea, polygonMass, ensureCCW, clipPolygonHalfPlane, circleBelowLine,
    pointInConvex, closestPointOnSegment, rayCircle, rayPolygon, circleCircle,
    beltTangent, regularPolygon, boxVerts, convexHull,
  };
})(typeof window !== 'undefined' ? window : globalThis);
