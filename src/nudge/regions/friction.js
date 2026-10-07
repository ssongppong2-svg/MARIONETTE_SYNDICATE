/*
 * Nudge — 서리 평원 (the Frost Plain): friction, f = μN.
 *
 *   icicle hall  three rubber blocks (4 kg) under a ceiling that drops icicles
 *   sand patch   two sandbags (12 kg) sunk in sand: 100 N of grip, far beyond
 *                the pointer's 40 N. A skater lives here; its spiked boots bite
 *                as hard as the ground allows (μ·N), so on sand it can shove them
 *   ice field    two more sandbags glide on ice
 *   icy ramp     16.7°: only a load of 12.9 kg or less can be pushed up it
 *   clutch       the ledge drops loads into a bottomless column standing on a
 *                running belt. The belt drags the bottom load with μk·N, where
 *                N is the weight of the whole column, and the column rams the
 *                frost wall. Only the bottom load touches the belt, so the
 *                stacking order decides μ: rubber 0.85, sackcloth 0.75, steel 0.4.
 *                A 30 kg steel block waits at the ledge's edge: the first load
 *                pushed along the ledge knocks it in.
 *   frost wall   gives way to 720 N held for 2 s
 *
 *   Everything in (90 kg):  rubber at the bottom   0.85 · 882 N = 750 N
 *                           a sandbag at the bottom 0.75 · 882 N = 661 N
 *                           the steel at the bottom 0.40 · 882 N = 353 N
 */
