// Headless tests for Soliterrapin: node test/soliterrapin.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mulberry32 as D_mulberry32 } from '../web/js/decktet.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'web/cards/manifest.json'), 'utf8'));
const byId = Object.fromEntries(manifest.cards.map((c) => [c.id, c]));

const C = await import('../web/js/games/soliterrapin-core.js');
C.init(byId);

const BASIC = manifest.basicDeck;
let failures = 0;
const check = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } };

const onTable = (state) => state.grid.filter(Boolean);
function conserved(state, label) {
  const all = [...onTable(state), ...state.deck, ...(state.current ? [state.current] : [])];
  if (all.length !== 36) { check(false, `${label}: ${all.length} cards`); return; }
  if (new Set(all).size !== 36) check(false, `${label}: duplicate or missing card`);
}

/* ---- an independent scorer, to hold the core against ---- */
function indLineTotal(ids) {
  const suits = new Set();
  for (const id of ids) for (const s of byId[id].suits) suits.add(s);
  if (suits.size === 6) return 0;                                   // Turtle Butt
  const counts = new Map();
  for (const id of ids) {
    const r = byId[id].rank === 'crown' ? 10 : byId[id].rank;
    counts.set(r, (counts.get(r) || 0) + 1);
  }
  let pts = 0;
  for (const n of counts.values()) if (n >= 2) pts += 5 * (n - 1);  // pairs / sets
  let best = 0, run = 0;
  for (let r = 1; r <= 10; r++) {                                   // longest straight
    run = counts.has(r) ? run + 1 : 0;
    if (run > best) best = run;
  }
  if (best >= 2) pts += 2 * (best - 1);
  return pts;
}

/* ---- setup invariants over 500 seeds ---- */
for (let seed = 1; seed <= 500; seed++) {
  const st = C.newGame(seed, BASIC);
  check(st.grid.length === 36 && st.grid.every((c) => c === null), `seed ${seed}: grid not empty`);
  check(st.deck.length === 35 && st.current != null, `seed ${seed}: deck ${st.deck.length}`);
  check(st.moves === 0 && st.over === null, `seed ${seed}: bad start flags`);
  check(C.legalCells(st).length === 36, `seed ${seed}: first card not placeable anywhere`);
  conserved(st, `seed ${seed}`);
}

/* ---- placement rules ---- */
{
  const base = C.newGame(1, BASIC);
  const first = C.applyMove(base, 14);           // dead centre
  check(first.grid[14] === base.current, 'the card landed on the cell');
  check(first.moves === 1 && first.over === null, 'move counted, game on');
  check(first.current !== base.current, 'the next card was flipped');
  conserved(first, 'after the first placement');

  const legal = C.legalCells(first);
  check(legal.join() === [8, 13, 15, 20].join(), `legal cells ${legal.join()}, want 8,13,15,20`);
  for (const bad of [14, 7, 21, 9, 6, 35]) {
    let threw = false;
    try { C.applyMove(first, bad); } catch { threw = true; }
    check(threw, `placing on ${bad} (occupied/diagonal/far) throws`);
  }
  const second = C.applyMove(first, 8);
  check(second.grid[8] === first.current, 'second placement above the first');
  check(C.legalCells(second).join() === [2, 7, 9, 13, 15, 20].join(),
    'the legal set grows around the two cards');
}

/* ---- a sealed row: a full row cannot grow, its neighbours still can ---- */
{
  const grid = Array(36).fill(null);
  BASIC.slice(0, 6).forEach((id, i) => { grid[i] = id; });    // row 0 complete
  const st = { seed: 0, grid, deck: BASIC.slice(6), current: BASIC[6], moves: 6, over: null };
  const legal = C.legalCells(st);
  check(legal.join() === [6, 7, 8, 9, 10, 11].join(),
    `a full row seals its own line; cells below stay open (${legal.join()})`);
  check(!legal.some((i) => i < 6), 'no cell of the sealed row is legal');
}

