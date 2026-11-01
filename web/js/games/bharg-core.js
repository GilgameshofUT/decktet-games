/* Bharg — game logic, no DOM.
 *
 * Rules: https://wiki.decktet.com/game:bharg  (P.D. Magnus)
 *
 * Two players, seven cards each.  Draw from the deck or the discard, then
 * discard.  A *bharg set* is three or more cards carrying one of each suit
 * with no suit repeated; a card is *bound* if it sits in a set or matches the
 * top of the Ace Pile.  Bind all seven of your cards after discarding and you
 * win the round, scoring the unbound cards left in the other hand.
 *
 * Interpretation (noted on the rules page): "a card may be counted as part of
 * at most one bharg set" makes boundness a covering question, so we ask
 * whether the hand can be partitioned into valid sets plus ace-matched
 * singletons (the same machinery scores the loser's leftovers). */

import { mulberry32, rankValue, baseId } from '../decktet.js';

let BY_ID = null;
export const init = (byId) => { BY_ID = byId; };
export const card = (id) => BY_ID[baseId(id)];
export const rankOf = (id) => rankValue(card(id));
export const suitsOf = (id) => card(id).suits;

export const HAND_SIZE = 7;
export const TARGET_SCORE = 50;

/* ------------------------------------------------------------- bharg sets */

/** Does this group carry one of each suit, with no suit repeated, size >= 3? */
export function isBhargSet(ids) {
  if (ids.length < 3) return false;
  const seen = new Set();
  for (const id of ids) {
    for (const s of suitsOf(id)) {
      if (seen.has(s)) return false;      // a suit appears twice
      seen.add(s);
    }
  }
  return true;
}

/** Every partition of n items (restricted growth strings).  Memoised; hands
 *  are at most eight cards, so Bell(8) = 4140 partitions. */
const partitionCache = new Map();
function allPartitions(n) {
  if (partitionCache.has(n)) return partitionCache.get(n);
  const out = [];
  if (n > 0) {
    const a = new Array(n).fill(0);
    const rec = (i, maxG) => {
      if (i === n) {
        const groups = new Map();
        for (let k = 0; k < n; k++) {
          if (!groups.has(a[k])) groups.set(a[k], []);
          groups.get(a[k]).push(k);
        }
        out.push([...groups.values()]);
        return;
      }
      for (let g = 0; g <= maxG + 1; g++) {
        a[i] = g;
        rec(i + 1, Math.max(maxG, g));
      }
    };
    rec(1, 0);
  }
  partitionCache.set(n, out);
  return out;
}

/**
 * The covering that binds the most cards: every card must end up either in a
 * valid bharg set or ace-matched on its own.  Returns { sets, free, covered }.
 */
export function bestCovering(hand, aceTop) {
  const aceSuits = aceTop ? new Set(suitsOf(aceTop)) : new Set();
  const aceMatched = (id) => suitsOf(id).some((s) => aceSuits.has(s));
  let best = { sets: [], free: [], covered: 0 };

  for (const groups of allPartitions(hand.length)) {
    const sets = [];
    const free = [];
    let covered = 0;
    for (const g of groups) {
      const ids = g.map((i) => hand[i]);
      if (ids.length === 1 && aceMatched(ids[0])) { free.push(ids[0]); covered += 1; continue; }
      if (isBhargSet(ids)) { sets.push(ids); covered += ids.length; continue; }
      // this part binds nothing — leave it out
    }
    if (covered > best.covered) best = { sets, free, covered };
  }
  return best;
}

export const isFullyBound = (hand, aceTop) =>
  bestCovering(hand, aceTop).covered === hand.length;

/** Per-card bound flags under the best covering available. */
export function boundFlags(hand, aceTop) {
  const flags = new Map(hand.map((id) => [id, false]));
  const cov = bestCovering(hand, aceTop);
  for (const id of [...cov.free, ...cov.sets.flat()]) flags.set(id, true);
  return flags;
}

/** Cards no covering can save: these are the unbound ones. */
export function unboundCards(hand, aceTop) {
  const flags = boundFlags(hand, aceTop);
  return hand.filter((id) => !flags.get(id));
}

export function scoreUnbound(hand, aceTop) {
  return unboundCards(hand, aceTop).reduce((sum, id) => sum + rankOf(id), 0);
}

/* ------------------------------------------------------------------- setup */

export function newGame(seed, deck) {
  const rng = mulberry32(seed);
  const shuffled = deck.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const state = {
    seed,
    hands: [[], []],
    draw: shuffled,
    discard: [],        // numbers and crowns, face up
    acePile: [],        // aces, face up
    turn: 0,
    phase: 'draw',      // 'draw' | 'discard'
    scores: [0, 0],
    round: 1,
    over: null,         // 'round' when someone went out
    winner: null,
  };

  for (let p = 0; p < 2; p++) {
    for (let i = 0; i < HAND_SIZE; i++) state.hands[p].push(state.draw.pop());
  }
  // flip until a non-ace starts the discard; aces start the Ace Pile
  for (;;) {
    const id = state.draw.pop();
    if (id == null) break;
    if (card(id).rank === 1) state.acePile.push(id);
    else { state.discard.push(id); break; }
  }
  return state;
}

/* ------------------------------------------------------------------ moves */

export const aceTop = (state) => state.acePile[state.acePile.length - 1] || null;
export const discardTop = (state) => state.discard[state.discard.length - 1] || null;

export function canDraw(state, source) {
  if (state.phase !== 'draw') return false;
  if (source === 'deck') return state.draw.length > 0;
  if (source === 'discard') return state.discard.length > 0;
  return false;
}

export function draw(state, source) {
  if (!canDraw(state, source)) throw new Error(`cannot draw from ${source}`);
  const next = structuredClone(state);
  const id = source === 'deck' ? next.draw.pop() : next.discard.pop();
  next.hands[next.turn].push(id);
  next.phase = 'discard';
  return next;
}

export function canDiscard(state, id) {
  return state.phase === 'discard' && state.hands[state.turn].includes(id);
}

export function discard(state, id) {
  if (!canDiscard(state, id)) throw new Error(`cannot discard ${id}`);
  const next = structuredClone(state);
  const hand = next.hands[next.turn];
  hand.splice(hand.indexOf(id), 1);

  if (card(id).rank === 1) next.acePile.push(id);
  else next.discard.push(id);

  // you can only go out after discarding
  if (isFullyBound(next.hands[next.turn], aceTop(next))) {
    const loser = 1 - next.turn;
    const points = scoreUnbound(next.hands[loser], aceTop(next));
    next.scores[next.turn] += points;
    next.over = 'round';
    next.winner = next.turn;
    next.lastScore = points;
    return next;
  }

  next.turn = 1 - next.turn;
  next.phase = 'draw';
  return next;
}

/** Start the next round (same players, reshuffled deck). */
export function nextRound(state, deck) {
  if (state.over !== 'round') return state;
  const st = newGame((state.seed + state.round * 7919) >>> 0, deck);
  st.scores = state.scores.slice();
  st.round = state.round + 1;
  if (Math.max(...st.scores) >= TARGET_SCORE) {
    st.over = 'match';
    st.winner = st.scores[0] === st.scores[1] ? null : (st.scores[0] > st.scores[1] ? 0 : 1);
  }
  return st;
}

export const OUTCOME = {
  round: { title: 'Round over', cls: '' },
  match: { title: 'Match over', cls: 'win' },
};
