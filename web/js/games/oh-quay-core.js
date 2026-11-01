/* Oh Quay — game logic, no DOM.
 *
 * Rules: https://wiki.decktet.com/game:oh-quay  (P.D. Magnus & Cristyn Magnus)
 *
 * The deck is split into four stacks of nine: each player has a *canal* (an
 * ordered line of cargo, visible) and a *dock* (a draw pile held facing away —
 * its top card is hidden from its holder and visible to the opponent).  Each
 * turn: take the front card of either dock and slot it anywhere in your canal,
 * then launch from the front — a single card, or a raft of same-suit cards in
 * ascending rank order (gaps allowed, lowest in front).  A single card goes to
 * the bottom of your own dock; on a raft of two both docks get a card; a raft
 * of three or longer leaves the rest in your score pile.  Empty your canal to
 * end the game: score piles are worth a point a card, and the finisher also
 * scores a point for every raft (singles included) left in the other canal.
 *
 * Interpretations (noted on the rules page):
 *   1. Canals are public information — only the docks are hidden, and only
 *      below the top card (exactly the hidden card when holding the cards:
 *      your own dock's top card is hidden from you, visible to the opponent).
 *   2. On a raft, the launcher's front card goes to the bottom of their own
 *      dock, the next card to the opponent's dock, the rest (in order) to the
 *      launcher's score pile — the wiki says "each take a card" without
 *      choosing which.
 *   3. Rafts left in the loser's canal at the end are counted greedily from
 *      the front: the longest same-suit ascending run, then the next, and so
 *      on; a leftover single counts as one raft.
 *   4. Points decide the game; an exact tie is a draw.  The loser of a game
 *      takes the first turn of the next one. */

import { mulberry32, rankValue, baseId } from '../decktet.js';

let BY_ID = null;
export const init = (byId) => { BY_ID = byId; };
export const card = (id) => BY_ID[baseId(id)];
export const rankOf = (id) => rankValue(card(id));
export const suitsOf = (id) => card(id).suits;

export const DOCK_SIZE = 9;

/* ------------------------------------------------------------------ rafts */

/** The longest raft that can be launched from the front of this canal:
 *  same shared suit, strictly ascending ranks, gaps allowed, lowest in front. */
export function maxRaft(canal) {
  if (!canal.length) return 0;
  const common = new Set(suitsOf(canal[0]));
  let last = rankOf(canal[0]);
  let n = 1;
  for (let i = 1; i < canal.length; i++) {
    const r = rankOf(canal[i]);
    if (r <= last) break;
    const s = suitsOf(canal[i]);
    for (const x of [...common]) if (!s.includes(x)) common.delete(x);
    if (!common.size) break;
    last = r;
    n++;
  }
  return n;
}

/** May `k` cards be launched from the front of `canal`? (k = 1 always can.) */
export function raftK(canal, k) {
  if (!Number.isInteger(k) || k < 1 || k > canal.length) return false;
  return k === 1 || maxRaft(canal) >= k;
}

/** How many rafts (singles count) remain in a canal? Greedy, from the front. */
export function raftsRemaining(canal) {
  let i = 0, n = 0;
  while (i < canal.length) {
    const slice = canal.slice(i);
    i += Math.max(1, maxRaft(slice));
    n++;
  }
  return n;
}

/* ------------------------------------------------------------------ setup */

export function newGame(seed, deck, first = 0) {
  const rng = mulberry32(seed);
  const shuffled = deck.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  // four stacks of nine: canal, dock, canal, dock
  return {
    seed,
    canals: [shuffled.slice(0, 9), shuffled.slice(18, 27)],
    docks: [shuffled.slice(9, 18), shuffled.slice(27, 36)],
    scores: [[], []],
    turn: first,
    phase: 'cargo',        // 'cargo' | 'insert' | 'launch'
    pending: null,         // the card just drawn, awaiting a spot in the canal
    over: null,            // 'end'
    finisher: null,
    points: null,
    winner: null,
    moves: 0,
  };
}

/* ------------------------------------------------------------------ moves */

/** May the current player take a card from the `which` dock? ('own' | 'foe') */
export function canCargo(state, which) {
  if (state.phase !== 'cargo') return false;
  const dock = which === 'own' ? state.docks[state.turn] : state.docks[1 - state.turn];
  return dock.length > 0;
}

export function cargo(state, which) {
  if (!canCargo(state, which)) throw new Error(`cannot draw from the ${which} dock`);
  const next = structuredClone(state);
  const dock = which === 'own' ? next.docks[next.turn] : next.docks[1 - next.turn];
  next.pending = dock.shift();
  next.phase = 'insert';
  return next;
}

/** Insert positions: 0 = front, canal.length = the back. */
export function canInsert(state, pos) {
  return state.phase === 'insert'
    && Number.isInteger(pos) && pos >= 0 && pos <= state.canals[state.turn].length;
}

export function insert(state, pos) {
  if (!canInsert(state, pos)) throw new Error(`cannot insert at ${pos}`);
  const next = structuredClone(state);
  next.canals[next.turn].splice(pos, 0, next.pending);
  next.pending = null;
  next.phase = 'launch';
  return next;
}

export function canLaunch(state, k) {
  return state.phase === 'launch' && raftK(state.canals[state.turn], k);
}

/** Launch `k` cards from the front of the canal, ending the turn. */
export function launch(state, k) {
  if (!canLaunch(state, k)) throw new Error(`cannot launch ${k} card(s)`);
  const next = structuredClone(state);
  const p = next.turn;
  const ids = next.canals[p].splice(0, k);
  if (k === 1) {
    next.docks[p].push(ids[0]);                 // single: back to your own dock
  } else {
    next.docks[p].push(ids[0]);                 // raft: one card to each dock…
    next.docks[1 - p].push(ids[1]);
    for (let i = 2; i < k; i++) next.scores[p].push(ids[i]);   // …rest scores
  }
  next.moves += 1;
  if (!next.canals[p].length) {
    next.over = 'end';
    next.finisher = p;
    settle(next);
  } else {
    next.turn = 1 - p;
    next.phase = 'cargo';
  }
  return next;
}

function settle(next) {
  const pts = [next.scores[0].length, next.scores[1].length];
  pts[next.finisher] += raftsRemaining(next.canals[1 - next.finisher]);
  next.points = pts;
  next.winner = pts[0] === pts[1] ? null : (pts[0] > pts[1] ? 0 : 1);
}

/* --------------------------------------------------- actions for tests/UI */

export function legalActions(state) {
  const out = [];
  if (state.phase === 'cargo') {
    if (canCargo(state, 'own')) out.push({ type: 'cargo', which: 'own' });
    if (canCargo(state, 'foe')) out.push({ type: 'cargo', which: 'foe' });
  } else if (state.phase === 'insert') {
    for (let pos = 0; pos <= state.canals[state.turn].length; pos++) {
      out.push({ type: 'insert', pos });
    }
  } else if (state.phase === 'launch') {
    const n = maxRaft(state.canals[state.turn]);
    for (let k = 1; k <= n; k++) out.push({ type: 'launch', k });
  }
  return out;
}

export function applyAction(state, a) {
  switch (a.type) {
    case 'cargo': return cargo(state, a.which);
    case 'insert': return insert(state, a.pos);
    case 'launch': return launch(state, a.k);
    default: throw new Error(`unknown action ${a.type}`);
  }
}

export const OUTCOME = {
  end: { title: 'The canal is clear', cls: 'win' },
};
