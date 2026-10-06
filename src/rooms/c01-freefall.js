/*
 * Chamber 01 — Free fall. Measure this facility's g, then time a drop.
 */
(function (root) {
  'use strict';
  const Lab = root.Lab;
  const { Vec2, Bodies, Mathx, Kit } = Lab;

  const X = 2.6;            // drop axis
  const PLATE = 0.04;       // plate top
  const R = 0.06;           // ball radius
  const GATES = [{ id: 'A', y: 1.8 }, { id: 'B', y: 0.6 }];

  Lab.defineChamber({
    id: 'c01', no: 1, code: 'FREE FALL', title: '자유낙하',
    modes: ['M', 'C'],
    tags: ['중력 가속도', '등가속도 운동', '광문 계측'],
    size: [7, 7.2],
    objective: '이 실험동의 중력 가속도 **g**를 재서 입력하고(A), 강철 공이 정해진 시각에 충돌판을 때리도록 낙하 높이를 맞춰라(B).',
    briefing: [
      '격리 해제 절차 1단계: **보정(calibration)**. 이 실험동은 중력을 인공적으로 조정한다. 지구의 9.81 m/s²를 믿지 마라.',
      '전자석이 강철 공을 붙잡고 있다. 높이를 정하고 놓으면 공이 두 광문(PG-A, PG-B)을 지나 충돌판에 떨어진다. 광문은 놓은 순간부터 빛이 가려지기 시작한 순간까지의 시간 **t**를 0.1 ms 단위로 기록한다.',
      '높이는 모두 **공의 아래쪽 끝**과 **충돌판 윗면** 기준이다. 자(M)로 직접 재도 된다.',
    ],
    tools: '도구 — **자(M)**: 두 점 사이 거리 측정, 꼭짓점·광문 끝에 달라붙음 · **잔상(T)**: 1/20 s 간격 스트로보 · **0.25×**: 느린 재생',
    params(rng) {
      return { T: rng.pick([0.8, 0.85, 0.9, 0.95, 1.0]) };
    },
    defaults: { h: 3.0 },
    setup(room) {
      room.lock('g', {
        kind: 'code', label: '중력 가속도 g', unit: 'm/s²', answer: room.g, tol: 0.03, placeholder: '예: 9.81',
        desc: '소수 둘째 자리까지. 허용 오차 ±0.03.',
        notebook: (rm) => ({ key: 'g', text: '이 실험동의 중력 가속도 g', value: `${Mathx.fmt(rm.g, 2)} m/s²` }),
      });
      room.lock('timing', {
        kind: 'task', label: `충돌 시각 ${Mathx.fmt(room.p.T, 3)} s`,
        desc: `놓은 뒤 정확히 **${Mathx.fmt(room.p.T, 3)} s ± 0.004 s**에 공이 충돌판을 때려야 한다.`,
        status: (rm) => rm.lastHit != null ? `마지막 충돌 ${Mathx.fmt(rm.lastHit, 4)} s` : '아직 충돌 기록 없음',
      });
      room.section('전자석');
      room.slider('h', {
        label: '낙하 높이 h', min: 0.3, max: 6.5, step: 0.005, unit: 'm', digits: 3,
        help: '공의 아래쪽 끝에서 충돌판 윗면까지',
        onChange: (v, rm) => { if (rm.o.held) rm.o.ball.setPosition(new Vec2(X, PLATE + v + R)); },
      });
      room.button('drop', {
        label: '공 놓기', primary: true, row: 'act',
        disabled: (rm) => !rm.o.held,
        onClick: (rm) => {
          const b = rm.o.ball;
          b.setType('dynamic');
          b.vel.set(0, 0);
          rm.o.held = false;
          rm.startClock();
          rm.dropH = rm.value('h');
          rm.record(`낙하 시작 · h = ${Mathx.fmt(rm.dropH, 3)} m`);
          Lab.Sound && Lab.Sound.release();
        },
      });
      room.button('catch', {
        label: '공 회수', row: 'act',
        disabled: (rm) => rm.o.held,
        onClick: (rm) => Lab.game.resetRoom(),
      });
      room.readout('pga', { label: 'PG-A 광선 높이', get: () => '1.800 m' });
      room.readout('pgb', { label: 'PG-B 광선 높이', get: () => '0.600 m' });
    },
    build(room) {
      // Impact plate.
      room.o.plate = room.solid(X - 0.45, 0, X + 0.45, PLATE, { material: 'steel', style: { hidden: true } });
      const h = room.value('h');
      const ball = room.add(Bodies.circle(X, PLATE + h + R, R, { type: 'kinematic', material: 'steel', density: 7800, style: { spokes: 2 } }), 'ball');
      room.o.held = true;
      room.lastHitThisDrop = false;
      for (const g of GATES) {
        room.photogate({
          a: new Vec2(X - 0.32, PLATE + g.y), b: new Vec2(X + 0.32, PLATE + g.y), label: 'PG-' + g.id,
          readout: 'time', readoutPos: new Vec2(X + 0.95, PLATE + g.y),
          onBlock: (t) => room.record(`PG-${g.id} 차단 · t = ${Mathx.fmt(t, 4)} s`),
        });
      }
      room.strobeFilter = (b) => b === ball;
    },
    step(room, dt) {
      const b = room.o.ball;
      if (room.o.held || room.lastHitThisDrop) return;
      const y0 = b.prevPos.y - R - PLATE, y1 = b.pos.y - R - PLATE;
      if (y0 > 0 && y1 <= 0) {
        const t = room.clock - dt + (y0 / (y0 - y1)) * dt;
        room.lastHit = t;
        room.lastHitThisDrop = true;
        room.record(`충돌판 · t = ${Mathx.fmt(t, 4)} s`);
        if (!room.isOpen('timing')) {
          if (Math.abs(t - room.p.T) <= 0.004) room.openLock('timing');
          else room.say(`충돌 ${Mathx.fmt(t, 4)} s — 목표 ${Mathx.fmt(room.p.T, 3)} s`, 'warn');
        }
      }
    },
    pointerDown(room, p) {
      if (!room.o.held) return null;
      const top = PLATE + room.value('h') + 2 * R;
      if (Math.abs(p.x - X) < 0.3 && p.y > top - 0.15 && p.y < top + 0.3) return { dy: p.y - top };
      return null;
    },
    pointerMove(room, p, e, handle) {
      const h = Mathx.clamp(Mathx.round(Mathx.snap(p.y - handle.dy - PLATE - 2 * R, 0.005), 3), 0.3, 6.5);
      room.setValue('h', h);
    },
    hover(room, p) {
      if (!room.o.held) return null;
      const top = PLATE + room.value('h') + 2 * R;
      if (Math.abs(p.x - X) < 0.3 && p.y > top - 0.15 && p.y < top + 0.3) return { cursor: 'ns-resize', tip: '끌어서 낙하 높이 조절' };
      return null;
    },
    drawBack(room, r) {
      const th = r.theme;
      Kit.stencil(r, room, '01');
      // Glass drop tube.
      for (const dx of [-0.2, 0.2]) r.line(new Vec2(X + dx, PLATE), new Vec2(X + dx, room.H), { color: th.ink3, width: 1, alpha: 0.6 });
      Kit.stick(r, new Vec2(X + 0.5, PLATE), new Vec2(X + 0.5, 6.8), { side: 'right' });
      r.text(new Vec2(X + 0.5, PLATE + 6.95), '높이 (m)', { size: 9, color: th.ink2, align: 'center' });
      // Magnet rail.
      r.line(new Vec2(X - 0.42, 0.2), new Vec2(X - 0.42, room.H), { color: th.ink3, width: 3 });
    },
    drawFront(room, r) {
      const th = r.theme;
      const h = room.value('h');
      const top = PLATE + h + 2 * R;
      Kit.magnet(r, new Vec2(X, top + 0.004), room.o.held);
      r.line(new Vec2(X - 0.42, top + 0.08), new Vec2(X - 0.13, top + 0.08), { color: th.ink, width: 2.4 });
      r.rect(X - 0.47, top + 0.02, X - 0.37, top + 0.14, { fill: th.instrument, stroke: th.ink, width: 1 });
      Kit.plate(r, X - 0.45, X + 0.45, PLATE, room.lastHitThisDrop);
      r.dim(new Vec2(X - 0.2, PLATE), new Vec2(X - 0.2, PLATE + h), `h = ${Mathx.fmt(h, 3)} m`, { off: 0.62 });
      if (room.lastHit != null) r.lcd(new Vec2(X + 0.95, PLATE + 0.2), [`충돌 t ${Mathx.fmt(room.lastHit, 4)} s`], { align: 'left' });
    },
    hints: [
      '공은 정지 상태에서 떨어지므로 낙하 거리 d와 걸린 시간 t 사이에 `d = ½·g·t²` 이 성립한다. 광문은 공의 **아래쪽 끝**이 광선에 닿는 순간을 기록한다.',
      'h = 3.000 m에서 놓았다면 PG-A까지의 낙하 거리는 `3.000 − 1.800 = 1.200 m`. 그러면 `g = 2d / t²`. 두 광문을 함께 쓰면 `g = 2(d_B − d_A)/(t_B² − t_A²)`로 놓는 순간의 오차까지 지울 수 있다.',
      '자물쇠 B는 충돌판까지의 거리가 h 자신이다. `h = ½·g·T²` 을 계산해 0.005 m 단위로 맞춰라.',
    ],
    explain: [
      '정지 상태에서 떨어지는 물체는 등가속도 운동을 한다. 떨어진 거리는 시간의 제곱에 비례한다.',
      { f: 'd = ½ g t²   →   g = 2d / t²' },
      '광문 하나만 써도 g를 구할 수 있지만, 두 광문의 시각 차를 쓰면 출발 순간의 불확실성이 상쇄된다.',
      { f: 'g = 2(d_B − d_A) / (t_B² − t_A²)' },
      (room) => `이 실험동의 g는 **${Mathx.fmt(room.g, 2)} m/s²** 이다. 목표 시각 ${Mathx.fmt(room.p.T, 3)} s에 맞는 높이는 h = ½·g·T² = **${Mathx.fmt(0.5 * room.g * room.p.T * room.p.T, 3)} m**. 이후 모든 격실은 이 g 아래에서 작동한다.`,
    ],
  });
})(typeof window !== 'undefined' ? window : globalThis);
