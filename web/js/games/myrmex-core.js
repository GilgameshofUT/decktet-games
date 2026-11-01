/* Myrmex — game logic, no DOM.
 *
 * Rules: https://wiki.decktet.com/game:myrmex  (Greg James)
 *
 * Spider solitaire with two Decktetts.  Eight tableau piles; move the top
 * card (or a run of consecutive same-suit cards) onto a pile whose top card
 * is one rank higher, or into an empty space.  Complete a suit sequence from
 * Crown down to Ace and the ten cards leave play as one of six chambers.
 * Restock the tableau from the draw pile whenever you like; the game ends
 * when the draw pile is empty and no moves remain.
 *
 * Two Decktetts make the deck, so cards carry instance ids: the second copy
 * of "the-author" is "the-author#2".  Look cards up with card()/baseId().
 *
 * Interpretations (all restated on the rules page):
 *   1. Rank order is Court > Pawn > Crown > 9 … 2 > Ace.  A *single* card may
 *      move onto any card one rank higher regardless of suit ("any 7 may be
 *      moved onto any 8"); a *group* must be consecutive descending and
 *      share one suit between all of its cards.
 *   2. A chamber is exactly the top ten cards of a pile forming Crown-…-Ace
 *      of one suit; only those ten cards are removed, anything beneath them
 *      stays put (and is flipped up if it is the last card of a closed pile).
 *   3. Restocking is a voluntary action ("when you feel that you have
 *      exhausted all of the useful moves").  You may only deal when every
 *      pile holds at least one card — the standard Spider restriction, not
 *      spelled out in the wiki.  It never blocks play: an empty pile can
 *      always receive any card or run, so "no moves left" implies no empty
 *      piles and a legal deal.
 *   4. The last restock is partial in every level (the wiki's "final partial
 *      restocking deal" of 4 for the 60/66-card games generalises: deal one
 *      card per pile, left to right, until the draw pile is spent).
 *   5. Difficulty levels follow the wiki's tougher variants exactly: Major
 *      Worker adds two each of The Borderland, The Harvest and The Watchman
 *      (both Light Keepers removed) and deals 38 cards; Queen additionally
 *      adds two each of The Consul, The Island and The Window (both Rites
 *      removed too) and deals 32 cards, as in the basic game.  Major and
 *      Queen deal their initial tableau face up, as the wiki requires; the
 *      easier "Larval Stage" variant does the same for the basic game.
 *   6. The wiki grades wins by the clock (15/25 minutes); this app grades by
 *      chambers instead and records the move count. */

import { mulberry32, baseId } from '../decktet.js';

let BY_ID = null;
export const init = (byId) => { BY_ID = byId; };
export const card = (id) => BY_ID[baseId(id)];
export const suitsOf = (id) => card(id).suits;

/** Play order: Ace 1 … 9, Crown 10, Pawn 11, Court 12. */
export function orderOf(id) {
  const c = card(id);
  if (c.rank === 'court') return 12;
  if (c.rank === 'pawn') return 11;
  if (c.rank === 'crown') return 10;
  return c.rank;                       // Ace 1 … numbered 2-9
}

export const PILE_COUNT = 8;
export const CHAMBER_COUNT = 6;
const SEQUENCE = 10;                   // Crown down to Ace

const PAWNS = ['the-borderland', 'the-harvest', 'the-watchman'];
const COURTS = ['the-consul', 'the-island', 'the-window'];

export const LEVELS = [
  { id: 'minor', name: 'Minor Worker', blurb: 'the basic 60-card game' },
  { id: 'major', name: 'Major Worker', blurb: 'adds 6 Pawns — Light Keepers removed · 66 cards' },
  { id: 'queen', name: 'Queen', blurb: 'adds Pawns and 6 Courts — Light Keepers and Rites removed · 72 cards' },
];
export const DEFAULT_LEVEL = 'minor';