/* ---- the last card ends the game ---- */
{
  const grid = Array(36).fill(null);
  BASIC.slice(0, 35).forEach((id, i) => { grid[i] = id; });
  const last = BASIC[35];
  const st = { seed: 0, grid, deck: [], current: last, moves: 35, over: null };
  check(C.legalCells(st).length === 1 && C.legalCells(st)[0] === 35, 'exactly one cell left');
  const done = C.applyMove(st, 35);
  check(done.over === 'done' && done.current === null, 'the 36th card ends the game');
  conserved(done, 'final board');
  let threw = false;
  try { C.applyMove(done, 0); } catch { threw = true; }
  check(threw, 'placing after the game is over throws');
}

/* ---- scoring: the Terrapin hand rules, one line at a time ---- */
{
  const line = (ids) => C.scoreLine(ids);
  const sixAces = ['ace-of-moons', 'ace-of-suns', 'ace-of-waves',
    'ace-of-leaves', 'ace-of-daemons', 'ace-of-crowns'];
  let s = line(sixAces);
  check(s.turtleButt && s.total === 0, 'six aces: all six suits = Turtle Butt = 0');

  // Turtle Butt nullifies the pairs it would otherwise score.
  const buttWithPairs = ['ace-of-moons', 'ace-of-suns', 'the-desert',
    'the-origin', 'the-author', 'the-bard'];
  s = line(buttWithPairs);
  check(s.turtleButt && s.total === 0,
    'a pair of Aces, a pair of rank 2 and a Crown still die to Turtle Butt');

  // A 1-2-3-4-5-6 straight of Moons: 2 points per card after the first = 10.
  const moonRun = ['ace-of-moons', 'the-author', 'the-journey',
    'the-mountain', 'the-forest', 'the-lunatic'];
  s = line(moonRun);
  check(!s.turtleButt, 'the moons run shows only five suits');
  check(s.total === 10 && s.straight.points === 10 && s.straight.ranks.join() === '1,2,3,4,5,6',
    `moons A-6 straight scores 10, got ${s.total}`);

  // Three aces (10) and three crowns (10): aces and crowns never join into
  // a straight, so the ranks present are only 1 and 10.
  const acesAndCrowns = ['ace-of-moons', 'ace-of-suns', 'ace-of-waves',
    'the-bard', 'the-sea', 'the-end'];
  s = line(acesAndCrowns);
  check(!s.turtleButt && s.total === 20 && s.straight.points === 0,
    `three Aces 10 + three Crowns 10, no straight; got ${s.total}`);
  check(s.pairs.length === 2 && s.pairs[0].points === 10 && s.pairs[1].points === 10,
    'the pair breakdown: Aces +10, Crowns +10');

  // Six of a kind: all six crowns are one per suit, so even that is Turtle Butt.
  const sixCrowns = ['the-bard', 'the-calamity', 'the-end',
    'the-huntress', 'the-sea', 'the-windfall'];
  s = line(sixCrowns);
  check(s.turtleButt && s.total === 0, 'even six crowns show all six suits: Turtle Butt');

  const fourAces = ['ace-of-moons', 'ace-of-suns', 'ace-of-waves', 'ace-of-leaves',
    'the-bard', 'the-end'];
  s = line(fourAces);
  check(!s.turtleButt, 'four aces plus two leaves/suns crowns keep two suits spare');
  check(s.total === 20 && s.pairs.length === 2,
    `four aces (15) + pair of Crowns (5) = 20, got ${s.total}`);

  // Two pairs and a three-card straight.
  const twoPairs = ['the-diplomat', 'the-pact', 'the-mill',
    'the-merchant', 'the-bard', 'the-end'];
  s = line(twoPairs);
  check(!s.turtleButt && s.total === 19,
    `pair 8s (5) + pair 9s (5) + pair Crowns (5) + straight 8-9-Crown (4) = 19, got ${s.total}`);

  // Only the longest straight scores; a tie is worth the same either way.
  const tied = ['ace-of-moons', 'the-author', 'the-journey',
    'the-diplomat', 'the-pact', 'the-bard'];
  s = line(tied);
  check(!s.turtleButt && s.total === 4 && s.straight.ranks.join() === '1,2,3',
    `two three-card straights: only one scores (4), got ${s.total}`);

  const longBeatsShort = ['the-mill', 'the-pact', 'the-bard',
    'ace-of-moons', 'the-author', 'the-journey'];
  s = line(longBeatsShort);
  check(s.total === 4 && s.straight.ranks.join() === '1,2,3',
    `two three-card straights again, scored the same (4); got ${s.total}`);

  // An empty line (a board mid-build) scores zero and is not Turtle Butt.
  s = line([null, null, 'ace-of-moons', null, null, null]);
  check(!s.turtleButt && s.total === 0, 'a lone ace scores nothing');

  // Cross-check every line above against the independent scorer.
  for (const ids of [sixAces, buttWithPairs, moonRun, acesAndCrowns,
    sixCrowns, fourAces, twoPairs, tied, longBeatsShort]) {
    check(C.scoreLine(ids).total === indLineTotal(ids),
      `core and independent scorer disagree on ${ids.join()}`);
  }
}

