/* Cascades — game logic, no DOM.
 *
 * Rules: https://wiki.decktet.com/game:cascades  (Joe Conard / P.D. Magnus)
 *
 * Three tiers of cards.  Work through the deck three cards at a time, playing
 * the top card of the turned-over trio onto the right end of a tier when it
 * shares a suit with the card already on that end — and when no tier holds
 * more cards of that rank than the tier directly above it.  When the deck
 * runs out, flip the waste over and go through it again (as in Klondike);
 * each completed trip frees the next of the three reserve piles.  Play every
 * card to win.
 *
 * Interpretations (each explained on the rules page):
 *   1. a "trip through the deck" is a full pass of the stock: when it runs
 *      out the waste is flipped back over (a redeal) and the player goes
 *      through it again.  Redeals are what make the wiki's "second pass" and
 *      "third pass" literal, what the linked reference implementation
 *      (mcdemarco.net) does, and what makes the game winnable at all — with
 *      a strictly single pass most deals die within the first trio.
 *   2. the trips free the reserve piles: the top one after the first trip,
 *      the middle after the second, the bottom after the third.  A freed
 *      pile's top card may be played at any time, alongside the waste.
 *   3. the suit rule is vacuous for an empty tier (there is no "card already
 *      on the end"), but the rank rules are not: to start the middle or
 *      bottom tier that rank must still already be in the tier above.
 *   4. rank bookkeeping is unified from the wiki's sentences: after a play no
 *      tier may hold more cards of one rank than the tier directly above it,
 *      and a tier holds at most one numbered card (2-9), two Aces, two
 *      Crowns — two Pawns or Courts in the extended deck.
 *   5. the second Pawn or Court may lead the top tier only once one of the
 *      same kind has been played on the bottom tier (the wiki's confusing
 *      "corresponding card … on the bottom tier" sentence).
 *   6. the game is lost when, after at least one trip through the deck,
 *      nothing on top of the waste or of any freed reserve pile can go
 *      anywhere and no redeal would surface anything playable. */

import { mulberry32, rankValue } from '../decktet.js';

let BY_ID = null;
export const init = (byId) => { BY_ID = byId; };
export const card = (id) => BY_ID[String(id).split('#')[0]];
export const rankOf = (id) => rankValue(card(id));

/** 'ace' | 2..9 | 'crown' | 'pawn' | 'court' — what the tier rules key on. */
export const rankKind = (id) => {
  const r = card(id).rank;
  return r === 1 ? 'ace' : r;
};
export const suitsOf = (id) => card(id).suits;

export const TIERS = 3;
export const FLIP_SIZE = 3;
export const RESERVE_SIZE = 3;
export const RESERVE_COUNT = 3;

/** The deck a game is played with: the basic 36, or +Pawns & Courts (44).
 *  The Excuse is never used in Cascades. */
export function deckList(data, extended = false) {
  return extended
    ? data.basicDeck.concat(data.extendedDeck.filter((id) => id !== 'the-excuse'))
    : data.basicDeck.slice();
}

export function newGame(seed, deck) {
  const rng = mulberry32(seed);
  const d = deck.slice();
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }

  const reserves = [];
  for (let r = 0; r < RESERVE_COUNT; r++) reserves.push(d.splice(0, RESERVE_SIZE));

  const st = {
    seed,
    deckSize: deck.length,
    tiers: [[], [], []],        // tiers[0] is the top tier; cards left -> right
    stock: d,                   // face down, bottom -> top (the end is the top)
    waste: [],                  // the turned-over trios; the end is the top
    reserves,                   // each bottom -> top; locked until freed
    trips: 0,                   // completed trips through the deck (stock runs)
    moves: 0,
    flips: 0,
    redeals: 0,
    over: null,
  };
  settle(st);
  return st;
}

export const top = (arr) => (arr && arr.length ? arr[arr.length - 1] : null);

/** Which reserve piles are free yet: [top, middle, bottom].
 *  The trips through the deck free them in order: the first trip frees the
 *  top pile, the second the middle, the third the bottom. */
export function reservesFree(state) {
  return [
    state.trips >= 1,
    state.trips >= 2,
    state.trips >= 3,
  ];
}

/** The card a source currently offers: src = {kind:'waste'} | {kind:'reserve', i}. */
export function sourceCard(state, src) {
  if (!src) return null;
  if (src.kind === 'waste') return top(state.waste);
  if (src.kind === 'reserve') {
    const i = src.i;
    if (!(i >= 0 && i < state.reserves.length)) return null;
    if (!reservesFree(state)[i]) return null;
    return top(state.reserves[i]);
  }
  return null;
}

/** Every source that currently has a playable-position card on top. */
export function playableSources(state) {
  const out = [];
  if (state.waste.length) out.push({ kind: 'waste' });
  const free = reservesFree(state);
  state.reserves.forEach((r, i) => {
    if (free[i] && r.length) out.push({ kind: 'reserve', i });
  });
  return out;
}

const countRank = (tier, kind) => tier.filter((id) => rankKind(id) === kind).length;
const KIND_NAME = { ace: 'Ace', crown: 'Crown', pawn: 'Pawn', court: 'Court' };

