// Headless tests for Advent of the Wyrms: node test/advent-of-the-wyrms.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mulberry32 as D_mulberry32 } from '../web/js/decktet.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'web/cards/manifest.json'), 'utf8'));
const byId = Object.fromEntries(manifest.cards.map((c) => [c.id, c]));

const C = await import('../web/js/games/advent-of-the-wyrms-core.js');
C.init(byId);

const DECK = [...manifest.basicDeck, ...manifest.extendedDeck];   // the extended 45-card deck
let failures = 0;
const check = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } };
const throws = (fn, msg) => {
  let t = false;
  try { fn(); } catch { t = true; }
  check(t, msg);
};

/* ---- conservation helpers ---- */

function allCards(state) {
  return [
    ...state.deck, ...state.hand, ...state.discards, ...state.negated, ...state.setAside,
    ...(state.pending ? [state.pending.card] : []),
    ...state.open.flatMap((i) => i.cards),
    ...state.done.flatMap((i) => i.cards),
  ];
}

function conserved(before, after, label) {
  const a = allCards(before).slice().sort().join('|');
  const b = allCards(after).slice().sort().join('|');
  check(a === b, `${label}: cards changed\n  before ${a}\n  after  ${b}`);
  check(new Set(allCards(after)).size === allCards(after).length, `${label}: duplicate card`);
}

/** A hand-built state. */
function mk(spec = {}) {
  return {
    seed: spec.seed ?? 0,
    deck: spec.deck ?? [],
    hand: spec.hand ?? [],
    open: spec.open ?? [],
    done: spec.done ?? [],
    discards: spec.discards ?? [],
    negated: spec.negated ?? [],
    setAside: spec.setAside ?? [],
    pending: spec.pending ?? null,
    moves: 0, negations: 0,
    over: spec.over ?? null, lostReason: spec.lostReason ?? null,
  };
}

/* ---- setup invariants over 500 seeds ---- */
for (let seed = 1; seed <= 500; seed++) {
  const st = C.newGame(seed, DECK);
  check(st.hand.length === 4, `seed ${seed}: hand ${st.hand.length}`);
  check(st.hand.every((id) => !C.isWyrms(id)), `seed ${seed}: wyrms in the opening hand`);
  check(allCards(st).length === 45, `seed ${seed}: ${allCards(st).length} cards`);
  check(new Set(allCards(st)).size === 45, `seed ${seed}: duplicate or missing card`);
  check(st.setAside.length === 0, `seed ${seed}: set-aside not reshuffled`);
  check(st.pending === null, `seed ${seed}: pending after setup`);
  check(st.moves === 0 && st.over === null, `seed ${seed}: fresh state`);
  check(st.open.length === 0 && st.done.length === 0, `seed ${seed}: no incantations at start`);
  const json = JSON.parse(JSON.stringify(st));
  check(json.hand.length === 4, `seed ${seed}: JSON round trip lost the hand`);
}

/* ---- ranks: this game's own ordering (Pawn 11, Court 12) ---- */
check(C.rankOf('ace-of-moons') === 1, 'ace is 1');
check(C.rankOf('the-pact') === 9, '9 is 9');
check(C.rankOf('the-bard') === 10, 'crown is 10');
check(C.rankOf('the-borderland') === 11, 'pawn is 11');
check(C.rankOf('the-window') === 12, 'court is 12');
check(C.rankOf('the-excuse') === 0, 'the Excuse has no rank');

/* ---- the wyrms suit is the Daemons suit ---- */
check(C.isWyrms('ace-of-daemons'), 'ace of daemons is wyrms');
check(C.isWyrms('the-desert'), 'the Desert (suns+wyrms) is wyrms');
check(C.isWyrms('the-borderland'), 'the Borderland (pawn) is wyrms');
check(!C.isWyrms('the-window'), 'the Window is not wyrms');
check(DECK.filter((id) => C.isWyrms(id)).length === 14, '14 wyrms cards in the 45-card deck');

/* ---- incantation options ---- */

