/*
 * Chamber 03 — Two strings. Hang a weight so its knot settles on a target:
 * circle geometry picks the hooks, Lami's theorem decides which strings survive.
 */
(function (root) {
  'use strict';
  const Lab = root.Lab;
  const { Vec2, Bodies, Mathx, Geom, Joints, Kit } = Lab;
  const DEG = Mathx.DEG;

  const RAIL = 6.6;          // hook height
  const RAIL_X0 = 0.8, RAIL_X1 = 11.2;
  const START_Y = 6.2;       // knot height before lowering
  const BOX = 0.32;          // weight size
  const TOL = 0.04;          // target radius
  const HOIST_K = 600;
  const PAYOUT = 0.25;       // m/s
  const STRING_NAMES = ['S1', 'S2', 'S3'];

  function knotFor(xa, La, xb, Lb) {
    const pts = Geom.circleCircle(new Vec2(xa, RAIL), La, new Vec2(xb, RAIL), Lb);
    if (!pts.length) return null;
    return pts.reduce((lo, p) => (p.y < lo.y ? p : lo));
  }
  /** Tensions in the left/right strings holding weight W at knot P. */
  function tensions(xa, xb, P, W) {
    const uA = new Vec2(xa, RAIL).sub(P).norm(), uB = new Vec2(xb, RAIL).sub(P).norm();
    const det = uA.x * uB.y - uB.x * uA.y;
    return { TL: (-uB.x * W) / det, TR: (uA.x * W) / det };
  }

  /** Build a scenario with exactly-on-grid intended hooks and discriminating strengths. */
  function generate(rng, g) {
    for (let attempt = 0; attempt < 4000; attempt++) {
      const M = rng.step(2.0, 4.0, 0.1);
      const W = M * g;
      const lens = [rng.step(1.5, 2.1, 0.05), rng.step(2.2, 2.9, 0.05), rng.step(3.0, 3.8, 0.05)];
      const iL = rng.int(0, 2);
      const iR = (iL + rng.int(1, 2)) % 3;
      const xa = rng.step(1.2, 6.0, 0.05);
      const xb = Mathx.round(rng.step(Math.min(10.8, xa + 1.2), Math.min(10.8, xa + 5.5), 0.05), 2);
      if (xb - xa < 1.0) continue;
      const P = knotFor(xa, lens[iL], xb, lens[iR]);
      if (!P) continue;
      const dy = RAIL - P.y;
      if (dy < 1.3 || dy > 3.6 || P.y < 2.0) continue;
      const phiL = Math.atan2(P.x - xa, dy), phiR = Math.atan2(xb - P.x, dy);
      if (phiL < 12 * DEG || phiL > 72 * DEG || phiR < 12 * DEG || phiR > 72 * DEG) continue;
      const T = tensions(xa, xb, P, W);
      const S = [0, 0, 0];
      S[iL] = Math.round(T.TL * rng.range(1.2, 1.35));
      S[iR] = Math.round(T.TR * rng.range(1.2, 1.35));
      const k = 3 - iL - iR;
      S[k] = Math.round(W * rng.range(0.3, 0.9));
      // Classify every ordered pair of distinct strings.
      const combos = [];
      let ambiguous = false;
      for (let a = 0; a < 3; a++) {
        for (let b = 0; b < 3; b++) {
          if (a === b) continue;
          if (lens[a] <= dy + 0.05 || lens[b] <= dy + 0.05) { combos.push({ a, b, kind: 'short' }); continue; }
          const ha = Mathx.round(Mathx.snap(P.x - Math.sqrt(lens[a] ** 2 - dy * dy), 0.05), 2);
          const hb = Mathx.round(Mathx.snap(P.x + Math.sqrt(lens[b] ** 2 - dy * dy), 0.05), 2);
          if (ha < RAIL_X0 || hb > RAIL_X1 || hb - ha < 0.3) { combos.push({ a, b, kind: 'offrail' }); continue; }
          const Q = knotFor(ha, lens[a], hb, lens[b]);
          if (!Q || Q.dist(P) > 0.03) { combos.push({ a, b, kind: 'miss' }); continue; }
          const t = tensions(ha, hb, Q, W);
          const ra = t.TL / S[a], rb = t.TR / S[b];
          let kind;
          if (ra <= 0.85 && rb <= 0.85) kind = 'ok';
          else if (ra >= 1.1 || rb >= 1.1) kind = 'break';
          else { kind = 'ambiguous'; ambiguous = true; }
          combos.push({ a, b, kind, ha, hb, TL: t.TL, TR: t.TR });
        }
      }
      if (ambiguous) continue;
      const intended = combos.find((c) => c.a === iL && c.b === iR);
      if (!intended || intended.kind !== 'ok') continue;
      const okN = combos.filter((c) => c.kind === 'ok').length;
      const breakN = combos.filter((c) => c.kind === 'break').length;
      if (okN > 2 || breakN < 1) continue;
      return {
        M, lens, strengths: S, target: P, intended: { a: iL, b: iR, xa, xb, TL: T.TL, TR: T.TR },
        combos,
      };
    }
    throw new Error('c03: no scenario');
  }

  Lab.defineChamber({
    id: 'c03', no: 3, chapter: 1, code: 'TENSION', title: '두 줄',
    modes: ['B', 'C'],
    tags: ['힘의 평형', '장력', '라미의 정리', '원의 교점'],
    size: [12, 6.75],
    objective: '줄 두 개로 추를 매달아 **매듭이 표적 ⊕에 정지**하게 하라(A). 줄은 한계 장력을 넘으면 끊어진다. 그다음 **왼쪽 줄의 장력**을 계산해 입력하라(B).',
    briefing: [
      '천장 레일에 고리 두 개가 있다. 각 고리에 줄 S1·S2·S3 중 하나를 걸고, 고리 위치를 0.05 m 단위로 정한다. 줄의 다른 끝은 모두 추 꼭대기의 고리(매듭)에 묶인다.',
      '**하중 걸기**를 누르면 윈치가 추를 천천히 내려 두 줄에 무게를 넘긴다. 줄 길이는 늘어나지 않는다. 대신 한계 장력을 넘는 순간 끊어진다.',
      '표적의 위치는 자(M)로 잰다. 표적 중심에 자가 달라붙는다. 레일 눈금은 x 좌표(m)다.',
    ],
    tools: '줄의 길이·한계 장력은 조작 패널에 있다. **컴퍼스 보조선**을 켜면 각 줄이 닿는 범위가 원호로 보인다.',
    params(rng, lab) { return generate(rng, lab.g); },
    defaults: { sL: 0, sR: 1, xL: 3.0, xR: 8.0, arcs: 0 },
    setup(room) {
      const p = room.p;
      room.lock('hang', {
        kind: 'task', label: '표적에 매달기',
        desc: `매듭이 표적 반경 ${TOL * 100} cm 안에서 2초간 멈춰야 한다.`,
        status: (rm) => rm.statusText || '',
      });
      room.lock('tl', {
        kind: 'code', label: '왼쪽 줄의 장력 T_L', unit: 'N', requires: 'hang',
        answer: (rm) => rm.state.answerTL != null ? rm.state.answerTL : rm.p.intended.TL, rtol: 0.02, placeholder: '예: 21.4',
        desc: '자물쇠 A를 연 그 배치에서. 허용 오차 ±2%.',
        notebook: (rm, v) => ({ key: 'c03-tl', text: '두 줄 — 왼쪽 줄 장력', value: `${Mathx.fmt(v, 1)} N` }),
      });
      const opts = STRING_NAMES.map((n, i) => ({ value: i, label: n }));
      const editing = (rm) => rm.phase !== 'edit';
      room.section('왼쪽 고리');
      room.choice('sL', {
        label: '줄', options: opts.map((o) => Object.assign({}, o, { disabled: (rm) => rm.value('sR') === o.value })),
        disabled: editing,
      });
      room.slider('xL', {
        label: '고리 위치 x', min: RAIL_X0, max: RAIL_X1, step: 0.05, unit: 'm', digits: 2, disabled: editing,
      });
      room.section('오른쪽 고리');
      room.choice('sR', {
        label: '줄', options: opts.map((o) => Object.assign({}, o, { disabled: (rm) => rm.value('sL') === o.value })),
        disabled: editing,
      });
      room.slider('xR', {
        label: '고리 위치 x', min: RAIL_X0, max: RAIL_X1, step: 0.05, unit: 'm', digits: 2, disabled: editing,
      });
      room.section('하중');
      room.button('load', {
        label: '하중 걸기', primary: true, row: 'load',
        disabled: (rm) => rm.phase !== 'edit',
        onClick: (rm) => rm.startLoading(),
      });
      room.button('rehang', { label: '다시 매달기', row: 'load', disabled: (rm) => rm.phase === 'edit', onClick: (rm) => Lab.game.resetRoom() });
      room.choice('arcs', { label: '컴퍼스 보조선', options: [{ value: 0, label: '끔' }, { value: 1, label: '켬' }] });
      room.note(STRING_NAMES.map((n, i) => `**${n}** 길이 ${Mathx.fmt(p.lens[i], 2)} m · 한계 ${p.strengths[i]} N`).join('\n'));
      room.note(`추 질량 **${Mathx.fmt(p.M, 1)} kg** · 줄의 질량과 늘어남은 무시한다.`);

      room.startLoading = function () {
        const pr = this.p;
        if (this.value('xR') - this.value('xL') < 0.2 - 1e-9) {
          this.say('왼쪽 고리는 오른쪽 고리보다 0.2 m 이상 왼쪽에 있어야 한다', 'bad');
          return;
        }
        const knot = this.o.weight.worldPoint(this.ringLocal);
        const sides = [['L', this.value('sL'), this.value('xL')], ['R', this.value('sR'), this.value('xR')]];
        for (const [, si, x] of sides) {
          const d = knot.dist(new Vec2(x, RAIL));
          if (d > pr.lens[si] - 0.005) {
            this.say(`${STRING_NAMES[si]}(${Mathx.fmt(pr.lens[si], 2)} m)가 매듭에 닿지 않는다 — 고리를 옮기거나 더 긴 줄을 써라`, 'bad');
            return;
          }
        }
        this.strings = sides.map(([side, si, x]) => {
          const j = new Joints.DistanceJoint(this.o.ceiling, this.o.weight, new Vec2(x, RAIL), knot, {
            length: pr.lens[si], rope: true, breakForce: pr.strengths[si], label: STRING_NAMES[si],
          });
          j.tensionTau = 0.25;
          j.side = side;
          return this.joint(j);
        });
        this.phase = 'loading';
        this.slackTime = 0;
        this.record(`하중 걸기 · 왼쪽 ${STRING_NAMES[sides[0][1]]} @ x = ${Mathx.fmt(sides[0][2], 2)} m · 오른쪽 ${STRING_NAMES[sides[1][1]]} @ x = ${Mathx.fmt(sides[1][2], 2)} m`);
        Lab.Sound && Lab.Sound.release();
      };
    },
    build(room) {
      const p = room.p, g = room.g;
      room.phase = 'edit';
      room.settle = 0;
      room.slackTime = 0;
      room.statusText = '';
      room.strings = [];
      room.reported = false;
      room.ringLocal = new Vec2(0, BOX / 2 + 0.03);
      // Weight hanging from the hoist directly above the target.
      const ring0 = new Vec2(p.target.x, START_Y);
      const w = room.add(Bodies.box(ring0.x, ring0.y - room.ringLocal.y, BOX, BOX, {
        mass: p.M, material: 'steel', linearDamping: 0.35, angularDamping: 2.5,
        style: { label: `${Mathx.fmt(p.M, 1)} kg`, labelOffset: new Vec2(0, -BOX / 2 - 0.13), ring: null },
      }), 'weight');
      room.ringLocal = w.localPoint(ring0);
      w.style.ring = room.ringLocal;
      const hoist = new Joints.Spring(room.o.ceiling, w, new Vec2(p.target.x, RAIL), ring0, {
        k: HOIST_K, damping: 2 * Math.sqrt(HOIST_K * p.M) * 0.9, mode: 'tension',
        restLength: RAIL - START_Y - (p.M * g) / HOIST_K, style: { hidden: true },
      });
      room.world.addForce(hoist);
      room.o.hoist = hoist;
    },
    preStep(room, dt) {
      const h = room.o.hoist;
      if (room.phase === 'loading' && h) {
        h.restLength += PAYOUT * dt;
        const slack = h.anchorA.dist(h.anchorB) <= h.restLength;
        if (slack) room.slackTime += dt; else room.slackTime = 0;
        if (room.slackTime > 0.4) {
          room.world.removeForce(h);
          room.o.hoist = null;
          room.phase = 'hanging';
          room.record('윈치 해제 · 두 줄이 하중을 모두 받음');
        } else if (h.restLength > RAIL - 0.3) {
          room.world.removeForce(h);
          room.o.hoist = null;
          room.phase = 'hanging';
        }
      }
    },
    step(room, dt) {
      if (room.phase !== 'hanging') return;
      const w = room.o.weight;
      const knot = w.worldPoint(room.ringLocal);
      const speed = w.velocityAt(knot).len();
      const err = knot.dist(room.p.target);
      const intact = room.strings.every((j) => !j.broken);
      if (intact && err < TOL && speed < 0.03) {
        room.settle += dt;
        room.statusText = `표적 오차 ${Mathx.fmt(err * 100, 1)} cm · 안정 ${Mathx.fmt(room.settle, 1)} s`;
        if (room.settle > 2 && !room.isOpen('hang')) {
          const [L, R] = room.strings;
          const xa = L.anchorA.x, xb = R.anchorA.x;
          room.state.answerTL = tensions(xa, xb, room.p.target, room.p.M * room.g).TL;
          room.persistState();
          room.openLock('hang');
          room.record(`매듭 정지 · 표적 오차 ${Mathx.fmt(err * 100, 1)} cm`);
        }
      } else {
        room.settle = 0;
        if (speed < 0.01 && !room.reported && room.time > 1) {
          room.reported = true;
          if (intact) {
            room.statusText = `표적에서 ${Mathx.fmt(err * 100, 1)} cm 벗어나 정지`;
            room.say(`매듭이 표적에서 ${Mathx.fmt(err * 100, 1)} cm 벗어난 곳에 멈췄다`, 'warn');
          }
        }
      }
    },
    onBreak(room, j) {
      room.statusText = `${j.label} 끊어짐`;
      room.say(`${j.label}가 끊어졌다 — 장력이 한계 ${room.p.strengths[STRING_NAMES.indexOf(j.label)]} N을 넘었다`, 'bad');
      room.record(`${j.label} 파단`);
      room.reported = true;
    },
    pointerDown(room, p) {
      if (room.phase !== 'edit') return null;
      for (const side of ['xL', 'xR']) {
        const x = room.value(side);
        if (Math.abs(p.x - x) < 0.2 && Math.abs(p.y - (RAIL + 0.02)) < 0.25) return { side };
      }
      return null;
    },
    pointerMove(room, p, e, handle) {
      const v = Mathx.clamp(Mathx.round(Mathx.snap(p.x, 0.05), 2), RAIL_X0, RAIL_X1);
      room.setValue(handle.side, v);
    },
    hover(room, p) {
      if (room.phase !== 'edit') return null;
      for (const side of ['xL', 'xR']) {
        if (Math.abs(p.x - room.value(side)) < 0.2 && Math.abs(p.y - (RAIL + 0.02)) < 0.25) return { cursor: 'ew-resize', tip: '끌어서 고리 위치 조절' };
      }
      return null;
    },
    snapPoints(room) { return [room.p.target.clone()]; },
    drawBack(room, r) {
      const th = r.theme;
      Kit.stencil(r, room, '03');
      // Ceiling rail with x scale.
      r.rect(RAIL_X0 - 0.2, RAIL + 0.02, RAIL_X1 + 0.2, RAIL + 0.1, { fill: th.instrument, stroke: th.ink, width: 1.1 });
      for (let x = Math.ceil(RAIL_X0 * 10) / 10; x <= RAIL_X1 + 1e-9; x = Mathx.round(x + 0.1, 2)) {
        const major = Math.abs(x - Math.round(x)) < 1e-6, half = Math.abs(x * 2 - Math.round(x * 2)) < 1e-6;
        r.line(new Vec2(x, RAIL + 0.1), new Vec2(x, RAIL + (major ? 0.02 : half ? 0.05 : 0.07)), { color: th.ink, width: major ? 1.2 : 0.7 });
        if (major) r.text(new Vec2(x, RAIL - 0.08), `${Math.round(x)}`, { size: 8.5, color: th.ink2, align: 'center' });
      }
      // String rack on the left wall.
      const p = room.p;
      STRING_NAMES.forEach((n, i) => {
        const y = 1.6 - i * 0.42;
        r.circle(new Vec2(0.35, y), 0.12, { fill: th.instrument, stroke: th.ink, width: 1.1 });
        r.circle(new Vec2(0.35, y), 0.05, { stroke: th.rope, width: 2 });
        r.text(new Vec2(0.55, y + 0.05), n, { size: 10, weight: 700, color: th.ink });
        r.text(new Vec2(0.55, y - 0.11), `${Mathx.fmt(p.lens[i], 2)} m · ${p.strengths[i]} N`, { size: 8.5, color: th.ink2 });
      });
      // Target.
      const T = p.target;
      r.circle(T, TOL, { stroke: th.info, width: 1.4, dash: [3, 3] });
      r.line(T.add(new Vec2(-0.12, 0)), T.add(new Vec2(0.12, 0)), { color: th.info, width: 1 });
      r.line(T.add(new Vec2(0, -0.12)), T.add(new Vec2(0, 0.12)), { color: th.info, width: 1 });
      r.text(T.add(new Vec2(0.16, 0.12)), '표적', { size: 9, color: th.info, font: 'sans' });
      // Compass arcs.
      if (room.value('arcs') && room.phase === 'edit') {
        for (const [s, x] of [[room.value('sL'), room.value('xL')], [room.value('sR'), room.value('xR')]]) {
          const L = p.lens[s];
          r.arc(new Vec2(x, RAIL), L, Math.PI, 2 * Math.PI, { color: th.info, width: 1, dash: [6, 5], alpha: 0.6 });
        }
      }
    },
    drawFront(room, r) {
      const th = r.theme;
      const p = room.p;
      const w = room.o.weight;
      const knot = w.worldPoint(room.ringLocal);
      // Hoist cable and winch.
      const winch = new Vec2(p.target.x, RAIL);
      r.rect(winch.x - 0.16, RAIL + 0.02, winch.x + 0.16, RAIL + 0.13, { fill: th.instrument, stroke: th.ink, width: 1.1 });
      if (room.o.hoist) r.line(winch, knot, { color: th.ink2, width: 1.4, dash: [2, 3] });
      // Preview strings in edit mode (slack, from hooks down to the knot).
      if (room.phase === 'edit') {
        for (const [s, x] of [[room.value('sL'), room.value('xL')], [room.value('sR'), room.value('xR')]]) {
          const a = new Vec2(x, RAIL), L = p.lens[s];
          const d = a.dist(knot);
          const ok = d <= L;
          if (ok) {
            const sag = Math.sqrt((3 * d * Math.max(0, L - d)) / 8);
            const mid = Vec2.lerp(a, knot, 0.5).add(new Vec2(0, -2 * Math.min(sag, 1.2)));
            const pts = [];
            for (let i = 0; i <= 20; i++) {
              const t = i / 20;
              pts.push(new Vec2((1 - t) ** 2 * a.x + 2 * (1 - t) * t * mid.x + t * t * knot.x, (1 - t) ** 2 * a.y + 2 * (1 - t) * t * mid.y + t * t * knot.y));
            }
            r.polyline(pts, { color: th.rope, width: 1.5, alpha: 0.75 });
          } else {
            r.line(a, a.add(knot.sub(a).norm().scale(L)), { color: th.danger, width: 1.5, dash: [4, 3] });
          }
        }
      } else {
        for (const j of room.strings) {
          if (j.broken) continue;
          const mid = Vec2.lerp(j.anchorA, j.anchorB, 0.5);
          r.text(mid, j.label, { size: 9, weight: 700, color: th.ink, bg: th.paper, align: 'center' });
        }
      }
      // Hook carriages.
      for (const [side, s] of [['xL', room.value('sL')], ['xR', room.value('sR')]]) {
        const x = room.value(side);
        const edit = room.phase === 'edit';
        r.rect(x - 0.12, RAIL + 0.02, x + 0.12, RAIL + 0.16, { fill: edit ? th.accent : th.instrument, stroke: th.ink, width: 1.2 });
        r.circle(new Vec2(x, RAIL), 0.03, { stroke: th.ink, width: 1.6, fill: th.paper });
        r.text(new Vec2(x, RAIL + 0.27), `${STRING_NAMES[s]} · ${Mathx.fmt(x, 2)}`, { size: 9, color: th.ink, align: 'center', bg: th.paper });
      }
    },
    hints: [
      '줄이 팽팽하면 매듭은 고리에서 정확히 줄 길이만큼 떨어져 있다. 표적이 레일보다 Δy 아래에 있으면 고리의 수평 거리는 `Δx = √(L² − Δy²)`. 두 원(고리 중심, 반지름 = 줄 길이)의 교점이 매듭의 자리다.',
      '매듭에서 세 힘이 평형을 이룬다. 줄이 연직선과 이루는 각을 φ라 하면 수평: `T_L·sinφ_L = T_R·sinφ_R`, 수직: `T_L·cosφ_L + T_R·cosφ_R = Mg`.',
      '라미의 정리: `T_L / sinφ_R = T_R / sinφ_L = Mg / sin(φ_L + φ_R)`. 연직에 가까운 줄이 하중을 더 많이 받는다. 약한 줄은 많이 눕혀서 써야 한다.',
    ],
    explain: [
      '팽팽한 줄 끝은 고리를 중심으로 하는 원 위에 있다. 두 줄이 모두 팽팽하면 매듭은 두 원의 교점, 그중 아래쪽 점에 놓인다. 원하는 자리에 매듭을 두려면 표적에서 레일까지 반지름 L인 원을 그려 레일과 만나는 곳에 고리를 단다.',
      { f: 'Δx = √(L² − Δy²)' },
      '매듭은 두 장력과 무게, 세 힘의 평형점이다. 세 힘이 평형이면 힘의 삼각형이 닫히고, 각 힘은 나머지 두 힘 사이 각의 사인에 비례한다.',
      { f: 'T_L / sin φ_R  =  T_R / sin φ_L  =  Mg / sin(φ_L + φ_R)' },
      (room) => {
        const it = room.p.intended;
        return `의도한 배치: 왼쪽 **${STRING_NAMES[it.a]}** @ x = ${Mathx.fmt(it.xa, 2)} m, 오른쪽 **${STRING_NAMES[it.b]}** @ x = ${Mathx.fmt(it.xb, 2)} m. 이때 T_L = ${Mathx.fmt(it.TL, 1)} N, T_R = ${Mathx.fmt(it.TR, 1)} N. 무게 Mg = ${Mathx.fmt(room.p.M * room.g, 1)} N보다 장력의 합이 큰 것은 두 줄이 서로를 옆으로 당기느라 힘을 쓰기 때문이다.`;
      },
    ],
  });

  Lab.C03 = { generate, knotFor, tensions, RAIL };
})(typeof window !== 'undefined' ? window : globalThis);
