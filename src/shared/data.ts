/** 규칙 수치와 기물·카드·구역 정의. 밸런스는 이 파일의 숫자만 바꾸면 됩니다. */
import type { CardId, Faction, PieceType, ZoneId } from './types';

export const N = 10;
export const AP_PER_TURN = 3;
export const MAX_TURNS_EACH = 20;
/** 매수는 자기 차례를 이만큼 끝낸 뒤부터 (= 4번째 차례부터) */
export const BRIBE_AFTER_TURNS = 3;
export const INCOME_PER_SERF = 2;
export const TAX_PER_SERF = 3;
export const HAND_SIZE = 5;
export const TURN_SECONDS = 60;
export const TIMEOUTS_TO_LOSE = 3;
export const RECONNECT_SECONDS = 60;
export const WINS_TO_TAKE_MATCH = 2;

export const BRIBE_COST = { serf: 3, court: 6 } as const;
export const SPY_DISCOUNT = 3;
export const BRIBE_MIN = 2;
export const SHADOW_RANGE = 4;

export const FACTION_NAME: Record<Faction, string> = { blue: '청실', red: '홍실' };
export const FACTION_FULL: Record<Faction, string> = { blue: '청실 신디케이트', red: '홍실 신디케이트' };

export type MovePattern = 'any' | 'line' | 'diag';
export type Ability = 'royal' | 'interrogate' | 'bless';

export interface PieceDef {
  name: string;
  move: { pattern: MovePattern; range: number };
  exec: number;
  court: boolean;
  ability: Ability | null;
  role: string;
}

export const PIECES: Record<PieceType, PieceDef> = {
  lord: { name: '군주', move: { pattern: 'any', range: 1 }, exec: 1, court: true, ability: 'royal',
    role: '전장의 규칙을 바꾸는 자. 매수되지 않는다.' },
  paladin: { name: '성기사', move: { pattern: 'line', range: 2 }, exec: 1, court: true, ability: null,
    role: '군주의 지휘를 받으면 칼끝이 한 칸 더 닿는다.' },
  assassin: { name: '자객', move: { pattern: 'diag', range: 3 }, exec: 2, court: true, ability: null,
    role: '대각선의 그림자. 두 칸 밖에서 목을 노린다.' },
  spy: { name: '첩자', move: { pattern: 'any', range: 2 }, exec: 1, court: true, ability: 'interrogate',
    role: '매수가 싸고, 붙어 있는 적이 VIP인지 캐낸다.' },
  archer: { name: '궁수', move: { pattern: 'line', range: 1 }, exec: 3, court: true, ability: null,
    role: '느리지만 세 칸 밖까지 화살이 닿는다.' },
  priest: { name: '사제', move: { pattern: 'any', range: 1 }, exec: 0, court: true, ability: 'bless',
    role: '칼을 들지 않는다. 축복으로 아군을 한 번 지킨다.' },
  serf: { name: '농노', move: { pattern: 'any', range: 1 }, exec: 0, court: false, ability: null,
    role: '사람이 곧 돈이다. 차례마다 루렌을 낸다.' },
};

export const ABILITY_INFO: Record<Ability, { name: string; ap: number; text: string }> = {
  royal: { name: '왕가의 지휘', ap: 2, text: '주변 8칸의 적은 다음 차례에 움직일 수 없고, 붙어 있는 성기사는 처형 사거리가 1 늘어난다.' },
  interrogate: { name: '심문', ap: 2, text: '붙어 있는 적 궁정 기물 하나가 VIP인지 캐낸다.' },
  bless: { name: '축복', ap: 1, text: '붙어 있는 아군 하나에 대한 처형을 상대의 다음 차례 동안 한 번 막는다. 독도 푼다.' },
};

/** 궁정 기물 배치 순서 (2~7열) */
export const COURT_ORDER: PieceType[] = ['archer', 'assassin', 'lord', 'priest', 'spy', 'paladin'];
export const COURT_COL0 = 2;
export const SERF_COUNT = 4;
export const SERF_COL0 = 3;
/** 진영별 출발 줄: [궁정 줄, 농노 줄] */
export const HOME_ROWS: Record<Faction, [number, number]> = { blue: [0, 1], red: [9, 8] };

export type CardAxis = 'intel' | 'economy' | 'loyalty' | 'assassination';
export type CardTargeting =
  | 'none'
  | 'own'            // 내 기물 하나
  | 'ownSerf'        // 내 농노 하나
  | 'ownAssassinCell'// 내 자객 하나 + 빈칸
  | 'enemy3'         // 적 기물 셋
  | 'poison';        // 내 기물에 붙어 있는 적 하나

export interface CardDef {
  id: CardId;
  name: string;
  axis: CardAxis;
  cost: number;
  ap: number;
  secret: boolean;
  targeting: CardTargeting;
  text: string;
  flavor: string;
}

