/* Ivory Tower — game logic, no DOM.
 *
 * Rules: https://wiki.decktet.com/game:ivory-tower  (P.D. Magnus)
 *
 * Build one tower: every card of a single suit, in order from Ace to Crown.
 * Cards you cannot use go onto up to three reserve piles.  A reserve pile
 * starts with a Crown and steps down in rank through cards sharing no suit
 * with the card below; only its lowest card is available to play.  Only the
 * top card of the draw pile is available too.  When nothing can be played,
 * turn over three more cards from the deck; when the deck runs out, flip the
 * draw pile over and keep going.
 *
 * Interpretation (noted on the rules page):
 *   1. "turning over the top three cards of the deck, so that you can only
 *      see the third card" — read as: the draw pile is a face-up pile whose
 *      top card is the only one you can see, and playing it exposes the card
 *      beneath.  Recycling flips the whole draw pile face down, so the card
 *      that was at its bottom becomes the next one you turn over.
 *   2. "If at anytime you are unable to play" — read as: the draw pile's top
 *      card fits nowhere (neither the tower nor a pile).  Turning over more
 *      cards is then allowed even if a reserve pile could still be shuffled
 *      around; otherwise the game could deadlock on endless shuffling.
 *   3. The wiki defines only the win.  This app ends a lost game when the
 *      tower cannot take a card and the deck's recycle cycle offers nothing
 *      that fits the piles as they stand: nothing new can ever arrive, and
 *      going on would only be endless shuffling.  The score is then the rank
 *      of the highest card in the tower (0 for an empty tower). */

import { mulberry32, rankValue, baseId } from '../decktet.js';

let BY_ID = null;
export const init = (byId) => { BY_ID = byId; };
export const card = (id) => BY_ID[baseId(id)];
export const rankOf = (id) => rankValue(card(id));
export const suitsOf = (id) => card(id).suits;

export const PILES = 3;        // resource piles you may have at most
export const TURNS = 3;        // cards turned over at a time
export const TOWER_LEN = 10;   // Ace, 2 … 9, Crown

/** Do two cards share a suit symbol? */
export const shareSuit = (a, b) => suitsOf(a).some((s) => suitsOf(b).includes(s));

/* ------------------------------------------------------------------ setup */

export function newGame(seed, basicDeck) {
  const rng = mulberry32(seed);
  const deck = basicDeck.slice();
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  // "turning over the top three cards of the deck, so that you can only see
  // the third card" — three cards onto the draw pile, third one on top.
  const draw = [];
  for (let i = 0; i < TURNS; i++) draw.push(deck.pop());

  const st = { seed, deck, draw, tower: [], reserves: [[], [], []], moves: 0, over: null };
  settle(st);
  return st;
}

/* ------------------------------------------------------------- the tower */

export const towerTopRank = (state) =>
  (state.tower.length ? rankOf(state.tower[state.tower.length - 1]) : 0);

/** The tower's suit: fixed by the Ace that starts it. */
export const towerSuit = (state) =>
  (state.tower.length ? suitsOf(state.tower[0])[0] : null);

/** May `id` be played onto the tower?  An Ace may start an empty tower. */
export function canPlayToTower(state, id) {
  const r = rankOf(id);
  if (!state.tower.length) return r === 1;
  return r === towerTopRank(state) + 1 && suitsOf(id).includes(towerSuit(state));
}

/* -------------------------------------------------------- resource piles */

/** May `id` go on top of (i.e. become the new lowest card of) pile `i`? */
export function canPlayToReserve(state, id, i) {
  const pile = state.reserves[i];
  if (!pile.length) return rankOf(id) === 10;        // a pile starts with a Crown
  return rankOf(id) === rankOf(pile[0]) - 1 && !shareSuit(id, pile[0]);
}

/* ------------------------------------------------------- available cards */

/** The card a source offers: the draw pile's top, or a pile's lowest card. */
export function cardOf(state, src) {
  if (src === 'draw') return state.draw.length ? state.draw[state.draw.length - 1] : null;
  const pile = state.reserves[src];
  return pile && pile.length ? pile[0] : null;
}

