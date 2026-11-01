// Headless tests for Head Solitaire: node test/head-solitaire.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mulberry32 as D_mulberry32 } from '../web/js/decktet.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'web/cards/manifest.json'), 'utf8'));
const byId = Object.fromEntries(manifest.cards.map((c) => [c.id, c]));

const C = await import('../web/js/games/head-solitaire-core.js');
C.init(byId);

const BASIC = manifest.basicDeck;
const SUITS = ['moons', 'suns', 'waves', 'leaves', 'daemons', 'crowns'];
let failures = 0;
const check = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } };

/* ---- card conservation ---- */
function allCards(state) {
  return [...state.hand, ...state.draw, ...state.discard,
    ...state.archive.flatMap((m) => m.ids)];
}
function conserved(state, label) {
  const all = allCards(state);
  if (all.length !== 36) { check(false, `${label}: ${all.length} cards`); return; }
  if (new Set(all).size !== 36) check(false, `${label}: duplicate or missing card`);
}

/** For hand-built (partial) states: a move must not create or destroy a card. */
function sameCards(before, after, label) {
  const a = allCards(before).slice().sort().join('|');
  const b = allCards(after).slice().sort().join('|');
  check(a === b, `${label}: cards changed\n  before ${a}\n  after  ${b}`);
}

/* ---- an independent meld checker, to hold the core against ---- */
const rankOf = (id) => (byId[id].rank === 'crown' ? 10 : byId[id].rank);
function indMeldType(ids) {
  if (ids.length < 3 || new Set(ids).size !== ids.length) return null;
  const suits = new Map();
  for (const id of ids) for (const s of byId[id].suits) suits.set(s, (suits.get(s) || 0) + 1);
  if (suits.size === 6 && [...suits.values()].every((n) => n === 1)) return 'suit';
  const ranks = ids.map(rankOf);
  if (ranks.every((r) => r === ranks[0])) return 'kind';
  const sorted = ranks.slice().sort((a, b) => a - b);
  if (new Set(sorted).size === sorted.length
      && sorted[sorted.length - 1] - sorted[0] === sorted.length - 1
      && SUITS.some((s) => ids.every((id) => byId[id].suits.includes(s)))) return 'run';
  return null;
}

/* ---- setup invariants over 500 seeds ---- */
for (let seed = 1; seed <= 500; seed++) {
  const st = C.newGame(seed, BASIC);
  check(st.hand.length === 6, `seed ${seed}: hand ${st.hand.length}`);
  check(st.draw.length === 30, `seed ${seed}: draw ${st.draw.length}`);
  check(st.discard.length === 0 && st.archive.length === 0, `seed ${seed}: piles not empty`);
  check(st.phase === 1 && !st.offer && st.over === null && st.moves === 0,
    `seed ${seed}: bad start flags`);
  conserved(st, `seed ${seed}`);
}

/* ---- known melds and non-melds ---- */
const KIND = ['the-castle', 'the-chance-meeting', 'the-cave'];        // three 7s
const SUIT6 = ['ace-of-moons', 'ace-of-suns', 'ace-of-waves',
  'ace-of-leaves', 'ace-of-daemons', 'ace-of-crowns'];
const SUIT3 = ['the-desert', 'the-journey', 'the-market'];            // three dual-suit cards
const RUN = ['ace-of-moons', 'the-author', 'the-journey'];            // Moons A–2–3
const RUN_TOP = ['the-betrayal', 'the-darkness', 'the-calamity'];     // Daemons 8–9–Crown

// The three cards of a numbered rank always split the six suits between
// them, so a numbered three-of-a-kind counts as a kind meld and a suit
// meld at once; the core reports 'suit' and labels it as both.
check(C.meldType(KIND) === 'suit', 'three 7s is a suit meld (and a kind meld)');
check(C.isKindMeld(KIND), 'three 7s is a kind meld');
check(C.meldType(SUIT6) === 'suit', 'six aces is a suit meld');
check(C.isKindMeld(SUIT6), 'six aces is also a kind meld');
check(C.meldType(SUIT3) === 'suit', 'desert+journey+market covers all six suits once');
check(C.meldType(RUN) === 'run', 'Moons A-2-3 is a run meld');
check(C.meldType(RUN_TOP) === 'run', 'Daemons 8-9-Crown is a run meld (Crown = 10)');
check(C.meldType(['ace-of-moons', 'ace-of-suns', 'ace-of-waves']) === 'kind',
  'three aces are a kind meld');
