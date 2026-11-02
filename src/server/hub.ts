/**
 * 접속, 닉네임, 빠른 대전 대기열, 방 코드, 재접속을 관리합니다.
 */
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import type { ClientMsg, ServerMsg } from '../shared/protocol';
import { NAME_MAX, PROTOCOL_VERSION, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '../shared/protocol';
import type { Faction } from '../shared/types';
import { FACTIONS } from '../shared/types';
import { Match, type Timings } from './match';

interface Client {
  token: string;
  name: string;
  socket: WebSocket | null;
  match: Match | null;
  faction: Faction | null;
  room: string | null;
  queuedAt: number | null;
  lastSeen: number;
  /** 도배 방지: 초당 20개까지, 순간 40개까지 */
  budget: number;
  budgetAt: number;
}

const DEFAULT_NAMES = ['이름 없는 자', '가면 쓴 손님', '익명의 후원자', '그림자 상인', '밤의 서기관'];

export function cleanName(raw: unknown): string {
  const s = typeof raw === 'string' ? raw : '';
  const cleaned = s.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
  return cleaned || DEFAULT_NAMES[randomInt(DEFAULT_NAMES.length)];
}

export function cleanCode(raw: unknown): string {
  return (typeof raw === 'string' ? raw : '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, ROOM_CODE_LENGTH);
}

export class Hub {
  private readonly byToken = new Map<string, Client>();
  private readonly bySocket = new Map<WebSocket, Client>();
  private readonly queue: Client[] = [];
  private readonly rooms = new Map<string, Client>();
  readonly matches = new Map<string, Match>();
  private readonly sweeper: NodeJS.Timeout;

  constructor(private readonly timings: Timings, private readonly random: () => number = Math.random) {
    this.sweeper = setInterval(() => this.sweep(), 60_000);
    this.sweeper.unref?.();
  }

  get online(): number {
    return [...this.byToken.values()].filter((c) => c.socket).length;
  }

  attach(ws: WebSocket) {
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      let msg: ClientMsg;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return this.raw(ws, { t: 'error', message: '메시지를 읽을 수 없다.' });
      }
      if (!msg || typeof msg !== 'object' || typeof (msg as { t?: unknown }).t !== 'string') return;
      this.handle(ws, msg);
    });
    ws.on('close', () => this.onClose(ws));
    ws.on('error', () => this.onClose(ws));
  }

  private raw(ws: WebSocket, msg: ServerMsg) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }

  private send(c: Client, msg: ServerMsg) {
    if (c.socket) this.raw(c.socket, msg);
  }

  private seatFor(c: Client) {
    const hub = this;
    return {
      get name() { return c.name; },
      get connected() { return c.socket !== null; },
      send(msg: ServerMsg) { hub.send(c, msg); },
    };
  }

  private handle(ws: WebSocket, msg: ClientMsg) {
    if (msg.t === 'hello') return this.hello(ws, msg);
    const c = this.bySocket.get(ws);
    if (!c) return this.raw(ws, { t: 'error', message: '먼저 이름을 알려 달라.' });
    const now = Date.now();
    c.lastSeen = now;
    c.budget = Math.min(40, c.budget + ((now - c.budgetAt) / 1000) * 20);
    c.budgetAt = now;
    if (c.budget < 1) return;
    c.budget -= 1;

    switch (msg.t) {
      case 'ping':
        return this.send(c, { t: 'pong', serverNow: Date.now() });
      case 'quick':
        return this.quick(c);
      case 'cancel':
        this.unqueue(c);
        this.closeRoom(c);
        return this.send(c, { t: 'lobby', online: this.online });
      case 'create_room':
        return this.createRoom(c);
      case 'join_room':
        return this.joinRoom(c, cleanCode(msg.code));
      case 'action': {
        if (!c.match || !c.faction) return this.send(c, { t: 'error', message: '대전 중이 아니다.' });
        const err = c.match.act(c.faction, msg.action);
        if (err) this.send(c, { t: 'error', message: err });
        return;
      }
      case 'resign':
        if (c.match && c.faction) c.match.resign(c.faction);
        return;
      case 'rematch':
        return this.rematch(c);
      case 'leave':
        return this.leaveMatch(c);
    }
  }

  private hello(ws: WebSocket, msg: Extract<ClientMsg, { t: 'hello' }>) {
    if (msg.v !== PROTOCOL_VERSION) {
      return this.raw(ws, { t: 'error', message: '게임 버전이 다르다. 새로 고침해 달라.' });
    }
    const existing = this.bySocket.get(ws);
    if (existing) return;
    const name = cleanName(msg.name);
    let c = msg.token ? this.byToken.get(msg.token) : undefined;
    let resumed = false;
    if (c) {
      if (c.socket && c.socket !== ws) {
        this.bySocket.delete(c.socket);
        try { c.socket.close(4000, 'replaced'); } catch { /* 이미 닫힘 */ }
      }
      c.socket = ws;
      if (!c.match) c.name = name;
      resumed = true;
    } else {
      c = {
        token: randomBytes(18).toString('base64url'), name, socket: ws, match: null, faction: null,
        room: null, queuedAt: null, lastSeen: Date.now(), budget: 40, budgetAt: Date.now(),
      };
      this.byToken.set(c.token, c);
    }
    c.lastSeen = Date.now();
    this.bySocket.set(ws, c);
    this.send(c, { t: 'welcome', token: c.token, name: c.name, online: this.online, resumed });

    if (c.match && c.faction && !c.match.hasLeft(c.faction)) {
      c.match.reconnect(c.faction);
    } else if (c.queuedAt) {
      this.send(c, { t: 'queued', since: c.queuedAt });
    } else if (c.room) {
      this.send(c, { t: 'room', code: c.room });
    } else {
      c.match = null;
      c.faction = null;
      this.send(c, { t: 'lobby', online: this.online });
    }
  }

  private busy(c: Client): boolean {
    if (c.match && c.match.phase !== 'over') {
      this.send(c, { t: 'error', message: '이미 대전 중이다.' });
      return true;
    }
    if (c.match) this.leaveMatch(c, false);
    return false;
  }

  private quick(c: Client) {
    if (this.busy(c)) return;
    this.closeRoom(c);
    if (c.queuedAt) return this.send(c, { t: 'queued', since: c.queuedAt });
    const partner = this.queue.find((q) => q !== c && q.socket);
    if (partner) {
      this.unqueue(partner);
      this.startMatch(partner, c);
      return;
    }
    c.queuedAt = Date.now();
    this.queue.push(c);
    this.send(c, { t: 'queued', since: c.queuedAt });
  }

  private unqueue(c: Client) {
    const i = this.queue.indexOf(c);
    if (i >= 0) this.queue.splice(i, 1);
    c.queuedAt = null;
  }

  private newCode(): string {
    for (;;) {
      let code = '';
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
      if (!this.rooms.has(code)) return code;
    }
  }

  private createRoom(c: Client) {
    if (this.busy(c)) return;
    this.unqueue(c);
    this.closeRoom(c);
    const code = this.newCode();
    c.room = code;
    this.rooms.set(code, c);
    this.send(c, { t: 'room', code });
  }

  private closeRoom(c: Client) {
    if (c.room && this.rooms.get(c.room) === c) this.rooms.delete(c.room);
    c.room = null;
  }

  private joinRoom(c: Client, code: string) {
    if (this.busy(c)) return;
    const host = this.rooms.get(code);
    if (!host || !host.socket) return this.send(c, { t: 'error', message: '그런 방이 없다. 코드를 다시 확인해 달라.' });
    if (host === c) return this.send(c, { t: 'error', message: '내가 만든 방이다. 친구에게 코드를 보내 달라.' });
    this.unqueue(c);
    this.closeRoom(c);
    this.closeRoom(host);
    this.startMatch(host, c);
  }

  private startMatch(a: Client, b: Client, keepSides?: Record<Faction, Client>) {
    const sides: Record<Faction, Client> = keepSides ?? (this.random() < 0.5 ? { blue: a, red: b } : { blue: b, red: a });
    const id = randomUUID();
    const match = new Match(
      id,
      { blue: this.seatFor(sides.blue), red: this.seatFor(sides.red) },
      this.timings,
      this.random,
      () => { /* 끝난 매치는 다시 하기를 위해 잠시 남겨 둔다 */ },
    );
    this.matches.set(id, match);
    for (const f of FACTIONS) {
      sides[f].match = match;
      sides[f].faction = f;
      sides[f].queuedAt = null;
      sides[f].room = null;
    }
    match.start();
  }

  private rematch(c: Client) {
    const m = c.match;
    if (!m || !c.faction) return;
    if (!m.voteRematch(c.faction)) return;
    const clients = [...this.byToken.values()].filter((x) => x.match === m);
    const blue = clients.find((x) => x.faction === 'blue');
    const red = clients.find((x) => x.faction === 'red');
    if (!blue || !red) return;
    this.matches.delete(m.id);
    m.clearTimers();
    // 다시 할 때는 진영을 바꾼다
    this.startMatch(blue, red, { blue: red, red: blue });
  }

  private leaveMatch(c: Client, notify = true) {
    const m = c.match;
    if (m && c.faction) {
      if (m.phase !== 'over') m.resign(c.faction);
      m.leave(c.faction);
      const others = [...this.byToken.values()].filter((x) => x !== c && x.match === m && !m.hasLeft(x.faction!));
      if (!others.length) { m.clearTimers(); this.matches.delete(m.id); }
    }
    c.match = null;
    c.faction = null;
    if (notify) this.send(c, { t: 'lobby', online: this.online });
  }

  private onClose(ws: WebSocket) {
    const c = this.bySocket.get(ws);
    if (!c) return;
    this.bySocket.delete(ws);
    if (c.socket !== ws) return;
    c.socket = null;
    c.lastSeen = Date.now();
    this.unqueue(c);
    this.closeRoom(c);
    if (c.match && c.faction) c.match.disconnect(c.faction);
  }

  /** 오래 떠나 있는 접속 기록 정리 */
  private sweep() {
    const now = Date.now();
    for (const [token, c] of this.byToken) {
      if (c.socket) continue;
      const inLiveMatch = c.match && c.match.phase !== 'over';
      if (!inLiveMatch && now - c.lastSeen > 10 * 60_000) {
        if (c.match && c.faction) this.leaveMatch(c, false);
        this.byToken.delete(token);
      }
    }
  }

  close() {
    clearInterval(this.sweeper);
    for (const m of this.matches.values()) m.clearTimers();
  }
}