export const CARDS: Record<CardId, CardDef> = {
  switch: { id: 'switch', name: '암살 후 변경', axis: 'intel', cost: 8, ap: 1, secret: false, targeting: 'none',
    text: '내 VIP가 노출됐을 때만 쓸 수 있다. 노출된 VIP를 내 손으로 처형하고, 새 VIP를 비공개로 받는다.',
    flavor: '너무 많이 알려진 얼굴은 지워야 한다.' },
  report: { id: 'report', name: '밀정의 보고', axis: 'intel', cost: 4, ap: 1, secret: true, targeting: 'enemy3',
    text: '적 기물 셋을 고른다. 그중에 VIP가 있는지만 알려 준다.',
    flavor: '셋 중 하나는 거짓말을 하고 있다.' },
  forgery: { id: 'forgery', name: '위조 서신', axis: 'intel', cost: 5, ap: 0, secret: true, targeting: 'none',
    text: '상대가 다음에 얻는 정보(밀정의 보고, 심문)의 결과가 반대로 나온다. 상대는 모른다.',
    flavor: '봉랍은 진짜다. 내용은 아니다.' },
  censor: { id: 'censor', name: '검열', axis: 'intel', cost: 4, ap: 0, secret: true, targeting: 'none',
    text: '다음에 내 기물이 처형되면 궁정 신문이 검열된다. 그 기물이 VIP였어도 상대는 알 수 없다.',
    flavor: '잉크는 피보다 빨리 마른다.' },
  decree: { id: 'decree', name: '봉인된 칙령', axis: 'intel', cost: 4, ap: 0, secret: true, targeting: 'none',
    text: '내 타겟을 다른 적 궁정 기물로 무작위로 바꾼다.',
    flavor: '명단의 이름이 바뀌었다. 칼은 그대로다.' },
  tax: { id: 'tax', name: '세금 징수', axis: 'economy', cost: 0, ap: 1, secret: false, targeting: 'none',
    text: '루렌을 (내 농노 수 × 3)만큼 걷는다.',
    flavor: '들녘은 마르고, 금고는 찬다.' },
  famine: { id: 'famine', name: '흉년', axis: 'economy', cost: 5, ap: 0, secret: false, targeting: 'none',
    text: '상대의 다음 차례 수입이 0이 된다.',
    flavor: '곳간의 쥐도 굶는 해.' },
  conscript: { id: 'conscript', name: '징집령', axis: 'economy', cost: 2, ap: 1, secret: false, targeting: 'ownSerf',
    text: '내 농노 하나가 민병이 된다. 처형 사거리 1이 생기지만 수입은 내지 않는다.',
    flavor: '쟁기를 놓고 창을 들어라.' },
  oath: { id: 'oath', name: '충성 서약', axis: 'loyalty', cost: 4, ap: 0, secret: true, targeting: 'own',
    text: '내 기물 하나는 이 판이 끝날 때까지 매수되지 않는다.',
    flavor: '피로 쓴 이름은 금으로 지울 수 없다.' },
  silver: { id: 'silver', name: '은화 서른 닢', axis: 'loyalty', cost: 2, ap: 0, secret: false, targeting: 'none',
    text: '이번 차례의 매수 한 번은 비용이 절반이고, 두 칸 거리까지 닿는다.',
    flavor: '값은 늘 서른 닢이었다.' },
  poison: { id: 'poison', name: '독배', axis: 'assassination', cost: 7, ap: 1, secret: false, targeting: 'poison',
    text: '내 기물에 붙어 있는 적 하나에 독을 탄다. 상대의 다음 차례가 끝날 때 죽는다. 그 전에 축복을 받으면 풀린다.',
    flavor: '건배는 두 번 하지 않는다.' },
  shadow: { id: 'shadow', name: '그림자 걸음', axis: 'assassination', cost: 3, ap: 0, secret: false, targeting: 'ownAssassinCell',
    text: '내 자객을 네 칸 안의 빈칸으로 옮긴다. 막힌 길도 넘는다.',
    flavor: '등불이 꺼진 사이에.' },
  double: { id: 'double', name: '대역', axis: 'assassination', cost: 5, ap: 0, secret: true, targeting: 'own',
    text: '내 기물 하나에 대역을 붙인다. 이 기물이 처음 처형될 때 붙어 있는 내 농노가 대신 죽는다.',
    flavor: '같은 옷, 다른 목숨.' },
  curfew: { id: 'curfew', name: '통금령', axis: 'assassination', cost: 6, ap: 0, secret: false, targeting: 'none',
    text: '상대의 다음 차례 AP가 1 줄어든다.',
    flavor: '해가 지면 아무도 문을 열지 않는다.' },
};

/** '암살 후 변경'은 판마다 고정으로 받고, 나머지는 이 중에서 무작위 */
export const CARD_POOL: CardId[] = (Object.keys(CARDS) as CardId[]).filter((c) => c !== 'switch');

export const AXIS_NAME: Record<CardAxis, string> = {
  intel: '정보', economy: '경제', loyalty: '충성', assassination: '암살',
};

export const zoneOf = (r: number): ZoneId => (r <= 1 || r >= 8 ? 'outer' : r <= 3 || r >= 6 ? 'mid' : 'court');

export const ZONES: Record<ZoneId, { name: string; places: string[] }> = {
  outer: { name: '외곽 농지', places: ['성문 밖 들녘', '변두리 마을', '물방앗간 길', '진흙 장터', '버려진 곡물 창고'] },
  mid: { name: '성벽 회랑', places: ['성벽 회랑', '중앙 연병장', '무기고 뒤뜰', '회색 계단', '경비대 초소'] },
  court: { name: '궁정 중심부', places: ['왕좌의 그림자', '대회랑', '거울의 방', '향 피우는 예배당', '연회장'] },
};

export const COLS = 'ABCDEFGHIJ';
