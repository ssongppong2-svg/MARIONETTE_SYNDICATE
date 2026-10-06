/*
 * Chamber solvability tests: each chamber is solved headlessly with the
 * intended physics reasoning (never by reading hidden answers out of locks)
 * across several random laboratories.
 */
'use strict';
const { load, check, summary } = require('./harness');
const Lab = load();
const { Mathx } = Lab;
const DT = Lab.DT;

function newGame(seed) {
  Lab.Save.load();
  Lab.Save.reset();
  Lab.Save.data.seed = seed;
  return new Lab.Game(Lab.Save.data);
}
function run(room, seconds, until) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    room.step(DT);
    if (until && until(room)) return true;
  }
  return false;
}
function press(room, id) {
  const c = room.controls.find((x) => x.id === id);
  if (!c) throw new Error('no control ' + id);
  if (c.disabled && c.disabled(room)) throw new Error('control disabled: ' + id);
  c.onClick(room);
}
function set(room, id, v) { room.setValue(id, v); }

const SEEDS = (process.env.SEEDS || '11,2024,777,31337,98765').split(',').map(Number);
const only = process.env.ONLY || '';
const solvers = {};

/* ---------------- 01 free fall ---------------- */
solvers.c01 = (game) => {
  const room = game.enter('c01');
  const g = game.lab.g;
  // Measure g from a trial drop using photogate A, as a player would.
  set(room, 'h', 3.0);
  press(room, 'drop');
  run(room, 1.5);
  const gA = room.devices[0];
  const d = 3.0 - 1.8;
  const gMeasured = (2 * d) / (gA.tBlock * gA.tBlock);
  const okG = room.submitCode('g', Mathx.fmt(gMeasured, 2)).ok;
  // Timing lock: h = ½ g T², snapped to the slider step.
  room.reset();
  const h = Mathx.snap(0.5 * gMeasured * room.p.T * room.p.T, 0.005);
  set(room, 'h', h);
  press(room, 'drop');
  run(room, 2.5);
  return { ok: okG && room.isOpen('timing') && room.cleared, info: `g=${g} measured=${gMeasured.toFixed(4)} hit=${room.lastHit && room.lastHit.toFixed(4)} T=${room.p.T}` };
};

/* ---------------- 02 incline ---------------- */
solvers.c02 = (game) => {
  const room = game.enter('c02');
  const g = game.lab.g;
  const DEG = Math.PI / 180;
  const slipped = () => room.logLines.some((l) => l.text.startsWith('블록 미끄러짐'));
  // Coarse sweep, then fine sweep from 1° below the first slip.
  let coarse = null;
  for (let a = 5; a <= 40; a += 1) {
    set(room, 'angle', a);
    if (run(room, 2.5, slipped)) { coarse = a; break; }
  }
  if (coarse == null) return { ok: false, info: 'never slipped' };
  room.logLines = [];
  set(room, 'angle', coarse - 1.2);
  run(room, 2.5);
  room.placeBlock();
  run(room, 0.5);
  let thetaC = null;
  for (let a = coarse - 1.2; a <= coarse + 0.5; a = Math.round((a + 0.1) * 10) / 10) {
    set(room, 'angle', a);
    if (run(room, 1.5, slipped)) { thetaC = room.o.ramp.angle / DEG; break; }
  }
  const musEst = Math.tan(thetaC * DEG);
  const okA = room.submitCode('mus', Mathx.fmt(musEst, 2)).ok;
  // Measure acceleration well above the slip angle.
  const test = Math.min(40, thetaC + 6);
  set(room, 'angle', test);
  run(room, 6);
  room.placeBlock();
  run(room, 4, () => room.devices.every((d) => d.duration != null && d.events.length));
  const v1 = 0.4 / room.devices[0].duration, v2 = 0.4 / room.devices[1].duration;
  const th = room.o.ramp.angle;
  const a = (v2 * v2 - v1 * v1) / 2;
  const mukEst = Math.tan(th) - a / (g * Math.cos(th));
  const thK = Math.round(Math.atan(mukEst) / DEG * 10) / 10;
  set(room, 'angle', thK);
  run(room, 20);
  room.placeBlock();
  run(room, 0.3);
  press(room, 'push');
  run(room, 6, () => room.isOpen('cv'));
  return { ok: okA && room.isOpen('cv') && room.cleared,
    info: `μs=${room.p.mus} est=${musEst.toFixed(3)} (θc ${thetaC.toFixed(2)}°) μk=${room.p.muk} est=${mukEst.toFixed(4)} θk=${thK} run=${room.lastRun ? (room.lastRun.v1.toFixed(3) + '→' + room.lastRun.v2.toFixed(3)) : '-'}` };
};

