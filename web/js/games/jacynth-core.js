/* Jacynth (solitaire) — game logic, no DOM.  Imported by the UI
   (games/jacynth.js) and by the node test (test/jacynth.test.mjs).

   Rules: https://wiki.decktet.com/game:jacynth  (the Solitaire variant)

   The city is a 4x4 grid; four corner cards are dealt to start and your first
   influence token must go on one of them.  Each turn: play a card from your
   hand into an empty space sharing an edge with a card already in play
   (number cards trigger a flip from the top of the deck), optionally place
   one influence token, then draw.  Score one point per card in each district
   you control.  Every play adds exactly one card to the city, so the game
   ends when the city is full (16 cards = 12 plays).

   State is plain JSON (arrays of card ids, numbers, booleans) so it survives
   structuredClone + localStorage. */

import { mulberry32, rankValue, SUITS } from '../decktet.js';

export { rankValue };

export const GRID = 4;
export const CELLS = GRID * GRID;
export const HAND_SIZE = 3;
export const TOKEN_TOTAL = 4;

/* n-th token must be placed by the time the city holds so many cards;
   the fourth token may go down at any time (deadline null). */
const TOKEN_DEADLINES = [null, null, 8, 12, null];

let BY_ID = null;

export function init(cardsById) {
  BY_ID = cardsById;
}

export const card = (id) => BY_ID[id];

/** Official solitaire rank table, lowest first. */
export const RANK_TITLES = [
  { min: 0, title: 'Outsider' },
  { min: 11, title: 'Respectable citizen' },
  { min: 15, title: 'Aspiring noble' },
  { min: 19, title: 'Favoured courtier' },
  { min: 24, title: 'Power broker' },
  { min: 27, title: 'Mogul' },
  { min: 30, title: 'Prince of the city' },
];

export function rankTitle(points) {
  let title = RANK_TITLES[0].title;
  for (const r of RANK_TITLES) if (points >= r.min) title = r.title;
  return title;
}

/* ----------------------------------------------------------------- setup */

/** Fresh shuffled game: four corner cards in the city, three in hand, and the
 *  rest face down.  The first influence token is placed by the caller via
 *  placeToken() on one of the four starting cards. */
export function newGame(seed, deckIds, opts = {}) {
  const rng = mulberry32(seed);
  const deck = deckIds.slice();
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const st = {
    seed,
    rng: (seed ^ 0x9e3779b9) >>> 0,
    grid: Array(CELLS).fill(null),
    corners: [],
    hand: [],
    deck,
    discard: [],
    tokenCards: [],
    phase: 'setup',            // 'setup' | 'token' | 'idle'
    lastFlip: null,
    moves: 0,
    over: null,                // null | 'done'
  };
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      if ((r === 0 || r === GRID - 1) && (c === 0 || c === GRID - 1)) {
        const i = r * GRID + c;
        st.grid[i] = deck.pop();
        st.corners.push(i);
      }
    }
  }
  for (let k = 0; k < HAND_SIZE; k++) st.hand.push(deck.pop());
  return st;
}

/* -------------------------------------------------------------- city/grid */

export const cityCount = (st) => st.grid.reduce((n, id) => n + (id ? 1 : 0), 0);

export function orthogonal(i) {
  const r = (i / GRID) | 0;
  const c = i % GRID;
  const out = [];
  if (r > 0) out.push(i - GRID);
  if (r < GRID - 1) out.push(i + GRID);
  if (c > 0) out.push(i - 1);
  if (c < GRID - 1) out.push(i + 1);
  return out;
}

/** Empty cells sharing an edge with a card already in the city. */
export function emptyAdjacentCells(st) {
  const out = [];
  for (let i = 0; i < CELLS; i++) {
    if (st.grid[i]) continue;
    if (orthogonal(i).some((n) => st.grid[n])) out.push(i);
  }
  return out;
}

/** Where may `cardId` (a card in hand) be played right now?  Empty when the
 *  game is over, during setup, or while a token deadline is outstanding. */
export function legalCells(st, cardId) {
  if (!st || st.over || st.phase !== 'idle' || tokenDue(st)) return [];
  if (cardId != null && !st.hand.includes(cardId)) return [];
  return emptyAdjacentCells(st);
}

/* ------------------------------------------------------------- tokens */

/** The number of the token whose deadline is outstanding (2 or 3), or 0. */
export function dueToken(st) {
  const placed = st.tokenCards.length;
  const city = cityCount(st);
  for (let n = 2; n <= 3; n++) {
    if (placed < n && city >= TOKEN_DEADLINES[n]) return n;
  }
  return 0;
}

export const tokenDue = (st) => dueToken(st) > 0;

/** Place one influence token on `cardId`.
 *  - during setup it must go on one of the four starting cards;
 *  - afterwards only just after playing a card (at most one per turn);
 *  - never twice on the same card, never more than four in total.
 *  In the token phase this also ends the turn (draw + settle), matching the
 *  wiki order: play, influence, draw. */
export function placeToken(st, cardId) {
  if (!st || st.over) throw new Error('the game is over');
  if (st.tokenCards.length >= TOKEN_TOTAL) throw new Error('no influence tokens left');
  const idx = st.grid.indexOf(cardId);
  if (idx === -1) throw new Error(`${cardId} is not in the city`);
  if (st.tokenCards.includes(cardId)) throw new Error('that card already holds a token');

  if (st.phase === 'setup') {
    if (!st.corners.includes(idx)) throw new Error('the first token goes on a starting card');
    const next = structuredClone(st);
    next.tokenCards.push(cardId);
    next.phase = 'idle';
    return next;
  }
  if (st.phase !== 'token') {
    throw new Error('you may only place a token just after playing a card');
  }
  const next = structuredClone(st);
  next.tokenCards.push(cardId);
  finishTurn(next);
  return next;
}

