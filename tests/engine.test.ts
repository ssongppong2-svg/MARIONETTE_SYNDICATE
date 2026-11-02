import { describe, expect, it } from 'vitest';
import {
  CARD_POOL, CARDS, COURT_EVENT_EVERY, DECK_COPIES, HAND_LIMIT, INCOME_PER_SERF, MARKET_PRICE, MARKET_SIZE,
  MAX_TURNS_EACH, PIECES, RESTOCK_EVERY,
} from '../src/shared/data';
import { apply, createRound, eventsFor, timeout } from '../src/shared/engine';
import { josa } from '../src/shared/korean';
import { bribeOptions, execRange, execTargets, reachable, snipeTargets } from '../src/shared/rules';
import type { Action, CardId, Faction, GameState } from '../src/shared/types';
import { viewFor } from '../src/shared/view';

/* ── 도우미 ─────────────────────────────────────── */
/** 판을 만들고 두 사람 모두 기본 배치로 시작한다 */
function fresh(seed = 7, first: Faction = 'blue'): GameState {
  const s = createRound({ seed, round: 1, first }).state;
  timeout(s);
  return s;
}
function idOf(s: GameState, f: Faction, type: string, n = 0): string {
  return Object.values(s.pieces).filter((p) => p.owner === f && p.type === type)[n].id;
}
/** 판 위를 비우고 원하는 기물만 원하는 칸에 둔다. 같은 기물이 두 번 나오면 먼저 쓴 자리를 따른다. */
function clearBoard(s: GameState, keep: [string, number, number][]) {
  for (const p of Object.values(s.pieces)) { p.r = -10; p.c = -10; p.alive = false; }
  const placed = new Set<string>();
  for (const [id, r, c] of keep) {
    if (placed.has(id)) continue;
    placed.add(id);
    Object.assign(s.pieces[id], { r, c, alive: true });
  }
}
function act(s: GameState, a: Action) {
  const res = apply(s, a);
  if (res.error) throw new Error(`${a.kind}: ${res.error}`);
  return res;
}
function mustFail(s: GameState, a: Action) {
  const res = apply(s, a);
  expect(res.error).toBeTruthy();
  return res.error!;
}
function endTurn(s: GameState) { return act(s, { kind: 'end' }); }
function giveCard(s: GameState, f: Faction, card: CardId, ruren = 20) {
  s.players[f].hand = [card];
  s.players[f].ruren = ruren;
}

/* ── 판 시작 ─────────────────────────────────────── */
describe('판 시작', () => {
  it('진영마다 궁정 6 + 농노 4, 지령은 궁정 기물만', () => {
    const s = fresh();
    for (const f of ['blue', 'red'] as Faction[]) {
      const mine = Object.values(s.pieces).filter((p) => p.owner === f);
      expect(mine).toHaveLength(10);
      expect(mine.filter((p) => p.type === 'serf')).toHaveLength(4);
      expect(PIECES[s.pieces[s.orders[f].vip].type].court).toBe(true);
      expect(s.pieces[s.orders[f].vip].owner).toBe(f);
      expect(PIECES[s.pieces[s.orders[f].target].type].court).toBe(true);
      expect(s.pieces[s.orders[f].target].owner).not.toBe(f);
    }
  });

  it('손패 5장, 암살 후 변경은 항상 들어 있고 겹치지 않는다', () => {
    for (let seed = 1; seed < 30; seed++) {
      const s = fresh(seed);
      for (const f of ['blue', 'red'] as Faction[]) {
        const hand = s.players[f].hand;
        expect(hand).toHaveLength(5);
        expect(hand[0]).toBe('switch');
        expect(new Set(hand).size).toBe(5);
        expect(hand.slice(1).every((c) => CARD_POOL.includes(c))).toBe(true);
      }
    }
  });

  it('첫 차례에 농노 수 × 2 루렌과 AP 3을 받는다', () => {
    const s = fresh();
    expect(s.players.blue.ruren).toBe(4 * INCOME_PER_SERF);
    expect(s.ap).toBe(3);
    expect(s.players.red.ruren).toBe(0);
  });

  it('배치 단계로 시작하고, 두 사람이 모두 마치면 첫 차례가 열린다', () => {
    const { state: s } = createRound({ seed: 5, round: 1, first: 'red' });
    expect(s.phase).toBe('deploy');
    const blue = viewFor(s, 'blue');
    expect(blue.pieces.every((p) => p.owner === 'blue')).toBe(true);
    expect(blue.me.targetType).toBe(s.pieces[s.orders.blue.target].type);
    const mine = (f: Faction) => Object.values(s.pieces).filter((p) => p.owner === f);
    // 청: 군주와 첫 농노의 자리를 바꾼다
    const layout = Object.fromEntries(mine('blue').map((p) => [p.id, { r: p.r, c: p.c }]));
    const lord = mine('blue').find((p) => p.type === 'lord')!;
    const serf = mine('blue').find((p) => p.type === 'serf')!;
    [layout[lord.id], layout[serf.id]] = [layout[serf.id], layout[lord.id]];
    expect(apply(s, { kind: 'deploy', layout: { ...layout, [lord.id]: { r: 5, c: 5 } } }, 'blue').error).toContain('진영');
    expect(apply(s, { kind: 'deploy', layout }, 'blue').error).toBeNull();
    expect(s.pieces[lord.id].r).toBe(1);
    expect(apply(s, { kind: 'move', piece: lord.id, to: { r: 2, c: lord.c } }, 'blue').error).toContain('배치');
    expect(apply(s, { kind: 'deploy', layout }, 'blue').error).toContain('이미');
    const redLayout = Object.fromEntries(mine('red').map((p) => [p.id, { r: p.r, c: p.c }]));
    const res = apply(s, { kind: 'deploy', layout: redLayout }, 'red');
    expect(res.error).toBeNull();
    expect(s.phase).toBe('play');
    expect(res.out.some((e) => e.ev.type === 'reveal')).toBe(true);
    expect(s.current).toBe('red');
    expect(viewFor(s, 'blue').pieces).toHaveLength(20);
  });

  it('같은 seed면 같은 판이 나온다', () => {
    expect(fresh(42)).toEqual(fresh(42));
    expect(fresh(42).orders).not.toEqual(fresh(43).orders);
  });
});

