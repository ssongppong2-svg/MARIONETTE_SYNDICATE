/*
 * Nudge — drawing. Pastel, soft-edged, a little wobbly.
 * Order: sky → glow → ropes → things → water (tints what is under it) →
 * rock → wall → shards → particles → the pointer.
 */
(function (root) {
  'use strict';
  const Lab = root.Lab;
  const { Vec2 } = Lab;
  const Nudge = (Lab.Nudge = Lab.Nudge || {});

  const C = {
    skyTop: '#fdf0f5', skyBottom: '#e9f1fb', cave: '#efe9f8',
    rock: '#d9d1ef', rockEdge: '#b6aadb', rough: '#c4b8e4',
    ice: '#e2f6fb', iceLine: '#ffffff',
    water: 'rgba(118, 202, 221, 0.42)', waterTop: '#bff1f7', waterLine: 'rgba(255,255,255,0.35)',
    stone: '#93a0c4', stoneEdge: '#76829f', pumice: '#f4e4c0', pumiceDot: '#e2cd9f',
    bucket: '#f4a99c', bucketEdge: '#d48478',
    buoy: '#ffe190', buoyEdge: '#e8c35d',
    ram: '#9fe1c6', ramEdge: '#6cc2a3',
    knob: '#a6e3cf', knobEdge: '#6cc2a3',
    rope: '#8b78aa', pulley: '#ffffff',
    wall: '#f7a8c3', wallEdge: '#e17fa4', crack: '#ffffff',
    pointerEdge: '#9f8bcf', pointerTail: '#ffeaf3', pointerShadow: 'rgba(140, 120, 190, 0.45)',
    glowA: 'rgba(255, 236, 247, 0.95)', glowB: 'rgba(200, 236, 255, 0.0)',
    mote: 'rgba(255,255,255,0.7)',
  };

  class View {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.time = 0;
      this.particles = [];
      this.trail = [];
      this.jelly = { e: 0, v: 0, ang: 0 };
      this.motes = Array.from({ length: 40 }, (_, i) => ({ x: (i * 7.31) % 16, y: 3.2 + ((i * 3.77) % 5.6), s: 0.6 + ((i * 1.7) % 1) }));
    }

    resize() {
      const dpr = Math.min(root.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
      const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
      if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
      this.dpr = dpr;
      this.W = this.canvas.clientWidth;
      this.H = this.canvas.clientHeight;
    }

    fit(v) {
      const pad = 8;
      const sw = (this.W - 2 * pad) / (v[2] - v[0]), sh = (this.H - 2 * pad) / (v[3] - v[1]);
      this.scale = Math.min(sw, sh);
      this.ox = pad + (this.W - 2 * pad - (v[2] - v[0]) * this.scale) / 2 - v[0] * this.scale;
      this.oy = pad + (this.H - 2 * pad - (v[3] - v[1]) * this.scale) / 2 + v[3] * this.scale;
    }
    X(x) { return this.ox + x * this.scale; }
    Y(y) { return this.oy - y * this.scale; }
    toWorld(sx, sy) { return new Vec2((sx - this.ox) / this.scale, (this.oy - sy) / this.scale); }

    /** Polygon path with rounded corners (radius in metres). */
    rounded(c, verts, r) {
      this.roundedPx(c, verts.map((v) => [this.X(v.x), this.Y(v.y)]), r * this.scale);
    }
    /** The same in screen pixels. */
    roundedPx(c, P, rp) {
      const n = P.length;
      c.beginPath();
      for (let i = 0; i < n; i++) {
        const a = P[(i + n - 1) % n], b = P[i], d = P[(i + 1) % n];
        const m1 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        if (i === 0) c.moveTo(m1[0], m1[1]);
        c.arcTo(b[0], b[1], d[0], d[1], Math.min(rp, Math.hypot(b[0] - a[0], b[1] - a[1]) / 2, Math.hypot(d[0] - b[0], d[1] - b[1]) / 2));
      }
      c.closePath();
    }
    poly(c, verts) {
      c.beginPath();
      verts.forEach((v, i) => (i ? c.lineTo(this.X(v.x), this.Y(v.y)) : c.moveTo(this.X(v.x), this.Y(v.y))));
      c.closePath();
    }

    /** Rock outline: only the stretches of edge that face open air, computed once per room. */
    prepare(lv) {
      const L = lv.L;
      const rocks = lv.world.bodies.filter((b) => b.isStatic && b !== lv.wall);
      // The room's inner box; everything beyond it is solid rock to the screen's edge.
      lv.room = { x0: 0, x1: L.W, y0: L.WELL.floor, y1: L.H };
      const R = lv.room;
      const solid = (p, self) => p.x < R.x0 || p.x > R.x1 || p.y < R.y0 || p.y > R.y1 ||
        rocks.some((o) => o !== self && o.containsPoint(p));
      lv.edges = [];
      for (const b of rocks) {
        const s = b.shapes[0];
        for (let i = 0; i < s.wv.length; i++) {
          const a = s.wv[i], c = s.wv[(i + 1) % s.wv.length], n = s.wn[i];
          const len = a.dist(c), steps = Math.max(1, Math.ceil(len / 0.02));
          let run = null;
          for (let k = 0; k < steps; k++) {
            const t0 = k / steps, t1 = (k + 1) / steps;
            const open = !solid(Vec2.lerp(a, c, (t0 + t1) / 2).addScaled(n, 0.01), b);
            if (open && !run) run = t0;
            if ((!open || k === steps - 1) && run !== null) {
              const end = open ? t1 : t0;
              if (end > run) lv.edges.push({ a: Vec2.lerp(a, c, run), b: Vec2.lerp(a, c, end), n: n.clone(), kind: b.surface });
              run = null;
            }
          }
        }
      }
      lv.rocks = rocks;
      this.particles = [];
      this.trail = [];
      this.jelly = { e: 0, v: 0, ang: 0 };
      this.arrowLen = 0;
    }

    /* ---------------- frame ---------------- */
    draw(st, dt) {
      const { lv, rules } = st;
      const c = this.ctx;
      this.time += dt;
      this.dt = dt;
      c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      c.globalAlpha = 1;
      c.globalCompositeOperation = 'source-over';
      const g = c.createLinearGradient(0, 0, 0, this.H);
      g.addColorStop(0, C.skyTop);
      g.addColorStop(1, C.skyBottom);
      c.fillStyle = g;
      c.fillRect(0, 0, this.W, this.H);

      this.drawGoal(c, lv, rules);
      this.drawMotes(c, dt);
      this.drawRopes(c, lv);
      this.drawThings(c, lv, rules);
      this.drawWater(c, lv, rules, dt);
      this.drawRock(c, lv);
      this.drawWall(c, lv, rules);
      this.drawPulleys(c, lv);
      this.drawParticles(c, dt);
      if (!rules.done) this.drawPointer(c, st, dt);
      if (st.bloom > 0) {
        c.globalAlpha = Math.min(1, st.bloom);
        const rg = c.createRadialGradient(this.X(lv.L.GOAL.x), this.Y(lv.L.GOAL.y), 0, this.X(lv.L.GOAL.x), this.Y(lv.L.GOAL.y), Math.max(this.W, this.H));
        rg.addColorStop(0, '#ffffff');
        rg.addColorStop(0.5, '#fff6fb');
        rg.addColorStop(1, '#eef6ff');
        c.fillStyle = rg;
        c.fillRect(0, 0, this.W, this.H);
        c.globalAlpha = 1;
      }
      if (rules.done) {
        // Above the light: the pointer, and the fragment it found circling it.
        this.drawPointer(c, st, dt);
        const p = lv.pointer.pos, t = this.time, a = t * 1.8;
        const at = p.add(new Vec2(Math.cos(a) * 0.32, Math.sin(a) * 0.22 + 0.04));
        const tri = [new Vec2(-0.08, 0.05), new Vec2(0.09, 0.07), new Vec2(0.01, -0.1)].map((v) => at.add(v.rotate(t * 1.1)));
        this.poly(c, tri);
        c.fillStyle = '#ffffff';
        c.shadowColor = 'rgba(247, 168, 195, 0.9)';
        c.shadowBlur = 10;
        c.fill();
        c.shadowBlur = 0;
        c.shadowColor = 'transparent';
        c.strokeStyle = C.wallEdge;
        c.lineWidth = 1;
        c.stroke();
      }
      if (st.fade > 0) {
        c.globalAlpha = Math.min(1, st.fade);
        c.fillStyle = C.skyTop;
        c.fillRect(0, 0, this.W, this.H);
        c.globalAlpha = 1;
      }
    }

    drawGoal(c, lv, rules) {
      const p = lv.L.GOAL;
      const pulse = 1 + 0.06 * Math.sin(this.time * 2);
      const R = 1.6 * pulse * this.scale;
      const g = c.createRadialGradient(this.X(p.x), this.Y(p.y), 0, this.X(p.x), this.Y(p.y), R);
      g.addColorStop(0, 'rgba(255,255,255,0.95)');
      g.addColorStop(0.25, 'rgba(255, 225, 240, 0.7)');
      g.addColorStop(0.6, 'rgba(205, 230, 255, 0.35)');
      g.addColorStop(1, 'rgba(205, 230, 255, 0)');
      c.fillStyle = g;
      c.beginPath();
      c.arc(this.X(p.x), this.Y(p.y), R, 0, Math.PI * 2);
      c.fill();
      if (!rules.done) {
        const t = this.time;
        const tri = [new Vec2(-0.12, 0.07), new Vec2(0.13, 0.1), new Vec2(0.01, -0.14)].map((v) => p.add(v.rotate(t * 0.6)).add(new Vec2(0, 0.06 * Math.sin(t * 1.3))));
        c.fillStyle = '#ffffff';
        this.poly(c, tri);
        c.fill();
      }
    }

    drawMotes(c, dt) {
      c.fillStyle = C.mote;
      for (const m of this.motes) {
        m.y += dt * 0.08 * m.s;
        m.x += dt * 0.05 * Math.sin(this.time * 0.5 + m.s * 9);
        if (m.y > 8.8) { m.y = 3.2; }
        c.beginPath();
        c.arc(this.X(m.x), this.Y(m.y), 1.6 * m.s, 0, Math.PI * 2);
        c.fill();
      }
    }

    drawRopes(c, lv) {
      for (const rope of [lv.rope1, lv.rope2]) {
        const T = rope.tension;
        c.strokeStyle = C.rope;
        c.lineWidth = 1.4 + Math.min(3.2, T / 160);
        c.lineCap = 'round';
        c.globalAlpha = 0.9;
        if (T > 250) { c.shadowColor = 'rgba(160, 120, 220, 0.45)'; c.shadowBlur = Math.min(14, (T - 250) / 30); }
        c.beginPath();
        for (const s of rope.segments) {
          c.moveTo(this.X(s.a.x), this.Y(s.a.y));
          c.lineTo(this.X(s.b.x), this.Y(s.b.y));
        }
        for (const n of rope.nodes) {
          if (!n.radius || n.sweep < 0.01) continue;
          const a0 = n.radius > 0 ? n.aOut : n.aIn;
          c.moveTo(this.X(n.world.x + Math.abs(n.radius) * Math.cos(a0)), this.Y(n.world.y + Math.abs(n.radius) * Math.sin(a0)));
          c.arc(this.X(n.world.x), this.Y(n.world.y), Math.abs(n.radius) * this.scale, -a0, -(a0 + n.sweep), true);
        }
        c.stroke();
        c.shadowBlur = 0;
        c.globalAlpha = 1;
      }
    }

    drawPulleys(c, lv) {
      for (const rope of [lv.rope1, lv.rope2]) {
        for (const n of rope.nodes) {
          if (!n.radius) continue;
          const R = Math.abs(n.radius) * this.scale;
          c.fillStyle = C.pulley;
          c.strokeStyle = C.rope;
          c.lineWidth = 1.4;
          c.beginPath();
          c.arc(this.X(n.world.x), this.Y(n.world.y), R, 0, Math.PI * 2);
          c.fill();
          c.stroke();
          c.beginPath();
          for (let k = 0; k < 3; k++) {
            const a = n.spin + (k * Math.PI) / 3;
            c.moveTo(this.X(n.world.x) + Math.cos(a) * R * 0.75, this.Y(n.world.y) - Math.sin(a) * R * 0.75);
            c.lineTo(this.X(n.world.x) - Math.cos(a) * R * 0.75, this.Y(n.world.y) + Math.sin(a) * R * 0.75);
          }
          c.lineWidth = 1;
          c.stroke();
        }
      }
    }

    /** Fill a body's shapes with a soft rounded look. */
    body(c, b, fill, edge, r = 0.05, squish = 0) {
      for (const s of b.shapes) {
        if (s.type !== 'polygon') continue;
        let v = s.wv;
        if (squish) {
          const cen = b.pos;
          v = v.map((p) => cen.add(p.sub(cen).scale(1 + squish)));
        }
        this.rounded(c, v, r);
        c.fillStyle = fill;
        c.fill();
        c.strokeStyle = edge;
        c.lineWidth = 1.4;
        c.stroke();
      }
    }

    drawThings(c, lv, rules) {
      const near = (b) => lv.pointer.pos.dist(b.pos) < 1.6;
      // Ram with an embossed force arrow: its length follows how hard the ram presses the wall.
      this.body(c, lv.ram, C.ram, C.ramEdge, 0.12);
      const rp = lv.ram.pos;
      const fs = rules.broken ? 0 : Math.min(1.15, rules.force / lv.L.STRENGTH);
      this.arrowLen = (this.arrowLen || 0) + (fs - (this.arrowLen || 0)) * Math.min(1, this.dt * 6);
      const x0 = rp.x - 0.75, tip = x0 + 0.2 + 1.25 * this.arrowLen;
      c.strokeStyle = 'rgba(255,255,255,0.8)';
      c.lineWidth = 3;
      c.lineCap = 'round';
      c.lineJoin = 'round';
      c.beginPath();
      c.moveTo(this.X(x0), this.Y(rp.y));
      c.lineTo(this.X(tip), this.Y(rp.y));
      c.moveTo(this.X(tip - 0.17), this.Y(rp.y + 0.16));
      c.lineTo(this.X(tip), this.Y(rp.y));
      c.lineTo(this.X(tip - 0.17), this.Y(rp.y - 0.16));
      c.stroke();
      // Controls with a soft halo when the pointer comes close.
      for (const k of [lv.gate, lv.plug]) {
        if (near(k)) {
          const a = 0.25 + 0.15 * Math.sin(this.time * 3);
          c.fillStyle = `rgba(166, 227, 207, ${a})`;
          c.beginPath();
          c.arc(this.X(k.pos.x), this.Y(k.pos.y), 0.38 * this.scale, 0, Math.PI * 2);
          c.fill();
        }
        this.body(c, k, C.knob, C.knobEdge, 0.03);
      }
      // Bucket and its handle.
      this.body(c, lv.bucket, C.bucket, C.bucketEdge, 0.02);
      const h = lv.bucket.worldPoint(lv.bucketLocal.handle);
      const left = lv.bucket.worldPoint(lv.bucketLocal.left), right = lv.bucket.worldPoint(lv.bucketLocal.right);
      c.strokeStyle = C.bucketEdge;
      c.lineWidth = 1.6;
      c.beginPath();
      c.moveTo(this.X(left.x), this.Y(left.y));
      c.quadraticCurveTo(this.X(h.x), this.Y(h.y + 0.12), this.X(right.x), this.Y(right.y));
      c.stroke();
      // Buoy with a stripe.
      this.body(c, lv.buoy, C.buoy, C.buoyEdge, 0.14);
      const bp = lv.buoy.pos, ba = lv.buoy.angle;
      c.strokeStyle = 'rgba(255,255,255,0.85)';
      c.lineWidth = 4;
      c.beginPath();
      const s1 = bp.add(new Vec2(-0.24, 0).rotate(ba)), s2 = bp.add(new Vec2(0.24, 0).rotate(ba));
      c.moveTo(this.X(s1.x), this.Y(s1.y));
      c.lineTo(this.X(s2.x), this.Y(s2.y));
      c.stroke();
      // Stones and the pumice.
      for (const s of lv.stones) {
        const sq = s.squish || 0;
        this.body(c, s, C.stone, C.stoneEdge, 0.05, sq);
        s.squish = sq * 0.85;
      }
      this.body(c, lv.pumice, C.pumice, C.pumiceDot, 0.07);
      c.fillStyle = C.pumiceDot;
      for (const d of [[-0.07, 0.04], [0.05, -0.03], [0.08, 0.06], [-0.03, -0.06]]) {
        const p = lv.pumice.worldPoint(new Vec2(d[0], d[1]));
        c.beginPath();
        c.arc(this.X(p.x), this.Y(p.y), 2, 0, Math.PI * 2);
        c.fill();
      }
      for (const sh of rules.shards) {
        const left = sh.life - (rules.time - rules.brokenAt);
        this.body(c, sh, C.wall, C.wallEdge, 0.03, left < 0.4 ? -0.85 * (1 - left / 0.4) : 0);
      }
    }

    drawWater(c, lv, rules, dt) {
      const L = lv.L, lvl = lv.level, t = this.time;
      const wave = (x, amp) => amp * Math.sin(x * 5 + t * 1.6) + amp * 0.6 * Math.sin(x * 11 - t * 2.3);
      const fill = (x0, x1, y0, top, amp) => {
        if (top <= y0 + 0.001) return;
        c.beginPath();
        c.moveTo(this.X(x0), this.Y(y0));
        const n = Math.max(6, Math.round((x1 - x0) * 8));
        for (let i = 0; i <= n; i++) {
          const x = x0 + ((x1 - x0) * i) / n;
          c.lineTo(this.X(x), this.Y(top + wave(x, amp)));
        }
        c.lineTo(this.X(x1), this.Y(y0));
        c.closePath();
        c.fillStyle = C.water;
        c.fill();
        c.strokeStyle = C.waterTop;
        c.lineWidth = 2;
        c.beginPath();
        for (let i = 0; i <= n; i++) {
          const x = x0 + ((x1 - x0) * i) / n;
          const y = top + wave(x, amp);
          if (i) c.lineTo(this.X(x), this.Y(y)); else c.moveTo(this.X(x), this.Y(y));
        }
        c.stroke();
      };
      const W = L.WELL, T = L.TUNNEL, R = L.RESERVOIR;
      fill(W.x0, W.x1, W.floor, Math.min(lvl, L.GROUND), 0.015);
      if (lvl > T.floor) fill(T.x0, T.x1, T.floor, Math.min(lvl, T.roof - 0.02), 0.015);
      fill(R.x0 + 0.15, R.x1 - 0.15, R.y0 + 0.15, 8.0, 0.02);

      // Streams: the pipe into the reservoir, and the outlet when the gate is open.
      const inflow = lv.inflowOpen();
      this.stream(c, new Vec2(2.4, 9.0), new Vec2(2.4, 8.0), 0.12, 1, dt);
      if (inflow > 0.02) {
        const bottom = Math.max(lvl, T.floor);
        this.stream(c, new Vec2(1.7, 5.3), new Vec2(1.7, bottom), 0.18 * inflow + 0.03, inflow, dt);
      }
      // Bubbles over an open drain.
      const drain = lv.drainOpen();
      if (drain > 0.05 && lvl > W.floor + 0.05) {
        for (let i = 0; i < 2; i++) {
          if (Math.random() < drain * 0.5) {
            this.particles.push({ x: (L.DRAIN[0] + L.DRAIN[1]) / 2 + (Math.random() - 0.5) * 0.25, y: W.floor + 0.2, vx: (Math.random() - 0.5) * 0.3, vy: 0.6 + Math.random() * 0.4, life: 1.6, top: lvl, kind: 'bubble' });
          }
        }
      }
    }

    stream(c, a, b, width, strength, dt) {
      if (b.y >= a.y) return;
      const g = c.createLinearGradient(0, this.Y(a.y), 0, this.Y(b.y));
      g.addColorStop(0, 'rgba(150, 215, 230, 0.7)');
      g.addColorStop(1, 'rgba(150, 215, 230, 0.35)');
      c.fillStyle = g;
      const wob = (y) => 0.015 * Math.sin(y * 9 + this.time * 7);
      c.beginPath();
      const n = 16;
      for (let i = 0; i <= n; i++) {
        const y = a.y + ((b.y - a.y) * i) / n;
        c.lineTo(this.X(a.x - width / 2 + wob(y)), this.Y(y));
      }
      for (let i = n; i >= 0; i--) {
        const y = a.y + ((b.y - a.y) * i) / n;
        c.lineTo(this.X(a.x + width / 2 + wob(y + 1)), this.Y(y));
      }
      c.closePath();
      c.fill();
      if (Math.random() < 0.6 * strength) {
        this.particles.push({ x: b.x + (Math.random() - 0.5) * width, y: b.y + 0.02, vx: (Math.random() - 0.5) * 1.2, vy: 0.8 + Math.random() * 0.8, life: 0.5, kind: 'drop' });
      }
    }

    drawRock(c, lv) {
      // All rock in one path, so neighbouring blocks fill as one mass without hairline seams.
      const R = lv.room, x0 = this.X(R.x0), x1 = this.X(R.x1), y0 = this.Y(R.y1), y1 = this.Y(R.y0);
      // Every sub-path winds the same way as the bodies' (counter-clockwise in world space),
      // so overlaps add up instead of cancelling under the nonzero rule.
      const band = (ax, ay, bx, by) => { c.moveTo(ax, by); c.lineTo(bx, by); c.lineTo(bx, ay); c.lineTo(ax, ay); c.closePath(); };
      c.beginPath();
      band(0, 0, this.W, y0);
      band(0, y1, this.W, this.H);
      band(0, 0, x0, this.H);
      band(x1, 0, this.W, this.H);
      for (const b of lv.rocks) {
        b.shapes[0].wv.forEach((v, i) => (i ? c.lineTo(this.X(v.x), this.Y(v.y)) : c.moveTo(this.X(v.x), this.Y(v.y))));
        c.closePath();
      }
      c.fillStyle = C.rock;
      c.fill();
      // Ice strip.
      c.fillStyle = C.ice;
      this.poly(c, lv.ice.shapes[0].wv);
      c.fill();
      c.strokeStyle = C.rockEdge;
      c.lineWidth = 1.6;
      c.lineCap = 'round';
      c.beginPath();
      for (const e of lv.edges) {
        c.moveTo(this.X(e.a.x), this.Y(e.a.y));
        c.lineTo(this.X(e.b.x), this.Y(e.b.y));
      }
      c.stroke();
      // Pebbly rough floor and a glint on the ice.
      c.fillStyle = C.rough;
      for (const e of lv.edges) {
        if (e.kind !== 'tunnel' || e.n.y < 0.7) continue;
        const L = e.a.dist(e.b);
        for (let s = 0.05; s < L; s += 0.11) {
          const p = Vec2.lerp(e.a, e.b, s / L);
          c.beginPath();
          c.arc(this.X(p.x), this.Y(p.y) + 2, 2 + ((s * 37) % 1.5), Math.PI, 0);
          c.fill();
        }
      }
      const ice = lv.ice.shapes[0].wv;
      c.strokeStyle = C.iceLine;
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(this.X(ice[3].x + 0.1), this.Y(ice[3].y - 0.02));
      c.lineTo(this.X(ice[2].x - 0.1), this.Y(ice[2].y - 0.02));
      c.stroke();
    }

    drawWall(c, lv, rules) {
      if (rules.broken) return;
      const W = lv.L.WALL;
      const S = lv.L.STRENGTH;
      const f = Math.min(1.3, rules.force / S);
      const bulge = 0.07 * f; // elastic: the face gives in proportion to the force
      const shake = rules.stress > 0 ? (Math.random() - 0.5) * 0.012 * (1 + rules.stress * 3) : 0;
      const yc = lv.L.GROUND + 0.5;
      const pts = [];
      const n = 24;
      for (let i = 0; i <= n; i++) {
        const y = W.y0 + ((W.y1 - W.y0) * i) / n;
        const k = Math.exp(-Math.pow((y - yc) / 1.2, 2));
        pts.push(new Vec2(W.x0 + bulge * k + shake, y));
      }
      for (let i = n; i >= 0; i--) {
        const y = W.y0 + ((W.y1 - W.y0) * i) / n;
        const k = Math.exp(-Math.pow((y - yc) / 1.4, 2));
        pts.push(new Vec2(W.x1 + bulge * 0.8 * k + shake, y));
      }
      c.globalAlpha = 0.9;
      this.poly(c, pts);
      c.fillStyle = C.wall;
      c.fill();
      c.globalAlpha = 1;
      c.strokeStyle = C.wallEdge;
      c.lineWidth = 1.6;
      c.stroke();
      // Cracks grow past the elastic range and with accumulated strain.
      const level = Math.max(0, (f - 0.45) / 0.55) * 0.6 + rules.stress * 0.6;
      if (level > 0.02) {
        c.save();
        this.poly(c, pts);
        c.clip();
        const rng = Lab.Mathx.makeRng(11);
        c.strokeStyle = C.crack;
        c.lineWidth = 1.6;
        c.lineCap = 'round';
        const origin = new Vec2(W.x0 + bulge, yc);
        const branches = 7;
        for (let b = 0; b < branches; b++) {
          const ang = -Math.PI / 2 + (b / (branches - 1)) * Math.PI + (rng() - 0.5) * 0.3;
          let p = origin.clone();
          const segs = 6;
          const len = (0.25 + rng() * 0.45) * Math.min(1.3, level) * 2.4;
          c.beginPath();
          c.moveTo(this.X(p.x), this.Y(p.y));
          for (let k = 0; k < segs; k++) {
            const a = ang + (rng() - 0.5) * 0.9;
            p = p.add(Vec2.fromAngle(a, len / segs));
            c.lineTo(this.X(p.x), this.Y(p.y));
          }
          c.stroke();
        }
        c.restore();
      }
    }

    drawParticles(c, dt) {
      const keep = [];
      for (const p of this.particles) {
        p.life -= dt;
        if (p.life <= 0) continue;
        if (p.kind === 'drop') { p.vy -= 9.8 * dt; }
        if (p.kind === 'bubble' && p.y > p.top) continue;
        if (p.kind === 'puff') { p.vx *= 0.96; p.vy *= 0.96; }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        keep.push(p);
        c.globalAlpha = Math.min(1, p.life * 2);
        if (p.kind === 'bubble') {
          c.strokeStyle = 'rgba(255,255,255,0.9)';
          c.lineWidth = 1.2;
          c.beginPath();
          c.arc(this.X(p.x), this.Y(p.y), 3, 0, Math.PI * 2);
          c.stroke();
        } else {
          c.fillStyle = p.color || 'rgba(190, 236, 245, 0.95)';
          c.beginPath();
          c.arc(this.X(p.x), this.Y(p.y), p.r || 2.4, 0, Math.PI * 2);
          c.fill();
        }
      }
      c.globalAlpha = 1;
      this.particles = keep.length > 400 ? keep.slice(-400) : keep;
    }

    puff(p, color, n = 20, speed = 2) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, s = Math.random() * speed;
        this.particles.push({ x: p.x, y: p.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.8 + Math.random() * 0.6, kind: 'puff', color, r: 2 + Math.random() * 3 });
      }
    }

    /** The classic arrow cursor, tip up-left, centred on the body (y down, in cursor units). */
    cursorPath(c, k) {
      this.roundedPx(c, CURSOR.map(([x, y]) => [(x - 5) * k, (y - 10) * k]), 1.2 * k);
    }

    /** Jelly: the body's stretch is a damped spring chasing what its motion asks for. */
    wobble(dt, want, ang) {
      const j = this.jelly;
      // Turn the stretch axis toward the new direction without flipping through 180°.
      let da = Math.atan2(Math.sin(ang - j.ang), Math.cos(ang - j.ang));
      if (Math.abs(da) > Math.PI / 2) da -= Math.sign(da) * Math.PI;
      j.ang += da * Math.min(1, dt * 14);
      for (let t = 0; t < dt; t += 1 / 240) {
        const h = Math.min(1 / 240, dt - t);
        j.v += (220 * (want - j.e) - 9 * j.v) * h;
        j.e += j.v * h;
      }
      j.e = Math.max(-0.4, Math.min(0.5, j.e));
    }

    drawPointer(c, st, dt) {
      const { lv, rules, mouse } = st;
      const b = lv.pointer, p = b.pos, v = b.vel;
      const k = (0.0125 * this.scale);          // metres per cursor unit, in pixels
      // Where the mouse really is: a faint ghost cursor on a dashed tether.
      if (mouse && p.dist(mouse) > 0.3) {
        c.strokeStyle = 'rgba(150, 130, 200, 0.32)';
        c.lineWidth = 1.2;
        c.setLineDash([3, 5]);
        c.beginPath();
        c.moveTo(this.X(p.x), this.Y(p.y));
        c.lineTo(this.X(mouse.x), this.Y(mouse.y));
        c.stroke();
        c.setLineDash([2, 3]);
        c.save();
        c.translate(this.X(mouse.x), this.Y(mouse.y));
        this.cursorPath(c, k);
        c.stroke();
        c.restore();
        c.setLineDash([]);
      }
      // Soft trail.
      this.trail.push({ x: p.x, y: p.y, life: 0.35 });
      for (const t of this.trail) t.life -= dt;
      this.trail = this.trail.filter((t) => t.life > 0);
      for (const t of this.trail) {
        c.fillStyle = `rgba(255,255,255,${t.life * 0.8})`;
        c.beginPath();
        c.arc(this.X(t.x), this.Y(t.y), 0.08 * this.scale * (0.3 + t.life), 0, Math.PI * 2);
        c.fill();
      }
      // Stretch along motion; flatten against whatever it is straining at; wobble in between.
      const speed = v.len();
      const F = rules.drive.F;
      let want = Math.min(0.32, speed / 11), ang = speed > 0.05 ? Math.atan2(v.y, v.x) : this.jelly.ang;
      if (rules.drive.strained) { want = -0.24; ang = Math.atan2(F.y, F.x); }
      this.wobble(dt, want, ang);
      const j = this.jelly, sx = 1 + j.e, sy = 1 / Math.sqrt(Math.max(0.3, sx));
      const shape = () => {
        c.rotate(-j.ang);
        c.scale(sx, sy);
        c.rotate(j.ang);
      };
      c.save();
      c.translate(this.X(p.x), this.Y(p.y));
      shape();
      this.cursorPath(c, k);
      const g = c.createLinearGradient(-5 * k, -10 * k, 6 * k, 9 * k);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(1, C.pointerTail);
      c.fillStyle = g;
      c.shadowColor = C.pointerShadow;
      c.shadowBlur = 5;
      c.shadowOffsetY = 2;
      c.fill();
      c.shadowColor = 'transparent';
      c.lineJoin = 'round';
      c.strokeStyle = C.pointerEdge;
      c.lineWidth = 1.1;
      c.stroke();
      c.restore();
      if (st.holdReset > 0) {
        c.strokeStyle = 'rgba(150, 130, 200, 0.8)';
        c.lineWidth = 2;
        c.beginPath();
        c.arc(this.X(p.x), this.Y(p.y), 0.26 * this.scale, -Math.PI / 2, -Math.PI / 2 + st.holdReset * Math.PI * 2);
        c.stroke();
      }
    }
  }

  // A classic arrow cursor, 12 × 20 units, tip at the origin.
  const CURSOR = [[0, 0], [0, 17], [4, 13], [7, 20], [10, 19], [7, 12.5], [12, 12.5]];

  Nudge.View = View;
  Nudge.COLORS = C;
})(typeof window !== 'undefined' ? window : globalThis);
