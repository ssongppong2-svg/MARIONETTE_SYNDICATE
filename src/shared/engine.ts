/**
 * 규칙 엔진. 한 판(round)의 상태를 만들고, 행동을 적용하고, 사건을 남깁니다.
 * 같은 seed와 같은 행동이면 언제나 같은 결과가 나옵니다.
 */
import {
  ABILITY_INFO, AP_PER_TURN, CARD_POOL, CARDS, COURT_COL0, COURT_EVENT_EVERY, COURT_EVENTS, COURT_INFLUENCE,
  COURT_ORDER, DECK_COPIES, HAND_SIZE, HOME_ROWS, INCOME_PER_SERF, MARKET_PRICE, MARKET_SIZE, MAX_TURNS_EACH,
  PIECES, RESTOCK_EVERY, SERF_COL0, SERF_COUNT, TAX_PER_SERF, TIMEOUTS_TO_LOSE, zoneOf, type CourtEventId,
} from './data';
import { bribeCost, cheb, royalEffect, validate } from './rules';
import { blessNews, bribeNews, deathNews, doubleNews, purgeNews } from './news';
import type {
  Action, CardId, DeathCause, Emitted, Faction, GameEvent, GameState, NewsItem, Piece, PlayerState,
} from './types';
import { FACTIONS, other } from './types';
import { viewFor } from './view';

