/*
 * Nudge — the loop: title, the opening, play and pause; input into the
 * pointer, the world stepped at 240 Hz, events into sound, light and words,
 * and the save kept in this browser.
 */
(function (root) {
  'use strict';
  const Lab = root.Lab;
  const { Vec2 } = Lab;
  const Nudge = Lab.Nudge;
  const DT = 1 / 240;
  const KEY = 'nudge.world.v1';
  const PHASE_ONE = ['gravity', 'friction'];

  const store = {
    load() {
      try { const s = root.localStorage.getItem(KEY); return s ? JSON.parse(s) : null; } catch { return null; }
    },
    save(data) {
      try { root.localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* storage unavailable: play on without saving */ }
    },
    clear() {
      try { root.localStorage.removeItem(KEY); } catch { /* nothing to clear */ }
    },
  };

  const App = {
    init(hot) {
      this.canvas = document.getElementById('world');
      this.ui = {
        start: document.getElementById('start'),
        startBtn: document.getElementById('start-btn'),
        startNote: document.getElementById('start-note'),
        pause: document.getElementById('pause'),
        resumeBtn: document.getElementById('resume-btn'),
        resetBtn: document.getElementById('reset-btn'),
        newBtn: document.getElementById('new-btn'),
        muteBtn: document.getElementById('mute-btn'),
        touch: document.getElementById('touch'),
        grabBtn: document.getElementById('grab-btn'),
        tResetBtn: document.getElementById('treset-btn'),
        tPauseBtn: document.getElementById('tpause-btn'),
      };
      this.view = new Nudge.View(this.canvas);
      this.hud = new Nudge.Hud(this.view);
      this.input = new Nudge.Input(this.canvas, this);
      this.state = 'title';
      this.ghost = null;
      this.spawnPop = 0;
      this.holdReset = 0;
      const saved = (hot && hot.save) || store.load();
      this.newGame(saved);
      this.wire();
      this.view.resize();
      this.view.follow(this.game.pointer.pos, 0, true);
      if (saved && saved.checkpoint && saved.checkpoint !== 'hub:start') this.ui.startNote.textContent = '이어서 하기: 마지막 부활 지점에서 시작합니다.';
      if (root.claude && root.claude.hot && root.claude.hot.snapshot) root.claude.hot.snapshot(() => ({ save: this.game.save }));
      let last = performance.now();
      const frame = (now) => {
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        this.tick(dt);
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    },

    wire() {
      const u = this.ui;
      u.startBtn.addEventListener('click', () => this.begin());
      u.resumeBtn.addEventListener('click', () => this.resume());
      u.resetBtn.addEventListener('click', () => { this.resetHere(); this.resume(); });
      u.newBtn.addEventListener('click', () => {
        if (u.newBtn.dataset.armed !== '1') {
          u.newBtn.dataset.armed = '1';
          u.newBtn.textContent = '정말 처음부터? 한 번 더 누르기';
          setTimeout(() => { u.newBtn.dataset.armed = ''; u.newBtn.textContent = '처음부터 새로 하기'; }, 3000);
          return;
        }
        u.newBtn.dataset.armed = '';
        u.newBtn.textContent = '처음부터 새로 하기';
        store.clear();
        this.newGame(null);
        this.ui.pause.hidden = true;
        this.begin();
      });
      u.muteBtn.addEventListener('click', () => this.toggleMute());
      // Touch: hold to grab, tap to start the region over or pause.
      const hold = (on) => (e) => { e.preventDefault(); if (on) this.press(); else this.unpress(); };
      u.grabBtn.addEventListener('pointerdown', hold(true));
      u.grabBtn.addEventListener('pointerup', hold(false));
      u.grabBtn.addEventListener('pointercancel', hold(false));
      u.tResetBtn.addEventListener('click', () => {
        const now = performance.now();
        if (now - (this.tResetArmed || 0) < 2000) { this.tResetArmed = 0; this.resetHere(); } else { this.tResetArmed = now; this.askReset(); }
      });
      u.tPauseBtn.addEventListener('click', () => this.pause());
      try { Nudge.Audio.muted = root.localStorage.getItem('nudge.muted') === '1'; } catch { /* default: sound on */ }
      this.syncMute();
    },

    newGame(saved) {
      const save = saved ? { fragments: saved.fragments || {}, delivered: saved.delivered || {}, checkpoint: saved.checkpoint || 'hub:start', cleared: saved.cleared || {}, seenIntro: !!saved.seenIntro } : null;
      this.game = new Nudge.Game({ save });
      this.view.prepare(this.game);
      this.view.particles = [];
      this.view.blows = [];
      this.acc = 0;
      this.view.resize();
      this.view.follow(this.game.pointer.pos, 0, true);
    },
    persist() {
      const s = this.game.save;
      store.save({ fragments: s.fragments, delivered: s.delivered, checkpoint: s.checkpoint, cleared: s.cleared, seenIntro: !!s.seenIntro });
    },

    /* ---------------- states ---------------- */
    begin() {
      this.wake();
      this.ui.start.hidden = true;
      this.input.requestLock();
      if (!this.game.save.seenIntro) {
        this.state = 'intro';
        this.cut = new Nudge.Cutscene(this.view, Nudge.openingShots(), () => this.play());
      } else this.play();
    },
    play() {
      this.state = 'play';
      this.input.take();          // motion made during the story does not count
      this.game.save.seenIntro = true;
      this.persist();
      const R = this.game.current || this.game.byId.hub;
      this.hud.show(R.id, R.name);
      this.ui.touch.hidden = !this.input.touch;
      if (this.input.lockFailed && !this.input.touch) this.hud.toast('이 화면에서는 마우스를 잠글 수 없어요. 화면 가장자리로 가면 시야가 따라갑니다.', { life: 5 });
    },
    pause() {
      if (this.state !== 'play') return;
      this.state = 'paused';
      this.unpress();
      this.input.exitLock();
      this.ui.pause.hidden = false;
      this.ui.resumeBtn.focus();
    },
    resume() {
      if (this.state !== 'paused') return;
      this.ui.pause.hidden = true;
      this.state = 'play';
      this.input.requestLock();
    },
    onLock(locked) {
      if (!locked && this.state === 'play') this.pause();
      if (locked && this.state === 'paused') { this.ui.pause.hidden = true; this.state = 'play'; }
    },
    wake() { Nudge.Audio.unlock(); },
    onTouch() { if (this.state === 'play') this.ui.touch.hidden = false; },
    toggleMute() {
      Nudge.Audio.setMuted(!Nudge.Audio.muted);
      try { root.localStorage.setItem('nudge.muted', Nudge.Audio.muted ? '1' : '0'); } catch { /* not remembered */ }
      this.syncMute();
    },
    syncMute() {
      this.ui.muteBtn.textContent = Nudge.Audio.muted ? '소리 켜기 (M)' : '소리 끄기 (M)';
      this.ui.muteBtn.setAttribute('aria-pressed', Nudge.Audio.muted ? 'true' : 'false');
    },

    /* ---------------- the hand ---------------- */
    press() {
      if (this.state === 'intro') { this.cut.next(); return; }
      if (this.state !== 'play') return;
      if (this.input.mode !== 'lock' && !this.input.touch && !this.input.lockFailed) this.input.requestLock();
      this.game.pointer.grab();
    },
    unpress() { if (this.game) this.game.pointer.release(); },
    askReset() {
      const R = this.game.current;
      if (!R || R.id === 'hub') { this.hud.toast('문 앞의 홀은 다시 시작할 것이 없어요.'); return; }
      this.hud.toast(`${this.input.touch ? '다시 버튼' : 'R'}을 한 번 더 누르면 「${R.name}」을 처음 상태로 되돌립니다.`, { life: 2 });
    },
    resetHere() {
      const g = this.game, R = g.current;
      if (!R || R.id === 'hub') return;
      g.resetRegion(R.id);
      this.view.prepare(g);
      const cp = g.checkpoint(g.save.checkpoint);
      const here = cp && cp.region === R.id ? cp : g.byId[R.id].checkpoints[0];
      g.save.checkpoint = here.id;
      this.persist();
      g.pointer.respawn(here.pos);
      this.spawnPop = 1;
      this.hud.toast(`「${R.name}」을 처음 상태로 되돌렸어요.`);
    },

    /* ---------------- frame ---------------- */
    tick(dt) {
      const v = this.view, g = this.game, P = g.pointer;
      v.resize();
      if (this.state === 'intro') {
        this.cut.draw(dt);
        return;
      }
      if (this.state === 'play') {
        // The mouse moves the pointer: one move per frame.
        this.ghost = null;
        if (this.input.mode === 'lock') {
          const d = this.input.take();
          P.moveBy(new Vec2(d.dx / v.scale, -d.dy / v.scale), dt);
        } else if (this.input.screen) {
          const m = v.toWorld(this.input.screen.x, this.input.screen.y);
          P.moveTo(m, dt);
          this.ghost = m;
        } else P.moveBy(new Vec2(), dt);
        this.acc += dt;
        let n = 0;
        while (this.acc >= DT && n < 40) { g.step(DT); this.acc -= DT; n++; }
        if (n === 40) this.acc = 0;
        this.events();
        v.follow(P.dead ? v.cam : P.pos, dt, false);
        this.spawnPop = Math.max(0, this.spawnPop - dt * 3);
        this.ambience();
      }
      v.draw(this, dt);
      if (this.state !== 'title') this.hud.draw(this, dt);
    },

    events() {
      const g = this.game, v = this.view, hud = this.hud, A = Nudge.Audio, P = g.pointer;
      let dirty = false;
      for (const ev of g.drainEvents()) {
        A.play(ev);
        switch (ev.type) {
          case 'hit': v.blow(ev); break;
          case 'shatter': {
            v.shatterPointer(ev.p);
            const name = Nudge.SOURCE[ev.cause] || '충격';
            hud.toast(ev.cause === 'crush' ? '끼어서 부서졌다 · 90 N 넘게 눌림' : ev.cause === 'orb' ? '중력 구에 빨려 들어가 부서졌다' : `부서졌다 · ${name}`, { tone: 'alarm' });
            break;
          }
          case 'respawn':
            this.spawnPop = 1;
            if (v.cam.dist(ev.p) > 10) v.follow(ev.p, 0, true);
            break;
          case 'checkpoint': hud.toast(`부활 지점 · ${ev.name}`); dirty = true; break;
          case 'fragment': {
            const f = Nudge.FRAGMENTS.find((q) => q.id === ev.id);
            v.puff(ev.p, 'rgba(255, 214, 232, 0.95)', 40, 2.5);
            hud.toast(`열쇠 조각 「${f.name} ${f.glyph}」을 얻었다. 문으로 가져가자.`, { tone: 'joy', life: 4.5 });
            dirty = true;
            break;
          }
          case 'socket': {
            const f = Nudge.FRAGMENTS.find((q) => q.id === ev.id);
            v.sendHome(f, P.pos);
            hud.toast(`「${f.name}」 조각이 태초의 문에 자리 잡았다.`, { tone: 'joy', life: 4 });
            if (PHASE_ONE.every((id) => g.save.delivered[id])) hud.toast('남은 네 곳은 아직 봉인되어 있다. 다음 장에서 열린다.', { life: 6 });
            dirty = true;
            break;
          }
          case 'region': hud.show(ev.id, ev.name); break;
          case 'break': {
            const col = ev.wall && ev.wall.color ? ev.wall.color : '#f7a8c3';
            v.puff(ev.p, col, 46, 3.2);
            hud.toast('벽이 무너졌다!', { tone: 'joy' });
            break;
          }
          case 'pop': v.puff(ev.p, ev.color || 'rgba(247, 168, 195, 0.75)', 6, 0.9); break;
          case 'gate': v.puff(ev.p, 'rgba(203, 191, 241, 0.9)', 18, 1.6); break;
          case 'galileo': {
            const R = g.byId.gravity, mid = new Vec2((R.GV.PLATES[0] + R.GV.PLATES[1]) / 2, 0.9);
            if (ev.ok) { v.say(mid, `Δt ${(ev.dt * 1000).toFixed(0)} ms · 함께 떨어졌다`, { color: '#3f8a6c' }); hud.toast('무거운 것과 가벼운 것이 함께 닿았다. 깔때기가 열린다.', { tone: 'joy' }); }
            else if (ev.dt != null) { v.say(mid, `Δt ${(ev.dt * 1000).toFixed(0)} ms · 너무 벌어짐`, { color: '#b33f68' }); hud.toast('두 판에 닿은 시간이 0.06 s 넘게 벌어졌다. 판자가 되돌아온다.'); }
            else { v.say(mid, '한쪽 판이 비었다', { color: '#b33f68' }); hud.toast('한쪽 판에는 아무것도 닿지 않았다. 판자가 되돌아온다.'); }
            break;
          }
          case 'regionReset': v.prepare(g); break;
          default: break;
        }
      }
      if (dirty) this.persist();
    },

    /** Wind on the frost plain; a hum when a wall nearby strains. */
    ambience() {
      const g = this.game;
      const here = g.regionAt(this.view.cam);
      let strain = 0;
      for (const R of g.regions) for (const w of R.walls) if (!w.broken && this.view.cam.dist(new Vec2(w.box[0], w.box[1])) < 14) strain = Math.max(strain, w.force / w.strength);
      Nudge.Audio.ambience(here && here.id === 'friction' ? 1 : 0, strain);
    },
  };

  Nudge.App = App;
  const boot = () => {
    const hot = root.claude && root.claude.hot;
    if (hot && hot.ready) hot.ready((data) => App.init(data || {}));
    else App.init((hot && hot.data) || {});
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
