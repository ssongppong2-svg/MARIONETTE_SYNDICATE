/**
 * 무엇을 할 수 있는지 판단하는 규칙. 화면용 상태(PlayerView)만으로 계산하므로
 * 서버의 판정과 화면의 안내(하이라이트, 버튼)가 언제나 같습니다.
 * 숨은 정보(VIP, 충성 서약)에 걸리는 실패는 여기서 막지 않고 실행할 때 드러납니다.
 */
import {
  ABILITY_INFO, BRIBE_AFTER_TURNS, BRIBE_COST, BRIBE_MIN, CARDS, N, PIECES, SHADOW_RANGE, SPY_DISCOUNT,
} from './data';
import { josa } from './korean';
import type { Action, CardId, Cell } from './types';
import type { PlayerView, ViewPiece } from './view';

export const cheb = (a: Cell, b: Cell): number => Math.max(Math.abs(a.r - b.r), Math.abs(a.c - b.c));
export const inBoard = (r: number, c: number): boolean => r >= 0 && r < N && c >= 0 && c < N;

const DIRS = {
  any: [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]],
  line: [[-1, 0], [1, 0], [0, -1], [0, 1]],
  diag: [[-1, -1], [-1, 1], [1, -1], [1, 1]],
} as const;

export function pieceAt(v: PlayerView, r: number, c: number): ViewPiece | undefined {
  return v.pieces.find((p) => p.r === r && p.c === c);
}
export function pieceById(v: PlayerView, id: string): ViewPiece | undefined {
  return v.pieces.find((p) => p.id === id);
}
export const isMyTurn = (v: PlayerView): boolean => v.current === v.you && v.winner === null && !v.draw;
const mine = (v: PlayerView, id: string): ViewPiece | undefined => {
  const p = pieceById(v, id);
  return p && p.owner === v.you ? p : undefined;
};
const enemies = (v: PlayerView): ViewPiece[] => v.pieces.filter((p) => p.owner !== v.you);
const allies = (v: PlayerView): ViewPiece[] => v.pieces.filter((p) => p.owner === v.you);
export const isCourt = (p: ViewPiece): boolean => PIECES[p.type].court;

export function execRange(p: ViewPiece): number {
  if (p.militia) return 1;
  let e = PIECES[p.type].exec;
  if (p.type === 'paladin' && p.buffed && e > 0) e += 1;
  return e;
}

export function reachable(v: PlayerView, id: string): Cell[] {
  const p = pieceById(v, id);
  if (!p || p.rooted) return [];
  const { pattern, range } = PIECES[p.type].move;
  const out: Cell[] = [];
  for (const [dr, dc] of DIRS[pattern]) {
    for (let k = 1; k <= range; k++) {
      const r = p.r + dr * k, c = p.c + dc * k;
      if (!inBoard(r, c) || pieceAt(v, r, c)) break;
      out.push({ r, c });
    }
  }
  return out;
}

export function execTargets(v: PlayerView, id: string): string[] {
  const p = pieceById(v, id);
  if (!p) return [];
  const range = execRange(p);
  if (range <= 0) return [];
  return v.pieces.filter((q) => q.owner !== p.owner && cheb(p, q) <= range).map((q) => q.id);
}

export const bribeOpen = (v: PlayerView): boolean => v.turnsTaken[v.you] >= BRIBE_AFTER_TURNS;

/** 매수 비용 (공개 정보만으로 계산). 군주는 null. */
export function bribeCost(v: PlayerView, actor: ViewPiece, target: ViewPiece): number | null {
  if (target.type === 'lord') return null;
  let cost: number = target.type === 'serf' ? BRIBE_COST.serf : BRIBE_COST.court;
  if (actor.type === 'spy' && !actor.militia) cost -= SPY_DISCOUNT;
  cost = Math.max(BRIBE_MIN, cost);
  if (v.me.silverActive) cost = Math.max(1, Math.ceil(cost / 2));
  return cost;
}

export interface BribeOption { id: string; cost: number; affordable: boolean }

/** 붙어 있는(은화 서른 닢이면 두 칸) 매수 후보. 루렌이 모자란 후보도 affordable=false로 돌려줍니다. */
export function bribeOptions(v: PlayerView, id: string): BribeOption[] {
  const p = pieceById(v, id);
  if (!p || !bribeOpen(v)) return [];
  const reach = v.me.silverActive ? 2 : 1;
  const out: BribeOption[] = [];
  for (const q of v.pieces) {
    if (q.owner === p.owner || cheb(p, q) > reach) continue;
    const cost = bribeCost(v, p, q);
    if (cost === null) continue;
    out.push({ id: q.id, cost, affordable: cost <= v.me.ruren });
  }
  return out;
}