/* ── 난수 (mulberry32) ─────────────────────────────── */
export function rand(s: GameState): number {
  s.rng = (s.rng + 0x6d2b79f5) >>> 0;
  let t = s.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pickOf = (s: GameState) => <T>(items: readonly T[]): T => items[Math.floor(rand(s) * items.length)];
function shuffle<T>(s: GameState, items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand(s) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ── 판 만들기 ─────────────────────────────────────── */
function newPlayer(): PlayerState {
  return {
    ruren: 0, hand: [], usedCardThisTurn: false, turnsTaken: 0, timeouts: 0, exposed: false,
    targetDone: false, vipDone: false, vipUncertain: false, famine: false, curfew: false,
    forged: false, censor: false, silverActive: false, intel: [], lastIncome: 0,
    deck: [], market: [], boughtThisTurn: false,
  };
}

function newPiece(id: string, type: Piece['type'], owner: Faction, r: number, c: number): Piece {
  return {
    id, type, owner, origin: owner, r, c, alive: true, militia: false,
    rootedUntil: 0, buffedUntil: 0, blessedUntil: 0, poison: null, oath: false, double: false,
  };
}

export interface RoundSetup { seed: number; round: number; first: Faction }
export interface Step { state: GameState; out: Emitted[] }

export function createRound({ seed, round, first }: RoundSetup): Step {
  const s: GameState = {
    rng: seed >>> 0, round, phase: 'deploy', deployed: { blue: false, red: false },
    turn: 1, current: first, first, ap: AP_PER_TURN,
    pieces: {}, orders: { blue: { vip: '', target: '' }, red: { vip: '', target: '' } },
    players: { blue: newPlayer(), red: newPlayer() },
    chronicle: [], newsSeq: 0, graveyard: [], revealedVips: [], winner: null, draw: false, endReason: null,
  };
  for (const f of FACTIONS) {
    const [courtRow, serfRow] = HOME_ROWS[f];
    const tag = f === 'blue' ? 'b' : 'r';
    COURT_ORDER.forEach((type, i) => {
      const id = `${tag}${i}`;
      s.pieces[id] = newPiece(id, type, f, courtRow, COURT_COL0 + i);
    });
    for (let i = 0; i < SERF_COUNT; i++) {
      const id = `${tag}${COURT_ORDER.length + i}`;
      s.pieces[id] = newPiece(id, 'serf', f, serfRow, SERF_COL0 + i);
    }
  }
  for (const f of FACTIONS) {
    s.orders[f] = {
      vip: pickOf(s)(courtOf(s, f).map((p) => p.id)),
      target: pickOf(s)(courtOf(s, other(f)).map((p) => p.id)),
    };
    // 덱: 암살 후 변경을 뺀 카드 종류마다 DECK_COPIES장. 손패 5장(암살 후 변경 + 4)과 상점 3장을 뽑는다.
    const pl = s.players[f];
    pl.deck = shuffle(s, CARD_POOL.flatMap((c) => Array<CardId>(DECK_COPIES).fill(c)));
    const opening: CardId[] = [];
    while (opening.length < HAND_SIZE - 1 && pl.deck.length) {
      const i = pl.deck.findIndex((c) => !opening.includes(c));
      opening.push(pl.deck.splice(i >= 0 ? i : 0, 1)[0]);
    }
    pl.hand = ['switch', ...opening];
    pl.market = pl.deck.splice(0, MARKET_SIZE);
  }
  // 배치 단계로 시작한다. 두 사람이 모두 배치를 마치면 첫 차례가 열린다.
  const out: Emitted[] = [{ vis: 'all', ev: { type: 'round_start', round, first } }];
  return { state: s, out };
}

/* ── 조회 ─────────────────────────────────────────── */
const alive = (s: GameState) => Object.values(s.pieces).filter((p) => p.alive);
const courtOf = (s: GameState, f: Faction) => alive(s).filter((p) => p.owner === f && PIECES[p.type].court);
/** 수입을 내는 농노: 외곽 구역에 있는 (민병이 아닌) 농노 */
const serfIncomeOf = (s: GameState, f: Faction) =>
  alive(s).filter((p) => p.owner === f && p.type === 'serf' && !p.militia && zoneOf(p.r) === 'outer').length;
/** 궁정 영향력: 궁정 구역에 선 궁정 기물 */
const influenceOf = (s: GameState, f: Faction) =>
  alive(s).filter((p) => p.owner === f && PIECES[p.type].court && zoneOf(p.r) === 'court').length;

/* ── 사건 기록 도우미 ──────────────────────────────── */
function emit(out: Emitted[], ev: GameEvent, vis: Emitted['vis'] = 'all') {
  out.push({ vis, ev });
}
function publish(s: GameState, out: Emitted[], draft: Omit<NewsItem, 'id' | 'turn'>) {
  const item: NewsItem = { ...draft, id: ++s.newsSeq, turn: s.turn };
  s.chronicle.push(item);
  emit(out, { type: 'news', item });
}

/* ── 배치 ─────────────────────────────────────────── */
function applyDeploy(s: GameState, out: Emitted[], f: Faction, layout: Record<string, { r: number; c: number }>) {
  for (const [id, cell] of Object.entries(layout)) {
    const p = s.pieces[id];
    p.r = cell.r;
    p.c = cell.c;
  }
  markDeployed(s, out, f);
}

function markDeployed(s: GameState, out: Emitted[], f: Faction) {
  s.deployed[f] = true;
  emit(out, { type: 'deployed', faction: f });
  if (FACTIONS.every((g) => s.deployed[g])) {
    s.phase = 'play';
    emit(out, { type: 'reveal' });
    startTurn(s, out);
  }
}

/* ── 궁정 상점 ─────────────────────────────────────── */
function restock(s: GameState, out: Emitted[], f: Faction) {
  const pl = s.players[f];
  pl.deck.push(...pl.market);
  pl.market = pl.deck.splice(0, MARKET_SIZE);
  emit(out, { type: 'restock', faction: f }, f);
}

/* ── 궁정 사건 ─────────────────────────────────────── */
function courtEvent(s: GameState, out: Emitted[]) {
  const id = pickOf(s)(Object.keys(COURT_EVENTS) as CourtEventId[]);
  const def = COURT_EVENTS[id];
  let detail = '';
  switch (id) {
    case 'harvest': {
      const got = FACTIONS.map((f) => {
        const n = serfIncomeOf(s, f) * 3;
        s.players[f].ruren += n;
        return n;
      });
      detail = `청실은 ${got[0]}, 홍실은 ${got[1]} 루렌을 거두었다.`;
      break;
    }
    case 'amnesty':
      for (const p of alive(s)) { p.rootedUntil = 0; p.blessedUntil = 0; p.poison = null; }
      detail = '감옥 문이 열리고, 독잔은 비워졌다.';
      break;
    case 'caravan':
      for (const f of FACTIONS) restock(s, out, f);
      detail = '먼 나라의 상단이 새 밀서를 싣고 왔다.';
      break;
    case 'banquet': {
      const [b, r] = FACTIONS.map((f) => influenceOf(s, f));
      if (b !== r) {
        const w: Faction = b > r ? 'blue' : 'red';
        s.players[w].ruren += 5;
        detail = `왕의 곁에 더 많이 선 ${w === 'blue' ? '청실' : '홍실'}에게 5 루렌이 내려졌다.`;
      } else detail = '연회장의 자리는 똑같이 나뉘었다. 아무도 상을 받지 못했다.';
      break;
    }
  }
  publish(s, out, { tag: '궁정 공고', title: def.name, body: `${def.text} ${detail}`, zone: null, censored: false, tone: 'gold' });
  emit(out, { type: 'court_event', event: id });
}

/* ── 차례 ─────────────────────────────────────────── */
function startTurn(s: GameState, out: Emitted[]) {
  const f = s.current;
  const pl = s.players[f];
  if (s.turn > 1 && (s.turn - 1) % COURT_EVENT_EVERY === 0) courtEvent(s, out);
  if (pl.turnsTaken > 0 && pl.turnsTaken % RESTOCK_EVERY === 0) restock(s, out, f);
  const influence = pl.famine ? 0 : influenceOf(s, f) * COURT_INFLUENCE;
  const income = pl.famine ? 0 : serfIncomeOf(s, f) * INCOME_PER_SERF + influence;
  pl.ruren += income;
  pl.lastIncome = income;
  s.ap = Math.max(0, AP_PER_TURN - (pl.curfew ? 1 : 0));
  emit(out, { type: 'turn_start', faction: f, turn: s.turn, income, influence, ap: s.ap, famine: pl.famine, curfew: pl.curfew });
  pl.famine = false;
  pl.curfew = false;
  pl.usedCardThisTurn = false;
  pl.silverActive = false;
  pl.boughtThisTurn = false;
}

function finishTurn(s: GameState, out: Emitted[]) {
  const f = s.current;
  // 이 차례 끝에 독이 도는 기물
  for (const p of alive(s)) {
    if (p.poison && p.poison.dueTurn <= s.turn) {
      const by = p.poison.by;
      p.poison = null;
      killPiece(s, out, p, by, 'poison');
      if (s.winner) return;
    }
  }
  s.players[f].turnsTaken += 1;
  s.players[f].usedCardThisTurn = false;
  s.players[f].silverActive = false;
  s.players[f].boughtThisTurn = false;
  if (FACTIONS.every((g) => s.players[g].turnsTaken >= MAX_TURNS_EACH)) {
    judge(s, out);
    return;
  }
  s.turn += 1;
  s.current = other(f);
  startTurn(s, out);
}

/* ── 승패 ─────────────────────────────────────────── */
function endRound(s: GameState, out: Emitted[], winner: Faction | null, reason: string) {
  s.winner = winner;
  s.draw = winner === null;
  s.endReason = reason;
  emit(out, {
    type: 'round_end', winner, reason,
    orders: { blue: { ...s.orders.blue }, red: { ...s.orders.red } },
  });
}

function checkWin(s: GameState, out: Emitted[], actor: Faction) {
  if (s.winner || s.draw) return;
  for (const f of [actor, other(actor)]) {
    const pl = s.players[f];
    if (pl.targetDone && pl.vipDone) {
      endRound(s, out, f, '타겟 처형과 상대 VIP 처형을 모두 이루었다');
      return;
    }
  }
}

function judge(s: GameState, out: Emitted[]) {
  const score = (f: Faction) => [
    Number(s.players[f].targetDone) + Number(s.players[f].vipDone),
    courtOf(s, f).length,
    s.players[f].ruren,
  ];
  const [b, r] = [score('blue'), score('red')];
  const labels = ['이룬 조건 수', '살아 있는 궁정 기물 수', '루렌'];
  for (let i = 0; i < 3; i++) {
    if (b[i] !== r[i]) {
      endRound(s, out, b[i] > r[i] ? 'blue' : 'red', `궁정 심판 — ${labels[i]}에서 앞섰다`);
      return;
    }
  }
  endRound(s, out, null, '궁정 심판 — 모든 기준이 같아 무승부');
}

/** 서버가 부르는 시간 초과 처리 */
export function timeout(s: GameState): Step {
  const out: Emitted[] = [];
  if (s.winner || s.draw) return { state: s, out };
  if (s.phase === 'deploy') {
    // 배치 시간이 끝나면 아직 마치지 않은 쪽은 지금 놓인 그대로 시작한다
    for (const f of FACTIONS) if (!s.deployed[f] && s.phase === 'deploy') markDeployed(s, out, f);
    return { state: s, out };
  }
  const f = s.current;
  s.players[f].timeouts += 1;
  emit(out, { type: 'timeout', faction: f });
  if (s.players[f].timeouts >= TIMEOUTS_TO_LOSE) {
    endRound(s, out, other(f), `${TIMEOUTS_TO_LOSE}번 연속 시간을 넘겼다`);
    return { state: s, out };
  }
  finishTurn(s, out);
  return { state: s, out };
}

/** 기권 등으로 판을 끝낼 때 */
export function forfeit(s: GameState, loser: Faction, reason: string): Step {
  const out: Emitted[] = [];
  if (!s.winner && !s.draw) endRound(s, out, other(loser), reason);
  return { state: s, out };
}

/* ── 죽음 ─────────────────────────────────────────── */
function bury(s: GameState, p: Piece, cause: DeathCause) {
  p.alive = false;
  p.poison = null;
  s.graveyard.push({ id: p.id, type: p.type, owner: p.owner, origin: p.origin, militia: p.militia, cause, turn: s.turn });
}

function reassignTarget(s: GameState, out: Emitted[], f: Faction) {
  const pool = courtOf(s, other(f)).filter((p) => p.id !== s.orders[f].target);
  if (!pool.length) {
    s.players[f].targetDone = true;
    emit(out, { type: 'condition', which: 'target', state: 'done' }, f);
    return;
  }
  s.orders[f].target = pickOf(s)(pool).id;
  emit(out, { type: 'target_changed', target: s.orders[f].target, reason: 'lost' }, f);
}

/** 적의 손에 기물이 죽음 (처형, 독, 대역). killer는 죽인 쪽 진영. */
function killPiece(s: GameState, out: Emitted[], victim: Piece, killer: Faction, cause: DeathCause) {
  const owner = victim.owner;
  const at = { r: victim.r, c: victim.c };
  const wasVip = s.orders[owner].vip === victim.id;
  const censored = s.players[owner].censor && cause !== 'double';
  if (censored) s.players[owner].censor = false;
  bury(s, victim, cause);
  emit(out, { type: 'death', piece: victim.id, pieceType: victim.type, owner, at, cause, killer });

  publish(s, out, deathNews(
    { type: victim.type, owner, r: at.r, militia: victim.militia }, cause,
    { vip: wasVip && !censored, censored }, pickOf(s),
  ));

  // 조건 ① 타겟
  const kp = s.players[killer];
  if (s.orders[killer].target === victim.id && !kp.targetDone) {
    kp.targetDone = true;
    emit(out, { type: 'condition', which: 'target', state: 'done' }, killer);
  }
  // 조건 ② 상대 VIP
  if (wasVip) {
    kp.vipDone = true;
    s.players[owner].exposed = false;
    if (censored) {
      kp.vipUncertain = true;
      emit(out, { type: 'vip_revealed', piece: victim.id, owner }, owner);
      emit(out, { type: 'condition', which: 'vip', state: 'unknown' }, killer);
    } else {
      kp.vipUncertain = false;
      s.revealedVips.push(victim.id);
      emit(out, { type: 'vip_revealed', piece: victim.id, owner });
      emit(out, { type: 'condition', which: 'vip', state: 'done' }, killer);
    }
  } else if (censored && !kp.vipDone) {
    // 검열된 죽음은 VIP였는지 알 수 없다
    kp.vipUncertain = true;
    emit(out, { type: 'condition', which: 'vip', state: 'unknown' }, killer);
  }
  checkWin(s, out, killer);
}

/* ── 행동 적용 ────────────────────────────────────── */
export interface ApplyResult extends Step { error: string | null }

/**
 * 행동을 적용한다. actor는 행동하는 쪽 (배치는 두 사람이 동시에 하므로 차례와 상관없이 받는다).
 */
export function apply(s: GameState, a: Action, actor: Faction = s.current): ApplyResult {
  const out: Emitted[] = [];
  const error = validate(viewFor(s, actor), a);
  if (error) return { state: s, out, error };
  if (a.kind === 'deploy') {
    applyDeploy(s, out, actor, a.layout);
    return { state: s, out, error: null };
  }
  const me = s.current;
  const opp = other(me);
  const pl = s.players[me];

  if (a.kind === 'buy') {
    const card = pl.market.splice(a.slot, 1)[0];
    pl.hand.push(card);
    pl.ruren -= MARKET_PRICE;
    s.ap -= 1;
    pl.boughtThisTurn = true;
    pl.timeouts = 0;
    if (pl.deck.length) pl.market.push(pl.deck.shift()!);
    emit(out, { type: 'bought', faction: me, card }, me);
    emit(out, { type: 'bought', faction: me, card: null }, opp);
    return { state: s, out, error: null };
  }

  if (a.kind === 'end') {
    pl.timeouts = 0;
    finishTurn(s, out);
    return { state: s, out, error: null };
  }
  pl.timeouts = 0;

  if (a.kind === 'card') {
    applyCard(s, out, a.card, a.pieces ?? [], a.cell);
    return { state: s, out, error: null };
  }

  if (!('piece' in a)) return { state: s, out, error: null };
  const p = s.pieces[a.piece];
  switch (a.kind) {
    case 'move': {
      const from = { r: p.r, c: p.c };
      p.r = a.to.r;
      p.c = a.to.c;
      s.ap -= 1;
      emit(out, { type: 'move', piece: p.id, from, to: { ...a.to }, shadow: false });
      break;
    }
    case 'execute':
    case 'snipe': {
      s.ap -= a.kind === 'snipe' ? ABILITY_INFO.snipe.ap : 1;
      const t = s.pieces[a.target];
      // 자객의 암습은 축복과 대역을 무시한다
      const ambush = p.type === 'assassin' && !p.militia;
      emit(out, { type: 'attack', attacker: p.id, target: t.id, by: me }, me);
      emit(out, { type: 'attack', attacker: null, target: t.id, by: me }, opp);
      if (t.blessedUntil >= s.turn && !ambush) {
        t.blessedUntil = 0;
        emit(out, { type: 'blocked', target: t.id });
        publish(s, out, blessNews({ type: t.type, owner: t.owner, r: t.r, militia: t.militia }, pickOf(s)));
        break;
      }
      if (t.double && !ambush) {
        const subs = alive(s).filter((q) => q.owner === t.owner && q.type === 'serf' && cheb(q, t) === 1);
        if (subs.length) {
          const sub = pickOf(s)(subs);
          t.double = false;
          emit(out, { type: 'double', original: t.id, substitute: sub.id });
          publish(s, out, doubleNews({ type: t.type, owner: t.owner, r: t.r, militia: t.militia }, pickOf(s)));
          killPiece(s, out, sub, me, 'double');
          break;
        }
      }
      killPiece(s, out, t, me, 'execute');
      break;
    }
    case 'bribe': {
      s.ap -= 1;
      const t = s.pieces[a.target];
      const cost = bribeCost(viewFor(s, me), viewOf(s, me, p.id), viewOf(s, me, t.id)) ?? 0;
      pl.silverActive = false;
      if (t.oath) {
        emit(out, { type: 'bribe', actor: p.id, target: t.id, cost: 0, result: 'oath', by: me });
        break;
      }
      if (s.orders[opp].vip === t.id) {
        emit(out, { type: 'bribe', actor: p.id, target: t.id, cost: 0, result: 'vip', by: me });
        if (!s.players[opp].exposed) {
          s.players[opp].exposed = true;
          emit(out, { type: 'exposed', piece: t.id }, opp);
        }
        pl.vipUncertain = false;
        break;
      }
      pl.ruren -= cost;
      publish(s, out, bribeNews({ type: t.type, owner: t.owner, r: t.r, militia: t.militia }, me, pickOf(s)));
      t.owner = me;
      t.poison = t.poison && t.poison.by === me ? null : t.poison;
      emit(out, { type: 'bribe', actor: p.id, target: t.id, cost, result: 'ok', by: me });
      if (s.orders[me].target === t.id && !pl.targetDone) {
        pl.targetDone = true;
        emit(out, { type: 'condition', which: 'target', state: 'done' }, me);
      }
      checkWin(s, out, me);
      break;
    }
    case 'royal': {
      s.ap -= ABILITY_INFO.royal.ap;
      const fx = royalEffect(viewFor(s, me), p.id);
      for (const id of fx.rooted) s.pieces[id].rootedUntil = s.turn + 1;
      for (const id of fx.buffed) s.pieces[id].buffedUntil = s.turn + 2;
      emit(out, { type: 'royal', lord: p.id, ...fx });
      break;
    }
    case 'interrogate': {
      s.ap -= ABILITY_INFO.interrogate.ap;
      const t = s.pieces[a.target];
      emit(out, { type: 'interrogate', actor: p.id, target: t.id });
      gatherIntel(s, out, 'interrogate', [t.id]);
      break;
    }
    case 'bless': {
      s.ap -= ABILITY_INFO.bless.ap;
      const t = s.pieces[a.target];
      const cured = t.poison !== null;
      t.poison = null;
      t.blessedUntil = s.turn + 1;
      emit(out, { type: 'bless', priest: p.id, target: t.id, cured });
      break;
    }
  }
  return { state: s, out, error: null };
}

/** 화면용 기물 (규칙 함수에 넘기기 위해) */
function viewOf(s: GameState, f: Faction, id: string) {
  const v = viewFor(s, f).pieces.find((q) => q.id === id);
  if (!v) throw new Error(`no piece ${id}`);
  return v;
}

/** 정보 얻기: 심문, 밀정의 보고. 위조 서신에 걸려 있으면 결과가 뒤집힌다. */
function gatherIntel(s: GameState, out: Emitted[], kind: 'interrogate' | 'report', subjects: string[]) {
  const me = s.current;
  const opp = other(me);
  const pl = s.players[me];
  const truth = subjects.includes(s.orders[opp].vip);
  const forged = pl.forged;
  pl.forged = false;
  const result = forged ? !truth : truth;
  const note = { turn: s.turn, kind, subjects: [...subjects], result };
  pl.intel.push(note);
  emit(out, { type: 'intel', note }, me);
  if (!forged && truth && subjects.length === 1) {
    pl.vipUncertain = false;
    if (!s.players[opp].exposed) {
      s.players[opp].exposed = true;
      emit(out, { type: 'exposed', piece: subjects[0] }, opp);
    }
  }
}

function applyCard(s: GameState, out: Emitted[], card: CardId, picks: string[], cell?: { r: number; c: number }) {
  const def = CARDS[card];
  const me = s.current;
  const opp = other(me);
  const pl = s.players[me];
  pl.ruren -= def.cost;
  s.ap -= def.ap;
  pl.usedCardThisTurn = true;
  pl.hand.splice(pl.hand.indexOf(card), 1);
  if (def.secret) {
    emit(out, { type: 'card', faction: me, card }, me);
    emit(out, { type: 'card', faction: me, card: null }, opp);
  } else {
    emit(out, { type: 'card', faction: me, card });
  }

  switch (card) {
    case 'switch': {
      const old = s.pieces[s.orders[me].vip];
      const pool = courtOf(s, me).filter((p) => p.id !== old.id);
      const at = { r: old.r, c: old.c };
      bury(s, old, 'switch');
      s.revealedVips.push(old.id);
      emit(out, { type: 'death', piece: old.id, pieceType: old.type, owner: me, at, cause: 'switch', killer: me });
      emit(out, { type: 'vip_revealed', piece: old.id, owner: me });
      publish(s, out, purgeNews({ type: old.type, owner: me, r: at.r, militia: old.militia }));
      s.orders[me].vip = pickOf(s)(pool).id;
      pl.exposed = false;
      emit(out, { type: 'vip_changed', vip: s.orders[me].vip }, me);
      // 상대가 알던 VIP는 사라졌다 — 상대의 검열 의심도 풀린다
      s.players[opp].vipUncertain = false;
      // 옛 VIP가 상대의 타겟이었다면, 상대는 새 타겟을 받는다
      if (s.orders[opp].target === old.id && !s.players[opp].targetDone) reassignTarget(s, out, opp);
      break;
    }
    case 'report':
      gatherIntel(s, out, 'report', picks);
      break;
    case 'forgery':
      s.players[opp].forged = true;
      emit(out, { type: 'secret', card, piece: null }, me);
      break;
    case 'censor':
      pl.censor = true;
      emit(out, { type: 'secret', card, piece: null }, me);
      break;
    case 'decree': {
      const pool = courtOf(s, opp).filter((p) => p.id !== s.orders[me].target);
      s.orders[me].target = pickOf(s)(pool).id;
      emit(out, { type: 'target_changed', target: s.orders[me].target, reason: 'decree' }, me);
      break;
    }
    case 'tax': {
      const amount = serfIncomeOf(s, me) * TAX_PER_SERF;
      pl.ruren += amount;
      emit(out, { type: 'tax', faction: me, amount });
      break;
    }
    case 'famine':
      s.players[opp].famine = true;
      emit(out, { type: 'famine', against: opp });
      break;
    case 'curfew':
      s.players[opp].curfew = true;
      emit(out, { type: 'curfew', against: opp });
      break;
    case 'conscript':
      s.pieces[picks[0]].militia = true;
      emit(out, { type: 'conscript', piece: picks[0] });
      break;
    case 'oath':
      s.pieces[picks[0]].oath = true;
      emit(out, { type: 'secret', card, piece: picks[0] }, me);
      break;
    case 'double':
      s.pieces[picks[0]].double = true;
      emit(out, { type: 'secret', card, piece: picks[0] }, me);
      break;
    case 'silver':
      pl.silverActive = true;
      emit(out, { type: 'silver', faction: me });
      break;
    case 'poison': {
      const t = s.pieces[picks[0]];
      t.poison = { by: me, dueTurn: s.turn + 1 };
      emit(out, { type: 'poisoned', target: t.id, by: me });
      break;
    }
    case 'shadow': {
      const p = s.pieces[picks[0]];
      const from = { r: p.r, c: p.c };
      p.r = cell!.r;
      p.c = cell!.c;
      emit(out, { type: 'move', piece: p.id, from, to: { ...cell! }, shadow: true });
      break;
    }
  }
}

/** 이 사건 목록 중 한 사람이 볼 수 있는 것만 */
export function eventsFor(out: Emitted[], f: Faction): GameEvent[] {
  return out.filter((e) => e.vis === 'all' || e.vis === f).map((e) => e.ev);
}
