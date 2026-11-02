import { WebSocket } from 'ws';
import { PIECES } from '../src/shared/data';
import type { ClientMsg, ServerMsg } from '../src/shared/protocol';
import { PROTOCOL_VERSION } from '../src/shared/protocol';
import { cheb, execTargets, isMyTurn, reachable } from '../src/shared/rules';
import type { Action } from '../src/shared/types';
import type { PlayerView } from '../src/shared/view';

/** 테스트용 접속자 */
export class TestClient {
  readonly log: ServerMsg[] = [];
  private cursor = 0;
  private wake: (() => void) | null = null;
  token = '';

  private constructor(readonly ws: WebSocket) {
    ws.on('message', (d) => {
      this.log.push(JSON.parse(String(d)));
      this.wake?.();
    });
  }

  static async connect(port: number, name: string, token?: string): Promise<TestClient> {
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    await new Promise<void>((ok, fail) => { ws.once('open', () => ok()); ws.once('error', fail); });
    const c = new TestClient(ws);
    c.send({ t: 'hello', name, token, v: PROTOCOL_VERSION });
    const w = await c.waitFor((m) => m.t === 'welcome');
    if (w.t === 'welcome') c.token = w.token;
    return c;
  }

  send(msg: ClientMsg) { this.ws.send(JSON.stringify(msg)); }

  /** 아직 소비하지 않은 메시지 중 조건에 맞는 첫 메시지를 기다린다 */
  async waitFor<T extends ServerMsg['t']>(
    pred: (m: ServerMsg) => boolean, timeoutMs = 5000,
  ): Promise<Extract<ServerMsg, { t: T }> | ServerMsg> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      for (let i = this.cursor; i < this.log.length; i++) {
        if (pred(this.log[i])) { this.cursor = i + 1; return this.log[i]; }
      }
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`메시지를 기다리다 시간 초과. 마지막: ${JSON.stringify(this.log.slice(-3)).slice(0, 600)}`);
      await new Promise<void>((ok) => { const t = setTimeout(ok, left); this.wake = () => { clearTimeout(t); ok(); }; });
      this.wake = null;
    }
  }

  lastState(): Extract<ServerMsg, { t: 'state' }> | undefined {
    for (let i = this.log.length - 1; i >= 0; i--) {
      const m = this.log[i];
      if (m.t === 'state') return m;
    }
    return undefined;
  }

  close() { this.ws.close(); }
}

/** 아주 단순한 테스트 봇: 칠 수 있으면 치고, 아니면 가장 가까운 적에게 다가가고, 그것도 없으면 차례를 넘긴다 */
export function botMove(v: PlayerView): Action | null {
  if (!isMyTurn(v)) return null;
  const mine = v.pieces.filter((p) => p.owner === v.you);
  const foes = v.pieces.filter((p) => p.owner !== v.you);
  if (v.ap >= 1) {
    const prefer = [v.me.orders.target];
    for (const p of mine) {
      const ts = execTargets(v, p.id);
      if (!ts.length) continue;
      const t = ts.find((id) => prefer.includes(id)) ?? ts[0];
      return { kind: 'execute', piece: p.id, target: t };
    }
    let best: { piece: string; to: { r: number; c: number }; gain: number } | null = null;
    for (const p of mine) {
      if (PIECES[p.type].exec <= 0 && !p.militia) continue;
      const now = Math.min(...foes.map((f) => cheb(p, f)));
      for (const to of reachable(v, p.id)) {
        const d = Math.min(...foes.map((f) => cheb(to, f)));
        const gain = now - d;
        if (gain > 0 && (!best || gain > best.gain)) best = { piece: p.id, to, gain };
      }
    }
    if (best) return { kind: 'move', piece: best.piece, to: best.to };
  }
  return { kind: 'end' };
}

export const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
