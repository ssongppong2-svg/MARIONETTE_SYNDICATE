/**
 * 컴퓨터 상대. 사람과 똑같이 자기 화면용 상태(PlayerView)만 보고 둡니다 — 상대의 VIP를 몰래 알지 못합니다.
 * 상대 VIP는 정보 수첩(심문·밀정의 보고)과 공개된 사실로 추리합니다.
 *
 *  쉬움   : 가끔 엉뚱한 수를 두고, 일찍 차례를 넘긴다
 *  보통   : 한 수씩 위험과 이득을 따져 가장 나은 수를 고른다
 *  어려움 : 남은 AP로 둘 수 있는 수열(최대 3수)을 내다보고 고른다
 */
import {
  ABILITY_INFO, CARDS, COURT_INFLUENCE, HOME_ROWS, INCOME_PER_SERF, MARKET_PRICE, N, PIECES, SNIPE_RANGE, TAX_PER_SERF,
  zoneOf,
} from './data';
import {
  blessTargets, bribeOptions, buyProblem, cardChoices, cardProblem, cheb, execRange, execTargets, inBoard,
  interrogateTargets, isCourt, isMyTurn, reachable, royalEffect, shadowCells, snipeTargets, validate,
} from './rules';
import type { Action, CardId, Cell, Faction, PieceType } from './types';
import { other } from './types';
import type { PlayerView, ViewPiece } from './view';

export type AiLevel = 'easy' | 'normal' | 'hard';
export const AI_LEVEL_NAME: Record<AiLevel, string> = { easy: '쉬움', normal: '보통', hard: '어려움' };

const VALUE: Record<PieceType, number> = { lord: 90, assassin: 80, archer: 78, paladin: 70, spy: 62, priest: 52, serf: 40 };
const AP_DIRS = {
  any: [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]],
  line: [[-1, 0], [1, 0], [0, -1], [0, 1]],
  diag: [[-1, -1], [-1, 1], [1, -1], [1, 1]],
} as const;

/* ── 가벼운 가상 판 ─────────────────────────────── */
interface Sim {
  pieces: ViewPiece[];
  ap: number;
  ruren: number;
  targetDone: number;   // 0~1 (기대값)
  vipDone: number;      // 0~1 (기대값)
  bonus: number;        // 카드·정보 등 계산하기 어려운 이득
  usedCard: boolean;
  hand: CardId[];
}

function startSim(v: PlayerView): Sim {
  return {
    pieces: v.pieces.map((p) => ({ ...p })),
    ap: v.ap,
    ruren: v.me.ruren,
    targetDone: v.me.targetDone ? 1 : 0,
    vipDone: v.me.vipState === 'done' ? 1 : v.me.vipState === 'unknown' ? 0.5 : 0,
    bonus: 0,
    usedCard: v.me.usedCardThisTurn,
    hand: [...v.me.hand],
  };
}

function cloneSim(s: Sim): Sim {
  return { ...s, pieces: s.pieces.map((p) => ({ ...p })), hand: [...s.hand] };
}

/** 가상 판을 규칙 함수에 넘기기 위해 화면용 상태 모양으로 */
function asView(v: PlayerView, s: Sim): PlayerView {
  return { ...v, pieces: s.pieces, ap: s.ap, me: { ...v.me, ruren: s.ruren, usedCardThisTurn: s.usedCard, hand: s.hand } };
}

/* ── 상대 VIP 추리 ─────────────────────────────── */
export function vipBelief(v: PlayerView): Map<string, number> {
  const opp = other(v.you);
  const out = new Map<string, number>();
  if (v.me.vipState === 'done') return out;
  const cands = v.pieces.filter((p) => p.owner === opp && isCourt(p));
  if (!cands.length) return out;
  const w = new Map(cands.map((p) => [p.id, 1]));
  // 상대가 '암살 후 변경'을 썼다면 그 전의 정보는 낡았다
  const lastSwitch = Math.max(0, ...v.graveyard.filter((g) => g.owner === opp && g.cause === 'switch').map((g) => g.turn));
  for (const n of v.me.intel) {
    if (n.turn < lastSwitch) continue;
    for (const [id, x] of w) {
      const hit = n.subjects.includes(id);
      if (n.kind === 'interrogate') w.set(id, x * (hit ? (n.result ? 9 : 0.08) : n.result ? 0.25 : 1.08));
      else w.set(id, x * (hit ? (n.result ? 2.6 : 0.12) : n.result ? 0.35 : 1.25));
    }
  }
  const total = [...w.values()].reduce((a, b) => a + b, 0) || 1;
  for (const [id, x] of w) out.set(id, x / total);
  return out;
}

