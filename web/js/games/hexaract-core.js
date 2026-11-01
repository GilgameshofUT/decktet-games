/* Hexaract — game logic, no DOM.
 *
 * Rules: https://wiki.decktet.com/game:hexaract  (Dejan Racković)
 *
 * A solo adventure: roll 5d6, group the dice into couplets whose sums match
 * the ranks of the cards on your journey, and resolve them — thwart evil
 * personalities, survey locations, turn the tables on events — to gather all
 * six suit tokens before 10 points of harm end you.
 *
 * Extra material, emulated here: the 5 six-sided dice live in the state (a
 * roll button fills them, and a saved game keeps them), the suit chips are
 * counters on the cards and in your supply, and the damage tracker is a
 * 10-step harm track.
 *
 * Interpretations (all restated on the rules page):
 *   1. Deck: the wiki never says which deck to use and its extended-deck
 *      section is empty, so this app uses the basic 36-card deck — the six
 *      Aces are separated for setup, the other 30 cards form the journey.
 *   2. Setup's "collect three suit tokens" reads as one token matching the
 *      suit of each of the three flipped Aces.
 *   3. A location's "necessary resources" is one token per suit it shows;
 *      every token placed must match one of the card's suits.  That is the
 *      only reading under which the wiki's crown-location bonus ("discard a
 *      face up ace to collect that additional resource") can mean anything.
 *   4. The crown bonus spends any face-up Ace (its own suit is not required
 *      to match) and collects one extra resource matching a suit of the card
 *      you resolved — into your supply for personalities and events.
 *   5. "You may spend resources from your supply to enhance your exploration"
 *      is placing one personal-supply token on a location per turn, whether
 *      or not dice were assigned this turn (once placed, it has left your
 *      supply, as the wiki says).
 *   6. A location does not become exhausted at the end of the turn whose
 *      replenish drew it; initial locations count as arriving in turn 1, so
 *      they tire at the end of turn 2.  Personalities cost harm every turn
 *      with no grace; events cost their matching supply token on two
 *      consecutive turn-ends and are then discarded.
 *   7. The game ends when the deck is empty and the journey is clear: you win
 *      with at least one token of every suit in your supply, and lose
 *      without it.  10+ harm at any time loses immediately.
 *   8. When an unresolved event demands a token and both its suits are in
 *      your supply, the app discards from the suit holding the most copies
 *      (ties: the card's first suit) — the wiki leaves the choice to the
 *      player. */

import { mulberry32, baseId } from '../decktet.js';

let BY_ID = null;
export const init = (byId) => { BY_ID = byId; };
export const card = (id) => BY_ID[baseId(id)];

export const SUITS = ['moons', 'suns', 'waves', 'leaves', 'daemons', 'crowns'];
export const HARM_TO_LOSE = 10;
export const JOURNEY = 3;
export const DICE = 5;

/* Card types, from the Decktet Book's charts of interpretive type
 * (decktet.com/download/decktetbook-charts.pdf): 11 personalities, 11
 * locations and 11 events in the basic deck.  The three cards that are both
 * a location and an event — the Origin, the Market and the End — are
 * locations here, as the wiki instructs. */
const PERSONALITIES = ['the-author', 'the-bard', 'the-diplomat', 'the-huntress',
  'the-lunatic', 'the-merchant', 'the-painter', 'the-penitent',
  'the-sailor', 'the-savage', 'the-soldier'];
const EVENTS = ['the-battle', 'the-betrayal', 'the-calamity', 'the-chance-meeting',
  'the-discovery', 'the-harvest', 'the-journey', 'the-origin',
  'the-pact', 'the-rite', 'the-windfall'];
const LOCATIONS = ['the-borderland', 'the-castle', 'the-cave', 'the-darkness',
  'the-desert', 'the-end', 'the-forest', 'the-island', 'the-market',
  'the-mill', 'the-mountain', 'the-origin', 'the-sea', 'the-window'];

