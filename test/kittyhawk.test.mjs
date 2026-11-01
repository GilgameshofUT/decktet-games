// Headless tests for Kittyhawk: node test/kittyhawk.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mulberry32 as D_mulberry32 } from '../web/js/decktet.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'web/cards/manifest.json'), 'utf8'));
const byId = Object.fromEntries(manifest.cards.map((c) => [c.id, c]));

const C = await import('../web/js/games/kittyhawk-core.js');
C.init(byId);

const DATA = manifest;
const bc = (id) => byId[String(id).split('#')[0]];   // instance id → card
let failures = 0;
const check = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } };

const allCards = (st) => [
  ...st.stock,
  ...st.foundations.flat(),
  ...st.tableau.flat(),
  ...st.heaps.flat(),
];

function conserved(st, label) {
  const all = allCards(st);
  if (all.length !== st.total) { check(false, `${label}: ${all.length} cards, want ${st.total}`); return; }
  if (new Set(all).size !== st.total) check(false, `${label}: duplicate or missing card`);
}

/** For hand-built partial states: no card may appear twice. */
function distinct(state) {
  const all = allCards(state);
  check(new Set(all).size === all.length, 'duplicate card in a hand-built state');
}

const orderOf = C.orderOf;

/* ---- deck building per level ---- */
{
  const sizes = { 1: 60, 2: 66, 3: 60, 4: 72, 5: 72 };
  for (const [lvl, size] of Object.entries(sizes)) {
    const d = C.buildDeck(DATA, Number(lvl));
    check(d.length === size && new Set(d).size === size, `level ${lvl} deck ${d.length}, want ${size}`);
    check(d.includes('the-author') && d.includes('the-author#2'),
      `level ${lvl}: numbered cards exist twice`);
  }
  const pawns = ['the-borderland', 'the-harvest', 'the-watchman'];
  for (const lvl of [2, 4, 5]) {
    const d = C.buildDeck(DATA, lvl);
    for (const p of pawns) check(d.includes(p) && d.includes(p + '#2'), `level ${lvl} adds both ${p}`);
    check(!d.some((id) => id.includes('the-light-keeper')), `level ${lvl}: no Light Keeper`);
  }
  check(!C.buildDeck(DATA, 1).some((id) => bc(id).rank === 'pawn'), 'level 1: no Pawns');
  check(!C.buildDeck(DATA, 3).some((id) => bc(id).rank === 'pawn'), 'level 3: no Pawns');
  for (const lvl of [4, 5]) {
    const d = C.buildDeck(DATA, lvl);
    for (const c of ['the-consul', 'the-island', 'the-window']) {
      check(d.includes(c) && d.includes(c + '#2'), `level ${lvl} adds both ${c}`);
    }
    check(!d.some((id) => id.includes('the-rite')), `level ${lvl}: no Rite`);
  }
}

/* ---- rank order ---- */
{
  const find = (pred) => Object.keys(byId).find(pred);
  check(orderOf(find((k) => byId[k].rank === 1)) === 1, 'Ace is 1');
  check(orderOf(find((k) => byId[k].rank === 'crown')) === 10, 'Crown is 10');
  check(orderOf(find((k) => byId[k].rank === 'pawn')) === 11, 'Pawn is 11');
  check(orderOf(find((k) => byId[k].rank === 'court')) === 12, 'Court is 12');
  check(orderOf('the-author#2') === 2, 'instance ids resolve through baseId');
}

/* ---- setup invariants over 500 seeds x 5 levels ---- */
const STOCKS = { 1: 42, 2: 48, 3: 48, 4: 54, 5: 60 };
for (let seed = 1; seed <= 500; seed++) {
  for (const lvl of [1, 2, 3, 4, 5]) {
    const st = C.newGame(seed, DATA, lvl);
    const seeded = lvl !== 3 && lvl !== 5;
    check(st.foundations.length === 6, `seed ${seed} lvl ${lvl}: ${st.foundations.length} foundations`);
    if (seeded) {
      check(st.foundations.every((f, i) => f.length === 1 && f[0] === `ace-of-${C.SUITS[i]}`),
        `seed ${seed} lvl ${lvl}: foundations must start with the six Aces`);
    } else {
      check(st.foundations.every((f) => f.length === 0), `seed ${seed} lvl ${lvl}: foundations start empty`);
    }
    check(st.tableau.length === 6 && st.tableau.every((t) => t.length === 1),
      `seed ${seed} lvl ${lvl}: six single-card tableau piles`);
    check(st.heaps.length === 2 && st.heaps.every((h) => h.length === 3),
      `seed ${seed} lvl ${lvl}: two heaps of three`);
    check(st.stock.length === STOCKS[lvl], `seed ${seed} lvl ${lvl}: stock ${st.stock.length}`);
    check(st.moves === 0 && st.deals === 0 && st.over === null, `seed ${seed} lvl ${lvl}: start flags`);
    conserved(st, `seed ${seed} lvl ${lvl}`);
    const json = JSON.parse(JSON.stringify(st));
    check(json.stock.length === STOCKS[lvl] && json.tableau.length === 6,
      `seed ${seed} lvl ${lvl}: JSON round trip`);
  }
}