(function (root) {
  'use strict';
  const Lab = root.Lab;
  const { Vec2, Bodies, Joints } = Lab;
  const Nudge = (Lab.Nudge = Lab.Nudge || {});
  Nudge.regions = Nudge.regions || {};

  const FR = {
    HALL: { x0: 12, x1: 22, roof: 3.0 },
    SAND: { x0: 22, x1: 27.3 },
    ICE: { x0: 27.3 },
    RAMP: { x0: 39.51, x1: 45, top: 1.5, foot: 0.35 },   // 16.7° (0.3) above a curved foot
    LEDGE: { x0: 45, x1: 46.5 },
    COLUMN: { x0: 46.57, x1: 46.96 },            // inner faces of the clutch column
    BELT: { y: -1.2, speed: -1.0 },              // (the contact's tangent runs right to left here: this drives loads toward the wall)
    WALL: { x0: 47.0, x1: 47.5, y0: -1.2, y1: 3.2, strength: 720, endure: 2 },
    GOAL: new Vec2(55.5, 0.2),
    RUBBER: { mass: 4, density: 1100, aspect: 2 },
    SACK: { mass: 12, density: 1500, aspect: 1.4 },
    STEEL: { mass: 30, density: 7870, aspect: 1.4 },
  };

  Nudge.regions.friction = function friction(game, R) {
    const k = Nudge.kit, M = Nudge.MAT;
    R.name = '서리 평원';
    R.palette = 'friction';
    R.bounds = [12, -3, 62, 13];
    R.FR = FR;
    const cleared = !!game.save.cleared.friction;

    /* ---------------- ground ---------------- */
    const H = FR.HALL, S = FR.SAND, I = FR.ICE, RP = FR.RAMP, L = FR.LEDGE, C = FR.COLUMN, W = FR.WALL;
    k.solid(game, H.x0, -3, H.x1, 0);                       // hall floor (rock)
    k.solid(game, H.x0 + 1, H.roof, H.x1, 16);              // hall roof, where the icicles grow
    k.solid(game, S.x0, -3, S.x1, 0, M.sand);               // sand patch
    k.solid(game, I.x0, -3, RP.x0, 0, M.ice);               // ice field
    k.solid(game, RP.x0, -3, RP.x1, 0, M.ice);
    // Icy ramp: its foot bends up in steps (4.6°, 9°, 13.5°) into the 16.7° slope,
    // so a pushed load tilts onto it instead of jamming in a crease.
    let x = RP.x0, y = 0;
    for (const sl of [0.08, 0.16, 0.24]) {
      const x2 = x + RP.foot, y2 = y + sl * RP.foot;
      // The first step starts 1 cm under the floor, so its face (not its tip) meets a load.
      const sunk = y > 0 ? null : [x - 0.01 / sl, -0.01];
      k.wedge(game, sunk ? [sunk, [x2, sunk[1]], [x2, y2]] : [[x, 0], [x2, 0], [x2, y2], [x, y]], M.ice);
      x = x2; y = y2;
    }
    // The slope and the ledge are one body, so nothing snags on a seam at the crest.
    // (The ledge's right face is the wall of the column's pit.)
    k.wedge(game, [[x, -3], [L.x1, -3], [L.x1, RP.top], [L.x0, RP.top], [x, y]], M.ice);
    k.solid(game, H.x1, 12, W.x1, 13);                      // a low sky over the plain
    k.solid(game, W.x0, W.y1, 62, 13);                      // rock over the frost wall and the vault
    k.solid(game, L.x1, -3, 61, FR.BELT.y - 1.0);           // pit bottom
    k.solid(game, W.x0, FR.BELT.y - 1.0, 61, FR.BELT.y);    // vault floor
    k.solid(game, 61, -3, 62, 13);                          // far wall
    // The belt: a strip of the pit floor that runs toward the wall.
    R.belt = k.solid(game, L.x1, FR.BELT.y - 1.0, W.x0, FR.BELT.y, M.belt, { surfaceSpeed: FR.BELT.speed });
    R.belt.role = 'belt';
    game.checkpointAt('gate', 13.2, 1.4, '서리 평원 입구');
    game.checkpointAt('plain', 28.6, 1.6, '얼음 들판');

    /* ---------------- icicle hall ---------------- */
    R.icicles = game.device(new Nudge.Icicles(game, [14.3, 15.7, 17.1, 18.5, 19.9, 21.3], H.roof, { period: 3.4, stagger: 0.57, grow: 1.2 }));
    const RB = FR.RUBBER, SK = FR.SACK;
    R.rubber = [15.0, 17.6, 20.6].map((x) => {             // each between two icicles
      const b = k.block(game, x, 0, RB.mass, RB.density, M.rubber, RB.aspect);
      b.role = 'rubber';
      return b;
    });

    /* ---------------- sand, skater and sandbags ---------------- */
    const sack = (x) => {
      const b = k.block(game, x, 0, SK.mass, SK.density, M.sack, SK.aspect);
      b.role = 'sandbag';
      return b;
    };
    R.sacks = [sack(24.2), sack(25.4), sack(31.0), sack(34.0)];
    R.skater = game.monster(new Nudge.Skater(game, 22.8, 0, { home: [S.x0 + 0.4, S.x1 + 0.1] }));

    /* ---------------- the steel block on the ledge ---------------- */
    const ST = FR.STEEL;
    R.steel = k.block(game, L.x1 - 0.14, RP.top, ST.mass, ST.density, M.iron, ST.aspect);
    R.steel.role = 'steel';

    /* ---------------- the clutch column and the frost wall ---------------- */
    if (!cleared) R.wallObj = game.wall(new Nudge.Wall(game, W.x0, W.y0, W.x1, W.y1, { strength: W.strength, endure: W.endure, axis: new Vec2(1, 0), color: '#bfe6ff' }));
    const t = 0.03, bot = FR.BELT.y + 0.01;
    const col = (R.column = game.add(Bodies.compound([
      { kind: 'box', x: C.x0 - t / 2, y: (bot + 1.3) / 2, w: t, h: 1.3 - bot },        // near wall, under the ledge's lip
      { kind: 'box', x: C.x1 + t / 2, y: (bot + 2.6) / 2, w: t, h: 2.6 - bot },        // far wall, a backstop for what is pushed off
    ], { mass: 4, material: M.slick })));
    col.role = 'column';
    R.columnRail = game.addJoint(new Joints.SliderJoint(game.anchor, col, col.pos, new Vec2(1, 0), { lower: -0.02, upper: 1.2 }));

    /* ---------------- the fragment ---------------- */
    game.checkpointAt('vault', 51.0, 0.2, '서리의 금고');
    if (!cleared) game.fragmentAt('friction', FR.GOAL.x, FR.GOAL.y);

    /** What the belt drags with: the loads standing on it, their μk and the weight above them. */
    R.clutch = () => {
      const w = game.world;
      let N = 0, F = 0, bottom = null;
      for (const arb of w.arbiters.values()) {
        if (arb.a !== R.belt && arb.b !== R.belt) continue;
        const o = arb.a === R.belt ? arb.b : arb.a;
        if (!o.isDynamic) continue;
        let P = 0;
        for (const c of arb.contacts) P += c.Pn;
        const n = P / w.dt;
        N += n;
        F += n * arb.muk;
        bottom = o;
      }
      return { N, F, mu: N > 0 ? F / N : 0, bottom };
    };
    /** Loads inside the column. */
    const colIn = col.localPoint(new Vec2(C.x0, 0));
    R.load = () => {
      const x0 = col.worldPoint(colIn).x;
      return game.world.bodies.filter((b) => b.isDynamic && b !== col && b.role !== 'pointer' && b.pos.x > x0 && b.pos.x < x0 + (C.x1 - C.x0) && b.pos.y < RP.top + 1);
    };

    R.update = () => {};
  };

  Nudge.FR = FR;
})(typeof window !== 'undefined' ? window : globalThis);
