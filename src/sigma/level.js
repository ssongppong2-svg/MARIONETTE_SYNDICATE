/*
 * ΣF — the vault room.
 *
 * The mouse is a tow line: a spring (k) that pulls toward the cursor with at
 * most F_MAX. Behind a counterweighted vault door lies the core.
 *
 *   tank ──(main valve, behind glass)──▶ sump: a raft rises with the water
 *   sump overflow ─────────────────────▶ counterweight bucket
 *   header tank ──(needle valve)───────▶ counterweight bucket
 *   deck (rough) ── trap hatch (latch) ─▶ counterweight bucket ── rope ── vault door
 *
 * The door rises once the bucket outweighs it plus the static friction of its
 * guides; a governor locks everything if it rises faster than V_MAX.
 */
(function (root) {
  'use strict';
  const Lab = root.Lab;
  const { Vec2, Bodies, Joints, Fluid, World } = Lab;
  const Sigma = (Lab.Sigma = Lab.Sigma || {});

  const G = 9.8;

  /* Materials: μs, μk, e. Pairs take the smaller value (the smoother surface wins). */
  const MAT = {
    rock: { key: 'rock', name: '암반', mu: 0.5, muk: 0.4, e: 0.05 },
    deck: { key: 'deck', name: '거친 콘크리트', mu: 0.62, muk: 0.48, e: 0.05 },
    slick: { key: 'slick', name: '무마찰 가이드', mu: 0, muk: 0, e: 0 },
    stone: { key: 'stone', name: '화강암', mu: 0.9, muk: 0.8, e: 0.08 },
    wood: { key: 'wood', name: '목재', mu: 0.9, muk: 0.8, e: 0.05 },
    raft: { key: 'raft', name: '발포 목재', mu: 0.55, muk: 0.45, e: 0.05 },
    steel: { key: 'steel', name: '강철', mu: 0.9, muk: 0.8, e: 0.1 },
    lead: { key: 'lead', name: '납', mu: 0.9, muk: 0.8, e: 0.02 },
    pumice: { key: 'pumice', name: '부석', mu: 0.9, muk: 0.8, e: 0.05 },
    glass: { key: 'glass', name: '강화유리', mu: 0.3, muk: 0.25, e: 0.3 },
    core: { key: 'core', name: '세라믹', mu: 0.3, muk: 0.25, e: 0.1 },
    knob: { key: 'knob', name: '손잡이', mu: 0, muk: 0, e: 0 },
  };

  const L = {
    W: 16, H: 8.5,
    DECK: 2.6,
    VIEW: [-0.25, -0.25, 16.25, 8.75],

    TETHER: { k: 600, fMax: 360, zeta: 0.75 },

    SUMP: { x0: 0, x1: 3.0, floor: 0, overflow: 2.5 },
    RAFT: { x: 1.75, w: 2.4, h: 0.6, density: 150 },
    TANK: { x0: 0.25, x1: 3.45, y0: 5.6, y1: 8.3, water: 840 },
    MAIN_Q: 40,            // kg/s through the fully open main valve
    CABINET: { x0: 0, x1: 1.3, y0: 3.4, y1: 4.4, t: 0.08, outlet: [0.45, 0.75] },
    GLASS: { threshold: 900, tau: 0.05 },   // N; assumed contact time (s)

    SHAFT: { x0: 12.2, x1: 13.4 },
    HATCH: { slot: [12.66, 12.74], open: 1.4 },              // rope slot, seconds the flaps stay down
    TRAP: { x: 13.55, travel: 0.3, trip: 0.25, f0: 150, k: 500 }, // spring latch: F = F0 + k·x
    BUCKET: { x: 12.8, top: 2.42, w: 1.08, h: 0.9, t: 0.04, mass: 18, capacity: 60 },
    CRADLE_Y: 1.52,

    HEADER: { x0: 13.5, x1: 14.1, y0: 4.6, y1: 5.0, water: 20 },
    NEEDLE_Q: 1.5,         // kg/s through the fully open needle valve

    DOOR: { x0: 14.4, x1: 14.7, y0: 2.6, y1: 4.0, mass: 120, fs: 54, fk: 36, rise: 1.2, vMax: 0.6 },
    VAULT: { x0: 14.7, x1: 16, y1: 4.0 },
    PULLEY: { a: new Vec2(12.8, 8.1), b: new Vec2(14.55, 8.1), r: 0.1 },
    PIN: { x: 14.0, release: 0.3, friction: 160 },

    SHELF: { x0: 6.0, x1: 9.0, y: 5.0 },
    GOAL_X: 14.2,          // the core counts as retrieved once it is pulled past here
  };

  function solid(world, x0, y0, x1, y1, mat, opts = {}) {
    const b = Bodies.box((x0 + x1) / 2, (y0 + y1) / 2, x1 - x0, y1 - y0, Object.assign({ type: 'static', material: mat }, opts));
    b.surface = mat.key;
    b.matName = mat.name;
    return world.add(b);
  }

  /** A block of given mass and density, w:h = aspect. */
  function block(world, id, name, x, y, mass, density, mat, aspect = 1.4, opts = {}) {
    const area = mass / (density * Lab.DEPTH);
    const w = Math.sqrt(area * aspect), h = area / w;
    const b = world.add(Bodies.box(x, y + h / 2, w, h, Object.assign({ mass, material: mat }, opts)));
    Object.assign(b, { tag: id, kname: name, grab: true, matName: mat.name, size: [w, h] });
    return b;
  }

  Sigma.build = function build() {
    const world = new World({ gravity: new Vec2(0, -G), frictionMix: 'min', velocityIterations: 14, positionIterations: 6 });
    const lv = { world, L, MAT, G };
    const D = L.DECK, S = L.SUMP, C = L.CABINET, SH = L.SHAFT, Dr = L.DOOR, B = L.BUCKET;
    const rock = MAT.rock;

    /* ---------------- rock ---------------- */
    lv.solids = [];
    const add = (...a) => { const b = solid(world, ...a); lv.solids.push(b); return b; };
    add(-0.6, -0.6, 0, 9.1, rock);                       // left wall
    add(16, -0.6, 16.6, 9.1, rock);                      // right wall
    add(-0.6, 8.5, 16.6, 9.1, rock);                     // ceiling
    add(-0.6, -0.6, 16.6, 0, rock);                      // floor
    lv.deck = add(S.x1, 0, SH.x0, D, MAT.deck);          // the long rough deck
    lv.right = add(SH.x1, 0, 16, D, MAT.deck);           // deck beyond the shaft

    // Tank (open top) above the sump.
    const T = L.TANK;
    add(T.x0 - 0.12, T.y0 - 0.12, T.x1 + 0.12, T.y0, rock);
    add(T.x0 - 0.12, T.y0, T.x0, T.y1, rock);
    add(T.x1, T.y0, T.x1 + 0.12, T.y1, rock);

    // Valve cabinet on the left wall: floor with an outlet, ceiling, and a glass front.
    const t = C.t;
    add(C.x0, C.y0, C.outlet[0], C.y0 + t, rock);
    add(C.outlet[1], C.y0, C.x1, C.y0 + t, rock);
    add(C.x0, C.y1 - t, C.x1, C.y1, rock);
    lv.glass = solid(world, C.x1 - 0.07, C.y0 + t, C.x1, C.y1 - t, MAT.glass);
    Object.assign(lv.glass, { role: 'glass', tag: 'GL-A', kname: '강화유리', matName: MAT.glass.name });

    // Spring hatch over the shaft: two flaps either side of the rope slot.
    lv.hatch = [
      solid(world, SH.x0, D - 0.1, L.HATCH.slot[0], D, MAT.deck),
      solid(world, L.HATCH.slot[1], D - 0.1, SH.x1, D, MAT.deck),
    ];
    for (const f of lv.hatch) { f.role = 'hatch'; f.tag = 'H-1'; }

    // Cradle ledges under the bucket, withdrawn by the release pin.
    lv.cradle = [
      solid(world, SH.x0, L.CRADLE_Y - 0.1, B.x - B.w / 2 + 0.1, L.CRADLE_Y, MAT.steel),
      solid(world, B.x + B.w / 2 - 0.1, L.CRADLE_Y - 0.1, SH.x1, L.CRADLE_Y, MAT.steel),
    ];
    for (const c of lv.cradle) c.role = 'cradle';

    // Vault: ceiling, door guides (housing) above it.
    add(Dr.x1, Dr.y1, 16, Dr.y1 + 0.25, rock);
    lv.housing = [
      add(Dr.x0 - 0.12, Dr.y1, Dr.x0, Dr.y1 + 1.8, MAT.slick),
      add(Dr.x1, Dr.y1 + 0.25, Dr.x1 + 0.12, Dr.y1 + 1.8, MAT.slick),
    ];

    // A shelf high over the deck.
    lv.shelf = add(L.SHELF.x0, L.SHELF.y - 0.15, L.SHELF.x1, L.SHELF.y, rock);

    // Header tank (shallow) above the release pin.
    const Hd = L.HEADER;
    add(Hd.x0 - 0.06, Hd.y0 - 0.06, Hd.x1 + 0.06, Hd.y0, rock);
    add(Hd.x0 - 0.06, Hd.y0, Hd.x0, Hd.y1, rock);
    add(Hd.x1, Hd.y0, Hd.x1 + 0.06, Hd.y1, rock);

    // Pulley hubs hanging from the ceiling (static anchors for the rope).
    lv.hubA = solid(world, L.PULLEY.a.x - 0.03, L.PULLEY.a.y - 0.03, L.PULLEY.a.x + 0.03, L.PULLEY.a.y + 0.03, rock, { mask: 0 });
    lv.hubB = solid(world, L.PULLEY.b.x - 0.03, L.PULLEY.b.y - 0.03, L.PULLEY.b.x + 0.03, L.PULLEY.b.y + 0.03, rock, { mask: 0 });
    lv.hubA.shapes[0].category = 0; lv.hubB.shapes[0].category = 0;

    /* ---------------- water ---------------- */
    lv.tankWater = T.water;
    lv.sumpWater = 0;
    lv.headerWater = Hd.water;
    lv.bucketWater = 0;
    lv.spilled = 0;                      // water lost over the bucket rim
    lv.sumpFluid = world.addFluid(new Fluid({ x0: S.x0, x1: S.x1, y0: S.floor, surface: S.floor, linearDrag: 1.2, angularDrag: 2.5 }));
    lv.sumpLevel = () => S.floor + lv.sumpWater / ((S.x1 - S.x0) * 100);   // 1 m² of section = 100 kg

    /* ---------------- movable things ---------------- */
    lv.items = [];
    const item = (...a) => { const b = block(world, ...a); lv.items.push(b); return b; };

    // Raft on the sump floor, the crate on it.
    const R = L.RAFT;
    lv.raft = world.add(Bodies.box(R.x, R.h / 2, R.w, R.h, { density: R.density, material: MAT.raft, angularDamping: 1.5 }));
    Object.assign(lv.raft, { tag: 'RF-1', kname: '부유 뗏목', grab: true, matName: MAT.raft.name, size: [R.w, R.h] });
    lv.items.push(lv.raft);
    lv.crate = item('K-64', '화물 상자', R.x, R.h, 64, 1100, MAT.wood, 1.0, { angularDamping: 0.6 });

    // Stones. Two read "—": out of the sensors' range until weighed.
    lv.stones = [
      item('S-1', '화강암', 0.7, L.CABINET.y1, 6.4, 2650, MAT.stone),
      item('S-2', '화강암', 5.6, D, 8.7, 2650, MAT.stone),
      item('S-3', '화강암', 6.5, L.SHELF.y, 11.2, 2650, MAT.stone),
      item('S-4', '화강암', 9.7, D, 13.9, 2650, MAT.stone),
      item('S-5', '화강암', 15.3, L.DOOR.y1 + 0.25, 16.3, 2650, MAT.stone),
      item('S-6', '화강암', 11.3, D, 19.6, 2650, MAT.stone),
      item('S-7', '화강암', 7.15, L.SHELF.y, 24.1, 2650, MAT.stone),
      item('S-8', '화강암', 7.85, L.SHELF.y, 29.8, 2650, MAT.stone),
    ];
    lv.lead = item('L-1', '납 블록', 8.6, L.SHELF.y, 34.5, 11340, MAT.lead, 1.2);
    lv.pumice = item('P-1', '부석', 4.4, D, 7.8, 640, MAT.pumice, 1.3);
    lv.steel = item('B-90', '강철 블록', 0.25, 0, 90, 7850, MAT.steel, 1.6);

    /* ---------------- valves and the pin (knobs on braked rails) ---------------- */
    // Handles live on the wall, in front of everything: they never collide.
    const knob = (id, name, x, y, w, h, opts) => {
      const k = world.add(Bodies.box(x, y, w, h, Object.assign({ mass: 2, material: MAT.knob, gravityScale: 0, category: 0, mask: 0 }, opts)));
      Object.assign(k, { tag: id, kname: name, grab: true, matName: '밸브 손잡이', isKnob: true, size: [w, h] });
      return k;
    };
    // Main valve: a plate over the cabinet outlet with a handle standing on it.
    const ov = C.outlet, oc = (ov[0] + ov[1]) / 2;
    lv.mainValve = world.add(Bodies.compound([
      { kind: 'box', x: oc, y: C.y0 + t + 0.03, w: 0.4, h: 0.06 },
      { kind: 'box', x: oc, y: C.y0 + t + 0.06 + 0.17, w: 0.07, h: 0.34 },
    ], { mass: 4, material: MAT.knob, gravityScale: 0, category: 0, mask: 0 }));
    Object.assign(lv.mainValve, { tag: 'V-1', kname: '주 밸브', grab: true, matName: '밸브 손잡이', isKnob: true, size: [0.4, 0.4] });
    lv.mainValveBase = oc - lv.mainValve.pos.x;
    lv.mainRail = world.addJoint(new Joints.SliderJoint(lv.solids[0], lv.mainValve, lv.mainValve.pos, new Vec2(1, 0),
      { lower: 0, upper: 0.38, motor: { enabled: true, speed: 0, maxForce: 220 } }));
    lv.mainValve.friction = 220;

    // Needle valve under the header tank.
    lv.needle = knob('V-2', '니들 밸브', Hd.x0 + 0.1, Hd.y0 - 0.26, 0.07, 0.3);
    lv.needleRail = world.addJoint(new Joints.SliderJoint(lv.solids[1], lv.needle, lv.needle.pos, new Vec2(1, 0),
      { lower: 0, upper: 0.4, motor: { enabled: true, speed: 0, maxForce: 60 } }));
    lv.needle.friction = 60;
    lv.needleOrigin = lv.needle.pos.x;

    // Trap lever: a spring latch that drops the hatch flaps.
    lv.trap = knob('T-1', '트랩 레버', L.TRAP.x, D + 0.25, 0.07, 0.5);
    lv.trapRail = world.addJoint(new Joints.SliderJoint(lv.solids[1], lv.trap, lv.trap.pos, new Vec2(1, 0),
      { lower: 0, upper: L.TRAP.travel }));
    lv.trapOrigin = lv.trap.pos.x;
    lv.trapTravel = () => lv.trap.pos.x - lv.trapOrigin;

    // Release pin standing out of the deck beyond the shaft.
    lv.pin = knob('PIN', '해제 핀', L.PIN.x, D + 0.2, 0.08, 0.4);
    lv.pinRail = world.addJoint(new Joints.SliderJoint(lv.solids[1], lv.pin, lv.pin.pos, new Vec2(1, 0),
      { lower: 0, upper: 0.35, motor: { enabled: true, speed: 0, maxForce: L.PIN.friction } }));
    lv.pin.friction = L.PIN.friction;
    lv.pinOrigin = lv.pin.pos.x;

    /* ---------------- counterweight bucket and the vault door ---------------- */
    const bx = B.x, btop = B.top, bw = B.w, bh = B.h, bt = B.t;
    lv.bucket = world.add(Bodies.compound([
      { kind: 'box', x: bx, y: btop - bh + bt / 2, w: bw, h: bt },
      { kind: 'box', x: bx - bw / 2 + bt / 2, y: btop - bh / 2, w: bt, h: bh },
      { kind: 'box', x: bx + bw / 2 - bt / 2, y: btop - bh / 2, w: bt, h: bh },
    ], { mass: B.mass, material: MAT.steel, angularDamping: 4 }));
    Object.assign(lv.bucket, { role: 'bucket', tag: 'CW', kname: '평형추 버킷', matName: MAT.steel.name });
    lv.bucketBottom = btop - bh;            // world y of the inner floor at rest (minus wall)
    lv.bucketLocal = {
      handle: lv.bucket.localPoint(new Vec2(bx, btop + 0.06)),
      floor: lv.bucket.localPoint(new Vec2(bx, btop - bh + bt)),
      left: lv.bucket.localPoint(new Vec2(bx - bw / 2 + bt, btop)),
      right: lv.bucket.localPoint(new Vec2(bx + bw / 2 - bt, btop)),
    };
    // Keep the bucket hanging straight in its shaft.
    lv.bucketRail = world.addJoint(new Joints.SliderJoint(lv.solids[3], lv.bucket, lv.bucket.pos, new Vec2(0, 1), {}));

    lv.door = world.add(Bodies.box((Dr.x0 + Dr.x1) / 2, (Dr.y0 + Dr.y1) / 2, Dr.x1 - Dr.x0, Dr.y1 - Dr.y0, { mass: Dr.mass, material: MAT.slick }));
    Object.assign(lv.door, { role: 'door', tag: 'D-1', kname: '금고문', matName: MAT.steel.name });
    lv.doorRail = world.addJoint(new Joints.SliderJoint(lv.solids[3], lv.door, lv.door.pos, new Vec2(0, 1),
      { lower: 0, upper: Dr.rise, motor: { enabled: true, speed: 0, maxForce: Dr.fs } }));

    const P = L.PULLEY;
    lv.rope = world.addJoint(new Joints.RopePath([
      { body: lv.door, point: new Vec2(P.b.x + P.r, Dr.y1) },
      { body: lv.hubB, point: P.b.clone(), radius: -P.r },
      { body: lv.hubA, point: P.a.clone(), radius: -P.r },
      { body: lv.bucket, point: new Vec2(bx - P.r, btop + 0.06) },
    ], { length: undefined }));
    lv.rope.tensionTau = 0.08;

    /* ---------------- the core ---------------- */
    lv.core = world.add(Bodies.box(15.45, D + 0.11, 0.22, 0.22, { mass: 0.9, material: MAT.core }));
    Object.assign(lv.core, { tag: 'C-0', kname: '코어', grab: true, matName: MAT.core.name, size: [0.22, 0.22] });
    lv.items.push(lv.core);

    /** Uncovered fraction of an interval [a, b] by a plate spanning [c − w/2, c + w/2]. */
    lv.openFraction = (a, b, c, w) => {
      const lo = Math.max(a, c - w / 2), hi = Math.min(b, c + w / 2);
      return 1 - Math.max(0, hi - lo) / (b - a);
    };
    lv.mainOpen = () => lv.openFraction(ov[0], ov[1], lv.mainValve.pos.x + lv.mainValveBase, 0.4);
    lv.needleOpen = () => Math.max(0, Math.min(1, (lv.needle.pos.x - lv.needleOrigin - 0.04) / 0.32));
    lv.pinTravel = () => lv.pin.pos.x - lv.pinOrigin;
    lv.doorRise = () => lv.doorRail.translation;

    return lv;
  };

  Sigma.L = L;
  Sigma.MAT = MAT;
  Sigma.G = G;
})(typeof window !== 'undefined' ? window : globalThis);