/* ── 정보 가리기 ─────────────────────────────────── */
describe('화면용 상태는 상대의 비밀을 담지 않는다', () => {
  it('상대의 지령, 손패, 비밀 상태가 없다', () => {
    const s = fresh();
    s.pieces[idOf(s, 'blue', 'archer')].oath = true;
    const red = viewFor(s, 'red');
    const json = JSON.stringify(red);
    expect(red.me.orders).toEqual(s.orders.red);
    expect(json).not.toContain('"vip":"' + s.orders.blue.vip + '"');
    expect(red.opponent).not.toHaveProperty('hand');
    expect(red.opponent.handCount).toBe(5);
    const blueArcher = red.pieces.find((p) => p.id === idOf(s, 'blue', 'archer'))!;
    expect(blueArcher.oath).toBeUndefined();
    expect(red.revealedOrders).toBeNull();
  });

  it('처형한 기물은 상대에게 알려지지 않는다', () => {
    const s = fresh();
    const archer = idOf(s, 'blue', 'archer');
    const victim = idOf(s, 'red', 'serf');
    clearBoard(s, [[archer, 5, 5], [victim, 5, 7], [s.orders.blue.vip, 0, 0], [s.orders.red.vip, 9, 9]]);
    const res = act(s, { kind: 'execute', piece: archer, target: victim });
    const redAttack = eventsFor(res.out, 'red').find((e) => e.type === 'attack');
    const blueAttack = eventsFor(res.out, 'blue').find((e) => e.type === 'attack');
    expect(redAttack).toMatchObject({ attacker: null, target: victim });
    expect(blueAttack).toMatchObject({ attacker: archer, target: victim });
  });
});