/* ── 위협 계산: 다음 차례에 상대가 칠 수 있는 내 기물 ─── */
function occupied(s: Sim): Set<string> {
  return new Set(s.pieces.map((p) => `${p.r},${p.c}`));
}

function stepsFrom(p: ViewPiece, from: Cell, occ: Set<string>): Cell[] {
  const { pattern, range } = PIECES[p.type].move;
  const out: Cell[] = [];
  for (const [dr, dc] of AP_DIRS[pattern]) {
    for (let k = 1; k <= range; k++) {
      const r = from.r + dr * k, c = from.c + dc * k;
      if (!inBoard(r, c) || occ.has(`${r},${c}`)) break;
      out.push({ r, c });
    }
  }
  return out;
}

/** side의 기물이 apBudget AP로 칠 수 있는 상대 기물 id → 필요한 최소 AP */
function strikeMap(s: Sim, side: Faction, apBudget: number): Map<string, number> {
  const out = new Map<string, number>();
  const occ = occupied(s);
  const victims = s.pieces.filter((p) => p.owner !== side);
  for (const p of s.pieces) {
    if (p.owner !== side) continue;
    const base = execRange(p, s.pieces);
    const sniper = p.type === 'archer' && !p.militia;
    if (base <= 0 && !sniper) continue;
    // 0, 1, 2번 움직인 자리 (구속된 기물은 그 자리 그대로)
    let frontier: Cell[] = [{ r: p.r, c: p.c }];
    const seen = new Set([`${p.r},${p.c}`]);
    const occNoSelf = new Set(occ);
    occNoSelf.delete(`${p.r},${p.c}`);
    for (let moves = 0; moves < apBudget; moves++) {
      // 남은 AP가 2 이상이면 궁수는 저격(4칸)도 할 수 있다
      const range = sniper && apBudget - moves >= ABILITY_INFO.snipe.ap ? SNIPE_RANGE : base;
      const cost = sniper && range === SNIPE_RANGE && base < SNIPE_RANGE ? ABILITY_INFO.snipe.ap : 1;
      for (const at of frontier) {
        for (const q of victims) {
          if (cheb(at, q) <= range) {
            const need = moves + cost;
            if ((out.get(q.id) ?? 99) > need) out.set(q.id, need);
          }
        }
      }
      if (p.rooted || moves + 1 >= apBudget) break;
      const next: Cell[] = [];
      for (const at of frontier) {
        for (const c of stepsFrom(p, at, occNoSelf)) {
          const key = `${c.r},${c.c}`;
          if (!seen.has(key)) { seen.add(key); next.push(c); }
        }
      }
      frontier = next;
    }
  }
  return out;
}

/* ── 평가 ───────────────────────────────────────── */
interface Ctx {
  v: PlayerView;
  me: Faction;
  opp: Faction;
  belief: Map<string, number>;
  level: AiLevel;
  rand: () => number;
}

