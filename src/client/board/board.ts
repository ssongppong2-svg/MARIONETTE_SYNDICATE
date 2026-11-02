/**
 * 보드 그리기 (PixiJS). 보드는 가만히 있고, 연출은 행동이 일어날 때 한 번만 재생합니다.
 * 반복 애니메이션은 매수 대상 고르기(깜빡임) 때만 씁니다.
 */
import { Application, Container, Graphics, Rectangle, Sprite, Text, Texture, type FederatedPointerEvent } from 'pixi.js';
import { N } from '../../shared/data';
import type { Cell, Faction, PieceType } from '../../shared/types';
import type { PlayerView, ViewPiece } from '../../shared/view';
import { manifest, loadImage } from '../assets';
import type { UiIcon } from '../icons';
import { settings } from '../settings';
import { GEO, HOUSE, PAL, paintBadge, paintBoard, paintMedallion, paintParticle } from './art';

export interface Highlights {
  selected: string | null;
  moves: Cell[];
  execs: string[];
  bribes: { id: string; cost: number; affordable: boolean }[];
  rings: { id: string; tone: 'ivory' | 'gold' }[];
  choices: string[];
  picks: string[];
  cells: Cell[];
  /** 배치 단계: 기물을 놓을 수 있는 내 진영 칸 */
  home: Cell[];
}
export const NO_HIGHLIGHTS: Highlights = { selected: null, moves: [], execs: [], bribes: [], rings: [], choices: [], picks: [], cells: [], home: [] };

export interface IntelMark { id: string; vip: boolean }

export interface BoardCallbacks {
  onCell(r: number, c: number, client: { x: number; y: number }): void;
  onHover(r: number | null, c: number | null, client: { x: number; y: number }): void;
  onCancel(): void;
}

interface PieceSprite {
  id: string;
  root: Container;
  medal: Sprite;
  strings: Graphics;
  marks: Container;
  key: string;
  dying: boolean;
}

interface Tween { start: number; dur: number; step(k: number): void; resolve(): void; ease: (k: number) => number }
interface Particle { s: Sprite; vx: number; vy: number; g: number; life: number; max: number; spin: number; fade: boolean; shrink: number }

const easeInOut = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);
const easeOut = (k: number) => 1 - (1 - k) ** 3;
const linear = (k: number) => k;
const hex = (s: string) => parseInt(s.replace('#', ''), 16);

export class Board {
  private app = new Application();
  private host!: HTMLElement;
  private root = new Container();
  private bg = new Sprite();
  private markLayer = new Graphics();
  private pulseLayer = new Graphics();
  private labelLayer = new Container();
  private pieceLayer = new Container();
  private fxLayer = new Container();
  private textLayer = new Container();
  sprites = new Map<string, PieceSprite>();
  private textures = new Map<string, Texture>();
  private particleTex!: Record<'soft' | 'shard' | 'coin' | 'drop' | 'spark', Texture>;
  private tweens: Tween[] = [];
  private particles: Particle[] = [];
  private raf = 0;
  private you: Faction = 'red';
  private coordsShown = true;
  private highlights: Highlights = NO_HIGHLIGHTS;
  private intel: IntelMark[] = [];
  private view: PlayerView | null = null;
  private portraits: Partial<Record<PieceType, HTMLImageElement | null>> = {};
  private shakeUntil = 0;
  private shakePower = 0;
  private resizeObs: ResizeObserver | null = null;
  private hoverCell: Cell | null = null;
  ready = false;

  constructor(private readonly cb: BoardCallbacks) {}