check(C.meldLabel({ type: 'suit', ids: KIND }) === 'Suit + kind meld · 7 ×3',
  'a numbered three-of-a-kind is labelled as both');

const noMelds = [
  [['ace-of-moons', 'ace-of-suns'], 'a pair is not a meld'],
  [['the-pact', 'the-bard', 'ace-of-suns'], '9-10-Ace does not wrap into a run'],
  [['the-mountain', 'the-discovery', 'the-lunatic'], '4-5-6 with no shared suit is not a run'],
  [['the-mountain', 'the-forest', 'the-sailor'], 'a repeated rank is not a run'],
  [['the-desert', 'the-journey'], 'two cards cannot meld'],
  [['the-desert', 'the-desert', 'the-journey'], 'the same card cannot appear twice'],
];
for (const [ids, msg] of noMelds) check(C.meldType(ids) === null, msg);

/* ---- the core agrees with the independent checker on every subset ---- */
{
  const rng = D_mulberry32(4242);
  let subsets = 0;
  for (let t = 0; t < 200; t++) {
    const hand = BASIC.slice();
    for (let i = hand.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [hand[i], hand[j]] = [hand[j], hand[i]];
    }
    const six = hand.slice(0, 6);
    for (let mask = 0; mask < (1 << 6); mask++) {
      const ids = six.filter((_, i) => mask & (1 << i));
      if (ids.length < 3) continue;
      subsets++;
      check(C.meldType(ids) === indMeldType(ids),
        `meldType(${ids.join()}) = ${C.meldType(ids)}, independent says ${indMeldType(ids)}`);
    }
  }
  console.log(`meld checker: ${subsets} subsets cross-checked`);
}

/* ---- a hand-built state helper ---- */
function state(spec = {}) {
  return {
    seed: 0,
    phase: spec.phase ?? 1,
    hand: spec.hand ?? [],
    draw: spec.draw ?? [],
    discard: spec.discard ?? [],
    archive: spec.archive ?? [],
    offer: false,
    moves: 0,
    over: null,
    ...spec.extra,
  };
}

const NOMELD6 = ['ace-of-moons', 'the-origin', 'the-mountain',
  'the-discovery', 'the-lunatic', 'the-huntress'];
check(C.handMelds(NOMELD6).length === 0, 'the no-meld fixture hand truly has no meld');

/* ---- melding: archive, refill, no mutation of the input ---- */
{
  const st = state({ hand: [...KIND, ...NOMELD6.slice(0, 3)], draw: NOMELD6.slice(3) });
  const next = C.applyMove(st, { type: 'meld', ids: KIND });
  check(next.archive.length === 1, 'meld archived');
  check(next.archive[0].type === 'suit' && C.isKindMeld(next.archive[0].ids),
    'the numbered three-of-a-kind is archived as the suit+kind meld it is');
  check(next.archive[0].ids.join() === KIND.join(), 'meld keeps its cards');
  check(next.hand.length === 6, `refilled to ${next.hand.length}`);
  check(next.hand.slice(3).join() === NOMELD6.slice(3).join(), 'refill drew the next cards');
  check(st.hand.length === 6 && st.archive.length === 0, 'the original state was not mutated');
  sameCards(st, next, 'after meld');
  check(next.moves === 1, `moves ${next.moves}`);
}

/* ---- illegal moves throw ---- */
{
  const st = state({ hand: [...KIND, ...NOMELD6.slice(0, 3)], draw: NOMELD6.slice(3) });
  const bad = [
    [{ type: 'discard' }, 'discard refused while the hand contains a meld'],
    [{ type: 'meld', ids: ['the-castle', 'the-chance-meeting'] }, 'two cards are not a meld'],
    [{ type: 'meld', ids: ['the-castle', 'the-cave', 'ace-of-moons'] }, 'not a meld at all'],
    [{ type: 'meld', ids: ['the-castle', 'the-chance-meeting', 'the-battle'] }, 'a card outside the hand'],
    [{ type: 'meld', ids: [] }, 'nothing selected'],
    [{ type: 'draw' }, 'draw outside the opening option'],
    [{ type: 'discard-top' }, 'discard-top outside the opening option'],
    [{ type: 'nonsense' }, 'unknown action'],
  ];
  for (const [action, msg] of bad) {
    let threw = false;
    try { C.applyMove(st, action); } catch { threw = true; }
    check(threw, msg);
  }
}

