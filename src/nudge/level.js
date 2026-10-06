/*
 * Nudge — the room.
 *
 * A pink wall stands between the pointer and the light. A mint ram rests
 * against it on frictionless rails. Two ropes pull the ram into the wall:
 *   rope 1 runs over a pulley down into the well to a bucket — it pulls with
 *          the bucket's weight in water (weight − buoyancy);
 *   rope 2 runs down to a pulley on the well floor and back up to a buoy —
 *          it pulls with the buoy's buoyancy minus its weight, only while
 *          the buoy is under water.
 * The wall gives way only to a sustained resultant force. The stones that
 * could load the bucket lie on a rough tunnel floor: too much friction for
 * the pointer when dry, little enough once water takes part of their weight.
 */
(function (root) {
  'use strict';
  const Lab = root.Lab;
  const { Vec2, Bodies, Joints, Fluid, World } = Lab;
  const Nudge = (Lab.Nudge = Lab.Nudge || {});

  const G = 9.8;

  const MAT = {
    rock: { key: 'rock', mu: 0.6, muk: 0.5, e: 0.05 },
    tunnel: { key: 'tunnel', mu: 0.7, muk: 0.62, e: 0.02 },
    ice: { key: 'ice', mu: 0.03, muk: 0.02, e: 0.05 },
    slick: { key: 'slick', mu: 0, muk: 0, e: 0 },
    stone: { key: 'stone', mu: 1, muk: 1, e: 0.05 },
    soft: { key: 'soft', mu: 0.4, muk: 0.3, e: 0.15 },
    pointer: { key: 'pointer', mu: 0.3, muk: 0.25, e: 0 },
  };

  const L = {
    W: 16, H: 9,
    GROUND: 3.0,
    TUNNEL: { x0: 1.2, x1: 12.4, floor: 1.4, roof: 2.6 },
    SHAFT: { x0: 1.2, x1: 2.2 },
    WELL: { x0: 12.4, x1: 14.6, floor: -2.0 },
    BUOY_COLUMN: { x0: 13.64, divider: 13.6, grate: -1.05 },
    WALL: { x0: 13.4, x1: 13.9, y0: 3.0, y1: 9.0 },
    RESERVOIR: { x0: 0.3, x1: 2.9, y0: 5.6, y1: 8.4, outlet: [1.45, 1.95] },
    DRAIN: [12.6, 12.9],
    MAX_LEVEL: 2.45,
    STRENGTH: 620,      // N the wall can bear
    ENDURE: 2.5,        // s of overload before it fails
    POINTER_FORCE: 40,  // N
    POINTER_SPEED: 4,   // m/s
    GOAL: new Vec2(15.0, 4.4),
    SPAWN: new Vec2(4.0, 4.6),
    VIEW: [-0.35, -2.35, 16.35, 9.35],
  };

  function box(world, x0, y0, x1, y1, mat, opts = {}) {
    const b = Bodies.box((x0 + x1) / 2, (y0 + y1) / 2, x1 - x0, y1 - y0, Object.assign({ type: 'static', material: mat }, opts));
    b.surface = mat.key;
    return world.add(b);
  }

  Nudge.build = function build() {
    const world = new World({ gravity: new Vec2(0, -G), frictionMix: 'min', velocityIterations: 14, positionIterations: 6 });
    const lv = { world, L, MAT, G };
    const T = L.TUNNEL, S = L.SHAFT, Wl = L.WELL, R = L.RESERVOIR;

    /* ---------- rock ---------- */
    const rock = MAT.rock;
    lv.solids = [
      box(world, -0.6, -2.6, 0, 9.6, rock),                     // left wall
      box(world, 16, -2.6, 16.6, 9.6, rock),                    // right wall
      box(world, -0.6, 9.0, 16.6, 9.6, rock),                   // ceiling
      box(world, -0.6, -2.6, 16.6, Wl.floor, rock),             // deep floor
      box(world, 0, Wl.floor, Wl.x0, T.floor, MAT.tunnel),      // bedrock under the tunnel (rough top)
      box(world, 0, T.floor, S.x0, L.GROUND, rock),             // left of the shaft
      box(world, S.x1, T.roof, Wl.x0, L.GROUND, rock),          // ground slab over the tunnel
      box(world, Wl.x1, Wl.floor, 16, L.GROUND, rock),          // bedrock right of the well
      // Slab over the well with two narrow rope slots.
      box(world, Wl.x0, T.roof, 12.76, L.GROUND, rock),
      box(world, 12.92, T.roof, 13.26, L.GROUND, rock),
      box(world, 13.42, T.roof, Wl.x1, L.GROUND, rock),
      // The buoy's column: a divider and a grate it rests on when the well is dry.
      box(world, L.BUOY_COLUMN.divider, L.BUOY_COLUMN.grate, L.BUOY_COLUMN.x0, 0.3, rock),
      box(world, L.BUOY_COLUMN.x0, L.BUOY_COLUMN.grate - 0.05, Wl.x1, L.BUOY_COLUMN.grate, rock),
    ];
    lv.grate = lv.solids[lv.solids.length - 1];
    lv.grate.surface = 'grate';
    // Polished strip at the end of the tunnel.
    lv.ice = box(world, 10.9, T.floor - 0.06, Wl.x0, T.floor, MAT.ice);

    // Reservoir (open top) with an outlet in its floor.
    lv.solids.push(
      box(world, R.x0, R.y0, R.x0 + 0.15, R.y1, rock),
      box(world, R.x1 - 0.15, R.y0, R.x1, R.y1, rock),
      box(world, R.x0, R.y0, R.outlet[0], R.y0 + 0.15, rock),
      box(world, R.outlet[1], R.y0, R.x1, R.y0 + 0.15, rock),
    );

    /* ---------- the wall ---------- */
    lv.wall = box(world, L.WALL.x0, L.WALL.y0, L.WALL.x1, L.WALL.y1, MAT.slick);
    lv.wall.role = 'wall';

    /* ---------- water ---------- */
    lv.level = Wl.floor;               // shared water level of tunnel + well
    lv.wellWater = world.addFluid(new Fluid({ x0: Wl.x0, x1: Wl.x1, y0: Wl.floor, surface: Wl.floor, linearDrag: 0.8, angularDrag: 1.5 }));
    lv.tunnelWater = world.addFluid(new Fluid({ x0: T.x0, x1: T.x1, y0: T.floor, surface: T.floor, linearDrag: 0.8, angularDrag: 1.5 }));
    lv.reservoir = world.addFluid(new Fluid({ x0: R.x0 + 0.15, x1: R.x1 - 0.15, y0: R.y0 + 0.15, surface: 8.0, linearDrag: 1, angularDrag: 1 }));
    lv.setLevel = (y) => {
      lv.level = y;
      lv.wellWater.surface = Math.max(Wl.floor, y);
      lv.tunnelWater.surface = Math.max(T.floor, Math.min(y, T.roof));
    };
    /** Water volume (m² of cross-section) held below level y. */
    lv.volumeAt = (y) => {
      const yw = Math.max(Wl.floor, Math.min(y, L.GROUND));
      let v = (Wl.x1 - Wl.x0) * (yw - Wl.floor);
      const yt = Math.max(T.floor, Math.min(y, T.roof));
      v += (T.x1 - T.x0) * (yt - T.floor);
      return v;
    };
    lv.levelAt = (v) => {
      const well = Wl.x1 - Wl.x0, tun = T.x1 - T.x0;
      const vBelow = well * (T.floor - Wl.floor);
      if (v <= vBelow) return Wl.floor + v / well;
      return T.floor + (v - vBelow) / (well + tun);
    };
    lv.volume = 0;

    /* ---------- ram on frictionless rails ---------- */
    const ram = world.add(Bodies.box(12.4, L.GROUND + 0.505, 2.0, 1.0, { mass: 40, material: MAT.slick }));
    ram.role = 'ram';
    lv.ram = ram;
    lv.rail = world.addJoint(new Joints.SliderJoint(lv.solids[3], ram, ram.pos, new Vec2(1, 0), { lower: -0.35, upper: 0.02 }));

    /* ---------- bucket on rope 1 ---------- */
    // Thin iron walls: 9 kg, denser than water (1500 kg/m³ averaged over its 2D section).
    const bx = 12.83, btop = 1.3, bw = 0.8, bh = 0.6, t = 0.03;
    const bucket = world.add(Bodies.compound([
      { kind: 'box', x: bx, y: btop - bh + t / 2, w: bw, h: t },
      { kind: 'box', x: bx - bw / 2 + t / 2, y: btop - bh / 2, w: t, h: bh },
      { kind: 'box', x: bx + bw / 2 - t / 2, y: btop - bh / 2, w: t, h: bh },
    ], { mass: 9, material: MAT.soft, angularDamping: 1.5 }));
    bucket.role = 'bucket';
    lv.bucket = bucket;
    lv.bucketHandle = new Vec2(bx, btop + 0.18);
    lv.bucketLocal = {
      handle: bucket.localPoint(lv.bucketHandle),
      left: bucket.localPoint(new Vec2(bx - bw / 2 + t / 2, btop)),
      right: bucket.localPoint(new Vec2(bx + bw / 2 - t / 2, btop)),
    };
    lv.rope1 = world.addJoint(new Joints.RopePath([
      { body: ram, point: new Vec2(12.0, L.GROUND + 0.02) },
      { body: lv.solids[9], point: new Vec2(12.75, 2.88), radius: 0.08 },
      { body: bucket, point: lv.bucketHandle.clone() },
    ]));

    /* ---------- buoy on rope 2 (down to a floor pulley, back up) ---------- */
    const buoyC = new Vec2(14.12, -0.3);
    const buoy = world.add(Bodies.box(buoyC.x, buoyC.y, 0.6, 0.5, { density: 100, material: MAT.soft, angularDamping: 2 }));
    buoy.role = 'buoy';
    lv.buoy = buoy;
    lv.rope2 = world.addJoint(new Joints.RopePath([
      { body: ram, point: new Vec2(12.3, L.GROUND + 0.02) },
      { body: lv.solids[10], point: new Vec2(13.26, 2.88), radius: 0.08 },
      { body: lv.solids[3], point: new Vec2(13.73, -1.55), radius: -0.39 },
      { body: buoy, point: new Vec2(buoyC.x, buoyC.y - 0.25) },
    ]));
    // Start dry: the buoy sits on its grate, its rope slack.
    buoy.setPosition(new Vec2(buoyC.x, L.BUOY_COLUMN.grate + 0.25 + 0.002));

    /* ---------- stones (dense) and a pumice (light) in the dry tunnel ---------- */
    lv.stones = [3.6, 5.6, 7.6, 9.6].map((x) => {
      // Wide and low: a push at pointer height can never tip it over.
      const s = world.add(Bodies.box(x, T.floor + 0.1, 0.3, 0.2, { mass: 10, material: MAT.stone }));
      s.role = 'stone';
      return s;
    });
    lv.pumice = world.add(Bodies.box(4.6, T.floor + 0.12, 0.3, 0.24, { density: 450, material: MAT.stone }));
    lv.pumice.role = 'pumice';

    /* ---------- water controls ---------- */
    // Outlet pipe under the reservoir, and a sliding plate under the pipe.
    lv.solids.push(
      box(world, R.outlet[0] - 0.08, 5.42, R.outlet[0], R.y0, rock),
      box(world, R.outlet[1], 5.42, R.outlet[1] + 0.08, R.y0, rock),
    );
    // The plate seals the pipe from below; a knob hangs under it for the pointer to push.
    const gate = world.add(Bodies.compound([
      { kind: 'box', x: 1.7, y: 5.37, w: 0.62, h: 0.08 },
      { kind: 'box', x: 1.7, y: 5.19, w: 0.07, h: 0.28 },
    ], { mass: 1, material: MAT.slick, gravityScale: 0 }));
    lv.gateBase = 1.7 - gate.pos.x;
    gate.role = 'gate';
    lv.gate = gate;
    lv.gateRest = gate.pos.clone();
    // Rails with a light brake: bumps don't move the controls, a deliberate push does.
    const brake = { enabled: true, speed: 0, maxForce: 15 };
    world.addJoint(new Joints.SliderJoint(lv.solids[0], gate, gate.pos, new Vec2(1, 0), { lower: 0, upper: 0.75, motor: brake }));
    // Sliding plug on the well floor, with a knob to push either way.
    const plug = world.add(Bodies.compound([
      { kind: 'box', x: 12.75, y: Wl.floor + 0.05, w: 0.4, h: 0.08 },
      { kind: 'box', x: 12.75, y: Wl.floor + 0.2, w: 0.07, h: 0.24 },
    ], { mass: 1, material: MAT.slick, gravityScale: 0 }));
    plug.role = 'plug';
    lv.plug = plug;
    lv.plugBase = 12.75 - plug.pos.x; // base centre offset from the body origin
    world.addJoint(new Joints.SliderJoint(lv.solids[3], plug, plug.pos, new Vec2(1, 0), { lower: -0.02, upper: 0.5, motor: Object.assign({}, brake) }));

    /** Uncovered fraction of an interval [a, b] by a plate spanning [c − w/2, c + w/2]. */
    const openFraction = (a, b, c, w) => {
      const lo = Math.max(a, c - w / 2), hi = Math.min(b, c + w / 2);
      return 1 - Math.max(0, hi - lo) / (b - a);
    };
    lv.inflowOpen = () => openFraction(R.outlet[0], R.outlet[1], gate.pos.x + lv.gateBase, 0.62);
    lv.drainOpen = () => openFraction(L.DRAIN[0], L.DRAIN[1], plug.pos.x + lv.plugBase, 0.4);

    /* ---------- the pointer ---------- */
    // Light on purpose: bumping into things carries almost no momentum, so only steady force counts.
    const p = world.add(Bodies.circle(L.SPAWN.x, L.SPAWN.y, 0.13, { mass: 0.3, material: MAT.pointer, gravityScale: 0, fixedRotation: true }));
    p.role = 'pointer';
    p.noBuoyancy = true;
    lv.pointer = p;

    lv.setLevel(Wl.floor);
    return lv;
  };

  Nudge.L = L;
  Nudge.G = G;
})(typeof window !== 'undefined' ? window : globalThis);
