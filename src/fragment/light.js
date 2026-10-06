/*
 * Fragment — 2D visibility polygons.
 * Rays are cast at every occluder endpoint (and a hair to either side) plus
 * an even fan, then clipped to the nearest occluding segment or the light's
 * radius. Static solids and bodies flagged `occluder` block light.
 */
(function (root) {
  'use strict';
  const Lab = root.Lab;
  const { Vec2 } = Lab;
  const Frag = (Lab.Fragment = Lab.Fragment || {});

  function occluderSegments(world, origin, radius) {
    const segs = [];
    const r2 = (radius + 0.5) * (radius + 0.5);
    for (const b of world.bodies) {
      if (!(b.isStatic || b.occluder)) continue;
      const bb = b.aabb;
      const cx = Math.max(bb.minX, Math.min(origin.x, bb.maxX));
      const cy = Math.max(bb.minY, Math.min(origin.y, bb.maxY));
      if ((cx - origin.x) ** 2 + (cy - origin.y) ** 2 > r2) continue;
      for (const s of b.shapes) {
        if (s.sensor || s.type !== 'polygon') continue;
        const v = s.wv, n = v.length;
        for (let i = 0; i < n; i++) segs.push([v[i], v[(i + 1) % n]]);
      }
    }
    return segs;
  }

  /** Distance along ray (o, d) to segment [a, b], or Infinity. */
  function raySeg(ox, oy, dx, dy, a, b) {
    const ex = b.x - a.x, ey = b.y - a.y;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) return Infinity;
    const ax = a.x - ox, ay = a.y - oy;
    const t = (ax * ey - ay * ex) / den;
    const u = (ax * dy - ay * dx) / den;
    if (t >= 0 && u >= 0 && u <= 1) return t;
    return Infinity;
  }

  function visibility(world, origin, radius) {
    const segs = occluderSegments(world, origin, radius);
    const angles = [];
    for (const [a, b] of segs) {
      for (const p of [a, b]) {
        if (p.distSq(origin) > (radius + 0.5) ** 2) continue;
        const ang = Math.atan2(p.y - origin.y, p.x - origin.x);
        angles.push(ang - 1e-4, ang, ang + 1e-4);
      }
    }
    const fan = 72;
    for (let i = 0; i < fan; i++) angles.push(-Math.PI + (2 * Math.PI * i) / fan);
    angles.sort((p, q) => p - q);
    const pts = [];
    for (const ang of angles) {
      const dx = Math.cos(ang), dy = Math.sin(ang);
      let t = radius;
      for (const [a, b] of segs) {
        const h = raySeg(origin.x, origin.y, dx, dy, a, b);
        if (h < t) t = h;
      }
      pts.push(new Vec2(origin.x + dx * t, origin.y + dy * t));
    }
    return pts;
  }

  function pointInPolygon(p, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i], b = pts[j];
      if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }

  Frag.visibility = visibility;
  Frag.pointInPolygon = pointInPolygon;
})(typeof window !== 'undefined' ? window : globalThis);
