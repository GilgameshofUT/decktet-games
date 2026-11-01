// Headless tests for Myrmex: node test/myrmex.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mulberry32 as D_mulberry32 } from '../web/js/decktet.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'web/cards/manifest.json'), 'utf8'));
const byId = Object.fromEntries(manifest.cards.map((c) => [c.id, c]));

const C = await import('../web/js/games/myrmex-core.js');
C.init(byId);

const DATA = manifest;                    // { basicDeck, extendedDeck, byId-less }
const bc = (id) => byId[String(id).split('#')[0]];   // instance id → card
const orderOf = C.orderOf;
let failures = 0;
const check = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } };

const allCards = (st) => [
  ...st.stock,
  ...st.chambers.flatMap((c) => c.cards),
  ...st.piles.flatMap((p) => [...p.down, ...p.up]),
];

function conserved(st, size, label) {
  const all = allCards(st);
  if (all.length !== size) { check(false, `${label}: ${all.length} cards, want ${size}`); return; }
  if (new Set(all).size !== size) check(false, `${label}: duplicate or missing card`);
}

/** For hand-built partial states: no card may appear twice. */
function distinct(state) {
  const all = allCards(state);
  check(new Set(all).size === all.length, 'duplicate card in a hand-built state');
}

/* ---- deck building for the three levels ---- */
{
  const minor = C.buildDeck(DATA, 'minor');
  check(minor.length === 60 && new Set(minor).size === 60, `minor deck ${minor.length}`);
  check(minor.filter((id) => bc(id).rank === 1).length === 6, 'six Aces');
  check(minor.filter((id) => bc(id).rank === 'crown').length === 6, 'six Crowns');
  check(minor.filter((id) => bc(id).rank >= 2).length === 48, '48 numbered cards');
  check(minor.includes('the-author') && minor.includes('the-author#2'),
    'numbered cards appear as two instances');
  check(!minor.some((id) => id.includes('the-light-keeper')), 'no Light Keeper in the minor deck');
  check(!minor.some((id) => bc(id).rank === 'pawn'), 'no Pawns in the minor deck');

  const major = C.buildDeck(DATA, 'major');
  check(major.length === 66 && new Set(major).size === 66, `major deck ${major.length}`);
  for (const p of ['the-borderland', 'the-harvest', 'the-watchman']) {
    check(major.includes(p) && major.includes(p + '#2'), `major adds both ${p}`);
  }
  check(!major.some((id) => id.includes('the-light-keeper')), 'Major Worker drops both Light Keepers');
  check(!major.some((id) => id.includes('the-rite')), 'no Courts at Major Worker level');

  const queen = C.buildDeck(DATA, 'queen');
  check(queen.length === 72 && new Set(queen).size === 72, `queen deck ${queen.length}`);
  for (const c of ['the-consul', 'the-island', 'the-window']) {
    check(queen.includes(c) && queen.includes(c + '#2'), `queen adds both ${c}`);
  }
  check(!queen.some((id) => id.includes('the-rite')), 'Queen level drops both Rites');
  check(!queen.some((id) => id.includes('the-light-keeper')), 'Queen level drops both Light Keepers');
}

/* ---- rank order ---- */
{
  const find = (pred) => Object.keys(byId).find(pred);
  check(C.orderOf(find((k) => byId[k].rank === 1)) === 1, 'Ace is 1');
  check(C.orderOf(find((k) => byId[k].rank === 9)) === 9, '9 is 9');
  check(C.orderOf(find((k) => byId[k].rank === 'crown')) === 10, 'Crown is 10');
  check(C.orderOf(find((k) => byId[k].rank === 'pawn')) === 11, 'Pawn is 11');
  check(C.orderOf(find((k) => byId[k].rank === 'court')) === 12, 'Court is 12');
  check(C.orderOf('the-author#2') === 2, 'instance ids resolve through baseId');
}

