/*
 * Force Chamber — interface
 * Top bar, control rack (objective, locks, controls, hints, measurement log),
 * toolbar, toasts and modal sheets. Plain DOM, no framework.
 */
(function (root) {
  'use strict';
  const Lab = (root.Lab = root.Lab || {});
  const { Mathx, icon, Sound, Save } = Lab;

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'text') el.textContent = v;
        else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, v);
      }
    }
    for (const k of kids.flat()) {
      if (k == null || k === false) continue;
      el.append(k.nodeType ? k : document.createTextNode(String(k)));
    }
    return el;
  }
  const $ = (id) => document.getElementById(id);
  const pad2 = (n) => String(n).padStart(2, '0');
  function fmtClock(sec) {
    sec = Math.max(0, Math.floor(sec));
    const m = Math.floor(sec / 60), s = sec % 60;
    return `${pad2(m)}:${pad2(s)}`;
  }
  function decimalsOf(step) {
    const s = String(step);
    return s.includes('.') ? s.split('.')[1].length : 0;
  }
  /** Rich text: **bold**, `mono`, line breaks. */
  function rich(text) {
    const esc = String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return esc
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/`(.+?)`/g, '<span class="mono">$1</span>')
      .replace(/\n/g, '<br>');
  }

  const MODES = { M: '조작', C: '계산', B: '조립' };

  const UI = {
    game: null,
    controlsEls: new Map(),
    readoutEls: [],
    modalStack: null,

    init(game) {
      this.game = game;
      document.querySelectorAll('[data-icon]').forEach((el) => { el.outerHTML = icon(el.dataset.icon, 16); });
      $('btn-brief').onclick = () => this.game.room && this.showBrief(this.game.room);
      $('btn-notebook').onclick = () => this.showNotebook();
      $('btn-map').onclick = () => this.showMap();
      $('btn-settings').onclick = () => this.showSettings();
      $('home-btn').onclick = () => this.showTitle();
      this.buildToolbar();
      game.on('enter', (room) => this.renderRoom(room));
      game.on('reset', (room) => { this.refreshControls(room); });
      game.on('room:unlock', (room, l) => {
        Sound.unlockLock();
        this.toast(`자물쇠 ${l.letter || ''} 해제 — ${l.label}`, 'ok');
        this.renderLocks(room);
      });
      game.on('room:wrong', (room, l) => { Sound.wrong(); this.renderLocks(room); });
      game.on('room:say', (room, text, tone) => this.toast(text, tone));
      game.on('room:log', (room) => this.renderLog(room));
      game.on('room:controls', (room) => this.refreshControls(room));
      game.on('room:impact', (room, arb, P) => Sound.impact(P));
      game.on('room:break', () => Sound.snap());
      game.on('cleared', (room) => {
        Sound.door();
        this.renderPanel(room);
        setTimeout(() => { if (this.game.room === room) this.showCleared(room); }, 1400);
      });
      game.on('notebook', () => { if (this.modalKind === 'notebook') this.showNotebook(); });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !$('modal').hidden && this.modalClosable) this.closeModal();
      });
    },

    /* ---------------- toolbar ---------------- */
    buildToolbar() {
      const tb = $('toolbar');
      tb.innerHTML = '';
      const tool = (id, ic, label, key, onClick, title) => h('button', {
        class: 'tool', type: 'button', id, 'aria-pressed': 'false', title: title || label, onclick: onClick,
      }, h('span', { html: icon(ic, 17) }), h('span', { class: 'lbl' }, label), key ? h('kbd', null, key) : null);
      tb.append(
        tool('tool-hand', 'hand', '손', 'H', () => Lab.Input.setTool('hand'), '손: 장치 조작·물체 잡기'),
        tool('tool-ruler', 'ruler', '자', 'M', () => Lab.Input.setTool('ruler'), '자: 두 점 사이 거리와 각도 측정 (Esc로 지우기)'),
        h('span', { class: 'sep' }),
        tool('tool-force', 'force', '힘', 'F', () => this.toggleForces(), '힘 벡터 표시'),
        tool('tool-strobe', 'strobe', '잔상', 'T', () => this.toggleStrobe(), '스트로보 잔상 (1/20 s 간격)'),
        h('span', { class: 'sep' }),
        tool('tool-pause', 'pause', '정지', 'Space', () => this.togglePause(), '일시정지 / 재생'),
        tool('tool-step', 'step', '한 칸', '.', () => this.stepOnce(), '일시정지 상태에서 1/60 s 진행'),
        h('span', { class: 'speed-group', role: 'group', 'aria-label': '시뮬레이션 속도' },
          ...[1, 0.5, 0.25].map((s) => h('button', {
            class: 'tool', type: 'button', 'data-speed': s, 'aria-pressed': s === 1 ? 'true' : 'false',
            title: `시뮬레이션 속도 ${s}×`, onclick: () => this.setSpeed(s),
          }, `${s}×`))),
        h('span', { class: 'sep' }),
        tool('tool-reset', 'reset', '리셋', 'R', () => this.resetRoom(), '격실 초기화 (해제한 자물쇠는 유지)'),
      );
      this.syncToolbar();
    },
    syncToolbar() {
      const g = this.game;
      const set = (id, on) => { const el = $(id); if (el) el.setAttribute('aria-pressed', on ? 'true' : 'false'); };
      set('tool-hand', Lab.Input && Lab.Input.tool === 'hand');
      set('tool-ruler', Lab.Input && Lab.Input.tool === 'ruler');
      set('tool-force', g.showForces);
      set('tool-strobe', g.strobe);
      set('tool-pause', g.paused);
      const pb = $('tool-pause');
      if (pb) {
        pb.querySelector('span').innerHTML = icon(g.paused ? 'play' : 'pause', 17);
        pb.querySelector('.lbl').textContent = g.paused ? '재생' : '정지';
      }
      document.querySelectorAll('[data-speed]').forEach((b) => b.setAttribute('aria-pressed', Number(b.dataset.speed) === g.timeScale ? 'true' : 'false'));
      const lg = $('force-legend');
      if (g.showForces) {
        lg.hidden = false;
        const th = Lab.readTheme();
        lg.innerHTML = [['중력', th.fGravity], ['수직항력', th.fNormal], ['마찰력', th.fFriction], ['장력', th.fTension], ['탄성력', th.fSpring], ['부력', th.fBuoy]]
          .map(([n, c]) => `<span><i style="background:${c}"></i>${n}</span>`).join('');
      } else lg.hidden = true;
    },
    toggleForces() { this.game.showForces = !this.game.showForces; this.syncToolbar(); },
    toggleStrobe() {
      this.game.strobe = !this.game.strobe;
      if (!this.game.strobe && this.game.room) this.game.room.clearTrails();
      this.syncToolbar();
    },
    togglePause() { this.game.paused = !this.game.paused; this.syncToolbar(); },
    setSpeed(s) { this.game.timeScale = s; this.syncToolbar(); },
    stepOnce() {
      const g = this.game;
      if (!g.room) return;
      g.paused = true;
      for (let i = 0; i < 4; i++) g.room.step(Lab.DT);
      this.syncToolbar();
    },
    resetRoom() {
      this.game.resetRoom();
      this.toast('격실을 초기 상태로 되돌렸습니다', 'info');
    },

    /* ---------------- toasts ---------------- */
    toast(text, tone = 'info') {
      const box = $('toasts');
      const el = h('div', { class: 'toast ' + tone, html: rich(text) });
      box.append(el);
      while (box.children.length > 3) box.firstChild.remove();
      setTimeout(() => el.remove(), tone === 'warn' || tone === 'bad' ? 5200 : 3800);
    },

    /* ---------------- chamber panel ---------------- */
    renderRoom(room) {
      const def = room.def;
      $('chamber-chip').innerHTML = '';
      $('chamber-chip').append(
        h('span', { class: 'no' }, pad2(def.no), h('span', null, ` / ${pad2(Lab.totalChambers())}`)),
        h('span', { class: 'name' }, def.title),
        h('span', { class: 'code' }, `CH.${def.chapter || 1} · ${def.code}`),
      );
      document.title = `${pad2(def.no)} ${def.title} · Force Chamber`;
      this.renderPanel(room);
    },

    renderPanel(room) {
      const panel = $('panel');
      panel.innerHTML = '';
      const def = room.def;
      this.controlsEls = new Map();
      this.readoutEls = [];

      const head = h('section', null,
        h('h2', null, '목표', h('span', { class: 'tags' }, ...(def.modes || []).map((m) => h('span', { class: 'tag mode', title: MODES[m] }, MODES[m])))),
        h('p', { class: 'objective', html: rich(def.objective || '') }),
        def.tags ? h('div', { class: 'tags' }, ...def.tags.map((t) => h('span', { class: 'tag' }, t))) : null,
      );
      panel.append(head);

      this.locksEl = h('section', { id: 'locks' });
      panel.append(this.locksEl);
      this.renderLocks(room);

      const ctrl = h('section', { id: 'controls' }, h('h2', null, '조작'));
      this.buildControls(room, ctrl);
      panel.append(ctrl);

      this.hintsEl = h('section', { id: 'hints' });
      panel.append(this.hintsEl);
      this.renderHints(room);

      this.logEl = h('section', { id: 'log' });
      panel.append(this.logEl);
      this.renderLog(room);

      if (room.cleared) {
        const next = Lab.Chambers.find((c) => c.no === def.no + 1);
        panel.append(h('div', { class: 'next-cta' },
          h('button', { class: 'btn', type: 'button', onclick: () => this.showCleared(room) }, '해설 보기'),
          next
            ? h('button', { class: 'btn primary', type: 'button', onclick: () => this.goto(next.id) }, `다음 격실 ${pad2(next.no)} →`)
            : h('button', { class: 'btn primary', type: 'button', onclick: () => this.showChapterComplete(def.chapter || 1) }, `챕터 ${def.chapter || 1} 완료`)));
      }
    },

    renderLocks(room) {
      const el = this.locksEl;
      if (!el) return;
      el.innerHTML = '';
      const openN = room.locks.filter((l) => l.open).length;
      el.append(h('h2', null, '자물쇠', h('span', { class: 'mono' }, `${openN} / ${room.locks.length}`)));
      room.locks.forEach((l, i) => {
        l.letter = l.letter || String.fromCharCode(65 + i);
        const box = h('div', { class: 'lock' + (l.open ? ' open' : '') },
          h('div', { class: 'lamp', 'aria-label': l.open ? '열림' : '잠김' }, l.letter),
          h('div', { class: 'lbl' }, l.label),
          l.desc ? h('div', { class: 'desc', html: rich(typeof l.desc === 'function' ? l.desc(room) : l.desc) }) : null,
        );
        const waiting = l.requires && !room.isOpen(l.requires);
        if (l.kind === 'code' && !l.open && waiting) {
          const req = room.getLock(l.requires);
          box.append(h('div', { class: 'status' }, `자물쇠 ${req ? req.letter || '' : ''}를 먼저 열어야 입력할 수 있다.`));
        } else if (l.kind === 'code' && !l.open) {
          const input = h('input', {
            type: 'text', inputmode: 'decimal', autocomplete: 'off', id: `lock-${room.id}-${l.id}`,
            placeholder: l.placeholder || '값 입력', 'aria-label': `${l.label} 값`,
          });
          const status = h('div', { class: 'status' });
          const entry = h('div', { class: 'entry' }, input, l.unit ? h('span', { class: 'unit' }, l.unit) : null);
          const submit = () => {
            Sound.unlock();
            const res = room.submitCode(l.id, input.value);
            if (res.ok) return;
            entry.classList.remove('shake');
            void entry.offsetWidth;
            entry.classList.add('shake');
            status.classList.add('bad');
            if (res.invalid) status.textContent = '숫자를 입력하세요.';
            else if (res.cooldown && res.cooldown > 0) {
              status.textContent = `세 번 틀렸습니다. ${res.cooldown}초 동안 잠깁니다.`;
              const until = Date.now() + res.cooldown * 1000;
              const iv = setInterval(() => {
                const left = Math.ceil((until - Date.now()) / 1000);
                if (left <= 0 || !status.isConnected) { clearInterval(iv); status.textContent = ''; return; }
                status.textContent = `세 번 틀렸습니다. ${left}초 동안 잠깁니다.`;
              }, 500);
            } else status.textContent = `틀렸습니다. (${l.wrong}회)`;
          };
          input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); e.stopPropagation(); });
          entry.append(h('button', { class: 'btn primary', type: 'button', onclick: submit }, '확인'));
          box.append(entry, status);
        } else if (l.kind === 'task' && !l.open && l.status) {
          box.append(h('div', { class: 'status', 'data-lock-status': l.id }, ''));
        }
        el.append(box);
      });
    },

    buildControls(room, wrap) {
      let row = null, rowKey = null;
      for (const c of room.controls) {
        if (c.type === 'button' && c.row && c.row === rowKey && row) {
          row.append(this.makeButton(room, c));
          continue;
        }
        rowKey = null; row = null;
        if (c.type === 'section') wrap.append(h('div', { class: 'ctrl-section' }, c.title));
        else if (c.type === 'note') wrap.append(h('p', { class: 'ctrl-note', html: rich(c.text) }));
        else if (c.type === 'slider') wrap.append(this.makeSlider(room, c));
        else if (c.type === 'choice') wrap.append(this.makeChoice(room, c));
        else if (c.type === 'readout') {
          const v = h('span', { class: 'mono' }, '—');
          const el = h('div', { class: 'readout' }, h('span', null, c.label), v);
          this.readoutEls.push({ c, v, el });
          wrap.append(el);
        } else if (c.type === 'button') {
          row = h('div', { class: 'btn-row' }, this.makeButton(room, c));
          rowKey = c.row || null;
          wrap.append(row);
        }
      }
      this.refreshControls(room);
    },
    makeButton(room, c) {
      const b = h('button', {
        class: 'btn' + (c.primary ? ' primary' : ''), type: 'button', id: `ctl-${room.id}-${c.id}`,
        title: c.title || null,
        onclick: () => { Sound.unlock(); Sound.click(); c.onClick(room); this.refreshControls(room); },
      }, c.label);
      this.controlsEls.set(c.id, { c, el: b });
      return b;
    },
    makeSlider(room, c) {
      const digits = c.digits != null ? c.digits : decimalsOf(c.step);
      const val = () => room.value(c.id);
      const num = h('input', { type: 'text', inputmode: 'decimal', id: `ctl-${room.id}-${c.id}`, 'aria-label': c.label, autocomplete: 'off' });
      const range = h('input', { type: 'range', min: c.min, max: c.max, step: c.step, 'aria-label': c.label + ' 슬라이더', id: `rng-${room.id}-${c.id}` });
      const set = (v) => {
        v = Mathx.clamp(Mathx.round(Mathx.snap(v - c.min, c.step) + c.min, digits + 2), c.min, c.max);
        room.setValue(c.id, v);
        sync();
      };
      const sync = () => {
        const v = val();
        if (document.activeElement !== num) num.value = Mathx.fmt(v, digits);
        range.value = v;
      };
      range.addEventListener('input', () => set(parseFloat(range.value)));
      num.addEventListener('change', () => {
        const v = parseFloat(String(num.value).replace(',', '.'));
        if (isFinite(v)) set(v); else sync();
      });
      num.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { num.blur(); }
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          set(val() + (e.key === 'ArrowUp' ? 1 : -1) * c.step * (e.shiftKey ? 10 : 1));
        }
      });
      num.addEventListener('blur', sync);
      const nudge = (dir) => h('button', {
        class: 'nudge', type: 'button', title: `${dir > 0 ? '+' : '−'}${c.step} (Shift: ×10)`,
        'aria-label': `${c.label} ${dir > 0 ? '증가' : '감소'}`,
        onclick: (e) => set(val() + dir * c.step * (e.shiftKey ? 10 : 1)),
      }, dir > 0 ? '+' : '−');
      const el = h('div', { class: 'ctrl' },
        h('div', { class: 'ctrl-head' },
          h('label', { for: `ctl-${room.id}-${c.id}` }, c.label),
          h('span', { class: 'ctrl-value' }, num, h('span', { class: 'unit' }, c.unit || ''))),
        h('div', { class: 'ctrl-row' }, nudge(-1), range, nudge(1)),
        c.help ? h('p', { class: 'ctrl-note', html: rich(c.help) }) : null,
      );
      this.controlsEls.set(c.id, { c, el, sync, inputs: [num, range] });
      sync();
      return el;
    },
    makeChoice(room, c) {
      const btns = c.options.map((o) => h('button', {
        type: 'button', 'data-value': String(o.value),
        onclick: () => { Sound.unlock(); Sound.click(); room.setValue(c.id, o.value); this.refreshControls(room); },
      }, o.label));
      const el = h('div', { class: 'ctrl' },
        h('div', { class: 'ctrl-head' }, h('label', null, c.label)),
        h('div', { class: 'choice', role: 'group', 'aria-label': c.label }, ...btns));
      this.controlsEls.set(c.id, { c, el, btns });
      return el;
    },
    refreshControls(room) {
      if (!room || room !== this.game.room) return;
      for (const { c, el, sync, inputs, btns } of this.controlsEls.values()) {
        const disabled = c.disabled ? !!c.disabled(room) : false;
        if (c.type === 'button') {
          el.disabled = disabled;
          if (c.dynamicLabel) el.textContent = c.dynamicLabel(room);
        } else if (c.type === 'slider') {
          inputs.forEach((i) => { i.disabled = disabled; });
          el.querySelectorAll('.nudge').forEach((b) => { b.disabled = disabled; });
          sync();
        } else if (c.type === 'choice') {
          const v = room.value(c.id);
          btns.forEach((b, i) => {
            b.setAttribute('aria-pressed', String(c.options[i].value) === String(v) ? 'true' : 'false');
            const od = c.options[i].disabled ? c.options[i].disabled(room) : false;
            b.disabled = disabled || od;
          });
        }
      }
    },

    renderHints(room) {
      const el = this.hintsEl;
      if (!el) return;
      el.innerHTML = '';
      const hints = room.def.hints || [];
      const used = Math.min(room.save.hints || 0, hints.length);
      el.append(h('h2', null, '힌트', h('span', { class: 'mono' }, `${used} / ${hints.length}`)));
      const box = h('div', { class: 'hint-box' });
      for (let i = 0; i < used; i++) box.append(h('div', { class: 'hint', html: rich(hints[i]) }));
      if (used < hints.length) {
        const row = h('div', { class: 'confirm-row' });
        const ask = h('button', { class: 'btn ghost', type: 'button' }, used ? '다음 힌트' : '힌트 보기');
        ask.onclick = () => {
          row.innerHTML = '';
          row.append(
            h('span', null, room.cleared ? '해제 후에는 별점에 영향이 없습니다.' : '힌트를 보면 이 격실의 별점이 하나 줄어듭니다.'),
            h('button', { class: 'btn', type: 'button', onclick: () => {
              room.save.hints = used + 1;
              this.game.persist();
              this.renderHints(room);
            } }, '보기'),
            h('button', { class: 'btn ghost', type: 'button', onclick: () => this.renderHints(room) }, '취소'));
        };
        row.append(ask);
        box.append(row);
      }
      el.append(box);
    },

    renderLog(room) {
      const el = this.logEl;
      if (!el) return;
      el.innerHTML = '';
      el.append(h('h2', null, '측정 기록', room.logLines.length ? h('span', { class: 'mono' }, room.logLines.length) : null));
      if (!room.logLines.length) {
        el.append(h('p', { class: 'log-empty' }, '광문·센서가 잡아낸 값이 여기에 쌓입니다.'));
        return;
      }
      const list = h('div', { class: 'log' });
      for (const l of room.logLines) list.append(h('div', null, h('b', null, `${Mathx.fmt(l.t, 2)} s`), h('span', null, l.text)));
      el.append(list);
    },

    /** Called every animation frame (cheap updates only). */
    frame(room, realTime) {
      if (!room) return;
      if (!this._last || realTime - this._last > 90) {
        this._last = realTime;
        for (const r of this.readoutEls) {
          let v;
          try { v = r.c.get(room); } catch (e) { v = '—'; }
          if (r.v.textContent !== v) r.v.textContent = v;
        }
        for (const l of room.locks) {
          if (l.kind === 'task' && !l.open && l.status) {
            const el = document.querySelector(`[data-lock-status="${l.id}"]`);
            if (el) {
              const s = l.status(room) || '';
              if (el.textContent !== s) el.textContent = s;
            }
          }
        }
        const sc = $('sim-clock');
        sc.textContent = `${this.game.paused ? '정지 · ' : ''}t = ${Mathx.fmt(room.time, 3)} s${this.game.timeScale !== 1 ? ` · ${this.game.timeScale}×` : ''}${room.editing ? ' · 편집' : ''}`;
        sc.classList.toggle('paused', this.game.paused || room.editing);
        $('stopwatch').textContent = `⏱ ${fmtClock(room.save.time || 0)}`;
      }
    },

    /* ---------------- modals ---------------- */
    openModal(content, opts = {}) {
      const m = $('modal');
      m.innerHTML = '';
      const sheet = h('div', { class: 'sheet' + (opts.wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.label || '' }, content);
      m.append(sheet);
      m.hidden = false;
      this.modalClosable = opts.closable !== false;
      this.modalKind = opts.kind || null;
      this.onModalClose = opts.onClose || null;
      m.onclick = (e) => { if (e.target === m && this.modalClosable) this.closeModal(); };
      const f = sheet.querySelector('.btn.primary') || sheet.querySelector('button');
      if (f) setTimeout(() => f.focus({ preventScroll: true }), 30);
      this.game.modalOpen = true;
    },
    closeModal() {
      const m = $('modal');
      m.hidden = true;
      m.innerHTML = '';
      this.game.modalOpen = false;
      this.modalKind = null;
      const cb = this.onModalClose;
      this.onModalClose = null;
      if (cb) cb();
    },

    showBrief(room) {
      const def = room.def;
      const body = h('div', { style: 'display:flex;flex-direction:column;gap:14px' },
        h('div', { class: 'eyebrow' }, `격실 ${pad2(def.no)} · ${def.code}`),
        h('h1', null, def.title),
        ...(def.briefing || []).map((p) => h('p', { html: rich(p) })),
        h('div', { class: 'brief-meta' },
          h('div', null, h('b', null, '방식'), (def.modes || []).map((m) => MODES[m]).join(' · ')),
          h('div', null, h('b', null, '개념'), (def.tags || []).join(', ')),
          h('div', null, h('b', null, '자물쇠'), `${room.locks.length}개`),
        ),
        def.tools ? h('p', { class: 'ctrl-note', html: rich(def.tools) }) : null,
        h('div', { class: 'actions' },
          h('button', { class: 'btn primary', type: 'button', onclick: () => this.closeModal() }, room.time > 0.5 ? '계속하기' : '실험 시작')));
      this.openModal(body, { label: def.title, kind: 'brief' });
    },

    showCleared(room) {
      const def = room.def, s = room.save;
      const stars = Math.max(1, 3 - (s.hints || 0));
      const frag = def.no < Lab.totalChambers() ? this.game.fragment(def.no) : null;
      const next = Lab.Chambers.find((c) => c.no === def.no + 1);
      const explain = h('div', { class: 'explain' });
      for (const block of def.explain || []) {
        if (block.f) explain.append(h('div', { class: 'formula', html: rich(block.f) }));
        else explain.append(h('p', { html: rich(typeof block === 'function' ? block(room) : block.p || block) }));
      }
      const body = h('div', { style: 'display:flex;flex-direction:column;gap:14px' },
        h('div', { class: 'eyebrow' }, `격실 ${pad2(def.no)} 개방`),
        h('h1', null, def.clearTitle || `${def.title} — 통과`),
        h('div', { class: 'stats' },
          h('div', { class: 'stat' }, h('b', null, fmtClock(s.time || 0)), h('span', null, '소요 시간')),
          h('div', { class: 'stat' }, h('b', null, String(s.hints || 0)), h('span', null, '사용한 힌트')),
          h('div', { class: 'stat' }, h('b', null, String(room.locks.reduce((a, l) => a + l.wrong, 0))), h('span', null, '오답')),
          h('div', { class: 'stat' }, h('div', { class: 'stars', 'aria-label': `별 ${stars}개` }, '★'.repeat(stars), h('span', { class: 'off' }, '★'.repeat(3 - stars))), h('span', null, '평가'))),
        frag ? h('div', { class: 'fragment' },
          h('span', { class: 'glyph' }, frag.glyph), h('span', { class: 'digit' }, String(frag.digit)),
          h('p', { class: 'ctrl-note' }, '문틀에 새겨진 조각. 마지막 격실의 문이 이 기호를 묻습니다. 실험 노트에 기록했습니다.')) : null,
        h('h2', null, '해설'),
        explain,
        h('div', { class: 'actions' },
          h('button', { class: 'btn', type: 'button', onclick: () => this.closeModal() }, '격실에 머무르기'),
          next
            ? h('button', { class: 'btn primary', type: 'button', onclick: () => { this.closeModal(); this.goto(next.id); } }, `다음 격실 ${pad2(next.no)} →`)
            : h('button', { class: 'btn primary', type: 'button', onclick: () => { this.closeModal(); this.showChapterComplete(def.chapter || 1); } }, `챕터 ${def.chapter || 1} 완료`)));
      this.openModal(body, { label: '격실 개방', kind: 'cleared' });
    },

    showChapterComplete(no) {
      const g = this.game;
      const info = Lab.ChapterInfo.find((c) => c.no === no) || { name: '', code: '' };
      const nextInfo = Lab.ChapterInfo.find((c) => c.no === no + 1);
      const rooms = Lab.Chambers.filter((c) => (c.chapter || 1) === no);
      const done = rooms.filter((c) => g.isCleared(c)).length;
      const total = rooms.reduce((a, c) => a + ((g.data.rooms[c.id] || {}).time || 0), 0);
      const stars = rooms.reduce((a, c) => a + ((g.data.rooms[c.id] || {}).stars || 0), 0);
      const frags = Save.data.notebook.filter((n) => n.kind === 'fragment');
      const body = h('div', { style: 'display:flex;flex-direction:column;gap:14px' },
        h('div', { class: 'eyebrow' }, `CHAPTER ${no} · ${info.code}`),
        h('h1', null, done === rooms.length ? `${info.name}을 통과했습니다` : `${info.name} · ${done} / ${rooms.length}`),
        h('p', null, `이 실험동의 중력 가속도는 ${g.isCleared(Lab.Chambers[0]) ? Mathx.fmt(g.lab.g, 2) + ' m/s²' : '아직 측정되지 않았'}${g.isCleared(Lab.Chambers[0]) ? '입니다' : '습니다'}. 모은 문틀 조각 ${frags.length}개는 실험 노트에 기록되어 있습니다.`),
        h('div', { class: 'stats' },
          h('div', { class: 'stat' }, h('b', null, `${done} / ${rooms.length}`), h('span', null, '개방한 격실')),
          h('div', { class: 'stat' }, h('b', null, fmtClock(total)), h('span', null, '챕터 소요 시간')),
          h('div', { class: 'stat' }, h('b', null, `${stars} / ${rooms.length * 3}`), h('span', null, '별점'))),
        nextInfo ? h('div', { class: 'fragment' },
          h('span', { class: 'glyph' }, '⋯'),
          h('div', null,
            h('b', null, `챕터 ${nextInfo.no} · ${nextInfo.name} — 준비 중`),
            h('p', { class: 'ctrl-note' }, nextInfo.blurb))) : null,
        h('p', { class: 'ctrl-note' }, '설정 → 새 실험 시작을 누르면 중력과 모든 미지수가 다시 정해집니다. 같은 격실도 전혀 다른 답을 요구합니다.'),
        h('div', { class: 'actions' },
          h('button', { class: 'btn', type: 'button', onclick: () => { this.closeModal(); this.showMap(); } }, '격실 목록'),
          h('button', { class: 'btn primary', type: 'button', onclick: () => this.closeModal() }, '닫기')));
      this.openModal(body, { label: `챕터 ${no}`, kind: 'chapter' });
    },

    showMap() {
      const g = this.game;
      const sections = [];
      for (const ch of Lab.ChapterInfo) {
        const grid = h('div', { class: 'map-grid' });
        const playable = Lab.Chambers.filter((c) => (c.chapter || 1) === ch.no);
        const planned = Lab.Roadmap.filter((c) => c.chapter === ch.no);
        for (const def of playable) {
          const r = g.data.rooms[def.id] || {};
          const avail = g.isAvailable(def);
          const cleared = g.isCleared(def);
          const stars = r.stars || 0;
          grid.append(h('button', {
            class: 'map-card' + (cleared ? ' cleared' : '') + (g.room && g.room.id === def.id ? ' current' : ''),
            type: 'button', disabled: !avail,
            onclick: () => { this.closeModal(); this.goto(def.id); },
          },
          h('div', { class: 'no' }, pad2(def.no), h('small', null, def.code)),
          h('div', { class: 't' }, def.title),
          h('div', { class: 'c' }, (def.tags || []).join(' · ')),
          h('div', { class: 'st' }, cleared ? `개방 ${'★'.repeat(stars)}` : avail ? (r.time ? `진행 중 · ${fmtClock(r.time)}` : '열림') : '잠김')));
        }
        for (const item of planned) {
          grid.append(h('button', { class: 'map-card planned', type: 'button', disabled: true, 'aria-label': `${item.title} 준비 중` },
            h('div', { class: 'no' }, pad2(item.no), h('small', null, item.code)),
            h('div', { class: 't' }, item.title),
            h('div', { class: 'c' }, item.tags.join(' · ')),
            h('div', { class: 'st' }, '준비 중')));
        }
        sections.push(h('div', { class: 'map-chapter' },
          h('div', { class: 'map-chapter-head' },
            h('h2', null, `챕터 ${ch.no} · ${ch.name}`),
            h('span', { class: 'mono' }, playable.length ? `${playable.filter((c) => g.isCleared(c)).length} / ${playable.length} 개방` : '준비 중')),
          h('p', { class: 'ctrl-note' }, ch.blurb),
          grid));
      }
      const body = h('div', { style: 'display:flex;flex-direction:column;gap:18px' },
        h('div', { class: 'eyebrow' }, `${g.clearedCount} / ${Lab.Chambers.length} 개방 · 전체 ${Lab.totalChambers()}격실 중 ${Lab.Chambers.length}격실 공개`),
        h('h1', null, '격실 목록'),
        h('p', { class: 'ctrl-note' }, '앞 격실을 열어야 다음 격실에 들어갈 수 있습니다. 연 격실은 언제든 다시 들어갈 수 있습니다.'),
        ...sections,
        h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', onclick: () => this.closeModal() }, '닫기')));
      this.openModal(body, { wide: true, label: '격실 목록', kind: 'map' });
    },

    showNotebook() {
      const nb = Save.data.notebook.slice().sort((a, b) => (a.room || 0) - (b.room || 0));
      const constants = nb.filter((n) => n.kind !== 'fragment');
      const frags = nb.filter((n) => n.kind === 'fragment');
      const body = h('div', { style: 'display:flex;flex-direction:column;gap:14px' },
        h('div', { class: 'eyebrow' }, 'LAB NOTEBOOK'),
        h('h1', null, '실험 노트'),
        h('p', { class: 'ctrl-note' }, '격실에서 확정한 측정값과 문틀 조각이 자동으로 기록됩니다.'),
        h('h2', null, '확정한 값'),
        constants.length
          ? h('div', { class: 'notebook' }, ...constants.map((n) => h('div', { class: 'nb-row' }, h('span', null, `${pad2(n.room || 0)} · ${n.text}`), h('b', null, n.value))))
          : h('p', { class: 'log-empty' }, '아직 확정한 값이 없습니다.'),
        h('h2', null, '문틀 조각'),
        frags.length
          ? h('div', { class: 'notebook' }, ...frags.map((n) => h('div', { class: 'nb-row' }, h('span', null, n.text), h('b', null, n.value))))
          : h('p', { class: 'log-empty' }, '격실을 열 때마다 조각이 하나씩 드러납니다.'),
        h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', onclick: () => this.closeModal() }, '닫기')));
      this.openModal(body, { label: '실험 노트', kind: 'notebook' });
    },

    showSettings() {
      const g = this.game;
      const st = Save.data.settings;
      const themeChoice = h('div', { class: 'choice' }, ...[['system', '시스템'], ['light', '밝게'], ['dark', '어둡게']].map(([v, l]) =>
        h('button', { type: 'button', 'aria-pressed': st.theme === v ? 'true' : 'false', onclick: () => { st.theme = v; Save.write(); Lab.applyTheme(); this.showSettings(); } }, l)));
      const soundChoice = h('div', { class: 'choice' }, ...[[true, '켜기'], [false, '끄기']].map(([v, l]) =>
        h('button', { type: 'button', 'aria-pressed': st.sound === v ? 'true' : 'false', onclick: () => { st.sound = v; Sound.enabled = v; Save.write(); this.showSettings(); } }, l)));
      const resetRow = h('div', { class: 'confirm-row' });
      const askReset = () => {
        resetRow.innerHTML = '';
        resetRow.append(
          h('span', null, '모든 진행과 미지수가 새로 정해집니다.'),
          h('button', { class: 'btn', type: 'button', style: 'border-color:var(--danger);color:var(--danger)', onclick: () => { Save.reset(); location.reload(); } }, '초기화'),
          h('button', { class: 'btn ghost', type: 'button', onclick: () => { resetRow.innerHTML = ''; resetRow.append(resetBtn); } }, '취소'));
      };
      const resetBtn = h('button', { class: 'btn', type: 'button', onclick: askReset }, '새 실험 시작');
      resetRow.append(resetBtn);
      const body = h('div', { style: 'display:flex;flex-direction:column;gap:6px' },
        h('div', { class: 'eyebrow' }, 'SETTINGS'),
        h('h1', null, '설정'),
        h('div', { class: 'settings-row' }, h('span', null, '화면 테마'), themeChoice),
        h('div', { class: 'settings-row' }, h('span', null, '소리'), soundChoice),
        h('div', { class: 'settings-row' }, h('span', null, '실험 번호 (시드)'), h('b', { class: 'mono' }, String(g.lab.seed))),
        h('div', { class: 'settings-row' }, h('span', null, '진행 초기화'), resetRow),
        h('p', { class: 'ctrl-note', style: 'margin-top:8px' }, '단축키 — H 손 · M 자 · F 힘 · T 잔상 · Space 정지 · . 한 칸 · R 리셋 · Esc 측정 지우기'),
        h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', onclick: () => this.closeModal() }, '닫기')));
      this.openModal(body, { label: '설정', kind: 'settings' });
    },

    goto(id) {
      const room = this.game.enter(id);
      if (room && !room.cleared && (room.save.time || 0) < 1) this.showBrief(room);
    },

    showTitle() { if (Lab.Title) Lab.Title.show(); },
  };

  Lab.UI = UI;
  Lab.h = h;
  Lab.rich = rich;
  Lab.fmtClock = fmtClock;
})(typeof window !== 'undefined' ? window : globalThis);