const TYPE = {};
for (const id of PERSONALITIES) TYPE[id] = 'personality';
for (const id of EVENTS) TYPE[id] = 'event';
for (const id of LOCATIONS) TYPE[id] = 'location';      // duals resolve as locations

export const typeOf = (id) => TYPE[baseId(id)];
export const rankOf = (id) => { const c = card(id); return c.rank === 'crown' ? 10 : c.rank; };
export const suitsOf = (id) => card(id).suits;
/** A location is finished when it holds one token per suit it shows. */
export const neededTokens = (id) => suitsOf(id).length;

/* ----------------------------------------------------------------- dice */

const values = (v) => (v === 6 ? [1, 2, 3, 4, 5] : [v]);   // a 6 is wild

/** Can this pair of dice (6s wild) sum to `rank`? */
export function coupletFits(a, b, rank) {
  return values(a).some((va) => values(b).some((vb) => va + vb === rank));
}

/** One way the dice can sum to `rank`: [value for a, value for b]. */
export function resolveWilds(a, b, rank) {
  for (const va of values(a).slice().reverse()) {
    for (const vb of values(b).slice().reverse()) {
      if (va + vb === rank) return [va, vb];
    }
  }
  return null;
}

/* -------------------------------------------------------------- helpers */

const shuffle = (arr, rng) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const zeroSupply = () => Object.fromEntries(SUITS.map((s) => [s, 0]));
const slotOf = (id, arrived) => ({ id, tokens: [], exhausted: false, arrived });

/** Every card that exists, for conservation checks (36 = 6 aces + 30). */
export function allCards(state) {
  return [...state.deck, ...state.discard, ...state.journey.map((s) => s && s.id).filter(Boolean),
    ...state.acesReserve, ...state.acesDiscarded];
}

export const supplyTotal = (state) => SUITS.reduce((n, s) => n + state.supply[s], 0);
export const hasAllSuits = (state) => SUITS.every((s) => state.supply[s] >= 1);
export const journeyCount = (state) => state.journey.filter(Boolean).length;

/* ----------------------------------------------------------------- setup */

export function newGame(seed, basicDeck) {
  const rng = mulberry32(seed);
  const pool = shuffle(basicDeck, rng);
  const aces = [], rest = [];
  for (const id of pool) (rankOf(id) === 1 ? aces : rest).push(id);

  const flipped = aces.slice(0, 3);          // your first three suit tokens
  const supply = zeroSupply();
  for (const a of flipped) supply[card(a).suits[0]] += 1;

  const journey = [];
  for (let i = 0; i < JOURNEY; i++) journey.push(slotOf(rest.shift(), 1));

  const st = {
    seed, rolls: 0,
    deck: rest,
    journey,                                   // 3 slots; each { id, tokens, exhausted, arrived }
    discard: [],                               // resolved / spent / discarded cards
    acesReserve: aces.slice(3),                // face up: the crown bonuses
    acesDiscarded: flipped,
    supply, harm: 0,
    dice: [],                                  // this turn's 5d6
    spentThisTurn: false,
    turn: 1, moves: 0, over: null, log: '',
  };
  st.log = 'Three Aces flip for your first tokens; the journey begins.';
  settle(st);
  return st;
}

/* --------------------------------------------------------------- scoring */

/** Harm 10+ loses at once; an empty deck with a clear journey decides by supply. */
export function settle(state) {
  if (state.over) return;
  if (state.harm >= HARM_TO_LOSE) { state.over = 'lost'; return; }
  if (!state.deck.length && !journeyCount(state)) {
    state.over = hasAllSuits(state) ? 'won' : 'lost';
  }
}

/* -------------------------------------------------------------- actions */

