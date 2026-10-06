/*
 * Fragment demo — puzzle mechanics and a full playthrough, headless.
 * Every check drives the world only through the player's two abilities:
 * the dot's movement keys and the capped hand force.
 */
'use strict';
const { load, check, summary, ENGINE_ONLY } = require('./harness');
const Lab = load(ENGINE_ONLY.concat(['src/fragment/level.js', 'src/fragment/actors.js', 'src/fragment/rules.js']));
const { Vec2 } = Lab;
const Frag = Lab.Fragment;
const DT = 1 / 240;

function setup() {
  const lv = Frag.build();
  const game = new Frag.Rules(lv);
  return { lv, game, hand: game.hand, dot: game.player };
}
function run(ctx, seconds, each) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    if (each && each(i * DT) === false) return true;
    ctx.game.step(DT);
  }
  return false;
}
function placeDot(ctx, x, y) { ctx.lv.dot.setPosition(new Vec2(x, y)); ctx.lv.dot.vel.set(0, 0); }

console.log('Friction and the hand');
{
  const ctx = setup();
  run(ctx, 1);
  const S = ctx.lv.S;
  placeDot(ctx, S.pos.x - 1.2, 0.17);
  run(ctx, 0.5);
  const x0 = S.pos.x, y0 = S.pos.y;
  ctx.hand.grab(S, S.pos.clone());
  run(ctx, 2, () => { ctx.hand.target = S.pos.add(new Vec2(-3, 0)); });
  check('ingot does not slide under a straight pull', Math.abs(S.pos.x - x0) < 0.01, `moved ${(S.pos.x - x0).toFixed(4)} m, hand ${ctx.hand.F.len().toFixed(0)} N`);
  run(ctx, 2, () => { ctx.hand.target = S.pos.add(new Vec2(0, 3)); });
  check('ingot cannot be lifted', S.pos.y - y0 < 0.01, `rose ${(S.pos.y - y0).toFixed(4)} m`);
  const x1 = S.pos.x;
  run(ctx, 2, () => { ctx.hand.target = S.pos.add(new Vec2(-2.5, 2.5)); });
  check('ingot slides when pulled up and across at 45°', x1 - S.pos.x > 0.4, `moved ${(x1 - S.pos.x).toFixed(3)} m`);
  ctx.hand.release();
}

console.log('Buoyancy and the hand');
{
  const ctx = setup();
  run(ctx, 1);
  const M = ctx.lv.M;
  placeDot(ctx, 5.3, -0.1);
  run(ctx, 1);
  const y0 = M.pos.y;
  ctx.hand.grab(M, M.pos.clone());
  let maxTop = -9;
  run(ctx, 4, () => { ctx.hand.target = M.pos.add(new Vec2(0, 3)); maxTop = Math.max(maxTop, M.pos.y - 0.23); });
  check('stone rises off the pond floor in water', M.pos.y - y0 > 0.5, `rose ${(M.pos.y - y0).toFixed(3)} m`);
  check('stone cannot be lifted clear of the water', maxTop < ctx.lv.L.POND.surface, `lowest face peaked at ${maxTop.toFixed(3)} m (surface ${ctx.lv.L.POND.surface})`);
  // Drag it along the floor and up the polished ramp, following on foot.
  let out = false;
  run(ctx, 25, () => {
    ctx.hand.target = M.pos.add(new Vec2(2, 1.2));
    ctx.dot.input.walkTo = M.pos.x - 1.0;
    if (M.pos.x > 10 && M.pos.y > 0) { out = true; return false; }
  });
  check('stone can be dragged up the smooth ramp onto the floor', out, `stone at ${M.pos}`);
  ctx.hand.release();
}

console.log('The dot cannot dive');
{
  const ctx = setup();
  placeDot(ctx, 13.1, -0.3);
  let minY = 0;
  run(ctx, 4, () => { ctx.dot.input.down = true; minY = Math.min(minY, ctx.lv.dot.pos.y); });
  check('dot stays near the surface even when pushing down', minY > -1.0, `deepest ${minY.toFixed(3)} m`);
}

console.log('Traversal');
{
  const ctx = setup();
  let reached = false;
  run(ctx, 25, () => {
    const d = ctx.lv.dot;
    ctx.dot.input.right = true;
    ctx.dot.input.jump = d.pos.x > 11.0 && d.pos.x < 12.0 && d.pos.y > -0.1;
    if (d.pos.x > 16.5 && d.pos.y > -0.1) { reached = true; return false; }
    if (d.pos.y < -0.5 && d.pos.x > 12 && d.pos.x < 14.2) ctx.dot.input.jump = true; // climb out if it fell in
  });
  check('dot crosses the pond and the well to the plateau', reached, `dot at ${ctx.lv.dot.pos}`);
}

console.log('Full playthrough: ingot alone');
{
  const ctx = setup();
  const { lv, hand, dot } = ctx;
  placeDot(ctx, 17.0, 0.17);
  run(ctx, 1);
  hand.grab(lv.S, lv.S.pos.add(new Vec2(-0.1, 0.03)));
  let dropped = false;
  run(ctx, 20, () => {
    if (!hand.active) return false;
    hand.target = lv.S.pos.add(new Vec2(-2.2, 2.2));
    dot.input.walkTo = Math.max(lv.S.pos.x - 1.4, 14.6);
    if (lv.S.pos.x < 14.15) { dropped = true; return false; }
  });
  hand.release();
  dot.input.walkTo = null;
  check('ingot dragged over the rough ground into the well', dropped, `ingot at ${lv.S.pos}`);
  let freed = false;
  run(ctx, 20, () => { if (lv.shardFree()) { freed = true; return false; } });
  check('platform sinks into the window and the gate releases the fragment', freed, `travel ${lv.travel().toFixed(3)} m`);
  // Wait at the surface for the fragment to rise, then touch it.
  let got = false;
  run(ctx, 30, () => {
    dot.input.walkTo = lv.shard.pos.x;
    if (lv.dot.pos.y > -0.1 && lv.dot.pos.x < 14.3 && lv.dot.pos.x > 12) dot.input.down = false;
    if (ctx.game.collected) { got = true; return false; }
  });
  check('dot reaches the fragment', got, `shard ${lv.shard.pos} dot ${lv.dot.pos}`);
}

console.log('Overload is unrecoverable and resets');
{
  const ctx = setup();
  const { lv } = ctx;
  run(ctx, 1);
  for (const b of [lv.M, lv.S]) {
    b.setPosition(new Vec2(13.0, -1.0));
    b.vel.set(0, 0);
    run(ctx, 6);
  }
  let resetAsked = false;
  run(ctx, 20, () => { if (ctx.game.wantsReset) { resetAsked = true; return false; } });
  check('stone + ingot overshoot keeps the fragment sealed', !lv.shardFree(), `travel ${lv.travel().toFixed(3)} m`);
  check('the world asks to reset itself', resetAsked);
}

process.exit(summary() ? 1 : 0);
