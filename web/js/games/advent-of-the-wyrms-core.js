/* Advent of the Wyrms — game logic, no DOM.
 *
 * Rules: https://wiki.decktet.com/game:advent-of-the-wyrms
 * (Shane Lelwica-Hebeisen, page revision 9)
 *
 * A solitaire set-collection game with the full 45-card Decktet deck.  Every
 * turn you add a card to one of your incantations (three cards sharing one
 * suit, played in ascending rank order) or discard, then draw.  A drawn card
 * with the wyrms suit must be negated with one of four sacrifices.  Craft four
 * incantations before the deck runs out.
 *
 * Interpretations (all noted on the rules page):
 *   1. "the wyrms suit" is the Daemons suit — the wiki's own name for that
 *      suit is Wyrms (this app's manifest calls it `daemons`).
 *   2. Ranks follow the game's own text: Ace 1 … 9, Crown 10, Pawn 11,
 *      Court 12 — which is *not* the shared rankValue() order (that one puts
 *      Courts below Pawns), so this file ranks cards itself.
 *   3. "played in ascending rank order" means each new card must rank strictly
 *      above every card already in that incantation.
 *   4. The shared suit is fixed by the first card played (the player picks
 *      which of its suits when it has two or three).  The Excuse may be played
 *      as a wild into any incantation — it matches any suit and has no rank.
 *   5. The five-at-a-time limit counts incantations still being *crafted*;
 *      a finished (3-card) incantation is set aside and frees its slot.
 *   6. Method 3 of negation ("discard 2 cards from the top of the deck")
 *      needs at least 2 cards in the deck.
 *   7. While refilling a hand of 1–3, a drawn wyrms card must be negated; a
 *      refill that started with an empty hand sets wyrms aside instead, then
 *      shuffles them back once the hand holds 4.
 *   8. You lose when a needed draw finds an empty deck, or when a drawn wyrms
 *      card has no legal negation at all.  Score = cards left in the deck on a
 *      win; 0 on a loss (the wiki's rule). */

import { mulberry32, baseId } from '../decktet.js';

let BY_ID = null;
export const init = (byId) => { BY_ID = byId; };
export const card = (id) => BY_ID[baseId(id)];

export const WYRMS_SUIT = 'daemons';     // the wiki's "wyrms suit"
export const EXCUSE = 'the-excuse';
export const HAND_SIZE = 4;
export const MAX_OPEN = 5;               // incantations crafted at once
export const WIN_COUNT = 4;              // completed incantations to win
export const INCANTATION_SIZE = 3;

/** Rank as this game orders it: Ace 1 … 9, Crown 10, Pawn 11, Court 12,
 *  The Excuse 0 (it "does not have a rank"). */
export function rankOf(id) {
  const c = card(id);
  if (c.rank === 'crown') return 10;
  if (c.rank === 'pawn') return 11;
  if (c.rank === 'court') return 12;
  if (c.rank == null) return 0;
  return c.rank;
}

export const isExcuse = (id) => baseId(id) === EXCUSE;
export const isWyrms = (id) => card(id).suits.includes(WYRMS_SUIT);

/* --------------------------------------------------------------- helpers */

function shuffleInto(target, ids, rng) {
  const a = ids.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  for (const id of a) target.splice(Math.floor(rng() * (target.length + 1)), 0, id);
}

const rngFor = (st, salt) =>
  mulberry32((st.seed + st.moves * 7919 + st.negations * 104729 + salt) >>> 0);

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
    hand: [],
    open: [],            // incantations being crafted: [{ suit, cards }]
    done: [],            // completed incantations:   [{ suit, cards }]
    discards: [],
    negated: [],
    setAside: [],
    pending: null,       // { card } awaiting negation
    moves: 0,
    negations: 0,
    over: null,
    lostReason: null,
  };

  // Setup: draw until the hand holds 4 non-wyrms cards; wyrms drawn are set
  // aside and shuffled back into the deck once the hand is full.
  refill(st, 'setup');
  settle(st);
  return st;
}

/** Draw until the hand holds HAND_SIZE cards.
 *  mode 'setup': every wyrms drawn is set aside.
 *  mode 'play':  a wyrms drawn must be negated — unless the hand is empty,
 *                in which case it is set aside (the wiki's 0-hand refill). */
function refill(st, mode) {
  while (st.hand.length < HAND_SIZE) {
    if (!st.deck.length) { st.over = 'lost'; st.lostReason = 'deck'; return; }
    const id = st.deck.pop();
    if (isWyrms(id)) {
      if (mode === 'setup' || st.hand.length === 0) { st.setAside.push(id); continue; }
      st.pending = { card: id };
      return;
    }
    st.hand.push(id);
  }
  if (st.setAside.length) {
    const salt = st.setAside.length + st.negations + 1;
    shuffleInto(st.deck, st.setAside.splice(0), rngFor(st, salt));
  }
}

/* ------------------------------------------------------------- incantations */

export const isComplete = (inc) => inc.cards.length >= INCANTATION_SIZE;

const maxRankIn = (inc) =>
  inc.cards.reduce((m, id) => Math.max(m, rankOf(id)), 0);

/** Every way to play the hand card at `handIndex` right now:
 *  { slot, suit, existing } — `slot` indexes state.open, or equals
 *  state.open.length for a new incantation. */
