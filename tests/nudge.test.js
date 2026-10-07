/*
 * Nudge — the pointer, the devices, and each region solved start to finish
 * by moving the pointer exactly as a mouse would (one move per 60 Hz frame).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { load, check, summary, ENGINE_ONLY } = require('./harness');
const NUDGE = ['kit', 'pointer', 'monsters', 'game', 'regions/hub', 'regions/gravity', 'regions/friction']
  .map((f) => `src/nudge/${f}.js`)
  .filter((f) => fs.existsSync(path.join(__dirname, '..', f)));
const Lab = load(ENGINE_ONLY.concat(NUDGE));
const { Vec2 } = Lab;
const V = (x, y) => new Vec2(x, y);
const DT = 1 / 240;

function setup(regions, save) {
  const game = new Lab.Nudge.Game({ regions, save });
  return { game, P: game.pointer };
}
/** One 60 Hz frame: the mouse moves, then four physics steps. */
function frame(ctx, aim) {
  const { P } = ctx;
  if (aim) P.moveBy(aim.sub(P.pos)); else P.moveBy(V(0, 0));
  for (let i = 0; i < 4; i++) ctx.game.step(DT);
}
/** Hold the mouse on a point for some seconds (re-aiming each frame, so drift is countered). */
function hold(ctx, p, seconds, until) {
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    if (until && until()) return true;
    frame(ctx, p);
  }
  return false;
}
/** Glide the mouse along a path at a given speed. */
function glide(ctx, pts, speed = 4) {
  for (const q of pts) {
    const from = ctx.P.pos.clone(), d = q.dist(from), n = Math.max(1, Math.ceil((d / speed) * 60));
    for (let i = 1; i <= n; i++) frame(ctx, Vec2.lerp(from, q, i / n));
  }
}
const events = (ctx) => ctx.game.drainEvents();
/** Wait without standing still: circle a point at 3 m/s, faster than the dropper can follow. */
function wander(ctx, c, seconds, until) {
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    if (until && until()) return true;
    const a = (i / 60) * 5;
    frame(ctx, c.add(V(Math.cos(a) * 0.6, Math.sin(a) * 0.4)));
  }
  return false;
}
/** Press on a load's back face along its own axis (on a slope, that is up the slope). */
function shove(ctx, b, depth = 0.03, maxStep = 0.08) {
  const P = ctx.P, hw = b.size[0] / 2;
  const d = V(Math.cos(b.angle), Math.sin(b.angle));
  const T = b.pos.sub(d.scale(hw + Lab.Nudge.PT.R - depth));
  const step = T.sub(P.pos), l = step.len();
  frame(ctx, l > maxStep ? P.pos.add(step.scale(maxStep / l)) : T);
}
/**
 * Cross under a row of icicles along y at a steady speed, setting off only
 * when no icicle will be falling where the pointer (and what it carries) is.
 */
function crossIcicles(ctx, ic, x1, speed = 2.5) {
  const P = ctx.P, x0 = P.pos.x, y = P.pos.y, T = Math.abs(x1 - x0) / speed;
  const safe = () => ic.slots.every((s) => {
    const k = (s.x - x0) / (x1 - x0);
    if (k < -0.05 || k > 1.05) return true;
    const tPass = k * T, half = 0.32 / speed, d = ic.timeToDrop(s);
    return [[d, d + 0.8], [d - ic.period, d - ic.period + 0.8]].every(([a, b]) => tPass + half < a || tPass - half > b);
  });
  for (let i = 0; i < 60 * 4 && !safe(); i++) frame(ctx, V(x0, y));
  glide(ctx, [V(x1, y)], speed);
}

