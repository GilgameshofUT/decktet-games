/* Window — game logic, no DOM.
 *
 * Rules: https://wiki.decktet.com/game:window  (Cristyn Magnus / P.D. Magnus)
 *
 * Nine stacks of three face-down cards, one face up on each.  Move a stack's
 * whole face-up pile onto an orthogonally adjacent stack whose top card is one
 * rank away, then flip the top face-down card of the stack you left.  Merge
 * everything into one pile to win.
 *
 * Interpretation (noted on the rules page): two clauses of the wiki rules are
 * ambiguous —
 *   1. "Aces may move onto either 1s or Crowns" (an Ace *is* rank 1), read as
 *      the natural wrap: Ace meets 2 and Crown, Crown meets 9 and Ace;
 *   2. "a face up card on one stack … the face up card on an adjacent stack",
 *      read as *any* face-up card of the moving pile meeting the neighbour's
 *      top card.  A search over both readings shows strict top-vs-top never
 *      reaches a win, while this reading does. */

import { mulberry32, rankValue, baseId } from '../decktet.js';

let BY_ID = null;
export const init = (byId) => { BY_ID = byId; };
export const card = (id) => BY_ID[baseId(id)];
export const rankOf = (id) => rankValue(card(id));

export const SIZE = 3;                 // 3x3 grid
export const STACK_DEPTH = 3;           // three face-down cards per stack

/** Orthogonal neighbours in a 3x3 grid. */
export function neighbours(i) {
  const r = Math.floor(i / SIZE);
  const c = i % SIZE;
  const out = [];
  if (c > 0) out.push(i - 1);
  if (c < SIZE - 1) out.push(i + 1);
  if (r > 0) out.push(i - SIZE);
  if (r < SIZE - 1) out.push(i + SIZE);
  return out;
}

/** May a pile whose top card is `a` move onto a pile whose top card is `b`? */
export function ranksMeet(a, b) {
  if (a === b) return false;
  if (Math.abs(a - b) === 1) return true;
  return (a === 1 && b === 10) || (a === 10 && b === 1);   // Ace <-> Crown
}

export function newGame(seed, basicDeck) {
  const rng = mulberry32(seed);
  const deck = basicDeck.slice();
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  const stacks = Array.from({ length: SIZE * SIZE }, () => ({ down: [], up: [] }));
  for (let round = 0; round < STACK_DEPTH; round++) {
    for (const s of stacks) s.down.push(deck.pop());
  }
  for (const s of stacks) s.up.push(deck.pop());

  const st = { seed, stacks, moves: 0, over: null };
  settle(st);
  return st;
}

export const topCard = (stack) => (stack.up.length ? stack.up[stack.up.length - 1] : null);

/** May the pile on `from` move onto the pile on `to`?
 *
 *  The wiki: "When a face up card on one stack is a rank higher or lower than
 *  the face up card on an adjacent stack, you may take all the face up cards
 *  from one of the stacks and move them to the adjacent stack."
 *
 *  So: any face-up card of the moving pile must meet the neighbour's top card
 *  (a search over both readings shows this is the one that leaves the game
 *  solvable — strict top-vs-top never reaches a win).  An empty neighbour takes
 *  anything. */
export function canMove(state, from, to) {
  if (from === to) return false;
  if (!neighbours(from).includes(to)) return false;
  const src = state.stacks[from];
  if (!src.up.length) return false;                 // nothing to move
  const dst = state.stacks[to];
  if (!dst.up.length) return true;                  // into an empty space
  const top = rankOf(topCard(dst));
  return src.up.some((id) => ranksMeet(rankOf(id), top));
}

export function legalMoves(state) {
  const out = [];
  for (let from = 0; from < state.stacks.length; from++) {
    for (const to of neighbours(from)) {
      if (canMove(state, from, to)) out.push({ from, to });
    }
  }
  return out;
}

export function applyMove(state, from, to) {
  if (!canMove(state, from, to)) throw new Error(`illegal move ${from} -> ${to}`);
  const next = structuredClone(state);
  const src = next.stacks[from];
  const dst = next.stacks[to];
  dst.up.push(...src.up);
  src.up = [];
  if (src.down.length) src.up.push(src.down.pop());   // flip the next card over
  next.moves += 1;
  settle(next);
  return next;
}

export function faceDown(state) {
  return state.stacks.reduce((n, s) => n + s.down.length, 0);
}

export function cardsUp(state) {
  return state.stacks.reduce((n, s) => n + s.up.length, 0);
}

export function stacksLeft(state) {
  return state.stacks.filter((s) => s.down.length || s.up.length).length;
}

/** Win when one pile holds every card, all of it face up. */
export function isWon(state) {
  return stacksLeft(state) === 1 && faceDown(state) === 0;
}

/** Apply the end-of-game rules (called after setup and after every move). */
export function settle(state) {
  if (state.over) return;
  if (isWon(state)) state.over = 'won';
  else if (!legalMoves(state).length) state.over = 'lost';
}

export const OUTCOME = {
  won: { title: 'You win', cls: 'win', text: 'Every card has merged into a single pile.' },
  lost: { title: 'No moves left', cls: 'lose', text: 'No two neighbouring piles meet any more. The window stays shut.' },
};
