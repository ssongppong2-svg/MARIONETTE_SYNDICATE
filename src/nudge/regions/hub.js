/*
 * Nudge — the hub: a hall around the Primordial Door (태초의 문). Six sockets
 * wait for the six fragments; passages lead out to the regions.
 */
(function (root) {
  'use strict';
  const Lab = root.Lab;
  const { Vec2 } = Lab;
  const Nudge = (Lab.Nudge = Lab.Nudge || {});
  Nudge.regions = Nudge.regions || {};

  Nudge.regions.hub = function hub(game, R) {
    const k = Nudge.kit;
    R.name = '태초의 문';
    R.palette = 'hub';
    R.bounds = [-12, -1, 12, 15];
    k.solid(game, -12, -3, 12, 0);      // floor
    k.solid(game, -12, 14, 12, 17);     // ceiling
    k.solid(game, -13, 3, -12, 17);     // left wall, above the passage to the cliffs
    k.solid(game, 12, 3, 13, 17);       // right wall, above the passage to the plain
    game.checkpointAt('start', 0, 2.2, '태초의 문');
    R.door = { c: new Vec2(0, 7.6), r: 3.4 };
    // Passages that will open in later chapters (sealed for now).
    R.seals = [
      { id: 'buoyancy', name: '잠긴 바다', x: -7.5, y: 0, side: 'floor' },
      { id: 'under', name: '지하세계', x: 0, y: 0, side: 'floor' },
      { id: 'elastic', name: '탄성 공방', x: 7.5, y: 0, side: 'floor' },
      { id: 'brother', name: '빅 브라더', x: 0, y: 14, side: 'ceiling' },
    ];
    R.exits = [
      { id: 'gravity', name: '낙하의 절벽', x: -12, y: 1.5, dir: -1 },
      { id: 'friction', name: '서리 평원', x: 12, y: 1.5, dir: 1 },
    ];
  };
})(typeof window !== 'undefined' ? window : globalThis);