/* ---- hand-built state helper ---- */
const stOf = (over = {}) => {
  const st = {
    seed: 0, level: 1, total: 60,
    foundations: [], tableau: [], heaps: [],
    stock: [],
    moves: 0, deals: 0, over: null,
    ...over,
  };
  while (st.foundations.length < 6) st.foundations.push([]);
  while (st.tableau.length < 6) st.tableau.push([]);
  while (st.heaps.length < 2) st.heaps.push([]);
  return st;
};

/* ---- foundations ---- */
{
  // Level 3: any Ace may start any empty foundation, fixing its suit.
  const st = stOf({ level: 3, tableau: [['the-mountain', 'ace-of-moons'], [], [], [], [], []] });
  check(C.canMoveTo(st, 'ace-of-moons', 'foundation', 0), 'an Ace starts an empty foundation');
  check(!C.canMoveTo(st, 'the-mountain', 'foundation', 0), 'only an Ace starts one');
  const next = C.applyMove(st, 'tableau', 0, 'foundation', 2);
  check(next.foundations[2].join() === 'ace-of-moons', 'the Ace landed and fixed the pile to Moons');
  check(C.canMoveTo(next, 'the-author', 'foundation', 2), 'a 2 of Moons may follow its Ace');
  check(!C.canMoveTo(next, 'the-author', 'foundation', 3), 'but not into another empty pile');
  check(next.moves === 1, 'move counted');
  check(st.tableau[0].length === 2, 'the original state was not mutated');
  distinct(next);

  // Rank and suit discipline on seeded foundations.
  const st2 = stOf({ foundations: [['ace-of-moons'], ['ace-of-suns'], [], [], [], []] });
  check(C.canMoveTo(st2, 'the-author', 'foundation', 0), 'the Author (Moons/Crowns) fits the Moons pile');
  check(!C.canMoveTo(st2, 'the-author', 'foundation', 1), 'the Author has no Suns suit');
  check(C.canMoveTo(st2, 'the-desert', 'foundation', 1), 'the Desert (Suns/Daemons) fits the Suns pile');
  check(!C.canMoveTo(st2, 'the-journey', 'foundation', 0), 'a 3 may not start on an Ace');
  check(!C.canMoveTo(st2, 'ace-of-waves', 'foundation', 0), 'a second Ace may not stack on the first');

  // Building up: the pile keeps one suit all the way.
  const built = stOf({ foundations: [['ace-of-moons', 'the-author'], [], [], [], [], []] });
  check(C.canMoveTo(built, 'the-journey', 'foundation', 0), '3 of Moons onto 2 of Moons');
  check(!C.canMoveTo(built, 'the-painter', 'foundation', 0), '3 of Suns/Crowns is not Moons');
  check(!C.canMoveTo(built, 'the-mountain', 'foundation', 0), 'a 4 is two ranks up');
}

/* ---- tableau ---- */
{
  const st = stOf({ tableau: [['the-mountain'], ['the-diplomat'], [], [], [], []] });
  check(!C.canMoveTo(st, 'the-mountain', 'tableau', 1), 'a 4 may not move onto an 8');
  check(C.canMoveTo(st, 'the-painter', 'tableau', 0), '3 (Suns/Crowns) onto 4 (Moons/Suns) via Suns');
  check(!C.canMoveTo(st, 'the-origin', 'tableau', 0), '2 (Waves/Leaves) shares no suit with 4');
  check(C.canMoveTo(st, 'the-mountain', 'tableau', 2), 'any card may fill an empty tableau pile');
  const next = C.applyMove(st, 'tableau', 0, 'tableau', 2);
  check(next.tableau[2].join() === 'the-mountain' && next.tableau[0].length === 0, 'the card moved');
  distinct(next);

  // A valid wiki-style stack: Mill 8 waves/leaves on Merchant 9 leaves/crowns.
  const stack = stOf({ tableau: [['the-merchant'], [], [], [], [], []] });
  check(C.canMoveTo(stack, 'the-mill', 'tableau', 0), '8 (Waves/Leaves) onto 9 (Leaves/Crowns)');
  const stacked = C.applyMove(stack, 'tableau', 0, 'tableau', 1);
  check(stacked.tableau[1].join() === 'the-merchant', 'the 9 moved into the empty pile');
}

