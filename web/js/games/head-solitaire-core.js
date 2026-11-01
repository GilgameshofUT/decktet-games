/* Head Solitaire — game logic, no DOM.
 *
 * Rules: https://wiki.decktet.com/game:head-solitaire
 * (design David L. Van Slyke, rules text P.D. Magnus)
 *
 * Hold the deck in one hand: a face-up hand of six cards on top, the draw
 * pile behind it, the archive of melds behind that, the discard pile at the
 * back.  Meld sets out of your hand and refill to six; when the draw pile
 * runs out the discard pile becomes the new draw pile (pass two).  When the
 * second pass is spent, the cards you never melded are your score — lower
 * is better.
 *
 * Interpretations (all stated on the rules page):
 *   1. A card counts for *each* of its suits, so a suit-meld's cards must
 *      bear the six suits exactly once between them (three disjoint two-suit
 *      cards qualify, as do the six aces), and a run's cards must each bear
 *      one single shared suit.
 *   2. One meld is placed per refill, exactly as the wiki words it ("place
 *      the meld … then draw more cards to refill your hand to six").
 *   3. A hand that contains a meld must meld it; the discard is only for
 *      hands with no meld in them.
 *   4. The discard pile becomes the new draw pile oldest-first — the front
 *      of the pile you held behind the archive is the first card you
 *      discarded — so re-ordering a discarded hand sets up the order in
 *      which you will see those cards again in pass two. */

import { mulberry32, rankValue, baseId, rankLabel, SUIT_NAME } from '../decktet.js';

let BY_ID = null;
export const init = (byId) => { BY_ID = byId; };
export const card = (id) => BY_ID[baseId(id)];
export const rankOf = (id) => rankValue(card(id));
export const suitsOf = (id) => card(id).suits;

export const HAND_SIZE = 6;
const ALL_SUITS = ['moons', 'suns', 'waves', 'leaves', 'daemons', 'crowns'];

/* ------------------------------------------------------------------ melds */

/** A suit-meld: the meld's cards bear each of the six suits exactly once. */
export function isSuitMeld(ids) {
  const counts = {};
  for (const id of ids) for (const s of suitsOf(id)) counts[s] = (counts[s] || 0) + 1;
  return ALL_SUITS.every((s) => counts[s] === 1);
}

/** A kind-meld: three or more cards of the same rank. */
export function isKindMeld(ids) {
  if (ids.length < 3) return false;
  const r = rankOf(ids[0]);
  return ids.every((id) => rankOf(id) === r);
}

/** A run-meld: three or more consecutive ranks (no wrap) sharing one suit. */
export function isRunMeld(ids) {
  if (ids.length < 3) return false;
  const ranks = ids.map(rankOf).sort((a, b) => a - b);
  if (new Set(ranks).size !== ranks.length) return false;          // distinct ranks
  if (ranks[ranks.length - 1] - ranks[0] !== ranks.length - 1) return false;  // consecutive
  return ALL_SUITS.some((s) => ids.every((id) => suitsOf(id).includes(s)));
}

/** 'suit' | 'kind' | 'run' | null — does this set of cards make one meld? */
export function meldType(ids) {
  if (!Array.isArray(ids) || ids.length < 3) return null;
  if (new Set(ids).size !== ids.length) return null;
  if (isSuitMeld(ids)) return 'suit';
  if (isKindMeld(ids)) return 'kind';
  if (isRunMeld(ids)) return 'run';
  return null;
}

const TYPE_RANK = { suit: 3, run: 2, kind: 1 };

/** Every meld inside a hand (all subsets of 3+ cards that meld). */
export function handMelds(hand) {
  const out = [];
  const n = hand.length;
  for (let mask = 0; mask < (1 << n); mask++) {
    const ids = hand.filter((_, i) => mask & (1 << i));
    if (ids.length < 3) continue;
    const type = meldType(ids);
    if (type) out.push({ type, ids });
  }
  return out;
}

/** A suggested meld for the hint button: the biggest, suit preferred. */
export function suggestMeld(hand) {
  const melds = handMelds(hand);
  if (!melds.length) return null;
  melds.sort((a, b) =>
    (b.ids.length - a.ids.length) || (TYPE_RANK[b.type] - TYPE_RANK[a.type]));
  return melds[0];
}

