/**
 * 대전 화면. 서버가 보낸 상태를 그리고, 사건을 연출로 재생하고, 입력을 행동으로 바꿉니다.
 * 판정은 하지 않습니다 — 버튼과 강조 표시는 서버와 같은 규칙 함수(shared/rules)로 계산합니다.
 */
import {
  ABILITY_INFO, AXIS_NAME, CARDS, FACTION_NAME, INCOME_PER_SERF, PIECES, TURN_SECONDS, WINS_TO_TAKE_MATCH,
} from '../../shared/data';
import { josa, particle } from '../../shared/korean';
import type { MatchInfo, OpponentStatus, ServerMsg } from '../../shared/protocol';
import {
  blessTargets, bribeOpen, bribeOptions, cardChoices, cardProblem, execRange, execTargets, interrogateTargets,
  isMyTurn, pieceAt, pieceById, reachable, royalEffect, shadowCells,
} from '../../shared/rules';
import type { Action, CardId, Cell, Faction, GameEvent, NewsItem, Orders } from '../../shared/types';
import { other } from '../../shared/types';
import type { PlayerView, ViewPiece } from '../../shared/view';
import { audio } from '../audio';
import { Board, NO_HIGHLIGHTS, type Highlights } from '../board/board';
import { pieceSvg, uiSvg, type UiIcon } from '../icons';
import type { Net } from '../net';
import { onSettings, saveSettings, settings } from '../settings';
import { openCodex, openSettings } from '../ui/codex';
import { $, confirmBox, el, esc, fmtClock, modal, placeNear, roman, toast } from '../ui/dom';

type Mode =
  | { kind: 'bribe' | 'interrogate' | 'bless'; piece: string }
  | { kind: 'card'; card: CardId; picks: string[]; assassin: string | null };

type StateMsg = Extract<ServerMsg, { t: 'state' }>;

const CARD_ICON: Record<CardId, UiIcon> = {
  switch: 'crown', report: 'eye', forgery: 'quill', censor: 'scroll', decree: 'flag', tax: 'coin', famine: 'hourglass',
  conscript: 'spear', oath: 'seal', silver: 'strings', poison: 'drop', shadow: 'moon', double: 'mask', curfew: 'bell',
};

const pname = (t: ViewPiece['type'], militia = false) => (militia ? '민병' : PIECES[t].name);
const label = (v: PlayerView, p: { type: ViewPiece['type']; owner: Faction; militia?: boolean }) =>
  `${p.owner === v.you ? '내' : '상대'} ${pname(p.type, p.militia)}`;

export class GameScreen {
  private root: HTMLElement;
  private board: Board;
  private view: PlayerView | null = null;
  private match: MatchInfo | null = null;
  private deadline: number | null = null;
  private opponent: OpponentStatus = 'online';
  private graceUntil: number | null = null;
  private selected: string | null = null;
  private mode: Mode | null = null;
  private pending = false;
  /** 사건 연출을 재생하는 중 — 이때의 클릭은 지난 상태를 기준으로 하므로 받지 않는다 */
  private animating = false;
  private chain: Promise<void> = Promise.resolve();
  private tab: 'news' | 'intel' = 'news';
  private popover: HTMLElement | null = null;
  private tooltip: HTMLElement | null = null;
  private overlay: HTMLElement | null = null;
  private clockTimer = 0;
  private lastTick = -1;
  private disposed = false;
  private offSettings: () => void;
  private onKey = (e: KeyboardEvent) => this.key(e);

  constructor(host: HTMLElement, private readonly net: Net, private readonly onLobby: () => void) {
    this.root = el('div', 'game');
    this.root.innerHTML = this.layout();
    host.appendChild(this.root);
    this.board = new Board({
      onCell: (r, c, client) => this.cellClicked(r, c, client),
      onHover: (r, c, client) => this.hover(r, c, client),
      onCancel: () => this.cancel(),
    });
    this.wire();
    this.clockTimer = window.setInterval(() => this.tickClock(), 250);
    document.addEventListener('keydown', this.onKey);
    this.offSettings = onSettings(() => this.board.refreshSettings());
  }

  async mount() {
    await this.board.init($(this.root, '.board-host'));
  }

  dispose() {
    this.disposed = true;
    clearInterval(this.clockTimer);
    document.removeEventListener('keydown', this.onKey);
    this.offSettings();
    this.closePopover();
    this.hideTooltip();
    this.overlay?.remove();
    this.board.destroy();
    this.root.remove();
  }

  /* ── 뼈대 ─────────────────────────────────── */
  private layout(): string {
    return `
    <header class="topbar frame">
      <div class="side left">
        <div class="house-chip" data-me-chip></div>
        <div style="min-width:0"><div class="pname" data-me-name></div><div class="psub" data-me-sub></div></div>
        <div class="pips" data-me-pips></div>
      </div>
      <div class="center-info">
        <div class="round-label" data-round></div>
        <div class="turn-label" data-turn></div>
        <div class="clock" data-clock>${uiSvg('hourglass')}<span>—</span></div>
        <div class="clockbar"><i data-clockbar></i></div>
      </div>
      <div class="side right">
        <div class="pips" data-op-pips></div>
        <div class="opp-id" style="min-width:0;text-align:right"><div class="pname" data-op-name></div><div class="psub" data-op-sub></div></div>
        <div class="house-chip opp-id" data-op-chip></div>
        <div class="top-actions">
          <button class="btn icon ghost" data-act="codex" title="궁정 법전" aria-label="궁정 법전">${uiSvg('book')}</button>
          <button class="btn icon ghost" data-act="sound" title="소리" aria-label="소리">${uiSvg(settings.sfx > 0 ? 'soundOn' : 'soundOff')}</button>
          <button class="btn icon ghost" data-act="settings" title="설정" aria-label="설정">${uiSvg('gear')}</button>
          <button class="btn icon ghost" data-act="resign" title="기권" aria-label="기권">${uiSvg('flag')}</button>
        </div>
      </div>
    </header>
    <aside class="panel-l panel frame">
      <h3>봉인된 지령서 <span class="muted" data-house></span></h3>
      <div class="orders" data-orders></div>
      <div class="conds" data-conds></div>
      <h3>금고</h3>
      <div class="treasury">${uiSvg('coin')}<div><div class="amt" data-ruren>0</div><div class="sub" data-income></div></div></div>
      <div class="flags" data-flags></div>
    </aside>
    <main class="board-wrap">
      <div class="board-host"></div>
    </main>
    <aside class="panel-r panel frame">
      <h3>상대 <span class="muted" data-op-house></span></h3>
      <div class="foe" data-foe></div>
      <div class="tabs">
        <button class="tab on" data-tab="news">궁정 신문<span class="count" data-news-count></span></button>
        <button class="tab" data-tab="intel">정보 수첩<span class="count" data-intel-count></span></button>
      </div>
      <div class="feed" data-feed></div>
    </aside>
    <footer class="bottom">
      <div class="ap frame"><div class="gems" data-gems></div><div class="lbl">AP</div></div>
      <div class="selbox frame" data-sel></div>
      <div class="hand" data-hand></div>
      <button class="btn primary endturn" data-act="end">차례 종료<span class="sub">E</span></button>
    </footer>`;
  }