/* ================================================================ */
console.log('Pointer: it is the mouse, and it is weak');
{
  const ctx = setup(['hub', 'gravity']);
  const { P, game } = ctx;
  const R = game.byId.gravity;
  R.dropper.gone = true;
  frame(ctx, P.pos.add(V(3, 0.5)));
  check('in free air it lands on the mouse at once', P.pos.dist(V(3, 2.7)) < 0.01, `${P.pos.x.toFixed(3)}, ${P.pos.y.toFixed(3)}`);
  hold(ctx, V(3, -1), 0.5);
  check('rock stops it', Math.abs(P.pos.y - Lab.Nudge.PT.R) < 0.02 && !P.dead, `y ${P.pos.y.toFixed(3)}`);
  P.respawn(V(-38.0, 8.0));
  frame(ctx, V(-38.0, 5.0));
  check('a 12 cm plank cannot be passed through', P.pos.y > 7.2, `y ${P.pos.y.toFixed(3)}`);
  const ball = R.heavy;
  P.respawn(V(ball.pos.x + 0.5, ball.pos.y));
  let maxF = 0;
  const x0 = ball.pos.x;
  for (let i = 0; i < 60; i++) { frame(ctx, P.pos.add(V(-0.06, 0))); if (P.touching) maxF = Math.max(maxF, P.F.len()); }
  check('it pushes a 25 kg ball with at most 40 N', maxF <= 40.01 && ball.pos.x < x0 - 0.2, `${maxF.toFixed(1)} N, moved ${(x0 - ball.pos.x).toFixed(2)} m`);
  P.respawn(ball.pos.add(V(0.12, 0.12)));
  frame(ctx);
  P.grab();
  hold(ctx, ball.pos.add(V(0, 1.0)), 1);
  check('its line (60 N) cannot lift 245 N', ball.pos.y < 0.2, `y ${ball.pos.y.toFixed(3)}`);
  P.release();
}

