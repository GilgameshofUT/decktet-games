// Headless tests for Aucteraden: node test/aucteraden.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mulberry32 as D_mulberry32 } from '../web/js/decktet.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'web/cards/manifest.json'), 'utf8'));
const byId = Object.fromEntries(manifest.cards.map((c) => [c.id, c]));

const C = await import('../web/js/games/aucteraden-core.js');
C.init(byId);

const BASIC = manifest.basicDeck;
let failures = 0;
const check = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } };
const throws = (fn, label) => {
  let threw = null;
  try { fn(); } catch (err) { threw = err; }
  check(!!threw, `${label} should throw`);
  return threw;
};

const SUITS = C.SUITS;
const CHIPS4 = Object.fromEntries(SUITS.map((s) => [s, 4]));
const rankOf = (id) => byId[id].rank === 'crown' ? 10 : byId[id].rank;

/** A hand-built state: grid = 16 entries (ids or null), top of deck first. */
function boardState(grid, chips = {}, opts = {}) {
  return {
    seed: 0, rngState: 1,
    over: opts.over ?? null,
    deck: opts.deck ?? [],
    market: opts.market ?? [null, null, null],
    tableau: grid.slice(),
    chips: { ...CHIPS4, ...chips },
    trash: opts.trash ?? [],
    rowDiscards: opts.rowDiscards ?? 0,
    moves: 0, lastNote: null,
  };
}

function conserved(st, label) {
  const all = [...st.tableau, ...st.market, ...st.deck, ...st.trash].filter(Boolean);
  if (all.length !== 36) { check(false, `${label}: ${all.length} cards`); return; }
  if (new Set(all).size !== 36) check(false, `${label}: duplicate or missing card`);
  for (const s of SUITS) {
    if (st.chips[s] < 0 || st.chips[s] > 4) check(false, `${label}: ${s} chips ${st.chips[s]}`);
  }
}

/** For hand-built (partial) boards: a move must neither create nor destroy a card. */
const zones = (st) => [...st.tableau, ...st.market, ...st.deck, ...st.trash]
  .filter(Boolean).sort().join('|');
function sameCards(before, after, label) {
  check(zones(before) === zones(after),
    `${label}: cards changed\n  before ${zones(before)}\n  after  ${zones(after)}`);
}

/* ---- an independent scorer, to hold the core against ---- */
function nb(i) {
  const r = Math.floor(i / 4), c = i % 4, out = [];
  if (c > 0) out.push(i - 1);
  if (c < 3) out.push(i + 1);
  if (r > 0) out.push(i - 4);
  if (r < 3) out.push(i + 4);
  return out;
}
function indChain(tableau, suit) {
  const paths = [];
  for (let start = 0; start < 16; start++) {
    const id = tableau[start];
    if (!id || !byId[id].suits.includes(suit)) continue;
    let frontier = [[start]];
    while (frontier.length) {
      const path = frontier.pop();
      paths.push(path);
      const tail = path[path.length - 1];
      for (const n of nb(tail)) {
        const id2 = tableau[n];
        if (!id2 || !byId[id2].suits.includes(suit)) continue;
        if (rankOf(id2) <= rankOf(tableau[tail])) continue;
        if (path.includes(n)) continue;
        frontier.push([...path, n]);
      }
    }
  }
  let len = 0, bonus = -1;
  for (const p of paths) {
    const first = byId[tableau[p[0]]].rank === 1;
    const last = byId[tableau[p[p.length - 1]]].rank === 'crown';
    const b = (first ? 1 : 0) + (last ? 2 : 0) + (first && last ? 4 : 0);
    if (p.length > len || (p.length === len && b > bonus)) { len = p.length; bonus = b; }
  }
  return { len, bonus: Math.max(bonus, 0) };
}
const IND_BASE = [-5, -5, 2, 5, 9, 14, 20, 30];
function indScore(st) {
  let total = 0;
  for (const s of SUITS) {
    const { len, bonus } = indChain(st.tableau, s);
    const base = len >= 7 ? 30 : IND_BASE[len];
    const pen = (st.chips[s] === 0 || st.chips[s] === 4) ? -5 : 0;
    total += base + bonus + pen;
  }
  total -= 5 * st.tableau.filter((x) => !x).length;
  total -= 3 * st.rowDiscards;
  return total;
}