  private wire() {
    const on = (sel: string, fn: () => void) => $(this.root, sel).addEventListener('click', () => { audio.play('click'); fn(); });
    on('[data-act="end"]', () => this.send({ kind: 'end' }));
    on('[data-act="codex"]', () => openCodex('turn'));
    on('[data-act="settings"]', () => openSettings(() => this.renderAll()));
    on('[data-act="sound"]', () => this.toggleSound());
    on('[data-act="resign"]', () => void this.resign());
    this.root.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => b.addEventListener('click', () => {
      audio.play('click');
      this.tab = b.dataset.tab as 'news' | 'intel';
      this.renderFeed();
    }));
  }

  private toggleSound() {
    const muted = settings.sfx === 0 && settings.music === 0;
    if (muted) saveSettings({ sfx: 0.8, music: 0.45 });
    else saveSettings({ sfx: 0, music: 0 });
    $(this.root, '[data-act="sound"]').innerHTML = uiSvg(settings.sfx > 0 ? 'soundOn' : 'soundOff');
  }

  private async resign() {
    const ok = await confirmBox('기권하시겠습니까?', '기권하면 이 매치 전체를 집니다. 되돌릴 수 없습니다.', '기권한다', true);
    if (ok) this.net.send({ t: 'resign' });
  }

  /* ── 서버 메시지 ──────────────────────────── */
  handle(msg: ServerMsg) {
    this.chain = this.chain.then(() => this.process(msg)).catch((e) => console.error(e));
  }

  private async process(msg: ServerMsg) {
    if (this.disposed) return;
    switch (msg.t) {
      case 'state': return this.onState(msg);
      case 'round_over': return this.onRoundOver(msg);
      case 'match_over': return this.onMatchOver(msg);
      case 'opponent':
        this.opponent = msg.status;
        this.graceUntil = msg.graceUntil;
        if (msg.status === 'away') toast('상대의 연결이 끊겼다. 돌아오기를 기다린다.', 'info', 3200);
        if (msg.status === 'online') toast('상대가 돌아왔다.', 'gold');
        this.renderAway();
        return;
      case 'rematch': return this.onRematch(msg.status);
      case 'error':
        this.pending = false;
        audio.play('error');
        toast(msg.message, 'err');
        this.renderAll();
        return;
    }
  }

  private async onState(msg: StateMsg) {
    const prev = this.view;
    const roundStart = msg.events.some((e) => e.type === 'round_start');
    if (roundStart || !prev || prev.round !== msg.view.round || prev.you !== msg.view.you) {
      this.overlay?.remove();
      this.overlay = null;
      this.selected = null;
      this.mode = null;
      this.board.setPerspective(msg.view.you);
      this.view = msg.view;
      this.match = msg.match;
      this.board.sync(msg.view);
    }
    this.match = msg.match;
    this.deadline = msg.deadline;
    this.opponent = msg.opponent;
    this.pending = false;
    this.animating = msg.events.length > 0;
    if (this.animating) { this.closePopover(); this.hideTooltip(); }
    try {
      await this.play(msg.events, msg.view);
    } finally {
      this.animating = false;
    }
    if (this.disposed) return;
    this.view = msg.view;
    if (this.selected && !pieceById(msg.view, this.selected)) this.selected = null;
    if (this.selected && pieceById(msg.view, this.selected)?.owner !== msg.view.you) this.selected = null;
    if (this.mode && !isMyTurn(msg.view)) this.mode = null;
    this.board.setIntel(this.intelMarks(msg.view));
    this.board.sync(msg.view);
    this.renderAll();
  }

  private intelMarks(v: PlayerView) {
    const marks = new Map<string, boolean>();
    for (const n of v.me.intel) if (n.kind === 'interrogate') marks.set(n.subjects[0], n.result);
    return [...marks].map(([id, vip]) => ({ id, vip }));
  }

  /* ── 사건 재생 ────────────────────────────── */
  private async play(events: GameEvent[], next: PlayerView) {
    const v0 = this.view ?? next;
    const find = (id: string) => pieceById(next, id) ?? pieceById(v0, id);
    const fast = events.length > 12;
    for (const ev of events) {
      if (this.disposed) return;
      switch (ev.type) {
        case 'round_start':
          audio.play('roundStart');
          await this.showLetter(next);
          break;
        case 'turn_start': {
          const mine = ev.faction === next.you;
          audio.play(mine ? 'turnMine' : 'turnTheirs');
          this.banner(mine ? '당신의 차례' : `${this.oppName()}의 차례`, `TURN ${Math.ceil(ev.turn / 2)}`, mine);
          if (mine && ev.famine) toast('흉년 — 이번 차례 수입이 없다.', 'err');
          if (mine && ev.curfew) toast('통금령 — 이번 차례 AP가 1 줄었다.', 'err');
          if (mine && ev.income) toast(`농노들이 ${ev.income} 루렌을 바쳤다.`, 'gold', 1800);
          break;
        }
        case 'move':
          audio.play('move');
          await this.board.animMove(ev.piece, ev.to, ev.shadow);
          break;
        case 'attack':
          audio.play('execute');
          await this.board.animAttack(ev.attacker, ev.target);
          break;
        case 'death':
          audio.play('death');
          if (ev.cause === 'poison') await this.board.animPoison(ev.piece);
          await this.board.animDeath(ev.piece, ev.owner);
          break;
        case 'blocked':
          audio.play('blocked');
          await this.board.animBlocked(ev.target);
          break;
        case 'double':
          await this.board.animDouble(ev.original);
          break;
        case 'vip_revealed': {
          const g = next.graveyard.find((x) => x.id === ev.piece);
          if (ev.owner !== next.you && g) toast(`쓰러진 ${josa(pname(g.type, g.militia), '은/는')} 상대의 VIP였다.`, 'gold', 3600);
          if (ev.owner === next.you) toast('내 VIP가 쓰러졌다.', 'err', 3600);
          break;
        }
        case 'news':
          audio.play('news');
          this.showNews(ev.item);
          if (!fast) await this.sleep(500);
          break;
        case 'bribe': {
          const t = find(ev.target);
          audio.play(ev.result === 'ok' ? 'bribe' : 'bribeFail');
          if (t) await this.board.animBribe(ev.actor, ev.target, ev.result, ev.result === 'ok' ? ev.by : t.owner, t.type, t.militia);
          if (ev.result === 'vip') toast(ev.by === next.you ? '매수 실패 — 그 기물은 상대의 VIP다.' : '상대가 내 VIP를 매수하려다 실패했다. VIP가 드러났다.', ev.by === next.you ? 'gold' : 'err', 4200);
          if (ev.result === 'oath') toast(ev.by === next.you ? '매수 실패 — 충성 서약을 한 기물이다.' : '충성 서약이 매수를 막았다.', 'info', 3200);
          break;
        }
        case 'exposed':
          audio.play('exposed');
          await this.showExposed(next);
          break;
        case 'interrogate':
          await this.board.animFlash(ev.target, '심문', '#ead28c');
          break;
        case 'intel': {
          const n = ev.note;
          const who = n.subjects.map((id) => find(id)).filter(Boolean).map((p) => pname(p!.type, p!.militia)).join(', ');
          toast(n.kind === 'interrogate'
            ? `심문 결과: ${who} — ${n.result ? 'VIP다' : 'VIP가 아니다'}`
            : `밀정의 보고: ${who} 중에 VIP가 ${n.result ? '있다' : '없다'}`, 'gold', 4200);
          this.tab = 'intel';
          break;
        }
        case 'card':
          audio.play(ev.card ? 'card' : 'seal');
          await this.cardPlayed(ev.faction, ev.card, next);
          break;
        case 'royal':
          audio.play('royal');
          await this.board.animRoyal(ev.lord, ev.rooted);
          break;
        case 'bless':
          audio.play('bless');
          await this.board.animBless(ev.target);
          if (ev.cured) toast('축복이 독을 풀었다.', 'gold');
          break;
        case 'poisoned':
          audio.play('poison');
          await this.board.animPoison(ev.target);
          break;
        case 'conscript':
          await this.board.animFlash(ev.piece, '징집', '#e8e2d0');
          break;
        case 'tax':
          if (ev.faction === next.you) toast(`세금 ${ev.amount} 루렌을 걷었다.`, 'gold');
          break;
        case 'famine':
          toast(ev.against === next.you ? '흉년이 든다 — 다음 차례 수입이 없다.' : '상대 땅에 흉년이 든다.', ev.against === next.you ? 'err' : 'gold');
          break;
        case 'curfew':
          toast(ev.against === next.you ? '통금령 — 다음 차례 AP가 1 줄어든다.' : '상대에게 통금령을 내렸다.', ev.against === next.you ? 'err' : 'gold');
          break;
        case 'silver':
          if (ev.faction === next.you) toast('은화를 풀었다 — 이번 차례 매수 한 번은 반값, 두 칸까지.', 'gold');
          break;
        case 'secret': {
          const p = ev.piece ? find(ev.piece) : null;
          const what: Record<string, string> = {
            oath: `충성 서약 — ${p ? josa(pname(p.type, p.militia), '은/는') : '그 기물은'} 이 판 동안 매수되지 않는다.`,
            double: `대역 — ${p ? pname(p.type, p.militia) : ''} 곁의 농노가 대신 죽어 줄 것이다.`,
            censor: '검열을 걸었다 — 다음에 내 기물이 처형되면 지면이 지워진다.',
            forgery: '위조 서신을 보냈다 — 상대의 다음 정보는 거짓이 된다.',
          };
          toast(what[ev.card] ?? '봉인된 칙령을 집행했다.', 'gold', 3600);
          break;
        }
        case 'target_changed': {
          const p = find(ev.target);
          toast(ev.reason === 'decree'
            ? `봉인된 칙령 — 새 타겟은 ${p ? pname(p.type, p.militia) : '?'}.`
            : `타겟이 내 손이 아닌 이유로 사라졌다. 새 타겟: ${p ? pname(p.type, p.militia) : '?'}.`, 'gold', 4200);
          break;
        }
        case 'vip_changed': {
          const p = find(ev.vip);
          toast(`새 VIP: ${p ? pname(p.type, p.militia) : '?'}. 상대는 아직 모른다.`, 'gold', 4200);
          break;
        }
        case 'condition':
          if (ev.state === 'done') {
            audio.play('blocked');
            toast(ev.which === 'target' ? '조건 달성 — 타겟을 처리했다.' : '조건 달성 — 상대의 VIP가 쓰러졌다.', 'gold', 3600);
          } else {
            toast('검열된 죽음 — 상대의 VIP였는지 알 수 없다.', 'info', 3600);
          }
          break;
        case 'timeout':
          toast(ev.faction === next.you ? '시간을 넘겼다. 세 번 연속이면 판을 진다.' : '상대가 시간을 넘겼다.', ev.faction === next.you ? 'err' : 'info');
          break;
        case 'round_end':
          break;
      }
    }
  }

  private sleep(ms: number) { return new Promise((ok) => setTimeout(ok, settings.reduceMotion ? Math.min(ms, 80) : ms)); }

  private oppName() {
    if (!this.match || !this.view) return '상대';
    return this.match.names[other(this.view.you)];
  }

  /* ── 연출용 덧그림 ────────────────────────── */
  private boardWrap() { return $(this.root, '.board-wrap'); }

  private banner(text: string, sub: string, mine: boolean) {
    const b = el('div', `banner ${mine ? 'mine' : ''}`, `<div class="b1">${esc(sub)}</div><div class="b2">${esc(text)}</div>`);
    this.boardWrap().appendChild(b);
    setTimeout(() => b.remove(), 1600);
  }

  private showNews(item: NewsItem) {
    const wrap = this.boardWrap();
    wrap.querySelectorAll('.news-card').forEach((n) => n.remove());
    const card = el('div', `news-card ${item.censored ? 'censored' : ''}`);
    card.innerHTML = `
      <div class="mast"><span>No. ${item.id}</span><span>궁정 신문</span><span>${roman(this.view?.round ?? 1)}</span></div>
      <div class="ntag">${esc(item.tag)}</div>
      <h4>${esc(item.title)}</h4>
      <p>${esc(item.body)}</p>
      <div class="nfoot"><span>${item.zone ? '장소: 구역 지명만 공개' : '장소: 비공개'}</span><span>범인 미상</span></div>`;
    const close = () => { card.classList.add('out'); setTimeout(() => card.remove(), 350); };
    card.addEventListener('click', close);
    wrap.appendChild(card);
    setTimeout(close, 5200);
  }

  private async cardPlayed(f: Faction, card: CardId | null, v: PlayerView) {
    const mine = f === v.you;
    const name = card ? CARDS[card].name : '봉인된 칙령';
    const text = card ? CARDS[card].text : '상대가 비밀 카드를 썼다. 무엇인지는 알 수 없다.';
    const node = el('div', 'banner', `<div class="b1">${mine ? 'YOU PLAY' : 'RIVAL PLAYS'}</div><div class="b2">${esc(name)}</div>`);
    if (!mine) node.insertAdjacentHTML('beforeend', `<div class="muted" style="font-size:13px;margin-top:4px">${esc(text)}</div>`);
    this.boardWrap().appendChild(node);
    setTimeout(() => node.remove(), 1600);
    await this.sleep(mine ? 350 : 700);
  }

  private showLetter(v: PlayerView): Promise<void> {
    const vip = pieceById(v, v.me.orders.vip);
    const tgt = pieceById(v, v.me.orders.target);
    if (!vip || !tgt) return Promise.resolve();
    return new Promise((resolve) => {
      const back = el('div', 'modal-back');
      back.innerHTML = `
        <div class="letter">
          <div class="seal">${uiSvg('seal')}</div>
          <div class="eyebrow">Round ${roman(v.round)}${this.match?.replay ? ' · 재경기' : ''}</div>
          <h2>봉인된 지령서</h2>
          <div class="from">${esc(FACTION_NAME[v.you])} 신디케이트 수장에게 — 이 서신은 읽은 뒤 태워라</div>
          <div class="orders-big">
            <div class="ob vip"><div class="k">지켜라</div>${pieceSvg(vip.type)}<b>${pname(vip.type)}</b><small>나의 VIP</small></div>
            <div class="ob tgt"><div class="k">처형하라</div>${pieceSvg(tgt.type)}<b>${pname(tgt.type)}</b><small>나의 타겟</small></div>
          </div>
          <p class="goal">타겟을 처형하고 상대의 VIP까지 쓰러뜨리면 이 판을 이긴다.<br>${v.current === v.you ? '<b>당신이 먼저 둔다.</b>' : `<b>${esc(this.oppName())}</b>${particle(this.oppName(), '이/가')} 먼저 둔다.`}</p>
          <button class="btn primary" data-ok>지령을 가슴에 품는다</button>
        </div>`;
      document.body.appendChild(back);
      const done = () => { back.remove(); resolve(); };
      back.querySelector('[data-ok]')!.addEventListener('click', () => { audio.play('seal'); done(); });
      setTimeout(() => { if (back.isConnected) done(); }, 7000);
    });
  }

  private showExposed(v: PlayerView): Promise<void> {
    const hasSwitch = v.me.hand.includes('switch');
    return modal(`
      <div class="eyebrow" style="color:#d26b63">Exposed</div>
      <h2 class="blood">당신의 VIP가 노출되었다</h2>
      <p class="lead">상대가 당신의 VIP가 누구인지 확실히 알게 되었다. 상대는 당신이 이 사실을 안다는 것을 모른다.</p>
      <p>${hasSwitch ? '<b class="gold">암살 후 변경</b> 카드로 노출된 VIP를 스스로 처단하고 새 VIP를 받을 수 있다 (8 루렌, 1 AP, 내 차례에).' : '손에 암살 후 변경 카드가 없다. 지켜 내는 수밖에 없다.'}</p>
      <div class="row"><button class="btn primary" data-close autofocus>알겠다</button></div>`, { dismissable: true });
  }

  private renderAway() {
    const wrap = this.boardWrap();
    wrap.querySelector('.awaybar')?.remove();
    if (this.opponent !== 'away' || !this.graceUntil) return;
    const bar = el('div', 'awaybar frame');
    wrap.appendChild(bar);
    const tick = () => {
      if (!bar.isConnected || this.opponent !== 'away' || !this.graceUntil) { bar.remove(); return; }
      bar.textContent = `상대의 연결이 끊겼다 — ${fmtClock(this.graceUntil - this.net.now())} 안에 돌아오지 않으면 당신이 이긴다`;
      setTimeout(tick, 500);
    };
    tick();
  }

  /* ── 판·매치 결과 ─────────────────────────── */
  private onRoundOver(msg: Extract<ServerMsg, { t: 'round_over' }>) {
    const v = this.view;
    if (!v) return;
    this.match = msg.match;
    this.renderTop();
    const win = msg.winner === v.you;
    audio.play(msg.winner === null ? 'news' : win ? 'victory' : 'defeat');
    this.overlay?.remove();
    const back = el('div', 'modal-back');
    back.innerHTML = `
      <div class="modal frame result">
        <div class="eyebrow" style="text-align:center">Round ${roman(v.round)}</div>
        <h2 class="${msg.winner === null ? '' : win ? 'win' : 'lose'}">${msg.winner === null ? '무승부' : win ? '판 승리' : '판 패배'}</h2>
        <div class="reason">${esc(msg.reason)}${msg.winner === null ? ' — 이 판을 다시 한다.' : ''}</div>
        ${this.revealHtml(v, msg.orders)}
        ${this.scoreHtml(msg.match)}
        <div class="countdown" data-count></div>
      </div>`;
    document.body.appendChild(back);
    this.overlay = back;
    const tick = () => {
      if (!back.isConnected) return;
      const left = (msg.nextAt ?? 0) - this.net.now();
      const c = back.querySelector('[data-count]');
      if (c) c.textContent = left > 0 ? `다음 판까지 ${Math.ceil(left / 1000)}초` : '다음 판을 준비하는 중…';
      setTimeout(tick, 250);
    };
    tick();
  }

  private revealHtml(v: PlayerView, orders: Record<Faction, Orders>) {
    const find = (id: string) => pieceById(v, id) ?? v.graveyard.find((g) => g.id === id);
    const line = (k: string, id: string, whose: Faction) => {
      const p = find(id);
      return `<div class="line"><span class="k">${k}</span>${p ? pieceSvg(p.type) : ''}<b>${p ? pname(p.type, p.militia) : '?'}</b><span class="whose">${FACTION_NAME[whose]}</span></div>`;
    };
    const col = (f: Faction) => `
      <div class="col"><h4><span class="house-chip ${f}" style="height:16px;width:8px"></span>${esc(this.match?.names[f] ?? '')} ${f === v.you ? '(나)' : ''}</h4>
      ${line('지킨 VIP', orders[f].vip, f)}${line('노린 타겟', orders[f].target, other(f))}</div>`;
    return `<div class="reveal">${col(v.you)}${col(other(v.you))}</div>`;
  }

  private scoreHtml(m: MatchInfo) {
    const me = m.you, op = other(me);
    return `<div class="scoreline"><span class="n gold">${m.scores[me]}</span><span class="muted" style="font-size:16px">${esc(m.names[me])} · ${esc(m.names[op])}</span><span class="n">${m.scores[op]}</span></div>`;
  }

  private onMatchOver(msg: Extract<ServerMsg, { t: 'match_over' }>) {
    this.match = msg.match;
    this.deadline = null;
    this.renderTop();
    const me = msg.match.you;
    const win = msg.winner === me;
    audio.play(win ? 'victory' : 'defeat');
    this.overlay?.remove();
    const back = el('div', 'modal-back');
    back.innerHTML = `
      <div class="modal frame result">
        <div class="eyebrow" style="text-align:center">${win ? 'The Crown Is Yours' : 'The Strings Are Cut'}</div>
        <h2 class="${win ? 'win' : 'lose'}">${win ? '매치 승리' : '매치 패배'}</h2>
        <div class="reason">${esc(msg.reason)}</div>
        ${this.view ? this.revealHtml(this.view, this.view.revealedOrders ?? { blue: { vip: '', target: '' }, red: { vip: '', target: '' } }) : ''}
        ${this.scoreHtml(msg.match)}
        <div class="row" style="justify-content:center">
          <button class="btn" data-lobby>${uiSvg('door')} 로비로</button>
          <button class="btn primary" data-rematch>다시 하기 (진영 교대)</button>
        </div>
      </div>`;
    document.body.appendChild(back);
    this.overlay = back;
    back.querySelector('[data-lobby]')!.addEventListener('click', () => {
      audio.play('click');
      this.net.send({ t: 'leave' });
      this.onLobby();
    });
    back.querySelector('[data-rematch]')!.addEventListener('click', () => {
      audio.play('click');
      this.net.send({ t: 'rematch' });
    });
  }

  private onRematch(status: 'asked' | 'waiting' | 'declined') {
    const btn = this.overlay?.querySelector<HTMLButtonElement>('[data-rematch]');
    if (status === 'asked') {
      toast(`${josa(this.oppName(), '이/가')} 다시 하기를 원한다.`, 'gold', 4000);
      if (btn) btn.textContent = '다시 하기 — 상대가 기다린다';
    } else if (status === 'waiting') {
      if (btn) { btn.disabled = true; btn.textContent = '상대의 대답을 기다리는 중…'; }
    } else {
      toast('상대가 궁정을 떠났다.', 'info');
      if (btn) { btn.disabled = true; btn.textContent = '상대가 떠났다'; }
    }
  }

  /* ── 입력 ─────────────────────────────────── */
  private send(action: Action) {
    if (!this.view || !isMyTurn(this.view) || this.pending || this.animating) return;
    if (!this.net.send({ t: 'action', action })) { toast('서버와 연결이 끊겼다.', 'err'); return; }
    this.pending = true;
    this.closePopover();
    if (action.kind !== 'move') this.mode = null;
    if (action.kind === 'end') { this.selected = null; this.mode = null; }
    this.renderBottom();
  }

  private key(e: KeyboardEvent) {
    if (document.querySelector('.modal-back')) return;
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    if (e.key === 'Escape') { this.cancel(); return; }
    if (e.key === 'e' || e.key === 'E' || e.key === 'ㄷ') {
      if (this.view && isMyTurn(this.view)) { audio.play('click'); this.send({ kind: 'end' }); }
      return;
    }
    const n = Number(e.key);
    if (n >= 1 && n <= 5 && this.view) {
      const card = this.view.me.hand[n - 1];
      const node = this.root.querySelectorAll<HTMLElement>('.card')[n - 1];
      if (card && node) this.cardClicked(card, node);
    }
  }

  private cancel() {
    if (this.popover) { this.closePopover(); return; }
    if (this.mode) { this.mode = null; this.renderAll(); return; }
    if (this.selected) { this.selected = null; this.renderAll(); }
  }

  private cellClicked(r: number, c: number, client: { x: number; y: number }) {
    const v = this.view;
    if (!v || this.animating) return;
    this.closePopover();
    this.hideTooltip();
    const p = pieceAt(v, r, c);
    const my = isMyTurn(v) && !this.pending;

    if (this.mode) {
      const m = this.mode;
      if (m.kind === 'card') return this.cardTargetClick(m, r, c, p);
      const list = m.kind === 'bribe'
        ? bribeOptions(v, m.piece).filter((o) => o.affordable).map((o) => o.id)
        : m.kind === 'interrogate' ? interrogateTargets(v, m.piece) : blessTargets(v, m.piece);
      if (p && list.includes(p.id) && my) {
        audio.play('click');
        this.send({ kind: m.kind, piece: m.piece, target: p.id });
        return;
      }
      if (m.kind === 'bribe' && p) {
        const opt = bribeOptions(v, m.piece).find((o) => o.id === p.id);
        if (opt && !opt.affordable) { toast(`루렌이 ${opt.cost - v.me.ruren} 모자란다.`, 'err'); return; }
      }
      this.mode = null;
    }

    if (p && p.owner === v.you) {
      audio.play('select');
      this.selected = this.selected === p.id ? null : p.id;
      this.renderAll();
      return;
    }
    if (!p && this.selected && my && reachable(v, this.selected).some((m) => m.r === r && m.c === c)) {
      this.send({ kind: 'move', piece: this.selected, to: { r, c } });
      return;
    }
    if (p && p.owner !== v.you && this.selected) {
      this.enemyMenu(this.selected, p, client);
      return;
    }
    if (!p) { this.selected = null; this.renderAll(); }
  }

  private enemyMenu(actorId: string, target: ViewPiece, client: { x: number; y: number }) {
    const v = this.view!;
    const actor = pieceById(v, actorId);
    if (!actor) return;
    const my = isMyTurn(v) && !this.pending;
    const opts: { icon: UiIcon; text: string; cost: string; why: string | null; danger?: boolean; act: () => void }[] = [];
    const inRange = execTargets(v, actor.id).includes(target.id);
    opts.push({
      icon: 'sword', text: '처형', cost: '1 AP', danger: true,
      why: !my ? '내 차례가 아니다' : execRange(actor) <= 0 ? `${josa(pname(actor.type, actor.militia), '은/는')} 칼을 들지 않는다` : !inRange ? `사거리 ${execRange(actor)} 밖이다` : v.ap < 1 ? 'AP가 모자란다' : null,
      act: () => this.send({ kind: 'execute', piece: actor.id, target: target.id }),
    });
    const bribe = bribeOptions(v, actor.id).find((o) => o.id === target.id);
    opts.push({
      icon: 'coin', text: '매수', cost: bribe ? `${bribe.cost} 루렌 · 1 AP` : '',
      why: !my ? '내 차례가 아니다' : target.type === 'lord' ? '군주는 매수되지 않는다' : !bribeOpen(v) ? '4번째 차례부터 할 수 있다' : !bribe ? (v.me.silverActive ? '두 칸 안이어야 한다' : '붙어 있어야 한다') : !bribe.affordable ? `루렌이 ${bribe.cost - v.me.ruren} 모자란다` : v.ap < 1 ? 'AP가 모자란다' : null,
      act: () => this.send({ kind: 'bribe', piece: actor.id, target: target.id }),
    });
    if (actor.type === 'spy' && !actor.militia) {
      const ok = interrogateTargets(v, actor.id).includes(target.id);
      opts.push({
        icon: 'eye', text: '심문', cost: `${ABILITY_INFO.interrogate.ap} AP`,
        why: !my ? '내 차례가 아니다' : !PIECES[target.type].court ? '농노는 VIP가 될 수 없다' : !ok ? '붙어 있어야 한다' : v.ap < ABILITY_INFO.interrogate.ap ? 'AP가 모자란다' : null,
        act: () => this.send({ kind: 'interrogate', piece: actor.id, target: target.id }),
      });
    }
    const pop = el('div', 'popover frame');
    pop.innerHTML = `<div class="ph">${esc(pname(actor.type, actor.militia))} → 상대 ${esc(pname(target.type, target.militia))}</div>` +
      opts.map((o, i) => `<button class="opt ${o.danger ? 'danger' : ''}" data-i="${i}" ${o.why ? 'disabled' : ''}>${uiSvg(o.icon)}<span>${o.text}${o.why ? `<span class="why">${esc(o.why)}</span>` : ''}</span><span class="cost">${o.cost}</span></button>`).join('');
    document.body.appendChild(pop);
    const at = this.board.cellToClient(target.r, target.c);
    placeNear(pop, at.x + at.size / 2, at.y, 8);
    pop.querySelectorAll<HTMLButtonElement>('.opt').forEach((b) => b.addEventListener('click', () => {
      audio.play('click');
      opts[Number(b.dataset.i)].act();
      this.closePopover();
    }));
    this.popover = pop;
    (pop.querySelector('.opt:not(:disabled)') as HTMLElement | null)?.focus();
    setTimeout(() => document.addEventListener('pointerdown', this.outside, true), 0);
  }

  private outside = (e: PointerEvent) => {
    if (this.popover && !this.popover.contains(e.target as Node)) {
      const onCanvas = (e.target as HTMLElement)?.tagName === 'CANVAS';
      this.closePopover();
      if (onCanvas) return;
    }
  };

  private closePopover() {
    this.popover?.remove();
    this.popover = null;
    document.removeEventListener('pointerdown', this.outside, true);
  }

  /* 카드 */
  private cardClicked(card: CardId, node: HTMLElement) {
    const v = this.view;
    if (!v || this.animating) return;
    this.closePopover();
    audio.play('card');
    const def = CARDS[card];
    const problem = cardProblem(v, card);
    const pop = el('div', 'popover frame');
    pop.style.width = '280px';
    pop.innerHTML = `
      <div class="ph">${AXIS_NAME[def.axis]} · ${def.cost} 루렌 · ${def.ap} AP${def.secret ? ' · 비밀 카드' : ''}</div>
      <div style="padding:4px 8px 8px"><b style="font-size:17px">${esc(def.name)}</b><p style="margin:6px 0 4px;font-size:13.5px;color:var(--ivory-dim)">${esc(def.text)}</p><i class="muted" style="font-size:12.5px">“${esc(def.flavor)}”</i></div>
      <button class="opt" data-use ${problem ? 'disabled' : ''}>${uiSvg(CARD_ICON[card])}<span>사용한다${problem ? `<span class="why">${esc(problem)}</span>` : ''}</span></button>`;
    document.body.appendChild(pop);
    const r = node.getBoundingClientRect();
    pop.style.left = `${Math.min(window.innerWidth - 290, Math.max(8, r.left + r.width / 2 - 140))}px`;
    pop.style.top = `${Math.max(8, r.top - pop.getBoundingClientRect().height - 12)}px`;
    pop.querySelector('[data-use]')!.addEventListener('click', () => {
      audio.play('click');
      this.closePopover();
      this.startCard(card);
    });
    this.popover = pop;
    setTimeout(() => document.addEventListener('pointerdown', this.outside, true), 0);
  }

  private startCard(card: CardId) {
    const v = this.view!;
    const t = CARDS[card].targeting;
    if (t === 'none') { this.send({ kind: 'card', card }); return; }
    this.selected = null;
    let assassin: string | null = null;
    if (t === 'ownAssassinCell') {
      const list = cardChoices(v, card);
      if (list.length === 1) assassin = list[0];
    }
    this.mode = { kind: 'card', card, picks: [], assassin };
    this.renderAll();
  }

  private cardTargetClick(m: Extract<Mode, { kind: 'card' }>, r: number, c: number, p: ViewPiece | undefined) {
    const v = this.view!;
    const t = CARDS[m.card].targeting;
    const choices = cardChoices(v, m.card);
    if (t === 'ownAssassinCell') {
      if (p && choices.includes(p.id)) { m.assassin = p.id; audio.play('select'); this.renderAll(); return; }
      if (m.assassin && shadowCells(v, m.assassin).some((x) => x.r === r && x.c === c)) {
        this.send({ kind: 'card', card: m.card, pieces: [m.assassin], cell: { r, c } });
        return;
      }
      return;
    }
    if (!p || !choices.includes(p.id)) return;
    if (t === 'enemy3') {
      const i = m.picks.indexOf(p.id);
      if (i >= 0) m.picks.splice(i, 1);
      else if (m.picks.length < 3) m.picks.push(p.id);
      audio.play('select');
      this.renderAll();
      return;
    }
    this.send({ kind: 'card', card: m.card, pieces: [p.id] });
  }

  /* 기물 위 설명 */
  private hover(r: number | null, c: number | null, client: { x: number; y: number }) {
    const v = this.view;
    if (!v || r === null || c === null || this.popover || this.animating) { this.hideTooltip(); return; }
    const p = pieceAt(v, r, c);
    if (!p) { this.hideTooltip(); return; }
    audio.play('hover');
    const def = PIECES[p.type];
    const mine = p.owner === v.you;
    const tags: string[] = [];
    const tag = (t: string, cls = '') => tags.push(`<span class="flag ${cls}">${t}</span>`);
    if (p.id === v.me.orders.vip) tag(`${uiSvg('crown')}나의 VIP`, 'gold');
    if (p.id === v.me.orders.target) tag(`${uiSvg('target')}나의 타겟`, 'warn');
    if (p.owner !== p.origin) tag(`${uiSvg('strings')}매수된 꼭두각시`, 'gold');
    if (p.militia) tag(`${uiSvg('spear')}민병`);
    if (p.rooted) tag(`${uiSvg('chain')}구속 — 움직일 수 없다`, 'warn');
    if (p.buffed) tag(`${uiSvg('sword')}지휘 — 사거리 +1`, 'gold');
    if (p.blessed) tag(`${uiSvg('halo')}축복`, 'gold');
    if (p.poisoned) tag(`${uiSvg('drop')}독 — 곧 죽는다`, 'warn');
    if (p.oath) tag(`${uiSvg('seal')}충성 서약`, 'good');
    if (p.double) tag(`${uiSvg('mask')}대역`, 'good');
    const notes = v.me.intel.filter((n) => n.subjects.includes(p.id));
    for (const n of notes) tag(`${uiSvg('eye')}${n.kind === 'interrogate' ? (n.result ? '심문: VIP' : '심문: VIP 아님') : `보고: 셋 중 ${n.result ? '있음' : '없음'}`}`, n.result ? 'gold' : '');
    const tip = this.tooltip ?? el('div', 'tooltip frame');
    tip.innerHTML = `
      <div class="tt-name">${pieceSvg(p.type)}${mine ? '내' : '상대'} ${esc(pname(p.type, p.militia))}<span class="muted" style="font-weight:400;font-size:12px">${FACTION_NAME[p.owner]}</span></div>
      <div class="tt-line">이동 ${def.move.pattern === 'any' ? '모든 방향' : def.move.pattern === 'line' ? '직선' : '대각선'} ${def.move.range} · 처형 ${execRange(p) || '—'}</div>
      ${def.ability ? `<div class="tt-line"><b>${ABILITY_INFO[def.ability].name}</b> (${ABILITY_INFO[def.ability].ap} AP)</div>` : ''}
      <div class="tt-role">${esc(def.role)}</div>
      ${tags.length ? `<div class="tt-tags">${tags.join('')}</div>` : ''}`;
    if (!this.tooltip) { document.body.appendChild(tip); this.tooltip = tip; }
    placeNear(tip, client.x, client.y, 22);
  }

  private hideTooltip() {
    this.tooltip?.remove();
    this.tooltip = null;
  }

  /* ── 그리기 ───────────────────────────────── */
  private renderAll() {
    if (!this.view) return;
    this.renderTop();
    this.renderLeft();
    this.renderRight();
    this.renderBottom();
    this.renderTargeting();
    this.board.setHighlights(this.highlights());
  }

  private renderTop() {
    const v = this.view, m = this.match;
    if (!v || !m) return;
    const me = v.you, op = other(me);
    const set = (sel: string, html: string) => { $(this.root, sel).innerHTML = html; };
    $(this.root, '[data-me-chip]').className = `house-chip ${me}`;
    $(this.root, '[data-op-chip]').className = `house-chip opp-id ${op}`;
    set('[data-me-name]', esc(m.names[me]));
    set('[data-me-sub]', `${FACTION_NAME[me]} 신디케이트 · 나`);
    set('[data-op-name]', esc(m.names[op]));
    set('[data-op-sub]', `${FACTION_NAME[op]} 신디케이트${this.opponent === 'away' ? ' · <span class="blood">연결 끊김</span>' : ''}`);
    const pips = (n: number) => Array.from({ length: WINS_TO_TAKE_MATCH }, (_, i) => `<div class="pip ${i < n ? 'on' : ''}"></div>`).join('');
    set('[data-me-pips]', pips(m.scores[me]));
    set('[data-op-pips]', pips(m.scores[op]));
    set('[data-round]', `ROUND ${roman(v.round)}${m.replay ? ' · 재경기' : ''}<span class="rscore"> · ${m.scores[me]} : ${m.scores[op]}</span>`);
    const t = $(this.root, '[data-turn]');
    const over = v.winner !== null || v.draw;
    t.className = `turn-label ${v.current === me ? 'mine' : 'theirs'}`;
    t.textContent = over ? '판이 끝났다' : v.current === me ? '당신의 차례' : `${m.names[op]}의 차례`;
    this.tickClock();
  }

  private tickClock() {
    const v = this.view;
    const clock = this.root.querySelector('[data-clock]') as HTMLElement | null;
    const bar = this.root.querySelector('[data-clockbar]') as HTMLElement | null;
    if (!v || !clock || !bar) return;
    const turns = `${Math.min(v.maxTurnsEach, v.turnsTaken[v.current] + 1)}/${v.maxTurnsEach}`;
    if (!this.deadline || v.winner !== null || v.draw) {
      clock.innerHTML = `${uiSvg('hourglass')}<span>차례 ${turns}</span>`;
      bar.style.transform = 'scaleX(0)';
      return;
    }
    const left = this.deadline - this.net.now();
    const warn = left < 10_000;
    clock.className = `clock ${warn ? 'warn' : ''}`;
    clock.innerHTML = `${uiSvg('hourglass')}<span>${fmtClock(left)} · 차례 ${turns}</span>`;
    bar.style.transform = `scaleX(${Math.max(0, Math.min(1, left / (TURN_SECONDS * 1000)))})`;
    bar.parentElement!.classList.toggle('warn', warn);
    const sec = Math.ceil(left / 1000);
    if (warn && isMyTurn(v) && sec !== this.lastTick && sec > 0) { this.lastTick = sec; audio.play('tick'); }
  }

  private renderLeft() {
    const v = this.view!;
    $(this.root, '[data-house]').textContent = FACTION_NAME[v.you];
    const vip = pieceById(v, v.me.orders.vip) ?? v.graveyard.find((g) => g.id === v.me.orders.vip);
    const tgt = pieceById(v, v.me.orders.target) ?? v.graveyard.find((g) => g.id === v.me.orders.target);
    const vipAlive = !!pieceById(v, v.me.orders.vip);
    const tgtLost = !!tgt && !pieceById(v, v.me.orders.target);
    $(this.root, '[data-orders]').innerHTML = `
      <div class="order vip ${v.me.exposed ? 'exposed' : ''}">
        <div class="k">${uiSvg('crown')}지켜라 · VIP</div>
        <div class="v">${vip ? pieceSvg(vip.type) : ''}${vip ? pname(vip.type) : '?'}</div>
        <div class="state">${!vipAlive ? '쓰러졌다' : v.me.exposed ? '노출됨 — 상대가 안다' : '아직 숨겨져 있다'}</div>
      </div>
      <div class="order tgt ${v.me.targetDone ? 'done' : ''}">
        <div class="k">${uiSvg('target')}처형하라 · 타겟</div>
        <div class="v">${tgt ? pieceSvg(tgt.type) : ''}${tgt ? pname(tgt.type) : '?'}</div>
        <div class="state">${v.me.targetDone ? (tgtLost ? '처형했다' : '포섭했다') : '살아 있다'}</div>
      </div>`;
    const vs = v.me.vipState;
    $(this.root, '[data-conds]').innerHTML = `
      <div class="cond ${v.me.targetDone ? 'done' : ''}"><span class="mark"></span><span class="what">내 타겟 처형</span><span class="st">${v.me.targetDone ? '달성' : '남음'}</span></div>
      <div class="cond ${vs === 'done' ? 'done' : vs === 'unknown' ? 'unknown' : ''}"><span class="mark"></span><span class="what">상대 VIP 처형</span><span class="st">${vs === 'done' ? '달성' : vs === 'unknown' ? '알 수 없음' : '남음'}</span></div>`;
    $(this.root, '[data-ruren]').textContent = String(v.me.ruren);
    const serfs = v.pieces.filter((p) => p.owner === v.you && p.type === 'serf' && !p.militia).length;
    $(this.root, '[data-income]').textContent = `루렌 · 다음 수입 +${v.me.famine ? 0 : serfs * INCOME_PER_SERF} (농노 ${serfs})`;
    const flags: string[] = [];
    const f = (icon: UiIcon, t: string, cls: string) => flags.push(`<span class="flag ${cls}">${uiSvg(icon)}${t}</span>`);
    if (v.me.censor) f('scroll', '검열 대기', 'good');
    if (v.me.forgeryPending) f('quill', '위조 서신 대기', 'good');
    if (v.me.silverActive) f('strings', '은화: 반값 매수', 'gold');
    if (v.me.famine) f('hourglass', '다음 차례 흉년', 'warn');
    if (v.me.curfew) f('bell', '다음 차례 통금', 'warn');
    if (v.me.timeouts) f('hourglass', `시간 초과 ${v.me.timeouts}/3`, 'warn');
    if (!bribeOpen(v)) f('coin', `매수는 ${4 - v.turnsTaken[v.you]}차례 뒤부터`, '');
    $(this.root, '[data-flags]').innerHTML = flags.join('');
  }

  private renderRight() {
    const v = this.view!;
    const op = other(v.you);
    $(this.root, '[data-op-house]').textContent = FACTION_NAME[op];
    const opSerfs = v.pieces.filter((p) => p.owner === op && p.type === 'serf' && !p.militia).length;
    const opCourt = v.pieces.filter((p) => p.owner === op && PIECES[p.type].court).length;
    $(this.root, '[data-foe]').innerHTML = `
      <div class="stat"><b>${v.opponent.ruren}</b><span>루렌</span></div>
      <div class="stat"><b>${v.opponent.handCount}</b><span>손패</span></div>
      <div class="stat"><b>${opCourt}</b><span>궁정</span></div>
      <div class="stat"><b>${opSerfs}</b><span>농노</span></div>`;
    this.renderFeed();
  }

  private renderFeed() {
    const v = this.view;
    if (!v) return;
    this.root.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === this.tab));
    $(this.root, '[data-news-count]').textContent = v.chronicle.length ? String(v.chronicle.length) : '';
    $(this.root, '[data-intel-count]').textContent = v.me.intel.length ? String(v.me.intel.length) : '';
    const feed = $(this.root, '[data-feed]');
    if (this.tab === 'news') {
      feed.dataset.empty = '아직 궁정은 조용하다.';
      feed.innerHTML = [...v.chronicle].reverse().map((n) => `
        <div class="gazette-item ${n.censored ? 'censored' : n.tone}">
          <div class="tag"><span>${esc(n.tag)}</span><span>No. ${n.id}</span></div>
          <h4>${esc(n.title)}</h4><p>${esc(n.body)}</p></div>`).join('');
    } else {
      feed.dataset.empty = '첩자의 심문이나 밀정의 보고로 얻은 정보가 여기에 적힌다. 위조 서신에 당했다면 거짓일 수도 있다.';
      const find = (id: string) => pieceById(v, id) ?? v.graveyard.find((g) => g.id === id);
      feed.innerHTML = [...v.me.intel].reverse().map((n) => {
        const names = n.subjects.map((id) => { const p = find(id); return p ? pname(p.type, p.militia) : '?'; }).join(', ');
        return `<div class="note">${uiSvg('eye')}<div><div class="when">${Math.ceil(n.turn / 2)}번째 차례 · ${n.kind === 'interrogate' ? '심문' : '밀정의 보고'}</div>
          ${n.kind === 'interrogate'
            ? `${esc(names)} — <b class="${n.result ? 'yes' : 'no'}">${n.result ? 'VIP다' : 'VIP가 아니다'}</b>`
            : `${esc(names)} 중에 VIP가 <b class="${n.result ? 'yes' : 'no'}">${n.result ? '있다' : '없다'}</b>`}
          </div></div>`;
      }).join('');
    }
  }

  private renderBottom() {
    const v = this.view!;
    const my = isMyTurn(v);
    $(this.root, '[data-gems]').innerHTML = [0, 1, 2].map((i) => `<div class="gem ${my && i < v.ap ? 'on' : my ? 'spent' : ''}"></div>`).join('');
    const endBtn = $(this.root, '[data-act="end"]') as HTMLButtonElement;
    endBtn.disabled = !my || this.pending;

    // 선택한 기물
    const sel = $(this.root, '[data-sel]');
    const p = this.selected ? pieceById(v, this.selected) : null;
    if (!p) {
      sel.innerHTML = `<div class="hint">${my ? '내 기물을 누르면 갈 수 있는 칸과 칠 수 있는 적이 보인다. 적을 누르면 처형·매수를 고른다.' : `${esc(this.oppName())}의 수를 기다리는 중… 기물을 눌러 살펴볼 수는 있다.`}</div>`;
    } else {
      const def = PIECES[p.type];
      const acts: string[] = [];
      const ab = def.ability && !p.militia ? ABILITY_INFO[def.ability] : null;
      if (ab && def.ability === 'royal') {
        const fx = royalEffect(v, p.id);
        const can = my && v.ap >= ab.ap && !this.pending;
        acts.push(`<button class="btn small" data-ab="royal" ${can ? '' : 'disabled'} title="${esc(ab.text)}">${uiSvg('crown')}${ab.name} · ${ab.ap}AP${fx.rooted.length ? ` (적 ${fx.rooted.length})` : ''}</button>`);
      }
      if (ab && def.ability === 'interrogate') {
        const can = my && v.ap >= ab.ap && interrogateTargets(v, p.id).length > 0 && !this.pending;
        acts.push(`<button class="btn small" data-ab="interrogate" ${can ? '' : 'disabled'} title="${esc(ab.text)}">${uiSvg('eye')}${ab.name} · ${ab.ap}AP</button>`);
      }
      if (ab && def.ability === 'bless') {
        const can = my && v.ap >= ab.ap && blessTargets(v, p.id).length > 0 && !this.pending;
        acts.push(`<button class="btn small" data-ab="bless" ${can ? '' : 'disabled'} title="${esc(ab.text)}">${uiSvg('halo')}${ab.name} · ${ab.ap}AP</button>`);
      }
      const bribes = bribeOptions(v, p.id);
      if (bribeOpen(v)) {
        const can = my && v.ap >= 1 && bribes.some((b) => b.affordable) && !this.pending;
        acts.push(`<button class="btn small" data-ab="bribe" ${can ? '' : 'disabled'}>${uiSvg('coin')}매수 · 1AP</button>`);
      }
      const moves = my ? reachable(v, p.id).length : 0;
      const execs = execTargets(v, p.id).length;
      sel.innerHTML = `
        <div class="portrait ${p.owner}">${pieceSvg(p.type)}</div>
        <div class="info">
          <div class="name">${esc(pname(p.type, p.militia))}${p.id === v.me.orders.vip ? ' <span class="gold" style="font-size:12px">· VIP</span>' : ''}${p.owner !== p.origin ? ' <span class="muted" style="font-size:12px">· 꼭두각시</span>' : ''}</div>
          <div class="stats">이동 ${def.move.pattern === 'any' ? '모든 방향' : def.move.pattern === 'line' ? '직선' : '대각선'} ${def.move.range} · 처형 ${execRange(p) || '—'}${p.rooted ? ' · <span class="blood">구속됨</span>' : ''}</div>
          <div class="stats muted">${my ? `갈 수 있는 칸 ${moves} · 칠 수 있는 적 ${execs}` : '상대의 차례'}</div>
        </div>
        <div class="actions">${acts.join('')}</div>`;
      sel.querySelectorAll<HTMLButtonElement>('[data-ab]').forEach((b) => b.addEventListener('click', () => {
        audio.play('click');
        const kind = b.dataset.ab!;
        if (kind === 'royal') { this.send({ kind: 'royal', piece: p.id }); return; }
        this.mode = { kind: kind as 'bribe' | 'interrogate' | 'bless', piece: p.id };
        this.renderAll();
      }));
    }

    // 손패
    const hand = $(this.root, '[data-hand]');
    if (!v.me.hand.length) {
      hand.innerHTML = '<div class="hand-empty">손패를 모두 썼다.</div>';
    } else {
      hand.innerHTML = v.me.hand.map((c, i) => {
        const d = CARDS[c];
        const problem = cardProblem(v, c);
        const focus = this.mode?.kind === 'card' && this.mode.card === c;
        return `<div class="card ${problem ? 'disabled' : ''} ${c === 'switch' ? 'signature' : ''} ${focus ? 'focus' : ''}" data-card="${c}" data-i="${i}" title="${esc(problem ?? d.text)}" tabindex="0" role="button" aria-label="${esc(d.name)}">
          <div class="cost">${d.cost}</div>${d.ap ? `<div class="apcost"><span>${d.ap}</span></div>` : ''}
          <div class="axis">${AXIS_NAME[d.axis]}</div>
          <div class="cico">${uiSvg(CARD_ICON[c])}</div>
          <div class="cname">${esc(d.name)}</div>
          <div class="cflavor">${esc(d.flavor)}</div>
          ${d.secret ? `<div class="secret" title="비밀 카드">${uiSvg('seal')}</div>` : ''}
        </div>`;
      }).join('');
      hand.querySelectorAll<HTMLElement>('.card').forEach((node) => {
        const go = () => this.cardClicked(node.dataset.card as CardId, node);
        node.addEventListener('click', go);
        node.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
        node.addEventListener('mouseenter', () => audio.play('hover'));
      });
    }
  }

  private renderTargeting() {
    const wrap = this.boardWrap();
    wrap.querySelector('.targeting')?.remove();
    const m = this.mode;
    if (!m || !this.view) return;
    let msg = '';
    let sub = '';
    let confirm = '';
    if (m.kind === 'bribe') { msg = '매수할 적을 고르세요'; sub = '초록 테두리 위의 숫자가 비용이다. 회색은 루렌이 모자란다.'; }
    if (m.kind === 'interrogate') { msg = '심문할 적을 고르세요'; sub = '붙어 있는 적 궁정 기물이 VIP인지 캐낸다.'; }
    if (m.kind === 'bless') { msg = '축복할 아군을 고르세요'; sub = '상대의 다음 차례 동안 처형을 한 번 막는다.'; }
    if (m.kind === 'card') {
      const d = CARDS[m.card];
      const t = d.targeting;
      msg = d.name;
      if (t === 'enemy3') { sub = `적 기물 셋을 고르세요 (${m.picks.length}/3)`; if (m.picks.length === 3) confirm = '보고를 받는다'; }
      if (t === 'own') sub = '내 기물 하나를 고르세요';
      if (t === 'ownSerf') sub = '민병으로 삼을 농노를 고르세요';
      if (t === 'poison') sub = '독을 탈 적을 고르세요 (내 기물에 붙어 있는 적)';
      if (t === 'ownAssassinCell') sub = m.assassin ? '옮겨 갈 빈칸을 고르세요 (보라색 점)' : '옮길 자객을 고르세요';
    }
    const bar = el('div', 'targeting frame', `<div class="msg">${esc(msg)}<small>${esc(sub)}</small></div>
      ${confirm ? `<button class="btn primary small" data-confirm>${esc(confirm)}</button>` : ''}
      <button class="btn ghost small" data-cancel>취소 <span class="kbd">Esc</span></button>`);
    wrap.appendChild(bar);
    bar.querySelector('[data-cancel]')!.addEventListener('click', () => { audio.play('click'); this.mode = null; this.renderAll(); });
    bar.querySelector('[data-confirm]')?.addEventListener('click', () => {
      audio.play('click');
      if (m.kind === 'card') this.send({ kind: 'card', card: m.card, pieces: [...m.picks] });
    });
  }

  private highlights(): Highlights {
    const v = this.view;
    if (!v) return NO_HIGHLIGHTS;
    const my = isMyTurn(v) && !this.pending;
    const h: Highlights = { ...NO_HIGHLIGHTS, moves: [], execs: [], bribes: [], rings: [], choices: [], picks: [], cells: [] };
    const m = this.mode;
    if (m && my) {
      if (m.kind === 'card') {
        const t = CARDS[m.card].targeting;
        if (t === 'ownAssassinCell') {
          h.choices = cardChoices(v, m.card);
          if (m.assassin) { h.selected = m.assassin; h.cells = shadowCells(v, m.assassin); }
        } else {
          h.choices = cardChoices(v, m.card);
          h.picks = [...m.picks];
        }
        return h;
      }
      h.selected = m.piece;
      if (m.kind === 'bribe') h.bribes = bribeOptions(v, m.piece);
      if (m.kind === 'interrogate') h.rings = interrogateTargets(v, m.piece).map((id) => ({ id, tone: 'ivory' as const }));
      if (m.kind === 'bless') h.rings = blessTargets(v, m.piece).map((id) => ({ id, tone: 'gold' as const }));
      return h;
    }
    if (!this.selected) return h;
    h.selected = this.selected;
    if (my) {
      if (v.ap >= 1) h.moves = reachable(v, this.selected);
      if (v.ap >= 1) h.execs = execTargets(v, this.selected);
    } else {
      h.execs = execTargets(v, this.selected);
    }
    return h;
  }
}

export type { Cell };
