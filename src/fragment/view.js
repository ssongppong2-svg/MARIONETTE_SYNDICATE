/*
 * Fragment — drawing.
 * Black field, white line work. Light is a mask cut by visibility polygons,
 * so solid ground casts real shadows. Only the dot and the fragment shine.
 */
(function (root) {
  'use strict';
  const Lab = root.Lab;
  const { Vec2 } = Lab;
  const Frag = (Lab.Fragment = Lab.Fragment || {});

  const WHITE = '#ffffff';
  const DOT_LIGHT = 3.6;
  const SHARD_LIGHT = 4.2;

  class View {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.mask = document.createElement('canvas');
      this.mctx = this.mask.getContext('2d');
      this.cam = null;
      this.scale = 60;
      this.dpr = 1;
      this.time = 0;
    }

    resize() {
      const dpr = Math.min(root.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
      const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
      if (this.canvas.width !== w || this.canvas.height !== h) {
        this.canvas.width = w; this.canvas.height = h;
        this.mask.width = w; this.mask.height = h;
      }
      this.dpr = dpr;
      this.W = this.canvas.clientWidth;
      this.H = this.canvas.clientHeight;
      // About nine metres of world tall; never narrower than eight metres.
      this.scale = Math.min(this.H / 9, this.W / 8);
    }

    follow(lv, dt, snap) {
      const d = lv.dot.pos;
      const target = new Vec2(d.x + 1.2, d.y - 1.5);
      const B = lv.L.WORLD;
      const hw = this.W / this.scale / 2, hh = this.H / this.scale / 2;
      target.x = Math.max(B.x0 + hw - 1.5, Math.min(B.x1 - hw + 1.5, target.x));
      target.y = Math.max(B.y0 + hh - 0.4, Math.min(B.y1 - hh, target.y));
      if (!this.cam || snap) this.cam = target;
      else this.cam = Vec2.lerp(this.cam, target, 1 - Math.exp(-dt * 3.2));
    }

    X(x) { return (x - this.cam.x) * this.scale + this.W / 2; }
    Y(y) { return (this.cam.y - y) * this.scale + this.H / 2; }
    toWorld(sx, sy) { return new Vec2((sx - this.W / 2) / this.scale + this.cam.x, this.cam.y - (sy - this.H / 2) / this.scale); }

    path(c, pts, close = true) {
      c.beginPath();
      pts.forEach((p, i) => (i ? c.lineTo(this.X(p.x), this.Y(p.y)) : c.moveTo(this.X(p.x), this.Y(p.y))));
      if (close) c.closePath();
    }

    /** Edges of static geometry not buried inside other solids, computed once per level. */
    prepare(lv) {
      const edges = [];
      const statics = lv.world.bodies.filter((b) => b.isStatic);
      const insideOther = (p, self) => statics.some((o) => o !== self && o.containsPoint(p));
      for (const b of statics) {
        for (const s of b.shapes) {
          const v = s.wv, n = v.length;
          for (let i = 0; i < n; i++) {
            const a = v[i], c = v[(i + 1) % n];
            const mid = Vec2.lerp(a, c, 0.5);
            const nrm = s.wn[i];
            if (insideOther(mid.addScaled(nrm, 0.02), b)) continue;
            edges.push({ a: a.clone(), b: c.clone(), n: nrm.clone(), rough: b.surface === 'rough' && nrm.y > 0.7, smooth: b.surface === 'smooth' && nrm.y > 0.3 });
          }
        }
      }
      lv.edges = edges;
    }

    /* ---------------- frame ---------------- */
    draw(state) {
      const { lv, rules } = state;
      const c = this.ctx;
      c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      c.globalCompositeOperation = 'source-over';
      c.globalAlpha = 1;
      c.fillStyle = '#000';
      c.fillRect(0, 0, this.W, this.H);

      this.drawWater(c, lv);
      this.drawGround(c, lv);
      this.drawSprings(c, lv);
      this.drawBodies(c, lv);
      this.applyLight(state);
      this.drawShard(c, lv, rules, state);
      this.drawDot(c, lv, rules, state);
      this.drawHand(c, state);
      if (state.fade > 0) {
        c.globalAlpha = Math.min(1, state.fade);
        c.fillStyle = '#000';
        c.fillRect(0, 0, this.W, this.H);
        c.globalAlpha = 1;
      }
    }

    drawWater(c, lv) {
      for (const f of lv.world.fluids) {
        const top = f.drawTop != null ? f.drawTop : f.surface + 0.05;
        c.save();
        c.beginPath();
        c.rect(this.X(f.x0), this.Y(top), (f.x1 - f.x0) * this.scale, (top - f.y0) * this.scale);
        c.clip();
        c.strokeStyle = WHITE;
        c.lineWidth = 1;
        c.globalAlpha = 0.16;
        c.beginPath();
        for (let y = f.surface - 0.35; y > f.y0; y -= 0.35) {
          const sy = Math.round(this.Y(y)) + 0.5;
          c.moveTo(this.X(f.x0), sy);
          c.lineTo(this.X(f.x1), sy);
        }
        c.stroke();
        if (f.drawTop != null) { c.restore(); continue; } // submerged region: no surface line
        c.globalAlpha = 0.85;
        c.beginPath();
        const n = Math.max(8, Math.round((f.x1 - f.x0) * 6));
        for (let i = 0; i <= n; i++) {
          const x = f.x0 + ((f.x1 - f.x0) * i) / n;
          const y = f.surface + 0.012 * Math.sin(x * 7 + this.time * 1.8) + 0.008 * Math.sin(x * 17 - this.time * 2.6);
          if (i) c.lineTo(this.X(x), this.Y(y)); else c.moveTo(this.X(x), this.Y(y));
        }
        c.stroke();
        c.restore();
      }
    }

    drawGround(c, lv) {
      c.strokeStyle = WHITE;
      c.lineWidth = 1.4;
      c.globalAlpha = 1;
      c.beginPath();
      for (const e of lv.edges) {
        if (e.rough) {
          // Sawtooth: rough ground reads as rough.
          const L = e.a.dist(e.b);
          const u = e.b.sub(e.a).scale(1 / L);
          const teeth = Math.max(1, Math.round(L / 0.09));
          c.moveTo(this.X(e.a.x), this.Y(e.a.y));
          for (let i = 1; i <= teeth; i++) {
            const t = (i / teeth) * L;
            const mid = e.a.addScaled(u, t - L / teeth / 2).addScaled(e.n, 0.035);
            const end = e.a.addScaled(u, t);
            c.lineTo(this.X(mid.x), this.Y(mid.y));
            c.lineTo(this.X(end.x), this.Y(end.y));
          }
        } else {
          c.moveTo(this.X(e.a.x), this.Y(e.a.y));
          c.lineTo(this.X(e.b.x), this.Y(e.b.y));
        }
      }
      c.stroke();
      // Polished surfaces get a second hairline just below.
      c.globalAlpha = 0.45;
      c.lineWidth = 1;
      c.beginPath();
      for (const e of lv.edges) {
        if (!e.smooth) continue;
        const a = e.a.addScaled(e.n, -0.06), b = e.b.addScaled(e.n, -0.06);
        c.moveTo(this.X(a.x), this.Y(a.y));
        c.lineTo(this.X(b.x), this.Y(b.y));
      }
      c.stroke();
      c.globalAlpha = 1;
    }

    drawSprings(c, lv) {
      c.strokeStyle = WHITE;
      c.lineWidth = 1.2;
      c.globalAlpha = 0.9;
      for (const s of lv.springs) {
        const a = s.anchorA, b = s.anchorB;
        const d = b.sub(a), len = d.len();
        const u = d.scale(1 / len), n = u.perp();
        const pts = [a, a.addScaled(u, 0.05)];
        const coils = s.coils * 2;
        for (let i = 0; i < coils; i++) {
          const t = 0.05 + ((len - 0.1) * (i + 0.5)) / coils;
          pts.push(a.addScaled(u, t).addScaled(n, (i % 2 ? -1 : 1) * s.width / 2));
        }
        pts.push(b.addScaled(u, -0.05), b);
        this.path(c, pts, false);
        c.stroke();
      }
      // Platform guide rails.
      c.globalAlpha = 0.35;
      c.setLineDash([4, 6]);
      for (const x of [lv.L.WELL.x0 + 0.02]) {
        c.beginPath();
        c.moveTo(this.X(x), this.Y(lv.L.WELL.floor));
        c.lineTo(this.X(x), this.Y(lv.L.PAD_TOP + 0.4));
        c.stroke();
      }
      c.setLineDash([]);
      c.globalAlpha = 1;
    }

    hatch(c, verts, spacing) {
      c.save();
      this.path(c, verts);
      c.clip();
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const v of verts) {
        const x = this.X(v.x), y = this.Y(v.y);
        minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
      c.beginPath();
      const h = maxY - minY;
      for (let x = minX - h; x < maxX; x += spacing) {
        c.moveTo(x, maxY);
        c.lineTo(x + h, minY);
      }
      c.lineWidth = 1;
      c.stroke();
      c.restore();
    }

    drawBodies(c, lv) {
      c.strokeStyle = WHITE;
      for (const b of lv.world.bodies) {
        if (b.isStatic || b.role === 'dot' || b.role === 'shard') continue;
        const hovered = lv.hover === b;
        for (const s of b.shapes) {
          if (s.type !== 'polygon') continue;
          const v = s.wv;
          c.fillStyle = '#000';
          this.path(c, v);
          c.fill();
          c.lineWidth = hovered ? 2.2 : 1.4;
          c.globalAlpha = 1;
          c.stroke();
          if (b.role === 'stone') { c.globalAlpha = 0.75; this.hatch(c, v, 7); }
          if (b.role === 'ingot') { c.globalAlpha = 0.95; this.hatch(c, v, 2.6); }
          c.globalAlpha = 1;
        }
        if (b.role === 'crate') {
          // An empty box: a smaller inner outline.
          const inner = b.shapes[0].verts.map((v) => b.worldPoint(v.scale(0.72)));
          c.globalAlpha = 0.4;
          this.path(c, inner);
          c.lineWidth = 1;
          c.stroke();
          c.globalAlpha = 1;
        }
      }
    }

    applyLight(state) {
      const { lv, rules } = state;
      const m = this.mctx;
      m.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      m.globalCompositeOperation = 'source-over';
      m.fillStyle = '#000';
      m.fillRect(0, 0, this.W, this.H);
      m.globalCompositeOperation = 'destination-out';
      const lights = [{ p: lv.dot.pos, r: state.dotLight || DOT_LIGHT, k: 1 }];
      if (lv.shard.world) lights.push({ p: lv.shard.pos, r: SHARD_LIGHT * (0.94 + 0.06 * Math.sin(this.time * 2.3)), k: 0.9 });
      state.dotVis = null;
      for (const L of lights) {
        const poly = Frag.visibility(lv.world, L.p, L.r);
        if (L.p === lv.dot.pos) state.dotVis = poly;
        m.save();
        this.path(m, poly);
        m.clip();
        const g = m.createRadialGradient(this.X(L.p.x), this.Y(L.p.y), 0, this.X(L.p.x), this.Y(L.p.y), L.r * this.scale);
        g.addColorStop(0, `rgba(0,0,0,${L.k})`);
        g.addColorStop(0.55, `rgba(0,0,0,${L.k * 0.75})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        m.fillStyle = g;
        m.fillRect(0, 0, this.W, this.H);
        m.restore();
      }
      // When the fragment is taken, its light ignores walls for a moment.
      const reveal = Math.max(0, Math.min(1, ((state.dotLight || DOT_LIGHT) - DOT_LIGHT * 1.2) / 24));
      if (reveal > 0) {
        const p = lv.dot.pos, R = (state.dotLight || DOT_LIGHT) * this.scale;
        const g = m.createRadialGradient(this.X(p.x), this.Y(p.y), 0, this.X(p.x), this.Y(p.y), R);
        g.addColorStop(0, `rgba(0,0,0,${0.95 * reveal})`);
        g.addColorStop(0.6, `rgba(0,0,0,${0.8 * reveal})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        m.fillStyle = g;
        m.fillRect(0, 0, this.W, this.H);
      }
      const c = this.ctx;
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.drawImage(this.mask, 0, 0);
      c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }

    glow(c, p, r, a) {
      const g = c.createRadialGradient(this.X(p.x), this.Y(p.y), 0, this.X(p.x), this.Y(p.y), r * this.scale);
      g.addColorStop(0, `rgba(255,255,255,${a})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.globalCompositeOperation = 'lighter';
      c.fillStyle = g;
      c.beginPath();
      c.arc(this.X(p.x), this.Y(p.y), r * this.scale, 0, Math.PI * 2);
      c.fill();
      c.globalCompositeOperation = 'source-over';
    }

    drawShard(c, lv, rules, state) {
      if (lv.shard.world) {
        this.glow(c, lv.shard.pos, 0.55, 0.35 + 0.08 * Math.sin(this.time * 2.3));
        c.fillStyle = WHITE;
        this.path(c, lv.shard.shapes[0].wv);
        c.fill();
      } else if (rules.collected) {
        // The fragment now circles the dot.
        const t = this.time * 1.4;
        const o = lv.dot.pos.add(Vec2.fromAngle(t, 0.42));
        const tri = [new Vec2(-0.07, 0.04), new Vec2(0.08, 0.05), new Vec2(0.01, -0.08)].map((v) => o.add(v.rotate(t * 1.7)));
        this.glow(c, o, 0.3, 0.3);
        c.fillStyle = WHITE;
        this.path(c, tri);
        c.fill();
      }
    }

    drawDot(c, lv, rules, state) {
      const p = lv.dot.pos;
      this.glow(c, p, 0.9, 0.22);
      c.fillStyle = WHITE;
      c.beginPath();
      c.arc(this.X(p.x), this.Y(p.y), 0.17 * this.scale, 0, Math.PI * 2);
      c.fill();
      if (state.holdReset > 0) {
        c.strokeStyle = WHITE;
        c.globalAlpha = 0.6;
        c.lineWidth = 1.2;
        c.beginPath();
        c.arc(this.X(p.x), this.Y(p.y), 0.32 * this.scale, -Math.PI / 2, -Math.PI / 2 + state.holdReset * Math.PI * 2);
        c.stroke();
        c.globalAlpha = 1;
      }
    }

    drawHand(c, state) {
      const { rules, pointer } = state;
      const hand = rules.hand;
      c.strokeStyle = WHITE;
      c.fillStyle = WHITE;
      if (hand.active && hand.point) {
        const p = hand.point;
        const F = hand.F;
        const len = (F.len() / Frag.HAND_MAX) * 1.3;
        const dir = F.len() > 1e-6 ? F.scale(1 / F.len()) : new Vec2(0, 1);
        const end = p.addScaled(dir, len);
        // The force as an arrow from its point of application.
        c.globalAlpha = 0.95;
        c.lineWidth = hand.saturated ? 2.6 : 1.6;
        c.beginPath();
        c.moveTo(this.X(p.x), this.Y(p.y));
        c.lineTo(this.X(end.x), this.Y(end.y));
        c.stroke();
        const ang = Math.atan2(-(end.y - p.y), end.x - p.x);
        const hs = hand.saturated ? 11 : 8;
        c.beginPath();
        c.moveTo(this.X(end.x), this.Y(end.y));
        c.lineTo(this.X(end.x) - Math.cos(ang - 0.4) * hs, this.Y(end.y) - Math.sin(ang - 0.4) * hs);
        c.lineTo(this.X(end.x) - Math.cos(ang + 0.4) * hs, this.Y(end.y) - Math.sin(ang + 0.4) * hs);
        c.closePath();
        c.fill();
        c.beginPath();
        c.arc(this.X(p.x), this.Y(p.y), 2.5, 0, Math.PI * 2);
        c.fill();
        // Faint tether to the dot: the hand's reach.
        c.globalAlpha = 0.18;
        c.lineWidth = 1;
        c.setLineDash([2, 5]);
        c.beginPath();
        c.moveTo(this.X(state.lv.dot.pos.x), this.Y(state.lv.dot.pos.y));
        c.lineTo(this.X(p.x), this.Y(p.y));
        c.stroke();
        c.setLineDash([]);
        c.globalAlpha = 1;
      }
      if (pointer && pointer.inside && !pointer.touch) {
        const big = state.lv.hover && !hand.active;
        c.globalAlpha = big ? 0.95 : 0.55;
        c.lineWidth = 1.2;
        c.beginPath();
        c.arc(pointer.sx, pointer.sy, big ? 7 : 3, 0, Math.PI * 2);
        c.stroke();
        c.globalAlpha = 1;
      }
    }
  }

  Frag.View = View;
  Frag.DOT_LIGHT = DOT_LIGHT;
})(typeof window !== 'undefined' ? window : globalThis);
