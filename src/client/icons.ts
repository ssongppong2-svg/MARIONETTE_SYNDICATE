/**
 * 손으로 그린 실루엣 아이콘 (48 × 48). 이모티콘은 쓰지 않습니다.
 * 같은 경로를 SVG(패널)와 Canvas Path2D(보드)에서 함께 씁니다.
 */
import type { PieceType } from '../shared/types';

export interface IconDef { d: string[]; rotate?: number }

export const PIECE_ICONS: Record<PieceType, IconDef> = {
  lord: {
    d: [
      'M8 33 L8 15 L16.5 23 L24 9 L31.5 23 L40 15 L40 33 Z',
      'M8 13 A2.6 2.6 0 1 1 8.01 13 Z M24 6.6 A2.8 2.8 0 1 1 24.01 6.6 Z M40 13 A2.6 2.6 0 1 1 40.01 13 Z',
      'M7 35.5 H41 V41.5 H7 Z M14 38.5 A1.6 1.6 0 1 0 14.01 38.5 Z M24 38.5 A1.6 1.6 0 1 0 24.01 38.5 Z M34 38.5 A1.6 1.6 0 1 0 34.01 38.5 Z',
    ],
  },
  paladin: {
    d: ['M24 4.5 L39.5 9.8 L39.5 22 C39.5 32.4 32.6 39.4 24 43.5 C15.4 39.4 8.5 32.4 8.5 22 L8.5 9.8 Z M21.8 12.5 H26.2 V19.6 H32.4 V24 H26.2 V35 H21.8 V24 H15.6 V19.6 H21.8 Z'],
  },
  assassin: {
    rotate: 45,
    d: [
      'M24 2.5 L27.6 27 L20.4 27 Z M23.3 8 L24.7 8 L25.4 24 L22.6 24 Z',
      'M12.5 27 Q24 31.5 35.5 27 L35.5 30.6 Q24 35 12.5 30.6 Z',
      'M22 31.5 H26 V40 H22 Z',
      'M24 40 A3.3 3.3 0 1 1 23.99 40 Z',
    ],
  },
  spy: {
    d: [
      'M3.5 24 C11.5 12 36.5 12 44.5 24 C36.5 36 11.5 36 3.5 24 Z M24 16.2 A7.8 7.8 0 1 0 24.01 16.2 Z',
      'M24 19.6 A4.4 4.4 0 1 1 23.99 19.6 Z',
    ],
  },
  archer: {
    d: [
      'M13 4.5 C31 11.5 31 36.5 13 43.5 L16.6 43.5 C34.6 36.5 34.6 11.5 16.6 4.5 Z',
      'M14 5.6 L15.4 5.6 L15.4 42.4 L14 42.4 Z',
      'M8 22.9 H35 V25.1 H8 Z M34.5 18.6 L44.5 24 L34.5 29.4 Z',
      'M8 22.9 L3.6 18 L7.4 18 L12 22.9 Z M8 25.1 L3.6 30 L7.4 30 L12 25.1 Z',
    ],
  },
  priest: {
    d: [
      'M21 4.5 H27 V14 H37 V20.5 H27 V43.5 H21 V20.5 H11 V14 H21 Z',
      'M24 7.6 A9.6 9.6 0 1 1 23.99 7.6 Z M24 10.2 A7 7 0 1 0 24.01 10.2 Z',
    ],
  },
  serf: {
    d: [
      'M24 6.4 A6.4 6.4 0 1 1 23.99 6.4 Z',
      'M14.5 37 C14.5 26 18.6 20.6 24 20.6 C29.4 20.6 33.5 26 33.5 37 Z',
      'M10.5 37 H37.5 V42.5 H10.5 Z',
    ],
  },
};