/** Where the card at `src` may go: 'tower' or a pile index. */
export function destinations(state, src) {
  const id = cardOf(state, src);
  if (!id || state.over) return [];
  const out = [];
  if (canPlayToTower(state, id)) out.push('tower');
  for (let i = 0; i < PILES; i++) {
    if (src === i) continue;                          // a pile may not feed itself
    if (canPlayToReserve(state, id, i)) out.push(i);
  }
  return out;
}

export function legalMoves(state) {
  const out = [];
  for (const src of ['draw', 0, 1, 2]) {
    for (const dest of destinations(state, src)) out.push({ src, dest });
  }
  return out;
}

/* -------------------------------------------------------------- the deck */

/** Can `id` be played anywhere at all — the tower, or any pile? */
export function playableAnywhere(state, id) {
  if (canPlayToTower(state, id)) return true;
  for (let i = 0; i < PILES; i++) {
    if (canPlayToReserve(state, id, i)) return true;
  }
  return false;
}

/** Turning over is allowed when the draw pile's top card fits nowhere. */
export function canTurnOver(state) {
  if (state.over) return false;
  const top = state.draw.length ? state.draw[state.draw.length - 1] : null;
  if (top && playableAnywhere(state, top)) return false;
  return state.deck.length > 0 || state.draw.length > 0;
}

export function applyTurnOver(state) {
  if (!canTurnOver(state)) throw new Error('cannot turn over');
  const next = structuredClone(state);
  if (!next.deck.length) {
    // "turn over the draw pile" — flipped face down, its bottom card on top
    next.deck = next.draw.slice().reverse();
    next.draw = [];
  }
  const n = Math.min(TURNS, next.deck.length);
  for (let i = 0; i < n; i++) next.draw.push(next.deck.pop());
  next.moves += 1;
  settle(next);
  return next;
}

/* ------------------------------------------------------------ the moves */

/** Move the card at `src` ('draw' | 0 | 1 | 2) to `dest` ('tower' | 0 | 1 | 2). */
export function applyMove(state, mv) {
  const { src, dest } = mv;
  if (!destinations(state, src).includes(dest)) {
    throw new Error(`illegal move ${String(src)} -> ${String(dest)}`);
  }
  const next = structuredClone(state);
  const id = src === 'draw' ? next.draw.pop() : next.reserves[src].shift();
  if (dest === 'tower') next.tower.push(id);
  else next.reserves[dest].unshift(id);
  next.moves += 1;
  settle(next);
  return next;
}

/* ----------------------------------------------------------------- end */

export const isWon = (state) => state.tower.length === TOWER_LEN;

/** Rank of the highest card in the tower: the wiki's score when you lose. */
export const score = (state) => towerTopRank(state);

/**
 * Would the draw cycle ever offer a playable card — the top card now, or a
 * card that comes up as you turn the pile over?
 *
 *  Draws expose every third card of the current pile, and a full recycle
 *  brings the same sequence round again, so a deterministic walk of the
 *  deck/draw partition answers it exactly.
 */
function anyFuturePlay(st) {
  const top = st.draw.length ? st.draw[st.draw.length - 1] : null;
  if (top && playableAnywhere(st, top)) return true;
  let deck = st.deck.slice();
  let draw = st.draw.slice();
  const seen = new Set();
  for (;;) {
    if (!deck.length) {
      if (!draw.length) return false;
      deck = draw.slice().reverse();
      draw = [];
    }
    const n = Math.min(TURNS, deck.length);
    for (let i = 0; i < n; i++) draw.push(deck.pop());
    if (playableAnywhere(st, draw[draw.length - 1])) return true;
    const key = `${deck.length}|${draw.length}|${draw[draw.length - 1]}`;
    if (seen.has(key)) return false;
    seen.add(key);
  }
}

/** Can any card be added to the tower right now? */
export function towerMovePossible(state) {
  return legalMoves(state).some((m) => m.dest === 'tower');
}

/** Apply the end-of-game rules (after setup and after every action). */
export function settle(state) {
  if (state.over) return;
  if (isWon(state)) { state.over = 'won'; return; }
  if (!towerMovePossible(state) && !anyFuturePlay(state)) state.over = 'lost';
}

export const OUTCOME = {
  won: { title: 'You win', cls: 'win', text: 'The tower stands complete: Ace to Crown, one suit all the way up.' },
  lost: { title: 'No plays left', cls: 'lose', text: 'No card in the deck cycle can be played any more. The tower is unfinished.' },
};