/* ---- setup invariants over 500 seeds ---- */
for (let seed = 1; seed <= 500; seed++) {
  const st = C.newGame(seed, BASIC);
  check(st.market.length === 3 && st.market.every(Boolean), `seed ${seed}: market ${st.market}`);
  check(new Set(st.market).size === 3, `seed ${seed}: duplicate market card`);
  check(st.deck.length === 33, `seed ${seed}: deck ${st.deck.length}`);
  check(st.tableau.length === 16 && st.tableau.every((x) => x === null), `seed ${seed}: tableau not empty`);
  check(SUITS.every((s) => st.chips[s] === 4), `seed ${seed}: chips`);
  check(st.moves === 0 && st.over === null && st.rowDiscards === 0, `seed ${seed}: bad flags`);
  conserved(st, `seed ${seed}`);
  const json = JSON.parse(JSON.stringify(st));
  check(json.deck.length === 33 && json.market.length === 3, `seed ${seed}: JSON round trip`);
}
throws(() => C.newGame(1, BASIC.slice(1)), 'an incomplete deck');

/* ---- costs by position ---- */
check(C.COST.join() === '2,1,0', 'left 2, middle 1, right free');

/* ---- the VP table ---- */
check([0, 1, 2, 3, 4, 5, 6, 7, 8].map(C.baseVP).join() === '-5,-5,2,5,9,14,20,30,30',
  `VP table: ${[0, 1, 2, 3, 4, 5, 6, 7, 8].map(C.baseVP)}`);

/* ---- placement rules ---- */
{
  const empty = Array(16).fill(null);
  check(C.legalCells(boardState(empty), 'ace-of-moons').length === 16, 'the first card goes anywhere');

  const grid = Array(16).fill(null);
  grid[5] = 'the-desert';                       // a plain rank-2 card
  const legal = C.legalCells(boardState(grid), 'ace-of-moons');
  check(legal.join() === '1,4,6,9'.split(',').join(),
    `touching squares only (${legal})`);
  check(!legal.includes(5), 'not on top of a card');

  // the Ace/Crown rule is about ranks and only bites straight neighbours
  const crowns = Array(16).fill(null);
  crowns[0] = 'the-windfall';                   // a Crown
  crowns[1] = 'the-desert';                     // a plain card for contact
  const ac = C.legalCells(boardState(crowns), 'ace-of-moons');
  check(!ac.includes(4), 'no Ace straight next to a Crown');
  check(ac.includes(5), 'the Ace may sit diagonal to the Crown');
  check(ac.includes(2), 'the Ace may sit next to the plain card');
  const plain = C.legalCells(boardState(crowns), 'the-sailor');
  check(plain.includes(4) && plain.includes(5), 'a plain card may sit next to a Crown');
  const twoCrowns = Array(16).fill(null);
  twoCrowns[0] = 'the-windfall';
  twoCrowns[1] = 'the-desert';
  twoCrowns[5] = 'the-sea';                     // a second Crown, diagonal to the first
  const bard = C.legalCells(boardState(twoCrowns), 'the-bard');
  check(!bard.includes(4), 'no Crown straight next to another Crown');
  check(bard.includes(2), 'a Crown may sit diagonal to a Crown (by the plain card)');
}

/* ---- payment: chips must come from one suit of the card ---- */
{
  const st = boardState(Array(16).fill(null));
  check(C.payment(st, 'ace-of-suns', 2).suit === 'suns', 'a single-suit card pays in its suit');
  check(C.payment(st, 'ace-of-suns', 0).suit === null, 'free costs nothing');
  const dry = boardState(Array(16).fill(null), { suns: 1 });
  check(C.payment(dry, 'ace-of-suns', 2) === null, 'one chip cannot pay a cost of two');
  const split = boardState(Array(16).fill(null), { moons: 1, crowns: 1 });
  check(C.payment(split, 'the-author', 2) === null,
    'a cost-2 card needs 2 chips of ONE of its suits, not one of each');
  check(C.payment(split, 'the-author', 1) !== null, 'a cost-1 card pays with either suit');
  const both = boardState(Array(16).fill(null), { moons: 2, crowns: 4 });
  check(C.payment(both, 'the-author', 2).suit === 'moons', 'the first suit with enough chips pays');
}

