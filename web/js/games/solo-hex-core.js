/* Solo Hex — game logic, no DOM.
 *
 * Rules: https://wiki.decktet.com/game:solo-hex  (tsilver33)
 *
 * Seven piles in a hexagon (rows of 2, 3, 2).  Each pile is face down except
 * its top card.  Each turn move a pile's whole face-up stack onto an
 * adjacent pile whose top card shares at least one suit; the pile you left
 * flips its next card face up.  An emptied pile stays empty.  The three
 * middle piles hide a sideways card fourth from the bottom: when it is
 * revealed it must immediately jump to a neighbouring pile.  Merge every
 * card into one face-up pile to win.
 *
 * Interpretations (each explained on the rules page):
 *   1. the prose deals 41 of the extended deck's 45 cards — 5,5 / 7,7,7 /
 *      5,5 — so the remaining four are set aside, as the setup photo shows.
 *   2. "Also move any face up cards under it with the move" makes a pile's
 *      face-up cards travel as a stack: covering a pile keeps its top card
 *      face up under the moved card (the wiki's Chinese translation and a
 *      published playthrough read it the same way — "like Window with a hex
 *      layout").  A move therefore always transfers the whole face-up block.
 *   3. the sideways card is the fourth card from the bottom of a 7-card pile
 *      (the prose's dealing order); the photo draws it nearer the top.
 *   4. a revealed sideways card with no adjacent pile sharing a suit "flips
 *      out": an immediate loss.  Empty piles share nothing.
 *   5. with several legal jump targets the player picks one; a sideways
 *      Excuse jumps to the lowest-ranked neighbour in the reference sheet's
 *      order (Ace < 2…9 < Pawn < Court < Crown; player's choice on a tie,
 *      "any card adjacent" when nothing numbered is near).
 *   6. anything may be moved or jumped onto the Excuse's pile — suit ignored
 *      ("the excuse must be jumped onto from any other card") — and the
 *      Excuse itself never moves, so an Excuse-topped pile never moves.
 *   7. victory needs the single pile to be all face up, as written: a lone
 *      pile that still hides face-down cards can never expose them (empty
 *      piles may not receive), so it is a loss, not a near win. */

import { mulberry32, rankValue } from '../decktet.js';

let BY_ID = null;
export const init = (byId) => { BY_ID = byId; };
export const card = (id) => BY_ID[String(id).split('#')[0]];
export const rankOf = (id) => rankValue(card(id));      // the Excuse is 0
export const suitsOf = (id) => card(id).suits;
export const isExcuse = (id) => rankOf(id) === 0;

/** The reference sheet's rank order, for the sideways Excuse's jump:
 *  Ace 1 … 9, then Pawn, Court, Crown. */
export function sheetRank(id) {
  const r = card(id).rank;
  if (r === 'pawn') return 10;
  if (r === 'court') return 11;
  if (r === 'crown') return 12;
  return rankValue(card(id));                          // Ace 1, 2..9, Excuse 0
}

export const PILE_SIZES = [5, 5, 7, 7, 7, 5, 5];        // top row, middle row, bottom row
export const SIDEWAYS_PILES = [2, 3, 4];                // the three middle piles
export const SIDeways_INDEX = 3;                        // fourth card from the bottom
export const SET_ASIDE = 4;                             // 45 - 41

/** Hexagonal neighbours of the seven piles (2-3-2). */
export const NEIGHBOURS = [
  [2, 3],                        // 0 top-left
  [3, 4],                        // 1 top-right
  [0, 3, 5],                     // 2 middle-left
  [0, 1, 2, 4, 5, 6],            // 3 middle-centre — every other pile
  [1, 3, 6],                     // 4 middle-right
  [2, 3],                        // 5 bottom-left
  [3, 4],                        // 6 bottom-right
];

export function newGame(seed, deck) {
  const rng = mulberry32(seed);
  const d = deck.slice();
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }

  const piles = PILE_SIZES.map((n, i) => ({
    cards: d.splice(0, n),                                 // bottom -> top
    up: 1,                                                 // the top card is face up
    sideways: SIDEWAYS_PILES.includes(i) ? SIDeways_INDEX : null,
  }));

  const st = {
    seed,
    deckSize: deck.length,
    piles,
    setAside: d.slice(),
    moves: 0,
    over: null,
    loss: null,          // 'flipout' | 'stuck' on a loss
    pending: null,       // { pile, excuse } while a sideways card must jump
  };
  settle(st);
  return st;
}

export const pileTop = (state, i) => {
  const p = state.piles[i];
  return p && p.cards.length ? p.cards[p.cards.length - 1] : null;
};
export const pilesLeft = (state) => state.piles.filter((p) => p.cards.length).length;

/** May the top card of pile `from` (with its face-up stack) move onto `to`? */
export function canMove(state, from, to) {
  if (from === to) return false;
  if (!NEIGHBOURS[from].includes(to)) return false;    // hexagonal adjacency
  const a = pileTop(state, from);
  const b = pileTop(state, to);
  if (!a || !b) return false;                       // nothing to move / nothing to move onto
  if (isExcuse(a)) return false;                    // the Excuse never moves
  if (isExcuse(b)) return true;                     // anything lands on the Excuse
  return suitsOf(a).some((s) => suitsOf(b).includes(s));
}

