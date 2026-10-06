/*
 * ΣF — mechanics, and a full playthrough driven only by the tow line,
 * the way a mouse would: grab, drag, whip, let go.
 */
'use strict';
const { load, check, summary, ENGINE_ONLY } = require('./harness');
const Lab = load(ENGINE_ONLY.concat(['src/sigma/level.js', 'src/sigma/rules.js']));
const { Vec2 } = Lab;
const DT = 1 / 240;
const V = (x, y) => new Vec2(x, y);
const g = 9.8;

function setup() {
  const lv = Lab.Sigma.build();
  const r = new Lab.Sigma.Rules(lv);
  return { lv, r, L: lv.L };
}
/** Step for `seconds`; `each` returning false stops early (and returns true). */
function run(ctx, seconds, each) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    if (each && each() === false) return true;
    ctx.r.step(DT);
  }
  return false;
}
function slide(ctx, p, seconds) { ctx.r.moveCursor(p, seconds); run(ctx, seconds); }
/** Pick a body up by its centre, carry it over `via` points and set it down at `to`. */
function carry(ctx, body, via, to) {
  const p = body.pos.clone();
  ctx.r.setCursor(p);
  if (!ctx.r.grab(p)) return false;
  // At an easy 1.5 m/s, so the load does not swing into things.
  const go = (q, min) => slide(ctx, q, Math.max(min, ctx.r.tether.hand.dist(q) / 1.5));
  for (const q of via) { go(q, 0.6); run(ctx, 0.6); }
  go(to, 1.5);
  run(ctx, 1.2);
  ctx.r.release();
  run(ctx, 0.6);
  return true;
}
/** Keep the hand a fixed offset ahead of the grabbed point, every frame. */
function lead(ctx, offset, seconds, until) {
  const frames = Math.round(seconds * 30);
  for (let i = 0; i < frames; i++) {
    if (!ctx.r.tether.body) return false;
    ctx.r.moveCursor(ctx.r.tether.point.add(offset), 1 / 30);
    if (run(ctx, 1 / 30, until)) return true;
  }
  return false;
}
function throwAtGlass(ctx, body) {
  const p = body.pos.clone();
  ctx.r.setCursor(p);
  ctx.r.grab(p);
  slide(ctx, V(5.4, 3.2), 0.4);
  run(ctx, 0.6);
  ctx.r.moveCursor(V(1.0, 6.0), 0.3);
  run(ctx, 0.6, () => body.vel.len() < 8.0);
  ctx.r.release();
  run(ctx, 1.5);
}
/** S-8 and S-4 set down side by side on the closed hatch: 428 N. */
function stage(ctx) {
  const { lv } = ctx;
  const [S4, S8] = [lv.stones[3], lv.stones[7]];
  carry(ctx, S8, [V(7.85, 6.4), V(9.6, 6.4), V(12.45, 3.9)], V(12.45, 3.15));
  carry(ctx, S4, [V(9.7, 3.7), V(13.15, 4.0)], V(13.15, 3.0));
}
/** Pull the trap lever until the latch lets the flaps drop. */
function pullTrap(ctx) {
  const { r, lv } = ctx;
  const n = r.hatchDrops;
  const p = lv.trap.pos.add(V(0, 0.1));
  r.setCursor(p);
  r.grab(p);
  lead(ctx, V(0.6, 0), 2, () => r.hatchDrops === n);
  r.release();
  run(ctx, 2.5);
}
/** Pull the crate along, 25° up, until it sits on the hatch; then let go. */
function dragCrate(ctx) {
  const { r, lv } = ctx;
  const k = lv.crate;
  r.setCursor(k.pos.clone());
  r.grab(k.pos.clone());
  const a = (25 * Math.PI) / 180;
  // Let go early: once free it coasts v²/(2·μk·g) further on the rough deck.
  const stops = () => k.pos.x + (k.vel.x * k.vel.x) / (2 * 0.48 * g);
  lead(ctx, V(Math.cos(a), Math.sin(a)).scale(0.9), 40, () => stops() < 12.8);
  r.release();
  run(ctx, 1.5);
}
function onDeck(ctx, x) {
  const k = ctx.lv.crate;
  k.setPosition(V(x, ctx.L.DECK + k.size[1] / 2 + 0.001));
  k.vel.set(0, 0);
  run(ctx, 0.4);
}

