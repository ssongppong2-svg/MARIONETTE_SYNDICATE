/*
 * Force Chamber — narrow phase collision
 * Separating-axis tests with reference-face clipping for polygons,
 * Voronoi-region tests for circles. Manifold normals point from A to B.
 */
(function (root) {
  'use strict';
  const Lab = (root.Lab = root.Lab || {});
  const { Vec2 } = Lab;

  const LINEAR_SLOP = 0.003;

  function manifold(normal, points) {
    return points.length ? { normal, points } : null;
  }

  function circleCircle(a, b) {
    const ca = a.wc, cb = b.wc;
    const dx = cb.x - ca.x, dy = cb.y - ca.y;
    const rs = a.radius + b.radius;
    const d2 = dx * dx + dy * dy;
    if (d2 > rs * rs) return null;
    const d = Math.sqrt(d2);
    const n = d > 1e-9 ? new Vec2(dx / d, dy / d) : new Vec2(0, 1);
    const sep = d - rs;
    const p = new Vec2(ca.x + n.x * (a.radius + 0.5 * sep), ca.y + n.y * (a.radius + 0.5 * sep));
    return manifold(n, [{ p, sep, id: 0 }]);
  }

  /** Polygon A against circle B. */
  function polygonCircle(poly, circ) {
    const c = circ.wc, r = circ.radius;
    const verts = poly.wv, norms = poly.wn, n = verts.length;
    let sepMax = -Infinity, edge = 0;
    for (let i = 0; i < n; i++) {
      const s = norms[i].x * (c.x - verts[i].x) + norms[i].y * (c.y - verts[i].y);
      if (s > r) return null;
      if (s > sepMax) { sepMax = s; edge = i; }
    }
    const v1 = verts[edge], v2 = verts[(edge + 1) % n];
    if (sepMax < 1e-9) {
      const nn = norms[edge].clone();
      const sep = sepMax - r;
      return manifold(nn, [{ p: c.addScaled(nn, -(r + 0.5 * sep)), sep, id: edge }]);
    }
    const u1 = (c.x - v1.x) * (v2.x - v1.x) + (c.y - v1.y) * (v2.y - v1.y);
    const u2 = (c.x - v2.x) * (v1.x - v2.x) + (c.y - v2.y) * (v1.y - v2.y);
    let nn, sep;
    if (u1 <= 0) {
      const d = c.dist(v1);
      if (d > r) return null;
      nn = c.sub(v1).norm();
      sep = d - r;
    } else if (u2 <= 0) {
      const d = c.dist(v2);
      if (d > r) return null;
      nn = c.sub(v2).norm();
      sep = d - r;
    } else {
      nn = norms[edge].clone();
      sep = sepMax - r;
    }
    return manifold(nn, [{ p: c.addScaled(nn, -(r + 0.5 * sep)), sep, id: edge }]);
  }

  /**
   * Deepest separation of p2 from p1's faces. Ghost faces (p1.ghost[i]: seams
   * buried against a neighbouring solid) still count for the separation test
   * (`out`), but are never offered as the contact face, so a body sliding
   * across a seam does not stub itself on it.
   */
  function findMaxSeparation(p1, p2) {
    const v1 = p1.wv, n1 = p1.wn, v2 = p2.wv, ghost = p1.ghost;
    let best = -Infinity, edge = -1, out = -Infinity;
    for (let i = 0; i < v1.length; i++) {
      const n = n1[i], v = v1[i];
      let si = Infinity;
      for (let j = 0; j < v2.length; j++) {
        const s = n.x * (v2[j].x - v.x) + n.y * (v2[j].y - v.y);
        if (s < si) si = s;
      }
      if (si > out) out = si;
      if (ghost && ghost[i]) continue;
      if (si > best) { best = si; edge = i; }
    }
    return { edge, sep: best, out };
  }

  function clipSegment(vIn, normal, offset, vertexId) {
    const out = [];
    const d0 = normal.dot(vIn[0].v) - offset;
    const d1 = normal.dot(vIn[1].v) - offset;
    if (d0 <= 0) out.push(vIn[0]);
    if (d1 <= 0) out.push(vIn[1]);
    if (d0 * d1 < 0) {
      const t = d0 / (d0 - d1);
      out.push({ v: Vec2.lerp(vIn[0].v, vIn[1].v, t), id: vertexId });
    }
    return out;
  }

  function polygonPolygon(A, B) {
    const sa = findMaxSeparation(A, B);
    if (sa.out > 0) return null;
    const sb = findMaxSeparation(B, A);
    if (sb.out > 0) return null;

    let ref, inc, edge1, flip;
    if (sa.edge < 0 || (sb.edge >= 0 && sb.sep > sa.sep + 0.1 * LINEAR_SLOP)) {
      ref = B; inc = A; edge1 = sb.edge; flip = true;
    } else {
      ref = A; inc = B; edge1 = sa.edge; flip = false;
    }

    // Incident edge: the edge of inc most anti-parallel to the reference normal.
    const refN = ref.wn[edge1];
    let incEdge = 0, minDot = Infinity;
    for (let i = 0; i < inc.wn.length; i++) {
      const d = refN.dot(inc.wn[i]);
      if (d < minDot) { minDot = d; incEdge = i; }
    }
    const ni = inc.wv.length;
    const incident = [
      { v: inc.wv[incEdge], id: incEdge * 4 + 0 },
      { v: inc.wv[(incEdge + 1) % ni], id: ((incEdge + 1) % ni) * 4 + 1 },
    ];

    const nr = ref.wv.length;
    const v11 = ref.wv[edge1], v12 = ref.wv[(edge1 + 1) % nr];
    const tangent = v12.sub(v11).norm();
    const normal = new Vec2(tangent.y, -tangent.x);
    const frontOffset = normal.dot(v11);
    const sideOffset1 = -tangent.dot(v11);
    const sideOffset2 = tangent.dot(v12);

    let clip = clipSegment(incident, tangent.neg(), sideOffset1, 2);
    if (clip.length < 2) return null;
    clip = clipSegment(clip, tangent, sideOffset2, 3);
    if (clip.length < 2) return null;

    const points = [];
    for (const cp of clip) {
      const sep = normal.dot(cp.v) - frontOffset;
      if (sep <= 0) {
        const p = cp.v.addScaled(normal, -0.5 * sep);
        points.push({ p, sep, id: (edge1 << 8) | (cp.id << 1) | (flip ? 1 : 0) });
      }
    }
    return manifold(flip ? normal.neg() : normal, points);
  }

  function flipManifold(m) {
    if (!m) return null;
    m.normal = m.normal.neg();
    return m;
  }

  /** Dispatch on shape types. Returns a manifold oriented from a to b or null. */
  function collide(a, b) {
    if (a.type === 'circle') {
      if (b.type === 'circle') return circleCircle(a, b);
      return flipManifold(polygonCircle(b, a));
    }
    if (b.type === 'circle') return polygonCircle(a, b);
    return polygonPolygon(a, b);
  }

  /** Boolean overlap test (used for sensors and placement validation). */
  function overlaps(a, b, margin = 0) {
    const m = collide(a, b);
    if (!m) return false;
    for (const p of m.points) if (p.sep < -margin) return true;
    return false;
  }

  Lab.Collide = { collide, overlaps, LINEAR_SLOP };
})(typeof window !== 'undefined' ? window : globalThis);
