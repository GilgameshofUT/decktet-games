/* Fifes & Drums — game logic, no DOM.
 *
 * Rules: https://wiki.decktet.com/game:fifes-and-drums
 * (original design Greg Payne, development P.D. Magnus; wiki text
 * CC BY-NC-SA 3.0.)
 *
 * Two players are each secretly bribed to help three of the six units.  A
 * battlefield track leads away from the advancing enemy; on your turn you
 * take one order card from a pool of five and move units along the track —
 * retreat with number cards, forced marches with Aces, charges with Crowns.
 * When the Excuse is turned over, the six unit tokens are scored by how far
 * forward they got (0..5 points each, ties sharing the lower value); the
 * player whose three secret units are worth most wins.
 *
 * Interpretations (also listed on web/rules/fifes-and-drums.html):
 *  - the wiki only clamps plays that would pass the *starting* space (a unit
 *    stays on space 1); this app also clamps a retreat that would run off
 *    the far end of the 45-space track — the unit stops on space 45;
 *  - a unit whose Crown is face up in the pool is "charged": when a number
 *    card carrying its suit is played, that unit must be moved toward the
 *    start (if both suits of the number card are charged, both move back);
 *  - the six retired Pawns and Courts are set aside unseen; this app keeps
 *    them in state but never renders them before the game ends;
 *  - equal final scores are a draw (the wiki just says "most points wins").
 */

import { mulberry32, SUIT_NAME } from '../decktet.js';

let BY_ID = null;
export const init = (byId) => { BY_ID = byId; };
export const card = (id) => BY_ID[String(id).split('#')[0]];

export const SUITS = ['moons', 'suns', 'waves', 'leaves', 'daemons', 'crowns'];
export const TRACK = 45;              // spaces 1..45, stored 0..44
export const POOL_SIZE = 5;
export const EXCUSE = 'the-excuse';

const suitName = (s) => SUIT_NAME[s] || s;
const isUnitCard = (id) => card(id).rank === 'pawn' || card(id).rank === 'court';

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

  // the goal cards: Pawns and Courts shuffled, one dealt to each player
  const unitCards = shuffled(deck.filter(isUnitCard), rng);      // 8 cards
  // five basic cards + the Excuse, shuffled, go on the bottom of the deck
  const basic = deck.filter((id) => !isUnitCard(id) && id !== EXCUSE);
  const body = shuffled(basic, rng);
  const bottom = shuffled([...body.slice(0, 5), EXCUSE], rng);
  // the top of the draw pile is the END of the array (pop() deals), so the
  // six-card bottom pile goes at the front
  const draw = [...bottom, ...body.slice(5)];

  const pool = [];
  for (let i = 0; i < POOL_SIZE; i++) pool.push(draw.pop());

  return {
    seed,
    moves: 0,
    goals: [unitCards[0], unitCards[1]],   // secret until the end
    aside: unitCards.slice(2),             // six retired units, never shown
    pos: Object.fromEntries(SUITS.map((s) => [s, 0])),
    pool,
    draw,
    discard: [],
    turn: 0,
    over: null,          // 'end' once the Excuse is turned over
    winner: null,        // 0 | 1 | 'draw'
  };
}

/* ------------------------------------------------------------ bookkeeping */

export const goalSuits = (id) => card(id).suits;

/** Is a Crown of this suit face up in the pool? (the pool param excludes
 *  the card being played, which the caller has already removed) */
export const crownCharged = (pool, suit) =>
  pool.some((id) => card(id).rank === 'crown' && card(id).suits.includes(suit));

/** The suits whose units are charged right now. */
export const chargedSuits = (pool) => SUITS.filter((s) => crownCharged(pool, s));

/** Points for each unit: the number of tokens strictly ahead of it toward
 *  the enemy = tokens behind it get 0, ties share the lower value. */
export function unitValues(state) {
  const out = {};
  for (const s of SUITS) {
    out[s] = SUITS.filter((t) => state.pos[t] < state.pos[s]).length;
  }
  return out;
}

