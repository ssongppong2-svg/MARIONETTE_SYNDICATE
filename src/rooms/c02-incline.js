/*
 * Chamber 02 — Inclined plane. Static friction from the slip angle,
 * kinetic friction from the angle of constant-velocity sliding.
 */
(function (root) {
  'use strict';
  const Lab = root.Lab;
  const { Vec2, Bodies, Mathx, Kit } = Lab;
  const DEG = Mathx.DEG;

  const PIV = new Vec2(1.4, 1.0); // hinge at the low end of the ramp
  const LEN = 5.6;                 // ramp length
  const BL = 0.4, BH = 0.2;        // block size
  const S0 = 4.4;                  // block start (centre, along the ramp)
  const GATES = [{ id: '1', s: 3.2 }, { id: '2', s: 2.2 }];
  const NUDGE = 1.0;               // m/s
  const MAX_ANGLE = 40;

  function rampPoint(room, s, n) {
    return room.o.ramp.worldPoint(new Vec2(s, n));
  }

  Lab.defineChamber({
    id: 'c02', no: 2, chapter: 1, code: 'INCLINE', title: '경사면',
    modes: ['M', 'C'],
    tags: ['정지마찰', '운동마찰', '경사면 분해', '광문 계측'],
    size: [9, 5.4],
    objective: '황동 블록과 경사로 사이의 **정지마찰계수 μs**를 구해 입력하고(A), 살짝 민 블록이 **등속도로** 두 광문을 지나가는 경사각을 찾아라(B).',
    briefing: [
      '경사로는 왼쪽 끝 경첩을 축으로 0°에서 40°까지 기운다. 각도는 슬라이더나 숫자로 정하거나, 경사로 오른쪽 끝의 주황 손잡이를 끌어서 바꾼다.',
      '경사로에 붙은 두 광문(PG-1, PG-2)은 1.000 m 떨어져 있고, 길이 **0.400 m**인 블록이 빛을 가린 시간 **Δt**를 잰다.',
      '**밀기**는 정지한 블록에 경사 아래 방향으로 1.00 m/s의 속도를 준다. 이 격실의 g는 1번 격실에서 잰 값과 같다.',
    ],
    tools: '경사로를 천천히 기울이며 블록이 움직이는 순간을 지켜보라. 측정 기록에 미끄러짐이 시작된 각도가 남는다.',
    params(rng) {
      const mus = rng.step(0.3, 0.62, 0.01);
      const muk = Mathx.round(mus * rng.range(0.55, 0.8), 3);
      return { mus, muk };
    },
    defaults: { angle: 0 },
    setup(room) {
      room.lock('mus', {
        kind: 'code', label: '정지마찰계수 μs', unit: '', answer: room.p.mus, tol: 0.015, placeholder: '예: 0.45',
        desc: '소수 둘째 자리까지. 허용 오차 ±0.015.',
        notebook: (rm) => ({ key: 'c02-mus', text: '황동–강철 정지마찰계수 μs', value: Mathx.fmt(rm.p.mus, 2) }),
      });
      room.lock('cv', {
        kind: 'task', label: '등속 미끄럼',
        desc: '밀어 준 블록이 PG-1과 PG-2를 지날 때의 속력 차이가 **4% 미만**이어야 한다.',
        status: (rm) => rm.lastRun ? `마지막 시도 · θ = ${Mathx.fmt(rm.lastRun.angle, 1)}°` : '아직 시도 없음',
        notebook: (rm) => ({ key: 'c02-muk', text: '황동–강철 운동마찰계수 μk ≈ tan θ', value: Mathx.fmt(Math.tan(rm.o.ramp.angle), 3) }),
      });
      room.section('경사로');
      room.slider('angle', {
        label: '경사각 θ', min: 0, max: MAX_ANGLE, step: 0.1, unit: '°', digits: 1,
        help: '경사로는 최대 3°/s로 목표 각도까지 부드럽게 움직인다.',
      });
      room.readout('cur', { label: '현재 각도', get: (rm) => `${Mathx.fmt(rm.o.ramp.angle / DEG, 2)}°` });
      room.section('블록');
      room.button('push', {
        label: '밀기 1.00 m/s', primary: true, row: 'blk',
        disabled: (rm) => !rm.blockAtRest(),
        onClick: (rm) => rm.push(),
      });
      room.button('place', { label: '블록 원위치', row: 'blk', onClick: (rm) => rm.placeBlock() });
      room.note('블록 길이 0.400 m · 질량 2.00 kg · 두 광문 간격 1.000 m');

      room.placeBlock = function () {
        const ramp = this.o.ramp;
        const c = ramp.worldPoint(new Vec2(S0, BH / 2 - 0.0004));
        this.o.block.setPosition(c, ramp.angle);
        this.o.block.vel.copy(ramp.velocityAt(c));
        this.o.block.angVel = ramp.angVel;
        this.run = null;
        this.slipLogged = false;
        this.restTime = 0;
        this.startClock(); // re-arm the gates
      };
      room.blockRelSpeed = function () {
        const b = this.o.block;
        return b.vel.sub(this.o.ramp.velocityAt(b.pos)).len();
      };
      room.blockAtRest = function () { return this.o.block && this.blockRelSpeed() < 0.02; };
      room.push = function () {
        const ramp = this.o.ramp, b = this.o.block;
        const down = Vec2.fromAngle(ramp.angle + Math.PI);
        b.vel.copy(ramp.velocityAt(b.pos).addScaled(down, NUDGE));
        this.run = { v1: null, v2: null, angle: ramp.angle / DEG };
        this.slipLogged = true;
        this.record(`밀기 · θ = ${Mathx.fmt(ramp.angle / DEG, 2)}°`);
        Lab.Sound && Lab.Sound.release();
      };
    },
    build(room) {
      const p = room.p;
      const surface = { mu: p.mus, muk: p.muk, e: 0 };
      room.add(Bodies.polygon([new Vec2(0.95, 0), new Vec2(1.85, 0), new Vec2(1.4, 0.86)], { type: 'static' }), 'pedestal');
      const ramp = room.add(Bodies.local([
        { kind: 'box', x: LEN / 2, y: -0.06, w: LEN, h: 0.12 },
        { kind: 'box', x: -0.03, y: 0.02, w: 0.06, h: 0.28 },
      ], { type: 'kinematic', position: PIV, angle: room.value('angle') * DEG, material: 'steel', materialOverrides: surface, style: { fillToken: 'mSteel' } }), 'ramp');
      const c = ramp.worldPoint(new Vec2(S0, BH / 2 - 0.0004));
      room.add(Bodies.box(c.x, c.y, BL, BH, {
        angle: ramp.angle, mass: 2.0, material: 'brass', materialOverrides: surface,
        style: { com: true },
      }), 'block');
      room.restTime = 0;
      room.slipLogged = false;
      room.run = null;
      for (const g of GATES) {
        const gate = room.photogate({
          a: rampPoint(room, g.s, 0.02), b: rampPoint(room, g.s, 0.4), label: 'PG-' + g.id,
          readout: 'duration', labelAt: 'b', filter: (b) => b === room.o.block,
          onClear: (dur) => {
            room.record(`PG-${g.id} 차단 시간 Δt = ${Mathx.fmt(dur * 1000, 2)} ms`);
            const run = room.run;
            if (!run) return;
            const v = BL / dur;
            if (g.id === '1' && run.v1 == null) run.v1 = v;
            if (g.id === '2' && run.v1 != null && run.v2 == null) {
              run.v2 = v;
              room.lastRun = run;
              const diff = Math.abs(run.v2 - run.v1) / run.v1;
              if (diff < 0.04 && run.v1 > 0.3) room.openLock('cv');
              else if (!room.isOpen('cv')) room.say(run.v2 > run.v1 ? '블록이 빨라졌다 — 등속이 아니다' : '블록이 느려졌다 — 등속이 아니다', 'warn');
            }
          },
        });
        gate.s = g.s;
      }
    },
    preStep(room, dt) {
      const ramp = room.o.ramp;
      const target = room.value('angle') * DEG;
      const err = target - ramp.angle;
      const vmax = 3 * DEG, amax = 3 * DEG;
      const desired = Mathx.clamp(err * 1.2, -vmax, vmax);
      const dw = Mathx.clamp(desired - ramp.angVel, -amax * dt, amax * dt);
      ramp.angVel += dw;
      if (Math.abs(err) < 2e-6 && Math.abs(ramp.angVel) < 1e-4) {
        ramp.angVel = 0;
        ramp.angle = target;
        ramp.updateTransform();
      }
      for (const d of room.devices) {
        if (d.s != null) d.setBeam(rampPoint(room, d.s, 0.02), rampPoint(room, d.s, 0.4));
      }
    },
    step(room, dt) {
      const v = room.blockRelSpeed();
      if (v < 0.005) room.restTime += dt; else if (v > 0.03) {
        if (!room.slipLogged && room.restTime > 0.4) {
          room.record(`블록 미끄러짐 시작 · θ = ${Mathx.fmt(room.o.ramp.angle / DEG, 2)}°`);
          room.slipLogged = true;
        }
        room.restTime = 0;
      }
      if (v < 0.005 && room.restTime > 0.3) room.slipLogged = false;
    },
    pointerDown(room, p) {
      const h = rampPoint(room, LEN - 0.2, 0.0);
      if (p.dist(h) < 0.25) return { kind: 'angle' };
      return null;
    },
    pointerMove(room, p) {
      const a = Math.atan2(p.y - PIV.y, p.x - PIV.x) / DEG;
      room.setValue('angle', Mathx.clamp(Mathx.round(a, 1), 0, MAX_ANGLE));
    },
    hover(room, p) {
      const h = rampPoint(room, LEN - 0.2, 0.0);
      if (p.dist(h) < 0.25) return { cursor: 'grab', tip: '끌어서 경사각 조절' };
      return null;
    },
    snapPoints(room) {
      return [PIV.clone(), rampPoint(room, LEN, 0)];
    },
    drawBack(room, r) {
      const th = r.theme;
      Kit.stencil(r, room, '02');
      // Protractor around the hinge.
      for (let d = 0; d <= 45; d++) {
        const u = Vec2.fromAngle(d * DEG);
        const r0 = d % 10 === 0 ? 1.0 : d % 5 === 0 ? 1.05 : 1.08;
        r.line(PIV.addScaled(u, r0), PIV.addScaled(u, 1.13), { color: th.ink3, width: d % 5 === 0 ? 1.1 : 0.7 });
        if (d % 10 === 0) r.text(PIV.addScaled(u, 1.26), `${d}°`, { size: 8.5, color: th.ink2, align: 'center' });
      }
      r.arc(PIV, 1.13, 0, 45 * DEG, { color: th.ink3, width: 0.8 });
      // Screw jack under the high end.
      const end = rampPoint(room, LEN - 0.3, -0.12);
      r.rect(end.x - 0.09, 0, end.x + 0.09, Math.min(0.9, end.y - 0.05), { fill: th.instrument, stroke: th.ink, width: 1.1 });
      r.line(new Vec2(end.x, 0.9), end, { color: th.ink, width: 4 });
      r.line(new Vec2(end.x, 0.9), end, { color: th.instrument, width: 1.5 });
    },
    drawFront(room, r) {
      const th = r.theme;
      const ramp = room.o.ramp;
      const ang = ramp.angle;
      // Angle mark at the hinge.
      r.line(PIV, PIV.add(new Vec2(1.6, 0)), { color: th.ink2, width: 0.9, dash: [5, 4] });
      if (ang > 0.2 * DEG) r.angleMark(PIV, 0.8, 0, ang, null, { color: th.accent, width: 1.6 });
      r.text(PIV.add(new Vec2(0.2, 1.62)), `θ = ${Mathx.fmt(ang / DEG, 2)}°`, { size: 12, color: th.accent, weight: 700, bg: th.paper });
      // Drag handle.
      const hnd = rampPoint(room, LEN - 0.2, 0.0);
      r.circle(hnd, 0.09, { fill: th.accent, stroke: th.paper, width: 2 });
      // Gate spacing along the ramp, underneath.
      r.dim(rampPoint(room, GATES[1].s, -0.12), rampPoint(room, GATES[0].s, -0.12), '1.000 m', { off: -0.3 });
      // Block length.
      const b = room.o.block;
      const u = Vec2.fromAngle(b.angle), n = u.perp();
      const top = b.pos.addScaled(n, BH / 2);
      r.dim(top.addScaled(u, -BL / 2), top.addScaled(u, BL / 2), '0.400 m', { off: 0.16, size: 9.5 });
      // Gate readouts follow the ramp.
      for (const d of room.devices) {
        if (d.s == null) continue;
        d.readoutPos = rampPoint(room, d.s, 0.62);
        d.readoutAlign = 'center';
      }
    },
    hints: [
      '블록이 막 미끄러지기 시작하는 순간, 경사면 방향 중력 성분 `mg·sinθ`가 최대 정지마찰력 `μs·mg·cosθ`와 같다. 따라서 `μs = tan θc`. 각도를 0.1°씩 올려 가며 찾아라.',
      '광문은 0.400 m 블록이 빛을 가린 시간 Δt를 잰다: `v = 0.400 / Δt`. 두 광문이 1.000 m 떨어져 있으니 `a = (v₂² − v₁²) / (2 × 1.000)`.',
      '미끄러지는 동안 `a = g(sinθ − μk·cosθ)`. 어떤 각도에서 a를 재면 μk를 구할 수 있고, `θ = arctan(μk)`에서 블록은 등속으로 내려간다. g는 실험 노트에 있다.',
    ],
    explain: [
      '경사면 위 블록의 무게 mg는 경사면에 나란한 성분 `mg·sinθ`와 수직인 성분 `mg·cosθ`로 나뉜다. 수직항력은 N = mg·cosθ.',
      { f: '정지:  mg·sinθ ≤ μs·mg·cosθ   →   미끄러지는 각도  tan θc = μs' },
      '일단 움직이면 마찰계수는 더 작은 μk로 떨어진다. 그래서 θc보다 낮은 각도에서도 밀어 주면 계속 미끄러질 수 있다.',
      { f: '운동:  a = g(sinθ − μk·cosθ)   →   a = 0 일 때  tan θ = μk' },
      (room) => `이번 블록은 μs = **${Mathx.fmt(room.p.mus, 2)}** (θc = ${Mathx.fmt(Math.atan(room.p.mus) / DEG, 1)}°), μk = **${Mathx.fmt(room.p.muk, 3)}** (등속 각도 ${Mathx.fmt(Math.atan(room.p.muk) / DEG, 2)}°). 질량 2.00 kg은 어느 식에도 남지 않는다. 마찰 각은 질량과 g에 무관하다.`,
    ],
  });
})(typeof window !== 'undefined' ? window : globalThis);
