/* Emu Ranchers — game logic, no DOM.
 *
 * Rules: https://wiki.decktet.com/game:emu-ranchers  (P.D. Magnus)
 *
 * Two players raise birds.  A bird is a stack of cards that all share one
 * suit, kept in rank order (gaps allowed).  Each turn: hatch a new bird, grow
 * an existing one, or discard — then draw.  When the last card leaves the draw
 * pile the year ends: both players lay whatever fits onto their own birds,
 * then every bird is scored against an upkeep cost of 18.  Four years make a
 * game; alternate who goes first each year.
 *
 * Interpretations (noted on the rules page):
 *   1. "Aces are below 1s" is read as a slip for "below 2s": Ace is the lowest
 *      rank, Crown the highest (the wiki's own scoring examples agree).
 *   2. Year end runs seat by seat — the player who drew the last card plays
 *      out first, then the opponent; "may lay down" is permissive, so cards
 *      left unplayed when a player finishes are discarded.
 *   3. Upkeep is paid optimally: the app discards number cards summing to at
 *      least 18 that waste the least, and shows the payment after scoring.
 *   4. Four years per game; the higher total wins, a tie is a draw. */

import { mulberry32, rankValue, baseId } from '../decktet.js';

let BY_ID = null;
export const init = (byId) => { BY_ID = byId; };
export const card = (id) => BY_ID[baseId(id)];
export const rankOf = (id) => rankValue(card(id));
export const suitsOf = (id) => card(id).suits;

export const HAND_SIZE = 6;
export const YEARS = 4;
export const UPKEEP = 18;

export const isAce = (id) => card(id).rank === 1;
export const isCrown = (id) => card(id).rank === 'crown';
export const isNumberCard = (id) => typeof card(id).rank === 'number' && card(id).rank > 1;

/* ---------------------------------------------------------------- stacks */

/** The suits every card in the stack shares. */
export function commonSuits(stack) {
  if (!stack.length) return new Set();
  const set = new Set(suitsOf(stack[0]));
  for (let i = 1; i < stack.length; i++) {
    const s = suitsOf(stack[i]);
    for (const x of [...set]) if (!s.includes(x)) set.delete(x);
  }
  return set;
}

/** May `id` be added to the top of this stack? */
export function growFits(stack, id) {
  if (!stack.length) return false;
  if (!suitsOf(id).some((s) => commonSuits(stack).has(s))) return false;
  if (stack.length === 1) return true;               // suit and direction open
  const rs = stack.map(rankOf);
  const last = rs[rs.length - 1];
  const increasing = rs.every((r, i) => i === 0 || r > rs[i - 1]);
  const decreasing = rs.every((r, i) => i === 0 || r < rs[i - 1]);
  const r = rankOf(id);
  if (increasing) return r > last;
  if (decreasing) return r < last;
  return false;                                       // never happens by construction
}

/** Display info for one bird: shared suits, direction, number-card total. */
export function stackInfo(stack) {
  const nums = stack.filter(isNumberCard).map(rankOf);
  let dir = null;
  if (stack.length > 1) {
    const rs = stack.map(rankOf);
    dir = rs[1] > rs[0] ? 'up' : rs[1] < rs[0] ? 'down' : null;
  }
  return {
    suits: [...commonSuits(stack)],
    dir,
    total: nums.reduce((a, b) => a + b, 0),
    ace: stack.some(isAce),
    crown: stack.some(isCrown),
  };
}

/* --------------------------------------------------------------- scoring */

/** Smallest sum of number cards reaching the upkeep cost of 18: the subset
 *  itself (as indices), so the payment wastes the least. */
export function minUpkeep(nums) {
  const total = nums.reduce((a, b) => a + b, 0);
  if (total < UPKEEP) return null;
  let bestSum = total, bestMask = (1 << nums.length) - 1, bestCount = nums.length;
  for (let mask = 0; mask < (1 << nums.length); mask++) {
    let s = 0, c = 0;
    for (let i = 0; i < nums.length; i++) {
      if (mask & (1 << i)) { s += nums[i]; c++; }
    }
    if (s >= UPKEEP && (s < bestSum || (s === bestSum && c < bestCount))) {
      bestSum = s; bestMask = mask; bestCount = c;
    }
  }
  return { sum: bestSum, mask: bestMask };
}