/** The couplets this turn's dice can form against each journey card. */
export function legalAssigns(state) {
  if (state.over || state.dice.length < 2) return [];
  const out = [];
  state.journey.forEach((slot, i) => {
    if (!slot) return;
    const rank = rankOf(slot.id);
    for (let a = 0; a < state.dice.length; a++) {
      for (let b = a + 1; b < state.dice.length; b++) {
        if (coupletFits(state.dice[a], state.dice[b], rank)) out.push({ slot: i, d1: a, d2: b });
      }
    }
  });
  return out;
}

/** The (location, suit) pairs a supply token could be spent on this turn. */
export function legalSpends(state) {
  if (state.over || state.spentThisTurn) return [];
  const out = [];
  state.journey.forEach((slot, i) => {
    if (!slot || typeOf(slot.id) !== 'location') return;
    for (const s of suitsOf(slot.id)) {
      if (state.supply[s] > 0) out.push({ slot: i, suit: s });
    }
  });
  return out;
}

function needDice(state) {
  if (state.dice.length < 2) throw new Error('Roll the dice first.');
}

/** Roll this turn's 5d6.  The result lives in the state, so a reload keeps it. */
export function rollDice(state) {
  if (state.over) throw new Error('the game is over');
  if (state.dice.length) throw new Error('You have already rolled this turn.');
  const rng = mulberry32(((state.seed ^ 0x9e3779b9) + state.rolls * 2654435761) >>> 0);
  const dice = Array.from({ length: DICE }, () => 1 + Math.floor(rng() * 6));
  const next = structuredClone(state);
  next.dice = dice;
  next.rolls += 1;
  next.moves += 1;
  next.log = `You roll ${dice.join(' · ')}.`;
  return next;
}

function consumeDice(next, d1, d2) {
  [d1, d2].sort((a, b) => b - a).forEach((i) => next.dice.splice(i, 1));
}

function placeOrComplete(next, slot, suit) {
  slot.tokens.push(suit);
  if (slot.tokens.length >= neededTokens(slot.id)) {
    next.journey[next.journey.indexOf(slot)] = null;   // traversed: card and tokens go
    next.discard.push(slot.id);
  }
}

/**
 * Assign a couplet of dice to a journey card.
 * suit: which of the card's suits the reward token shows.
 * aceIndex: index into the face-up Aces to spend for the crown bonus (null = skip).
 */
export function applyAssign(state, slot, d1, d2, suit, aceIndex = null) {
  if (state.over) throw new Error('the game is over');
  needDice(state);
  const next = structuredClone(state);
  const s = next.journey[slot];
  if (!s) throw new Error('that journey slot is empty');
  if (!Number.isInteger(d1) || !Number.isInteger(d2) || d1 === d2 ||
    d1 >= next.dice.length || d2 >= next.dice.length) throw new Error('bad dice');
  const rank = rankOf(s.id);
  if (!coupletFits(next.dice[d1], next.dice[d2], rank)) {
    const [va, vb] = [Math.min(next.dice[d1], 5), Math.min(next.dice[d2], 5)];
    throw new Error(`Those dice cannot sum to ${rank} (best they can do is ${va + vb}).`);
  }
  if (!suitsOf(s.id).includes(suit)) throw new Error(`${card(s.id).name} shows no ${suit}`);
  let ace = null;
  if (aceIndex != null) {
    ace = next.acesReserve[aceIndex];
    if (!ace) throw new Error('no face-up Ace there');
  }

  const type = typeOf(s.id);
  const name = card(s.id).name;
  consumeDice(next, d1, d2);

  if (type === 'location') {
    placeOrComplete(next, s, suit);
    next.log = `You survey ${name}: a ${suit} token settles on it.`;
  } else {
    next.journey[slot] = null;
    next.discard.push(s.id);
    next.supply[suit] += 1;
    next.log = type === 'personality'
      ? `You thwart ${name} and gain a ${suit} token.`
      : `You turn the tables on ${name} and gain a ${suit} token.`;
  }

  if (ace) {
    next.acesReserve.splice(aceIndex, 1);
    next.acesDiscarded.push(ace);
    next.supply[suit] += 1;
    next.log += ` A face-up Ace buys a second ${suit} token.`;
  }

  next.moves += 1;
  settle(next);
  return next;
}

