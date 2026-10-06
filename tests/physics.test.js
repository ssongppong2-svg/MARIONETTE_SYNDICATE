/*
 * Engine accuracy tests: every puzzle relies on these laws holding numerically.
 */
'use strict';
const { load, check, rel, near, summary, ENGINE_ONLY } = require('./harness');
const Lab = load(ENGINE_ONLY);
const { Vec2, World, Bodies, Joints, Fluid, Mathx } = Lab;
const DT = 1 / 240;

function ground(world, x0 = -20, x1 = 20, y = 0, material = 'concrete') {
  return world.add(Bodies.box((x0 + x1) / 2, y - 0.5, x1 - x0, 1, { type: 'static', material }));
}
function run(world, seconds, each) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    world.step(DT);
    if (each && each(world.time) === false) break;
  }
}

console.log('Free fall');
{
  const g = 7.37;
  const w = new World({ gravity: new Vec2(0, -g) });
  const ball = w.add(Bodies.circle(0, 10, 0.1, { material: 'steel' }));
  let tCross = null;
  let prevY = ball.pos.y;
  run(w, 2, (t) => {
    const y = ball.pos.y;
    if (prevY > 5 && y <= 5) tCross = t - DT + DT * (prevY - 5) / (prevY - y);
    prevY = y;
    return tCross == null;
  });
  const exact = Math.sqrt(2 * 5 / g);
  check('fall time over 5 m matches √(2h/g)', rel(tCross, exact) < 2e-4, `sim ${tCross.toFixed(5)} s vs ${exact.toFixed(5)} s`);
}

console.log('Projectile');
{
  const g = 9.81, v = 8, th = 50 * Mathx.DEG;
  const w = new World({ gravity: new Vec2(0, -g) });
  const ball = w.add(Bodies.circle(0, 0, 0.05, { velocity: new Vec2(v * Math.cos(th), v * Math.sin(th)) }));
  run(w, 1.0);
  const t = w.time;
  const x = v * Math.cos(th) * t, y = v * Math.sin(th) * t - 0.5 * g * t * t;
  check('parabola position after 1 s', near(ball.pos.x, x, 1e-6) && near(ball.pos.y, y, 1e-6), `(${ball.pos.x.toFixed(4)}, ${ball.pos.y.toFixed(4)}) vs (${x.toFixed(4)}, ${y.toFixed(4)})`);
}

console.log('Inclined plane friction');
function inclineTest(thetaDeg, mu, muk, seconds = 2) {
  const w = new World({ gravity: new Vec2(0, -9.81) });
  const th = thetaDeg * Mathx.DEG;
  const mat = { name: 't', mu, muk, e: 0 };
  // Long ramp body rotated by th.
  const ramp = w.add(Bodies.box(0, 0, 30, 0.4, { type: 'static', angle: th, materialOverrides: mat, material: mat }));
  const t = new Vec2(Math.cos(th), Math.sin(th)), n = new Vec2(-Math.sin(th), Math.cos(th));
  const start = t.scale(4).add(n.scale(0.2 + 0.1 - 0.0005));
  // Pair friction is √(μa·μb); both surfaces share the values under test.
  const block = w.add(Bodies.box(start.x, start.y, 0.3, 0.2, { angle: th, material: mat }));
  run(w, 0.3);
  const s0 = block.pos.dot(t), t0 = w.time;
  const v0 = block.vel.dot(t);
  run(w, seconds);
  const s1 = block.pos.dot(t), t1 = w.time;
  const dt = t1 - t0;
  const a = (2 * (s1 - s0 - v0 * dt)) / (dt * dt);
  return { a, moved: Math.abs(s1 - s0), block, ramp };
}
{
  const r = inclineTest(20, 0.4, 0.3);
  check('block holds below arctan(μs)  (20° < 21.8°)', r.moved < 0.002, `moved ${(r.moved * 1000).toFixed(2)} mm`);
  const r2 = inclineTest(23, 0.4, 0.3);
  const th = 23 * Mathx.DEG;
  const aExp = -9.81 * (Math.sin(th) - 0.3 * Math.cos(th));
  check('block slides above arctan(μs) with a = g(sinθ − μk cosθ)', rel(r2.a, aExp) < 0.01, `a ${r2.a.toFixed(4)} vs ${aExp.toFixed(4)}`);
  const r3 = inclineTest(21.5, 0.4, 0.3, 3);
  check('block holds just below arctan(0.4)=21.80°  (21.5°)', r3.moved < 0.003, `moved ${(r3.moved * 1000).toFixed(2)} mm`);
}

