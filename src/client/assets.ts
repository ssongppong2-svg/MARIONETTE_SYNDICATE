/**
 * 바꿔 끼울 수 있는 그림·소리 자리.
 * public/assets/manifest.json 에 파일을 적으면 코드로 만든 기본값 대신 그 파일을 씁니다.
 *
 * {
 *   "audio": { "music": "audio/theme.ogg", "execute": "audio/execute.ogg" },
 *   "art":   { "title": "art/title.webp", "pieces": { "lord": "art/lord.png" } }
 * }
 */
import type { PieceType } from '../shared/types';

export type SoundName =
  | 'click' | 'hover' | 'select' | 'move' | 'execute' | 'death' | 'bribe' | 'bribeFail' | 'card' | 'seal'
  | 'news' | 'turnMine' | 'turnTheirs' | 'royal' | 'bless' | 'poison' | 'tick' | 'exposed' | 'victory'
  | 'defeat' | 'roundStart' | 'blocked' | 'error' | 'match';

export interface Manifest {
  audio: Partial<Record<SoundName | 'music', string>>;
  art: { title?: string; board?: string; pieces?: Partial<Record<PieceType, string>> };
}

export const manifest: Manifest = { audio: {}, art: {} };

export async function loadManifest(): Promise<void> {
  try {
    const res = await fetch('assets/manifest.json', { cache: 'no-cache' });
    if (!res.ok) return;
    const data = (await res.json()) as Partial<Manifest>;
    Object.assign(manifest.audio, data.audio ?? {});
    Object.assign(manifest.art, data.art ?? {});
  } catch { /* 매니페스트가 없으면 전부 기본값 */ }
}

export function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((ok) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => ok(null);
    img.src = src;
  });
}