/** The two-Decktetts Myrmex deck for one difficulty level. */
export function buildDeck(data, level = DEFAULT_LEVEL) {
  const basic = data.basicDeck;
  const aces = basic.filter((id) => card(id).rank === 1);
  const crowns = basic.filter((id) => card(id).rank === 'crown');
  const numbered = basic.filter((id) => { const r = card(id).rank; return r >= 2 && r <= 9; });
  const pairs = (ids) => ids.flatMap((id) => [id, id + '#2']);

  const deck = [...aces, ...crowns, ...pairs(numbered)];
  if (level !== 'minor') deck.push(...pairs(PAWNS));
  if (level === 'queen') deck.push(...pairs(COURTS));
  return deck;
}

export const deckSize = (level) => (level === 'minor' ? 60 : level === 'major' ? 66 : 72);

/* ------------------------------------------------------------------ setup */

export function newGame(seed, data, level = DEFAULT_LEVEL, larval = false) {
  const rng = mulberry32(seed);
  const deck = buildDeck(data, level).slice();
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  // Major/Queen deal their tableau face up by rule; Larval Stage does the
  // same for the basic game.
  const open = larval || level !== 'minor';
  const piles = Array.from({ length: PILE_COUNT }, () => ({ down: [], up: [] }));

  if (level === 'major') {
    // 38 cards: the first six piles get 5, the last two get 4 — all face up.
    for (let round = 0; round < 5; round++) {
      for (let i = 0; i < 6; i++) piles[i].up.push(deck.shift());
    }
    for (let round = 0; round < 4; round++) {
      for (let i = 6; i < PILE_COUNT; i++) piles[i].up.push(deck.shift());
    }
  } else {
    // 32 cards: three face-down rows of 8, then the face-up top cards.
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < PILE_COUNT; i++) (open ? piles[i].up : piles[i].down).push(deck.shift());
    }
    for (let i = 0; i < PILE_COUNT; i++) piles[i].up.push(deck.shift());
  }

  const st = {
    seed, level, larval: !!larval,
    piles, stock: deck, chambers: [],
    moves: 0, deals: 0, over: null,
  };
  settle(st);
  return st;
}

/* ------------------------------------------------------------------ moves */

/** Cards sharing every one of these suits. */
export function commonSuits(ids) {
  let out = suitsOf(ids[0]).slice();
  for (const id of ids.slice(1)) {
    const s = suitsOf(id);
    out = out.filter((x) => s.includes(x));
    if (!out.length) break;
  }
  return out;
}

/** The movable run lengths (in cards, counted from the top) of a pile. */
export function legalRuns(state, from) {
  const up = state.piles[from]?.up || [];
  if (!up.length) return [];
  const depths = [1];
  for (let d = 2; d <= up.length; d++) {
    const lower = up[up.length - d];      // deeper in the pile, higher rank
    const above = up[up.length - d + 1];
    if (orderOf(lower) === orderOf(above) + 1 && commonSuits([lower, above]).length) depths.push(d);
    else break;
  }
  return depths;
}

export function canMove(state, from, to, depth = 1) {
  if (!Number.isInteger(from) || !Number.isInteger(to)) return false;
  if (from < 0 || from >= PILE_COUNT || to < 0 || to >= PILE_COUNT) return false;
  if (from === to) return false;
  if (!legalRuns(state, from).includes(depth)) return false;
  const dst = state.piles[to];
  if (!dst.up.length) return true;                        // any card or run fills a void
  const bottom = state.piles[from].up[state.piles[from].up.length - depth];
  return orderOf(dst.up[dst.up.length - 1]) === orderOf(bottom) + 1;
}

export function legalMoves(state) {
  const out = [];
  for (let from = 0; from < PILE_COUNT; from++) {
    const up = state.piles[from].up;
    for (const depth of legalRuns(state, from)) {
      const bottom = up[up.length - depth];
      for (let to = 0; to < PILE_COUNT; to++) {
        if (to === from) continue;
        const dst = state.piles[to];
        if (!dst.up.length || orderOf(dst.up[dst.up.length - 1]) === orderOf(bottom) + 1) {
          out.push({ from, to, depth });
        }
      }
    }
  }
  return out;
}