function evaluate(ctx: Ctx, s: Sim): number {
  const { v, me, opp, belief } = ctx;
  let score = 0;
  const mine = s.pieces.filter((p) => p.owner === me);
  const theirs = s.pieces.filter((p) => p.owner === opp);
  for (const p of mine) score += VALUE[p.type];
  for (const p of theirs) score -= VALUE[p.type];

  // 승리 조건
  score += s.targetDone * 420 + s.vipDone * 420;
  if (s.targetDone >= 1 && s.vipDone >= 1) score += 10000;

  // 내가 다음 차례에 칠 수 있는 것 (공격 기회)
  const myStrikes = strikeMap(s, me, 3);
  const tgt = v.me.orders.target;
  if (s.targetDone < 1 && theirs.some((p) => p.id === tgt)) {
    const need = myStrikes.get(tgt);
    if (need !== undefined) score += need === 1 ? 70 : need === 2 ? 45 : 25;
    else {
      const t = theirs.find((p) => p.id === tgt)!;
      const d = Math.min(...mine.filter((p) => execRange(p, s.pieces) > 0).map((p) => cheb(p, t)), 20);
      score -= d * 4;
    }
  }
  if (s.vipDone < 1) {
    for (const p of theirs) {
      const b = belief.get(p.id) ?? 0;
      if (!b) continue;
      const need = myStrikes.get(p.id);
      if (need !== undefined) score += b * (need === 1 ? 140 : need === 2 ? 90 : 50);
      else {
        const d = Math.min(...mine.filter((m) => execRange(m, s.pieces) > 0).map((m) => cheb(m, p)), 20);
        score -= b * d * 5;
      }
    }
  }

  // 상대가 다음 차례에 칠 수 있는 내 기물 (위험)
  const danger = strikeMap(s, opp, 3);
  const myVip = v.me.orders.vip;
  let worst = 0;
  let sum = 0;
  for (const p of mine) {
    const need = danger.get(p.id);
    if (need === undefined) continue;
    let loss = VALUE[p.type] * (need === 1 ? 1 : need === 2 ? 0.8 : 0.55);
    if (p.id === myVip) loss += v.me.exposed ? 520 : 260 * (need === 1 ? 1 : 0.7);
    if (p.blessed) loss *= 0.25;
    if (p.double && p.id === myVip) loss *= 0.6;
    worst = Math.max(worst, loss);
    sum += loss;
  }
  score -= worst * 0.85 + (sum - worst) * 0.25;

  // 경제: 외곽의 농노는 수입, 궁정 구역의 궁정 기물은 영향력
  const serfs = mine.filter((p) => p.type === 'serf' && !p.militia && zoneOf(p.r) === 'outer').length;
  const influence = mine.filter((p) => isCourt(p) && zoneOf(p.r) === 'court').length;
  score += s.ruren * 1.6 + serfs * INCOME_PER_SERF * 3 + influence * COURT_INFLUENCE * 5;
  score += s.bonus;
  return score;
}

/* ── 후보 수 만들기 ─────────────────────────────── */
interface Cand { a: Action; s: Sim }

function applyLight(ctx: Ctx, s: Sim, a: Action): Sim | null {
  const { v, me, belief } = ctx;
  const n = cloneSim(s);
  const sv = asView(v, n);
  if (validate(sv, a)) return null;
  const find = (id: string) => n.pieces.find((p) => p.id === id)!;
  switch (a.kind) {
    case 'move': {
      const p = find(a.piece);
      p.r = a.to.r; p.c = a.to.c;
      n.ap -= 1;
      return n;
    }
    case 'execute':
    case 'snipe': {
      const t = find(a.target);
      const actor = find(a.piece);
      n.ap -= a.kind === 'snipe' ? ABILITY_INFO.snipe.ap : 1;
      const ambush = actor.type === 'assassin' && !actor.militia;
      if (t.blessed && !ambush) { t.blessed = false; n.bonus -= 5; return n; }
      n.pieces = n.pieces.filter((p) => p.id !== t.id);
      if (t.id === v.me.orders.target) n.targetDone = 1;
      n.vipDone = Math.min(1, n.vipDone + (belief.get(t.id) ?? 0));
      return n;
    }
    case 'bribe': {
      const actor = find(a.piece);
      const t = find(a.target);
      const opt = bribeOptions(sv, actor.id).find((o) => o.id === t.id);
      if (!opt) return null;
      n.ap -= 1;
      const pVip = belief.get(t.id) ?? 0;
      const pOk = (1 - pVip) * 0.88;
      n.ruren -= opt.cost * pOk;
      n.bonus += pOk * VALUE[t.type] * 1.6 + pVip * 45 - 6;
      if (t.id === v.me.orders.target) n.targetDone = Math.min(1, n.targetDone + pOk);
      if (pOk > 0.5) t.owner = me;
      return n;
    }
    case 'royal': {
      const fx = royalEffect(sv, a.piece);
      n.ap -= ABILITY_INFO.royal.ap;
      for (const id of fx.rooted) find(id).rooted = true;
      for (const id of fx.buffed) find(id).buffed = true;
      n.bonus += fx.rooted.length * 6 - 10;
      return n;
    }
    case 'interrogate': {
      const b = belief.get(a.target) ?? 0;
      n.ap -= ABILITY_INFO.interrogate.ap;
      const unknown = b > 0.06 && b < 0.9;
      n.bonus += unknown ? 70 * (1 - Math.abs(0.5 - b)) : -20;
      return n;
    }
    case 'bless': {
      const t = find(a.target);
      n.ap -= ABILITY_INFO.bless.ap;
      t.blessed = true;
      const cured = t.poisoned ? VALUE[t.type] + (t.id === v.me.orders.vip ? 300 : 0) : 0;
      t.poisoned = null;
      n.bonus += cured - 8;
      return n;
    }
    case 'card':
      return applyCardLight(ctx, n, a);
    case 'buy': {
      const card = n.hand.length < 99 ? v.me.market[a.slot] : undefined;
      if (!card) return null;
      n.ap -= 1;
      n.ruren -= MARKET_PRICE;
      n.hand.push(card);
      n.bonus += cardWorth(ctx, card);
      return n;
    }
    case 'deploy':
    case 'end':
      return n;
  }
}

