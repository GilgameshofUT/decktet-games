/* Second Story — game logic, no DOM.
 *
 * Rules: https://wiki.decktet.com/game:second-story  (P.D. Magnus)
 *
 * A press-your-luck burglary for two players on one device.  Each turn is one
 * night: flip a card, and its rank is the house's security, its suits the
 * loot.  Roll against the rank — one die for a thorough job, two dice to be
 * quick — and fill your bag with suit chips; get out before the guard
 * notices, because a caught burglar drops the bag.  Chips banked in the lair
 * are safe (bar a crown's second chance).  Aces are a bit of luck: take a
 * chip, or lose one that fell out.  When one suit runs dry in the bank the
 * players get one last night each, and the score is your second most
 * numerous suit.
 *
 * Interpretations (all stated on the rules page):
 *   1. Two players: turns simply alternate, the pass screen between them.
 *   2. Dice come from a seeded sequence (seed + rngN) kept in state, so a
 *      reload shows the same roll; a d10 counts 1..10, the '0' face the high
 *      10 as the wiki says.  `act`/`reroll` accept explicit dice for tests.
 *   3. When a suit is depleted, a successful job pays nothing for that suit
 *      ("no compensation"); an Ace of a depleted suit likewise does nothing.
 *   4. The final phase starts at the end of the turn that empties a suit;
 *      play then continues in order and the player who emptied the suit
 *      takes their last night last (the wiki's "also get the final turn").
 *   5. Second-most-suit scoring, ties broken by third, fourth … through the
 *      sixth most numerous suit, then a tie — the wiki's rule.
 *   6. A crown second chance may be taken again while matching lair chips
 *      last; failing with none left ends the night with the bag dropped. */

import { mulberry32, rankValue, baseId, shuffle } from '../decktet.js';

let BY_ID = null;
export const init = (byId) => { BY_ID = byId; };
export const card = (id) => BY_ID[baseId(id)];
export const rankOf = (id) => rankValue(card(id));          // Ace 1 … 9, Crown 10

export const SUITS = ['moons', 'suns', 'waves', 'leaves', 'daemons', 'crowns'];
export const START_CHIPS = 10;                              // per suit; 60 in all

export const emptyLair = () => Object.fromEntries(SUITS.map((s) => [s, 0]));
export const emptyBank = () => Object.fromEntries(SUITS.map((s) => [s, START_CHIPS]));

const mix = (seed, n) => (seed ^ Math.imul(n + 1, 0x9e3779b9)) >>> 0;

/** One d10 from the seeded sequence; mutates the clone it is given. */
export function rollDie(state) {
  const rng = mulberry32(mix(state.seed, state.rngN));
  state.rngN += 1;
  return 1 + Math.floor(rng() * 10);
}

/* ------------------------------------------------------------------ setup */

export function newGame(seed, deck) {
  return {
    seed,
    rngN: 0,
    deck: shuffle(deck, mulberry32(seed)),
    discard: [],
    bank: emptyBank(),
    lair: [emptyLair(), emptyLair()],
    bag: [],
    cards: [],           // cards revealed this night, face up
    events: [],          // what happened this night, in order
    player: 0,
    phase: 'flip',       // 'flip' | 'act' | 'take' | 'chance' | 'decide'
    card: null,          // the house being burgled right now
    mode: null,          // 'thorough' | 'quick'
    roll: null,          // the dice as they landed — kept for reloads
    final: false,        // the last night has begun
    finalQueue: [],      // who still takes a final turn
    log: [],             // one entry per finished night
    turn: 1,
    moves: 0,
    over: null,
    winner: null,
  };
}

/** Bank + bags + lairs: every chip is somewhere. */
export function chipTotals(state) {
  const total = emptyBank();
  for (const s of SUITS) {
    total[s] = state.bank[s] + state.bag.filter((x) => x === s).length +
      state.lair[0][s] + state.lair[1][s];
  }
  return total;
}

/* ------------------------------------------------------------------ moves */

function drawOne(next) {
  if (!next.deck.length) {
    if (!next.discard.length) throw new Error('no cards left to flip');
    const rng = mulberry32(mix(next.seed, next.rngN));
    next.rngN += 1;
    next.deck = shuffle(next.discard, rng);
    next.discard = [];
  }
  next.cards.push(next.deck.shift());
}

