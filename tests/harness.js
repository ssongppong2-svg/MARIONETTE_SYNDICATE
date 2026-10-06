/*
 * Loads the game's browser scripts into Node for headless tests.
 * Script order comes from index.html; DOM-bound layers (render/ui/main) are skipped.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const ENGINE_ONLY = [
  'src/core/math.js',
  'src/core/geometry.js',
  'src/physics/body.js',
  'src/physics/collide.js',
  'src/physics/contact.js',
  'src/physics/joints.js',
  'src/physics/world.js',
];

function scriptList() {
  const indexPath = path.join(ROOT, 'index.html');
  if (!fs.existsSync(indexPath)) return ENGINE_ONLY;
  const html = fs.readFileSync(indexPath, 'utf8');
  const out = [];
  const re = /<script[^>]*\ssrc="([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) {
    const src = m[1];
    if (/^https?:/.test(src)) continue;
    if (/^src\/(ui|render)\//.test(src) || src === 'src/main.js') continue;
    out.push(src);
  }
  return out.length ? out : ENGINE_ONLY;
}

function load(list) {
  for (const rel of list || scriptList()) {
    const code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    vm.runInThisContext(code, { filename: rel });
  }
  return globalThis.Lab;
}

let failures = 0, passes = 0;
function check(name, cond, detail = '') {
  if (cond) { passes++; console.log(`  ✓ ${name}${detail ? '  ' + detail : ''}`); }
  else { failures++; console.log(`  ✗ ${name}${detail ? '  ' + detail : ''}`); }
}
function near(a, b, tol) { return Math.abs(a - b) <= tol; }
function rel(a, b) { return Math.abs(a - b) / Math.max(1e-12, Math.abs(b)); }
function summary() {
  console.log(`\n${passes} passed, ${failures} failed`);
  return failures;
}

module.exports = { load, check, near, rel, summary, ENGINE_ONLY, scriptList, ROOT };