console.log('Stacking');
{
  const w = new World({ gravity: new Vec2(0, -9.81) });
  ground(w);
  const boxes = [];
  for (let i = 0; i < 10; i++) boxes.push(w.add(Bodies.box(0, 0.1 + i * 0.2, 0.4, 0.2, { material: 'wood' })));
  run(w, 10);
  const top = boxes[9];
  check('10-box tower stands for 10 s', Math.abs(top.pos.x) < 0.01 && Math.abs(top.pos.y - 1.9) < 0.03, `top at ${top.pos}`);
  const maxV = Math.max(...boxes.map((b) => b.vel.len()));
  check('tower at rest', maxV < 0.01, `max speed ${maxV.toExponential(2)}`);
}

console.log('Overhang (harmonic stack)');
{
  const w = new World({ gravity: new Vec2(0, -9.81) });
  w.add(Bodies.box(-2, -0.5, 4, 1, { type: 'static', material: 'wood' }));
  const L = 0.6, h = 0.1;
  // Offsets of block centres from the table edge for a 4-block harmonic stack, 2% margin.
  const s = 0.98;
  const right = [L / 8, L / 8 + L / 6, L / 8 + L / 6 + L / 4, L / 8 + L / 6 + L / 4 + L / 2].map((v) => v * s);
  const blocks = [];
  for (let i = 0; i < 4; i++) {
    const rightEnd = right[i];
    blocks.push(w.add(Bodies.box(rightEnd - L / 2, h / 2 + i * h, L, h, { material: 'wood' })));
  }
  run(w, 6);
  const top = blocks[3];
  check('near-critical harmonic stack holds', Math.abs(top.pos.x - (right[3] - L / 2)) < 0.01 && top.pos.y > 0.3, `top x ${top.pos.x.toFixed(3)} y ${top.pos.y.toFixed(3)}`);
}

console.log('Restitution');
{
  const w = new World({ gravity: new Vec2(0, -9.81) });
  ground(w, -5, 5, 0, { name: 'f', mu: 0.5, e: 0.8 });
  const ball = w.add(Bodies.circle(0, 2.1, 0.1, { material: { name: 'b', mu: 0.5, e: 1 } }));
  let maxY = 0, bounced = false;
  run(w, 3, () => {
    if (ball.vel.y > 0) bounced = true;
    if (bounced) maxY = Math.max(maxY, ball.pos.y - 0.1);
    if (bounced && ball.vel.y < 0) return false;
  });
  check('bounce height = e²·h', rel(maxY, 0.64 * 2.0) < 0.01, `${maxY.toFixed(4)} m vs ${(1.28).toFixed(4)} m`);
}

console.log('Pendulum');
{
  const g = 9.81, L = 2.0;
  const w = new World({ gravity: new Vec2(0, -g) });
  const pivot = w.add(Bodies.box(0, 5, 0.1, 0.1, { type: 'static' }));
  const th0 = 4 * Mathx.DEG;
  const bobPos = new Vec2(L * Math.sin(th0), 5 - L * Math.cos(th0));
  const bob = w.add(Bodies.circle(bobPos.x, bobPos.y, 0.05, { density: 7800 }));
  w.addJoint(new Joints.DistanceJoint(pivot, bob, new Vec2(0, 5), bobPos, { rope: false }));
  const crossings = [];
  let prevX = bob.pos.x;
  run(w, 12, (t) => {
    const x = bob.pos.x;
    if (prevX > 0 && x <= 0) crossings.push(t - DT + DT * prevX / (prevX - x));
    prevX = x;
  });
  const T = (crossings[crossings.length - 1] - crossings[0]) / (crossings.length - 1);
  // Large-amplitude correction for 4°: T ≈ T0(1 + θ²/16)
  const T0 = 2 * Math.PI * Math.sqrt(L / g) * (1 + th0 * th0 / 16);
  check('period = 2π√(L/g)', rel(T, T0) < 0.002, `${T.toFixed(5)} s vs ${T0.toFixed(5)} s`);
  check('rod length preserved', Math.abs(bob.pos.dist(new Vec2(0, 5)) - L) < 0.002);
}

console.log('Atwood machine (rope over pulley)');
{
  const g = 9.81, m1 = 3, m2 = 2;
  const w = new World({ gravity: new Vec2(0, -g) });
  const ceiling = w.add(Bodies.box(0, 6, 4, 0.2, { type: 'static' }));
  const R = 0.15;
  const b1 = w.add(Bodies.box(-R, 3, 0.2, 0.2, { mass: m1 }));
  const b2 = w.add(Bodies.box(R, 3, 0.2, 0.2, { mass: m2 }));
  const rope = w.addJoint(new Joints.RopePath([
    { body: b1, point: new Vec2(-R, 3.1) },
    { body: ceiling, point: new Vec2(0, 5.5), radius: R },
    { body: b2, point: new Vec2(R, 3.1) },
  ]));
  run(w, 0.2);
  const y0 = b1.pos.y, v0 = b1.vel.y, t0 = w.time;
  run(w, 1.0);
  const dt = w.time - t0;
  const a = (2 * (b1.pos.y - y0 - v0 * dt)) / (dt * dt);
  const aExp = -(m1 - m2) * g / (m1 + m2);
  check('a = (m1 − m2)g/(m1 + m2)', rel(a, aExp) < 0.01, `${a.toFixed(4)} vs ${aExp.toFixed(4)}`);
  const Texp = 2 * m1 * m2 * g / (m1 + m2);
  check('tension = 2m1m2g/(m1+m2)', rel(rope.tension, Texp) < 0.02, `${rope.tension.toFixed(3)} N vs ${Texp.toFixed(3)} N`);
}