/* ---- buying: pay, place, refill ---- */
{
  // The wiki's refill, example 1: nothing matches the drawn Ace of Leaves,
  // so the market does not change — the Ace lands in the leftmost place.
  const st = boardState(Array(16).fill(null), {}, {
    market: ['the-desert', 'the-cave', 'the-forest'],
    deck: ['ace-of-leaves', 'the-bard'],
  });
  const next = C.buy(st, 2, 0);                 // right card: the Forest, free
  check(next.tableau[0] === 'the-forest', 'the bought card is placed');
  check(next.chips.leaves === 4 && next.chips.moons === 4, 'a free card spends no chips');
  check(next.market.join() === 'ace-of-leaves,the-desert,the-cave',
    `example 1 refill: ${next.market}`);
  check(next.deck.join() === 'the-bard', 'one card was drawn');
  check(next.moves === 1 && next.over === null, 'one turn, still playing');
  check(st.tableau[0] === null, 'the original state is untouched');
  sameCards(st, next, 'after example 1');

  const left = C.buy(next, 0, 1);               // left: ace-of-leaves, costs 2 leaves
  check(left.chips.leaves === 2, `two leaf chips spent: ${left.chips.leaves} left`);
  check(left.tableau[1] === 'ace-of-leaves', 'the Ace was placed next to the Forest');
  check(left.deck.length === 0, 'the last card was drawn');
  check(left.market.join() === ',the-bard,the-cave' || left.market[1] === 'the-bard',
    `market after the paid buy: ${left.market}`);
  sameCards(next, left, 'after a paid buy');
}

/* ---- refill: the rules' own examples ---- */
{
  // Example 2: a Wyrm/Knot card drawn against a Wyrm card and a Knot card
  // discards both; it lands rightmost, then two draws fill centre and left.
  const st = boardState(Array(16).fill(null), {}, {
    market: [null, 'the-soldier', 'the-cave'], // soldier: daemons+crowns, cave: waves+daemons
    deck: ['the-betrayal', 'the-desert', 'the-journey'],  // betrayal: daemons+crowns
  });
  C.refill(st);
  check(st.trash.sort().join() === ['the-cave', 'the-soldier'].sort().join(),
    `both matching cards discarded: ${st.trash}`);
  check(st.market.join() === 'the-journey,the-desert,the-betrayal',
    `example 2 refill: ${st.market}`);
  check(st.deck.length === 0, 'three cards were drawn');

  // Example 3: a Wyrm/Leaves card discards only the Wyrm card; it lands in
  // the middle, and the next draw fills the left.
  const st3 = boardState(Array(16).fill(null), {}, {
    market: [null, 'the-cave', 'the-journey'],  // cave: waves+daemons; journey: moons+waves
    deck: ['the-savage', 'the-bard'],           // savage: leaves+daemons
  });
  C.refill(st3);
  check(st3.trash.join() === 'the-cave', `only the matching card discarded: ${st3.trash}`);
  check(st3.market.join() === 'the-bard,the-savage,the-journey',
    `example 3 refill: ${st3.market}`);

  // Only the first drawn card removes market cards.
  const firstOnly = boardState(Array(16).fill(null), {}, {
    market: [null, 'the-cave', 'the-journey'],
    deck: ['the-savage', 'the-market'],          // market: leaves+crowns — matches the Savage
  });
  C.refill(firstOnly);
  check(firstOnly.trash.join() === 'the-cave', 'the second draw removed nothing');
  check(firstOnly.market.join() === 'the-market,the-savage,the-journey',
    `no second-pass discards: ${firstOnly.market}`);

  // An empty deck leaves the market short but right-packed.
  const dry = boardState(Array(16).fill(null), {}, {
    market: [null, 'the-cave', null],
    deck: ['the-market'],
  });
  C.refill(dry);
  check(dry.market[1] === 'the-market' && dry.market[2] === 'the-cave', `dry refill: ${dry.market}`);
  check(C.COST[1] === 1, 'costs follow positions, not cards');
}