/* ---- two full boards, scored on paper ---- */

// Board A: the deck in order — six aces, six crowns, then each rank's trio.
// Every row covers all six suits (Turtle Butt).  Every column mixes an Ace
// and a Crown with ranks one apart somewhere ({1,2} or {9,10}), never more,
// and never a pair — 2 points each.  Paper total: 6 x 0 + 6 x 2 = 12.
const BOARD_A = [
  'ace-of-moons', 'ace-of-suns', 'ace-of-waves', 'ace-of-leaves', 'ace-of-daemons', 'ace-of-crowns',
  'the-bard', 'the-calamity', 'the-end', 'the-huntress', 'the-sea', 'the-windfall',
  'the-author', 'the-desert', 'the-origin', 'the-journey', 'the-painter', 'the-savage',
  'the-mountain', 'the-sailor', 'the-battle', 'the-forest', 'the-discovery', 'the-soldier',
  'the-lunatic', 'the-market', 'the-penitent', 'the-chance-meeting', 'the-castle', 'the-cave',
  'the-diplomat', 'the-mill', 'the-betrayal', 'the-pact', 'the-merchant', 'the-darkness',
];
{
  const sc = C.scoreGrid(BOARD_A);
  check(sc.total === 12, `board A total ${sc.total}, paper says 12`);
  sc.lines.forEach((l, i) => {
    const want = i < 6 ? 0 : 2;
    check(l.total === want, `board A ${l.kind} ${l.index + 1}: ${l.total}, paper says ${want}`);
    check(l.turtleButt === (i < 6), `board A ${l.kind} ${l.index + 1}: turtleButt flag`);
    check(l.total === indLineTotal(l.ids), `board A ${l.kind} ${l.index + 1}: independent scorer`);
  });
}