/* ---- setup invariants over 500 seeds x 3 levels (+ Larval Stage) ---- */
for (let seed = 1; seed <= 500; seed++) {
  for (const [level, size, stock] of [['minor', 60, 28], ['major', 66, 28], ['queen', 72, 40]]) {
    const st = C.newGame(seed, DATA, level);
    check(st.piles.length === 8, `seed ${seed} ${level}: ${st.piles.length} piles`);
    check(st.stock.length === stock, `seed ${seed} ${level}: stock ${st.stock.length}, want ${stock}`);
    check(st.chambers.length === 0 && st.moves === 0 && st.deals === 0 && st.over === null,
      `seed ${seed} ${level}: bad start flags`);
    if (level === 'minor') {
      check(st.piles.every((p) => p.down.length === 3 && p.up.length === 1),
        `seed ${seed} minor: closed deal shape`);
      check(C.faceDown(st) === 24, `seed ${seed} minor: ${C.faceDown(st)} face down`);
    } else if (level === 'major') {
      check(st.piles.slice(0, 6).every((p) => p.down.length === 0 && p.up.length === 5) &&
        st.piles.slice(6).every((p) => p.down.length === 0 && p.up.length === 4),
        `seed ${seed} major: 38-card open deal shape`);
      check(C.faceDown(st) === 0, `seed ${seed} major: face up by rule`);
    } else {
      check(st.piles.every((p) => p.down.length === 0 && p.up.length === 4),
        `seed ${seed} queen: 32-card open deal shape`);
    }
    conserved(st, size, `seed ${seed} ${level}`);
    const json = JSON.parse(JSON.stringify(st));
    check(json.piles.length === 8 && json.stock.length === stock,
      `seed ${seed} ${level}: JSON round trip`);
  }
  const larval = C.newGame(seed, DATA, 'minor', true);
  check(larval.piles.every((p) => p.down.length === 0 && p.up.length === 4),
    `seed ${seed} larval: face-up deal`);
  conserved(larval, 60, `seed ${seed} larval`);
}

/* ---- hand-built tableau helpers ---- */
const P = (down, up) => ({ down: down.slice(), up: up.slice() });
const stOf = (piles, stock = [], extra = {}) => ({
  seed: 0, level: 'minor', larval: false,
  piles: Array.from({ length: 8 }, (_, i) => piles[i] || P([], [])),
  stock: stock.slice(), chambers: [], moves: 0, deals: 0, over: null, ...extra,
});
const id = (base) => base;               // first instance
// suns run, Crown (10) first, Ace last
const SUNS = ['the-bard', 'the-pact', 'the-diplomat', 'the-castle', 'the-penitent',
  'the-discovery', 'the-mountain', 'the-painter', 'the-desert', 'ace-of-suns'];

/* ---- single-card moves: any suit onto the next rank up ---- */
{
  const st = stOf({ 0: P([], ['the-castle']), 1: P([], ['the-mountain']) });   // 7 onto 4? no
  check(!C.canMove(st, 0, 1), '7 may not move onto 4');
  const ok = stOf({ 0: P([], ['the-desert']), 1: P([], ['the-castle']) });     // 2 onto 7? no
  check(!C.canMove(ok, 0, 1), '2 may not move onto 7');
  const s2 = stOf({ 0: P([], ['the-painter']), 1: P([], ['the-castle']) });    // 3 onto 7? no
  check(!C.canMove(s2, 0, 1), '3 may not move onto 7');
  const s3 = stOf({ 0: P([], ['the-mountain']), 1: P([], ['the-castle']) });   // 4 onto 7? no
  check(!C.canMove(s3, 0, 1), '4 may not move onto 7');
  const s4 = stOf({ 0: P([], ['the-desert']), 1: P([], ['the-painter']) });    // 2 onto 3: yes, suits differ
  check(C.canMove(s4, 0, 1), 'any 2 may move onto any 3');
  const s5 = stOf({ 0: P([], ['ace-of-suns']), 1: P([], ['the-desert']) });    // Ace onto 2
  check(C.canMove(s5, 0, 1), 'an Ace may move onto a 2');
  const s6 = stOf({ 0: P([], ['the-pact']), 1: P([], ['the-bard']) });         // 9 onto a Crown
  check(C.canMove(s6, 0, 1), 'a 9 may move onto a Crown');
  const s7 = stOf({ 0: P([], ['the-bard']), 1: P([], ['the-pact']) });         // Crown onto 9: no
  check(!C.canMove(s7, 0, 1), 'a Crown may not move onto a 9');
}

