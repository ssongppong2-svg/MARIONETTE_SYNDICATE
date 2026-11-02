/**
 * 대전 서버 연결. 끊기면 스스로 다시 붙고, 같은 토큰으로 대전을 이어 갑니다.
 * 서버 주소는 기본적으로 이 페이지와 같은 곳의 /ws 이고,
 * ?server=wss://… 또는 저장된 값으로 바꿀 수 있습니다 (스팀 빌드 등).
 */
import type { ClientMsg, ServerMsg } from '../shared/protocol';
import { PROTOCOL_VERSION } from '../shared/protocol';
import { storeGet, storeSet } from './settings';

export type NetStatus = 'connecting' | 'open' | 'closed';

const TOKEN_KEY = 'ms.token';
const SERVER_KEY = 'ms.server';

function serverUrl(): string {
  const q = new URLSearchParams(location.search).get('server');
  if (q) storeSet(SERVER_KEY, q);
  const saved = q ?? storeGet(SERVER_KEY);
  if (saved) return saved;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}

export class Net {
  private ws: WebSocket | null = null;
  private retry = 0;
  private timer: number | null = null;
  private pingTimer: number | null = null;
  private wantOpen = false;
  status: NetStatus = 'closed';
  /** 서버 시계 − 내 시계 (ms) */
  clockOffset = 0;
  name = '';

  constructor(
    private readonly onMessage: (m: ServerMsg) => void,
    private readonly onStatus: (s: NetStatus, retryIn: number | null) => void,
  ) {}

  get token(): string | null { return storeGet(TOKEN_KEY); }

  connect(name: string) {
    this.name = name;
    this.wantOpen = true;
    this.open();
  }

  private open() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    this.setStatus('connecting', null);
    let ws: WebSocket;
    try {
      ws = new WebSocket(serverUrl());
    } catch {
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.setStatus('open', null);
      this.send({ t: 'hello', name: this.name, token: this.token ?? undefined, v: PROTOCOL_VERSION });
      this.pingTimer = window.setInterval(() => this.send({ t: 'ping' }), 20_000);
    };
    ws.onmessage = (e) => {
      let msg: ServerMsg;
      try { msg = JSON.parse(String(e.data)); } catch { return; }
      if (msg.t === 'welcome') storeSet(TOKEN_KEY, msg.token);
      if ('serverNow' in msg && typeof msg.serverNow === 'number') this.clockOffset = msg.serverNow - Date.now();
      this.onMessage(msg);
    };
    ws.onclose = (e) => {
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = null;
      this.ws = null;
      if (e.code === 4000) { this.wantOpen = false; this.setStatus('closed', null); return; }
      if (this.wantOpen) this.scheduleRetry();
      else this.setStatus('closed', null);
    };
  }

  private scheduleRetry() {
    const wait = Math.min(8000, 600 * 2 ** this.retry) + Math.random() * 300;
    this.retry += 1;
    this.setStatus('closed', wait);
    if (this.timer) clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.open(), wait);
  }

  private setStatus(s: NetStatus, retryIn: number | null) {
    this.status = s;
    this.onStatus(s, retryIn);
  }

  send(msg: ClientMsg): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  /** 서버 시계 기준 지금 */
  now(): number { return Date.now() + this.clockOffset; }

  retryNow() {
    if (this.timer) clearTimeout(this.timer);
    this.retry = 0;
    this.open();
  }
}