/** 상점 카드의 대략적인 값어치 (사서 손에 쥐는 가치) */
function cardWorth(ctx: Ctx, card: CardId): number {
  const { v } = ctx;
  const late = v.turnsTaken[v.you] >= 10;
  const table: Record<CardId, number> = {
    switch: 40, report: 26, forgery: 14, censor: 16, decree: 12, tax: 18, famine: 14, conscript: 8,
    oath: v.me.exposed ? 10 : 26, silver: 10, poison: 30, shadow: 24, double: 22, curfew: 18,
  };
  return (table[card] ?? 10) * (late ? 0.8 : 1) - 9;
}

function applyCardLight(ctx: Ctx, n: Sim, a: Extract<Action, { kind: 'card' }>): Sim | null {
  const { v, me, opp, belief } = ctx;
  const def = CARDS[a.card];
  n.ruren -= def.cost;
  n.ap -= def.ap;
  n.usedCard = true;
  n.hand.splice(n.hand.indexOf(a.card), 1);
  const find = (id: string) => n.pieces.find((p) => p.id === id);
  const mine = n.pieces.filter((p) => p.owner === me);
  const theirs = n.pieces.filter((p) => p.owner === opp);
  const serfs = mine.filter((p) => p.type === 'serf' && !p.militia).length;
  const oppSerfs = theirs.filter((p) => p.type === 'serf' && !p.militia).length;
  const early = v.turnsTaken[me] < 8;
  switch (a.card) {
    case 'switch': {
      const danger = strikeMap(n, opp, 3);
      const vip = v.me.orders.vip;
      n.pieces = n.pieces.filter((p) => p.id !== vip);
      n.bonus += danger.has(vip) ? 560 : 260;
      return n;
    }
    case 'report': {
      const picks = a.pieces ?? [];
      const mass = picks.reduce((x, id) => x + (belief.get(id) ?? 0), 0);
      n.bonus += mass > 0.05 && mass < 0.95 ? 60 : 5;
      return n;
    }
    case 'forgery': n.bonus += 22; return n;
    case 'censor': n.bonus += early ? 34 : 18; return n;
    case 'decree': {
      const t = find(v.me.orders.target);
      const d = t ? Math.min(...mine.filter((m) => execRange(m, n.pieces) > 0).map((m) => cheb(m, t)), 20) : 0;
      n.bonus += d >= 6 ? 30 : -10;
      return n;
    }
    case 'tax': n.ruren += serfs * TAX_PER_SERF; return n;
    case 'famine': n.bonus += oppSerfs * INCOME_PER_SERF * 1.6 + 4; return n;
    case 'curfew': n.bonus += 34; return n;
    case 'conscript': {
      const p = find(a.pieces![0])!;
      p.militia = true;
      n.bonus += theirs.some((q) => cheb(q, p) <= 2) ? 14 : -12;
      return n;
    }
    case 'oath': {
      const p = find(a.pieces![0])!;
      p.oath = true;
      n.bonus += p.id === v.me.orders.vip ? (v.turnsTaken[opp] >= 2 ? 70 : 40) : p.type === 'lord' ? -20 : 6;
      return n;
    }
    case 'double': {
      const p = find(a.pieces![0])!;
      p.double = true;
      const hasSerf = mine.some((q) => q.type === 'serf' && q.id !== p.id && cheb(q, p) === 1);
      n.bonus += p.id === v.me.orders.vip ? (hasSerf ? 90 : 25) : hasSerf ? 10 : -10;
      return n;
    }
    case 'silver': {
      const sv = asView(v, n);
      const opts = mine.flatMap((m) => bribeOptions({ ...sv, me: { ...sv.me, silverActive: true } }, m.id));
      n.bonus += opts.some((o) => o.affordable) && n.ap >= 1 ? 16 : -15;
      return n;
    }
    case 'poison': {
      const t = find(a.pieces![0])!;
      const b = belief.get(t.id) ?? 0;
      n.bonus += (VALUE[t.type] + b * 330 + (t.id === v.me.orders.target ? 330 : 0)) * 0.6;
      return n;
    }
    case 'shadow': {
      const p = find(a.pieces![0])!;
      p.r = a.cell!.r; p.c = a.cell!.c;
      return n;
    }
  }
}

