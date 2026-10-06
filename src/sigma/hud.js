/*
 * ΣF — the instrument layer. Every number the room knows, all the time:
 * object tags, device cards with their formulas, a live free-body diagram,
 * the tow line's readout, a top telemetry bar, LED meters, a phosphor scope
 * and an event log.
 */
(function (root) {
  'use strict';
  const Lab = root.Lab;
  const { Vec2 } = Lab;
  const Sigma = (Lab.Sigma = Lab.Sigma || {});

  const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : '—');
  const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : '—');
  const f3 = (v) => (Number.isFinite(v) ? v.toFixed(3) : '—');
  const clock = (t) => {
    const m = Math.floor(t / 60), s = t - m * 60;
    return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`;
  };

  /* ---------------- drawing helpers ---------------- */

  /** Size of a card of lines: {t: title} | {k, v, c?} | {s: plain text, c?} | {bar, c?}. */
  function measure(view, c, lines, o = {}) {
    const fs = o.size || (view.compact ? 9 : 10), lh = fs + 4, pad = 6;
    c.font = view.font(fs);
    let w = o.minW || 0;
    for (const l of lines) {
      if (l.t) { c.font = view.font(fs, 'sans', 600); w = Math.max(w, c.measureText(l.t).width); c.font = view.font(fs); }
      else if (l.k != null) w = Math.max(w, c.measureText(l.k).width + c.measureText(l.v).width + 14);
      else if (l.s) w = Math.max(w, c.measureText(l.s).width);
    }
    return { w: w + pad * 2, h: lines.length * lh + pad * 2 - 3, fs, lh, pad };
  }

  function card(view, c, x, y, lines, o = {}) {
    const C = Sigma.C;
    const m = measure(view, c, lines, o);
    const { w, h, fs, lh, pad } = m;
    // Keep inside the room area, and off the cards already placed this frame.
    const minY = view.top + 2, maxY = view.H - view.bottom - h - 2;
    x = Math.max(4, Math.min(view.W - w - 4, x));
    y = Math.max(minY, Math.min(maxY, y));
    if (!o.fixed && HUD.placed) {
      for (let k = 0; k < 8; k++) {
        const hit = HUD.placed.find((p) => overlap({ x, y, w, h }, p) > 0);
        if (!hit) break;
        if (hit.y + hit.h + 4 + h <= view.H - view.bottom - 2) y = hit.y + hit.h + 4;
        else if (hit.x + hit.w + 4 + w <= view.W - 4) x = hit.x + hit.w + 4;
        else break;
      }
    }
    if (o.anchor) {
      const [ax, ay] = o.anchor;
      const cx = Math.max(x, Math.min(x + w, ax)), cy = Math.max(y, Math.min(y + h, ay));
      c.strokeStyle = o.line || C.cyanFaint;
      c.lineWidth = 1;
      c.beginPath(); c.moveTo(ax, ay); c.lineTo(cx, cy); c.stroke();
      c.fillStyle = o.line || C.cyanDim;
      c.fillRect(ax - 1.5, ay - 1.5, 3, 3);
    }
    c.fillStyle = C.panel;
    c.fillRect(x, y, w, h);
    c.strokeStyle = o.border || C.panelLine;
    c.lineWidth = 1;
    c.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    // Corner ticks: an instrument look.
    c.strokeStyle = o.accent || C.cyan;
    c.beginPath();
    c.moveTo(x, y + 6); c.lineTo(x, y); c.lineTo(x + 6, y);
    c.moveTo(x + w - 6, y + h); c.lineTo(x + w, y + h); c.lineTo(x + w, y + h - 6);
    c.stroke();
    let ly = y + pad + fs;
    for (const l of lines) {
      if (l.t) view.text(c, l.t, x + pad, ly, { size: fs, kind: 'sans', weight: 600, color: l.c || o.accent || C.cyan });
      else if (l.k != null) {
        view.text(c, l.k, x + pad, ly, { size: fs, color: C.text2 });
        view.text(c, l.v, x + w - pad, ly, { size: fs, color: l.c || C.text, align: 'right' });
      } else if (l.s) view.text(c, l.s, x + pad, ly, { size: fs, color: l.c || C.text2 });
      else if (l.bar != null) {
        const bw = w - pad * 2, v = Math.max(0, Math.min(1, l.bar));
        c.fillStyle = 'rgba(94,230,255,0.12)'; c.fillRect(x + pad, ly - fs + 4, bw, 4);
        c.fillStyle = l.c || C.cyan; c.fillRect(x + pad, ly - fs + 4, bw * v, 4);
        if (l.mark != null) { c.fillStyle = C.red; c.fillRect(x + pad + bw * l.mark - 1, ly - fs + 2, 2, 8); }
      }
      ly += lh;
    }
    const rect = { x, y, w, h };
    if (HUD.placed) HUD.placed.push(rect);
    return rect;
  }

  const overlap = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

  /** Seven-segment digits with ghost segments, like an LED meter. */
  const SEG = { 0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcfgd', '-': 'g', ' ': '', E: 'afged', r: 'eg', o: 'gcde', L: 'fed', C: 'afed' };
  function seg7(c, str, x, y, h, color, ghost = 'rgba(255,178,62,0.07)') {
    const w = h * 0.52, t = h * 0.11, sk = h * 0.08, gap = h * 0.16;
    const segs = {
      a: [[t, 0], [w - t, 0]], d: [[t, h], [w - t, h]], g: [[t, h / 2], [w - t, h / 2]],
      f: [[0, t], [0, h / 2 - t]], e: [[0, h / 2 + t], [0, h - t]], b: [[w, t], [w, h / 2 - t]], c: [[w, h / 2 + t], [w, h - t]],
    };
    const bar = (s, col) => {
      const [[x0, y0], [x1, y1]] = segs[s];
      const sx0 = x + x0 + sk * (1 - y0 / h), sx1 = x + x1 + sk * (1 - y1 / h);
      c.strokeStyle = col;
      c.lineWidth = t;
      c.lineCap = 'round';
      c.beginPath(); c.moveTo(sx0, y + y0); c.lineTo(sx1, y + y1); c.stroke();
    };
    let cx = 0;
    for (const ch of String(str)) {
      if (ch === '.') {
        c.fillStyle = color;
        c.fillRect(x - gap * 0.55, y + h - t / 2, t, t);
        continue;
      }
      if (ch === ':') {
        c.fillStyle = color;
        c.fillRect(x, y + h * 0.3, t, t);
        c.fillRect(x - sk * 0.4, y + h * 0.68, t, t);
        x += t + gap;
        continue;
      }
      const on = SEG[ch] != null ? SEG[ch] : '';
      for (const s of 'abcdefg') bar(s, ghost);
      c.shadowColor = color; c.shadowBlur = 8;
      for (const s of on) bar(s, color);
      c.shadowBlur = 0;
      x += w + gap; cx++;
    }
    c.lineCap = 'butt';
    return cx * (w + gap);
  }

  function arrow(view, c, from, vec, color, label, o = {}) {
    const len = vec.len();
    if (len < 1e-3) return;
    const [x0, y0] = view.P(from), [x1, y1] = view.P(from.add(vec));
    c.strokeStyle = color;
    c.fillStyle = color;
    c.lineWidth = o.width || 2;
    if (o.dash) c.setLineDash(o.dash);
    c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
    c.setLineDash([]);
    const a = Math.atan2(y1 - y0, x1 - x0), hs = 7;
    c.beginPath();
    c.moveTo(x1, y1);
    c.lineTo(x1 - hs * Math.cos(a - 0.4), y1 - hs * Math.sin(a - 0.4));
    c.lineTo(x1 - hs * Math.cos(a + 0.4), y1 - hs * Math.sin(a + 0.4));
    c.closePath(); c.fill();
    if (label) view.text(c, label, x1 + 4 * Math.cos(a) + 3, y1 + 4 * Math.sin(a) + 3, { size: 9, color, weight: 600 });
  }

  /* ---------------- in-world annotations ---------------- */
  const HUD = {
    placed: null,
    world(view, st) {
      const c = view.ctx;
      this.placed = [];
      this.tags(view, c, st);
      this.devices(view, c, st);
      const focus = st.rules.tether.body || st.hover;
      if (focus) this.fbd(view, c, st, focus);
      this.tether(view, c, st);
      this.cursor(view, c, st);
    },

    tags(view, c, st) {
      const { lv } = st, C = Sigma.C;
      const fs = view.compact ? 8 : 9;
      for (const b of lv.items) {
        if (!b.world || b === lv.raft || b === lv.core) continue;
        const focus = st.hover === b || st.rules.tether.body === b;
        const top = new Vec2(b.pos.x + b.size[0] / 2, b.pos.y + b.size[1] / 2);
        const [x, y] = view.P(top);
        const m = b.unknown && !b.weighed ? '— kg' : `${f1(b.mass)} kg`;
        c.strokeStyle = focus ? C.cyan : 'rgba(94,230,255,0.28)';
        c.lineWidth = 1;
        c.beginPath(); c.moveTo(x, y); c.lineTo(x + 6, y - 7); c.lineTo(x + 12, y - 7); c.stroke();
        view.text(c, b.tag, x + 14, y - 10, { size: fs, color: focus ? C.cyan : C.text2, weight: 600 });
        view.text(c, m, x + 14, y - 10 + fs + 1, { size: fs, color: focus ? C.text : C.text3 });
      }
    },

    devices(view, c, st) {
      const { lv, rules: r } = st, L = lv.L, C = Sigma.C, G = lv.G;
      const A = (x, y) => view.P(new Vec2(x, y));
      const small = view.compact;
      /** A card whose top-left sits at world (wx, wy), with a leader to world point `to`. */
      const brief = small ? !st.info : !!st.info;   // I flips the default density
      const at = (wx, wy, to, lines, o = {}) => {
        if (brief) {
          if (o.chip && to) this.chip(view, c, A(to.x, to.y), o.chip, o.accent, o.chipBelow);
          return null;
        }
        const [x, y] = A(wx, wy);
        return card(view, c, x, y, lines, Object.assign({ anchor: to ? A(to.x, to.y) : null }, o));
      };
      // Tank T-1.
      const T = L.TANK, tw = lv.tankWater, th = tw / ((T.x1 - T.x0) * 100);
      if (!brief) {
        at(3.7, 8.32, new Vec2(T.x1, T.y0 + th), [
          { t: 'T-1 상부 수조' },
          { k: 'm_w', v: `${f1(tw)} kg` },
          { k: 'h', v: `${f3(th)} m` },
          { k: 'Q_out', v: `${f2(r.flows.main)} kg/s` },
        ], { minW: 150 });
      }
      // Cabinet: glass, and the main valve behind it.
      {
        const li = r.lastImpact;
        const lines = [{ t: r.glassBroken ? 'GL-A 파괴됨 · V-1 주 밸브 노출' : 'GL-A 강화유리 · 캐비닛 밀폐' }];
        if (!r.glassBroken) {
          lines.push({ k: '파괴 조건', v: `F ≥ ${L.GLASS.threshold} N` });
          lines.push({ k: 'F ≈ Δp / Δt', v: `Δt ${L.GLASS.tau.toFixed(3)} s` });
          lines.push({ k: '최근 충격력', v: li ? `${f1(li.F)} N` : '—', c: li ? C.amber : C.text3 });
          lines.push({ bar: li ? li.F / L.GLASS.threshold / 1.25 : 0, mark: 0.8, c: C.amber });
        }
        lines.push({ k: 'V-1 개도', v: `${(lv.mainOpen() * 100).toFixed(0)} %` });
        lines.push({ k: 'Q = 40 kg/s × 개도', v: `${f2(r.flows.main)} kg/s` });
        lines.push({ k: '레일 마찰', v: `${lv.mainValve.friction} N` });
        at(3.7, 7.0, new Vec2(L.CABINET.x1, (L.CABINET.y0 + L.CABINET.y1) / 2), lines, {
          accent: r.glassBroken ? C.amber : C.cyan, minW: 150,
          chip: r.glassBroken ? `V-1 ${(lv.mainOpen() * 100).toFixed(0)}%` : `GL-A ≥${L.GLASS.threshold} N`,
        });
      }
      // Sump and raft, engraved into the deck rock.
      {
        const S = L.SUMP, h = lv.sumpLevel(), raft = lv.raft;
        const rTop = raft.pos.y + raft.size[1] / 2, rBot = raft.pos.y - raft.size[1] / 2;
        const draft = Math.max(0, Math.min(raft.size[1], h - rBot));
        const over = h >= S.overflow - 1e-4;
        at(3.12, 2.42, new Vec2(S.x1 - 0.05, Math.max(h, 0.05)), [
          { t: 'S 침수 구역 · RF-1 뗏목' },
          { k: '수위 h', v: `${f3(h)} m`, c: over ? C.red : C.text },
          { k: '월류선', v: `${S.overflow.toFixed(3)} m → CW` },
          { k: 'm_w', v: `${f1(lv.sumpWater)} kg` },
          { bar: h / S.overflow, c: over ? C.red : C.cyan },
          { k: 'RF-1 흘수 d', v: `${f3(draft)} m` },
          { k: 'RF-1 상면', v: `${f3(rTop)} m`, c: rTop >= L.DECK ? C.green : C.text },
          { k: '갑판 높이', v: `${L.DECK.toFixed(3)} m` },
        ], { minW: 160, chip: `h ${f3(h)} m` });
      }
      // Header tank and needle valve.
      if (!brief) {
        const H = L.HEADER;
        at(9.35, 8.32, new Vec2(H.x0, (H.y0 + H.y1) / 2), [
          { t: 'T-2 보조 수조 · V-2 니들 밸브' },
          { k: 'm_w', v: `${f2(lv.headerWater)} kg` },
          { k: 'V-2 개도', v: `${(lv.needleOpen() * 100).toFixed(1)} %` },
          { k: 'Q = 1.50 kg/s × 개도', v: `${f3(r.flows.needle)} kg/s` },
          { k: '누적 → CW', v: `${f3(r.totals.needle)} kg` },
          { k: '레일 마찰', v: `${lv.needle.friction} N` },
        ], { minW: 190 });
      }
      // Hatch load cell and the trap lever.
      {
        const x = Math.max(0, lv.trapTravel()), F = r.trapForce || 0;
        at(9.35, 6.55, new Vec2(12.6, L.DECK), [
          { t: 'H-1 해치 · 하중 셀' },
          { k: '하중 W_on', v: `${f1(r.hatchLoad)} N` },
          { k: 'm = W_on / g', v: `${f2(r.hatchLoad / G)} kg` },
          { k: '상태', v: r.hatchOpen > 0 ? '개방' : '폐쇄', c: r.hatchOpen > 0 ? C.amber : C.text },
          { t: 'T-1 걸쇠 · F = F₀ + k·x' },
          { k: 'F₀ · k', v: `${L.TRAP.f0} N · ${L.TRAP.k} N/m` },
          { k: 'x / 트립', v: `${f3(x)} / ${L.TRAP.trip.toFixed(2)} m` },
          { k: 'F_e', v: `${f1(F)} N` },
          { bar: x / L.TRAP.trip, c: C.amber },
        ], { minW: 190, chip: `H-1 ${f1(r.hatchLoad)} N` });
      }
      // Counterweight bucket, engraved into the deck rock.
      {
        const bk = lv.bucket;
        const contents = r.bucketContents();
        const mc = contents.reduce((s2, b) => s2 + b.mass, 0);
        const m = bk.mass + mc, W = m * G;
        const known = contents.every((b) => !b.unknown || b.weighed);
        at(8.7, 2.42, new Vec2(bk.pos.x - 0.5, bk.pos.y), [
          { t: `CW 평형추 버킷 · ${r.cradled ? '거치대 고정' : '매달림'}` },
          { k: '버킷 + 물', v: `${f1(lv.L.BUCKET.mass)} + ${f2(lv.bucketWater)} kg` },
          { k: '적재물', v: contents.length ? contents.map((b) => b.tag).join(' ') : '—' },
          { k: 'Σm', v: known ? `${f2(m)} kg` : '— kg' },
          { k: 'W_CW = Σm·g', v: known ? `${f1(W)} N` : '— N', c: C.amber },
          { k: '로프 장력 T', v: r.cradled ? '— (거치대가 받침)' : `${f1(lv.rope.tension)} N` },
        ], { minW: 210, accent: C.amber, chip: known ? `W_CW ${f1(W)} N` : 'W_CW — N' });
      }
      // Vault door, the cradle pin, the governor.
      {
        const Dr = L.DOOR, W = Dr.mass * G, rise = lv.doorRise(), v = r.doorV;
        const status = r.lockout ? 'LOCKOUT' : r.doorOpen ? '개방' : r.moving ? '상승 중' : r.cradled ? '잠김 · 거치대' : '정지';
        at(13.48, 2.42, new Vec2(lv.door.pos.x - 0.1, L.DECK - 0.15), [
          { t: 'D-1 금고문' },
          { k: 'm_D · W_D', v: `${f1(Dr.mass)} kg · ${f1(W)} N` },
          { k: '가이드 f_s · f_k', v: `${f1(Dr.fs)} · ${f1(Dr.fk)} N` },
          { k: '개방 높이 h', v: `${f2(Dr.rise)} m` },
          { k: '조속기 v_max', v: `${f2(Dr.vMax)} m/s`, c: C.red },
          { s: 'W_CW − W_D − f = (m_D + m_CW)·a' },
          { k: 'y · v', v: `${f3(rise)} m · ${f3(v)} m/s`, c: v > Dr.vMax * 0.85 ? C.red : C.text },
          { bar: v / Dr.vMax / 1.1, mark: 1 / 1.1, c: v > Dr.vMax * 0.85 ? C.red : C.green },
          { k: 'PIN 마찰 · x', v: `${L.PIN.friction} N · ${f3(Math.max(0, lv.pinTravel()))}/${L.PIN.release.toFixed(2)} m` },
          { k: '상태', v: status, c: r.lockout ? C.red : r.doorOpen ? C.green : C.text },
        ], { accent: r.lockout ? C.red : C.cyan, border: r.lockout ? C.red : undefined, chip: `D-1 ${status} · v ${f3(v)}`, chipBelow: true });
      }
      // Core.
      {
        const core = lv.core, [ax, ay] = view.P(core.pos);
        view.text(c, r.done ? 'C-0 · 회수됨' : `C-0 코어 · ${f2(core.mass)} kg`, ax, ay - 18, { size: 9, color: '#ffffff', align: 'center', weight: 600 });
      }
    },

    /** A one-line reading pinned next to a device (small screens). */
    chip(view, c, [x, y], text, accent, below) {
      const C = Sigma.C;
      c.font = view.font(9);
      const w = c.measureText(text).width + 8;
      const bx = Math.min(view.W - w - 4, x + 6), by = below ? y + 6 : y - 18;
      c.fillStyle = C.panel;
      c.fillRect(bx, by, w, 13);
      c.strokeStyle = accent || C.panelLine;
      c.strokeRect(bx + 0.5, by + 0.5, w - 1, 12);
      view.text(c, text, bx + 4, by + 10, { size: 9, color: C.text });
    },

    /** Free-body diagram of one body: arrows scaled 1 m : 600 N, plus the arithmetic. */
    fbd(view, c, st, b) {
      const r = st.rules, lv = st.lv, C = Sigma.C, G = lv.G, F = C.force;
      if (b.isKnob) return this.knobCard(view, c, st, b);
      const A = r.analyze(b);
      const s = 1 / 600;
      const known = !b.unknown || b.weighed;
      // Weight from the centre of mass.
      arrow(view, c, b.pos, new Vec2(0, -A.W * s), F.W, known ? `W ${f1(A.W)}` : 'W ?');
      // Contacts: normal and friction at each.
      for (const k of A.contacts) {
        if (k.fn < 0.5) continue;
        arrow(view, c, k.p, k.n.scale(k.fn * s), F.N, k.n.y > 0.5 ? `F_N ${f1(k.fn)}` : `${f1(k.fn)}`, { width: 1.5 });
        if (Math.abs(k.ft) > 0.5) {
          const tg = new Vec2(k.n.y, -k.n.x);
          arrow(view, c, k.p, tg.scale(k.ft * s), F.f, `f ${f1(Math.abs(k.ft))}`, { width: 1.5 });
        }
      }
      if (A.B > 0.5) arrow(view, c, b.pos.add(new Vec2(0.03, 0)), new Vec2(0, A.B * s), F.B, `B ${f1(A.B)}`);
      // The card.
      const area = b.area;
      const lines = [{ t: `${b.tag} ${b.kname} · ${b.matName}` }];
      lines.push({ k: 'm', v: known ? `${f2(b.mass)} kg` : '— kg (미계량)' });
      lines.push({ k: 'V · ρ', v: `${f2(area * Lab.DEPTH * 1000)} L · ${b.density.toFixed(0)} kg/m³` });
      lines.push({ k: 'W = m·g', v: known ? `${f2(b.mass)}×${G.toFixed(2)} = ${f1(A.W)} N` : '?', c: F.W });
      if (A.N > 0.5) {
        lines.push({ k: '수직항력 F_N', v: `${f1(A.N)} N`, c: F.N });
        lines.push({ k: 'f_s,max = μs·F_N', v: `${A.mus.toFixed(2)}×${f1(A.N)} = ${f1(A.mus * A.N)} N`, c: F.f });
        lines.push({ k: 'f (마찰력)', v: `${f1(A.fr)} N · ${A.sliding ? `운동 μk ${A.muk.toFixed(2)}` : '정지'}`, c: F.f });
      }
      if (A.B > 0.5) lines.push({ k: '부력 B = ρ_w·V_잠김·g', v: `${f1(A.B)} N`, c: F.B });
      if (A.B > 0.5) lines.push({ k: '겉보기 무게 W − B', v: `${f1(A.W - A.B)} N` });
      if (A.tether) {
        const T = A.tether, ang = (Math.atan2(T.y, T.x) * 180) / Math.PI;
        lines.push({ k: '견인 T', v: `${f1(T.len())} N ∠${ang.toFixed(1)}°`, c: F.T });
        lines.push({ k: 'T_x · T_y', v: `${f1(T.x)} · ${f1(T.y)} N`, c: F.T });
        if (A.N > 0.5 && Math.abs(T.x) > 1) {
          const tx = Math.abs(T.x);
          if (A.sliding) {
            const fk = A.muk * A.N;
            lines.push({ k: 'f_k = μk·F_N', v: `${A.muk.toFixed(2)}×${f1(A.N)} = ${f1(fk)} N`, c: F.f });
            lines.push({ s: `|T_x| ${f1(tx)} ${tx > fk ? '>' : '<'} f_k ${f1(fk)} → ${tx > fk + 2 ? '가속' : tx < fk - 2 ? '감속' : '등속'}`, c: C.green });
          } else {
            const fs = A.mus * A.N, slip = tx > fs;
            lines.push({ s: `|T_x| ${f1(tx)} ${slip ? '>' : '≤'} f_s,max ${f1(fs)} → ${slip ? '미끄러짐 시작' : '정지 유지'}`, c: slip ? C.green : C.amber });
          }
        }
      }
      lines.push({ k: 'v', v: `${f3(b.vel.len())} m/s` });
      const [bx, by] = view.P(b.pos);
      this.inspect(view, c, st, b, lines, [bx, by], C.cyan, 230);
    },

    /** Place the inspector card around its body where it covers the least: other cards, objects, the hand. */
    inspect(view, c, st, b, lines, anchor, accent, minW) {
      const m = measure(view, c, lines, { minW });
      const [ax, ay] = anchor, g = 28;
      const cands = [
        [ax + g, ay - m.h - g], [ax - m.w - g, ay - m.h - g], [ax + g, ay + g], [ax - m.w - g, ay + g],
        [ax + 3 * g, ay - m.h - 3 * g], [ax - m.w - 3 * g, ay - m.h - 3 * g], [ax + 3 * g, ay + 2 * g], [ax - m.w - 3 * g, ay + 2 * g],
        [ax - m.w / 2, ay - m.h - 4 * g], [ax - m.w / 2, ay + 3 * g],
      ];
      const keep = [];
      for (const it of st.lv.items) {
        if (!it.world) continue;
        const bb = it.aabb, [x0, y0] = view.P(new Vec2(bb.minX, bb.maxY)), [x1, y1] = view.P(new Vec2(bb.maxX, bb.minY));
        keep.push({ x: x0 - 6, y: y0 - 6, w: x1 - x0 + 12, h: y1 - y0 + 12 });
      }
      if (st.mouse) { const [hx, hy] = view.P(st.mouse); keep.push({ x: hx - 20, y: hy - 20, w: 170, h: 100 }); }
      const room = { x: 4, y: view.top + 2, w: view.W - 8, h: view.H - view.top - view.bottom - 4 };
      let best = null, bestS = Infinity;
      cands.forEach(([x, y], i) => {
        const r = { x, y, w: m.w, h: m.h };
        let s = (m.w * m.h - overlap(r, room)) * 50;
        for (const p of this.placed) s += overlap(r, p) * 25;
        for (const k of keep) s += overlap(r, k) * 2;
        s += i * 40;
        if (i === this.lastSlot && b === this.lastBody) s -= 400; // stay put unless clearly better
        if (s < bestS) { bestS = s; best = i; }
      });
      this.lastSlot = best; this.lastBody = b;
      const [x, y] = cands[best];
      card(view, c, x, y, lines, { anchor: [ax, ay], accent, minW, fixed: true });
    },

    knobCard(view, c, st, k) {
      const lv = st.lv, r = st.rules, L = lv.L, C = Sigma.C;
      const [x, y] = view.P(k.pos);
      const T = r.tether.body === k ? r.tether.F : null;
      const lines = [{ t: `${k.tag} ${k.kname}` }];
      if (k === lv.trap) {
        lines.push({ s: '용수철 걸쇠 · 탄성력 F = F₀ + k·x' });
        lines.push({ k: 'F_e', v: `${f1(r.trapForce || 0)} N` });
      } else {
        lines.push({ k: '레일 마찰 (정지=운동)', v: `${k.friction} N` });
      }
      if (T) {
        lines.push({ k: '견인 T_x', v: `${f1(T.x)} N`, c: Sigma.C.force.T });
        const need = k === lv.trap ? (r.trapForce || L.TRAP.f0) : k.friction;
        lines.push({ s: Math.abs(T.x) > need ? '|T_x| > 저항 → 이동' : '|T_x| ≤ 저항 → 정지', c: Math.abs(T.x) > need ? C.green : C.amber });
      }
      this.inspect(view, c, st, k, lines, [x, y], C.amber, 0);
    },

    /** The line itself: a spring from the hand to the grip, coloured by tension. */
    tether(view, c, st) {
      const r = st.rules, t = r.tether, C = Sigma.C;
      if (!t.body) return;
      const p = t.point, h = t.hand;
      const F = t.F.len(), k = Math.min(1, F / t.fMax);
      const col = t.maxed ? (Math.floor(view.time * 10) % 2 ? C.red : '#ff8a96') : k > 0.75 ? C.amber : k > 0.4 ? '#ffd166' : C.cyan;
      const [x0, y0] = view.P(p), [x1, y1] = view.P(h);
      const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy);
      if (len > 2) {
        const ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
        const coils = 16, amp = 3.5;
        c.strokeStyle = col;
        c.lineWidth = 1.2 + k * 1.6;
        c.shadowColor = col; c.shadowBlur = 6 + 10 * k;
        c.beginPath();
        c.moveTo(x0, y0);
        const lead = Math.min(10, len * 0.15);
        c.lineTo(x0 + ux * lead, y0 + uy * lead);
        for (let i = 1; i < coils * 2; i++) {
          const s = lead + ((len - 2 * lead) * i) / (coils * 2);
          const side = i % 2 ? 1 : -1;
          c.lineTo(x0 + ux * s + nx * amp * side, y0 + uy * s + ny * amp * side);
        }
        c.lineTo(x1 - ux * lead, y1 - uy * lead);
        c.lineTo(x1, y1);
        c.stroke();
        c.shadowBlur = 0;
      }
      // The pull, as a vector at the grip, and its components.
      const s = 1 / 600;
      arrow(view, c, p, t.F.scale(s), C.force.T, null, { width: 2.4 });
      arrow(view, c, p, new Vec2(t.F.x * s, 0), C.force.T, null, { width: 1, dash: [3, 3] });
      arrow(view, c, p, new Vec2(0, t.F.y * s), C.force.T, null, { width: 1, dash: [3, 3] });
      // Readout at the hand: the N climbs as the line stretches.
      const bx = x1 + 16, by = y1 + 14;
      const w = 132, hgt = 62;
      const px = Math.min(view.W - w - 6, bx), py = Math.min(view.H - view.bottom - hgt - 4, by);
      c.fillStyle = 'rgba(3, 7, 11, 0.9)';
      c.fillRect(px, py, w, hgt);
      c.strokeStyle = col; c.lineWidth = 1;
      c.strokeRect(px + 0.5, py + 0.5, w - 1, hgt - 1);
      const digits = (t.Fshow || F).toFixed(1).padStart(5, ' ');
      seg7(c, digits, px + 8, py + 8, 24, t.maxed ? C.red : C.amber);
      view.text(c, 'N', px + w - 10, py + 30, { size: 11, color: t.maxed ? C.red : C.amber, align: 'right', weight: 700 });
      c.fillStyle = 'rgba(255,178,62,0.15)'; c.fillRect(px + 8, py + 39, w - 16, 3);
      c.fillStyle = t.maxed ? C.red : C.amber; c.fillRect(px + 8, py + 39, (w - 16) * k, 3);
      view.text(c, `x ${f3(t.stretch)} m · F=kx ≤ ${t.fMax}`, px + 8, py + 54, { size: 9, color: C.text2 });
      if (t.maxed) view.text(c, 'MAX', px + w - 8, py + 54, { size: 9, color: C.red, align: 'right', weight: 700 });
    },

    cursor(view, c, st) {
      const r = st.rules, C = Sigma.C, h = st.mouse;
      if (!h) return;
      const [x, y] = view.P(h);
      const sealed = r.sealed(h);
      const col = sealed ? C.red : r.tether.body ? C.amber : st.hover ? C.cyan : 'rgba(211, 233, 241, 0.75)';
      c.strokeStyle = col;
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(x - 12, y); c.lineTo(x - 4, y); c.moveTo(x + 4, y); c.lineTo(x + 12, y);
      c.moveTo(x, y - 12); c.lineTo(x, y - 4); c.moveTo(x, y + 4); c.lineTo(x, y + 12);
      c.stroke();
      c.strokeRect(x - 1.5, y - 1.5, 3, 3);
      view.text(c, `${f2(h.x)}, ${f2(h.y)}`, x + 10, y + 20, { size: 9, color: C.text3 });
      if (sealed) view.text(c, `✕ ${sealed}`, x + 10, y - 10, { size: 9, color: C.red, weight: 600 });
      else if (st.hover && !r.tether.body) {
        const b = st.hover, v = b.shapes.flatMap((s) => s.wv || []);
        if (v.length) {
          let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
          for (const p of v) { const [sx, sy] = view.P(p); x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy); }
          x0 -= 4; y0 -= 4; x1 += 4; y1 += 4;
          c.strokeStyle = C.cyan;
          c.beginPath();
          for (const [cx, cy, sx, sy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]]) {
            c.moveTo(cx + 6 * sx, cy); c.lineTo(cx, cy); c.lineTo(cx, cy + 6 * sy);
          }
          c.stroke();
        }
      }
      if (st.holdReset > 0) {
        c.strokeStyle = C.red; c.lineWidth = 2;
        c.beginPath(); c.arc(x, y, 18, -Math.PI / 2, -Math.PI / 2 + st.holdReset * Math.PI * 2); c.stroke();
      }
    },

    /* ---------------- screen panels ---------------- */
    screen(view, st) {
      const c = view.ctx;
      this.topBar(view, c, st);
      if (!view.compact) {
        const y = view.H - view.bottom;
        c.fillStyle = 'rgba(3, 7, 11, 0.94)';
        c.fillRect(0, y, view.W, view.bottom);
        c.strokeStyle = Sigma.C.panelLine;
        c.beginPath(); c.moveTo(0, y + 0.5); c.lineTo(view.W, y + 0.5); c.stroke();
        const lw = Math.min(420, view.W * 0.33), gw = Math.min(440, view.W * 0.34);
        this.meters(view, c, st, 10, y + 10, lw - 14, view.bottom - 20);
        this.scope(view, c, st, lw + 4, y + 10, view.W - lw - gw - 12, view.bottom - 20);
        this.log(view, c, st, view.W - gw, y + 10, gw - 10, view.bottom - 20);
      }
    },

    topBar(view, c, st) {
      const { rules: r, lv } = st, C = Sigma.C, W = view.W, h = view.top;
      c.fillStyle = 'rgba(3, 7, 11, 0.94)';
      c.fillRect(0, 0, W, h);
      c.strokeStyle = C.panelLine;
      c.beginPath(); c.moveTo(0, h - 0.5); c.lineTo(W, h - 0.5); c.stroke();
      const mid = h / 2 + 4;
      view.text(c, 'ΣF', 12, mid + 2, { font: `700 ${view.compact ? 17 : 21}px ${Sigma.FONT.disp}`, color: C.cyan });
      let x = view.compact ? 44 : 52;
      if (!view.compact) { view.text(c, 'EQ-07 · 평형 금고', x, mid, { size: 12, kind: 'sans', weight: 600, color: C.text }); x += 122; }
      const state = r.done ? ['CLEAR', '#ffffff'] : r.lockout ? ['LOCKOUT', C.red] : r.moving ? ['DOOR ↑', C.green] : ['RUN', C.green];
      c.strokeStyle = state[1]; c.lineWidth = 1;
      c.strokeRect(x + 0.5, mid - 12.5, 64, 16);
      view.text(c, state[0], x + 32, mid - 0.5, { size: 10, weight: 700, color: state[1], align: 'center' });
      x += 78;
      if (!view.compact) {
        const goal = `목표 · C-0 → x < ${lv.L.GOAL_X.toFixed(2)} m`;
        view.text(c, goal, x, mid, { size: 11, kind: 'sans', weight: 600, color: '#ffffff' });
        c.font = view.font(11, 'sans', 600);
        x += c.measureText(goal).width + 20;
      }
      const w = lv.world;
      const fps = st.fps || 60;
      const items = view.compact
        ? [`t ${clock(r.time)}`, `F ${f1(r.tether.body ? r.tether.F.len() : 0)} N`]
        : [`t ${clock(r.time)}`, `Δt ${(w.dt * 1000).toFixed(2)} ms`, `iter ${w.velocityIterations}/${w.positionIterations}`, `물체 ${w.bodies.length}`, `접촉 ${w.arbiters.size}`, `${fps.toFixed(0)} fps`];
      for (const s of items) {
        view.text(c, s, x, mid, { size: 10, color: C.text2 });
        c.font = view.font(10);
        x += c.measureText(s).width + 16;
      }
      // Environment (mostly noise), an info toggle and a reset button on the right.
      const bw = view.compact ? 54 : 70;
      const bx = W - bw - 8;
      st.resetBox = { x: bx, y: mid - 13, w: bw, h: 18 };
      const iw = 58, ix = bx - iw - 8;
      st.infoBox = { x: ix, y: mid - 13, w: iw, h: 18 };
      const full = view.compact ? !!st.info : !st.info;
      c.strokeStyle = full ? C.cyan : C.text3;
      c.strokeRect(ix + 0.5, mid - 12.5, iw - 1, 17);
      view.text(c, 'I · INFO', ix + iw / 2, mid, { size: 9, color: full ? C.cyan : C.text2, align: 'center', weight: 600 });
      c.strokeStyle = C.amber;
      c.strokeRect(bx + 0.5, mid - 12.5, bw - 1, 17);
      view.text(c, view.compact ? 'R 리셋' : 'R · 리셋', bx + bw / 2, mid, { size: 10, color: C.amber, align: 'center', weight: 600 });
      if (!view.compact && W > 1100) {
        const t = r.time;
        const env = [`g 9.80 m/s²`, `ρ_w 1000 kg/m³`, `단면 0.10 m`, `P ${(101.3 + 0.04 * Math.sin(t * 0.3)).toFixed(2)} kPa`, `${(21.4 + 0.1 * Math.sin(t * 0.11)).toFixed(1)} °C`];
        let ex = ix - 12;
        for (let i = env.length - 1; i >= 0; i--) {
          c.font = view.font(10);
          const ww = c.measureText(env[i]).width;
          if (ex - ww < x + 10) break;
          view.text(c, env[i], ex, mid, { size: 10, color: C.text3, align: 'right' });
          ex -= ww + 14;
        }
      }
    },

    meters(view, c, st, x, y, w, h) {
      const { rules: r, lv } = st, C = Sigma.C, G = lv.G, Dr = lv.L.DOOR;
      const contents = r.bucketContents();
      const Wcw = (lv.bucket.mass + contents.reduce((s, b) => s + b.mass, 0)) * G;
      const sumF = Wcw - Dr.mass * G - (r.moving ? Dr.fk : Dr.fs);
      const cells = [
        ['F_TOW', '견인력', r.tether.body ? r.tether.Fshow || 0 : 0, 'N', r.tether.maxed ? C.red : C.amber],
        ['W_CW', '버킷 무게', Wcw, 'N', C.amber],
        ['ΣF_D', '문 합력 (정지 기준)', sumF, 'N', sumF > 0 ? C.green : C.amber],
        ['v_D', '문 속도', r.doorV, 'm/s', r.doorV > Dr.vMax * 0.85 ? C.red : C.green],
      ];
      const cw = (w - 8) / 2, ch = (h - 6) / 2;
      cells.forEach(([id, ko, v, unit, col], i) => {
        const cx = x + (i % 2) * (cw + 8), cy = y + Math.floor(i / 2) * (ch + 6);
        c.strokeStyle = 'rgba(255,178,62,0.25)';
        c.strokeRect(cx + 0.5, cy + 0.5, cw - 1, ch - 1);
        view.text(c, id, cx + 6, cy + 13, { size: 9, color: col, weight: 700 });
        view.text(c, ko, cx + 6 + 44, cy + 13, { size: 9, kind: 'sans', color: C.text3 });
        const dh = Math.min(26, ch - 26);
        const s = (v < 0 ? '-' : ' ') + Math.abs(v).toFixed(unit === 'm/s' ? 3 : 1).padStart(6, ' ');
        seg7(c, s, cx + 6, cy + 20, dh, col);
        view.text(c, unit, cx + cw - 6, cy + 20 + dh, { size: 10, color: col, align: 'right', weight: 700 });
      });
    },

    scope(view, c, st, x, y, w, h) {
      const r = st.rules;
      if (w < 120) return;
      c.fillStyle = '#020a06';
      c.fillRect(x, y, w, h);
      c.strokeStyle = 'rgba(93, 255, 158, 0.12)';
      c.lineWidth = 1;
      c.beginPath();
      for (let i = 1; i < 10; i++) { const gx = x + (w * i) / 10; c.moveTo(gx, y); c.lineTo(gx, y + h); }
      for (let i = 1; i < 4; i++) { const gy = y + (h * i) / 4; c.moveTo(x, gy); c.lineTo(x + w, gy); }
      c.stroke();
      c.strokeStyle = 'rgba(93, 255, 158, 0.35)';
      c.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      const hist = r.history, span = 10;
      const t1 = r.time, t0 = t1 - span;
      const trace = (key, lo, hi, col) => {
        c.strokeStyle = col;
        c.lineWidth = 1.4;
        c.shadowColor = col; c.shadowBlur = 6;
        c.beginPath();
        let first = true;
        for (const s of hist) {
          if (s.t < t0) continue;
          const px = x + ((s.t - t0) / span) * w;
          const v = Math.max(lo, Math.min(hi, s[key]));
          const py = y + h - ((v - lo) / (hi - lo)) * h;
          if (first) { c.moveTo(px, py); first = false; } else c.lineTo(px, py);
        }
        c.stroke();
        c.shadowBlur = 0;
      };
      trace('h', 0, 2.6, 'rgba(102, 214, 255, 0.85)');
      trace('sum', -400, 400, '#5dff9e');
      trace('F', 0, 400, '#ffb23e');
      // Zero line for ΣF.
      c.setLineDash([2, 4]);
      c.strokeStyle = 'rgba(93, 255, 158, 0.4)';
      c.beginPath(); c.moveTo(x, y + h / 2); c.lineTo(x + w, y + h / 2); c.stroke();
      c.setLineDash([]);
      view.text(c, 'SCOPE · 10 s', x + 6, y + 12, { size: 9, color: '#5dff9e', weight: 700 });
      const leg = [['F_tow 0–400 N', '#ffb23e'], ['ΣF_D ±400 N', '#5dff9e'], ['h_S 0–2.6 m', '#66d6ff']];
      let lx = x + w - 6;
      for (let i = leg.length - 1; i >= 0; i--) {
        view.text(c, leg[i][0], lx, y + 12, { size: 9, color: leg[i][1], align: 'right' });
        c.font = view.font(9);
        lx -= c.measureText(leg[i][0]).width + 12;
      }
    },

    log(view, c, st, x, y, w, h) {
      const { rules: r } = st, C = Sigma.C;
      c.fillStyle = 'rgba(5, 10, 15, 0.9)';
      c.fillRect(x, y, w, h);
      c.strokeStyle = C.panelLine;
      c.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      view.text(c, 'EVENT LOG', x + 6, y + 12, { size: 9, color: C.cyan, weight: 700 });
      const lh = 13, n = Math.floor((h - 20) / lh);
      const lines = r.log.slice(-n);
      const colors = { alert: C.amber, warn: C.red, impact: C.text2, throw: '#ffd166', sys: C.text3 };
      c.save();
      c.beginPath(); c.rect(x, y, w - 4, h); c.clip();
      lines.forEach((l, i) => {
        const ly = y + 26 + i * lh;
        view.text(c, `[${clock(l.t)}]`, x + 6, ly, { size: 9, color: C.text3 });
        view.text(c, l.text, x + 72, ly, { size: 9, color: colors[l.kind] || C.text2 });
      });
      c.restore();
    },

    overlays(view, c, st) {
      const { rules: r, lv } = st, C = Sigma.C, W = view.W, H = view.H;
      if (H > W * 1.2) {
        const y = view.Y(lv.L.VIEW[1]) + 34;
        view.text(c, '↻ 가로 화면에서 더 크게 보입니다', W / 2, Math.min(H - 20, y), { size: 12, kind: 'sans', color: C.text2, align: 'center' });
      }
      if (r.lockout) {
        const a = 0.1 + 0.05 * Math.sin(view.time * 6);
        c.fillStyle = `rgba(255, 30, 50, ${a})`;
        c.fillRect(0, view.top, W, H - view.top - view.bottom);
        const cw = Math.min(520, W - 32), ch = 118;
        const cx = (W - cw) / 2, cy = view.top + Math.max(10, (H - view.top - view.bottom - ch) * 0.3);
        c.fillStyle = 'rgba(20, 3, 6, 0.94)';
        c.fillRect(cx, cy, cw, ch);
        c.strokeStyle = C.red; c.lineWidth = 1.5;
        c.strokeRect(cx + 0.5, cy + 0.5, cw - 1, ch - 1);
        view.text(c, 'LOCKOUT', cx + 18, cy + 46, { font: `700 ${view.compact ? 30 : 40}px ${Sigma.FONT.disp}`, color: C.red });
        view.text(c, `조속기 작동 · 문 속도 ${f3(r.doorVmax)} m/s > ${lv.L.DOOR.vMax.toFixed(2)} m/s`, cx + 18, cy + 72, { size: 12, kind: 'sans', color: '#ffc4ca' });
        view.text(c, '모든 장치가 잠겼습니다 · R 키 또는 오른쪽 위 리셋으로 처음부터', cx + 18, cy + 96, { size: 11, kind: 'sans', color: C.text2 });
      }
      if (st.ending > 0) {
        const k = Math.min(1, st.ending);
        // The core's light floods the screen, then the report settles on it.
        const [gx, gy] = view.P(lv.core.pos);
        const g = c.createRadialGradient(gx, gy, 0, gx, gy, Math.max(W, H) * (0.3 + 0.9 * k));
        g.addColorStop(0, `rgba(255,255,255,${0.95 * k})`);
        g.addColorStop(0.5, `rgba(214, 246, 255, ${0.75 * k})`);
        g.addColorStop(1, `rgba(160, 225, 245, ${0.55 * k})`);
        c.fillStyle = g;
        c.fillRect(0, 0, W, H);
        if (k > 0.55) {
          c.globalAlpha = Math.min(1, (k - 0.55) / 0.3);
          const s = r.stats, fin = st.final || {};
          const rows = [
            ['최대 견인력', `${f1(s.peakTether)} / ${lv.L.TETHER.fMax} N`],
            ['투척 · 유리 충돌', `${s.throws} 회 · ${s.glassHit} 회`],
            ['유리 파괴 충격력', fin.glass ? `${f1(fin.glass)} N` : '—'],
            ['최종 W_CW', fin.Wcw ? `${f1(fin.Wcw)} N` : '—'],
            ['문 최고 속도', `${f3(r.doorVmax)} / ${lv.L.DOOR.vMax.toFixed(2)} m/s`],
            ['조속기 여유', `${f1((1 - r.doorVmax / lv.L.DOOR.vMax) * 100)} %`],
            ['견인줄 차단', `${s.snaps} 회`],
            ['기록된 충돌', `${s.impacts} 건`],
          ];
          const cw = Math.min(460, W - 32), ch = 150 + rows.length * 20;
          const cx = (W - cw) / 2, cy = Math.max(view.top + 10, (H - ch) / 2 - 20);
          c.fillStyle = 'rgba(3, 8, 12, 0.92)';
          c.fillRect(cx, cy, cw, ch);
          c.strokeStyle = C.cyan; c.lineWidth = 1;
          c.strokeRect(cx + 0.5, cy + 0.5, cw - 1, ch - 1);
          view.text(c, 'C-0 회수 완료', cx + 18, cy + 34, { font: `700 ${view.compact ? 20 : 24}px ${Sigma.FONT.sans}`, color: '#ffffff' });
          view.text(c, 'EQ-07 · 평형 금고 · CLEAR', cx + cw - 18, cy + 32, { size: 10, color: C.cyan, align: 'right', weight: 700 });
          view.text(c, '경과 시간', cx + 18, cy + 64, { size: 10, kind: 'sans', color: C.text2 });
          seg7(c, clock(r.doneAt || r.time), cx + 18, cy + 72, 30, C.amber);
          rows.forEach(([k2, v], i) => {
            const ry = cy + 130 + i * 20;
            view.text(c, k2, cx + 18, ry, { size: 11, kind: 'sans', color: C.text2 });
            view.text(c, v, cx + cw - 18, ry, { size: 11, color: C.text, align: 'right', weight: 600 });
          });
          view.text(c, 'R · 다시 하기', cx + cw / 2, cy + ch - 12, { size: 10, kind: 'sans', color: C.text3, align: 'center' });
          c.globalAlpha = 1;
        }
      }
    },
  };

  Sigma.HUD = HUD;
  Sigma.seg7 = seg7;
})(typeof window !== 'undefined' ? window : globalThis);