/* ── 이동과 처형 ─────────────────────────────────── */
describe('이동과 처형', () => {
  it('성기사는 직선 두 칸, 막히면 멈춘다', () => {
    const s = fresh();
    const pal = idOf(s, 'blue', 'paladin');
    const blocker = idOf(s, 'red', 'serf');
    clearBoard(s, [[pal, 4, 4], [blocker, 4, 5]]);
    const cells = reachable(viewFor(s, 'blue'), pal).map((c) => `${c.r},${c.c}`).sort();
    expect(cells).toEqual(['2,4', '3,4', '4,2', '4,3', '5,4', '6,4'].sort());
  });

  it('자객은 대각선 세 칸, 처형 사거리 2', () => {
    const s = fresh();
    const a = idOf(s, 'blue', 'assassin');
    const far = idOf(s, 'red', 'serf', 0);
    const near = idOf(s, 'red', 'serf', 1);
    clearBoard(s, [[a, 4, 4], [far, 4, 7], [near, 6, 6]]);
    const v = viewFor(s, 'blue');
    expect(reachable(v, a)).toHaveLength(10); // 6,6에 막혀 한 갈래는 한 칸뿐
    expect(execTargets(v, a)).toEqual([near]);
  });

  it('처형하면 AP가 줄고, 궁정 신문이 나오며 범인은 밝히지 않는다', () => {
    const s = fresh();
    const archer = idOf(s, 'blue', 'archer');
    const victim = idOf(s, 'red', 'paladin');
    clearBoard(s, [[archer, 5, 5], [victim, 7, 7], [s.orders.blue.vip, 0, 0], [s.orders.red.vip, 9, 9]]);
    if (s.orders.red.vip === victim) s.orders.red.vip = idOf(s, 'red', 'lord');
    s.pieces[s.orders.red.vip].alive = true;
    act(s, { kind: 'execute', piece: archer, target: victim });
    expect(s.pieces[victim].alive).toBe(false);
    expect(s.ap).toBe(2);
    const news = s.chronicle.at(-1)!;
    expect(news.title).toBe('전사 보도');
    expect(news.body).toMatch(/성기사(가|의)/);
    expect(news.body).not.toContain('궁수');
  });

  it('사거리 밖, 내 차례가 아님, AP 부족은 거절한다', () => {
    const s = fresh();
    const archer = idOf(s, 'blue', 'archer');
    const victim = idOf(s, 'red', 'serf');
    clearBoard(s, [[archer, 0, 0], [victim, 9, 9]]);
    expect(mustFail(s, { kind: 'execute', piece: archer, target: victim })).toContain('사거리');
    s.current = 'red';
    expect(mustFail(s, { kind: 'move', piece: archer, to: { r: 1, c: 0 } })).toContain('내 기물');
    s.current = 'blue';
    s.ap = 0;
    expect(mustFail(s, { kind: 'move', piece: archer, to: { r: 1, c: 0 } })).toContain('AP');
  });
});

/* ── 이중 승리 ───────────────────────────────────── */
describe('이중 승리 조건', () => {
  function duel() {
    const s = fresh(3);
    const archer = idOf(s, 'blue', 'archer');
    const tgt = s.orders.blue.target;
    let vip = s.orders.red.vip;
    if (vip === tgt) {
      s.orders.red.vip = Object.values(s.pieces).find((p) => p.owner === 'red' && PIECES[p.type].court && p.id !== tgt)!.id;
      vip = s.orders.red.vip;
    }
    clearBoard(s, [[archer, 5, 5], [tgt, 5, 7], [vip, 7, 5], [s.orders.blue.vip, 0, 0]]);
    return { s, archer, tgt, vip };
  }

  it('타겟만으로는 끝나지 않고, VIP까지 처형하면 즉시 이긴다', () => {
    const { s, archer, tgt, vip } = duel();
    act(s, { kind: 'execute', piece: archer, target: tgt });
    expect(s.players.blue.targetDone).toBe(true);
    expect(s.winner).toBeNull();
    const res = act(s, { kind: 'execute', piece: archer, target: vip });
    expect(s.winner).toBe('blue');
    const end = res.out.find((e) => e.ev.type === 'round_end');
    expect(end?.vis).toBe('all');
    expect(viewFor(s, 'red').revealedOrders).toEqual(s.orders);
    expect(s.chronicle.at(-1)!.title).toBe('암살 확인');
    expect(s.revealedVips).toContain(vip);
  });

  it('VIP만으로도 끝나지 않는다', () => {
    const { s, archer, vip } = duel();
    act(s, { kind: 'execute', piece: archer, target: vip });
    expect(s.players.blue.vipDone).toBe(true);
    expect(s.winner).toBeNull();
    expect(viewFor(s, 'blue').me.vipState).toBe('done');
  });
});

