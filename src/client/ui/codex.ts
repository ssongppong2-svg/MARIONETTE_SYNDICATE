/** 규칙 책과 설정 창 */
import {
  ABILITY_INFO, AXIS_NAME, BRIBE_COST, CARDS, MAX_TURNS_EACH, PIECES, SPY_DISCOUNT, TIMEOUTS_TO_LOSE, TURN_SECONDS,
} from '../../shared/data';
import type { CardId, PieceType } from '../../shared/types';
import { pieceSvg, uiSvg } from '../icons';
import { audio } from '../audio';
import { saveSettings, settings } from '../settings';
import { modal } from './dom';

const PIECE_ORDER: PieceType[] = ['lord', 'paladin', 'assassin', 'spy', 'archer', 'priest', 'serf'];
const MOVE_NAME = { any: '모든 방향', line: '직선', diag: '대각선' } as const;

const SECTIONS: { id: string; title: string; body: () => string }[] = [
  {
    id: 'win', title: '승리',
    body: () => `
      <p>한 판에서 아래 <b>두 가지를 모두</b> 이루면 그 즉시 이긴다. 먼저 두 판을 이기면 매치 승리.</p>
      <ol><li><b>내 타겟</b>을 처형한다. (매수로 포섭해도 된다)</li><li><b>상대의 VIP</b>를 처형한다.</li></ol>
      <p>VIP는 쓰러지는 순간 정체가 드러난다. 각자 ${MAX_TURNS_EACH}차례가 지나도 끝나지 않으면 <b>궁정 심판</b>: 이룬 조건 수 → 살아 있는 궁정 기물 수 → 루렌 순으로 가린다.</p>`,
  },
  {
    id: 'orders', title: '지령',
    body: () => `
      <p>판이 시작되면 봉인된 지령서를 받는다. 상대는 내 지령을 모르고, 나도 상대의 지령을 모른다.</p>
      <ul><li><b>VIP</b> — 반드시 지켜야 하는 내 궁정 기물 (보드에 금테와 왕관)</li>
      <li><b>타겟</b> — 반드시 처형해야 하는 상대 궁정 기물 (보드에 붉은 테두리)</li></ul>
      <p>상대가 내 VIP를 <b>확실히</b> 알게 되면 '노출'되고, 나에게만 알림이 온다. 노출되면 <b>암살 후 변경</b> 카드로 VIP를 바꿀 수 있다.</p>`,
  },
  {
    id: 'turn', title: '차례',
    body: () => `
      <p>차례마다 <b>AP 3</b>을 받는다. 남은 AP는 사라진다. 차례는 ${TURN_SECONDS}초. ${TIMEOUTS_TO_LOSE}번 연속으로 넘기면 그 판을 진다.</p>
      <table><tr><th>행동</th><th>AP</th><th>설명</th></tr>
      <tr><td>이동</td><td>1</td><td>기물마다 다른 방식</td></tr>
      <tr><td>처형</td><td>1</td><td>사거리 안의 적이 즉시 죽는다. HP는 없다. 상대는 누가 죽였는지 모른다</td></tr>
      <tr><td>매수</td><td>1</td><td>자기 4번째 차례부터. 붙어 있는 적을 루렌으로 내 편으로</td></tr>
      <tr><td>카드</td><td>카드별</td><td>차례마다 한 장</td></tr>
      <tr><td>특수 능력</td><td>1~2</td><td>군주·첩자·사제</td></tr></table>
      <p class="muted">조작: 내 기물을 누르면 갈 수 있는 칸(◇)과 칠 수 있는 적(붉은 모서리)이 보인다. 적을 누르면 처형·매수·심문을 고른다. 오른쪽 클릭이나 <span class="kbd">Esc</span>로 취소, <span class="kbd">E</span>로 차례 종료.</p>`,
  },
  {
    id: 'pieces', title: '기물',
    body: () => `
      <table><tr><th>기물</th><th>이동</th><th>처형</th><th>특징</th></tr>
      ${PIECE_ORDER.map((t) => {
        const p = PIECES[t];
        const ab = p.ability ? `<b>${ABILITY_INFO[p.ability].name}</b> (${ABILITY_INFO[p.ability].ap} AP): ${ABILITY_INFO[p.ability].text}` : p.role;
        return `<tr><td>${pieceSvg(t)}${p.name}</td><td>${MOVE_NAME[p.move.pattern]} ${p.move.range}</td><td>${p.exec || '—'}</td><td>${ab}</td></tr>`;
      }).join('')}</table>
      <p class="muted">처형 사거리는 상하좌우·대각선 모두 같은 거리로 센다. 진영마다 궁정 기물 6, 농노 4.</p>`,
  },
  {
    id: 'economy', title: '경제와 매수',
    body: () => `
      <p><b>사람이 곧 돈이고, 돈이 곧 전력이다.</b> 차례가 시작될 때 <b>살아 있는 농노 수 × 2</b> 루렌을 받는다.</p>
      <p>매수 비용: 농노 ${BRIBE_COST.serf}, 궁정 기물 ${BRIBE_COST.court}, 군주는 매수할 수 없다. 첩자가 매수하면 ${SPY_DISCOUNT} 깎인다.</p>
      <ul><li><b>VIP는 매수되지 않는다.</b> 시도하면 실패하고(AP만 잃는다) 그 기물이 VIP라는 게 드러난다.</li>
      <li><b>충성 서약</b>을 한 기물도 매수되지 않는다. 이때는 VIP인지 드러나지 않는다.</li>
      <li>내 <b>타겟을 매수</b>하면 포섭으로 보고 타겟 조건을 이룬다.</li>
      <li>매수된 기물에는 <b>꼭두각시의 실</b>이 달린다.</li></ul>`,
  },
  {
    id: 'cards', title: '카드',
    body: () => `
      <p>판마다 5장: <b>암살 후 변경</b> 1장은 항상, 나머지 4장은 무작위. 차례마다 한 장. <b>비밀</b> 카드는 상대에게 "봉인된 칙령이 집행되었다"로만 보인다.</p>
      <div class="cards-grid">${(Object.keys(CARDS) as CardId[]).map((id) => {
        const c = CARDS[id];
        return `<div><b>${c.name}</b><span class="muted">${AXIS_NAME[c.axis]} · ${c.cost} 루렌 · ${c.ap} AP${c.secret ? ' · 비밀' : ''}</span><br>${c.text}</div>`;
      }).join('')}</div>`,
  },
  {
    id: 'news', title: '궁정 신문',
    body: () => `
      <p>처형은 궁정의 공식 속보로 보도된다.</p>
      <table><tr><th>단계</th><th>내용</th></tr>
      <tr><td class="gold">공개</td><td>누가 죽었는가</td></tr>
      <tr><td class="blood">제한</td><td>어디서 죽었는가 — 구역의 지명만</td></tr>
      <tr><td class="muted">비공개</td><td>누가 죽였는가</td></tr></table>
      <p><b>검열</b> 카드를 걸어 두면, 내 기물이 처형될 때 지면이 검게 칠해지고 그 기물이 VIP였는지도 상대가 알 수 없다.</p>`,
  },
];

