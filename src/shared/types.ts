/** 마리오네트 신디케이트 — 규칙 엔진의 공용 타입. 서버와 화면이 함께 씁니다. */

export type Faction = 'blue' | 'red';
export const FACTIONS: readonly Faction[] = ['blue', 'red'];
export const other = (f: Faction): Faction => (f === 'blue' ? 'red' : 'blue');

export type PieceType = 'lord' | 'paladin' | 'assassin' | 'spy' | 'archer' | 'priest' | 'serf';

export type CardId =
  | 'switch' | 'report' | 'forgery' | 'censor' | 'decree'
  | 'tax' | 'famine' | 'conscript'
  | 'oath' | 'silver'
  | 'poison' | 'shadow' | 'double' | 'curfew';

export interface Cell { r: number; c: number }

export interface Piece {
  id: string;
  type: PieceType;
  owner: Faction;
  /** 판을 시작할 때의 주인. owner와 다르면 매수된 꼭두각시입니다. */
  origin: Faction;
  r: number;
  c: number;
  alive: boolean;
  militia: boolean;
  /** 아래 세 값은 "이 전체 차례 번호가 끝날 때까지" 유효합니다. 0이면 없음. */
  rootedUntil: number;
  buffedUntil: number;
  blessedUntil: number;
  poison: null | { by: Faction; dueTurn: number };
  /** 비밀 상태 — 주인만 압니다. */
  oath: boolean;
  double: boolean;
}

export interface Orders { vip: string; target: string }

export interface IntelNote {
  turn: number;
  kind: 'interrogate' | 'report';
  subjects: string[];
  /** "VIP가 있다/맞다" — 위조 서신에 당했다면 거짓일 수 있습니다. */
  result: boolean;
}

export interface PlayerState {
  ruren: number;
  hand: CardId[];
  usedCardThisTurn: boolean;
  /** 이 판에서 끝낸 내 차례 수 */
  turnsTaken: number;
  /** 연속으로 시간을 넘긴 횟수 */
  timeouts: number;
  /** 상대가 내 현재 VIP를 확실히 안다 */
  exposed: boolean;
  /** 조건 ① 내 타겟 처형(또는 포섭) — 한 번 이루면 유지 */
  targetDone: boolean;
  /** 조건 ② 상대 VIP 처형 — 한 번 이루면 유지 */
  vipDone: boolean;
  /** 검열 때문에 조건 ②를 이뤘는지 확신할 수 없다 */
  vipUncertain: boolean;
  famine: boolean;
  curfew: boolean;
  /** 상대가 위조 서신을 썼다 — 내 다음 정보 결과가 뒤집힌다 */
  forged: boolean;
  /** 다음에 내 기물이 처형되면 보도가 검열된다 */
  censor: boolean;
  silverActive: boolean;
  intel: IntelNote[];
  lastIncome: number;
}

export type ZoneId = 'outer' | 'mid' | 'court';

export interface NewsItem {
  id: number;
  turn: number;
  tag: string;
  title: string;
  body: string;
  zone: ZoneId | null;
  censored: boolean;
  tone: 'blood' | 'gold' | 'shadow' | 'earth';
}

export interface Grave {
  id: string;
  type: PieceType;
  owner: Faction;
  origin: Faction;
  militia: boolean;
  cause: DeathCause;
  turn: number;
}

export interface GameState {
  rng: number;
  round: number;
  /** 전체 차례 번호 (1부터, 양쪽 차례를 모두 셉니다) */
  turn: number;
  current: Faction;
  first: Faction;
  ap: number;
  pieces: Record<string, Piece>;
  orders: Record<Faction, Orders>;
  players: Record<Faction, PlayerState>;
  chronicle: NewsItem[];
  newsSeq: number;
  graveyard: Grave[];
  /** 공개적으로 VIP였다고 밝혀진 기물 */
  revealedVips: string[];
  winner: Faction | null;
  draw: boolean;
  endReason: string | null;
}

export type Action =
  | { kind: 'move'; piece: string; to: Cell }
  | { kind: 'execute'; piece: string; target: string }
  | { kind: 'bribe'; piece: string; target: string }
  | { kind: 'royal'; piece: string }
  | { kind: 'interrogate'; piece: string; target: string }
  | { kind: 'bless'; piece: string; target: string }
  | { kind: 'card'; card: CardId; pieces?: string[]; cell?: Cell }
  | { kind: 'end' };

export type DeathCause = 'execute' | 'poison' | 'switch' | 'double';

export type GameEvent =
  | { type: 'round_start'; round: number; first: Faction }
  | { type: 'turn_start'; faction: Faction; turn: number; income: number; ap: number; famine: boolean; curfew: boolean }
  | { type: 'move'; piece: string; from: Cell; to: Cell; shadow: boolean }
  | { type: 'attack'; attacker: string | null; target: string; by: Faction }
  | { type: 'blocked'; target: string }
  | { type: 'death'; piece: string; pieceType: PieceType; owner: Faction; at: Cell; cause: DeathCause; killer: Faction }
  | { type: 'double'; original: string; substitute: string }
  | { type: 'vip_revealed'; piece: string; owner: Faction }
  | { type: 'news'; item: NewsItem }
  | { type: 'bribe'; actor: string; target: string; cost: number; result: 'ok' | 'vip' | 'oath'; by: Faction }
  | { type: 'exposed'; piece: string }
  | { type: 'interrogate'; actor: string; target: string }
  | { type: 'intel'; note: IntelNote }
  | { type: 'card'; faction: Faction; card: CardId | null }
  | { type: 'royal'; lord: string; rooted: string[]; buffed: string[] }
  | { type: 'bless'; priest: string; target: string; cured: boolean }
  | { type: 'poisoned'; target: string; by: Faction }
  | { type: 'conscript'; piece: string }
  | { type: 'tax'; faction: Faction; amount: number }
  | { type: 'famine'; against: Faction }
  | { type: 'curfew'; against: Faction }
  | { type: 'silver'; faction: Faction }
  | { type: 'secret'; card: CardId; piece: string | null }
  | { type: 'target_changed'; target: string; reason: 'decree' | 'lost' }
  | { type: 'vip_changed'; vip: string }
  | { type: 'condition'; which: 'target' | 'vip'; state: 'done' | 'unknown' }
  | { type: 'timeout'; faction: Faction }
  | { type: 'round_end'; winner: Faction | null; reason: string; orders: Record<Faction, Orders> };

/** 엔진이 만든 사건과, 그 사건을 볼 수 있는 쪽 */
export interface Emitted { vis: 'all' | Faction; ev: GameEvent }
