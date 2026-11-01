// Headless tests for Quincunx (solitaire): node test/quincunx.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'web/cards/manifest.json'), 'utf8'));
const byId = Object.fromEntries(manifest.cards.map((c) => [c.id, c]));

const C = await import('../web/js/games/quincunx-core.js');
C.init(byId);

const BASIC = manifest.basicDeck;
let failures = 0;
const check = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } };

const rank = (id) => (byId[id].rank === 'crown' ? 10 : byId[id].rank);
const suits = (id) => byId[id].suits;
const rankOf = (id) => (byId[id].rank === 'crown' ? 10 : byId[id].rank === null ? 0 : byId[id].rank);

const onTable = (s) => [...s.grid.filter(Boolean), ...s.hand, ...s.deck];
function conserved(state, label) {
  const all = onTable(state);
  if (all.length !== 36) { check(false, `${label}: ${all.length} cards`); return; }
  if (new Set(all).size !== 36) check(false, `${label}: duplicate or missing card`);
}

/* ------------------------------------------------------- an independent scorer */

function indScore(grid, cell, id) {
  const r = Math.floor(cell / 4), c = cell % 4;
  const at = (rr, cc) => (rr >= 0 && rr < 4 && cc >= 0 && cc < 4 ? rr * 4 + cc : -1);
  const nbrs = [[0, -1], [0, 1], [-1, 0], [1, 0]]
    .map(([dr, dc]) => at(r + dr, c + dc)).filter((x) => x >= 0 && grid[x]);

  let pts = 0, draws = 0;
  for (const n of nbrs) {
    const sum = rankOf(id) + rankOf(grid[n]);
    if (sum <= 9) {
      const aceMe = rankOf(id) === 1, aceN = rankOf(grid[n]) === 1;
      if (aceMe && suits(grid[n]).some((s) => suits(id).includes(s))) pts += sum;
      else if (aceN && suits(id).some((s) => suits(grid[n]).includes(s))) pts += sum;
      else pts -= sum;
    } else if (sum === 10) { /* zero */ }
    else if (sum === 11 || sum === 20) draws += 1;
    else pts += sum - 10;
  }

  let pairPts = 0, straightCount = 0, threeCount = 0;
  const pairVoid = new Set();
  for (const [dr, dc] of [[0, 1], [1, 0]]) {
    const line = [];
    for (let s = -4; s <= 4; s++) line.push(at(r + dr * s, c + dc * s));
    let straightHere = false, threeHere = false;
    for (let len = 3; len <= 5; len++) {
      for (let start = 0; start + len <= line.length; start++) {
        const win = line.slice(start, start + len);
        if (!win.includes(cell) || win.some((x) => x < 0 || !grid[x])) continue;
        const rs = win.map((x) => rankOf(grid[x]));
        if (rs.every((v) => v === rs[0])) {
          threeHere = true;
          for (const x of win) if (x !== cell) pairVoid.add(`${x}`);
        } else {
          const d = rs[1] - rs[0];
          if ((d === 1 || d === -1) && rs.every((v, i) => i === 0 || v - rs[i - 1] === d)) {
            straightHere = true;
          }
        }
      }
    }
    if (straightHere) straightCount += 1;
    if (threeHere) threeCount += 1;
  }
  for (const n of nbrs) if (rankOf(grid[n]) === rankOf(id) && !pairVoid.has(`${n}`)) pairPts += 5;

  let power = 0;
  if (rankOf(id) === 1 || rankOf(id) === 10) {
    const suit = suits(id).find((s) => nbrs.some((n) =>
      (rankOf(grid[n]) === 1 || rankOf(grid[n]) === 10) && suits(grid[n]).includes(s)));
    if (suit) {
      for (let i = 0; i < grid.length; i++) {
        if (i !== cell && grid[i] && suits(grid[i]).includes(suit)) power += rankOf(grid[i]);
      }
    }
  }
  return { total: pts + pairPts + straightCount * 20 + threeCount * 30 + power, draws };
}

/* ------------------------------------------------------------ setup invariants */

for (const variant of ['corners', 'slate']) {
  for (let seed = 1; seed <= 500; seed++) {
    const st = C.newGame(seed, BASIC, variant);
    check(st.variant === variant, `seed ${seed}: variant ${st.variant}`);
    check(st.grid.length === 16, `seed ${seed}: grid ${st.grid.length}`);
    const out = st.grid.filter(Boolean).length;
    check(out === (variant === 'slate' ? 1 : 4), `seed ${seed}: ${out} starting cards`);
    check(st.hand.length === (variant === 'slate' ? 12 : 8), `seed ${seed}: hand ${st.hand.length}`);
    check(st.deck.length === 36 - out - st.hand.length, `seed ${seed}: deck ${st.deck.length}`);
    check(st.moves === 0 && st.over === null && st.score === 0, `seed ${seed}: start flags`);
    const outCells = st.grid.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
    const wantLegal = variant === 'slate' ? C.neighbours(outCells[0]).length : 16 - out;
    check(C.legalCells(st).length === wantLegal,
      `seed ${seed}: legal cells ${C.legalCells(st).length}, want ${wantLegal}`);
    conserved(st, `seed ${variant} ${seed}`);
  }
}
{
  const st = C.newGame(7, BASIC, 'nonsense');
  check(st.variant === 'corners', 'an unknown variant falls back to corners');
}

