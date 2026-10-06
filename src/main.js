/*
 * Force Chamber — boot, title screen and main loop.
 */
(function (root) {
  'use strict';
  const Lab = root.Lab;
  const { Save, Game, Renderer, Scene, UI, Input, Sound, Mathx, Vec2, h } = Lab;

  // A host page may set data-theme itself; "system" in the game defers to it.
  const hostTheme = document.documentElement.getAttribute('data-theme');
  function applyTheme() {
    const t = Save.data.settings.theme;
    const root = document.documentElement;
    if (t === 'light' || t === 'dark') root.setAttribute('data-theme', t);
    else if (hostTheme) root.setAttribute('data-theme', hostTheme);
    else root.removeAttribute('data-theme');
    if (Lab.renderer) Lab.renderer.refreshTheme();
    if (Lab.Title && Lab.Title.r) Lab.Title.r.refreshTheme();
    if (UI.game) UI.syncToolbar();
  }
  Lab.applyTheme = applyTheme;

  /* ---------------- title screen ---------------- */
  const Title = {
    el: null, r: null, raf: 0, t0: 0,
    show() {
      const el = document.getElementById('title-screen');
      this.el = el;
      el.innerHTML = '';
      const g = UI.game;
      const cur = g.data.current && g.chamber(g.data.current);
      const firstOpen = Lab.Chambers.find((c) => g.isAvailable(c) && !g.isCleared(c)) || Lab.Chambers[0];
      const resume = cur || (g.clearedCount ? firstOpen : null);
      const canvas = h('canvas', { 'aria-hidden': 'true' });
      const start = (id) => { Sound.unlock(); this.hide(); UI.goto(id); };
      const copy = h('div', { class: 'title-copy' },
        h('div', { class: 'kicker' }, `Physics escape · Chapter 1 · ${Lab.ChapterInfo[0].code}`),
        h('h1', null, h('span', { class: 'vec' }, 'F'), 'ORCE', h('br'), 'CHAMBER'),
        h('p', { class: 'sub' }, '힘의 격실'),
        h('p', null, '무인 역학 실험동에 갇혔다. 이곳의 문은 열쇠가 아니라 물리 법칙으로 열린다. 낙하 시간을 재고, 마찰계수를 계산하고, 두 줄의 장력을 맞춰 첫 구역을 빠져나가라.'),
        h('p', null, `경고: 이 실험동의 중력은 지구와 같지 않다. 첫 격실에서 직접 재야 한다. 지금은 챕터 1(격실 01–${String(Lab.Chambers.length).padStart(2, '0')})이 열려 있고, 나머지 ${Lab.Roadmap.length}개 격실은 준비 중이다.`),
        h('div', { class: 'title-facts' },
          h('div', null, h('b', null, `${Lab.Chambers.length} / ${Lab.totalChambers()}`), '공개된 격실'),
          h('div', null, h('b', null, g.data.rooms.c01 && g.data.rooms.c01.cleared ? `${Mathx.fmt(g.lab.g, 2)}` : 'g = ?'), g.data.rooms.c01 && g.data.rooms.c01.cleared ? 'm/s² · 측정됨' : '이 실험동의 중력'),
          h('div', null, h('b', null, `${g.clearedCount}`), '개방한 격실')),
        h('div', { class: 'actions' },
          resume
            ? h('button', { class: 'btn primary', type: 'button', onclick: () => start(resume.id) }, `이어서 하기 · 격실 ${String(resume.no).padStart(2, '0')}`)
            : h('button', { class: 'btn primary', type: 'button', onclick: () => start(Lab.Chambers[0].id) }, '실험 시작'),
          h('button', { class: 'btn', type: 'button', onclick: () => { Sound.unlock(); this.hide(); UI.showMap(); } }, '격실 목록')));
      el.append(canvas, copy);
      el.hidden = false;
      this.r = new Renderer(canvas);
      this.t0 = performance.now();
      cancelAnimationFrame(this.raf);
      const loop = (now) => {
        if (el.hidden) return;
        this.draw((now - this.t0) / 1000);
        this.raf = requestAnimationFrame(loop);
      };
      this.raf = requestAnimationFrame(loop);
    },
    hide() {
      if (this.el) this.el.hidden = true;
      cancelAnimationFrame(this.raf);
    },
    /** Pendulum wave: 15 pendulums whose periods drift in and out of phase. */
    draw(t) {
      const r = this.r;
      r.resize();
      const W = 6, H = 4.6;
      r.fit(-0.2, -0.2, W + 0.2, H + 0.2, 12);
      r.begin();
      const th = r.theme;
      const fakeRoom = { W, H, def: { axisLabels: false } };
      Scene.background(r, fakeRoom);
      const N = 15, cycle = 48, K = 40;
      const top = H - 0.35;
      r.rect(0.3, top, W - 0.3, top + 0.12, { fill: th.solid, hatch: 'solid', stroke: th.ink, width: 1.2 });
      const reduced = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const time = reduced ? 7.3 : t;
      for (let i = 0; i < N; i++) {
        const T = cycle / (K + i);
        const L = 9.81 * Math.pow(T / (2 * Math.PI), 2) * 10;
        const x = 0.75 + ((W - 1.5) * i) / (N - 1);
        const amp = 0.3;
        const pivot = new Vec2(x, top);
        // Strobe ghosts.
        for (let k = 3; k >= 0; k--) {
          const tt = time - k * 0.05;
          const a = amp * Math.cos((2 * Math.PI * tt) / T);
          const bob = pivot.add(new Vec2(Math.sin(a) * L, -Math.cos(a) * L));
          if (k === 0) {
            r.line(pivot, bob, { color: th.ink2, width: 1 });
            r.circle(bob, 0.075, { fill: i % 5 === 2 ? th.accent : th.mSteel, stroke: th.ink, width: 1.3 });
          } else {
            r.circle(bob, 0.075, { stroke: th.trail, width: 1, alpha: 0.25 - k * 0.05 });
          }
        }
        r.dot(pivot, 2, th.ink);
      }
      const Tl = cycle / K;
      r.dim(new Vec2(0.75, top), new Vec2(0.75, top - 9.81 * Math.pow(Tl / (2 * Math.PI), 2) * 10), 'L₀', { off: 0.42 });
      r.text(new Vec2(W - 0.35, 0.25), `T_n = ${cycle} s / (${K} + n)`, { size: 10, color: th.ink2, align: 'right' });
    },
  };
  Lab.Title = Title;

  /* ---------------- boot ---------------- */
  function boot() {
    Save.load();
    Sound.enabled = Save.data.settings.sound !== false;
    applyTheme();
    if (root.MutationObserver) {
      new MutationObserver(() => {
        if (Lab.renderer) Lab.renderer.refreshTheme();
        if (Lab.Title && Lab.Title.r) Lab.Title.r.refreshTheme();
      }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    }
    if (root.matchMedia) {
      const mq = root.matchMedia('(prefers-color-scheme: dark)');
      const onChange = () => applyTheme();
      if (mq.addEventListener) mq.addEventListener('change', onChange); else if (mq.addListener) mq.addListener(onChange);
    }
    const game = new Game(Save.data);
    Lab.game = game;
    const canvas = document.getElementById('view');
    const renderer = new Renderer(canvas);
    Lab.renderer = renderer;
    UI.init(game);
    Input.init(game, renderer, canvas);

    const start = Save.data.current && game.chamber(Save.data.current) ? Save.data.current : Lab.Chambers[0].id;
    game.enter(start);
    Title.show();

    if (root.claude && root.claude.hot && root.claude.hot.snapshot) {
      root.claude.hot.snapshot(() => ({ current: game.data.current }));
    }

    let last = performance.now();
    const frame = (now) => {
      const dt = (now - last) / 1000;
      last = now;
      const room = game.room;
      if (room) {
        const titleUp = Title.el && !Title.el.hidden;
        const active = !titleUp && !game.modalOpen && document.visibilityState === 'visible';
        if (active) {
          game.advance(dt);
          if (!game.paused && !room.cleared) room.save.time = (room.save.time || 0) + Math.min(dt, 0.25);
        }
        if (room.cleared && room.doorOpen < 1) room.doorOpen = Math.min(1, room.doorOpen + dt / 1.6);
        if (!titleUp) {
          renderer.resize();
          const v = room.def.view || [-0.55, -0.55, room.W + 0.55, room.H + 0.55];
          const tb = document.getElementById('toolbar');
          const bottom = tb ? tb.offsetHeight + 20 : 14;
          renderer.fit(v[0], v[1], v[2], v[3], { t: 12, r: 14, b: bottom, l: 14 });
          renderer.begin();
          Scene.draw(renderer, room, game, { overlay: (r) => Input.drawOverlay(r) });
          UI.frame(room, now);
        }
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    setInterval(() => { if (game.room) game.room.persistState(); }, 5000);
    root.addEventListener('beforeunload', () => { if (game.room) game.room.persistState(); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => renderer.refreshTheme());
  }

  if (root.claude && root.claude.hot && root.claude.hot.ready) root.claude.hot.ready(boot);
  else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
