#!/usr/bin/env node
/*
 * Bundles index.html, styles.css and every local script into one HTML file.
 *
 *   node tools/build.js                 → dist/nudge.html (standalone page)
 *   node tools/build.js --fragment out  → page body without the document skeleton,
 *                                          for hosts that wrap the page themselves
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const fragmentIdx = args.indexOf('--fragment');
const fragmentOut = fragmentIdx >= 0 ? args[fragmentIdx + 1] : null;

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const cssPath = path.join(ROOT, 'styles.css');
let out = html;
if (fs.existsSync(cssPath)) {
  const css = fs.readFileSync(cssPath, 'utf8');
  out = out.replace(/<link rel="stylesheet" href="styles\.css">/, () => `<style>\n${css}\n</style>`);
}
out = out.replace(/<script src="([^"]+)"><\/script>/g, (m, src) => {
  if (/^https?:/.test(src)) return m;
  const code = fs.readFileSync(path.join(ROOT, src), 'utf8').replace(/<\/script/gi, '<\\/script');
  return `<script>/* ${src} */\n${code}\n</script>`;
});

if (fragmentOut) {
  const head = out.match(/<head>([\s\S]*?)<\/head>/)[1]
    .replace(/<meta charset="utf-8">\s*/, '')
    .replace(/<meta name="viewport"[^>]*>\s*/, '');
  const body = out.match(/<body>([\s\S]*?)<\/body>/)[1];
  const title = head.match(/<title>[\s\S]*?<\/title>/)[0];
  const rest = head.replace(title, '');
  // Title first so hosts that scan the opening bytes find it.
  fs.writeFileSync(path.resolve(fragmentOut), `${title}\n${rest.trim()}\n${body.trim()}\n`);
  console.log('fragment →', fragmentOut);
} else {
  const dist = path.join(ROOT, 'dist');
  fs.mkdirSync(dist, { recursive: true });
  const file = path.join(dist, 'nudge.html');
  fs.writeFileSync(file, out);
  console.log('standalone →', path.relative(ROOT, file), `(${(out.length / 1024).toFixed(0)} KB)`);
}