/* ---- discarding: only a meldless hand, order preserved, then refill ---- */
{
  const st = state({ hand: NOMELD6, draw: ['ace-of-suns', 'the-bard', 'the-painter'] });
  const next = C.applyMove(st, { type: 'discard' });
  check(next.phase === 2, 'the interlude fired when the draw ran out');
  check(next.discard.length === 0 && next.draw.length === 3,
    'the discard pile became the new draw pile');
  check(next.hand.join() ===
    ['ace-of-suns', 'the-bard', 'the-painter', 'ace-of-moons', 'the-origin', 'the-mountain'].join(),
    'the hand was topped up from the draw, then from the OLDEST discards');
  check(next.draw.join() === ['the-discovery', 'the-lunatic', 'the-huntress'].join(),
    'the newest discards come out at the end of pass two');
  sameCards(st, next, 'after discard into the interlude');
}

/* ---- re-ordering: swap only in a meldless hand ---- */
{
  const st = state({ hand: NOMELD6, draw: BASIC.filter((id) => !NOMELD6.includes(id)) });
  const next = C.applyMove(st, { type: 'swap', a: 0, b: 3 });
  check(next.hand[0] === NOMELD6[3] && next.hand[3] === NOMELD6[0], 'swap moved the two cards');
  check(next.hand.slice().sort().join() === NOMELD6.slice().sort().join(), 'swap lost no card');
  for (const action of [
    { type: 'swap', a: 1, b: 1 },
    { type: 'swap', a: 0, b: 9 },
    { type: 'swap', a: -1, b: 2 },
  ]) {
    let threw = false;
    try { C.applyMove(st, action); } catch { threw = true; }
    check(threw, `illegal swap ${JSON.stringify(action)} throws`);
  }
  const meldHand = state({ hand: [...KIND, ...NOMELD6.slice(0, 3)], draw: NOMELD6.slice(3) });
  let threw = false;
  try { C.applyMove(meldHand, { type: 'swap', a: 0, b: 1 }); } catch { threw = true; }
  check(threw, 're-ordering is refused while the hand contains a meld');
}

/* ---- the interlude: the discard pile becomes the draw pile, oldest first ---- */
{
  // Hand = three 7s, draw spent, Part One discard = [ace-moons, ace-suns, ace-waves].
  // Melding empties the hand, so the pass-two option applies.
  const st = state({
    hand: KIND,
    draw: [],
    discard: ['ace-of-moons', 'ace-of-suns', 'ace-of-waves'],
  });
  const after = C.applyMove(st, { type: 'meld', ids: KIND });
  check(after.phase === 2, 'interlude moved the game into pass two');
  check(after.offer === true, 'an empty hand at the interlude offers the top-card dump');
  check(after.draw.join() === ['ace-of-moons', 'ace-of-suns', 'ace-of-waves'].join(),
    'the new draw pile starts with the oldest discard');
  check(after.discard.length === 0, 'the part-two discard pile starts empty');

  // Take the option: dump the oldest discard, then draw the rest.
  const took = C.applyMove(after, { type: 'discard-top' });
  check(!took.offer, 'the option is spent');
  check(took.discard.join() === ['ace-of-moons'].join(), 'the dumped card went to the new discard');
  check(took.hand.join() === ['ace-of-suns', 'ace-of-waves'].join(), 'the rest became the hand');
  check(took.over === null, 'two cards still in hand: not over yet');
  const done = C.applyMove(took, { type: 'discard' });
  check(done.over === 'done', 'no cards left anywhere: game over');
  check(C.score(done) === 3, `score ${C.score(done)}, expected 3 (1 dumped + 2 discarded)`);

  // …or just draw.  Three aces make a kind meld, so the game can be closed
  // out at a perfect score of zero.
  const drew = C.applyMove(after, { type: 'draw' });
  check(!drew.offer && drew.hand.length === 3 && drew.discard.length === 0,
    'plain draw takes the whole new pile into the hand');
  check(drew.over === null, 'three cards still in hand: not over yet');
  let refused = false;
  try { C.applyMove(drew, { type: 'discard' }); } catch { refused = true; }
  check(refused, 'three aces are a kind meld: discard refused');
  const fin = C.applyMove(drew, { type: 'meld', ids: drew.hand });
  check(fin.over === 'done' && C.score(fin) === 0, 'melding the last cards ends the game at 0');

  let threw = false;
  try { C.applyMove(after, { type: 'discard' }); } catch { threw = true; }
  check(threw, 'discard is refused while the opening option is pending');
}

