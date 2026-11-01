// Headless tests for Wyvern Pass Not: node test/wyvern-pass-not.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mulberry32 as D_mulberry32 } from '../web/js/decktet.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'web/cards/manifest.json'), 'utf8'));
const byId = Object.fromEntries(manifest.cards.map((c) => [c.id, c]));

const C = await import('../web/js/games/wyvern-pass-not-core.js');
C.init(byId);

// The basic game's deck: every card except the Excuse (who is the mage).
const DECK = [...manifest.basicDeck, ...manifest.extendedDeck].filter((id) => id !== C.MAGE);
let failures = 0;
const check = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } };
const throws = (fn, msg) => {
  let t = false;
  try { fn(); } catch { t = true; }
  check(t, msg);
};

function allCards(state) {
  return [...state.deck, ...state.pool, ...state.ring, ...state.discards].filter(Boolean);
}
function conserved(before, after, label) {
  const a = allCards(before).slice().sort().join('|');
  const b = allCards(after).slice().sort().join('|');
  check(a === b, `${label}: cards changed\n  before ${a}\n  after  ${b}`);
  check(new Set(allCards(after)).size === allCards(after).length, `${label}: duplicate card`);
}

function mk(spec = {}) {
  return {
    seed: spec.seed ?? 0,
    deck: spec.deck ?? [],
    pool: spec.pool ?? [],
    poolSize: spec.poolSize ?? (spec.pool ? spec.pool.length : C.START_POOL),
    discards: spec.discards ?? [],
    ring: spec.ring ?? new Array(C.RING_SIZE).fill(null),
    redeals: 0, moves: 0,
    over: spec.over ?? null, lostReason: spec.lostReason ?? null,
  };
}

/** A hand-built state from a partial ring and a pool. */
const table = (ring7, pool, extra = {}) =>
  mk({ ring: [...ring7, ...new Array(C.RING_SIZE - ring7.length).fill(null)], pool, ...extra });

/* ---- setup invariants over 500 seeds ---- */
for (let seed = 1; seed <= 500; seed++) {
  const st = C.newGame(seed, DECK);
  check(DECK.length === 44, `the deck has ${DECK.length} cards`);
  check(st.pool.length === 4 && st.poolSize === 4, `seed ${seed}: pool ${st.pool.length}`);
  check(st.deck.length === 40, `seed ${seed}: deck ${st.deck.length}`);
  check(st.ring.every((id) => id == null), `seed ${seed}: ring not empty`);
  check(allCards(st).length === 44 && new Set(allCards(st)).size === 44,
    `seed ${seed}: ${allCards(st).length} cards, ${new Set(allCards(st)).size} unique`);
  check(!allCards(st).includes(C.MAGE), `seed ${seed}: the Excuse is in play`);
  check(st.moves === 0 && st.over === null, `seed ${seed}: fresh state`);
  const json = JSON.parse(JSON.stringify(st));
  check(json.pool.length === 4 && json.deck.length === 40, `seed ${seed}: JSON round trip`);
}

/* ---- link tokens and options ---- */
check(C.tokens('ace-of-moons').join() === 'moons,moons', 'an ace counts its suit twice');
check(C.tokens('the-end').join() === 'leaves,leaves', 'a crown counts its suit twice');
check(C.tokens('the-author').join() === 'moons,crowns', 'a two-suit card has two tokens');
check(C.tokens('the-borderland').join() === 'waves,leaves,daemons', 'a pawn has three tokens');
check(C.tokens('the-excuse').length === 0, 'the Excuse is the mage, not a link');
check(C.options('ace-of-moons').length === 1, 'an ace links its suit on both sides only');
check(C.options('the-author').length === 2, 'a two-suit card: one order per side');
check(C.options('the-borderland').length === 6, 'a three-suit card: 3×2 orderings');
check(!C.options('the-author').some(([a, b]) => a === b), 'a two-suit card may not spend a suit twice');