/* ---- groups: consecutive, descending, one shared suit ---- */
{
  const st = stOf({
    0: P([], ['the-castle', 'the-penitent', 'the-discovery']),   // 7-6-5 of Suns on top
    1: P([], ['the-diplomat']),                                  // an 8 (moons/suns)
  });
  check(C.legalRuns(st, 0).join() === '1,2,3', 'the 7-6-5 Suns run is movable as a group');
  check(C.canMove(st, 0, 1, 3), 'the group may move onto any 8');
  const next = C.applyMove(st, 0, 1, 3);
  check(next.piles[1].up.join() === ['the-diplomat', 'the-castle', 'the-penitent', 'the-discovery'].join(),
    'the group landed in order');
  check(next.moves === 1, 'move counted');
  check(st.piles[0].up.length === 3, 'the original state was not mutated');
  distinct(next);

  // A group whose cards share no suit may not travel together.
  const mismatch = stOf({
    0: P([], ['the-castle', 'the-desert']),                      // 7 suns/crowns, 2 suns/daemons: rank gap
    1: P([], []),
  });
  check(C.legalRuns(mismatch, 0).join() === '1', 'a 7-…-2 pile is not a run');
  check(C.commonSuits(['the-castle', 'the-soldier']).length > 0, 'castle/soldier share crowns');
  check(C.commonSuits(['the-castle', 'the-origin']).length === 0, 'castle/origin share no suit');
  const disjoint = stOf({ 0: P([], ['the-castle', 'the-origin']), 1: P([], []) });
  check(C.legalRuns(disjoint, 0).join() === '1', 'a two-card group with no shared suit cannot travel together');
}

/* ---- into an empty pile, and the illegal moves ---- */
{
  const st = stOf({ 0: P(['the-mountain'], ['the-castle', 'the-penitent']), 1: P([], []) });
  check(C.canMove(st, 0, 1, 1), 'a single card may fill a void');
  check(C.canMove(st, 0, 1, 2), 'a run may fill a void regardless of the destination rank');
  const next = C.applyMove(st, 0, 1, 2);
  check(next.piles[1].up.join() === ['the-castle', 'the-penitent'].join(),
    'the run relocated');
  check(next.piles[0].up.join() === 'the-mountain' && next.piles[0].down.length === 0,
    'the emptied source flipped its face-down card up');
  distinct(next);

  const throwsList = [
    () => C.applyMove(st, 0, 0, 1),                       // onto itself
    () => C.applyMove(st, 2, 1, 1),                       // empty source
    () => C.applyMove(st, 0, 1, 9),                       // depth beyond the pile
    () => C.applyMove(st, 9, 1, 1),                       // bad pile index
  ];
  throwsList.forEach((fn, i) => {
    let threw = false;
    try { fn(); } catch { threw = true; }
    check(threw, `illegal move #${i + 1} throws`);
  });
  const bad = stOf({ 0: P([], ['the-castle']), 1: P([], ['the-mountain']) });   // 7 onto 4
  let msg = '';
  try { C.applyMove(bad, 0, 1, 1); } catch (e) { msg = e.message; }
  check(/one rank higher/.test(msg), `rank refusal explains itself: "${msg}"`);
  const badRun = stOf({ 0: P([], ['the-castle', 'the-mountain']), 1: P([], []) });
  msg = '';
  try { C.applyMove(badRun, 0, 1, 2); } catch (e) { msg = e.message; }
  check(/consecutive/.test(msg), `run refusal explains itself: "${msg}"`);
}