console.log('Tow line: a spring scale with a ceiling');
{
  const ctx = setup();
  const s = ctx.lv.stones[2];
  ctx.r.setCursor(s.pos.clone());
  ctx.r.grab(s.pos.clone());
  slide(ctx, s.pos.add(V(0, 1.2)), 0.6);
  run(ctx, 2);
  const F = ctx.r.tether.F.len();
  check('hanging still, the line reads the weight (F = kx = mg)', Math.abs(F - s.mass * g) < 0.5, `${F.toFixed(2)} N vs ${(s.mass * g).toFixed(2)} N`);
  check('stretch matches F / k', Math.abs(ctx.r.tether.stretch - F / ctx.L.TETHER.k) < 0.005, `${ctx.r.tether.stretch.toFixed(4)} m`);
  ctx.r.release();
  const lead = ctx.lv.lead;
  ctx.r.setCursor(lead.pos.clone());
  ctx.r.grab(lead.pos.clone());
  slide(ctx, lead.pos.add(V(0, 0.9)), 0.5);
  run(ctx, 1.5);
  check('the 34.5 kg lead block (338 N) is just liftable under 360 N', lead.pos.y > ctx.L.SHELF.y + 0.2, `y ${lead.pos.y.toFixed(2)}`);
}

console.log('Friction: the crate will not slide flat, but will at an angle');
{
  const ctx = setup();
  for (const s of ctx.lv.stones) if (s.pos.y > 2 && s.pos.y < 3.5) ctx.lv.world.remove(s);
  ctx.lv.world.remove(ctx.lv.pumice);
  onDeck(ctx, 5);
  const k = ctx.lv.crate, x0 = k.pos.x;
  ctx.r.setCursor(k.pos.clone());
  ctx.r.grab(k.pos.clone());
  lead(ctx, V(1.0, 0), 2);
  const A = ctx.r.analyze(k);
  check('flat pull maxes out at 360 N below μs·N', Math.abs(k.pos.x - x0) < 0.01 && ctx.r.tether.maxed, `moved ${(k.pos.x - x0).toFixed(3)} m, μs·N ${A.frMax.toFixed(1)} N`);
  const a = (25 * Math.PI) / 180;
  lead(ctx, V(Math.cos(a), Math.sin(a)).scale(0.9), 2);
  check('pulling 25° upward lightens N and the crate slides', k.pos.x - x0 > 0.8, `moved ${(k.pos.x - x0).toFixed(2)} m`);
}

console.log('Glass: only a hard throw breaks it; the valve is sealed until then');
{
  const ctx = setup();
  const knob = ctx.lv.mainValve;
  ctx.r.setCursor(V(1.0, 3.9));
  check('the cabinet is sealed while the glass stands', ctx.r.grab(knob.pos.clone()) === null);
  // A gentle lob that touches the glass.
  const s = ctx.lv.stones[1];
  ctx.r.setCursor(s.pos.clone());
  ctx.r.grab(s.pos.clone());
  slide(ctx, V(3.4, 4.0), 0.8);
  slide(ctx, V(1.55, 3.95), 1.0);
  run(ctx, 0.8);
  ctx.r.release();
  run(ctx, 1);
  check('pressing a stone against it does nothing', !ctx.r.glassBroken, ctx.r.lastImpact ? `${ctx.r.lastImpact.F.toFixed(0)} N` : 'no impact');
  throwAtGlass(ctx, ctx.lv.pumice);
  check('a hard throw breaks it', ctx.r.glassBroken, ctx.r.lastImpact ? `${ctx.r.lastImpact.F.toFixed(0)} N ≥ ${ctx.L.GLASS.threshold} N` : '');
}

console.log('Buoyancy: the raft lifts the crate to the deck');
{
  const ctx = setup();
  ctx.r.glassBroken = true;
  ctx.r.lv.world.remove(ctx.lv.glass);
  ctx.lv.mainValve.setPosition(ctx.lv.mainValve.pos.add(V(0.38, 0)));
  run(ctx, 40, () => ctx.lv.sumpLevel() < 2.45);
  const raft = ctx.lv.raft, top = raft.pos.y + raft.size[1] / 2;
  check('raft floats level, carrying the crate', Math.abs(raft.angle) < 0.05 && ctx.lv.crate.pos.y > top, `angle ${raft.angle.toFixed(3)}`);
  check('at level 2.45 m the raft deck is above the 2.60 m deck', top > ctx.L.DECK, `raft top ${top.toFixed(3)} m`);
  run(ctx, 10);
  check('left open, the sump overflows into the counterweight bucket', ctx.lv.bucketWater > 1, `${ctx.lv.bucketWater.toFixed(1)} kg in the bucket`);
}