/* ---- the hand-built linked ring ---- */
const RING8 = [
  'ace-of-moons',    // moons ×2
  'the-huntress',    // crown of moons ×2
  'the-author',      // moons + crowns
  'ace-of-crowns',   // crowns ×2
  'the-windfall',    // crown of crowns ×2
  'the-painter',     // suns + crowns
  'the-bard',        // crown of suns ×2
  'the-diplomat',    // moons + suns
];
{
  const plan = C.bestPlan(RING8);
  check(plan.count === 8, `the ring links ${plan.count} of 8`);
  check(C.ringIsLinked(RING8), 'every link shares a suit at once');
  check(C.linkCount(RING8) === 8, 'linkCount agrees');
}
{
  const broken = [...RING8.slice(0, 7), 'the-savage'];   // leaves + wyrms: fits nothing here
  check(C.linkCount(broken) === 6, `broken ring keeps ${C.linkCount(broken)} links, want 6`);
  check(!C.ringIsLinked(broken), 'a full ring with a broken link is not protected');
}

/* ---- token spending on paths ---- */
check(C.linkCount(['the-sea', 'the-mill', 'the-end']) === 2,
  'waves then leaves: the mill spends one suit per side');
check(C.linkCount(['the-sea', 'the-mill', 'the-cave']) === 1,
  'the mill already spent waves on the left; the cave gets none');
check(C.linkCount(['ace-of-waves', 'the-mill', 'the-end']) === 2,
  'the ace doubles its suit; the mill links waves in, leaves out');
check(C.linkCount(['the-end', 'the-mill']) === 1, 'a lone pair links');
check(C.linkCount(['the-end', null, 'the-mill', null, null, null, null, null]) === 0,
  'an empty slot breaks adjacency');

/* ---- suit pools and scoring fixtures ---- */

{
  // Fixture: a closed ring of eight, all links shared. 8 links × 6 = 48.
  // Suits in the ring: moons ×3, crowns ×4, suns ×3 — no pool of six.
  const st = mk({ ring: RING8 });
  const s = C.score(st);
  check(s.links === 8 && s.linkPoints === 48, `links ${s.links}, points ${s.linkPoints}`);
  check(s.poolPoints === 0, `no suit pool expected, got ${s.poolPoints}`);
  check(s.total === 48, `total ${s.total}, want 48`);
}
{
  // Fixture: the same ring with the savage breaking two links → 6 × 6 = 36.
  const st = mk({ ring: [...RING8.slice(0, 7), 'the-savage'] });
  const s = C.score(st);
  check(s.links === 6 && s.linkPoints === 36, `links ${s.links}, points ${s.linkPoints}`);
  check(s.total === 36, `total ${s.total}, want 36`);
}
{
  // Fixture: a partial ring of six moons cards.  Slots 4-5-6-7-0 chain four
  // links (mountain→pact→harvest→huntress→ace of moons; each of these spends
  // no moons token twice thanks to the two crowns of moons); the journey at
  // slot 2 stands alone.  4 links × 6 = 24, plus the six-moons pool: 30 → 54.
  const ring = [
    'ace-of-moons', null, 'the-journey', null,
    'the-mountain', 'the-pact', 'the-harvest', 'the-huntress',
  ];
  const st = mk({ ring });
  const s = C.score(st);
  check(s.pools.moons === 6, `moons pool ${s.pools.moons}, want 6`);
  check(s.poolPoints === 30, `pool points ${s.poolPoints}, want 30`);
  check(s.links === 4, `links ${s.links}, want 4`);
  check(s.total === 54, `total ${s.total}, want 54`);
}

/* ---- taking a card from the pool ---- */

{
  const st = C.newGame(7, DECK);
  const next = C.applyTake(st, 0, 3);
  check(next.ring[3] === st.pool[0], 'the pool card was placed');
  check(next.pool.length === 4, 'the pool refilled');
  check(next.deck.length === 39, `deck ${next.deck.length}, want 39`);
  check(next.moves === 1, 'move counted');
  check(next.over === null, 'a partial ring does not end the game');
  conserved(st, next, 'applyTake');

  throws(() => C.applyTake(next, 0, 3), 'taking into an occupied slot throws');
  throws(() => C.applyTake(next, 9, 0), 'a missing pool card throws');
}

/* ---- moving a placed card ---- */