export function interrogateTargets(v: PlayerView, id: string): string[] {
  const p = pieceById(v, id);
  if (!p || p.type !== 'spy' || p.militia) return [];
  return v.pieces.filter((q) => q.owner !== p.owner && isCourt(q) && cheb(p, q) === 1).map((q) => q.id);
}

export function blessTargets(v: PlayerView, id: string): string[] {
  const p = pieceById(v, id);
  if (!p || p.type !== 'priest') return [];
  return v.pieces.filter((q) => q.owner === p.owner && q.id !== p.id && cheb(p, q) === 1).map((q) => q.id);
}

export function royalEffect(v: PlayerView, id: string): { rooted: string[]; buffed: string[] } {
  const p = pieceById(v, id);
  if (!p || p.type !== 'lord') return { rooted: [], buffed: [] };
  const near = v.pieces.filter((q) => q.id !== p.id && cheb(p, q) === 1);
  return {
    rooted: near.filter((q) => q.owner !== p.owner).map((q) => q.id),
    buffed: near.filter((q) => q.owner === p.owner && q.type === 'paladin').map((q) => q.id),
  };
}

export function shadowCells(v: PlayerView, id: string): Cell[] {
  const p = pieceById(v, id);
  if (!p || p.type !== 'assassin' || p.rooted) return [];
  const out: Cell[] = [];
  for (let r = p.r - SHADOW_RANGE; r <= p.r + SHADOW_RANGE; r++) {
    for (let c = p.c - SHADOW_RANGE; c <= p.c + SHADOW_RANGE; c++) {
      if (!inBoard(r, c) || (r === p.r && c === p.c) || pieceAt(v, r, c)) continue;
      out.push({ r, c });
    }
  }
  return out;
}

/** 카드가 고를 수 있는 기물 후보 */
export function cardChoices(v: PlayerView, card: CardId): string[] {
  switch (CARDS[card].targeting) {
    case 'own': {
      const flag = card === 'oath' ? 'oath' : 'double';
      return allies(v).filter((p) => !p[flag]).map((p) => p.id);
    }
    case 'ownSerf':
      return allies(v).filter((p) => p.type === 'serf' && !p.militia).map((p) => p.id);
    case 'ownAssassinCell':
      return allies(v).filter((p) => p.type === 'assassin' && shadowCells(v, p.id).length > 0).map((p) => p.id);
    case 'enemy3':
      return enemies(v).map((p) => p.id);
    case 'poison': {
      const mineP = allies(v);
      return enemies(v).filter((q) => !q.poisoned && mineP.some((m) => cheb(m, q) === 1)).map((q) => q.id);
    }
    default:
      return [];
  }
}

/** 카드를 지금 쓸 수 없는 이유. 쓸 수 있으면 null. */
export function cardProblem(v: PlayerView, card: CardId): string | null {
  const def = CARDS[card];
  if (!isMyTurn(v)) return '내 차례가 아니다.';
  if (!v.me.hand.includes(card)) return '손에 없는 카드다.';
  if (v.me.usedCardThisTurn) return '카드는 차례마다 한 장만 쓸 수 있다.';
  if (v.me.ruren < def.cost) return `루렌이 ${def.cost - v.me.ruren} 모자란다.`;
  if (v.ap < def.ap) return 'AP가 모자란다.';
  switch (card) {
    case 'switch': {
      const vip = pieceById(v, v.me.orders.vip);
      if (!vip) return 'VIP가 이미 쓰러졌다.';
      if (!v.me.exposed) return '내 VIP가 아직 노출되지 않았다.';
      if (!allies(v).some((p) => p.id !== vip.id && isCourt(p))) return '새 VIP로 세울 궁정 기물이 없다.';
      return null;
    }
    case 'report':
      return enemies(v).length >= 3 ? null : '고를 적 기물이 셋보다 적다.';
    case 'forgery':
      return v.me.forgeryPending ? '이미 위조 서신이 기다리고 있다.' : null;
    case 'censor':
      return v.me.censor ? '이미 검열을 걸어 두었다.' : null;
    case 'decree': {
      if (v.me.targetDone) return '타겟은 이미 처리했다.';
      const others = enemies(v).filter((p) => isCourt(p) && p.id !== v.me.orders.target);
      return others.length ? null : '바꿀 수 있는 적 궁정 기물이 없다.';
    }
    case 'tax':
      return allies(v).some((p) => p.type === 'serf' && !p.militia) ? null : '세금을 낼 농노가 없다.';
    case 'famine':
      return v.opponent.famine ? '상대는 이미 흉년이다.' : null;
    case 'curfew':
      return v.opponent.curfew ? '이미 통금령이 내려져 있다.' : null;
    case 'silver':
      if (!bribeOpen(v)) return '매수는 4번째 차례부터 할 수 있다.';
      return v.me.silverActive ? '이미 은화를 풀었다.' : null;
    default:
      return cardChoices(v, card).length ? null : '고를 수 있는 기물이 없다.';
  }
}