/* ── 매수 ─────────────────────────────────────────── */
describe('매수', () => {
  function setup() {
    const s = fresh(11);
    const spy = idOf(s, 'blue', 'spy');
    const serf = idOf(s, 'red', 'serf');
    const lord = idOf(s, 'red', 'lord');
    clearBoard(s, [[spy, 5, 5], [serf, 5, 6], [lord, 6, 5], [s.orders.red.vip, 4, 4], [s.orders.blue.vip, 0, 0]]);
    s.players.blue.ruren = 20;
    return { s, spy, serf, lord };
  }

  it('4번째 차례 전에는 할 수 없다', () => {
    const { s, spy, serf } = setup();
    expect(mustFail(s, { kind: 'bribe', piece: spy, target: serf })).toContain('4번째');
  });

  it('첩자는 할인받고, 매수된 기물은 내 편이 된다', () => {
    const { s, spy, serf } = setup();
    s.players.blue.turnsTaken = 3;
    const opt = bribeOptions(viewFor(s, 'blue'), spy).find((o) => o.id === serf)!;
    expect(opt.cost).toBe(2);
    act(s, { kind: 'bribe', piece: spy, target: serf });
    expect(s.pieces[serf].owner).toBe('blue');
    expect(s.pieces[serf].origin).toBe('red');
    expect(s.players.blue.ruren).toBe(18);
    expect(s.chronicle.at(-1)!.title).toBe('변절');
  });

  it('군주는 후보에도 없다', () => {
    const { s, spy, lord } = setup();
    s.players.blue.turnsTaken = 3;
    expect(bribeOptions(viewFor(s, 'blue'), spy).map((o) => o.id)).not.toContain(lord);
    expect(mustFail(s, { kind: 'bribe', piece: spy, target: lord })).toContain('군주');
  });

  it('VIP는 매수되지 않고, 시도하면 VIP가 노출된다 (루렌은 남는다)', () => {
    const { s, spy } = setup();
    s.players.blue.turnsTaken = 3;
    const vip = s.orders.red.vip;
    const res = act(s, { kind: 'bribe', piece: spy, target: vip });
    expect(s.pieces[vip].owner).toBe('red');
    expect(s.players.blue.ruren).toBe(20);
    expect(s.ap).toBe(2);
    expect(s.players.red.exposed).toBe(true);
    expect(eventsFor(res.out, 'red').some((e) => e.type === 'exposed')).toBe(true);
    expect(eventsFor(res.out, 'blue').some((e) => e.type === 'exposed')).toBe(false);
  });

  it('충성 서약을 한 기물은 매수되지 않고, VIP인지도 드러나지 않는다', () => {
    const { s, spy } = setup();
    s.players.blue.turnsTaken = 3;
    const vip = s.orders.red.vip;
    s.pieces[vip].oath = true;
    const res = act(s, { kind: 'bribe', piece: spy, target: vip });
    expect(res.out.find((e) => e.ev.type === 'bribe')!.ev).toMatchObject({ result: 'oath' });
    expect(s.players.red.exposed).toBe(false);
  });

  it('내 타겟을 매수하면 포섭으로 조건을 이룬다', () => {
    const { s, spy } = setup();
    s.players.blue.turnsTaken = 3;
    const tgt = s.orders.blue.target === s.orders.red.vip
      ? (s.orders.blue.target = idOf(s, 'red', 'paladin'))
      : s.orders.blue.target;
    clearBoard(s, [[spy, 5, 5], [tgt, 5, 6], [s.orders.red.vip, 0, 9], [s.orders.blue.vip, 0, 0]]);
    act(s, { kind: 'bribe', piece: spy, target: tgt });
    expect(s.players.blue.targetDone).toBe(true);
  });
});

/* ── 기물 능력 ───────────────────────────────────── */
describe('기물 능력', () => {
  it('왕가의 지휘: 주변 적은 다음 차례에 못 움직이고, 성기사는 사거리 +1', () => {
    const s = fresh();
    const lord = idOf(s, 'blue', 'lord');
    const pal = idOf(s, 'blue', 'paladin');
    const enemy = idOf(s, 'red', 'archer');
    clearBoard(s, [[lord, 5, 5], [pal, 5, 4], [enemy, 6, 6], [s.orders.red.vip, 9, 9], [s.orders.blue.vip, 0, 0]]);
    act(s, { kind: 'royal', piece: lord });
    expect(s.ap).toBe(1);
    endTurn(s);
    const rv = viewFor(s, 'red');
    expect(rv.pieces.find((p) => p.id === enemy)!.rooted).toBe(true);
    expect(mustFail(s, { kind: 'move', piece: enemy, to: { r: 7, c: 6 } })).toContain('묶여');
    endTurn(s);
    const bv = viewFor(s, 'blue');
    expect(bv.pieces.find((p) => p.id === pal)!.buffed).toBe(true);
    expect(bv.pieces.find((p) => p.id === enemy)!.rooted).toBe(false);
  });

  it('심문: 붙어 있는 VIP를 캐내면 상대에게 노출 알림', () => {
    const s = fresh(5);
    const spy = idOf(s, 'blue', 'spy');
    const vip = s.orders.red.vip;
    clearBoard(s, [[spy, 5, 5], [vip, 5, 6], [s.orders.blue.vip, 0, 0]]);
    const res = act(s, { kind: 'interrogate', piece: spy, target: vip });
    expect(s.players.blue.intel.at(-1)).toMatchObject({ kind: 'interrogate', result: true });
    expect(s.players.red.exposed).toBe(true);
    expect(eventsFor(res.out, 'red').find((e) => e.type === 'intel')).toBeUndefined();
  });

  it('위조 서신에 걸리면 심문 결과가 뒤집히고 노출되지 않는다', () => {
    const s = fresh(5);
    const spy = idOf(s, 'blue', 'spy');
    const vip = s.orders.red.vip;
    clearBoard(s, [[spy, 5, 5], [vip, 5, 6], [s.orders.blue.vip, 0, 0]]);
    s.players.blue.forged = true;
    act(s, { kind: 'interrogate', piece: spy, target: vip });
    expect(s.players.blue.intel.at(-1)!.result).toBe(false);
    expect(s.players.red.exposed).toBe(false);
    expect(s.players.blue.forged).toBe(false);
  });

  it('축복은 처형을 한 번 막는다', () => {
    const s = fresh();
    const priest = idOf(s, 'blue', 'priest');
    const ally = idOf(s, 'blue', 'serf');
    const archer = idOf(s, 'red', 'archer');
    clearBoard(s, [[priest, 5, 5], [ally, 5, 6], [archer, 7, 6], [s.orders.red.vip, 9, 9], [s.orders.blue.vip, 0, 0]]);
    act(s, { kind: 'bless', piece: priest, target: ally });
    endTurn(s);
    act(s, { kind: 'execute', piece: archer, target: ally });
    expect(s.pieces[ally].alive).toBe(true);
    expect(s.chronicle.at(-1)!.title).toBe('빗나간 칼날');
    act(s, { kind: 'execute', piece: archer, target: ally });
    expect(s.pieces[ally].alive).toBe(false);
  });
});

