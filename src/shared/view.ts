/**
 * 플레이어 한 사람이 봐도 되는 정보만 담은 화면용 상태.
 * 서버는 이것만 보내므로, 화면 코드를 뜯어봐도 상대의 VIP·타겟·손패는 알 수 없습니다.
 */
import { MAX_TURNS_EACH, RESTOCK_EVERY } from './data';
import type {
  CardId, Faction, GameState, Grave, IntelNote, NewsItem, Orders, Phase, PieceType,
} from './types';
import { FACTIONS, other } from './types';

export interface ViewPiece {
  id: string;
  type: PieceType;
  owner: Faction;
  origin: Faction;
  r: number;
  c: number;
  militia: boolean;
  rooted: boolean;
  buffed: boolean;
  blessed: boolean;
  poisoned: null | { by: Faction; dueTurn: number };
  /** 내 기물에만 채워집니다 */
  oath?: boolean;
  double?: boolean;
}

export interface GraveEntry extends Grave {
  /** 공개적으로 VIP였다고 밝혀졌는가 */
  wasVip: boolean;
}

export type VipState = 'pending' | 'done' | 'unknown';

export interface PlayerView {
  you: Faction;
  round: number;
  /** 배치 단계에는 상대 기물이 보이지 않는다 */
  phase: Phase;
  deployed: Record<Faction, boolean>;
  turn: number;
  current: Faction;
  first: Faction;
  ap: number;
  maxTurnsEach: number;
  turnsTaken: Record<Faction, number>;
  pieces: ViewPiece[];
  graveyard: GraveEntry[];
  me: {
    ruren: number;
    hand: CardId[];
    usedCardThisTurn: boolean;
    orders: Orders;
    /** 지령의 기물 종류 (배치 단계처럼 상대 기물이 안 보일 때도 지령서를 그리기 위해) */
    vipType: PieceType;
    targetType: PieceType;
    exposed: boolean;
    targetDone: boolean;
    vipState: VipState;
    censor: boolean;
    forgeryPending: boolean;
    silverActive: boolean;
    intel: IntelNote[];
    timeouts: number;
    lastIncome: number;
    famine: boolean;
    curfew: boolean;
    /** 궁정 상점 */
    market: CardId[];
    deckCount: number;
    boughtThisTurn: boolean;
    /** 상점이 새로 채워지기까지 남은 내 차례 수 */
    restockIn: number;
  };
  opponent: {
    ruren: number;
    handCount: number;
    usedCardThisTurn: boolean;
    timeouts: number;
    lastIncome: number;
    famine: boolean;
    curfew: boolean;
    deckCount: number;
  };
  chronicle: NewsItem[];
  winner: Faction | null;
  draw: boolean;
  endReason: string | null;
  /** 판이 끝나면 양쪽 지령이 공개됩니다 */
  revealedOrders: Record<Faction, Orders> | null;
}

export function viewFor(state: GameState, you: Faction): PlayerView {
  const opp = other(you);
  const t = state.turn;
  const me = state.players[you];
  const op = state.players[opp];
  const over = state.winner !== null || state.draw;
  let vipState: VipState = 'pending';
  if (me.vipDone && !me.vipUncertain) vipState = 'done';
  else if (me.vipUncertain) vipState = 'unknown';

  const deploying = state.phase === 'deploy';
  return {
    you,
    round: state.round,
    phase: state.phase,
    deployed: { ...state.deployed },
    turn: t,
    current: state.current,
    first: state.first,
    ap: state.ap,
    maxTurnsEach: MAX_TURNS_EACH,
    turnsTaken: { blue: state.players.blue.turnsTaken, red: state.players.red.turnsTaken },
    pieces: Object.values(state.pieces)
      .filter((p) => p.alive && (!deploying || p.owner === you))
      .map((p) => {
        const vp: ViewPiece = {
          id: p.id, type: p.type, owner: p.owner, origin: p.origin, r: p.r, c: p.c, militia: p.militia,
          rooted: p.rootedUntil >= t, buffed: p.buffedUntil >= t, blessed: p.blessedUntil >= t,
          poisoned: p.poison ? { ...p.poison } : null,
        };
        if (p.owner === you) { vp.oath = p.oath; vp.double = p.double; }
        return vp;
      }),
    graveyard: state.graveyard.map((g) => ({ ...g, wasVip: state.revealedVips.includes(g.id) })),
    me: {
      ruren: me.ruren,
      hand: [...me.hand],
      usedCardThisTurn: me.usedCardThisTurn,
      orders: { ...state.orders[you] },
      vipType: state.pieces[state.orders[you].vip].type,
      targetType: state.pieces[state.orders[you].target].type,
      exposed: me.exposed,
      targetDone: me.targetDone,
      vipState,
      censor: me.censor,
      forgeryPending: op.forged,
      silverActive: me.silverActive,
      intel: me.intel.map((n) => ({ ...n, subjects: [...n.subjects] })),
      timeouts: me.timeouts,
      lastIncome: me.lastIncome,
      famine: me.famine,
      curfew: me.curfew,
      market: [...me.market],
      deckCount: me.deck.length,
      boughtThisTurn: me.boughtThisTurn,
      restockIn: RESTOCK_EVERY - (me.turnsTaken % RESTOCK_EVERY),
    },
    opponent: {
      ruren: op.ruren,
      handCount: op.hand.length,
      usedCardThisTurn: op.usedCardThisTurn,
      timeouts: op.timeouts,
      lastIncome: op.lastIncome,
      famine: op.famine,
      curfew: op.curfew,
      deckCount: op.deck.length,
    },
    chronicle: state.chronicle.map((n) => ({ ...n })),
    winner: state.winner,
    draw: state.draw,
    endReason: state.endReason,
    revealedOrders: over
      ? { blue: { ...state.orders.blue }, red: { ...state.orders.red } }
      : null,
  };
}

export function bothViews(state: GameState): Record<Faction, PlayerView> {
  return Object.fromEntries(FACTIONS.map((f) => [f, viewFor(state, f)])) as Record<Faction, PlayerView>;
}