/** 행동이 규칙에 맞는지 검사. 맞으면 null, 아니면 이유. */
export function validate(v: PlayerView, a: Action): string | null {
  if (v.winner !== null || v.draw) return '이 판은 끝났다.';
  if (v.current !== v.you) return '내 차례가 아니다.';
  if (a.kind === 'end') return null;

  if (a.kind === 'card') {
    const problem = cardProblem(v, a.card);
    if (problem) return problem;
    const t = CARDS[a.card].targeting;
    const picks = a.pieces ?? [];
    const choices = cardChoices(v, a.card);
    if (t === 'enemy3') {
      if (picks.length !== 3 || new Set(picks).size !== 3) return '적 기물 셋을 서로 다르게 골라야 한다.';
      if (!picks.every((id) => choices.includes(id))) return '고를 수 없는 기물이 있다.';
    } else if (t === 'own' || t === 'ownSerf' || t === 'poison') {
      if (picks.length !== 1 || !choices.includes(picks[0])) return '대상을 하나 골라야 한다.';
    } else if (t === 'ownAssassinCell') {
      if (picks.length !== 1 || !choices.includes(picks[0]) || !a.cell) return '자객과 빈칸을 골라야 한다.';
      const cell = a.cell;
      if (!shadowCells(v, picks[0]).some((c) => c.r === cell.r && c.c === cell.c)) return '그 칸으로는 갈 수 없다.';
    }
    return null;
  }

  const p = mine(v, a.piece);
  if (!p) return '내 기물이 아니다.';

  switch (a.kind) {
    case 'move':
      if (v.ap < 1) return 'AP가 모자란다.';
      if (p.rooted) return '군주의 지휘에 묶여 움직일 수 없다.';
      return reachable(v, p.id).some((c) => c.r === a.to.r && c.c === a.to.c) ? null : '그 칸으로는 갈 수 없다.';
    case 'execute':
      if (v.ap < 1) return 'AP가 모자란다.';
      if (execRange(p) <= 0) return `${josa(PIECES[p.type].name, '은/는')} 처형하지 않는다.`;
      return execTargets(v, p.id).includes(a.target) ? null : '사거리 밖이다.';
    case 'bribe': {
      if (v.ap < 1) return 'AP가 모자란다.';
      if (!bribeOpen(v)) return '매수는 4번째 차례부터 할 수 있다.';
      const target = pieceById(v, a.target);
      if (target?.type === 'lord') return '군주는 매수되지 않는다.';
      const opt = bribeOptions(v, p.id).find((o) => o.id === a.target);
      if (!opt) return v.me.silverActive ? '두 칸 안의 적만 매수할 수 있다.' : '붙어 있는 적만 매수할 수 있다.';
      return opt.affordable ? null : `루렌이 ${opt.cost - v.me.ruren} 모자란다.`;
    }
    case 'royal':
      if (p.type !== 'lord') return '군주만 쓸 수 있다.';
      return v.ap >= ABILITY_INFO.royal.ap ? null : 'AP가 모자란다.';
    case 'interrogate':
      if (p.type !== 'spy' || p.militia) return '첩자만 심문할 수 있다.';
      if (v.ap < ABILITY_INFO.interrogate.ap) return 'AP가 모자란다.';
      return interrogateTargets(v, p.id).includes(a.target) ? null : '붙어 있는 적 궁정 기물만 심문할 수 있다.';
    case 'bless':
      if (p.type !== 'priest') return '사제만 축복할 수 있다.';
      if (v.ap < ABILITY_INFO.bless.ap) return 'AP가 모자란다.';
      return blessTargets(v, p.id).includes(a.target) ? null : '붙어 있는 아군만 축복할 수 있다.';
  }
}
