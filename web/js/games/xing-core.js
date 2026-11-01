/* Xing (Frogger) — game logic, no DOM.
 *
 * Rules: https://wiki.decktet.com/game:frogger  (José Carlos de Diego
 * Guerrero; English translation Jorge Arroyo; wiki text CC BY-NC-SA 3.0.)
 * A rethemed version appears as Xing in The Decktet Book.
 *
 * Two players race six frogs each along a corridor of twelve cards.  Every
 * suit symbol on a corridor card is a space; you advance by playing a card
 * whose suit matches the first free symbol ahead, and you refill your hand by
 * moving a frog back and taking from the six-card market.
 *
 * Interpretations (also listed on web/rules/xing.html):
 *  - a played card matches the first *free* symbol ahead; if every matching
 *    symbol ahead is covered, that frog cannot be advanced by that card (the
 *    wiki only defines the home move for "no matching suit symbols on the
 *    whole line of cards", covered or not);
 *  - each corridor card exposes all of its suits as spaces (the physical
 *    overlap that hides a third symbol has no screen equivalent);
 *  - when the market has no card the frog's landing suit forbids, the
 *    move-back action simply finishes without a card, as the blocked-player
 *    paragraph implies;
 *  - a player with no possible action at all may simply pass the turn.
 */

import { mulberry32, SUIT_NAME } from '../decktet.js';

let BY_ID = null;
export const init = (byId) => { BY_ID = byId; };
export const card = (id) => BY_ID[String(id).split('#')[0]];

export const EXCUSE = 'the-excuse';
export const CORRIDOR = 12;
export const HAND_START = 4;
export const MARKET_SIZE = 6;
export const FROGS = 6;
export const ACTIONS_PER_TURN = 3;

const suitName = (s) => SUIT_NAME[s] || s;
const suitList = (arr) => arr.map(suitName).join(' or ');

