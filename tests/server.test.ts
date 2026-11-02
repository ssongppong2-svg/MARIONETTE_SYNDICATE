import { afterEach, describe, expect, it } from 'vitest';
import { startServer } from '../src/server/main';
import type { ServerMsg } from '../src/shared/protocol';
import type { Faction } from '../src/shared/types';
import { botMove, sleep, TestClient } from './helpers';

type Running = Awaited<ReturnType<typeof startServer>>;
let server: Running | null = null;
const clients: TestClient[] = [];

async function boot(timings: { turnMs?: number; deployMs?: number; roundBreakMs?: number; graceMs?: number } = {}) {
  server = await startServer({ port: 0, staticDir: '/nonexistent', timings: { turnMs: 5000, roundBreakMs: 50, graceMs: 2000, ...timings } });
  return server.port;
}
async function join(port: number, name: string, token?: string) {
  const c = await TestClient.connect(port, name, token);
  clients.push(c);
  return c;
}
async function pair(port: number) {
  const a = await join(port, '가');
  const b = await join(port, '나');
  a.send({ t: 'quick' });
  await a.waitFor((m) => m.t === 'queued');
  b.send({ t: 'quick' });
  const sa = await a.waitFor((m) => m.t === 'state');
  const sb = await b.waitFor((m) => m.t === 'state');
  if (sa.t !== 'state' || sb.t !== 'state') throw new Error('state 아님');
  return { a, b, fa: sa.match.you, fb: sb.match.you };
}
/** 두 봇이 자기 차례마다 알아서 두게 한다 */
function autoplay(...cs: TestClient[]) {
  for (const c of cs) {
    c.ws.on('message', (d) => {
      const m = JSON.parse(String(d)) as ServerMsg;
      if (m.t !== 'state') return;
      const a = botMove(m.view);
      if (a) setImmediate(() => c.send({ t: 'action', action: a }));
    });
  }
}

afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  await server?.close();
  server = null;
});

