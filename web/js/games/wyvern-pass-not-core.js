/* Wyvern Pass Not — game logic, no DOM.
 *
 * Rules: https://wiki.decktet.com/game:wyvern-pass-not
 * (Ruber Eaglenest, page revision 10 — the wiki marks the game beta)
 *
 * You are the mage (the Excuse, standing in the middle).  Around you an
 * eight-slot ring must be closed with every link shared: adjacent cards must
 * meet by a suit, and once one of a card's suits is spent it is gone — so a
 * two-suit card spends one suit per side, a three-suit Pawn or Court spends
 * two of its three, and an Ace or Crown (one suit) counts as having that suit
 * twice.  Draw from a face-up pool of four, which refills from the deck; you
 * may re-deal the pool, but each re-deal shrinks it by one, and asking to
 * re-deal when only one card is left means the wyvern breathes.
 *
 * Interpretations (all noted on the rules page):
 *   1. Deck: the wiki's "all the basic Decktet cards plus the Aces, the
 *      Crowns and the Pawns" is garbled (the basic deck already has aces and
 *      crowns).  This app uses every card except the Excuse — basic deck +
 *      Pawns + Courts, 44 cards — which the advanced setup confirms by
 *      removing only "the Excuse and the Aces" from all the cards.
 *   2. Courts link exactly like Pawns (three suits, two links).
 *   3. A ring is only "complete" once all eight slots hold a card; if any of
 *      the eight links is broken then, the mage dies.  You may place a card
 *      anywhere, linked or not, and move placed cards to empty slots.
 *   4. Scoring counts 6 points per valid link (48 for a closed ring) plus the
 *      suit-pool bonuses (6/7/8 cards of one suit in the ring: 30/60/120).
 *      On a failed ring we count the maximum set of links that could work
 *      under the one-suit-per-link rule.
 *   5. The advanced game (limiters, power-tool Aces, five stages) is not
 *      implemented; the basic game is. */

import { mulberry32, baseId } from '../decktet.js';

let BY_ID = null;
export const init = (byId) => { BY_ID = byId; };
export const card = (id) => BY_ID[baseId(id)];

export const MAGE = 'the-excuse';
export const RING_SIZE = 8;
export const START_POOL = 4;
export const LINK_POINTS = 6;
export const POOL_BONUS = { 6: 30, 7: 60, 8: 120 };   // cards of one suit in the ring

/** Ring slot i sits clockwise; slot i links to (i+1) % 8.  In the 3×3 table
 *  layout slot 0 is top-left, then across the top, down the right, back
 *  along the bottom and up the left — the grid cell (1-based) of each slot: */
export const SLOT_CELL = [1, 2, 3, 6, 9, 8, 7, 4];

/** A card's link tokens: each suit is one link; a single-suit card (Ace or
 *  Crown) "counts as" having two links of that suit. */
export function tokens(id) {
  const suits = card(id).suits;
  const t = [];
  for (const s of suits) {
    t.push(s);
    if (suits.length === 1) t.push(s);
  }
  return t;
}

/** Every ordered [incoming, outgoing] suit pair the card can present to its
 *  two links: the two suits must come from its tokens, one per link. */
export function options(id) {
  const t = tokens(id);
  const uniq = [...new Set(t)];
  if (uniq.length === 1) return [[uniq[0], uniq[0]]];
  const out = [];
  for (const a of uniq) {
    for (const b of uniq) {
      if (a !== b || t.filter((x) => x === a).length >= 2) out.push([a, b]);
    }
  }
  return out;
}

/* ------------------------------------------------------- link assignment */

/** Witness assignment for an open path of placed cards: { count, links } —
 *  links[k] is the suit shared by run[k] → run[k+1], or null if broken.
 *  Maximises the number of valid links. */
export function pathPlan(opts) {
  const n = opts.length;
  const memo = new Map();
  const solve = (i, inSuit) => {
    if (inSuit != null && !opts[i].some((o) => o[0] === inSuit)) return null;
    if (i >= n - 1) return { count: 0, links: [] };
    const key = i + '|' + (inSuit ?? '');
    if (memo.has(key)) return memo.get(key);
    let best = { count: 0, links: new Array(n - 1 - i).fill(null) };
    const usable = inSuit == null ? opts[i] : opts[i].filter((o) => o[0] === inSuit);
    for (const o of usable) {
      const brk = solve(i + 1, null);                 // break the outgoing link
      if (brk.count > best.count) best = { count: brk.count, links: [null, ...brk.links] };
      const mt = solve(i + 1, o[1]);                  // share o[1] with the next card
      if (mt && 1 + mt.count > best.count) {
        best = { count: 1 + mt.count, links: [o[1], ...mt.links] };
      }
    }
    memo.set(key, best);
    return best;
  };
  return solve(0, null);
}

