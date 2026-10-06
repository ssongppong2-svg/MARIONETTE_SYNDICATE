/*
 * Force Chamber — shared chamber kit
 * Drawing helpers for common lab fixtures and small scene builders.
 */
(function (root) {
  'use strict';
  const Lab = (root.Lab = root.Lab || {});
  const { Vec2, Mathx } = Lab;

  const Kit = {
    /** Meter stick from a (zero mark) towards b, centimetre ticks, labels every 10 cm or 50 cm. */
    stick(r, a, b, opts = {}) {
      const th = r.theme;
      const d = b.sub(a), L = d.len();
      const u = d.scale(1 / L), n = u.perp().scale(opts.side === 'right' ? -1 : 1);
      const w = opts.width || 0.09;
      const quad = [a, b, b.addScaled(n, w), a.addScaled(n, w)];
      r.poly(quad, { fill: th.instrument, stroke: th.ink3, width: 1 });
      const cm = r.px(0.01) >= 2.2;
      const labelEvery = r.px(0.1) >= 26 ? 0.1 : 0.5;
      const step = cm ? 0.01 : 0.05;
      const N = Math.round(L / step);
      for (let i = 0; i <= N; i++) {
        const s = i * step;
        const isMeter = i % Math.round(1 / step) === 0;
        const isTen = i % Math.round(0.1 / step) === 0;
        const isFive = i % Math.round(0.05 / step) === 0;
        const len = isMeter ? w : isTen ? w * 0.62 : isFive ? w * 0.42 : w * 0.25;
        const p = a.addScaled(u, s);
        r.line(p, p.addScaled(n, len), { color: th.ink, width: isMeter ? 1.4 : isTen ? 1 : 0.6, alpha: isTen ? 1 : 0.7 });
        const every = Math.round(labelEvery / step);
        if (i % every === 0 && i > 0) {
          const txt = labelEvery >= 0.5 && !isMeter ? Mathx.fmt(s, 1) : isMeter ? `${Math.round(s)} m` : `${Math.round(s * 100) % 100}`;
          const align = n.x < -0.5 ? 'right' : n.x > 0.5 ? 'left' : 'center';
          r.text(p.addScaled(n, w + r.m(3)), txt, { size: isMeter ? 9 : 8, color: isMeter ? th.ink : th.ink2, align, weight: isMeter ? 700 : 400 });
        }
      }
      if (opts.label) r.text(b.addScaled(u, r.m(10)), opts.label, { size: 9, color: th.ink2, align: 'center' });
    },

    /** Electromagnet block hanging above point p (bottom face centre). */
    magnet(r, p, on, w = 0.26, hgt = 0.16) {
      const th = r.theme;
      r.rect(p.x - w / 2, p.y, p.x + w / 2, p.y + hgt, { fill: th.instrument, stroke: th.ink, width: 1.3 });
      for (let i = 1; i < 6; i++) {
        const x = p.x - w / 2 + (w * i) / 6;
        r.line(new Vec2(x, p.y + 0.02), new Vec2(x, p.y + hgt - 0.02), { color: on ? th.accent : th.ink3, width: 1.2 });
      }
      r.rect(p.x - w / 2, p.y - 0.018, p.x + w / 2, p.y, { fill: th.ink, stroke: false });
    },

    /** Static U-shaped cup with an internal sensor zone. Returns { zone, bodies }. */
    cup(room, x, y, w, hgt, opts = {}) {
      const t = opts.wall || 0.05;
      const mat = opts.material || 'felt';
      const style = opts.style || {};
      const bodies = [
        room.solid(x - w / 2 - t, y, x - w / 2, y + hgt, { material: mat, style }),
        room.solid(x + w / 2, y, x + w / 2 + t, y + hgt, { material: mat, style }),
        room.solid(x - w / 2 - t, y - t, x + w / 2 + t, y, { material: mat, style }),
      ];
      const zone = room.zone({ x0: x - w / 2 + 0.01, y0: y, x1: x + w / 2 - 0.01, y1: y + hgt * 0.8, filter: opts.filter, onEnter: opts.onEnter });
      return { zone, bodies };
    },

    /** Stencilled chamber number on the back wall. */
    stencil(r, room, text, p) {
      const th = r.theme;
      r.text(p || new Vec2(0.25, room.H - 0.45), text, { size: 46, color: th.ink, alpha: 0.06, weight: 700, align: 'left', font: 'display' });
    },

    /** Small pressure plate drawn on top of a solid. */
    plate(r, x0, x1, y, active) {
      const th = r.theme;
      r.rect(x0, y - 0.04, x1, y, { fill: active ? th.accentSoft : th.instrument, stroke: th.ink, width: 1.2 });
      r.line(new Vec2(x0 + 0.03, y - 0.02), new Vec2(x1 - 0.03, y - 0.02), { color: active ? th.accent : th.ink3, width: 1 });
    },

    /** Bracket bolted to a ceiling with a hook point. */
    bracket(r, p, len = 0.12) {
      const th = r.theme;
      r.line(p, p.add(new Vec2(0, len)), { color: th.ink, width: 2.4 });
      r.rect(p.x - 0.07, p.y + len, p.x + 0.07, p.y + len + 0.04, { fill: th.instrument, stroke: th.ink, width: 1 });
    },

    fmt: Mathx.fmt,
  };

  Lab.Kit = Kit;
})(typeof window !== 'undefined' ? window : globalThis);
