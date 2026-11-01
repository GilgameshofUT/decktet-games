/* Colour Bazaar — game logic, no DOM.
 *
 * Rules: https://wiki.decktet.com/game:colour-bazaar  (P.D. Magnus)
 *
 * Commodity speculation in the Sapphire Ports.  Each of the six suits is a
 * style of fabric; four markets (the Pawn cards) grow stacks of cards that
 * set the style's value.  Every turn: play a card onto a stack whose top
 * shares a suit (or, forced, discard one), take one suit chip of your choice,
 * draw a card.  The game ends when the last of the 30 suit chips (five per
 * suit) is taken; each chip is then worth what its style fetched across all
 * four stacks.
 *
 * Extra material, emulated here: the 30 suit chips are counters in the state
 * (supply + holdings), and the scoring pad is the on-screen table of live
 * suit values.
 *
 * Implemented for exactly two players, pass-and-play.  Interpretations (all
 * restated on the rules page):
 *   1. Two players only (the wiki allows 2-3); 30 chips, five per suit, so
 *      fifteen turns each.
 *   2. Deck: the basic 36-card deck.  The Courts are NOT used — the wiki
 *      calls them optional — so the Court pressure rule never applies.
 *   3. The four Pawns (from the extended deck) are the untouched bases of the
 *      four markets; they are not part of the 36 cards and never score.
 *   4. Scoring a suit per stack: the number card of that suit closest to the
 *      top counts, except that a stack holding a Crown of that suit
 *      contributes the HIGHEST-ranked number card of the suit instead (the
 *      wiki's example: a Crown of Moons over an 8 and a 2 of Moons makes the
 *      stack worth 8 for Moons).  A Crown whose suit has no number card in
 *      the stack contributes nothing.
 *   5. A forced discard goes to a face-up discard pile that is never
 *      reshuffled; when the draw pile is empty you simply draw nothing. */

import { rankValue, baseId } from '../decktet.js';

let BY_ID = null;
export const init = (byId) => { BY_ID = byId; };
export const card = (id) => BY_ID[baseId(id)];
export const rankOf = (id) => rankValue(card(id));
export const suitsOf = (id) => card(id).suits;

export const SUITS = ['moons', 'suns', 'waves', 'leaves', 'daemons', 'crowns'];
export const PAWNS = ['the-borderland', 'the-harvest', 'the-light-keeper', 'the-watchman'];
export const CHIPS_PER_SUIT = 5;
export const MARKETS = 4;
export const HAND_SIZE = 4;

const zeroChips = () => Object.fromEntries(SUITS.map((s) => [s, 0]));
const isNumber = (id) => typeof card(id).rank === 'number';      // Ace…9; not Pawn/Court/Crown
const isCrown = (id) => card(id).rank === 'crown';

/* ------------------------------------------------------------------- rng */