/** Witness assignment for a closed ring of eight: links[i] is the suit shared
 *  by slot i → slot i+1, or null when no fully-linked arrangement exists. */
export function cyclePlan(opts) {
  for (const o0 of opts[0]) {
    const memo = new Map();
    const go = (i, inSuit) => {                       // outgoing suits of cards i..7, or null
      if (i === RING_SIZE) return inSuit === o0[0] ? [] : null;
      const key = i + '|' + inSuit;
      if (memo.has(key)) return memo.get(key);
      for (const o of opts[i]) {
        if (o[0] !== inSuit) continue;
        const rest = go(i + 1, o[1]);
        if (rest) { const res = [o[1], ...rest]; memo.set(key, res); return res; }
      }
      memo.set(key, null);
      return null;
    };
    const outs = go(1, o0[1]);
    if (outs) return [o0[1], ...outs];
  }
  return null;
}

const runsOf = (ring) => {
  const n = ring.length;
  if (ring.every(Boolean)) return [ring.map((_, i) => i)];
  const firstEmpty = ring.findIndex((x) => !x);
  const out = [];
  let run = [];
  for (let k = 1; k <= n; k++) {
    const i = (firstEmpty + k) % n;
    if (ring[i]) run.push(i);
    else if (run.length) { out.push(run); run = []; }
  }
  return out;
};

/** The best link arrangement of the current ring: { count, links } where
 *  links[i] is the suit shared by slot i → (i+1)%8, or null if that link
 *  cannot be made to work. */
export function bestPlan(ring) {
  const opts = ring.map((id) => (id ? options(id) : null));
  const full = ring.length === RING_SIZE && ring.every(Boolean);

  if (full) {
    const c = cyclePlan(opts);
    if (c) return { count: RING_SIZE, links: c };
    let best = { count: 0, links: new Array(RING_SIZE).fill(null) };
    for (let cut = 0; cut < RING_SIZE; cut++) {        // break one link, path the rest
      const idx = [];
      const rotated = [];
      for (let k = 0; k < RING_SIZE; k++) {
        const i = (cut + 1 + k) % RING_SIZE;
        idx.push(i);
        rotated.push(opts[i]);
      }
      const p = pathPlan(rotated);
      const links = new Array(RING_SIZE).fill(null);
      idx.forEach((i, k) => { if (k < RING_SIZE - 1) links[i] = p.links[k]; });
      if (p.count > best.count) best = { count: p.count, links };
    }
    return best;
  }

  const links = new Array(RING_SIZE).fill(null);
  let count = 0;
  for (const run of runsOf(ring)) {
    if (run.length < 2) continue;
    const p = pathPlan(run.map((i) => opts[i]));
    count += p.count;
    run.forEach((i, k) => { if (k < run.length - 1) links[i] = p.links[k]; });
  }
  return { count, links };
}

export const linkCount = (ring) => bestPlan(ring).count;
export const ringIsLinked = (ring) =>
  ring.every(Boolean) && linkCount(ring) === RING_SIZE;

/* ----------------------------------------------------------------- score */

/** Suit pools: how many ring cards carry each suit. */
export function suitPools(ring) {
  const counts = {};
  for (const id of ring) {
    if (!id) continue;
    for (const s of new Set(card(id).suits)) counts[s] = (counts[s] || 0) + 1;
  }
  return counts;
}

export function score(state) {
  const links = linkCount(state.ring);
  const pools = suitPools(state.ring);
  const poolPoints = Object.values(pools).reduce(
    (sum, n) => sum + (POOL_BONUS[n] || 0), 0);
  return {
    links,
    linkPoints: links * LINK_POINTS,
    pools,
    poolPoints,
    total: links * LINK_POINTS + poolPoints,
  };
}

/* ----------------------------------------------------------------- setup */

export function newGame(seed, deck) {
  const rng = mulberry32(seed >>> 0);
  const shuffled = deck.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const st = {
    seed: seed >>> 0,
    deck: shuffled,
    pool: [],
    poolSize: START_POOL,
    discards: [],
    ring: new Array(RING_SIZE).fill(null),
    redeals: 0,
    moves: 0,
    over: null,
    lostReason: null,
  };
  for (let i = 0; i < START_POOL; i++) st.pool.push(st.deck.pop());
  settle(st);
  return st;
}

/** Draw one card for the pool, reshuffling the discards when the deck runs
 *  out ("reshuffle all the discarded cards to build a new deck"). */