function cardCandidates(ctx: Ctx, s: Sim): Action[] {
  const { v, belief } = ctx;
  const sv = asView(v, s);
  const out: Action[] = [];
  for (const card of new Set(s.hand)) {
    if (cardProblem(sv, card)) continue;
    const t = CARDS[card].targeting;
    if (t === 'none') { out.push({ kind: 'card', card }); continue; }
    const choices = cardChoices(sv, card);
    if (t === 'enemy3') {
      const ranked = choices
        .map((id) => ({ id, b: belief.get(id) ?? 0 }))
        .filter((x) => x.b > 0)
        .sort((a, b) => Math.abs(0.33 - a.b) - Math.abs(0.33 - b.b));
      const pick = ranked.slice(0, 3).map((x) => x.id);
      if (pick.length === 3) out.push({ kind: 'card', card, pieces: pick });
    } else if (t === 'own') {
      const vip = v.me.orders.vip;
      if (choices.includes(vip)) out.push({ kind: 'card', card, pieces: [vip] });
    } else if (t === 'ownSerf' || t === 'poison') {
      for (const id of choices.slice(0, 6)) out.push({ kind: 'card', card, pieces: [id] });
    } else if (t === 'ownAssassinCell') {
      for (const id of choices) {
        const cells = shadowCells(sv, id);
        const tgt = sv.pieces.find((p) => p.id === v.me.orders.target);
        const ranked = cells
          .map((c) => ({ c, d: tgt ? cheb(c, tgt) : 9 }))
          .sort((a, b) => a.d - b.d)
          .slice(0, 4);
        for (const x of ranked) out.push({ kind: 'card', card, pieces: [id], cell: x.c });
      }
    }
  }
  return out;
}

