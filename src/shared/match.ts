/**
 * 한 매치(3판 2선승)의 진행. 판정과 비밀 정보는 모두 여기에만 있습니다.
 * 온라인에서는 서버가, AI 대전에서는 브라우저가 이것을 돌립니다.
 * 각 플레이어에게는 viewFor()로 걸러 낸 화면용 상태와, 볼 수 있는 사건만 보냅니다.
 */
import { WINS_TO_TAKE_MATCH } from './data';
import { apply, createRound, eventsFor, forfeit, timeout } from './engine';
import { josa } from './korean';
import type { MatchInfo, OpponentStatus, ServerMsg } from './protocol';
import type { Action, Emitted, Faction, GameState } from './types';
import { FACTIONS, other } from './types';
import { viewFor } from './view';

type Timer = ReturnType<typeof setTimeout>;

export interface Timings {
  /** 0이면 차례 시간 제한이 없다 (AI 대전) */
  turnMs: number;
  /** 배치 단계 시간. 0이면 제한 없음 */
  deployMs?: number;
  roundBreakMs: number;
  graceMs: number;
}

export interface Seat {
  name: string;
  connected: boolean;
  send(msg: ServerMsg): void;
}

type Phase = 'playing' | 'between' | 'over';

export class Match {
  readonly scores: Record<Faction, number> = { blue: 0, red: 0 };
  roundNo = 0;
  replay = false;
  phase: Phase = 'playing';
  state!: GameState;
  deadline: number | null = null;
  winner: Faction | null = null;
  readonly rematchVotes = new Set<Faction>();

  private nextFirst: Faction;
  private turnTimer: Timer | null = null;
  private breakTimer: Timer | null = null;
  private nextAt: number | null = null;
  private readonly grace: Partial<Record<Faction, { timer: Timer; until: number }>> = {};
  private left = new Set<Faction>();

  constructor(
    readonly id: string,
    readonly seats: Record<Faction, Seat>,
    private readonly timings: Timings,
    private readonly random: () => number,
    private readonly onFinished: (m: Match) => void,
  ) {
    this.nextFirst = random() < 0.5 ? 'blue' : 'red';
  }

  info(f: Faction): MatchInfo {
    return {
      id: this.id, you: f,
      names: { blue: this.seats.blue.name, red: this.seats.red.name },
      scores: { ...this.scores }, roundNo: this.roundNo, replay: this.replay,
    };
  }

  private opponentStatus(f: Faction): OpponentStatus {
    const o = other(f);
    if (this.left.has(o)) return 'left';
    return this.seats[o].connected ? 'online' : 'away';
  }

  start() {
    this.startRound();
  }

  private startRound() {
    this.roundNo += 1;
    this.phase = 'playing';
    this.nextAt = null;
    const first = this.nextFirst;
    this.nextFirst = other(first);
    const seed = Math.floor(this.random() * 2 ** 32);
    const { state, out } = createRound({ seed, round: this.roundNo, first });
    this.state = state;
    this.resetTurnTimer();
    this.broadcast(out);
  }

  /** 상태와 사건을 두 사람에게 보낸다 */
  private broadcast(out: Emitted[]) {
    const now = Date.now();
    for (const f of FACTIONS) {
      this.seats[f].send({
        t: 'state', match: this.info(f), view: viewFor(this.state, f), events: eventsFor(out, f),
        deadline: this.deadline, serverNow: now, opponent: this.opponentStatus(f),
      });
    }
  }

  /** 한 사람에게 지금 상태를 다시 보낸다 (재접속) */
  resend(f: Faction) {
    const now = Date.now();
    const seat = this.seats[f];
    if (this.phase === 'over' && this.winner) {
      seat.send({ t: 'state', match: this.info(f), view: viewFor(this.state, f), events: [], deadline: null, serverNow: now, opponent: this.opponentStatus(f) });
      seat.send({ t: 'match_over', match: this.info(f), winner: this.winner, reason: this.state.endReason ?? '' });
      return;
    }
    seat.send({
      t: 'state', match: this.info(f), view: viewFor(this.state, f), events: [],
      deadline: this.deadline, serverNow: now, opponent: this.opponentStatus(f),
    });
    if (this.phase === 'between') {
      seat.send({
        t: 'round_over', match: this.info(f), winner: this.state.winner, reason: this.state.endReason ?? '',
        orders: this.state.orders, nextAt: this.nextAt, serverNow: now,
      });
    }
  }

  private resetTurnTimer() {
    if (this.turnTimer) clearTimeout(this.turnTimer);
    this.turnTimer = null;
    const ms = this.state?.phase === 'deploy' ? (this.timings.deployMs ?? this.timings.turnMs) : this.timings.turnMs;
    if (this.phase !== 'playing' || ms <= 0) { this.deadline = null; return; }
    this.deadline = Date.now() + ms;
    this.turnTimer = setTimeout(() => this.onTurnTimeout(), ms);
  }

  private onTurnTimeout() {
    if (this.phase !== 'playing') return;
    const step = timeout(this.state);
    this.afterStep(step.out, true);
  }