export function addOptions(state, handIndex) {
  const id = state.hand[handIndex];
  if (id == null || state.over || state.pending) return [];
  const c = card(id);
  const wild = isExcuse(id);
  const out = [];

  state.open.forEach((inc, slot) => {
    if (wild) { out.push({ slot, suit: inc.suit, existing: true }); return; }
    if (inc.suit == null) {                      // wild-led: choose its suit now
      for (const s of c.suits) out.push({ slot, suit: s, existing: true });
      return;
    }
    if (!c.suits.includes(inc.suit)) return;     // must share the incantation's suit
    if (rankOf(id) <= maxRankIn(inc)) return;    // ascending rank order
    out.push({ slot, suit: inc.suit, existing: true });
  });

  if (state.open.length < MAX_OPEN) {
    if (wild) out.push({ slot: state.open.length, suit: null, existing: false });
    else for (const s of c.suits) out.push({ slot: state.open.length, suit: s, existing: false });
  }
  return out;
}

/* ------------------------------------------------------------- negation */

/** Every legal way to negate the pending wyrms card. */
export function legalNegations(state) {
  if (!state.pending || state.over) return [];
  const w = card(state.pending.card);
  const out = [];
  state.hand.forEach((id, i) => {
    if (isExcuse(id)) { out.push({ method: 'excuse', handIndex: i }); return; }
    if (w.suits.some((s) => s !== WYRMS_SUIT && card(id).suits.includes(s))) {
      out.push({ method: 'match', handIndex: i });
    }
    if (rankOf(id) >= rankOf(state.pending.card)) out.push({ method: 'rank', handIndex: i });
  });
  if (state.deck.length >= 2) out.push({ method: 'deck2', handIndex: null });
  return out;
}

/* ----------------------------------------------------------------- moves */

const guard = (state) => {
  if (state.over) throw new Error('the game is over');
  if (state.pending) throw new Error('negate the drawn wyrms card first');
};

/** Step 1: discard the hand card at `handIndex`, then draw. */
export function applyDiscard(state, handIndex) {
  guard(state);
  const id = state.hand[handIndex];
  if (id == null) throw new Error('no such card in hand');
  const next = structuredClone(state);
  next.discards.push(next.hand.splice(handIndex, 1)[0]);
  next.moves += 1;
  refill(next, 'play');
  settle(next);
  return next;
}

/** Step 1: play the hand card at `handIndex` to incantation `slot`
 *  (slot === open.length starts a new one, which adopts `suit`). */
export function applyAdd(state, handIndex, slot, suit) {
  guard(state);
  const ok = addOptions(state, handIndex).some(
    (o) => o.slot === slot && (o.suit ?? null) === (suit ?? null)
  );
  if (!ok) throw new Error(`illegal add: hand ${handIndex} -> slot ${slot} (${suit})`);
  const next = structuredClone(state);
  const id = next.hand.splice(handIndex, 1)[0];
  if (slot === next.open.length) next.open.push({ suit: suit ?? null, cards: [] });
  const inc = next.open[slot];
  if (inc.suit == null) inc.suit = suit ?? null;
  inc.cards.push(id);
  if (isComplete(inc)) { next.done.push(inc); next.open.splice(slot, 1); }
  next.moves += 1;
  // Step 1 completing the fourth incantation wins at once — the wiki's win
  // condition is met before step 2's draw could find an empty deck.
  if (next.done.length >= WIN_COUNT) { settle(next); return next; }
  refill(next, 'play');
  settle(next);
  return next;
}

/** Negate the pending wyrms card with a legal choice from legalNegations(). */
export function applyNegate(state, choice) {
  if (state.over) throw new Error('the game is over');
  if (!state.pending) throw new Error('no wyrms card to negate');
  const legal = legalNegations(state);
  const found = legal.find((o) =>
    o.method === choice.method &&
    (o.handIndex == null ? choice.handIndex == null : o.handIndex === choice.handIndex));
  if (!found) throw new Error(`illegal negation ${choice.method}`);

  const next = structuredClone(state);
  if (found.method === 'deck2') {
    for (let k = 0; k < 2; k++) {
      const id = next.deck.pop();
      if (isWyrms(id)) next.setAside.push(id);   // set aside, not discarded
      else next.discards.push(id);
    }
  } else {
    next.discards.push(next.hand.splice(found.handIndex, 1)[0]);
  }
  next.negated.push(next.pending.card);
  next.pending = null;
  next.negations += 1;
  refill(next, 'play');
  settle(next);
  return next;
}

/* ------------------------------------------------------------------ end */

export function completeCount(state) { return state.done.length; }

/** Apply the end-of-game rules (after setup and after every action). */
export function settle(state) {
  if (state.over) return;
  if (state.done.length >= WIN_COUNT) { state.over = 'won'; return; }
  if (state.pending && legalNegations(state).length === 0) {
    state.over = 'lost';
    state.lostReason = 'trapped';
  }
}

/** Every legal action right now (used by tests and the hint line). */
export function legalActions(state) {
  if (state.over) return [];
  if (state.pending) return legalNegations(state).map((n) => ({ kind: 'negate', ...n }));
  const out = [];
  state.hand.forEach((_, i) => {
    out.push({ kind: 'discard', handIndex: i });
    for (const o of addOptions(state, i)) {
      out.push({ kind: 'add', handIndex: i, slot: o.slot, suit: o.suit });
    }
  });
  return out;
}

/** Optional score: cards remaining in the deck.  Always 0 on a loss. */
export function score(state) {
  return state.over === 'won' ? state.deck.length : 0;
}

export const OUTCOME = {
  won: {
    title: 'You win',
    cls: 'win',
    text: 'Four incantations stand. The calamity is contained and the mortal world is safe.',
  },
  lost: {
    title: 'You lose…',
    cls: 'lose',
    text: 'The sect completed its summoning. The wyrms emerge from the darkness.',
  },
};