{
  // a two-suit card may start an incantation with either of its suits
  const st = mk({ hand: ['the-mountain'], deck: DECK.filter((id) => !C.isWyrms(id)).slice(0, 10) });
  const opts = C.addOptions(st, 0);
  check(opts.some((o) => !o.existing && o.suit === 'moons'), 'mountain may start a moons incantation');
  check(opts.some((o) => !o.existing && o.suit === 'suns'), 'mountain may start a suns incantation');
}
{
  // suit and ascending-rank rules against an existing incantation
  const open = [{ suit: 'moons', cards: ['the-mountain'] }];        // rank 4
  const st = mk({ hand: ['the-pact', 'the-journey', 'the-sea'], open });   // 9 moons, 3 moons, 10 waves
  const pact = C.addOptions(st, 0).filter((o) => o.existing);
  check(pact.length === 1 && pact[0].slot === 0 && pact[0].suit === 'moons',
    'the Pact (9, moons) may join a moons incantation started at 4');
  check(C.addOptions(st, 1).every((o) => o.existing === false),
    'the Journey (3) is below the mountain (4): only a new incantation');
  check(C.addOptions(st, 2).every((o) => o.existing === false),
    'the Sea (waves) shares no suit with the moons incantation');
}
{
  // pawns outrank crowns; an equal rank may not be added
  const open = [{ suit: 'waves', cards: ['the-borderland'] }];       // pawn, rank 11
  const st = mk({ hand: ['the-light-keeper'], open });               // pawn, rank 11, waves
  check(C.addOptions(st, 0).every((o) => o.existing === false),
    'an equal rank may not join an incantation');
}
{
  // up to five incantations being crafted at once
  const open = [
    { suit: 'moons', cards: ['the-author'] },
    { suit: 'suns', cards: ['the-painter'] },
    { suit: 'waves', cards: ['the-journey'] },
    { suit: 'leaves', cards: ['the-origin'] },
    { suit: 'crowns', cards: ['the-windfall'] },
  ];
  const st = mk({ hand: ['ace-of-moons'], open });   // rank 1: too low for the moons slot
  check(C.addOptions(st, 0).length === 0, 'no new incantation while five are being crafted');
}

/* ---- playing cards: applyAdd ---- */

{
  const open = [{ suit: 'moons', cards: ['the-author'] }];           // rank 2
  const st = mk({ hand: ['the-mountain'], open, deck: nonWyrms(10, ['the-mountain', 'the-author']) });
  const before = st;
  const next = C.applyAdd(st, 0, 0, 'moons');
  check(next.open[0].cards.join() === 'the-author,the-mountain', 'card appended in order');
  check(next.hand.length === 4 && !next.hand.includes('the-mountain'),
    'the played card left the hand, which refilled to four');
  check(next.moves === 1, 'move counted');
  check(st.open[0].cards.length === 1, 'the original state was not mutated');
  conserved(before, next, 'applyAdd');
}
{
  // completing an incantation moves it aside and frees the slot
  const open = [{ suit: 'moons', cards: ['the-author', 'the-mountain'] }];
  const st = mk({ hand: ['the-pact'], open, deck: nonWyrms(10) });
  const next = C.applyAdd(st, 0, 0, 'moons');
  check(next.open.length === 0, 'the open slot was freed');
  check(next.done.length === 1 && C.isComplete(next.done[0]), 'completed incantation set aside');
}
{
  // completing the fourth incantation wins before the draw can lose
  const done = sunsDone().concat(wavesDone(), leavesDone(), crownsDone());
  const st = mk({
    hand: ['the-pact'],
    open: [{ suit: 'moons', cards: ['ace-of-moons', 'the-mountain'] }],
    done,
    deck: nonWyrms(10, [...done.flatMap((i) => i.cards), 'the-mountain', 'the-pact']),
  });
  const next = C.applyAdd(st, 0, 0, 'moons');
  check(next.over === 'won', `fourth incantation wins (over=${next.over})`);
}

/* ---- illegal adds throw ---- */