/** 화면 장식용 아이콘 */
export const UI_ICONS = {
  crown: 'M6 34 L6 14 L15 22 L24 8 L33 22 L42 14 L42 34 Z M5 37 H43 V42 H5 Z',
  target: 'M24 4 A20 20 0 1 1 23.99 4 Z M24 8.5 A15.5 15.5 0 1 0 24.01 8.5 Z M24 14 A10 10 0 1 1 23.99 14 Z M24 18 A6 6 0 1 0 24.01 18 Z M22.6 0 H25.4 V13 H22.6 Z M22.6 35 H25.4 V48 H22.6 Z M0 22.6 H13 V25.4 H0 Z M35 22.6 H48 V25.4 H35 Z',
  coin: 'M24 5 A19 19 0 1 1 23.99 5 Z M24 9 A15 15 0 1 0 24.01 9 Z M21 15 H27 L29 19 L25.5 24 L29 29 L27 33 H21 L19 29 L22.5 24 L19 19 Z',
  hourglass: 'M11 4 H37 V8 H34 C34 16 27 20 27 24 C27 28 34 32 34 40 H37 V44 H11 V40 H14 C14 32 21 28 21 24 C21 20 14 16 14 8 H11 Z M18 40 H30 C30 35 26 32 24 30 C22 32 18 35 18 40 Z',
  scroll: 'M10 6 H34 C38 6 40 9 40 12 V38 C40 42 37 44 34 44 H14 C10 44 8 41 8 38 V34 H12 V38 C12 39.5 13 40.5 14 40.5 C15.5 40.5 16 39.5 16 38 V12 C16 10 15 9.5 14 9.5 H10 Z M20 15 H34 V18 H20 Z M20 22 H34 V25 H20 Z M20 29 H30 V32 H20 Z',
  eye: 'M3 24 C11 12 37 12 45 24 C37 36 11 36 3 24 Z M24 16 A8 8 0 1 0 24.01 16 Z M24 20 A4 4 0 1 1 23.99 20 Z',
  chain: 'M6 20 A8 8 0 0 1 14 12 H22 A8 8 0 0 1 22 28 H19 V24 H22 A4 4 0 0 0 22 16 H14 A4 4 0 0 0 14 24 H15 V28 H14 A8 8 0 0 1 6 20 Z M42 28 A8 8 0 0 1 34 36 H26 A8 8 0 0 1 26 20 H29 V24 H26 A4 4 0 0 0 26 32 H34 A4 4 0 0 0 34 24 H33 V20 H34 A8 8 0 0 1 42 28 Z',
  sword: 'M22.5 3 H25.5 L26.5 30 H21.5 Z M14 30 H34 V33.5 H14 Z M22 33.5 H26 V41 H22 Z M24 41 A3 3 0 1 1 23.99 41 Z',
  halo: 'M24 10 C35 10 44 13.5 44 18 C44 22.5 35 26 24 26 C13 26 4 22.5 4 18 C4 13.5 13 10 24 10 Z M24 14 C15.5 14 9 16 9 18 C9 20 15.5 22 24 22 C32.5 22 39 20 39 18 C39 16 32.5 14 24 14 Z M24 28 L27 34 L33 35 L28.5 39 L29.8 45 L24 42 L18.2 45 L19.5 39 L15 35 L21 34 Z',
  drop: 'M24 4 C24 4 38 20 38 30 A14 14 0 0 1 10 30 C10 20 24 4 24 4 Z M18 30 A6 6 0 0 0 24 36 V33 A3 3 0 0 1 21 30 Z',
  seal: 'M24 4 L28 8 L34 7 L35 13 L40 17 L37 22 L40 28 L35 31 L34 37 L28 36 L24 40 L20 36 L14 37 L13 31 L8 28 L11 22 L8 17 L13 13 L14 7 L20 8 Z M24 13 A9 9 0 1 0 24.01 13 Z M18 41 L16 47 L20 45 L22 41 Z M30 41 L32 47 L28 45 L26 41 Z',
  mask: 'M4 14 C12 10 20 11 24 15 C28 11 36 10 44 14 C44 26 38 34 31 34 C27 34 25.5 30 24 30 C22.5 30 21 34 17 34 C10 34 4 26 4 14 Z M11 20 C13 18 17 18 19 21 C16 23 13 23 11 20 Z M29 21 C31 18 35 18 37 20 C35 23 32 23 29 21 Z',
  spear: 'M33 3 L45 3 L45 15 L41 11 L12 40 L13 44 L9 45 L4 44 L3 39 L4 35 L8 36 L37 7 Z',
  gear: 'M21 3 H27 L28 9 L32 11 L37 7 L41 11 L37 16 L39 20 L45 21 V27 L39 28 L37 32 L41 37 L37 41 L32 37 L28 39 L27 45 H21 L20 39 L16 37 L11 41 L7 37 L11 32 L9 28 L3 27 V21 L9 20 L11 16 L7 11 L11 7 L16 11 L20 9 Z M24 16 A8 8 0 1 0 24.01 16 Z',
  book: 'M6 8 C12 6 19 7 23 10 V42 C19 39 12 38 6 40 Z M42 8 C36 6 29 7 25 10 V42 C29 39 36 38 42 40 Z',
  flag: 'M8 4 H12 V45 H8 Z M12 6 C18 3 24 9 30 6 C34 4 38 4 41 6 V26 C38 24 34 24 30 26 C24 29 18 23 12 26 Z',
  door: 'M10 4 H38 V44 H34 V8 H14 V44 H10 Z M17 10 L32 7 V42 L17 39 Z M26 24 A2 2 0 1 1 25.99 24 Z',
  soundOn: 'M5 17 H13 L25 7 V41 L13 31 H5 Z M30 15 C34 18 34 30 30 33 L32.5 35.5 C38 31 38 17 32.5 12.5 Z M35 9 C43 15 43 33 35 39 L37.5 41.5 C47 34 47 14 37.5 6.5 Z',
  soundOff: 'M5 17 H13 L25 7 V41 L13 31 H5 Z M30 17 L33 14 L38 19 L43 14 L46 17 L41 22 L46 27 L43 30 L38 25 L33 30 L30 27 L35 22 Z',
  close: 'M10 7 L24 21 L38 7 L41 10 L27 24 L41 38 L38 41 L24 27 L10 41 L7 38 L21 24 L7 10 Z',
  strings: 'M6 6 H42 V10 H26 V14 H22 V10 H6 Z M8 10 H10 V44 H8 Z M23 14 H25 V44 H23 Z M38 10 H40 V44 H38 Z',
  moon: 'M30 4 A20 20 0 1 0 44 30 A16 16 0 1 1 30 4 Z',
  bell: 'M24 4 A3 3 0 0 1 27 7 V8.5 C33 10 37 15.5 37 22 V31 L41 36 V38 H7 V36 L11 31 V22 C11 15.5 15 10 21 8.5 V7 A3 3 0 0 1 24 4 Z M19 40 H29 A5 5 0 0 1 19 40 Z',
  quill: 'M42 4 C30 6 20 14 14 26 L11 34 L6 44 L8 45 L13 36 L21 33 C32 27 40 16 42 4 Z M16 30 C20 22 26 15 34 10 C28 17 23 24 19 31 Z',
} as const;