/* ── 카드 ─────────────────────────────────────────── */
describe('카드', () => {
  it('비밀 카드는 상대에게 이름이 보이지 않는다', () => {
    const s = fresh();
    giveCard(s, 'blue', 'censor');
    const res = act(s, { kind: 'card', card: 'censor' });
    expect(eventsFor(res.out, 'red').find((e) => e.type === 'card')).toMatchObject({ card: null });
    expect(eventsFor(res.out, 'blue').find((e) => e.type === 'card')).toMatchObject({ card: 'censor' });
    expect(s.players.blue.ruren).toBe(20 - CARDS.censor.cost);
  });

  it('차례마다 한 장, 루렌이 모자라면 못 쓴다', () => {
    const s = fresh();
    s.players.blue.hand = ['tax', 'famine'];
    s.players.blue.ruren = 4;
    expect(mustFail(s, { kind: 'card', card: 'famine' })).toContain('루렌');
    act(s, { kind: 'card', card: 'tax' });
    expect(s.players.blue.ruren).toBe(4 + 4 * 3);
    expect(mustFail(s, { kind: 'card', card: 'famine' })).toContain('한 장');
  });

  it('암살 후 변경: 노출되어야 쓸 수 있고, VIP를 희생시켜 새 VIP를 받는다', () => {
    const s = fresh(9);
    giveCard(s, 'blue', 'switch');
    expect(mustFail(s, { kind: 'card', card: 'switch' })).toContain('노출');
    s.players.blue.exposed = true;
    const old = s.orders.blue.vip;
    s.orders.red.target = old;
    const res = act(s, { kind: 'card', card: 'switch' });
    expect(s.pieces[old].alive).toBe(false);
    expect(s.orders.blue.vip).not.toBe(old);
    expect(s.pieces[s.orders.blue.vip].alive).toBe(true);
    expect(s.players.blue.exposed).toBe(false);
    expect(s.players.red.vipDone).toBe(false);
    expect(s.orders.red.target).not.toBe(old);
    expect(eventsFor(res.out, 'red').some((e) => e.type === 'target_changed')).toBe(true);
    expect(eventsFor(res.out, 'red').some((e) => e.type === 'vip_changed')).toBe(false);
    expect(s.chronicle.at(-1)!.title).toBe('숙청');
  });

  it('검열: VIP가 처형돼도 상대는 확신할 수 없다 (그래도 조건은 이룬다)', () => {
    const s = fresh(4);
    const archer = idOf(s, 'blue', 'archer');
    const vip = s.orders.red.vip;
    clearBoard(s, [[archer, 5, 5], [vip, 5, 7], [s.orders.blue.vip, 0, 0]]);
    s.players.red.censor = true;
    const res = act(s, { kind: 'execute', piece: archer, target: vip });
    expect(s.players.blue.vipDone).toBe(true);
    expect(viewFor(s, 'blue').me.vipState).toBe('unknown');
    expect(eventsFor(res.out, 'blue').some((e) => e.type === 'vip_revealed')).toBe(false);
    expect(s.chronicle.at(-1)!.censored).toBe(true);
    expect(s.revealedVips).not.toContain(vip);
  });

  it('독배: 상대의 다음 차례가 끝날 때 죽고, 축복하면 풀린다', () => {
    const s = fresh(2);
    const serf = idOf(s, 'blue', 'serf');
    const victim = idOf(s, 'red', 'archer');
    const other2 = idOf(s, 'red', 'spy');
    const priest = idOf(s, 'red', 'priest');
    clearBoard(s, [[serf, 5, 5], [victim, 5, 6], [other2, 4, 4], [priest, 8, 8], [s.orders.red.vip, 9, 9], [s.orders.blue.vip, 0, 0]]);
    giveCard(s, 'blue', 'poison');
    act(s, { kind: 'card', card: 'poison', pieces: [victim] });
    endTurn(s);
    expect(s.pieces[victim].alive).toBe(true);
    endTurn(s);
    expect(s.pieces[victim].alive).toBe(false);
    expect(s.graveyard.at(-1)!.cause).toBe('poison');

    // 축복으로 해독
    const t = fresh(2);
    clearBoard(t, [[serf, 5, 5], [other2, 5, 6], [priest, 5, 7], [t.orders.red.vip, 9, 9], [t.orders.blue.vip, 0, 0]]);
    giveCard(t, 'blue', 'poison');
    act(t, { kind: 'card', card: 'poison', pieces: [other2] });
    endTurn(t);
    act(t, { kind: 'bless', piece: priest, target: other2 });
    endTurn(t);
    expect(t.pieces[other2].alive).toBe(true);
  });

  it('대역: 처형되면 붙어 있는 농노가 대신 죽는다', () => {
    const s = fresh(6);
    const archer = idOf(s, 'blue', 'archer');
    const pal = idOf(s, 'red', 'paladin');
    const serf = idOf(s, 'red', 'serf');
    clearBoard(s, [[archer, 5, 5], [pal, 5, 7], [serf, 5, 8], [s.orders.red.vip, 9, 9], [s.orders.blue.vip, 0, 0]]);
    s.pieces[pal].double = true;
    act(s, { kind: 'execute', piece: archer, target: pal });
    expect(s.pieces[pal].alive).toBe(true);
    expect(s.pieces[serf].alive).toBe(false);
    expect(s.pieces[pal].double).toBe(false);
  });

  it('흉년, 통금령, 징집령, 은화, 그림자 걸음, 봉인된 칙령, 밀정의 보고', () => {
    const s = fresh(8);
    giveCard(s, 'blue', 'famine');
    act(s, { kind: 'card', card: 'famine' });
    endTurn(s);
    expect(s.players.red.lastIncome).toBe(0);
    endTurn(s);

    giveCard(s, 'blue', 'curfew');
    act(s, { kind: 'card', card: 'curfew' });
    endTurn(s);
    expect(s.ap).toBe(2);
    endTurn(s);

    const serf = idOf(s, 'blue', 'serf');
    giveCard(s, 'blue', 'conscript');
    act(s, { kind: 'card', card: 'conscript', pieces: [serf] });
    expect(s.pieces[serf].militia).toBe(true);
    endTurn(s); endTurn(s);
    expect(s.players.blue.lastIncome).toBe(3 * INCOME_PER_SERF);

    s.players.blue.turnsTaken = 3;
    giveCard(s, 'blue', 'silver');
    act(s, { kind: 'card', card: 'silver' });
    expect(viewFor(s, 'blue').me.silverActive).toBe(true);
    endTurn(s); endTurn(s);

    const asn = idOf(s, 'blue', 'assassin');
    giveCard(s, 'blue', 'shadow');
    const from = { r: s.pieces[asn].r, c: s.pieces[asn].c };
    act(s, { kind: 'card', card: 'shadow', pieces: [asn], cell: { r: from.r + 4, c: from.c } });
    expect(s.pieces[asn].r).toBe(from.r + 4);
    endTurn(s); endTurn(s);

    const before = s.orders.blue.target;
    giveCard(s, 'blue', 'decree');
    act(s, { kind: 'card', card: 'decree' });
    expect(s.orders.blue.target).not.toBe(before);
    endTurn(s); endTurn(s);

    giveCard(s, 'blue', 'report');
    const three = Object.values(s.pieces).filter((p) => p.owner === 'red' && p.alive).slice(0, 3).map((p) => p.id);
    act(s, { kind: 'card', card: 'report', pieces: three });
    expect(s.players.blue.intel.at(-1)).toMatchObject({ kind: 'report', result: three.includes(s.orders.red.vip) });
  });
});