{
  const st = mk({ hand: ['the-mountain'], open: [{ suit: 'moons', cards: ['the-author'] }] });
  throws(() => C.applyAdd(st, 0, 0, 'suns'), 'wrong suit for the incantation throws');
  throws(() => C.applyAdd(st, 0, 9, 'moons'), 'out-of-range slot throws');
  throws(() => C.applyAdd(st, 5, 0, 'moons'), 'no such hand card throws');
  const st2 = mk({ hand: ['the-mountain'], open: [{ suit: 'moons', cards: ['the-mountain'] }] });
  throws(() => C.applyAdd(st2, 0, 0, 'moons'), 'equal rank throws');
  const st3 = mk({ hand: ['the-mountain'], open: [{ suit: 'waves', cards: ['the-sea'] }] });
  throws(() => C.applyAdd(st3, 0, 0, 'waves'), 'a card without the suit throws');
  const over = mk({ hand: ['the-mountain'], over: 'won' });
  throws(() => C.applyAdd(over, 0, 0, 'moons'), 'playing after the game is over throws');
  const pending = mk({ hand: ['the-mountain'], pending: { card: 'the-desert' } });
  throws(() => C.applyAdd(pending, 0, 0, 'moons'), 'playing before negating throws');
  throws(() => C.applyDiscard(pending, 0), 'discarding before negating throws');
  check(C.addOptions(pending, 0).length === 0, 'no options while a wyrms card waits');
}

/* ---- the Excuse is wild ---- */

{
  const st = mk({ hand: ['the-excuse'], open: [{ suit: 'moons', cards: ['the-author'] }], deck: nonWyrms(10, ['the-author', 'the-excuse']) });
  const opts = C.addOptions(st, 0);
  check(opts.some((o) => o.slot === 0 && o.suit === 'moons'), 'the Excuse may join any incantation');
  check(opts.some((o) => !o.existing && o.suit == null), 'the Excuse may start an incantation');
  const next = C.applyAdd(st, 0, 0, 'moons');
  check(next.open[0].cards.join() === 'the-author,the-excuse', 'the Excuse was played');
}
{
  // a wild-led incantation takes its suit from the next card, and the wild
  // imposes no rank constraint on what follows
  const st = mk({
    hand: ['the-mountain', 'the-journey'],
    open: [{ suit: null, cards: ['the-excuse'] }],
    deck: nonWyrms(10, ['the-mountain', 'the-journey', 'the-excuse']),
  });
  const opts = C.addOptions(st, 0);
  check(opts.some((o) => o.slot === 0 && o.suit === 'moons') &&
    opts.some((o) => o.slot === 0 && o.suit === 'suns'),
    'the mountain picks the suit of a wild-led incantation');
  const mid = C.applyAdd(st, 0, 0, 'moons');
  check(mid.open[0].suit === 'moons' && mid.open[0].cards.length === 2, 'suit taken from the card');
  check(C.addOptions(mid, 0).every((o) => o.existing === false),
    'a rank-3 card may not follow the rank-4 mountain');
}

/* ---- discarding ---- */

{
  const st = mk({ hand: ['the-mountain', 'the-pact'], deck: nonWyrms(10), discards: ['the-sea'] });
  const next = C.applyDiscard(st, 1);
  check(next.discards[next.discards.length - 1] === 'the-pact', 'discarded the right card');
  check(next.hand.length === 4 && next.hand[0] === 'the-mountain',
    'hand down one, then refilled to four');
  conserved(st, next, 'applyDiscard');
}

/* ---- negation: the four methods ---- */