/** Score one bird at year end: profit positive, loss negative.
 *  { score, upkeep: [ids discarded to pay the cost] } */
export function scoreStack(stack) {
  const nums = stack.filter(isNumberCard);
  const total = nums.map(rankOf).reduce((a, b) => a + b, 0);
  const bonus = (stack.some(isAce) && stack.some(isCrown)) ? 10
    : (stack.some(isAce) || stack.some(isCrown)) ? 5 : 0;

  if (total < UPKEEP) return { score: -(UPKEEP - total + bonus), upkeep: [] };

  // pay upkeep: discard number cards summing to at least 18, wasting least
  const want = minUpkeep(nums.map(rankOf));
  const upkeep = nums.filter((_, i) => want.mask & (1 << i));
  const paid = upkeep.reduce((a, id) => a + rankOf(id), 0);
  return { score: (total - paid) + bonus, upkeep };
}

/* ----------------------------------------------------------------- setup */

export function newGame(seed, deck, first = 0) {
  const rng = mulberry32(seed);
  const shuffled = deck.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const state = {
    seed,
    year: 1,
    first,
    hands: [[], []],
    draw: shuffled,       // drawn from the end
    discard: [],
    ranch: [[], []],      // per seat: stacks of card ids, in play order
    turn: first,
    phase: 'action',      // 'action' | 'draw' | 'year-end' | 'scored'
    mustDrawDeck: false,  // the player discarded, so the draw is forced
    yeSeat: null,         // whose year-end plays it is
    yeDone: [false, false],
    scores: [0, 0],
    yearLog: [],          // { year, scores: [a, b] } per finished year
    lastScore: null,
    over: null,           // 'year' | 'game'
    winner: null,
    moves: 0,
  };

  for (let p = 0; p < 2; p++) {
    for (let i = 0; i < HAND_SIZE; i++) state.hands[p].push(state.draw.pop());
  }
  return state;
}

/* ----------------------------------------------------------------- moves */

export const seatOf = (state) => (state.phase === 'year-end' ? state.yeSeat : state.turn);

export function canHatch(state, id) {
  return state.phase === 'action' && state.hands[state.turn].includes(id);
}

export function canGrow(state, id, idx) {
  if (state.phase !== 'action') return false;
  const stack = state.ranch[state.turn][idx];
  return !!stack && state.hands[state.turn].includes(id) && growFits(stack, id);
}

export function canYeGrow(state, id, idx) {
  if (state.phase !== 'year-end') return false;
  const seat = state.yeSeat;
  const stack = state.ranch[seat][idx];
  return !!stack && state.hands[seat].includes(id) && growFits(stack, id);
}

export function canDiscardCard(state, id) {
  return state.phase === 'action' && state.hands[state.turn].includes(id);
}

function actOnHand(state, id, fn) {
  const next = structuredClone(state);
  const hand = next.hands[next.turn];
  hand.splice(hand.indexOf(id), 1);
  fn(next);
  next.phase = 'draw';
  return next;
}

export function hatch(state, id) {
  if (!canHatch(state, id)) throw new Error(`cannot hatch ${id}`);
  return actOnHand(state, id, (next) => next.ranch[next.turn].push([id]));
}

export function grow(state, id, idx) {
  if (!canGrow(state, id, idx)) throw new Error(`cannot grow ${id} onto bird ${idx}`);
  return actOnHand(state, id, (next) => next.ranch[next.turn][idx].push(id));
}

export function discardCard(state, id) {
  if (!canDiscardCard(state, id)) throw new Error(`cannot discard ${id}`);
  return actOnHand(state, id, (next) => {
    next.discard.push(id);
    next.mustDrawDeck = true;
  });
}

export function canDraw(state, source) {
  if (state.phase !== 'draw') return false;
  if (source === 'deck') return state.draw.length > 0;
  if (source === 'discard') return !state.mustDrawDeck && state.discard.length > 0;
  return false;
}