{
  const st = C.newGame(11, DECK);
  const two = C.applyTake(C.applyTake(st, 2, 5), 3, 1);
  const moved = C.applyMoveCard(two, 5, 0);
  check(moved.ring[0] === two.ring[5] && moved.ring[5] == null, 'the card moved');
  conserved(two, moved, 'applyMoveCard');
  throws(() => C.applyMoveCard(moved, 7, 1), 'moving from an empty slot throws');
  throws(() => C.applyMoveCard(moved, 0, 1), 'moving onto an occupied slot throws');
}

/* ---- dealing again ---- */

{
  const st = C.newGame(13, DECK);
  const d1 = C.applyRedeal(st);
  check(d1.pool.length === 3 && d1.poolSize === 3, `first deal gives ${d1.pool.length}`);
  check(d1.discards.length === 4, 'the old pool was discarded');
  const d2 = C.applyRedeal(d1);
  check(d2.pool.length === 2 && d2.discards.length === 7, 'second deal: 2 cards');
  const d3 = C.applyRedeal(d2);
  check(d3.pool.length === 3 - 1 - 1 && d3.pool.length === 1 && d3.discards.length === 9,
    'third deal leaves one card');
  check(d3.over === null, 'one card is still playable');
  conserved(st, d3, 'three deals');
  const dead = C.applyRedeal(d3);
  check(dead.over === 'lost' && dead.lostReason === 'no-cards',
    'asking to deal with one card left kills the mage');
  throws(() => C.applyRedeal(dead), 'dealing after the game is over throws');
}

/* ---- surrender ---- */

{
  const st = C.newGame(17, DECK);
  const dead = C.applySurrender(st);
  check(dead.over === 'lost' && dead.lostReason === 'surrender', 'surrender loses');
  conserved(st, dead, 'surrender');
  throws(() => C.applySurrender(dead), 'surrendering twice throws');
}

/* ---- the deck reshuffles the discards when it runs out ---- */

{
  const st = mk({
    ring: [...RING8.slice(0, 7), null],
    pool: ['the-mountain'],
    deck: [],
    discards: ['the-journey', 'the-pact'],
  });
  const next = C.applyTake(st, 0, 7);
  check(next.deck.length === 1 && next.pool.length === 1,
    'the pool refilled from the reshuffled discards (one card left in the deck)');
  check(next.pool[0] === 'the-journey' || next.pool[0] === 'the-pact',
    'the refill came from the discards');
  conserved(st, next, 'deck reshuffle');
}

/* ---- completing the ring ---- */

{
  // the eighth card closes the ring with every link shared: the mage survives
  const st = mk({
    ring: [...RING8.slice(0, 7), null],
    pool: ['the-diplomat', 'the-savage'],
    deck: DECK.filter((id) => ![...RING8, 'the-savage'].includes(id)).slice(0, 10),
  });
  const next = C.applyTake(st, 0, 7);
  check(next.over === 'won', `a fully linked ring wins (over=${next.over})`);
  check(C.score(next).total === 48, 'a closed ring scores 48');
  throws(() => C.applyTake(next, 0, 0), 'playing after the win throws');
}
{
  // …and a broken eighth link means the wyvern breathes
  const st = mk({
    ring: [...RING8.slice(0, 7), null],
    pool: ['the-savage', 'the-diplomat'],
    deck: DECK.filter((id) => ![...RING8, 'the-diplomat'].includes(id)).slice(0, 10),
  });
  const next = C.applyTake(st, 0, 7);
  check(next.over === 'lost' && next.lostReason === 'broken-ring',
    `a broken ring loses (over=${next.over}/${next.lostReason})`);
}
{
  // A move keeps the ring's card count, so it can never finish or break a
  // round on its own — only taking the eighth card from the pool can.
  const ring = [...RING8.slice(0, 7), null];
  const st = mk({ ring });
  const moved = C.applyMoveCard(st, 5, 7);
  check(moved.ring[7] === 'the-painter' && moved.ring[5] == null, 'the painter moved');
  check(moved.over === null, 'a seven-card ring is never over');
  conserved(st, moved, 'moving inside a nearly full ring');
}

/* ---- legal actions ---- */