console.log('Movable pulley 2:1');
{
  const g = 9.81, mc = 4, mw = 2.5;
  const w = new World({ gravity: new Vec2(0, -g) });
  const ceiling = w.add(Bodies.box(0, 6, 6, 0.2, { type: 'static' }));
  const R = 0.12;
  const cage = w.add(Bodies.box(0, 2, 0.4, 0.4, { mass: mc }));
  const wt = w.add(Bodies.box(0.6 + R, 3, 0.2, 0.2, { mass: mw }));
  w.addJoint(new Joints.SliderJoint(ceiling, cage, new Vec2(0, 2), new Vec2(0, 1)));
  w.addJoint(new Joints.SliderJoint(ceiling, wt, new Vec2(0.6 + R, 3), new Vec2(0, 1)));
  // anchor at ceiling → down around a wheel on the cage (ccw, under) → up over a fixed wheel → weight
  w.addJoint(new Joints.RopePath([
    { body: ceiling, point: new Vec2(-R, 5.9) },
    { body: cage, point: new Vec2(0, 2.3), radius: -R },
    { body: ceiling, point: new Vec2(0.6, 5.6), radius: R },
    { body: wt, point: new Vec2(0.6 + R, 3.1) },
  ]));
  run(w, 0.1);
  const y0 = cage.pos.y, v0 = cage.vel.y, t0 = w.time;
  run(w, 0.8);
  const dt = w.time - t0;
  const a = (2 * (cage.pos.y - y0 - v0 * dt)) / (dt * dt);
  const aExp = (2 * mw - mc) * g / (mc + 4 * mw);
  check('cage a = (2mw − mc)g/(mc + 4mw)', rel(a, aExp) < 0.015, `${a.toFixed(4)} vs ${aExp.toFixed(4)}`);
}

console.log('Rolling without slipping');
{
  for (const beta of [0.5, 1.0, 0.4]) {
    const g = 9.81, th = 15 * Mathx.DEG;
    const w = new World({ gravity: new Vec2(0, -g) });
    w.add(Bodies.box(0, 0, 40, 0.4, { type: 'static', angle: -th, material: 'rubber' }));
    const t = new Vec2(Math.cos(th), -Math.sin(th)), n = new Vec2(Math.sin(th), Math.cos(th));
    const r = 0.1;
    const start = t.scale(-6).add(n.scale(0.2 + r + 0.0005));
    const cyl = w.add(Bodies.circle(start.x, start.y, r, { material: 'rubber', mass: 1, inertiaFactor: beta }));
    run(w, 0.2);
    const s0 = cyl.pos.dot(t), v0 = cyl.vel.dot(t), t0 = w.time;
    run(w, 1.5);
    const dt = w.time - t0;
    const a = (2 * (cyl.pos.dot(t) - s0 - v0 * dt)) / (dt * dt);
    const aExp = g * Math.sin(th) / (1 + beta);
    check(`β = ${beta}: a = g sinθ/(1+β)`, rel(a, aExp) < 0.01, `${a.toFixed(4)} vs ${aExp.toFixed(4)}`);
  }
}

console.log('Buoyancy');
{
  const w = new World({ gravity: new Vec2(0, -9.81) });
  w.add(Bodies.box(0, -0.25, 4, 0.5, { type: 'static' }));
  w.add(Bodies.box(-2.1, 1, 0.2, 3, { type: 'static' }));
  w.add(Bodies.box(2.1, 1, 0.2, 3, { type: 'static' }));
  w.addFluid(new Fluid({ x0: -2, x1: 2, y0: 0, surface: 1.5, density: 1000 }));
  const block = w.add(Bodies.box(0, 1.6, 0.4, 0.3, { density: 600 }));
  const ball = w.add(Bodies.circle(1.2, 1.7, 0.15, { density: 250 }));
  run(w, 12);
  const depth = 1.5 - (block.pos.y - 0.15);
  check('floating block draft = ρ/ρw · h', near(depth, 0.18, 0.004), `draft ${depth.toFixed(4)} m vs 0.1800 m`);
  // circle: submerged area fraction 0.25
  const sub = Lab.Geom.circleBelowLine(ball.pos, 0.15, 1.5).area / (Math.PI * 0.15 * 0.15);
  check('floating ball displaces ρ/ρw of its area', near(sub, 0.25, 0.005), `fraction ${sub.toFixed(4)}`);
}