/* ---------------------------------------- scoring fixtures, scored on paper */

const gridAt = (spec) => {
  const g = Array(16).fill(null);
  for (const [cell, id] of Object.entries(spec)) g[Number(cell)] = id;
  return g;
};

// Fixture 1 — basic scoring, every branch but the draws.
//   played: the-Mountain (4, moons+suns) on cell 5 (row 1, col 1)
//   left  ace-of-moons  1+4=5  matching Ace        +5
//   right ace-of-waves  1+4=5  no matching suit    -5
//   above the-Forest   4+5=9   no Ace              -9
//   below the-Desert   2+4=6   no Ace              -6
//   no pairs, no straight, no three, no power  =>  -15
{
  const g = gridAt({ 4: 'ace-of-moons', 5: 'the-mountain', 6: 'ace-of-waves',
    1: 'the-forest', 9: 'the-desert' });
  const s = C.scorePlacement(g, 5, 'the-mountain');
  check(s.total === -15 && s.basicPoints === -15 && s.draws === 0,
    `fixture 1: ${s.total} (paper: -15)`);
  check(s.basic.length === 4, `fixture 1: ${s.basic.length} scored sides`);
  check(s.basic.find((b) => b.cell === 4).points === 5, 'fixture 1: matching ace adds the sum');
  check(s.basic.find((b) => b.cell === 6).points === -5, 'fixture 1: non-matching ace subtracts');
  check(s.basic.find((b) => b.cell === 1).points === -9, 'fixture 1: bare sum of 9 loses 9');
  check(s.basic.find((b) => b.cell === 9).points === -6, 'fixture 1: bare sum of 6 loses 6');
  check(s.total === indScore(g, 5, 'the-mountain').total, 'fixture 1: independent scorer');
}

// Fixture 2 — the wiki's Boris example plus a power play.
//   played: the-Windfall (Crown of Crowns, 10) on cell 5
//   left  ace-of-crowns   1+10=11  draw
//   right the-Bard        10+10=20 draw, pair +5
//   above the-Huntress    10+10=20 draw, pair +5
//   below ace-of-moons    1+10=11  draw
//   power play: Crown of Crowns next to the Ace of Crowns => +1 (the only
//   other Crowns card showing).  Paper: 0 basic + 10 pairs + 1 power = 11, 4 draws.
{
  const g = gridAt({ 4: 'ace-of-crowns', 5: 'the-windfall', 6: 'the-bard',
    1: 'the-huntress', 9: 'ace-of-moons' });
  const s = C.scorePlacement(g, 5, 'the-windfall');
  check(s.total === 11 && s.draws === 4, `fixture 2: ${s.total} with ${s.draws} draws (paper: 11 with 4)`);
  check(s.pairs.length === 2, 'fixture 2: two crown pairs');
  check(s.power && s.power.suit === 'crowns' && s.power.points === 1, 'fixture 2: power play +1');
  check(s.threes.length === 0, 'fixture 2: two crowns is not a three of a kind');
  check(s.total === indScore(g, 5, 'the-windfall').total, 'fixture 2: independent scorer');
}

// Fixture 3 — a four card straight, a three of a kind, and pair voiding.
//   row 0: ace-of-moons(1), the-Author(2), the-Journey(3); played the-Sailor
//   (4, waves+leaves) on cell 3; below it the-Mountain (4) on 7, and
//   the-Battle (4) on 11.
//   basic: 3+4=7 loses 7, 4+4=8 loses 8                       -15
//   straight 1-2-3-4 through the play                          +20
//   three of a kind 4-4-4 vertically                           +30
//   the pair with the Mountain is inside the three of a kind     0
//   Paper total: 35.
{
  const g = gridAt({ 0: 'ace-of-moons', 1: 'the-author', 2: 'the-journey',
    3: 'the-sailor', 7: 'the-mountain', 11: 'the-battle' });
  const s = C.scorePlacement(g, 3, 'the-sailor');
  check(s.total === 35, `fixture 3: ${s.total} (paper: 35)`);
  check(s.straights.length === 1 && s.straights[0].length === 4, 'fixture 3: one four-card straight');
  check(s.threes.length === 1 && s.threes[0].length === 3, 'fixture 3: one three of a kind');
  check(s.pairs.length === 0, 'fixture 3: the pair inside the three of a kind does not score');
  check(s.total === indScore(g, 3, 'the-sailor').total, 'fixture 3: independent scorer');
}