export function scoreOf(state, p) {
  const v = unitValues(state);
  return goalSuits(state.goals[p]).reduce((sum, s) => sum + v[s], 0);
}

export const finalScores = (state) => [scoreOf(state, 0), scoreOf(state, 1)];

export function winnerOf(state) {
  const [a, b] = finalScores(state);
  return a === b ? 'draw' : (a > b ? 0 : 1);
}

/* ----------------------------------------------------------------- moves */

const clampTrack = (v) => Math.max(0, Math.min(TRACK - 1, v));

/** Forced march / charge: hop to the nearest occupied space in `dir`, or one
 *  space if nothing lies that way (clamped at both ends of the track). */
function march(pos, suit, dir) {
  const here = pos[suit];
  let best = null;
  for (const s of SUITS) {
    if (s === suit) continue;
    const p = pos[s];
    const nearer = dir === 'forward' ? p > here : p < here;
    if (!nearer) continue;
    if (best == null || (dir === 'forward' ? p < best : p > best)) best = p;
  }
  if (best != null) return best;
  return clampTrack(here + (dir === 'forward' ? 1 : -1));
}

/**
 * Play the order in pool slot `index`.
 *
 *  number card — plan.splits = { suit: spaces, … } totalling the rank, each
 *                unit at least one space; charged suits move back instead;
 *  Ace         — plan.direction = 'forward' | 'backward' (forced march);
 *  Crown       — no plan needed: charge the matching unit back to contact.
 */
export function play(state, index, plan = {}) {
  if (state.over) throw new Error('the game is over: the Excuse has been drawn');
  const id = state.pool[index];
  if (id == null) {
    throw new Error(`pool slot ${index + 1} is empty — take one of the face-up orders`);
  }
  const c = card(id);
  const next = structuredClone(state);
  next.pool.splice(index, 1);
  const charged = (suit) => crownCharged(next.pool, suit);

  if (typeof c.rank === 'number' && c.rank !== 1) {   // 2–9: a retreat order
    const suits = c.suits;
    const splits = plan.splits || {};
    for (const s of Object.keys(splits)) {
      if (!suits.includes(s)) {
        throw new Error(`the ${c.name} has no ${suitName(s)} unit: it orders the ` +
          `${suits.map(suitName).join(' and ')} units only`);
      }
    }
    const total = suits.reduce((sum, s) => sum + (splits[s] || 0), 0);
    if (total !== c.rank) {
      throw new Error(`the ${c.name} moves ${c.rank} spaces in total, but the plan moves ` +
        `${total} — split them between its ${suits.map(suitName).join(' and ')} units, ` +
        `at least one space each`);
    }
    for (const s of suits) {
      const v = splits[s];
      if (!Number.isInteger(v) || v < 1) {
        throw new Error(`${suitName(s)} must move at least one space ` +
          `(you gave ${v == null ? 'nothing' : v})`);
      }
      next.pos[s] = clampTrack(next.pos[s] + (charged(s) ? -v : v));
    }
  } else if (c.rank === 1) {
    const dir = plan.direction;
    if (dir !== 'forward' && dir !== 'backward') {
      throw new Error(`the ${c.name} is a forced march: choose a direction — ` +
        `'forward' (retreat) or 'backward' (charge)`);
    }
    const s = c.suits[0];
    next.pos[s] = march(next.pos, s, dir);
  } else if (c.rank === 'crown') {
    const s = c.suits[0];
    next.pos[s] = march(next.pos, s, 'backward');
  } else {
    throw new Error(`the ${c.name} cannot be played as an order`);
  }

  next.discard.push(id);
  next.moves += 1;

  // flip a replacement: the Excuse ends the game on the spot
  const flipped = next.draw.pop();
  if (flipped == null || flipped === EXCUSE) {
    next.over = 'end';
    next.winner = winnerOf(next);
    if (flipped != null) next.discard.push(flipped);
  } else {
    next.pool.push(flipped);
    next.turn = 1 - next.turn;
  }
  return next;
}
