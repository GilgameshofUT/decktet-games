/* Aucteraden — game logic, no DOM.
 *
 * Rules: https://wiki.decktet.com/game:aucteraden  (Jack Neal)
 *
 * A solitaire market-and-tableau game with the basic 36-card Decktet and
 * four suit chips per suit.  Every turn you buy one card from a three-card
 * market (left costs 2 chips, middle 1, right free), place it in a 4x4
 * tableau next to a card already there, refill the market and check for the
 * end.  Refills discard market cards matching the first card drawn.  At the
 * end each suit scores its longest same-suit ascending chain, with penalties
 * for untouched chip suits, empty tableau squares and discarded market rows.
 * 40 VP wins; 50 is a commanding win.
 *
 * Interpretations (all stated on the rules page):
 *   1. Market refill — the prose says the fresh card goes "in the leftmost
 *      place", but all three of the rules' own examples place it in the
 *      rightmost empty slot (leftmost only when that is the only gap), so
 *      that is what this app does.
 *   2. Payment — "Only chips from one of the suits may be used": every chip
 *      of a cost-2 card must come from a single one of its suits.
 *   3. The Ace/Crown rule is about ranks: an Ace or Crown may never be
 *      placed orthogonally next to another Ace or Crown (diagonals are fine).
 *   4. The first card of the tableau may go on any square.
 *   5. Ties between equally long chains are the player's choice; this app
 *      scores the best-scoring one.  With the basic deck an Ace can only
 *      begin and a Crown only end an ascending chain, so the +1/+2/+4
 *      bonuses simply add.
 *   6. The basic (36-card) game only; the extended-deck rules exist but are
 *      optional and are not implemented. */

let BY_ID = null;
export const init = (byId) => { BY_ID = byId; };
export const card = (id) => BY_ID[String(id).split('#')[0]];
export const rankOf = (id) => {
  const c = card(id);
  if (c.rank === 'crown') return 10;
  return c.rank;
};
export const suitsOf = (id) => card(id).suits;

export const SUITS = ['moons', 'suns', 'waves', 'leaves', 'daemons', 'crowns'];
export const SIZE = 4;
export const CELLS = SIZE * SIZE;
export const COST = [2, 1, 0];                   // left, middle, right
export const WIN = 40;
export const COMMANDING = 50;

export const rowOf = (i) => Math.floor(i / SIZE);
export const colOf = (i) => i % SIZE;

/** Straight-line (non-diagonal) neighbours inside the 4x4 tableau. */
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

const isAceOrCrown = (id) => {
  const r = card(id).rank;
  return r === 1 || r === 'crown';
};
export { isAceOrCrown as isAC };

/* ------------------------------------------------------------------- rng */