const removeOne = (arr, suit) => arr.splice(arr.indexOf(suit), 1);
const lairHas = (state, suit) => state.lair[state.player][suit] > 0;

/** Take a chip of `suit` into the bag, if the bank still has one. */
function fillBag(next, suit) {
  if (next.bank[suit] > 0) {
    next.bank[suit] -= 1;
    next.bag.push(suit);
  } else {
    next.events.push(`No ${suit} chips are left in the city — no compensation.`);
  }
}

/** Flip the next card of the night.  Aces resolve immediately. */
export function flip(state) {
  if (state.over) throw new Error('the game is over');
  if (state.phase !== 'flip') throw new Error('there is no card to flip right now');
  const next = structuredClone(state);
  drawOne(next);
  const id = next.cards[next.cards.length - 1];
  const c = card(id);
  next.card = id;
  next.roll = null;
  next.mode = null;

  if (c.rank === 1) {
    const suit = c.suits[0];
    if (next.bag.includes(suit)) {
      removeOne(next.bag, suit);
      next.bank[suit] += 1;
      next.events.push(`${c.name}: something fell out of your bag — a ${suit} chip goes back to the bank.`);
    } else if (next.bank[suit] > 0) {
      fillBag(next, suit);
      next.events.push(`${c.name}: good luck — take a ${suit} chip for your bag.`);
    } else {
      next.events.push(`${c.name}: no ${suit} chips are left in the city.`);
    }
    next.card = null;               // you can't end a turn on an Ace
    next.phase = 'flip';
    return next;
  }
  next.phase = 'act';
  return next;
}

/**
 * Roll against the house: 'thorough' takes one die and both suits on
 * success, 'quick' two dice and one suit of your choice.  Crowns are always
 * rolled with two dice.  Pass explicit `dice` only in tests/fixtures. */
export function act(state, mode, dice = null) {
  if (state.over) throw new Error('the game is over');
  if (state.phase !== 'act') throw new Error('there is nothing to act on right now');
  const c = card(state.card);
  if (c.rank === 1) throw new Error('an Ace is resolved as it is flipped');
  if (mode !== 'thorough' && mode !== 'quick') throw new Error('bad move');
  if (c.rank === 'crown' && mode !== 'quick') throw new Error('a Crown always takes two dice');

  const next = structuredClone(state);
  const want = mode === 'thorough' ? 1 : 2;
  if (dice) {
    if (dice.length !== want || dice.some((d) => !Number.isInteger(d) || d < 1 || d > 10)) {
      throw new Error('bad dice');
    }
    next.roll = dice.slice();
  } else {
    next.roll = [];
    while (next.roll.length < want) next.roll.push(rollDie(next));
  }
  next.mode = mode;

  const rank = rankValue(c);                        // a Crown is security 10
  const words = mode === 'thorough' ? 'One die' : 'Both dice';
  if (!next.roll.some((d) => d >= rank)) {
    next.events.push(`${words} ${next.roll.join(' and ')} — under the security of ${c.name}: the guard has noticed you.`);
    if (c.rank === 'crown' && lairHas(next, c.suits[0])) {
      next.phase = 'chance';
      return next;
    }
    return endNight(next, true);
  }

  next.events.push(`${words} ${next.roll.join(' and ')} — you are inside ${c.name}.`);
  if (mode === 'thorough') {
    for (const suit of c.suits) fillBag(next, suit);   // one chip per suit
    next.phase = 'decide';
    return next;
  }
  const avail = c.suits.filter((s) => next.bank[s] > 0);
  if (!avail.length) {
    next.events.push('Nothing of that kind is left in the city.');
    next.phase = 'decide';
    return next;
  }
  if (avail.length === 1) {                             // nothing to choose
    fillBag(next, avail[0]);
    next.phase = 'decide';
    return next;
  }
  next.phase = 'take';                                  // pick one of the two
  return next;
}

/** The quick job takes one chip: say which of the card's suits. */
export function take(state, suit) {
  if (state.phase !== 'take') throw new Error('there is nothing to take right now');
  const c = card(state.card);
  if (!c.suits.includes(suit)) throw new Error('that suit is not in this house');
  if (state.bank[suit] < 1) throw new Error(`no ${suit} chips are left in the bank`);
  const next = structuredClone(state);
  fillBag(next, suit);
  next.phase = 'decide';
  return next;
}