export function applyMove(state, from, to, depth = 1) {
  if (!Number.isInteger(from) || from < 0 || from >= PILE_COUNT) throw new Error('bad source pile');
  if (!Number.isInteger(to) || to < 0 || to >= PILE_COUNT) throw new Error('bad target pile');
  if (from === to) throw new Error('a pile may not move onto itself');
  const runs = legalRuns(state, from);
  if (!runs.includes(depth)) {
    throw new Error(depth > (runs[0] || 0)
      ? 'cards only move together as a run of consecutive same-suit cards'
      : 'that pile has no cards to move');
  }
  const dst = state.piles[to];
  const bottom = state.piles[from].up[state.piles[from].up.length - depth];
  if (dst.up.length && orderOf(dst.up[dst.up.length - 1]) !== orderOf(bottom) + 1) {
    throw new Error(`only onto a card one rank higher — that pile's top is rank ` +
      `${orderOf(dst.up[dst.up.length - 1])}, the run starts at rank ${orderOf(bottom)}`);
  }

  const next = structuredClone(state);
  const src = next.piles[from];
  const run = src.up.splice(src.up.length - depth, depth);
  next.piles[to].up.push(...run);
  if (!src.up.length && src.down.length) src.up.push(src.down.pop());   // flip up
  next.moves += 1;
  settle(next);
  return next;
}

/* ---------------------------------------------------------------- restock */

export const canDeal = (state) =>
  state.stock.length > 0 && state.piles.every((p) => p.up.length || p.down.length);

export function applyDeal(state) {
  if (!state.stock.length) throw new Error('the draw pile is exhausted');
  const empty = state.piles.findIndex((p) => !p.up.length && !p.down.length);
  if (empty >= 0) throw new Error('fill every empty pile before restocking');

  const next = structuredClone(state);
  const n = Math.min(PILE_COUNT, next.stock.length);
  for (let i = 0; i < n; i++) next.piles[i].up.push(next.stock.shift());
  next.deals += 1;
  settle(next);
  return next;
}

/* ------------------------------------------------------------- end states */

/** Top ten cards of a pile forming Crown … Ace of one suit?  Index or -1. */
function chamberIndex(pile) {
  const up = pile.up;
  if (up.length < SEQUENCE) return -1;
  for (let i = 0; i < SEQUENCE; i++) {
    if (orderOf(up[up.length - SEQUENCE + i]) !== SEQUENCE - i) return -1;
  }
  const run = up.slice(-SEQUENCE);
  return commonSuits(run).length ? up.length - SEQUENCE : -1;
}

/** Apply the end-of-game rules (after setup and after every action). */
export function settle(state) {
  if (state.over) return state;
  let changed = true;
  while (changed) {
    changed = false;
    for (const pile of state.piles) {
      const idx = chamberIndex(pile);
      if (idx < 0) continue;
      const cards = pile.up.splice(idx, SEQUENCE);
      state.chambers.push({ suit: commonSuits(cards)[0], cards });
      if (!pile.up.length && pile.down.length) pile.up.push(pile.down.pop());
      changed = true;
    }
  }
  if (state.chambers.length === CHAMBER_COUNT) state.over = 'won';
  else if (!state.stock.length && !legalMoves(state).length) state.over = 'lost';
  return state;
}

export const faceDown = (state) => state.piles.reduce((n, p) => n + p.down.length, 0);
export const cardsUp = (state) =>
  state.piles.reduce((n, p) => n + p.up.length, 0) +
  state.chambers.reduce((n, c) => n + c.cards.length, 0);

export const OUTCOME = {
  won: { title: 'Full victory', cls: 'win', text: 'All six chambers are filled with sorted material. You may enter the Queen’s chamber.' },
};