function candidates(ctx: Ctx, s: Sim, moveCap: number): Action[] {
  const { v, me } = ctx;
  const sv = asView(v, s);
  const out: Action[] = [];
  const mine = s.pieces.filter((p) => p.owner === me);
  if (s.ap >= 1) {
    for (const p of mine) {
      for (const t of execTargets(sv, p.id)) out.push({ kind: 'execute', piece: p.id, target: t });
      for (const o of bribeOptions(sv, p.id)) if (o.affordable) out.push({ kind: 'bribe', piece: p.id, target: o.id });
    }
    // 이동은 많으니 거친 점수로 추려 둔다
    const moves: { a: Action; h: number }[] = [];
    const theirs = s.pieces.filter((p) => p.owner !== me);
    for (const p of mine) {
      if (execRange(p, s.pieces) <= 0 && p.type !== 'priest' && p.type !== 'spy' && p.type !== 'serf' && p.type !== 'archer') continue;
      for (const to of reachable(sv, p.id)) {
        const before = Math.min(...theirs.map((q) => cheb(p, q)), 20);
        const after = Math.min(...theirs.map((q) => cheb(to, q)), 20);
        const tgt = theirs.find((q) => q.id === v.me.orders.target);
        const toward = tgt ? cheb(p, tgt) - cheb(to, tgt) : 0;
        moves.push({ a: { kind: 'move', piece: p.id, to }, h: (before - after) + toward * 1.5 + ctx.rand() * 0.5 });
      }
    }
    moves.sort((x, y) => y.h - x.h);
    for (const m of moves.slice(0, moveCap)) out.push(m.a);
    // 위험한 기물을 빼는 수도 넣는다
    const danger = strikeMap(s, other(me), 3);
    for (const p of mine) {
      if (!danger.has(p.id)) continue;
      for (const to of reachable(sv, p.id).slice(0, 8)) out.push({ kind: 'move', piece: p.id, to });
    }
  }
  if (s.ap >= ABILITY_INFO.snipe.ap) {
    for (const p of mine) {
      if (p.type !== 'archer') continue;
      const near = new Set(execTargets(sv, p.id));
      for (const t of snipeTargets(sv, p.id)) if (!near.has(t)) out.push({ kind: 'snipe', piece: p.id, target: t });
    }
  }
  if (!buyProblem({ ...sv, me: { ...sv.me, boughtThisTurn: sv.me.boughtThisTurn } })) {
    let bestSlot = -1, bestW = 0;
    v.me.market.forEach((c, i) => { const w = cardWorth(ctx, c); if (w > bestW) { bestW = w; bestSlot = i; } });
    // 손패가 넉넉하면 사지 않는다 (AP와 루렌을 판 위에 쓴다)
    const thin = s.hand.length <= 3 || s.ruren >= 14;
    if (bestSlot >= 0 && thin && s.ruren >= MARKET_PRICE + 3) out.push({ kind: 'buy', slot: bestSlot });
  }
  for (const p of mine) {
    if (p.type === 'lord' && s.ap >= ABILITY_INFO.royal.ap && royalEffect(sv, p.id).rooted.length) out.push({ kind: 'royal', piece: p.id });
    if (p.type === 'spy' && !p.militia && s.ap >= ABILITY_INFO.interrogate.ap) {
      for (const t of interrogateTargets(sv, p.id)) out.push({ kind: 'interrogate', piece: p.id, target: t });
    }
    if (p.type === 'priest' && s.ap >= ABILITY_INFO.bless.ap) {
      for (const t of blessTargets(sv, p.id)) out.push({ kind: 'bless', piece: p.id, target: t });
    }
  }
  out.push(...cardCandidates(ctx, s));
  return out;
}

/* ── 고르기 ─────────────────────────────────────── */
function expand(ctx: Ctx, s: Sim, moveCap: number): Cand[] {
  const out: Cand[] = [];
  for (const a of candidates(ctx, s, moveCap)) {
    const n = applyLight(ctx, s, a);
    if (n) out.push({ a, s: n });
  }
  return out;
}

/**
 * 배치: VIP를 뒷줄에 두고 성기사(매수 방지)와 사제(축복)를 곁에 붙인다. 농노는 앞줄에 뭉쳐 방패와 수입이 된다.
 * 매번 자리를 조금씩 바꿔서 배치만 보고 VIP를 맞히기 어렵게 한다.
 */