function rand(st) {
  let a = (st.rngState + 0x6d2b79f5) | 0;
  st.rngState = a;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/* ------------------------------------------------------------------ setup */

export function newGame(seed, basicDeck) {
  if (basicDeck.length !== 36) throw new Error(`the basic Decktet is 36 cards, got ${basicDeck.length}`);
  const st = {
    seed,
    rngState: seed >>> 0,
    over: null,
    deck: basicDeck.slice(),
    market: [null, null, null],
    tableau: Array(CELLS).fill(null),
    chips: Object.fromEntries(SUITS.map((s) => [s, 4])),
    trash: [],
    rowDiscards: 0,
    moves: 0,
    lastNote: null,
  };
  for (let i = st.deck.length - 1; i > 0; i--) {
    const j = Math.floor(rand(st) * (i + 1));
    [st.deck[i], st.deck[j]] = [st.deck[j], st.deck[i]];
  }
  st.market = st.deck.splice(0, 3);
  return st;
}

/* ---------------------------------------------------------------- market */

/** Right-pack the market (cards shift right after a buy or a discard). */
function packRight(st) {
  const cards = st.market.filter(Boolean);
  st.market = [...Array(3 - cards.length).fill(null), ...cards];
}

/**
 * Refill the market to three.  The first card drawn discards any market card
 * matching one of its suits; only that first card removes anything.  Every
 * fresh card lands in the rightmost empty slot (the rules' examples), and
 * the market refills from the deck until it holds three again.
 */
export function refill(st) {
  packRight(st);
  let first = true;
  while (st.market.some((x) => x === null) && st.deck.length) {
    const drawn = st.deck.shift();
    if (first) {
      first = false;
      const suits = new Set(suitsOf(drawn));
      const keep = [];
      for (const m of st.market) {
        if (m && suitsOf(m).some((s) => suits.has(s))) st.trash.push(m);
        else if (m) keep.push(m);
      }
      st.market = [...Array(3 - keep.length).fill(null), ...keep];
    }
    for (let i = 3 - 1; i >= 0; i--) {
      if (st.market[i] === null) { st.market[i] = drawn; break; }
    }
  }
}

/* -------------------------------------------------------------- placement */

/** Squares a freshly bought card may be placed on. */
export function legalCells(state, id) {
  const out = [];
  const occupied = state.tableau.some(Boolean);
  const ac = isAceOrCrown(id);
  for (let i = 0; i < CELLS; i++) {
    if (state.tableau[i]) continue;
    if (!occupied) { out.push(i); continue; }        // the first card: anywhere
    const ns = neighbours(i).filter((n) => state.tableau[n]);
    if (!ns.length) continue;                        // must touch a card
    if (ac && ns.some((n) => isAceOrCrown(state.tableau[n]))) continue;
    out.push(i);
  }
  return out;
}

/** All chips of a cost-N card must come from one of its suits. */
export function payment(state, id, cost) {
  if (cost === 0) return { suit: null, n: 0 };
  for (const s of suitsOf(id)) {
    if (state.chips[s] >= cost) return { suit: s, n: cost };
  }
  return null;
}

/** Everything buyable this turn: [{ slot, id, cells, cost, suit }] */
export function buyOptions(state) {
  const out = [];
  if (state.over) return out;
  for (let slot = 0; slot < 3; slot++) {
    const id = state.market[slot];
    if (!id) continue;
    const pay = payment(state, id, COST[slot]);
    if (!pay) continue;
    const cells = legalCells(state, id);
    if (cells.length) out.push({ slot, id, cells, cost: COST[slot], suit: pay.suit });
  }
  return out;
}

/* ---------------------------------------------------------------- actions */

/** Buy the card in market slot `slot` and place it on tableau square `cell`. */
export function buy(state, slot, cell) {
  if (state.over) throw new Error('the game is over');
  if (!Number.isInteger(slot) || slot < 0 || slot > 2) throw new Error('bad market slot');
  const id = state.market[slot];
  if (!id) throw new Error('that market slot is empty');
  const cost = COST[slot];
  const pay = payment(state, id, cost);
  if (!pay) {
    const suits = suitsOf(id).map((s) => `${state.chips[s]} ${s}`).join(', ');
    throw new Error(`the ${['left', 'middle', 'right'][slot]} card costs ` +
      `${cost} chip${cost === 1 ? '' : 's'} of its own suit — you have ${suits}`);
  }
  if (!Number.isInteger(cell) || cell < 0 || cell >= CELLS) throw new Error('bad tableau square');
  if (state.tableau[cell]) throw new Error('that square is taken');
  const cells = legalCells(state, id);
  if (!cells.includes(cell)) {
    throw new Error(isAceOrCrown(id)
      ? 'an Ace or Crown may not be placed straight next to another Ace or Crown'
      : 'a card must be placed straight up, down, left or right of a card already down');
  }

  const next = structuredClone(state);
  next.market[slot] = null;
  next.tableau[cell] = id;
  if (pay.suit) {
    next.chips[pay.suit] -= cost;
  }
  next.lastNote = null;
  next.moves += 1;
  refill(next);
  settle(next);
  return next;
}

/** Throw the whole market row away for a 3 VP penalty and refill. */
export function discardRow(state) {
  if (state.over) throw new Error('the game is over');
  if (!state.market.some(Boolean)) throw new Error('the market is empty');
  const next = structuredClone(state);
  next.rowDiscards += 1;
  next.trash.push(...next.market.filter(Boolean));
  next.market = [null, null, null];
  next.lastNote = 'The whole market row is discarded (−3 VP).';
  next.moves += 1;
  refill(next);
  settle(next);
  return next;
}

/** End the game, or force the row discard when nothing can be bought. */
function settle(st) {
  if (st.over) return;
  if (st.tableau.every(Boolean) || st.market.every((x) => x === null)) {
    st.over = 'done';
    return;
  }
  let guard = 0;
  while (!buyOptions(st).length && st.market.some(Boolean) && !st.over && guard++ < 40) {
    st.rowDiscards += 1;
    st.trash.push(...st.market.filter(Boolean));
    st.market = [null, null, null];
    st.lastNote = 'Nothing could be bought or placed — the market row is discarded (−3 VP).';
    refill(st);
    if (st.tableau.every(Boolean) || st.market.every((x) => x === null)) {
      st.over = 'done';
      return;
    }
  }
}

/* --------------------------------------------------------------- scoring */

export const BASE = [-5, -5, 2, 5, 9, 14, 20, 30];
export const baseVP = (len) => (len >= 7 ? 30 : BASE[len]);

/**
 * The longest same-suit ascending chain of a suit in a tableau (array of 16
 * ids or nulls).  Returns { ids, length, bonus } — ties go to the
 * best-scoring chain, then to the first found.
 */
export function longestChain(tableau, suit) {
  const cells = [];
  for (let i = 0; i < CELLS; i++) {
    const id = tableau[i];
    if (id && suitsOf(id).includes(suit)) cells.push(i);
  }
  if (!cells.length) return { ids: [], length: 0, bonus: 0 };

  const chainBonus = (ids) => {
    const first = card(ids[0]).rank === 1;
    const last = card(ids[ids.length - 1]).rank === 'crown';
    return (first ? 1 : 0) + (last ? 2 : 0) + (first && last ? 4 : 0);
  };
  let best = { ids: [], length: 0, bonus: -1 };
  const visit = (path) => {
    const i = path[path.length - 1];
    for (const j of neighbours(i)) {
      const id2 = tableau[j];
      if (!id2 || !suitsOf(id2).includes(suit)) continue;
      if (rankOf(id2) <= rankOf(tableau[i])) continue;   // strictly ascending
      visit([...path, j]);
    }
    const ids = path.map((k) => tableau[k]);
    const bonus = chainBonus(ids);
    if (path.length > best.length || (path.length === best.length && bonus > best.bonus)) {
      best = { ids, length: path.length, bonus };
    }
  };
  for (const c of cells) visit([c]);
  return best;
}

/** Full score breakdown — the on-screen pad. */
export function score(state) {
  const suits = SUITS.map((suit) => {
    const ch = longestChain(state.tableau, suit);
    const base = baseVP(ch.length);
    const left = state.chips[suit];
    const chipPenalty = (left === 0 || left === 4) ? -5 : 0;
    return {
      suit, length: ch.length, ids: ch.ids, base,
      bonus: ch.bonus, left, chipPenalty,
      total: base + ch.bonus + chipPenalty,
    };
  });
  const empty = state.tableau.filter((x) => !x).length;
  const emptyPenalty = 5 * empty;
  const discardPenalty = 3 * state.rowDiscards;
  const suitsTotal = suits.reduce((n, s) => n + s.total, 0);
  return {
    total: suitsTotal - emptyPenalty - discardPenalty,
    suits, suitsTotal,
    empty, emptyPenalty,
    rowDiscards: state.rowDiscards, discardPenalty,
  };
}

export const OUTCOME = {
  win: { title: 'You win', cls: 'win', text: 'A fine network of trade routes. Aucteraden is in your debt.' },
  great: { title: 'Commanding win', cls: 'win', text: 'The clans line up at your door. Truly commanding trade.' },
  lose: { title: 'Game over', cls: '', text: 'The routes never quite paid. Frugality, next time.' },
};

/** One line for the pad, e.g. "Leaves · chain 4 A→4 · +1 Ace". */
export function describeSuit(row) {
  const name = row.suit[0].toUpperCase() + row.suit.slice(1);
  if (!row.length) return `${name}: no chain · −5`;
  const bits = [`${name} · chain ${row.length}`];
  if (row.bonus === 7) bits.push('Ace…Crown +7');
  else if (row.bonus === 1) bits.push('+1 Ace');
  else if (row.bonus === 2) bits.push('+2 Crown');
  else if (row.bonus === 4) bits.push('+4 Ace & Crown');
  if (row.chipPenalty) bits.push('chips −5');
  bits.push(`${row.total}`);
  return bits.join(' · ');
}
