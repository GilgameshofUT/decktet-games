/* Soliterrapin — game logic, no DOM.
 *
 * Rules: https://wiki.decktet.com/game:soliterrapin  (Mike Arlington)
 *
 * Flip the top card and place it on the table; every later card must be
 * placed on a free square touching an existing card, straight up/down/left/
 * right.  A row or column that holds six cards is sealed.  When all 36
 * cards are out, every row and column is scored as its own Terrapin hand:
 * a line showing all six suits is Turtle Butt and scores nothing, otherwise
 * it scores pairs (5 per pair, extra Aces/Crowns included) plus the longest
 * straight (2 per card after the first, Aces 1, Crowns 10, no wrap).
 *
 * Interpretations (all stated on the rules page):
 *   1. The wiki describes a free-form surface that ends up inside a 6x6
 *      grid; this app draws that 6x6 grid up front and lets the first card
 *      go in any of its 36 squares ("the center, a corner, on a side, or
 *      anywhere else").
 *   2. A card counts for *each* of its suits, so Turtle Butt is decided by
 *      the suits a line's cards bear between them.
 *   3. Pairs score 5 x (count - 1) per rank, which reproduces every figure
 *      the wiki gives (pair 5, three 10, four 15, five 20).
 *   4. The straight is the longest run of consecutive ranks present in the
 *      line (duplicates never extend it); only the longest scores, and
 *      ties are worth the same either way. */

import { mulberry32, rankValue, baseId } from '../decktet.js';

let BY_ID = null;
export const init = (byId) => { BY_ID = byId; };
export const card = (id) => BY_ID[baseId(id)];
export const rankOf = (id) => rankValue(card(id));
export const suitsOf = (id) => card(id).suits;

export const SIZE = 6;
const ALL_SUITS = ['moons', 'suns', 'waves', 'leaves', 'daemons', 'crowns'];

export const rowOf = (i) => Math.floor(i / SIZE);
export const colOf = (i) => i % SIZE;

/** Straight-line (non-diagonal) neighbours inside the 6x6 grid. */
export function neighbours(i) {
  const r = rowOf(i);
  const c = colOf(i);
  const out = [];
  if (c > 0) out.push(i - 1);
  if (c < SIZE - 1) out.push(i + 1);
  if (r > 0) out.push(i - SIZE);
  if (r < SIZE - 1) out.push(i + SIZE);
  return out;
}

export function newGame(seed, basicDeck) {
  const rng = mulberry32(seed);
  const deck = basicDeck.slice();
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return {
    seed,
    grid: Array(SIZE * SIZE).fill(null),
    deck: deck.slice(1),            // face down, top at index 0
    current: deck[0],               // the card just flipped
    moves: 0,
    over: null,
  };
}

/** Squares the current card may be placed on this turn. */
export function legalCells(state) {
  if (state.over) return [];
  if (!state.grid.some(Boolean)) return state.grid.map((_, i) => i);   // first card: anywhere
  const out = [];
  for (let i = 0; i < state.grid.length; i++) {
    if (state.grid[i]) continue;
    if (neighbours(i).some((n) => state.grid[n])) out.push(i);
  }
  return out;
}

export function canPlace(state, i) {
  return Number.isInteger(i) && legalCells(state).includes(i);
}

/** Place the current card on `cell`; flips the next card from the deck. */
export function applyMove(state, cell) {
  if (state.over) throw new Error('the game is over');
  if (!Number.isInteger(cell) || cell < 0 || cell >= SIZE * SIZE) throw new Error('bad cell');
  if (state.grid[cell]) throw new Error('that square is occupied');
  if (!canPlace(state, cell)) throw new Error('place next to a card already on the table');

  const next = structuredClone(state);
  next.grid[cell] = next.current;
  next.current = next.deck.length ? next.deck.shift() : null;
  next.moves += 1;
  if (next.grid.every(Boolean)) next.over = 'done';
  return next;
}

export const placed = (state) => state.grid.filter(Boolean).length;

/* --------------------------------------------------------------- scoring */

/**
 * Score one row or column (array of card ids; nulls ignored).
 * Returns { total, turtleButt, pairs: [{rank, count, points}],
 *           straight: { ranks: [], points } }.
 */
export function scoreLine(ids) {
  const cards = ids.filter(Boolean);
  const suits = new Set();
  for (const id of cards) for (const s of suitsOf(id)) suits.add(s);
  if (suits.size === 6) {
    return { total: 0, turtleButt: true, pairs: [], straight: { ranks: [], points: 0 } };
  }

  const counts = new Map();
  for (const id of cards) {
    const r = rankOf(id);
    counts.set(r, (counts.get(r) || 0) + 1);
  }

  const pairs = [];
  let pairPoints = 0;
  for (const [r, n] of counts) {
    if (n < 2) continue;
    const points = 5 * (n - 1);
    pairPoints += points;
    pairs.push({ rank: r, count: n, points });
  }
  pairs.sort((a, b) => a.rank - b.rank);

  let best = [];
  let run = [];
  for (let r = 1; r <= 10; r++) {           // Ace 1 … Crown 10, no wrap
    if (counts.has(r)) {
      run.push(r);
      if (run.length > best.length) best = run.slice();
    } else {
      run = [];
    }
  }
  const straightPoints = best.length >= 2 ? 2 * (best.length - 1) : 0;

  return {
    total: pairPoints + straightPoints,
    turtleButt: false,
    pairs,
    straight: { ranks: best, points: straightPoints },
  };
}

/** The board's twelve lines and their total. */
export function scoreGrid(grid) {
  const lines = [];
  for (let r = 0; r < SIZE; r++) {
    const ids = grid.slice(r * SIZE, r * SIZE + SIZE);
    lines.push({ kind: 'row', index: r, ids, ...scoreLine(ids) });
  }
  for (let c = 0; c < SIZE; c++) {
    const ids = grid.filter((_, i) => colOf(i) === c);
    lines.push({ kind: 'col', index: c, ids, ...scoreLine(ids) });
  }
  return { total: lines.reduce((n, l) => n + l.total, 0), lines };
}

/** A one-line breakdown for the score panel, e.g. "pair of 4s +5 · … = 11". */
export function describeLine(line) {
  const name = `${line.kind === 'row' ? 'Row' : 'Column'} ${line.index + 1}`;
  if (!line.ids.some(Boolean)) return `${name}: empty`;
  if (line.turtleButt) return `${name}: Turtle Butt — 0 points`;
  const parts = [];
  for (const p of line.pairs) {
    const label = p.rank === 10 ? 'Crowns' : p.rank === 1 ? 'Aces' : `${p.rank}s`;
    if (p.count === 2) parts.push(`pair of ${label} +${p.points}`);
    else parts.push(`${p.count} × ${label} +${p.points}`);
  }
  if (line.straight.points) {
    const rs = line.straight.ranks
      .map((r) => (r === 10 ? 'Crown' : r === 1 ? 'Ace' : String(r)));
    parts.push(`straight ${rs.join('–')} +${line.straight.points}`);
  }
  if (!parts.length) parts.push('nothing');
  return `${name}: ${parts.join(' · ')} = ${line.total}`;
}
