/*
 * Nudge — drawing the world. Pastel and soft-edged; every force worth knowing
 * is written beside the thing it acts on, in newtons.
 *
 * Layers: sky → far decor (the door, field rings, weather) → ropes seen
 * through rock → rock and its surfaces → things and devices → walls →
 * monsters → readouts → particles → the pointer → blows (arrows with N).
 */
(function (root) {
  'use strict';
  const Lab = root.Lab;
  const { Vec2 } = Lab;
  const Nudge = (Lab.Nudge = Lab.Nudge || {});

  const FONT_NUM = '"Fredoka", "Jua", "Gowun Dodum", ui-rounded, system-ui, sans-serif';
  const FONT_KO = '"Gowun Dodum", "Jua", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif';
  const FONT_TITLE = '"Jua", "Gowun Dodum", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif';

  /** Each region tints its sky and rock. */
  const PAL = {
    hub: { skyTop: '#fbf0f7', skyBot: '#e9effc', rock: '#cdc1ea', edge: '#9a8bcf', strata: 'rgba(255, 255, 255, 0.22)', accent: '#f7a8c3', ink: '#5b4d7a' },
    gravity: { skyTop: '#fff4eb', skyBot: '#fbe7f0', rock: '#dbbacb', edge: '#b0849f', strata: 'rgba(255, 240, 246, 0.3)', accent: '#f39fbf', ink: '#6d4660' },
    friction: { skyTop: '#f2f9ff', skyBot: '#eff0fd', rock: '#b9cde8', edge: '#879fcd', strata: 'rgba(255, 255, 255, 0.3)', accent: '#86cdee', ink: '#435983' },
  };
  const C = {
    ink: '#5b4d7a', inkSoft: 'rgba(91, 77, 122, 0.6)', white: '#ffffff',
    ice: '#e4f6fd', iceLine: '#ffffff', sand: '#f3e3c2', sandDot: '#dcc597', smooth: '#ffffff',
    belt: '#9b92c7', beltLine: '#c9c1ee',
    rope: '#8b78aa', pulley: '#ffffff',
    plate: '#ffe08f', plateEdge: '#e5bf58',
    wood: '#efcf9f', woodEdge: '#c99c63', woodGrain: 'rgba(201, 156, 99, 0.55)',
    stone: '#aaa7cb', stoneEdge: '#827fa8', stoneDot: 'rgba(255,255,255,0.45)',
    iron: '#9aa4c5', ironEdge: '#6f7aa0',
    mint: '#a6e3cf', mintEdge: '#6cc2a3',
    coral: '#f6ad9f', coralEdge: '#d4867a',
    lilac: '#cbbff1', lilacEdge: '#9b8bd0',
    rubber: '#ff9fb4', rubberEdge: '#e0718c',
    sack: '#ead5a8', sackEdge: '#c3a46a', stitch: 'rgba(160, 128, 74, 0.7)',
    steel: '#a2afcf', steelEdge: '#6c7aa3',
    feather: '#ffffff', featherEdge: '#d8cfee',
    pointerEdge: '#9f8bcf', pointerTail: '#ffeaf3', pointerShadow: 'rgba(140, 120, 190, 0.45)',
    blow: '#ff5d8f', blowSoft: '#ff9a6b', push: '#7c6cc4', line: '#9b6cc4',
    chip: 'rgba(255, 255, 255, 0.86)', chipEdge: 'rgba(155, 139, 208, 0.55)',
  };
  /** How each kind of loose thing looks, and the name a reader would use. */
  const LOOK = {
    heavy: { fill: C.stone, edge: C.stoneEdge, dots: true, name: '화강암 공' },
    woodball: { fill: C.wood, edge: C.woodEdge, grain: true, name: '나무 공' },
    feather: { fill: C.feather, edge: C.featherEdge, fluff: true, name: '깃털 뭉치' },
    rock: { fill: '#a3abc9', edge: '#7d86a8', dots: true, name: '돌' },
    ram: { fill: C.mint, edge: C.mintEdge, name: '충각' },
    basket: { fill: C.coral, edge: C.coralEdge, name: '바구니' },
    platform: { fill: C.lilac, edge: C.lilacEdge, name: '승강판' },
    counterweight: { fill: C.iron, edge: C.ironEdge, name: '평형추' },
    knob: { fill: C.mint, edge: C.mintEdge, name: '핀' },
    rubber: { fill: C.rubber, edge: C.rubberEdge, name: '고무' },
    sandbag: { fill: C.sack, edge: C.sackEdge, stitch: true, name: '모래주머니' },
    steel: { fill: C.steel, edge: C.steelEdge, rivets: true, name: '강철' },
    column: { fill: 'rgba(203, 191, 241, 0.55)', edge: C.lilacEdge, name: '클러치 기둥' },
    icicle: { fill: '#eefaff', edge: '#a9d4ea', name: '고드름' },
    blade: { fill: '#c5cde4', edge: '#7f8bb0', name: '칼날 진자' },
    shard: { fill: '#f7a8c3', edge: '#e17fa4' },
  };
  /** Names for what struck the pointer. */
  const SOURCE = {
    blade: '칼날 진자', rock: '떨어진 돌', icicle: '고드름', skater: '스케이터', dropper: '드로퍼',
    orb: '중력 구', crush: '압착', heavy: '화강암 공', woodball: '나무 공', sandbag: '모래주머니',
    steel: '강철', rubber: '고무', ram: '충각', basket: '바구니', platform: '승강판', counterweight: '평형추',
    impact: '충격', shard: '파편', column: '클러치 기둥',
  };
  // A classic arrow cursor, 12 × 20 units, tip at the origin.
  const CURSOR = [[0, 0], [0, 17], [4, 13], [7, 20], [10, 19], [7, 12.5], [12, 12.5]];

  const lerp = (a, b, t) => a + (b - a) * t;
  function mix(h1, h2, t) {
    const a = parseInt(h1.slice(1), 16), b = parseInt(h2.slice(1), 16);
    const ch = (s) => Math.round(lerp((a >> s) & 255, (b >> s) & 255, t));
    return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
  }

  class View {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.time = 0;
      this.cam = new Vec2(0, 4);
      this.scale = 60;
      this.particles = [];
      this.trail = [];
      this.blows = [];
      this.notes = [];          // short-lived readouts in the world (Δt on the plates …)
      this.flyers = [];         // fragments flying into the door
      this.jelly = { e: 0, v: 0, ang: 0 };
      this.flakes = Array.from({ length: 70 }, (_, i) => ({ x: (i * 7.31) % 1, y: (i * 3.77) % 1, s: 0.5 + ((i * 1.7) % 1) }));
      this.calm = !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
    }

    resize() {
      const dpr = Math.min(root.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
      const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
      if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
      this.dpr = dpr;
      this.W = this.canvas.clientWidth;
      this.H = this.canvas.clientHeight;
      // About 11 m of height on screen, never so few pixels a pointer vanishes.
      this.scale = Math.max(36, Math.min(96, Math.min(this.H / 11, this.W / 15)));
    }
    X(x) { return this.W / 2 + (x - this.cam.x) * this.scale; }
    Y(y) { return this.H / 2 - (y - this.cam.y) * this.scale; }
    toWorld(sx, sy) { return new Vec2(this.cam.x + (sx - this.W / 2) / this.scale, this.cam.y - (sy - this.H / 2) / this.scale); }
    /** World box on screen, with a margin. */
    get box() {
      const hw = this.W / 2 / this.scale + 1, hh = this.H / 2 / this.scale + 1;
      return [this.cam.x - hw, this.cam.y - hh, this.cam.x + hw, this.cam.y + hh];
    }
    seen(b) {
      const v = this.box, a = b.aabb;
      return !(a.maxX < v[0] || a.minX > v[2] || a.maxY < v[1] || a.minY > v[3]);
    }

    /* ---------------- camera ---------------- */
    /** Keep the pointer inside a calm middle box; ease toward it. */
    follow(at, dt, snap) {
      // The ground is usually below: keep more of the view above the pointer.
      const p = at.add(new Vec2(0, 1.4));
      const dzx = (this.W * 0.2) / this.scale, dzy = (this.H * 0.16) / this.scale;
      const want = this.cam.clone();
      if (p.x > want.x + dzx) want.x = p.x - dzx;
      if (p.x < want.x - dzx) want.x = p.x + dzx;
      if (p.y > want.y + dzy) want.y = p.y - dzy;
      if (p.y < want.y - dzy) want.y = p.y + dzy;
      const k = snap ? 1 : 1 - Math.exp(-dt / 0.16);
      this.cam = this.cam.add(want.sub(this.cam).scale(k));
      // Never wander far past the edge of the world.
      const hw = this.W / 2 / this.scale, hh = this.H / 2 / this.scale, B = this.world;
      if (B) {
        this.cam.x = B[2] - B[0] < 2 * hw ? (B[0] + B[2]) / 2 : Math.max(B[0] + hw, Math.min(B[2] - hw, this.cam.x));
        this.cam.y = B[3] - B[1] < 2 * hh ? (B[1] + B[3]) / 2 : Math.max(B[1] + hh, Math.min(B[3] - hh, this.cam.y));
      }
    }

    /* ---------------- static geometry ---------------- */
    /** Rock and its open-air outline, worked out once per build. */
    prepare(game) {
      this.game = game;
      const rocks = game.world.bodies.filter((b) => b.isStatic && b.shapes[0].mask !== 0 && b.shapes[0].type === 'polygon' &&
        !['gate', 'wall', 'plank', 'plate', 'belt'].includes(b.role));
      this.rocks = rocks;
      const B = [Infinity, Infinity, -Infinity, -Infinity];
      for (const R of game.regions) {
        const b = R.bounds;
        if (!b) continue;
        B[0] = Math.min(B[0], b[0]); B[1] = Math.min(B[1], b[1]); B[2] = Math.max(B[2], b[2]); B[3] = Math.max(B[3], b[3]);
      }
      this.world = B;
      const inside = (p) => game.regions.some((R) => R.bounds && p.x > R.bounds[0] && p.x < R.bounds[2] && p.y > R.bounds[1] && p.y < R.bounds[3]);
      const solidAt = (p, self) => !inside(p) || rocks.some((o) => {
        if (o === self) return false;
        const a = o.aabb;
        return p.x >= a.minX && p.x <= a.maxX && p.y >= a.minY && p.y <= a.maxY && o.containsPoint(p);
      });
      this.edges = [];
      for (const b of rocks) {
        const s = b.shapes[0];
        for (let i = 0; i < s.wv.length; i++) {
          const a = s.wv[i], c = s.wv[(i + 1) % s.wv.length], n = s.wn[i];
          const len = a.dist(c), steps = Math.max(1, Math.ceil(len / 0.05));
          let run = null;
          for (let k = 0; k < steps; k++) {
            const t0 = k / steps, t1 = (k + 1) / steps;
            const open = !solidAt(Vec2.lerp(a, c, (t0 + t1) / 2).addScaled(n, 0.01), b);
            if (open && run === null) run = t0;
            if ((!open || k === steps - 1) && run !== null) {
              const end = open ? t1 : t0;
              if (end > run) this.edges.push({ a: Vec2.lerp(a, c, run), b: Vec2.lerp(a, c, end), n: n.clone(), kind: b.surface, region: b.regionId });
              run = null;
            }
          }
        }
      }
    }

    pal(id) { return PAL[id] || PAL.hub; }
    /** The palette where the camera is, blended across region borders. */
    hereTint() {
      const g = this.game, c = this.cam;
      const R = g.regionAt(c) || g.byId.hub;
      return this.pal(R.palette || R.id);
    }

    /* ---------------- drawing helpers ---------------- */
    roundedPx(c, P, rp) {
      const n = P.length;
      c.beginPath();
      for (let i = 0; i < n; i++) {
        const a = P[(i + n - 1) % n], b = P[i], d = P[(i + 1) % n];
        if (i === 0) c.moveTo((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
        c.arcTo(b[0], b[1], d[0], d[1], Math.max(0, Math.min(rp, Math.hypot(b[0] - a[0], b[1] - a[1]) / 2, Math.hypot(d[0] - b[0], d[1] - b[1]) / 2)));
      }
      c.closePath();
    }
    rounded(c, verts, r) { this.roundedPx(c, verts.map((v) => [this.X(v.x), this.Y(v.y)]), r * this.scale); }
    poly(c, verts) {
      c.beginPath();
      verts.forEach((v, i) => (i ? c.lineTo(this.X(v.x), this.Y(v.y)) : c.moveTo(this.X(v.x), this.Y(v.y))));
      c.closePath();
    }
    /** Fill a body's shapes, soft-cornered. */
    body(c, b, fill, edge, r = 0.04, squish = 0) {
      for (const s of b.shapes) {
        if (s.sensor) continue;
        if (s.type === 'circle') {
          c.beginPath();
          c.arc(this.X(s.wc.x), this.Y(s.wc.y), s.radius * this.scale * (1 + squish), 0, Math.PI * 2);
        } else {
          let v = s.wv;
          if (squish) v = v.map((p) => b.pos.add(p.sub(b.pos).scale(1 + squish)));
          this.rounded(c, v, r);
        }
        c.fillStyle = fill;
        c.fill();
        c.strokeStyle = edge;
        c.lineWidth = 1.4;
        c.stroke();
      }
    }
    /** A small rounded readout, centred on a screen point. */
    chip(c, sx, sy, text, opts = {}) {
      c.font = `${opts.weight || 600} ${opts.size || 12}px ${FONT_NUM}`;
      const w = c.measureText(text).width + 12, h = (opts.size || 12) + 8;
      const x = sx - w / 2, y = sy - h / 2;
      this.roundedPx(c, [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], h / 2);
      c.fillStyle = opts.bg || C.chip;
      c.fill();
      c.strokeStyle = opts.edge || C.chipEdge;
      c.lineWidth = 1;
      c.stroke();
      c.fillStyle = opts.color || C.ink;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(text, sx, sy + 0.5);
      return { w, h };
    }
    /** Chip anchored in the world. */
    note(c, p, text, opts) { return this.chip(c, this.X(p.x), this.Y(p.y), text, opts); }
    arrow(c, from, to, color, width = 2.4, head = 9) {
      const ax = this.X(from.x), ay = this.Y(from.y), bx = this.X(to.x), by = this.Y(to.y);
      const ang = Math.atan2(by - ay, bx - ax), len = Math.hypot(bx - ax, by - ay);
      if (len < 2) return;
      c.strokeStyle = color;
      c.fillStyle = color;
      c.lineWidth = width;
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(ax, ay);
      c.lineTo(bx - Math.cos(ang) * head * 0.7, by - Math.sin(ang) * head * 0.7);
      c.stroke();
      c.beginPath();
      c.moveTo(bx, by);
      c.lineTo(bx - Math.cos(ang - 0.42) * head, by - Math.sin(ang - 0.42) * head);
      c.lineTo(bx - Math.cos(ang + 0.42) * head, by - Math.sin(ang + 0.42) * head);
      c.closePath();
      c.fill();
    }

    /* ---------------- frame ---------------- */
    draw(app, dt) {
      const c = this.ctx;
      this.time += dt;
      this.dt = dt;
      c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      c.globalAlpha = 1;
      this.drawSky(c);
      this.drawDoor(c);
      this.drawFields(c);
      this.drawWeather(c, dt);
      this.drawRopes(c, 'under');
      this.drawRock(c);
      this.drawStaticDevices(c);
      this.drawRopes(c, 'over');
      this.drawThings(c);
      this.drawWalls(c);
      this.drawMonsters(c);
      this.drawReadouts(c);
      this.drawFragments(c);
      this.drawParticles(c, dt);
      this.drawPointer(c, app, dt);
      this.drawBlows(c, dt);
      this.drawNotes(c, dt);
    }

    drawSky(c) {
      const here = this.hereTint();
      c.fillStyle = here.rock;
      c.fillRect(0, 0, this.W, this.H);
      this.strata(c, here);
      for (const R of this.game.regions) {
        const b = R.bounds;
        if (!b) continue;
        const P = this.pal(R.palette || R.id);
        const x0 = this.X(b[0]), x1 = this.X(b[2]), y0 = this.Y(b[3]), y1 = this.Y(b[1]);
        if (x1 < 0 || x0 > this.W || y1 < 0 || y0 > this.H) continue;
        const gr = c.createLinearGradient(0, this.Y(b[3]), 0, this.Y(b[1]));
        gr.addColorStop(0, P.skyTop);
        gr.addColorStop(1, P.skyBot);
        c.fillStyle = gr;
        c.fillRect(x0, y0, x1 - x0, y1 - y0);
      }
    }

    /** The Primordial Door: six sockets around a sealed disc. */
    drawDoor(c) {
      const hub = this.game.byId.hub;
      if (!hub || !hub.door) return;
      const d = hub.door, cx = this.X(d.c.x), cy = this.Y(d.c.y), R = d.r * this.scale, t = this.time;
      if (cx + R < -50 || cx - R > this.W + 50) return;
      const save = this.game.save;
      const n = Object.keys(save.delivered).filter((k) => save.delivered[k]).length;
      // Halo grows with each fragment set in place.
      const halo = c.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * (1.5 + 0.08 * n));
      halo.addColorStop(0, `rgba(255, 255, 255, ${0.5 + 0.06 * n})`);
      halo.addColorStop(0.6, 'rgba(255, 228, 242, 0.35)');
      halo.addColorStop(1, 'rgba(220, 230, 255, 0)');
      c.fillStyle = halo;
      c.beginPath();
      c.arc(cx, cy, R * 1.6, 0, Math.PI * 2);
      c.fill();
      // Stone rings.
      const rings = [[1, '#e9e1f8', '#b9acdf'], [0.78, '#f3eefc', '#c8bde8'], [0.52, '#fbf8ff', '#d6ccef']];
      for (const [k, f, e] of rings) {
        c.beginPath();
        c.arc(cx, cy, R * k, 0, Math.PI * 2);
        c.fillStyle = f;
        c.fill();
        c.strokeStyle = e;
        c.lineWidth = 2;
        c.stroke();
      }
      // A slow inner spiral, the seal.
      c.strokeStyle = 'rgba(185, 172, 223, 0.6)';
      c.lineWidth = 1.5;
      c.beginPath();
      for (let a = 0; a < Math.PI * 6; a += 0.08) {
        const r = R * 0.06 + (a / (Math.PI * 6)) * R * 0.44;
        const x = cx + Math.cos(a + t * 0.15) * r, y = cy + Math.sin(a + t * 0.15) * r;
        if (a === 0) c.moveTo(x, y); else c.lineTo(x, y);
      }
      c.stroke();
      // Sockets.
      const F = Nudge.FRAGMENTS;
      F.forEach((f, i) => {
        const a = -Math.PI / 2 + (i / F.length) * Math.PI * 2;
        const sx = cx + Math.cos(a) * R * 0.9, sy = cy + Math.sin(a) * R * 0.9, sr = Math.max(10, R * 0.13);
        const set = !!save.delivered[f.id];
        c.beginPath();
        c.arc(sx, sy, sr, 0, Math.PI * 2);
        c.fillStyle = set ? '#ffffff' : '#ece5f7';
        if (set) { c.shadowColor = 'rgba(247, 168, 195, 0.95)'; c.shadowBlur = 16 + 4 * Math.sin(t * 2 + i); }
        c.fill();
        c.shadowBlur = 0;
        c.strokeStyle = set ? PAL.hub.accent : '#c5b9e3';
        c.lineWidth = 2;
        c.stroke();
        c.font = `700 ${Math.round(sr * 1.05)}px ${FONT_NUM}`;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillStyle = set ? '#e17fa4' : 'rgba(155, 139, 208, 0.45)';
        c.fillText(f.glyph, sx, sy + 1);
        if (this.scale > 50) {
          c.font = `500 ${Math.round(Math.max(10, sr * 0.62))}px ${FONT_KO}`;
          c.fillStyle = set ? '#c0698c' : 'rgba(120, 104, 170, 0.6)';
          c.fillText(f.name, sx, sy + sr + 11);
        }
      });
      c.font = `400 ${Math.round(Math.max(14, R * 0.12))}px ${FONT_TITLE}`;
      c.fillStyle = 'rgba(120, 104, 170, 0.75)';
      c.textAlign = 'center';
      c.fillText('태초의 문', cx, cy + 4);
      // Sealed passages and the open ones.
      for (const s of hub.seals || []) {
        const x = this.X(s.x), y = this.Y(s.y);
        c.fillStyle = '#efe8fb';
        c.strokeStyle = '#b9acdf';
        c.lineWidth = 2;
        c.beginPath();
        c.ellipse(x, y, 0.7 * this.scale, 0.16 * this.scale, 0, 0, Math.PI * 2);
        c.fill();
        c.stroke();
        c.font = `500 12px ${FONT_KO}`;
        c.fillStyle = 'rgba(120, 104, 170, 0.8)';
        c.textAlign = 'center';
        c.fillText(`${s.name} · 봉인`, x, s.side === 'floor' ? y - 0.32 * this.scale : y + 0.4 * this.scale);
      }
      for (const e of hub.exits || []) {
        const x = this.X(e.x - e.dir * 1.6), y = this.Y(2.4);
        c.font = `400 15px ${FONT_TITLE}`;
        c.fillStyle = 'rgba(110, 94, 160, 0.85)';
        c.textAlign = 'center';
        c.fillText(e.dir < 0 ? `← ${e.name}` : `${e.name} →`, x, y);
        const done = save.delivered[e.id];
        if (done) {
          c.font = `600 11px ${FONT_NUM}`;
          c.fillStyle = '#e17fa4';
          c.fillText('조각 회수함', x, y + 16);
        }
      }
    }

    /** Gravity wells: soft rings with inward arrows sized by a = K/r². */
    drawFields(c) {
      for (const R of this.game.regions) {
        for (const d of R.devices) {
          if (!(d instanceof Nudge.Orb)) continue;
          const o = d, cx = this.X(o.c.x), cy = this.Y(o.c.y), t = this.time;
          if (cx < -400 || cx > this.W + 400) continue;
          const rg = c.createRadialGradient(cx, cy, 0, cx, cy, o.range * this.scale);
          rg.addColorStop(0, 'rgba(150, 120, 220, 0.28)');
          rg.addColorStop(0.35, 'rgba(170, 150, 230, 0.12)');
          rg.addColorStop(1, 'rgba(190, 170, 240, 0)');
          c.fillStyle = rg;
          c.beginPath();
          c.arc(cx, cy, o.range * this.scale, 0, Math.PI * 2);
          c.fill();
          for (const r of [1.2, 2.2, 3.4]) {
            const a = Math.min(o.cap, o.K / (r * r));
            for (let k = 0; k < 8; k++) {
              const ang = (k / 8) * Math.PI * 2 + t * 0.25 + r;
              const p = o.c.add(Vec2.fromAngle(ang, r));
              const q = o.c.add(Vec2.fromAngle(ang, r - Math.min(0.6, a * 0.06)));
              this.arrow(c, p, q, 'rgba(124, 108, 196, 0.35)', 1.4, 6);
            }
          }
        }
      }
    }

    drawWeather(c, dt) {
      const here = this.game.regionAt(this.cam);
      const id = here ? here.id : 'hub';
      const hw = this.W / this.scale, hh = this.H / this.scale;
      c.fillStyle = id === 'friction' ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.6)';
      const pace = this.calm ? 0.3 : 1;
      dt *= pace;
      for (const f of this.flakes) {
        if (id === 'friction') { f.y -= dt * 0.035 * f.s; f.x += dt * 0.01 * Math.sin(this.time + f.s * 7); } else { f.y += dt * 0.012 * f.s; }
        f.x = ((f.x % 1) + 1) % 1;
        f.y = ((f.y % 1) + 1) % 1;
        const wx = this.cam.x - hw / 2 + ((f.x * hw - this.cam.x * 0.3) % hw + hw) % hw;
        const wy = this.cam.y - hh / 2 + f.y * hh;
        c.beginPath();
        c.arc(this.X(wx), this.Y(wy), (id === 'friction' ? 2.2 : 1.5) * f.s, 0, Math.PI * 2);
        c.fill();
      }
    }

    /** Ropes: dashed where they run through rock, solid in the open. */
    drawRopes(c, pass) {
      for (const R of this.game.regions) {
        for (const j of R.joints) {
          if (!(j instanceof Lab.Joints.RopePath) || !j.segments) continue;
          const T = j.tension || 0;
          c.strokeStyle = C.rope;
          c.lineCap = 'round';
          if (pass === 'under') {
            c.lineWidth = 1.2;
            c.globalAlpha = 0.5;
            c.setLineDash([4, 5]);
          } else {
            c.lineWidth = 1.4 + Math.min(3, T / 220);
            c.globalAlpha = 0.95;
            c.setLineDash([]);
            if (T > 300) { c.shadowColor = 'rgba(160, 120, 220, 0.45)'; c.shadowBlur = Math.min(12, (T - 300) / 40); }
          }
          // In the open the rope is solid; through rock it shows only as the dashed pass.
          if (pass === 'over') { c.save(); this.clipOpen(c); }
          c.beginPath();
          for (const s of j.segments) { c.moveTo(this.X(s.a.x), this.Y(s.a.y)); c.lineTo(this.X(s.b.x), this.Y(s.b.y)); }
          for (const n of j.nodes) {
            if (!n.radius || !(n.sweep > 0.01)) continue;
            const a0 = n.radius > 0 ? n.aOut : n.aIn, r = Math.abs(n.radius);
            c.moveTo(this.X(n.world.x + r * Math.cos(a0)), this.Y(n.world.y + r * Math.sin(a0)));
            c.arc(this.X(n.world.x), this.Y(n.world.y), r * this.scale, -a0, -(a0 + n.sweep), true);
          }
          c.stroke();
          if (pass === 'over') c.restore();
          c.setLineDash([]);
          c.shadowBlur = 0;
          c.globalAlpha = 1;
          if (pass === 'over') {
            for (const n of j.nodes) {
              if (!n.radius) continue;
              const r = Math.max(3, Math.abs(n.radius) * this.scale);
              c.fillStyle = C.pulley;
              c.strokeStyle = C.rope;
              c.lineWidth = 1.3;
              c.beginPath();
              c.arc(this.X(n.world.x), this.Y(n.world.y), r, 0, Math.PI * 2);
              c.fill();
              c.stroke();
            }
          }
        }
      }
    }
    /** Clip to everything that is not rock (even-odd against the rock path). */
    clipOpen(c) {
      c.beginPath();
      c.rect(0, 0, this.W, this.H);
      for (const b of this.rocks) {
        if (!this.seen(b)) continue;
        const v = b.shapes[0].wv;
        // Reverse winding so the rock is cut out under nonzero.
        for (let i = v.length - 1; i >= 0; i--) (i === v.length - 1 ? c.moveTo(this.X(v[i].x), this.Y(v[i].y)) : c.lineTo(this.X(v[i].x), this.Y(v[i].y)));
        c.closePath();
      }
      c.clip('evenodd');
    }

    /** Faint strata, fixed to the world so they slide past as the view moves. */
    strata(c, P) {
      c.strokeStyle = P.strata;
      c.lineWidth = 1;
      c.beginPath();
      const v = this.box, step = 0.55, k = 0.18;   // lines y = c − k·x, c on a fixed 0.55 m grid
      for (let c0 = Math.floor((v[1] + k * v[0]) / step) * step; c0 < v[3] + k * v[2]; c0 += step) {
        c.moveTo(this.X(v[0]), this.Y(c0 - k * v[0]));
        c.lineTo(this.X(v[2]), this.Y(c0 - k * v[2]));
      }
      c.stroke();
    }

    drawRock(c) {
      // Each region's rock in one path, so neighbouring blocks fill as one mass.
      const byRegion = {};
      for (const b of this.rocks) {
        if (!this.seen(b)) continue;
        (byRegion[b.regionId] = byRegion[b.regionId] || []).push(b);
      }
      for (const id of Object.keys(byRegion)) {
        const P = this.pal(this.game.byId[id] ? this.game.byId[id].palette || id : 'hub');
        c.beginPath();
        for (const b of byRegion[id]) {
          b.shapes[0].wv.forEach((v, i) => (i ? c.lineTo(this.X(v.x), this.Y(v.y)) : c.moveTo(this.X(v.x), this.Y(v.y))));
          c.closePath();
        }
        c.fillStyle = P.rock;
        c.fill();
        c.save();
        c.clip();
        this.strata(c, P);
        c.restore();
        // Surfaces with a material of their own.
        for (const b of byRegion[id]) {
          const kind = b.surface;
          if (kind !== 'ice' && kind !== 'sand') continue;
          this.poly(c, b.shapes[0].wv);
          c.fillStyle = kind === 'ice' ? C.ice : C.sand;
          c.fill();
        }
      }
      c.lineCap = 'round';
      const v = this.box;
      for (const e of this.edges) {
        if (Math.max(e.a.x, e.b.x) < v[0] || Math.min(e.a.x, e.b.x) > v[2] || Math.max(e.a.y, e.b.y) < v[1] || Math.min(e.a.y, e.b.y) > v[3]) continue;
        const P = this.pal(this.game.byId[e.region] ? this.game.byId[e.region].palette || e.region : 'hub');
        c.strokeStyle = e.kind === 'ice' ? '#a9d4ea' : e.kind === 'sand' ? '#d6bd88' : P.edge;
        c.lineWidth = 1.6;
        c.beginPath();
        c.moveTo(this.X(e.a.x), this.Y(e.a.y));
        c.lineTo(this.X(e.b.x), this.Y(e.b.y));
        c.stroke();
        if (e.n.y < 0.5) continue;
        const L = e.a.dist(e.b);
        if (e.kind === 'ice') {
          c.strokeStyle = C.iceLine;
          c.lineWidth = 2;
          c.beginPath();
          for (let s = 0.2; s < L - 0.2; s += 1.3) {
            const p = Vec2.lerp(e.a, e.b, s / L), q = Vec2.lerp(e.a, e.b, Math.min(1, (s + 0.6) / L));
            c.moveTo(this.X(p.x), this.Y(p.y) + 3);
            c.lineTo(this.X(q.x), this.Y(q.y) + 3);
          }
          c.stroke();
        } else if (e.kind === 'sand') {
          c.fillStyle = C.sandDot;
          for (let s = 0.04; s < L; s += 0.09) {
            const p = Vec2.lerp(e.a, e.b, s / L);
            c.beginPath();
            c.arc(this.X(p.x), this.Y(p.y) + 3 + ((s * 53) % 4), 1.4 + ((s * 37) % 1.2), 0, Math.PI * 2);
            c.fill();
          }
        } else if (e.kind === 'smooth') {
          c.strokeStyle = 'rgba(255,255,255,0.7)';
          c.lineWidth = 1.2;
          c.beginPath();
          c.moveTo(this.X(e.a.x), this.Y(e.a.y) + 2.5);
          c.lineTo(this.X(e.b.x), this.Y(e.b.y) + 2.5);
          c.stroke();
        }
      }
    }

    /** Fixed devices: plates, the belt, the plank, gates, checkpoints. */
    drawStaticDevices(c) {
      const g = this.game, t = this.time;
      for (const R of g.regions) {
        for (const b of R.bodies) {
          if (!b.world || !b.isStatic || !this.seen(b)) continue;
          if (b.role === 'plate') {
            const plate = R.devices.find((d) => d.body === b);
            const flash = plate ? Math.max(0, 1 - (g.time - plate.lastHit) / 0.6) : 0;
            this.body(c, b, flash > 0 ? mix(C.plate, '#ffffff', flash) : C.plate, C.plateEdge, 0.02);
          } else if (b.role === 'belt') {
            this.body(c, b, C.belt, '#7d73ad', 0.02);
            const s = b.shapes[0].wv, top = Math.max(...s.map((v) => v.y)), x0 = Math.min(...s.map((v) => v.x)), x1 = Math.max(...s.map((v) => v.x));
            const sp = (b.shapes[0].surfaceSpeed || b.surfaceSpeed || 0);
            const dir = sp < 0 ? 1 : -1;
            c.strokeStyle = C.beltLine;
            c.lineWidth = 2;
            c.save();
            this.poly(c, s);
            c.clip();
            c.beginPath();
            for (let x = x0 - 0.3 + ((t * Math.abs(sp) * dir) % 0.3 + 0.3) % 0.3; x < x1 + 0.3; x += 0.3) {
              c.moveTo(this.X(x - 0.06 * dir), this.Y(top - 0.12));
              c.lineTo(this.X(x + 0.06 * dir), this.Y(top - 0.3));
              c.lineTo(this.X(x - 0.06 * dir), this.Y(top - 0.48));
            }
            c.stroke();
            c.restore();
          } else if (b.role === 'plank') {
            this.body(c, b, C.wood, C.woodEdge, 0.02);
          } else if (b.role === 'gate') {
            this.body(c, b, '#c9bdf0', '#9b8bd0', 0.02);
          } else if (b.role === 'orb') {
            const s = b.shapes[0], x = this.X(s.wc.x), y = this.Y(s.wc.y), r = s.radius * this.scale;
            const gr = c.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
            gr.addColorStop(0, '#d9ccff');
            gr.addColorStop(1, '#6f5cc0');
            c.fillStyle = gr;
            c.beginPath();
            c.arc(x, y, r, 0, Math.PI * 2);
            c.fill();
            c.strokeStyle = 'rgba(255,255,255,0.75)';
            c.lineWidth = 1.5;
            c.beginPath();
            c.arc(x, y, r * 1.35, t * 2, t * 2 + 1.6);
            c.stroke();
          }
        }
        // Checkpoints: little lanterns, lit when they hold the last save.
        for (const cp of R.checkpoints) {
          const x = this.X(cp.pos.x), y = this.Y(cp.pos.y);
          if (x < -40 || x > this.W + 40 || y < -40 || y > this.H + 40) continue;
          const lit = g.save.checkpoint === cp.id;
          c.strokeStyle = lit ? '#e8a6c4' : 'rgba(155, 139, 208, 0.45)';
          c.lineWidth = 1.5;
          c.beginPath();
          c.arc(x, y, 9, 0, Math.PI * 2);
          c.stroke();
          if (lit) {
            c.fillStyle = `rgba(255, 214, 232, ${0.55 + 0.25 * Math.sin(t * 3)})`;
            c.beginPath();
            c.arc(x, y, 6, 0, Math.PI * 2);
            c.fill();
          }
        }
      }
    }

    /** Loose things, by what they are. */
    drawThings(c) {
      const g = this.game;
      for (const R of g.regions) {
        for (const d of R.devices) {
          if (d instanceof Nudge.Pin) this.drawPin(c, d);
          if (d instanceof Nudge.Pendulum) this.drawBlade(c, d);
        }
        if (R.icicles) this.drawHangingIcicles(c, R.icicles);
      }
      for (const b of g.world.bodies) {
        if (!b.rail || !b.world) continue;
        c.strokeStyle = 'rgba(155, 139, 208, 0.45)';
        c.lineWidth = 3;
        c.setLineDash([6, 6]);
        c.beginPath();
        c.moveTo(this.X(b.rail[0].x), this.Y(b.rail[0].y));
        c.lineTo(this.X(b.rail[1].x), this.Y(b.rail[1].y));
        c.stroke();
        c.setLineDash([]);
      }
      for (const b of g.world.bodies) {
        if (!b.isDynamic || b.isKnob || b === g.pointer.body || b.role === 'monster' || b.role === 'blade' || !this.seen(b)) continue;
        const L = LOOK[b.role] || { fill: '#d9d1ef', edge: '#a89cd2' };
        const fill = b.role === 'shard' && b.color ? b.color : L.fill;
        let squish = 0;
        if (b.role === 'shard') {
          const left = b.life - (g.time - b.born);
          squish = left < 0.4 ? -0.85 * (1 - left / 0.4) : 0;
        }
        this.body(c, b, fill, b.role === 'shard' ? 'rgba(225, 127, 164, 0.8)' : L.edge, b.role === 'sandbag' ? 0.07 : 0.035, squish);
        if (L.dots) this.speckle(c, b);
        if (L.grain) this.grain(c, b);
        if (L.stitch) this.stitch(c, b);
        if (L.rivets) this.rivets(c, b);
        if (L.fluff) this.fluff(c, b);
        // Mass, written on anything you might push.
        if (b.grab && b.role !== 'platform' && this.scale > 45) {
          const m = b.mass;
          c.font = `600 ${Math.max(9, Math.min(12, this.scale * 0.13))}px ${FONT_NUM}`;
          c.textAlign = 'center';
          c.textBaseline = 'middle';
          c.fillStyle = 'rgba(91, 77, 122, 0.78)';
          const lab = m >= 1 ? `${+m.toFixed(1)} kg` : `${Math.round(m * 1000)} g`;
          const r = b.radius || (b.size ? Math.min(b.size[0], b.size[1]) / 2 : 0.1);
          if (r * this.scale > 16) c.fillText(lab, this.X(b.pos.x), this.Y(b.pos.y));
          else c.fillText(lab, this.X(b.pos.x), this.Y(b.pos.y) - r * this.scale - 9);
        }
      }
    }
    speckle(c, b) {
      c.fillStyle = C.stoneDot;
      for (const d of [[-0.35, 0.2], [0.25, 0.35], [0.1, -0.3], [-0.2, -0.25]]) {
        const r = b.radius || 0.1;
        const p = b.worldPoint(b.localPoint(b.pos).add(new Vec2(d[0] * r, d[1] * r)));
        c.beginPath();
        c.arc(this.X(p.x), this.Y(p.y), Math.max(1, r * this.scale * 0.12), 0, Math.PI * 2);
        c.fill();
      }
    }
    grain(c, b) {
      const r = (b.radius || 0.1) * this.scale;
      c.strokeStyle = C.woodGrain;
      c.lineWidth = 1;
      c.beginPath();
      c.arc(this.X(b.pos.x), this.Y(b.pos.y), r * 0.55, -b.angle, -b.angle + 4);
      c.stroke();
    }
    stitch(c, b) {
      const s = b.shapes[0];
      if (s.type !== 'polygon') return;
      const top = s.wv.slice().sort((p, q) => q.y - p.y);
      const a = top[0], d = top[1], mid = Vec2.lerp(a, d, 0.5), down = b.pos.sub(mid).norm();
      const p1 = Vec2.lerp(a, d, 0.2).addScaled(down, 0.05), p2 = Vec2.lerp(a, d, 0.8).addScaled(down, 0.05);
      c.strokeStyle = C.stitch;
      c.lineWidth = 1.2;
      c.setLineDash([3, 3]);
      c.beginPath();
      c.moveTo(this.X(p1.x), this.Y(p1.y));
      c.lineTo(this.X(p2.x), this.Y(p2.y));
      c.stroke();
      c.setLineDash([]);
    }
    rivets(c, b) {
      const s = b.shapes[0];
      if (s.type !== 'polygon') return;
      c.fillStyle = 'rgba(255,255,255,0.65)';
      for (const v of s.wv) {
        const p = Vec2.lerp(v, b.pos, 0.22);
        c.beginPath();
        c.arc(this.X(p.x), this.Y(p.y), 1.6, 0, Math.PI * 2);
        c.fill();
      }
    }
    fluff(c, b) {
      const r = (b.radius || 0.1) * this.scale;
      c.fillStyle = '#ffffff';
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + b.angle;
        c.beginPath();
        c.arc(this.X(b.pos.x) + Math.cos(a) * r * 0.9, this.Y(b.pos.y) + Math.sin(a) * r * 0.9, r * 0.45, 0, Math.PI * 2);
        c.fill();
      }
    }

    drawPin(c, pin) {
      const k = pin.body;
      if (!this.seen(k)) return;
      // Its groove, and how far it must travel to trip.
      const a = pin.origin, b = pin.origin.addScaled(pin.dir, pin.release);
      c.strokeStyle = pin.tripped ? 'rgba(108, 194, 163, 0.35)' : 'rgba(108, 194, 163, 0.6)';
      c.lineWidth = 5;
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(this.X(a.x), this.Y(a.y));
      c.lineTo(this.X(b.x), this.Y(b.y));
      c.stroke();
      const near = this.game.pointer.pos.dist(k.pos) < 1.5;
      if (near && !pin.tripped) {
        c.fillStyle = `rgba(166, 227, 207, ${0.25 + 0.15 * Math.sin(this.time * 3)})`;
        c.beginPath();
        c.arc(this.X(k.pos.x), this.Y(k.pos.y), 0.36 * this.scale, 0, Math.PI * 2);
        c.fill();
      }
      this.body(c, k, C.mint, C.mintEdge, 0.03);
      if (near && !pin.tripped) this.note(c, k.pos.add(new Vec2(0, 0.42)), '잡고 당기기', { size: 11 });
    }

    drawBlade(c, d) {
      const b = d.body;
      if (!this.seen(b)) return;
      // A faint arc of its swing.
      c.strokeStyle = 'rgba(127, 139, 176, 0.18)';
      c.lineWidth = 6;
      c.beginPath();
      c.arc(this.X(d.pivot.x), this.Y(d.pivot.y), d.len * this.scale, Math.PI / 2 - d.amp, Math.PI / 2 + d.amp);
      c.stroke();
      this.body(c, b, LOOK.blade.fill, LOOK.blade.edge, 0.06);
      c.fillStyle = '#ffffff';
      c.strokeStyle = LOOK.blade.edge;
      c.lineWidth = 1.5;
      c.beginPath();
      c.arc(this.X(d.pivot.x), this.Y(d.pivot.y), 5, 0, Math.PI * 2);
      c.fill();
      c.stroke();
    }

    drawHangingIcicles(c, ic) {
      for (const s of ic.slots) {
        const x = this.X(s.x), y = this.Y(s.y);
        if (x < -30 || x > this.W + 30) continue;
        if (s.body) continue;
        // It regrows after falling, and shivers more the closer it is to letting go.
        const grow = Math.min(1, (ic.period - ic.timeToDrop(s)) / 0.9);
        const wob = s.shiver > 0 ? Math.sin(this.time * 40) * 2.2 * s.shiver : 0;
        const L = 0.6 * grow * this.scale, w = 0.12 * this.scale;
        c.fillStyle = LOOK.icicle.fill;
        c.strokeStyle = s.shiver > 0.6 ? '#7fb7d8' : LOOK.icicle.edge;
        c.lineWidth = 1.3;
        c.beginPath();
        c.moveTo(x - w, y);
        c.lineTo(x + w, y);
        c.lineTo(x + wob, y + L);
        c.closePath();
        c.fill();
        c.stroke();
        if (s.shiver > 0.5) {
          c.strokeStyle = `rgba(127, 183, 216, ${(s.shiver - 0.5) * 0.9})`;
          c.setLineDash([3, 5]);
          c.beginPath();
          c.moveTo(x, y + L + 4);
          c.lineTo(x, this.Y(0.2));
          c.stroke();
          c.setLineDash([]);
        }
      }
    }

    drawWalls(c) {
      for (const R of this.game.regions) {
        for (const w of R.walls) {
          if (w.broken) continue;
          const [x0, y0, x1, y1] = w.box;
          if (this.X(x1) < -60 || this.X(x0) > this.W + 60) continue;
          const f = Math.min(1.3, w.force / w.strength);
          const bulge = 0.08 * f * Math.sign(w.axis.x || 1);
          const shake = w.stress > 0 && !this.calm ? (Math.random() - 0.5) * 0.012 * (1 + w.stress * 3) : 0;
          const yc = y0 + Math.min(1.2, (y1 - y0) / 2);
          const pts = [];
          const n = 24;
          for (let i = 0; i <= n; i++) {
            const y = y0 + ((y1 - y0) * i) / n;
            pts.push(new Vec2(x0 + bulge * Math.exp(-Math.pow((y - yc) / 1.2, 2)) + shake, y));
          }
          for (let i = n; i >= 0; i--) {
            const y = y0 + ((y1 - y0) * i) / n;
            pts.push(new Vec2(x1 + bulge * 0.8 * Math.exp(-Math.pow((y - yc) / 1.4, 2)) + shake, y));
          }
          const col = w.color || '#f7a8c3';
          this.poly(c, pts);
          c.globalAlpha = 0.92;
          c.fillStyle = col;
          c.fill();
          c.globalAlpha = 1;
          c.strokeStyle = mix(col, '#7a5a9a', 0.35);
          c.lineWidth = 1.6;
          c.stroke();
          const level = Math.max(0, (f - 0.45) / 0.55) * 0.6 + w.stress * 0.6;
          if (level > 0.02) {
            c.save();
            this.poly(c, pts);
            c.clip();
            const rng = Lab.Mathx.makeRng(Math.round(x0 * 13));
            c.strokeStyle = '#ffffff';
            c.lineWidth = 1.6;
            c.lineCap = 'round';
            const side = (w.axis.x || 1) > 0 ? x0 + bulge : x1;
            for (let k = 0; k < 7; k++) {
              const ang = (w.axis.x > 0 ? 0 : Math.PI) - Math.PI / 2 + (k / 6) * Math.PI + (rng() - 0.5) * 0.3;
              let p = new Vec2(side, yc);
              const len = (0.25 + rng() * 0.45) * Math.min(1.3, level) * 2.4;
              c.beginPath();
              c.moveTo(this.X(p.x), this.Y(p.y));
              for (let s = 0; s < 6; s++) {
                p = p.add(Vec2.fromAngle(ang + (rng() - 0.5) * 0.9, len / 6));
                c.lineTo(this.X(p.x), this.Y(p.y));
              }
              c.stroke();
            }
            c.restore();
          }
        }
      }
    }

    drawMonsters(c) {
      for (const R of this.game.regions) {
        for (const m of R.monsters) {
          if (m.gone || !this.seen(m.body)) continue;
          if (m instanceof Nudge.Dropper) this.drawDropper(c, m);
          else if (m instanceof Nudge.Skater) this.drawSkater(c, m);
        }
      }
    }
    drawDropper(c, m) {
      const b = m.body, x = this.X(b.pos.x), y = this.Y(b.pos.y), r = 0.42 * this.scale, t = this.time;
      // The aim line: brighter as it settles over its mark.
      if (m.rock && m.tell > 0.05) {
        c.strokeStyle = `rgba(255, 93, 143, ${Math.min(0.85, m.tell)})`;
        c.lineWidth = 1.5 + m.tell * 1.5;
        c.setLineDash([5, 6]);
        c.beginPath();
        c.moveTo(x, y + r);
        c.lineTo(x, this.Y(-1));
        c.stroke();
        c.setLineDash([]);
      }
      // A soft cloud-ghost with a heavy heart.
      c.fillStyle = '#f8f3ff';
      c.strokeStyle = '#b8a8e2';
      c.lineWidth = 1.5;
      c.beginPath();
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2;
        const rr = r * (0.82 + 0.1 * Math.sin(t * 3 + k * 1.7));
        c.moveTo(x + Math.cos(a) * rr * 0.55 + rr * 0.5, y + Math.sin(a) * rr * 0.55);
        c.arc(x + Math.cos(a) * rr * 0.55, y + Math.sin(a) * rr * 0.55, rr * 0.5, 0, Math.PI * 2);
      }
      c.fill();
      c.stroke();
      c.fillStyle = '#6b5a96';
      const look = Math.max(-1, Math.min(1, (this.game.pointer.pos.x - b.pos.x) * 0.6));
      for (const s of [-1, 1]) {
        c.beginPath();
        c.ellipse(x + s * r * 0.25 + look * 3, y - r * 0.05, 2.6, 3.6, 0, 0, Math.PI * 2);
        c.fill();
      }
      if (m.rock) {
        const rr = m.rock;
        this.body(c, rr, LOOK.rock.fill, LOOK.rock.edge, 0.03, m.tell > 0.6 ? Math.sin(t * 50) * 0.03 : 0);
        this.note(c, rr.pos.add(new Vec2(0.55, 0)), `${rr.mass} kg`, { size: 10 });
      } else {
        // Reloading ring.
        const k = 1 - Math.max(0, m.cool) / m.reload;
        c.strokeStyle = 'rgba(155, 139, 208, 0.6)';
        c.lineWidth = 2;
        c.beginPath();
        c.arc(x, y + r * 0.9, 6, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2);
        c.stroke();
      }
    }
    drawSkater(c, m) {
      const b = m.body;
      if (m.charging) {
        c.strokeStyle = 'rgba(255, 93, 143, 0.45)';
        c.lineWidth = 2;
        const back = -Math.sign(b.vel.x || 1);
        for (let k = 0; k < 3; k++) {
          const yy = b.pos.y + 0.15 + k * 0.17;
          c.beginPath();
          c.moveTo(this.X(b.pos.x + back * 0.4), this.Y(yy));
          c.lineTo(this.X(b.pos.x + back * (0.6 + Math.min(0.6, Math.abs(b.vel.x) * 0.15))), this.Y(yy));
          c.stroke();
        }
      }
      this.body(c, b, m.charging ? '#ffd2e0' : '#cfeeff', m.charging ? '#e0718c' : '#7fb7d8', 0.12);
      // Spiked boots.
      const s = b.shapes[0].wv, bot = Math.min(...s.map((v) => v.y)), xs = s.map((v) => v.x), x0 = Math.min(...xs), x1 = Math.max(...xs);
      c.fillStyle = '#6f7aa0';
      for (let k = 0; k < 4; k++) {
        const xx = lerp(x0 + 0.08, x1 - 0.08, k / 3);
        c.beginPath();
        c.moveTo(this.X(xx - 0.035), this.Y(bot + 0.02));
        c.lineTo(this.X(xx + 0.035), this.Y(bot + 0.02));
        c.lineTo(this.X(xx), this.Y(bot - 0.04));
        c.closePath();
        c.fill();
      }
      // Eyes on the pointer.
      const look = Math.max(-1, Math.min(1, this.game.pointer.pos.x - b.pos.x));
      c.fillStyle = '#4c5b86';
      for (const sx of [-0.1, 0.1]) {
        c.beginPath();
        c.arc(this.X(b.pos.x + sx + look * 0.05), this.Y(b.pos.y + 0.13), m.charging ? 2.2 : 3, 0, Math.PI * 2);
        c.fill();
      }
      if (m.charging) {
        c.strokeStyle = '#4c5b86';
        c.lineWidth = 1.5;
        c.beginPath();
        c.moveTo(this.X(b.pos.x - 0.16), this.Y(b.pos.y + 0.23));
        c.lineTo(this.X(b.pos.x - 0.04), this.Y(b.pos.y + 0.19));
        c.moveTo(this.X(b.pos.x + 0.16), this.Y(b.pos.y + 0.23));
        c.lineTo(this.X(b.pos.x + 0.04), this.Y(b.pos.y + 0.19));
        c.stroke();
      }
    }

    /* ---------------- readouts: the numbers ---------------- */
    drawReadouts(c) {
      const g = this.game, P = g.pointer;
      const near = (p, r = 6) => P.pos.dist(p) < r || this.cam.dist(p) < r;
      const G = g.byId.gravity;
      if (G) {
        const GV = G.GV;
        if (G.wallObj && !G.wallObj.broken) this.wallChip(c, G.wallObj);
        if (G.rope && near(G.basket.pos, 9)) {
          const m = G.basketMass();
          this.note(c, G.basket.pos.add(new Vec2(0, 0.8)), `바구니 ${(3 + m).toFixed(0)} kg · 장력 ${G.rope.tension.toFixed(0)} N`, { size: 11 });
        }
        if (near(G.platform.pos, 7)) {
          const load = G.loaded() ? G.heavy.mass : 0;
          const lm = 2 + load, cm = G.counter.mass, net = (lm - cm) * 9.8;
          const txt = `발판 ${lm.toFixed(0)} kg · 평형추 ${cm} kg · 알짜힘 ${net > 0 ? '↓' : '↑'} ${Math.abs(net).toFixed(1)} N`;
          this.note(c, G.platform.pos.add(new Vec2(0, -0.45)), txt, { size: 11 });
          this.note(c, G.counter.pos.add(new Vec2(0, 0.6)), `${cm} kg`, { size: 10 });
        }
        if (near(new Vec2((GV.CUPS[0] + GV.CUPS[1]) / 2, 3.5), 7)) {
          this.note(c, new Vec2((GV.PLATES[0] + GV.PLATES[1]) / 2, 0.55), '두 판을 0.06 s 안에 함께', { size: 11 });
        }
        if (G.orb && near(G.orb.c, 7)) this.note(c, G.orb.c.add(new Vec2(0, -0.75)), `a = ${G.orb.K} / r²`, { size: 11 });
        if (G.blade && near(G.blade.pivot, 6)) this.note(c, G.blade.pivot.add(new Vec2(0, -0.35)), `${G.blade.body.mass} kg`, { size: 10 });
      }
      const F = g.byId.friction;
      if (F) {
        const FR = F.FR;
        if (F.wallObj && !F.wallObj.broken) this.wallChip(c, F.wallObj);
        if (near(F.column.pos, 8)) {
          const cl = F.clutch();
          if (cl.bottom) {
            const bottom = (LOOK[cl.bottom.role] || {}).name || cl.bottom.role;
            this.note(c, new Vec2(F.column.pos.x - 1.4, 2.95), `벨트에 닿은 바닥: ${bottom} · μ ${cl.mu.toFixed(2)}`, { size: 11 });
            this.note(c, new Vec2(F.column.pos.x - 1.4, 2.55), `f = μN = ${cl.mu.toFixed(2)} × ${cl.N.toFixed(0)} N = ${cl.F.toFixed(0)} N`, { size: 11 });
          } else this.note(c, new Vec2(F.column.pos.x - 1.4, 2.75), '빈 기둥 · 벨트가 미는 힘 0 N', { size: 11 });
        }
        const sk = F.skater;
        if (sk && near(sk.body.pos, 7)) this.note(c, sk.body.pos.add(new Vec2(0, 0.75)), `μN ${sk.grip.toFixed(0)} N`, { size: 10, color: sk.charging ? '#c0466f' : C.ink });
        if (near(new Vec2(FR.RAMP.x0 + 2, 1), 6)) this.note(c, new Vec2(FR.RAMP.x0 + 2.4, 1.6), '16.7° · 얼음 μ 0.03', { size: 11 });
        if (near(new Vec2(FR.SAND.x0 + 2.5, 0), 7)) this.note(c, new Vec2((FR.SAND.x0 + FR.SAND.x1) / 2, -0.45), '모래 μ 0.9', { size: 11 });
      }
    }
    wallChip(c, w) {
      const [x0, , x1, y1] = w.box;
      const p = new Vec2((x0 + x1) / 2, Math.min(y1 - 0.4, w.box[1] + 3.2));
      if (Math.abs(p.x - this.cam.x) > 12) return;
      const f = w.force, s = w.strength;
      const hot = f >= s;
      const { w: cw } = this.note(c, p, `${f.toFixed(0)} / ${s} N`, { size: 12, color: hot ? '#c0466f' : C.ink });
      // Endurance ring: how long it has held past its strength.
      if (w.stress > 0.01) {
        c.strokeStyle = '#ff5d8f';
        c.lineWidth = 2.5;
        c.beginPath();
        c.arc(this.X(p.x) + cw / 2 + 12, this.Y(p.y), 7, -Math.PI / 2, -Math.PI / 2 + w.stress * Math.PI * 2);
        c.stroke();
      }
    }

    drawFragments(c) {
      const g = this.game, t = this.time;
      for (const R of g.regions) {
        const f = R.fragment;
        if (!f || f.taken) continue;
        const x = this.X(f.pos.x), y = this.Y(f.pos.y + 0.06 * Math.sin(t * 1.5));
        if (x < -60 || x > this.W + 60) continue;
        const glow = c.createRadialGradient(x, y, 0, x, y, 1.1 * this.scale);
        glow.addColorStop(0, 'rgba(255,255,255,0.95)');
        glow.addColorStop(0.3, 'rgba(255, 220, 238, 0.6)');
        glow.addColorStop(1, 'rgba(210, 230, 255, 0)');
        c.fillStyle = glow;
        c.beginPath();
        c.arc(x, y, 1.1 * this.scale, 0, Math.PI * 2);
        c.fill();
        this.glyph(c, x, y, Nudge.FRAGMENTS.find((q) => q.id === f.id), 1);
      }
      // Fragments being carried home circle the pointer.
      const P = g.pointer;
      if (!P.dead) {
        const carried = Nudge.FRAGMENTS.filter((q) => g.save.fragments[q.id] && !g.save.delivered[q.id]);
        carried.forEach((q, i) => {
          const a = t * 1.8 + (i / carried.length) * Math.PI * 2;
          this.glyph(c, this.X(P.pos.x + Math.cos(a) * 0.42), this.Y(P.pos.y + Math.sin(a) * 0.3), q, 0.6);
        });
      }
      // … and fly into the door.
      this.flyers = this.flyers.filter((f) => f.t < 1.2);
      for (const f of this.flyers) {
        f.t += this.dt;
        const k = Math.min(1, f.t / 1.2), e = k * k * (3 - 2 * k);
        const p = Vec2.lerp(f.from, f.to, e).add(new Vec2(0, Math.sin(k * Math.PI) * 1.5));
        this.glyph(c, this.X(p.x), this.Y(p.y), f.frag, 0.8 + 0.4 * Math.sin(k * Math.PI));
      }
    }
    glyph(c, x, y, frag, k) {
      if (!frag) return;
      const r = 13 * k;
      c.save();
      c.translate(x, y);
      c.rotate(Math.sin(this.time * 1.3) * 0.15);
      c.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
        if (i) c.lineTo(Math.cos(a) * r, Math.sin(a) * r); else c.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      c.closePath();
      c.fillStyle = '#ffffff';
      c.shadowColor = 'rgba(247, 168, 195, 0.95)';
      c.shadowBlur = 12;
      c.fill();
      c.shadowBlur = 0;
      c.strokeStyle = '#e17fa4';
      c.lineWidth = 1.5;
      c.stroke();
      c.font = `700 ${Math.round(r * 1.1)}px ${FONT_NUM}`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillStyle = '#e17fa4';
      c.fillText(frag.glyph, 0, 1);
      c.restore();
    }
    sendHome(frag, from) {
      const hub = this.game.byId.hub;
      const i = Nudge.FRAGMENTS.indexOf(frag);
      const a = -Math.PI / 2 + (i / Nudge.FRAGMENTS.length) * Math.PI * 2;
      const to = hub.door.c.add(new Vec2(Math.cos(a) * hub.door.r * 0.9, -Math.sin(a) * hub.door.r * 0.9));
      this.flyers.push({ frag, from: from.clone(), to, t: 0 });
    }

    /* ---------------- particles ---------------- */
    drawParticles(c, dt) {
      const keep = [];
      for (const p of this.particles) {
        p.life -= dt;
        if (p.life <= 0) continue;
        if (p.grav) p.vy -= 9.8 * dt * p.grav;
        p.vx *= p.drag || 1;
        p.vy *= p.drag || 1;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.a = (p.a || 0) + (p.spin || 0) * dt;
        keep.push(p);
        c.globalAlpha = Math.min(1, p.life * 2);
        if (p.kind === 'cursor') {
          // A splinter of the pointer.
          c.save();
          c.translate(this.X(p.x), this.Y(p.y));
          c.rotate(p.a);
          c.fillStyle = p.color;
          c.strokeStyle = C.pointerEdge;
          c.lineWidth = 1;
          c.beginPath();
          c.moveTo(0, -p.r);
          c.lineTo(p.r * 0.8, p.r * 0.6);
          c.lineTo(-p.r * 0.7, p.r * 0.5);
          c.closePath();
          c.fill();
          c.stroke();
          c.restore();
        } else {
          c.fillStyle = p.color || 'rgba(255,255,255,0.9)';
          c.beginPath();
          c.arc(this.X(p.x), this.Y(p.y), p.r || 2.4, 0, Math.PI * 2);
          c.fill();
        }
      }
      c.globalAlpha = 1;
      this.particles = keep.length > 500 ? keep.slice(-500) : keep;
    }
    puff(p, color, n = 20, speed = 2, opts = {}) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, s = Math.random() * speed;
        this.particles.push(Object.assign({ x: p.x, y: p.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.7 + Math.random() * 0.6, color, r: 2 + Math.random() * 3, drag: 0.96 }, opts));
      }
    }
    shatterPointer(p) {
      for (let i = 0; i < 16; i++) {
        const a = Math.random() * Math.PI * 2, s = 1 + Math.random() * 3.5;
        this.particles.push({ kind: 'cursor', x: p.x, y: p.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s + 1, grav: 0.6, drag: 0.985, life: 1.0 + Math.random() * 0.5, r: 3 + Math.random() * 5, a: Math.random() * 6, spin: (Math.random() - 0.5) * 14, color: i % 3 ? '#ffffff' : C.pointerTail });
      }
      this.jelly = { e: 0, v: 0, ang: 0 };
      this.trail = [];
    }

    /* ---------------- the pointer ---------------- */
    cursorPath(c, k) { this.roundedPx(c, CURSOR.map(([x, y]) => [(x - 5) * k, (y - 10) * k]), 1.2 * k); }
    wobble(dt, want, ang) {
      const j = this.jelly;
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
    drawPointer(c, app, dt) {
      const g = this.game, P = g.pointer;
      if (P.dead) return;
      const p = P.pos;
      const k = Math.max(0.95, 0.0125 * this.scale);
      // Where the mouse really is, when something holds the pointer back.
      if (app.ghost && p.dist(app.ghost) > 0.25) {
        c.strokeStyle = 'rgba(150, 130, 200, 0.32)';
        c.lineWidth = 1.2;
        c.setLineDash([3, 5]);
        c.beginPath();
        c.moveTo(this.X(p.x), this.Y(p.y));
        c.lineTo(this.X(app.ghost.x), this.Y(app.ghost.y));
        c.stroke();
        c.setLineDash([2, 3]);
        c.save();
        c.translate(this.X(app.ghost.x), this.Y(app.ghost.y));
        this.cursorPath(c, k);
        c.stroke();
        c.restore();
        c.setLineDash([]);
      }
      // The line to what it holds, with its pull in newtons.
      if (P.grip) {
        const o = P.grip.body, q = o.worldPoint(P.grip.local), L = P.lineF.len();
        c.strokeStyle = C.line;
        c.lineWidth = 1.5 + Math.min(2.5, L / 25);
        c.lineCap = 'round';
        c.beginPath();
        c.moveTo(this.X(p.x), this.Y(p.y));
        c.lineTo(this.X(q.x), this.Y(q.y));
        c.stroke();
        c.fillStyle = C.line;
        c.beginPath();
        c.arc(this.X(q.x), this.Y(q.y), 3, 0, Math.PI * 2);
        c.fill();
        const mid = Vec2.lerp(p, q, 0.5);
        this.chip(c, this.X(mid.x) + 22, this.Y(mid.y), `${L.toFixed(0)} N`, { size: 11, color: L > 59 ? '#c0466f' : C.ink });
      }
      // Its push, when it leans on something.
      if (P.touching && P.F.len() > 2) {
        const F = P.F, u = F.norm();
        const tip = p.addScaled(u, 0.16 + F.len() / 100);
        this.arrow(c, p.addScaled(u, 0.16), tip, C.push, 2.4, 8);
        this.chip(c, this.X(tip.x) + u.x * 18, this.Y(tip.y) - u.y * 18 - 4, `${F.len().toFixed(0)} N`, { size: 11, color: F.len() > 39 ? '#7c6cc4' : C.ink });
      }
      // Soft trail.
      this.trail.push({ x: p.x, y: p.y, life: 0.3 });
      for (const t of this.trail) t.life -= dt;
      this.trail = this.trail.filter((t) => t.life > 0);
      for (const t of this.trail) {
        c.fillStyle = `rgba(255,255,255,${t.life})`;
        c.beginPath();
        c.arc(this.X(t.x), this.Y(t.y), 0.07 * this.scale * (0.3 + t.life), 0, Math.PI * 2);
        c.fill();
      }
      // Jelly: stretch with motion, flatten against what it strains at.
      const v = P.handVel || P.body.vel, speed = v.len();
      let want = Math.min(0.3, speed / 14), ang = speed > 0.05 ? Math.atan2(v.y, v.x) : this.jelly.ang;
      if (P.touching && P.F.len() > 20) { want = -0.22; ang = Math.atan2(P.F.y, P.F.x); }
      if (P.stagger > 0) want = 0.35 * Math.sin(this.time * 40);
      this.wobble(dt, want, ang);
      const j = this.jelly, sx = 1 + j.e, sy = 1 / Math.sqrt(Math.max(0.3, sx));
      c.save();
      c.translate(this.X(p.x), this.Y(p.y));
      c.rotate(-j.ang);
      c.scale(sx, sy);
      c.rotate(j.ang);
      if (app.spawnPop > 0) c.scale(1 + app.spawnPop * 0.6, 1 + app.spawnPop * 0.6);
      this.cursorPath(c, k);
      const gr = c.createLinearGradient(-5 * k, -10 * k, 6 * k, 9 * k);
      gr.addColorStop(0, '#ffffff');
      gr.addColorStop(1, C.pointerTail);
      c.fillStyle = gr;
      c.shadowColor = C.pointerShadow;
      c.shadowBlur = 5;
      c.shadowOffsetY = 2;
      c.fill();
      c.shadowColor = 'transparent';
      c.shadowBlur = 0;
      c.shadowOffsetY = 0;
      c.lineJoin = 'round';
      c.strokeStyle = P.grip ? C.line : C.pointerEdge;
      c.lineWidth = 1.2;
      c.stroke();
      c.restore();
      if (app.holdReset > 0) {
        c.strokeStyle = 'rgba(150, 130, 200, 0.85)';
        c.lineWidth = 2;
        c.beginPath();
        c.arc(this.X(p.x), this.Y(p.y), 0.3 * this.scale, -Math.PI / 2, -Math.PI / 2 + app.holdReset * Math.PI * 2);
        c.stroke();
      }
    }

    /* ---------------- blows: arrows at the point of application ---------------- */
    blow(ev) {
      this.blows.push({ p: ev.p.clone(), dir: ev.dir.clone(), F: ev.F, src: ev.source, t: 0, fatal: ev.F >= Nudge.PT.BREAK });
      if (this.blows.length > 8) this.blows.shift();
    }
    drawBlows(c, dt) {
      this.blows = this.blows.filter((b) => b.t < 1.8);
      for (const b of this.blows) {
        b.t += dt;
        const a = b.t < 1.2 ? 1 : 1 - (b.t - 1.2) / 0.6;
        const L = 0.5 + Math.min(1.4, b.F / 80);
        const from = b.p.addScaled(b.dir, -L);
        c.globalAlpha = a;
        const col = b.fatal ? C.blow : C.blowSoft;
        this.arrow(c, from, b.p, col, 3.2, 12);
        // The point of application.
        c.strokeStyle = col;
        c.lineWidth = 2;
        c.fillStyle = '#ffffff';
        c.beginPath();
        c.arc(this.X(b.p.x), this.Y(b.p.y), 4.5, 0, Math.PI * 2);
        c.fill();
        c.stroke();
        const name = SOURCE[b.src] || '충격';
        this.chip(c, this.X(from.x), this.Y(from.y) - 14, `${name} ${b.F.toFixed(0)} N${b.fatal ? ' ≥ 60 N' : ''}`, { size: 12, color: b.fatal ? '#c0466f' : '#b0603b', edge: col });
        c.globalAlpha = 1;
      }
    }
    /** A readout that appears in the world for a moment. */
    say(p, text, opts = {}) { this.notes.push({ p: p.clone(), text, t: 0, life: opts.life || 2.6, color: opts.color }); }
    drawNotes(c, dt) {
      this.notes = this.notes.filter((n) => n.t < n.life);
      for (const n of this.notes) {
        n.t += dt;
        c.globalAlpha = Math.min(1, (n.life - n.t) / 0.5, n.t / 0.15);
        this.note(c, n.p.add(new Vec2(0, n.t * 0.15)), n.text, { size: 12, color: n.color || C.ink });
        c.globalAlpha = 1;
      }
    }
  }

  Nudge.View = View;
  Nudge.PALETTES = PAL;
  Nudge.LOOK = LOOK;
  Nudge.SOURCE = SOURCE;
  Nudge.FONTS = { NUM: FONT_NUM, KO: FONT_KO, TITLE: FONT_TITLE };
})(typeof window !== 'undefined' ? window : globalThis);
