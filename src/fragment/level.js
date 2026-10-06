/*
 * Fragment — the world.
 *
 * A dark field with a pond, a deep well and a rough plateau. The white
 * fragment is sealed in a flooded chamber at the bottom of the well. Its gate
 * is a plate fixed to a spring-supported platform: the aperture in the plate
 * lines up with the chamber opening only when the platform sinks into one
 * narrow depth window. The depth is set by the platform load's weight in
 * water (weight − buoyancy), balanced by the springs.
 */
(function (root) {
  'use strict';
  const Lab = root.Lab;
  const { Vec2, Bodies, Joints, Fluid, World } = Lab;
  const Frag = (Lab.Fragment = Lab.Fragment || {});

  const G = 9.8;
  const RHO_WATER = 1000;

  const MAT = {
    ground: { key: 'ground', mu: 0.5, muk: 0.45, e: 0.05 },
    smooth: { key: 'smooth', mu: 0.06, muk: 0.05, e: 0.05 },
    rough: { key: 'rough', mu: 1.0, muk: 0.9, e: 0.03 },
    stone: { key: 'stone', mu: 1.0, muk: 0.9, e: 0.04 },
    crate: { key: 'crate', mu: 0.6, muk: 0.5, e: 0.1 },
    dot: { key: 'dot', mu: 0, muk: 0, e: 0 },
    pad: { key: 'pad', mu: 0.8, muk: 0.7, e: 0 },
    shard: { key: 'shard', mu: 0.05, muk: 0.04, e: 0.05 },
  };

  // Collision categories.
  const CAT = { STATIC: 1, LOOSE: 2, PAD: 4, SHARD: 8 };

  const L = {
    SPAWN: new Vec2(1.5, 0.18),
    POND: { x0: 4.5, x1: 9.4, bottom: -1.6, surface: -0.15 },
    WELL: { x0: 12.0, x1: 14.2, floor: -7.2, surface: -0.35 },
    CHAMBER: { x0: 14.2, x1: 15.1, floor: -5.6, roofAtGate: -5.18, roofBack: -5.38 },
    PAD_TOP: -6.0,
    PAD_TRAVEL: 1.0,
    // Gate plate (rest coordinates) — slit lines up with the opening at rest,
    // the aperture lines up when the platform has sunk 0.42–0.68 m.
    GATE: { x0: 14.08, x1: 14.16, top: -4.1, slit: [-5.42, -5.36], aperture: [-4.99, -4.49] },
    TARGET_TRAVEL: 0.55,
    WORLD: { x0: -0.6, x1: 22.4, y0: -7.6, y1: 6 },
  };

  const DENSITY = { M: 1900, S: 11300, pad: 1100, shard: 800, dot: 400 };

  function staticBox(world, x0, y0, x1, y1, mat) {
    const b = Bodies.box((x0 + x1) / 2, (y0 + y1) / 2, x1 - x0, y1 - y0, { type: 'static', material: mat });
    b.surface = mat.key;
    return world.add(b);
  }
  function staticPoly(world, pts, mat) {
    const b = Bodies.polygon(pts, { type: 'static', material: mat });
    b.surface = mat.key;
    return world.add(b);
  }

  Frag.build = function build() {
    const world = new World({ gravity: new Vec2(0, -G), frictionMix: 'min', velocityIterations: 12, positionIterations: 6 });
    const lv = { world, L, MAT, CAT, G };

    /* ---------- ground ---------- */
    const P = L.POND, W = L.WELL, C = L.CHAMBER;
    lv.statics = [
      staticBox(world, -0.6, -2.4, P.x0, 0, MAT.ground),                    // start ground
      staticBox(world, -0.6, 0, 0, 6, MAT.ground),                          // left wall
      staticBox(world, P.x0, -2.4, 6.6, P.bottom, MAT.ground),              // pond bottom
      staticPoly(world, [new Vec2(6.6, P.bottom), new Vec2(P.x1, 0), new Vec2(P.x1, -2.4), new Vec2(6.6, -2.4)], MAT.smooth), // ramp out of the pond
      staticBox(world, P.x1, -7.6, W.x0, 0, MAT.smooth),                    // polished floor, well's left wall
      staticBox(world, W.x0, -7.6, W.x1, W.floor, MAT.ground),              // well floor
      staticBox(world, W.x1, -7.6, 15.4, C.floor, MAT.ground),              // below the chamber
      staticBox(world, C.x1, C.floor, 15.4, C.roofBack, MAT.ground),        // chamber back wall
      staticPoly(world, [new Vec2(W.x1, C.roofAtGate), new Vec2(C.x1, C.roofBack), new Vec2(15.4, C.roofBack), new Vec2(15.4, 0), new Vec2(W.x1, 0)], MAT.rough), // sloped chamber roof / plateau lip
      staticBox(world, 15.4, -7.6, 22.4, 0, MAT.rough),                     // rough plateau
      staticBox(world, 22.0, 0, 22.4, 6, MAT.ground),                       // right wall
    ];
    lv.wellFloor = lv.statics[5];

    /* ---------- water ---------- */
    lv.pond = world.addFluid(new Fluid({ x0: P.x0, x1: P.x1, y0: P.bottom, surface: P.surface, density: RHO_WATER, linearDrag: 2.5, angularDrag: 2 }));
    lv.well = world.addFluid(new Fluid({ x0: W.x0, x1: W.x1, y0: W.floor, surface: W.surface, density: RHO_WATER, linearDrag: 2.5, angularDrag: 2 }));
    // The flooded chamber shares the well's pressure head; it is drawn only up to its own roof.
    lv.chamberWater = world.addFluid(new Fluid({ x0: W.x1, x1: C.x1, y0: C.floor, surface: W.surface, density: RHO_WATER, linearDrag: 2.5, angularDrag: 2 }));
    lv.chamberWater.drawTop = C.roofAtGate;

    /* ---------- platform + gate (one rigid body on a vertical track) ---------- */
    const GT = L.GATE;
    const padParts = [
      { kind: 'box', x: (W.x0 + 0.04 + GT.x0) / 2, y: L.PAD_TOP - 0.05, w: GT.x0 - (W.x0 + 0.04), h: 0.1 },
      { kind: 'box', x: (GT.x0 + GT.x1) / 2, y: (L.PAD_TOP + GT.slit[0]) / 2, w: GT.x1 - GT.x0, h: GT.slit[0] - L.PAD_TOP },
      { kind: 'box', x: (GT.x0 + GT.x1) / 2, y: (GT.slit[1] + GT.aperture[0]) / 2, w: GT.x1 - GT.x0, h: GT.aperture[0] - GT.slit[1] },
      { kind: 'box', x: (GT.x0 + GT.x1) / 2, y: (GT.aperture[1] + GT.top) / 2, w: GT.x1 - GT.x0, h: GT.top - GT.aperture[1] },
    ];
    const pad = Bodies.local(padParts, {
      density: DENSITY.pad, material: MAT.pad, category: CAT.PAD, mask: CAT.LOOSE | CAT.SHARD,
      position: new Vec2(0, 0),
    });
    pad.role = 'pad';
    pad.occluder = true;
    world.add(pad);
    lv.pad = pad;
    lv.padRest = pad.pos.clone();
    lv.slider = world.addJoint(new Joints.SliderJoint(lv.wellFloor, pad, pad.pos, new Vec2(0, 1), { lower: -L.PAD_TRAVEL, upper: 0.15 }));

    /* ---------- loose objects ---------- */
    lv.crate = world.add(Bodies.box(3.0, 0.25, 0.5, 0.5, { mass: 4, material: MAT.crate, category: CAT.LOOSE }));
    lv.crate.role = 'crate';
    lv.M = world.add(Bodies.box(5.45, P.bottom + 0.23, 0.46, 0.46, { density: DENSITY.M, material: MAT.stone, category: CAT.LOOSE }));
    lv.M.role = 'stone';
    lv.S = world.add(Bodies.box(18.2, 0.055, 0.32, 0.11, { density: DENSITY.S, material: MAT.stone, category: CAT.LOOSE }));
    lv.S.role = 'ingot';
    for (const b of [lv.crate, lv.M, lv.S]) b.grabbable = true;

    /* ---------- springs under the platform ---------- */
    // Stiffness chosen so the ingot alone (weight in water) sinks the platform by TARGET_TRAVEL.
    const ingotInWater = lv.S.mass * G * (1 - RHO_WATER / DENSITY.S);
    const K = ingotInWater / L.TARGET_TRAVEL;
    const padArea = pad.area;
    const padInWater = (pad.mass - RHO_WATER * padArea * Lab.DEPTH) * G;
    lv.springs = [];
    for (const x of [12.6, 13.6]) {
      const a = new Vec2(x, W.floor), b = new Vec2(x, L.PAD_TOP - 0.1);
      const len = a.dist(b);
      const s = new Joints.Spring(lv.wellFloor, pad, a, b, {
        k: K / 2, restLength: len + padInWater / K, damping: 30, mode: 'compression', coils: 9, width: 0.22,
      });
      world.addForce(s);
      lv.springs.push(s);
    }
    lv.K = K;

    /* ---------- the fragment ---------- */
    const sc = new Vec2(14.62, -5.42);
    lv.shard = world.add(Bodies.polygon([sc.add(new Vec2(-0.11, 0.06)), sc.add(new Vec2(0.12, 0.09)), sc.add(new Vec2(0.01, -0.12))], {
      density: DENSITY.shard, material: MAT.shard, category: CAT.SHARD,
    }));
    lv.shard.role = 'shard';

    /* ---------- the dot ---------- */
    lv.dot = world.add(Bodies.circle(L.SPAWN.x, L.SPAWN.y, 0.17, { density: DENSITY.dot, material: MAT.dot, fixedRotation: true, category: CAT.LOOSE }));
    lv.dot.role = 'dot';

    lv.travel = () => lv.padRest.y - pad.pos.y;
    lv.shardFree = () => lv.shard.pos.x < GT.x0 - 0.02;
    return lv;
  };

  Frag.G = G;
  Frag.CAT = CAT;
  Frag.L = L;
})(typeof window !== 'undefined' ? window : globalThis);