console.log('Elastic puck collision (top-down)');
{
  const w = new World({ gravity: new Vec2(0, 0) });
  const a = w.add(Bodies.circle(0, 0, 0.1, { material: 'puck', velocity: new Vec2(2, 0) }));
  const b = w.add(Bodies.circle(1, 0, 0.1, { material: 'puck' }));
  run(w, 1);
  check('equal masses exchange velocity', near(a.vel.x, 0, 1e-6) && near(b.vel.x, 2, 1e-6), `va ${a.vel.x.toFixed(4)} vb ${b.vel.x.toFixed(4)}`);
  // oblique: 90° separation
  const w2 = new World({ gravity: new Vec2(0, 0) });
  const c = w2.add(Bodies.circle(0, 0, 0.1, { material: 'puck', velocity: new Vec2(2, 0) }));
  const d = w2.add(Bodies.circle(1, 0.1, 0.1, { material: 'puck' }));
  run(w2, 1);
  const angle = Math.acos(c.vel.norm().dot(d.vel.norm())) / Mathx.DEG;
  check('oblique elastic collision separates at 90°', near(angle, 90, 0.05), `${angle.toFixed(3)}°`);
  check('kinetic energy conserved', rel(0.5 * c.mass * c.vel.lenSq() + 0.5 * d.mass * d.vel.lenSq(), 0.5 * c.mass * 4) < 1e-6);
}

console.log('Cushion restitution angle');
{
  const e = 0.6;
  const w = new World({ gravity: new Vec2(0, 0) });
  w.add(Bodies.box(0, 1.1, 10, 0.2, { type: 'static', material: { name: 'c', mu: 0, muk: 0, e } }));
  const puck = w.add(Bodies.circle(0, 0, 0.1, { material: 'puck', velocity: new Vec2(1, 1) }));
  run(w, 2);
  check('v_n scaled by e, v_t unchanged', near(puck.vel.x, 1, 1e-6) && near(puck.vel.y, -e, 1e-3), `v = ${puck.vel}`);
}

console.log('Lever balance');
{
  const g = 9.81;
  const w = new World({ gravity: new Vec2(0, -g) });
  const base = w.add(Bodies.box(0, 0, 0.2, 0.2, { type: 'static' }));
  const beam = w.add(Bodies.box(0, 1, 3, 0.08, { mass: 2, category: 2, mask: 1 }));
  w.addJoint(new Joints.RevoluteJoint(base, beam, new Vec2(0, 1), { limit: { enabled: true, lower: -0.3, upper: 0.3 } }));
  // weights hanging on short ropes: 3 kg at -0.8 m, 2 kg at +1.2 m → balanced
  const w1 = w.add(Bodies.box(-0.8, 0.6, 0.1, 0.1, { mass: 3, category: 2, mask: 1 }));
  const w2 = w.add(Bodies.box(1.2, 0.6, 0.1, 0.1, { mass: 2, category: 2, mask: 1 }));
  w.addJoint(new Joints.DistanceJoint(beam, w1, new Vec2(-0.8, 1), new Vec2(-0.8, 0.65), { rope: false }));
  w.addJoint(new Joints.DistanceJoint(beam, w2, new Vec2(1.2, 1), new Vec2(1.2, 0.65), { rope: false }));
  run(w, 5);
  check('balanced lever stays level', Math.abs(beam.angle) < 0.002, `${(beam.angle / Mathx.DEG).toFixed(4)}°`);
  w2.setMass(2.1);
  run(w, 3);
  check('unbalanced lever tips clockwise onto its stop', Math.abs(beam.angle + 0.3) < 0.01, `${(beam.angle / Mathx.DEG).toFixed(2)}°`);
}

console.log('Spring');
{
  const g = 9.81, k = 200, m = 2;
  const w = new World({ gravity: new Vec2(0, -g) });
  const hook = w.add(Bodies.box(0, 3, 0.1, 0.1, { type: 'static' }));
  const mass = w.add(Bodies.box(0, 2, 0.2, 0.2, { mass: m }));
  w.addForce(new Joints.Spring(hook, mass, new Vec2(0, 3), new Vec2(0, 2.1), { k, restLength: 0.9, damping: 8 }));
  run(w, 8);
  const ext = (3 - (mass.pos.y + 0.1)) - 0.9;
  check('static extension = mg/k', rel(ext, m * g / k) < 0.003, `${ext.toFixed(5)} vs ${(m * g / k).toFixed(5)}`);
}

process.exit(summary() ? 1 : 0);