/* ================================================================ */
console.log('Gravity devices');
{
  // The blade is a real obstacle: crossing under it at the wrong moment ends the pointer.
  const ctx = setup(['hub', 'gravity']);
  const { P, game } = ctx, R = game.byId.gravity, GV = R.GV;
  R.dropper.gone = true;
  glide(ctx, [V(-12.5, 0.2)]);
  hold(ctx, V(-12.5, 0.2), 6, () => Math.abs(R.blade.angle) < 0.15 && R.blade.body.angVel > 0);
  glide(ctx, [V(-20.5, 0.2)], 3);
  const ev = events(ctx);
  check('the blade shatters a pointer caught under its swing', ev.some((e) => e.type === 'shatter' && e.cause === 'blade'), ev.filter((e) => e.type === 'hit').map((e) => `${e.F.toFixed(0)} N`).join(' '));

  // The feather is a decoy: air holds it back and the plates are struck apart.
  hold(ctx, V(0, 2.2), 1.5);                       // back at the checkpoint …
  P.respawn(V(-34.6, 9.5));                        // … and straight over to the plank
  R.heavy.setPosition(V(GV.CUPS[0], GV.PLANK.y + GV.PLANK.t + R.heavy.radius + 0.005)); R.heavy.vel.set(0, 0);
  R.feather.setPosition(V(GV.CUPS[1], GV.PLANK.y + GV.PLANK.t + R.feather.radius + 0.005)); R.feather.vel.set(0, 0);
  hold(ctx, V(-34.6, 9.5), 0.5);
  glide(ctx, [R.pin.body.pos.clone()]);
  P.grab();
  glide(ctx, [R.pin.body.pos.add(V(0.45, 0))], 1);
  P.release();
  hold(ctx, V(-34.6, 9.5), 3.2);
  const gal = events(ctx).find((e) => e.type === 'galileo');
  check('a feather lags behind: the funnel stays shut', gal && !gal.ok && !R.lid.open, gal ? (gal.dt != null ? `Δt ${(gal.dt * 1000).toFixed(0)} ms` : 'the feather was still falling') : 'no drop');
  check('… and the plank and its pin are set back', R.plank.length === 5 && !R.pin.tripped);
  check('… the plank put back belongs to the region (so it is drawn)', R.plank.every((b) => b.world && R.bodies.includes(b)));

  // Pull the pin again and keep holding it through the reset: the line lets go, the pin sits home.
  glide(ctx, [R.pin.body.pos.clone()]);
  P.grab();
  glide(ctx, [R.pin.body.pos.add(V(0.45, 0))], 1);
  hold(ctx, R.pin.body.pos.clone(), 3.4);
  check('a pin held while the plank comes back is let go, and stays in', !P.grip && R.plank.length === 5 && !R.pin.tripped && R.pin.travel < 0.05, `travel ${R.pin.travel.toFixed(2)} m`);
  events(ctx);

  // Let the latch go with nothing aboard: 2 kg against 26 kg flies up, then winds itself back.
  R.heavy.setPosition(V(-38.5, R.heavy.radius)); R.heavy.vel.set(0, 0);
  glide(ctx, [V(-32.5, 9.5), V(-32.5, 1.5), V(-38.0, 1.5), R.latch.body.pos.clone()], 6);   // round the plank's end
  P.grab();
  glide(ctx, [R.latch.body.pos.add(V(0.45, 0))], 1);
  P.release();
  glide(ctx, [V(-38.0, 1.5)]);
  const up = hold(ctx, V(-38.0, 1.5), 4, () => R.caught);
  check('an empty platform is flung up to the pawl', up, `y ${R.liftRail.translation.toFixed(2)}`);
  const back = hold(ctx, V(-38.0, 1.5), 12, () => R.latched);
  check('… and winds itself back down and latches', back && R.liftRail.translation < 0.02, `y ${R.liftRail.translation.toFixed(2)}`);

  // Nothing walls the lift in: from beside it the pointer reaches the ram's side at head height.
  glide(ctx, [V(-42.0, 3.0), V(-45.7, 3.0)], 3);
  check('the lift is open on its far side (the counterweight runs on a rail)', P.pos.dist(V(-45.7, 3.0)) < 0.05, `at ${P.pos.x.toFixed(2)}, ${P.pos.y.toFixed(2)}`);

  // The dropper roams the whole canyon, so a stone may land on the plank: left lying, it crumbles.
  const stone = (x, y) => {
    const r = Lab.Nudge.kit.ball(game, x, y, 20, 2600, Lab.Nudge.MAT.stone, {});
    r.role = 'rock';
    R.dropper.dropped.push(r);
    return r;
  };
  R.dropper.gone = true;
  const onPlank = stone(-38.0, GV.PLANK.y + GV.PLANK.t), inBasket = stone(R.basket.pos.x, R.basket.pos.y - 0.2);
  wander(ctx, V(-36, 4), 6);
  check('a stone left on the plank crumbles after a few seconds', !onPlank.world);
  check('… but a stone in the basket stays', !!inBasket.world && R.inBasket(inBasket), `${R.basketMass().toFixed(0)} kg in the basket`);

  // A region reset leaves no plank behind but the new one.
  game.resetRegion('gravity');
  const R2 = game.byId.gravity;
  const planks = game.world.bodies.filter((b) => b.role === 'plank');
  check('after a reset only the new plank is in the world', planks.length === 5 && planks.every((b) => R2.plank.includes(b)), `${planks.length} plank pieces`);
}