/* ── 시간과 심판 ─────────────────────────────────── */
describe('시간 초과와 궁정 심판', () => {
  it('세 번 연속 시간을 넘기면 그 판을 진다', () => {
    const s = fresh();
    timeout(s); // 청 1
    endTurn(s); // 홍
    timeout(s); // 청 2
    endTurn(s);
    expect(s.winner).toBeNull();
    timeout(s); // 청 3
    expect(s.winner).toBe('red');
  });

  it('행동하면 연속 횟수가 초기화된다', () => {
    const s = fresh();
    timeout(s); endTurn(s);
    timeout(s); endTurn(s);
    endTurn(s); endTurn(s);
    timeout(s);
    expect(s.winner).toBeNull();
    expect(s.players.blue.timeouts).toBe(1);
  });

  it(`각자 ${MAX_TURNS_EACH}차례가 지나면 궁정 심판`, () => {
    const s = fresh();
    s.players.blue.targetDone = true;
    for (let i = 0; i < MAX_TURNS_EACH * 2; i++) endTurn(s);
    expect(s.winner).toBe('blue');
    expect(s.endReason).toContain('궁정 심판');
  });
});

/* ── 구역, 기물 능력, 상점, 궁정 사건 ─────────── */
describe('구역', () => {
  it('외곽의 농노만 수입을 내고, 궁정 구역의 궁정 기물은 영향력을 낸다', () => {
    const s = fresh(12);
    const serfs = Object.values(s.pieces).filter((p) => p.owner === 'blue' && p.type === 'serf');
    const spy = idOf(s, 'blue', 'spy');
    const pal = idOf(s, 'blue', 'paladin');
    s.pieces[serfs[0].id].r = 3; // 전장으로 나간 농노 → 수입 없음
    s.pieces[spy].r = 4; s.pieces[spy].c = 0; // 궁정 구역
    s.pieces[pal].r = 5; s.pieces[pal].c = 9; // 궁정 구역
    endTurn(s); endTurn(s);
    expect(s.players.blue.lastIncome).toBe(3 * INCOME_PER_SERF + 2);
  });
});