export function openCodex(start = 'win') {
  void modal(`
    <button class="btn icon ghost close" data-close aria-label="닫기">${uiSvg('close')}</button>
    <div class="eyebrow">Codex</div>
    <h2>궁정 법전</h2>
    <div class="rule"></div>
    <div class="codex">
      <nav>${SECTIONS.map((s) => `<button data-sec="${s.id}">${s.title}</button>`).join('')}</nav>
      <section></section>
    </div>`, {
    wide: true,
    onMount: (root) => {
      const sec = root.querySelector('section')!;
      const show = (id: string) => {
        const s = SECTIONS.find((x) => x.id === id) ?? SECTIONS[0];
        sec.innerHTML = `<h3>${s.title}</h3>${s.body()}`;
        root.querySelectorAll('nav button').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.sec === s.id));
      };
      root.querySelectorAll<HTMLButtonElement>('nav button').forEach((b) => b.addEventListener('click', () => { audio.play('click'); show(b.dataset.sec!); }));
      show(start);
    },
  });
}

export function openSettings(onChange?: () => void) {
  const sw = (key: 'shake' | 'reduceMotion' | 'coords') => `<button class="switch" role="switch" aria-checked="${settings[key]}" data-key="${key}"></button>`;
  void modal(`
    <button class="btn icon ghost close" data-close aria-label="닫기">${uiSvg('close')}</button>
    <div class="eyebrow">Settings</div>
    <h2>설정</h2>
    <div class="rule"></div>
    <div class="setting"><div>효과음<small>처형, 매수, 종소리</small></div><input type="range" min="0" max="1" step="0.05" value="${settings.sfx}" data-range="sfx"></div>
    <div class="setting"><div>배경음<small>낮은 오르간과 류트</small></div><input type="range" min="0" max="1" step="0.05" value="${settings.music}" data-range="music"></div>
    <div class="setting"><div>화면 흔들림<small>처형할 때 보드가 흔들린다</small></div>${sw('shake')}</div>
    <div class="setting"><div>움직임 줄이기<small>연출을 짧게, 깜빡임을 멈춘다</small></div>${sw('reduceMotion')}</div>
    <div class="setting"><div>좌표 표시<small>보드 가장자리의 A–J, 1–10</small></div>${sw('coords')}</div>
    <div class="row"><button class="btn primary" data-close>닫기</button></div>`, {
    onMount: (root) => {
      root.querySelectorAll<HTMLInputElement>('[data-range]').forEach((r) => {
        r.addEventListener('input', () => { saveSettings({ [r.dataset.range!]: Number(r.value) }); });
        r.addEventListener('change', () => audio.play('click'));
      });
      root.querySelectorAll<HTMLButtonElement>('.switch').forEach((b) => b.addEventListener('click', () => {
        const key = b.dataset.key as 'shake' | 'reduceMotion' | 'coords';
        saveSettings({ [key]: !settings[key] });
        b.setAttribute('aria-checked', String(settings[key]));
        document.documentElement.classList.toggle('reduce-motion', settings.reduceMotion);
        audio.play('click');
        onChange?.();
      }));
    },
  });
}
