/**
 * claude.ai 페이지용 파일 하나 만들기.
 * vite build --mode artifact 결과(dist-artifact)의 JS·CSS를 HTML 안에 넣고,
 * 글꼴은 Google Fonts에서 불러오게 한다. 결과: dist-artifact/marionette-syndicate.html
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = 'dist-artifact';
const html = readFileSync(join(dir, 'index.html'), 'utf8');
const css = [...html.matchAll(/<link rel="stylesheet"[^>]*href="\.\/([^"]+)"[^>]*>/g)].map((m) => readFileSync(join(dir, m[1]), 'utf8'));
const js = [...html.matchAll(/<script type="module"[^>]*src="\.\/([^"]+)"[^>]*><\/script>/g)].map((m) => readFileSync(join(dir, m[1]), 'utf8'));
if (!js.length) throw new Error('JS를 찾지 못했다');
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1].replace(/<script[\s\S]*?<\/script>/g, '').trim();
const fonts = 'https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&family=Nanum+Myeongjo:wght@400;700;800&display=swap';
const out = `<title>마리오네트 신디케이트</title>
<meta name="description" content="금빛 궁정 위에 피와 그림자가 얹힌 중세 정치 암살극. 10×10 보드 1대1 심리전.">
<meta name="theme-color" content="#0b0b0e">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${fonts}">
<style>
${css.join('\n')}
</style>
${body}
<script type="module">
${js.join('\n').replace(/<\/script/gi, '<\\/script')}
</script>
`;
writeFileSync(join(dir, 'marionette-syndicate.html'), out);
console.log(`dist-artifact/marionette-syndicate.html  ${(out.length / 1024).toFixed(0)} KB`);
