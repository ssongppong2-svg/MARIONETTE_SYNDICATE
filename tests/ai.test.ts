import { describe, expect, it } from 'vitest';
import { decide, vipBelief, type AiLevel } from '../src/shared/ai';
import { apply, createRound, timeout } from '../src/shared/engine';
import type { Faction } from '../src/shared/types';
import { viewFor } from '../src/shared/view';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** 두 AI가 한 판을 끝까지 둔다 */
function duel(seed: number, levels: Record<Faction, AiLevel>) {
  const { state: s } = createRound({ seed, round: 1, first: seed % 2 ? 'blue' : 'red' });
  const r = rng(seed * 7 + 1);
  // 배치: 두 AI가 각자 놓는다
  for (const f of ['blue', 'red'] as Faction[]) {
    const res = apply(s, decide(viewFor(s, f), levels[f], r), f);
    if (res.error) throw new Error(`배치 실패: ${res.error}`);
  }
  expect(s.phase).toBe('play');
  let actions = 0;
  while (!s.winner && !s.draw && actions < 2000) {
    const v = viewFor(s, s.current);
    const a = decide(v, levels[s.current], r);
    const res = apply(s, a);
    if (res.error) throw new Error(`AI가 규칙에 어긋난 수를 두었다: ${JSON.stringify(a)} — ${res.error}`);
    actions++;
  }
  return { s, actions };
}

describe('AI', () => {
  it('배치에서 VIP를 뒷줄에 두고 모든 기물을 자기 진영 안에 놓는다', () => {
    for (const level of ['easy', 'normal', 'hard'] as AiLevel[]) {
      const { state } = createRound({ seed: 9, round: 1, first: 'blue' });
      const a = decide(viewFor(state, 'red'), level, rng(2));
      expect(a.kind).toBe('deploy');
      expect(apply(state, a, 'red').error).toBeNull();
      if (level !== 'easy') expect(state.pieces[state.orders.red.vip].r).toBe(9);
    }
  });

  it('상대의 비밀을 받지 않는다 — 화면용 상태만으로 둔다', () => {
    const { state } = createRound({ seed: 3, round: 1, first: 'blue' });
    const v = viewFor(state, 'blue');
    expect(JSON.stringify(v)).not.toContain(`"vip":"${state.orders.red.vip}"`);
    expect(() => decide(v, 'hard', rng(1))).not.toThrow();
  });

  it('정보가 없으면 상대 궁정 기물 모두를 똑같이 의심한다', () => {
    const { state } = createRound({ seed: 3, round: 1, first: 'blue' });
    timeout(state);
    const b = vipBelief(viewFor(state, 'blue'));
    expect(b.size).toBe(6);
    for (const p of b.values()) expect(p).toBeCloseTo(1 / 6, 5);
  });

  it('심문 결과를 믿음에 반영한다', () => {
    const { state } = createRound({ seed: 3, round: 1, first: 'blue' });
    timeout(state);
    const vip = state.orders.red.vip;
    state.players.blue.intel.push({ turn: 1, kind: 'interrogate', subjects: [vip], result: true });
    const b = vipBelief(viewFor(state, 'blue'));
    expect(b.get(vip)!).toBeGreaterThan(0.6);
  });

  for (const level of ['easy', 'normal', 'hard'] as AiLevel[]) {
    it(`${level}: 규칙에 맞는 수만 두고 판을 끝낸다`, () => {
      let decisive = 0;
      const N = level === 'hard' ? 6 : 12;
      for (let seed = 1; seed <= N; seed++) {
        const { s } = duel(seed, { blue: level, red: level });
        expect(s.winner !== null || s.draw).toBe(true);
        if (s.endReason?.includes('모두 이루었다')) decisive++;
      }
      expect(decisive).toBeGreaterThanOrEqual(Math.ceil(N * 0.5));
    }, 120000);
  }

  it('어려움은 쉬움을 대부분 이긴다', () => {
    let hard = 0;
    const N = 16;
    for (let seed = 1; seed <= N; seed++) {
      const hardSide: Faction = seed % 2 ? 'blue' : 'red';
      const levels = { blue: 'easy', red: 'easy' } as Record<Faction, AiLevel>;
      levels[hardSide] = 'hard';
      const { s } = duel(100 + seed, levels);
      if (s.winner === hardSide) hard++;
    }
    expect(hard).toBeGreaterThanOrEqual(Math.ceil(N * 0.65));
  }, 180000);
});