/* ---- illegal buys throw ---- */
{
  const st = boardState(Array(16).fill(null), { waves: 0, leaves: 0 }, {
    market: ['ace-of-moons', 'the-sailor', 'the-desert'],
    deck: ['the-bard'],
  });
  throws(() => C.buy(st, 3, 0), 'a bad market slot');
  throws(() => C.buy(st, 0, -1), 'a bad tableau square');
  const err1 = throws(() => C.buy(st, 1, 0), 'cannot afford the middle card with no chips of its suits');
  check(err1.message.includes('costs 1 chip'), `message: ${err1.message}`);

  const full = boardState(Array(16).fill(null), {}, {
    market: ['the-desert', 'the-sailor', 'the-battle'],
    deck: ['the-bard', 'the-cave'],
  });
  const placed = C.buy(full, 2, 5);              // battle (daemons+crowns), free, cell 5
  check(placed.tableau[5] === 'the-battle', 'the battle was placed');
  throws(() => C.buy(placed, 0, 5), 'that square is taken');
  throws(() => C.buy(placed, 0, 15), 'a far square: must touch the tableau');

  const crownGrid = Array(16).fill(null);
  crownGrid[5] = 'the-windfall';
  const crownState = boardState(crownGrid, {}, {
    market: ['ace-of-moons', 'the-sailor', 'the-battle'],
    deck: ['the-bard'],
  });
  const err = throws(() => C.buy(crownState, 0, 6), 'an Ace straight next to a Crown');
  check(err.message.includes('Ace or Crown'), `message: ${err.message}`);
  throws(() => C.buy({ ...st, over: 'done' }, 2, 0), 'buying after the game is over');
}

/* ---- discarding the market row ---- */
{
  const st = boardState(Array(16).fill(null), {}, {
    market: ['the-desert', 'the-sailor', 'the-battle'],
    deck: ['the-bard', 'the-cave', 'the-end'],
  });
  const next = C.discardRow(st);
  check(next.rowDiscards === 1, 'one row discard counted');
  check(next.trash.length === 3, 'the three cards are gone for good');
  check(next.market.join() === 'the-end,the-cave,the-bard',
    `the market refills after a discard: ${next.market}`);
  check(next.lastNote.includes('−3'), `note: ${next.lastNote}`);
  sameCards(st, next, 'after a voluntary row discard');

  throws(() => C.discardRow({ ...st, over: 'done' }), 'discarding after the game is over');
  throws(() => C.discardRow(boardState(Array(16).fill(null))), 'discarding an empty market');
}

/* ---- the forced row discard: nothing can be bought or placed ---- */
{
  // After this buy, every remaining market card is an Ace or a Crown and the
  // only empty square is ringed by two Crowns — so nothing may legally be
  // placed and the rules force the row away for 3 VP each time.
  const grid = Array(16).fill(null);
  const fillers = BASIC.filter((id) => byId[id].rank !== 1 && byId[id].rank !== 'crown')
    .filter((id) => id !== 'the-desert').slice(0, 12);
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 12, 13].forEach((cell, i) => { grid[cell] = fillers[i]; });
  grid[11] = 'the-windfall';
  grid[14] = 'the-sea';
  const st = boardState(grid, {}, {
    market: ['ace-of-moons', 'the-huntress', 'the-desert'],
    deck: ['the-bard', 'the-end', 'the-calamity'],
  });
  check(C.buyOptions(st).length === 1, 'only the free plain card is buyable');
  const next = C.buy(st, 2, 10);                 // the Desert to the one open square
  check(next.rowDiscards === 2, `two forced row discards: ${next.rowDiscards}`);
  check(next.over === 'done', 'the market ran dry: over');
  check(next.tableau[15] === null, 'no card could be placed on the last square');
  check(next.lastNote.includes('discarded'), `note: ${next.lastNote}`);
}

/* ---- end of game ---- */
{
  const grid = BASIC.slice(0, 15).slice();
  grid.push(null);
  const st = boardState(grid, {}, { market: ['the-discovery'], deck: [] });
  const emptyCell = st.tableau.findIndex((x) => x === null);
  const next = C.buy(st, 0, emptyCell);          // discovery (suns+waves), costs 2
  check(next.over === 'done', 'a full tableau ends the game');
  check(next.tableau.every(Boolean), 'all sixteen squares filled');
  check(next.chips.suns === 2, 'the left card cost two sun chips');

  const last = boardState(Array(16).fill(null), {}, {
    market: [null, null, 'the-desert'], deck: [],
  });
  const done = C.discardRow(last);
  check(done.over === 'done', 'an empty market ends the game');
}