/** Draw to end the turn.  The last card of the draw pile ends the year. */
export function drawCard(state, source) {
  if (!canDraw(state, source)) throw new Error(`cannot draw from ${source}`);
  const next = structuredClone(state);
  const id = source === 'deck' ? next.draw.pop() : next.discard.pop();
  next.hands[next.turn].push(id);
  next.mustDrawDeck = false;
  next.moves += 1;
  if (source === 'deck' && next.draw.length === 0) {
    next.phase = 'year-end';
    next.yeSeat = next.turn;
    next.yeDone = [false, false];
  } else {
    next.turn = 1 - next.turn;
    next.phase = 'action';
  }
  return next;
}

/* -------------------------------------------------------------- year end */

export function yeGrow(state, id, idx) {
  if (!canYeGrow(state, id, idx)) throw new Error(`cannot grow ${id} onto bird ${idx}`);
  const next = structuredClone(state);
  const seat = next.yeSeat;
  next.hands[seat].splice(next.hands[seat].indexOf(id), 1);
  next.ranch[seat][idx].push(id);
  return next;
}

/** Finish this seat's year-end plays; whatever is left is discarded. */
export function yeFinish(state) {
  if (state.phase !== 'year-end') throw new Error('not year end');
  const next = structuredClone(state);
  const seat = next.yeSeat;
  next.discard.push(...next.hands[seat]);
  next.hands[seat] = [];
  next.yeDone[seat] = true;
  next.moves += 1;
  if (next.yeDone.every(Boolean)) settleYear(next);
  else next.yeSeat = 1 - seat;
  return next;
}

/** Score every bird, pay upkeep, bank the year. */
function settleYear(next) {
  const yearScores = [0, 0];
  for (const p of [0, 1]) {
    const kept = [];
    for (const stack of next.ranch[p]) {
      const { score, upkeep } = scoreStack(stack);
      yearScores[p] += score;
      next.discard.push(...upkeep);
      const rest = stack.filter((id) => !upkeep.includes(id));
      if (rest.length) kept.push(rest);
    }
    next.ranch[p] = kept;
    next.scores[p] += yearScores[p];
  }
  next.yearLog.push({ year: next.year, scores: yearScores.slice() });
  next.lastScore = { year: next.year, scores: yearScores.slice() };
  next.phase = 'scored';
  next.yeSeat = null;
  next.over = next.year >= YEARS ? 'game' : 'year';
  if (next.over === 'game') {
    next.winner = next.scores[0] === next.scores[1] ? null
      : next.scores[0] > next.scores[1] ? 0 : 1;
  }
}

/** Deal the next year; the player who went first now goes second. */
export function nextYear(state, deck) {
  if (state.over !== 'year') return state;
  const st = newGame((state.seed + state.year * 7919 + 104729) >>> 0, deck, 1 - state.first);
  st.year = state.year + 1;
  st.scores = state.scores.slice();
  st.yearLog = state.yearLog.slice();
  return st;
}

/* ------------------------------------------------- actions for tests/UI */

export function legalActions(state) {
  const out = [];
  if (state.phase === 'action') {
    for (const id of state.hands[state.turn]) {
      out.push({ type: 'hatch', id });
      out.push({ type: 'discard', id });
      state.ranch[state.turn].forEach((s, i) => {
        if (growFits(s, id)) out.push({ type: 'grow', id, stack: i });
      });
    }
  } else if (state.phase === 'draw') {
    if (canDraw(state, 'deck')) out.push({ type: 'draw', source: 'deck' });
    if (canDraw(state, 'discard')) out.push({ type: 'draw', source: 'discard' });
  } else if (state.phase === 'year-end') {
    const seat = state.yeSeat;
    for (const id of state.hands[seat]) {
      state.ranch[seat].forEach((s, i) => {
        if (growFits(s, id)) out.push({ type: 'yeGrow', id, stack: i });
      });
    }
    out.push({ type: 'yeFinish' });
  }
  return out;
}

export function applyAction(state, a) {
  switch (a.type) {
    case 'hatch': return hatch(state, a.id);
    case 'grow': return grow(state, a.id, a.stack);
    case 'discard': return discardCard(state, a.id);
    case 'draw': return drawCard(state, a.source);
    case 'yeGrow': return yeGrow(state, a.id, a.stack);
    case 'yeFinish': return yeFinish(state);
    default: throw new Error(`unknown action ${a.type}`);
  }
}

export const OUTCOME = {
  year: { title: 'Year over', cls: '' },
  game: { title: 'Game over', cls: 'win' },
};
