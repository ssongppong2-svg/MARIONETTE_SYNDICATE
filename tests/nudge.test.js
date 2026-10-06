/*
 * Nudge — mechanics and a full playthrough driven only by the pointer.
 * The pointer is steered through waypoints exactly as a mouse would.
 */
'use strict';
const { load, check, summary, ENGINE_ONLY } = require('./harness');
const Lab = load(ENGINE_ONLY.concat(['src/nudge/level.js', 'src/nudge/rules.js']));
const { Vec2 } = Lab;
const DT = 1 / 240;

function setup() {
  const lv = Lab.Nudge.build();
  const r = new Lab.Nudge.Rules(lv);
  r.setTarget(lv.pointer.pos);
  return { lv, r };
}
function run(ctx, seconds, each) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    if (each && each() === false) return true;
    ctx.r.step(DT);
  }
  return false;
}
/** Steer the pointer through waypoints; each is reached within 0.12 m or times out. */
function go(ctx, pts, per = 8) {
  for (const p of pts) {
    ctx.r.setTarget(p);
    const ok = run(ctx, per, () => (ctx.lv.pointer.pos.dist(p) < 0.12 ? false : true));
    if (!ok) return false;
  }
  return true;
}
const V = (x, y) => new Vec2(x, y);
const TUNNEL_Y = 2.0;
const toTunnel = [V(1.7, 4.2), V(1.7, TUNNEL_Y)];

console.log('Friction: dry stones do not yield to the pointer');
{
  const ctx = setup();
  const s = ctx.lv.stones[0];
  go(ctx, toTunnel.concat([V(s.pos.x - 0.6, TUNNEL_Y), V(s.pos.x - 0.6, 1.53)]));
  const x0 = s.pos.x;
  ctx.r.setTarget(V(s.pos.x + 3, 1.53));
  run(ctx, 3);
  check('dry stone stays put under the pointer\'s full push', Math.abs(s.pos.x - x0) < 0.02, `moved ${(s.pos.x - x0).toFixed(4)} m`);
  // Ram it repeatedly at full speed: impacts must not inch it along either.
  for (let k = 0; k < 10; k++) {
    go(ctx, [V(s.pos.x - 1.2, 1.53)]);
    ctx.r.setTarget(V(s.pos.x + 3, 1.53));
    run(ctx, 0.6);
  }
  check('ten full-speed bumps barely move it', Math.abs(s.pos.x - x0) < 0.05, `moved ${(s.pos.x - x0).toFixed(4)} m`);
  const pm = ctx.lv.pumice, px0 = pm.pos.x;
  go(ctx, [V(s.pos.x, TUNNEL_Y), V(pm.pos.x - 0.5, TUNNEL_Y), V(pm.pos.x - 0.5, 1.53)]);
  ctx.r.setTarget(V(pm.pos.x + 2, 1.53));
  run(ctx, 1.5);
  check('the light pumice does slide dry', pm.pos.x - px0 > 0.3, `moved ${(pm.pos.x - px0).toFixed(3)} m`);
}

console.log('Water: the pointer opens the gate and the tunnel floods');
const flooded = (() => {
  const ctx = setup();
  const g = ctx.lv.gate;
  const gk = () => g.pos.add(V(0, -0.14)); // knob under the gate plate
  go(ctx, [V(1.0, 4.9), V(gk().x - 0.2, gk().y)]);
  ctx.r.setTarget(V(gk().x + 1.6, gk().y));
  run(ctx, 2);
  check('gate slides open', ctx.lv.inflowOpen() > 0.95, `open ${ctx.lv.inflowOpen().toFixed(2)}`);
  run(ctx, 14);
  check('tunnel and well fill to the brim', ctx.lv.level > 2.4, `level ${ctx.lv.level.toFixed(3)} m`);
  return ctx;
})();

console.log('Buoyancy: wet stones can be pushed');
{
  const ctx = flooded;
  const s = ctx.lv.stones[0];
  go(ctx, toTunnel.concat([V(s.pos.x - 0.6, TUNNEL_Y), V(s.pos.x - 0.6, 1.53)]));
  run(ctx, 0.5);
  const x0 = s.pos.x;
  ctx.r.setTarget(V(s.pos.x + 3, 1.53));
  run(ctx, 3);
  check('submerged stone slides under the same push', s.pos.x - x0 > 0.5, `moved ${(s.pos.x - x0).toFixed(3)} m`);
}

