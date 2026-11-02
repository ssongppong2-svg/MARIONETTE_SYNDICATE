/** 화면 ↔ 서버 메시지 */
import type { Action, Faction, GameEvent, Orders } from './types';
import type { PlayerView } from './view';

export const PROTOCOL_VERSION = 1;
export const NAME_MAX = 12;
export const ROOM_CODE_LENGTH = 6;
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export type ClientMsg =
  | { t: 'hello'; name: string; token?: string; v: number }
  | { t: 'quick' }
  | { t: 'cancel' }
  | { t: 'create_room' }
  | { t: 'join_room'; code: string }
  | { t: 'action'; action: Action }
  | { t: 'resign' }
  | { t: 'rematch' }
  | { t: 'leave' }
  | { t: 'ping' };

export interface MatchInfo {
  id: string;
  you: Faction;
  names: Record<Faction, string>;
  scores: Record<Faction, number>;
  /** 이번이 몇 번째 판인지 (재경기 포함) */
  roundNo: number;
  replay: boolean;
}

export type OpponentStatus = 'online' | 'away' | 'left';

export type ServerMsg =
  | { t: 'welcome'; token: string; name: string; online: number; resumed: boolean }
  | { t: 'lobby'; online: number; notice?: string }
  | { t: 'queued'; since: number }
  | { t: 'room'; code: string }
  | {
      t: 'state';
      match: MatchInfo;
      view: PlayerView;
      events: GameEvent[];
      /** 지금 차례가 끝나는 시각 (서버 시계, ms) */
      deadline: number | null;
      serverNow: number;
      opponent: OpponentStatus;
    }
  | {
      t: 'round_over';
      match: MatchInfo;
      winner: Faction | null;
      reason: string;
      orders: Record<Faction, Orders>;
      nextAt: number | null;
      serverNow: number;
    }
  | { t: 'match_over'; match: MatchInfo; winner: Faction; reason: string }
  | { t: 'opponent'; status: OpponentStatus; graceUntil: number | null; serverNow: number }
  | { t: 'rematch'; status: 'asked' | 'waiting' | 'declined' }
  | { t: 'error'; message: string }
  | { t: 'pong'; serverNow: number };
