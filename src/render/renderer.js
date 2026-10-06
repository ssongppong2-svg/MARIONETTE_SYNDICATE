/*
 * Force Chamber — canvas renderer
 * Draws chambers like a technical drawing on graph paper: hatched solids,
 * ink outlines, dimension lines, instrument readouts and force vectors.
 * All colours come from CSS custom properties so both themes stay in sync.
 */
(function (root) {
  'use strict';
  const Lab = (root.Lab = root.Lab || {});
  const { Vec2, Mathx } = Lab;

  const FONT_MONO = '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
  const FONT_DISPLAY = '"B612 Mono", "IBM Plex Mono", ui-monospace, monospace';
  const FONT_SANS = '"IBM Plex Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif';

  const TOKENS = [
    'paper', 'paper-2', 'ink', 'ink-2', 'ink-3', 'grid', 'grid-major', 'accent', 'accent-soft',
    'info', 'ok', 'warn', 'danger', 'solid', 'hatch', 'frame', 'frame-hatch', 'instrument',
    'beam', 'beam-hot', 'lcd-bg', 'lcd-ink', 'lcd-hot', 'water', 'water-line', 'rope',
    'm-wood', 'm-steel', 'm-brass', 'm-rubber', 'm-ice', 'm-glass', 'm-felt', 'm-foam', 'm-lead', 'm-default',
    'f-gravity', 'f-normal', 'f-friction', 'f-tension', 'f-buoy', 'f-spring', 'trail', 'shadow',
  ];

  function readTheme(el) {
    const cs = getComputedStyle(el || document.documentElement);
    const th = {};
    for (const t of TOKENS) {
      const key = t.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
      th[key] = cs.getPropertyValue('--' + t).trim() || '#888';
    }
    th.beamHot = th.beamHot || th.danger;
    return th;
  }

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.dpr = 1;
      this.scale = 80;
      this.ox = 0; this.oy = 0;
      this.theme = readTheme();
      this.patterns = {};
      this.fontScale = 1;
      this.overlays = [];
    }

    refreshTheme() {
      this.theme = readTheme();
      this.patterns = {};
    }

    resize() {
      const rect = this.canvas.getBoundingClientRect();
      const dpr = Math.min(root.devicePixelRatio || 1, 2.5);
      const w = Math.max(1, Math.round(rect.width * dpr));
      const h = Math.max(1, Math.round(rect.height * dpr));
      if (this.canvas.width !== w || this.canvas.height !== h) {
        this.canvas.width = w;
        this.canvas.height = h;
      }
      this.dpr = dpr;
      this.cssW = rect.width;
      this.cssH = rect.height;
    }

    /** Fit a world rectangle into the canvas, centred, with padding in CSS px (number or {t,r,b,l}). */
    fit(x0, y0, x1, y1, pad = 16) {
      const P = typeof pad === 'number' ? { t: pad, r: pad, b: pad, l: pad } : pad;
      const w = this.cssW - P.l - P.r, h = this.cssH - P.t - P.b;
      this.scale = Math.max(4, Math.min(w / (x1 - x0), h / (y1 - y0)));
      this.ox = P.l + (w - (x1 - x0) * this.scale) / 2 - x0 * this.scale;
      this.oy = P.t + (h - (y1 - y0) * this.scale) / 2 + y1 * this.scale;
      this.fontScale = Mathx.clamp(this.scale / 85, 0.72, 1.18);
      this.view = { x0, y0, x1, y1 };
    }

    X(x) { return this.ox + x * this.scale; }
    Y(y) { return this.oy - y * this.scale; }
    toWorld(sx, sy) { return new Vec2((sx - this.ox) / this.scale, (this.oy - sy) / this.scale); }
    px(m) { return m * this.scale; }
    m(px) { return px / this.scale; }

    begin() {
      const c = this.ctx;
      c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      c.fillStyle = this.theme.paper2;
      c.fillRect(0, 0, this.cssW, this.cssH);
    }

    /* ---------------- primitives ---------------- */
    path(pts, close) {
      const c = this.ctx;
      c.beginPath();
      for (let i = 0; i < pts.length; i++) {
        const x = this.X(pts[i].x), y = this.Y(pts[i].y);
        if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
      }
      if (close) c.closePath();
    }
    style(o, defWidth = 1.2) {
      const c = this.ctx;
      c.lineWidth = o.width != null ? o.width : defWidth;
      c.strokeStyle = o.color || o.stroke || this.theme.ink;
      c.setLineDash(o.dash || []);
      c.lineCap = o.cap || 'round';
      c.lineJoin = 'round';
      c.globalAlpha = o.alpha != null ? o.alpha : 1;
    }
    done() {
      const c = this.ctx;
      c.globalAlpha = 1;
      c.setLineDash([]);
    }
    line(a, b, o = {}) {
      this.style(o);
      const c = this.ctx;
      c.beginPath();
      c.moveTo(this.X(a.x), this.Y(a.y));
      c.lineTo(this.X(b.x), this.Y(b.y));
      c.stroke();
      this.done();
    }
    polyline(pts, o = {}) {
      if (pts.length < 2) return;
      this.style(o);
      this.path(pts, false);
      this.ctx.stroke();
      this.done();
    }
    poly(pts, o = {}) {
      const c = this.ctx;
      this.path(pts, true);
      c.globalAlpha = o.alpha != null ? o.alpha : 1;
      if (o.fill) { c.fillStyle = o.fill; c.fill(); }
      if (o.hatch) { c.fillStyle = this.pattern(o.hatch); c.fill(); }
      c.globalAlpha = 1;
      if (o.stroke !== false && (o.stroke || o.width)) {
        this.style(Object.assign({}, o, { alpha: o.strokeAlpha != null ? o.strokeAlpha : o.alpha }));
        this.path(pts, true);
        c.stroke();
      }
      this.done();
    }
    rect(x0, y0, x1, y1, o = {}) {
      this.poly([new Vec2(x0, y0), new Vec2(x1, y0), new Vec2(x1, y1), new Vec2(x0, y1)], o);
    }
    circle(cen, r, o = {}) {
      const c = this.ctx;
      c.beginPath();
      c.arc(this.X(cen.x), this.Y(cen.y), Math.max(0.5, this.px(r)), 0, Math.PI * 2);
      c.globalAlpha = o.alpha != null ? o.alpha : 1;
      if (o.fill) { c.fillStyle = o.fill; c.fill(); }
      if (o.hatch) { c.fillStyle = this.pattern(o.hatch); c.fill(); }
      c.globalAlpha = 1;
      if (o.stroke !== false && (o.stroke || o.width)) {
        this.style(o);
        c.stroke();
      }
      this.done();
    }
    /** Dot with a fixed screen radius. */
    dot(p, rpx, fill) {
      const c = this.ctx;
      c.beginPath();
      c.arc(this.X(p.x), this.Y(p.y), rpx, 0, Math.PI * 2);
      c.fillStyle = fill || this.theme.ink;
      c.fill();
    }
    /** Arc in world angles (radians, CCW from +x). */
    arc(cen, r, a0, a1, o = {}) {
      this.style(o);
      const c = this.ctx;
      c.beginPath();
      // Canvas y is flipped, so world CCW becomes canvas clockwise.
      c.arc(this.X(cen.x), this.Y(cen.y), this.px(r), -a0, -a1, a1 > a0);
      c.stroke();
      this.done();
    }
    arrow(a, b, o = {}) {
      const len = this.px(a.dist(b));
      if (len < 1) return;
      const head = Math.min(o.head || 8, len * 0.5);
      const c = this.ctx;
      const ax = this.X(a.x), ay = this.Y(a.y), bx = this.X(b.x), by = this.Y(b.y);
      const ang = Math.atan2(by - ay, bx - ax);
      this.style(Object.assign({ width: 2 }, o));
      c.beginPath();
      c.moveTo(ax, ay);
      c.lineTo(bx - Math.cos(ang) * head * 0.6, by - Math.sin(ang) * head * 0.6);
      c.stroke();
      c.beginPath();
      c.moveTo(bx, by);
      c.lineTo(bx - Math.cos(ang - 0.38) * head, by - Math.sin(ang - 0.38) * head);
      c.lineTo(bx - Math.cos(ang + 0.38) * head, by - Math.sin(ang + 0.38) * head);
      c.closePath();
      c.fillStyle = o.color || this.theme.ink;
      c.globalAlpha = o.alpha != null ? o.alpha : 1;
      c.fill();
      this.done();
    }
    font(size, kind = 'mono', weight = 400) {
      const px = Math.round(size * this.fontScale * 10) / 10;
      return `${weight} ${px}px ${kind === 'mono' ? FONT_MONO : kind === 'display' ? FONT_DISPLAY : FONT_SANS}`;
    }
    /** Text at a world point. Options: size, font ('mono'|'sans'), weight, color, align, baseline, bg, rotate, dx, dy. */
    text(p, str, o = {}) {
      const c = this.ctx;
      c.font = this.font(o.size || 11, o.font || 'mono', o.weight || 400);
      c.textAlign = o.align || 'left';
      c.textBaseline = o.baseline || 'middle';
      const x = this.X(p.x) + (o.dx || 0), y = this.Y(p.y) + (o.dy || 0);
      c.save();
      c.translate(x, y);
      if (o.rotate) c.rotate(-o.rotate);
      if (o.bg) {
        const w = c.measureText(str).width;
        const h = (o.size || 11) * this.fontScale * 1.35;
        const pad = 3;
        let bx = -pad;
        if (c.textAlign === 'center') bx = -w / 2 - pad;
        else if (c.textAlign === 'right') bx = -w - pad;
        c.fillStyle = o.bg;
        c.globalAlpha = o.bgAlpha != null ? o.bgAlpha : 0.92;
        c.fillRect(bx, -h / 2, w + pad * 2, h);
        c.globalAlpha = 1;
      }
      c.fillStyle = o.color || this.theme.ink;
      c.globalAlpha = o.alpha != null ? o.alpha : 1;
      c.fillText(str, 0, 0);
      c.restore();
      c.globalAlpha = 1;
    }
    measure(str, size = 11, kind = 'mono') {
      this.ctx.font = this.font(size, kind);
      return this.ctx.measureText(str).width;
    }

    /** Instrument readout box anchored at a world point. */
    lcd(p, lines, o = {}) {
      const c = this.ctx;
      const size = o.size || 10.5;
      c.font = this.font(size, 'mono');
      const lh = size * this.fontScale * 1.45;
      let w = 0;
      for (const l of lines) w = Math.max(w, c.measureText(l).width);
      const pad = 5;
      const bw = w + pad * 2, bh = lh * lines.length + pad * 1.2;
      let x = this.X(p.x), y = this.Y(p.y) - bh / 2;
      if (o.align === 'right') x -= bw;
      else if (o.align === 'center') x -= bw / 2;
      if (o.valign === 'top') y = this.Y(p.y);
      if (o.valign === 'bottom') y = this.Y(p.y) - bh;
      c.fillStyle = this.theme.lcdBg;
      c.globalAlpha = 0.96;
      this.roundRect(x, y, bw, bh, 3);
      c.fill();
      c.globalAlpha = 1;
      c.lineWidth = 1;
      c.strokeStyle = o.hot ? this.theme.lcdHot : this.theme.ink3;
      this.roundRect(x, y, bw, bh, 3);
      c.stroke();
      c.fillStyle = o.color || (o.hot ? this.theme.lcdHot : this.theme.lcdInk);
      c.textAlign = 'left';
      c.textBaseline = 'middle';
      lines.forEach((l, i) => c.fillText(l, x + pad, y + pad * 0.6 + lh * (i + 0.5)));
      return { x, y, w: bw, h: bh };
    }
    roundRect(x, y, w, h, r) {
      const c = this.ctx;
      c.beginPath();
      c.moveTo(x + r, y);
      c.arcTo(x + w, y, x + w, y + h, r);
      c.arcTo(x + w, y + h, x, y + h, r);
      c.arcTo(x, y + h, x, y, r);
      c.arcTo(x, y, x + w, y, r);
      c.closePath();
    }

    /** Engineering dimension line between a and b, offset perpendicular by `off` metres. */
    dim(a, b, text, o = {}) {
      const th = this.theme;
      const color = o.color || th.ink2;
      const d = b.sub(a);
      const len = d.len();
      if (len < 1e-6) return;
      const u = d.scale(1 / len), n = u.perp();
      const off = o.off != null ? o.off : 0.25;
      const pa = a.addScaled(n, off), pb = b.addScaled(n, off);
      const ext = o.ext != null ? o.ext : 0.08;
      if (Math.abs(off) > 0.01) {
        this.line(a.addScaled(n, Math.sign(off) * 0.04), pa.addScaled(n, Math.sign(off) * ext), { color, width: 0.8 });
        this.line(b.addScaled(n, Math.sign(off) * 0.04), pb.addScaled(n, Math.sign(off) * ext), { color, width: 0.8 });
      }
      this.line(pa, pb, { color, width: 0.9 });
      // Architectural ticks at both ends.
      const t = this.m(5);
      const k = u.add(n).norm();
      for (const p of [pa, pb]) this.line(p.addScaled(k, -t), p.addScaled(k, t), { color, width: 1.3 });
      if (text) {
        const mid = Vec2.lerp(pa, pb, 0.5);
        let ang = Math.atan2(u.y, u.x);
        if (ang > Math.PI / 2 + 1e-6) ang -= Math.PI;
        if (ang < -Math.PI / 2 - 1e-6) ang += Math.PI;
        this.text(mid, text, { size: o.size || 10.5, color: o.textColor || color, align: 'center', rotate: ang, bg: th.paper, bgAlpha: 0.95 });
      }
    }

    /** Angle mark: arc from direction a0 to a1 (radians) with a label. */
    angleMark(cen, radius, a0, a1, text, o = {}) {
      const color = o.color || this.theme.ink2;
      this.arc(cen, radius, Math.min(a0, a1), Math.max(a0, a1), { color, width: o.width || 1 });
      if (text) {
        const am = (a0 + a1) / 2;
        const p = cen.add(Vec2.fromAngle(am, radius + this.m(14)));
        this.text(p, text, { size: o.size || 10.5, color: o.textColor || color, align: 'center', bg: o.bg === false ? null : this.theme.paper, bgAlpha: 0.85 });
      }
    }

    /** Diagonal hatch pattern used for cut solids. */
    pattern(kind) {
      if (this.patterns[kind]) return this.patterns[kind];
      const th = this.theme;
      const size = kind === 'frame' ? 9 : 7;
      const off = document.createElement('canvas');
      const s = Math.round(size * this.dpr);
      off.width = s; off.height = s;
      const c = off.getContext('2d');
      c.strokeStyle = kind === 'frame' ? th.frameHatch : kind === 'water' ? th.waterLine : th.hatch;
      c.lineWidth = Math.max(1, this.dpr * (kind === 'frame' ? 1 : 0.8));
      c.beginPath();
      if (kind === 'cross') {
        c.moveTo(0, 0); c.lineTo(s, s); c.moveTo(s, 0); c.lineTo(0, s);
      } else {
        c.moveTo(-s, s * 2); c.lineTo(s * 2, -s);
        c.moveTo(-s, s); c.lineTo(s, -s);
        c.moveTo(0, s * 2); c.lineTo(s * 2, 0);
      }
      c.stroke();
      const p = this.ctx.createPattern(off, 'repeat');
      if (p && p.setTransform && root.DOMMatrix) p.setTransform(new DOMMatrix().scale(1 / this.dpr));
      this.patterns[kind] = p;
      return p;
    }

    /** Centre-of-mass symbol (quartered circle). */
    comMark(p, rpx = 4.5) {
      const c = this.ctx, x = this.X(p.x), y = this.Y(p.y);
      c.beginPath(); c.arc(x, y, rpx, 0, Math.PI * 2);
      c.fillStyle = this.theme.paper; c.fill();
      c.beginPath(); c.moveTo(x, y); c.arc(x, y, rpx, 0, Math.PI / 2); c.closePath();
      c.fillStyle = this.theme.ink; c.fill();
      c.beginPath(); c.moveTo(x, y); c.arc(x, y, rpx, Math.PI, Math.PI * 1.5); c.closePath(); c.fill();
      c.beginPath(); c.arc(x, y, rpx, 0, Math.PI * 2);
      c.lineWidth = 1; c.strokeStyle = this.theme.ink; c.stroke();
    }

    materialColor(mat) {
      const th = this.theme;
      const name = mat && mat.key;
      const map = { wood: th.mWood, steel: th.mSteel, brass: th.mBrass, rubber: th.mRubber, ice: th.mIce, glass: th.mGlass, felt: th.mFelt, foam: th.mFoam, lead: th.mLead };
      return map[name] || th.mDefault;
    }
  }

  Lab.Renderer = Renderer;
  Lab.readTheme = readTheme;
  Lab.FONT_MONO = FONT_MONO;
  Lab.FONT_SANS = FONT_SANS;
  Lab.FONT_DISPLAY = FONT_DISPLAY;
})(typeof window !== 'undefined' ? window : globalThis);