/* ---- a partial hand is refilled from the new draw pile, oldest first ---- */
{
  const st = state({
    hand: [...KIND, ...NOMELD6.slice(0, 3)],   // three 7s + three odd cards
    draw: [],
    discard: ['ace-of-suns', 'the-bard'],
  });
  const after = C.applyMove(st, { type: 'meld', ids: KIND });
  check(!after.offer, 'a non-empty hand gets no option');
  check(after.hand.join() === [...NOMELD6.slice(0, 3), 'ace-of-suns', 'the-bard'].join(),
    'the partial hand was topped up from the oldest discards');
  check(after.phase === 2 && after.draw.length === 0, 'second pass, draw spent');
}

/* ---- a hand-built end of game: score is the pass-two discard ---- */
{
  const st = state({ phase: 2, hand: ['the-mountain'], draw: [], discard: ['the-bard'] });
  const next = C.applyMove(st, { type: 'discard' });
  check(next.over === 'done', 'an empty hand and an empty draw ends pass two');
  check(C.score(next) === 2, `score ${C.score(next)}, expected 2`);
  let threw = false;
  try { C.applyMove(next, { type: 'discard' }); } catch { threw = true; }
  check(threw, 'acting after the game is over throws');
}

/* ---- the end-of-game fixture, computed on paper ----
 *
 * Hand: three 7s + [ace-of-moons, the-mountain, the-huntress] (no other meld:
 * ranks 1,4,10 never run together). Draw: [the-bard]. Part Two discard: [].
 *   meld the 7s            → archive 3 cards, hand refilled to [A,m,H,b]
 *   [ace-moons, mountain, huntress, bard] has suits moons,suns,crowns,leaves
 *   and ranks {1,4,10} — no meld → discard, game over, score = 4. */
{
  const st = state({
    phase: 2,
    hand: [...KIND, 'ace-of-moons', 'the-mountain', 'the-huntress'],
    draw: ['the-bard'],
    discard: [],
  });
  let s = C.applyMove(st, { type: 'meld', ids: KIND });
  check(s.hand.join() === ['ace-of-moons', 'the-mountain', 'the-huntress', 'the-bard'].join(),
    'fixture: hand after the meld');
  check(C.handMelds(s.hand).length === 0, 'fixture: no second meld in the hand');
  s = C.applyMove(s, { type: 'discard' });
  check(s.over === 'done', 'fixture: game over');
  check(C.score(s) === 4, `fixture: score ${C.score(s)}, paper says 4`);
  check(C.melded(s) === 3, 'fixture: 3 cards melded');
  check(s.discard.length === C.score(s), 'score is the pass-two discard');
  sameCards(st, s, 'fixture');
  const round = JSON.parse(JSON.stringify(s));
  check(round.discard.length === 4 && round.archive.length === 1, 'JSON round trip');
}

/* ---- full random playouts: a legal player always finishes ---- */
let totalScore = 0, overCount = 0;
for (let seed = 1; seed <= 300; seed++) {
  let st = C.newGame(seed, BASIC);
  const rng = D_mulberry32(seed * 7919 + 13);
  let guard = 0;
  while (!st.over && guard++ < 300) {
    if (st.offer) {
      st = C.applyMove(st, { type: rng() < 0.5 ? 'discard-top' : 'draw' });
    } else {
      const melds = C.handMelds(st.hand);
      if (melds.length) {
        const m = melds[Math.floor(rng() * melds.length)];
        st = C.applyMove(st, { type: 'meld', ids: m.ids });
      } else {
        st = C.applyMove(st, { type: 'discard' });
      }
    }
    conserved(st, `seed ${seed} move ${st.moves}`);
    check(st.hand.length <= 6, `seed ${seed}: hand ${st.hand.length} > 6`);
    for (const m of st.archive) {
      check(C.meldType(m.ids) === m.type, `seed ${seed}: bad meld in archive`);
    }
    const json = JSON.parse(JSON.stringify(st));
    check(json.hand.length === st.hand.length, `seed ${seed}: JSON round trip`);
  }
  check(st.over === 'done', `seed ${seed}: game never ended (guard ${guard})`);
  check(C.score(st) === 36 - C.melded(st),
    `seed ${seed}: score ${C.score(st)} != 36 - ${C.melded(st)} melded`);
  totalScore += C.score(st);
  overCount++;
}
console.log(`random playouts: ${overCount}/300 finished, average score ${(totalScore / overCount).toFixed(1)}`);
check(overCount === 300, 'every playout must finish');

console.log(failures === 0 ? 'head-solitaire: all tests passed' : `head-solitaire: ${failures} failures`);
process.exit(failures ? 1 : 0);