/* ---- illegal moves throw, with an explanation ---- */
{
  const st = stOf({
    foundations: [['ace-of-moons', 'the-author'], [], [], [], [], []],
    tableau: [['the-mountain'], ['the-origin'], [], [], [], []],
    heaps: [['the-sea'], ['the-end']],
  });
  const throwsLike = (fn, re, what) => {
    let msg = '';
    try { fn(); } catch (e) { msg = e.message; }
    check(re.test(msg), `${what}: got "${msg}"`);
  };
  throwsLike(() => C.applyMove(st, 'tableau', 0, 'heap', 0), /heaps by dealing/, 'tableau → heap throws');
  throwsLike(() => C.applyMove(st, 'foundation', 0, 'heap', 1), /heaps by dealing/, 'foundation → heap throws');
  throwsLike(() => C.applyMove(st, 'tableau', 1, 'foundation', 0), /destination/, 'wrong rank/suit to a foundation throws');
  throwsLike(() => C.applyMove(st, 'tableau', 0, 'foundation', 1), /destination/, 'Ace pile refuses a stray 4');
  throwsLike(() => C.applyMove(st, 'tableau', 0, 'tableau', 0), /itself/, 'a card may not move onto itself');
  throwsLike(() => C.applyMove(st, 'heap', 0, 'tableau', 0), /destination/, 'a Crown may not move onto a 4');
  throwsLike(() => C.applyMove(st, 'stock', 0, 'tableau', 0), /no top card/, 'the stock has no movable card');
  // Only tops are listed as sources.
  const multi = stOf({ tableau: [['the-origin', 'the-mountain'], [], [], [], [], []] });
  check(!C.legalMoves(multi).some((m) => m.from.kind === 'tableau' && m.from.i === 0 &&
    m.from.id === 'the-origin'), 'buried cards are never legal sources');
}

/* ---- freecell-style backtracking: foundations feed the tableau ---- */
{
  const st = stOf({ foundations: [['ace-of-moons', 'the-author'], [], [], [], [], []] });
  check(C.canMoveTo(st, 'the-author', 'tableau', 0), 'a foundation top may travel to the tableau');
  const next = C.applyMove(st, 'foundation', 0, 'tableau', 3);
  check(next.foundations[0].join() === 'ace-of-moons' && next.tableau[3].join() === 'the-author',
    'the 2 of Moons left the foundation');
  distinct(next);
}

/* ---- heaps and the stock ---- */
{
  const st = stOf({ tableau: [['the-mountain']], heaps: [['the-sea', 'the-painter'], ['the-end']] });
  check(C.canMoveTo(st, 'the-painter', 'tableau', 0), 'the heap top (3 Suns/Crowns) moves onto a 4');
  const next = C.applyMove(st, 'heap', 0, 'tableau', 1);
  check(next.heaps[0].join() === 'the-sea', 'only the heap top moved');
  distinct(next);

  // Dealing: six stock cards, three onto each heap.
  const deal = stOf({ stock: C.buildDeck(DATA, 1).slice(0, 42) });
  const dealt = C.applyDeal(deal);
  check(dealt.deals === 1 && dealt.stock.length === 36, 'the deal took six cards');
  check(dealt.heaps[0].length === 3 && dealt.heaps[1].length === 3, 'three more on each heap');
  let threw = false;
  try { C.applyDeal(stOf({ stock: [] })); } catch (e) { threw = /six/.test(e.message); }
  check(threw, 'dealing from a nearly-empty stock throws');
  threw = false;
  try { C.applyDeal(stOf({ stock: ['a'] })); } catch { threw = true; }
  check(threw, 'a stock with fewer than six cards cannot deal');
}

