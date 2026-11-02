/**
 * AI 대전: 서버 없이 이 브라우저 안에서 매치를 돌립니다.
 * 온라인 대전과 똑같은 Match와 메시지를 쓰므로, 대전 화면은 상대가 사람인지 AI인지 모릅니다.
 * AI도 자기 화면용 상태만 받습니다.
 */
import { decide, type AiLevel } from '../shared/ai';
import { Match } from '../shared/match';
import type { ClientMsg, ServerMsg } from '../shared/protocol';
import { isMyTurn } from '../shared/rules';
import type { Faction } from '../shared/types';
import { other } from '../shared/types';
import type { PlayerView } from '../shared/view';

/** 대전 화면이 말을 거는 상대: 서버(Net) 또는 이 브라우저(LocalLink) */
export interface Link {
  send(msg: ClientMsg): boolean;
  now(): number;
}

export const AI_NAMES: Record<AiLevel, string> = {
  easy: '견습 인형사',
  normal: '궁정 인형사',
  hard: '그림자 인형사',
};

export class LocalLink implements Link {
  private match: Match | null = null;
  private human: Faction;
  private aiTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(
    private readonly deliver: (m: ServerMsg) => void,
    private readonly playerName: string,
    private readonly level: AiLevel,
  ) {
    this.human = Math.random() < 0.5 ? 'blue' : 'red';
  }

  get opponentName() { return AI_NAMES[this.level]; }

  start() {
    const human = this.human;
    const ai = other(human);
    const seats = {
      [human]: { name: this.playerName || '이름 없는 자', connected: true, send: (m: ServerMsg) => this.toHuman(m) },
      [ai]: { name: this.opponentName, connected: true, send: (m: ServerMsg) => this.toAi(m) },
    } as Record<Faction, { name: string; connected: boolean; send(m: ServerMsg): void }>;
    this.match = new Match(
      `local-${Date.now()}`, seats, { turnMs: 0, roundBreakMs: 9000, graceMs: 0 }, Math.random, () => {},
    );
    this.match.start();
  }

  private toHuman(m: ServerMsg) {
    if (this.disposed) return;
    // 같은 흐름 안에서 바로 화면을 바꾸지 않도록 다음 틈에 넘긴다
    queueMicrotask(() => { if (!this.disposed) this.deliver(m); });
  }

  private toAi(m: ServerMsg) {
    if (this.disposed || m.t !== 'state') return;
    if (this.aiTimer) clearTimeout(this.aiTimer);
    this.aiTimer = null;
    const v = m.view;
    if (v.phase === 'deploy') {
      // 배치는 사람과 동시에 한다. 사람이 지령서를 읽는 동안 조용히 놓는다.
      if (!v.deployed[v.you]) this.aiTimer = setTimeout(() => this.think(v), 1200);
      return;
    }
    if (!isMyTurn(v)) return;
    // 사람이 연출을 따라올 수 있게 잠시 생각하는 척한다
    const roundStart = m.events.some((e) => e.type === 'round_start' || e.type === 'reveal');
    const turnStart = m.events.some((e) => e.type === 'turn_start');
    const delay = roundStart ? 2600 : (turnStart ? 1500 : 650) + m.events.length * 380;
    this.aiTimer = setTimeout(() => this.think(v), delay);
  }

  private think(v: PlayerView) {
    this.aiTimer = null;
    if (this.disposed || !this.match) return;
    const action = decide(v, this.level);
    const err = this.match.act(v.you, action);
    if (err) this.match.act(v.you, { kind: 'end' });
  }

  send(msg: ClientMsg): boolean {
    const m = this.match;
    if (this.disposed || !m) return false;
    switch (msg.t) {
      case 'action': {
        const err = m.act(this.human, msg.action);
        if (err) this.toHuman({ t: 'error', message: err });
        return true;
      }
      case 'resign':
        m.resign(this.human);
        return true;
      case 'rematch':
        if (m.phase !== 'over') return true;
        // 다시 할 때는 진영을 바꾼다
        m.clearTimers();
        this.human = other(this.human);
        this.start();
        return true;
      case 'leave':
        this.dispose();
        return true;
      default:
        return true;
    }
  }

  now() { return Date.now(); }

  dispose() {
    this.disposed = true;
    if (this.aiTimer) clearTimeout(this.aiTimer);
    this.match?.clearTimers();
    this.match = null;
  }
}