describe('대전 서버', () => {
  it('빠른 대전으로 두 사람이 서로 다른 진영으로 묶인다', async () => {
    const port = await boot();
    const { a, b, fa, fb } = await pair(port);
    expect(fa).not.toBe(fb);
    const st = a.lastState()!;
    expect(st.match.names[fa]).toBe('가');
    expect(st.match.names[fb]).toBe('나');
    expect(st.deadline).toBeGreaterThan(Date.now());
    expect(b.lastState()!.view.you).toBe(fb);
  });

  it('상대의 지령은 판이 끝나기 전까지 어떤 메시지에도 실리지 않는다', async () => {
    const port = await boot();
    const { a, b } = await pair(port);
    autoplay(a, b);
    await a.waitFor((m) => m.t === 'round_over', 50000);
    const myOrders = (c: TestClient) => c.log.find((m) => m.t === 'state' && m.view.me.orders) as Extract<ServerMsg, { t: 'state' }>;
    const enemyVipOfA = myOrders(b).view.me.orders.vip;
    for (const m of a.log) {
      if (m.t === 'round_over' || m.t === 'match_over') break;
      if (m.t !== 'state') continue;
      expect(m.view.revealedOrders === null || m.view.winner !== null || m.view.draw).toBe(true);
      if (m.view.winner === null && !m.view.draw) {
        expect(JSON.stringify(m.view)).not.toContain(`"vip":"${enemyVipOfA}"`);
      }
      expect(m.view.me.hand.length).toBeLessThanOrEqual(5);
      expect(m.view.opponent).not.toHaveProperty('hand');
      expect(m.view.opponent).not.toHaveProperty('market');
    }
  }, 60000);

  it('방 코드로 친구와 대전한다 (틀린 코드는 거절)', async () => {
    const port = await boot();
    const host = await join(port, '주인');
    const guest = await join(port, '손님');
    host.send({ t: 'create_room' });
    const room = await host.waitFor((m) => m.t === 'room');
    if (room.t !== 'room') throw new Error();
    expect(room.code).toMatch(/^[A-Z0-9]{6}$/);
    guest.send({ t: 'join_room', code: 'ZZZZZZ' });
    const err = await guest.waitFor((m) => m.t === 'error');
    expect(err.t === 'error' && err.message).toContain('방이 없다');
    guest.send({ t: 'join_room', code: room.code.toLowerCase() });
    await host.waitFor((m) => m.t === 'state');
    await guest.waitFor((m) => m.t === 'state');
  });

  it('규칙에 어긋난 행동과 남의 차례 행동은 거절한다', async () => {
    const port = await boot();
    const { a, b, fa } = await pair(port);
    // 배치 단계에는 차례 행동을 받지 않는다
    a.send({ t: 'action', action: { kind: 'end' } });
    const e0 = await a.waitFor((m) => m.t === 'error');
    expect(e0.t === 'error' && e0.message).toContain('배치');
    for (const c of [a, b]) {
      const v = c.lastState()!.view;
      c.send({ t: 'action', action: botMove(v)! });
    }
    await a.waitFor((m) => m.t === 'state' && m.view.phase === 'play');
    await b.waitFor((m) => m.t === 'state' && m.view.phase === 'play');
    const st = a.lastState()!;
    const [first, second] = st.view.current === fa ? [a, b] : [b, a];
    second.send({ t: 'action', action: { kind: 'end' } });
    const e1 = await second.waitFor((m) => m.t === 'error');
    expect(e1.t === 'error' && e1.message).toContain('차례');
    first.send({ t: 'action', action: { kind: 'move', piece: 'zz', to: { r: 0, c: 0 } } });
    const e2 = await first.waitFor((m) => m.t === 'error');
    expect(e2.t === 'error' && e2.message).toBeTruthy();
  });

  it('두 봇이 매치를 끝까지 둔다 (3판 2선승)', async () => {
    const port = await boot();
    const { a, b } = await pair(port);
    autoplay(a, b);
    const end = await a.waitFor((m) => m.t === 'match_over', 110000);
    if (end.t !== 'match_over') throw new Error();
    expect(end.match.scores[end.winner]).toBe(2);
    const endB = await b.waitFor((m) => m.t === 'match_over');
    expect(endB.t === 'match_over' && endB.winner).toBe(end.winner);
    const rounds = a.log.filter((m) => m.t === 'round_over');
    for (const r of rounds) {
      if (r.t !== 'round_over') continue;
      expect(r.orders.blue.vip).toBeTruthy();
      expect(r.orders.red.target).toBeTruthy();
    }
  }, 120000);

  it('아무도 두지 않으면 시간 초과가 쌓여 판을 지고, 매치가 끝난다', async () => {
    const port = await boot({ turnMs: 40, deployMs: 40 });
    const { a } = await pair(port);
    const end = await a.waitFor((m) => m.t === 'match_over', 15000);
    expect(end.t === 'match_over' && end.reason).toContain('시간');
    expect(a.log.some((m) => m.t === 'state' && m.events.some((e) => e.type === 'timeout'))).toBe(true);
  });

  it('연결이 끊겨도 같은 토큰으로 돌아오면 이어서 둔다', async () => {
    const port = await boot();
    const { a, b, fa } = await pair(port);
    const token = a.token;
    a.close();
    const away = await b.waitFor((m) => m.t === 'opponent');
    expect(away.t === 'opponent' && away.status).toBe('away');
    const a2 = await join(port, '가', token);
    const back = await a2.waitFor((m) => m.t === 'state');
    expect(back.t === 'state' && back.match.you).toBe(fa);
    const online = await b.waitFor((m) => m.t === 'opponent');
    expect(online.t === 'opponent' && online.status).toBe('online');
  });

  it('유예 시간 안에 돌아오지 않으면 남은 사람이 이긴다', async () => {
    const port = await boot({ graceMs: 150 });
    const { a, b, fb } = await pair(port);
    a.close();
    const end = await b.waitFor((m) => m.t === 'match_over', 3000);
    expect(end.t === 'match_over' && end.winner).toBe(fb);
  });

  it('기권하면 매치를 지고, 둘 다 원하면 진영을 바꿔 다시 한다', async () => {
    const port = await boot();
    const { a, b, fa, fb } = await pair(port);
    a.send({ t: 'resign' });
    const end = await b.waitFor((m) => m.t === 'match_over');
    expect(end.t === 'match_over' && end.winner).toBe(fb);
    await a.waitFor((m) => m.t === 'match_over');
    a.send({ t: 'rematch' });
    const asked = await b.waitFor((m) => m.t === 'rematch');
    expect(asked.t === 'rematch' && asked.status).toBe('asked');
    b.send({ t: 'rematch' });
    const sa = await a.waitFor((m) => m.t === 'state' && m.match.roundNo === 1 && m.match.scores.blue === 0 && m.match.scores.red === 0);
    expect(sa.t === 'state' && sa.match.you).toBe(fb as Faction);
    void fa;
  });

  it('대기열에서 취소하면 로비로 돌아간다', async () => {
    const port = await boot();
    const a = await join(port, '혼자');
    a.send({ t: 'quick' });
    await a.waitFor((m) => m.t === 'queued');
    a.send({ t: 'cancel' });
    await a.waitFor((m) => m.t === 'lobby');
    await sleep(10);
  });
});