/* ---- pawns and courts in the tougher levels ---- */
{
  // A Pawn sits above the Crown: a Crown may move onto a Pawn, a Pawn onto a Court.
  const st = stOf({ 0: P([], ['the-watchman']), 1: P([], ['the-bard']) });
  check(!C.canMove(st, 0, 1), 'a Pawn may not move onto a Crown');
  check(C.canMove(st, 1, 0), 'a Crown may move onto a Pawn');
  const st2 = stOf({ 0: P([], ['the-consul']), 1: P([], ['the-harvest']) });
  check(C.canMove(st2, 1, 0), 'a Pawn may move onto a Court');
  check(!C.canMove(st2, 0, 1), 'a Court may not move onto a Pawn');
}

/* ---- chambers ---- */
{
  // Completing the run removes the ten cards as one chamber.
  const partial = stOf({
    0: P([], SUNS.slice(0, 9)),                               // Crown … 2 of Suns
    1: P(['the-sea'], ['ace-of-suns']),
  });
  check(partial.chambers.length === 0, 'nothing completed yet');
  const next = C.applyMove(partial, 1, 0, 1);
  check(next.chambers.length === 1, 'one chamber completed');
  check(next.chambers[0].suit === 'suns', 'the chamber is of Suns');
  check(next.chambers[0].cards.join() === SUNS.join(), 'the chamber holds the Crown…Ace run');
  check(next.piles[0].up.length === 0 && next.piles[0].down.length === 0,
    'the emptied pile is bare');
  check(next.piles[1].up.join() === 'the-sea', 'the buried card was flipped up');
  distinct(next);

  // A gap stops it: same ranks, one card swapped for a non-Suns 5.
  const gap = stOf({ 0: P([], SUNS.slice(0, 9)), 1: P([], ['ace-of-crowns']) });
  const gapNext = C.applyMove(gap, 1, 0, 1);
  check(gapNext.chambers.length === 0, 'an Ace of Crowns breaks the suit: no chamber');

  // A sequence buried under more cards only loses its top ten.
  const buried = stOf({ 0: P([], ['the-origin', ...SUNS]) });
  const buriedNext = C.settle(structuredClone(buried));
  check(buriedNext.chambers.length === 1, 'buried cards below the run stay put');
  check(buriedNext.piles[0].up.join() === 'the-origin', 'only the top ten left');

  // Two stacked runs are both claimed in one settle.
  const double = stOf({ 0: P([], [...SUNS, ...SUNS.map((x) => x + '#2')]) });
  const doubleNext = C.settle(structuredClone(double));
  check(doubleNext.chambers.length === 2, 'two chambers from one pile');
  check(doubleNext.piles[0].up.length === 0, 'the pile is bare');
  distinct(doubleNext);
}