/* ================================================================ */
console.log('Gravity region: 낙하의 절벽');
(() => {
  const ctx = setup(['hub', 'gravity']);
  const { P, game } = ctx;
  const R = game.byId.gravity, GV = R.GV;
  let ev = [];
  const log = () => { ev = ev.concat(events(ctx)); };

  // 1. The blade: wait for it to swing high to the right, then slip under its tip.
  glide(ctx, [V(-12.5, 0.5)]);
  hold(ctx, V(-12.5, 0.5), 6, () => R.blade.angle > 0.85);
  frame(ctx, V(-20.5, 0.45));
  hold(ctx, V(-20.5, 0.45), 0.3);
  log();
  check('past the blade in one piece', !P.dead && P.pos.x < -20, `x ${P.pos.x.toFixed(2)}`);
  glide(ctx, [V(-22.4, 1.6)]);

  // 2. Roll the stone ball up the ramp onto the latched platform.
  const ball = R.heavy;
  glide(ctx, [V(-38.0, 0.6), V(ball.pos.x + 0.35, ball.pos.y)], 6);
  // Mouse moving left at 0.7 m/s: the pointer pushes only as fast as the hand goes.
  for (let i = 0; i < 1500 && ball.pos.x > GV.LIFT.x + 0.1; i++) frame(ctx, V(P.pos.x - 0.012, ball.pos.y));
  hold(ctx, V(-41.0, 1.0), 1.5);
  check('stone ball rests on the platform deck', Math.abs(ball.pos.x - GV.LIFT.x) < 0.7 && ball.pos.y > 0.15 && ball.pos.y < 0.4, `x ${ball.pos.x.toFixed(2)} y ${ball.pos.y.toFixed(2)}`);

  // 3. Pull the latch pin; 27 kg against 26 kg, the platform stays down.
  glide(ctx, [R.latch.body.pos.clone()]);
  P.grab();
  glide(ctx, [R.latch.body.pos.add(V(0.45, 0))], 1);
  P.release();
  hold(ctx, V(-39.0, 1.2), 0.5);
  check('latch released, platform still down', !R.latched && R.liftRail.translation < 0.05, `y ${R.liftRail.translation.toFixed(3)}`);

  // 4. Haul the platform up by its edge (net 9.8 N down), dodging the dropper.
  const deckEdge = R.platform.localPoint(V(GV.LIFT.x + 0.6, 0.15));     // taken while it is still at the bottom
  const deck = () => R.platform.worldPoint(deckEdge);
  glide(ctx, [deck().add(V(0.15, 0.1))]);
  P.grab();
  for (let i = 0; i < 60 * 12 && R.liftRail.translation < GV.LIFT.top - 0.01; i++) frame(ctx, deck().add(V(0.25 + Math.sin(i * 0.3) * 0.2, 0.6)));
  hold(ctx, deck().add(V(0.25, 0.6)), 0.2);
  check('platform hauled to the plank and caught by the pawl', R.caught && R.liftRail.translation > GV.LIFT.top - 0.02, `y ${R.liftRail.translation.toFixed(2)}`);
  P.release();
  // Over the ball, down behind it, and roll it along the plank at 1 m/s: up the
  // low lip of the first cup and short of the high one.
  glide(ctx, [V(-42.6, 7.9), V(-44.0, 7.9), V(ball.pos.x - 0.31, ball.pos.y + 0.02)], 3);
  for (let i = 0; i < 600 && ball.pos.x < GV.CUPS[0] - 0.1; i++) frame(ctx, V(P.pos.x + 1.0 / 60, ball.pos.y + 0.02));
  hold(ctx, V(P.pos.x - 0.2, 8.4), 0.3);
  wander(ctx, V(-41.5, 8.8), 2);
  check('stone ball rolls into the first cup', Math.abs(ball.pos.x - GV.CUPS[0]) < 0.15 && ball.pos.y > 7.1, `x ${ball.pos.x.toFixed(2)} y ${ball.pos.y.toFixed(2)}`);

  // 5. Fetch the wooden ball (not the feather) and set it in the second cup.
  const wood = R.wood;
  glide(ctx, [V(-30, 11.0), wood.pos.add(V(0, 0.2))], 6);
  P.grab();
  glide(ctx, [V(-26, 11.5), V(GV.CUPS[1], 8.4), V(GV.CUPS[1], 7.45)], 3);
  hold(ctx, V(GV.CUPS[1], 7.45), 0.6);
  P.release();
  hold(ctx, V(GV.CUPS[1] + 1.5, 9), 1);
  check('wooden ball sits in the second cup', Math.abs(wood.pos.x - GV.CUPS[1]) < 0.12 && wood.pos.y > 7.1, `x ${wood.pos.x.toFixed(2)} y ${wood.pos.y.toFixed(2)}`);

  // 6. Pull the plank's pin: both balls fall the same 7 m together.
  glide(ctx, [R.pin.body.pos.clone()]);
  P.grab();
  glide(ctx, [R.pin.body.pos.add(V(0.45, 0))], 1);
  P.release();
  glide(ctx, [V(-34.6, 9.5)]);
  wander(ctx, V(-34.6, 9.6), 3);                   // keep moving: the dropper is overhead
  log();
  const gal = ev.find((e) => e.type === 'galileo');
  check('a heavy and a light ball strike the plates together', gal && gal.ok && R.lid.open, gal ? `Δt ${gal.dt != null ? (gal.dt * 1000).toFixed(1) + ' ms' : '—'}` : 'no drop');

  // 7. Lure the dropper over the funnel (offset against the orb's pull): stand still
  // until it lets go, then slip aside and keep moving, so it cannot settle over you.
  const target = -30.8;
  let drops = 0;
  for (let k = 0; k < 8 && R.basketMass() < 60; k++) {
    const before = R.dropper.dropped.length;
    hold(ctx, V(target, 3.4), 14, () => R.dropper.dropped.length > before);
    drops++;
    for (let i = 0; i < 60 * 3.5; i++) frame(ctx, V(target - 3.0 + 0.8 * Math.sin(i / 60 * 5), 3.4));
  }
  log();
  // What hangs on the rope: the 3 kg basket and the stones in it.
  const W = (3 + R.basketMass()) * 9.8;
  check('enough stones fall into the basket (≥ 600 N on the rope)', W >= GV.WALL.strength, `${W.toFixed(0)} N (${R.basketMass().toFixed(0)} kg of stone) after ${drops} drops`);
  wander(ctx, V(-36, 4), 4, () => R.wallObj.broken);
  check('the wall gives way to the sustained pull', R.wallObj.broken, `stress ${R.wallObj.stress.toFixed(2)}`);

  // 8. Into the chamber for the fragment, then home.
  // Over the counterweight's channel, down past the ram, through the breach.
  const overCW = [V(-43.5, 10.2), V(-45.7, 10.2), V(-45.7, 2.5)];
  glide(ctx, overCW.concat([V(-49.0, 2.0), GV.GOAL.clone()]), 5);
  log();
  check('the gravity fragment is taken', game.save.fragments.gravity === true);
  glide(ctx, overCW.slice().reverse().concat([V(-36, 4.6), V(-24, 4.6), V(-22, 1.5), V(-20.5, 0.45)]), 6);   // well clear of the orb
  hold(ctx, V(-20.5, 0.45), 6, () => R.blade.angle < -0.85);
  frame(ctx, V(-12.5, 0.45));
  glide(ctx, [V(-6, 2)], 6);
  log();
  check('carried home, it flies into the door', game.save.delivered.gravity === true);
  check('no shattering along the way', !ev.some((e) => e.type === 'shatter'), ev.filter((e) => e.type === 'shatter').map((e) => e.cause).join(','));
  return ctx;
})();