/** A crown's second chance: risk a matching lair chip and roll again. */
export function reroll(state, dice = null) {
  if (state.phase !== 'chance') throw new Error('there is no second chance to take');
  const suit = card(state.card).suits[0];
  if (!lairHas(state, suit)) throw new Error(`you have no ${suit} chip in your lair to risk`);
  const next = structuredClone(state);
  next.lair[next.player][suit] -= 1;
  next.bag.push(suit);
  next.events.push(`You move a ${suit} chip from your lair to your bag and reroll.`);
  if (dice) {
    if (dice.length !== 2 || dice.some((d) => !Number.isInteger(d) || d < 1 || d > 10)) {
      throw new Error('bad dice');
    }
    next.roll = dice.slice();
  } else {
    next.roll = [rollDie(next), rollDie(next)];
  }
  if (next.roll.some((d) => d >= 10)) {                  // only a ten beats a Crown
    fillBag(next, suit);
    next.events.push(`${next.roll.join(' and ')} — you made it out with the crown's chip.`);
    next.phase = 'decide';
    return next;
  }
  next.events.push(`${next.roll.join(' and ')} — you missed again.`);
  if (lairHas(next, suit)) {                             // another second chance
    next.phase = 'chance';
    return next;
  }
  return endNight(next, true);
}

/** Give up the second chance: the bag is dropped. */
export function giveUp(state) {
  if (state.phase !== 'chance') throw new Error('there is no second chance to give up');
  return endNight(structuredClone(state), true);
}

/** End the night: the bag goes to the lair, or is dropped back to the bank. */
export function stop(state) {
  if (state.phase !== 'decide') throw new Error('you cannot stop right now');
  return endNight(structuredClone(state), false);
}

/** Try another house — you may not back down once the card is flipped. */
export function cont(state) {
  if (state.phase !== 'decide') throw new Error('there is no house to try right now');
  const next = structuredClone(state);
  next.phase = 'flip';
  next.card = null;
  next.roll = null;
  next.mode = null;
  return next;
}

function endNight(next, caught) {
  const p = next.player;
  if (caught) {
    const dropped = next.bag.length;
    for (const suit of next.bag) next.bank[suit] += 1;
    next.events.push(`Caught! ${dropped} chip(s) drop back into the bank.`);
  } else {
    for (const suit of next.bag) next.lair[p][suit] += 1;
    next.events.push(`${next.bag.length} chip(s) carried back to your lair.`);
  }
  next.log.push({
    turn: next.turn, player: p, caught,
    events: next.events.slice(), cards: next.cards.slice(),
  });
  for (const id of next.cards) next.discard.push(id);
  next.bag = [];
  next.cards = [];
  next.events = [];
  next.card = null;
  next.mode = null;
  next.roll = null;
  next.turn += 1;
  next.moves += 1;

  if (next.final) {
    next.finalQueue.shift();
    if (!next.finalQueue.length) { finish(next); return next; }
    next.player = next.finalQueue[0];
  } else {
    next.player = 1 - p;
    if (SUITS.some((s) => next.bank[s] === 0)) {
      // the last night: everyone gets one more turn, emptier last
      next.final = true;
      next.finalQueue = [1 - p, p];
      next.player = 1 - p;
    }
  }
  next.phase = 'flip';
  return next;
}

function finish(next) {
  next.over = 'done';
  const a = scoreVector(next.lair[0]);
  const b = scoreVector(next.lair[1]);
  let winner = null;
  for (let i = 1; i < 6; i++) {                 // disregard the most numerous
    if (a[i] !== b[i]) { winner = a[i] > b[i] ? 0 : 1; break; }
  }
  next.winner = winner;
}

/* --------------------------------------------------------------- scoring */

/** Chips per suit, most numerous first — six entries, padded with zeros. */
export function scoreVector(lair) {
  const counts = SUITS.map((s) => lair[s] || 0).sort((x, y) => y - x);
  while (counts.length < 6) counts.push(0);
  return counts;
}

/** The score: the number of chips in your second most numerous suit. */
export const lairScore = (lair) => scoreVector(lair)[1];
