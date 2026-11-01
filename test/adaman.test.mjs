// Headless tests for the Adaman rules: node test/adaman.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(
  readFileSync(path.join(ROOT, 'web/cards/manifest.json'), 'utf8'));
const byId = Object.fromEntries(manifest.cards.map((c) => [c.id, c]));

const C = await import('../web/js/games/adaman-core.js');
C.init(byId);

let failures = 0;
function check(cond, msg) {
  if (!cond) {
    failures++;
    console.error('FAIL:', msg);
  }
}

const BASIC = manifest.basicDeck;
const PERSONALITIES = new Set(manifest.personalities);

function counts(st) {
  const all = [...st.deck, ...st.capital, ...st.resources, ...st.palace, ...st.discard];
  const tally = {};
  for (const id of all) tally[id] = (tally[id] || 0) + 1;
  return { all, tally };
}

/* ---- setup invariants over many seeds ---- */
for (let seed = 1; seed <= 500; seed++) {
  const st = C.newGame(seed, BASIC);
  const { all, tally } = counts(st);
  check(all.length === 36, `seed ${seed}: ${all.length} cards in play`);
  for (const id of BASIC) check((tally[id] || 0) === 1, `seed ${seed}: ${id} duplicated/missing`);
  check(st.capital.length === 5 || st.over, `seed ${seed}: capital ${st.capital.length}`);
  check(st.resources.length === 5 || st.over, `seed ${seed}: resources ${st.resources.length}`);
  check(st.resources.every((id) => !byId[id].personality),
    `seed ${seed}: a personality reached the resources`);
  check(st.palace.length <= 5 || st.over === 'caught',
    `seed ${seed}: palace ${st.palace.length} without ending the game`);
  if (!st.over) {
    check(C.hasAnyMove(st) || st.over === 'lost',
      `seed ${seed}: game starts with no legal move and is not marked lost`);
  }
}

/* ---- playing random legal games to completion ---- */
const outcomes = { won: 0, lost: 0, caught: 0 };
for (let seed = 1; seed <= 400; seed++) {
  let st = C.newGame(seed, BASIC);
  let guard = 0;
  while (!st.over && guard++ < 500) {
    // one greedy legal move per target: biggest cards first, stop when the
    // total reaches the target's rank
    const moves = [];
    for (const t of [...st.capital, ...st.palace]) {
      const need = C.rankValue(byId[t]);
      const contrib = C.contributors(st, t)
        .sort((a, b) => C.rankValue(byId[b]) - C.rankValue(byId[a]));
      const sel = [];
      let sum = 0;
      for (const id of contrib) {
        if (sum >= need) break;
        sel.push(id);
        sum += C.rankValue(byId[id]);
      }
      if (sum >= need) moves.push({ t, sel });
    }
    if (!moves.length) break;
    const m = moves[Math.floor(Math.random() * moves.length)];
    st = C.applyMove(st, m.t, m.sel);
  }
  check(!!st.over, `seed ${seed}: game never ended (${guard} moves)`);
  check(st.over === 'won' || st.over === 'lost' || st.over === 'caught',
    `seed ${seed}: weird outcome ${st.over}`);
  outcomes[st.over]++;

  const { all, tally } = counts(st);
  check(all.length === 36, `seed ${seed}: cards lost after play (${all.length})`);
  for (const id of BASIC) check((tally[id] || 0) === 1, `seed ${seed}: ${id} lost`);

  const score = C.scoreOf(st);
  if (st.over === 'won') {
    check(C.personalitiesInDiscard(st) === 11, `seed ${seed}: win with ${C.personalitiesInDiscard(st)} personalities`);
    check(score >= 66, `seed ${seed}: winning score ${score} < 66`);
  }
  if (st.over === 'caught') {
    check(st.palace.length > 5, `seed ${seed}: caught with palace ${st.palace.length}`);
    check(score === 0, `seed ${seed}: caught score ${score}`);
  }
  if (st.over === 'lost') {
    check(C.personalitiesInDiscard(st) < 11, `seed ${seed}: loss with all personalities controlled`);
    check(!C.hasAnyMove(st), `seed ${seed}: loss but moves remain`);
    const controlled = st.discard.filter((id) => PERSONALITIES.has(id));
    const expected = controlled.reduce((s, id) => s + C.rankValue(byId[id]), 0);
    check(score === expected, `seed ${seed}: loss score ${score} != ${expected}`);
  }
}

/* ---- illegal moves are refused ---- */
{
  const st = C.newGame(7, BASIC);
  const target = st.capital[0];
  const strangers = st.resources.filter(
    (r) => !byId[r].suits.some((s) => byId[target].suits.includes(s)));
  if (strangers.length === st.resources.length) {
    let threw = false;
    try { C.applyMove(st, target, strangers); } catch { threw = true; }
    check(threw, 'a move with no shared suit should be refused');
  }
}

console.log('outcomes:', outcomes);
console.log(failures === 0 ? 'adaman: all tests passed' : `adaman: ${failures} failures`);
process.exit(failures ? 1 : 0);