export function decideDeploy(v: PlayerView, level: AiLevel, rand: () => number = Math.random): Action {
  const [back, front] = HOME_ROWS[v.you];
  const mine = v.pieces.filter((p) => p.owner === v.you);
  const layout: Record<string, Cell> = {};
  const used = new Set<string>();
  const put = (id: string, r: number, c: number) => {
    let cc = Math.max(0, Math.min(N - 1, c));
    while (used.has(`${r},${cc}`)) cc = (cc + 1) % N;
    used.add(`${r},${cc}`);
    layout[id] = { r, c: cc };
  };
  if (level === 'easy') {
    const cells: Cell[] = [];
    for (const r of [back, front]) for (let c = 0; c < N; c++) cells.push({ r, c });
    for (const p of mine) {
      const i = Math.floor(rand() * cells.length);
      const [cell] = cells.splice(i, 1);
      layout[p.id] = cell;
    }
    return { kind: 'deploy', layout };
  }
  const byType = (t: PieceType) => mine.filter((p) => p.type === t);
  const vip = mine.find((p) => p.id === v.me.orders.vip)!;
  const center = 2 + Math.floor(rand() * 6);
  put(vip.id, back, center);
  const vc = layout[vip.id].c;
  // VIP 곁: 성기사와 사제 (VIP가 그 기물이면 건너뛴다)
  const pal = byType('paladin').find((p) => p.id !== vip.id);
  const pri = byType('priest').find((p) => p.id !== vip.id);
  const side = rand() < 0.5 ? -1 : 1;
  if (pal) put(pal.id, back, vc + side);
  if (pri) put(pri.id, back, vc - side);
  // 나머지 궁정 기물: 궁수와 군주는 뒷줄, 자객과 첩자는 앞줄 가장자리
  for (const p of mine) {
    if (layout[p.id] || p.type === 'serf') continue;
    if (p.type === 'archer' || p.type === 'lord') put(p.id, back, rand() < 0.5 ? vc + 3 + Math.floor(rand() * 2) : vc - 3 - Math.floor(rand() * 2));
    else put(p.id, front, rand() < 0.5 ? 1 + Math.floor(rand() * 2) : N - 2 - Math.floor(rand() * 2));
  }
  // 농노: VIP 앞에 뭉쳐서 (결집) 방패가 된다
  const serfs = byType('serf');
  serfs.forEach((p, i) => put(p.id, front, vc - 1 + i - (rand() < 0.5 ? 0 : 1)));
  return { kind: 'deploy', layout };
}

export function decide(v: PlayerView, level: AiLevel, rand: () => number = Math.random): Action {
  if (v.phase === 'deploy') return v.deployed[v.you] ? { kind: 'end' } : decideDeploy(v, level, rand);
  if (!isMyTurn(v)) return { kind: 'end' };
  const ctx: Ctx = { v, me: v.you, opp: other(v.you), belief: vipBelief(v), level, rand };
  const root = startSim(v);
  const base = evaluate(ctx, root);
  const first = expand(ctx, root, level === 'hard' ? 40 : 28);
  if (!first.length) return { kind: 'end' };

  let best: { a: Action; score: number } = { a: { kind: 'end' }, score: base };

  if (level === 'hard') {
    // 남은 AP 안에서 수열을 내다본다 (빔 탐색)
    let beam = first.map((c) => ({ first: c.a, s: c.s, score: evaluate(ctx, c.s) }));
    beam.sort((x, y) => y.score - x.score);
    beam = beam.slice(0, 10);
    for (const b of beam) if (b.score > best.score) best = { a: b.first, score: b.score };
    for (let depth = 1; depth < 3; depth++) {
      const next: typeof beam = [];
      for (const b of beam) {
        if (b.s.ap <= 0 && b.s.usedCard) continue;
        for (const c of expand(ctx, b.s, 14)) next.push({ first: b.first, s: c.s, score: evaluate(ctx, c.s) });
      }
      if (!next.length) break;
      next.sort((x, y) => y.score - x.score);
      beam = next.slice(0, 10);
      for (const b of beam) if (b.score > best.score + 1) best = { a: b.first, score: b.score };
    }
  } else {
    for (const c of first) {
      let sc = evaluate(ctx, c.s);
      if (level === 'easy') sc += (rand() - 0.5) * 120;
      if (sc > best.score) best = { a: c.a, score: sc };
    }
    if (level === 'easy') {
      if (rand() < 0.22 && first.length) best = { a: first[Math.floor(rand() * first.length)].a, score: 0 };
      if (rand() < 0.25 && v.ap < 3) best = { a: { kind: 'end' }, score: 0 };
    }
  }
  // 마지막 안전장치: 규칙에 맞지 않으면 차례를 넘긴다
  return validate(v, best.a) ? { kind: 'end' } : best.a;
}