{
  // the Desert (suns+wyrms, rank 2) waits; options per the wiki's four ways
  const st = mk({
    hand: ['the-mountain', 'ace-of-waves', 'the-excuse', 'the-journey'],   // 4 moons+suns, ace r1, wild, r3 waves
    pending: { card: 'the-desert' },
    deck: nonWyrms(10),
  });
  const neg = C.legalNegations(st);
  check(neg.some((o) => o.method === 'match' && o.handIndex === 0), 'mountain matches the suns suit');
  check(neg.some((o) => o.method === 'rank' && o.handIndex === 0), 'mountain (4) outranks the Desert (2)');
  check(!neg.some((o) => o.method === 'match' && o.handIndex === 1), 'ace of waves shares no suit');
  check(!neg.some((o) => o.method === 'rank' && o.handIndex === 1), 'ace of waves (1) is below 2');
  check(neg.some((o) => o.method === 'excuse'), 'the Excuse negates');
  check(neg.some((o) => o.method === 'rank' && o.handIndex === 3), 'the Journey (3) outranks 2');
  check(neg.some((o) => o.method === 'deck2'), 'two from the deck negates');
}
{
  // match-suit negation
  const st = mk({
    hand: ['the-mountain', 'the-pact'],
    pending: { card: 'the-desert' },
    deck: nonWyrms(10),
  });
  const next = C.applyNegate(st, { method: 'match', handIndex: 0 });
  check(next.negated.join() === 'the-desert', 'the wyrms card is negated out of play');
  check(next.discards.includes('the-mountain'), 'the matching card is discarded');
  check(next.hand.length === 4 && !next.hand.includes('the-mountain'),
    'the hand refilled to four without it');
  check(next.pending === null, 'nothing left to negate');
  check(next.negations === 1, 'negation counted');
  conserved(st, next, 'negate by match');
}
{
  // rank negation, incl. "equals/exceeds" and the crown at 10
  const st = mk({ hand: ['the-huntress'], pending: { card: 'the-calamity' }, deck: nonWyrms(10) });
  check(C.legalNegations(st).some((o) => o.method === 'rank' && o.handIndex === 0),
    'a Crown (10) negates the Crown of Wyrms (10)');
  const next = C.applyNegate(st, { method: 'rank', handIndex: 0 });
  check(next.negated.join() === 'the-calamity', 'calamity negated');
  const st2 = mk({ hand: ['the-huntress'], pending: { card: 'the-borderland' }, deck: nonWyrms(10) });
  check(!C.legalNegations(st2).some((o) => o.method === 'rank'),
    'a Crown (10) cannot negate a Pawn (11)');
  const st3 = mk({ hand: ['the-window'], pending: { card: 'the-borderland' }, deck: nonWyrms(10) });
  check(C.legalNegations(st3).some((o) => o.method === 'rank'),
    'a Court (12) negates a Pawn (11)');
}
{
  // the ace and crown of wyrms have no other suit: no match method at all
  const st = mk({ hand: ['the-mountain', 'the-journey'], pending: { card: 'ace-of-daemons' }, deck: nonWyrms(10) });
  check(!C.legalNegations(st).some((o) => o.method === 'match'),
    'the ace of wyrms cannot be negated by matching a suit');
  check(C.legalNegations(st).every((o) => o.method !== 'match'), 'no match option exists');
}
{
  // the Excuse negation
  const st = mk({ hand: ['the-excuse', 'the-mountain'], pending: { card: 'the-desert' }, deck: nonWyrms(10) });
  const next = C.applyNegate(st, { method: 'excuse', handIndex: 0 });
  check(next.discards.includes('the-excuse'), 'the Excuse is spent');
  check(next.negated.join() === 'the-desert', 'desert negated');
}
{
  // two-from-the-deck: wyrms among them are set aside, then reshuffled back.
  // The deck draws from its end, so the top two are the last two in the list.
  const st = mk({
    hand: ['the-mountain'],
    pending: { card: 'the-desert' },
    deck: ['the-journey', 'the-market', 'the-lunatic', 'the-origin', 'the-darkness'],
  });
  const next = C.applyNegate(st, { method: 'deck2', handIndex: null });
  check(next.discards.includes('the-origin'), 'a plain card is discarded');
  check(!next.discards.includes('the-darkness'), 'a wyrms card is not discarded');
  check(next.deck.includes('the-darkness'), 'the set-aside wyrms card is back in the deck');
  check(next.setAside.length === 0 && next.pending === null, 'refilled and settled');
  conserved(st, next, 'negate by deck2');
}
{
  // two-from-the-deck needs two cards
  const st = mk({ hand: ['the-mountain'], pending: { card: 'the-desert' }, deck: ['the-origin'] });
  check(!C.legalNegations(st).some((o) => o.method === 'deck2'), 'no deck2 with one card left');
}

/* ---- refills ---- */