export function legalMoves(state) {
  if (state.pending) return [];                     // resolve the jump first
  const out = [];
  for (let from = 0; from < state.piles.length; from++) {
    if (!state.piles[from].cards.length) continue;
    for (const to of NEIGHBOURS[from]) {
      if (canMove(state, from, to)) out.push({ from, to });
    }
  }
  return out;
}

/** Why `from` may not move onto `to` — or null when it may. */
export function moveRejection(state, from, to) {
  if (from === to) return 'A pile cannot move onto itself.';
  if (!NEIGHBOURS[from].includes(to)) return 'Those piles are not hexagonally adjacent.';
  if (!state.piles[from].cards.length) return 'That pile is empty.';
  if (!state.piles[to].cards.length) return 'That pile is empty for the rest of the game.';
  const a = pileTop(state, from);
  const b = pileTop(state, to);
  if (isExcuse(a)) return 'The Excuse never moves — other cards jump onto it.';
  if (isExcuse(b)) return null;
  return `${card(a).name} shares no suit with ${card(b).name}.`;
}

/** Move pile `from`'s whole face-up stack onto pile `to`. */
export function applyMove(state, from, to) {
  if (state.pending) throw new Error('resolve the sideways jump first');
  if (!canMove(state, from, to)) throw new Error(`illegal move ${from} -> ${to}`);
  const next = structuredClone(state);
  const src = next.piles[from];
  const dst = next.piles[to];
  const n = src.up;                                  // the face-up stack travels as one
  dst.cards.push(...src.cards.splice(src.cards.length - n, n));
  dst.up += n;
  if (src.cards.length) src.up = 1;                  // flip the next card face up
  else src.up = 0;
  next.moves += 1;
  expose(next, from);
  settle(next);
  return next;
}

/** The revealed card of pile `i` is sideways: it must jump at once. */
function expose(state, i) {
  const p = state.piles[i];
  if (p.sideways == null) return;
  if (p.cards.length !== p.sideways + 1) return;        // not the sideways card yet
  const targets = jumpTargets(state, i);
  if (!targets.length) {                               // "flip out" — the game is over
    state.over = 'flipout';
    state.loss = 'flipout';
    return;
  }
  state.pending = { pile: i, excuse: isExcuse(p.cards[p.cards.length - 1]) };
}

/** Where a revealed sideways card may jump. */
export function jumpTargets(state, i) {
  const p = state.piles[i];
  if (!p || !p.cards.length) return [];
  const id = pileTop(state, i);
  const ns = NEIGHBOURS[i].filter((j) => state.piles[j].cards.length);
  if (isExcuse(id)) {
    const ranked = ns.filter((j) => !isExcuse(pileTop(state, j)));
    if (ranked.length) {
      const low = Math.min(...ranked.map((j) => sheetRank(pileTop(state, j))));
      return ranked.filter((j) => sheetRank(pileTop(state, j)) === low);
    }
    return ns;                                          // no numbered cards: any adjacent card
  }
  return ns.filter((j) => canMove(state, i, j));        // shares a suit — or the Excuse
}

/** The sideways card of `state.pending.pile` jumps alone onto pile `to`. */
export function applyJump(state, to) {
  if (!state.pending) throw new Error('no sideways jump is pending');
  const from = state.pending.pile;
  const targets = jumpTargets(state, from);
  if (!targets.includes(to)) throw new Error(`illegal jump to pile ${to}`);
  const next = structuredClone(state);
  const src = next.piles[from];
  next.piles[to].cards.push(src.cards.pop());
  next.piles[to].up += 1;                              // it lands face up
  src.up = src.cards.length ? 1 : 0;                   // the pile beneath flips up
  src.sideways = null;                                 // it has jumped: no longer sideways
  next.pending = null;
  settle(next);
  return next;
}

/** Cards in the biggest pile — how close to the single pile that wins. */
export const score = (state) => Math.max(...state.piles.map((p) => p.cards.length));

export function allCards(state) {
  return [...state.piles.flatMap((p) => p.cards), ...state.setAside];
}

/** One pile, and every card in it face up. */
export function isWon(state) {
  const live = state.piles.filter((p) => p.cards.length);
  return live.length === 1 && live[0].up === live[0].cards.length;
}

export function settle(state) {
  if (state.over) return;
  if (isWon(state)) { state.over = 'won'; return; }
  if (state.pending) return;                            // the jump must resolve first
  if (!legalMoves(state).length) { state.over = 'stuck'; state.loss = 'stuck'; }
}

export const OUTCOME = {
  won: { title: 'You win', cls: 'win', text: 'Every card has merged into a single face-up pile.' },
  flipout: {
    title: 'Flip out',
    cls: 'lose',
    text: 'A sideways card was revealed with no neighbouring pile sharing one of its suits. The game is over.',
  },
  stuck: { title: 'No moves left', cls: 'lose', text: 'No two neighbouring piles share a suit any more.' },
};
