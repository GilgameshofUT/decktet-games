/* Kittyhawk — game logic, no DOM.
 *
 * Rules: https://wiki.decktet.com/game:kittyhawk  (Ezra Bradford, rules v2.0)
 *
 * Freecell-style solitaire with two Decktetts: six Foundation piles (one per
 * suit, started by the Aces), six Tableau piles, two Heap piles that new
 * cards enter through, and a Stock you deal six cards at a time from — three
 * onto each Heap.  Move single cards; when all 60+ cards are stacked on the
 * foundations you win.
 *
 * Two Decktetts make the deck, so cards carry instance ids: the second copy
 * of "the-author" is "the-author#2".  Look cards up with card()/baseId().
 *
 * Interpretations (all restated on the rules page):
 *   1. The wiki's deal rule says "put three of them on top of each of the
 *      two Stock piles" — "Stock piles" there means the two *Heap* piles.
 *   2. "You may move the top card of any stack" is read freecell-style: the
 *      moving card may be the top card of any tableau pile, heap, or
 *      foundation, and the destination rules below decide where it lands.
 *      So a foundation card can travel back to the tableau.
 *   3. Two-suit cards may go to either foundation whose Ace-suit they bear;
 *      tableau moves need a shared suit with the target card specifically.
 *   4. Levels 3 and 5 start with empty foundations and the Aces shuffled
 *      into the stock; any Ace may start any empty foundation, fixing that
 *      pile's suit.
 *   5. A deal always moves six stock cards: the first three onto the left
 *      heap, the next three onto the right (the wiki does not say which
 *      goes where).  You may deal at any time the stock has cards.
 *   6. The game is lost when no card can move and no deal is possible. */

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

export const SUITS = ['moons', 'suns', 'waves', 'leaves', 'daemons', 'crowns'];
export const TABLEAU_COUNT = 6;
export const HEAP_COUNT = 2;
export const DEAL_SIZE = 6;            // three onto each heap

const PAWNS = ['the-borderland', 'the-harvest', 'the-watchman'];
const COURTS = ['the-consul', 'the-island', 'the-window'];

export const LEVELS = [
  { level: 1, name: 'Level 1', deck: 60, blurb: 'the 60-card Myrmex deck; the Aces start the foundations' },
  { level: 2, name: 'Level 2', deck: 66, blurb: 'adds six Pawns — two each of all but the Light Keeper' },
  { level: 3, name: 'Level 3', deck: 60, blurb: 'no Pawns — the Aces are shuffled into the stock' },
  { level: 4, name: 'Level 4', deck: 72, blurb: 'adds six Pawns and six Courts — two each of all but the Rite' },
  { level: 5, name: 'Level 5', deck: 72, blurb: 'Aces, Pawns and Courts all — for true experts' },
];
export const DEFAULT_LEVEL = 1;
export const deckSize = (level) => (LEVELS.find((l) => l.level === level) || LEVELS[0]).deck;

/** The two-Decktetts Myrmex deck for one difficulty level. */
export function buildDeck(data, level = DEFAULT_LEVEL) {
  const basic = data.basicDeck;
  const aces = basic.filter((id) => card(id).rank === 1);
  const crowns = basic.filter((id) => card(id).rank === 'crown');
  const numbered = basic.filter((id) => { const r = card(id).rank; return r >= 2 && r <= 9; });
  const pairs = (ids) => ids.flatMap((id) => [id, id + '#2']);

  const deck = [...aces, ...crowns, ...pairs(numbered)];
  if (level === 2 || level === 4 || level === 5) deck.push(...pairs(PAWNS));
  if (level === 4 || level === 5) deck.push(...pairs(COURTS));
  return deck;
}

/* ------------------------------------------------------------------ setup */

export function newGame(seed, data, level = DEFAULT_LEVEL) {
  const rng = mulberry32(seed);
  const deck = buildDeck(data, level).slice();
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  // Levels 3 and 5 keep the Aces in the stock; the others lay one out per suit.
  const seededAces = level !== 3 && level !== 5;
  const foundations = SUITS.map((s) => (seededAces ? [`ace-of-${s}`] : []));
  if (seededAces) {
    for (const f of foundations) {
      const at = deck.indexOf(f[0]);
      if (at >= 0) deck.splice(at, 1);
    }
  }

  const tableau = Array.from({ length: TABLEAU_COUNT }, () => [deck.shift()]);
  const heaps = [
    Array.from({ length: 3 }, () => deck.shift()),      // three face-up cards each
    Array.from({ length: 3 }, () => deck.shift()),
  ];

  const st = {
    seed, level, total: deckSize(level),
    foundations, tableau, heaps, stock: deck,
    moves: 0, deals: 0, over: null,
  };
  settle(st);
  return st;
}

