/** 플레이어 설정 (이 브라우저에만 저장) */
import type { AiLevel } from '../shared/ai';

export interface Settings {
  name: string;
  aiLevel: AiLevel;
  sfx: number;
  music: number;
  shake: boolean;
  reduceMotion: boolean;
  coords: boolean;
}

const KEY = 'ms.settings.v1';
const prefersReduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const defaults: Settings = { name: '', aiLevel: 'normal', sfx: 0.8, music: 0.45, shake: true, reduceMotion: prefersReduced, coords: true };

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...defaults, ...JSON.parse(raw) };
  } catch { /* 저장소를 쓸 수 없는 환경 */ }
  return { ...defaults };
}

export const settings: Settings = load();
const listeners = new Set<(s: Settings) => void>();

export function saveSettings(patch: Partial<Settings>) {
  Object.assign(settings, patch);
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* 무시 */ }
  for (const fn of listeners) fn(settings);
}

export function onSettings(fn: (s: Settings) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function storeGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
export function storeSet(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* 무시 */ }
}