{
  const st = C.newGame(23, DECK);
  const acts = C.legalActions(st);
  check(acts.filter((a) => a.kind === 'take').length === 4 * C.RING_SIZE,
    'four pool cards into eight empty slots');
  check(acts.some((a) => a.kind === 'redeal') && acts.some((a) => a.kind === 'surrender'),
    'the round may always be redealt or surrendered');
  check(C.legalActions({ ...st, over: 'won' }).length === 0, 'no actions after the game');
}

/* ---- full random playouts ---- */

const applyAction = (st, a) =>
  a.kind === 'take' ? C.applyTake(st, a.poolIndex, a.toSlot)
    : a.kind === 'move' ? C.applyMoveCard(st, a.fromSlot, a.toSlot)
      : a.kind === 'redeal' ? C.applyRedeal(st)
        : C.applySurrender(st);

let won = 0, lost = 0, maxMoves = 0;
for (let seed = 1; seed <= 300; seed++) {
  let st = C.newGame(seed, DECK);
  const rng = D_mulberry32(seed * 7919 + 13);
  let guard = 0;
  while (!st.over && guard++ < 100) {
    const acts = C.legalActions(st).filter((a) => a.kind !== 'surrender');
    const takes = acts.filter((a) => a.kind === 'take');
    const pool = rng() < 0.85 && takes.length ? takes : acts;
    const before = st;
    st = applyAction(st, pool[Math.floor(rng() * pool.length)]);
    conserved(before, st, `seed ${seed} move ${st.moves}`);
  }
  check(!!st.over, `seed ${seed}: playout never ended (guard ${guard})`);
  maxMoves = Math.max(maxMoves, st.moves);
  if (st.over === 'won') won++;
  else if (st.over === 'lost') lost++;
  else check(false, `seed ${seed}: over=${st.over}`);
  const s = C.score(st);
  check(s.total === s.linkPoints + s.poolPoints, `seed ${seed}: score does not add up`);
  if (st.over === 'won') check(s.links === C.RING_SIZE, `seed ${seed}: a win without eight links`);
}
check(won + lost === 300, 'every playout ended in a decision');

/* ---- a competent player wins a reasonable share ----
 *
 * A greedy builder — always take the pool card into the empty slot that
 * yields the most simultaneously valid links — closes the ring in about one
 * game of five.  If a rule regression made the ring impossibly hard, this
 * would collapse. */
{
  let gWon = 0, gScore = 0;
  for (let seed = 1; seed <= 300; seed++) {
    let st = C.newGame(seed, DECK);
    const rng = D_mulberry32(seed * 131 + 17);
    let guard = 0;
    while (!st.over && guard++ < 60) {
      let pick = null, val = -1;
      const empties = C.emptySlots(st);
      for (let pi = 0; pi < st.pool.length; pi++) {
        for (const s of empties) {
          const ring = st.ring.slice();
          ring[s] = st.pool[pi];
          const v = C.linkCount(ring) + rng() * 0.01;
          if (v > val) { val = v; pick = { pi, s }; }
        }
      }
      st = C.applyTake(st, pick.pi, pick.s);
    }
    if (st.over === 'won') { gWon++; gScore += C.score(st).total; }
  }
  check(gWon >= 20, `a greedy ring-builder won only ${gWon} of 300 games`);
  console.log(`greedy ring-builder: ${gWon}/300 won, avg winning score ${(gScore / Math.max(1, gWon)).toFixed(1)}`);
}

/* ---- JSON round trip of a mid-game state ---- */
{
  let st = C.newGame(99, DECK);
  for (let i = 0; i < 4 && !st.over; i++) {
    st = C.applyTake(st, 0, C.emptySlots(st)[0]);
  }
  const back = JSON.parse(JSON.stringify(st));
  check(C.legalActions(back).length === C.legalActions(st).length, 'legal actions differ after round trip');
  check(C.linkCount(back.ring) === C.linkCount(st.ring), 'link count differs after round trip');
}

console.log(`playouts: ${won} won, ${lost} lost, max ${maxMoves} moves`);
console.log(failures === 0 ? 'wyvern-pass-not: all tests passed' : `wyvern-pass-not: ${failures} failures`);
process.exit(failures ? 1 : 0);
