/** 타이틀, 로비, 대기 화면 */
import { AI_LEVEL_NAME, type AiLevel } from '../../shared/ai';
import { NAME_MAX, ROOM_CODE_LENGTH } from '../../shared/protocol';
import { audio } from '../audio';
import { uiSvg } from '../icons';
import { saveSettings, settings } from '../settings';
import { openCodex, openSettings } from './codex';
import { $, el, esc, fmtClock, toast } from './dom';
import { paintTitle } from './title-art';

export function titleScreen(host: HTMLElement, onEnter: (name: string) => void) {
  const s = el('div', 'screen title-screen');
  s.innerHTML = `
    <canvas class="title-art" aria-hidden="true"></canvas>
    <div class="title-block">
      <div class="eyebrow">A Tale of Strings and Crowns</div>
      <h1 class="logo">MARIONETTE<br>SYNDICATE</h1>
      <div class="logo-sub">마리오네트 신디케이트</div>
      <p class="tagline">금빛 궁정 위에 피와 그림자가 얹힌 중세 정치 암살극</p>
      <form class="entry">
        <input class="field" name="name" maxlength="${NAME_MAX}" placeholder="궁정에서 불릴 이름" autocomplete="nickname" value="${esc(settings.name)}" aria-label="이름" />
        <button class="btn primary" type="submit">입장</button>
      </form>
    </div>
    <div class="title-foot">10 × 10 · 1대1 온라인 심리전 · 3판 2선승</div>`;
  host.appendChild(s);
  const cv = s.querySelector('canvas')!;
  void paintTitle(cv);
  const onResize = () => void paintTitle(cv);
  window.addEventListener('resize', onResize);
  const form = s.querySelector('form')!;
  const input = form.querySelector('input')!;
  setTimeout(() => input.focus(), 50);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    audio.unlock();
    audio.play('match');
    const name = input.value.trim().slice(0, NAME_MAX);
    saveSettings({ name });
    window.removeEventListener('resize', onResize);
    onEnter(name);
  });
}

export interface LobbyHandlers {
  ai(level: AiLevel): void;
  quick(): void;
  createRoom(): void;
  joinRoom(code: string): void;
  rename(): void;
}

const LEVEL_HINT: Record<AiLevel, string> = {
  easy: '가끔 실수하고 일찍 차례를 넘긴다',
  normal: '한 수씩 위험과 이득을 따진다',
  hard: '남은 AP로 세 수를 내다본다',
};