/** A short human label for a placed meld, e.g. "Run · Moons 1–2–3". */
export function meldLabel(meld) {
  if (meld.type === 'suit') {
    // The three cards of a numbered rank always split the six suits between
    // them, so a numbered three-of-a-kind is a suit meld and a kind meld.
    if (isKindMeld(meld.ids)) {
      return `Suit + kind meld · ${rankLabel(card(meld.ids[0]))} ×${meld.ids.length}`;
    }
    return `Suit meld · ${meld.ids.length} cards`;
  }
  if (meld.type === 'kind') {
    return `Kind meld · ${rankLabel(card(meld.ids[0]))} ×${meld.ids.length}`;
  }
  const suit = ALL_SUITS.find((s) => meld.ids.every((id) => suitsOf(id).includes(s)));
  const ranks = meld.ids.map(rankOf).sort((a, b) => a - b)
    .map((r) => (r === 10 ? 'Crown' : String(r)));
  return `Run · ${SUIT_NAME[suit]} ${ranks.join('–')}`;
}

/* ------------------------------------------------------------------ state */

export function newGame(seed, basicDeck) {
  const rng = mulberry32(seed);
  const deck = basicDeck.slice();
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return {
    seed,
    phase: 1,                       // pass one / pass two
    hand: deck.slice(0, HAND_SIZE), // face up, in your hand
    draw: deck.slice(HAND_SIZE),    // face down, top at index 0
    discard: [],                    // face up, oldest first
    archive: [],                    // placed melds
    offer: false,                   // pass-two opening option pending?
    moves: 0,
    over: null,
  };
}

/** Does this hand contain at least one meld? */
export const hasMeld = (state) => handMelds(state.hand).length > 0;

export const score = (state) => state.discard.length;
export const melded = (state) => state.archive.reduce((n, m) => n + m.ids.length, 0);

function refill(state) {
  while (state.hand.length < HAND_SIZE && state.draw.length) {
    state.hand.push(state.draw.shift());
  }
}

/** After an action: refill, run the interlude, check the end of the game. */
function advance(state) {
  refill(state);

  if (state.phase === 1 && state.draw.length === 0) {
    // Interlude: the discard pile becomes the new draw pile, face up,
    // oldest card first ("in front of" the archive you were holding).
    state.phase = 2;
    state.draw = state.discard;
    state.discard = [];
    if (state.hand.length === 0 && state.draw.length > 0) {
      state.offer = true;            // the wiki's optional dump of the top card
    } else {
      refill(state);                 // partial hand refilled from the new draw
    }
  }

  if (!state.offer && state.phase === 2 && state.draw.length === 0 && state.hand.length === 0) {
    state.over = 'done';
  }
  state.moves += 1;
}

/**
 * Apply one action:
 *   { type: 'meld', ids }   place a meld from the hand (refills to six)
 *   { type: 'discard' }     discard the whole hand (only when no meld in it)
 *   { type: 'swap', a, b }  reorder two hand cards (no-meld hands only)
 *   { type: 'draw' }        take the pass-two opening option: just draw six
 *   { type: 'discard-top' } …or dump the top of the new draw pile first
 */
export function applyMove(state, action) {
  if (state.over) throw new Error('the game is over');
  if (!action || typeof action.type !== 'string') throw new Error('no action');
  const next = structuredClone(state);

  switch (action.type) {
    case 'meld': {
      const ids = action.ids;
      if (!Array.isArray(ids) || !ids.length) throw new Error('nothing selected');
      if (!ids.every((id) => next.hand.includes(id))) throw new Error('not in your hand');
      if (meldType(ids) === null) throw new Error('not a meld');
      for (const id of ids) next.hand.splice(next.hand.indexOf(id), 1);
      next.archive.push({ type: meldType(ids), ids });
      break;
    }
    case 'discard': {
      if (next.offer) throw new Error('take the pass-two opening option first');
      if (!next.hand.length) throw new Error('your hand is empty');
      if (handMelds(next.hand).length) throw new Error('this hand contains a meld');
      next.discard.push(...next.hand);
      next.hand = [];
      break;
    }
    case 'swap': {
      if (next.offer) throw new Error('take the pass-two opening option first');
      const { a, b } = action;
      if (!Number.isInteger(a) || !Number.isInteger(b)
          || a < 0 || b < 0 || a >= next.hand.length || b >= next.hand.length) {
        throw new Error('bad hand index');
      }
      if (a === b) throw new Error('nothing to swap');
      if (handMelds(next.hand).length) throw new Error('re-ordering is for meldless hands');
      [next.hand[a], next.hand[b]] = [next.hand[b], next.hand[a]];
      break;
    }
    case 'draw': {
      if (!next.offer) throw new Error('no opening option here');
      next.offer = false;
      break;
    }
    case 'discard-top': {
      if (!next.offer) throw new Error('no opening option here');
      if (!next.draw.length) throw new Error('the new draw pile is empty');
      next.offer = false;
      next.discard.push(next.draw.shift());
      break;
    }
    default:
      throw new Error(`unknown action ${action.type}`);
  }

  advance(next);
  return next;
}