/* ------------------------------------------------------------------ moves */

const sharesSuit = (a, b) => suitsOf(a).some((s) => suitsOf(b).includes(s));

export function canMoveTo(state, id, toKind, i) {
  if (toKind === 'foundation') {
    const f = state.foundations[i];
    if (!f) return false;
    if (!f.length) return card(id).rank === 1;                 // any Ace starts the pile
    const top = f[f.length - 1];
    return orderOf(id) === orderOf(top) + 1 && sharesSuit(id, f[0]);
  }
  if (toKind === 'tableau') {
    const t = state.tableau[i];
    if (!t) return false;
    if (!t.length) return true;                                // any card into a blank space
    const top = t[t.length - 1];
    return orderOf(top) === orderOf(id) + 1 && sharesSuit(id, top);   // one rank lower
  }
  return false;                                                // heaps and stock take nothing
}

const topOf = (state, kind, i) => {
  const pile = kind === 'foundation' ? state.foundations[i]
    : kind === 'tableau' ? state.tableau[i]
      : kind === 'heap' ? state.heaps[i] : null;
  return pile && pile.length ? pile[pile.length - 1] : null;
};

export function legalMoves(state) {
  const out = [];
  const sources = [];
  for (let i = 0; i < TABLEAU_COUNT; i++) {
    const id = topOf(state, 'tableau', i);
    if (id) sources.push({ kind: 'tableau', i, id });
  }
  for (let i = 0; i < HEAP_COUNT; i++) {
    const id = topOf(state, 'heap', i);
    if (id) sources.push({ kind: 'heap', i, id });
  }
  for (let i = 0; i < SUITS.length; i++) {
    const id = topOf(state, 'foundation', i);
    if (id) sources.push({ kind: 'foundation', i, id });
  }
  for (const src of sources) {
    for (let i = 0; i < TABLEAU_COUNT; i++) {
      if (canMoveTo(state, src.id, 'tableau', i)) out.push({ from: src, to: { kind: 'tableau', i } });
    }
    for (let i = 0; i < SUITS.length; i++) {
      if (canMoveTo(state, src.id, 'foundation', i)) out.push({ from: src, to: { kind: 'foundation', i } });
    }
  }
  return out;
}

export function applyMove(state, fromKind, fromIdx, toKind, toIdx) {
  const id = topOf(state, fromKind, fromIdx);
  if (!id) throw new Error('that stack has no top card to move');
  if (fromKind === toKind && fromIdx === toIdx) throw new Error('a card may not move onto itself');
  if (!canMoveTo(state, id, toKind, toIdx)) {
    if (toKind === 'heap' || toKind === 'stock') throw new Error('cards only reach the heaps by dealing');
    throw new Error('that destination does not take this card');
  }

  const next = structuredClone(state);
  const pull = (kind, i) => {
    const pile = kind === 'foundation' ? next.foundations[i]
      : kind === 'tableau' ? next.tableau[i] : next.heaps[i];
    return pile.pop();
  };
  const push = (kind, i, cardId) => {
    const pile = kind === 'foundation' ? next.foundations[i]
      : kind === 'tableau' ? next.tableau[i] : next.heaps[i];
    pile.push(cardId);
  };
  push(toKind, toIdx, pull(fromKind, fromIdx));
  next.moves += 1;
  settle(next);
  return next;
}

/* ------------------------------------------------------------------ stock */

export const canDeal = (state) => state.stock.length >= DEAL_SIZE;

export function applyDeal(state) {
  if (!canDeal(state)) throw new Error('the stock cannot deal six cards');
  const next = structuredClone(state);
  for (let i = 0; i < HEAP_COUNT; i++) {
    for (let k = 0; k < DEAL_SIZE / HEAP_COUNT; k++) next.heaps[i].push(next.stock.shift());
  }
  next.deals += 1;
  settle(next);
  return next;
}

/* ------------------------------------------------------------- end states */

export const cardsIn = (state) => state.foundations.reduce((n, f) => n + f.length, 0);

/** Apply the end-of-game rules (after setup and after every action). */
export function settle(state) {
  if (state.over) return state;
  if (cardsIn(state) === state.total) state.over = 'won';
  else if (!legalMoves(state).length && !canDeal(state)) state.over = 'lost';
  return state;
}
