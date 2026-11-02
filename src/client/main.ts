/**
 * 마리오네트 신디케이트 — 화면 진입점.
 * 타이틀 → 로비 → (대기) → 대전. 화면 전환은 서버 메시지가 이끕니다.
 */
import './fonts';
import './styles.css';

import type { ServerMsg } from '../shared/protocol';
import { NAME_MAX } from '../shared/protocol';
import { loadManifest } from './assets';
import { audio } from './audio';
import { grainDataUrl } from './board/art';
import { GameScreen } from './game/game';
import { LocalLink, type Link } from './local';
import { Net, type NetStatus } from './net';
import { saveSettings, settings } from './settings';
import { el, esc, modal, toast } from './ui/dom';
import { lobbyScreen, titleScreen, waitingScreen } from './ui/screens';

/** 서버 없이 AI 대전만 하는 빌드 (claude.ai 페이지 등) */
const OFFLINE = import.meta.env.VITE_OFFLINE === '1';

type Screen =
  | { kind: 'title' }
  | { kind: 'lobby'; setOnline(n: number): void }
  | { kind: 'waiting'; dispose(): void }
  | { kind: 'game'; game: GameScreen };

class App {
  private host: HTMLElement;
  private screen: Screen = { kind: 'title' };
  private net: Net;
  private name = '';
  private online = 0;
  private netbar: HTMLElement | null = null;
  private entered = false;
  private local: LocalLink | null = null;

  constructor(root: HTMLElement) {
    document.body.insertAdjacentHTML('afterbegin', '<div class="backdrop"></div>');
    const grain = el('div', 'grain');
    grain.style.backgroundImage = `url(${grainDataUrl()})`;
    document.body.appendChild(grain);
    document.documentElement.classList.toggle('reduce-motion', settings.reduceMotion);
    this.host = root;
    this.net = new Net((m) => this.onMessage(m), (s, r) => this.onNet(s, r));
    // 브라우저 정책: 첫 입력에서 소리를 깨운다
    const wake = () => { audio.unlock(); if (this.entered) audio.startMusic(); };
    window.addEventListener('pointerdown', wake, { passive: true });
    window.addEventListener('keydown', wake);
  }

  start() {
    this.showTitle();
  }

  private clear() {
    this.local?.dispose();
    this.local = null;
    if (this.screen.kind === 'waiting') this.screen.dispose();
    if (this.screen.kind === 'game') this.screen.game.dispose();
    this.host.innerHTML = '';
  }

  private showTitle() {
    this.clear();
    this.screen = { kind: 'title' };
    titleScreen(this.host, (name) => {
      this.name = name;
      this.entered = true;
      audio.startMusic();
      if (!OFFLINE) this.net.connect(name);
      this.showLobby();
    });
  }

  private showLobby() {
    this.clear();
    const lobby = lobbyScreen(this.host, this.name || '이름 없는 자', this.online, {
      ai: (level) => this.startAi(level),
      quick: () => this.net.send({ t: 'quick' }) || this.offline(),
      createRoom: () => this.net.send({ t: 'create_room' }) || this.offline(),
      joinRoom: (code) => this.net.send({ t: 'join_room', code }) || this.offline(),
      rename: () => this.rename(),
    }, { online: !OFFLINE });
    this.screen = { kind: 'lobby', setOnline: lobby.setOnline };
  }

  private startAi(level: Parameters<LobbyArg['ai']>[0]) {
    this.clear();
    const link = new LocalLink((m) => this.onLocal(m), this.name || settings.name || '이름 없는 자', level);
    this.ensureGame(link);
    this.local = link;
    link.start();
  }

  private onLocal(m: ServerMsg) {
    if (this.screen.kind === 'game') this.screen.game.handle(m);
  }

  private offline() {
    toast('서버에 연결하는 중이다. 잠시 뒤 다시 눌러 주세요.', 'err');
  }

  private rename() {
    void modal(`
      <h2>이름 바꾸기</h2>
      <p class="lead">다음 대전부터 이 이름으로 불린다.</p>
      <form data-form><input class="field" maxlength="${NAME_MAX}" value="${esc(settings.name)}" autofocus />
      <div class="row"><button type="button" class="btn" data-close>그만두기</button><button class="btn primary">바꾼다</button></div></form>`, {
      onMount: (root, close) => {
        root.querySelector('form')!.addEventListener('submit', (e) => {
          e.preventDefault();
          const name = (root.querySelector('input') as HTMLInputElement).value.trim().slice(0, NAME_MAX);
          saveSettings({ name });
          this.name = name;
          close();
          // 새 이름으로 다시 인사한다 (같은 토큰)
          if (!OFFLINE) { this.net.connect(name); this.net.reconnect(); }
          this.showLobby();
        });
      },
    });
  }

  private ensureGame(link: Link = this.net): GameScreen {
    if (this.screen.kind === 'game') return this.screen.game;
    this.clear();
    const game = new GameScreen(this.host, link, () => this.showLobby());
    this.screen = { kind: 'game', game };
    audio.play('match');
    void game.mount();
    return game;
  }

  private onMessage(m: ServerMsg) {
    switch (m.t) {
      case 'welcome':
        this.name = m.name;
        this.online = m.online;
        if (m.resumed && this.screen.kind !== 'game') toast('궁정으로 돌아왔다.', 'gold');
        return;
      case 'lobby':
        this.online = m.online;
        if (this.screen.kind === 'lobby') this.screen.setOnline(m.online);
        else if (this.screen.kind !== 'title') this.showLobby();
        if (m.notice) toast(m.notice);
        return;
      case 'queued':
        this.clear();
        this.screen = { kind: 'waiting', ...waitingScreen(this.host, { queue: m.since }, () => this.net.send({ t: 'cancel' }), () => this.net.now()) };
        return;
      case 'room':
        this.clear();
        this.screen = { kind: 'waiting', ...waitingScreen(this.host, { code: m.code }, () => this.net.send({ t: 'cancel' }), () => this.net.now()) };
        return;
      case 'state':
      case 'round_over':
      case 'match_over':
      case 'opponent':
      case 'rematch':
        this.ensureGame().handle(m);
        return;
      case 'error':
        if (this.screen.kind === 'game') this.screen.game.handle(m);
        else { audio.play('error'); toast(m.message, 'err'); }
        return;
      case 'pong':
        return;
    }
  }

  private onNet(s: NetStatus, retryIn: number | null) {
    this.netbar?.remove();
    this.netbar = null;
    if (s === 'open' || !this.entered) return;
    const bar = el('div', 'netbar');
    bar.innerHTML = s === 'connecting'
      ? '서버에 연결하는 중…'
      : `서버와 연결이 끊겼다${retryIn ? ` — ${Math.ceil(retryIn / 1000)}초 뒤 다시 시도` : ''} <button class="btn small ghost">지금 다시</button>`;
    bar.querySelector('button')?.addEventListener('click', () => this.net.retryNow());
    document.body.appendChild(bar);
    this.netbar = bar;
  }
}

type LobbyArg = Parameters<typeof lobbyScreen>[3];

async function boot() {
  if (!OFFLINE) await loadManifest();
  try { await document.fonts.ready; } catch { /* 무시 */ }
  new App(document.getElementById('app')!).start();
}

void boot();