/* ------------------------------------------------------------- the turn */

const isNumberCard = (c) => typeof c.rank === 'number' && c.rank >= 2 && c.rank <= 9;

/** One step of the stateful rng (same algorithm as mulberry32), so flips stay
 *  deterministic per seed and survive save/restore. */
function rngStep(st) {
  let a = (st.rng + 0x6d2b79f5) | 0;
  st.rng = a;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Draw one card if any remain, close the turn, and settle.  Mutates. */
function finishTurn(st) {
  if (st.deck.length) st.hand.push(st.deck.pop());
  st.phase = 'idle';
  settle(st);
}

function settle(st) {
  if (st.over) return;
  // The city always fills long before the deck runs out, but keep the
  // exhaustion case as a safety net for odd decks.
  if (st.grid.every((id) => id)) st.over = 'done';
  else if (!st.hand.length && !st.deck.length) st.over = 'done';
}

/** Play `cardId` from hand into `cellIndex`.
 *  Flip rule (wiki): playing a number card (2-9) flips the top of the deck —
 *  an Ace/Crown/Pawn/Court is discarded and your card is placed as normal; a
 *  number card of equal or higher rank discards YOUR card and takes the spot;
 *  a number card of lower rank is discarded and your card is placed as normal
 *  (the last case is unstated on the wiki — see the note on the rules page).
 *  If four tokens are already placed the turn ends immediately; otherwise the
 *  state enters the 'token' phase, closed by placeToken() or endTurn(). */
export function playCard(st, cellIndex, cardId) {
  if (!st || st.over) throw new Error('the game is over');
  if (st.phase !== 'idle') throw new Error(`cannot play during the '${st.phase}' phase`);
  if (tokenDue(st)) throw new Error('the required influence token must be placed first');
  if (!st.hand.includes(cardId)) throw new Error(`${cardId} is not in your hand`);
  if (!Number.isInteger(cellIndex) || cellIndex < 0 || cellIndex >= CELLS) {
    throw new Error('bad cell index');
  }
  if (st.grid[cellIndex]) throw new Error('that space is already occupied');
  if (!emptyAdjacentCells(st).includes(cellIndex)) {
    throw new Error('a played card must touch the city along an edge');
  }

  const next = structuredClone(st);
  next.hand = next.hand.filter((id) => id !== cardId);

  const mine = card(cardId);
  let placed = cardId;
  let flipped = null;
  let result = 'none';        // 'none' | 'court' | 'beaten' | 'lower'
  if (isNumberCard(mine) && next.deck.length) {
    flipped = next.deck.pop();
    const theirs = card(flipped);
    if (!isNumberCard(theirs)) {
      next.discard.push(flipped);                 // Ace/Crown/Pawn/Court: gone
      result = 'court';
    } else if (rankValue(theirs) >= rankValue(mine)) {
      next.discard.push(cardId);                  // theirs takes the spot
      placed = flipped;
      result = 'beaten';
    } else {
      next.discard.push(flipped);                 // lower: yours stands
      result = 'lower';
    }
  }
  next.grid[cellIndex] = placed;
  next.lastFlip = { played: cardId, flipped, placed, result };
  next.moves += 1;

  if (next.tokenCards.length >= TOKEN_TOTAL) finishTurn(next);
  else next.phase = 'token';
  return next;
}

/** End the turn without placing a token.  Refused while a token deadline is
 *  outstanding — then the token must be placed first. */
export function endTurn(st) {
  if (!st || st.over) throw new Error('the game is over');
  if (st.phase !== 'token') throw new Error('there is no turn to finish');
  if (tokenDue(st)) throw new Error('the required influence token must be placed first');
  const next = structuredClone(st);
  finishTurn(next);
  return next;
}

/* ------------------------------------------------------------- scoring */

/** Maximal orthogonal groups of adjacent cards sharing a suit.  A two-suit
 *  card belongs to two districts.  Returns [{ suit, cells, size }]. */
export function districts(st) {
  const out = [];
  for (const suit of SUITS) {
    const open = new Set();
    for (let i = 0; i < CELLS; i++) {
      const id = st.grid[i];
      if (id && card(id).suits.includes(suit)) open.add(i);
    }
    while (open.size) {
      const start = open.values().next().value;
      open.delete(start);
      const stack = [start];
      const cells = [];
      while (stack.length) {
        const i = stack.pop();
        cells.push(i);
        for (const n of orthogonal(i)) {
          if (open.has(n)) { open.delete(n); stack.push(n); }
        }
      }
      cells.sort((a, b) => a - b);
      out.push({ suit, cells, size: cells.length });
    }
  }
  return out;
}

const controls = (st, d) => d.cells.some((i) => st.tokenCards.includes(st.grid[i]));

/** One point per card in each district you control; a card sitting in two
 *  controlled districts counts twice, a district counts once however many
 *  tokens you have on it. */
export function score(st) {
  return districts(st).reduce((sum, d) => sum + (controls(st, d) ? d.size : 0), 0);
}

export function scoreBreakdown(st) {
  const ds = districts(st);
  const controlled = ds.filter((d) => controls(st, d));
  return {
    score: controlled.reduce((sum, d) => sum + d.size, 0),
    districts: ds.length,
    controlled: controlled.length,
  };
}
