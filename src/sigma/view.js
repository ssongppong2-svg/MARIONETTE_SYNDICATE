/*
 * ΣF — the room, drawn like a live schematic on a dark instrument screen.
 * A cached static layer (grid, rock, rulers) under a per-frame layer
 * (water, machines, objects, particles). Text-heavy overlays live in hud.js.
 */
(function (root) {
  'use strict';
  const Lab = root.Lab;
  const { Vec2 } = Lab;
  const Sigma = (Lab.Sigma = Lab.Sigma || {});

  const C = {
    bg: '#03060a', air: '#060c12',
    grid: 'rgba(94, 230, 255, 0.035)', gridMajor: 'rgba(94, 230, 255, 0.075)',
    rock: '#09121a', rockHatch: 'rgba(94, 230, 255, 0.055)', rockEdge: '#24505f',
    cyan: '#5ee6ff', cyanDim: 'rgba(94, 230, 255, 0.45)', cyanFaint: 'rgba(94, 230, 255, 0.16)',
    text: '#d3e9f1', text2: '#86a3b2', text3: '#4f6878',
    amber: '#ffb23e', amberDim: 'rgba(255, 178, 62, 0.35)', red: '#ff4d5e', green: '#5dff9e', violet: '#b892ff', white: '#ffffff',
    water: 'rgba(36, 150, 214, 0.22)', waterLine: '#66d6ff', waterScan: 'rgba(102, 214, 255, 0.07)',
    panel: 'rgba(4, 9, 14, 0.88)', panelLine: 'rgba(94, 230, 255, 0.24)',
    mat: {
      stone: '#8fb3c4', wood: '#e3a253', raft: '#53c2a8', lead: '#a4b0bc', pumice: '#d6c69a',
      steel: '#7c9aac', core: '#ffffff', knob: '#ffb23e',
    },
    force: { W: '#ff6b7a', N: '#5ee6ff', f: '#b892ff', B: '#5dff9e', T: '#ffd166', sum: '#ffffff' },
  };
  const FONT = {
    mono: '"JetBrains Mono", "IBM Plex Sans KR", ui-monospace, Menlo, monospace',
    sans: '"IBM Plex Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif',
    disp: '"Chakra Petch", "IBM Plex Sans KR", sans-serif',
  };

  class View {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.layer = root.document ? root.document.createElement('canvas') : null;
      this.time = 0;
      this.particles = [];
      this.cracks = [];
      this.glitch = 0;
      this.flash = 0;
      this.reduced = !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
    }

    resize() {
      const dpr = Math.min(root.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
      const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
      const changed = this.canvas.width !== w || this.canvas.height !== h || this.dpr !== dpr;
      if (changed) { this.canvas.width = w; this.canvas.height = h; }
      this.dpr = dpr;
      this.W = this.canvas.clientWidth;
      this.H = this.canvas.clientHeight;
      return changed;
    }

    /** Screen regions: a top bar, the room, and (when there is room) a bottom instrument deck. */
    layout(L) {
      const W = this.W, H = this.H;
      this.compact = W < 820 || H < 560;
      this.top = this.compact ? 30 : 40;
      this.bottom = this.compact ? 0 : Math.round(Math.min(178, Math.max(138, H * 0.21)));
      const v = L.VIEW, pad = 6;
      const aw = W - 2 * pad, ah = H - this.top - this.bottom - 2 * pad;
      this.scale = Math.min(aw / (v[2] - v[0]), ah / (v[3] - v[1]));
      this.ox = pad + (aw - (v[2] - v[0]) * this.scale) / 2 - v[0] * this.scale;
      this.oy = this.top + pad + (ah - (v[3] - v[1]) * this.scale) / 2 + v[3] * this.scale;
    }
    X(x) { return this.ox + x * this.scale; }
    Y(y) { return this.oy - y * this.scale; }
    P(p) { return [this.X(p.x), this.Y(p.y)]; }
    toWorld(sx, sy) { return new Vec2((sx - this.ox) / this.scale, (this.oy - sy) / this.scale); }

    poly(c, verts) {
      c.beginPath();
      verts.forEach((v, i) => (i ? c.lineTo(this.X(v.x), this.Y(v.y)) : c.moveTo(this.X(v.x), this.Y(v.y))));
      c.closePath();
    }
    rect(c, x0, y0, x1, y1) {
      c.beginPath();
      c.rect(this.X(x0), this.Y(y1), (x1 - x0) * this.scale, (y1 - y0) * this.scale);
    }
    font(size, kind = 'mono', weight = 400) { return `${weight} ${size}px ${FONT[kind]}`; }
    text(c, s, x, y, o = {}) {
      c.font = o.font || this.font(o.size || 10, o.kind || 'mono', o.weight || 400);
      c.fillStyle = o.color || C.text;
      c.textAlign = o.align || 'left';
      c.textBaseline = o.base || 'alphabetic';
      c.fillText(s, x, y);
    }

    /* ---------------- per-room preparation ---------------- */
    prepare(lv) {
      const L = lv.L;
      lv.room = { x0: 0, x1: L.W, y0: 0, y1: L.H };
      const rocks = lv.solids;
      const R = lv.room;
      const solid = (p, self) => p.x < R.x0 || p.x > R.x1 || p.y < R.y0 || p.y > R.y1 || rocks.some((o) => o !== self && o.containsPoint(p));
      lv.edges = [];
      for (const b of rocks) {
        const s = b.shapes[0];
        for (let i = 0; i < s.wv.length; i++) {
          const a = s.wv[i], c = s.wv[(i + 1) % s.wv.length], n = s.wn[i];
          const steps = Math.max(1, Math.ceil(a.dist(c) / 0.03));
          let run = null;
          for (let k = 0; k < steps; k++) {
            const t0 = k / steps, t1 = (k + 1) / steps;
            const open = !solid(Vec2.lerp(a, c, (t0 + t1) / 2).addScaled(n, 0.01), b);
            if (open && run === null) run = t0;
            if ((!open || k === steps - 1) && run !== null) {
              const end = open ? t1 : t0;
              if (end > run) lv.edges.push({ a: Vec2.lerp(a, c, run), b: Vec2.lerp(a, c, end), n: n.clone(), kind: b.surface });
              run = null;
            }
          }
        }
      }
      this.lv = lv;
      this.particles = [];
      this.cracks = [];
      this.layerKey = null;
    }

    /** Grid, rock and rulers: drawn once per size into an offscreen layer. */
    buildLayer() {
      const lv = this.lv, L = lv.L;
      const key = `${this.W}x${this.H}@${this.dpr}`;
      if (this.layerKey === key || !this.layer) return;
      this.layerKey = key;
      const cv = this.layer;
      cv.width = this.canvas.width; cv.height = this.canvas.height;
      const c = cv.getContext('2d');
      c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      c.fillStyle = C.bg;
      c.fillRect(0, 0, this.W, this.H);
      // Air with a measuring grid.
      const R = lv.room;
      c.fillStyle = C.air;
      this.rect(c, R.x0, R.y0, R.x1, R.y1);
      c.fill();
      c.lineWidth = 1;
      for (let x = 0; x <= L.W + 1e-6; x += 0.25) {
        c.strokeStyle = Math.abs(x - Math.round(x)) < 1e-6 ? C.gridMajor : C.grid;
        c.beginPath(); c.moveTo(Math.round(this.X(x)) + 0.5, this.Y(R.y0)); c.lineTo(Math.round(this.X(x)) + 0.5, this.Y(R.y1)); c.stroke();
      }
      for (let y = 0; y <= L.H + 1e-6; y += 0.25) {
        c.strokeStyle = Math.abs(y - Math.round(y)) < 1e-6 ? C.gridMajor : C.grid;
        c.beginPath(); c.moveTo(this.X(R.x0), Math.round(this.Y(y)) + 0.5); c.lineTo(this.X(R.x1), Math.round(this.Y(y)) + 0.5); c.stroke();
      }
      // Rock: one path (no seams), cross-hatched, with lit edges.
      const x0 = this.X(R.x0), x1 = this.X(R.x1), y0 = this.Y(R.y1), y1 = this.Y(R.y0);
      const band = (ax, ay, bx, by) => { c.moveTo(ax, by); c.lineTo(bx, by); c.lineTo(bx, ay); c.lineTo(ax, ay); c.closePath(); };
      c.beginPath();
      band(0, 0, this.W, y0); band(0, y1, this.W, this.H); band(0, 0, x0, this.H); band(x1, 0, this.W, this.H);
      for (const b of lv.solids) {
        b.shapes[0].wv.forEach((v, i) => (i ? c.lineTo(this.X(v.x), this.Y(v.y)) : c.moveTo(this.X(v.x), this.Y(v.y))));
        c.closePath();
      }
      c.fillStyle = C.rock;
      c.fill();
      c.save();
      c.clip();
      c.strokeStyle = C.rockHatch;
      c.lineWidth = 1;
      c.beginPath();
      for (let d = -this.H; d < this.W; d += 7) { c.moveTo(d, this.H); c.lineTo(d + this.H, 0); }
      c.stroke();
      c.restore();
      c.strokeStyle = C.rockEdge;
      c.lineWidth = 1.2;
      c.beginPath();
      for (const e of lv.edges) { c.moveTo(this.X(e.a.x), this.Y(e.a.y)); c.lineTo(this.X(e.b.x), this.Y(e.b.y)); }
      c.stroke();
      // The rough deck: a fine tooth along its top.
      c.strokeStyle = 'rgba(94, 230, 255, 0.35)';
      c.beginPath();
      for (const e of lv.edges) {
        if (e.kind !== 'deck' || e.n.y < 0.7) continue;
        const len = e.a.dist(e.b);
        for (let s = 0; s < len; s += 0.08) {
          const p = Vec2.lerp(e.a, e.b, s / len);
          c.moveTo(this.X(p.x), this.Y(p.y)); c.lineTo(this.X(p.x) + 2, this.Y(p.y) + 3);
        }
      }
      c.stroke();
      // Pipes, as schematic double lines buried in the rock.
      this.pipes(c);
      // Rulers in the rock margins.
      this.rulers(c);
      // Engraved captions.
      if (!this.compact) {
        const cap = (t, x, y, al = 'left') => this.text(c, t, this.X(x), this.Y(y), { size: 9, color: C.text3, align: al, kind: 'sans', weight: 500 });
        cap('DECK · μs 0.62 · μk 0.48', 6.05, 2.36);
        cap('VAULT', 15.35, 2.75, 'center');
      }
    }

    pipes(c) {
      const lv = this.lv, L = lv.L, C0 = L.CABINET, T = L.TANK, H = L.HEADER;
      const pipe = (pts) => {
        for (const [w, col] of [[5, 'rgba(94,230,255,0.10)'], [1, 'rgba(94,230,255,0.38)']]) {
          c.strokeStyle = col; c.lineWidth = w; c.lineJoin = 'round';
          c.beginPath();
          pts.forEach((p, i) => (i ? c.lineTo(this.X(p[0]), this.Y(p[1])) : c.moveTo(this.X(p[0]), this.Y(p[1]))));
          c.stroke();
        }
      };
      const ox = (C0.outlet[0] + C0.outlet[1]) / 2;
      pipe([[ox, T.y0 - 0.12], [ox, C0.y1]]);                                   // tank → valve
      pipe([[0.06, L.SUMP.overflow], [0.06, -0.12], [12.1, -0.12], [12.1, 2.33], [12.2, 2.33]]); // overflow → shaft
      pipe([[(H.x0 + H.x1) / 2 + 0.2, H.y0 - 0.06], [13.95, 3.5], [13.95, 2.33], [13.4, 2.33]]); // header → shaft
      this.pipeRoutes = {
        over: [[0.06, L.SUMP.overflow], [0.06, -0.12], [12.1, -0.12], [12.1, 2.33], [12.2, 2.33]],
        needle: [[(H.x0 + H.x1) / 2 + 0.2, H.y0 - 0.06], [13.95, 3.5], [13.95, 2.33], [13.4, 2.33]],
        main: [[ox, T.y0 - 0.12], [ox, C0.y1]],
      };
    }

    rulers(c) {
      const L = this.lv.L;
      c.strokeStyle = C.text3;
      c.lineWidth = 1;
      c.beginPath();
      for (let x = 0; x <= L.W; x += 0.5) {
        const big = Math.abs(x - Math.round(x)) < 1e-6;
        c.moveTo(this.X(x), this.Y(0) + 1); c.lineTo(this.X(x), this.Y(0) + (big ? 6 : 3));
      }
      for (let y = 0; y <= L.H; y += 0.5) {
        const big = Math.abs(y - Math.round(y)) < 1e-6;
        c.moveTo(this.X(0) - 1, this.Y(y)); c.lineTo(this.X(0) - (big ? 6 : 3), this.Y(y));
      }
      c.stroke();
      if (this.scale < 30) return;
      for (let x = 0; x <= L.W; x += 1) this.text(c, `${x}`, this.X(x), this.Y(0) + 14, { size: 8, color: C.text3, align: 'center' });
      for (let y = 1; y <= L.H; y += 1) this.text(c, `${y}`, this.X(0) - 8, this.Y(y) + 3, { size: 8, color: C.text3, align: 'right' });
      this.text(c, 'm', this.X(L.W) + 8, this.Y(0) + 14, { size: 8, color: C.text3 });
    }

    /* ---------------- frame ---------------- */
    draw(st, dt) {
      const c = this.ctx;
      this.time += dt;
      this.dt = dt;
      this.buildLayer();
      c.setTransform(1, 0, 0, 1, 0, 0);
      if (this.layer) c.drawImage(this.layer, 0, 0);
      c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      c.globalAlpha = 1;
      this.drawWater(c, st);
      this.drawStreams(c, st);
      this.drawMachines(c, st);
      this.drawItems(c, st);
      this.drawGlass(c, st);
      this.drawParticles(c, dt);
      Sigma.HUD.world(this, st);
      Sigma.HUD.screen(this, st);
      this.drawEffects(c, st, dt);
      Sigma.HUD.overlays(this, c, st);
    }

    /* Water: translucent fill, scanlines, a bright moving surface. */
    waterBox(c, x0, y0, x1, top, amp = 0.012) {
      if (top <= y0 + 1e-4) return;
      const t = this.time;
      const wave = (x) => amp * Math.sin(x * 6 + t * 1.8) + amp * 0.5 * Math.sin(x * 13 - t * 2.6);
      const n = Math.max(4, Math.round((x1 - x0) * 10));
      c.beginPath();
      c.moveTo(this.X(x0), this.Y(y0));
      for (let i = 0; i <= n; i++) { const x = x0 + ((x1 - x0) * i) / n; c.lineTo(this.X(x), this.Y(top + wave(x))); }
      c.lineTo(this.X(x1), this.Y(y0));
      c.closePath();
      c.fillStyle = C.water;
      c.fill();
      c.save();
      c.clip();
      c.strokeStyle = C.waterScan;
      c.lineWidth = 1;
      c.beginPath();
      for (let y = this.Y(top) + 3; y < this.Y(y0); y += 4) { c.moveTo(this.X(x0), y); c.lineTo(this.X(x1), y); }
      c.stroke();
      c.restore();
      c.strokeStyle = C.waterLine;
      c.lineWidth = 1.4;
      c.beginPath();
      for (let i = 0; i <= n; i++) { const x = x0 + ((x1 - x0) * i) / n; const y = this.Y(top + wave(x)); if (i) c.lineTo(this.X(x), y); else c.moveTo(this.X(x), y); }
      c.stroke();
    }

    drawWater(c, st) {
      const lv = st.lv, L = lv.L, T = L.TANK, S = L.SUMP, H = L.HEADER;
      this.waterBox(c, T.x0, T.y0, T.x1, T.y0 + lv.tankWater / ((T.x1 - T.x0) * 100), 0.015);
      this.waterBox(c, S.x0, S.floor, S.x1, lv.sumpLevel(), 0.012);
      this.waterBox(c, H.x0, H.y0, H.x1, H.y0 + lv.headerWater / ((H.x1 - H.x0) * 100), 0.006);
      // Water in the bucket rides with it.
      if (lv.bucketWater > 0.01) {
        const B = L.BUCKET, fl = lv.bucket.worldPoint(lv.bucketLocal.floor);
        const iw = B.w - 2 * B.t;
        const h = Math.min(B.h - B.t, lv.bucketWater / (iw * 100));
        this.waterBox(c, fl.x - iw / 2, fl.y, fl.x + iw / 2, fl.y + h, 0.004);
      }
      // Overflow line in the sump.
      c.setLineDash([4, 4]);
      c.strokeStyle = 'rgba(255, 77, 94, 0.55)';
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(this.X(S.x0), this.Y(S.overflow)); c.lineTo(this.X(S.x1), this.Y(S.overflow));
      c.stroke();
      c.setLineDash([]);
    }

    /** Falling water and the flow in the pipes (moving dashes). */
    drawStreams(c, st) {
      const lv = st.lv, r = st.rules, L = lv.L, C0 = L.CABINET;
      const stream = (x, yTop, yBot, w, k) => {
        if (yBot >= yTop) return;
        const g = c.createLinearGradient(0, this.Y(yTop), 0, this.Y(yBot));
        g.addColorStop(0, 'rgba(102, 214, 255, 0.55)');
        g.addColorStop(1, 'rgba(102, 214, 255, 0.15)');
        c.fillStyle = g;
        const wob = (y) => 0.01 * Math.sin(y * 11 + this.time * 9);
        c.beginPath();
        for (let i = 0; i <= 14; i++) { const y = yTop + ((yBot - yTop) * i) / 14; c.lineTo(this.X(x - w / 2 + wob(y)), this.Y(y)); }
        for (let i = 14; i >= 0; i--) { const y = yTop + ((yBot - yTop) * i) / 14; c.lineTo(this.X(x + w / 2 + wob(y + 1)), this.Y(y)); }
        c.closePath();
        c.fill();
        if (Math.random() < k) this.particles.push({ x: x + (Math.random() - 0.5) * w, y: yBot + 0.02, vx: (Math.random() - 0.5) * 1.4, vy: 0.6 + Math.random(), life: 0.45, kind: 'drop' });
      };
      const ox = (C0.outlet[0] + C0.outlet[1]) / 2;
      const qm = r.flows.main / L.MAIN_Q;
      if (qm > 0.005) stream(ox, C0.y0, Math.max(lv.sumpLevel(), 0), 0.06 + 0.22 * qm, 0.8 * qm);
      const fl = lv.bucket.worldPoint(lv.bucketLocal.floor).y + Math.max(0, lv.bucketWater / ((L.BUCKET.w - 2 * L.BUCKET.t) * 100));
      const qn = r.flows.needle / L.NEEDLE_Q;
      if (qn > 0.005) stream(13.3, 2.33, fl, 0.02 + 0.05 * qn, 0.5 * qn);
      if (r.flows.over > 0.05) stream(12.3, 2.33, fl, 0.03 + Math.min(0.2, r.flows.over / 200), 0.6);
      // Flow in pipes: dashes travelling along the route.
      const flow = (route, q) => {
        if (!this.pipeRoutes || q <= 0.002) return;
        c.save();
        c.strokeStyle = 'rgba(102, 214, 255, 0.9)';
        c.lineWidth = 1.6;
        c.setLineDash([3, 7]);
        c.lineDashOffset = -this.time * 40;
        c.beginPath();
        route.forEach((p, i) => (i ? c.lineTo(this.X(p[0]), this.Y(p[1])) : c.moveTo(this.X(p[0]), this.Y(p[1]))));
        c.stroke();
        c.restore();
      };
      if (this.pipeRoutes) {
        flow(this.pipeRoutes.main, qm);
        flow(this.pipeRoutes.needle, qn);
        flow(this.pipeRoutes.over, r.flows.over);
      }
    }

    /* ---------------- machines ---------------- */
    drawMachines(c, st) {
      const lv = st.lv, r = st.rules, L = lv.L;
      // Tank and header walls are rock; label their insides with a faint frame.
      // Cradle ledges.
      for (const b of lv.cradle) {
        if (!b.world) continue;
        this.poly(c, b.shapes[0].wv);
        c.fillStyle = '#1a2a33'; c.fill();
        c.strokeStyle = C.amber; c.lineWidth = 1; c.stroke();
      }
      // Hatch flaps: hazard-striped plates, swung down while open.
      const SH = L.SHAFT, D = L.DECK, slot = L.HATCH.slot;
      const open = r.hatchOpen > 0 ? Math.min(1, (L.HATCH.open - r.hatchOpen) / 0.18) : 0;
      const flap = (hx, len, dir) => {
        c.save();
        c.translate(this.X(hx), this.Y(D - 0.05));
        c.rotate(dir * open * 1.45);
        const w = len * this.scale * dir, h = 0.1 * this.scale;
        c.fillStyle = '#141d24';
        c.fillRect(0, -h / 2, w, h);
        c.save();
        c.beginPath(); c.rect(0, -h / 2, w, h); c.clip();
        c.strokeStyle = 'rgba(255, 178, 62, 0.75)'; c.lineWidth = 3;
        c.beginPath();
        for (let s = -20; s < Math.abs(w) + 20; s += 9) { c.moveTo(dir * s, h / 2); c.lineTo(dir * (s + 6), -h / 2); }
        c.stroke();
        c.restore();
        c.strokeStyle = C.amber; c.lineWidth = 1;
        c.strokeRect(0, -h / 2, w, h);
        c.restore();
      };
      flap(SH.x0, slot[0] - SH.x0, 1);
      flap(SH.x1, SH.x1 - slot[1], -1);
      // Bucket.
      const bk = lv.bucket;
      for (const s of bk.shapes) { this.poly(c, s.wv); c.fillStyle = '#16232b'; c.fill(); c.strokeStyle = C.mat.steel; c.lineWidth = 1.2; c.stroke(); }
      // Door: ribbed steel plate in its housing.
      const dr = lv.door, dv = dr.shapes[0].wv;
      this.poly(c, dv);
      c.fillStyle = r.lockout ? '#2a0d12' : '#121c23'; c.fill();
      c.strokeStyle = r.lockout ? C.red : C.mat.steel; c.lineWidth = 1.4; c.stroke();
      c.save(); this.poly(c, dv); c.clip();
      c.strokeStyle = 'rgba(124, 154, 172, 0.35)'; c.lineWidth = 1;
      c.beginPath();
      for (let y = dr.pos.y - 0.7; y <= dr.pos.y + 0.7; y += 0.14) { c.moveTo(this.X(dr.pos.x - 0.15), this.Y(y)); c.lineTo(this.X(dr.pos.x + 0.15), this.Y(y)); }
      c.stroke();
      c.restore();
      // Rope and pulleys.
      const rope = lv.rope, T = rope.tension;
      c.strokeStyle = T > 1240 ? C.amber : '#b9cbd5';
      c.lineWidth = 1 + Math.min(2, T / 900);
      c.beginPath();
      for (const s of rope.segments) { c.moveTo(this.X(s.a.x), this.Y(s.a.y)); c.lineTo(this.X(s.b.x), this.Y(s.b.y)); }
      for (const n of rope.nodes) {
        if (!n.radius || n.sweep < 0.01) continue;
        const a0 = n.radius > 0 ? n.aOut : n.aIn;
        c.moveTo(this.X(n.world.x + Math.abs(n.radius) * Math.cos(a0)), this.Y(n.world.y + Math.abs(n.radius) * Math.sin(a0)));
        c.arc(this.X(n.world.x), this.Y(n.world.y), Math.abs(n.radius) * this.scale, -a0, -(a0 + n.sweep), true);
      }
      c.stroke();
      for (const n of rope.nodes) {
        if (!n.radius) continue;
        const R = Math.abs(n.radius) * this.scale, [x, y] = this.P(n.world);
        c.fillStyle = '#0b141b'; c.strokeStyle = C.cyan; c.lineWidth = 1;
        c.beginPath(); c.arc(x, y, R, 0, Math.PI * 2); c.fill(); c.stroke();
        c.beginPath();
        for (let k = 0; k < 3; k++) { const a = n.spin + (k * Math.PI) / 3; c.moveTo(x + Math.cos(a) * R, y - Math.sin(a) * R); c.lineTo(x - Math.cos(a) * R, y + Math.sin(a) * R); }
        c.stroke();
      }
      // Knobs: rails, then the handles.
      const rail = (k, x0, x1, y) => {
        c.strokeStyle = 'rgba(255, 178, 62, 0.28)'; c.lineWidth = 3; c.lineCap = 'round';
        c.beginPath(); c.moveTo(this.X(x0), this.Y(y)); c.lineTo(this.X(x1), this.Y(y)); c.stroke();
        c.lineCap = 'butt';
      };
      rail(lv.needle, lv.needleOrigin, lv.needleOrigin + 0.4, lv.needle.pos.y - 0.15);
      rail(lv.trap, lv.trapOrigin, lv.trapOrigin + L.TRAP.travel, D + 0.02);
      rail(lv.pin, lv.pinOrigin, lv.pinOrigin + 0.35, D + 0.02);
      for (const k of [lv.mainValve, lv.needle, lv.trap, lv.pin]) {
        const hot = st.hover === k || r.tether.body === k;
        for (const s of k.shapes) {
          this.poly(c, s.wv);
          c.fillStyle = hot ? 'rgba(255, 178, 62, 0.45)' : 'rgba(255, 178, 62, 0.16)';
          c.fill();
          c.strokeStyle = C.amber; c.lineWidth = 1.2; c.stroke();
        }
      }
      // The core's vault glow.
      const core = lv.core;
      if (!r.done) {
        const g = c.createRadialGradient(this.X(core.pos.x), this.Y(core.pos.y), 0, this.X(core.pos.x), this.Y(core.pos.y), 0.9 * this.scale);
        g.addColorStop(0, 'rgba(255,255,255,0.35)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = g;
        c.beginPath(); c.arc(this.X(core.pos.x), this.Y(core.pos.y), 0.9 * this.scale, 0, Math.PI * 2); c.fill();
      }
    }

    /* ---------------- objects ---------------- */
    drawItems(c, st) {
      const lv = st.lv, r = st.rules;
      const contents = new Set(r.bucketContents());
      for (const b of lv.items) {
        if (!b.world) continue;
        const col = b === lv.core ? C.white : C.mat[b.shapes[0].material.key] || C.cyan;
        const hot = st.hover === b || r.tether.body === b;
        for (const s of b.shapes) {
          this.poly(c, s.wv);
          c.fillStyle = b === lv.core ? 'rgba(255,255,255,0.92)' : hot ? 'rgba(40, 70, 86, 0.95)' : 'rgba(14, 26, 34, 0.94)';
          c.fill();
          c.strokeStyle = col;
          c.lineWidth = hot ? 2 : 1.2;
          c.stroke();
        }
        const [x, y] = this.P(b.pos);
        const key = b.shapes[0].material.key;
        c.save();
        c.translate(x, y);
        c.rotate(-b.angle);
        const w = b.size[0] * this.scale, h = b.size[1] * this.scale;
        c.strokeStyle = col;
        c.globalAlpha = 0.5;
        c.lineWidth = 1;
        c.beginPath();
        if (key === 'wood') {          // crate: braces
          c.moveTo(-w / 2 + 3, -h / 2 + 3); c.lineTo(w / 2 - 3, h / 2 - 3);
          c.moveTo(-w / 2 + 3, h / 2 - 3); c.lineTo(w / 2 - 3, -h / 2 + 3);
          c.rect(-w / 2 + 3, -h / 2 + 3, w - 6, h - 6);
        } else if (key === 'raft') {   // planks
          for (let i = 1; i < 6; i++) { const xx = -w / 2 + (w * i) / 6; c.moveTo(xx, -h / 2 + 2); c.lineTo(xx, h / 2 - 2); }
        } else if (key === 'steel' || key === 'lead') {
          c.moveTo(-w / 2, -h / 2); c.lineTo(w / 2, h / 2); c.moveTo(-w / 2, h / 2); c.lineTo(w / 2, -h / 2);
        } else if (key === 'pumice') {
          for (const [dx, dy] of [[-0.25, -0.2], [0.2, -0.1], [0.05, 0.22], [-0.15, 0.15], [0.28, 0.25]]) { c.moveTo(dx * w + 1.5, dy * h); c.arc(dx * w, dy * h, 1.5, 0, Math.PI * 2); }
        } else if (key === 'stone') {
          c.moveTo(-w / 2 + 2, h / 6); c.lineTo(w / 2 - 2, -h / 6);
        }
        c.stroke();
        c.globalAlpha = 1;
        if (b.unknown && !b.weighed) this.text(c, '?', 0, 4, { size: 11, color: col, align: 'center', weight: 700 });
        c.restore();
        if (contents.has(b) && lv.bucket.pos.y < lv.L.DECK) {
          c.strokeStyle = 'rgba(255, 178, 62, 0.55)';
          c.setLineDash([2, 3]);
          this.poly(c, b.shapes[0].wv);
          c.stroke();
          c.setLineDash([]);
        }
      }
    }

    drawGlass(c, st) {
      const lv = st.lv, r = st.rules;
      if (r.glassBroken) return;
      const g = lv.glass, v = g.shapes[0].wv;
      this.poly(c, v);
      c.fillStyle = 'rgba(150, 225, 255, 0.14)'; c.fill();
      c.strokeStyle = '#bff0ff'; c.lineWidth = 1.2; c.stroke();
      c.save(); this.poly(c, v); c.clip();
      c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = 1;
      c.beginPath();
      const [x0, y0] = this.P(new Vec2(g.pos.x - 0.04, g.pos.y + 0.4));
      for (let k = 0; k < 3; k++) { c.moveTo(x0, y0 + k * 9); c.lineTo(x0 + 6, y0 + k * 9 - 6); }
      c.stroke();
      // Cracks from hits below the threshold.
      c.strokeStyle = 'rgba(255,255,255,0.75)';
      for (const k of this.cracks) {
        const rng = Lab.Mathx.makeRng(k.seed);
        const [cx, cy] = this.P(k.p);
        c.beginPath();
        for (let b = 0; b < 5; b++) {
          let x = cx, y = cy;
          c.moveTo(x, y);
          const a = rng() * Math.PI * 2, len = (6 + rng() * 22) * k.s;
          for (let i = 0; i < 4; i++) { x += Math.cos(a + (rng() - 0.5)) * len / 4; y += Math.sin(a + (rng() - 0.5)) * len / 4; c.lineTo(x, y); }
        }
        c.stroke();
      }
      c.restore();
    }

    /* ---------------- particles and screen effects ---------------- */
    burst(p, n, color, speed = 3, kind = 'spark') {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, s = Math.random() * speed;
        this.particles.push({ x: p.x, y: p.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s + speed * 0.3, life: 0.6 + Math.random() * 0.8, kind, color, rot: Math.random() * 6, spin: (Math.random() - 0.5) * 14 });
      }
    }
    crack(p, s) { this.cracks.push({ p: p.clone(), s, seed: (this.cracks.length + 1) * 977 }); }

    drawParticles(c, dt) {
      const keep = [];
      for (const p of this.particles) {
        p.life -= dt;
        if (p.life <= 0) continue;
        p.vy -= 9.8 * dt * (p.kind === 'dust' ? 0.05 : 1);
        p.x += p.vx * dt; p.y += p.vy * dt;
        p.rot = (p.rot || 0) + (p.spin || 0) * dt;
        keep.push(p);
        c.globalAlpha = Math.min(1, p.life * 1.8);
        const [x, y] = this.P(p);
        if (p.kind === 'shard') {
          c.save(); c.translate(x, y); c.rotate(p.rot);
          c.fillStyle = 'rgba(200, 240, 255, 0.85)';
          c.beginPath(); c.moveTo(-4, -2); c.lineTo(4, -3); c.lineTo(0, 4); c.closePath(); c.fill();
          c.restore();
        } else if (p.kind === 'drop') {
          c.fillStyle = 'rgba(140, 222, 255, 0.9)';
          c.fillRect(x - 1, y - 1, 2, 2);
        } else {
          c.fillStyle = p.color || C.amber;
          c.fillRect(x - 1, y - 1, 2.2, 2.2);
        }
      }
      c.globalAlpha = 1;
      this.particles = keep.length > 600 ? keep.slice(-600) : keep;
    }

    drawEffects(c, st, dt) {
      const W = this.W, H = this.H;
      // CRT: scanlines and a vignette.
      c.fillStyle = 'rgba(0, 0, 0, 0.18)';
      for (let y = 0; y < H; y += 3) c.fillRect(0, y, W, 1);
      const v = c.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
      v.addColorStop(0, 'rgba(0,0,0,0)');
      v.addColorStop(1, 'rgba(0,0,0,0.55)');
      c.fillStyle = v;
      c.fillRect(0, 0, W, H);
      if (this.flash > 0) {
        c.fillStyle = `rgba(190, 240, 255, ${this.flash * 0.35})`;
        c.fillRect(0, 0, W, H);
        this.flash = Math.max(0, this.flash - dt * 3);
      }
      // Glitch: a few displaced horizontal slices.
      if (this.glitch > 0 && !this.reduced) {
        const cv = this.canvas, d = this.dpr;
        for (let i = 0; i < 5; i++) {
          const y = Math.random() * H, h = 4 + Math.random() * 18, dx = (Math.random() - 0.5) * 30 * this.glitch;
          c.drawImage(cv, 0, y * d, cv.width, h * d, dx, y, W, h);
        }
        this.glitch = Math.max(0, this.glitch - dt * 2.5);
      }
      if (!this.reduced) {
        c.fillStyle = `rgba(94, 230, 255, ${0.012 + 0.01 * Math.sin(this.time * 50)})`;
        c.fillRect(0, 0, W, H);
      }
      if (st.fade > 0) {
        c.globalAlpha = Math.min(1, st.fade);
        c.fillStyle = C.bg;
        c.fillRect(0, 0, W, H);
        c.globalAlpha = 1;
      }
    }
  }

  Sigma.View = View;
  Sigma.C = C;
  Sigma.FONT = FONT;
})(typeof window !== 'undefined' ? window : globalThis);