export function lobbyScreen(host: HTMLElement, name: string, online: number, h: LobbyHandlers, opts: { online: boolean }) {
  const s = el('div', 'screen');
  const levels: AiLevel[] = ['easy', 'normal', 'hard'];
  s.innerHTML = `
    <div class="lobby ${opts.online ? '' : 'offline'}">
      <div class="lobby-head">
        <div><div class="eyebrow">The Antechamber</div><div class="logo">MARIONETTE SYNDICATE</div></div>
        <div class="whoami">궁정에 들어선 이름<br><b>${esc(name)}</b> <button class="btn ghost small" data-act="rename">바꾸기</button></div>
      </div>
      <div class="mode-card mode-quick mode-ai frame">
        <div>
          <div class="eyebrow">Versus the Puppeteer</div>
          <h2>AI 대전</h2>
          <p>컴퓨터 인형사와 겨룬다. 시간 제한 없이, 3판 2선승. AI도 당신의 VIP를 모른다.</p>
        </div>
        <div class="crest">${uiSvg('strings')}</div>
        <div class="levels" role="radiogroup" aria-label="난이도">
          ${levels.map((l) => `<button class="level" role="radio" data-level="${l}" aria-checked="${settings.aiLevel === l}"><b>${AI_LEVEL_NAME[l]}</b><span>${LEVEL_HINT[l]}</span></button>`).join('')}
        </div>
        <button class="btn primary" data-act="ai">AI와 겨루기</button>
      </div>
      ${opts.online ? `
      <div class="mode-card frame">
        <div class="eyebrow">Quick Match</div>
        <h2>빠른 대전</h2>
        <p>궁정에 와 있는 아무 상대와 바로 겨룬다. 차례마다 60초.</p>
        <button class="btn" data-act="quick">상대 찾기</button>
      </div>
      <div class="mode-card frame">
        <div class="eyebrow">Private Chamber</div>
        <h2>친구와 대전</h2>
        <button class="btn" data-act="room">방 코드 만들기</button>
        <form class="join-row">
          <input class="field code" maxlength="${ROOM_CODE_LENGTH}" placeholder="코드 입력" aria-label="방 코드" />
          <button class="btn" type="submit">참가</button>
        </form>
      </div>` : `
      <div class="mode-card frame">
        <div class="eyebrow">Online</div>
        <h2>온라인 대전</h2>
        <p>사람과 겨루는 온라인 대전은 대전 서버를 올린 뒤에 열린다. 지금은 AI와 둘 수 있다.</p>
      </div>`}
      <div class="lobby-foot">
        <span class="muted">${opts.online ? `<span class="online-dot"></span>지금 궁정에 <b class="gold" data-online>${online}</b>명` : '이 브라우저 안에서 두는 판'}</span>
        <span>
          <button class="btn ghost small" data-act="codex">${uiSvg('book')} 궁정 법전</button>
          <button class="btn ghost small" data-act="settings">${uiSvg('gear')} 설정</button>
        </span>
      </div>
    </div>`;
  host.appendChild(s);
  const on = (act: string, fn: () => void) => s.querySelector(`[data-act="${act}"]`)?.addEventListener('click', () => { audio.play('click'); fn(); });
  on('ai', () => h.ai(settings.aiLevel));
  on('quick', h.quick);
  on('room', h.createRoom);
  on('rename', h.rename);
  on('codex', () => openCodex());
  on('settings', () => openSettings());
  s.querySelectorAll<HTMLButtonElement>('[data-level]').forEach((b) => b.addEventListener('click', () => {
    audio.play('select');
    saveSettings({ aiLevel: b.dataset.level as AiLevel });
    s.querySelectorAll<HTMLButtonElement>('[data-level]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
  }));
  const form = s.querySelector('.join-row') as HTMLFormElement | null;
  if (form) {
    const input = form.querySelector('input')!;
    input.addEventListener('input', () => { input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      audio.play('click');
      if (input.value.length !== ROOM_CODE_LENGTH) { toast(`코드는 ${ROOM_CODE_LENGTH}자리다.`, 'err'); return; }
      h.joinRoom(input.value);
    });
  }
  return {
    setOnline(n: number) { const e = s.querySelector('[data-online]'); if (e) e.textContent = String(n); },
  };
}

export function waitingScreen(host: HTMLElement, kind: { queue: number } | { code: string }, onCancel: () => void, now: () => number) {
  const s = el('div', 'screen');
  const isRoom = 'code' in kind;
  s.innerHTML = `
    <div class="waiting frame">
      <div class="hourglass">${uiSvg('hourglass')}</div>
      <div class="eyebrow">${isRoom ? 'Private Chamber' : 'Seeking a Rival'}</div>
      <h2>${isRoom ? '친구를 기다리는 중' : '상대를 찾는 중'}</h2>
      ${isRoom
        ? `<p class="muted">이 코드를 친구에게 보내 주세요. 누르면 복사됩니다.</p><div class="room-code" role="button" tabindex="0" title="복사">${esc(kind.code)}</div>`
        : `<p class="muted">궁정의 문 앞에서 기다리는 사람을 찾고 있다.</p><div class="elapsed" data-elapsed>0:00</div>`}
      <button class="btn" data-act="cancel">그만두기</button>
    </div>`;
  host.appendChild(s);
  $(s, '[data-act="cancel"]').addEventListener('click', () => { audio.play('click'); onCancel(); });
  let timer = 0;
  if (!isRoom) {
    const since = kind.queue;
    const tick = () => { const e = s.querySelector('[data-elapsed]'); if (e) e.textContent = fmtClock(now() - since + 999); };
    tick();
    timer = window.setInterval(tick, 1000);
  } else {
    const codeEl = $(s, '.room-code');
    const copy = async () => {
      try { await navigator.clipboard.writeText(kind.code); toast('코드를 복사했다.', 'gold'); } catch { toast('복사할 수 없다. 직접 적어 주세요.', 'err'); }
    };
    codeEl.addEventListener('click', copy);
    codeEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') void copy(); });
  }
  return { dispose() { clearInterval(timer); } };
}
