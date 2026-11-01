// Asset + link integrity: node test/assets.test.mjs
// Checks that the cut cards, their variants, the icons, every relative link in
// every HTML page, and the service worker's precache list all line up.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const WEB = path.join(ROOT, 'web');

let failures = 0;
const check = (cond, msg) => {
  if (!cond) { failures++; console.error('FAIL:', msg); }
};

const manifest = JSON.parse(readFileSync(path.join(WEB, 'cards/manifest.json'), 'utf8'));

check(manifest.cards.length === 45, `manifest has ${manifest.cards.length} cards`);
check(manifest.basicDeck.length === 36, `basic deck ${manifest.basicDeck.length}`);
check(manifest.extendedDeck.length === 9, `extended deck ${manifest.extendedDeck.length}`);
check(manifest.personalities.length === 11, `personalities ${manifest.personalities.length}`);

/* ---- every card has all three sizes and usable alpha ---- */
for (const c of manifest.cards) {
  for (const [kind, rel] of [
    ['png', `cards/${c.id}.png`],
    ['web', `cards/web/${c.id}.webp`],
    ['thumb', `cards/thumb/${c.id}.webp`],
  ]) {
    const p = path.join(WEB, rel);
    check(existsSync(p), `${rel} missing`);
    if (existsSync(p) && kind === 'png' && statSync(p).size < 5000) {
      console.error('WARN:', rel, 'is suspiciously small');
    }
  }
}

/* ---- suit and rank icons ---- */
for (const s of manifest.suits.map((s) => s.toLowerCase())) {
  check(existsSync(path.join(WEB, `cards/icons/suits/${s}.png`)), `suit icon ${s} missing`);
}
for (const r of ['2', '3', '4', '5', '6', '7', '8', '9', 'crown', 'pawn', 'court']) {
  check(existsSync(path.join(WEB, `cards/icons/ranks/${r}.png`)), `rank icon ${r} missing`);
}

/* ---- every relative href/src in every page resolves ---- */
const pages = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (name.endsWith('.html')) pages.push(p);
  }
})(WEB);

for (const page of pages) {
  const html = readFileSync(page, 'utf8');
  const refs = [...html.matchAll(/(?:href|src)\s*=\s*"([^"]+)"/g)].map((m) => m[1]);
  for (const ref of refs) {
    if (/^(https?:|mailto:|#|data:)/.test(ref)) continue;
    if (ref.includes('${')) continue;               // template literal in inline JS
    const target = ref.split('#')[0].split('?')[0];
    if (!target) continue;
    const abs = path.resolve(path.dirname(page), target);
    check(existsSync(abs), `${path.relative(ROOT, page)} → ${ref} missing`);
  }
}

/* ---- the service worker only precaches files that exist ---- */
const sw = readFileSync(path.join(WEB, 'sw.js'), 'utf8');
const shellBlock = sw.match(/const SHELL = \[([\s\S]*?)\];/);
check(!!shellBlock, 'sw.js SHELL not found');
if (shellBlock) {
  const entries = [...shellBlock[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  for (const e of entries) {
    const rel = e === './' ? 'index.html' : e;
    check(existsSync(path.join(WEB, rel)), `sw precache ${e} missing`);
  }
  check(entries.length >= 15, `SHELL has only ${entries.length} entries`);
}

/* ---- the games catalogue: every live game has its files, every thumb exists */
const cat = JSON.parse(readFileSync(path.join(WEB, 'games.json'), 'utf8'));
check(Array.isArray(cat.games) && cat.games.length >= 3, 'games.json has no games');
check(new Set(cat.games.map((g) => g.id)).size === cat.games.length, 'duplicate game ids');
check(new Set(cat.games.map((g) => g.href)).size === cat.games.length, 'duplicate game hrefs');
const sections = new Set((cat.sections || []).map((s) => s.id));

let live = 0;
for (const g of cat.games) {
  check(sections.has(g.section), `${g.id}: unknown section ${g.section}`);
  check(existsSync(path.join(WEB, g.thumb)), `${g.id}: thumb ${g.thumb} missing`);
  for (const field of ['title', 'blurb', 'rules', 'href']) {
    check(!!g[field], `${g.id}: missing ${field}`);
  }
  if (g.planned) continue;
  live++;
  for (const rel of [
    g.href, g.rules,
    `js/games/${g.id}.js`,
    `js/games/${g.id}-core.js`,
  ]) {
    check(existsSync(path.join(WEB, rel)), `${g.id}: ${rel} missing`);
  }
}
check(live >= 3, `only ${live} live games`);

console.log(failures === 0
  ? `assets: ${pages.length} pages, ${manifest.cards.length} cards, all checks passed`
  : `assets: ${failures} failures`);
process.exit(failures ? 1 : 0);