/* ---- winning: the sixth chamber ---- */
{
  const used = new Set();
  const ladder = (suit) => {
    const pick = (pred) => {
      for (const base of C.buildDeck(DATA, 'minor')) {
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

  const chambers = Object.entries(ladders)
    .filter(([s]) => s !== 'suns')
    .map(([suit, ids]) => ({ suit, cards: ids }));
  check(chambers.length === 5, 'five chambers pre-filled');
  const suns = ladders.suns;                                  // [Ace, 2, …, Crown]
  const st = stOf({
    0: P([], suns.slice(1).reverse()),                        // Crown … 2, Ace to come
    1: P([], [suns[0]]),
  }, [], { chambers });
  conserved(st, 60, 'pre-win');
  const next = C.applyMove(st, 1, 0, 1);
  check(next.over === 'won', `over = ${next.over}`);
  check(next.chambers.length === 6, 'six chambers is the win');
  check(C.cardsUp(next) === 60, 'every card is either played or chambered');
  conserved(next, 60, 'won state');
}

/* ---- losing: stock spent, no moves left ---- */
{
  const four = ['the-mountain', 'the-mountain#2', 'the-sailor', 'the-sailor#2',
    'the-battle', 'the-battle#2'];
  const six = ['the-lunatic', 'the-lunatic#2'];
  const buriedCards = ['ace-of-moons', 'ace-of-suns', 'ace-of-waves',
    'ace-of-leaves', 'ace-of-daemons', 'ace-of-crowns', 'the-bard', 'the-sea'];
  const piles = {};
  [...four, ...six].forEach((x, i) => { piles[i] = P([buriedCards[i]], [x]); });
  const st = stOf(piles);
  check(C.legalMoves(st).length === 0, 'a 4/4/4/4/4/4/6/6 tableau has no legal move');
  C.settle(st);
  check(st.over === 'lost', `over = ${st.over}`);

  // With cards still in the draw pile the game is not over — the deal is the move.
  const st2 = stOf(piles, ['the-end']);
  C.settle(st2);
  check(st2.over === null, 'a spent tableau with cards to deal is still live');
}

/* ---- over fires through applyMove and applyDeal, not just settle ---- */
{
  // One legal move left, and it leaves a stalemate with no empty pile: lost.
  const st = stOf({
    0: P([], ['the-lunatic']),                                 // a 6
    1: P([], ['the-betrayal', 'the-discovery']),               // an 8 with a 5 on top
    2: P([], ['the-origin']),                                  // a 2
    3: P([], ['the-diplomat']),                                // an 8
    4: P([], ['the-bard']),                                    // a Crown
    5: P([], ['the-author']),                                  // a 2
    6: P([], ['the-mill']),                                    // an 8
    7: P([], ['the-end']),                                     // a Crown
  }, []);
  check(C.legalMoves(st).length === 1, 'exactly one move remains');
  const next = C.applyMove(st, 1, 0, 1);                        // the 5 onto the 6
  check(next.over === 'lost', `the stalemate after the move reads over = ${next.over}`);

  // A restock that lands eight unplayable cards ends the game too.
  const dealSt = stOf({
    0: P(['ace-of-moons'], []), 1: P(['ace-of-suns'], []), 2: P(['ace-of-waves'], []),
    3: P(['ace-of-leaves'], []), 4: P(['ace-of-daemons'], []), 5: P(['ace-of-crowns'], []),
    6: P(['the-bard'], []), 7: P(['the-sea'], []),
  }, ['the-mountain', 'the-mountain#2', 'the-sailor', 'the-sailor#2',
    'the-battle', 'the-battle#2', 'the-lunatic', 'the-lunatic#2']);
  const dealt = C.applyDeal(dealSt);
  check(dealt.stock.length === 0, 'the deal spent the draw pile');
  check(C.legalMoves(dealt).length === 0, 'the dealt tops 4/4/4/4/4/4/6/6 have no move');
  check(dealt.over === 'lost', `the restock reads over = ${dealt.over}`);
}

/* ---- restocking ---- */
{
  const full = C.newGame(7, DATA, 'minor');
  const next = C.applyDeal(full);
  check(next.deals === 1 && next.stock.length === 20, 'the first restock deals 8 of 28');
  check(next.piles.every((p) => p.up.length === 2), 'one new card face up on each pile');
  conserved(next, 60, 'after a restock');

  let part = next;
  while (part.stock.length >= 8) part = C.applyDeal(part);
  check(part.stock.length === 4, `${part.stock.length} cards left for the final deal`);
  part = C.applyDeal(part);
  check(part.stock.length === 0 && part.deals === 4,
    'the final restock is a partial deal of 4 to the first four piles');
  check(part.piles.slice(0, 4).every((p) => p.up.length === 5) &&
    part.piles.slice(4).every((p) => p.up.length === 4),
    'only the first four piles were restocked');
  conserved(part, 60, 'after the final deal');

  let threw = false;
  try { C.applyDeal(part); } catch { threw = true; }
  check(threw, 'dealing from an empty draw pile throws');

  const hole = stOf({ 3: P([], ['the-mountain']) }, ['the-sea']);
  threw = false;
  try { C.applyDeal(hole); } catch (e) { threw = /empty pile/.test(e.message); }
  check(threw, 'restocking with an empty pile throws');

  // The Queen level's 40-card stock: 4 deals of 8 then a partial 8.
  let q = C.newGame(11, DATA, 'queen');
  const counts = [];
  while (C.canDeal(q)) { counts.push(q.stock.length); q = C.applyDeal(q); }
  check(counts.join() === [40, 32, 24, 16, 8].join(), `queen deal sizes ${counts.join()}`);
  conserved(q, 72, 'queen stock spent');
}

/* ---- full random playouts ---- */
/* A seeded scripted player: it prefers revealing face-down cards and landing
 * same-suit, deals when it has gone a while without progress, and refuses to
 * repeat a position it has already seen.  Myrmex (like Spider) can loop
 * forever in principle — an empty pile always offers some move — so the
 * script also resigns when it stagnates.  Every game therefore terminates;
 * every game that reaches a real `over` must satisfy its own end condition
 * exactly.  Reaching `over` from the public API is pinned down separately by
 * the hand-built fixtures above and below. */
function keyOf(st) {
  return st.piles.map((p) => (p.up.length ? p.up[p.up.length - 1] : '-') +
    `/${p.up.length}/${p.down.length}`).join('|') + `#${st.stock.length}#${st.chambers.length}`;
}

function playout(seed, level, maxMoves = 2500) {
  let st = C.newGame(seed, DATA, level);
  const rng = D_mulberry32(seed * 7919 + 13);
  const seen = new Set([keyOf(st)]);
  const fd0 = C.faceDown(st);
  let progress = st.chambers.length * 10 + (fd0 - C.faceDown(st));
  let since = 0;
  let resigned = false;
  let guard = 0;
  while (!st.over && guard++ < maxMoves) {
    const scored = C.legalMoves(st).map((m) => {
      const dst = st.piles[m.to];
      const src = st.piles[m.from];
      const bottom = src.up[src.up.length - m.depth];
      let s = rng() * 0.5;
      if (src.down.length) s += 8;                                           // reveals a card
      if (dst.up.length && C.commonSuits([dst.up[dst.up.length - 1], bottom]).length) s += 5;
      if (orderOf(bottom) === 1 && dst.up.length && orderOf(dst.up[dst.up.length - 1]) === 2 &&
        C.commonSuits([dst.up[dst.up.length - 1], bottom]).length) s += 50;  // the closing link
      if (!dst.up.length) s -= 3;                                            // avoid voids
      if (m.depth > 1) s += 1;                                               // ships a built run
      const below = src.up[src.up.length - m.depth - 1];                     // what the run leaves
      if (below && orderOf(below) === orderOf(bottom) + 1 &&
        C.commonSuits([below, bottom]).length) s -= 2;                       // splits a longer run
      return { m, s };
    });
    scored.sort((a, b) => b.s - a.s);
    let done = false;
    for (const { m } of scored) {
      const next = C.applyMove(st, m.from, m.to, m.depth);
      const k = keyOf(next);
      if (!seen.has(k)) {
        seen.add(k); st = next; done = true;
        conserved(next, C.deckSize(level), `seed ${seed} move ${st.moves}`);
        break;
      }
    }
    if (!done && since >= 5 && C.canDeal(st)) {
      const next = C.applyDeal(st);
      const k = keyOf(next);
      if (!seen.has(k)) {
        seen.add(k); st = next; done = true;
        conserved(next, C.deckSize(level), `seed ${seed} deal ${st.deals}`);
      }
    }
    const now = st.chambers.length * 10 + (fd0 - C.faceDown(st));
    if (now !== progress) { progress = now; since = 0; } else since += 1;
    if (since >= 20) { resigned = true; break; }                             // give up, spider-style
  }
  return { st, resigned, guard };
}

let won = 0, lost = 0, resigned = 0, chamberTotal = 0;
for (let seed = 1; seed <= 300; seed++) {
  const { st, resigned: rs } = playout(seed, 'minor');
  if (rs) resigned++;
  else if (st.over === 'won') won++;
  else if (st.over === 'lost') lost++;
  else check(false, `seed ${seed}: neither over nor resigned (guard hit?)`);

  // Every finished game must satisfy its own end condition, and every chamber
  // must be a genuine single-suit Crown…Ace run, disjoint from the table.
  if (st.over) {
    if (st.over === 'won') check(st.chambers.length === 6, `seed ${seed}: won with ${st.chambers.length} chambers`);
    else {
      check(!st.stock.length, `seed ${seed}: lost with ${st.stock.length} cards in the draw pile`);
      check(C.legalMoves(st).length === 0, `seed ${seed}: lost with legal moves left`);
    }
  }
  const table = new Set([
    ...st.stock,
    ...st.piles.flatMap((p) => [...p.down, ...p.up]),
  ]);
  for (const ch of st.chambers) {
    check(ch.cards.length === 10, `seed ${seed}: chamber of ${ch.cards.length} cards`);
    check(ch.cards.every((x) => !table.has(x)), `seed ${seed}: chamber card still on the table`);
    check(new Set(ch.cards).size === 10, `seed ${seed}: duplicate card in a chamber`);
    ch.cards.forEach((x, i) => check(orderOf(x) === 10 - i,
      `seed ${seed}: chamber rank ${orderOf(x)} at slot ${i}`));
    check(C.commonSuits(ch.cards).includes(ch.suit), `seed ${seed}: chamber suit mismatch`);
  }
  conserved(st, 60, `seed ${seed} final`);
  chamberTotal += st.chambers.length;
  const json = JSON.parse(JSON.stringify(st));
  check(json.chambers.length === st.chambers.length, `seed ${seed}: JSON round trip`);
}
console.log(`random playouts (minor): ${won} won, ${lost} lost, ${resigned} resigned, ` +
  `avg chambers ${(chamberTotal / 300).toFixed(2)}`);
check(won + lost + resigned === 300, 'every minor playout terminated');

/* the tougher levels also run and terminate */
for (const [level, n] of [['major', 120], ['queen', 120]]) {
  let done = 0;
  for (let seed = 1; seed <= n; seed++) {
    const { st, resigned: rs } = playout(seed, level);
    if (!rs) {
      done++;
      check(st.over === 'won' || st.over === 'lost', `seed ${seed} ${level}: over = ${st.over}`);
    }
    conserved(st, C.deckSize(level), `seed ${seed} ${level} final`);
  }
  console.log(`random playouts (${level}): ${done}/${n} reached a real end, ` +
    `${n - done} resigned; all terminated`);
}

/* ---- JSON round trip of a mid-game state ---- */
{
  let st = C.newGame(99, DATA, 'minor');
  for (let i = 0; i < 25 && !st.over; i++) {
    if (C.canDeal(st) && i % 5 === 4) { st = C.applyDeal(st); continue; }
    const moves = C.legalMoves(st);
    if (!moves.length) break;
    st = C.applyMove(st, moves[0].from, moves[0].to, moves[0].depth);
  }
  const back = JSON.parse(JSON.stringify(st));
  check(C.legalMoves(back).length === C.legalMoves(st).length, 'legal moves differ after round trip');
}

console.log(failures === 0 ? 'myrmex: all tests passed' : `myrmex: ${failures} failures`);
process.exit(failures ? 1 : 0);