/* ---- pawns and courts on the high end ---- */
{
  const st = stOf({ tableau: [['the-huntress'], [], [], [], [], []] });    // a Crown of Moons
  check(C.canMoveTo(st, 'the-pact', 'tableau', 0), 'a 9 stacks on a Crown');
  const pawn = stOf({ tableau: [['the-watchman'], [], [], [], [], []] });  // a Pawn
  check(C.canMoveTo(pawn, 'the-huntress', 'tableau', 0), 'a Crown stacks on a Pawn');
  check(!C.canMoveTo(pawn, 'the-pact', 'tableau', 0), 'but a 9 must step through the Crown');
  check(!C.canMoveTo(st, 'the-consul', 'tableau', 0), 'a Court may not sit directly on a 9');
  const court = stOf({ tableau: [['the-consul'], [], [], [], [], []] });
  check(C.canMoveTo(court, 'the-watchman', 'tableau', 0),
    'any Pawn can stack on any Court, suit-wise');
}

/* ---- winning: the last card into the foundations ---- */
{
  const used = new Set();
  const ladder = (suit) => {
    const pick = (pred) => {
      for (const base of C.buildDeck(DATA, 1)) {
        if (used.has(base)) continue;
        if (pred(bc(base))) { used.add(base); return base; }
      }
      throw new Error(`no card for ${suit}`);
    };
    const out = [pick((c) => c.rank === 1 && c.suits.includes(suit))];
    for (let r = 2; r <= 9; r++) out.push(pick((c) => c.rank === r && c.suits.includes(suit)));
    out.push(pick((c) => c.rank === 'crown' && c.suits.includes(suit)));
    return out;
  };
  const ladders = Object.fromEntries(
    ['moons', 'suns', 'waves', 'leaves', 'daemons', 'crowns'].map((s) => [s, ladder(s)])
  );
  check(used.size === 60, `six ladders cover ${used.size} cards`);

  const foundations = C.SUITS.map((s) =>
    (s === 'crowns' ? ladders[s].slice(0, -1) : ladders[s]));      // every ladder save the last Crown
  const last = ladders.crowns[ladders.crowns.length - 1];          // Crown of Crowns
  const st = stOf({ total: 60, foundations, tableau: [[last], [], [], [], [], []] });
  distinct(st);
  const next = C.applyMove(st, 'tableau', 0, 'foundation', 5);
  check(next.over === 'won', `over = ${next.over}`);
  check(C.cardsIn(next) === 60, 'all 60 cards are in the foundations');
  conserved(next, 'won state');

  // …but 59 cards is not a win.
  const almost = stOf({ total: 60, foundations: foundations.slice(1), tableau: [[last], [], [], [], [], []] });
  C.settle(almost);
  check(almost.over === null, 'a missing foundation is not a win');
}

/* ---- losing: nothing moves and the stock is empty ---- */
{
  const threes = ['the-journey', 'the-journey#2', 'the-painter', 'the-painter#2',
    'the-savage', 'the-savage#2'];
  const st = stOf({ level: 3, total: 60, tableau: threes.map((t) => [t]) });
  check(C.legalMoves(st).length === 0, 'six lone 3s have nowhere to go');
  check(!C.canDeal(st), 'an empty stock cannot deal');
  C.settle(st);
  check(st.over === 'lost', `over = ${st.over}`);
  check(C.cardsIn(st) === 0, 'no cards reached a foundation');

  // …but with stock left, dealing is the move.
  const live = stOf({ level: 3, total: 60, tableau: threes.map((t) => [t]), stock: C.buildDeck(DATA, 1).slice(50, 56) });
  C.settle(live);
  check(live.over === null, 'cards in the stock keep the game alive');
}

/* ---- full random playouts ---- */
/* A seeded scripted player: it banks cards on the foundations, thins the
 * heaps, deals when it has gone a while without improving, and refuses to
 * repeat a position it has already seen.  Freecell-style games can loop in
 * principle, so the script also resigns when it stagnates — every game
 * terminates, and every game that reaches a real `over` must satisfy its own
 * end condition exactly.  Reaching `over` from the public API is pinned down
 * separately by the hand-built fixtures above. */
function keyOf(st) {
  const t = (p) => (p.length ? p[p.length - 1] : '-') + '/' + p.length;
  return [
    st.foundations.map(t).join(','),
    st.tableau.map(t).join(','),
    st.heaps.map(t).join(','),
    st.stock.length,
  ].join('#');
}

