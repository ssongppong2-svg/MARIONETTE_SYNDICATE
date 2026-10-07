/*
 * Nudge — what sits on the glass: the six sockets of the key, the name of the
 * place, short messages, and the opening story.
 */
(function (root) {
  'use strict';
  const Lab = root.Lab;
  const Nudge = (Lab.Nudge = Lab.Nudge || {});

  const SUB = {
    hub: '여섯 조각을 모아 문을 열어라',
    gravity: '중력 · 무게 W = mg',
    friction: '마찰력 f = μN',
  };

  class Hud {
    constructor(view) {
      this.view = view;
      this.banner = null;
      this.toasts = [];
      this.hintT = 0;
    }
    get F() { return Nudge.FONTS; }

    show(id, name) { this.banner = { name, sub: SUB[id] || '', t: 0 }; }
    toast(text, opts = {}) {
      if (this.toasts.length && this.toasts[this.toasts.length - 1].text === text) return;
      this.toasts.push({ text, t: 0, life: opts.life || 3.2, tone: opts.tone || 'calm' });
      if (this.toasts.length > 3) this.toasts.shift();
    }

    draw(app, dt) {
      const v = this.view, c = v.ctx, W = v.W, H = v.H, g = v.game;
      c.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
      this.sockets(c, g, W);
      this.place(c, g);
      this.drawBanner(c, W, H, dt);
      this.drawToasts(c, W, H, dt);
      this.hints(c, app, W, H, dt);
    }

    /** The key: six sockets, filled as fragments are carried home. */
    sockets(c, g, W) {
      const F = Nudge.FRAGMENTS, n = F.length, gap = 30, x0 = W / 2 - ((n - 1) * gap) / 2, y = W < 600 ? 72 : 26;
      F.forEach((f, i) => {
        const x = x0 + i * gap, got = !!g.save.fragments[f.id], set = !!g.save.delivered[f.id];
        c.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
          if (k) c.lineTo(x + Math.cos(a) * 11, y + Math.sin(a) * 11); else c.moveTo(x + Math.cos(a) * 11, y + Math.sin(a) * 11);
        }
        c.closePath();
        c.fillStyle = set ? '#ffffff' : got ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.35)';
        if (set) { c.shadowColor = 'rgba(247, 168, 195, 0.9)'; c.shadowBlur = 10; }
        c.fill();
        c.shadowBlur = 0;
        c.strokeStyle = set ? '#e17fa4' : got ? '#e8a6c4' : 'rgba(155, 139, 208, 0.45)';
        c.lineWidth = 1.5;
        c.stroke();
        c.font = `700 12px ${this.F.NUM}`;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillStyle = set ? '#e17fa4' : got ? '#d28aab' : 'rgba(155, 139, 208, 0.5)';
        c.fillText(f.glyph, x, y + 1);
      });
    }

    /** Where you are, top left; the checkpoint you will wake at. */
    place(c, g) {
      const R = g.current;
      if (!R) return;
      const P = this.view.pal(R.palette || R.id);
      c.textAlign = 'left';
      c.textBaseline = 'alphabetic';
      c.font = `400 17px ${this.F.TITLE}`;
      c.fillStyle = P.ink;
      c.fillText(R.name || '', 16, 30);
      const cp = g.checkpoint(g.save.checkpoint);
      if (cp) {
        c.font = `500 12px ${this.F.KO}`;
        c.fillStyle = 'rgba(91, 77, 122, 0.65)';
        c.fillText(`부활 지점 · ${cp.name}`, 16, 48);
      }
    }

    drawBanner(c, W, H, dt) {
      const b = this.banner;
      if (!b) return;
      b.t += dt;
      const life = 3.2;
      if (b.t > life) { this.banner = null; return; }
      const a = Math.min(1, b.t / 0.4, (life - b.t) / 0.6);
      c.globalAlpha = a;
      c.textAlign = 'center';
      c.textBaseline = 'alphabetic';
      const y = H * 0.2 + (W < 600 ? 40 : 0) - (1 - Math.min(1, b.t / 0.4)) * 10;
      const size = Math.round(Math.min(46, W / 11));
      c.font = `400 ${size}px ${this.F.TITLE}`;
      const bw = Math.min(W - 32, Math.max(c.measureText(b.name).width, 220) + 64), top = y - size - 6, bh = size + 44;
      this.view.roundedPx(c, [[W / 2 - bw / 2, top], [W / 2 + bw / 2, top], [W / 2 + bw / 2, top + bh], [W / 2 - bw / 2, top + bh]], 22);
      c.fillStyle = 'rgba(255, 255, 255, 0.62)';
      c.fill();
      c.fillStyle = 'rgba(255,255,255,0.9)';
      c.fillText(b.name, W / 2 + 1.5, y + 2);
      c.fillStyle = '#6a5a94';
      c.fillText(b.name, W / 2, y);
      if (b.sub) {
        c.font = `600 15px ${this.F.NUM}`;
        c.fillStyle = 'rgba(106, 90, 148, 0.8)';
        c.fillText(b.sub, W / 2, y + 28);
      }
      c.globalAlpha = 1;
    }

    drawToasts(c, W, H, dt) {
      this.toasts = this.toasts.filter((t) => t.t < t.life);
      let y = H - 92;
      for (let i = this.toasts.length - 1; i >= 0; i--) {
        const t = this.toasts[i];
        t.t += dt;
        const a = Math.min(1, t.t / 0.2, (t.life - t.t) / 0.5);
        c.globalAlpha = Math.max(0, a);
        c.font = `500 14px ${this.F.KO}`;
        const w = Math.min(W - 32, c.measureText(t.text).width + 28), h = 32;
        const x = W / 2 - w / 2;
        this.view.roundedPx(c, [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], 16);
        c.fillStyle = t.tone === 'alarm' ? 'rgba(255, 232, 240, 0.95)' : t.tone === 'joy' ? 'rgba(255, 248, 252, 0.96)' : 'rgba(255, 255, 255, 0.9)';
        c.fill();
        c.strokeStyle = t.tone === 'alarm' ? '#ff8fb0' : t.tone === 'joy' ? '#e8a6c4' : 'rgba(155, 139, 208, 0.5)';
        c.lineWidth = 1.2;
        c.stroke();
        c.fillStyle = t.tone === 'alarm' ? '#b33f68' : '#5b4d7a';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(t.text, W / 2, y + h / 2 + 1, W - 48);
        y -= 40;
      }
      c.globalAlpha = 1;
    }

    /** Controls, quiet at the bottom; brighter for the first minute. */
    hints(c, app, W, H, dt) {
      this.hintT += dt;
      const strong = this.hintT < 60;
      const touch = app.input && app.input.touch;
      const text = touch
        ? '끌어서 움직이기 · 잡기 버튼을 누르고 있으면 잡기 · 다시 버튼: 이 구역 처음부터'
        : app.input && app.input.mode === 'lock'
          ? '마우스 왼쪽 누르고 있기: 잡기 · 놓으며 휘두르면 던지기 · R 두 번: 이 구역 처음부터 · Esc: 일시정지'
          : '마우스 왼쪽 누르고 있기: 잡기 · 화면 가장자리로 가면 시야가 따라감 · R 두 번: 구역 처음부터 · Esc: 일시정지';
      c.font = `500 12px ${this.F.KO}`;
      c.textAlign = 'center';
      c.textBaseline = 'alphabetic';
      c.fillStyle = strong ? 'rgba(91, 77, 122, 0.75)' : 'rgba(91, 77, 122, 0.4)';
      c.fillText(text, W / 2, H - 18, W - 32);
    }
  }

  /* ================================================================ */
  /**
   * The opening: five short shots drawn on the canvas. A click or a key moves
   * to the next; the last one hands over to play.
   */
  class Cutscene {
    constructor(view, shots, onDone) {
      this.view = view;
      this.shots = shots;
      this.i = 0;
      this.t = 0;
      this.onDone = onDone;
      this.done = false;
    }
    next() {
      if (this.done) return;
      if (this.t < 0.35) return;
      this.i++;
      this.t = 0;
      if (this.i >= this.shots.length) { this.done = true; this.onDone(); }
    }
    skip() { if (!this.done) { this.done = true; this.onDone(); } }
    draw(dt) {
      if (this.done) return;
      const v = this.view, c = v.ctx, W = v.W, H = v.H, F = Nudge.FONTS;
      this.t += dt;
      const shot = this.shots[this.i];
      if (this.t > shot.dur) { this.next(); if (this.done) return; }
      c.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
      const bg = c.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#2e2647');
      bg.addColorStop(1, '#4b3f6e');
      c.fillStyle = bg;
      c.fillRect(0, 0, W, H);
      const s = Math.min(W, H) / 10;
      const cx = W / 2, cy = H * 0.42;
      shot.draw(c, this.t, cx, cy, s, this);
      // Caption.
      const a = Math.min(1, this.t / 0.5, (shot.dur - this.t) / 0.4 + 0.3);
      c.globalAlpha = Math.max(0, a);
      c.textAlign = 'center';
      c.textBaseline = 'alphabetic';
      c.font = `400 ${Math.round(Math.min(24, W / 22))}px ${F.KO}`;
      c.fillStyle = '#f6efff';
      const lines = shot.text.split('\n');
      lines.forEach((ln, k) => c.fillText(ln, cx, H * 0.78 + k * 32, W - 40));
      c.globalAlpha = 1;
      // Progress and how to move on.
      c.font = `500 12px ${F.KO}`;
      c.fillStyle = 'rgba(246, 239, 255, 0.55)';
      c.fillText('클릭: 다음 · Space: 건너뛰기', cx, H - 22);
      for (let k = 0; k < this.shots.length; k++) {
        c.beginPath();
        c.arc(cx - ((this.shots.length - 1) * 12) / 2 + k * 12, H - 44, 3, 0, Math.PI * 2);
        c.fillStyle = k === this.i ? '#f7a8c3' : 'rgba(246, 239, 255, 0.3)';
        c.fill();
      }
    }
  }

  /* -- the shots -- */
  function hexKey(c, x, y, r, rot, fill, edge) {
    c.beginPath();
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + rot;
      if (k) c.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); else c.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    c.closePath();
    c.fillStyle = fill;
    c.fill();
    c.strokeStyle = edge;
    c.lineWidth = 1.5;
    c.stroke();
  }
  function door(c, x, y, r, t, glow) {
    const h = c.createRadialGradient(x, y, r * 0.2, x, y, r * 1.8);
    h.addColorStop(0, `rgba(255, 236, 247, ${0.5 * glow})`);
    h.addColorStop(1, 'rgba(255, 236, 247, 0)');
    c.fillStyle = h;
    c.beginPath();
    c.arc(x, y, r * 1.8, 0, Math.PI * 2);
    c.fill();
    for (const [k, f] of [[1, '#d9cff3'], [0.75, '#e9e2fa'], [0.5, '#f7f3ff']]) {
      c.beginPath();
      c.arc(x, y, r * k, 0, Math.PI * 2);
      c.fillStyle = f;
      c.fill();
      c.strokeStyle = '#a99ad6';
      c.lineWidth = 2;
      c.stroke();
    }
    c.strokeStyle = 'rgba(169, 154, 214, 0.7)';
    c.beginPath();
    for (let a = 0; a < Math.PI * 6; a += 0.1) {
      const rr = r * 0.05 + (a / (Math.PI * 6)) * r * 0.42;
      const px = x + Math.cos(a + t * 0.4) * rr, py = y + Math.sin(a + t * 0.4) * rr;
      if (a === 0) c.moveTo(px, py); else c.lineTo(px, py);
    }
    c.stroke();
  }
  function cursor(c, x, y, k, rot = 0) {
    const P = [[0, 0], [0, 17], [4, 13], [7, 20], [10, 19], [7, 12.5], [12, 12.5]];
    c.save();
    c.translate(x, y);
    c.rotate(rot);
    c.beginPath();
    P.forEach(([px, py], i) => (i ? c.lineTo((px - 5) * k, (py - 10) * k) : c.moveTo((px - 5) * k, (py - 10) * k)));
    c.closePath();
    c.fillStyle = '#ffffff';
    c.shadowColor = 'rgba(247, 168, 195, 0.8)';
    c.shadowBlur = 12;
    c.fill();
    c.shadowBlur = 0;
    c.strokeStyle = '#9f8bcf';
    c.lineWidth = 1.5;
    c.stroke();
    c.restore();
  }
  function arrow(c, x0, y0, x1, y1, col, w = 3) {
    const a = Math.atan2(y1 - y0, x1 - x0);
    c.strokeStyle = col;
    c.fillStyle = col;
    c.lineWidth = w;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(x0, y0);
    c.lineTo(x1 - Math.cos(a) * 8, y1 - Math.sin(a) * 8);
    c.stroke();
    c.beginPath();
    c.moveTo(x1, y1);
    c.lineTo(x1 - Math.cos(a - 0.45) * 12, y1 - Math.sin(a - 0.45) * 12);
    c.lineTo(x1 - Math.cos(a + 0.45) * 12, y1 - Math.sin(a + 0.45) * 12);
    c.closePath();
    c.fill();
  }

  function openingShots() {
    const F = () => Nudge.FONTS;
    const ease = (t) => t * t * (3 - 2 * t);
    return [
      {
        dur: 5.5,
        text: '태초에, 세상의 모든 힘은\n한 문 뒤에서 잠들어 있었다.',
        draw(c, t, x, y, s) { door(c, x, y, s * 2.2, t, Math.min(1, t / 1.5)); },
      },
      {
        dur: 6.5,
        text: '빅 브라더는 문을 잠그고, 열쇠를\n여섯 조각으로 쪼개 세상 곳곳에 숨겼다.',
        draw(c, t, x, y, s) {
          door(c, x, y, s * 2.2, t, 0.6);
          // The eye opens above the door.
          const open = ease(Math.min(1, t / 1.2));
          const ex = x, ey = y - s * 3.1, ew = s * 1.3, eh = s * 0.55 * open;
          c.fillStyle = '#fbf6ff';
          c.strokeStyle = '#a99ad6';
          c.lineWidth = 2;
          c.beginPath();
          c.ellipse(ex, ey, ew, Math.max(1, eh), 0, 0, Math.PI * 2);
          c.fill();
          c.stroke();
          c.fillStyle = '#5b4d7a';
          c.beginPath();
          c.arc(ex, ey, Math.max(1, eh * 0.75), 0, Math.PI * 2);
          c.fill();
          // The key breaks into six and scatters.
          const k = ease(Math.max(0, Math.min(1, (t - 1.6) / 2.2)));
          Nudge.FRAGMENTS.forEach((f, i) => {
            const a = -Math.PI / 2 + (i / 6) * Math.PI * 2;
            const px = x + Math.cos(a) * s * 3.6 * k, py = y + Math.sin(a) * s * 2.6 * k;
            hexKey(c, px, py, s * 0.32, t * 0.6 + i, '#ffffff', '#e17fa4');
            c.font = `700 ${Math.round(s * 0.34)}px ${F().NUM}`;
            c.textAlign = 'center';
            c.textBaseline = 'middle';
            c.fillStyle = '#e17fa4';
            c.fillText(f.glyph, px, py + 1);
          });
        },
      },
      {
        dur: 5,
        text: '너는 포인터다.\n화면 위를 떠도는, 아주 작은 화살표.',
        draw(c, t, x, y, s) {
          const k = s * 0.09 * (1 + 0.05 * Math.sin(t * 6));
          cursor(c, x + Math.sin(t * 1.3) * s * 0.4, y + Math.cos(t * 1.1) * s * 0.25, k, Math.sin(t * 2) * 0.08);
        },
      },
      {
        dur: 6.5,
        text: '너는 약하다. 미는 힘 40 N, 당기는 줄 60 N.\n세게 부딪히면 산산이 부서진다.',
        draw(c, t, x, y, s) {
          // A crate far too heavy, and a pointer leaning on it.
          const bx = x + s * 0.9, by = y + s * 0.2, bw = s * 1.6, bh = s * 1.2;
          c.fillStyle = '#ead5a8';
          c.strokeStyle = '#c3a46a';
          c.lineWidth = 2;
          Nudge.App.view.roundedPx(c, [[bx - bw / 2, by - bh / 2], [bx + bw / 2, by - bh / 2], [bx + bw / 2, by + bh / 2], [bx - bw / 2, by + bh / 2]], 8);
          c.fill();
          c.stroke();
          c.font = `600 ${Math.round(s * 0.3)}px ${F().NUM}`;
          c.fillStyle = '#7c6440';
          c.textAlign = 'center';
          c.textBaseline = 'middle';
          c.fillText('200 kg', bx, by);
          const px = bx - bw / 2 - s * 0.32 + Math.sin(t * 9) * 1.5;
          cursor(c, px, by, s * 0.08, -0.4);
          const a = Math.min(1, t / 1.2);
          arrow(c, px + s * 0.1, by - s * 0.55, px + s * 0.1 + s * 0.9 * a, by - s * 0.55, '#c3b5ff', 3);
          c.font = `600 ${Math.round(s * 0.28)}px ${F().NUM}`;
          c.fillStyle = '#f6efff';
          c.fillText('40 N', px + s * 0.55, by - s * 0.85);
          // … and something falling on it.
          if (t > 3.4) {
            const k = Math.min(1, (t - 3.4) / 0.6);
            const ry = y - s * 2.6 + k * s * 2.4;
            c.fillStyle = '#a3abc9';
            c.beginPath();
            c.arc(px - s * 1.6, ry, s * 0.28, 0, Math.PI * 2);
            c.fill();
            if (k >= 1) {
              c.font = `700 ${Math.round(s * 0.3)}px ${F().NUM}`;
              c.fillStyle = '#ff8fb0';
              c.fillText('≥ 60 N → 부서짐', px - s * 1.6, y - s * 1.2);
            }
          }
        },
      },
      {
        dur: 6,
        text: '그러니 세상의 힘을 빌려라.\n조각을 모아, 문을 열어라.',
        draw(c, t, x, y, s) {
          c.textAlign = 'center';
          c.textBaseline = 'middle';
          c.font = `400 ${Math.round(s * 1.25)}px ${F().TITLE}`;
          c.fillStyle = '#ffffff';
          c.shadowColor = 'rgba(247, 168, 195, 0.9)';
          c.shadowBlur = 18;
          c.fillText('Nudge', x, y - s * 0.6);
          c.shadowBlur = 0;
          c.font = `400 ${Math.round(s * 0.42)}px ${F().TITLE}`;
          c.fillStyle = '#e9ddff';
          c.fillText('태초의 문', x, y + s * 0.35);
          Nudge.FRAGMENTS.forEach((f, i) => {
            const px = x - s * 1.5 + i * s * 0.6, py = y + s * 1.3;
            hexKey(c, px, py, s * 0.2, Math.PI / 6, 'rgba(255,255,255,0.15)', 'rgba(255,255,255,0.5)');
            c.font = `700 ${Math.round(s * 0.2)}px ${F().NUM}`;
            c.fillStyle = 'rgba(255,255,255,0.6)';
            c.fillText(f.glyph, px, py + 1);
          });
        },
      },
    ];
  }

  Nudge.Hud = Hud;
  Nudge.Cutscene = Cutscene;
  Nudge.openingShots = openingShots;
})(typeof window !== 'undefined' ? window : globalThis);