function rand(st) {
  let a = (st.rngState + 0x6d2b79f5) | 0;
  st.rngState = a;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/* ---------------------------------------------------------------- setup */

export function newGame(seed, deck) {
  if (deck.length !== 36) throw new Error(`the basic Decktet is 36 cards, got ${deck.length}`);
  const st = {
    seed, rngState: seed >>> 0, moves: 0,
    hands: [[], []],
    draw: deck.slice(),
    discard: [],
    stacks: PAWNS.map((p) => [p]),
    supply: Object.fromEntries(SUITS.map((s) => [s, CHIPS_PER_SUIT])),
    chips: [zeroChips(), zeroChips()],
    turn: 0, phase: 'play',          // play | chip
    over: null, winner: null,
    notes: [],
  };
  for (let i = st.draw.length - 1; i > 0; i--) {
    const j = Math.floor(rand(st) * (i + 1));
    [st.draw[i], st.draw[j]] = [st.draw[j], st.draw[i]];
  }
  for (let p = 0; p < 2; p++) {
    for (let i = 0; i < HAND_SIZE; i++) st.hands[p].push(st.draw.pop());
  }
  st.notes = ['Player 1 begins: influence fashion, invest in a style, draw.'];
  return st;
}

/* --------------------------------------------------------------- markets */

export const topOf = (state, si) => {
  const stack = state.stacks[si];
  return stack[stack.length - 1];
};

export const sharesSuit = (id, other) => suitsOf(id).some((s) => suitsOf(other).includes(s));

/** May `id` be played onto market `si` (whose top card is `top`)? */
export const canPlay = (state, id, si) => {
  const stack = state.stacks[si];
  if (!stack) return false;
  return sharesSuit(id, stack[stack.length - 1]);
};

/** Every (card, market) legal play for player `p`. */
export function legalPlays(state, p = state.turn) {
  const out = [];
  for (const id of state.hands[p]) {
    for (let si = 0; si < state.stacks.length; si++) {
      if (canPlay(state, id, si)) out.push({ id, si });
    }
  }
  return out;
}

export const anyLegalPlay = (state, p = state.turn) => legalPlays(state, p).length > 0;

/* --------------------------------------------------------------- actions */

const phaseGuard = (state, phase) => {
  if (state.over) throw new Error('the game is over');
  if (state.phase !== phase) {
    throw new Error(`that can only happen in the ${phase} phase — this is the ${state.phase} phase`);
  }
};

/** Influence fashion: play one card onto one of the four markets. */
export function playCard(state, id, si) {
  phaseGuard(state, 'play');
  const p = state.turn;
  if (!state.hands[p].includes(id)) {
    throw new Error(`${card(id)?.name || id} is not in Player ${p + 1}'s hand`);
  }
  if (!Number.isInteger(si) || si < 0 || si >= state.stacks.length) {
    throw new Error(`there are ${state.stacks.length} markets, 0 to ${state.stacks.length - 1}`);
  }
  if (!canPlay(state, id, si)) {
    if (!anyLegalPlay(state, p)) {
      throw new Error(`nothing in your hand fits any market — you must discard a card instead`);
    }
    const top = topOf(state, si);
    throw new Error(`market ${si + 1} is topped by ${card(top).name} ` +
      `(${suitsOf(top).map((s) => s[0].toUpperCase() + s.slice(1)).join(' and ')}); ` +
      `${card(id).name} shares no suit with it`);
  }
  const next = structuredClone(state);
  next.hands[p].splice(next.hands[p].indexOf(id), 1);
  next.stacks[si].push(id);
  next.phase = 'chip';
  next.moves += 1;
  next.notes = [`Player ${p + 1} adds ${card(id).name} to market ${si + 1}.`];
  return next;
}

/** Forced: when nothing fits anywhere, one card must be discarded. */
export function discardCard(state, id) {
  phaseGuard(state, 'play');
  const p = state.turn;
  if (!state.hands[p].includes(id)) {
    throw new Error(`${card(id)?.name || id} is not in Player ${p + 1}'s hand`);
  }
  if (anyLegalPlay(state, p)) {
    const { id: fit, si } = legalPlays(state, p)[0];
    throw new Error(`you may not choose to discard — ${card(fit).name} could still be ` +
      `played on market ${si + 1}`);
  }
  const next = structuredClone(state);
  next.hands[p].splice(next.hands[p].indexOf(id), 1);
  next.discard.push(id);
  next.phase = 'chip';
  next.moves += 1;
  next.notes = [`Player ${p + 1} discards ${card(id).name}: nothing fitted.`];
  return next;
}

/** Invest: take one chip of a style still on offer. The last chip ends the game. */
export function takeChip(state, suit) {
  phaseGuard(state, 'chip');
  const p = state.turn;
  if (!SUITS.includes(suit)) throw new Error(`${suit} is not one of the six styles`);
  if (state.supply[suit] < 1) {
    throw new Error(`every ${suit} chip has already been taken — pick another style`);
  }
  const next = structuredClone(state);
  next.chips[p][suit] += 1;
  next.supply[suit] -= 1;
  next.moves += 1;
  const supplyLeft = SUITS.reduce((n, s) => n + next.supply[s], 0);
  if (supplyLeft === 0) {
    next.over = 'done';
    next.winner = pickWinner(next);
    next.notes = ['The last chip is taken: the cargo ships arrive. Scores are tabulated.'];
    return next;
  }
  // draw a card (none if the pile is depleted), then the other player's turn
  if (next.draw.length) next.hands[p].push(next.draw.pop());
  next.turn = 1 - next.turn;
  next.phase = 'play';
  next.notes = [`Player ${p + 1} invests in ${suit}; Player ${next.turn + 1} to play.`];
  return next;
}

/* --------------------------------------------------------------- scoring */

/** What one chip of `suit` is worth: the sum of the four markets. */
export function chipValue(state, suit) {
  return state.stacks.reduce((n, stack) => n + stackContribution(stack, suit), 0);
}

/**
 * One market's contribution to a style: the number card of that suit closest
 * to the top — unless a Crown of the suit is present, in which case the
 * highest-ranked number card of the suit in that market counts instead.
 */
export function stackContribution(stack, suit) {
  const crowned = stack.some((id) => isCrown(id) && suitsOf(id).includes(suit));
  if (crowned) {
    let best = 0;
    for (const id of stack) {
      if (isNumber(id) && suitsOf(id).includes(suit)) best = Math.max(best, rankOf(id));
    }
    return best;
  }
  for (let i = stack.length - 1; i >= 0; i--) {
    const id = stack[i];
    if (isNumber(id) && suitsOf(id).includes(suit)) return rankOf(id);
  }
  return 0;
}

/** The full pad: per-style values, per-market breakdown, both scores. */
export function score(state) {
  const values = Object.fromEntries(SUITS.map((s) => [s, chipValue(state, s)]));
  const markets = state.stacks.map((stack) =>
    Object.fromEntries(SUITS.map((s) => [s, stackContribution(stack, s)])));
  const players = state.chips.map((ch) => SUITS.reduce((n, s) => n + ch[s] * values[s], 0));
  return { values, markets, players };
}

function pickWinner(st) {
  const { players } = score(st);
  return players[0] === players[1] ? null : (players[0] > players[1] ? 0 : 1);
}

/* -------------------------------------------------------------- plumbing */

/** Every card in circulation: hands, draw, discard and the markets' cards. */
export function allCards(state) {
  return [...state.hands[0], ...state.hands[1], ...state.draw, ...state.discard,
    ...state.stacks.flat().filter((id) => !PAWNS.includes(id))];
}

export const chipsInPlay = (state) =>
  SUITS.reduce((n, s) => n + state.supply[s] + state.chips[0][s] + state.chips[1][s], 0);

/** One entry point for the UI and the playouts: { type, … }. */
export function applyMove(state, action) {
  switch (action.type) {
    case 'play': return playCard(state, action.id, action.si);
    case 'discard': return discardCard(state, action.id);
    case 'chip': return takeChip(state, action.suit);
    default: throw new Error(`unknown action ${action.type}`);
  }
}

/** Every legal move from this state, for random playouts. */
export function legalActions(state) {
  if (state.over) return [];
  if (state.phase === 'play') {
    const plays = legalPlays(state);
    if (plays.length) return plays.map(({ id, si }) => ({ type: 'play', id, si }));
    return state.hands[state.turn].map((id) => ({ type: 'discard', id }));
  }
  if (state.phase === 'chip') {
    return SUITS.filter((s) => state.supply[s] > 0).map((suit) => ({ type: 'chip', suit }));
  }
  return [];
}