function playout(seed, level, maxMoves = 3000) {
  let st = C.newGame(seed, DATA, level);
  const rng = D_mulberry32(seed * 7919 + 13);
  const seen = new Set([keyOf(st)]);
  let best = C.cardsIn(st);
  let since = 0;
  let resigned = false;
  let guard = 0;
  while (!st.over && guard++ < maxMoves) {
    const moves = C.legalMoves(st).map((m) => {
      let s = rng() * 0.9;
      if (m.to.kind === 'foundation') s += 6;                       // bank it
      if (m.from.kind === 'foundation') s -= 4;                     // undoing progress
      if (m.to.kind === 'tableau' && !st.tableau[m.to.i].length) s -= 2;
      if (m.from.kind === 'heap') s += 1;                           // thin the heaps
      return { m, s };
    });
    moves.sort((a, b) => b.s - a.s);
    let done = false;
    for (const { m } of moves) {
      const next = C.applyMove(st, m.from.kind, m.from.i, m.to.kind, m.to.i);
      conserved(next, `seed ${seed} move ${st.moves}`);
      const k = keyOf(next);
      if (!seen.has(k)) { seen.add(k); st = next; done = true; break; }
    }
    if (!done && since >= 5 && C.canDeal(st)) {
      const next = C.applyDeal(st);
      conserved(next, `seed ${seed} deal ${st.deals}`);
      const k = keyOf(next);
      if (!seen.has(k)) { seen.add(k); st = next; done = true; }
    }
    if (C.cardsIn(st) > best) { best = C.cardsIn(st); since = 0; } else since += 1;
    if (since >= 40) { resigned = true; break; }                     // give up
  }
  return { st, resigned, guard };
}

let won = 0, lost = 0, resignedCount = 0, foundationTotal = 0;
for (let seed = 1; seed <= 300; seed++) {
  const { st, resigned: rs } = playout(seed, 1);
  if (rs) resignedCount++;
  else if (st.over === 'won') won++;
  else if (st.over === 'lost') lost++;
  else check(false, `seed ${seed}: neither over nor resigned (guard hit?)`);

  if (st.over === 'won') {
    check(C.cardsIn(st) === st.total && !st.stock.length && st.tableau.every((t) => !t.length) &&
      st.heaps.every((h) => !h.length), `seed ${seed}: won but cards remain elsewhere`);
  } else if (st.over === 'lost') {
    check(C.legalMoves(st).length === 0 && !C.canDeal(st), `seed ${seed}: lost with moves left`);
  }
  // Every foundation is a single-suit ladder, Ace up to its current top.
  for (const f of st.foundations) {
    if (!f.length) continue;
    check(bc(f[0]).rank === 1, `seed ${seed}: foundation does not start with an Ace`);
    const suits = bc(f[0]).suits;
    f.forEach((x, i) => {
      check(orderOf(x) === i + 1, `seed ${seed}: foundation rank ${orderOf(x)} at slot ${i}`);
      check(bc(x).suits.some((s) => suits.includes(s)), `seed ${seed}: foundation suit drift`);
    });
  }
  conserved(st, `seed ${seed} final`);
  foundationTotal += C.cardsIn(st);
  const json = JSON.parse(JSON.stringify(st));
  check(json.foundations.length === 6, `seed ${seed}: JSON round trip`);
}
console.log(`random playouts (level 1): ${won} won, ${lost} lost, ${resignedCount} resigned, ` +
  `avg foundations ${(foundationTotal / 300).toFixed(1)}/60`);
check(won + lost + resignedCount === 300, 'every level-1 playout terminated');

/* the other levels also run and terminate */
for (const lvl of [2, 3, 4, 5]) {
  let done = 0;
  for (let seed = 1; seed <= 100; seed++) {
    const { st, resigned: rs } = playout(seed, lvl);
    if (!rs) {
      done++;
      check(st.over === 'won' || st.over === 'lost', `seed ${seed} lvl ${lvl}: over = ${st.over}`);
    }
    conserved(st, `seed ${seed} lvl ${lvl} final`);
  }
  console.log(`random playouts (level ${lvl}): ${done}/100 reached a real end; all terminated`);
}

/* ---- JSON round trip of a mid-game state ---- */
{
  let st = C.newGame(99, DATA, 1);
  for (let i = 0; i < 30 && !st.over; i++) {
    const moves = C.legalMoves(st);
    if (moves.length) {
      const m = moves[i % moves.length];
      st = C.applyMove(st, m.from.kind, m.from.i, m.to.kind, m.to.i);
    } else if (C.canDeal(st)) {
      st = C.applyDeal(st);
    } else break;
  }
  const back = JSON.parse(JSON.stringify(st));
  check(C.legalMoves(back).length === C.legalMoves(st).length, 'legal moves differ after round trip');
}

console.log(failures === 0 ? 'kittyhawk: all tests passed' : `kittyhawk: ${failures} failures`);
process.exit(failures ? 1 : 0);
