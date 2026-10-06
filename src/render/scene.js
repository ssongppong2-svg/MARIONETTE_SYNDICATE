/*
 * Force Chamber — chamber drawing
 * Paper and grid, solids, bodies, ropes, pulleys, springs, liquids,
 * instruments, the exit door with its lock lamps, strobe trails and the
 * free-body force overlay.
 */
(function (root) {
  'use strict';
  const Lab = (root.Lab = root.Lab || {});
  const { Vec2, Mathx, Joints, WALL } = Lab;

  function bodyWorldShapes(b, pos, angle) {
    const xf = new Lab.Transform(pos || b.pos, angle != null ? angle : b.angle);
    return b.shapes.filter((s) => !s.sensor).map((s) => s.type === 'circle'
      ? { type: 'circle', c: xf.apply(s.center), r: s.radius, shape: s }
      : { type: 'poly', v: s.verts.map((v) => xf.apply(v)), shape: s });
  }

  const Scene = {
    draw(r, room, game, opts = {}) {
      const th = r.theme;
      this.background(r, room);
      if (room.def.drawBack) room.def.drawBack(room, r);
      for (const f of room.world.fluids) this.fluidBack(r, f, room);
      for (const z of room.zones) z.draw(r);
      this.trails(r, room);
      for (const j of room.world.joints) this.joint(r, j);
      for (const f of room.world.forces) if (f instanceof Joints.Spring) this.spring(r, f);
      // Static first, then moving bodies on top.
      for (const b of room.world.bodies) if (b.isStatic) this.body(r, b, room);
      for (const b of room.world.bodies) if (!b.isStatic) this.body(r, b, room);
      for (const f of room.world.fluids) this.fluidFront(r, f, room);
      for (const j of room.world.joints) this.jointFront(r, j);
      for (const d of room.devices) if (d.draw) d.draw(r);
      for (const l of room.labels) r.text(l.p, l.text, Object.assign({ size: 10, color: th.ink2 }, l));
      if (room.def.drawFront) room.def.drawFront(room, r);
      this.door(r, room);
      if (game.showForces) this.forces(r, room);
      if (opts.overlay) opts.overlay(r);
    },

    /* ---------------- paper ---------------- */
    background(r, room) {
      const th = r.theme, c = r.ctx;
      const W = room.W, H = room.H;
      r.rect(0, 0, W, H, { fill: th.paper });
      const minor = r.px(0.1) >= 7 ? 0.1 : r.px(0.25) >= 7 ? 0.25 : 0.5;
      c.save();
      c.beginPath();
      c.rect(r.X(0), r.Y(H), r.px(W), r.px(H));
      c.clip();
      c.lineWidth = 1;
      c.strokeStyle = th.grid;
      c.beginPath();
      for (let x = minor; x < W - 1e-6; x += minor) {
        if (Math.abs(x - Math.round(x)) < 1e-6) continue;
        const sx = Math.round(r.X(x)) + 0.5;
        c.moveTo(sx, r.Y(0)); c.lineTo(sx, r.Y(H));
      }
      for (let y = minor; y < H - 1e-6; y += minor) {
        if (Math.abs(y - Math.round(y)) < 1e-6) continue;
        const sy = Math.round(r.Y(y)) + 0.5;
        c.moveTo(r.X(0), sy); c.lineTo(r.X(W), sy);
      }
      c.stroke();
      c.strokeStyle = th.gridMajor;
      c.beginPath();
      for (let x = 1; x < W - 1e-6; x += 1) {
        const sx = Math.round(r.X(x)) + 0.5;
        c.moveTo(sx, r.Y(0)); c.lineTo(sx, r.Y(H));
      }
      for (let y = 1; y < H - 1e-6; y += 1) {
        const sy = Math.round(r.Y(y)) + 0.5;
        c.moveTo(r.X(0), sy); c.lineTo(r.X(W), sy);
      }
      c.stroke();
      c.restore();
      // Coordinate ticks along the floor and left wall (metres).
      if (room.def.axisLabels !== false) {
        for (let x = 1; x < W - 0.2; x += 1) r.text(new Vec2(x, -WALL / 2), String(x), { size: 8.5, color: th.ink3, align: 'center', bg: th.frame, bgAlpha: 0.9 });
        for (let y = 1; y < H - 0.2; y += 1) r.text(new Vec2(-WALL / 2, y), String(y), { size: 8.5, color: th.ink3, align: 'center', bg: th.frame, bgAlpha: 0.9 });
      }
    },

    /* ---------------- bodies ---------------- */
    body(r, b, room) {
      const st = b.style || {};
      if (st.hidden) return;
      const th = r.theme;
      const shapes = bodyWorldShapes(b);
      if (b.isStatic && !st.fill) {
        const frame = !!st.frame;
        for (const s of shapes) {
          const o = {
            fill: frame ? th.frame : th.solid,
            hatch: frame ? 'frame' : 'solid',
            stroke: st.stroke || (frame ? th.ink3 : th.ink),
            width: frame ? 1 : 1.3,
          };
          if (s.type === 'circle') r.circle(s.c, s.r, o); else r.poly(s.v, o);
        }
        if (st.label) r.text(b.pos.add(st.labelOffset || new Vec2(0, 0)), st.label, { size: st.labelSize || 10, color: th.ink2, align: 'center', bg: th.paper, bgAlpha: 0.85 });
        return;
      }
      const fill = st.fill || (st.fillToken && r.theme[st.fillToken]) || r.materialColor(b.shapes[0] && b.shapes[0].material);
      const stroke = st.accent ? th.accent : st.stroke || th.ink;
      const width = st.accent ? 2 : st.width || 1.4;
      for (const s of shapes) {
        const o = { fill: s.shape.style && s.shape.style.fill ? s.shape.style.fill : fill, stroke, width, alpha: st.alpha, dash: st.dash, hatch: st.hatch };
        if (s.type === 'circle') {
          r.circle(s.c, s.r, o);
          if (st.spokes !== 0) {
            const n = st.spokes || 1;
            for (let i = 0; i < n; i++) {
              const a = b.angle + (i * Math.PI) / n;
              const d = Vec2.fromAngle(a, s.r * 0.92);
              r.line(n > 1 ? s.c.sub(d) : s.c, s.c.add(d), { color: stroke, width: 1, alpha: 0.75 });
            }
          }
        } else {
          r.poly(s.v, o);
        }
      }
      if (st.com) r.comMark(b.pos, 4);
      if (st.label) {
        const p = b.pos.add(st.labelOffset || new Vec2(0, 0));
        r.text(p, st.label, { size: st.labelSize || 10, color: st.labelColor || th.ink, align: 'center', weight: 700, font: st.labelFont || 'mono' });
      }
      if (st.ring) {
        const p = b.worldPoint(st.ring);
        r.circle(p, 0.025, { stroke: th.ink, width: 1.4, fill: th.paper });
      }
    },

    /* ---------------- joints ---------------- */
    joint(r, j) {
      const th = r.theme, st = j.style || {};
      if (st.hidden) return;
      if (j instanceof Joints.DistanceJoint) {
        const a = j.anchorA, b = j.anchorB;
        const color = st.color || (j.rope ? th.rope : th.ink);
        const width = st.width || (j.rope ? 1.6 : 3);
        const d = a.dist(b);
        if (j.rope && d < j.length - 0.002) {
          // Slack rope: parabolic sag with the same arc length.
          const sag = Math.sqrt((3 * d * (j.length - d)) / 8);
          const mid = Vec2.lerp(a, b, 0.5).add(new Vec2(0, -2 * sag));
          const pts = [];
          for (let i = 0; i <= 16; i++) {
            const t = i / 16;
            pts.push(new Vec2(
              (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * mid.x + t * t * b.x,
              (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * mid.y + t * t * b.y));
          }
          r.polyline(pts, { color, width });
        } else {
          r.line(a, b, { color, width });
        }
        if (st.knots !== false) { r.dot(a, 2.2, color); r.dot(b, 2.2, color); }
      } else if (j instanceof Joints.RopePath) {
        const color = st.color || th.rope;
        for (const s of j.segments) r.line(s.a, s.b, { color, width: st.width || 1.6 });
        for (const n of j.nodes) {
          if (!n.radius) continue;
          if (n.sweep > 0.01) {
            // Rope wrapped around the wheel.
            const a0 = n.radius > 0 ? n.aOut : n.aIn;
            r.arc(n.world, Math.abs(n.radius), a0, a0 + n.sweep, { color, width: st.width || 1.6 });
          }
        }
        const first = j.nodes[0], last = j.nodes[j.nodes.length - 1];
        r.dot(first.world, 2.4, color); r.dot(last.world, 2.4, color);
      } else if (j instanceof Joints.SliderJoint && st.track) {
        const t = st.track;
        const a = j.origin.addScaled(j.axis, t[0]), b = j.origin.addScaled(j.axis, t[1]);
        r.line(a, b, { color: th.ink3, width: 3, alpha: 0.6 });
        r.line(a, b, { color: th.paper, width: 1, alpha: 0.9 });
      }
    },
    jointFront(r, j) {
      const th = r.theme, st = j.style || {};
      if (j instanceof Joints.RopePath) {
        for (const n of j.nodes) {
          if (!n.radius) continue;
          const R = Math.abs(n.radius);
          r.circle(n.world, R * 0.98, { fill: th.instrument, stroke: th.ink, width: 1.3 });
          for (let k = 0; k < 3; k++) {
            const a = n.spin + (k * Math.PI) / 3;
            const d = Vec2.fromAngle(a, R * 0.8);
            r.line(n.world.sub(d), n.world.add(d), { color: th.ink2, width: 1 });
          }
          r.circle(n.world, R * 0.2, { fill: th.paper, stroke: th.ink, width: 1 });
        }
      } else if (j instanceof Joints.RevoluteJoint && st.pin !== false) {
        const p = j.anchor;
        r.circle(p, st.pinRadius || 0.035, { fill: th.paper, stroke: th.ink, width: 1.5 });
        r.dot(p, 1.6, th.ink);
      }
    },
    spring(r, s) {
      const th = r.theme;
      const a = s.anchorA, b = s.anchorB;
      const d = b.sub(a), len = d.len();
      if (len < 1e-6 || (s.style && s.style.hidden)) return;
      const u = d.scale(1 / len), n = u.perp();
      const lead = Math.min(0.06, len * 0.12);
      const coils = s.coils, w = s.width / 2;
      const pts = [a, a.addScaled(u, lead)];
      const body = len - 2 * lead;
      for (let i = 0; i < coils * 2; i++) {
        const t = (i + 0.5) / (coils * 2);
        pts.push(a.addScaled(u, lead + body * t).addScaled(n, i % 2 ? -w : w));
      }
      pts.push(b.addScaled(u, -lead), b);
      r.polyline(pts, { color: (s.style && s.style.color) || th.ink, width: 1.5 });
    },

    /* ---------------- liquids ---------------- */
    fluidBack(r, f, room) {
      const th = r.theme;
      const t = room.time;
      const pts = [new Vec2(f.x0, f.y0), new Vec2(f.x1, f.y0)];
      const n = 40;
      for (let i = n; i >= 0; i--) {
        const x = f.x0 + ((f.x1 - f.x0) * i) / n;
        pts.push(new Vec2(x, f.surface + 0.008 * Math.sin(x * 9 + t * 2.2) + 0.005 * Math.sin(x * 23 - t * 3.1)));
      }
      r.poly(pts, { fill: th.water, alpha: 0.85 });
      f._surface = pts.slice(2);
    },
    fluidFront(r, f) {
      const th = r.theme;
      if (f._surface) r.polyline(f._surface, { color: th.waterLine, width: 1.6 });
      // Depth ticks on the tank's left side.
      for (let y = f.y0 + 0.5; y < f.surface - 0.05; y += 0.5) {
        r.line(new Vec2(f.x0, y), new Vec2(f.x0 + 0.1, y), { color: th.waterLine, width: 1, alpha: 0.7 });
      }
    },

    /* ---------------- door ---------------- */
    door(r, room) {
      const th = r.theme;
      const d = room.door;
      const x0 = d.x, x1 = d.x + WALL;
      // Doorway cut.
      r.rect(x0, d.y, x1, d.y + d.h, { fill: room.cleared ? th.paper : th.paper2, stroke: false });
      const lift = Mathx.smoothstep(room.doorOpen) * d.h * 0.96;
      const c = r.ctx;
      c.save();
      c.beginPath();
      c.rect(r.X(x0), r.Y(d.y + d.h), r.px(WALL), r.px(d.h));
      c.clip();
      r.rect(x0 + 0.02, d.y + lift, x1 - 0.02, d.y + d.h + lift, { fill: th.instrument, stroke: th.ink, width: 1.4 });
      for (let k = 1; k < 6; k++) {
        const y = d.y + lift + (k * d.h) / 6;
        r.line(new Vec2(x0 + 0.05, y), new Vec2(x1 - 0.05, y), { color: th.ink3, width: 1 });
      }
      c.restore();
      r.line(new Vec2(x0, d.y + d.h), new Vec2(x1, d.y + d.h), { color: th.ink, width: 2 });
      r.text(new Vec2((x0 + x1) / 2, d.y + d.h + 0.16), 'EXIT', { size: 9, color: room.cleared ? th.ok : th.ink2, align: 'center', weight: 700 });
      // Lock lamps stacked above the door, inside the chamber.
      const n = room.locks.length;
      room.locks.forEach((l, i) => {
        const p = new Vec2(x0 - 0.2, d.y + d.h + 0.42 + (n - 1 - i) * 0.3);
        if (l.open) {
          r.circle(p, 0.12, { fill: th.ok, alpha: 0.18, stroke: false });
          r.circle(p, 0.075, { fill: th.ok, stroke: th.ink, width: 1.2 });
        } else {
          r.circle(p, 0.075, { fill: th.paper, stroke: th.danger, width: 1.6 });
          r.dot(p, 2.2, th.danger);
        }
        r.text(p.add(new Vec2(-0.14, 0)), l.letter || String.fromCharCode(65 + i), { size: 9, color: th.ink2, align: 'right', weight: 700 });
      });
    },

    /* ---------------- strobe ---------------- */
    trails(r, room) {
      if (!room.trails || !room.trails.size) return;
      const th = r.theme;
      for (const [b, tr] of room.trails) {
        if (!b.world) continue;
        const n = tr.pts.length;
        tr.pts.forEach((pt, i) => {
          const alpha = 0.12 + 0.38 * ((i + 1) / n);
          for (const s of bodyWorldShapes(b, new Vec2(pt.x, pt.y), pt.a)) {
            if (s.type === 'circle') r.circle(s.c, s.r, { stroke: th.trail, width: 1, alpha });
            else r.poly(s.v, { stroke: th.trail, width: 1, alpha });
          }
          r.dot(new Vec2(pt.x, pt.y), 1.5, th.trail);
        });
      }
    },

    /* ---------------- forces ---------------- */
    forces(r, room) {
      const th = r.theme, w = room.world, dt = w.dt;
      const bodies = w.bodies.filter((b) => b.isDynamic && !b.style.hidden && !b.style.noForces);
      if (!bodies.length) return;
      let maxW = 0;
      for (const b of bodies) maxW = Math.max(maxW, b.mass * w.gravity.len() * b.gravityScale);
      const k = room.forceScale || (maxW > 0 ? 0.9 / maxW : 0.05); // metres per newton
      const minLen = r.m(6);
      const draw = (p, F, color, label) => {
        const L = F.len() * k;
        if (L < minLen) return;
        const end = p.addScaled(F, k);
        r.arrow(p, end, { color, width: 2.2, head: 9 });
        if (label) r.text(end.add(F.norm().scale(r.m(10))), `${Mathx.fmt(F.len(), 1)} N`, { size: 9, color, align: 'center', bg: th.paper, bgAlpha: 0.8 });
      };
      for (const b of bodies) {
        const Fg = w.gravity.scale(b.mass * b.gravityScale);
        draw(b.pos, Fg, th.fGravity, true);
        if (b.buoyancy) {
          let F = new Vec2(), P = new Vec2(), n = 0;
          for (const e of b.buoyancy) { F.iadd(e.F); P.iadd(e.p); n++; }
          draw(P.scale(1 / n), F, th.fBuoy, true);
        }
      }
      const set = new Set(bodies);
      for (const arb of w.arbiters.values()) {
        const n = arb.normal, t = new Vec2(n.y, -n.x);
        let Pn = 0, Pt = 0;
        const c = new Vec2();
        for (const cp of arb.contacts) { Pn += cp.Pn; Pt += cp.Pt; c.iadd(cp.p); }
        if (!arb.contacts.length) continue;
        c.iscale(1 / arb.contacts.length);
        const Fn = n.scale(Pn / dt), Ft = t.scale(Pt / dt);
        if (set.has(arb.b)) { draw(c, Fn, th.fNormal, true); draw(c, Ft, th.fFriction, true); }
        if (set.has(arb.a)) { draw(c, Fn.neg(), th.fNormal, true); draw(c, Ft.neg(), th.fFriction, true); }
      }
      for (const j of w.joints) {
        if (j instanceof Joints.DistanceJoint && j.rope) {
          const T = j.tension;
          if (T <= 0.01) continue;
          const a = j.anchorA, bb = j.anchorB, u = bb.sub(a).norm();
          if (set.has(j.b)) draw(bb, u.scale(-T), th.fTension, true);
          if (set.has(j.a)) draw(a, u.scale(T), th.fTension, true);
        } else if (j instanceof Joints.RopePath) {
          const T = j.tension;
          if (T <= 0.01) continue;
          const segs = j.segments;
          j.nodes.forEach((nd, i) => {
            if (!set.has(nd.body)) return;
            let F = new Vec2();
            if (i > 0) F.iadd(segs[i - 1].dir.scale(-T));
            if (i < segs.length) F.iadd(segs[i].dir.scale(T));
            draw(nd.world, F, th.fTension, true);
          });
        }
      }
      for (const f of w.forces) {
        if (!(f instanceof Joints.Spring) || !f.force) continue;
        const a = f.anchorA, b = f.anchorB, u = b.sub(a).norm();
        if (set.has(f.b)) draw(b, u.scale(-f.force), th.fSpring, true);
        if (set.has(f.a)) draw(a, u.scale(f.force), th.fSpring, true);
      }
    },
  };

  Lab.Scene = Scene;
  Lab.bodyWorldShapes = bodyWorldShapes;
})(typeof window !== 'undefined' ? window : globalThis);