{
  // refilling from 1–3: a wyrms card drawn must be negated (pending again).
  // The deck draws from its end, so the wyrms card is last in the list.
  const st = mk({
    hand: ['the-mountain', 'the-pact'],
    pending: { card: 'the-desert' },
    deck: ['the-origin', 'the-journey', 'the-market', 'the-darkness'],
  });
  const next = C.applyNegate(st, { method: 'rank', handIndex: 0 });
  check(next.pending?.card === 'the-darkness', 'the refill stopped on a wyrms card');
  check(next.hand.join() === 'the-pact', 'hand holds one card');
  check(next.negated.join() === 'the-desert', 'only the first is negated so far');
}
{
  // Refilling after the hand hit 0: wyrms are set aside, not negated.
  // Draws come from the deck's end, so the two wyrms cards lead the list.
  const st = mk({
    hand: ['the-mountain'],
    pending: { card: 'the-desert' },
    deck: ['the-origin', 'the-journey', 'the-market', 'the-lunatic', 'the-soldier', 'the-darkness'],
  });
  const next = C.applyNegate(st, { method: 'rank', handIndex: 0 });
  check(next.hand.length === 4 && next.hand.every((id) => !C.isWyrms(id)), 'four non-wyrms drawn');
  check(next.pending === null, 'no negation owed from an empty-hand refill');
  check(next.deck.includes('the-darkness') && next.deck.includes('the-soldier'),
    'set-aside wyrms reshuffled into the deck');
  check(next.setAside.length === 0, 'set-aside cleared');
  conserved(st, next, 'empty-hand refill');
}

/* ---- losing ---- */

{
  // a needed draw with an empty deck loses
  const st = mk({ hand: ['the-mountain', 'the-pact', 'the-journey', 'the-sea'], deck: [] });
  const next = C.applyDiscard(st, 0);
  check(next.over === 'lost' && next.lostReason === 'deck', `empty deck loses (over=${next.over})`);
  check(C.score(next) === 0, 'a loss scores 0');
}
{
  // a drawn wyrms card with no legal negation is also the end
  const st = mk({
    hand: ['ace-of-moons', 'ace-of-waves', 'ace-of-leaves', 'ace-of-suns'],
    pending: { card: 'the-calamity' },   // crown of wyrms, rank 10
    deck: [],
  });
  check(C.legalNegations(st).length === 0, 'no way to negate the crown of wyrms here');
  C.settle(st);
  check(st.over === 'lost' && st.lostReason === 'trapped', 'trapped by an unnegatable wyrms card');
  check(C.score(st) === 0, 'a loss scores 0');
}

/* ---- scoring fixture: a win on paper ---- */

{
  // Four finished incantations use 12 cards, plus the mountain (2), the pact
  // (1) and the pact (1) and the ace of moons: 15 distinct non-wyrms cards.
  // Of the 45 cards, 14 are wyrms and one is the Excuse, leaving 30 usable
  // non-wyrms — so the fixture's deck holds the other 15.  The game ends the
  // moment the fourth incantation is crafted, before step 2's draw: all 15
  // cards remain in the deck, and that is the score.
  const done = sunsDone().concat(wavesDone(), leavesDone(), crownsDone());
  const used = [...done.flatMap((i) => i.cards), 'ace-of-moons', 'the-mountain', 'the-pact'];
  const deck = nonWyrms(33).filter((id) => !used.includes(id));
  check(used.length === 15 && new Set(used).size === 15, 'the fixture uses 15 distinct cards');
  check(nonWyrms(33).length === 30, `there are ${nonWyrms(33).length} usable non-wyrms cards`);
  check(deck.length === 15, `fixture deck has ${deck.length} cards`);
  const st = mk({
    hand: ['the-pact'],
    open: [{ suit: 'moons', cards: ['ace-of-moons', 'the-mountain'] }],
    done,
    deck,
  });
  const next = C.applyAdd(st, 0, 0, 'moons');
  check(next.over === 'won', 'the fourth incantation wins');
  check(next.deck.length === 15, `deck has ${next.deck.length} (no draw after the win)`);
  check(C.score(next) === 15, `score ${C.score(next)}, want 15`);
  check(new Set(allCards(next)).size === 30 && allCards(next).length === 30,
    'the fixture state holds its 30 cards, each once');
}

/* ---- full random playouts ---- */

const applyAction = (st, a) =>
  a.kind === 'discard' ? C.applyDiscard(st, a.handIndex)
    : a.kind === 'add' ? C.applyAdd(st, a.handIndex, a.slot, a.suit)
      : C.applyNegate(st, a);

