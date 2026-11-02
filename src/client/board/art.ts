/**
 * 보드와 기물의 그림을 Canvas 2D로 그립니다. 한 번 그려서 텍스처로 씁니다.
 * 확정 아트 디렉션: "금빛 궁정 위에 피와 그림자가 얹힌 중세 정치 암살극", 채도 낮게, 강조색만 튀게.
 */
import { COLS, N, zoneOf } from '../../shared/data';
import type { Faction, PieceType, ZoneId } from '../../shared/types';
import { PIECE_ICONS, UI_ICONS, paintIcon, type UiIcon } from '../icons';

export const PAL = {
  ink: '#0F0F12', violet: '#2A1B2E', navy: '#1A2333',
  gold: '#C2A14A', goldHi: '#EAD28C', goldLo: '#6E5524', ivory: '#E8E2D0', wood: '#5A4632',
  blood: '#7A1212', iron: '#A83232', moss: '#4E5A3C', earth: '#6B4F2A',
};

/** 진영의 속색 */
export const HOUSE: Record<Faction, { inner: string; edge: string; glint: string; accent: string }> = {
  blue: { inner: '#33476a', edge: '#0f1626', glint: '#9fb4d6', accent: '#7f9cc6' },
  red: { inner: '#6e1d2e', edge: '#24080f', glint: '#d99aa6', accent: '#c4576a' },
};

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = Math.ceil(w);
  c.height = Math.ceil(h);
  return [c, c.getContext('2d')!];
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return `rgb(${Math.round(r1 + (r2 - r1) * t)},${Math.round(g1 + (g2 - g1) * t)},${Math.round(b1 + (b2 - b1) * t)})`;
}
function shade(hex: string, k: number): string {
  const [r, g, b] = hexToRgb(hex);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

/** 얼룩 질감 (작은 반투명 점을 많이 찍는다) */
function mottle(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, rand: () => number, colors: string[], count: number, size: [number, number], alpha: [number, number]) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  for (let i = 0; i < count; i++) {
    ctx.globalAlpha = alpha[0] + rand() * (alpha[1] - alpha[0]);
    ctx.fillStyle = colors[Math.floor(rand() * colors.length)];
    const r = size[0] + rand() * (size[1] - size[0]);
    ctx.beginPath();
    ctx.ellipse(x + rand() * w, y + rand() * h, r, r * (0.5 + rand() * 0.7), rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function grain(ctx: CanvasRenderingContext2D, w: number, h: number, amount: number, seed: number) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const rand = rng(seed);
  for (let i = 0; i < d.length; i += 4) {
    const n = (rand() - 0.5) * amount;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

export interface BoardGeometry { cell: number; frame: number; size: number }
export const GEO: BoardGeometry = { cell: 96, frame: 70, size: 96 * N + 70 * 2 };

const ZONE_TILE: Record<ZoneId, { a: string; b: string; flecks: string[]; light: number }> = {
  outer: { a: '#4b5236', b: '#5d4a2c', flecks: ['#2d311f', '#6e5a37', '#3a3022', '#58603f'], light: 0.78 },
  mid: { a: '#4d4b4d', b: '#59544c', flecks: ['#2f2e31', '#6a655b', '#7b6a3f', '#3b3a3d'], light: 0.92 },
  court: { a: '#8c7c58', b: '#a6946c', flecks: ['#bfae82', '#6f5f3e', '#cdbd94', '#7d6a46'], light: 0.98 },
};

/** 보드 전체 그림. displayRow는 화면에서 그 줄이 몇 번째에 놓이는지 (내 진영이 아래). */
export function paintBoard(displayRow: (r: number) => number, coords: boolean): HTMLCanvasElement {
  const { cell, frame, size } = GEO;
  const [cv, ctx] = canvas(size, size);
  const rand = rng(20260628);

  // ── 나무 틀
  const wood = ctx.createLinearGradient(0, 0, size, size);
  wood.addColorStop(0, '#3a2c1f');
  wood.addColorStop(0.5, '#4a3826');
  wood.addColorStop(1, '#2a1f16');
  ctx.fillStyle = wood;
  ctx.fillRect(0, 0, size, size);
  ctx.save();
  for (let i = 0; i < 220; i++) {
    const y = rand() * size;
    ctx.strokeStyle = rand() < 0.5 ? 'rgba(20,12,6,0.35)' : 'rgba(120,90,55,0.18)';
    ctx.lineWidth = 0.6 + rand() * 1.6;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= size; x += 40) ctx.lineTo(x, y + Math.sin(x / (90 + rand() * 60) + i) * (2 + rand() * 4));
    ctx.stroke();
  }
  ctx.restore();
  // 틀 안쪽 그림자와 금 상감
  const inset = (pad: number, color: string, width: number) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.strokeRect(pad, pad, size - pad * 2, size - pad * 2);
  };
  inset(10, 'rgba(0,0,0,0.55)', 6);
  inset(16, PAL.goldLo, 3);
  inset(17, PAL.gold, 1.4);
  inset(frame - 14, PAL.goldLo, 2.5);
  inset(frame - 14, 'rgba(234,210,140,0.75)', 1);
  inset(frame - 3, 'rgba(0,0,0,0.85)', 6);
  // 모서리 장식 (금 마름모와 백합 끝)
  for (const [x, y] of [[frame / 2, frame / 2], [size - frame / 2, frame / 2], [frame / 2, size - frame / 2], [size - frame / 2, size - frame / 2]]) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.PI / 4);
    const g = ctx.createLinearGradient(-14, -14, 14, 14);
    g.addColorStop(0, PAL.goldHi);
    g.addColorStop(1, PAL.goldLo);
    ctx.fillStyle = g;
    ctx.fillRect(-11, -11, 22, 22);
    ctx.fillStyle = '#2a1f16';
    ctx.fillRect(-5, -5, 10, 10);
    ctx.fillStyle = PAL.gold;
    ctx.fillRect(-2, -2, 4, 4);
    ctx.restore();
  }

  // ── 칸
  for (let r = 0; r < N; r++) {
    const zone = zoneOf(r);
    const zt = ZONE_TILE[zone];
    const dr = displayRow(r);
    for (let c = 0; c < N; c++) {
      const x = frame + c * cell;
      const y = frame + dr * cell;
      const checker = (r + c) % 2 === 0 ? 1 : 0.9;
      const base = mix(zt.a, zt.b, rand());
      ctx.fillStyle = shade(base.startsWith('rgb') ? rgbToHex(base) : base, zt.light * checker);
      ctx.fillRect(x, y, cell, cell);
      mottle(ctx, x, y, cell, cell, rand, zt.flecks, 70, [2, 9], [0.06, 0.2]);
      if (zone === 'court') {
        // 대리석 결
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, cell, cell);
        ctx.clip();
        for (let k = 0; k < 2; k++) {
          ctx.strokeStyle = `rgba(70,55,30,${0.18 + rand() * 0.15})`;
          ctx.lineWidth = 0.7 + rand();
          ctx.beginPath();
          let px = x + rand() * cell, py = y;
          ctx.moveTo(px, py);
          for (let s = 0; s < 6; s++) { px += (rand() - 0.5) * 30; py += cell / 6; ctx.lineTo(px, py); }
          ctx.stroke();
        }
        ctx.restore();
      } else if (zone === 'mid') {
        mottle(ctx, x, y, cell, cell, rand, [PAL.gold], 6, [0.8, 1.8], [0.25, 0.45]);
      } else {
        // 지푸라기
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, cell, cell);
        ctx.clip();
        for (let k = 0; k < 9; k++) {
          ctx.strokeStyle = `rgba(150,130,80,${0.08 + rand() * 0.12})`;
          ctx.lineWidth = 1;
          const sx = x + rand() * cell, sy = y + rand() * cell, a = rand() * Math.PI;
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(sx + Math.cos(a) * 12, sy + Math.sin(a) * 12);
          ctx.stroke();
        }
        ctx.restore();
      }
      // 돌 모서리 (빛은 위 왼쪽에서)
      ctx.fillStyle = 'rgba(255,240,210,0.07)';
      ctx.fillRect(x, y, cell, 3);
      ctx.fillRect(x, y, 3, cell);
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(x, y + cell - 3, cell, 3);
      ctx.fillRect(x + cell - 3, y, 3, cell);
    }
  }
  // 줄눈
  ctx.strokeStyle = 'rgba(8,7,6,0.85)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= N; i++) {
    ctx.beginPath(); ctx.moveTo(frame + i * cell, frame); ctx.lineTo(frame + i * cell, frame + N * cell); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(frame, frame + i * cell); ctx.lineTo(frame + N * cell, frame + i * cell); ctx.stroke();
  }
  // 구역 경계: 가는 금선
  for (const boundary of [2, 4, 6, 8]) {
    const dy = frame + Math.min(displayRow(boundary - 1), displayRow(boundary)) * cell + cell;
    ctx.strokeStyle = 'rgba(194,161,74,0.42)';
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(frame, dy); ctx.lineTo(frame + N * cell, dy); ctx.stroke();
  }

  // ── 조명: 궁정은 밝지만 불편하게, 외곽은 낮고 흐리게
  const cx = size / 2, cy = size / 2;
  const light = ctx.createRadialGradient(cx, cy, cell * 0.5, cx, cy, size * 0.62);
  light.addColorStop(0, 'rgba(255,226,160,0.10)');
  light.addColorStop(0.45, 'rgba(0,0,0,0.0)');
  light.addColorStop(1, 'rgba(0,0,0,0.46)');
  ctx.fillStyle = light;
  ctx.fillRect(frame, frame, N * cell, N * cell);
  const band = ctx.createLinearGradient(0, frame, 0, frame + N * cell);
  band.addColorStop(0, 'rgba(0,0,0,0.22)');
  band.addColorStop(0.2, 'rgba(0,0,0,0)');
  band.addColorStop(0.8, 'rgba(0,0,0,0)');
  band.addColorStop(1, 'rgba(0,0,0,0.22)');
  ctx.fillStyle = band;
  ctx.fillRect(frame, frame, N * cell, N * cell);
  // 판 안쪽 그림자
  const inner = (w: number, a: number) => {
    ctx.strokeStyle = `rgba(0,0,0,${a})`;
    ctx.lineWidth = w;
    ctx.strokeRect(frame + w / 2, frame + w / 2, N * cell - w, N * cell - w);
  };
  inner(14, 0.18);
  inner(6, 0.25);

  // ── 좌표
  if (coords) {
    ctx.fillStyle = 'rgba(232,226,208,0.62)';
    ctx.font = `600 ${Math.round(cell * 0.22)}px Cinzel, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let c = 0; c < N; c++) {
      const x = frame + c * cell + cell / 2;
      ctx.fillText(COLS[c], x, frame / 2 + 3);
      ctx.fillText(COLS[c], x, size - frame / 2 + 1);
    }
    for (let r = 0; r < N; r++) {
      const y = frame + displayRow(r) * cell + cell / 2 + 2;
      ctx.fillText(String(r + 1), frame / 2 + 2, y);
      ctx.fillText(String(r + 1), size - frame / 2 - 2, y);
    }
  }
  grain(ctx, size, size, 14, 99);
  return cv;
}

function rgbToHex(rgb: string): string {
  const m = rgb.match(/\d+/g)!.map(Number);
  return '#' + m.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join('');
}

/** 기물 메달리온 (금테 + 진영 속색 + 아이보리 실루엣) */
export function paintMedallion(type: PieceType, faction: Faction, size: number, opts: { militia?: boolean; portrait?: HTMLImageElement | null } = {}): HTMLCanvasElement {
  const pad = size * 0.12;
  const [cv, ctx] = canvas(size + pad * 2, size + pad * 2);
  const cx = cv.width / 2, cy = cv.height / 2;
  const R = size / 2;
  const serf = type === 'serf';
  const house = HOUSE[faction];

  // 그림자
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.75)';
  ctx.shadowBlur = size * 0.09;
  ctx.shadowOffsetY = size * 0.05;
  ctx.fillStyle = '#000';
  ctx.beginPath(); ctx.arc(cx, cy, R * 0.98, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  // 테두리 (궁정은 낡은 금, 농노는 흙빛 청동)
  const rim = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
  if (serf) {
    rim.addColorStop(0, '#b08c5a'); rim.addColorStop(0.45, '#7a5c36'); rim.addColorStop(1, '#3a2a17');
  } else {
    rim.addColorStop(0, '#f3dc96'); rim.addColorStop(0.35, PAL.gold); rim.addColorStop(0.7, '#8d6f30'); rim.addColorStop(1, '#4a3816');
  }
  ctx.fillStyle = rim;
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
  // 동전 가장자리 눈금
  ctx.save();
  ctx.strokeStyle = 'rgba(40,28,10,0.45)';
  ctx.lineWidth = Math.max(1, size * 0.008);
  const ticks = serf ? 36 : 48;
  for (let i = 0; i < ticks; i++) {
    const a = (i / ticks) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * R * 0.9, cy + Math.sin(a) * R * 0.9);
    ctx.lineTo(cx + Math.cos(a) * R * 0.985, cy + Math.sin(a) * R * 0.985);
    ctx.stroke();
  }
  ctx.restore();

  // 안쪽 원판
  const ri = R * (serf ? 0.8 : 0.82);
  ctx.fillStyle = 'rgba(20,14,6,0.9)';
  ctx.beginPath(); ctx.arc(cx, cy, ri + size * 0.012, 0, Math.PI * 2); ctx.fill();
  const disc = ctx.createRadialGradient(cx - ri * 0.3, cy - ri * 0.35, ri * 0.1, cx, cy, ri);
  disc.addColorStop(0, house.inner);
  disc.addColorStop(1, house.edge);
  ctx.fillStyle = disc;
  ctx.beginPath(); ctx.arc(cx, cy, ri, 0, Math.PI * 2); ctx.fill();
  // 원판 결
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, ri, 0, Math.PI * 2); ctx.clip();
  const rand = rng(type.length * 31 + (faction === 'blue' ? 7 : 13));
  mottle(ctx, cx - ri, cy - ri, ri * 2, ri * 2, rand, ['#000000', house.glint], 40, [size * 0.01, size * 0.05], [0.03, 0.08]);
  ctx.restore();
  // 안쪽 금선
  ctx.strokeStyle = serf ? 'rgba(176,140,90,0.55)' : 'rgba(234,210,140,0.65)';
  ctx.lineWidth = Math.max(1, size * 0.012);
  ctx.beginPath(); ctx.arc(cx, cy, ri * 0.92, 0, Math.PI * 2); ctx.stroke();

  // 실루엣 (또는 넣어 준 초상화)
  const iconSize = ri * (serf ? 1.42 : 1.36);
  if (opts.portrait) {
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, ri * 0.9, 0, Math.PI * 2); ctx.clip();
    ctx.drawImage(opts.portrait, cx - ri * 0.9, cy - ri * 0.9, ri * 1.8, ri * 1.8);
    ctx.restore();
  } else {
    const icon = PIECE_ICONS[type];
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    paintIcon(ctx, icon.d, cx + size * 0.012, cy + size * 0.02, iconSize, icon.rotate);
    ctx.fillStyle = 'rgba(255,248,225,0.35)';
    paintIcon(ctx, icon.d, cx - size * 0.006, cy - size * 0.008, iconSize, icon.rotate);
    const ivory = ctx.createLinearGradient(cx, cy - iconSize / 2, cx, cy + iconSize / 2);
    ivory.addColorStop(0, '#f6f0e1');
    ivory.addColorStop(1, '#c4b998');
    ctx.fillStyle = ivory;
    paintIcon(ctx, icon.d, cx, cy, iconSize, icon.rotate);
  }
  if (opts.militia) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    paintIcon(ctx, UI_ICONS.spear, cx + ri * 0.42, cy + ri * 0.4, ri * 0.85);
    ctx.fillStyle = '#d8cfb6';
    paintIcon(ctx, UI_ICONS.spear, cx + ri * 0.4, cy + ri * 0.38, ri * 0.82);
  }

  // 위쪽 반사광
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();
  const spec = ctx.createLinearGradient(cx, cy - R, cx, cy);
  spec.addColorStop(0, 'rgba(255,250,235,0.20)');
  spec.addColorStop(1, 'rgba(255,250,235,0)');
  ctx.fillStyle = spec;
  ctx.beginPath(); ctx.ellipse(cx, cy - R * 0.45, R * 0.82, R * 0.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  return cv;
}

/** 상태 표시용 작은 원형 배지 */
export function paintBadge(icon: UiIcon, fg: string, bg: string, size: number): HTMLCanvasElement {
  const [cv, ctx] = canvas(size, size);
  const c = size / 2;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.beginPath(); ctx.arc(c, c + size * 0.04, c * 0.94, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = bg;
  ctx.beginPath(); ctx.arc(c, c, c * 0.9, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = PAL.gold;
  ctx.lineWidth = Math.max(1, size * 0.06);
  ctx.beginPath(); ctx.arc(c, c, c * 0.84, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = fg;
  paintIcon(ctx, UI_ICONS[icon], c, c, size * 0.56);
  return cv;
}

/** 입자 텍스처 */
export function paintParticle(kind: 'soft' | 'shard' | 'coin' | 'drop' | 'spark'): HTMLCanvasElement {
  const S = 32;
  const [cv, ctx] = canvas(S, S);
  const c = S / 2;
  switch (kind) {
    case 'soft': {
      const g = ctx.createRadialGradient(c, c, 0, c, c, c);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, S, S);
      break;
    }
    case 'spark': {
      const g = ctx.createRadialGradient(c, c, 0, c, c, c);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.25, 'rgba(255,255,255,0.8)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, S, S);
      break;
    }
    case 'shard':
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.moveTo(c, 2); ctx.lineTo(S - 6, S - 4); ctx.lineTo(8, S - 10); ctx.closePath(); ctx.fill();
      break;
    case 'drop':
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.ellipse(c, c, 7, 11, 0, 0, Math.PI * 2); ctx.fill();
      break;
    case 'coin': {
      const g = ctx.createLinearGradient(0, 0, S, S);
      g.addColorStop(0, '#f6e3a1'); g.addColorStop(0.5, PAL.gold); g.addColorStop(1, '#5a4419');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(c, c, 13, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(60,40,10,0.7)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(c, c, 9, 0, Math.PI * 2); ctx.stroke();
      break;
    }
  }
  return cv;
}

/** 화면 전체에 까는 필름 결 (정지 이미지) */
export function grainDataUrl(): string {
  const [cv, ctx] = canvas(256, 256);
  const img = ctx.createImageData(256, 256);
  const rand = rng(4242);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.floor(rand() * 255);
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 22;
  }
  ctx.putImageData(img, 0, 0);
  return cv.toDataURL('image/png');
}