/* ---- scoring: the chain rules ---- */
{
  const grid = Array(16).fill(null);
  grid[0] = 'ace-of-moons'; grid[4] = 'the-journey'; grid[8] = 'the-forest';
  grid[6] = 'the-author';                        // isolated for moons
  const chain = C.longestChain(grid, 'moons');
  check(chain.length === 3, `A-3-5 moons chain ${chain.length}: ${chain.ids}`);
  check(chain.ids.join() === 'ace-of-moons,the-journey,the-forest',
    `ascending with gaps, orthogonally contiguous: ${chain.ids}`);
  check(chain.bonus === 1, 'an Ace-starting chain earns +1');

  const diag = Array(16).fill(null);
  diag[0] = 'ace-of-moons';
  diag[5] = 'the-author';                        // only diagonal to the Ace
  check(C.longestChain(diag, 'moons').length === 1, 'diagonals do not chain');

  const aceCrown = Array(16).fill(null);
  aceCrown[0] = 'ace-of-leaves'; aceCrown[4] = 'the-savage'; aceCrown[8] = 'the-end';
  const ac = C.longestChain(aceCrown, 'leaves');
  check(ac.length === 3 && ac.bonus === 7, `A…C chain bonus ${ac.bonus}, paper says 7`);

  // a dual-suit card belongs to both of its suits' chains
  const dual = Array(16).fill(null);
  dual[0] = 'the-author';                        // 2, moons + crowns
  check(C.longestChain(dual, 'moons').length === 1, 'the Author counts for Moons');
  check(C.longestChain(dual, 'crowns').length === 1, 'the Author counts for Crowns');

  // ties go to the best-scoring chain: painter→battle (0) or painter→Crown (+2)
  const tie = Array(16).fill(null);
  tie[0] = 'the-painter'; tie[1] = 'the-battle'; tie[4] = 'the-windfall';
  const tieChain = C.longestChain(tie, 'crowns');
  check(tieChain.length === 2 && tieChain.ids.join() === 'the-painter,the-windfall',
    `tie-break: ${tieChain.ids}`);
}

/* ---- two finished tableaux, scored on paper ---- */

// Board A: a full 4x4, scored on paper.
//   Moons   A-2-3-4 (row 1)          base 9  +1 Ace           → 10
//   Crowns  painter→windfall (tie)   base 2  +2 Crown          →  4, chips out −5 → −1
//   Leaves  A-3-4                    base 5  +1 Ace           →  6, untouched −5 →  1
//   Suns    longest chain 1                                → −5, untouched −5 → −10
//   Waves   Origin 2→Sailor 4→Discovery 5→{Cave,Darkness}  base 9             →  9
//   Daemons Desert 2→{Savage 3, Cave 7}                    base 2             →  2
//   Paper total: 10 −1 +1 −10 +9 +2 = 11.
const BOARD_A = [
  'ace-of-moons', 'the-author', 'the-journey', 'the-mountain',
  'the-huntress', 'the-battle', 'the-painter', 'the-windfall',
  'ace-of-leaves', 'the-savage', 'the-sailor', 'the-origin',
  'the-desert', 'the-cave', 'the-discovery', 'the-darkness',
];
{
  const st = boardState(BOARD_A, { moons: 2, suns: 4, waves: 3, leaves: 4, daemons: 1, crowns: 0 },
    { over: 'done' });
  const sc = C.score(st);
  const want = { moons: 10, suns: -10, waves: 9, leaves: 1, daemons: 2, crowns: -1 };
  const wantLen = { moons: 4, suns: 1, waves: 4, leaves: 3, daemons: 2, crowns: 2 };
  for (const row of sc.suits) {
    check(row.total === want[row.suit],
      `board A ${row.suit}: ${row.total} (base ${row.base} bonus ${row.bonus} chips ${row.chipPenalty}), paper says ${want[row.suit]}`);
    check(row.length === wantLen[row.suit],
      `board A ${row.suit} chain ${row.length}, paper says ${wantLen[row.suit]}`);
  }
  check(sc.total === 11, `board A total ${sc.total}, paper says 11`);
  check(sc.total === indScore(st), 'board A: the independent scorer agrees');
}