// Fixture 4 — a straight through the card, and a "peak" that is not one.
{
  // the-Lunatic (6, moons+waves) on cell 6: the-Castle(7) above, the-
  // Discovery(5) below, the-Mountain(4) left, the-Author(2) right.
  //   basic: 6+7=13 +3 · 6+5=11 draw · 6+4=10 0 · 6+2=8 loses 8   => -5
  //   vertical 5-6-7 straight                                    +20
  //   Paper total: 15, one card drawn.
  const g = gridAt({ 2: 'the-castle', 10: 'the-discovery', 5: 'the-mountain',
    7: 'the-author', 6: 'the-lunatic' });
  const s = C.scorePlacement(g, 6, 'the-lunatic');
  check(s.straights.length === 1 && s.total === 15 && s.draws === 1,
    `fixture 4a: ${s.total} with ${s.straights.length} straight and ${s.draws} draws (paper: 15, 1, 1)`);
  check(s.total === indScore(g, 6, 'the-lunatic').total, 'fixture 4a: independent scorer');
  check(s.draws === indScore(g, 6, 'the-lunatic').draws, 'fixture 4a: independent draws');

  // two arms pointing the same way: 4-[5]-4 is a peak, not a straight
  const g2 = gridAt({ 5: 'the-mountain', 7: 'the-sailor', 6: 'the-soldier' });
  const s2 = C.scorePlacement(g2, 6, 'the-soldier');
  check(s2.straights.length === 0 && s2.pairs.length === 0 && s2.total === -18,
    `fixture 4b: peak 4-5-4 gives no straight and no pairs, -18 (got ${s2.total})`);
  check(s2.total === indScore(g2, 6, 'the-soldier').total, 'fixture 4b: independent scorer');

  // the same peak at equal ranks is a three of a kind: 5-[5]-5
  const g3 = gridAt({ 5: 'the-forest', 7: 'the-discovery', 6: 'the-soldier' });
  const s3 = C.scorePlacement(g3, 6, 'the-soldier');
  check(s3.threes.length === 1 && s3.pairs.length === 0 && s3.total === 30,
    `fixture 4c: 5-5-5 peak scores the three of a kind only (got ${s3.total})`);
  check(s3.total === indScore(g3, 6, 'the-soldier').total, 'fixture 4c: independent scorer');
}

// Fixture 5 — the end of the round: the hand penalty.
{
  check(C.handPenalty(['ace-of-moons', 'the-bard', 'the-mountain']) === -29,
    'penalty: Ace 15 + Crown 10 + 4 = 29');
  const st = {
    seed: 0, variant: 'corners', grid: BASIC.slice(0, 16), hand: ['ace-of-moons', 'the-bard'],
    deck: [], score: 40, draws: 0, moves: 12, last: null, over: null,
  };
  check(C.settle(st) === 'won', 'a full spread is a win');
  check(C.finalScore(st) === 40 - 15 - 10, `final score ${C.finalScore(st)}, paper: 15`);
}

/* ------------------------------------------------------------- playing cards */

{
  const base = C.newGame(1, BASIC, 'corners');
  const corners = base.grid.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
  check(corners.join() === '0,3,12,15', `corners land on ${corners.join()}`);
  const id = base.hand[0];
  const next = C.applyMove(base, 5, id);
  check(next.grid[5] === id, 'the card landed on the square');
  check(next.moves === 1 && next.score === next.last.total, 'move counted and scored');
  check(!base.hand.includes(id) === false, 'the original state was not mutated');
  conserved(next, 'after one move');
  check(next.hand.length + next.deck.length + next.grid.filter(Boolean).length === 36, 'cards split three ways');
}

/* ---- illegal moves throw ---- */
{
  const st = C.newGame(3, BASIC, 'corners');
  const id = st.hand[0];
  for (const [cell, why] of [[0, 'a filled corner'], [99, 'out of range'], [-1, 'out of range'],
    [1.5, 'not an integer']]) {
    let threw = false;
    try { C.applyMove(st, cell, id); } catch { threw = true; }
    check(threw, `playing on ${cell} (${why}) throws`);
  }
  let threw = false;
  try { C.applyMove(st, 5, 'the-excuse'); } catch { threw = true; }
  check(threw, 'playing a card that is not in your hand throws');

  const done = C.newGame(5, BASIC, 'corners');
  done.over = 'won';
  threw = false;
  try { C.applyMove(done, 5, done.hand[0]); } catch { threw = true; }
  check(threw, 'playing after the game is over throws');
}