  act(f: Faction, action: Action): string | null {
    if (this.phase !== 'playing') return '지금은 둘 수 없다.';
    // 배치는 두 사람이 동시에 한다. 그 밖의 행동은 자기 차례에만.
    if (action.kind !== 'deploy' && this.state.phase === 'deploy') return '아직 배치 중이다.';
    if (action.kind !== 'deploy' && this.state.current !== f) return '내 차례가 아니다.';
    const turnBefore = this.state.turn;
    const phaseBefore = this.state.phase;
    const res = apply(this.state, action, f);
    if (res.error) return res.error;
    this.afterStep(res.out, this.state.turn !== turnBefore || this.state.phase !== phaseBefore);
    return null;
  }

  private afterStep(out: Emitted[], newTurn: boolean) {
    const over = this.state.winner !== null || this.state.draw;
    if (over) {
      this.phase = 'between';
      this.resetTurnTimer();
    } else if (newTurn) {
      this.resetTurnTimer();
    }
    this.broadcast(out);
    if (over) this.finishRound();
  }

  private finishRound() {
    const w = this.state.winner;
    if (w) this.scores[w] += 1;
    this.replay = w === null;
    if (w && this.scores[w] >= WINS_TO_TAKE_MATCH) {
      this.endMatch(w, this.state.endReason ?? '');
      return;
    }
    this.nextAt = Date.now() + this.timings.roundBreakMs;
    const now = Date.now();
    for (const f of FACTIONS) {
      this.seats[f].send({
        t: 'round_over', match: this.info(f), winner: w, reason: this.state.endReason ?? '',
        orders: this.state.orders, nextAt: this.nextAt, serverNow: now,
      });
    }
    this.breakTimer = setTimeout(() => this.startRound(), this.timings.roundBreakMs);
  }

  private endMatch(winner: Faction, reason: string) {
    this.phase = 'over';
    this.winner = winner;
    this.clearTimers();
    for (const f of FACTIONS) {
      this.seats[f].send({ t: 'match_over', match: this.info(f), winner, reason });
    }
    this.onFinished(this);
  }

  /** 기권: 매치 전체를 진다 */
  resign(f: Faction) {
    if (this.phase === 'over') return;
    if (this.phase === 'playing') {
      const step = forfeit(this.state, f, '기권했다');
      this.phase = 'between';
      this.resetTurnTimer();
      this.broadcast(step.out);
    }
    this.endMatch(other(f), `${josa(this.seats[f].name, '이/가')} 기권했다`);
  }

  disconnect(f: Faction) {
    if (this.phase === 'over') {
      this.leave(f);
      return;
    }
    const until = Date.now() + this.timings.graceMs;
    const timer = setTimeout(() => {
      delete this.grace[f];
      if (this.phase === 'over') return;
      if (this.phase === 'playing') {
        const step = forfeit(this.state, f, '연결이 끊긴 채 돌아오지 않았다');
        this.phase = 'between';
        this.resetTurnTimer();
        this.broadcast(step.out);
      }
      this.left.add(f);
      this.endMatch(other(f), '상대가 돌아오지 않았다');
    }, this.timings.graceMs);
    this.grace[f] = { timer, until };
    this.seats[other(f)].send({ t: 'opponent', status: 'away', graceUntil: until, serverNow: Date.now() });
  }

  reconnect(f: Faction) {
    const g = this.grace[f];
    if (g) { clearTimeout(g.timer); delete this.grace[f]; }
    this.resend(f);
    this.seats[other(f)].send({ t: 'opponent', status: 'online', graceUntil: null, serverNow: Date.now() });
  }

  /** 매치가 끝난 뒤 로비로 나감 */
  leave(f: Faction) {
    this.left.add(f);
    this.rematchVotes.delete(f);
    const o = other(f);
    if (!this.left.has(o)) {
      this.seats[o].send({ t: 'opponent', status: 'left', graceUntil: null, serverNow: Date.now() });
      if (this.phase === 'over') this.seats[o].send({ t: 'rematch', status: 'declined' });
    }
  }

  /** 다시 하기에 두 사람이 모두 동의하면 true */
  voteRematch(f: Faction): boolean {
    if (this.phase !== 'over' || this.left.has(other(f))) {
      this.seats[f].send({ t: 'rematch', status: 'declined' });
      return false;
    }
    this.rematchVotes.add(f);
    if (this.rematchVotes.size === 2) return true;
    this.seats[f].send({ t: 'rematch', status: 'waiting' });
    this.seats[other(f)].send({ t: 'rematch', status: 'asked' });
    return false;
  }

  hasLeft(f: Faction) { return this.left.has(f); }

  clearTimers() {
    if (this.turnTimer) clearTimeout(this.turnTimer);
    if (this.breakTimer) clearTimeout(this.breakTimer);
    for (const f of FACTIONS) {
      const g = this.grace[f];
      if (g) clearTimeout(g.timer);
      delete this.grace[f];
    }
    this.turnTimer = null;
    this.breakTimer = null;
    this.deadline = null;
  }
}