export type UiIcon = keyof typeof UI_ICONS;

export function pieceSvg(type: PieceType, cls = ''): string {
  const def = PIECE_ICONS[type];
  const body = def.d.map((d) => `<path fill-rule="evenodd" d="${d}"/>`).join('');
  const g = def.rotate ? `<g transform="rotate(${def.rotate} 24 24)">${body}</g>` : body;
  return `<svg class="ico ${cls}" viewBox="0 0 48 48" fill="currentColor" aria-hidden="true">${g}</svg>`;
}

export function uiSvg(name: UiIcon, cls = ''): string {
  return `<svg class="ico ${cls}" viewBox="0 0 48 48" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="${UI_ICONS[name]}"/></svg>`;
}

/** Canvas에 아이콘을 칠한다 (가운데 정렬, size 픽셀 정사각형 안에) */
export function paintIcon(ctx: CanvasRenderingContext2D, d: string[] | string, cx: number, cy: number, size: number, rotate = 0) {
  const paths = Array.isArray(d) ? d : [d];
  ctx.save();
  ctx.translate(cx, cy);
  if (rotate) ctx.rotate((rotate * Math.PI) / 180);
  ctx.scale(size / 48, size / 48);
  ctx.translate(-24, -24);
  for (const p of paths) ctx.fill(new Path2D(p), 'evenodd');
  ctx.restore();
}
