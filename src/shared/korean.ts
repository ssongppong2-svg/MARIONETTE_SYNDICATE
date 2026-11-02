/** 받침에 맞는 조사를 고릅니다. josa('궁수', '이/가') → '궁수가' */
export type JosaPair = '이/가' | '을/를' | '은/는' | '과/와' | '으로/로' | '이에요/예요';

export function hasBatchim(word: string): boolean | null {
  const ch = word.trim().slice(-1);
  const code = ch.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 !== 0;
  if (/[0-9]/.test(ch)) return '013678'.includes(ch); // 영, 일, 삼, 육, 칠, 팔
  return null;
}

function rieul(word: string): boolean {
  const code = word.trim().slice(-1).charCodeAt(0);
  return code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 === 8;
}

export function josa(word: string, pair: JosaPair): string {
  const [withB, withoutB] = pair.split('/') as [string, string];
  const b = hasBatchim(word);
  if (b === null) return `${word}${withB}(${withoutB})`;
  if (pair === '으로/로') return word + (b && !rieul(word) ? withB : withoutB);
  return word + (b ? withB : withoutB);
}