console.log('Full playthrough');
{
  const ctx = setup();
  const { lv, r } = ctx;
  const g = lv.gate;
  const gk = () => g.pos.add(V(0, -0.14));
  go(ctx, [V(1.0, 4.9), V(gk().x - 0.2, gk().y)]);
  r.setTarget(V(gk().x + 1.6, gk().y));
  run(ctx, 14);
  go(ctx, toTunnel);
  let loaded = 0;
  for (const s of lv.stones.slice().sort((a, b) => b.pos.x - a.pos.x)) {
    go(ctx, [V(Math.max(2.4, s.pos.x - 0.6), TUNNEL_Y), V(s.pos.x - 0.45, 1.53)]);
    run(ctx, 0.5); // settle low behind the stone before pushing
    run(ctx, 40, () => {
      r.setTarget(V(s.pos.x + 1.5, 1.53));
      return s.pos.x < 12.5;
    });
    r.setTarget(V(12.0, TUNNEL_Y));
    run(ctx, 3);
    const b = lv.bucket;
    if (s.pos.y < 1.3 && s.pos.y > b.pos.y - 0.5 && Math.abs(s.pos.x - b.pos.x) < 0.45) loaded++;
    go(ctx, [V(11.6, TUNNEL_Y)]);
  }
  check('all four stones pushed into the bucket', loaded === 4, `${loaded} in bucket`);
  const fFlooded = r.force;
  check('flooded: the wall holds (force below strength)', fFlooded < lv.L.STRENGTH && !r.broken, `${fFlooded.toFixed(0)} N`);
  // Shut the inflow first, otherwise it outruns the drain.
  go(ctx, [V(1.7, TUNNEL_Y), V(1.7, 4.2), V(gk().x + 0.2, 4.7), V(gk().x + 0.2, gk().y)]);
  r.setTarget(V(gk().x - 1.6, gk().y));
  run(ctx, 2);
  check('inflow gate pushed shut', lv.inflowOpen() < 0.02, `open ${lv.inflowOpen().toFixed(2)}`);
  go(ctx, [V(1.7, 4.2), V(1.7, TUNNEL_Y), V(11.6, TUNNEL_Y)]);
  // Down the corridor beside the bucket; open the plug from its left, then wait on its right.
  const knob = () => lv.plug.pos.add(V(0, 0.15));
  go(ctx, [V(12.2, TUNNEL_Y), V(13.42, 1.9), V(13.42, -1.35), V(knob().x, -1.35), V(knob().x - 0.18, -1.75)]);
  r.setTarget(V(knob().x + 1.0, -1.75));
  run(ctx, 1.0);
  go(ctx, [V(knob().x, -1.35), V(knob().x + 0.2, -1.75)]);
  run(ctx, 12, () => lv.level > 0.55);
  r.setTarget(V(knob().x - 1.0, -1.75));
  run(ctx, 0.8);
  check('drain shut with the water between bucket and buoy', lv.drainOpen() < 0.05 && lv.level < 0.8 && lv.level > -0.1, `level ${lv.level.toFixed(3)} drain ${lv.drainOpen().toFixed(2)}`);
  run(ctx, 6, () => !r.broken);
  check('sustained resultant force breaks the wall', r.broken, `force ${r.force.toFixed(0)} N, stress ${r.stress.toFixed(2)}`);
  const pieces = r.shards.length;
  run(ctx, 3.3);
  const left = lv.world.bodies.filter((b) => b.role === 'shard').length;
  check('the broken wall melts away and clears the path', pieces > 0 && r.shards.length === 0 && left === 0, `${pieces} pieces, ${left} left`);
  go(ctx, [V(13.42, -1.6), V(13.42, 1.9), V(12.2, TUNNEL_Y), V(1.7, TUNNEL_Y), V(1.7, 4.4), V(13.0, 4.4), V(lv.L.GOAL.x, lv.L.GOAL.y)], 14);
  run(ctx, 1);
  check('pointer reaches the light behind the wall', r.done);
}

console.log('Draining straight through does not break the wall');
{
  const ctx = setup();
  const { lv, r } = ctx;
  lv.volume = lv.volumeAt(2.45);
  lv.stones.forEach((s, i) => { s.setPosition(V(12.65 + (i % 2) * 0.33, 0.85 + Math.floor(i / 2) * 0.21)); s.vel.set(0, 0); });
  run(ctx, 3);
  lv.plug.setPosition(V(lv.plug.pos.x + 0.5, lv.plug.pos.y));
  run(ctx, 12);
  check('a full-speed drain passes the sweet level too fast', !r.broken, `level ${lv.level.toFixed(2)} stress peak handled`);
}

process.exit(summary() ? 1 : 0);