// Board B: a mixed board (row-major).  Paper score:
//   R1  aces 1-1 + 2-3-4 + pair of 4s: pairs 10, straight 1-2-3-4 = 6      → 16
//   R2  lunatic/penitent/market + chance/castle/cave: all six suits         →  0 (TB)
//   R3  pair 2s, pair 3s, pair Crowns (15) + straight 2-3                   → 17
//   R4  pair 8s, pair Crowns (10) + straight 8-9-Crown                      → 14
//   R5  forest/discovery/soldier + bard/sea/darkness: all six suits         →  0 (TB)
//   R6  four Aces 15 + pair Crowns 5; ranks {1,8,9} straight 8-9 = 2        → 17
//   C1  no pairs; ranks {1,2,4,5,6,8}: straight 4-5-6                       →  4
//   C2  no pairs; ranks {1,2,5,6,8,9}: straights of two, longest 2          →  2
//   C3  all six suits                                                       →  0 (TB)
//   C4  pair of 3s; ranks {1,3,7,9,10}: straight 9-Crown                    →  7
//   C5  three Crowns 10; ranks {1,4,7,10}: no straight                      → 10
//   C6  pair of Crowns 5; ranks {1,4,7,9,10}: straight 9-Crown              →  7
// Paper total: rows 64 + columns 30 = 94.
const BOARD_B = [
  'ace-of-moons', 'ace-of-suns', 'the-origin', 'the-journey', 'the-mountain', 'the-sailor',
  'the-lunatic', 'the-penitent', 'the-market', 'the-chance-meeting', 'the-castle', 'the-cave',
  'the-author', 'the-desert', 'the-painter', 'the-savage', 'the-huntress', 'the-end',
  'the-battle', 'the-betrayal', 'the-diplomat', 'the-pact', 'the-windfall', 'the-calamity',
  'the-forest', 'the-discovery', 'the-soldier', 'the-bard', 'the-sea', 'the-darkness',
  'the-mill', 'the-merchant', 'ace-of-waves', 'ace-of-leaves', 'ace-of-daemons', 'ace-of-crowns',
];
{
  check(new Set(BOARD_B).size === 36, 'board B uses 36 distinct cards');
  const sc = C.scoreGrid(BOARD_B);
  const wantRows = [16, 0, 17, 14, 0, 17];
  const wantCols = [4, 2, 0, 7, 10, 7];
  check(sc.total === 94, `board B total ${sc.total}, paper says 94`);
  sc.lines.forEach((l, i) => {
    const want = l.kind === 'row' ? wantRows[l.index] : wantCols[l.index];
    check(l.total === want, `board B ${l.kind} ${l.index + 1}: ${l.total}, paper says ${want}`);
    check(l.total === indLineTotal(l.ids), `board B ${l.kind} ${l.index + 1}: independent scorer`);
  });
  check(C.describeLine(sc.lines[1]).includes('Turtle Butt'), 'describeLine flags Turtle Butt');
  check(C.describeLine(sc.lines[0]).endsWith('= 16'), 'describeLine totals the line');
}

/* ---- a board mid-build scores the same way, line by line ---- */
{
  const grid = Array(36).fill(null);
  ['ace-of-moons', 'the-author', 'the-journey'].forEach((id, i) => { grid[i] = id; });
  const sc = C.scoreGrid(grid);
  check(sc.lines[0].total === 4, 'a partial row scores a live preview (A-2-3 = 4)');
  check(sc.lines.filter((l) => !l.ids.some(Boolean)).every((l) => l.total === 0),
    'empty lines score nothing');
}

/* ---- full random playouts: random placement always completes the board ---- */
let totalScore = 0;
for (let seed = 1; seed <= 300; seed++) {
  let st = C.newGame(seed, BASIC);
  const rng = D_mulberry32(seed * 7919 + 13);
  let guard = 0;
  while (!st.over && guard++ < 100) {
    const legal = C.legalCells(st);
    check(legal.length > 0, `seed ${seed}: no legal cell with ${C.placed(st)} cards down`);
    const cell = legal[Math.floor(rng() * legal.length)];
    st = C.applyMove(st, cell);
    conserved(st, `seed ${seed} move ${st.moves}`);
    check(C.placed(st) === st.moves, `seed ${seed}: placed ${C.placed(st)} after ${st.moves} moves`);
    const json = JSON.parse(JSON.stringify(st));
    check(json.grid.length === 36 && json.deck.length === st.deck.length,
      `seed ${seed}: JSON round trip`);
  }
  check(st.over === 'done', `seed ${seed}: game never ended (guard ${guard})`);
  check(st.moves === 36, `seed ${seed}: finished in ${st.moves} moves, expected 36`);
  check(st.grid.every(Boolean) && st.deck.length === 0 && st.current === null,
    `seed ${seed}: board not full`);
  const sc = C.scoreGrid(st.grid);
  check(sc.total === sc.lines.reduce((n, l) => n + indLineTotal(l.ids), 0),
    `seed ${seed}: total ${sc.total} != independent ${sc.lines.reduce((n, l) => n + indLineTotal(l.ids), 0)}`);
  totalScore += sc.total;
}
console.log(`random playouts: 300/300 finished, average score ${(totalScore / 300).toFixed(1)}`);

console.log(failures === 0 ? 'soliterrapin: all tests passed' : `soliterrapin: ${failures} failures`);
process.exit(failures ? 1 : 0);