/* ---------------- 03 two strings ---------------- */
solvers.c03 = (game, seed) => {
  const room = game.enter('c03');
  const g = game.lab.g, p = room.p;
  const P = p.target, M = p.M, W = M * g, RAIL = Lab.C03.RAIL;
  const dy = RAIL - P.y;
  // Player reasoning: for each ordered string pair, hooks from Pythagoras, tensions from Lami.
  let best = null;
  const breaking = [];
  for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) {
    if (a === b || p.lens[a] <= dy || p.lens[b] <= dy) continue;
    const xa = Mathx.round(Mathx.snap(P.x - Math.sqrt(p.lens[a] ** 2 - dy * dy), 0.05), 2);
    const xb = Mathx.round(Mathx.snap(P.x + Math.sqrt(p.lens[b] ** 2 - dy * dy), 0.05), 2);
    if (xa < 0.8 || xb > 11.2 || xb - xa < 0.3) continue;
    const phiL = Math.atan2(P.x - xa, dy), phiR = Math.atan2(xb - P.x, dy);
    const TL = W * Math.sin(phiR) / Math.sin(phiL + phiR), TR = W * Math.sin(phiL) / Math.sin(phiL + phiR);
    const worst = Math.max(TL / p.strengths[a], TR / p.strengths[b]);
    if (worst > 1.1) breaking.push({ a, b, xa, xb });
    if (!best || worst < best.worst) best = { a, b, xa, xb, TL, worst };
  }
  // Negative check: a combination predicted to break must break.
  let brokeOk = true;
  if (breaking.length) {
    const c = breaking[0];
    set(room, 'sL', c.a); set(room, 'sR', c.b); set(room, 'xL', c.xa); set(room, 'xR', c.xb);
    room.reset();
    room.startLoading();
    run(room, 30, () => room.strings.some((j) => j.broken));
    brokeOk = room.strings.length === 0 || room.strings.some((j) => j.broken);
    room.reset();
  }
  set(room, 'sL', best.a); set(room, 'sR', best.b); set(room, 'xL', best.xa); set(room, 'xR', best.xb);
  room.reset();
  room.startLoading();
  run(room, 40, () => room.isOpen('hang'));
  const okB = room.submitCode('tl', Mathx.fmt(best.TL, 1)).ok;
  return { ok: room.isOpen('hang') && okB && room.cleared && brokeOk,
    info: `pair ${best.a + 1}${best.b + 1} hooks ${best.xa}/${best.xb} TL=${best.TL.toFixed(2)} worst=${best.worst.toFixed(2)} breakTest=${brokeOk} status='${room.statusText}' t=${room.time.toFixed(1)}s` };
};

let any = false;
for (const def of Lab.Chambers) {
  if (only && !only.split(',').includes(def.id)) continue;
  const solver = solvers[def.id];
  if (!solver) { console.log(`- ${def.id} (no solver yet)`); continue; }
  any = true;
  console.log(`${def.id} ${def.title}`);
  for (const seed of SEEDS) {
    const game = newGame(seed);
    let res;
    try { res = solver(game, seed); } catch (e) { res = { ok: false, info: e.stack }; }
    check(`seed ${seed}`, res.ok, res.info);
  }
}
if (!any) console.log('no chambers tested');
process.exit(summary() ? 1 : 0);