function drawOne(st) {
  if (!st.deck.length && st.discards.length) {
    const rng = mulberry32((st.seed + st.moves * 7919 + st.redeals * 104729 + st.discards.length) >>> 0);
    const pile = st.discards.slice();
    for (let i = pile.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [pile[i], pile[j]] = [pile[j], pile[i]];
    }
    st.deck = pile;
    st.discards = [];
  }
  return st.deck.pop() ?? null;
}

/* ----------------------------------------------------------------- moves */

export const emptySlots = (state) =>
  state.ring.map((id, i) => (id ? null : i)).filter((i) => i != null);

/** Take the pool card at `poolIndex` and place it in ring slot `toSlot`;
 *  the pool refills from the deck. */
export function applyTake(state, poolIndex, toSlot) {
  if (state.over) throw new Error('the game is over');
  const id = state.pool[poolIndex];
  if (id == null) throw new Error(`no pool card at ${poolIndex}`);
  if (state.ring[toSlot]) throw new Error(`slot ${toSlot} is occupied`);
  const next = structuredClone(state);
  next.ring[toSlot] = next.pool.splice(poolIndex, 1)[0];
  next.moves += 1;
  const drawn = drawOne(next);
  if (drawn == null) { next.over = 'lost'; next.lostReason = 'deck'; return next; }
  next.pool.push(drawn);
  settle(next);
  return next;
}

/** Move a card already in the ring to another, empty slot. */
export function applyMoveCard(state, fromSlot, toSlot) {
  if (state.over) throw new Error('the game is over');
  if (!state.ring[fromSlot]) throw new Error(`no card in slot ${fromSlot}`);
  if (state.ring[toSlot]) throw new Error(`slot ${toSlot} is occupied`);
  const next = structuredClone(state);
  next.ring[toSlot] = next.ring[fromSlot];
  next.ring[fromSlot] = null;
  next.moves += 1;
  settle(next);
  return next;
}

/** Deal again: discard the pool and deal poolSize-1 cards.  Asking to deal
 *  when one card is left means there are no resources at all — you die. */
export function applyRedeal(state) {
  if (state.over) throw new Error('the game is over');
  const next = structuredClone(state);
  if (next.poolSize <= 1) {
    next.over = 'lost';
    next.lostReason = 'no-cards';
    return next;
  }
  next.discards.push(...next.pool);
  next.pool = [];
  next.poolSize -= 1;
  next.redeals += 1;
  for (let i = 0; i < next.poolSize; i++) next.pool.push(drawOne(next));
  next.moves += 1;
  settle(next);
  return next;
}

/** Give up: the mage surrenders and the wyvern breathes. */
export function applySurrender(state) {
  if (state.over) throw new Error('the game is over');
  const next = structuredClone(state);
  next.over = 'lost';
  next.lostReason = 'surrender';
  return next;
}

/* ------------------------------------------------------------------ end */

/** A full ring is a win only if every link works; otherwise the wyvern wins. */
export function settle(state) {
  if (state.over) return;
  if (state.ring.every(Boolean)) {
    state.over = ringIsLinked(state.ring) ? 'won' : 'lost';
    if (state.over === 'lost') state.lostReason = 'broken-ring';
  }
}

/** Every legal action right now (used by tests). */
export function legalActions(state) {
  if (state.over) return [];
  const out = [];
  const empties = emptySlots(state);
  state.pool.forEach((id, pi) => {
    if (id == null) return;
    for (const s of empties) out.push({ kind: 'take', poolIndex: pi, toSlot: s });
  });
  state.ring.forEach((id, i) => {
    if (!id) return;
    for (const s of empties) out.push({ kind: 'move', fromSlot: i, toSlot: s });
  });
  out.push({ kind: 'redeal' });
  out.push({ kind: 'surrender' });
  return out;
}

export const OUTCOME = {
  won: {
    title: 'The mage survives',
    cls: 'win',
    text: 'Every link of the ring holds. The wyvern breathes — and passes you by.',
  },
  'lost-broken': {
    title: 'The ring broke',
    cls: 'lose',
    text: 'The ring is full but one link is broken. The wyvern breathes, and the mage dies.',
  },
  'lost-no-cards': {
    title: 'No cards left to deal',
    cls: 'lose',
    text: 'You asked to deal again with a single card in the pool. There are no resources left — the wyvern breathes.',
  },
  'lost-surrender': {
    title: 'The mage surrenders',
    cls: 'lose',
    text: 'You yielded before the ring was closed. The wyvern breathes.',
  },
};

export const outcomeOf = (state) =>
  OUTCOME[state.over === 'won' ? 'won' : `lost-${state.lostReason}`] || OUTCOME['lost-broken'];
