/*
 * Nudge — 낙하의 절벽 (the Cliffs of the Fall): gravity and weight.
 *
 *   corridor     a heavy blade swings across it
 *   balance lift platform 2 kg + a 25 kg stone ball vs a 26 kg counterweight,
 *                latched by a pin; hauled up (net 9.8 N), a pawl holds it
 *                level with the plank
 *   Galileo      a plank holds two cups 7 m above two plates; pull its pin and
 *                whatever sits in the cups falls at once. Both plates struck
 *                within 0.06 s open the funnel. (A feather lags in the air.)
 *   funnel       leads to a counterweight basket on a rope; the rope runs under
 *                the canyon floor to a ram against the wall
 *   wall         gives way to 600 N held for 2 s — about 61 kg in the basket
 *   dropper      floats over the pointer anywhere under the canyon's sky and
 *                drops 20 kg stones; a stone left lying (outside the basket)
 *                crumbles after 4 s. A gravity orb beside the funnel bends
 *                what falls near it
 */
(function (root) {
  'use strict';
  const Lab = root.Lab;
  const { Vec2, Bodies, Joints } = Lab;
  const Nudge = (Lab.Nudge = Lab.Nudge || {});
  Nudge.regions = Nudge.regions || {};

  const GV = {
    SHAFT: { x0: -31.4, x1: -29.4 },
    FUNNEL: [-30.8, -30.0],          // the mouth between the lips
    PLANK: { x0: -42.5, x1: -34.0, y: 7.0, t: 0.12 },
    CUPS: [-40.0, -36.0],
    PLATES: [-40.0, -36.0],
    LIFT: { x: -43.25, w: 1.3, top: 6.97 },     // at the top the deck's near edge is flush with the plank
    CW: { x: -44.68, mass: 26 },
    WALL: { x0: -46.5, x1: -46.0, y0: 0.12, y1: 5.0, strength: 600, endure: 2 },
    GOAL: new Vec2(-52.5, 2.4),
  };

  function hub(game, x, y) {
    return game.add(Bodies.box(x, y, 0.02, 0.02, { type: 'static', category: 0, mask: 0 }));
  }

  Nudge.regions.gravity = function gravity(game, R) {
    const k = Nudge.kit, M = Nudge.MAT;
    R.name = '낙하의 절벽';
    R.palette = 'gravity';
    R.bounds = [-58, -12, -12, 17];
    R.GV = GV;
    const cleared = !!game.save.cleared.gravity;
    const SH = GV.SHAFT;

    /* ---------------- rock ---------------- */
    k.solid(game, -21, -2, -12, 0);                   // corridor floor
    k.solid(game, -21, 3, -13, 18);                   // above the corridor
    // Canyon floor (smooth stone: balls roll), with the two plates set into it.
    let fx = -57;
    for (const x of GV.PLATES) {
      k.solid(game, fx, -2, x - 0.5, 0, M.smooth);
      k.solid(game, x - 0.5, -2, x + 0.5, -0.06);
      fx = x + 0.5;
    }
    k.solid(game, fx, -2, SH.x0, 0, M.smooth);
    k.solid(game, SH.x1, -2, -21, 0, M.smooth);
    k.solid(game, -57, -12, SH.x0, -2);               // deep rock around the basket shaft
    k.solid(game, SH.x1, -12, -21, -2);
    k.solid(game, SH.x0, -12, SH.x1, -11);
    k.solid(game, -46.5, 16, -21, 18);                // canyon ceiling
    k.solid(game, -57, 5, -46.5, 18);                 // mass over the chamber
    k.solid(game, -58, -12, -57, 18);                 // far wall
    // Funnel lips over the shaft: only what falls from above gets in.
    const F = GV.FUNNEL;
    k.wedge(game, [[F[0] - 1.2, 0], [F[0], 0], [F[0], 0.6]], M.smooth);
    k.wedge(game, [[F[1], 0], [F[1] + 1.2, 0], [F[1], 0.6]], M.smooth);
    R.lid = game.gate(new Nudge.Gate(game, F[0], -0.14, F[1], 0, { kind: 'lid' }));
    if (cleared) R.lid.lift();

    /* ---------------- corridor blade ---------------- */
    // Pivot just under the rock (its corners clear it); the tip skims 10 cm over the floor.
    R.blade = game.device(new Nudge.Pendulum(game, -16.5, 2.85, 2.75, { amp: 0.95, mass: 30 }));
    game.checkpointAt('gate', -22.4, 1.6, '절벽 입구');

    /* ---------------- the wall, the ram and the basket ---------------- */
    const W = GV.WALL;
    if (!cleared) R.wallObj = game.wall(new Nudge.Wall(game, W.x0, W.y0, W.x1, W.y1, { strength: W.strength, endure: W.endure, axis: new Vec2(1, 0), color: '#f7a8c3' }));
    const ram = (R.ram = game.add(Bodies.box(-45.3, 0.42, 1.4, 0.8, { mass: 20, material: M.slick })));
    ram.role = 'ram';
    game.addJoint(new Joints.SliderJoint(game.anchor, ram, ram.pos, new Vec2(1, 0), { lower: -3.5, upper: 0.02 }));
    const bx = -30.4, btop = -3.0, bw = 1.5, bh = 0.9, bt = 0.06;
    const basket = (R.basket = game.add(Bodies.compound([
      { kind: 'box', x: bx, y: btop - bh + bt / 2, w: bw, h: bt },
      { kind: 'box', x: bx - bw / 2 + bt / 2, y: btop - bh / 2, w: bt, h: bh },
      { kind: 'box', x: bx + bw / 2 - bt / 2, y: btop - bh / 2, w: bt, h: bh },
    ], { mass: 3, material: M.iron, angularDamping: 3 })));
    basket.role = 'basket';
    R.basketFloor = basket.localPoint(new Vec2(bx, btop - bh + bt));
    const inLo = basket.localPoint(new Vec2(bx - bw / 2 + bt, btop - bh + bt)), inHi = basket.localPoint(new Vec2(bx + bw / 2 - bt, btop + 0.5));
    /** Is a body inside the basket? */
    R.inBasket = (b) => {
      const q = basket.localPoint(b.pos);
      return q.x > inLo.x && q.x < inHi.x && q.y > inLo.y && q.y < inHi.y;
    };
    /** Mass resting in the basket (what its weight on the rope is made of). */
    R.basketMass = () => {
      let m = 0;
      for (const b of game.world.bodies) if (b.isDynamic && b !== basket && b.role !== 'pointer' && R.inBasket(b)) m += b.mass;
      return m;
    };
    game.addJoint(new Joints.SliderJoint(game.anchor, basket, basket.pos, new Vec2(0, 1), {}));
    const pa = hub(game, -46.25, 0.0), pb = hub(game, -46.25, -1.2), pc = hub(game, -30.3, -1.3);
    R.rope = game.addJoint(new Joints.RopePath([
      { body: ram, point: new Vec2(-45.95, 0.05) },
      { body: pa, point: pa.pos.clone(), radius: -0.05 },
      { body: pb, point: pb.pos.clone(), radius: -0.05 },
      { body: pc, point: pc.pos.clone(), radius: 0.05 },
      { body: basket, point: new Vec2(-30.25, btop + 0.1) },
    ]));
    R.rope.tensionTau = 0.1;
    // While the basket hangs free, the ram leans on the wall with its weight.

    /* ---------------- balance lift ---------------- */
    const LF = GV.LIFT, CW = GV.CW;
    // The deck dips 3 cm toward a low lip on the far side, so a load settles there
    // instead of drifting back off the edge it came in by.
    const dx0 = LF.x - LF.w / 2, dx1 = LF.x + LF.w / 2;
    const plat = (R.platform = game.add(Bodies.compound([
      { kind: 'poly', verts: [new Vec2(dx0, 0), new Vec2(dx1, 0), new Vec2(dx1, 0.15), new Vec2(dx0, 0.12)] },
      { kind: 'box', x: dx0 + 0.04, y: 0.145, w: 0.08, h: 0.05 },
    ], { mass: 2, material: M.rock })));
    plat.role = 'platform';
    plat.grab = true;
    plat.size = [LF.w, 0.12];
    R.liftRail = game.addJoint(new Joints.SliderJoint(game.anchor, plat, plat.pos, new Vec2(0, 1), {
      lower: 0, upper: LF.top, motor: { enabled: true, speed: 0, maxForce: 1e5 },
    }));
    const cw = (R.counter = game.add(Bodies.box(CW.x, 8.4, 0.8, 0.6, { mass: CW.mass, material: M.iron, fixedRotation: true })));
    cw.role = 'counterweight';
    // It runs on a vertical rail (no walls around it, so the lift stays open on all sides).
    cw.rail = [new Vec2(CW.x, 1.0), new Vec2(CW.x, 9.3)];
    game.addJoint(new Joints.SliderJoint(game.anchor, cw, cw.pos, new Vec2(0, 1), { lower: 1.3 - 8.4, upper: 0.6 }));
    const l1 = hub(game, LF.x, 9.8), l2 = hub(game, CW.x, 9.8);
    R.liftRope = game.addJoint(new Joints.RopePath([
      { body: plat, point: new Vec2(LF.x + 0.1, 0.12) },
      { body: l1, point: l1.pos.clone(), radius: -0.1 },
      { body: l2, point: l2.pos.clone(), radius: -0.1 },
      { body: cw, point: new Vec2(CW.x - 0.1, 8.7) },
    ]));
    R.latched = true;      // held at the bottom by the pin
    R.caught = false;      // held at the top by the pawl
    R.lowering = false;
    R.emptyT = 0;
    /** Is the heavy ball riding on the deck? */
    const deckMid = plat.localPoint(new Vec2(LF.x, 0.135));
    R.loaded = () => {
      const b = R.heavy, d = plat.worldPoint(deckMid);
      return !!b && Math.abs(b.pos.x - d.x) < LF.w / 2 + 0.05 && b.pos.y > d.y && b.pos.y < d.y + 0.45;
    };
    // A gentle ramp up to the platform's deck, and the latch pin beside it.
    k.wedge(game, [[dx1 + 0.03, 0], [dx1 + 1.53, 0], [dx1 + 0.03, 0.15]], M.smooth);
    R.latch = game.device(new Nudge.Pin(game, -39.7, 0.3, { friction: 20, release: 0.3, onRelease: () => { R.latched = false; R.liftRail.motor.enabled = false; } }));

    /* ---------------- Galileo: plank, cups, plates ---------------- */
    const P = GV.PLANK;
    k.solid(game, P.x1, P.y - 0.4, P.x1 + 1.0, P.y + P.t);   // the ledge holding the plank's pin
    R.plates = GV.PLATES.map((x) => game.device(new Nudge.Plate(game, x - 0.5, x + 0.5, 0, { minImpulse: 2 })));   // flush with the floor
    R.makePlank = () => game.within(R, () => {
      R.plank = [k.solid(game, P.x0, P.y, P.x1, P.y + P.t, M.wood)];
      for (const x of GV.CUPS) {
        R.plank.push(k.wedge(game, [[x - 0.2, P.y + P.t], [x - 0.12, P.y + P.t], [x - 0.12, P.y + P.t + 0.04]], M.wood));
        R.plank.push(k.wedge(game, [[x + 0.12, P.y + P.t], [x + 0.2, P.y + P.t], [x + 0.12, P.y + P.t + 0.09]], M.wood));
      }
      for (const b of R.plank) b.role = 'plank';
    });
    R.makePlank();
    R.drop = null;
    R.pin = game.device(new Nudge.Pin(game, P.x1 + 0.5, P.y + P.t + 0.2, { friction: 25, release: 0.3, onRelease: () => {
      for (const b of R.plank) {
        game.world.remove(b);
        const i = R.bodies.indexOf(b);
        if (i >= 0) R.bodies.splice(i, 1);
      }
      R.plank = [];
      R.drop = { t: game.time, hits: [] };
    } }));

    /* ---------------- the balls ---------------- */
    // The heavy ball: 25 kg of granite, wider than the pointer so it can be pushed square.
    R.heavy = k.ball(game, -39.0, 0.0, 25, 2600, M.stone, { angularDamping: 0.05 });
    R.heavy.role = 'heavy';
    k.solid(game, -25.6, 9.4, -23.6, 9.7);                    // a high ledge
    R.wood = k.ball(game, -24.2, 9.7, 1.2, 600, M.wood, { angularDamping: 0.3 });
    R.wood.role = 'woodball';
    R.feather = k.ball(game, -25.0, 9.7, 0.15, 40, M.foam, { linearDamping: 4, angularDamping: 1 });
    R.feather.role = 'feather';

    /* ---------------- monsters ---------------- */
    // It follows the pointer under the whole open sky of the canyon (the rock over
    // the chamber and over the corridor are its only bounds).
    R.dropper = game.monster(new Nudge.Dropper(game, { home: [-46.0, -21.5], alt: 12.8, rockMass: 20, reload: 5 }));
    R.orb = game.device(new Nudge.Orb(game, -28.2, 2.4, { K: 40, range: 5.5, r: 0.35 }));   // its reach stops short of the basket

    /* ---------------- the fragment ---------------- */
    game.checkpointAt('chamber', -49.0, 2.0, '열쇠의 방');
    if (!cleared) game.fragmentAt('gravity', GV.GOAL.x, GV.GOAL.y);

    R.update = (dt) => {
      // Galileo: both plates struck together?
      if (R.drop) {
        const [a, b] = R.plates;
        const t0 = R.drop.t;
        if (a.lastHit > t0 && b.lastHit > t0 && Math.abs(a.lastHit - b.lastHit) < 0.06 && !R.lid.open) {
          R.lid.lift();
          game.emit({ type: 'galileo', ok: true, dt: Math.abs(a.lastHit - b.lastHit) });
          R.drop = null;
        } else if (game.time - t0 > 2.6) {
          game.emit({ type: 'galileo', ok: false, dt: a.lastHit > t0 && b.lastHit > t0 ? Math.abs(a.lastHit - b.lastHit) : null });
          R.drop = null;
          R.makePlank();
          R.pin.reset();
        }
      }
      // A pawl catches the platform at the top, level with the plank.
      const rail = R.liftRail, motor = rail.motor;
      if (!R.latched && !R.caught && !R.lowering && rail.translation > LF.top - 0.01) {
        R.caught = true;
        motor.enabled = true;
        motor.speed = 0;
        game.emit({ type: 'latch', p: plat.pos.clone() });
      }
      // An empty platform left up (or flung up) winds itself back down and latches.
      if (!R.latched && !R.lowering) {
        R.emptyT = !R.loaded() && rail.translation > 0.05 ? R.emptyT + dt : 0;
        if (R.emptyT > 2) { R.lowering = true; R.caught = false; motor.enabled = true; motor.speed = -1.2; }
      }
      if (R.lowering && rail.translation < 0.01) {
        R.lowering = false;
        R.latched = true;
        motor.speed = 0;
        R.latch.reset();
        game.emit({ type: 'latch', p: plat.pos.clone() });
      }
      // A stone left lying anywhere but in the basket crumbles after 4 s, so none
      // can bury the plank, the lift or the path for good; too many at once, the
      // oldest goes first.
      const crumble = (r) => {
        game.world.remove(r);
        R.dropper.dropped.splice(R.dropper.dropped.indexOf(r), 1);
        game.emit({ type: 'pop', p: r.pos.clone(), color: '#b9c3dd' });
      };
      for (const r of R.dropper.dropped.slice()) {
        if (!r.world) continue;
        const still = r.vel.len() < 0.08 && Math.abs(r.angVel) < 0.5 && !R.inBasket(r);
        r.restT = still ? (r.restT || 0) + dt : 0;
        if (r.restT > 4) crumble(r);
      }
      const loose = R.dropper.dropped.filter((r) => r.world && !R.inBasket(r));
      if (loose.length > 8) crumble(loose[0]);
    };
  };

  Nudge.GV = GV;
})(typeof window !== 'undefined' ? window : globalThis);