console.log('Hatch: a load cell on a spring-latched trapdoor');
{
  const ctx = setup();
  const { lv, r } = ctx;
  stage(ctx);
  const W = (lv.stones[3].mass + lv.stones[7].mass) * g;
  check('the closed hatch weighs what rests on it', r.hatchDrops === 0 && Math.abs(r.hatchLoad - W) < 6, `${r.hatchLoad.toFixed(1)} N vs ${W.toFixed(1)} N`);
  const p = lv.trap.pos.add(V(0, 0.1));
  r.setCursor(p);
  r.grab(p);
  slide(ctx, p.add(V(0.43, 0)), 0.5);
  run(ctx, 1);
  const x = lv.trapTravel(), F = r.tether.F.len();
  check('the latch spring pushes back F = F0 + k·x', r.hatchDrops === 0 && Math.abs(F - (150 + 500 * x)) < 3, `x ${x.toFixed(3)} m, F ${F.toFixed(1)} N`);
  r.release();
  pullTrap(ctx);
  let inside = r.bucketContents().map((b) => b.tag).sort().join(' ');
  check('past the trip point the flaps drop the load into the bucket', inside === 'S-4 S-8', inside);
  check('the flaps close again and the lever springs home', lv.hatch.every((f) => f.world) && lv.trapTravel() < 0.01);
  for (const s of [lv.stones[1], lv.stones[5]]) lv.world.remove(s);
  onDeck(ctx, 11.0);
  dragCrate(ctx);
  check('the crate can be parked on the hatch', r.hatchLoad > 600, `load ${r.hatchLoad.toFixed(1)} N`);
  pullTrap(ctx);
  inside = r.bucketContents().map((b) => b.tag).sort().join(' ');
  check('and dropped in after them', inside === 'K-64 S-4 S-8', inside);
}

console.log('Door: static friction to start, a governor at 0.60 m/s');
{
  const trial = (contents) => {
    const ctx = setup();
    const { lv, r } = ctx;
    const k = lv.crate;
    k.setPosition(V(12.8, lv.bucket.worldPoint(lv.bucketLocal.floor).y + k.size[1] / 2 + 0.03));
    k.vel.set(0, 0);
    run(ctx, 2);
    lv.bucketWater = contents - 64;
    lv.bucket.setMass(ctx.L.BUCKET.mass + lv.bucketWater);
    run(ctx, 0.3);
    lv.pin.setPosition(lv.pin.pos.add(V(0.35, 0)));
    run(ctx, 7, () => !(r.lockout || r.doorOpen));
    return r;
  };
  const Dr = Lab.Sigma.L.DOOR, mb = Lab.Sigma.L.BUCKET.mass;
  const predict = (contents) => {
    const W = (mb + contents) * g, F = W - Dr.mass * g - Dr.fk;
    return Math.sqrt((2 * Dr.rise * F) / (Dr.mass + mb + contents));
  };
  let r = trial(106.8);
  check('W_CW under W_D + f_s: the door stays shut', !r.doorOpen && !r.lockout && r.doorVmax < 0.05, `v ${r.doorVmax.toFixed(3)}`);
  r = trial(108.6);
  check('inside the window it opens below the limit', r.doorOpen && !r.lockout, `v_top ${r.doorVmax.toFixed(3)} m/s`);
  check('the motion matches (W_CW − W_D − f_k) = (m_D + m_CW)·a', Math.abs(r.doorVmax - predict(108.6)) < 0.025, `sim ${r.doorVmax.toFixed(3)} vs ${predict(108.6).toFixed(3)}`);
  r = trial(110.5);
  check('too heavy: the governor locks it out', r.lockout && !r.doorOpen, `v ${r.doorVmax.toFixed(3)} m/s`);
}

console.log('Reach: the line needs a clear path and open air');
{
  const ctx = setup();
  const { lv, r } = ctx;
  r.setCursor(V(15.2, 3.0));
  check('the vault is sealed while its door is down', r.grab(lv.core.pos.clone()) === null);
  const s = lv.stones[3];
  r.setCursor(s.pos.clone());
  r.grab(s.pos.clone());
  slide(ctx, V(s.pos.x, 5.6), 0.6);
  slide(ctx, V(7.5, 4.6), 0.4);   // the shelf now lies between hand and stone
  run(ctx, 0.3);
  check('the line snaps when rock comes between hand and load', !r.tether.body && r.stats.snaps === 1, `${r.stats.snaps} snap(s)`);
}