let won = 0, lost = 0, maxMoves = 0;
for (let seed = 1; seed <= 300; seed++) {
  let st = C.newGame(seed, DECK);
  const rng = D_mulberry32(seed * 7919 + 13);
  let guard = 0;
  while (!st.over && guard++ < 300) {
    const acts = C.legalActions(st);
    if (!acts.length) { check(false, `seed ${seed}: no legal action but not over`); break; }
    const before = st;
    st = applyAction(st, acts[Math.floor(rng() * acts.length)]);
    conserved(before, st, `seed ${seed} move ${st.moves}`);
  }
  check(!!st.over, `seed ${seed}: playout never ended (guard ${guard})`);
  maxMoves = Math.max(maxMoves, st.moves);
  if (st.over === 'won') won++;
  else if (st.over === 'lost') lost++;
  else check(false, `seed ${seed}: over=${st.over}`);
  const json = JSON.parse(JSON.stringify(st));
  check(json.deck.length === st.deck.length, `seed ${seed}: JSON round trip`);
}
check(won + lost === 300, 'every playout ended in a decision');

/* ---- a competent player wins a reasonable share ----
 *
 * A greedy policy — negate with two-from-the-deck first, then the Excuse,
 * then the cheapest card; prefer finishing an incantation, then adding to one,
 * then starting one, and only then discard — wins about a third of deals.
 * If a rule regression made the game unwinnable this would collapse to zero. */
{
  let gWon = 0, gScore = 0;
  for (let seed = 1; seed <= 300; seed++) {
    let st = C.newGame(seed, DECK);
    let guard = 0;
    while (!st.over && guard++ < 200) {
      let a;
      if (st.pending) {
        const neg = C.legalNegations(st);
        const weight = (o) => o.method === 'deck2' ? 0 : o.method === 'excuse' ? 1
          : (o.method === 'match' ? 2 : 3) + C.rankOf(st.hand[o.handIndex]) / 100;
        a = neg.slice().sort((x, y) => weight(x) - weight(y))[0];
      } else {
        const acts = C.legalActions(st);
        const adds = acts.filter((x) => x.kind === 'add');
        const complete = adds.filter((x) => x.slot < st.open.length && st.open[x.slot].cards.length === 2);
        const toExisting = adds.filter((x) => x.slot < st.open.length && !complete.includes(x));
        const startNew = adds.filter((x) => x.slot >= st.open.length);
        const discards = acts.filter((x) => x.kind === 'discard')
          .sort((x, y) => C.rankOf(st.hand[y.handIndex]) - C.rankOf(st.hand[x.handIndex]));
        a = complete[0]
          || toExisting.sort((x, y) => st.open[x.slot].cards.length - st.open[y.slot].cards.length)[0]
          || startNew[0] || discards[0];
      }
      st = applyAction(st, a);
    }
    if (st.over === 'won') { gWon++; gScore += C.score(st); }
  }
  check(gWon >= 60, `a greedy player won only ${gWon} of 300 games`);
  console.log(`greedy player: ${gWon}/300 won, avg winning score ${(gScore / Math.max(1, gWon)).toFixed(1)}`);
}

/* ---- JSON round trip of a mid-game state ---- */
{
  let st = C.newGame(99, DECK);
  for (let i = 0; i < 12 && !st.over; i++) {
    const acts = C.legalActions(st);
    if (!acts.length) break;
    st = applyAction(st, acts[0]);
  }
  const back = JSON.parse(JSON.stringify(st));
  check(C.legalActions(back).length === C.legalActions(st).length, 'legal actions differ after round trip');
}

console.log(`playouts: ${won} won, ${lost} lost, max ${maxMoves} moves`);
console.log(failures === 0 ? 'advent-of-the-wyrms: all tests passed' : `advent-of-the-wyrms: ${failures} failures`);
process.exit(failures ? 1 : 0);

/* ---------------------------------------------------------------- helpers */

function nonWyrms(n, exclude = []) {
  return DECK.filter((id) => !C.isWyrms(id) && id !== 'the-excuse' && !exclude.includes(id)).slice(0, n);
}
function sunsDone() {
  return [{ suit: 'suns', cards: ['ace-of-suns', 'the-painter', 'the-bard'] }];
}
function wavesDone() {
  return [{ suit: 'waves', cards: ['ace-of-waves', 'the-journey', 'the-sea'] }];
}
function leavesDone() {
  return [{ suit: 'leaves', cards: ['ace-of-leaves', 'the-origin', 'the-end'] }];
}
function crownsDone() {
  return [{ suit: 'crowns', cards: ['ace-of-crowns', 'the-author', 'the-windfall'] }];
}