/** Why the card `id` may not go on tier `t` — or null when it may. */
export function tierRejection(state, id, t) {
  if (!(t >= 0 && t < TIERS)) return 'No such tier.';
  const tier = state.tiers[t];
  const kind = rankKind(id);
  const end = top(tier);                               // null for an empty tier
  // The suit rule needs a card "already on the end"; an empty tier has none.
  if (end && !suitsOf(id).some((s) => suitsOf(end).includes(s))) {
    return `${card(id).name} shares no suit with ${card(end).name} at the end of that tier.`;
  }

  if (typeof kind === 'number') {                      // numbered cards, ranks 2-9
    if (countRank(tier, kind) > 0) {
      return `Only one card of rank ${kind} may go in a tier.`;
    }
    if (t > 0 && countRank(state.tiers[t - 1], kind) === 0) {
      return `Play the rank ${kind} on the tier above first.`;
    }
    return null;
  }

  // Aces, Crowns, Pawns, Courts: at most two per tier, and no tier may hold
  // more of them than the tier directly above it.
  const name = KIND_NAME[kind] || kind;
  const art = kind === 'ace' ? 'an Ace' : `a ${name}`;   // "an Ace", "a Crown"…
  const here = countRank(tier, kind);
  if (here >= 2) return `No tier may hold more than two ${name}s.`;
  if (t > 0) {
    if (countRank(state.tiers[t - 1], kind) < here + 1) {
      return here === 0
        ? `There must be ${art} in the tier above to play one in a lower tier.`
        : `The tier above must hold two ${name}s before a second may be played here.`;
    }
    return null;
  }
  if ((kind === 'pawn' || kind === 'court') && here === 1
      && countRank(state.tiers[2], kind) === 0) {
    return `A second ${name} may lead the top tier only after one has been played on the bottom tier.`;
  }
  return null;
}

/** Why the source's card may not go on tier `t` — or null when it may. */
export function playRejection(state, src, t) {
  const id = sourceCard(state, src);
  if (!id) return 'Pick up the top card of the deck or of a freed draw pile first.';
  return tierRejection(state, id, t);
}

export const canPlay = (state, src, t) => playRejection(state, src, t) === null;

export function legalPlays(state) {
  const out = [];
  for (const src of playableSources(state)) {
    for (let t = 0; t < TIERS; t++) {
      if (canPlay(state, src, t)) out.push({ src, tier: t });
    }
  }
  return out;
}

export function applyPlay(state, src, t) {
  const bad = playRejection(state, src, t);
  if (bad) throw new Error(`illegal play: ${bad}`);
  const next = structuredClone(state);
  const pile = src.kind === 'waste' ? next.waste : next.reserves[src.i];
  next.tiers[t].push(pile.pop());
  next.moves += 1;
  settle(next);
  return next;
}

/** Turn the next trio of the deck face up onto the waste.
 *  The deck may hold any number of cards (27 or 35); the last flip takes
 *  whatever is left. */
export function applyFlip(state) {
  if (!state.stock.length) throw new Error('the deck is empty — flip the waste over instead');
  const next = structuredClone(state);
  const n = Math.min(FLIP_SIZE, next.stock.length);
  next.waste.push(...next.stock.splice(next.stock.length - n, n));
  next.flips += 1;
  if (!next.stock.length) next.trips += 1;             // a trip through the deck is done
  settle(next);
  return next;
}

/** May the waste be flipped back over onto the deck (Klondike-style redeal)? */
export const canRedeal = (state) => !state.stock.length && state.waste.length > 0;

/** Flip the waste face down onto the deck for another trip. */
export function applyRedeal(state) {
  if (!canRedeal(state)) {
    throw new Error(state.stock.length ? 'the deck still has cards — flip it' : 'the waste is empty');
  }
  const next = structuredClone(state);
  next.stock = next.waste.slice().reverse();           // same order comes round again
  next.waste = [];
  next.redeals += 1;
  settle(next);
  return next;
}

/** Every card that will be the waste's top during the next trips: the redeal
 *  reverses the waste and the trios shift its phase, so the order repeats
 *  after a few trips — this returns the tops of one full period, i.e.
 *  everything a redeal could ever surface again. */
export function redealTops(state) {
  let stock = state.waste.slice().reverse();
  const seenOrders = new Set();
  const tops = [];
  for (;;) {
    const key = stock.join('|');
    if (seenOrders.has(key)) break;              // nothing new can ever surface
    seenOrders.add(key);
    let waste = [];
    while (stock.length) {
      const n = Math.min(FLIP_SIZE, stock.length);
      waste.push(...stock.splice(stock.length - n, n));
      tops.push(top(waste));
    }
    stock = waste.slice().reverse();
  }
  return tops;
}

export const cardsPlayed = (state) => state.tiers.reduce((n, t) => n + t.length, 0);
export const score = cardsPlayed;

export function allCards(state) {
  return [...state.tiers.flat(), ...state.stock, ...state.waste, ...state.reserves.flat()];
}

/** Every card played: nothing is left in the deck, waste or draw piles. */
export const isWon = (state) => cardsPlayed(state) === state.deckSize;

/** After at least one trip: nothing playable on top of a source, and no
 *  redeal would surface anything playable either. */
export function isStuck(state) {
  if (state.stock.length || state.trips < 1) return false;
  const anyPlayable = (id) => state.tiers.some((_, t) => tierRejection(state, id, t) === null);
  if (playableSources(state).some((src) => anyPlayable(sourceCard(state, src)))) return false;
  return !redealTops(state).some(anyPlayable);         // another trip would show nothing new
}

export function settle(state) {
  if (state.over) return;
  if (isWon(state)) state.over = 'won';
  else if (isStuck(state)) state.over = 'stuck';
}

export const OUTCOME = {
  won: { title: 'You win', cls: 'win', text: 'Every card has been played into the three tiers.' },
  stuck: {
    title: 'No moves left',
    cls: 'lose',
    text: 'Another trip through the deck would show nothing playable, and nothing left ' +
      'on top of a pile can go anywhere.',
  },
};