describe('기물 능력', () => {
  it('성기사 호위: 성기사와 그 곁의 아군은 매수 후보가 아니다', () => {
    const s = fresh(13);
    const spy = idOf(s, 'blue', 'spy');
    const pal = idOf(s, 'red', 'paladin');
    const near = idOf(s, 'red', 'serf', 0);
    const far = idOf(s, 'red', 'serf', 1);
    clearBoard(s, [[spy, 5, 5], [pal, 5, 7], [near, 5, 6], [far, 4, 5], [s.orders.red.vip, 9, 9], [s.orders.blue.vip, 0, 0]]);
    s.players.blue.turnsTaken = 3;
    s.players.blue.ruren = 20;
    const ids = bribeOptions(viewFor(s, 'blue'), spy).map((o) => o.id);
    expect(ids).toContain(far);
    expect(ids).not.toContain(near);
    expect(mustFail(s, { kind: 'bribe', piece: spy, target: near })).toContain('성기사');
  });

  it('자객 암습: 축복과 대역을 무시한다', () => {
    const s = fresh(14);
    const asn = idOf(s, 'blue', 'assassin');
    const t = idOf(s, 'red', 'archer');
    const serf = idOf(s, 'red', 'serf');
    clearBoard(s, [[asn, 5, 5], [t, 6, 6], [serf, 6, 7], [s.orders.red.vip, 9, 9], [s.orders.blue.vip, 0, 0]]);
    s.pieces[t].blessedUntil = 99;
    s.pieces[t].double = true;
    act(s, { kind: 'execute', piece: asn, target: t });
    expect(s.pieces[t].alive).toBe(false);
    expect(s.pieces[serf].alive).toBe(true);
  });

  it('궁수 저격: 2 AP로 네 칸 밖까지', () => {
    const s = fresh(15);
    const arc = idOf(s, 'blue', 'archer');
    const t = idOf(s, 'red', 'serf');
    clearBoard(s, [[arc, 2, 2], [t, 6, 2], [s.orders.red.vip, 9, 9], [s.orders.blue.vip, 0, 0]]);
    const v = viewFor(s, 'blue');
    expect(execTargets(v, arc)).not.toContain(t);
    expect(snipeTargets(v, arc)).toContain(t);
    act(s, { kind: 'snipe', piece: arc, target: t });
    expect(s.pieces[t].alive).toBe(false);
    expect(s.ap).toBe(1);
  });

  it('농노 결집: 다른 농노 둘과 붙어 있으면 맞서 싸운다', () => {
    const s = fresh(16);
    const [a, b, c] = Object.values(s.pieces).filter((p) => p.owner === 'blue' && p.type === 'serf').map((p) => p.id);
    const foe = idOf(s, 'red', 'spy');
    clearBoard(s, [[a, 4, 4], [b, 4, 3], [c, 4, 5], [foe, 5, 4], [s.orders.red.vip, 9, 9], [s.orders.blue.vip, 0, 0]]);
    let v = viewFor(s, 'blue');
    expect(execRange(v.pieces.find((p) => p.id === a)!, v.pieces)).toBe(1);
    expect(execTargets(v, b)).toEqual([]);
    act(s, { kind: 'execute', piece: a, target: foe });
    expect(s.pieces[foe].alive).toBe(false);
    s.pieces[c].r = 7;
    v = viewFor(s, 'blue');
    expect(execRange(v.pieces.find((p) => p.id === a)!, v.pieces)).toBe(0);
  });
});