/* ================================================================ */
console.log('Friction devices');
{
  // Stack order: the same 90 kg with a sandbag at the bottom grips with 0.75, not 0.85.
  const ctx = setup(['hub', 'friction']);
  const { P, game } = ctx, R = game.byId.friction, FR = R.FR;
  P.respawn(V(44, 4));
  const cx = (FR.COLUMN.x0 + FR.COLUMN.x1) / 2;
  const drop = (b) => { b.setPosition(V(cx, 2.3), 0); b.vel.set(0, 0); b.angVel = 0; hold(ctx, V(44, 4), 1.0); };
  [R.sacks[0], ...R.rubber, R.steel, ...R.sacks.slice(1)].forEach(drop);
  hold(ctx, V(44, 4), 4);
  const cl = R.clutch();
  check('a sandbag at the bottom: the wall holds', !R.wallObj.broken && cl.bottom === R.sacks[0], `μ ${cl.mu.toFixed(2)} × N ${cl.N.toFixed(0)} = ${cl.F.toFixed(0)} N < 720 N`);

  // An icicle falling on a pointer that lingers under it.
  const ic = R.icicles, slot = ic.slots[2];
  P.respawn(V(slot.x, 1.6));
  hold(ctx, V(slot.x, 1.6), ic.period + 1);
  let ev = events(ctx);
  check('an icicle shatters a pointer lingering under it', ev.some((e) => e.type === 'shatter' && e.cause === 'icicle'), ev.filter((e) => e.type === 'hit').map((e) => `${e.source} ${e.F.toFixed(0)} N`).join(' '));

  // On sand the skater's boots bite with μ·N = 0.9 × 392 N: it runs a pointer down.
  hold(ctx, V(0, 2.2), 1.5);
  P.respawn(V(26.5, 0.14));
  hold(ctx, V(26.5, 0.14), 4, () => P.dead);
  ev = events(ctx);
  check('the skater runs down a pointer on the sand', ev.some((e) => e.type === 'shatter'), ev.filter((e) => e.type === 'hit' || e.type === 'shatter').map((e) => `${e.type} ${e.source || e.cause} ${e.F ? e.F.toFixed(0) + ' N' : ''}`).join(', '));
  check('… with a grip far beyond the pointer\'s', R.skater.grip > 300, `${R.skater.grip.toFixed(0)} N`);
}