console.log('Full playthrough with the tow line only');
{
  const ctx = setup();
  const { lv, r, L } = ctx;
  const [S2, S6] = [lv.stones[1], lv.stones[5]];

  // 1. Weigh S-8 + S-4 on the hatch and drop them into the bucket.
  stage(ctx);
  check('S-8 + S-4 weighed on the hatch', Math.abs(r.hatchLoad - 43.7 * g) < 6, `${r.hatchLoad.toFixed(1)} N`);
  pullTrap(ctx);

  // 2. Clear the crate's path: S-6 into the sump, the pumice up onto the shelf.
  carry(ctx, S6, [V(11.3, 3.6), V(2.2, 4.0)], V(0.3, 1.8));
  carry(ctx, lv.pumice, [V(4.4, 3.8), V(5.4, 6.4), V(7.85, 6.4)], V(7.85, 5.55));

  // 3. Break the glass with a hard throw of S-2.
  throwAtGlass(ctx, S2);
  check('glass broken by a throw', r.glassBroken, r.lastImpact ? `${r.lastImpact.F.toFixed(0)} N` : '');
  // It bounced back onto the crate: lift it off, or it rides along into the bucket.
  carry(ctx, S2, [S2.pos.add(V(0, 0.8))], V(0.3, 1.4));

  // 4. Open the main valve through the broken front.
  const knobAt = () => lv.mainValve.pos.add(V(0, 0.12));
  r.setCursor(V(1.6, 3.85));
  slide(ctx, V(1.1, 3.85), 0.3);
  r.grab(knobAt());
  lead(ctx, V(0.7, 0), 1.5, () => lv.mainOpen() < 0.99);
  r.release();
  check('main valve open', lv.mainOpen() > 0.99, `${(lv.mainOpen() * 100).toFixed(0)} %`);

  // 5. Close it with the level inside the raft window.
  run(ctx, 40, () => lv.sumpLevel() < 2.4);
  r.setCursor(V(1.6, 3.85));
  slide(ctx, V(1.2, 3.85), 0.15);
  r.grab(knobAt());
  lead(ctx, V(-0.7, 0), 1.5, () => lv.mainOpen() > 0.001);
  r.release();
  run(ctx, 1);
  const lvl = lv.sumpLevel(), top = lv.raft.pos.y + lv.raft.size[1] / 2;
  check('valve shut with the raft deck above the deck, no overflow', lv.mainOpen() < 0.001 && top > L.DECK && lv.bucketWater === 0, `level ${lvl.toFixed(3)} m, raft top ${top.toFixed(3)} m`);

  // 6. Drag the crate off the raft and along the rough deck onto the hatch; drop it.
  dragCrate(ctx);
  pullTrap(ctx);
  const inside = r.bucketContents().map((b) => b.tag).sort().join(' ');
  check('crate follows the stones into the bucket', inside === 'K-64 S-4 S-8', `${inside} · contents ${(r.bucketMass() - L.BUCKET.mass).toFixed(1)} kg`);

  // 7. Top up with the needle valve: 107.7 kg sits at the window's edge; aim for 108.6.
  const nk = () => lv.needle.pos.clone();
  r.setCursor(nk());
  r.grab(nk());
  lead(ctx, V(0.5, 0), 1, () => lv.needleOpen() < 0.25);
  r.release();
  run(ctx, 20, () => lv.bucketWater < 0.9);
  r.setCursor(nk());
  r.grab(nk());
  lead(ctx, V(-0.5, 0), 1, () => lv.needleOpen() > 0);
  r.release();
  run(ctx, 1);
  const mc = r.bucketMass() - L.BUCKET.mass;
  check('needle valve tops the bucket up into the window', lv.needleOpen() === 0 && mc > 108.2 && mc < 109.2, `contents ${mc.toFixed(2)} kg (water ${lv.bucketWater.toFixed(2)} kg)`);

  // 8. Pull the release pin.
  r.setCursor(lv.pin.pos.add(V(0, 0.1)));
  r.grab(lv.pin.pos.add(V(0, 0.1)));
  lead(ctx, V(0.6, 0), 2, () => r.cradled);
  r.release();
  run(ctx, 8, () => !(r.doorOpen || r.lockout));
  check('the vault door opens under the governor limit', r.doorOpen && !r.lockout, `v_top ${r.doorVmax.toFixed(3)} m/s`);

  // 9. Reach into the vault and pull the core out.
  const c = lv.core;
  r.setCursor(V(15.0, 3.3));
  slide(ctx, c.pos.add(V(0, 0.02)), 0.4);
  r.grab(c.pos.add(V(0, 0.02)));
  slide(ctx, V(14.9, 3.2), 0.5);
  slide(ctx, V(13.6, 3.3), 0.8);
  run(ctx, 1.5);
  check('core retrieved', r.done, `t ${r.time.toFixed(1)} s`);
}

summary();