function shuffled(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ----------------------------------------------------------------- setup */

export function newGame(seed, deck) {
  const rng = mulberry32(seed >>> 0);
  const pawns = deck.filter((id) => card(id).rank === 'pawn');          // 4
  const rest = shuffled(deck.filter((id) => id !== EXCUSE && card(id).rank !== 'pawn'), rng);

  // the corridor: 8 random cards plus the four Pawns, shuffled into a line
  const corridor = shuffled([...rest.slice(0, 8), ...pawns], rng);
  const draw = rest.slice(8);                                           // 32

  const hands = [[], []];
  for (let p = 0; p < 2; p++) {
    for (let i = 0; i < HAND_START; i++) hands[p].push(draw.pop());
  }
  const market = [];
  for (let i = 0; i < MARKET_SIZE; i++) market.push(draw.pop());

  return {
    seed,
    moves: 0,
    corridor,
    hands,
    market,
    deck: draw,
    discard: [],
    frogs: [frogRow(), frogRow()],
    turn: 0,
    actions: 0,
    pending: null,        // { suit } while a moved-back frog waits for a card
    over: null,           // 'win'
    winner: null,         // 0 | 1
  };
}

const frogRow = () => Array.from({ length: FROGS }, () => ({ k: 'excuse' }));

/* ----------------------------------------------------------- board access */

export const slotsOf = (state, cardIdx) => card(state.corridor[cardIdx]).suits;

export function occupant(state, cardIdx, slot) {
  const suit = slotsOf(state, cardIdx)[slot];
  for (let p = 0; p < 2; p++) {
    for (let i = 0; i < FROGS; i++) {
      const f = state.frogs[p][i];
      if (f.k === 'card' && f.card === cardIdx && slotsOf(state, f.card)[f.slot] === suit) {
        return { p, i };
      }
    }
  }
  return null;
}

export const freeSlots = (state, cardIdx) => {
  const out = [];
  for (let slot = 0; slot < slotsOf(state, cardIdx).length; slot++) {
    if (!occupant(state, cardIdx, slot)) out.push(slot);
  }
  return out;
};

export const homeCount = (state, p) => state.frogs[p].filter((f) => f.k === 'home').length;

export function isBlocked(state, p) {
  return state.hands[p].length === 0 &&
    state.frogs[p].every((f) => f.k === 'excuse' || f.k === 'home');
}

/** The market cards `p` may take right now (a landed suit is forbidden). */
export function legalMarket(state, p) {
  const suit = state.pending ? state.pending.suit : null;
  const out = [];
  state.market.forEach((id, i) => {
    if (id == null) return;
    if (suit && card(id).suits.includes(suit)) return;
    out.push(i);
  });
  return out;
}

/* ----------------------------------------------------------------- moves */

function checkTurn(state, p) {
  if (state.over) throw new Error('the game is over');
  if (p !== state.turn) throw new Error(`it is player ${state.turn + 1}'s turn`);
  if (state.actions >= ACTIONS_PER_TURN) {
    throw new Error('you have used your three actions — end your turn');
  }
}

const checkNoPending = (state) => {
  if (state.pending) throw new Error('finish taking your card from the market first');
};

/**
 * Play hand card `handIdx` and advance frog `fi` to the first free symbol
 * ahead that shares a suit with it (or home, if nothing matches at all).
 */
export function advance(state, p, handIdx, fi) {
  checkTurn(state, p);
  checkNoPending(state);
  const frog = state.frogs[p][fi];
  if (!frog) throw new Error(`player ${p + 1} has no frog ${fi + 1}`);
  if (frog.k === 'home') throw new Error(`frog ${fi + 1} is already home and cannot move again`);
  const id = state.hands[p][handIdx];
  if (id == null) throw new Error(`you have no card in slot ${handIdx + 1} of your hand`);
  const suits = card(id).suits;
  if (!suits.length) throw new Error(`the ${card(id).name} has no suit to match on the corridor`);

  const from = frog.k === 'card' ? frog.card : -1;
  let target = null;
  let covered = false;
  for (let t = from + 1; t < CORRIDOR; t++) {
    const csuits = slotsOf(state, t);
    for (let slot = 0; slot < csuits.length; slot++) {
      if (!suits.includes(csuits[slot])) continue;
      if (occupant(state, t, slot)) { covered = true; continue; }
      target = { k: 'card', card: t, slot };
      break;
    }
    if (target) break;
  }
  if (!target) {
    if (covered) {
      throw new Error(`every ${suitList(suits)} symbol ahead of frog ${fi + 1} is occupied — ` +
        'move a frog back for a new card, or play another card');
    }
    target = { k: 'home' };
  }

  const next = structuredClone(state);
  // Aces and Crowns devour: every other frog on the landing card goes to the Excuse
  if (target.k === 'card' && (card(id).rank === 1 || card(id).rank === 'crown')) {
    for (let q = 0; q < 2; q++) {
      for (let j = 0; j < FROGS; j++) {
        const f = next.frogs[q][j];
        if (f.k === 'card' && f.card === target.card) next.frogs[q][j] = { k: 'excuse' };
      }
    }
  }
  next.frogs[p][fi] = target;
  next.hands[p].splice(handIdx, 1);
  next.discard.push(id);
  next.actions += 1;
  next.moves += 1;

  if (next.frogs[p].every((f) => f.k === 'home')) {
    next.over = 'win';
    next.winner = p;
  }
  return next;
}

/**
 * Move frog `fi` back to the first card behind it with a free symbol (or the
 * Excuse), then wait to take a card from the market.  `slot` picks which free
 * symbol of the landing card to sit on.
 */
export function moveBack(state, p, fi, slot = null) {
  checkTurn(state, p);
  checkNoPending(state);
  const frog = state.frogs[p][fi];
  if (!frog) throw new Error(`player ${p + 1} has no frog ${fi + 1}`);
  if (frog.k !== 'card') {
    throw new Error(`frog ${fi + 1} is ${frog.k === 'home' ? 'home' : 'on the Excuse'} — ` +
      'only a frog out on the corridor can move back');
  }

  let dest = null;
  let landed = null;
  for (let t = frog.card - 1; t >= 0; t--) {
    const free = freeSlots(state, t);
    if (free.length) {
      dest = t;
      landed = free[0];
      break;
    }
  }
  if (dest == null) {
    // nothing behind has a free symbol: the frog sits back down on the Excuse
    const next = structuredClone(state);
    next.frogs[p][fi] = { k: 'excuse' };
    return finishBack(next, p, null);
  }
  const free = freeSlots(state, dest);
  if (slot != null && !free.includes(slot)) {
    throw new Error(`slot ${slot + 1} of corridor card ${dest + 1} is not free ` +
      `(free: ${free.map((x) => x + 1).join(', ') || 'none'})`);
  }
  const use = slot == null ? free[0] : slot;
  const next = structuredClone(state);
  next.frogs[p][fi] = { k: 'card', card: dest, slot: use };
  return finishBack(next, p, slotsOf(next, dest)[use]);
}

function finishBack(next, p, suit) {
  next.moves += 1;
  next.pending = { suit };
  const canTake = legalMarket(next, p).length > 0;
  if (!canTake) {
    // no card the frog's landing suit allows: the move-back just finishes
    next.pending = null;
    next.actions += 1;
  }
  return next;
}

/** Complete a move-back: take one of the legal market cards. */
export function takeCard(state, p, marketIdx) {
  checkTurn(state, p);
  if (!state.pending) {
    throw new Error('you are not waiting to take a card — that happens right after a frog moves back');
  }
  const id = state.market[marketIdx];
  if (id == null) throw new Error(`market slot ${marketIdx + 1} is empty`);
  const suit = state.pending.suit;
  if (suit && card(id).suits.includes(suit)) {
    throw new Error(`you may not take ${card(id).name}: it shares ${suitName(suit)}, ` +
      'the symbol your frog landed on');
  }
  const next = structuredClone(state);
  next.market[marketIdx] = null;
  next.hands[p].push(id);
  next.pending = null;
  next.actions += 1;
  next.moves += 1;
  refill(next);
  return next;
}

/** A blocked player (no cards, no frogs on the corridor) may take a card and
 *  that uses the whole turn. */
export function takeOnly(state, p, marketIdx) {
  checkTurn(state, p);
  checkNoPending(state);
  if (!isBlocked(state, p)) {
    throw new Error('you may take a card this way only when blocked: ' +
      'no cards in hand and no frogs on the corridor');
  }
  const id = state.market[marketIdx];
  if (id == null) throw new Error(`market slot ${marketIdx + 1} is empty`);
  const next = structuredClone(state);
  next.market[marketIdx] = null;
  next.hands[p].push(id);
  next.actions += 1;
  next.moves += 1;
  refill(next);
  return endTurn(next);
}

export function endTurn(state) {
  if (state.over) throw new Error('the game is over');
  if (state.pending) throw new Error('finish taking your card from the market first');
  if (state.actions === 0 && canAct(state, state.turn)) {
    throw new Error('take at least one action first — advance a frog, move one back, or take a card');
  }
  const next = structuredClone(state);
  next.turn = 1 - state.turn;
  next.actions = 0;
  next.moves += 1;
  return next;
}

/** Could player `p` do anything at all right now? */
export function canAct(state, p) {
  if (state.over) return false;
  if (state.pending) return true;
  if (state.hands[p].length) {
    for (let fi = 0; fi < FROGS; fi++) {
      if (state.frogs[p][fi].k === 'home') continue;
      for (let hi = 0; hi < state.hands[p].length; hi++) {
        try { advance(state, p, hi, fi); return true; } catch { /* keep looking */ }
      }
    }
  }
  if (state.frogs[p].some((f) => f.k === 'card')) return true;      // a move back
  if (isBlocked(state, p) && state.market.some((x) => x != null)) return true;
  return false;
}

/* ------------------------------------------------------------- refilling */

function refill(next) {
  if (next.market.some((x) => x != null)) return;
  for (let i = 0; i < MARKET_SIZE; i++) {
    const id = drawOne(next);
    if (id == null) return;
    next.market[i] = id;
  }
}

function drawOne(next) {
  if (!next.deck.length) {
    if (!next.discard.length) return null;
    // the deck runs out: shuffle the discard pile into a new deck
    next.deck = shuffled(next.discard,
      mulberry32((next.seed ^ (next.moves * 2654435761)) >>> 0));
    next.discard = [];
  }
  return next.deck.pop();
}