/* ================================================================ */
console.log('Friction region: 서리 평원');
(() => {
  const ctx = setup(['hub', 'friction']);
  const { P, game } = ctx;
  const R = game.byId.friction, FR = R.FR;
  let ev = [];
  const log = () => { ev = ev.concat(events(ctx)); };
  const cx = (FR.COLUMN.x0 + FR.COLUMN.x1) / 2;
  const hallY = 1.6;

  // 0. What the numbers say.
  const sack = R.sacks[0], rub = R.rubber[0];
  check('a sandbag on sand holds with more than the pointer can push', 0.85 * sack.mass * 9.8 > Lab.Nudge.PT.PUSH, `${(0.85 * sack.mass * 9.8).toFixed(0)} N > 40 N`);
  check('a rubber block is light enough to carry on the line', rub.mass * 9.8 < Lab.Nudge.PT.GRAB, `${(rub.mass * 9.8).toFixed(0)} N < 60 N`);

  // 1. Rubber goes in first, carried by hand past the icicles.
  glide(ctx, [V(12.0, hallY), V(13.2, hallY)], 5);
  for (const b of R.rubber) {
    crossIcicles(ctx, R.icicles, b.pos.x);
    glide(ctx, [V(b.pos.x, b.pos.y + b.size[1] / 2 + 0.1)], 2);
    P.grab();
    glide(ctx, [V(b.pos.x, hallY)], 1.5);
    crossIcicles(ctx, R.icicles, 22.4);
    glide(ctx, [V(27, 2.8), V(45.6, 3.0), V(cx, 2.8), V(cx, 0.9)], 3);
    hold(ctx, V(cx, 0.9), 0.4);
    P.release();
    glide(ctx, [V(cx, 2.8), V(45.6, 3.0), V(27, 2.8), V(22.4, hallY)], 4);
    if (b !== R.rubber[2]) crossIcicles(ctx, R.icicles, 21.6);
  }
  log();
  const inCol = () => R.load();
  check('three rubber blocks stand in the column', R.rubber.every((b) => inCol().includes(b)), inCol().map((b) => b.role).join(','));
  check('… and rubber is what the belt grips', R.clutch().bottom && R.clutch().bottom.role === 'rubber', `μ ${R.clutch().mu.toFixed(2)}`);

  // 2. The pointer alone cannot free the sunk sandbags; the skater can.
  const [s0, s1] = R.sacks;
  hold(ctx, V(30, 3.0), 7, () => s0.pos.x > FR.SAND.x1 + 0.2 && s1.pos.x > FR.SAND.x1 + 0.2 && Math.abs(s0.vel.x) + Math.abs(s1.vel.x) < 0.05);
  log();
  check('lured along the sand, the skater shoves both sandbags onto the ice', s0.pos.x > FR.SAND.x1 + 0.2 && s1.pos.x > FR.SAND.x1 + 0.2, `x ${s0.pos.x.toFixed(2)}, ${s1.pos.x.toFixed(2)}`);

  // 3. Each sandbag, frontmost first, across the ice, up the ramp and off the ledge.
  const onIce = () => R.sacks.filter((b) => !inCol().includes(b) && b.pos.y < 0.5).sort((a, b) => b.pos.x - a.pos.x);
  let first = true;
  for (let n = 0; n < 4; n++) {
    const bags = onIce();
    if (!bags.length) break;
    const b = bags[0], hw = b.size[0] / 2, top = () => b.pos.y + b.size[1] / 2 + 0.1;
    if (b.pos.x - hw - 0.3 < FR.SAND.x1 + 0.3) {
      // Too near the skater to get behind it: tow it clear on the line from above.
      glide(ctx, [V(b.pos.x, 1.2), V(b.pos.x, top())], 4);
      P.grab();
      glide(ctx, [V(b.pos.x + 2.5, top() + 0.15)], 1.2);
      P.release();
    }
    const next = bags[1];
    if (next && b.pos.x - hw - (next.pos.x + next.size[0] / 2) < 0.5) {
      // Too close to get behind it: drag the one behind away on the line.
      glide(ctx, [V(next.pos.x, 1.2), V(next.pos.x, next.pos.y + next.size[1] / 2 + 0.1)], 4);
      P.grab();
      glide(ctx, [V(next.pos.x - 0.9, next.pos.y + next.size[1] / 2 + 0.25)], 1);
      P.release();
    }
    glide(ctx, [V(P.pos.x, 1.2), V(b.pos.x - hw - 0.3, 1.2), V(b.pos.x - hw - 0.16, b.pos.y)], 4);
    for (let i = 0; i < 60 * 30 && b.pos.x < FR.LEDGE.x1 - hw * 0.4 && b.pos.y > -0.5; i++) shove(ctx, b);
    glide(ctx, [V(P.pos.x - 0.4, 3.0)], 3);
    hold(ctx, V(44.5, 3.0), 1.5);
    if (first) {
      check('the first load along the ledge knocks the steel block in', inCol().includes(R.steel));
      first = false;
    }
  }
  log();
  check('all four sandbags are in the column', R.sacks.every((b) => inCol().includes(b)), inCol().map((b) => b.role).join(','));
  const cl = R.clutch();
  check('the belt drags the column with μ·N ≥ 720 N', cl.F >= FR.WALL.strength, `μ ${cl.mu.toFixed(2)} × N ${cl.N.toFixed(0)} = ${cl.F.toFixed(0)} N`);
  hold(ctx, V(44.5, 3.0), 4, () => R.wallObj.broken);
  check('the frost wall gives way', R.wallObj.broken, `force ${R.wallObj.force.toFixed(0)} N, stress ${R.wallObj.stress.toFixed(2)}`);

  // 4. Into the vault, then home through the icicles.
  glide(ctx, [V(46.0, 2.9), V(49.0, 2.9), V(51, 0.3), FR.GOAL.clone()], 4);
  log();
  check('the friction fragment is taken', game.save.fragments.friction === true);
  glide(ctx, [V(51, 0.3), V(49.0, 2.9), V(45.6, 3.0), V(27, 2.8), V(22.4, hallY)], 6);
  crossIcicles(ctx, R.icicles, 13.0);
  glide(ctx, [V(8, 2)], 5);
  log();
  check('carried home, it flies into the door', game.save.delivered.friction === true);
  check('no shattering along the way', !ev.some((e) => e.type === 'shatter'), ev.filter((e) => e.type === 'shatter').map((e) => e.cause).join(','));
})();

summary();