  async init(host: HTMLElement) {
    this.host = host;
    await this.app.init({
      backgroundAlpha: 0, antialias: true, autoDensity: true, autoStart: false, sharedTicker: false,
      resolution: Math.min(2, window.devicePixelRatio || 1), width: host.clientWidth || 600, height: host.clientHeight || 600,
    });
    host.appendChild(this.app.canvas);
    this.app.canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); this.cb.onCancel(); });
    this.app.stage.addChild(this.root);
    this.root.addChild(this.bg, this.markLayer, this.pulseLayer, this.pieceLayer, this.labelLayer, this.fxLayer, this.textLayer);

    const pt = (k: 'soft' | 'shard' | 'coin' | 'drop' | 'spark') => Texture.from(paintParticle(k));
    this.particleTex = { soft: pt('soft'), shard: pt('shard'), coin: pt('coin'), drop: pt('drop'), spark: pt('spark') };

    const pieces = manifest.art.pieces ?? {};
    await Promise.all(Object.entries(pieces).map(async ([t, src]) => {
      if (src) this.portraits[t as PieceType] = await loadImage(src);
    }));

    this.root.eventMode = 'static';
    this.root.hitArea = new Rectangle(GEO.frame, GEO.frame, GEO.cell * N, GEO.cell * N);
    this.root.cursor = 'pointer';
    this.root.on('pointertap', (e: FederatedPointerEvent) => {
      if (e.button === 2) return;
      const cell = this.cellAt(e);
      if (cell) this.cb.onCell(cell.r, cell.c, { x: e.clientX, y: e.clientY });
    });
    this.root.on('pointermove', (e: FederatedPointerEvent) => {
      const cell = this.cellAt(e);
      const same = cell && this.hoverCell && cell.r === this.hoverCell.r && cell.c === this.hoverCell.c;
      if (same) return;
      this.hoverCell = cell;
      this.cb.onHover(cell?.r ?? null, cell?.c ?? null, { x: e.clientX, y: e.clientY });
    });
    this.root.on('pointerleave', (e: FederatedPointerEvent) => {
      this.hoverCell = null;
      this.cb.onHover(null, null, { x: e.clientX, y: e.clientY });
    });

    if (new URLSearchParams(location.search).has('debug')) (window as unknown as { __msBoard: Board }).__msBoard = this;
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(host);
    this.paintBackground();
    this.resize();
    this.ready = true;
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.resizeObs?.disconnect();
    this.app.destroy(true, { children: true, texture: true });
  }

  /* ── 좌표 ─────────────────────────────────── */
  private displayRow(r: number) { return this.you === 'blue' ? N - 1 - r : r; }
  private engineRow(dr: number) { return this.you === 'blue' ? N - 1 - dr : dr; }
  private center(r: number, c: number) {
    return { x: GEO.frame + (c + 0.5) * GEO.cell, y: GEO.frame + (this.displayRow(r) + 0.5) * GEO.cell };
  }
  private cellAt(e: FederatedPointerEvent): Cell | null {
    const p = this.root.toLocal(e.global);
    const c = Math.floor((p.x - GEO.frame) / GEO.cell);
    const dr = Math.floor((p.y - GEO.frame) / GEO.cell);
    if (c < 0 || c >= N || dr < 0 || dr >= N) return null;
    return { r: this.engineRow(dr), c };
  }
  /** 칸 가운데의 화면 좌표 (팝업 위치용) */
  cellToClient(r: number, c: number): { x: number; y: number; size: number } {
    const p = this.center(r, c);
    const g = this.root.toGlobal(p);
    const rect = this.app.canvas.getBoundingClientRect();
    const scaleX = rect.width / this.app.screen.width;
    return { x: rect.left + g.x * scaleX, y: rect.top + g.y * scaleX, size: GEO.cell * this.root.scale.x * scaleX };
  }

  resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.app.renderer.resize(w, h);
    const s = Math.min(w, h) / GEO.size;
    this.root.scale.set(s);
    this.root.position.set((w - GEO.size * s) / 2, (h - GEO.size * s) / 2);
    this.render();
  }

  setPerspective(you: Faction) {
    if (this.you === you && this.bg.texture !== Texture.EMPTY) return;
    this.you = you;
    this.paintBackground();
    for (const s of this.sprites.values()) s.root.destroy({ children: true });
    this.sprites.clear();
  }

  private paintBackground() {
    this.coordsShown = settings.coords;
    const old = this.bg.texture;
    this.bg.texture = Texture.from(paintBoard((r) => this.displayRow(r), this.coordsShown));
    if (old && old !== Texture.EMPTY) old.destroy(true);
    this.render();
  }

  refreshSettings() {
    if (this.coordsShown !== settings.coords) this.paintBackground();
  }

  /* ── 텍스처 ───────────────────────────────── */
  private medalTexture(type: PieceType, owner: Faction, militia: boolean): Texture {
    const key = `${type}:${owner}:${militia ? 1 : 0}`;
    let t = this.textures.get(key);
    if (!t) {
      t = Texture.from(paintMedallion(type, owner, 180, { militia, portrait: this.portraits[type] ?? null }));
      this.textures.set(key, t);
    }
    return t;
  }
  private badgeTexture(icon: UiIcon, fg: string, bg: string): Texture {
    const key = `badge:${icon}:${fg}:${bg}`;
    let t = this.textures.get(key);
    if (!t) {
      t = Texture.from(paintBadge(icon, fg, bg, 72));
      this.textures.set(key, t);
    }
    return t;
  }

  /* ── 상태 맞추기 ──────────────────────────── */
  setIntel(marks: IntelMark[]) { this.intel = marks; if (this.view) this.sync(this.view); }

  sync(view: PlayerView) {
    this.view = view;
    if (view.you !== this.you) this.setPerspective(view.you);
    const seen = new Set<string>();
    for (const p of view.pieces) {
      seen.add(p.id);
      let s = this.sprites.get(p.id);
      if (!s) s = this.createSprite(p);
      if (s.dying) continue;
      const key = `${p.type}:${p.owner}:${p.militia ? 1 : 0}`;
      if (s.key !== key) { s.medal.texture = this.medalTexture(p.type, p.owner, p.militia); s.key = key; }
      const at = this.center(p.r, p.c);
      s.root.position.set(at.x, at.y);
      s.root.alpha = 1;
      s.root.scale.set(1);
      s.root.rotation = 0;
      this.drawStrings(s, p);
      this.drawMarks(s, p, view);
    }
    for (const [id, s] of this.sprites) {
      if (!seen.has(id)) { s.root.destroy({ children: true }); this.sprites.delete(id); }
    }
    this.drawHighlights();
    this.render();
  }

  private createSprite(p: ViewPiece): PieceSprite {
    const root = new Container();
    const strings = new Graphics();
    const medal = new Sprite(this.medalTexture(p.type, p.owner, p.militia));
    medal.anchor.set(0.5);
    const scale = (GEO.cell * (p.type === 'serf' ? 0.74 : 0.86)) / 180;
    medal.scale.set(scale);
    const marks = new Container();
    root.addChild(strings, medal, marks);
    const at = this.center(p.r, p.c);
    root.position.set(at.x, at.y);
    this.pieceLayer.addChild(root);
    const s: PieceSprite = { id: p.id, root, medal, strings, marks, key: `${p.type}:${p.owner}:${p.militia ? 1 : 0}`, dying: false };
    this.sprites.set(p.id, s);
    return s;
  }

  /** 매수된 기물: 꼭두각시 실 */
  private drawStrings(s: PieceSprite, p: ViewPiece) {
    s.strings.clear();
    if (p.owner === p.origin) return;
    const h = GEO.cell * 0.62;
    const top = -h;
    const accent = hex(HOUSE[p.owner].glint);
    s.strings.moveTo(-GEO.cell * 0.2, top).lineTo(GEO.cell * 0.2, top).stroke({ width: 3, color: hex(PAL.wood), alpha: 0.95 });
    s.strings.moveTo(0, top - 6).lineTo(0, top + 6).stroke({ width: 3, color: hex(PAL.wood), alpha: 0.95 });
    for (const x of [-0.18, 0, 0.18]) {
      s.strings.moveTo(GEO.cell * x, top).lineTo(GEO.cell * x * 0.6, -GEO.cell * 0.3).stroke({ width: 1.4, color: accent, alpha: 0.85 });
    }
  }

  private drawMarks(s: PieceSprite, p: ViewPiece, v: PlayerView) {
    s.marks.removeChildren().forEach((c) => c.destroy());
    const R = GEO.cell * (p.type === 'serf' ? 0.37 : 0.43);
    const ring = new Graphics();
    s.marks.addChild(ring);
    if (p.id === v.me.orders.vip) {
      ring.circle(0, 0, R + 5).stroke({ width: 3.5, color: hex(PAL.gold), alpha: 1 });
      ring.circle(0, 0, R + 10).stroke({ width: 1.2, color: hex(PAL.goldHi), alpha: 0.8 });
      this.addBadge(s, 'crown', PAL.ink, PAL.gold, 0, -R - 6, 0.4);
    }
    if (p.id === v.me.orders.target && !v.me.targetDone) {
      for (let i = 0; i < 4; i++) {
        const a0 = (i * Math.PI) / 2 + 0.25, a1 = a0 + Math.PI / 2 - 0.5;
        ring.arc(0, 0, R + 7, a0, a1).stroke({ width: 4, color: hex(PAL.iron), alpha: 1 });
      }
      this.addBadge(s, 'target', PAL.ivory, PAL.blood, 0, -R - 6, 0.4);
    }
    const corner = [
      { x: R * 0.78, y: -R * 0.78 }, { x: -R * 0.78, y: -R * 0.78 }, { x: R * 0.78, y: R * 0.78 }, { x: -R * 0.78, y: R * 0.78 },
    ];
    let k = 0;
    const put = (icon: UiIcon, fg: string, bg: string) => { const c = corner[k++ % 4]; this.addBadge(s, icon, fg, bg, c.x, c.y, 0.32); };
    if (p.rooted) put('chain', PAL.ivory, '#3a3a40');
    if (p.buffed) put('sword', PAL.ink, PAL.gold);
    if (p.blessed) put('halo', PAL.ink, '#e9dfb8');
    if (p.poisoned) put('drop', '#cfe3a0', '#2f3d1c');
    if (p.oath) put('seal', PAL.ivory, PAL.blood);
    if (p.double) put('mask', PAL.ink, PAL.ivory);
    const intel = this.intel.find((m) => m.id === p.id);
    if (intel && p.owner !== v.you) put('eye', intel.vip ? PAL.ink : PAL.ivory, intel.vip ? PAL.gold : '#3c3a40');
  }

  private addBadge(s: PieceSprite, icon: UiIcon, fg: string, bg: string, x: number, y: number, size: number) {
    const b = new Sprite(this.badgeTexture(icon, fg, bg));
    b.anchor.set(0.5);
    b.scale.set((GEO.cell * size) / 72);
    b.position.set(x, y);
    s.marks.addChild(b);
  }

  /* ── 강조 표시 ────────────────────────────── */
  setHighlights(h: Highlights) {
    this.highlights = h;
    this.drawHighlights();
    this.render();
    if (h.bribes.length) this.loop();
  }

  private drawHighlights() {
    const g = this.markLayer;
    g.clear();
    this.labelLayer.removeChildren().forEach((c) => c.destroy());
    const h = this.highlights;
    const pos = (id: string) => {
      const p = this.view?.pieces.find((q) => q.id === id);
      return p ? this.center(p.r, p.c) : null;
    };
    const C = GEO.cell;
    if (h.selected) {
      const at = pos(h.selected);
      if (at) {
        g.rect(at.x - C / 2 + 3, at.y - C / 2 + 3, C - 6, C - 6).fill({ color: hex(PAL.goldHi), alpha: 0.16 });
        g.rect(at.x - C / 2 + 3, at.y - C / 2 + 3, C - 6, C - 6).stroke({ width: 3, color: hex(PAL.goldHi), alpha: 0.95 });
      }
    }
    for (const m of h.moves) {
      const at = this.center(m.r, m.c);
      g.poly([at.x, at.y - 9, at.x + 9, at.y, at.x, at.y + 9, at.x - 9, at.y]).fill({ color: hex(PAL.ivory), alpha: 0.62 });
    }
    for (const m of h.home) {
      const at = this.center(m.r, m.c);
      g.rect(at.x - C / 2 + 2, at.y - C / 2 + 2, C - 4, C - 4).fill({ color: hex(PAL.gold), alpha: 0.08 });
      g.rect(at.x - C / 2 + 6, at.y - C / 2 + 6, C - 12, C - 12).stroke({ width: 1.2, color: hex(PAL.goldHi), alpha: 0.35 });
    }
    for (const m of h.cells) {
      const at = this.center(m.r, m.c);
      g.circle(at.x, at.y, 9).fill({ color: 0x9a7ab0, alpha: 0.7 });
      g.circle(at.x, at.y, 14).stroke({ width: 1.5, color: 0x9a7ab0, alpha: 0.5 });
    }
    const brackets = (x: number, y: number, color: number, width = 4, inset = 6) => {
      const a = C / 2 - inset, l = C * 0.22;
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        g.moveTo(x + sx * a, y + sy * (a - l)).lineTo(x + sx * a, y + sy * a).lineTo(x + sx * (a - l), y + sy * a)
          .stroke({ width, color, alpha: 1, cap: 'square' });
      }
    };
    for (const id of h.execs) { const at = pos(id); if (at) brackets(at.x, at.y, hex(PAL.iron)); }
    for (const r of h.rings) {
      const at = pos(r.id);
      if (at) g.circle(at.x, at.y, C * 0.47).stroke({ width: 3, color: hex(r.tone === 'gold' ? PAL.goldHi : PAL.ivory), alpha: 0.9 });
    }
    for (const id of h.choices) {
      const at = pos(id);
      if (at && !h.picks.includes(id)) g.rect(at.x - C / 2 + 5, at.y - C / 2 + 5, C - 10, C - 10).stroke({ width: 2, color: hex(PAL.ivory), alpha: 0.7 });
    }
    h.picks.forEach((id, i) => {
      const at = pos(id);
      if (!at) return;
      brackets(at.x, at.y, hex(PAL.goldHi), 5, 4);
      this.label(String(i + 1), at.x + C * 0.34, at.y - C * 0.34, PAL.ink, PAL.goldHi);
    });
    for (const b of h.bribes) {
      const at = pos(b.id);
      if (at) this.label(`${b.cost}`, at.x, at.y - C * 0.5, b.affordable ? PAL.ink : PAL.ivory, b.affordable ? '#9cb873' : '#4a4a4a');
    }
    this.drawPulse(performance.now());
  }

  private drawPulse(now: number) {
    const g = this.pulseLayer;
    g.clear();
    const bribes = this.highlights.bribes;
    if (!bribes.length) return;
    const k = settings.reduceMotion ? 1 : 0.55 + 0.45 * Math.sin(now / 260);
    for (const b of bribes) {
      const p = this.view?.pieces.find((q) => q.id === b.id);
      if (!p) continue;
      const at = this.center(p.r, p.c);
      const C = GEO.cell;
      g.roundRect(at.x - C / 2 + 4, at.y - C / 2 + 4, C - 8, C - 8, 10).stroke({ width: 4, color: b.affordable ? 0x8fb35c : 0x5a5a5a, alpha: b.affordable ? k : 0.5 });
    }
  }

  private label(text: string, x: number, y: number, fg: string, bg: string) {
    const c = new Container();
    const t = new Text({ text, style: { fontFamily: 'Cinzel, "Nanum Myeongjo", serif', fontWeight: '700', fontSize: 22, fill: fg } });
    t.anchor.set(0.5);
    const w = Math.max(30, t.width + 14);
    const box = new Graphics().roundRect(-w / 2, -15, w, 30, 15).fill({ color: hex(bg) }).stroke({ width: 2, color: hex(PAL.ink), alpha: 0.7 });
    c.addChild(box, t);
    c.position.set(x, y);
    this.labelLayer.addChild(c);
  }

  /* ── 그리기 루프 ──────────────────────────── */
  render() {
    if (!this.ready && !this.app.renderer) return;
    try { this.app.render(); } catch { /* 초기화 전 */ }
  }

  private loop() {
    if (this.raf) return;
    const tick = () => {
      this.raf = 0;
      const now = performance.now();
      for (const t of [...this.tweens]) {
        const k = Math.min(1, (now - t.start) / t.dur);
        t.step(t.ease(k));
        if (k >= 1) { this.tweens.splice(this.tweens.indexOf(t), 1); t.resolve(); }
      }
      for (const p of [...this.particles]) {
        p.life += 16.7;
        const k = p.life / p.max;
        p.vy += p.g;
        p.s.x += p.vx;
        p.s.y += p.vy;
        p.s.rotation += p.spin;
        if (p.fade) p.s.alpha = Math.max(0, 1 - k);
        if (p.shrink) p.s.scale.set(Math.max(0.01, p.s.scale.x * (1 - p.shrink)));
        if (k >= 1) { p.s.destroy(); this.particles.splice(this.particles.indexOf(p), 1); }
      }
      if (now < this.shakeUntil) {
        const a = this.shakePower * ((this.shakeUntil - now) / 260);
        this.app.stage.position.set((Math.random() - 0.5) * a, (Math.random() - 0.5) * a);
      } else this.app.stage.position.set(0, 0);
      if (this.highlights.bribes.length) this.drawPulse(now);
      this.render();
      if (this.tweens.length || this.particles.length || now < this.shakeUntil || this.highlights.bribes.length) {
        this.raf = requestAnimationFrame(tick);
      }
    };
    this.raf = requestAnimationFrame(tick);
  }

  private tween(dur: number, step: (k: number) => void, ease = easeInOut): Promise<void> {
    const d = settings.reduceMotion ? Math.min(dur, 120) : dur;
    return new Promise((resolve) => {
      this.tweens.push({ start: performance.now(), dur: d, step, resolve, ease });
      this.loop();
    });
  }

  private wait(ms: number) { return this.tween(ms, () => {}, linear); }

  private burst(kind: keyof Board['particleTex'], x: number, y: number, n: number, opts: { color: number; speed: [number, number]; size: [number, number]; life: [number, number]; gravity?: number; up?: number; spread?: number; angle?: number; spin?: number; fade?: boolean; shrink?: number; blend?: 'add' | 'normal' }) {
    if (settings.reduceMotion) n = Math.ceil(n / 3);
    for (let i = 0; i < n; i++) {
      const s = new Sprite(this.particleTex[kind]);
      s.anchor.set(0.5);
      s.tint = opts.color;
      const size = opts.size[0] + Math.random() * (opts.size[1] - opts.size[0]);
      s.scale.set(size / 32);
      s.position.set(x, y);
      if (opts.blend === 'add') s.blendMode = 'add';
      const ang = (opts.angle ?? -Math.PI / 2) + (Math.random() - 0.5) * (opts.spread ?? Math.PI * 2);
      const sp = opts.speed[0] + Math.random() * (opts.speed[1] - opts.speed[0]);
      this.fxLayer.addChild(s);
      this.particles.push({
        s, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - (opts.up ?? 0), g: opts.gravity ?? 0,
        life: 0, max: opts.life[0] + Math.random() * (opts.life[1] - opts.life[0]), spin: (Math.random() - 0.5) * (opts.spin ?? 0),
        fade: opts.fade ?? true, shrink: opts.shrink ?? 0,
      });
    }
    this.loop();
  }

  private floatText(text: string, x: number, y: number, color: string) {
    const t = new Text({
      text,
      style: { fontFamily: '"Nanum Myeongjo", serif', fontWeight: '800', fontSize: 30, fill: color, stroke: { color: '#0b0b0e', width: 6 } },
    });
    t.anchor.set(0.5);
    t.position.set(x, y);
    this.textLayer.addChild(t);
    void this.tween(1100, (k) => { t.y = y - 40 * k; t.alpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3; }, easeOut).then(() => t.destroy());
  }

  shake(power = 14) {
    if (!settings.shake || settings.reduceMotion) return;
    this.shakePower = power;
    this.shakeUntil = performance.now() + 260;
    this.loop();
  }

  private spriteAt(id: string) { return this.sprites.get(id); }

  /* ── 연출 ─────────────────────────────────── */
  async animMove(id: string, to: Cell, shadow: boolean) {
    const s = this.spriteAt(id);
    if (!s) return;
    const from = { x: s.root.x, y: s.root.y };
    const end = this.center(to.r, to.c);
    if (shadow) {
      this.burst('soft', from.x, from.y, 18, { color: 0x2a1b2e, speed: [0.5, 2.2], size: [26, 54], life: [450, 800] });
      await this.tween(220, (k) => { s.root.alpha = 1 - k; s.root.scale.set(1 - 0.3 * k); });
      s.root.position.set(end.x, end.y);
      this.burst('soft', end.x, end.y, 18, { color: 0x2a1b2e, speed: [0.5, 2.2], size: [26, 54], life: [450, 800] });
      await this.tween(260, (k) => { s.root.alpha = k; s.root.scale.set(0.7 + 0.3 * k); });
      return;
    }
    this.pieceLayer.addChild(s.root);
    await this.tween(300, (k) => {
      s.root.position.set(from.x + (end.x - from.x) * k, from.y + (end.y - from.y) * k);
      const lift = Math.sin(Math.PI * k);
      s.root.scale.set(1 + 0.08 * lift);
    });
    this.burst('soft', end.x, end.y + GEO.cell * 0.3, 6, { color: 0x6b5a40, speed: [0.4, 1.4], size: [10, 22], life: [300, 520], spread: Math.PI, angle: 0 });
  }

  async animAttack(attacker: string | null, target: string) {
    const t = this.spriteAt(target);
    if (!t) return;
    const end = { x: t.root.x, y: t.root.y };
    const a = attacker ? this.spriteAt(attacker) : null;
    const slash = new Graphics();
    this.fxLayer.addChild(slash);
    if (a) {
      const start = { x: a.root.x, y: a.root.y };
      await this.tween(170, (k) => {
        slash.clear();
        const hx = start.x + (end.x - start.x) * k, hy = start.y + (end.y - start.y) * k;
        const tx = start.x + (end.x - start.x) * Math.max(0, k - 0.35), ty = start.y + (end.y - start.y) * Math.max(0, k - 0.35);
        slash.moveTo(tx, ty).lineTo(hx, hy).stroke({ width: 7, color: hex(PAL.ivory), alpha: 0.9, cap: 'round' });
        slash.moveTo(tx, ty).lineTo(hx, hy).stroke({ width: 14, color: hex(PAL.iron), alpha: 0.35, cap: 'round' });
      }, easeOut);
    }
    const ang = Math.random() * Math.PI;
    const L = GEO.cell * 0.62;
    await this.tween(150, (k) => {
      slash.clear();
      const dx = Math.cos(ang) * L, dy = Math.sin(ang) * L;
      slash.moveTo(end.x - dx, end.y - dy).lineTo(end.x - dx + dx * 2 * k, end.y - dy + dy * 2 * k)
        .stroke({ width: 6, color: hex(PAL.ivory), alpha: 1, cap: 'round' });
    }, easeOut);
    this.burst('spark', end.x, end.y, 14, { color: hex(PAL.goldHi), speed: [3, 8], size: [8, 16], life: [200, 380], blend: 'add' });
    this.shake(12);
    void this.tween(220, (k) => { slash.alpha = 1 - k; }).then(() => slash.destroy());
  }

  async animDeath(id: string, owner: Faction) {
    const s = this.spriteAt(id);
    if (!s) return;
    s.dying = true;
    const { x, y } = s.root;
    this.burst('drop', x, y, 22, { color: hex(PAL.blood), speed: [2, 7], size: [6, 14], life: [500, 900], gravity: 0.32, up: 2, spin: 0.1 });
    this.burst('shard', x, y, 14, { color: hex(HOUSE[owner].inner), speed: [2, 6], size: [10, 22], life: [600, 1000], gravity: 0.25, up: 3, spin: 0.3 });
    this.burst('shard', x, y, 8, { color: hex(PAL.gold), speed: [2, 6], size: [6, 14], life: [500, 900], gravity: 0.25, up: 3, spin: 0.3 });
    this.burst('soft', x, y, 10, { color: 0x1a1a1a, speed: [0.3, 1.2], size: [30, 60], life: [700, 1100] });
    await this.tween(420, (k) => {
      s.root.alpha = 1 - k;
      s.root.scale.set(1 + 0.15 * k);
      s.root.rotation = 0.25 * k;
    }, easeOut);
    s.root.destroy({ children: true });
    this.sprites.delete(id);
  }

  async animBribe(actor: string, target: string, result: 'ok' | 'vip' | 'oath', newOwner: Faction, newType: PieceType, militia: boolean) {
    const t = this.spriteAt(target);
    if (!t) return;
    const { x, y } = t.root;
    void actor;
    this.burst('coin', x, y - GEO.cell * 0.2, 16, { color: 0xffffff, speed: [3, 6.5], size: [14, 22], life: [600, 950], gravity: 0.3, up: 4, spin: 0.25, spread: Math.PI * 0.9 });
    if (result !== 'ok') {
      await this.wait(260);
      this.floatText(result === 'vip' ? '거절 — 충성이 너무 깊다' : '충성 서약', x, y - GEO.cell * 0.55, result === 'vip' ? PAL.goldHi : PAL.ivory);
      await this.tween(320, (k) => { t.root.x = x + Math.sin(k * Math.PI * 6) * 6 * (1 - k); });
      return;
    }
    // 실이 내려오고, 메달리온이 뒤집힌다
    const lines = new Graphics();
    this.fxLayer.addChild(lines);
    await this.tween(300, (k) => {
      lines.clear();
      for (const dx of [-0.18, 0, 0.18]) {
        lines.moveTo(x + GEO.cell * dx, y - GEO.cell * 1.6).lineTo(x + GEO.cell * dx * 0.6, y - GEO.cell * 1.6 + GEO.cell * 1.3 * k)
          .stroke({ width: 1.6, color: hex(HOUSE[newOwner].glint), alpha: 0.9 });
      }
    });
    await this.tween(170, (k) => { t.medal.scale.x = Math.abs(t.medal.scale.y) * (1 - k); });
    t.medal.texture = this.medalTexture(newType, newOwner, militia);
    t.key = `${newType}:${newOwner}:${militia ? 1 : 0}`;
    await this.tween(170, (k) => { t.medal.scale.x = Math.abs(t.medal.scale.y) * k; });
    void this.tween(260, (k) => { lines.alpha = 1 - k; }).then(() => lines.destroy());
    this.burst('spark', x, y, 10, { color: hex(HOUSE[newOwner].glint), speed: [1, 4], size: [8, 14], life: [300, 600], blend: 'add' });
  }

  async animBlocked(id: string) {
    const s = this.spriteAt(id);
    if (!s) return;
    const { x, y } = s.root;
    const ring = new Graphics();
    this.fxLayer.addChild(ring);
    await this.tween(520, (k) => {
      ring.clear();
      ring.circle(x, y, GEO.cell * (0.4 + 0.5 * k)).stroke({ width: 6 * (1 - k) + 1, color: hex(PAL.goldHi), alpha: 1 - k });
    }, easeOut);
    ring.destroy();
    this.floatText('축복이 막았다', x, y - GEO.cell * 0.55, PAL.goldHi);
  }

  async animDouble(original: string) {
    const s = this.spriteAt(original);
    if (!s) return;
    this.floatText('대역', s.root.x, s.root.y - GEO.cell * 0.55, PAL.ivory);
    await this.wait(250);
  }

  async animRoyal(lord: string, rooted: string[]) {
    const s = this.spriteAt(lord);
    if (!s) return;
    const { x, y } = s.root;
    const ring = new Graphics();
    this.fxLayer.addChild(ring);
    this.burst('spark', x, y, 20, { color: hex(PAL.goldHi), speed: [2, 5], size: [8, 16], life: [400, 700], blend: 'add' });
    await this.tween(600, (k) => {
      ring.clear();
      ring.circle(x, y, GEO.cell * 1.6 * k).stroke({ width: 10 * (1 - k) + 2, color: hex(PAL.gold), alpha: 1 - k * 0.9 });
      ring.rect(x - GEO.cell * 1.5, y - GEO.cell * 1.5, GEO.cell * 3, GEO.cell * 3).stroke({ width: 2, color: hex(PAL.goldHi), alpha: 0.6 * (1 - k) });
    }, easeOut);
    ring.destroy();
    for (const id of rooted) {
      const r = this.spriteAt(id);
      if (r) this.floatText('구속', r.root.x, r.root.y - GEO.cell * 0.5, PAL.ivory);
    }
  }

  async animBless(target: string) {
    const s = this.spriteAt(target);
    if (!s) return;
    const { x, y } = s.root;
    const g = new Graphics();
    this.fxLayer.addChild(g);
    await this.tween(650, (k) => {
      g.clear();
      const a = Math.sin(Math.PI * k);
      g.rect(x - GEO.cell * 0.32, y - GEO.cell * 2.2, GEO.cell * 0.64, GEO.cell * 2.2).fill({ color: hex(PAL.goldHi), alpha: 0.18 * a });
      g.circle(x, y, GEO.cell * 0.5).fill({ color: hex(PAL.goldHi), alpha: 0.12 * a });
    });
    g.destroy();
    this.burst('spark', x, y - GEO.cell * 0.3, 10, { color: hex(PAL.goldHi), speed: [0.3, 1.2], size: [6, 12], life: [500, 900], gravity: -0.03, blend: 'add' });
  }

  async animPoison(target: string) {
    const s = this.spriteAt(target);
    if (!s) return;
    this.burst('soft', s.root.x, s.root.y, 22, { color: 0x6f8f3a, speed: [0.3, 1.4], size: [20, 46], life: [700, 1200], gravity: -0.02 });
    await this.wait(380);
  }

  /** 배치 공개: 상대 기물이 그림자에서 나타난다 */
  async animReveal(ids: string[]) {
    const list = ids.map((id) => this.spriteAt(id)).filter(Boolean) as PieceSprite[];
    for (const s of list) { s.root.alpha = 0; s.root.scale.set(0.7); }
    for (const s of list) this.burst('soft', s.root.x, s.root.y, 4, { color: 0x2a1b2e, speed: [0.2, 1], size: [30, 50], life: [500, 800] });
    await this.tween(650, (k) => { for (const s of list) { s.root.alpha = k; s.root.scale.set(0.7 + 0.3 * k); } }, easeOut);
  }

  async animFlash(id: string, text: string, color = PAL.ivory) {
    const s = this.spriteAt(id);
    if (!s) return;
    this.burst('spark', s.root.x, s.root.y, 8, { color: hex(color), speed: [1, 3], size: [8, 14], life: [300, 500], blend: 'add' });
    this.floatText(text, s.root.x, s.root.y - GEO.cell * 0.55, color);
    await this.wait(240);
  }
}