// Board B: another full tableau, ending with two row discards.
//   Moons   A-2-3-4-5-Crown(Huntress)  base 20 +1 +2 +4 = 27, untouched −5 → 22
//   Crowns  painter→Windfall           base 2  +2 Crown                     →  4
//   Suns    painter→Mountain           base 2                                →  2
//   Waves   Sailor→Discovery→{Cave,Darkness} base 5, chips out −5           →  0
//   Leaves  Ace→{3,4,5}                base 2  +1 Ace                       →  3
//   Daemons Desert→{Savage,Cave}       base 2, untouched −5                 → −3
//   Row discards 2: −6.  Paper total: 22+4+2+0+3−3 − 6 = 22.
const BOARD_B = [
  'ace-of-moons', 'the-author', 'the-journey', 'the-battle',
  'the-huntress', 'the-forest', 'the-mountain', 'the-painter',
  'the-savage', 'ace-of-leaves', 'the-sailor', 'the-windfall',
  'the-desert', 'the-cave', 'the-discovery', 'the-darkness',
];
{
  const st = boardState(BOARD_B, { moons: 4, suns: 2, waves: 0, leaves: 3, daemons: 4, crowns: 1 },
    { over: 'done', rowDiscards: 2 });
  const sc = C.score(st);
  const want = { moons: 22, suns: 2, waves: 0, leaves: 3, daemons: -3, crowns: 4 };
  const wantLen = { moons: 6, suns: 2, waves: 3, leaves: 2, daemons: 2, crowns: 2 };
  for (const row of sc.suits) {
    check(row.total === want[row.suit],
      `board B ${row.suit}: ${row.total} (base ${row.base} bonus ${row.bonus} chips ${row.chipPenalty}), paper says ${want[row.suit]}`);
    check(row.length === wantLen[row.suit],
      `board B ${row.suit} chain ${row.length}, paper says ${wantLen[row.suit]}`);
  }
  check(sc.suits.find((r) => r.suit === 'moons').bonus === 7, 'board B moons: Ace…Crown +7');
  check(sc.discardPenalty === 6 && sc.emptyPenalty === 0, 'board B penalties');
  check(sc.total === 22, `board B total ${sc.total}, paper says 22`);
  check(sc.total === indScore(st), 'board B: the independent scorer agrees');
}

/* ---- a half-built tableau scores the empty squares too ---- */
{
  const grid = Array(16).fill(null);
  ['ace-of-moons', 'the-author'].forEach((id, i) => { grid[i] = id; });
  const st = boardState(grid);
  const sc = C.score(st);
  check(sc.empty === 14 && sc.emptyPenalty === 70, `empty squares: ${sc.empty} → −${sc.emptyPenalty}`);
  check(sc.suits.find((r) => r.suit === 'moons').length === 2, 'the partial moons chain scores live');
}

/* ---- full random playouts: a random player always finishes ---- */
let totalScore = 0, wins = 0;
for (let seed = 1; seed <= 300; seed++) {
  let st = C.newGame(seed, BASIC);
  const rng = D_mulberry32(seed * 7919 + 13);
  let guard = 0;
  while (!st.over && guard++ < 120) {
    let next = null;
    const opts = C.buyOptions(st);
    if (!opts.length) {
      next = C.discardRow(st);                   // settle() forces it anyway
    } else if (rng() < 0.06 && st.market.some(Boolean)) {
      next = C.discardRow(st);                   // the voluntary penalty path
    } else {
      const opt = opts[Math.floor(rng() * opts.length)];
      const cell = opt.cells[Math.floor(rng() * opt.cells.length)];
      next = C.buy(st, opt.slot, cell);
    }
    st = next;
    conserved(st, `seed ${seed} move ${st.moves}`);
    const json = JSON.parse(JSON.stringify(st));
    check(json.tableau.length === 16 && json.deck.length === st.deck.length,
      `seed ${seed}: JSON round trip`);
  }
  check(st.over === 'done', `seed ${seed}: game never ended (guard ${guard})`);
  const sc = C.score(st);
  check(sc.total === indScore(st), `seed ${seed}: core ${sc.total} != independent ${indScore(st)}`);
  if (sc.total >= C.WIN) wins++;
  totalScore += sc.total;
}
console.log(`random playouts: 300/300 finished, average score ${(totalScore / 300).toFixed(1)}, ${wins} wins`);

console.log(failures === 0 ? 'aucteraden: all tests passed' : `aucteraden: ${failures} failures`);
process.exit(failures ? 1 : 0);