/* ---- blank slate placement ---- */
{
  const st = C.newGame(11, BASIC, 'slate');
  const first = st.grid.findIndex(Boolean);
  const legal = C.legalCells(st);
  check(legal.length === C.neighbours(first).length && !legal.includes(first),
    'after the first card only its neighbours are legal');
  const next = C.applyMove(st, legal[0], st.hand[0]);
  const rest = C.legalCells(next);
  check(rest.length > 0 && rest.every((i) => !next.grid[i]
    && C.neighbours(i).some((n) => next.grid[n])),
    'the legal set is always empty squares around the tableau');
  let threw = false;
  const far = next.grid.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0
    && !C.neighbours(i).some((n) => next.grid[n]));
  check(far.length > 0, 'the slate leaves distant empty squares illegal');
  if (far.length) { try { C.applyMove(next, far[0], next.hand[0]); } catch { threw = true; } }
  check(threw, 'a non-adjacent square throws in the blank slate setup');
}

/* ---- running out of hand cards is a loss ---- */
{
  const g = Array(16).fill(null);
  g[0] = 'ace-of-moons';
  const st = { seed: 0, variant: 'corners', grid: g, hand: ['the-mountain'], deck: [],
    score: 0, draws: 0, moves: 11, last: null, over: null };
  const next = C.applyMove(st, 5, 'the-mountain');
  check(next.over === 'lost' && C.filled(next) < 16, 'an empty hand before a full spread loses');
  check(C.finalScore(next) === next.score, 'a lost game keeps the running score only');
}

/* ---- full random playouts: every deal ends, and the score cross-checks ---- */
let total = { corners: 0, slate: 0 }, won = 0, lost = 0, movesSum = 0;
for (const variant of ['corners', 'slate']) {
  for (let seed = 1; seed <= 300; seed++) {
    let st = C.newGame(seed, BASIC, variant);
    const rng = (mul) => mulberry32Local(mul);
    let r = rng(seed * 7919 + 13);
    let paper = 0, paperDraws = 0, guard = 0;
    const maxMoves = 16 - (variant === 'slate' ? 1 : 4);
    while (!st.over && guard++ <= maxMoves) {
      const cells = C.legalCells(st);
      check(cells.length > 0, `seed ${seed}: no legal square`);
      const cell = cells[Math.floor(r() * cells.length)];
      const id = st.hand[Math.floor(r() * st.hand.length)];
      st = C.applyMove(st, cell, id);
      conserved(st, `seed ${variant} ${seed} move ${st.moves}`);
      const ind = indScore(st.grid, cell, id);
      check(st.last.total === ind.total && st.last.draws === ind.draws,
        `seed ${variant} ${seed} move ${st.moves}: core ${st.last.total}/${st.last.draws} vs independent ${ind.total}/${ind.draws}`);
      paper += ind.total;
      paperDraws += ind.draws;
      check(st.draws === paperDraws, `seed ${variant} ${seed}: drawn ${st.draws}, paper ${paperDraws}`);
      check(st.score === paper, `seed ${variant} ${seed}: score ${st.score}, paper ${paper}`);
      const json = JSON.parse(JSON.stringify(st));
      check(json.hand.length === st.hand.length, `seed ${variant} ${seed}: JSON round trip`);
    }
    check(st.over === 'won' || st.over === 'lost', `seed ${variant} ${seed}: never ended (guard ${guard})`);
    check(guard <= maxMoves + 1, `seed ${variant} ${seed}: needed ${guard} moves`);
    if (st.over === 'won') {
      won++;
      check(C.finalScore(st) === st.score + C.handPenalty(st.hand),
        `seed ${variant} ${seed}: final score != score + penalty`);
    } else {
      lost++;
    }
    movesSum += st.moves;
    total[variant] += C.finalScore(st);
  }
}
console.log(`random playouts: ${won} won, ${lost} lost, average final score ` +
  `corners ${(total.corners / 300).toFixed(1)}, slate ${(total.slate / 300).toFixed(1)}`);
check(won + lost === 600, `${won + lost} of 600 random games reached an end`);
check(won >= 100, `only ${won} of 600 random games were won (expected at least 100)`);

function mulberry32Local(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---- describePlay says something sensible ---- */
{
  const g = gridAt({ 4: 'ace-of-moons', 5: 'the-mountain' });
  const s = C.scorePlacement(g, 5, 'the-mountain');
  check(C.describePlay(s).includes('+5') && C.describePlay(s).endsWith('= +5'),
    `describePlay: "${C.describePlay(s)}"`);
}

console.log(failures === 0 ? 'quincunx: all tests passed' : `quincunx: ${failures} failures`);
process.exit(failures ? 1 : 0);