describe('궁정 상점', () => {
  it(`덱은 종류마다 ${DECK_COPIES}장, 상점에 ${MARKET_SIZE}장이 펼쳐진다`, () => {
    const s = fresh(17);
    const pl = s.players.blue;
    expect(pl.market).toHaveLength(MARKET_SIZE);
    expect(pl.deck.length + pl.market.length + pl.hand.length - 1).toBe(CARD_POOL.length * DECK_COPIES);
    expect(viewFor(s, 'red')).not.toHaveProperty('opponent.market');
  });

  it(`1 AP와 ${MARKET_PRICE} 루렌으로 한 장 사고, 상점은 덱에서 다시 채워진다`, () => {
    const s = fresh(18);
    s.players.blue.ruren = 10;
    const card = s.players.blue.market[1];
    const res = act(s, { kind: 'buy', slot: 1 });
    expect(s.players.blue.hand).toContain(card);
    expect(s.players.blue.ruren).toBe(10 - MARKET_PRICE);
    expect(s.ap).toBe(2);
    expect(s.players.blue.market).toHaveLength(MARKET_SIZE);
    expect(eventsFor(res.out, 'red').find((e) => e.type === 'bought')).toMatchObject({ card: null });
    expect(mustFail(s, { kind: 'buy', slot: 0 })).toContain('한 장');
  });

  it(`손패는 ${HAND_LIMIT}장까지`, () => {
    const s = fresh(19);
    s.players.blue.ruren = 30;
    s.players.blue.hand = Array(HAND_LIMIT).fill('tax');
    expect(mustFail(s, { kind: 'buy', slot: 0 })).toContain(`${HAND_LIMIT}장`);
  });

  it(`자기 차례 ${RESTOCK_EVERY}번마다 상점이 새 카드로 바뀐다`, () => {
    const s = fresh(20);
    const before = [...s.players.blue.market];
    const deckTop = s.players.blue.deck.slice(0, MARKET_SIZE);
    for (let i = 0; i < RESTOCK_EVERY * 2; i++) endTurn(s);
    expect(s.players.blue.market).toEqual(deckTop);
    expect(s.players.blue.deck.slice(-MARKET_SIZE)).toEqual(before);
  });
});

describe('궁정 사건', () => {
  it(`전체 차례 ${COURT_EVENT_EVERY}번마다 궁정 공고가 나온다`, () => {
    const s = fresh(21);
    let found = false;
    for (let i = 0; i < COURT_EVENT_EVERY; i++) {
      const res = endTurn(s);
      if (res.out.some((e) => e.ev.type === 'court_event')) found = true;
    }
    expect(found).toBe(true);
    expect(s.chronicle.some((n) => n.tag === '궁정 공고')).toBe(true);
  });
});

describe('배치 시간', () => {
  it('배치 시간이 끝나면 놓인 그대로 시작한다', () => {
    const { state: s } = createRound({ seed: 22, round: 1, first: 'blue' });
    const res = timeout(s);
    expect(s.phase).toBe('play');
    expect(res.out.filter((e) => e.ev.type === 'deployed')).toHaveLength(2);
    expect(s.players.blue.timeouts).toBe(0);
  });
});

describe('조사', () => {
  it('받침에 맞게 붙는다', () => {
    expect(josa('궁수', '이/가')).toBe('궁수가');
    expect(josa('성기사', '이/가')).toBe('성기사가');
    expect(josa('군주', '을/를')).toBe('군주를');
    expect(josa('청실의 첩자', '이/가')).toBe('청실의 첩자가');
    expect(josa('민병', '이/가')).toBe('민병이');
    expect(josa('홍실', '을/를')).toBe('홍실을');
    expect(josa('궁정', '으로/로')).toBe('궁정으로');
    expect(josa('들녘길', '으로/로')).toBe('들녘길로');
  });
});