/** Spend one personal-supply token on a location (at most one per turn). */
export function applySpend(state, slot, suit) {
  if (state.over) throw new Error('the game is over');
  const next = structuredClone(state);
  const s = next.journey[slot];
  if (!s) throw new Error('that journey slot is empty');
  if (typeOf(s.id) !== 'location') throw new Error('only a location can be enhanced with a resource');
  if (next.spentThisTurn) throw new Error('only one resource may be spent per turn');
  if (!suitsOf(s.id).includes(suit)) throw new Error(`${card(s.id).name} shows no ${suit}`);
  if (next.supply[suit] < 1) throw new Error(`you have no ${suit} token to spend`);
  next.supply[suit] -= 1;
  next.spentThisTurn = true;
  placeOrComplete(next, s, suit);
  next.moves += 1;
  next.log = `You spend a ${suit} token exploring ${card(s.id).name}.`;
  settle(next);
  return next;
}

/** End the turn: consequences of inaction, then exhaust & replenish. */
export function endTurn(state) {
  if (state.over) throw new Error('the game is over');
  const next = structuredClone(state);
  const notes = [];

  // ---- 3. Consequences of inaction ------------------------------------
  let harm = 0;
  for (const s of next.journey) {
    if (!s) continue;
    const type = typeOf(s.id);
    if (type === 'personality') harm += 1;
    else if (type === 'location' && s.exhausted) harm += 1;
    else if (type === 'event') {
      // discard one matching supply token, if any (most copies first)
      const suits = suitsOf(s.id).filter((x) => next.supply[x] > 0);
      if (suits.length) {
        const best = suits.slice().sort((a, b) =>
          next.supply[b] - next.supply[a] || suitsOf(s.id).indexOf(a) - suitsOf(s.id).indexOf(b))[0];
        next.supply[best] -= 1;
        notes.push(`${card(s.id).name} costs you its ${best} token`);
      }
    }
  }
  if (harm) {
    next.harm += harm;
    notes.unshift(`${harm} harm (${next.harm}/${HARM_TO_LOSE})`);
  }
  settle(next);
  if (next.over) {
    next.moves += 1;
    next.log = notes.join('; ') + '.';
    return next;
  }

  // ---- 4. Exhaust & Replenish -----------------------------------------
  for (let i = 0; i < JOURNEY; i++) {
    const s = next.journey[i];
    if (!s) continue;
    const type = typeOf(s.id);
    if (type === 'event') {
      if (s.exhausted) { next.journey[i] = null; next.discard.push(s.id); }   // its influence has passed
      else s.exhausted = true;
    } else if (type === 'location' && !s.exhausted && s.arrived < next.turn) {
      s.exhausted = true;                                // not the turn it arrived
    }
  }
  for (let i = 0; i < JOURNEY; i++) {
    if (next.journey[i]) continue;
    const id = next.deck.shift();
    if (id) next.journey[i] = slotOf(id, next.turn);
  }

  next.turn += 1;
  next.dice = [];
  next.spentThisTurn = false;
  next.moves += 1;
  next.log = (notes.length ? notes.join('; ') + '. ' : 'A quiet stretch. ') +
    `Turn ${next.turn}: roll the dice.`;
  settle(next);
  return next;
}

/** One entry point for the UI and the playouts: { type, … }. */
export function applyMove(state, action) {
  switch (action.type) {
    case 'roll': return rollDice(state);
    case 'assign': return applyAssign(state, action.slot, action.d1, action.d2, action.suit, action.aceIndex ?? null);
    case 'spend': return applySpend(state, action.slot, action.suit);
    case 'endTurn': return endTurn(state);
    default: throw new Error(`unknown action ${action.type}`);
  }
}
